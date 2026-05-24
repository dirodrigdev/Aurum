import type { PortfolioWeights } from './model/types';
import type {
  InstrumentImplementationAlternativePlanSummary,
  InstrumentImplementationDestinationDiagnostic,
  InstrumentImplementationPlan,
  InstrumentImplementationResidualCategory,
  InstrumentImplementationResidualRow,
  InstrumentImplementationStage,
  InstrumentImplementationStageSummary,
  InstrumentImplementationTransfer,
  InstrumentImplementationUniverse,
  InstrumentImplementationUniverseAuditRow,
} from './instrumentImplementationTypes';
import { REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP } from './optimizerPolicyConfig';

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const MIN_MOVE_CLP = 10_000_000;
const RV_DIRECTION_EPS = 1e-6;
const MATERIAL_GAP_EPS_PP = 0.1;

type ImplementationInstrument = InstrumentImplementationUniverse['instruments'][number];
type RawUniverseRow = {
  instrumentId: string;
  manager: string | null;
  bucketEligible: boolean;
};

type WeightedInstrument = ImplementationInstrument & {
  effectiveWeight: number;
  effectiveAmountClp: number;
};

type PlanLevel = InstrumentImplementationStage;

type WorkingPlan = {
  planLevel: PlanLevel;
  transfers: InstrumentImplementationTransfer[];
  reachableMix: { rv: number; rf: number };
  gapVsIdealRvPp: number;
  reachableWeights: PortfolioWeights;
  restrictionsApplied: {
    sameCurrency: boolean;
    sameManager: boolean;
    sameTaxWrapper: boolean;
    crossManager: boolean;
    crossCurrency: boolean;
  };
  stageSummaries: InstrumentImplementationStageSummary[];
  warnings: string[];
  destinationDiagnostics: InstrumentImplementationDestinationDiagnostic[];
  residualRows: InstrumentImplementationResidualRow[];
  universeAudit: InstrumentImplementationUniverseAuditRow[];
  movedClp: number;
  directionalImprovementPp: number;
  operationCount: number;
  maxFrictionUsed: InstrumentImplementationStage;
  complexityScore: number;
  postAmountsById: Map<string, number>;
};

const stageRank: Record<InstrumentImplementationStage, number> = {
  clean: 0,
  cross_manager: 1,
  cross_currency: 2,
};

const normalizeText = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

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

function buildTargetFromRiskMix(rvTarget: number, globalShare: number): PortfolioWeights {
  const rv = clamp01(rvTarget);
  const rf = 1 - rv;
  const normalizedGlobal = clamp01(globalShare);
  const localShare = 1 - normalizedGlobal;
  return normalizeWeights({
    rvGlobal: rv * normalizedGlobal,
    rvChile: rv * localShare,
    rfGlobal: rf * normalizedGlobal,
    rfChile: rf * localShare,
  });
}

function deriveRvOfInstrument(item: ImplementationInstrument): number {
  return clamp01(item.currentMixUsed?.rv ?? 0);
}

function deriveRfOfInstrument(item: ImplementationInstrument): number {
  return clamp01(item.currentMixUsed?.rf ?? (1 - deriveRvOfInstrument(item)));
}

function deriveGlobalOfInstrument(item: ImplementationInstrument): number {
  return clamp01(item.exposureUsed?.global ?? 0.5);
}

function deriveManager(item: ImplementationInstrument, rawRows: Map<string, RawUniverseRow>): string | null {
  const raw = rawRows.get(item.instrumentId);
  if (raw?.manager) return raw.manager;
  const token = (item.name ?? '').trim().split(/\s+/)[0];
  return token ? token.toUpperCase() : null;
}

function canSellInstrument(item: ImplementationInstrument): boolean {
  return item.usable && (item.amountClp ?? 0) > 0 && item.isSellable !== false;
}

function canUseAsDestination(item: ImplementationInstrument): boolean {
  return Boolean(item.instrumentId && item.currentMixUsed && item.currency && item.decisionEligible !== false);
}

function inferOperationalCandidateClass(item: ImplementationInstrument): { eligible: boolean; reason: string } {
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
  if (item.decisionEligible === false) {
    return { eligible: false, reason: 'Marcado como no elegible para decisión.' };
  }
  if (item.isSellable === false) {
    if (voluntaryLike) {
      return { eligible: true, reason: 'Elegible como destino voluntario (aporte/traspaso), aunque no sea origen vendible.' };
    }
    return { eligible: false, reason: 'Marcado como no operable para traspaso.' };
  }
  return { eligible: true, reason: 'Elegible como destino operativo.' };
}

function isVoluntaryDestination(item: ImplementationInstrument): boolean {
  const text = `${item.name ?? ''} ${item.vehicleType ?? ''} ${item.taxWrapper ?? ''} ${item.role ?? ''}`.toLowerCase();
  return text.includes('cuenta 2') || text.includes('cuenta2') || text.includes('apv') || text.includes('voluntar');
}

function pairStage(
  source: ImplementationInstrument,
  destination: ImplementationInstrument,
  rawRows: Map<string, RawUniverseRow>,
): InstrumentImplementationStage {
  const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
  const sameManager = deriveManager(source, rawRows) && deriveManager(source, rawRows) === deriveManager(destination, rawRows);
  if (!sameCurrency) return 'cross_currency';
  if (!sameManager) return 'cross_manager';
  return 'clean';
}

function pairAllowed(
  source: ImplementationInstrument,
  destination: ImplementationInstrument,
  planLevel: PlanLevel,
  rawRows: Map<string, RawUniverseRow>,
): boolean {
  if (source.instrumentId === destination.instrumentId) return false;
  const stage = pairStage(source, destination, rawRows);
  if (planLevel === 'clean') return stage === 'clean';
  if (planLevel === 'cross_manager') return stage === 'clean' || stage === 'cross_manager';
  return true;
}

function pairFrictionScore(
  source: ImplementationInstrument,
  destination: ImplementationInstrument,
  rawRows: Map<string, RawUniverseRow>,
): number {
  const stage = pairStage(source, destination, rawRows);
  let score = stageRank[stage] * 100;
  if (source.taxWrapper && destination.taxWrapper && source.taxWrapper !== destination.taxWrapper && !isVoluntaryDestination(destination)) {
    score += 10;
  }
  if (isVoluntaryDestination(destination)) score += 5;
  if ((destination.replacementConstraint ?? '') !== 'none' && destination.replacementConstraint) score += 3;
  return score;
}

function parseRawUniverseRows(universe: InstrumentImplementationUniverse): Map<string, RawUniverseRow> {
  try {
    const raw = JSON.parse(universe.snapshot.rawJson ?? '{}') as Record<string, unknown>;
    const rows = Array.isArray(raw.instruments) ? raw.instruments : [];
    return new Map(
      rows.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const record = row as Record<string, unknown>;
        const master = (record.instrument_master && typeof record.instrument_master === 'object')
          ? record.instrument_master as Record<string, unknown>
          : record;
        const position = (record.portfolio_position && typeof record.portfolio_position === 'object')
          ? record.portfolio_position as Record<string, unknown>
          : {};
        const instrumentId = String(master.instrument_id ?? master.instrumentId ?? record.instrument_id ?? record.instrumentId ?? '').trim();
        if (!instrumentId) return [];
        return [[instrumentId, {
          instrumentId,
          manager: master.manager ? String(master.manager) : null,
          bucketEligible: Boolean(position.bucket_eligible),
        } satisfies RawUniverseRow]];
      }),
    );
  } catch {
    return new Map();
  }
}

function buildWeightedInstruments(instruments: ImplementationInstrument[]): WeightedInstrument[] {
  const totalAmount = instruments.reduce((sum, item) => sum + Math.max(0, item.amountClp ?? 0), 0);
  const totalWeight = instruments.reduce((sum, item) => sum + Math.max(0, item.weightPortfolio ?? 0), 0);
  return instruments.map((item) => {
    const amount = Math.max(0, item.amountClp ?? 0);
    const fallbackWeight = totalWeight > 0 ? Math.max(0, item.weightPortfolio ?? 0) / totalWeight : 0;
    const effectiveWeight = totalAmount > 0 ? amount / totalAmount : fallbackWeight;
    return {
      ...item,
      effectiveWeight,
      effectiveAmountClp: amount,
    };
  });
}

function computeMixFromAmounts(
  instruments: WeightedInstrument[],
  postAmountsById: Map<string, number>,
): { rv: number; rf: number; globalShare: number } {
  const total = Math.max(
    0,
    instruments.reduce((sum, item) => sum + Math.max(0, postAmountsById.get(item.instrumentId) ?? item.effectiveAmountClp), 0),
  );
  if (total <= 0) return { rv: 0, rf: 1, globalShare: 0.5 };

  let rv = 0;
  let rf = 0;
  let globalShare = 0;
  for (const item of instruments) {
    const amount = Math.max(0, postAmountsById.get(item.instrumentId) ?? item.effectiveAmountClp);
    const weight = amount / total;
    rv += weight * deriveRvOfInstrument(item);
    rf += weight * deriveRfOfInstrument(item);
    globalShare += weight * deriveGlobalOfInstrument(item);
  }
  return {
    rv: clamp01(rv),
    rf: clamp01(rf),
    globalShare: clamp01(globalShare),
  };
}

function computeCurrentMix(instruments: WeightedInstrument[]): { rv: number; rf: number; globalShare: number } {
  const postAmounts = new Map(instruments.map((item) => [item.instrumentId, item.effectiveAmountClp]));
  return computeMixFromAmounts(instruments, postAmounts);
}

function buildSourceOrder(instruments: WeightedInstrument[], movingToHigherRv: boolean): WeightedInstrument[] {
  return [...instruments]
    .filter(canSellInstrument)
    .sort((a, b) => {
      const rvA = deriveRvOfInstrument(a);
      const rvB = deriveRvOfInstrument(b);
      const amountDiff = (b.effectiveAmountClp - a.effectiveAmountClp);
      if (movingToHigherRv) {
        if (Math.abs(rvA - rvB) > 1e-9) return rvA - rvB;
      } else if (Math.abs(rvA - rvB) > 1e-9) {
        return rvB - rvA;
      }
      return amountDiff;
    });
}

function buildDestinationOrder(
  source: WeightedInstrument,
  destinations: WeightedInstrument[],
  movingToHigherRv: boolean,
  rawRows: Map<string, RawUniverseRow>,
): WeightedInstrument[] {
  return [...destinations].sort((a, b) => {
    const rvA = deriveRvOfInstrument(a);
    const rvB = deriveRvOfInstrument(b);
    if (movingToHigherRv && Math.abs(rvB - rvA) > 1e-9) return rvB - rvA;
    if (!movingToHigherRv && Math.abs(rvA - rvB) > 1e-9) return rvA - rvB;
    const friction = pairFrictionScore(source, a, rawRows) - pairFrictionScore(source, b, rawRows);
    if (Math.abs(friction) > 1e-9) return friction;
    const impact = (b.estimatedMixImpactPoints ?? 0) - (a.estimatedMixImpactPoints ?? 0);
    if (Math.abs(impact) > 1e-9) return impact;
    return (b.replaceabilityScore ?? 0) - (a.replaceabilityScore ?? 0);
  });
}

function computeMaxUsefulMoveClp(
  source: WeightedInstrument,
  destination: WeightedInstrument,
  gapRvAbs: number,
  totalPortfolioClp: number,
): number {
  const sourceRv = deriveRvOfInstrument(source);
  const destinationRv = deriveRvOfInstrument(destination);
  const rvLiftPerClp = Math.abs(destinationRv - sourceRv) / Math.max(1, totalPortfolioClp);
  if (rvLiftPerClp <= 1e-12) return 0;
  const needClp = gapRvAbs / rvLiftPerClp;
  return Math.max(0, needClp);
}

function movementReason(stage: InstrumentImplementationStage, movingToHigherRv: boolean): string {
  if (movingToHigherRv) {
    if (stage === 'clean') return 'Subir RV con menor fricción operativa.';
    if (stage === 'cross_manager') return 'Subir RV usando mejor destino en misma moneda entre administradoras.';
    return 'Subir RV usando mejor destino con cambio de moneda.';
  }
  if (stage === 'clean') return 'Bajar RV con menor fricción operativa.';
  if (stage === 'cross_manager') return 'Bajar RV usando mejor destino defensivo en misma moneda entre administradoras.';
  return 'Bajar RV usando destino defensivo con cambio de moneda.';
}

function buildUniverseAudit(
  instruments: WeightedInstrument[],
  rawRows: Map<string, RawUniverseRow>,
  destinationDiagnostics: Map<string, InstrumentImplementationDestinationDiagnostic>,
): InstrumentImplementationUniverseAuditRow[] {
  const rows = instruments.map((item) => {
    const destinationDiagnostic = destinationDiagnostics.get(item.instrumentId);
    const movable = canSellInstrument(item);
    const raw = rawRows.get(item.instrumentId);
    const normalizedName = normalizeText(item.name);
    const blockLabel =
      normalizedName.includes('global66') ? 'Global66'
        : normalizedName.includes('wise') ? 'Wise'
          : normalizedName.includes('cuenta') || normalizedName.includes('cash') || normalizedName.includes('money market')
            ? 'Caja / Liquidez'
            : 'Instrumento';
    return {
      instrumentId: item.instrumentId,
      name: item.name ?? item.instrumentId,
      blockLabel,
      amountClp: item.effectiveAmountClp,
      currency: item.currency ?? null,
      rv: deriveRvOfInstrument(item),
      rf: deriveRfOfInstrument(item),
      movable,
      protected: false,
      includedAsSource: movable,
      includedAsDestination: destinationDiagnostic?.eligible ?? false,
      reason: raw?.bucketEligible
        ? 'Figura como bucket_eligible en snapshot, pero no existe flag separado de bucket protegido; no se excluye automáticamente.'
        : destinationDiagnostic?.reason ?? (movable ? 'Disponible como fuente.' : 'No disponible como fuente.'),
      fileFilter: 'instrumentImplementationPlanner.ts · canSellInstrument / inferOperationalCandidateClass',
    } satisfies InstrumentImplementationUniverseAuditRow;
  });

  const addMissingPlaceholder = (instrumentId: string, name: string, reason: string) => {
    if (rows.some((row) => row.instrumentId === instrumentId || normalizeText(row.name).includes(normalizeText(name)))) return;
    rows.push({
      instrumentId,
      name,
      blockLabel: name,
      amountClp: 0,
      currency: null,
      rv: 0,
      rf: 0,
      movable: false,
      protected: false,
      includedAsSource: false,
      includedAsDestination: false,
      reason,
      fileFilter: 'instrumentImplementationPlanner.ts · audit snapshot',
    });
  };

  addMissingPlaceholder('audit_global66_absent', 'Global66', 'No aparece en el instrument_universe cargado; no entra al planner.');
  addMissingPlaceholder('audit_wise_absent', 'Wise', 'No aparece en el instrument_universe cargado; no entra al planner.');
  addMissingPlaceholder('audit_clp_cash_absent', 'Cuentas corrientes CLP / caja CLP', 'No aparece bloque CLP líquido explícito en el instrument_universe cargado.');

  return rows.sort((a, b) => b.amountClp - a.amountClp || a.name.localeCompare(b.name));
}

function buildResidualRows(input: {
  instruments: WeightedInstrument[];
  postAmountsById: Map<string, number>;
  chosenPlanLevel: PlanLevel;
  targetRv: number;
  movingToHigherRv: boolean;
  rawRows: Map<string, RawUniverseRow>;
  transfers: InstrumentImplementationTransfer[];
}): InstrumentImplementationResidualRow[] {
  const usedDestinationIds = new Set(input.transfers.map((row) => row.toInstrumentId));
  const usedSourceIds = new Set(input.transfers.map((row) => row.fromInstrumentId));

  return input.instruments
    .map((item) => {
      const postAmountClp = Math.max(0, input.postAmountsById.get(item.instrumentId) ?? item.effectiveAmountClp);
      const rvPost = deriveRvOfInstrument(item);
      const rfPost = deriveRfOfInstrument(item);
      const rfClpEquivalent = postAmountClp * rfPost;
      const movable = canSellInstrument(item);
      const raw = input.rawRows.get(item.instrumentId);
      let category: InstrumentImplementationResidualCategory = 'no_residual';
      let reason = 'Sin RF residual material.';

      if (rfClpEquivalent > 1) {
        if (usedDestinationIds.has(item.instrumentId) && rfPost > 0) {
          category = 'embedded_rf';
          reason = 'RF residual embebida en el fondo destino final.';
        } else if (!movable && item.isCaptive) {
          category = 'captive';
          reason = 'Activo cautivo/no operable.';
        } else if (raw?.bucketEligible) {
          category = 'bucket_protected';
          reason = 'El snapshot marca bucket_eligible; revisar si debe protegerse fuera del planner.';
        } else if ((normalizeText(item.name).includes('usd') || normalizeText(item.vehicleType).includes('cash'))) {
          category = 'cash';
          reason = 'Caja / liquidez residual.';
        } else if (!movable) {
          category = 'outside_universe';
          reason = 'No entra como fuente movible en la implementación.';
        } else if (input.movingToHigherRv && rvPost >= input.targetRv - RV_DIRECTION_EPS) {
          category = 'embedded_rf';
          reason = 'El instrumento ya está en el techo RV alcanzable disponible.';
        } else if (input.chosenPlanLevel === 'clean') {
          category = 'manager_restricted';
          reason = 'Queda RF porque el plan ganador limpio no abre cruce entre administradoras.';
        } else if (input.chosenPlanLevel === 'cross_manager' && normalizeText(item.currency) !== 'clp') {
          category = 'currency_restricted';
          reason = 'Queda RF porque el plan ganador no requiere abrir FX.';
        } else if (usedSourceIds.has(item.instrumentId)) {
          category = 'direct_rf';
          reason = 'Queda RF residual por remanente no material o sin mejora adicional bajo restricciones.';
        } else {
          category = 'not_selected';
          reason = 'No seleccionado en el plan ganador frente a destinos/fuentes con mayor impacto.';
        }
      }

      return {
        instrumentId: item.instrumentId,
        name: item.name ?? item.instrumentId,
        postAmountClp,
        rvPost,
        rfPost,
        rfClpEquivalent,
        movable,
        protected: false,
        category,
        reason,
      } satisfies InstrumentImplementationResidualRow;
    })
    .filter((row) => row.postAmountClp > 1 || row.rfClpEquivalent > 1)
    .sort((a, b) => b.rfClpEquivalent - a.rfClpEquivalent || b.postAmountClp - a.postAmountClp);
}

function summarizeStages(
  transfers: InstrumentImplementationTransfer[],
  currentMix: { rv: number; rf: number },
  targetRv: number,
): InstrumentImplementationStageSummary[] {
  let rollingRv = currentMix.rv;
  const byStage = new Map<InstrumentImplementationStage, InstrumentImplementationTransfer[]>();
  for (const stage of ['clean', 'cross_manager', 'cross_currency'] as const) {
    byStage.set(stage, transfers.filter((row) => row.stage === stage));
  }

  return (['clean', 'cross_manager', 'cross_currency'] as const).map((stage) => {
    const rows = byStage.get(stage) ?? [];
    let movedClp = 0;
    for (const row of rows) {
      movedClp += row.amountClpMoved;
      const sourceRv = row.constraints.sameCurrency || row.fromCurrency ? 0 : 0;
      void sourceRv;
    }
    if (rows.length) {
      rollingRv += rows.reduce((sum, row) => {
        const fromRv = Number((row as unknown as { _fromRv?: number })._fromRv ?? 0);
        const toRv = Number((row as unknown as { _toRv?: number })._toRv ?? 0);
        const portfolioTotal = Number((row as unknown as { _portfolioTotal?: number })._portfolioTotal ?? 1);
        return sum + ((row.amountClpMoved / Math.max(1, portfolioTotal)) * (toRv - fromRv));
      }, 0);
    }
    const remainingGapRvPp = (targetRv - rollingRv) * 100;
    return {
      stage,
      used: rows.length > 0,
      statusReason: rows.length > 0 ? 'used' : Math.abs(remainingGapRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP ? 'not_required' : 'agotado',
      operationCount: rows.length,
      movedClp,
      reachedMix: { rv: clamp01(rollingRv), rf: clamp01(1 - rollingRv) },
      remainingGapRvPp,
    };
  });
}

function comparePlans(a: WorkingPlan, b: WorkingPlan): number {
  const gap = Math.abs(a.gapVsIdealRvPp) - Math.abs(b.gapVsIdealRvPp);
  if (Math.abs(gap) > 1e-9) return gap;
  const improvement = b.directionalImprovementPp - a.directionalImprovementPp;
  if (Math.abs(improvement) > 1e-9) return improvement;
  if (a.operationCount !== b.operationCount) return a.operationCount - b.operationCount;
  if (stageRank[a.maxFrictionUsed] !== stageRank[b.maxFrictionUsed]) return stageRank[a.maxFrictionUsed] - stageRank[b.maxFrictionUsed];
  const moved = a.movedClp - b.movedClp;
  if (Math.abs(moved) > 1e-6) return moved;
  if (a.complexityScore !== b.complexityScore) return a.complexityScore - b.complexityScore;
  return stageRank[a.planLevel] - stageRank[b.planLevel];
}

function buildPlanForLevel(input: {
  universe: InstrumentImplementationUniverse;
  weighted: WeightedInstrument[];
  currentMix: { rv: number; rf: number; globalShare: number };
  targetRv: number;
  targetRf: number;
  planLevel: PlanLevel;
  rawRows: Map<string, RawUniverseRow>;
}): WorkingPlan {
  const { weighted, currentMix, targetRv, targetRf, planLevel, rawRows } = input;
  const movingToHigherRv = targetRv > currentMix.rv + RV_DIRECTION_EPS;
  const totalPortfolioClp = Math.max(1, weighted.reduce((sum, item) => sum + item.effectiveAmountClp, 0));
  const postAmountsById = new Map(weighted.map((item) => [item.instrumentId, item.effectiveAmountClp]));
  const transfers: InstrumentImplementationTransfer[] = [];

  const destinationSeeds = weighted.map((item) => ({
    item,
    diagnostic: {
      instrumentId: item.instrumentId,
      name: item.name ?? item.instrumentId,
      rv: deriveRvOfInstrument(item),
      eligible: false,
      used: false,
      reason: 'No evaluado.',
    } as InstrumentImplementationDestinationDiagnostic,
  }));
  const destinationDiagnostics = new Map(destinationSeeds.map((row) => [row.item.instrumentId, row.diagnostic]));
  const destinationUniverse = destinationSeeds
    .map(({ item, diagnostic }) => {
      const eligibility = inferOperationalCandidateClass(item);
      diagnostic.eligible = eligibility.eligible && canUseAsDestination(item);
      diagnostic.reason = diagnostic.eligible ? eligibility.reason : eligibility.reason;
      return item;
    })
    .filter((item) => {
      const eligibility = destinationDiagnostics.get(item.instrumentId);
      return Boolean(eligibility?.eligible);
    });

  const sources = buildSourceOrder(weighted, movingToHigherRv);
  let gapRv = Math.abs(targetRv - currentMix.rv);

  for (const source of sources) {
    if (gapRv * 100 <= MATERIAL_GAP_EPS_PP) break;
    const availableClp = Math.max(0, postAmountsById.get(source.instrumentId) ?? 0);
    if (availableClp < MIN_MOVE_CLP) continue;

    const sourceRv = deriveRvOfInstrument(source);
    const candidates = buildDestinationOrder(source, destinationUniverse, movingToHigherRv, rawRows)
      .filter((destination) => {
        if (!pairAllowed(source, destination, planLevel, rawRows)) return false;
        const destinationRv = deriveRvOfInstrument(destination);
        return movingToHigherRv
          ? destinationRv > sourceRv + RV_DIRECTION_EPS
          : destinationRv < sourceRv - RV_DIRECTION_EPS;
      });

    for (const destination of candidates) {
      if (gapRv * 100 <= MATERIAL_GAP_EPS_PP) break;
      const destinationRv = deriveRvOfInstrument(destination);
      const rvLift = Math.abs(destinationRv - sourceRv);
      if (rvLift <= RV_DIRECTION_EPS) continue;

      const maxUsefulMoveClp = computeMaxUsefulMoveClp(source, destination, gapRv, totalPortfolioClp);
      const moveClpRaw = Math.min(availableClp, maxUsefulMoveClp);
      const closesGapMaterially = gapRv * 100 <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 0.5;
      if (moveClpRaw < MIN_MOVE_CLP - 1 && !closesGapMaterially) continue;
      const moveClp = Math.min(availableClp, moveClpRaw);
      if (moveClp <= 0) continue;

      const stage = pairStage(source, destination, rawRows);
      const nextSourceAmount = Math.max(0, availableClp - moveClp);
      postAmountsById.set(source.instrumentId, nextSourceAmount);
      postAmountsById.set(destination.instrumentId, Math.max(0, postAmountsById.get(destination.instrumentId) ?? 0) + moveClp);

      const nativeRatio = source.effectiveAmountClp > 0 ? moveClp / source.effectiveAmountClp : 0;
      const amountNativeMoved = source.amountNative != null ? source.amountNative * nativeRatio : null;
      const sameCurrency = Boolean(source.currency && destination.currency && source.currency === destination.currency);
      const sameManager = Boolean(deriveManager(source, rawRows) && deriveManager(source, rawRows) === deriveManager(destination, rawRows));
      const sameTaxWrapper = Boolean(source.taxWrapper && destination.taxWrapper && source.taxWrapper === destination.taxWrapper);

      transfers.push({
        fromInstrumentId: source.instrumentId,
        fromName: source.name ?? source.instrumentId,
        fromManager: deriveManager(source, rawRows),
        fromCurrency: source.currency ?? null,
        fromTaxWrapper: source.taxWrapper ?? null,
        toInstrumentId: destination.instrumentId,
        toName: destination.name ?? destination.instrumentId,
        toManager: deriveManager(destination, rawRows),
        toCurrency: destination.currency ?? null,
        toTaxWrapper: destination.taxWrapper ?? null,
        weightMoved: moveClp / totalPortfolioClp,
        amountNativeMoved,
        nativeCurrency: source.amountNativeCurrency ?? source.currency ?? null,
        amountClpMoved: moveClp,
        stage,
        rationale: movementReason(stage, movingToHigherRv),
        constraints: {
          sameCurrency,
          sameManager,
          sameTaxWrapper,
          crossManager: stage === 'cross_manager',
          crossCurrency: stage === 'cross_currency',
        },
      } as InstrumentImplementationTransfer & { _fromRv?: number; _toRv?: number; _portfolioTotal?: number });
      (transfers[transfers.length - 1] as InstrumentImplementationTransfer & { _fromRv: number; _toRv: number; _portfolioTotal: number })._fromRv = sourceRv;
      (transfers[transfers.length - 1] as InstrumentImplementationTransfer & { _fromRv: number; _toRv: number; _portfolioTotal: number })._toRv = destinationRv;
      (transfers[transfers.length - 1] as InstrumentImplementationTransfer & { _fromRv: number; _toRv: number; _portfolioTotal: number })._portfolioTotal = totalPortfolioClp;

      destinationDiagnostics.get(destination.instrumentId)!.used = true;
      destinationDiagnostics.get(destination.instrumentId)!.reason = `Usado en plan ${planLevel}.`;
      gapRv = Math.abs(targetRv - computeMixFromAmounts(weighted, postAmountsById).rv);
      break;
    }
  }

  const mix = computeMixFromAmounts(weighted, postAmountsById);
  const reachableMix = { rv: mix.rv, rf: mix.rf };
  const gapVsIdealRvPp = (targetRv - reachableMix.rv) * 100;
  const reachableWeights = buildTargetFromRiskMix(reachableMix.rv, mix.globalShare);
  const operationCount = transfers.length;
  const movedClp = transfers.reduce((sum, row) => sum + row.amountClpMoved, 0);
  const maxFrictionUsed = transfers.reduce<InstrumentImplementationStage>((maxStage, row) => (
    stageRank[row.stage] > stageRank[maxStage] ? row.stage : maxStage
  ), 'clean');
  const restrictionsApplied = {
    sameCurrency: !transfers.some((row) => row.constraints.crossCurrency),
    sameManager: !transfers.some((row) => row.constraints.crossManager),
    sameTaxWrapper: !transfers.some((row) => !row.constraints.sameTaxWrapper),
    crossManager: transfers.some((row) => row.constraints.crossManager),
    crossCurrency: transfers.some((row) => row.constraints.crossCurrency),
  };

  const topDestination = [...destinationUniverse]
    .sort((a, b) => movingToHigherRv ? deriveRvOfInstrument(b) - deriveRvOfInstrument(a) : deriveRvOfInstrument(a) - deriveRvOfInstrument(b))[0] ?? null;

  const warnings: string[] = [];
  if (!operationCount) warnings.push('No se encontraron traspasos ejecutables con las restricciones actuales.');
  if (Math.abs(gapVsIdealRvPp) > REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP) {
    warnings.push(`Gap material vs objetivo ideal: ${gapVsIdealRvPp.toFixed(2)} pp RV.`);
  }
  if (Math.abs(gapVsIdealRvPp) > 3) {
    warnings.push(`Implementación parcial: falta ${gapVsIdealRvPp > 0 ? '+' : ''}${gapVsIdealRvPp.toFixed(1)} pp RV para llegar al objetivo.`);
  }
  if (planLevel === 'cross_manager' && restrictionsApplied.crossManager) {
    warnings.push('Se requiere mover entre administradoras para acercarse al RV/RF objetivo.');
  }
  if (planLevel === 'cross_currency' && restrictionsApplied.crossCurrency) {
    warnings.push('Se requiere cambio de moneda para acercarse al RV/RF objetivo. Validar costos, spread, impuestos y timing antes de ejecutar.');
  }

  for (const diagnostic of destinationDiagnostics.values()) {
    if (diagnostic.used || !diagnostic.eligible) continue;
    if (topDestination) {
      const topRv = deriveRvOfInstrument(topDestination);
      if (movingToHigherRv && topRv > diagnostic.rv + RV_DIRECTION_EPS) {
        diagnostic.reason = `No se usa porque ${topDestination.name ?? topDestination.instrumentId} tiene mayor RV efectivo (${(topRv * 100).toFixed(2)}%) que ${(diagnostic.rv * 100).toFixed(2)}%.`;
      } else if (!movingToHigherRv && topRv < diagnostic.rv - RV_DIRECTION_EPS) {
        diagnostic.reason = `No se usa porque ${topDestination.name ?? topDestination.instrumentId} reduce más RV efectivo que ${diagnostic.name}.`;
      } else {
        diagnostic.reason = `Elegible, pero no mejora el plan ${planLevel} frente al destino principal elegido.`;
      }
    }
  }

  const stageSummaries = summarizeStages(transfers, { rv: currentMix.rv, rf: currentMix.rf }, targetRv);
  const residualRows = buildResidualRows({
    instruments: weighted,
    postAmountsById,
    chosenPlanLevel: planLevel,
    targetRv,
    movingToHigherRv,
    rawRows,
    transfers,
  });
  const universeAudit = buildUniverseAudit(weighted, rawRows, destinationDiagnostics);
  const directionalImprovementPp = Math.abs(reachableMix.rv - currentMix.rv) * 100;
  const complexityScore = new Set(transfers.map((row) => `${row.fromInstrumentId}->${row.toInstrumentId}`)).size;

  return {
    planLevel,
    transfers,
    reachableMix,
    gapVsIdealRvPp,
    reachableWeights,
    restrictionsApplied,
    stageSummaries,
    warnings,
    destinationDiagnostics: Array.from(destinationDiagnostics.values()).sort((a, b) => Number(b.used) - Number(a.used) || b.rv - a.rv),
    residualRows,
    universeAudit,
    movedClp,
    directionalImprovementPp,
    operationCount,
    maxFrictionUsed,
    complexityScore,
    postAmountsById,
  };
}

export function buildInstrumentImplementationPlan(input: {
  universe: InstrumentImplementationUniverse;
  targetWeights: PortfolioWeights;
}): InstrumentImplementationPlan | null {
  const weighted = buildWeightedInstruments(input.universe.instruments);
  const currentMix = computeCurrentMix(weighted);
  const targetRv = clamp01(input.targetWeights.rvGlobal + input.targetWeights.rvChile);
  const targetRf = 1 - targetRv;
  const rawRows = parseRawUniverseRows(input.universe);
  if (!weighted.length) return null;

  if (Math.abs(targetRv - currentMix.rv) <= RV_DIRECTION_EPS) {
    const currentWeights = buildTargetFromRiskMix(currentMix.rv, currentMix.globalShare);
    const destinationDiagnosticsMap = new Map<string, InstrumentImplementationDestinationDiagnostic>();
    for (const item of weighted) {
      const eligibility = inferOperationalCandidateClass(item);
      destinationDiagnosticsMap.set(item.instrumentId, {
        instrumentId: item.instrumentId,
        name: item.name ?? item.instrumentId,
        rv: deriveRvOfInstrument(item),
        eligible: eligibility.eligible && canUseAsDestination(item),
        used: false,
        reason: eligibility.reason,
      });
    }
    return {
      planLevel: 'clean',
      alternativePlans: [],
      targetMixIdeal: { rv: targetRv, rf: targetRf },
      currentMix: { rv: currentMix.rv, rf: currentMix.rf },
      reachableMix: { rv: currentMix.rv, rf: currentMix.rf },
      gapVsIdealRvPp: 0,
      equivalentToIdeal: true,
      structuralChangeRequired: false,
      transfers: [],
      stageSummaries: summarizeStages([], { rv: currentMix.rv, rf: currentMix.rf }, targetRv),
      destinationDiagnostics: Array.from(destinationDiagnosticsMap.values()),
      restrictionsApplied: {
        sameCurrency: true,
        sameManager: true,
        sameTaxWrapper: true,
        crossManager: false,
        crossCurrency: false,
      },
      warnings: [],
      baseTargetWeights: normalizeWeights(input.targetWeights),
      reachableWeights: currentWeights,
      residualRows: buildResidualRows({
        instruments: weighted,
        postAmountsById: new Map(weighted.map((item) => [item.instrumentId, item.effectiveAmountClp])),
        chosenPlanLevel: 'clean',
        targetRv,
        movingToHigherRv: false,
        rawRows,
        transfers: [],
      }),
      universeAudit: buildUniverseAudit(weighted, rawRows, destinationDiagnosticsMap),
    };
  }

  const alternatives = (['clean', 'cross_manager', 'cross_currency'] as const)
    .map((planLevel) => buildPlanForLevel({
      universe: input.universe,
      weighted,
      currentMix,
      targetRv,
      targetRf,
      planLevel,
      rawRows,
    }))
    .sort(comparePlans);

  const winner = alternatives[0];

  return {
    planLevel: winner.planLevel,
    alternativePlans: alternatives.map((plan) => ({
      planLevel: plan.planLevel,
      reachableMix: plan.reachableMix,
      gapVsIdealRvPp: plan.gapVsIdealRvPp,
      operationCount: plan.operationCount,
      movedClp: plan.movedClp,
      maxFrictionUsed: plan.maxFrictionUsed,
      warnings: plan.warnings,
    }) satisfies InstrumentImplementationAlternativePlanSummary),
    targetMixIdeal: { rv: targetRv, rf: targetRf },
    currentMix: { rv: currentMix.rv, rf: currentMix.rf },
    reachableMix: winner.reachableMix,
    gapVsIdealRvPp: winner.gapVsIdealRvPp,
    equivalentToIdeal: Math.abs(winner.gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9,
    structuralChangeRequired: Math.abs(winner.gapVsIdealRvPp) > REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9,
    transfers: winner.transfers,
    stageSummaries: winner.stageSummaries,
    destinationDiagnostics: winner.destinationDiagnostics,
    restrictionsApplied: winner.restrictionsApplied,
    warnings: winner.warnings,
    baseTargetWeights: normalizeWeights(input.targetWeights),
    reachableWeights: winner.reachableWeights,
    residualRows: winner.residualRows,
    universeAudit: winner.universeAudit,
  };
}
