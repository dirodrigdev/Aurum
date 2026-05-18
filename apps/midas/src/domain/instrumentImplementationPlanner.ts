import type { PortfolioWeights } from './model/types';
import type {
  InstrumentImplementationPlan,
  InstrumentImplementationTransfer,
  InstrumentImplementationUniverse,
} from './instrumentImplementationTypes';
import { REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP } from './optimizerPolicyConfig';

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const MATERIAL_CROSS_MANAGER_MIN_WEIGHT = 0.03;

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

type ImplementationInstrument = InstrumentImplementationUniverse['instruments'][number];

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
  return Boolean(item.instrumentId && item.currentMixUsed && item.currency && item.decisionEligible !== false && item.isCaptive !== true);
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

function scorePair(
  source: ImplementationInstrument,
  destination: ImplementationInstrument,
): number {
  let score = 0;
  const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
  const sameManager = hasSameManager(source, destination);
  const sameWrapper = hasSameTaxWrapper(source, destination);

  if (sameCurrency) score += 6;
  if (sameManager) score += 4;
  if (sameWrapper) score += 2;
  if (source.sameCurrencyCandidates.includes(destination.instrumentId)) score += 2;
  if (source.decisionEligible !== false && destination.decisionEligible !== false) score += 1;

  score += (destination.replaceabilityScore ?? 0) * 2;
  score += (destination.estimatedMixImpactPoints ?? 0) / 100;
  if (destination.replacementConstraint && destination.replacementConstraint !== 'none') score -= 1;
  return score;
}

function inferManagerName(item: ImplementationInstrument): string | null {
  if (!item.name) return null;
  const token = item.name.trim().split(/\s+/)[0];
  return token ? token.toUpperCase() : null;
}

export function buildInstrumentImplementationPlan(input: {
  universe: InstrumentImplementationUniverse;
  targetWeights: PortfolioWeights;
}): InstrumentImplementationPlan | null {
  const instruments = input.universe.instruments.filter(canSellInstrument);
  const destinationUniverse = input.universe.instruments.filter(canUseAsDestination);
  if (!instruments.length) return null;

  const currentRv = instruments.reduce((sum, item) => sum + (item.weightPortfolio ?? 0) * deriveRvOfInstrument(item), 0);
  const currentRf = 1 - currentRv;
  const targetRv = clamp01(input.targetWeights.rvGlobal + input.targetWeights.rvChile);
  const targetRf = 1 - targetRv;
  const deltaRv = targetRv - currentRv;
  const currentGlobalShare = instruments.reduce(
    (sum, item) => sum + (item.weightPortfolio ?? 0) * deriveGlobalOfInstrument(item),
    0,
  );

  const restrictionsApplied = {
    sameCurrency: true,
    sameManager: true,
    sameTaxWrapper: true,
    crossManager: false,
    crossCurrency: false,
  };

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
      restrictionsApplied,
      warnings: [],
      baseTargetWeights: normalizeWeights(input.targetWeights),
      reachableWeights,
    };
  }

  const movingToHigherRv = deltaRv > 0;
  const sources = [...instruments]
    .filter((item) => movingToHigherRv ? deriveRvOfInstrument(item) < targetRv : deriveRvOfInstrument(item) > targetRv)
    .sort((a, b) => (
      movingToHigherRv
        ? deriveRvOfInstrument(a) - deriveRvOfInstrument(b)
        : deriveRvOfInstrument(b) - deriveRvOfInstrument(a)
    ));
  const destinations = [...destinationUniverse]
    .filter((item) => movingToHigherRv ? deriveRvOfInstrument(item) > currentRv + 1e-6 : deriveRvOfInstrument(item) < currentRv - 1e-6)
    .sort((a, b) => (
      movingToHigherRv
        ? deriveRvOfInstrument(b) - deriveRvOfInstrument(a)
        : deriveRvOfInstrument(a) - deriveRvOfInstrument(b)
    ));

  const sourceRemaining = new Map(sources.map((item) => [item.instrumentId, clamp01(item.weightPortfolio ?? 0)]));
  const destinationCapacity = new Map(destinations.map((item) => [item.instrumentId, Math.max(0, 1 - clamp01(item.weightPortfolio ?? 0))]));
  const transfers: InstrumentImplementationTransfer[] = [];
  let remainingDelta = Math.abs(deltaRv);

  for (const source of sources) {
    const sourceWeight = sourceRemaining.get(source.instrumentId) ?? 0;
    if (sourceWeight <= 1e-6 || remainingDelta <= 1e-6) continue;

    const orderedDestinations = [...destinations]
      .filter((destination) => source.currency && destination.currency && source.currency === destination.currency)
      .sort((a, b) => scorePair(source, b) - scorePair(source, a));
    for (const destination of orderedDestinations) {
      if (remainingDelta <= 1e-6) break;
      if (source.instrumentId === destination.instrumentId) continue;

      const capacity = destinationCapacity.get(destination.instrumentId) ?? 0;
      if (capacity <= 1e-6) continue;

      const sourceRv = deriveRvOfInstrument(source);
      const destinationRv = deriveRvOfInstrument(destination);
      const rvLiftPerWeight = Math.abs(destinationRv - sourceRv);
      if (rvLiftPerWeight <= 1e-6) continue;

      const maxByNeed = remainingDelta / rvLiftPerWeight;
      const currentSourceRemaining = sourceRemaining.get(source.instrumentId) ?? 0;
      const moveWeight = Math.min(currentSourceRemaining, capacity, maxByNeed);
      if (moveWeight <= 1e-6) continue;

      const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
      const sameManager = hasSameManager(source, destination);
      const sameTaxWrapper = hasSameTaxWrapper(source, destination);
      if (!sameManager && moveWeight < MATERIAL_CROSS_MANAGER_MIN_WEIGHT - 1e-9) {
        continue;
      }
      const crossManager = !sameManager;
      const crossCurrency = !sameCurrency;
      if (crossManager) restrictionsApplied.crossManager = true;
      if (crossCurrency) restrictionsApplied.crossCurrency = true;
      if (!sameManager) restrictionsApplied.sameManager = false;
      if (!sameTaxWrapper) restrictionsApplied.sameTaxWrapper = false;
      if (!sameCurrency) restrictionsApplied.sameCurrency = false;

      const rationale = sameManager
        ? 'Prioriza mismo administrador'
        : sameCurrency
          ? 'Cross-manager por mejora material manteniendo moneda'
          : 'Fallback por falta de alternativa limpia';
      const sourceWeight = Math.max(0, source.weightPortfolio ?? 0);
      const nativeRatio = sourceWeight > 0 ? moveWeight / sourceWeight : 0;

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
    }
  }

  const reachableRv = movingToHigherRv ? targetRv - remainingDelta : targetRv + remainingDelta;
  const reachableRf = 1 - reachableRv;
  const gapVsIdealRvPp = (targetRv - reachableRv) * 100;
  const equivalentToIdeal = Math.abs(gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9;
  const reachableWeights = buildTargetFromRiskMix(reachableRv, currentGlobalShare);

  const warnings: string[] = [];
  if (!transfers.length) warnings.push('No se encontraron traspasos ejecutables con las restricciones actuales.');
  if (!equivalentToIdeal) warnings.push(`Gap material vs objetivo ideal: ${gapVsIdealRvPp >= 0 ? '' : '+'}${gapVsIdealRvPp.toFixed(2)} pp RV.`);
  if (remainingDelta > 1e-6) warnings.push('No totalmente implementable bajo restricciones actuales.');

  return {
    targetMixIdeal: { rv: targetRv, rf: targetRf },
    currentMix: { rv: currentRv, rf: currentRf },
    reachableMix: { rv: reachableRv, rf: reachableRf },
    gapVsIdealRvPp,
    equivalentToIdeal,
    structuralChangeRequired: !equivalentToIdeal,
    transfers,
    restrictionsApplied,
    warnings,
    baseTargetWeights: normalizeWeights(input.targetWeights),
    reachableWeights,
  };
}
