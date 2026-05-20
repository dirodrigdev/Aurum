import type { PortfolioWeights } from './model/types';
import type {
  InstrumentImplementationDestinationDiagnostic,
  InstrumentImplementationPlan,
  InstrumentImplementationStage,
  InstrumentImplementationStageSummary,
  InstrumentImplementationTransfer,
  InstrumentImplementationUniverse,
} from './instrumentImplementationTypes';
import { REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP } from './optimizerPolicyConfig';

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const MIN_MOVE_CLP = 10_000_000;
const MIN_MOVE_WEIGHT_FLOOR = 0.0075; // 0.75%
const RV_DIRECTION_EPS = 1e-6;

type ImplementationInstrument = InstrumentImplementationUniverse['instruments'][number];

const normalizeWeights = (weights: PortfolioWeights): PortfolioWeights => {
  const rvGlobal = clamp01(weights.rvGlobal);
  const rvChile = clamp01(weights.rvChile);
  const rfGlobal = clamp01(weights.rfGlobal);
  const rfChile = clamp01(weights.rfChile);
  const total = rvGlobal + rvChile + rfGlobal + rfChile;
  if (total <= 0) return { rvGlobal: 0, rvChile: 0, rfGlobal: 0, rfChile: 1 };
  return {
    rvGlobal: rvGlobal / total,
    rvChile: rvChile / total,
    rfGlobal: rfGlobal / total,
    rfChile: rfChile / total,
  };
};

function buildTargetFromRiskMix(rvTarget: number, currentGlobalShare: number): PortfolioWeights {
  const rv = clamp01(rvTarget);
  const rf = 1 - rv;
  const globalShare = clamp01(currentGlobalShare);
  const localShare = 1 - globalShare;
  return normalizeWeights({
    rvGlobal: rv * globalShare,
    rvChile: rv * localShare,
    rfGlobal: rf * globalShare,
    rfChile: rf * localShare,
  });
}

function deriveRvOfInstrument(item: ImplementationInstrument): number {
  return clamp01(item.currentMixUsed?.rv ?? 0);
}

function deriveGlobalOfInstrument(item: ImplementationInstrument): number {
  return clamp01(item.exposureUsed?.global ?? 0.5);
}

function canSellInstrument(item: ImplementationInstrument): boolean {
  return item.usable && (item.weightPortfolio ?? 0) > 0 && item.isSellable !== false;
}

function canUseAsDestination(item: ImplementationInstrument): boolean {
  return Boolean(item.instrumentId && item.currentMixUsed && item.currency && item.decisionEligible !== false);
}

function inferManagerName(item: ImplementationInstrument): string | null {
  if (!item.name) return null;
  const token = item.name.trim().split(/\s+/)[0];
  return token ? token.toUpperCase() : null;
}

function hasSameManager(source: ImplementationInstrument, destination: ImplementationInstrument): boolean {
  const sourceManager = inferManagerName(source);
  const destinationManager = inferManagerName(destination);
  return source.sameManagerCandidates.includes(destination.instrumentId)
    || Boolean(sourceManager && destinationManager && sourceManager === destinationManager);
}

function hasSameTaxWrapper(source: ImplementationInstrument, destination: ImplementationInstrument): boolean {
  return source.sameTaxWrapperCandidates.includes(destination.instrumentId)
    || Boolean(source.taxWrapper && destination.taxWrapper && source.taxWrapper === destination.taxWrapper);
}

function inferOperationalCandidateClass(item: ImplementationInstrument): {
  eligible: boolean;
  reason: string;
} {
  if (!item.instrumentId) return { eligible: false, reason: 'Sin identificador de instrumento.' };
  if (!item.currentMixUsed) return { eligible: false, reason: 'Sin mix RV/RF usable.' };
  if (!item.currency) return { eligible: false, reason: 'Sin moneda informada.' };

  const name = `${item.name ?? ''} ${item.vehicleType ?? ''} ${item.taxWrapper ?? ''} ${item.role ?? ''}`.toLowerCase();
  const replacementConstraint = `${item.replacementConstraint ?? ''}`.toLowerCase();
  const planVitalLike = name.includes('planvital');
  const voluntaryLike = name.includes('cuenta 2') || name.includes('cuenta2') || name.includes('apv') || name.includes('voluntar');
  const blockedByAfpConstraint = replacementConstraint.includes('afp') || replacementConstraint.includes('oblig');

  if (planVitalLike && blockedByAfpConstraint && !voluntaryLike) {
    return {
      eligible: false,
      reason: 'PlanVital Fondo A no usado porque está marcado como no operable/cautivo. Si corresponde a Cuenta 2, falta representarlo como posición voluntaria operable.',
    };
  }
  if (planVitalLike && !voluntaryLike && !item.taxWrapper) {
    return { eligible: false, reason: 'PlanVital no usado por falta de metadata de transferibilidad/wrapper.' };
  }
  if (item.isCaptive === true) {
    return { eligible: false, reason: 'Instrumento cautivo/no receptor de aportes.' };
  }
  if (item.decisionEligible === false) return { eligible: false, reason: 'Marcado como no elegible para decisión.' };

  if (item.isSellable === false) {
    if (voluntaryLike) {
      return { eligible: true, reason: 'Elegible como destino voluntario (aporte/traspaso), aunque no sea origen vendible.' };
    }
    return { eligible: false, reason: 'Marcado como no operable para traspaso.' };
  }

  return { eligible: true, reason: 'Elegible como destino operativo.' };
}

function isVoluntaryDestination(item: ImplementationInstrument): boolean {
  const name = `${item.name ?? ''} ${item.vehicleType ?? ''} ${item.taxWrapper ?? ''} ${item.role ?? ''}`.toLowerCase();
  return name.includes('cuenta 2') || name.includes('cuenta2') || name.includes('apv') || name.includes('voluntar');
}

function scorePair(source: ImplementationInstrument, destination: ImplementationInstrument): number {
  let score = 0;
  const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
  const sameManager = hasSameManager(source, destination);
  const sameWrapper = hasSameTaxWrapper(source, destination);

  if (sameCurrency) score += 6;
  if (sameManager) score += 4;
  if (sameWrapper) score += 2;
  if (source.sameCurrencyCandidates.includes(destination.instrumentId)) score += 2;

  score += (destination.replaceabilityScore ?? 0) * 2;
  score += (destination.estimatedMixImpactPoints ?? 0) / 100;
  score += deriveRvOfInstrument(destination) * 8;
  if (destination.replacementConstraint && destination.replacementConstraint !== 'none') score -= 1;
  return score;
}

function stageStatusReasonForGap(
  stage: InstrumentImplementationStage,
  used: boolean,
  remainingGapRvPp: number,
  hasAllowedCandidates: boolean,
): InstrumentImplementationStageSummary['statusReason'] {
  if (used) return 'used';
  if (Math.abs(remainingGapRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9) return 'not_required';
  if (!hasAllowedCandidates) return stage === 'cross_manager' ? 'sin_destinos_elegibles' : 'bloqueado_por_metadata';
  return 'agotado';
}

export function buildInstrumentImplementationPlan(input: {
  universe: InstrumentImplementationUniverse;
  targetWeights: PortfolioWeights;
}): InstrumentImplementationPlan | null {
  const instruments = input.universe.instruments.filter(canSellInstrument);
  const destinationDiagnosticsSeed = input.universe.instruments.map((item) => {
    const eligibility = inferOperationalCandidateClass(item);
    return {
      item,
      diagnostic: {
        instrumentId: item.instrumentId || 'sin-id',
        name: item.name ?? item.instrumentId ?? 'Sin nombre',
        rv: deriveRvOfInstrument(item),
        eligible: eligibility.eligible,
        used: false,
        reason: eligibility.reason,
      } as InstrumentImplementationDestinationDiagnostic,
    };
  });
  const destinationUniverse = destinationDiagnosticsSeed
    .filter((row) => row.diagnostic.eligible)
    .map((row) => row.item)
    .filter(canUseAsDestination);
  const destinationDiagnosticsMap = new Map(destinationDiagnosticsSeed.map((row) => [row.item.instrumentId, row.diagnostic]));
  if (!instruments.length) return null;

  const currentRv = instruments.reduce((sum, item) => sum + (item.weightPortfolio ?? 0) * deriveRvOfInstrument(item), 0);
  const currentRf = 1 - currentRv;
  const targetRv = clamp01(input.targetWeights.rvGlobal + input.targetWeights.rvChile);
  const targetRf = 1 - targetRv;
  const deltaRv = targetRv - currentRv;
  const currentGlobalShare = instruments.reduce((sum, item) => sum + (item.weightPortfolio ?? 0) * deriveGlobalOfInstrument(item), 0);

  const restrictionsApplied = {
    sameCurrency: true,
    sameManager: true,
    sameTaxWrapper: true,
    crossManager: false,
    crossCurrency: false,
  };
  const stageSummaries: InstrumentImplementationStageSummary[] = [];

  if (Math.abs(deltaRv) <= 1e-6) {
    const reachableWeights = buildTargetFromRiskMix(currentRv, currentGlobalShare);
    return {
      targetMixIdeal: { rv: targetRv, rf: targetRf },
      currentMix: { rv: currentRv, rf: currentRf },
      reachableMix: { rv: currentRv, rf: currentRf },
      gapVsIdealRvPp: 0,
      equivalentToIdeal: true,
      structuralChangeRequired: false,
      transfers: [],
      stageSummaries,
      destinationDiagnostics: Array.from(destinationDiagnosticsMap.values()),
      restrictionsApplied,
      warnings: [],
      baseTargetWeights: normalizeWeights(input.targetWeights),
      reachableWeights,
    };
  }

  const movingToHigherRv = deltaRv > 0;
  const sources = [...instruments]
    .filter((item) => movingToHigherRv ? deriveRvOfInstrument(item) < targetRv : deriveRvOfInstrument(item) > targetRv)
    .sort((a, b) => {
      const byWeight = Math.max(0, b.weightPortfolio ?? 0) - Math.max(0, a.weightPortfolio ?? 0);
      if (Math.abs(byWeight) > 1e-9) return byWeight;
      return movingToHigherRv
        ? deriveRvOfInstrument(a) - deriveRvOfInstrument(b)
        : deriveRvOfInstrument(b) - deriveRvOfInstrument(a);
    });

  const destinations = [...destinationUniverse]
    .filter((item) => movingToHigherRv ? deriveRvOfInstrument(item) > currentRv + 1e-6 : deriveRvOfInstrument(item) < currentRv - 1e-6)
    .sort((a, b) => {
      const rvA = deriveRvOfInstrument(a);
      const rvB = deriveRvOfInstrument(b);
      if (movingToHigherRv && Math.abs(rvB - rvA) > 1e-9) return rvB - rvA;
      if (!movingToHigherRv && Math.abs(rvA - rvB) > 1e-9) return rvA - rvB;
      return (b.replaceabilityScore ?? 0) - (a.replaceabilityScore ?? 0);
    });

  const sourceRemaining = new Map(sources.map((item) => [item.instrumentId, clamp01(item.weightPortfolio ?? 0)]));
  const destinationCapacity = new Map(destinations.map((item) => [item.instrumentId, Math.max(0, 1 - clamp01(item.weightPortfolio ?? 0))]));
  const transfers: InstrumentImplementationTransfer[] = [];
  let remainingDelta = Math.abs(deltaRv);
  const portfolioTotalClp = Math.max(0, instruments.reduce((sum, item) => sum + Math.max(0, item.amountClp ?? 0), 0));
  const minMoveWeight = portfolioTotalClp > 0 ? Math.min(MIN_MOVE_WEIGHT_FLOOR, MIN_MOVE_CLP / portfolioTotalClp) : MIN_MOVE_WEIGHT_FLOOR;

  const stageConfig: Array<{
    stage: InstrumentImplementationStage;
    allow: (input: { sameCurrency: boolean; sameManager: boolean; sameTaxWrapper: boolean; source: ImplementationInstrument; destination: ImplementationInstrument }) => boolean;
  }> = [
    {
      stage: 'clean',
      allow: ({ sameCurrency, sameManager, sameTaxWrapper, source, destination }) => {
        const strictWrapperCompatible = source.taxWrapper && destination.taxWrapper ? sameTaxWrapper : true;
        return sameCurrency && sameManager && strictWrapperCompatible;
      },
    },
    {
      stage: 'cross_manager',
      allow: ({ sameCurrency, sameManager, sameTaxWrapper, source, destination }) => {
        const wrapperCompatible = source.taxWrapper && destination.taxWrapper
          ? (sameTaxWrapper || isVoluntaryDestination(destination))
          : true;
        return sameCurrency && !sameManager && wrapperCompatible;
      },
    },
    {
      stage: 'cross_currency',
      allow: ({ sameCurrency }) => !sameCurrency,
    },
  ];

  for (const stage of stageConfig) {
    if (remainingDelta <= 1e-6) {
      stageSummaries.push({
        stage: stage.stage,
        used: false,
        statusReason: 'not_required',
        operationCount: 0,
        movedClp: 0,
        reachedMix: {
          rv: movingToHigherRv ? targetRv - remainingDelta : targetRv + remainingDelta,
          rf: movingToHigherRv ? 1 - (targetRv - remainingDelta) : 1 - (targetRv + remainingDelta),
        },
        remainingGapRvPp: remainingDelta * 100,
      });
      continue;
    }

    const stageTransferStart = transfers.length;
    const stageClpStart = transfers.reduce((sum, item) => sum + item.amountClpMoved, 0);

    const hasAllowedCandidates = destinations.some((destination) => sources.some((source) => {
      if (source.instrumentId === destination.instrumentId) return false;
      const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
      const sameManager = hasSameManager(source, destination);
      const sameTaxWrapper = hasSameTaxWrapper(source, destination);
      return stage.allow({ sameCurrency, sameManager, sameTaxWrapper, source, destination });
    }));

    for (const source of sources) {
      const sourceWeight = sourceRemaining.get(source.instrumentId) ?? 0;
      if (sourceWeight <= 1e-6 || remainingDelta <= 1e-6) continue;

      const orderedDestinations = [...destinations].sort((a, b) => scorePair(source, b) - scorePair(source, a));
      for (const destination of orderedDestinations) {
        if (remainingDelta <= 1e-6) break;
        if (source.instrumentId === destination.instrumentId) continue;

        const capacity = destinationCapacity.get(destination.instrumentId) ?? 0;
        if (capacity <= 1e-6) continue;

        const sourceRv = deriveRvOfInstrument(source);
        const destinationRv = deriveRvOfInstrument(destination);
        const improvesRvDirection = movingToHigherRv
          ? destinationRv > sourceRv + RV_DIRECTION_EPS
          : destinationRv < sourceRv - RV_DIRECTION_EPS;
        if (!improvesRvDirection) continue;
        const rvLiftPerWeight = Math.abs(destinationRv - sourceRv);
        if (rvLiftPerWeight <= 1e-6) continue;

        const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
        const sameManager = hasSameManager(source, destination);
        const sameTaxWrapper = hasSameTaxWrapper(source, destination);
        if (!stage.allow({ sameCurrency, sameManager, sameTaxWrapper, source, destination })) continue;

        const maxByNeed = remainingDelta / rvLiftPerWeight;
        const currentSourceRemaining = sourceRemaining.get(source.instrumentId) ?? 0;
        const moveWeight = Math.min(currentSourceRemaining, capacity, maxByNeed);
        if (moveWeight <= 1e-6) continue;

        const sourceClp = Math.max(0, source.amountClp ?? 0);
        const moveClpEstimate = sourceClp * (Math.max(0, source.weightPortfolio ?? 0) > 0 ? moveWeight / Math.max(1e-9, source.weightPortfolio ?? 0) : 0);
        const isMicroMove = moveWeight < minMoveWeight || moveClpEstimate < MIN_MOVE_CLP;
        const closesMaterialGap = (remainingDelta * 100) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 0.5;
        if (isMicroMove && !closesMaterialGap) continue;

        const crossManager = !sameManager;
        const crossCurrency = !sameCurrency;
        if (crossManager) restrictionsApplied.crossManager = true;
        if (crossCurrency) restrictionsApplied.crossCurrency = true;
        if (!sameManager) restrictionsApplied.sameManager = false;
        if (!sameTaxWrapper) restrictionsApplied.sameTaxWrapper = false;
        if (!sameCurrency) restrictionsApplied.sameCurrency = false;

        const rationale = stage.stage === 'clean'
          ? 'Sube RV/RF con tramo limpio (misma moneda y manager)'
          : stage.stage === 'cross_manager'
            ? 'Acerca RV/RF objetivo con cruce entre administradoras en misma moneda'
            : 'Acerca RV/RF objetivo con cambio de moneda (tramo excepcional)';
        const sourceWeightTotal = Math.max(0, source.weightPortfolio ?? 0);
        const nativeRatio = sourceWeightTotal > 0 ? moveWeight / sourceWeightTotal : 0;

        transfers.push({
          fromInstrumentId: source.instrumentId,
          fromName: source.name ?? source.instrumentId,
          fromManager: inferManagerName(source),
          fromCurrency: source.currency ?? null,
          fromTaxWrapper: source.taxWrapper ?? null,
          toInstrumentId: destination.instrumentId,
          toName: destination.name ?? destination.instrumentId,
          toManager: inferManagerName(destination),
          toCurrency: destination.currency ?? null,
          toTaxWrapper: destination.taxWrapper ?? null,
          weightMoved: moveWeight,
          amountNativeMoved: source.amountNative !== null && source.amountNative !== undefined
            ? source.amountNative * nativeRatio
            : null,
          nativeCurrency: source.amountNativeCurrency ?? source.currency ?? null,
          amountClpMoved: (source.amountClp ?? 0) * nativeRatio,
          stage: stage.stage,
          rationale,
          constraints: {
            sameCurrency,
            sameManager,
            sameTaxWrapper,
            crossManager,
            crossCurrency,
          },
        });

        sourceRemaining.set(source.instrumentId, Math.max(0, currentSourceRemaining - moveWeight));
        destinationCapacity.set(destination.instrumentId, Math.max(0, capacity - moveWeight));
        remainingDelta = Math.max(0, remainingDelta - (moveWeight * rvLiftPerWeight));

        const destinationDiagnostic = destinationDiagnosticsMap.get(destination.instrumentId);
        if (destinationDiagnostic) {
          destinationDiagnostic.used = true;
          destinationDiagnostic.reason = stage.stage === 'clean'
            ? 'Usado en tramo limpio.'
            : stage.stage === 'cross_manager'
              ? 'Usado en tramo cross-manager.'
              : 'Usado en tramo cross-currency.';
        }
      }
    }

    const reachedRvAfterStage = movingToHigherRv ? targetRv - remainingDelta : targetRv + remainingDelta;
    const stageMovedClp = transfers.reduce((sum, item) => sum + item.amountClpMoved, 0) - stageClpStart;
    const remainingGapRvPp = remainingDelta * 100;
    stageSummaries.push({
      stage: stage.stage,
      used: transfers.length > stageTransferStart,
      statusReason: stageStatusReasonForGap(
        stage.stage,
        transfers.length > stageTransferStart,
        remainingGapRvPp,
        hasAllowedCandidates,
      ),
      operationCount: transfers.length - stageTransferStart,
      movedClp: Math.max(0, stageMovedClp),
      reachedMix: { rv: reachedRvAfterStage, rf: 1 - reachedRvAfterStage },
      remainingGapRvPp,
    });
  }

  const reachableRv = movingToHigherRv ? targetRv - remainingDelta : targetRv + remainingDelta;
  const reachableRf = 1 - reachableRv;
  const gapVsIdealRvPp = (targetRv - reachableRv) * 100;
  const equivalentToIdeal = Math.abs(gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9;
  const reachableWeights = buildTargetFromRiskMix(reachableRv, currentGlobalShare);

  if (Math.abs(gapVsIdealRvPp) > 3 + 1e-9) {
    const crossManagerSummary = stageSummaries.find((summary) => summary.stage === 'cross_manager');
    if (crossManagerSummary && !crossManagerSummary.used && crossManagerSummary.statusReason === 'not_required') {
      crossManagerSummary.statusReason = 'agotado';
    }
  }

  const warnings: string[] = [];
  if (!transfers.length) warnings.push('No se encontraron traspasos ejecutables con las restricciones actuales.');
  if (!equivalentToIdeal) warnings.push(`Gap material vs objetivo ideal: ${gapVsIdealRvPp >= 0 ? '' : '+'}${gapVsIdealRvPp.toFixed(2)} pp RV.`);
  if (remainingDelta > 1e-6) warnings.push('No totalmente implementable bajo restricciones actuales.');
  if (stageSummaries.some((summary) => summary.stage === 'cross_manager' && summary.used)) {
    warnings.push('Se requiere mover entre administradoras para acercarse al RV/RF objetivo.');
  }
  if (stageSummaries.some((summary) => summary.stage === 'cross_currency' && summary.used)) {
    warnings.push('Se requiere cambio de moneda para acercarse al RV/RF objetivo. Validar costos, spread, impuestos y timing antes de ejecutar.');
  }
  if (remainingDelta * 100 > 3 + 1e-9) {
    const missingClpEstimate = portfolioTotalClp > 0 ? (remainingDelta * portfolioTotalClp) : 0;
    warnings.push(`Implementación parcial: falta aproximarse en +${(remainingDelta * 100).toFixed(1)} pp RV (~${Math.round(missingClpEstimate).toLocaleString('es-CL')} CLP hacia destinos de alta RV).`);
  }

  const destinationDiagnostics = Array.from(destinationDiagnosticsMap.values())
    .map((row) => {
      if (row.used) return row;
      if (!row.eligible) return row;
      const isHighRv = row.rv >= targetRv - 1e-6;
      if (isHighRv) {
        return {
          ...row,
          reason: row.reason === 'Elegible como destino operativo.' || row.reason.includes('voluntario')
            ? 'Elegible, pero no priorizado por fricción/capacidad frente a otros destinos.'
            : row.reason,
        };
      }
      return {
        ...row,
        reason: 'No mejora RV/RF objetivo respecto a destinos priorizados.',
      };
    })
    .sort((a, b) => (Number(b.used) - Number(a.used)) || (b.rv - a.rv) || a.name.localeCompare(b.name));

  return {
    targetMixIdeal: { rv: targetRv, rf: targetRf },
    currentMix: { rv: currentRv, rf: currentRf },
    reachableMix: { rv: reachableRv, rf: reachableRf },
    gapVsIdealRvPp,
    equivalentToIdeal,
    structuralChangeRequired: !equivalentToIdeal,
    transfers,
    stageSummaries,
    destinationDiagnostics,
    restrictionsApplied,
    warnings,
    baseTargetWeights: normalizeWeights(input.targetWeights),
    reachableWeights,
  };
}
