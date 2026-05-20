import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelParameters, PortfolioWeights, ScenarioVariantId, SimulationResults } from '../domain/model/types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import { loadInstrumentImplementationUniverse } from '../domain/instrumentImplementationLoader';
import { buildInstrumentImplementationPlan } from '../domain/instrumentImplementationPlanner';
import type { InstrumentImplementationPlan } from '../domain/instrumentImplementationTypes';
import {
  buildOptimizationFrontierDiagnostics,
  type OptimizationDiagnosticRow,
} from '../domain/optimizer/optimizationFrontierDiagnostics';
import { buildRvRfCandidateWeights } from '../domain/optimizer/rvRfCandidateMapping';
import type { QualityOptimizationCandidate } from '../domain/optimizer/qualityRanking';
import { buildQualityOptimizationCandidate, compareQualityOptimizationCandidates } from '../domain/optimizer/qualityRanking';
import {
  RV_RF_PREMIUM_SENSITIVITY_SCENARIOS,
  applyRvRfPremiumSensitivity,
  explainSensitivityShift,
  pickSensitivityWinner,
  type RvRfPremiumSensitivityScenario,
} from '../domain/optimizer/rvRfPremiumSensitivity';
import {
  applyTemporarySpendScale,
  computeMaxSpendScalePassingQoL,
  SPENDING_HEADROOM_SCALES,
  type SpendingHeadroomScale,
} from '../domain/optimizer/spendingHeadroom';
import {
  buildDecisionProfiles,
  buildFineRvRfGrid,
  selectBestAvailableFallbackCandidate as selectBestAvailableFallbackCandidateFromDomain,
  diagnoseFallbackSelection,
  type RvRfDecisionCandidate,
  type RvRfDecisionCandidateAnnotated,
  type RvRfDecisionProfiles,
} from '../domain/optimizer/rvRfDecisionProfiles';
import { optimizerPolicyConfig, REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP } from '../domain/optimizerPolicyConfig';
import { T } from './theme';

type OptimizationMode = 'light' | 'normal' | 'decision';
type SourceMode = 'base' | 'simulation';

type Phase1Point = {
  scenarioId?: string;
  rvPct: number;
  rfPct: number;
  success40: number;
  ruin20: number;
  ruinP10: number | null;
  drawdownP50: number;
  terminalP50All: number | null;
  terminalP50Survivors: number | null;
  weights: PortfolioWeights;
  isCurrentMix?: boolean;
};

type Phase2Point = {
  source: Phase1Point;
  success40Assisted: number;
  ruin20Assisted: number;
  houseSalePct: number;
  houseSaleYearP50: number | null;
  cutScenarioPct: number | null;
  cutSeverityMean: number | null;
  firstCutYearP50: number | null;
  terminalP50All: number | null;
  terminalP50Survivors: number | null;
  drawdownP50: number;
  qualityCandidate: QualityOptimizationCandidate;
};

type PhaseRunMeta = {
  sourceLabel: string;
  nSim: number;
  seed: number;
  feeAnnual: number;
  bucketMonths: number;
  houseMode: string;
  cutsMode: string;
  riskCapitalMode: string;
  ranAtLabel: string;
  scenarioHash: string;
};

type Phase1ChampionChallenger = {
  champion: Phase1Point | null;
  challenger: Phase1Point | null;
  deltaSuccessPp: number | null;
  materialityLabel: string;
  currentIsChampion: boolean;
  message: string;
};

type Phase1Diagnostics = {
  runId: number;
  coarseEvaluations: number;
  currentEvaluations: number;
  local25Evaluations: number;
  micro10Evaluations: number;
  totalEvaluations: number;
  elapsedMs: number;
  capReached: boolean;
  cap: number;
};

type Phase2CompetitionDecision = {
  baselineLabel: string;
  autonomousGapPp: number;
  eligibleAutonomous: boolean;
  materialImprovements: string[];
  redFlags: string[];
  competesWithPhase1: boolean;
  displacesPhase1: boolean;
  reasons: string[];
};

type LongevityPlus5Result = {
  selectedLabel: string;
  selectedReason: string;
  success40AssistedBase: number;
  success45: number;
  drop40To45Pp: number;
  carryAmong40: number | null;
  terminalP50All45: number | null;
};

type Phase3SpendingVariant = {
  id: string;
  label: string;
  deltas: [number, number, number, number];
};

type Phase3Candidate = {
  baseRow: Phase2Point;
  variant: Phase3SpendingVariant;
  spendingVector: number[];
  success40: number;
  ruin20: number;
  cutScenarioPct: number | null;
  houseSalePct: number;
  drawdownP50: number;
  qualityOfLifeScore: number;
  weightedSpendingImprovementPct: number;
  deltaVsBestSuccessPp: number;
  guardrailViolations: string[];
  eligibleByBand: boolean;
  guardrailsPassed: boolean;
};

type Phase3Result = {
  relevantRows: Phase2Point[];
  bestSuccessRow: Phase2Point;
  rawWinner: Phase3Candidate | null;
  rawRunnerUp: Phase3Candidate | null;
  runnerUp: Phase3Candidate | null;
  poolBand: number;
  successBand: number;
  minimumSuccess: number;
  variantsTested: Phase3SpendingVariant[];
  candidatesEvaluated: number;
  eligibleCandidates: number;
  preferred: Phase3Candidate | null;
};

type RealisticValidationResult = {
  row: Phase2Point;
  deltaVsIdealSuccessPp: number;
  message: string;
};

type SensitivityScenarioResult = {
  scenario: RvRfPremiumSensitivityScenario;
  winner: Phase2Point | null;
  frontier: ReturnType<typeof buildOptimizationFrontierDiagnostics>;
  warnings: string[];
};

type SpendingHeadroomMixCandidate = {
  candidateId: string;
  label: string;
  sourceLabel: string;
  rvPct: number;
  rfPct: number;
  weights: PortfolioWeights;
};

type SpendingHeadroomEvaluationResult = {
  spendScale: SpendingHeadroomScale;
  spendLabel: string;
  candidateId: string;
  resultKey: string;
  rvReal: number;
  rfReal: number;
  rvGlobal: number;
  rvChile: number;
  rfGlobal: number;
  rfChile: number;
  qasrStrict: number | null;
  csr85_4: number | null;
  classicSuccessRate: number | null;
  probRuin: number;
  monthsInSevereCutMean: number | null;
  maxConsecutiveSevereCutMonthsP75: number | null;
  terminalWealthP25: number | null;
  terminalWealthP50: number | null;
  houseSaleRate: number | null;
  severeCutMonthsDuringHouseSaleMedian: number | null;
};

type SpendingHeadroomMixResult = {
  mix: SpendingHeadroomMixCandidate;
  evaluations: SpendingHeadroomEvaluationResult[];
  maxSpendScalePassingQoL: number | null;
};

type DecisionProfilesScenarioTable = {
  scenarioId: 'base' | 'rv_plus_10';
  label: string;
  profiles: RvRfDecisionProfiles;
  financialReference: FinancialReferenceCandidate | null;
  currentCandidate: RvRfDecisionCandidate | null;
};

export type FinancialReferenceCandidate = {
  candidateId: string;
  mixLabel: string;
  rvPct: number;
  rfPct: number;
  success40: number;
  ruin20: number;
  ruinP10: number | null;
  drawdownP50: number | null;
  terminalWealthP50: number | null;
  weights: PortfolioWeights;
};

type DecisionFlowStage = 'idle' | 'express' | 'zoom' | 'confirmed';

type DecisionFlowStatus = {
  stage: Exclude<DecisionFlowStage, 'idle'>;
  badge: string;
  message: string;
  nSim: number;
  stepPp: number | null;
  candidateCount: number;
  seed: number;
  implementationEnabled: boolean;
  sourceMode: SourceMode;
  sourceLabel: string;
  scenarioLabel: string | null;
  inputFingerprint: string;
  ranAtLabel: string | null;
};

type DecisionProgress = {
  stage: Exclude<DecisionFlowStage, 'idle'>;
  evaluated: number;
  total: number;
  nSim: number;
  seed: number;
  sourceMode: SourceMode;
  sourceLabel: string;
  scenarioLabel: string | null;
  inputFingerprint: string;
};

type OptimizationResultMeta = {
  inputFingerprint: string;
  sourceMode: SourceMode;
  sourceLabel: string;
  scenarioLabel: string | null;
  nSim: number;
  seed: number;
  ranAtLabel: string;
};

type OptimizationDecisionTraceCandidate = {
  mix: string;
  qasrBase: number | null;
  qasrPlus20: number | null;
  qasrPlus30: number | null;
  csr: number | null;
  successClassic: number | null;
  ruin: number | null;
  severeCutMeanMonths: number | null;
  severeCutStreakP75: number | null;
  guardrailFailures: string[];
  scoreOrRank: number | null;
  rejectedByBaselineDominance: boolean;
  rejectedByCandidateDominance: boolean;
  selectedReason: string | null;
};

type OptimizationDecisionTraceStage = {
  nSim: number;
  candidateCount: number;
  shortlistSource: string;
  candidates: OptimizationDecisionTraceCandidate[];
  selectedMix: string | null;
};

type OptimizationDecisionTrace = {
  inputFingerprint: string;
  sourceMode: SourceMode;
  seed: number;
  stages: {
    express: OptimizationDecisionTraceStage | null;
    zoom: OptimizationDecisionTraceStage | null;
    confirmation: OptimizationDecisionTraceStage | null;
  };
  finalRecommendationMix: string | null;
  implementationTargetMix: string | null;
  implementationReachedMix: string | null;
  implementationGap: number | null;
  notes: string[];
};

type DecisionRunContext = {
  runToken: number;
  inputFingerprint: string;
  sourceMode: SourceMode;
  sourceLabel: string;
  scenarioLabel: string | null;
};

type DecisionExecutionState = 'idle' | 'running' | 'background' | 'restarting' | 'interrupted' | 'completed';

type SleeveMixSnapshot = {
  rvGlobal: number;
  rvChile: number;
  rfGlobal: number;
  rfChile: number;
};

type SleeveValidationRow = {
  label: string;
  current: number;
  target: number;
  postTrade: number;
  gapPp: number;
};

type SleeveValidation = {
  rows: SleeveValidationRow[];
  maxGapPp: number;
  hasCompleteSleeveData: boolean;
};

type ImplementationActionStatus = 'no_action' | 'optional' | 'recommended' | 'not_implementable';

type ImplementationMaterialitySummary = {
  gapRvPp: number;
  totalTradePortfolioPct: number;
  totalTradeClp: number;
  status: ImplementationActionStatus;
  statusLabel: string;
  summary: string;
  detail: string;
  marginalTrade: boolean;
  relevantTrade: boolean;
  sleeveValidation: SleeveValidation;
};

type MidasComparisonRow = {
  section: 'composition' | 'quality' | 'wealth';
  label: string;
  current: string;
  recommended: string;
  change: string;
};

type CurrentVsMidasTradeoffs = {
  gains: string[];
  sacrifices: string[];
  marginal: boolean;
};

type DiscardedCompetitor = {
  candidate: RvRfDecisionCandidate | null;
  reason: string;
};

export type OptimizationSimulationSnapshot = {
  comparable?: boolean | null;
  scenarioHash?: string | null;
  nSim?: number | null;
  seed?: number | null;
  probRuin?: number | null;
  terminalP50?: number | null;
} | null;

const SHORTLIST_BEST_SUCCESS_BAND = optimizerPolicyConfig.phase1.shortlistBestSuccessBand;
const SHORTLIST_MIN_RV_DISTANCE = optimizerPolicyConfig.phase1.shortlistMinRvDistancePp;
const SHORTLIST_TARGET = optimizerPolicyConfig.phase1.shortlistTarget;
const PHASE1_SWEEP_MIN_RV = 0;
const PHASE1_SWEEP_MAX_RV = 100;
const PHASE1_SWEEP_STEP = 5;
const PHASE1_LOCAL_REFINEMENT_BASE_LIMIT = 4;
const PHASE1_MICRO_REFINEMENT_BASE_LIMIT = 2;
const PHASE1_MAX_EVALUATIONS = 29;
const PHASE1_SLOW_NOTICE_MS = 2500;
const TECHNICAL_TIE_BAND_PP = optimizerPolicyConfig.phase1.technicalTieBandPp;
const DELTA_ZERO_EPSILON_PP = 0.05;
const PHASE3_QOL_WEIGHTS = optimizerPolicyConfig.phase3.qolWeights;
const PHASE3_SPENDING_VARIANTS: Phase3SpendingVariant[] = [
  { id: 'base', label: 'Base', deltas: [0, 0, 0, 0] },
  { id: 'uniform-5', label: 'Uniforme +5%', deltas: [0.05, 0.05, 0.05, 0.05] },
  { id: 'uniform-10', label: 'Uniforme +10%', deltas: [0.10, 0.10, 0.10, 0.10] },
  { id: 'uniform-15', label: 'Uniforme +15%', deltas: [0.15, 0.15, 0.15, 0.15] },
  { id: 'g2-5', label: 'Fase 2 +5%', deltas: [0, 0.05, 0, 0] },
  { id: 'g2-10', label: 'Fase 2 +10%', deltas: [0, 0.10, 0, 0] },
  { id: 'g2-15', label: 'Fase 2 +15%', deltas: [0, 0.15, 0, 0] },
  { id: 'g2g3-5', label: 'Fase 2+3 +5%', deltas: [0, 0.05, 0.05, 0] },
  { id: 'g2-10-g3-5', label: 'Fase 2 +10%, Fase 3 +5%', deltas: [0, 0.10, 0.05, 0] },
  { id: 'g2g3-10', label: 'Fase 2+3 +10%', deltas: [0, 0.10, 0.10, 0] },
  { id: 'human-1', label: 'Humana +5/+10/+5', deltas: [0.05, 0.10, 0.05, 0] },
  { id: 'human-2', label: 'Humana +5/+15/+10', deltas: [0.05, 0.15, 0.10, 0] },
];
const PHASE3_GUARDRAILS = optimizerPolicyConfig.phase3.guardrails;
const PHASE2_COMPETITION_THRESHOLDS = optimizerPolicyConfig.phase2Competition;
const PHASE2_SELECTION_POLICY = optimizerPolicyConfig.phase2;
const MIX_COMPARISON_THRESHOLDS = optimizerPolicyConfig.moveRecommendation;
export const IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP = 1.0;
export const IMPLEMENTATION_RV_RF_GAP_OPTIONAL_PP = 2.0;
export const IMPLEMENTATION_TRADE_NO_ACTION_PORTFOLIO_PCT = 1.5;
export const IMPLEMENTATION_TRADE_RELEVANT_PORTFOLIO_PCT = 3.0;
export const IMPLEMENTATION_CRITICAL_SLEEVE_GAP_PP = 2.0;
export const DECISION_EXPRESS_STEP_PP = 10;
export const DECISION_EXPRESS_NSIM = 750;
export const DECISION_ZOOM_NSIM = 1000;
export const DECISION_OFFICIAL_GRID_STEP_PP = 5;
export const DECISION_CONFIRM_NEIGHBOR_STEP_PP = 5;
export const DECISION_CONFIRM_WIDE_NEIGHBOR_PP = 10;
export const DECISION_REFINEMENT_MAX_WINDOW_PP = 15;

function clampMixPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(4))));
}

function snapMixToStep(rvPct: number, stepPp = DECISION_OFFICIAL_GRID_STEP_PP): number {
  const snapped = Math.round(rvPct / stepPp) * stepPp;
  return clampMixPercent(snapped);
}

function cloneParams<T>(params: T): T {
  return JSON.parse(JSON.stringify(params)) as T;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(',')}}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashJson(value: unknown): string {
  return hashString(stableSerialize(value));
}

export function buildOptimizationInputFingerprint(input: {
  sourceMode: SourceMode;
  sourceLabel: string;
  params: ModelParameters;
}): string {
  return hashJson({
    version: 'optimization-light-v3',
    sourceMode: input.sourceMode,
    sourceLabel: input.sourceLabel,
    params: input.params,
    decisionConfig: {
      expressStepPp: DECISION_EXPRESS_STEP_PP,
      officialGridStepPp: DECISION_OFFICIAL_GRID_STEP_PP,
      confirmNeighborStepPp: DECISION_CONFIRM_NEIGHBOR_STEP_PP,
      confirmWideNeighborPp: DECISION_CONFIRM_WIDE_NEIGHBOR_PP,
      refinementMaxWindowPp: DECISION_REFINEMENT_MAX_WINDOW_PP,
    },
  });
}

function buildOptimizationResultMeta(input: {
  inputFingerprint: string;
  sourceMode: SourceMode;
  sourceLabel: string;
  scenarioLabel: string | null;
  nSim: number;
  seed: number;
}): OptimizationResultMeta {
  return {
    inputFingerprint: input.inputFingerprint,
    sourceMode: input.sourceMode,
    sourceLabel: input.sourceLabel,
    scenarioLabel: input.scenarioLabel,
    nSim: input.nSim,
    seed: input.seed,
    ranAtLabel: new Date().toLocaleString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export function isOptimizationResultMetaCurrent(meta: OptimizationResultMeta | null, activeFingerprint: string): boolean {
  return Boolean(meta && meta.inputFingerprint === activeFingerprint);
}

export function hasStaleOptimizationMeta(meta: OptimizationResultMeta | null, activeFingerprint: string): boolean {
  return Boolean(meta && meta.inputFingerprint !== activeFingerprint);
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatYears(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  return `${value.toFixed(1)} años`;
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-CL', { maximumFractionDigits: 0 });
}

function formatClpShort(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `CLP ${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (abs >= 1_000) return `CLP ${(value / 1_000).toFixed(1).replace('.', ',')}k`;
  return `CLP ${value.toFixed(0)}`;
}

function formatScore100(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  return `${Math.round(value * 100)}/100`;
}

function formatPctOrNA(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  return formatPct(value);
}

function formatMonthsHuman(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  const roundedMonths = Math.round(value * 10) / 10;
  if (roundedMonths <= 0) return '0 meses';
  if (roundedMonths < 12) return `${roundedMonths.toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses`;
  const years = roundedMonths / 12;
  return `${roundedMonths.toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses / ${years.toLocaleString('es-ES', { maximumFractionDigits: 1 })} años`;
}

function formatPctPrecise(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSpendScaleLabel(scale: SpendingHeadroomScale): string {
  if (Math.abs(scale - 1) < 1e-9) return 'Base';
  return `+${Math.round((scale - 1) * 100)}%`;
}

function formatScorePrecise(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  return `${(value * 100).toFixed(2)}/100`;
}

function formatNativeAmount(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const label = currency || 'Nativo';
  if (label.toUpperCase() === 'CLP') return formatClpShort(value);
  return `${label.toUpperCase()} ${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}

function formatPctValue(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

function formatRvPctLabel(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function formatSignedPp(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} pp`;
}

function implementationStageLabel(stage: 'clean' | 'cross_manager' | 'cross_currency'): string {
  if (stage === 'clean') return 'Limpio';
  if (stage === 'cross_manager') return 'Entre administradoras';
  return 'Cambio moneda';
}

function implementationStageReasonLabel(statusReason: 'used' | 'not_required' | 'agotado' | 'sin_destinos_elegibles' | 'bloqueado_por_metadata' | 'no_mejora_rv_rf'): string {
  if (statusReason === 'used') return 'Usado';
  if (statusReason === 'not_required') return 'No requerido';
  if (statusReason === 'agotado') return 'Agotado';
  if (statusReason === 'sin_destinos_elegibles') return 'Sin destinos elegibles';
  if (statusReason === 'bloqueado_por_metadata') return 'Bloqueado por metadata';
  return 'No mejora RV/RF';
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatDeltaVsBest(deltaVsBestPp: number): string {
  if (Math.abs(deltaVsBestPp) < DELTA_ZERO_EPSILON_PP) return '0.0 pp';
  return `${deltaVsBestPp.toFixed(1)} pp`;
}

function scenarioLabel(point: Phase1Point): string {
  return `${point.scenarioId ?? '?'} · RV ${point.rvPct}% / RF ${point.rfPct}%`;
}

function findPhase2RowByRvPct(rows: Phase2Point[], rvPct: number): Phase2Point | null {
  return rows.find((row) => Math.abs(row.source.rvPct - rvPct) <= 0.05) ?? null;
}

function currentRvPctExactFromWeights(weights: PortfolioWeights): number {
  return clampMixPercent((weights.rvGlobal + weights.rvChile) * 100);
}

function formatDecisionMixLabel(rvPct: number): string {
  const rv = clampMixPercent(rvPct);
  const rf = clampMixPercent(100 - rv);
  return `RV ${formatRvPctLabel(rv)} / RF ${formatRvPctLabel(rf)}`;
}

function candidateIdForRvPct(rvPct: number, currentRvPct: number | null): string {
  const rv = clampMixPercent(rvPct);
  const rf = clampMixPercent(100 - rv);
  const slug = (value: number) => formatRvPctLabel(value).replace(',', '_').replace('.', '_');
  if (currentRvPct !== null && Math.abs(rv - currentRvPct) <= 0.0001) {
    return `current_active_rv_${slug(rv)}_rf_${slug(rf)}`;
  }
  return `rv_${slug(rv)}_rf_${slug(rf)}`;
}

export function buildOptimizationExpressGrid(currentRv?: number | null): number[] {
  const coarseGrid = buildFineRvRfGrid(DECISION_EXPRESS_STEP_PP);
  const closedGrid: number[] = [];
  coarseGrid.forEach((rvPct) => {
    pushUniqueMix(closedGrid, snapMixToStep(rvPct));
  });
  if (currentRv !== null && currentRv !== undefined && Number.isFinite(currentRv)) {
    pushUniqueMix(closedGrid, snapMixToStep(currentRv));
  }
  return closedGrid.sort((a, b) => a - b);
}

function scenarioVariantLabel(id: ScenarioVariantId | string | null | undefined): string {
  if (id === 'pessimistic') return 'Pesimista';
  if (id === 'optimistic') return 'Optimista';
  return 'Base';
}

function pushUniqueMix(target: number[], rvPct: number) {
  const clamped = clampMixPercent(rvPct);
  if (!target.some((value) => Math.abs(value - clamped) <= 0.0001)) target.push(clamped);
}

function currentRvPctFromWeights(weights: PortfolioWeights): number {
  return currentRvPctExactFromWeights(weights);
}

function isOnOfficialGrid(rvPct: number, stepPp = DECISION_OFFICIAL_GRID_STEP_PP): boolean {
  const snapped = snapMixToStep(rvPct, stepPp);
  return Math.abs(snapped - clampMixPercent(rvPct)) <= 0.0001;
}

function pushBoundedRefinementNeighbors(target: number[], anchor: number, maxWindow = DECISION_REFINEMENT_MAX_WINDOW_PP) {
  const anchor5 = snapMixToStep(anchor);
  const candidates = [
    anchor5 - DECISION_CONFIRM_WIDE_NEIGHBOR_PP,
    anchor5 - DECISION_CONFIRM_NEIGHBOR_STEP_PP,
    anchor5,
    anchor5 + DECISION_CONFIRM_NEIGHBOR_STEP_PP,
    anchor5 + DECISION_CONFIRM_WIDE_NEIGHBOR_PP,
  ];
  candidates.forEach((candidate) => {
    if (Math.abs(candidate - anchor5) <= maxWindow + 1e-9) {
      pushUniqueMix(target, snapMixToStep(candidate));
    }
  });
}

export function buildOptimizationZoomShortlist(input: {
  preliminaryRecommendationRv: number | null;
  defensiveReferenceRv: number | null;
  technicalPreludeRv: number | null;
  currentRvRounded: number | null;
}): number[] {
  if (input.preliminaryRecommendationRv === null || !Number.isFinite(input.preliminaryRecommendationRv)) return [];
  const shortlist: number[] = [];
  const anchor = snapMixToStep(input.preliminaryRecommendationRv);
  pushBoundedRefinementNeighbors(shortlist, anchor);
  const optionalAnchors = [input.defensiveReferenceRv, input.technicalPreludeRv, input.currentRvRounded];
  optionalAnchors.forEach((seed) => {
    if (seed === null || !Number.isFinite(seed)) return;
    const snapped = snapMixToStep(seed);
    if (Math.abs(snapped - anchor) <= DECISION_REFINEMENT_MAX_WINDOW_PP + 1e-9) {
      pushBoundedRefinementNeighbors(shortlist, snapped);
    }
  });
  return shortlist.sort((a, b) => a - b);
}

export function buildOptimizationZoomFallbackShortlist(currentRvRounded: number | null): number[] {
  if (currentRvRounded === null || !Number.isFinite(currentRvRounded)) return [];
  const shortlist: number[] = [];
  const anchor = snapMixToStep(currentRvRounded);
  pushBoundedRefinementNeighbors(shortlist, anchor, DECISION_CONFIRM_WIDE_NEIGHBOR_PP);
  return shortlist.sort((a, b) => a - b);
}

export function buildOptimizationConfirmationShortlist(input: {
  zoomRecommendationRv: number | null;
  expressRecommendationRv: number | null;
  defensiveReferenceRv: number | null;
  technicalPreludeRv: number | null;
  currentRvRounded: number | null;
}): number[] {
  if (input.zoomRecommendationRv === null || !Number.isFinite(input.zoomRecommendationRv)) return [];
  const shortlist: number[] = [];
  const anchor = snapMixToStep(input.zoomRecommendationRv);
  pushBoundedRefinementNeighbors(shortlist, anchor);
  const optionalAnchors = [
    input.expressRecommendationRv,
    input.defensiveReferenceRv,
    input.technicalPreludeRv,
    input.currentRvRounded,
  ];
  optionalAnchors.forEach((seed) => {
    if (seed === null || !Number.isFinite(seed)) return;
    const snapped = snapMixToStep(seed);
    if (Math.abs(snapped - anchor) <= DECISION_REFINEMENT_MAX_WINDOW_PP + 1e-9) {
      pushBoundedRefinementNeighbors(shortlist, snapped);
    }
  });
  return shortlist.sort((a, b) => a - b);
}

export function selectBestAvailableFallbackCandidate(
  rows: RvRfDecisionCandidateAnnotated[] | null | undefined,
  baselineCandidate: RvRfDecisionCandidate | null = null,
): RvRfDecisionCandidateAnnotated | null {
  return selectBestAvailableFallbackCandidateFromDomain(rows, baselineCandidate);
}

function buildDecisionTraceStage(input: {
  nSim: number;
  candidateCount: number;
  shortlistSource: string;
  profiles: RvRfDecisionProfiles | null;
  baselineCandidate: RvRfDecisionCandidate | null;
  selectedCandidate: RvRfDecisionCandidate | null;
}): OptimizationDecisionTraceStage | null {
  if (!input.profiles) return null;
  const fallbackTrace = diagnoseFallbackSelection(input.profiles.rows, input.baselineCandidate);
  const fallbackById = new Map(fallbackTrace.diagnostics.map((row) => [row.candidateId, row]));
  return {
    nSim: input.nSim,
    candidateCount: input.candidateCount,
    shortlistSource: input.shortlistSource,
    candidates: input.profiles.rows.map((candidate) => {
      const fallback = fallbackById.get(candidate.candidateId) ?? null;
      return {
        mix: candidate.mixLabel,
        qasrBase: candidate.qasrBase,
        qasrPlus20: candidate.qasrAt120,
        qasrPlus30: candidate.qasrAt130,
        csr: candidate.csrBase,
        successClassic: candidate.ruinRate === null ? null : 1 - candidate.ruinRate,
        ruin: candidate.ruinRate,
        severeCutMeanMonths: candidate.monthsInSevereCutMean,
        severeCutStreakP75: candidate.maxConsecutiveSevereCutMonthsP75,
        guardrailFailures: candidate.failedGuardrails,
        scoreOrRank: fallback?.rank ?? null,
        rejectedByBaselineDominance: fallback?.rejectedByBaselineDominance ?? false,
        rejectedByCandidateDominance: fallback?.rejectedByCandidateDominance ?? false,
        selectedReason: candidate.candidateId === input.selectedCandidate?.candidateId
          ? 'selected_visible'
          : (fallback?.selectedReason ?? null),
      };
    }),
    selectedMix: input.selectedCandidate?.mixLabel ?? null,
  };
}

function toSleeveSnapshot(weights: PortfolioWeights): SleeveMixSnapshot {
  return {
    rvGlobal: weights.rvGlobal,
    rvChile: weights.rvChile,
    rfGlobal: weights.rfGlobal,
    rfChile: weights.rfChile,
  };
}

export function buildSleeveValidation(input: {
  current: PortfolioWeights;
  target: PortfolioWeights;
  postTrade: PortfolioWeights;
}): SleeveValidation {
  const current = toSleeveSnapshot(input.current);
  const target = toSleeveSnapshot(input.target);
  const postTrade = toSleeveSnapshot(input.postTrade);
  const rows: SleeveValidationRow[] = [
    { label: 'RV global', current: current.rvGlobal, target: target.rvGlobal, postTrade: postTrade.rvGlobal, gapPp: (target.rvGlobal - current.rvGlobal) * 100 },
    { label: 'RV local / Chile', current: current.rvChile, target: target.rvChile, postTrade: postTrade.rvChile, gapPp: (target.rvChile - current.rvChile) * 100 },
    { label: 'RF global', current: current.rfGlobal, target: target.rfGlobal, postTrade: postTrade.rfGlobal, gapPp: (target.rfGlobal - current.rfGlobal) * 100 },
    { label: 'RF local / Chile', current: current.rfChile, target: target.rfChile, postTrade: postTrade.rfChile, gapPp: (target.rfChile - current.rfChile) * 100 },
  ];
  const maxGapPp = Math.max(...rows.map((row) => Math.abs(row.gapPp)));
  return {
    rows,
    maxGapPp,
    hasCompleteSleeveData: rows.every((row) => Number.isFinite(row.current) && Number.isFinite(row.target) && Number.isFinite(row.postTrade)),
  };
}

export function classifyImplementationMateriality(input: {
  currentWeights: PortfolioWeights;
  plan: InstrumentImplementationPlan;
}): ImplementationMaterialitySummary {
  const gapRvPp = Math.abs((input.plan.targetMixIdeal.rv - input.plan.currentMix.rv) * 100);
  const totalTradePortfolioPct = input.plan.transfers.reduce((sum, transfer) => sum + (transfer.weightMoved * 100), 0);
  const totalTradeClp = input.plan.transfers.reduce((sum, transfer) => sum + transfer.amountClpMoved, 0);
  const sleeveValidation = buildSleeveValidation({
    current: input.currentWeights,
    target: input.plan.baseTargetWeights,
    postTrade: input.plan.reachableWeights,
  });
  const hasCriticalSleeveGap = sleeveValidation.maxGapPp > IMPLEMENTATION_CRITICAL_SLEEVE_GAP_PP + 1e-9;

  if (gapRvPp < IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP - 1e-9 || (totalTradePortfolioPct < IMPLEMENTATION_TRADE_NO_ACTION_PORTFOLIO_PCT && !hasCriticalSleeveGap)) {
    return {
      gapRvPp,
      totalTradePortfolioPct,
      totalTradeClp,
      status: 'no_action',
      statusLabel: 'No requiere acción',
      summary: 'Objetivo alcanzado dentro de tolerancia.',
      detail: 'El mix actual ya está suficientemente cerca del Óptimo MIDAS recomendado. No vale la pena hacer traspasos por ahora.',
      marginalTrade: totalTradePortfolioPct < IMPLEMENTATION_TRADE_NO_ACTION_PORTFOLIO_PCT,
      relevantTrade: false,
      sleeveValidation,
    };
  }

  if (!input.plan.transfers.length) {
    return {
      gapRvPp,
      totalTradePortfolioPct,
      totalTradeClp,
      status: 'not_implementable',
      statusLabel: 'No implementable automáticamente por instrumento',
      summary: 'No hay traspasos ejecutables por instrumento bajo las restricciones actuales.',
      detail: 'La app conserva el diagnóstico por sleeve como referencia técnica, pero no lo presenta como instrucción operativa.',
      marginalTrade: false,
      relevantTrade: false,
      sleeveValidation,
    };
  }

  if (
    gapRvPp < IMPLEMENTATION_RV_RF_GAP_OPTIONAL_PP - 1e-9
    || totalTradePortfolioPct < IMPLEMENTATION_TRADE_RELEVANT_PORTFOLIO_PCT - 1e-9
  ) {
    return {
      gapRvPp,
      totalTradePortfolioPct,
      totalTradeClp,
      status: 'optional',
      statusLabel: 'Ajuste opcional',
      summary: 'El ajuste es pequeño. Ejecutar solo si quieres alinear exactamente.',
      detail: 'El movimiento sugerido no cambia materialmente el perfil total. Puede servir para afinar sleeves o cerrar un pequeño desvío.',
      marginalTrade: totalTradePortfolioPct < IMPLEMENTATION_TRADE_NO_ACTION_PORTFOLIO_PCT,
      relevantTrade: totalTradePortfolioPct >= IMPLEMENTATION_TRADE_RELEVANT_PORTFOLIO_PCT,
      sleeveValidation,
    };
  }

  return {
    gapRvPp,
    totalTradePortfolioPct,
    totalTradeClp,
    status: 'recommended',
    statusLabel: 'Implementación recomendada',
    summary: 'El desvío sigue siendo material frente al objetivo MIDAS.',
    detail: 'El gap y el tamaño del movimiento ya justifican ejecutar la implementación sugerida.',
    marginalTrade: false,
    relevantTrade: totalTradePortfolioPct >= IMPLEMENTATION_TRADE_RELEVANT_PORTFOLIO_PCT,
    sleeveValidation,
  };
}

export function canUseDecisionFlowForImplementation(status: DecisionFlowStatus | null): boolean {
  return Boolean(status && status.stage === 'confirmed' && status.implementationEnabled);
}

export function buildSimulationReconciliationMessage(input: {
  snapshot: OptimizationSimulationSnapshot;
  nSim: number;
  seed: number;
}): string {
  if (!input.snapshot) return `Actual recalculado en Optimización con nSim ${input.nSim.toLocaleString('es-ES')} / seed ${input.seed}.`;
  if (input.snapshot.comparable === true) return 'Actual validado contra Simulación.';
  return 'Actual recalculado en Optimización. No coincide exactamente con la corrida visible de Simulación.';
}

function score100Value(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : value * 100;
}

function formatScoreChange(current: number | null, recommended: number | null): string {
  if (current === null || recommended === null || !Number.isFinite(current) || !Number.isFinite(recommended)) return 'No disponible';
  return formatScoreDeltaPoints((recommended - current) * 100);
}

function formatPctChange(current: number | null, recommended: number | null): string {
  if (current === null || recommended === null || !Number.isFinite(current) || !Number.isFinite(recommended)) return 'No disponible';
  return formatSignedPp((recommended - current) * 100);
}

function formatMonthsChange(current: number | null, recommended: number | null): string {
  if (current === null || recommended === null || !Number.isFinite(current) || !Number.isFinite(recommended)) return 'No disponible';
  return `${recommended - current >= 0 ? '+' : '-'}${Math.abs(recommended - current).toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses`;
}

function formatMoneyChange(current: number | null, recommended: number | null): string {
  if (current === null || recommended === null || !Number.isFinite(current) || !Number.isFinite(recommended)) return 'No disponible';
  return `${recommended - current >= 0 ? '+' : '-'}${formatClpShort(Math.abs(recommended - current))}`;
}

function formatWeightPct(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

function formatWeightChange(current: number, recommended: number): string {
  return formatSignedPp((recommended - current) * 100);
}

export function selectFinancialOptimumCandidate(
  candidates: FinancialReferenceCandidate[] | null,
): FinancialReferenceCandidate | null {
  if (!candidates?.length) return null;
  return [...candidates].sort((a, b) => (
    (b.success40 - a.success40)
    || (a.ruin20 - b.ruin20)
    || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
    || ((a.drawdownP50 ?? Number.POSITIVE_INFINITY) - (b.drawdownP50 ?? Number.POSITIVE_INFINITY))
    || (a.rvPct - b.rvPct)
  ))[0] ?? null;
}

export function buildFinancialReferenceParams(params: ModelParameters): ModelParameters {
  return buildAutonomousParams(params);
}

export function selectClosestDiscardedCompetitor(input: {
  profiles: RvRfDecisionProfiles | null;
  mainRecommendation: RvRfDecisionCandidate | null;
  defensiveReference: RvRfDecisionCandidate | null;
  headroomAlternative: RvRfDecisionCandidate | null;
  benchmarkExtreme: RvRfDecisionCandidate | null;
  financialReference?: FinancialReferenceCandidate | null;
}): DiscardedCompetitor {
  const { profiles, mainRecommendation, defensiveReference, headroomAlternative, benchmarkExtreme, financialReference } = input;
  if (!profiles || !mainRecommendation) return { candidate: null, reason: 'No hay suficientes datos para identificar un competidor descartado.' };
  const excluded = new Set([
    mainRecommendation.candidateId,
    defensiveReference?.candidateId,
    headroomAlternative?.candidateId,
    benchmarkExtreme?.candidateId,
    financialReference?.candidateId,
  ].filter((value): value is string => Boolean(value)));
  const eligible = profiles.rows
    .filter((candidate) => !excluded.has(candidate.candidateId) && candidate.passesHardGuardrails);
  const lessExtremeEligible = eligible.filter((candidate) => candidate.rvPct < 95);
  const candidatePool = lessExtremeEligible.length ? lessExtremeEligible : eligible;

  const ratioRunnerUp = [...candidatePool]
    .filter((candidate) => (
      candidate.inParetoFrontier
      && candidate.tradeoffRatioVsDefensive !== null
      && candidate.tradeoffRatioVsDefensive < profiles.ratioUsed
    ))
    .sort((a, b) => (
      ((b.tradeoffRatioVsDefensive ?? Number.NEGATIVE_INFINITY) - (a.tradeoffRatioVsDefensive ?? Number.NEGATIVE_INFINITY))
      || (Math.abs(a.rvPct - mainRecommendation.rvPct) - Math.abs(b.rvPct - mainRecommendation.rvPct))
    ))[0] ?? null;
  if (ratioRunnerUp) {
    return { candidate: ratioRunnerUp, reason: 'No supera ratio estabilidad/holgura.' };
  }

  const paretoRunnerUp = [...candidatePool]
    .filter((candidate) => candidate.inParetoFrontier)
    .sort((a, b) => (
      (Math.abs(a.rvPct - mainRecommendation.rvPct) - Math.abs(b.rvPct - mainRecommendation.rvPct))
      || ((score100Value(b.qasrBase) ?? Number.NEGATIVE_INFINITY) - (score100Value(a.qasrBase) ?? Number.NEGATIVE_INFINITY))
    ))[0] ?? null;
  if (paretoRunnerUp) {
    const baseDelta = ((paretoRunnerUp.qasrBase ?? 0) - (mainRecommendation.qasrBase ?? 0)) * 100;
    if (baseDelta < -2) return { candidate: paretoRunnerUp, reason: 'Mejora holgura, pero pierde demasiada calidad base.' };
    return { candidate: paretoRunnerUp, reason: 'No mejora materialmente frente al recomendado.' };
  }

  const nearest = [...candidatePool]
    .sort((a, b) => Math.abs(a.rvPct - mainRecommendation.rvPct) - Math.abs(b.rvPct - mainRecommendation.rvPct))[0] ?? null;
  if (!nearest) return { candidate: null, reason: 'No hay competidor descartado interpretable en esta corrida.' };
  if (!nearest.passesHardGuardrails) return { candidate: nearest, reason: 'No pasa guardrails.' };
  if (nearest.rvPct >= 95) return { candidate: nearest, reason: 'Es demasiado extremo y no hay alternativa menos concentrada equivalente.' };
  return { candidate: nearest, reason: 'No mejora materialmente frente al recomendado.' };
}

export function buildCurrentVsMidasComparisonRows(input: {
  currentWeights: PortfolioWeights;
  recommendedWeights: PortfolioWeights;
  currentCandidate: RvRfDecisionCandidate | null;
  recommendedCandidate: RvRfDecisionCandidate | null;
}): MidasComparisonRow[] {
  const current = toSleeveSnapshot(input.currentWeights);
  const recommended = toSleeveSnapshot(input.recommendedWeights);
  const currentRv = current.rvGlobal + current.rvChile;
  const recommendedRv = recommended.rvGlobal + recommended.rvChile;
  const compositionRows: MidasComparisonRow[] = [
    {
      section: 'composition',
      label: 'RV/RF total',
      current: `RV ${formatWeightPct(currentRv)} / RF ${formatWeightPct(1 - currentRv)}`,
      recommended: `RV ${formatWeightPct(recommendedRv)} / RF ${formatWeightPct(1 - recommendedRv)}`,
      change: formatWeightChange(currentRv, recommendedRv),
    },
    {
      section: 'composition',
      label: 'RV global',
      current: formatWeightPct(current.rvGlobal),
      recommended: formatWeightPct(recommended.rvGlobal),
      change: formatWeightChange(current.rvGlobal, recommended.rvGlobal),
    },
    {
      section: 'composition',
      label: 'RV local / Chile',
      current: formatWeightPct(current.rvChile),
      recommended: formatWeightPct(recommended.rvChile),
      change: formatWeightChange(current.rvChile, recommended.rvChile),
    },
    {
      section: 'composition',
      label: 'RF global',
      current: formatWeightPct(current.rfGlobal),
      recommended: formatWeightPct(recommended.rfGlobal),
      change: formatWeightChange(current.rfGlobal, recommended.rfGlobal),
    },
    {
      section: 'composition',
      label: 'RF local / Chile',
      current: formatWeightPct(current.rfChile),
      recommended: formatWeightPct(recommended.rfChile),
      change: formatWeightChange(current.rfChile, recommended.rfChile),
    },
  ];

  const c = input.currentCandidate;
  const r = input.recommendedCandidate;
  const currentSuccess = c?.ruinRate === null || c?.ruinRate === undefined ? null : 1 - (c.ruinRate as number);
  const recommendedSuccess = r?.ruinRate === null || r?.ruinRate === undefined ? null : 1 - (r.ruinRate as number);
  const qualityRows: MidasComparisonRow[] = [
    { section: 'quality', label: 'QASR base', current: formatScore100(c?.qasrBase ?? null), recommended: formatScore100(r?.qasrBase ?? null), change: formatScoreChange(c?.qasrBase ?? null, r?.qasrBase ?? null) },
    { section: 'quality', label: 'QASR +20% gasto', current: formatScore100(c?.qasrAt120 ?? null), recommended: formatScore100(r?.qasrAt120 ?? null), change: formatScoreChange(c?.qasrAt120 ?? null, r?.qasrAt120 ?? null) },
    { section: 'quality', label: 'QASR +30% gasto', current: formatScore100(c?.qasrAt130 ?? null), recommended: formatScore100(r?.qasrAt130 ?? null), change: formatScoreChange(c?.qasrAt130 ?? null, r?.qasrAt130 ?? null) },
    { section: 'quality', label: 'CSR', current: formatPctOrNA(c?.csrBase ?? null), recommended: formatPctOrNA(r?.csrBase ?? null), change: formatPctChange(c?.csrBase ?? null, r?.csrBase ?? null) },
    { section: 'quality', label: 'Éxito clásico', current: formatPctOrNA(currentSuccess), recommended: formatPctOrNA(recommendedSuccess), change: formatPctChange(currentSuccess, recommendedSuccess) },
    { section: 'quality', label: 'Ruina', current: formatPctOrNA(c?.ruinRate ?? null), recommended: formatPctOrNA(r?.ruinRate ?? null), change: formatPctChange(c?.ruinRate ?? null, r?.ruinRate ?? null) },
    { section: 'quality', label: 'Recorte severo promedio', current: formatMonthsHuman(c?.monthsInSevereCutMean ?? null), recommended: formatMonthsHuman(r?.monthsInSevereCutMean ?? null), change: formatMonthsChange(c?.monthsInSevereCutMean ?? null, r?.monthsInSevereCutMean ?? null) },
    { section: 'quality', label: 'Racha severa P75', current: formatMonthsHuman(c?.maxConsecutiveSevereCutMonthsP75 ?? null), recommended: formatMonthsHuman(r?.maxConsecutiveSevereCutMonthsP75 ?? null), change: formatMonthsChange(c?.maxConsecutiveSevereCutMonthsP75 ?? null, r?.maxConsecutiveSevereCutMonthsP75 ?? null) },
    { section: 'quality', label: 'Venta de casa %', current: formatPctOrNA(c?.houseSaleRate ?? null), recommended: formatPctOrNA(r?.houseSaleRate ?? null), change: formatPctChange(c?.houseSaleRate ?? null, r?.houseSaleRate ?? null) },
    { section: 'quality', label: 'Max drawdown P50', current: 'No disponible', recommended: 'No disponible', change: 'No disponible' },
  ];
  const wealthRows: MidasComparisonRow[] = [
    { section: 'wealth', label: 'Patrimonio final P25', current: formatClpShort(c?.terminalWealthP25 ?? null), recommended: formatClpShort(r?.terminalWealthP25 ?? null), change: formatMoneyChange(c?.terminalWealthP25 ?? null, r?.terminalWealthP25 ?? null) },
    { section: 'wealth', label: 'Patrimonio final P50', current: formatClpShort(c?.terminalWealthP50 ?? null), recommended: formatClpShort(r?.terminalWealthP50 ?? null), change: formatMoneyChange(c?.terminalWealthP50 ?? null, r?.terminalWealthP50 ?? null) },
  ];
  return [...compositionRows, ...qualityRows, ...wealthRows];
}

export function buildCurrentVsMidasTradeoffs(input: {
  currentWeights: PortfolioWeights;
  recommendedWeights: PortfolioWeights;
  currentCandidate: RvRfDecisionCandidate | null;
  recommendedCandidate: RvRfDecisionCandidate | null;
}): CurrentVsMidasTradeoffs {
  const gains: string[] = [];
  const sacrifices: string[] = [];
  const currentRv = input.currentWeights.rvGlobal + input.currentWeights.rvChile;
  const recommendedRv = input.recommendedWeights.rvGlobal + input.recommendedWeights.rvChile;
  const rvDeltaPp = (recommendedRv - currentRv) * 100;
  const c = input.currentCandidate;
  const r = input.recommendedCandidate;
  const pushDirectional = (delta: number | null, positiveIsGain: boolean, threshold: number, formatter: (value: number) => string) => {
    if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < threshold) return;
    const text = formatter(delta);
    if ((delta > 0 && positiveIsGain) || (delta < 0 && !positiveIsGain)) gains.push(text);
    else sacrifices.push(text);
  };
  pushDirectional(
    c?.qasrBase !== null && c?.qasrBase !== undefined && r?.qasrBase !== null && r?.qasrBase !== undefined
      ? (r.qasrBase - c.qasrBase) * 100
      : null,
    true,
    0.15,
    (delta) => `${delta >= 0 ? 'Ganas' : 'Pierdes'} ${formatScoreDeltaPoints(delta)} de QASR base.`,
  );
  pushDirectional(
    c?.qasrAt120 !== null && c?.qasrAt120 !== undefined && r?.qasrAt120 !== null && r?.qasrAt120 !== undefined
      ? (r.qasrAt120 - c.qasrAt120) * 100
      : null,
    true,
    0.15,
    (delta) => `${delta >= 0 ? 'Ganas' : 'Pierdes'} ${formatScoreDeltaPoints(delta)} de QASR +20.`,
  );
  pushDirectional(
    c?.qasrAt130 !== null && c?.qasrAt130 !== undefined && r?.qasrAt130 !== null && r?.qasrAt130 !== undefined
      ? (r.qasrAt130 - c.qasrAt130) * 100
      : null,
    true,
    0.15,
    (delta) => `${delta >= 0 ? 'Ganas' : 'Pierdes'} ${formatScoreDeltaPoints(delta)} de QASR +30.`,
  );
  pushDirectional(
    c?.csrBase !== null && c?.csrBase !== undefined && r?.csrBase !== null && r?.csrBase !== undefined
      ? (r.csrBase - c.csrBase) * 100
      : null,
    true,
    0.5,
    (delta) => `La CSR cambia ${formatSignedPp(delta)}.`,
  );
  pushDirectional(
    c?.ruinRate !== null && c?.ruinRate !== undefined && r?.ruinRate !== null && r?.ruinRate !== undefined
      ? (r.ruinRate - c.ruinRate) * 100
      : null,
    false,
    0.5,
    () => `La ruina cambia de ${formatPctOrNA(c?.ruinRate ?? null)} a ${formatPctOrNA(r?.ruinRate ?? null)}.`,
  );
  pushDirectional(
    c?.monthsInSevereCutMean !== null && c?.monthsInSevereCutMean !== undefined && r?.monthsInSevereCutMean !== null && r?.monthsInSevereCutMean !== undefined
      ? r.monthsInSevereCutMean - c.monthsInSevereCutMean
      : null,
    false,
    1,
    (delta) => `El recorte severo promedio ${delta < 0 ? 'baja' : 'sube'} ${Math.abs(delta).toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses.`,
  );
  pushDirectional(
    c?.maxConsecutiveSevereCutMonthsP75 !== null && c?.maxConsecutiveSevereCutMonthsP75 !== undefined && r?.maxConsecutiveSevereCutMonthsP75 !== null && r?.maxConsecutiveSevereCutMonthsP75 !== undefined
      ? r.maxConsecutiveSevereCutMonthsP75 - c.maxConsecutiveSevereCutMonthsP75
      : null,
    false,
    1,
    (delta) => `La racha severa P75 ${delta < 0 ? 'baja' : 'sube'} ${Math.abs(delta).toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses.`,
  );
  pushDirectional(
    c?.houseSaleRate !== null && c?.houseSaleRate !== undefined && r?.houseSaleRate !== null && r?.houseSaleRate !== undefined
      ? (r.houseSaleRate - c.houseSaleRate) * 100
      : null,
    false,
    1,
    () => `La venta de casa cambia de ${formatPctOrNA(c?.houseSaleRate ?? null)} a ${formatPctOrNA(r?.houseSaleRate ?? null)}.`,
  );
  if (gains.length < 3 && sacrifices.length < 3) {
    pushDirectional(
      c?.terminalWealthP50 !== null && c?.terminalWealthP50 !== undefined && r?.terminalWealthP50 !== null && r?.terminalWealthP50 !== undefined
        ? r.terminalWealthP50 - c.terminalWealthP50
        : null,
      true,
      1,
      (delta) => `El P50 final ${delta >= 0 ? 'sube' : 'baja'} ${formatClpShort(Math.abs(delta))}.`,
    );
  }
  pushDirectional(
    c?.terminalWealthP25 !== null && c?.terminalWealthP25 !== undefined && r?.terminalWealthP25 !== null && r?.terminalWealthP25 !== undefined
      ? r.terminalWealthP25 - c.terminalWealthP25
      : null,
    true,
    Number.POSITIVE_INFINITY,
    (delta) => `El P25 final ${delta >= 0 ? 'sube' : 'baja'} ${formatClpShort(Math.abs(delta))}.`,
  );
  if (Math.abs(rvDeltaPp) >= 0.5) {
    const text = `La RV ${rvDeltaPp >= 0 ? 'sube' : 'baja'} ${Math.abs(rvDeltaPp).toFixed(1)} pp.`;
    if (rvDeltaPp >= 0) sacrifices.push(text);
    else gains.push(text);
  }
  const marginal = Math.abs(rvDeltaPp) < IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP;
  return {
    gains: gains.slice(0, 3),
    sacrifices: sacrifices.slice(0, 3),
    marginal,
  };
}

function findPhase2RowForDecisionCandidate(
  rows: Phase2Point[],
  candidate: RvRfDecisionCandidate | null,
): Phase2Point | null {
  if (!candidate) return null;
  return findPhase2RowByRvPct(rows, candidate.rvPct);
}

function buildSpendingHeadroomCandidates(
  rows: Phase2Point[],
  currentRow: Phase2Point | null,
  winner: Phase2Point | null,
  winnerSourceLabel = 'Recomendación principal V2.7.2',
): SpendingHeadroomMixCandidate[] {
  const candidates: SpendingHeadroomMixCandidate[] = [];
  const pushRow = (row: Phase2Point | null, sourceLabel: string) => {
    if (!row) return;
    if (candidates.some((candidate) => Math.abs(candidate.rvPct - row.source.rvPct) <= 0.05)) return;
    candidates.push({
      candidateId: row.qualityCandidate.id,
      label: `RV ${row.source.rvPct}% / RF ${row.source.rfPct}%`,
      sourceLabel,
      rvPct: row.source.rvPct,
      rfPct: row.source.rfPct,
      weights: cloneParams(row.source.weights),
    });
  };

  pushRow(winner, winnerSourceLabel);
  pushRow(currentRow, 'Mix actual');
  [0, 5, 25, 50, 80, 100].forEach((rvPct) => pushRow(findPhase2RowByRvPct(rows, rvPct), `Benchmark ${rvPct}/${100 - rvPct}`));

  const topQasr = [...rows]
    .filter((row) => row.qualityCandidate.qasrStrict !== null)
    .sort((a, b) => compareQualityOptimizationCandidates(a.qualityCandidate, b.qualityCandidate))
    .slice(0, 3);
  topQasr.forEach((row) => pushRow(row, 'Top QASR'));

  if (winner && winner.qualityCandidate.qasrStrict !== null) {
    const winnerQasr = winner.qualityCandidate.qasrStrict;
    const equivalentByQasr = rows
      .filter((row) => (
        row.qualityCandidate.qasrStrict !== null
        && ((winnerQasr ?? 0) - (row.qualityCandidate.qasrStrict ?? 0)) <= 0.005 + 1e-9
      ))
      .sort((a, b) => (
        ((b.qualityCandidate.terminalWealthP50 ?? Number.NEGATIVE_INFINITY) - (a.qualityCandidate.terminalWealthP50 ?? Number.NEGATIVE_INFINITY))
        || (a.source.rvPct - b.source.rvPct)
      ))
      .slice(0, 3);
    equivalentByQasr.forEach((row) => pushRow(row, 'Top patrimonio con QASR equivalente'));
  }

  return [...candidates].sort((a, b) => a.rvPct - b.rvPct);
}

type RecommendationTradeoffCard = {
  key: string;
  title: string;
  mixLabel: string;
  gains: string[];
  sacrifices: string[];
  reading: string;
};

function formatScoreDeltaPoints(delta: number): string {
  return `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)} pts`;
}

function buildDecisionTradeoffCard(
  key: string,
  title: string,
  baseline: RvRfDecisionCandidate,
  alternative: RvRfDecisionCandidate,
): RecommendationTradeoffCard {
  const gains: string[] = [];
  const sacrifices: string[] = [];
  const qasrBaseDelta = ((alternative.qasrBase ?? 0) - (baseline.qasrBase ?? 0)) * 100;
  const qasr120Delta = ((alternative.qasrAt120 ?? 0) - (baseline.qasrAt120 ?? 0)) * 100;
  const csrDelta = ((alternative.csrBase ?? 0) - (baseline.csrBase ?? 0)) * 100;
  const severeCutDelta = (alternative.monthsInSevereCutMean ?? 0) - (baseline.monthsInSevereCutMean ?? 0);
  const ruinDelta = ((alternative.ruinRate ?? 0) - (baseline.ruinRate ?? 0)) * 100;
  const terminalP50Delta = (
    baseline.terminalWealthP50 && baseline.terminalWealthP50 > 0 && alternative.terminalWealthP50 !== null
      ? ((alternative.terminalWealthP50 - baseline.terminalWealthP50) / baseline.terminalWealthP50) * 100
      : null
  );

  if (qasrBaseDelta >= 0.15) gains.push(`${formatScoreDeltaPoints(qasrBaseDelta)} de QASR base`);
  if (qasrBaseDelta <= -0.15) sacrifices.push(`${formatScoreDeltaPoints(qasrBaseDelta)} de QASR base`);
  if (qasr120Delta >= 0.15) gains.push(`${formatScoreDeltaPoints(qasr120Delta)} de QASR +20`);
  if (qasr120Delta <= -0.15) sacrifices.push(`${formatScoreDeltaPoints(qasr120Delta)} de QASR +20`);
  if (csrDelta >= 0.8) gains.push(`${csrDelta.toFixed(1)} pp más de CSR`);
  if (csrDelta <= -0.8) sacrifices.push(`${Math.abs(csrDelta).toFixed(1)} pp menos de CSR`);
  if (severeCutDelta <= -1) gains.push(`${Math.abs(severeCutDelta).toFixed(1)} meses menos de recorte severo`);
  if (severeCutDelta >= 1) sacrifices.push(`${Math.abs(severeCutDelta).toFixed(1)} meses más de recorte severo`);
  if (ruinDelta <= -0.5) gains.push(`${Math.abs(ruinDelta).toFixed(1)} pp menos de ruina`);
  if (ruinDelta >= 0.5) sacrifices.push(`${Math.abs(ruinDelta).toFixed(1)} pp más de ruina`);
  if (terminalP50Delta !== null && terminalP50Delta >= 10) gains.push(`${terminalP50Delta.toFixed(1)}% más de patrimonio final P50`);
  if (terminalP50Delta !== null && terminalP50Delta <= -10) sacrifices.push(`${Math.abs(terminalP50Delta).toFixed(1)}% menos de patrimonio final P50`);

  const reading = qasr120Delta > 0.15 && qasrBaseDelta < -0.15
    ? 'Gana holgura futura, pero acepta menor estabilidad base.'
    : qasrBaseDelta > 0.15 && qasr120Delta < -0.15
      ? 'Prioriza estabilidad base por sobre holgura futura.'
      : terminalP50Delta !== null && Math.abs(qasrBaseDelta) < 0.15 && Math.abs(qasr120Delta) < 0.15
        ? 'Se parece mucho en calidad, pero cambia el margen patrimonial.'
        : 'Cambia el equilibrio entre estabilidad base, holgura y recortes.';

  return {
    key,
    title,
    mixLabel: alternative.mixLabel,
    gains: gains.slice(0, 3),
    sacrifices: sacrifices.slice(0, 3),
    reading,
  };
}

function buildLegacyTradeoffCard(
  key: string,
  title: string,
  baseline: Phase2Point,
  alternative: Phase2Point,
): RecommendationTradeoffCard {
  const gains: string[] = [];
  const sacrifices: string[] = [];
  const qasrBaseDelta = (((alternative.qualityCandidate.qasrStrict ?? 0) - (baseline.qualityCandidate.qasrStrict ?? 0)) * 100);
  const csrDelta = (((alternative.qualityCandidate.csr85_4 ?? 0) - (baseline.qualityCandidate.csr85_4 ?? 0)) * 100);
  const severeCutDelta = ((alternative.qualityCandidate.monthsInSevereCutMean ?? 0) - (baseline.qualityCandidate.monthsInSevereCutMean ?? 0));
  const terminalP50Delta = (
    baseline.qualityCandidate.terminalWealthP50 && baseline.qualityCandidate.terminalWealthP50 > 0 && alternative.qualityCandidate.terminalWealthP50 !== null
      ? ((alternative.qualityCandidate.terminalWealthP50 - baseline.qualityCandidate.terminalWealthP50) / baseline.qualityCandidate.terminalWealthP50) * 100
      : null
  );

  if (qasrBaseDelta >= 0.15) gains.push(`${formatScoreDeltaPoints(qasrBaseDelta)} de QASR base`);
  if (qasrBaseDelta <= -0.15) sacrifices.push(`${formatScoreDeltaPoints(qasrBaseDelta)} de QASR base`);
  if (csrDelta >= 0.8) gains.push(`${csrDelta.toFixed(1)} pp más de CSR`);
  if (csrDelta <= -0.8) sacrifices.push(`${Math.abs(csrDelta).toFixed(1)} pp menos de CSR`);
  if (severeCutDelta <= -1) gains.push(`${Math.abs(severeCutDelta).toFixed(1)} meses menos de recorte severo`);
  if (severeCutDelta >= 1) sacrifices.push(`${Math.abs(severeCutDelta).toFixed(1)} meses más de recorte severo`);
  if (terminalP50Delta !== null && terminalP50Delta >= 10) gains.push(`${terminalP50Delta.toFixed(1)}% más de patrimonio final P50`);
  if (terminalP50Delta !== null && terminalP50Delta <= -10) sacrifices.push(`${Math.abs(terminalP50Delta).toFixed(1)}% menos de patrimonio final P50`);

  return {
    key,
    title,
    mixLabel: `RV ${alternative.source.rvPct} / RF ${alternative.source.rfPct}`,
    gains: gains.slice(0, 3),
    sacrifices: sacrifices.slice(0, 3),
    reading: 'Sirve como comparador preliminar técnico; no es la recomendación final del perfil.',
  };
}

function explainSpendingHeadroom(
  results: SpendingHeadroomMixResult[],
  winner: SpendingHeadroomMixCandidate | null,
): string {
  if (!results.length || !winner) return 'Primero ejecuta la holgura para comparar mixes bajo gasto mayor.';
  const winnerResult = results.find((item) => Math.abs(item.mix.rvPct - winner.rvPct) <= 0.05) ?? null;
  if (!winnerResult) return 'No hay suficientes datos para interpretar la holgura del mix recomendado.';
  const winnerBase = winnerResult.evaluations.find((item) => Math.abs(item.spendScale - 1) <= 1e-9) ?? null;
  const allCollapse = results.every((item) => (item.maxSpendScalePassingQoL ?? 0) <= 1);
  if (allCollapse) {
    return 'El gasto adicional reduce materialmente la calidad de vida en todos los mixes; conviene optimizar gasto formalmente en V3.';
  }
  const moreAggressiveWithHeadroom = results.find((item) => {
    if (item.mix.rvPct <= winner.rvPct + 5) return false;
    const base = item.evaluations.find((evaluation) => Math.abs(evaluation.spendScale - 1) <= 1e-9) ?? null;
    if (!base || !winnerBase) return false;
    const qasrGap = Math.abs((base.qasrStrict ?? -Infinity) - (winnerBase.qasrStrict ?? -Infinity));
    const csrGap = Math.abs((base.csr85_4 ?? -Infinity) - (winnerBase.csr85_4 ?? -Infinity));
    const headroomA = item.maxSpendScalePassingQoL ?? 0;
    const headroomB = winnerResult.maxSpendScalePassingQoL ?? 0;
    return qasrGap <= 0.005 + 1e-9 && csrGap <= 0.01 + 1e-9 && headroomA > headroomB + 0.09;
  });
  if (moreAggressiveWithHeadroom) {
    return 'Varios mixes son equivalentes en calidad base, pero el mix más agresivo ofrece mayor holgura de gasto y margen patrimonial.';
  }
  const winnerHeadroom = winnerResult.maxSpendScalePassingQoL ?? 0;
  const bestOtherHeadroom = Math.max(
    ...results
      .filter((item) => Math.abs(item.mix.rvPct - winner.rvPct) > 0.05)
      .map((item) => item.maxSpendScalePassingQoL ?? 0),
    0,
  );
  if (winnerHeadroom >= bestOtherHeadroom - 1e-9 && winnerHeadroom >= 1.2 - 1e-9) {
    return 'El mix conservador no solo maximiza calidad base, también sostiene mejor el aumento de gasto.';
  }
  return 'La prima de retorno ayuda, pero la holgura sigue dependiendo de cómo cada mix absorbe recortes y volatilidad bajo gasto mayor.';
}

function formatMixPair(mix: { rv: number; rf: number }): string {
  return `RV ${(mix.rv * 100).toFixed(1)}% / RF ${(mix.rf * 100).toFixed(1)}%`;
}

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

function summarizeRiskMix(params: ModelParameters): string {
  const rv = params.weights.rvGlobal + params.weights.rvChile;
  const rf = params.weights.rfGlobal + params.weights.rfChile;
  return `${Math.round(rv * 100)}/${Math.round(rf * 100)}`;
}

function hasRiskCapitalEnabled(params: ModelParameters): boolean {
  const risk = Number(params.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
  return Number.isFinite(risk) && risk > 0;
}

function buildDeltaSummary(baseParams: ModelParameters, candidateParams: ModelParameters): string {
  const deltas: string[] = [];
  const baseMix = summarizeRiskMix(baseParams);
  const candidateMix = summarizeRiskMix(candidateParams);
  if (baseMix !== candidateMix) deltas.push(`mix ${candidateMix}`);
  if (!approxEqual(baseParams.feeAnnual, candidateParams.feeAnnual)) {
    deltas.push(`fee ${formatPctValue(candidateParams.feeAnnual)}`);
  }
  if (baseParams.simulation.nSim !== candidateParams.simulation.nSim) {
    deltas.push(`nSim ${candidateParams.simulation.nSim}`);
  }
  const baseHouseEnabled = Boolean(baseParams.realEstatePolicy?.enabled);
  const candidateHouseEnabled = Boolean(candidateParams.realEstatePolicy?.enabled);
  if (baseHouseEnabled !== candidateHouseEnabled) {
    deltas.push(`venta de casa ${candidateHouseEnabled ? 'ON' : 'OFF'}`);
  }
  const baseRiskCapital = hasRiskCapitalEnabled(baseParams);
  const candidateRiskCapital = hasRiskCapitalEnabled(candidateParams);
  if (baseRiskCapital !== candidateRiskCapital) {
    deltas.push(`capital de riesgo ${candidateRiskCapital ? 'ON' : 'OFF'}`);
  }
  return deltas.length ? `Cambios vs base: ${deltas.join(' · ')}` : 'Sin cambios temporales respecto de la base vigente';
}

function assignScenarioIds(points: Phase1Point[]): Phase1Point[] {
  const sorted = [...points].sort((a, b) => a.rvPct - b.rvPct);
  return sorted.map((point, index) => ({
    ...point,
    scenarioId: String.fromCharCode(65 + index),
  }));
}

function pushUniqueRv(values: number[], rvPct: number) {
  const clamped = Math.max(PHASE1_SWEEP_MIN_RV, Math.min(PHASE1_SWEEP_MAX_RV, rvPct));
  if (!values.some((value) => Math.abs(value - clamped) <= 0.05)) values.push(clamped);
}

function toPhase1Point(rvPct: number, weights: PortfolioWeights, sim: SimulationResults, options?: { isCurrentMix?: boolean }): Phase1Point {
  const rvRounded = Number(rvPct.toFixed(1));
  const rfRounded = Number((100 - rvRounded).toFixed(1));
  return {
    rvPct: rvRounded,
    rfPct: rfRounded,
    success40: sim.success40 ?? (1 - (sim.probRuin40 ?? sim.probRuin)),
    ruin20: sim.probRuin20 ?? 0,
    ruinP10: Number.isFinite(sim.ruinTimingP10 ?? Number.NaN) ? (sim.ruinTimingP10 as number) : null,
    drawdownP50: sim.maxDrawdownPercentiles[50] ?? 0,
    terminalP50All: sim.p50TerminalAllPaths ?? null,
    terminalP50Survivors: sim.p50TerminalSurvivors ?? null,
    weights,
    isCurrentMix: options?.isCurrentMix ?? false,
  };
}

function toPhase2Point(source: Phase1Point, sim: SimulationResults): Phase2Point {
  return {
    source,
    success40Assisted: sim.success40 ?? (1 - (sim.probRuin40 ?? sim.probRuin)),
    ruin20Assisted: sim.probRuin20 ?? 0,
    houseSalePct: sim.houseSalePct ?? 0,
    houseSaleYearP50: Number.isFinite(sim.saleYearMedian ?? Number.NaN) ? (sim.saleYearMedian as number) : null,
    cutScenarioPct: Number.isFinite(sim.cutScenarioPct ?? Number.NaN) ? (sim.cutScenarioPct as number) : null,
    cutSeverityMean: Number.isFinite(sim.cutSeverityMean ?? Number.NaN) ? (sim.cutSeverityMean as number) : null,
    firstCutYearP50: Number.isFinite(sim.firstCutYearMedian ?? Number.NaN) ? (sim.firstCutYearMedian as number) : null,
    terminalP50All: sim.p50TerminalAllPaths ?? null,
    terminalP50Survivors: sim.p50TerminalSurvivors ?? null,
    drawdownP50: sim.maxDrawdownPercentiles[50] ?? 0,
    qualityCandidate: buildQualityOptimizationCandidate({
      id: `rv-${source.rvPct.toFixed(1)}`,
      rvWeight: source.rvPct / 100,
      rfWeight: source.rfPct / 100,
      result: sim,
    }),
  };
}

function toPhase2PointFromDecisionCandidate(candidate: RvRfDecisionCandidate, weights: PortfolioWeights): Phase2Point {
  const source: Phase1Point = {
    rvPct: candidate.rvPct,
    rfPct: candidate.rfPct,
    success40: candidate.ruinRate === null ? 0 : 1 - candidate.ruinRate,
    ruin20: candidate.ruinRate ?? 0,
    ruinP10: null,
    drawdownP50: 0,
    terminalP50All: candidate.terminalWealthP50,
    terminalP50Survivors: candidate.terminalWealthP50,
    weights,
  };
  return {
    source,
    success40Assisted: source.success40,
    ruin20Assisted: source.ruin20,
    houseSalePct: candidate.houseSaleRate ?? 0,
    houseSaleYearP50: null,
    cutScenarioPct: null,
    cutSeverityMean: candidate.monthsInSevereCutMean,
    firstCutYearP50: null,
    terminalP50All: candidate.terminalWealthP50,
    terminalP50Survivors: candidate.terminalWealthP50,
    drawdownP50: 0,
    qualityCandidate: {
      id: candidate.candidateId,
      rvWeight: candidate.rvPct / 100,
      rfWeight: candidate.rfPct / 100,
      qasrStrict: candidate.qasrBase,
      csr85_4: candidate.csrBase,
      classicSuccessRate: candidate.ruinRate === null ? null : 1 - candidate.ruinRate,
      monthsInSevereCutMean: candidate.monthsInSevereCutMean,
      maxConsecutiveSevereCutMonthsP75: candidate.maxConsecutiveSevereCutMonthsP75,
      terminalWealthP25: candidate.terminalWealthP25,
      terminalWealthP50: candidate.terminalWealthP50,
      houseSaleRate: candidate.houseSaleRate,
      warnings: [],
    },
  };
}

function buildAutonomousParams(params: ModelParameters): ModelParameters {
  const next = cloneParams(params);
  next.realEstatePolicy = {
    ...(next.realEstatePolicy ?? {
      enabled: false,
      triggerRunwayMonths: 36,
      saleDelayMonths: 12,
      saleCostPct: 0,
      realAppreciationAnnual: 0,
    }),
    enabled: false,
  };
  next.spendingRule = {
    ...next.spendingRule,
    // Neutralizacion controlada: mantenemos orden valido de floors,
    // pero usamos umbrales extremos para que no se activen en la practica.
    softCut: 0.999,
    hardCut: 0.998,
    dd15Threshold: 10,
    dd25Threshold: 10,
    consecutiveMonths: 999,
  };
  if (next.simulationComposition?.nonOptimizable?.riskCapital) {
    next.simulationComposition.nonOptimizable.riskCapital = {
      ...next.simulationComposition.nonOptimizable.riskCapital,
      totalCLP: 0,
      clp: 0,
      usd: 0,
      usdTotal: 0,
      source: 'autonomous_phase1_disabled',
    };
  }
  return next;
}

function buildShortlist(points: Phase1Point[]): Phase1Point[] {
  if (!points.length) return [];
  const currentPoint = points.find((point) => point.isCurrentMix) ?? null;
  const sorted = [...points].sort((a, b) => (
    (b.success40 - a.success40)
      || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
      || (a.ruin20 - b.ruin20)
      || (a.drawdownP50 - b.drawdownP50)
  ));
  const bestSuccess = sorted[0].success40;
  const candidatePool = sorted.filter((point) => point.success40 >= bestSuccess - SHORTLIST_BEST_SUCCESS_BAND);
  const shortlist: Phase1Point[] = [];

  for (const point of candidatePool) {
    if (shortlist.length >= SHORTLIST_TARGET) break;
    const hasNearbyMix = shortlist.some((chosen) => Math.abs(chosen.rvPct - point.rvPct) < SHORTLIST_MIN_RV_DISTANCE);
    if (!hasNearbyMix) shortlist.push(point);
  }

  if (shortlist.length < 3) {
    for (const point of sorted) {
      if (shortlist.length >= 3) break;
      const alreadyIncluded = shortlist.some((chosen) => chosen.rvPct === point.rvPct);
      if (!alreadyIncluded) shortlist.push(point);
    }
  }

  if (shortlist.length < SHORTLIST_TARGET) {
    for (const point of sorted) {
      if (shortlist.length >= SHORTLIST_TARGET) break;
      const alreadyIncluded = shortlist.some((chosen) => chosen.rvPct === point.rvPct);
      if (!alreadyIncluded) shortlist.push(point);
    }
  }

  if (currentPoint && !shortlist.some((point) => isSameMix(point, currentPoint))) {
    shortlist.push(currentPoint);
  }
  const phase1Decision = choosePhase1ChampionChallenger(points);
  [phase1Decision.champion, phase1Decision.challenger].forEach((point) => {
    if (point && !shortlist.some((candidate) => isSameMix(candidate, point))) {
      shortlist.push(point);
    }
  });

  return shortlist;
}

function buildRunMeta(params: ModelParameters, sourceLabel: string, phase: 'phase1' | 'phase2'): PhaseRunMeta {
  const phaseParams = phase === 'phase1' ? buildAutonomousParams(params) : cloneParams(params);
  const houseMode = phase === 'phase1'
    ? 'OFF'
    : phaseParams.realEstatePolicy?.enabled
      ? 'ON'
      : 'OFF';
  const cutsMode = phase === 'phase1'
    ? 'Neutralizados'
    : `Activos ${Math.round(phaseParams.spendingRule.softCut * 100)}/${Math.round(phaseParams.spendingRule.hardCut * 100)}`;
  const riskCapitalAmount = Number(phaseParams.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
  const riskCapitalMode = riskCapitalAmount > 0 ? 'ON' : 'OFF';
  const scenarioHash = hashJson({
    sourceLabel,
    phase,
    weights: phaseParams.weights,
    spendingPhases: phaseParams.spendingPhases,
    spendingRule: phaseParams.spendingRule,
    bucketMonths: phaseParams.bucketMonths,
    feeAnnual: phaseParams.feeAnnual,
    houseEnabled: phaseParams.realEstatePolicy?.enabled ?? false,
    houseTrigger: phaseParams.realEstatePolicy?.triggerRunwayMonths ?? null,
    riskCapital: riskCapitalAmount,
    nSim: phaseParams.simulation.nSim,
    seed: phaseParams.simulation.seed,
  });
  return {
    sourceLabel,
    nSim: phaseParams.simulation.nSim,
    seed: phaseParams.simulation.seed,
    feeAnnual: phaseParams.feeAnnual,
    bucketMonths: phaseParams.bucketMonths ?? 24,
    houseMode,
    cutsMode,
    riskCapitalMode,
    ranAtLabel: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    scenarioHash,
  };
}

function hasNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function isSameMix(a: Phase1Point, b: Phase1Point, epsilon = 0.05): boolean {
  return Math.abs(a.rvPct - b.rvPct) <= epsilon && Math.abs(a.rfPct - b.rfPct) <= epsilon;
}

function isSamePhase3Candidate(a: Phase3Candidate, b: Phase3Candidate): boolean {
  return isSameMix(a.baseRow.source, b.baseRow.source) && a.variant.id === b.variant.id;
}

function selectByMaterialityFloor(
  rows: Phase2Point[],
  value: (row: Phase2Point) => number,
  materiality: number,
): Phase2Point[] {
  if (rows.length <= 1) return rows;
  const best = rows.reduce((min, row) => Math.min(min, value(row)), Number.POSITIVE_INFINITY);
  return rows.filter((row) => (value(row) - best) <= materiality + 1e-9);
}

function selectByMaterialityCeiling(
  rows: Phase2Point[],
  value: (row: Phase2Point) => number,
  materiality: number,
): Phase2Point[] {
  if (rows.length <= 1) return rows;
  const best = rows.reduce((max, row) => Math.max(max, value(row)), Number.NEGATIVE_INFINITY);
  return rows.filter((row) => (best - value(row)) <= materiality + 1e-9);
}

function evaluatePhase2Competition(
  baseline: Phase2Point,
  candidate: Phase2Point,
): Phase2CompetitionDecision {
  const t = PHASE2_COMPETITION_THRESHOLDS;
  const autonomousGapPp = (baseline.source.success40 - candidate.source.success40) * 100;
  const eligibleAutonomous = autonomousGapPp <= t.autonomousEligibilityGapPp + 1e-9;
  const materialImprovements: string[] = [];
  const redFlags: string[] = [];

  if (((baseline.houseSalePct - candidate.houseSalePct) * 100) >= t.material.houseSalePctPpLower) {
    materialImprovements.push(`Venta de casa ${((baseline.houseSalePct - candidate.houseSalePct) * 100).toFixed(1)} pp menor`);
  }
  if (hasNumber(candidate.houseSaleYearP50) && hasNumber(baseline.houseSaleYearP50)
    && (candidate.houseSaleYearP50 - baseline.houseSaleYearP50) >= t.material.houseSaleYearLaterYears) {
    materialImprovements.push(`Venta de casa ${(candidate.houseSaleYearP50 - baseline.houseSaleYearP50).toFixed(1)} años más tarde`);
  }
  if (hasNumber(candidate.cutScenarioPct) && hasNumber(baseline.cutScenarioPct)
    && ((baseline.cutScenarioPct - candidate.cutScenarioPct) * 100) >= t.material.cutScenarioPctPpLower) {
    materialImprovements.push(`Escenarios con cuts ${((baseline.cutScenarioPct - candidate.cutScenarioPct) * 100).toFixed(1)} pp menor`);
  }
  if (hasNumber(candidate.cutSeverityMean) && hasNumber(baseline.cutSeverityMean)
    && ((baseline.cutSeverityMean - candidate.cutSeverityMean) * 100) >= t.material.cutSeverityPpLower) {
    materialImprovements.push(`Recorte medio ${((baseline.cutSeverityMean - candidate.cutSeverityMean) * 100).toFixed(1)} pp menor`);
  }
  if (hasNumber(candidate.firstCutYearP50) && hasNumber(baseline.firstCutYearP50)
    && (candidate.firstCutYearP50 - baseline.firstCutYearP50) >= t.material.firstCutYearLaterYears) {
    materialImprovements.push(`Primer cut ${(candidate.firstCutYearP50 - baseline.firstCutYearP50).toFixed(1)} años más tarde`);
  }
  if (((baseline.ruin20Assisted - candidate.ruin20Assisted) * 100) >= t.material.ruin20PpLower) {
    materialImprovements.push(`Ruina20 asistida ${((baseline.ruin20Assisted - candidate.ruin20Assisted) * 100).toFixed(1)} pp menor`);
  }
  if (((baseline.drawdownP50 - candidate.drawdownP50) * 100) >= t.material.maxDDP50PpLower) {
    materialImprovements.push(`MaxDD P50 ${((baseline.drawdownP50 - candidate.drawdownP50) * 100).toFixed(1)} pp menor`);
  }

  if (((baseline.success40Assisted - candidate.success40Assisted) * 100) >= t.redFlags.success40AssistedPpWorse) {
    redFlags.push(`Éxito40 asistido ${((baseline.success40Assisted - candidate.success40Assisted) * 100).toFixed(1)} pp peor`);
  }
  if (((candidate.houseSalePct - baseline.houseSalePct) * 100) >= t.redFlags.houseSalePctPpWorse) {
    redFlags.push(`Venta de casa ${((candidate.houseSalePct - baseline.houseSalePct) * 100).toFixed(1)} pp peor`);
  }
  if (hasNumber(candidate.cutScenarioPct) && hasNumber(baseline.cutScenarioPct)
    && ((candidate.cutScenarioPct - baseline.cutScenarioPct) * 100) >= t.redFlags.cutScenarioPctPpWorse) {
    redFlags.push(`Escenarios con cuts ${((candidate.cutScenarioPct - baseline.cutScenarioPct) * 100).toFixed(1)} pp peor`);
  }
  if (hasNumber(candidate.cutSeverityMean) && hasNumber(baseline.cutSeverityMean)
    && ((candidate.cutSeverityMean - baseline.cutSeverityMean) * 100) >= t.redFlags.cutSeverityPpWorse) {
    redFlags.push(`Recorte medio ${((candidate.cutSeverityMean - baseline.cutSeverityMean) * 100).toFixed(1)} pp peor`);
  }
  if (hasNumber(candidate.firstCutYearP50) && hasNumber(baseline.firstCutYearP50)
    && (baseline.firstCutYearP50 - candidate.firstCutYearP50) >= t.redFlags.firstCutYearEarlierYears) {
    redFlags.push(`Primer cut ${(baseline.firstCutYearP50 - candidate.firstCutYearP50).toFixed(1)} años más temprano`);
  }
  if (((candidate.ruin20Assisted - baseline.ruin20Assisted) * 100) >= t.redFlags.ruin20AssistedPpWorse) {
    redFlags.push(`Ruina20 asistida ${((candidate.ruin20Assisted - baseline.ruin20Assisted) * 100).toFixed(1)} pp peor`);
  }
  if (((candidate.drawdownP50 - baseline.drawdownP50) * 100) >= t.redFlags.maxDDP50PpWorse) {
    redFlags.push(`MaxDD P50 ${((candidate.drawdownP50 - baseline.drawdownP50) * 100).toFixed(1)} pp peor`);
  }

  const noRedFlags = redFlags.length === 0;
  const competesWithPhase1 = eligibleAutonomous
    && materialImprovements.length >= t.compete.minMaterialImprovements
    && noRedFlags;
  const displacesPhase1 = eligibleAutonomous
    && ((candidate.success40Assisted - baseline.success40Assisted) * 100) >= -t.displace.success40AssistedMaxWorsePp
    && materialImprovements.length >= t.displace.minMaterialImprovements
    && noRedFlags;

  const reasons: string[] = [];
  reasons.push(
    eligibleAutonomous
      ? `OK Elegibilidad autónoma: ${autonomousGapPp.toFixed(1)} pp vs baseline (<= ${t.autonomousEligibilityGapPp.toFixed(1)} pp)`
      : `NO Elegibilidad autónoma: ${autonomousGapPp.toFixed(1)} pp vs baseline (> ${t.autonomousEligibilityGapPp.toFixed(1)} pp)`,
  );
  if (materialImprovements.length) {
    reasons.push(...materialImprovements.slice(0, 3).map((reason) => `OK ${reason}`));
  } else {
    reasons.push('NO Sin mejoras materiales');
  }
  if (redFlags.length) {
    reasons.push(...redFlags.slice(0, 2).map((reason) => `NO ${reason}`));
  } else {
    reasons.push('OK Sin red flags');
  }

  return {
    baselineLabel: `RV ${baseline.source.rvPct}% / RF ${baseline.source.rfPct}%`,
    autonomousGapPp,
    eligibleAutonomous,
    materialImprovements,
    redFlags,
    competesWithPhase1,
    displacesPhase1,
    reasons,
  };
}

function choosePhase1Baseline(points: Phase1Point[]): Phase1Point | null {
  if (!points.length) return null;
  const ranking = [...points].sort((a, b) => (
    (b.success40 - a.success40)
      || (a.ruin20 - b.ruin20)
      || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
  ));
  const bestSuccess = ranking[0]?.success40 ?? null;
  if (bestSuccess === null) return ranking[0] ?? null;
  const plateau = ranking.filter((point) => ((bestSuccess - point.success40) * 100) <= (TECHNICAL_TIE_BAND_PP + 1e-9));
  if (plateau.length <= 1) return ranking[0] ?? null;
  const balanced = [...plateau].sort((a, b) => (
    (a.ruin20 - b.ruin20)
    || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
    || (a.drawdownP50 - b.drawdownP50)
    || (a.rvPct - b.rvPct)
  ));
  return balanced[0] ?? ranking[0] ?? null;
}

function choosePhase1ChampionChallenger(points: Phase1Point[]): Phase1ChampionChallenger {
  if (!points.length) {
    return {
      champion: null,
      challenger: null,
      deltaSuccessPp: null,
      materialityLabel: 'Sin Fase 1 calculada',
      currentIsChampion: false,
      message: 'Ejecuta Fase 1 para identificar campeón y retador.',
    };
  }

  const ranking = [...points].sort((a, b) => (
    (b.success40 - a.success40)
    || (a.ruin20 - b.ruin20)
    || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
    || (a.drawdownP50 - b.drawdownP50)
    || (a.rvPct - b.rvPct)
  ));
  const currentPoint = points.find((point) => point.isCurrentMix) ?? null;
  const technicalBest = ranking[0] ?? null;
  const champion = technicalBest;
  const currentIsChampion = Boolean(currentPoint && champion && isSameMix(currentPoint, champion));
  const challenger = currentIsChampion
    ? ranking.find((point) => champion && !isSameMix(point, champion)) ?? null
    : currentPoint ?? ranking.find((point) => champion && !isSameMix(point, champion)) ?? null;
  const deltaSuccessPp = champion && challenger ? (champion.success40 - challenger.success40) * 100 : null;
  const isMaterial = deltaSuccessPp !== null
    && Math.abs(deltaSuccessPp) >= optimizerPolicyConfig.phase1.materialitySuccessPp;
  const materialityLabel = deltaSuccessPp === null
    ? 'Sin retador comparable'
    : isMaterial ? 'Mejora material' : 'Mejora no material';
  const message = currentIsChampion
    ? 'El mix de la fuente activa sigue siendo el mejor resultado técnico en Fase 1. Se mantiene un retador para validación comparativa.'
    : 'Fase 1 propone un campeón técnico distinto y conserva el mix de la fuente activa como retador cuando está disponible.';

  return {
    champion,
    challenger,
    deltaSuccessPp,
    materialityLabel,
    currentIsChampion,
    message,
  };
}

function buildLongevityPlus5Params(baseParams: ModelParameters, weights: PortfolioWeights): ModelParameters {
  const next = cloneParams(baseParams);
  const baseHorizon = next.simulation.horizonMonths;
  const extendedHorizon = baseHorizon + 60;
  next.weights = cloneParams(weights);
  next.simulation = {
    ...next.simulation,
    horizonMonths: extendedHorizon,
  };

  // Supuesto explícito: los 5 años extra usan el gasto real de la última fase.
  const totalDuration = next.spendingPhases.reduce((sum, phase) => sum + phase.durationMonths, 0);
  const extraMonths = Math.max(0, extendedHorizon - totalDuration);
  if (extraMonths > 0 && next.spendingPhases.length > 0) {
    const lastIndex = next.spendingPhases.length - 1;
    const lastPhase = next.spendingPhases[lastIndex];
    next.spendingPhases = next.spendingPhases.map((phase, index) => (
      index === lastIndex
        ? { ...lastPhase, durationMonths: lastPhase.durationMonths + extraMonths }
        : phase
    ));
  }
  return next;
}

function phase3SuccessBand(bestSuccess: number): number {
  return optimizerPolicyConfig.phase3.successSacrificeBand.find((entry) => bestSuccess >= entry.minSuccess)?.band
    ?? optimizerPolicyConfig.phase3.successSacrificeBand[optimizerPolicyConfig.phase3.successSacrificeBand.length - 1].band;
}

function phase3PoolBand(bestSuccess: number): number {
  return optimizerPolicyConfig.phase3.poolEntryBand.find((entry) => bestSuccess >= entry.minSuccess)?.band
    ?? optimizerPolicyConfig.phase3.poolEntryBand[optimizerPolicyConfig.phase3.poolEntryBand.length - 1].band;
}

function getSpendingVector(params: ModelParameters): number[] {
  return PHASE3_QOL_WEIGHTS.map((_, index) => {
    const phase = params.spendingPhases[index] ?? params.spendingPhases[params.spendingPhases.length - 1];
    return Math.max(1, Number(phase?.amountReal ?? 1));
  });
}

function buildPhase3SpendingParams(
  baseParams: ModelParameters,
  weights: PortfolioWeights,
  variant: Phase3SpendingVariant,
): ModelParameters {
  const next = cloneParams(baseParams);
  next.weights = cloneParams(weights);
  next.spendingPhases = next.spendingPhases.map((phase, index) => (
    index < 4
      ? { ...phase, amountReal: phase.amountReal * (1 + variant.deltas[index]) }
      : phase
  ));
  return next;
}

function computeQualityOfLifeScore(baseVector: number[], candidateVector: number[]): number {
  return PHASE3_QOL_WEIGHTS.reduce((sum, weight, index) => {
    const base = Math.max(1, baseVector[index] ?? 1);
    const candidate = Math.max(0, candidateVector[index] ?? base);
    return sum + weight * (candidate / base);
  }, 0);
}

function buildPhase3GuardrailViolations(bestBase: Phase2Point, candidate: Phase3Candidate): string[] {
  const violations: string[] = [];
  if (candidate.ruin20 - bestBase.ruin20Assisted > PHASE3_GUARDRAILS.ruin20MaxWorse + 1e-9) {
    violations.push(`Ruina20 empeora ${formatSignedPp((candidate.ruin20 - bestBase.ruin20Assisted) * 100)}`);
  }
  if (
    hasNumber(candidate.cutScenarioPct)
    && hasNumber(bestBase.cutScenarioPct)
    && candidate.cutScenarioPct - bestBase.cutScenarioPct > PHASE3_GUARDRAILS.cutScenarioPctMaxWorse + 1e-9
  ) {
    violations.push(`Cuts empeoran ${formatSignedPp((candidate.cutScenarioPct - bestBase.cutScenarioPct) * 100)}`);
  }
  if (candidate.houseSalePct - bestBase.houseSalePct > PHASE3_GUARDRAILS.houseSalePctMaxWorse + 1e-9) {
    violations.push(`Venta casa empeora ${formatSignedPp((candidate.houseSalePct - bestBase.houseSalePct) * 100)}`);
  }
  if (candidate.drawdownP50 - bestBase.drawdownP50 > PHASE3_GUARDRAILS.maxDDP50MaxWorse + 1e-9) {
    violations.push(`MaxDD P50 empeora ${formatSignedPp((candidate.drawdownP50 - bestBase.drawdownP50) * 100)}`);
  }
  return violations;
}

type MixSwitchVerdict = {
  level: 'no' | 'considerar' | 'cambiar';
  label: string;
  detail: string;
  deltaSuccessPp: number;
  movePp: number;
  phase1DownsideImprovement: boolean;
  phase2MaterialImprovements: number;
};

function buildMixSwitchVerdict(
  currentPoint: Phase1Point,
  targetPoint: Phase1Point,
  currentPhase2Decision: Phase2CompetitionDecision | null,
  targetPhase2Decision: Phase2CompetitionDecision | null,
): MixSwitchVerdict {
  const t = MIX_COMPARISON_THRESHOLDS;
  const deltaSuccessPp = (targetPoint.success40 - currentPoint.success40) * 100;
  const movePp = Math.abs(targetPoint.rvPct - currentPoint.rvPct);
  if (isSameMix(currentPoint, targetPoint)) {
    return {
      level: 'no',
      label: 'Mantener mix actual',
      detail: 'El mix de la fuente activa ya es el campeón técnico de Fase 1.',
      deltaSuccessPp,
      movePp,
      phase1DownsideImprovement: false,
      phase2MaterialImprovements: 0,
    };
  }
  const phase1DownsideImprovement = (
    ((currentPoint.ruin20 - targetPoint.ruin20) * 100) >= t.ruin20PpImprovement
    || ((targetPoint.ruinP10 ?? Number.NEGATIVE_INFINITY) - (currentPoint.ruinP10 ?? Number.NEGATIVE_INFINITY)) >= t.ruinP10YearsImprovement
    || ((currentPoint.drawdownP50 - targetPoint.drawdownP50) * 100) >= t.maxDDP50PpImprovement
  );
  const phase2MaterialImprovements = Math.max(
    0,
    (targetPhase2Decision?.materialImprovements.length ?? 0) - (currentPhase2Decision?.materialImprovements.length ?? 0),
  );
  const hasDownsideImprovement = phase1DownsideImprovement || phase2MaterialImprovements > 0;

  if (deltaSuccessPp > t.successPpStrongMin || phase2MaterialImprovements >= 2) {
    return {
      level: 'cambiar',
      label: 'Vale la pena cambiar',
      detail: phase2MaterialImprovements >= 2
        ? 'Mejora material en varias métricas de costo/downside'
        : 'Mejora fuerte en Success40',
      deltaSuccessPp,
      movePp,
      phase1DownsideImprovement,
      phase2MaterialImprovements,
    };
  }
  if ((deltaSuccessPp >= t.successPpConsiderMin && deltaSuccessPp <= t.successPpStrongMin) || hasDownsideImprovement) {
    return {
      level: 'considerar',
      label: 'Vale la pena considerar',
      detail: hasDownsideImprovement ? 'También mejora downside/costo de supervivencia' : 'Mejora moderada en Success40',
      deltaSuccessPp,
      movePp,
      phase1DownsideImprovement,
      phase2MaterialImprovements,
    };
  }
  return {
    level: 'no',
    label: 'No vale la pena cambiar',
    detail: 'La mejora es marginal y sin mejora material de downside/costo',
    deltaSuccessPp,
    movePp,
    phase1DownsideImprovement,
    phase2MaterialImprovements,
  };
}

function renderRunMeta(meta: PhaseRunMeta, stale: boolean): React.ReactNode {
  return (
    <div
      style={{
        background: stale ? 'rgba(255, 176, 32, 0.10)' : T.surfaceEl,
        border: `1px solid ${stale ? 'rgba(255, 176, 32, 0.35)' : T.border}`,
        borderRadius: 10,
        padding: '8px 10px',
        display: 'grid',
        gap: 3,
      }}
    >
      <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
        {stale ? 'Resultados desactualizados: vuelve a ejecutar' : 'Resultados calculados con la fuente actual'}
      </div>
      <div style={{ color: T.textMuted, fontSize: 10 }}>
        {`${meta.sourceLabel} · nSim ${meta.nSim} · seed ${meta.seed} · fee ${formatPctValue(meta.feeAnnual)} · bucket ${meta.bucketMonths}m`}
      </div>
      <div style={{ color: T.textMuted, fontSize: 10 }}>
        {`house ${meta.houseMode} · cuts ${meta.cutsMode} · risk capital ${meta.riskCapitalMode} · ${meta.ranAtLabel} · hash ${meta.scenarioHash}`}
      </div>
    </div>
  );
}

export function OptimizationLightPage({
  baseParams,
  simulationParams,
  simulationActive,
  simulationLabel,
  simulationSnapshot = null,
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
  simulationSnapshot?: OptimizationSimulationSnapshot;
}) {
  const [mode, setMode] = useState<OptimizationMode>('light');
  const [sourceMode, setSourceMode] = useState<SourceMode>(simulationActive ? 'simulation' : 'base');
  const [phase1Running, setPhase1Running] = useState(false);
  const [phase2Running, setPhase2Running] = useState(false);
  const [phase1Points, setPhase1Points] = useState<Phase1Point[]>([]);
  const [shortlist, setShortlist] = useState<Phase1Point[]>([]);
  const [phase2Rows, setPhase2Rows] = useState<Phase2Point[]>([]);
  const [phase1Meta, setPhase1Meta] = useState<PhaseRunMeta | null>(null);
  const [phase1Diagnostics, setPhase1Diagnostics] = useState<Phase1Diagnostics | null>(null);
  const [phase1SlowNotice, setPhase1SlowNotice] = useState<string | null>(null);
  const [phase2Meta, setPhase2Meta] = useState<PhaseRunMeta | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [longevityOpen, setLongevityOpen] = useState(false);
  const [longevityRunning, setLongevityRunning] = useState(false);
  const [longevityResult, setLongevityResult] = useState<LongevityPlus5Result | null>(null);
  const [longevityError, setLongevityError] = useState<string | null>(null);
  const [implementationRunning, setImplementationRunning] = useState(false);
  const [implementationPlan, setImplementationPlan] = useState<InstrumentImplementationPlan | null>(null);
  const [implementationError, setImplementationError] = useState<string | null>(null);
  const [finalImplementationRunning, setFinalImplementationRunning] = useState(false);
  const [finalImplementationPlan, setFinalImplementationPlan] = useState<InstrumentImplementationPlan | null>(null);
  const [finalImplementationError, setFinalImplementationError] = useState<string | null>(null);
  const [finalImplementationNote, setFinalImplementationNote] = useState<string | null>(null);
  const [realisticValidationRunning, setRealisticValidationRunning] = useState(false);
  const [realisticValidation, setRealisticValidation] = useState<RealisticValidationResult | null>(null);
  const [realisticValidationError, setRealisticValidationError] = useState<string | null>(null);
  const [phase3Running, setPhase3Running] = useState(false);
  const [phase3Result, setPhase3Result] = useState<Phase3Result | null>(null);
  const [phase3Error, setPhase3Error] = useState<string | null>(null);
  const [sensitivityRunning, setSensitivityRunning] = useState(false);
  const [sensitivityResults, setSensitivityResults] = useState<SensitivityScenarioResult[]>([]);
  const [sensitivityError, setSensitivityError] = useState<string | null>(null);
  const [spendingHeadroomRunning, setSpendingHeadroomRunning] = useState(false);
  const [spendingHeadroomResults, setSpendingHeadroomResults] = useState<SpendingHeadroomMixResult[]>([]);
  const [spendingHeadroomError, setSpendingHeadroomError] = useState<string | null>(null);
  const [decisionProfilesRunning, setDecisionProfilesRunning] = useState(false);
  const [decisionProfilesTables, setDecisionProfilesTables] = useState<DecisionProfilesScenarioTable[]>([]);
  const [decisionProfilesError, setDecisionProfilesError] = useState<string | null>(null);
  const [decisionFlowStatus, setDecisionFlowStatus] = useState<DecisionFlowStatus | null>(null);
  const [decisionProgress, setDecisionProgress] = useState<DecisionProgress | null>(null);
  const [decisionResultMeta, setDecisionResultMeta] = useState<OptimizationResultMeta | null>(null);
  const [decisionCancelRequested, setDecisionCancelRequested] = useState(false);
  const [decisionFlowWarning, setDecisionFlowWarning] = useState<string | null>(null);
  const [decisionDiagnosticTrace, setDecisionDiagnosticTrace] = useState<OptimizationDecisionTrace | null>(null);
  const [decisionExecutionState, setDecisionExecutionState] = useState<DecisionExecutionState>('idle');
  const [decisionBackgroundHint, setDecisionBackgroundHint] = useState<string | null>(null);
  const [technicalDiagnosticsOpen, setTechnicalDiagnosticsOpen] = useState(false);
  const [lastExpressCandidate, setLastExpressCandidate] = useState<RvRfDecisionCandidate | null>(null);
  const [lastZoomCandidate, setLastZoomCandidate] = useState<RvRfDecisionCandidate | null>(null);
  const [lastConfirmedCandidate, setLastConfirmedCandidate] = useState<RvRfDecisionCandidate | null>(null);
  const [lastRenderableCandidate, setLastRenderableCandidate] = useState<RvRfDecisionCandidate | null>(null);
  const [lastRenderableKind, setLastRenderableKind] = useState<'official' | 'contingency' | null>(null);
  const [implementationMeta, setImplementationMeta] = useState<OptimizationResultMeta | null>(null);
  const [finalImplementationMeta, setFinalImplementationMeta] = useState<OptimizationResultMeta | null>(null);
  const [realisticValidationMeta, setRealisticValidationMeta] = useState<OptimizationResultMeta | null>(null);
  const decisionCancelRequestedRef = React.useRef(false);
  const decisionForceInterruptRef = React.useRef(false);
  const decisionProgressHeartbeatRef = React.useRef<number>(Date.now());
  const decisionLastEvaluatedRef = React.useRef<number>(0);
  const decisionResumeActionRef = React.useRef<'profiles' | 'confirmation' | null>(null);
  const decisionRunTokenRef = React.useRef(0);
  const activeDecisionFingerprintRef = React.useRef<string>('');

  const decisionYield = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    await new Promise<void>((resolve) => window.setTimeout(resolve, hidden ? 16 : 0));
  }, []);

  const shouldAbortDecisionRun = useCallback(
    () => decisionCancelRequestedRef.current || decisionForceInterruptRef.current,
    [],
  );

  const effectiveSourceMode: SourceMode = sourceMode === 'simulation' && simulationActive ? 'simulation' : 'base';
  const activeParams = effectiveSourceMode === 'simulation' ? simulationParams : baseParams;
  const activeSourceLabel = effectiveSourceMode === 'simulation' ? 'Simulación activa' : 'Base vigente';
  const activeScenarioLabel = effectiveSourceMode === 'simulation'
    ? (simulationLabel ?? scenarioVariantLabel(activeParams.activeScenario))
    : null;
  const sourceDescription = effectiveSourceMode === 'simulation'
    ? 'Simulación activa: usa los cambios temporales que estás probando'
    : 'Base vigente: usa la configuración persistida del caso';
  const sourceDeltaSummary = effectiveSourceMode === 'simulation'
    ? buildDeltaSummary(baseParams, simulationParams)
    : 'Sin cambios temporales respecto de la base vigente';
  const simulationSourceDisabledReason = simulationActive
    ? null
    : 'Simulación activa no disponible: primero valida o recalcula Simulación.';
  const activeOptimizationInputFingerprint = useMemo(
    () => buildOptimizationInputFingerprint({
      sourceMode: effectiveSourceMode,
      sourceLabel: activeSourceLabel,
      params: activeParams,
    }),
    [activeParams, activeSourceLabel, effectiveSourceMode],
  );
  const expectedPhase1Hash = useMemo(
    () => buildRunMeta(activeParams, activeSourceLabel, 'phase1').scenarioHash,
    [activeParams, activeSourceLabel],
  );
  const expectedPhase2Hash = useMemo(
    () => buildRunMeta(activeParams, activeSourceLabel, 'phase2').scenarioHash,
    [activeParams, activeSourceLabel],
  );
  const phase1IsStale = Boolean(phase1Meta && phase1Meta.scenarioHash !== expectedPhase1Hash);
  const phase2IsStale = Boolean(phase2Meta && phase2Meta.scenarioHash !== expectedPhase2Hash);
  const decisionFlowIsCurrent = decisionFlowStatus === null || decisionFlowStatus.inputFingerprint === activeOptimizationInputFingerprint;
  const decisionProgressIsCurrent = decisionProgress === null || decisionProgress.inputFingerprint === activeOptimizationInputFingerprint;
  const decisionResultIsCurrent = isOptimizationResultMetaCurrent(decisionResultMeta, activeOptimizationInputFingerprint);
  const implementationResultIsCurrent = isOptimizationResultMetaCurrent(implementationMeta, activeOptimizationInputFingerprint);
  const finalImplementationIsCurrent = isOptimizationResultMetaCurrent(finalImplementationMeta, activeOptimizationInputFingerprint);
  const realisticValidationIsCurrent = isOptimizationResultMetaCurrent(realisticValidationMeta, activeOptimizationInputFingerprint);
  const decisionResultIsStale = hasStaleOptimizationMeta(decisionResultMeta, activeOptimizationInputFingerprint);
  const implementationResultIsStale = hasStaleOptimizationMeta(implementationMeta, activeOptimizationInputFingerprint);
  const finalImplementationIsStale = hasStaleOptimizationMeta(finalImplementationMeta, activeOptimizationInputFingerprint);
  const realisticValidationIsStale = hasStaleOptimizationMeta(realisticValidationMeta, activeOptimizationInputFingerprint);

  useEffect(() => {
    activeDecisionFingerprintRef.current = activeOptimizationInputFingerprint;
  }, [activeOptimizationInputFingerprint]);

  useEffect(() => {
    if (sourceMode === 'simulation' && !simulationActive) {
      setSourceMode('base');
    }
  }, [simulationActive, sourceMode]);

  const resetDecisionFlowArtifacts = useCallback(() => {
    setDecisionProfilesRunning(false);
    setImplementationPlan(null);
    setImplementationError(null);
    setImplementationMeta(null);
    setFinalImplementationPlan(null);
    setFinalImplementationError(null);
    setFinalImplementationNote(null);
    setFinalImplementationMeta(null);
    setRealisticValidation(null);
    setRealisticValidationError(null);
    setRealisticValidationMeta(null);
    setPhase3Result(null);
    setPhase3Error(null);
    setSensitivityResults([]);
    setSensitivityError(null);
    setSpendingHeadroomResults([]);
    setSpendingHeadroomError(null);
    setDecisionProfilesTables([]);
    setDecisionProfilesError(null);
    setDecisionFlowStatus(null);
    setDecisionProgress(null);
    setDecisionResultMeta(null);
    setDecisionCancelRequested(false);
    decisionCancelRequestedRef.current = false;
    decisionForceInterruptRef.current = false;
    setDecisionExecutionState('idle');
    setDecisionBackgroundHint(null);
    setDecisionFlowWarning(null);
  }, []);

  const buildDecisionRunContext = useCallback((): DecisionRunContext => {
    const runToken = decisionRunTokenRef.current + 1;
    decisionRunTokenRef.current = runToken;
    return {
      runToken,
      inputFingerprint: activeOptimizationInputFingerprint,
      sourceMode: effectiveSourceMode,
      sourceLabel: activeSourceLabel,
      scenarioLabel: activeScenarioLabel,
    };
  }, [activeOptimizationInputFingerprint, activeScenarioLabel, activeSourceLabel, effectiveSourceMode]);

  const isDecisionRunContextCurrent = useCallback((context: DecisionRunContext): boolean => (
    decisionRunTokenRef.current === context.runToken
    && activeDecisionFingerprintRef.current === context.inputFingerprint
  ), []);

  useEffect(() => {
    const stalePhase1 = phase1Meta && phase1Meta.scenarioHash !== expectedPhase1Hash;
    const stalePhase2 = phase2Meta && phase2Meta.scenarioHash !== expectedPhase2Hash;
    if (!stalePhase1 && !stalePhase2) return;
    setStaleNotice('Resultados desactualizados: cambió la fuente o el escenario. Vuelve a ejecutar.');
    setLongevityResult(null);
    setLongevityError(null);
    resetDecisionFlowArtifacts();
    if (stalePhase1) {
      setPhase1Points([]);
      setShortlist([]);
      setPhase1Meta(null);
      setPhase1Diagnostics(null);
      setPhase1SlowNotice(null);
    }
    if (stalePhase2 || stalePhase1) {
      setPhase2Rows([]);
      setPhase2Meta(null);
    }
  }, [expectedPhase1Hash, expectedPhase2Hash, phase1Meta, phase2Meta, resetDecisionFlowArtifacts]);

  useEffect(() => {
    if (
      decisionFlowStatus === null
      && decisionProgress === null
      && decisionResultMeta === null
      && implementationMeta === null
      && finalImplementationMeta === null
      && realisticValidationMeta === null
    ) {
      return;
    }
    if (
      decisionProfilesRunning
      && decisionFlowIsCurrent
      && decisionProgressIsCurrent
      && !decisionResultIsStale
      && !implementationResultIsStale
      && !finalImplementationIsStale
      && !realisticValidationIsStale
    ) {
      return;
    }
    if (
      decisionFlowIsCurrent
      && decisionProgressIsCurrent
      && !decisionResultIsStale
      && !implementationResultIsStale
      && !finalImplementationIsStale
      && !realisticValidationIsStale
    ) {
      return;
    }
    decisionRunTokenRef.current += 1;
    decisionForceInterruptRef.current = true;
    const previousSourceLabel = decisionResultMeta?.sourceLabel
      ?? implementationMeta?.sourceLabel
      ?? finalImplementationMeta?.sourceLabel
      ?? realisticValidationMeta?.sourceLabel
      ?? decisionFlowStatus?.sourceLabel
      ?? 'fuente anterior';
    setStaleNotice(`Resultado anterior: calculado con ${previousSourceLabel}. Cambió la fuente/input. Vuelve a ejecutar.`);
    resetDecisionFlowArtifacts();
  }, [
    decisionFlowIsCurrent,
    decisionProfilesRunning,
    decisionFlowStatus,
    decisionProgress,
    decisionProgressIsCurrent,
    decisionResultIsCurrent,
    decisionResultIsStale,
    decisionResultMeta,
    finalImplementationIsCurrent,
    finalImplementationIsStale,
    finalImplementationMeta,
    implementationMeta,
    implementationResultIsCurrent,
    implementationResultIsStale,
    realisticValidationIsCurrent,
    realisticValidationIsStale,
    realisticValidationMeta,
    resetDecisionFlowArtifacts,
  ]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (!decisionProfilesRunning) return;
      if (document.hidden) {
        setDecisionExecutionState('background');
        setDecisionBackgroundHint('Cálculo en segundo plano · puede avanzar más lento.');
        return;
      }
      setDecisionExecutionState('restarting');
      setDecisionBackgroundHint('Reanudando y verificando progreso real…');
      decisionProgressHeartbeatRef.current = Date.now();
      window.setTimeout(() => {
        if (!decisionProfilesRunning) return;
        if (decisionForceInterruptRef.current || decisionCancelRequestedRef.current) return;
        setDecisionExecutionState('running');
        setDecisionBackgroundHint(null);
      }, 220);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [decisionProfilesRunning]);

  useEffect(() => {
    if (!decisionProfilesRunning) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const stalledMs = Date.now() - decisionProgressHeartbeatRef.current;
      if (stalledMs < 15_000) return;
      decisionForceInterruptRef.current = true;
      setDecisionExecutionState('interrupted');
      setDecisionBackgroundHint(null);
      setDecisionFlowWarning('Cálculo pausado/interrumpido. Puedes reanudar desde esta etapa o reiniciar el cálculo.');
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [decisionProfilesRunning]);

  const runPhase1 = useCallback(async () => {
    if (phase1Running) return;
    const runId = (phase1Diagnostics?.runId ?? 0) + 1;
    const startedAt = performance.now();
    let slowTimer: number | null = null;
    setPhase1Running(true);
    setStaleNotice(null);
    setPhase1Diagnostics(null);
    setPhase1SlowNotice(null);
    setPhase1Points([]);
    setShortlist([]);
    setPhase2Rows([]);
    setLongevityResult(null);
    setLongevityError(null);
    setImplementationPlan(null);
    setImplementationError(null);
    setFinalImplementationPlan(null);
    setFinalImplementationError(null);
      setFinalImplementationNote(null);
      setRealisticValidation(null);
      setRealisticValidationError(null);
      setPhase3Result(null);
      setPhase3Error(null);
      setSensitivityResults([]);
      setSensitivityError(null);
      setSpendingHeadroomResults([]);
      setSpendingHeadroomError(null);
      setDecisionProfilesTables([]);
      setDecisionProfilesError(null);
      try {
      // Permite pintar feedback de loading inmediatamente antes del trabajo pesado.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      slowTimer = window.setTimeout(() => {
        setPhase1SlowNotice('Fase 1 sigue procesando: sweep grueso + refinamiento local acotado.');
      }, PHASE1_SLOW_NOTICE_MS);
      const autonomousBase = buildAutonomousParams(activeParams);
      const pointMap = new Map<string, Phase1Point>();
      const counts = {
        coarseEvaluations: 0,
        currentEvaluations: 0,
        local25Evaluations: 0,
        micro10Evaluations: 0,
      };
      let capReached = false;
      const totalEvaluations = () => (
        counts.coarseEvaluations
        + counts.currentEvaluations
        + counts.local25Evaluations
        + counts.micro10Evaluations
      );
      const evaluateRv = (
        rvPct: number,
        stage: 'coarseEvaluations' | 'currentEvaluations' | 'local25Evaluations' | 'micro10Evaluations',
        options?: { isCurrentMix?: boolean },
      ) => {
        const normalizedRv = Math.max(PHASE1_SWEEP_MIN_RV, Math.min(PHASE1_SWEEP_MAX_RV, rvPct));
        const key = normalizedRv.toFixed(2);
        const existing = pointMap.get(key);
        if (existing) {
          if (options?.isCurrentMix) existing.isCurrentMix = true;
          return existing;
        }
        if (totalEvaluations() >= PHASE1_MAX_EVALUATIONS) {
          capReached = true;
          return null;
        }
        const candidate = cloneParams(autonomousBase);
        const nextWeights = options?.isCurrentMix
          ? cloneParams(autonomousBase.weights)
          : buildRvRfCandidateWeights(autonomousBase.weights, normalizedRv);
        candidate.weights = nextWeights;
        const sim = runSimulationCentral(candidate);
        const point = toPhase1Point(normalizedRv, nextWeights, sim, options);
        pointMap.set(key, point);
        counts[stage] += 1;
        return point;
      };
      for (let rvPct = PHASE1_SWEEP_MIN_RV; rvPct <= PHASE1_SWEEP_MAX_RV; rvPct += PHASE1_SWEEP_STEP) {
        evaluateRv(rvPct, 'coarseEvaluations');
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      const currentRvPct = (autonomousBase.weights.rvGlobal + autonomousBase.weights.rvChile) * 100;
      evaluateRv(currentRvPct, 'currentEvaluations', { isCurrentMix: true });

      const coarseRanking = [...pointMap.values()].sort((a, b) => (
        (b.success40 - a.success40) || (a.ruin20 - b.ruin20) || (a.rvPct - b.rvPct)
      ));
      const localCenters: number[] = [];
      pushUniqueRv(localCenters, currentRvPct);
      coarseRanking.slice(0, 3).forEach((point) => pushUniqueRv(localCenters, point.rvPct));
      const localRefinedPoints: Phase1Point[] = [];
      for (const center of localCenters) {
        if (localCenters.indexOf(center) >= PHASE1_LOCAL_REFINEMENT_BASE_LIMIT) break;
        [center - 2.5, center + 2.5].forEach((rvPct) => {
          const point = evaluateRv(rvPct, 'local25Evaluations');
          if (point) localRefinedPoints.push(point);
        });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }

      const localRanking = (localRefinedPoints.length ? localRefinedPoints : [...pointMap.values()]).sort((a, b) => (
        (b.success40 - a.success40) || (a.ruin20 - b.ruin20) || (a.rvPct - b.rvPct)
      ));
      localRanking.slice(0, PHASE1_MICRO_REFINEMENT_BASE_LIMIT).forEach((point) => {
        [point.rvPct - 1, point.rvPct + 1].forEach((rvPct) => evaluateRv(rvPct, 'micro10Evaluations'));
      });

      const points = assignScenarioIds([...pointMap.values()]);
      const matchedCurrent = points.find((point) => Math.abs(point.rvPct - currentRvPct) <= 0.05);
      if (matchedCurrent) {
        matchedCurrent.isCurrentMix = true;
      }
      setPhase1Points(points);
      setShortlist(buildShortlist(points));
      setPhase1Meta(buildRunMeta(activeParams, activeSourceLabel, 'phase1'));
      const diagnostics: Phase1Diagnostics = {
        runId,
        ...counts,
        totalEvaluations: totalEvaluations(),
        elapsedMs: Math.round(performance.now() - startedAt),
        capReached,
        cap: PHASE1_MAX_EVALUATIONS,
      };
      setPhase1Diagnostics(diagnostics);
      if (capReached) {
        setPhase1SlowNotice('Se alcanzó el límite de refinamiento para mantener rendimiento.');
      }
      console.info('[MIDAS][phase1-diagnostics]', diagnostics);
      setPhase2Rows([]);
      setPhase2Meta(null);
    } finally {
      if (slowTimer !== null) window.clearTimeout(slowTimer);
      setPhase1Running(false);
    }
  }, [activeParams, activeSourceLabel, phase1Diagnostics?.runId, phase1Running]);

  const runPhase2 = useCallback(async () => {
    if (phase2Running || !phase1Points.length) return;
    setPhase2Running(true);
    setStaleNotice(null);
    setPhase2Rows([]);
    setLongevityResult(null);
    setLongevityError(null);
    setImplementationPlan(null);
    setImplementationError(null);
    setFinalImplementationPlan(null);
    setFinalImplementationError(null);
    setFinalImplementationNote(null);
    setRealisticValidation(null);
    setRealisticValidationError(null);
    setPhase3Result(null);
    setPhase3Error(null);
    setSensitivityResults([]);
    setSensitivityError(null);
    setSpendingHeadroomResults([]);
    setSpendingHeadroomError(null);
    setDecisionProfilesTables([]);
    setDecisionProfilesError(null);
    try {
      // Permite pintar feedback de loading inmediatamente antes del trabajo pesado.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const baselinePoint = choosePhase1Baseline(phase1Points);
      const currentPoint = phase1Points.find((point) => point.isCurrentMix) ?? null;
      const evaluationPoints = [...phase1Points];
      if (baselinePoint) {
        const baselineIncluded = evaluationPoints.some((point) => isSameMix(point, baselinePoint));
        if (!baselineIncluded) evaluationPoints.push(baselinePoint);
      }
      if (currentPoint) {
        const currentIncluded = evaluationPoints.some((point) => isSameMix(point, currentPoint));
        if (!currentIncluded) evaluationPoints.push(currentPoint);
      }
      const rows: Phase2Point[] = [];
      for (const point of evaluationPoints) {
        const assistedParams = cloneParams(activeParams);
        assistedParams.weights = point.weights;
        const sim = runSimulationCentral(assistedParams);
        rows.push(toPhase2Point(point, sim));
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      setPhase2Rows(rows);
      setPhase2Meta(buildRunMeta(activeParams, activeSourceLabel, 'phase2'));
    } finally {
      setPhase2Running(false);
    }
  }, [activeParams, activeSourceLabel, phase1Points, phase2Running]);

  const runSensitivity = useCallback(async () => {
    if (sensitivityRunning || !phase2Rows.length) return;
    setSensitivityRunning(true);
    setSensitivityError(null);
    setSensitivityResults([]);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const results: SensitivityScenarioResult[] = [];
      for (const scenario of RV_RF_PREMIUM_SENSITIVITY_SCENARIOS) {
        const { params: scenarioParams, warnings } = applyRvRfPremiumSensitivity(activeParams, scenario);
        const rows: Phase2Point[] = [];
        for (const point of phase2Rows) {
          const candidateParams = cloneParams(scenarioParams);
          candidateParams.weights = cloneParams(point.source.weights);
          const sim = runSimulationCentral(candidateParams);
          rows.push(toPhase2Point(point.source, sim));
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        const ranked = [...rows].sort((a, b) => compareQualityOptimizationCandidates(a.qualityCandidate, b.qualityCandidate));
        const picked = pickSensitivityWinner(ranked.map((row) => row.qualityCandidate));
        const winner = picked.winner
          ? ranked.find((row) => row.qualityCandidate.id === picked.winner?.id) ?? null
          : null;
        const diagnosticRows: OptimizationDiagnosticRow[] = rows.map((row) => ({
          id: row.qualityCandidate.id,
          rvPct: row.source.rvPct,
          rfPct: row.source.rfPct,
          weights: row.source.weights,
          qasrStrict: row.qualityCandidate.qasrStrict,
          csr85_4: row.qualityCandidate.csr85_4,
          classicSuccessRate: row.qualityCandidate.classicSuccessRate,
          monthsInSevereCutMean: row.qualityCandidate.monthsInSevereCutMean,
          maxConsecutiveSevereCutMonthsP75: row.qualityCandidate.maxConsecutiveSevereCutMonthsP75,
          terminalWealthP25: row.qualityCandidate.terminalWealthP25,
          terminalWealthP50: row.qualityCandidate.terminalWealthP50,
          houseSaleRate: row.qualityCandidate.houseSaleRate,
        }));
        results.push({
          scenario,
          winner,
          frontier: buildOptimizationFrontierDiagnostics(
            scenarioParams,
            diagnosticRows,
            winner
              ? diagnosticRows.find((row) => row.id === winner.qualityCandidate.id) ?? null
              : null,
          ),
          warnings: [...warnings, ...picked.warnings],
        });
      }
      setSensitivityResults(results);
    } catch (error) {
      setSensitivityError(error instanceof Error ? error.message : String(error));
    } finally {
      setSensitivityRunning(false);
    }
  }, [activeParams, phase2Rows, sensitivityRunning]);

  async function runSpendingHeadroom() {
    const mixes = buildSpendingHeadroomCandidates(phase2Rows, phase2CurrentRow, phase2QualityWinner);
    if (spendingHeadroomRunning || !mixes.length) return;
    setSpendingHeadroomRunning(true);
    setSpendingHeadroomError(null);
    setSpendingHeadroomResults([]);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const results: SpendingHeadroomMixResult[] = [];
      for (const mix of mixes) {
        const evaluations: SpendingHeadroomEvaluationResult[] = [];
        for (const spendScale of SPENDING_HEADROOM_SCALES) {
          const candidateParams = applyTemporarySpendScale(activeParams, spendScale);
          candidateParams.weights = cloneParams(mix.weights);
          const sim = runSimulationCentral(candidateParams);
          const candidate = buildQualityOptimizationCandidate({
            id: mix.candidateId,
            rvWeight: mix.rvPct / 100,
            rfWeight: mix.rfPct / 100,
            result: sim,
          });
          const rvReal = mix.weights.rvGlobal + mix.weights.rvChile;
          const rfReal = mix.weights.rfGlobal + mix.weights.rfChile;
          evaluations.push({
            spendScale,
            spendLabel: formatSpendScaleLabel(spendScale),
            candidateId: mix.candidateId,
            resultKey: hashJson({
              candidateId: mix.candidateId,
              spendScale,
              weights: mix.weights,
              spendingPhases: candidateParams.spendingPhases,
            }),
            rvReal,
            rfReal,
            rvGlobal: mix.weights.rvGlobal,
            rvChile: mix.weights.rvChile,
            rfGlobal: mix.weights.rfGlobal,
            rfChile: mix.weights.rfChile,
            qasrStrict: candidate.qasrStrict,
            csr85_4: candidate.csr85_4,
            classicSuccessRate: candidate.classicSuccessRate,
            probRuin: sim.probRuin40 ?? sim.probRuin,
            monthsInSevereCutMean: candidate.monthsInSevereCutMean,
            maxConsecutiveSevereCutMonthsP75: candidate.maxConsecutiveSevereCutMonthsP75,
            terminalWealthP25: candidate.terminalWealthP25,
            terminalWealthP50: candidate.terminalWealthP50,
            houseSaleRate: candidate.houseSaleRate,
            severeCutMonthsDuringHouseSaleMedian: sim.qualityOfLifeMetrics?.severeCutMonthsDuringHouseSaleMedian ?? null,
          });
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        results.push({
          mix,
          evaluations,
          maxSpendScalePassingQoL: computeMaxSpendScalePassingQoL(evaluations),
        });
      }
      setSpendingHeadroomResults(results.sort((a, b) => a.mix.rvPct - b.mix.rvPct));
    } catch (error) {
      setSpendingHeadroomError(error instanceof Error ? error.message : String(error));
    } finally {
      setSpendingHeadroomRunning(false);
    }
  }

  async function evaluateDecisionProfilesStage(input: {
    stage: Exclude<DecisionFlowStage, 'idle'>;
    badge: string;
    message: string;
    nSim: number;
    stepPp: number | null;
    rvCandidates: number[];
    implementationEnabled: boolean;
    runContext: DecisionRunContext;
  }): Promise<DecisionProfilesScenarioTable[]> {
    const scenarioDefs = [
      { id: 'base' as const, label: 'Sanity Check Base' },
      { id: 'rv_plus_10' as const, label: 'Sanity Check RV +10pp' },
    ];
    const seed = activeParams.simulation.seed ?? 0;
    const currentRvExact = currentRvPctExactFromWeights(activeParams.weights);
    const officialCandidates = [...input.rvCandidates]
      .map((value) => snapMixToStep(value))
      .filter((value, index, all) => all.findIndex((candidate) => Math.abs(candidate - value) <= 0.0001) === index)
      .sort((a, b) => a - b);
    if (officialCandidates.length === 0) {
      throw new Error('No hay candidatos oficiales de optimización para evaluar.');
    }
    const evaluationCandidates = [...officialCandidates];
    if (!evaluationCandidates.some((value) => Math.abs(value - currentRvExact) <= 0.0001)) {
      pushUniqueMix(evaluationCandidates, currentRvExact);
    }
    const total = scenarioDefs.length * evaluationCandidates.length * SPENDING_HEADROOM_SCALES.length;
    let evaluated = 0;
    const nextTables: DecisionProfilesScenarioTable[] = [];

    setDecisionProgress({
      stage: input.stage,
      evaluated: 0,
      total,
      nSim: input.nSim,
      seed,
      sourceMode: input.runContext.sourceMode,
      sourceLabel: input.runContext.sourceLabel,
      scenarioLabel: input.runContext.scenarioLabel,
      inputFingerprint: input.runContext.inputFingerprint,
    });
    decisionLastEvaluatedRef.current = 0;
    decisionProgressHeartbeatRef.current = Date.now();

    for (const scenarioDef of scenarioDefs) {
      const scenario = RV_RF_PREMIUM_SENSITIVITY_SCENARIOS.find((item) => item.id === scenarioDef.id);
      if (!scenario) continue;
      const scenarioAdjusted = applyRvRfPremiumSensitivity(activeParams, scenario);
      const baseScenarioParams = cloneParams(scenarioAdjusted.params);
      baseScenarioParams.simulation.nSim = input.nSim;
      const rows: RvRfDecisionCandidate[] = [];
      const financialRows: FinancialReferenceCandidate[] = [];
      let currentCandidate: RvRfDecisionCandidate | null = null;

      for (const rvPct of evaluationCandidates) {
        if (shouldAbortDecisionRun() || !isDecisionRunContextCurrent(input.runContext)) throw new Error('__MIDAS_DECISION_CANCELLED__');
        const weights = buildRvRfCandidateWeights(activeParams.weights, rvPct);
        const candidateId = candidateIdForRvPct(rvPct, currentRvExact);
        const candidateIsOfficial = isOnOfficialGrid(rvPct);
        const evaluations: SpendingHeadroomEvaluationResult[] = [];

        if (scenarioDef.id === 'base' && candidateIsOfficial) {
          const autonomous = buildFinancialReferenceParams(activeParams);
          autonomous.weights = cloneParams(weights);
          autonomous.simulation.nSim = input.nSim;
          const financialSim = runSimulationCentral(autonomous);
          financialRows.push({
            candidateId,
            mixLabel: formatDecisionMixLabel(rvPct),
            rvPct: clampMixPercent(rvPct),
            rfPct: clampMixPercent(100 - rvPct),
            success40: financialSim.success40 ?? (1 - (financialSim.probRuin40 ?? financialSim.probRuin)),
            ruin20: financialSim.probRuin20 ?? 0,
            ruinP10: Number.isFinite(financialSim.ruinTimingP10 ?? Number.NaN) ? (financialSim.ruinTimingP10 as number) : null,
            drawdownP50: financialSim.maxDrawdownPercentiles[50] ?? null,
            terminalWealthP50: financialSim.p50TerminalAllPaths ?? financialSim.terminalWealthPercentiles[50] ?? null,
            weights: cloneParams(weights),
          });
        }

        for (const spendScale of SPENDING_HEADROOM_SCALES) {
          if (shouldAbortDecisionRun() || !isDecisionRunContextCurrent(input.runContext)) throw new Error('__MIDAS_DECISION_CANCELLED__');
          const scaled = applyTemporarySpendScale(baseScenarioParams, spendScale);
          scaled.weights = cloneParams(weights);
          scaled.simulation.nSim = input.nSim;
          const sim = runSimulationCentral(scaled);
          const quality = buildQualityOptimizationCandidate({
            id: `${candidateId}_x${spendScale}`,
            rvWeight: rvPct / 100,
            rfWeight: 1 - rvPct / 100,
            result: sim,
          });
          evaluations.push({
            spendScale,
            spendLabel: formatSpendScaleLabel(spendScale),
            candidateId,
            resultKey: hashJson({
              table: scenarioDef.id,
              candidateId,
              spendScale,
              weights,
              spendingPhases: scaled.spendingPhases,
              nSim: input.nSim,
            }),
            rvReal: weights.rvGlobal + weights.rvChile,
            rfReal: weights.rfGlobal + weights.rfChile,
            rvGlobal: weights.rvGlobal,
            rvChile: weights.rvChile,
            rfGlobal: weights.rfGlobal,
            rfChile: weights.rfChile,
            qasrStrict: quality.qasrStrict,
            csr85_4: quality.csr85_4,
            classicSuccessRate: quality.classicSuccessRate,
            probRuin: sim.probRuin40 ?? sim.probRuin,
            monthsInSevereCutMean: quality.monthsInSevereCutMean,
            maxConsecutiveSevereCutMonthsP75: quality.maxConsecutiveSevereCutMonthsP75,
            terminalWealthP25: quality.terminalWealthP25,
            terminalWealthP50: quality.terminalWealthP50,
            houseSaleRate: quality.houseSaleRate,
            severeCutMonthsDuringHouseSaleMedian: sim.qualityOfLifeMetrics?.severeCutMonthsDuringHouseSaleMedian ?? sim.qualityOfLifeMetrics?.severeCutMonthsDuringHouseSaleMean ?? null,
          });
          evaluated += 1;
          setDecisionProgress({
            stage: input.stage,
            evaluated,
            total,
            nSim: input.nSim,
            seed,
            sourceMode: input.runContext.sourceMode,
            sourceLabel: input.runContext.sourceLabel,
            scenarioLabel: input.runContext.scenarioLabel,
            inputFingerprint: input.runContext.inputFingerprint,
          });
          decisionLastEvaluatedRef.current = evaluated;
          decisionProgressHeartbeatRef.current = Date.now();
          await decisionYield();
        }

        const baseEval = evaluations.find((item) => Math.abs(item.spendScale - 1) <= 1e-9) ?? null;
        const plus20 = evaluations.find((item) => Math.abs(item.spendScale - 1.2) <= 1e-9) ?? null;
        const plus30 = evaluations.find((item) => Math.abs(item.spendScale - 1.3) <= 1e-9) ?? null;
        if (!baseEval || !plus20 || !plus30) continue;

        const candidate: RvRfDecisionCandidate = {
          candidateId,
          mixLabel: formatDecisionMixLabel(rvPct),
          rvPct: clampMixPercent(rvPct),
          rfPct: clampMixPercent(100 - rvPct),
          rvReal: baseEval.rvReal,
          rfReal: baseEval.rfReal,
          qasrBase: baseEval.qasrStrict,
          qasrAt120: plus20.qasrStrict,
          qasrAt130: plus30.qasrStrict,
          csrBase: baseEval.csr85_4,
          ruinRate: baseEval.probRuin,
          monthsInSevereCutMean: baseEval.monthsInSevereCutMean,
          maxConsecutiveSevereCutMonthsP75: baseEval.maxConsecutiveSevereCutMonthsP75,
          terminalWealthP25: baseEval.terminalWealthP25,
          terminalWealthP50: baseEval.terminalWealthP50,
          houseSaleRate: baseEval.houseSaleRate,
          severeCutDuringSaleMonths: baseEval.severeCutMonthsDuringHouseSaleMedian,
          recSevPctBase: baseEval.monthsInSevereCutMean === null
            ? null
            : baseEval.monthsInSevereCutMean / Math.max(1, activeParams.simulation.horizonMonths),
        };
        if (candidateIsOfficial) rows.push(candidate);
        if (Math.abs(rvPct - currentRvExact) <= 0.0001) currentCandidate = candidate;
      }

      nextTables.push({
        scenarioId: scenarioDef.id,
        label: scenarioDef.label,
        profiles: buildDecisionProfiles(rows, input.nSim),
        financialReference: selectFinancialOptimumCandidate(financialRows),
        currentCandidate,
      });
    }

    if (!isDecisionRunContextCurrent(input.runContext)) throw new Error('__MIDAS_DECISION_CANCELLED__');
    const resultMeta = buildOptimizationResultMeta({
      inputFingerprint: input.runContext.inputFingerprint,
      sourceMode: input.runContext.sourceMode,
      sourceLabel: input.runContext.sourceLabel,
      scenarioLabel: input.runContext.scenarioLabel,
      nSim: input.nSim,
      seed,
    });
    setDecisionProfilesTables(nextTables);
    setDecisionFlowStatus({
      stage: input.stage,
      badge: input.badge,
      message: input.message,
      nSim: input.nSim,
      stepPp: input.stepPp,
      candidateCount: officialCandidates.length,
      seed,
      implementationEnabled: input.implementationEnabled,
      sourceMode: input.runContext.sourceMode,
      sourceLabel: input.runContext.sourceLabel,
      scenarioLabel: input.runContext.scenarioLabel,
      inputFingerprint: input.runContext.inputFingerprint,
      ranAtLabel: resultMeta.ranAtLabel,
    });
    setDecisionProgress({
      stage: input.stage,
      evaluated: total,
      total,
      nSim: input.nSim,
      seed,
      sourceMode: input.runContext.sourceMode,
      sourceLabel: input.runContext.sourceLabel,
      scenarioLabel: input.runContext.scenarioLabel,
      inputFingerprint: input.runContext.inputFingerprint,
    });
    setDecisionResultMeta(resultMeta);
    decisionLastEvaluatedRef.current = total;
    decisionProgressHeartbeatRef.current = Date.now();

    return nextTables;
  }

  async function runDecisionProfiles() {
    if (decisionProfilesRunning) return;
    const runContext = buildDecisionRunContext();
    decisionResumeActionRef.current = 'profiles';
    resetDecisionFlowArtifacts();
    setDecisionProfilesRunning(true);
    setDecisionExecutionState(typeof document !== 'undefined' && document.hidden ? 'background' : 'running');
    setDecisionBackgroundHint(
      typeof document !== 'undefined' && document.hidden
        ? 'Cálculo en segundo plano · puede avanzar más lento.'
        : null,
    );
    setDecisionProfilesError(null);
    setDecisionFlowWarning(null);
    setDecisionDiagnosticTrace({
      inputFingerprint: runContext.inputFingerprint,
      sourceMode: runContext.sourceMode,
      seed: activeParams.simulation.seed ?? 0,
      stages: {
        express: null,
        zoom: null,
        confirmation: null,
      },
      finalRecommendationMix: null,
      implementationTargetMix: null,
      implementationReachedMix: null,
      implementationGap: null,
      notes: [
        'Indicar si Express/Zoom/Confirmation usan candidatos distintos',
        'Indicar si 100/0 quedó fuera del shortlist de Zoom o Confirmation',
        'Indicar si 80/20 fue elegido por ranking, guardrail, shortlist o implementación',
      ],
    });
    setDecisionCancelRequested(false);
    decisionCancelRequestedRef.current = false;
    decisionForceInterruptRef.current = false;
    decisionProgressHeartbeatRef.current = Date.now();
    decisionLastEvaluatedRef.current = 0;
    setDecisionFlowStatus({
      stage: 'express',
      badge: 'Preliminar · Express',
      message: 'Resultado rápido para explorar. No implementar.',
      nSim: DECISION_EXPRESS_NSIM,
      stepPp: DECISION_EXPRESS_STEP_PP,
      candidateCount: 0,
      seed: activeParams.simulation.seed ?? 0,
      implementationEnabled: false,
      sourceMode: runContext.sourceMode,
      sourceLabel: runContext.sourceLabel,
      scenarioLabel: runContext.scenarioLabel,
      inputFingerprint: runContext.inputFingerprint,
      ranAtLabel: null,
    });
    try {
      await decisionYield();
      const expressCandidates = buildOptimizationExpressGrid(currentRvPctExactFromWeights(activeParams.weights));
      const expressTables = await evaluateDecisionProfilesStage({
        stage: 'express',
        badge: 'Preliminar · Express',
        message: 'Resultado rápido para explorar. No implementar.',
        nSim: DECISION_EXPRESS_NSIM,
        stepPp: DECISION_EXPRESS_STEP_PP,
        rvCandidates: expressCandidates,
        implementationEnabled: false,
        runContext,
      });
      const expressBaseTable = expressTables.find((table) => table.scenarioId === 'base') ?? null;
      const expressBaseProfiles = expressBaseTable?.profiles ?? null;
      const expressFinancial = expressBaseTable?.financialReference ?? null;
      const expressMain = expressBaseProfiles?.primaryRecommendation ?? null;
      const expressFallback = selectBestAvailableFallbackCandidate(
        expressBaseProfiles?.rows,
        expressBaseTable?.currentCandidate ?? expressBaseProfiles?.defensiveReference ?? null,
      );
      const expressRenderable = expressMain ?? expressFallback;
      const expressVisibleRv = expressRenderable?.rvPct ?? null;
      const expressDefensive = expressBaseProfiles?.defensiveReference ?? null;
      setLastExpressCandidate(expressRenderable);
      if (expressRenderable) {
        setLastRenderableCandidate(expressRenderable);
        setLastRenderableKind(expressMain ? 'official' : 'contingency');
      }
      setDecisionDiagnosticTrace((previous) => previous ? ({
        ...previous,
        stages: {
          ...previous.stages,
          express: buildDecisionTraceStage({
            nSim: DECISION_EXPRESS_NSIM,
            candidateCount: expressBaseProfiles?.rows.length ?? 0,
            shortlistSource: 'express_grid_10pp',
            profiles: expressBaseProfiles,
            baselineCandidate: expressBaseTable?.currentCandidate ?? expressBaseProfiles?.defensiveReference ?? null,
            selectedCandidate: expressRenderable,
          }),
        },
      }) : previous);

      const zoomCandidatesInitial = buildOptimizationZoomShortlist({
        preliminaryRecommendationRv: expressVisibleRv,
        defensiveReferenceRv: expressDefensive?.rvPct ?? null,
        technicalPreludeRv: expressFinancial?.rvPct ?? null,
        currentRvRounded: snapMixToStep(currentRvPctFromWeights(activeParams.weights)),
      });
      let zoomCandidates = zoomCandidatesInitial;
      if (zoomCandidates.length === 0) {
        zoomCandidates = buildOptimizationZoomFallbackShortlist(
          snapMixToStep(currentRvPctFromWeights(activeParams.weights)),
        );
        if (zoomCandidates.length > 0) {
          setDecisionFlowWarning('Express no produjo recomendación oficial; Zoom usó fallback local alrededor del mix actual redondeado.');
        }
      }
      if (zoomCandidates.length === 0) {
        setDecisionProfilesError('No hay candidatos oficiales de optimización para evaluar.');
        setDecisionExecutionState('interrupted');
        setDecisionBackgroundHint(null);
        return;
      }

      const zoomTables = await evaluateDecisionProfilesStage({
        stage: 'zoom',
        badge: 'Preliminar · Zoom refinado',
        message: 'Resultado refinado, pero aún no confirmado. No implementar. Shortlist refinada con vecinos ±5pp/±10pp.',
        nSim: DECISION_ZOOM_NSIM,
        stepPp: null,
        rvCandidates: zoomCandidates,
        implementationEnabled: false,
        runContext,
      });
      const zoomBaseTable = zoomTables.find((table) => table.scenarioId === 'base') ?? null;
      const zoomBaseProfiles = zoomBaseTable?.profiles ?? null;
      const zoomMain = zoomBaseProfiles?.primaryRecommendation ?? null;
      const zoomFallback = selectBestAvailableFallbackCandidate(
        zoomBaseProfiles?.rows,
        zoomBaseTable?.currentCandidate ?? zoomBaseProfiles?.defensiveReference ?? null,
      );
      const zoomRenderable = zoomMain ?? zoomFallback;
      setLastZoomCandidate(zoomRenderable);
      if (zoomRenderable) {
        setLastRenderableCandidate(zoomRenderable);
        setLastRenderableKind(zoomMain ? 'official' : 'contingency');
      }
      setDecisionDiagnosticTrace((previous) => previous ? ({
        ...previous,
        stages: {
          ...previous.stages,
          zoom: buildDecisionTraceStage({
            nSim: DECISION_ZOOM_NSIM,
            candidateCount: zoomBaseProfiles?.rows.length ?? 0,
            shortlistSource: zoomCandidatesInitial.length > 0 ? 'zoom_around_express_visible' : 'zoom_fallback_current_rounded',
            profiles: zoomBaseProfiles,
            baselineCandidate: zoomBaseTable?.currentCandidate ?? zoomBaseProfiles?.defensiveReference ?? null,
            selectedCandidate: zoomRenderable,
          }),
        },
      }) : previous);

      if (expressMain && zoomMain && expressMain.candidateId !== zoomMain.candidateId) {
        setDecisionFlowWarning(`El resultado rápido cambió al refinar: Express sugería ${expressMain.mixLabel} y Zoom sugiere ${zoomMain.mixLabel}. Usa solo el confirmado para decidir.`);
      }
    } catch (error) {
      if (!isDecisionRunContextCurrent(runContext)) return;
      if (error instanceof Error && error.message === '__MIDAS_DECISION_CANCELLED__') {
        setDecisionFlowWarning('Cálculo cancelado. Mantuvimos el último resultado completo disponible.');
        if (decisionForceInterruptRef.current) {
          setDecisionExecutionState('interrupted');
          setDecisionBackgroundHint(null);
        }
      } else {
        setDecisionProfilesError(error instanceof Error ? error.message : String(error));
        setDecisionExecutionState('interrupted');
        setDecisionBackgroundHint(null);
      }
    } finally {
      if (isDecisionRunContextCurrent(runContext)) {
        setDecisionProfilesRunning(false);
      }
      if (isDecisionRunContextCurrent(runContext) && !decisionForceInterruptRef.current) {
        setDecisionExecutionState('completed');
        setDecisionBackgroundHint(null);
      }
    }
  }

  async function runDecisionConfirmation() {
    if (decisionProfilesRunning) return;
    const runContext = buildDecisionRunContext();
    decisionResumeActionRef.current = 'confirmation';
    const preliminaryMain = actionableRecommendationCandidate;
    const preliminaryDefensive = officialDefensiveReference;
    resetDecisionFlowArtifacts();
    setDecisionProfilesRunning(true);
    setDecisionExecutionState(typeof document !== 'undefined' && document.hidden ? 'background' : 'running');
    setDecisionBackgroundHint(
      typeof document !== 'undefined' && document.hidden
        ? 'Cálculo en segundo plano · puede avanzar más lento.'
        : null,
    );
    setDecisionProfilesError(null);
    setDecisionFlowWarning(null);
    setDecisionCancelRequested(false);
    decisionCancelRequestedRef.current = false;
    decisionForceInterruptRef.current = false;
    decisionProgressHeartbeatRef.current = Date.now();
    decisionLastEvaluatedRef.current = 0;
    setDecisionFlowStatus({
      stage: 'confirmed',
      badge: 'Confirmación oficial en curso',
      message: 'Corriendo shortlist oficial con simulación completa.',
      nSim: activeParams.simulation.nSim,
      stepPp: DECISION_CONFIRM_NEIGHBOR_STEP_PP,
      candidateCount: 0,
      seed: activeParams.simulation.seed ?? 0,
      implementationEnabled: false,
      sourceMode: runContext.sourceMode,
      sourceLabel: runContext.sourceLabel,
      scenarioLabel: runContext.scenarioLabel,
      inputFingerprint: runContext.inputFingerprint,
      ranAtLabel: null,
    });
    try {
      await decisionYield();
      const expressVisibleRv = lastExpressCandidate?.rvPct ?? null;
      const shortlist = buildOptimizationConfirmationShortlist({
        zoomRecommendationRv: preliminaryMain?.rvPct ?? null,
        expressRecommendationRv: expressVisibleRv ?? preliminaryMain?.rvPct ?? null,
        defensiveReferenceRv: preliminaryDefensive?.rvPct ?? null,
        technicalPreludeRv: financialOptimum?.rvPct ?? null,
        currentRvRounded: snapMixToStep(currentRvPctExactFromWeights(activeParams.weights)),
      });
      const confirmationCandidates = shortlist.length ? shortlist : buildFineRvRfGrid(DECISION_OFFICIAL_GRID_STEP_PP);
      const confirmedTables = await evaluateDecisionProfilesStage({
        stage: 'confirmed',
        badge: 'Confirmación completa finalizada',
        message: 'Resultado confirmado con simulación completa.',
        nSim: activeParams.simulation.nSim,
        stepPp: DECISION_CONFIRM_NEIGHBOR_STEP_PP,
        rvCandidates: confirmationCandidates,
        implementationEnabled: true,
        runContext,
      });
      const confirmedBaseTable = confirmedTables.find((table) => table.scenarioId === 'base') ?? null;
      const confirmedBaseProfiles = confirmedBaseTable?.profiles ?? null;
      const confirmedMain = confirmedBaseProfiles?.primaryRecommendation ?? selectBestAvailableFallbackCandidate(
        confirmedBaseProfiles?.rows,
        confirmedBaseTable?.currentCandidate ?? confirmedBaseProfiles?.defensiveReference ?? null,
      );
      const confirmedOfficial = confirmedBaseProfiles?.primaryRecommendation ?? null;
      setLastConfirmedCandidate(confirmedMain);
      if (confirmedMain) {
        setLastRenderableCandidate(confirmedMain);
        setLastRenderableKind(confirmedOfficial ? 'official' : 'contingency');
      }
      setDecisionDiagnosticTrace((previous) => previous ? ({
        ...previous,
        stages: {
          ...previous.stages,
          confirmation: buildDecisionTraceStage({
            nSim: activeParams.simulation.nSim,
            candidateCount: confirmedBaseProfiles?.rows.length ?? 0,
            shortlistSource: 'confirmation_around_zoom_with_optional_anchors',
            profiles: confirmedBaseProfiles,
            baselineCandidate: confirmedBaseTable?.currentCandidate ?? confirmedBaseProfiles?.defensiveReference ?? null,
            selectedCandidate: confirmedMain,
          }),
        },
        finalRecommendationMix: confirmedMain?.mixLabel ?? previous.finalRecommendationMix,
      }) : previous);

      if (preliminaryMain && confirmedMain && preliminaryMain.candidateId !== confirmedMain.candidateId) {
        setDecisionFlowWarning(`El resultado preliminar cambió al confirmar. Usa solo el confirmado para decidir: ${confirmedMain.mixLabel}.`);
      } else if (!confirmedOfficial && confirmedMain) {
        setDecisionFlowWarning(`Confirmación completa sin candidato apto oficial. Se mantiene contingencia con ${confirmedMain.mixLabel}.`);
      }
    } catch (error) {
      if (!isDecisionRunContextCurrent(runContext)) return;
      if (error instanceof Error && error.message === '__MIDAS_DECISION_CANCELLED__') {
        setDecisionFlowWarning('Confirmación cancelada. Mantuvimos el último resultado completo disponible.');
        if (decisionForceInterruptRef.current) {
          setDecisionExecutionState('interrupted');
          setDecisionBackgroundHint(null);
        }
      } else {
        setDecisionProfilesError(error instanceof Error ? error.message : String(error));
        setDecisionExecutionState('interrupted');
        setDecisionBackgroundHint(null);
      }
    } finally {
      if (isDecisionRunContextCurrent(runContext)) {
        setDecisionProfilesRunning(false);
      }
      if (isDecisionRunContextCurrent(runContext) && !decisionForceInterruptRef.current) {
        setDecisionExecutionState('completed');
        setDecisionBackgroundHint(null);
      }
    }
  }

  const resumeDecisionRun = useCallback(() => {
    if (decisionProfilesRunning) return;
    setDecisionExecutionState('restarting');
    setDecisionFlowWarning('Reanudando cálculo desde la etapa actual…');
    decisionForceInterruptRef.current = false;
    decisionCancelRequestedRef.current = false;
    setDecisionCancelRequested(false);
    if (decisionResumeActionRef.current === 'confirmation') {
      void runDecisionConfirmation();
      return;
    }
    void runDecisionProfiles();
  }, [decisionProfilesRunning]);

  const modeCards = useMemo(
    () => ([
      { id: 'light', label: 'Light', active: mode === 'light', enabled: true, hint: 'Flujo recomendado' },
      { id: 'normal', label: 'Normal', active: mode === 'normal', enabled: false, hint: 'Próximamente' },
      { id: 'decision', label: 'Decisión', active: mode === 'decision', enabled: false, hint: 'Próximamente' },
    ] as const),
    [mode],
  );

  const phase1BestSuccess = useMemo(() => (
    phase1Points.length ? Math.max(...phase1Points.map((p) => p.success40)) : null
  ), [phase1Points]);
  const phase1Ranking = useMemo(
    () => [...phase1Points].sort((a, b) => (
      (b.success40 - a.success40)
        || (a.ruin20 - b.ruin20)
        || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
    )),
    [phase1Points],
  );
  const phase1Sweep = useMemo(
    () => [...phase1Points].sort((a, b) => a.rvPct - b.rvPct),
    [phase1Points],
  );
  const phase1Top3 = phase1Ranking.slice(0, 3);
  const phase1TechnicalTiePoints = useMemo(() => {
    if (phase1BestSuccess === null) return [];
    return phase1Ranking.filter((point) => ((phase1BestSuccess - point.success40) * 100) <= (TECHNICAL_TIE_BAND_PP + 1e-9));
  }, [phase1BestSuccess, phase1Ranking]);
  const phase1BalancedPoint = useMemo(() => {
    if (!phase1TechnicalTiePoints.length) return null;
    const sorted = [...phase1TechnicalTiePoints].sort((a, b) => (
      (a.ruin20 - b.ruin20)
      || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
      || (a.drawdownP50 - b.drawdownP50)
      || (a.rvPct - b.rvPct)
    ));
    return sorted[0] ?? null;
  }, [phase1TechnicalTiePoints]);
  const phase1CurrentPoint = useMemo(
    () => phase1Points.find((point) => point.isCurrentMix) ?? null,
    [phase1Points],
  );
  const phase1ChampionChallenger = useMemo(
    () => choosePhase1ChampionChallenger(phase1Points),
    [phase1Points],
  );
  const phase1SuggestedPoint = useMemo(
    () => phase1ChampionChallenger.champion,
    [phase1ChampionChallenger.champion],
  );
  const phase2BaselinePoint = useMemo(
    () => choosePhase1Baseline(phase1Points),
    [phase1Points],
  );
  const phase2CurrentRow = useMemo(
    () => (phase1CurrentPoint ? phase2Rows.find((row) => isSameMix(row.source, phase1CurrentPoint)) ?? null : null),
    [phase1CurrentPoint, phase2Rows],
  );
  const phase2SuggestedRow = useMemo(
    () => (phase1SuggestedPoint ? phase2Rows.find((row) => isSameMix(row.source, phase1SuggestedPoint)) ?? null : null),
    [phase1SuggestedPoint, phase2Rows],
  );
  const phase2BaselineRow = useMemo(
    () => (phase2BaselinePoint ? phase2Rows.find((row) => isSameMix(row.source, phase2BaselinePoint)) ?? null : null),
    [phase2BaselinePoint, phase2Rows],
  );
  const phase2QualityRows = useMemo(
    () => [...phase2Rows].sort((a, b) => (
      compareQualityOptimizationCandidates(a.qualityCandidate, b.qualityCandidate)
      || (a.source.rvPct - b.source.rvPct)
    )),
    [phase2Rows],
  );
  const phase2QualityWinner = useMemo(
    () => phase2QualityRows.find((row) => row.qualityCandidate.qasrStrict !== null) ?? null,
    [phase2QualityRows],
  );
  const phase2QualityRunnerUp = useMemo(
    () => phase2QualityRows.find((row) => (
      row.qualityCandidate.qasrStrict !== null
      && (!phase2QualityWinner || !isSameMix(row.source, phase2QualityWinner.source))
    )) ?? null,
    [phase2QualityRows, phase2QualityWinner],
  );
  const phase2QualityMissingRows = useMemo(
    () => phase2Rows.filter((row) => row.qualityCandidate.qasrStrict === null),
    [phase2Rows],
  );
  const phase2FrontierDiagnostics = useMemo(() => {
    const diagnosticRows: OptimizationDiagnosticRow[] = phase2Rows.map((row) => ({
      id: `rv-${row.source.rvPct.toFixed(1)}`,
      rvPct: row.source.rvPct,
      rfPct: row.source.rfPct,
      weights: row.source.weights,
      qasrStrict: row.qualityCandidate.qasrStrict,
      csr85_4: row.qualityCandidate.csr85_4,
      classicSuccessRate: row.qualityCandidate.classicSuccessRate,
      monthsInSevereCutMean: row.qualityCandidate.monthsInSevereCutMean,
      maxConsecutiveSevereCutMonthsP75: row.qualityCandidate.maxConsecutiveSevereCutMonthsP75,
      terminalWealthP25: row.qualityCandidate.terminalWealthP25,
      terminalWealthP50: row.qualityCandidate.terminalWealthP50,
      houseSaleRate: row.qualityCandidate.houseSaleRate,
    }));
    return buildOptimizationFrontierDiagnostics(
      activeParams,
      diagnosticRows,
      phase2QualityWinner
        ? diagnosticRows.find((row) => Math.abs(row.rvPct - phase2QualityWinner.source.rvPct) < 1e-9) ?? null
        : null,
    );
  }, [activeParams, phase2QualityWinner, phase2Rows]);
  const baseDecisionProfiles = useMemo(
    () => decisionProfilesTables.find((table) => table.scenarioId === 'base')?.profiles ?? null,
    [decisionProfilesTables],
  );
  const baseDecisionTable = useMemo(
    () => decisionProfilesTables.find((table) => table.scenarioId === 'base') ?? null,
    [decisionProfilesTables],
  );
  const hasDecisionRunResult = Boolean(decisionFlowStatus || baseDecisionTable || baseDecisionProfiles);
  const hasEvaluatedCandidates = Boolean(baseDecisionProfiles && baseDecisionProfiles.rows.length > 0);
  const officialMainRecommendation = baseDecisionProfiles?.primaryRecommendation ?? null;
  const hasOfficialRecommendation = Boolean(officialMainRecommendation);
  const bestAvailableRecommendation = useMemo(
    () => selectBestAvailableFallbackCandidate(
      baseDecisionProfiles?.rows,
      baseDecisionTable?.currentCandidate ?? baseDecisionProfiles?.defensiveReference ?? null,
    ),
    [baseDecisionProfiles, baseDecisionTable],
  );
  const needsBestAvailableFallback = hasEvaluatedCandidates && !hasOfficialRecommendation;
  const recommendationCandidate = officialMainRecommendation ?? bestAvailableRecommendation;
  const actionableRecommendationCandidate = recommendationCandidate ?? (decisionProfilesRunning ? lastRenderableCandidate : null);
  const recommendationKind: 'official' | 'contingency' | 'none' = hasOfficialRecommendation
    ? 'official'
    : actionableRecommendationCandidate
      ? (lastRenderableKind ?? 'contingency')
      : 'none';
  const recommendationIsOfficial = recommendationKind === 'official';
  const recommendationIsContingency = recommendationKind === 'contingency';
  const fallbackGuardrailSummary = useMemo(() => {
    if (!baseDecisionProfiles?.rows?.length) return null;
    const passed = baseDecisionProfiles.rows.filter((row) => row.passesHardGuardrails).length;
    const failed = baseDecisionProfiles.rows.length - passed;
    const reasons = new Map<string, number>();
    baseDecisionProfiles.rows.forEach((row) => {
      row.failedGuardrails.forEach((reason) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1));
    });
    const topReasons = [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    return {
      total: baseDecisionProfiles.rows.length,
      passed,
      failed,
      topReasons,
    };
  }, [baseDecisionProfiles]);
  const officialDefensiveReference = baseDecisionProfiles?.defensiveReference ?? null;
  const officialHeadroomAlternative = baseDecisionProfiles?.headroomAlternative ?? null;
  const officialBenchmarkExtreme = baseDecisionProfiles?.benchmarkExtreme ?? null;
  const financialOptimum = useMemo(
    () => baseDecisionTable?.financialReference ?? null,
    [baseDecisionTable],
  );
  const currentDecisionCandidate = useMemo(() => {
    if (baseDecisionTable?.currentCandidate) return baseDecisionTable.currentCandidate;
    if (!baseDecisionProfiles) return null;
    const currentId = candidateIdForRvPct(currentRvPctExactFromWeights(activeParams.weights), currentRvPctExactFromWeights(activeParams.weights));
    return baseDecisionProfiles.rows.find((row) => row.candidateId === currentId) ?? null;
  }, [activeParams.weights, baseDecisionProfiles, baseDecisionTable]);
  const recommendedDecisionWeights = useMemo(
    () => (actionableRecommendationCandidate ? buildRvRfCandidateWeights(activeParams.weights, actionableRecommendationCandidate.rvPct) : null),
    [actionableRecommendationCandidate, activeParams.weights],
  );
  const closestDiscardedCompetitor = useMemo(
    () => selectClosestDiscardedCompetitor({
      profiles: baseDecisionProfiles,
      mainRecommendation: actionableRecommendationCandidate,
      defensiveReference: officialDefensiveReference,
      headroomAlternative: officialHeadroomAlternative,
      benchmarkExtreme: officialBenchmarkExtreme,
      financialReference: financialOptimum,
    }),
    [actionableRecommendationCandidate, baseDecisionProfiles, financialOptimum, officialBenchmarkExtreme, officialDefensiveReference, officialHeadroomAlternative],
  );
  const currentVsMidasRows = useMemo(
    () => (actionableRecommendationCandidate && recommendedDecisionWeights
      ? buildCurrentVsMidasComparisonRows({
        currentWeights: activeParams.weights,
        recommendedWeights: recommendedDecisionWeights,
        currentCandidate: currentDecisionCandidate,
        recommendedCandidate: actionableRecommendationCandidate,
      })
      : []),
    [actionableRecommendationCandidate, activeParams.weights, currentDecisionCandidate, recommendedDecisionWeights],
  );
  const currentVsMidasTradeoffs = useMemo(
    () => (actionableRecommendationCandidate && recommendedDecisionWeights
      ? buildCurrentVsMidasTradeoffs({
        currentWeights: activeParams.weights,
        recommendedWeights: recommendedDecisionWeights,
        currentCandidate: currentDecisionCandidate,
        recommendedCandidate: actionableRecommendationCandidate,
      })
      : null),
    [actionableRecommendationCandidate, activeParams.weights, currentDecisionCandidate, recommendedDecisionWeights],
  );
  const currentReconciliationMessage = useMemo(
    () => buildSimulationReconciliationMessage({
      snapshot: simulationActive ? simulationSnapshot : null,
      nSim: decisionFlowStatus?.nSim ?? activeParams.simulation.nSim,
      seed: decisionFlowStatus?.seed ?? activeParams.simulation.seed ?? 0,
    }),
    [activeParams.simulation.nSim, activeParams.simulation.seed, decisionFlowStatus?.nSim, decisionFlowStatus?.seed, simulationActive, simulationSnapshot],
  );
  const recommendationCandidateRow = useMemo(
    () => findPhase2RowForDecisionCandidate(phase2Rows, actionableRecommendationCandidate),
    [actionableRecommendationCandidate, phase2Rows],
  );
  const officialMainRecommendationRow = useMemo(
    () => findPhase2RowForDecisionCandidate(phase2Rows, officialMainRecommendation),
    [officialMainRecommendation, phase2Rows],
  );
  const recommendationCandidateSourceRow = useMemo(() => {
    if (!actionableRecommendationCandidate) return null;
    if (recommendationCandidateRow) return recommendationCandidateRow;
    const weights = buildRvRfCandidateWeights(activeParams.weights, actionableRecommendationCandidate.rvPct);
    return toPhase2PointFromDecisionCandidate(actionableRecommendationCandidate, weights);
  }, [actionableRecommendationCandidate, activeParams, recommendationCandidateRow]);
  const officialDefensiveReferenceRow = useMemo(
    () => findPhase2RowForDecisionCandidate(phase2Rows, officialDefensiveReference),
    [officialDefensiveReference, phase2Rows],
  );
  const officialHeadroomAlternativeRow = useMemo(
    () => findPhase2RowForDecisionCandidate(phase2Rows, officialHeadroomAlternative),
    [officialHeadroomAlternative, phase2Rows],
  );
  const officialRecommendationWarning = useMemo(() => {
    if (!phase2Rows.length) return null;
    if (!baseDecisionProfiles) return 'La recomendación oficial V2.7.2 aparece aquí después de generar la decisión por perfiles.';
    if (!actionableRecommendationCandidate) return 'No hay candidato seleccionable en los mixes evaluados.';
    if (!recommendationCandidateSourceRow) return 'El candidato seleccionado no pudo convertirse en escenario ejecutable.';
    const officialRow = baseDecisionProfiles.rows.find((row) => row.candidateId === actionableRecommendationCandidate.candidateId) ?? null;
    if (!officialRow?.passesHardGuardrails) return 'Candidato recomendado no coincide con fuente V2.7.2.';
    return null;
  }, [actionableRecommendationCandidate, baseDecisionProfiles, phase2Rows.length, recommendationCandidateSourceRow]);
  const legacyRecommendationConflict = useMemo(() => {
    if (!phase2QualityWinner || !recommendationCandidateRow) return null;
    if (isSameMix(phase2QualityWinner.source, recommendationCandidateRow.source)) return null;
    return `El top legacy ${scenarioLabel(phase2QualityWinner.source)} difiere de la recomendación principal V2.7.2 ${scenarioLabel(recommendationCandidateRow.source)}.`;
  }, [phase2QualityWinner, recommendationCandidateRow]);
  const recommendationTradeoffCards = useMemo(() => {
    if (!officialMainRecommendation || !baseDecisionProfiles) return [] as RecommendationTradeoffCard[];
    const cards: RecommendationTradeoffCard[] = [];
    if (officialDefensiveReference && officialDefensiveReference.candidateId !== officialMainRecommendation.candidateId) {
      cards.push(buildDecisionTradeoffCard('defensive', 'Referencia defensiva', officialMainRecommendation, officialDefensiveReference));
    }
    if (officialHeadroomAlternative && officialHeadroomAlternative.candidateId !== officialMainRecommendation.candidateId) {
      cards.push(buildDecisionTradeoffCard('headroom', 'Alternativa de mayor holgura', officialMainRecommendation, officialHeadroomAlternative));
    }
    if (officialBenchmarkExtreme && officialBenchmarkExtreme.candidateId !== officialMainRecommendation.candidateId) {
      cards.push(buildDecisionTradeoffCard('benchmark', 'Benchmark extremo', officialMainRecommendation, officialBenchmarkExtreme));
    }
    if (phase2SuggestedRow && officialMainRecommendationRow && !isSameMix(phase2SuggestedRow.source, officialMainRecommendationRow.source)) {
      cards.push(buildLegacyTradeoffCard('phase1', 'Óptimo técnico preliminar', officialMainRecommendationRow, phase2SuggestedRow));
    }
    return cards;
  }, [
    baseDecisionProfiles,
    officialBenchmarkExtreme,
    officialDefensiveReference,
    officialHeadroomAlternative,
    officialMainRecommendation,
    officialMainRecommendationRow,
    phase2SuggestedRow,
  ]);
  const sensitivityInterpretation = useMemo(() => {
    const base = sensitivityResults.find((item) => item.scenario.id === 'base') ?? null;
    const others = sensitivityResults
      .filter((item) => item.scenario.id !== 'base')
      .map((item) => item.winner?.source.rvPct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return explainSensitivityShift(base?.winner?.source.rvPct ?? null, others);
  }, [sensitivityResults]);
  const spendingHeadroomWinnerRow = recommendationCandidateRow ?? phase2QualityWinner;
  const spendingHeadroomCandidates = useMemo(
    () => buildSpendingHeadroomCandidates(phase2Rows, phase2CurrentRow, spendingHeadroomWinnerRow),
    [phase2CurrentRow, phase2Rows, spendingHeadroomWinnerRow],
  );
  const spendingHeadroomInterpretation = useMemo(
    () => explainSpendingHeadroom(spendingHeadroomResults, spendingHeadroomCandidates.find((item) => item.sourceLabel === 'Recomendación principal V2.7.2') ?? null),
    [spendingHeadroomCandidates, spendingHeadroomResults],
  );
  const phase2Decisions = useMemo(() => {
    if (!phase2BaselineRow) return new Map<number, Phase2CompetitionDecision>();
    return new Map(
      phase2Rows.map((row) => [row.source.rvPct, evaluatePhase2Competition(phase2BaselineRow, row)]),
    );
  }, [phase2BaselineRow, phase2Rows]);
  const switchVerdict = useMemo(() => {
    if (!phase1CurrentPoint || !phase1SuggestedPoint) return null;
    const currentDecision = phase2CurrentRow ? phase2Decisions.get(phase2CurrentRow.source.rvPct) ?? null : null;
    const suggestedDecision = phase2SuggestedRow ? phase2Decisions.get(phase2SuggestedRow.source.rvPct) ?? null : null;
    return buildMixSwitchVerdict(phase1CurrentPoint, phase1SuggestedPoint, currentDecision, suggestedDecision);
  }, [phase1CurrentPoint, phase1SuggestedPoint, phase2CurrentRow, phase2Decisions, phase2SuggestedRow]);
  const phase2ChampionChallenger = useMemo(() => {
    if (!phase2Rows.length) {
      return {
        champion: null as Phase2Point | null,
        challenger: null as Phase2Point | null,
        reason: 'Sin Fase 2 calculada',
      };
    }
    if (!phase2QualityWinner) {
      return {
        champion: null as Phase2Point | null,
        challenger: null as Phase2Point | null,
        reason: 'Faltan métricas de calidad de vida para rankear los candidatos.',
      };
    }
    return {
      champion: phase2QualityWinner,
      challenger: phase2QualityRunnerUp,
      reason: 'Ranking principal por calidad de vida: QASR → CSR → éxito clásico → recortes severos → patrimonio final.',
    };
  }, [phase2QualityRows, phase2QualityRunnerUp, phase2QualityWinner, phase2Rows.length]);
  const phase3BaseSpendingVector = useMemo(
    () => getSpendingVector(activeParams),
    [activeParams],
  );
  const phase2LongevitySelectedRow = useMemo(() => {
    return {
      row: recommendationCandidateSourceRow,
      reason: recommendationCandidateSourceRow
        ? 'Fuente oficial V2.7.2/V2.7.4 · Pareto + ratio vs referencia defensiva.'
        : 'Primero genera la recomendación principal V2.7.2/V2.7.4.',
    };
  }, [recommendationCandidateSourceRow]);
  const phase2ImplementationSelectedRow = useMemo(() => phase2LongevitySelectedRow.row, [phase2LongevitySelectedRow.row]);
  React.useEffect(() => {
    setDecisionDiagnosticTrace((previous) => previous ? ({
      ...previous,
      finalRecommendationMix: actionableRecommendationCandidate?.mixLabel ?? previous.finalRecommendationMix,
      implementationTargetMix: phase2ImplementationSelectedRow ? formatDecisionMixLabel(phase2ImplementationSelectedRow.source.rvPct) : null,
      implementationReachedMix: implementationPlan ? formatMixPair(implementationPlan.reachableMix) : null,
      implementationGap: implementationPlan?.gapVsIdealRvPp ?? null,
    }) : previous);
  }, [actionableRecommendationCandidate, implementationPlan, phase2ImplementationSelectedRow]);
  const decisionImplementationReady = useMemo(
    () => canUseDecisionFlowForImplementation(decisionFlowStatus) && Boolean(currentDecisionCandidate) && decisionResultIsCurrent,
    [currentDecisionCandidate, decisionFlowStatus, decisionResultIsCurrent],
  );
  const activeScenarioAfterPhase2 = useMemo(
    () => phase2ImplementationSelectedRow,
    [phase2ImplementationSelectedRow],
  );
  const implementationMateriality = useMemo(
    () => (implementationPlan ? classifyImplementationMateriality({ currentWeights: activeParams.weights, plan: implementationPlan }) : null),
    [activeParams.weights, implementationPlan],
  );
  const implementationSleeveMoneyGuide = useMemo(() => {
    if (!implementationMateriality?.sleeveValidation?.rows?.length) return [] as string[];
    const baseCapital = Number.isFinite(activeParams.capitalInitial) ? activeParams.capitalInitial : 0;
    if (baseCapital <= 0) return [] as string[];
    return implementationMateriality.sleeveValidation.rows
      .filter((row) => Math.abs(row.gapPp) > 0.05)
      .map((row) => {
        const amountClp = Math.abs(row.gapPp) / 100 * baseCapital;
        const direction = row.gapPp > 0 ? 'Aumentar' : 'Reducir';
        return `${direction} ${row.label} en ${formatClpShort(amountClp)} (${formatSignedPp(row.gapPp)}).`;
      });
  }, [activeParams.capitalInitial, implementationMateriality]);
  const activeScenarioAfterImplementation = useMemo(() => {
    if (!activeScenarioAfterPhase2) {
      return {
        row: null as Phase2Point | null,
        sourceLabel: 'Recomendación principal V2.7.2/V2.7.4 pendiente',
        blockedReason: 'Primero genera la recomendación principal V2.7.2/V2.7.4 para activar Implementación.',
        roleLabel: 'Escenario activo',
      };
    }
    const materialGap = Boolean(
      implementationPlan
      && Math.abs(implementationPlan.gapVsIdealRvPp) > REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9,
    );
    if (!implementationPlan) {
      return {
        row: activeScenarioAfterPhase2,
        sourceLabel: `Escenario activo recibido desde recomendación principal V2.7.2/V2.7.4: ${scenarioLabel(activeScenarioAfterPhase2.source)}`,
        blockedReason: null as string | null,
        roleLabel: 'Recomendación principal V2.7.2/V2.7.4',
      };
    }
    if (!materialGap) {
      return {
        row: activeScenarioAfterPhase2,
        sourceLabel: 'Implementación equivalente a la recomendación principal V2.7.2/V2.7.4',
        blockedReason: null as string | null,
        roleLabel: 'Implementado equivalente',
      };
    }
    if (realisticValidation?.row) {
      return {
        row: realisticValidation.row,
        sourceLabel: 'Implementación validada desde la recomendación principal V2.7.2/V2.7.4',
        blockedReason: null as string | null,
        roleLabel: 'Validado tras implementación',
      };
    }
    return {
      row: null as Phase2Point | null,
      sourceLabel: 'Escenario implementable pendiente de validación realista',
      blockedReason: 'Primero valida el mix alcanzable para seguir usando la recomendación principal oficial.',
      roleLabel: 'Escenario activo',
    };
  }, [activeScenarioAfterPhase2, implementationPlan, realisticValidation]);
  const phase3Input = useMemo(() => {
    if (!activeScenarioAfterImplementation.row) {
      return {
        rows: [] as Phase2Point[],
        sourceLabel: activeScenarioAfterImplementation.sourceLabel,
        poolBand: 0,
        blockedReason: activeScenarioAfterImplementation.blockedReason,
        activeRow: null as Phase2Point | null,
        challengerRow: null as Phase2Point | null,
        activeRoleLabel: activeScenarioAfterImplementation.roleLabel,
      };
    }

    const seedRows: Phase2Point[] = [activeScenarioAfterImplementation.row];
    const challengerCandidates = [
      phase2ChampionChallenger.challenger,
      phase2CurrentRow,
      ...phase2Rows,
    ].filter((row): row is Phase2Point => Boolean(row));

    let selectedChallenger: Phase2Point | null = null;
    for (const candidate of challengerCandidates) {
      if (!seedRows.some((row) => isSameMix(row.source, candidate.source))) {
        seedRows.push(candidate);
        selectedChallenger = candidate;
        break;
      }
    }

    const sorted = [...seedRows].sort((a, b) => (
      (b.success40Assisted - a.success40Assisted)
      || (a.ruin20Assisted - b.ruin20Assisted)
      || (a.houseSalePct - b.houseSalePct)
    ));
    const best = sorted[0]?.success40Assisted ?? 0;
    const poolBand = phase3PoolBand(best);
    const rows = sorted.filter((row) => row.success40Assisted >= best - poolBand - 1e-9).slice(0, 4);
    if (rows.length < 2 && selectedChallenger && !rows.some((row) => isSameMix(row.source, selectedChallenger.source))) {
      rows.push(selectedChallenger);
    }
    if (rows.length < 2) {
      const fallback = sorted.find((row) => !rows.some((chosen) => isSameMix(chosen.source, row.source))) ?? null;
      if (fallback) rows.push(fallback);
    }
    return {
      rows,
      sourceLabel: activeScenarioAfterImplementation.sourceLabel,
      poolBand,
      blockedReason: null as string | null,
      activeRow: activeScenarioAfterImplementation.row,
      challengerRow: selectedChallenger,
      activeRoleLabel: activeScenarioAfterImplementation.roleLabel,
    };
  }, [activeScenarioAfterImplementation, phase2ChampionChallenger.challenger, phase2CurrentRow, phase2Rows]);
  const phase3InputRows = phase3Input.rows;
  const finalPolicyWinnerRow = useMemo(
    () => phase3Result?.preferred?.baseRow ?? null,
    [phase3Result],
  );
  const finalPolicyMatchesIntermediateTarget = useMemo(
    () => Boolean(finalPolicyWinnerRow && phase2ImplementationSelectedRow && isSameMix(finalPolicyWinnerRow.source, phase2ImplementationSelectedRow.source)),
    [finalPolicyWinnerRow, phase2ImplementationSelectedRow],
  );
  const phase3RawPolicyComparison = useMemo(() => {
    if (!phase3Result) return null;
    const raw = phase3Result.rawWinner;
    const policy = phase3Result.preferred;
    const sameWinner = Boolean(raw && policy && isSamePhase3Candidate(raw, policy));
    if (!raw) {
      return {
        raw,
        policy,
        sameWinner: false,
        reason: 'No hay ganador RAW calculable en esta corrida.',
      };
    }
    if (sameWinner) {
      return {
        raw,
        policy,
        sameWinner: true,
        reason: 'RAW y POLICY coinciden: resultado robusto.',
      };
    }
    if (!raw.eligibleByBand) {
      return {
        raw,
        policy,
        sameWinner: false,
        reason: 'Difieren por bandas de tolerancia activas.',
      };
    }
    if (!raw.guardrailsPassed) {
      return {
        raw,
        policy,
        sameWinner: false,
        reason: 'Difieren por guardrails activos.',
      };
    }
    if (!policy) {
      return {
        raw,
        policy,
        sameWinner: false,
        reason: 'Difieren porque POLICY exige mejora de QoL dentro de banda aceptable.',
      };
    }
    if (implementationPlan && !implementationPlan.equivalentToIdeal) {
      return {
        raw,
        policy,
        sameWinner: false,
        reason: 'Difieren por restricciones de implementación y validación realista.',
      };
    }
    return {
      raw,
      policy,
      sameWinner: false,
      reason: 'Difieren por QoL dentro de banda aceptable.',
    };
  }, [implementationPlan, phase3Result]);

  const runFinalImplementation = useCallback(async () => {
    if (finalImplementationRunning) return;
    if (!finalPolicyWinnerRow) {
      setFinalImplementationError('Primero ejecuta Fase 3 para definir un ganador POLICY final.');
      return;
    }
    setFinalImplementationRunning(true);
    setFinalImplementationError(null);
    setFinalImplementationPlan(null);
    setFinalImplementationNote(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const loaded = loadInstrumentImplementationUniverse(finalPolicyWinnerRow.source.weights);
      if (!loaded.universe) {
        throw new Error(loaded.warnings[0] ?? 'No hay instrument_universe cargado para implementar el ganador final.');
      }
      const plan = buildInstrumentImplementationPlan({
        universe: loaded.universe,
        targetWeights: finalPolicyWinnerRow.source.weights,
      });
      if (!plan) throw new Error('No se pudo construir el plan de implementación del ganador final.');
      if (activeDecisionFingerprintRef.current !== activeOptimizationInputFingerprint) return;
      setFinalImplementationPlan(plan);
      setFinalImplementationMeta(buildOptimizationResultMeta({
        inputFingerprint: activeOptimizationInputFingerprint,
        sourceMode: effectiveSourceMode,
        sourceLabel: activeSourceLabel,
        scenarioLabel: activeScenarioLabel,
        nSim: decisionFlowStatus?.nSim ?? activeParams.simulation.nSim,
        seed: decisionFlowStatus?.seed ?? activeParams.simulation.seed ?? 0,
      }));
      if (finalPolicyMatchesIntermediateTarget) {
        setFinalImplementationNote(
          implementationPlan
            ? 'El ganador final coincide con la implementación actual.'
            : 'El ganador final coincide con el objetivo intermedio de implementación.',
        );
      } else {
        setFinalImplementationNote('Se recalculó la implementación para el ganador recomendado.');
      }
    } catch (error) {
      setFinalImplementationError(error instanceof Error ? error.message : String(error));
    } finally {
      setFinalImplementationRunning(false);
    }
  }, [activeOptimizationInputFingerprint, activeParams.simulation.nSim, activeParams.simulation.seed, activeScenarioLabel, activeSourceLabel, decisionFlowStatus?.nSim, decisionFlowStatus?.seed, effectiveSourceMode, finalImplementationRunning, finalPolicyWinnerRow, finalPolicyMatchesIntermediateTarget, implementationPlan]);

  const runImplementation = useCallback(async () => {
    if (implementationRunning) return;
    if (!decisionImplementationReady) {
      setImplementationError('Confirma con simulación completa antes de implementar.');
      return;
    }
    const idealRow = phase2ImplementationSelectedRow;
    if (!idealRow) {
      setImplementationError('No hay recomendación principal oficial para construir implementación.');
      return;
    }
    setImplementationRunning(true);
    setImplementationError(null);
    setImplementationPlan(null);
    setFinalImplementationPlan(null);
    setFinalImplementationError(null);
    setFinalImplementationNote(null);
    setImplementationMeta(null);
    setFinalImplementationMeta(null);
    setRealisticValidation(null);
    setRealisticValidationError(null);
    setRealisticValidationMeta(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const loaded = loadInstrumentImplementationUniverse(idealRow.source.weights);
      if (!loaded.universe) {
        throw new Error(loaded.warnings[0] ?? 'No hay instrument_universe cargado para implementar el mix ideal.');
      }
      const plan = buildInstrumentImplementationPlan({
        universe: loaded.universe,
        targetWeights: idealRow.source.weights,
      });
      if (!plan) throw new Error('No se pudo construir un plan de implementación utilizable.');
      if (activeDecisionFingerprintRef.current !== activeOptimizationInputFingerprint) return;
      setImplementationPlan(plan);
      setImplementationMeta(buildOptimizationResultMeta({
        inputFingerprint: activeOptimizationInputFingerprint,
        sourceMode: effectiveSourceMode,
        sourceLabel: activeSourceLabel,
        scenarioLabel: activeScenarioLabel,
        nSim: decisionFlowStatus?.nSim ?? activeParams.simulation.nSim,
        seed: decisionFlowStatus?.seed ?? activeParams.simulation.seed ?? 0,
      }));
    } catch (error) {
      setImplementationError(error instanceof Error ? error.message : String(error));
    } finally {
      setImplementationRunning(false);
    }
  }, [activeOptimizationInputFingerprint, activeParams.simulation.nSim, activeParams.simulation.seed, activeScenarioLabel, activeSourceLabel, decisionFlowStatus?.nSim, decisionFlowStatus?.seed, decisionImplementationReady, effectiveSourceMode, implementationRunning, phase2ImplementationSelectedRow]);

  const runRealisticValidation = useCallback(async () => {
    if (realisticValidationRunning) return;
    const idealRow = phase2ImplementationSelectedRow;
    if (!implementationPlan || !idealRow || !implementationResultIsCurrent) {
      setRealisticValidationError('Primero ejecuta Implementación para validar el mix alcanzable.');
      return;
    }
    if (Math.abs(implementationPlan.gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9) {
      setRealisticValidation({
        row: idealRow,
        deltaVsIdealSuccessPp: 0,
        message: 'Implementación equivalente al objetivo ideal (no requiere validación adicional).',
      });
      setRealisticValidationMeta(buildOptimizationResultMeta({
        inputFingerprint: activeOptimizationInputFingerprint,
        sourceMode: effectiveSourceMode,
        sourceLabel: activeSourceLabel,
        scenarioLabel: activeScenarioLabel,
        nSim: decisionFlowStatus?.nSim ?? activeParams.simulation.nSim,
        seed: decisionFlowStatus?.seed ?? activeParams.simulation.seed ?? 0,
      }));
      setRealisticValidationError(null);
      return;
    }
    setRealisticValidationRunning(true);
    setRealisticValidationError(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const params = cloneParams(activeParams);
      params.weights = cloneParams(implementationPlan.reachableWeights);
      const sim = runSimulationCentral(params);
      const reachableRv = (implementationPlan.reachableWeights.rvGlobal + implementationPlan.reachableWeights.rvChile) * 100;
      const reachableRf = 100 - reachableRv;
      const row = toPhase2Point({
        ...idealRow.source,
        rvPct: Number(reachableRv.toFixed(1)),
        rfPct: Number(reachableRf.toFixed(1)),
        weights: cloneParams(implementationPlan.reachableWeights),
      }, sim);
      const deltaVsIdealSuccessPp = (row.success40Assisted - idealRow.success40Assisted) * 100;
      const message = Math.abs(deltaVsIdealSuccessPp) <= optimizerPolicyConfig.implementation.realisticValidationGapRvPp
        ? 'Implementación equivalente al objetivo (resultado prácticamente igual).'
        : 'La implementación real modifica el resultado del escenario ideal.';
      if (activeDecisionFingerprintRef.current !== activeOptimizationInputFingerprint) return;
      setRealisticValidation({ row, deltaVsIdealSuccessPp, message });
      setRealisticValidationMeta(buildOptimizationResultMeta({
        inputFingerprint: activeOptimizationInputFingerprint,
        sourceMode: effectiveSourceMode,
        sourceLabel: activeSourceLabel,
        scenarioLabel: activeScenarioLabel,
        nSim: decisionFlowStatus?.nSim ?? activeParams.simulation.nSim,
        seed: decisionFlowStatus?.seed ?? activeParams.simulation.seed ?? 0,
      }));
    } catch (error) {
      setRealisticValidationError(error instanceof Error ? error.message : String(error));
    } finally {
      setRealisticValidationRunning(false);
    }
  }, [activeOptimizationInputFingerprint, activeParams, activeParams.simulation.nSim, activeParams.simulation.seed, activeScenarioLabel, activeSourceLabel, decisionFlowStatus?.nSim, decisionFlowStatus?.seed, effectiveSourceMode, implementationPlan, implementationResultIsCurrent, phase2ImplementationSelectedRow, realisticValidationRunning]);

  const runLongevityPlus5 = useCallback(async () => {
    const selectedRow = phase2LongevitySelectedRow.row;
    if (!selectedRow || longevityRunning) return;
    setLongevityRunning(true);
    setLongevityError(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const extendedParams = buildLongevityPlus5Params(activeParams, selectedRow.source.weights);
      const shadow45 = runSimulationCentral(extendedParams);
      const success45 = shadow45.success40 ?? (1 - (shadow45.probRuin40 ?? shadow45.probRuin));
      const success40Base = selectedRow.success40Assisted;
      const carryAmong40 = success40Base > 0 ? (success45 / success40Base) : null;
      setLongevityResult({
        selectedLabel: `RV ${selectedRow.source.rvPct}% / RF ${selectedRow.source.rfPct}%`,
        selectedReason: phase2LongevitySelectedRow.reason,
        success40AssistedBase: success40Base,
        success45,
        drop40To45Pp: (success40Base - success45) * 100,
        carryAmong40,
        terminalP50All45: shadow45.p50TerminalAllPaths ?? null,
      });
    } catch (error) {
      setLongevityError(error instanceof Error ? error.message : String(error));
    } finally {
      setLongevityRunning(false);
    }
  }, [activeParams, longevityRunning, phase2LongevitySelectedRow]);

  const runPhase3 = useCallback(async () => {
    if (phase3Running || !phase3InputRows.length) return;
    setPhase3Running(true);
    setPhase3Error(null);
    setPhase3Result(null);
    setFinalImplementationPlan(null);
    setFinalImplementationError(null);
    setFinalImplementationNote(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const sortedBySuccess = [...phase3InputRows].sort((a, b) => (
        (b.success40Assisted - a.success40Assisted)
        || (a.ruin20Assisted - b.ruin20Assisted)
        || (a.houseSalePct - b.houseSalePct)
      ));
      const bestSuccessRow = sortedBySuccess[0];
      if (!bestSuccessRow) throw new Error('No hay escenarios relevantes de Fase 2 para Fase 3.');

      const bestSuccess = bestSuccessRow.success40Assisted;
      const successBand = phase3SuccessBand(bestSuccess);
      const minimumSuccess = bestSuccess - successBand;
      const baseSpendingVector = getSpendingVector(activeParams);
      const candidates: Phase3Candidate[] = [];

      for (const row of phase3InputRows) {
        for (const variant of PHASE3_SPENDING_VARIANTS) {
          const candidateParams = buildPhase3SpendingParams(activeParams, row.source.weights, variant);
          const sim = runSimulationCentral(candidateParams);
          const spendingVector = getSpendingVector(candidateParams);
          const qualityOfLifeScore = computeQualityOfLifeScore(baseSpendingVector, spendingVector);
          const success40 = sim.success40 ?? (1 - (sim.probRuin40 ?? sim.probRuin));
          const candidate: Phase3Candidate = {
            baseRow: row,
            variant,
            spendingVector,
            success40,
            ruin20: sim.probRuin20 ?? 0,
            cutScenarioPct: Number.isFinite(sim.cutScenarioPct ?? Number.NaN) ? (sim.cutScenarioPct as number) : null,
            houseSalePct: sim.houseSalePct ?? 0,
            drawdownP50: sim.maxDrawdownPercentiles[50] ?? 0,
            qualityOfLifeScore,
            weightedSpendingImprovementPct: (qualityOfLifeScore - 1) * 100,
            deltaVsBestSuccessPp: (success40 - bestSuccess) * 100,
            guardrailViolations: [],
            eligibleByBand: success40 >= minimumSuccess - 1e-9,
            guardrailsPassed: false,
          };
          candidate.guardrailViolations = buildPhase3GuardrailViolations(bestSuccessRow, candidate);
          candidate.guardrailsPassed = candidate.guardrailViolations.length === 0;
          candidates.push(candidate);
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      }

      const eligibleCandidates = candidates.filter((candidate) => candidate.eligibleByBand && candidate.guardrailsPassed);
      const improvedEligibleCandidates = eligibleCandidates.filter((candidate) => candidate.qualityOfLifeScore > 1.0001);
      const rawRanked = [...candidates].sort((a, b) => (
        (b.success40 - a.success40)
        || (a.ruin20 - b.ruin20)
        || (a.houseSalePct - b.houseSalePct)
        || (b.qualityOfLifeScore - a.qualityOfLifeScore)
      ));
      const rawWinner = rawRanked[0] ?? null;
      const rawRunnerUp = rawRanked.find((candidate) => rawWinner && !isSamePhase3Candidate(candidate, rawWinner)) ?? null;
      const rankedEligible = [...improvedEligibleCandidates].sort((a, b) => (
        (b.qualityOfLifeScore - a.qualityOfLifeScore)
        || (b.success40 - a.success40)
        || (a.ruin20 - b.ruin20)
        || (a.houseSalePct - b.houseSalePct)
      ));
      const preferred = rankedEligible[0] ?? null;
      const runnerUp = rankedEligible.find((candidate) => (
        !preferred
        || !isSameMix(candidate.baseRow.source, preferred.baseRow.source)
        || candidate.variant.id !== preferred.variant.id
      )) ?? null;

      setPhase3Result({
        relevantRows: phase3InputRows,
        bestSuccessRow,
        rawWinner,
        rawRunnerUp,
        runnerUp,
        poolBand: phase3Input.poolBand,
        successBand,
        minimumSuccess,
        variantsTested: PHASE3_SPENDING_VARIANTS,
        candidatesEvaluated: candidates.length,
        eligibleCandidates: eligibleCandidates.length,
        preferred,
      });
    } catch (error) {
      setPhase3Error(error instanceof Error ? error.message : String(error));
    } finally {
      setPhase3Running(false);
    }
  }, [activeParams, phase3Input.poolBand, phase3InputRows, phase3Running]);

  const classifyRescueDependency = useCallback((row: Phase2Point): string => {
    const house = row.houseSalePct;
    const cut = row.cutScenarioPct ?? 0;
    if (house > 0.30 || cut > 0.35) return 'Dependencia alta de rescates';
    if (house > 0.15 || cut > 0.20) return 'Dependencia media de rescates';
    return 'Dependencia baja de rescates';
  }, []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Optimización</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Calcula el Óptimo MIDAS recomendado y confirma la corrida completa antes de implementar traspasos.
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Modo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
          {modeCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => card.enabled && setMode(card.id)}
              disabled={!card.enabled}
              style={{
                background: card.active ? T.primary : T.surfaceEl,
                border: `1px solid ${card.active ? T.primary : T.border}`,
                color: card.active ? '#fff' : card.enabled ? T.textSecondary : T.textMuted,
                borderRadius: 10,
                padding: '8px 10px',
                textAlign: 'left',
                cursor: card.enabled ? 'pointer' : 'not-allowed',
                opacity: card.enabled ? 1 : 0.75,
                display: 'grid',
                gap: 3,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{card.label}</span>
              <span style={{ fontSize: 10 }}>{card.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: T.textMuted, fontSize: 11 }}>Fuente activa</div>
          <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>{activeSourceLabel}</div>
        </div>
        {activeScenarioLabel ? (
          <div style={{ color: T.textMuted, fontSize: 10 }}>Escenario: {activeScenarioLabel}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSourceMode('base')}
            style={{
              background: effectiveSourceMode === 'base' ? T.primary : T.surfaceEl,
              border: `1px solid ${effectiveSourceMode === 'base' ? T.primary : T.border}`,
              color: effectiveSourceMode === 'base' ? '#fff' : T.textSecondary,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Base vigente
          </button>
          <button
            type="button"
            onClick={() => simulationActive && setSourceMode('simulation')}
            disabled={!simulationActive}
            title={simulationSourceDisabledReason ?? 'Usar Simulación activa'}
            style={{
              background: effectiveSourceMode === 'simulation' ? T.primary : T.surfaceEl,
              border: `1px solid ${effectiveSourceMode === 'simulation' ? T.primary : T.border}`,
              color: effectiveSourceMode === 'simulation' ? '#fff' : T.textSecondary,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: simulationActive ? 'pointer' : 'not-allowed',
              opacity: simulationActive ? 1 : 0.65,
            }}
          >
            Simulación activa
          </button>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ color: T.textSecondary, fontSize: 11 }}>{sourceDescription}</div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>{sourceDeltaSummary}</div>
          {simulationSourceDisabledReason ? (
            <div style={{ color: T.textMuted, fontSize: 10 }}>{simulationSourceDisabledReason}</div>
          ) : null}
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gap: 5 }}>
          <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 900, lineHeight: 1.2 }}>Óptimo MIDAS recomendado</div>
          <div style={{ color: T.textSecondary, fontSize: 12, lineHeight: 1.45 }}>
            Calcula el mix recomendado para tu perfil. MIDAS compara el óptimo financiero con una recomendación ajustada por calidad de vida, holgura, recortes y estabilidad.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={runDecisionProfiles}
            disabled={decisionProfilesRunning || mode !== 'light'}
            style={{
              background: decisionProfilesRunning ? T.surfaceEl : T.primary,
              border: `1px solid ${decisionProfilesRunning ? T.border : T.primary}`,
              color: decisionProfilesRunning ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '8px 13px',
              fontSize: 12,
              fontWeight: 800,
              cursor: decisionProfilesRunning || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: mode !== 'light' ? 0.65 : 1,
            }}
          >
            {decisionProfilesRunning ? 'Calculando Óptimo MIDAS…' : 'Calcular Óptimo MIDAS recomendado'}
          </button>
          <button
            type="button"
            onClick={runDecisionConfirmation}
            disabled={decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed'}
            style={{
              background: decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? T.surface : T.surfaceEl,
              border: `1px solid ${T.border}`,
              color: decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? T.textMuted : T.textPrimary,
              borderRadius: 999,
              padding: '8px 13px',
              fontSize: 12,
              fontWeight: 800,
              cursor: decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? 'not-allowed' : 'pointer',
              opacity: !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? 0.7 : 1,
            }}
          >
            {decisionFlowStatus?.stage === 'confirmed'
              ? 'Confirmación completa lista'
              : recommendationIsOfficial
                ? 'Confirmar con simulación completa'
                : 'Confirmar mejor opción disponible'}
          </button>
          {decisionProfilesRunning ? (
            <button
              type="button"
              onClick={() => {
                decisionCancelRequestedRef.current = true;
                setDecisionCancelRequested(true);
              }}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                color: T.textPrimary,
                borderRadius: 999,
                padding: '8px 13px',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Cancelar cálculo
            </button>
          ) : null}
          {!decisionProfilesRunning && decisionExecutionState === 'interrupted' ? (
            <button
              type="button"
              onClick={resumeDecisionRun}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                color: T.textPrimary,
                borderRadius: 999,
                padding: '8px 13px',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Reanudar cálculo
            </button>
          ) : null}
          {!decisionProfilesRunning && decisionExecutionState === 'interrupted' ? (
            <button
              type="button"
              onClick={runDecisionProfiles}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                color: T.textSecondary,
                borderRadius: 999,
                padding: '8px 13px',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Reiniciar cálculo
            </button>
          ) : null}
        </div>
        {decisionProfilesError ? <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>{decisionProfilesError}</div> : null}
        {decisionBackgroundHint ? <div style={{ color: T.warning, fontSize: 10 }}>{decisionBackgroundHint}</div> : null}
        {decisionExecutionState === 'background' ? (
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            Chrome puede ralentizar cálculos en segundo plano; se verificará el progreso al volver.
          </div>
        ) : null}
        {decisionFlowStatus ? (
          <div style={{ display: 'grid', gap: 4, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', background: T.surfaceEl }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: T.textPrimary, fontSize: 11, fontWeight: 900 }}>{decisionFlowStatus.badge}</span>
              <span style={{ color: T.textMuted, fontSize: 10 }}>
                {decisionFlowStatus.badge} · {decisionFlowStatus.candidateCount} mixes · {decisionProgress?.total ?? 0} unidades · nSim {decisionFlowStatus.nSim.toLocaleString('es-ES')} · seed {decisionFlowStatus.seed}{decisionFlowStatus.stepPp !== null ? ` · malla ${decisionFlowStatus.stepPp}pp` : ' · shortlist refinada con vecinos ±5pp/±10pp'}
              </span>
            </div>
            <div style={{ color: T.textSecondary, fontSize: 10 }}>{decisionFlowStatus.message}</div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Fuente usada: {decisionFlowStatus.sourceLabel}{decisionFlowStatus.ranAtLabel ? ` · ${decisionFlowStatus.ranAtLabel}` : ''}
            </div>
            {decisionFlowStatus.scenarioLabel ? (
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Escenario: {decisionFlowStatus.scenarioLabel}
              </div>
            ) : null}
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Estado ejecución: {decisionExecutionState === 'running'
                ? 'Calculando'
                : decisionExecutionState === 'background'
                  ? 'Cálculo en segundo plano'
                  : decisionExecutionState === 'restarting'
                    ? 'Reanudando'
                    : decisionExecutionState === 'interrupted'
                      ? 'Interrumpido'
                      : decisionExecutionState === 'completed'
                        ? 'Finalizado'
                        : 'Inactivo'}
            </div>
            {decisionFlowStatus.stage === 'zoom' ? (
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                El refinamiento local compara mixes oficiales de la grilla 5pp alrededor del ancla seleccionada.
              </div>
            ) : null}
            {decisionProgress ? (
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Progreso: {decisionProgress.stage} · {decisionProgress.evaluated}/{decisionProgress.total} corridas · nSim {decisionProgress.nSim.toLocaleString('es-ES')} · seed {decisionProgress.seed}
                {decisionCancelRequested ? ' · cancelación solicitada' : ''}
              </div>
            ) : null}
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Ruta: Express {lastExpressCandidate?.mixLabel ?? 'No disponible'} → Zoom {lastZoomCandidate?.mixLabel ?? 'No disponible'} → Confirmación {lastConfirmedCandidate?.mixLabel ?? 'No disponible'}
            </div>
          </div>
        ) : null}
        {recommendationIsOfficial ? (
          <>
            <div style={{
              border: `1px solid ${decisionFlowStatus?.stage === 'confirmed' ? T.primary : T.border}`,
              borderRadius: 12,
              padding: 12,
              background: decisionFlowStatus?.stage === 'confirmed' ? '#0d1224' : T.surfaceEl,
              display: 'grid',
              gap: 7,
              opacity: decisionFlowStatus?.stage === 'confirmed' ? 1 : 0.88,
            }}>
              {decisionFlowStatus?.stage !== 'confirmed' ? (
                <div style={{ color: T.warning, fontSize: 11, fontWeight: 900 }}>
                  {decisionFlowStatus?.stage === 'zoom' ? 'Preliminar · Zoom refinado' : 'Preliminar · Express'} · No implementar
                </div>
              ) : null}
              <div style={{ color: decisionFlowStatus?.stage === 'confirmed' ? '#fff' : T.textPrimary, fontSize: 13, fontWeight: 900 }}>Óptimo MIDAS recomendado</div>
              <div style={{ color: decisionFlowStatus?.stage === 'confirmed' ? '#fff' : T.textPrimary, fontSize: 24, fontWeight: 900 }}>{officialMainRecommendation!.mixLabel}</div>
              <div style={{ color: T.textMuted, fontSize: 11 }}>
                Mix elegido por el modelo al equilibrar calidad base, holgura futura, recortes y estabilidad.
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Fuente usada: {decisionResultMeta?.sourceLabel ?? activeSourceLabel}
              </div>
              {decisionResultMeta?.scenarioLabel ? (
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Escenario: {decisionResultMeta.scenarioLabel}
                </div>
              ) : null}
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Estado: {decisionFlowStatus?.badge ?? 'Preliminar pendiente'} · Referencia defensiva: {officialDefensiveReference?.mixLabel ?? 'No disponible'} · Alternativa de holgura: {officialHeadroomAlternative?.mixLabel ?? 'No disponible'} · Benchmark extremo: {officialBenchmarkExtreme?.mixLabel ?? 'RV 100 / RF 0'}
              </div>
              {decisionFlowWarning ? <div style={{ color: T.warning, fontSize: 10 }}>{decisionFlowWarning}</div> : null}
              {officialRecommendationWarning ? <div style={{ color: T.warning, fontSize: 10 }}>{officialRecommendationWarning}</div> : null}
            </div>

            {financialOptimum ? (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>Óptimo financiero</div>
                  <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 800 }}>Referencia previa · no compite en la recomendación MIDAS</div>
                </div>
                <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 900 }}>{financialOptimum.mixLabel}</div>
                <div style={{ color: T.textSecondary, fontSize: 11, lineHeight: 1.45 }}>
                  Referencia autónoma: estima qué mix reduce mejor el riesgo financiero sin venta de casa, sin recortes adaptativos y sin capital de riesgo. No es la recomendación final.
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Métrica financiera usada: éxito {formatPct(financialOptimum.success40)} · ruina20 {formatPct(financialOptimum.ruin20)} · MaxDD P50 {formatPctOrNA(financialOptimum.drawdownP50)} · P50 terminal informativo {formatClpShort(financialOptimum.terminalWealthP50)} · Estado: {decisionFlowStatus?.badge ?? 'Preliminar pendiente'} · {financialOptimum.candidateId === officialMainRecommendation!.candidateId ? 'Coincide con el Óptimo MIDAS recomendado.' : `Difiere del Óptimo MIDAS recomendado (${officialMainRecommendation!.mixLabel}).`}
                </div>
              </div>
            ) : null}

            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl, display: 'grid', gap: 8 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>Escenarios evaluados por el modelo</div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                El óptimo financiero queda fuera de este bloque: aquí compiten solo perfiles evaluados por calidad, holgura, recortes y estabilidad.
              </div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                {[
                  officialDefensiveReference ? {
                    key: 'defensive',
                    title: 'Referencia defensiva',
                    copy: 'Prioriza estabilidad base y menos recortes.',
                    candidate: officialDefensiveReference,
                    extra: null as string | null,
                  } : null,
                  {
                    key: 'main',
                    title: 'Óptimo MIDAS recomendado',
                    copy: 'Equilibrio elegido por el modelo.',
                    candidate: officialMainRecommendation,
                    extra: null as string | null,
                  },
                  officialHeadroomAlternative ? {
                    key: 'headroom',
                    title: 'Alternativa de mayor holgura',
                    copy: 'Prioriza más holgura futura, si existe una mejora material.',
                    candidate: officialHeadroomAlternative,
                    extra: 'No fue recomendación principal porque el modelo mantiene el intercambio explícito entre calidad base y holgura.',
                  } : (
                    closestDiscardedCompetitor.candidate ? {
                      key: 'discarded',
                      title: 'Competidor más cercano descartado',
                      copy: closestDiscardedCompetitor.reason,
                      candidate: closestDiscardedCompetitor.candidate,
                      extra: null as string | null,
                    } : null
                  ),
                ].filter((item): item is { key: string; title: string; copy: string; candidate: RvRfDecisionCandidate; extra: string | null } => Boolean(item)).map((item) => (
                  <div key={item.key} style={{ border: `1px solid ${item.key === 'main' ? T.primary : T.border}`, borderRadius: 9, padding: 9, background: T.surface, display: 'grid', gap: 5 }}>
                    <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 900 }}>{item.title}</div>
                    <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 900 }}>{item.candidate.mixLabel}</div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>{item.copy}</div>
                    <div style={{ color: T.textSecondary, fontSize: 10 }}>
                      QASR base {formatScore100(item.candidate.qasrBase)} · QASR +20 {formatScore100(item.candidate.qasrAt120)} · CSR {formatPctOrNA(item.candidate.csrBase)}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 10 }}>
                      Ruina {formatPctOrNA(item.candidate.ruinRate)} · Recorte severo {formatMonthsHuman(item.candidate.monthsInSevereCutMean)} · Racha P75 {formatMonthsHuman(item.candidate.maxConsecutiveSevereCutMonthsP75)}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 10 }}>P50 final {formatClpShort(item.candidate.terminalWealthP50)}</div>
                    {item.extra ? <div style={{ color: T.textMuted, fontSize: 10 }}>{item.extra}</div> : null}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl, display: 'grid', gap: 8 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>Qué cambia frente a tu mix actual</div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                {decisionFlowStatus?.stage === 'confirmed' ? 'Comparación confirmada' : 'Comparación preliminar'} entre el mix actual exacto de la fuente activa y el Óptimo MIDAS recomendado. No usa el óptimo financiero.
              </div>
              <div style={{ color: currentDecisionCandidate ? T.textMuted : T.warning, fontSize: 10 }}>
                {currentDecisionCandidate ? currentReconciliationMessage : 'Mix actual pendiente de evaluar en esta etapa.'}
              </div>
              {currentDecisionCandidate ? (
              <div style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textMuted, fontSize: 10, fontWeight: 800 }}>
                  <div>Variable</div>
                  <div>Actual</div>
                  <div>Óptimo MIDAS</div>
                  <div>Cambio</div>
                </div>
                {currentVsMidasRows.map((row) => (
                  <div key={`${row.section}-${row.label}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textSecondary, fontSize: 10, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                    <div style={{ color: T.textPrimary, fontWeight: 700 }}>{row.label}</div>
                    <div>{row.current}</div>
                    <div>{row.recommended}</div>
                    <div>{row.change}</div>
                  </div>
                ))}
              </div>
              ) : null}
              {currentVsMidasTradeoffs ? (
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 900 }}>Qué ganas</div>
                    {(currentVsMidasTradeoffs.gains.length ? currentVsMidasTradeoffs.gains : ['No aparece una mejora material clara con los datos disponibles.']).map((item) => (
                      <div key={`gain-${item}`} style={{ color: T.textSecondary, fontSize: 10, marginTop: 4 }}>{item}</div>
                    ))}
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 900 }}>Qué sacrificas</div>
                    {(currentVsMidasTradeoffs.sacrifices.length ? currentVsMidasTradeoffs.sacrifices : ['No aparece un sacrificio material claro con los datos disponibles.']).map((item) => (
                      <div key={`sacrifice-${item}`} style={{ color: T.textSecondary, fontSize: 10, marginTop: 4 }}>{item}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              {currentVsMidasTradeoffs?.marginal ? (
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  El cambio frente al mix actual es marginal. No parece justificar traspasos por sí solo.
                </div>
              ) : null}
            </div>
          </>
        ) : needsBestAvailableFallback && bestAvailableRecommendation ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ border: `1px solid ${T.warning}`, borderRadius: 12, padding: 12, background: 'rgba(255,176,32,0.08)', display: 'grid', gap: 7 }}>
              <div style={{ color: T.warning, fontSize: 11, fontWeight: 900 }}>Contingencia · No apta estándar MIDAS</div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>Mejor opción disponible bajo escenario exigente</div>
              <div style={{ color: T.textPrimary, fontSize: 24, fontWeight: 900 }}>{bestAvailableRecommendation.mixLabel}</div>
              <div style={{ color: T.textMuted, fontSize: 11 }}>
                No cumple todos los guardrails MIDAS, pero es la alternativa menos mala entre los mixes evaluados.
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                QASR base {formatScore100(bestAvailableRecommendation.qasrBase)} · QASR +20 {formatScore100(bestAvailableRecommendation.qasrAt120)} · CSR {formatPctOrNA(bestAvailableRecommendation.csrBase)}
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Ruina {formatPctOrNA(bestAvailableRecommendation.ruinRate)} · Recorte severo {formatMonthsHuman(bestAvailableRecommendation.monthsInSevereCutMean)} · Racha severa P75 {formatMonthsHuman(bestAvailableRecommendation.maxConsecutiveSevereCutMonthsP75)}
              </div>
              <div style={{ color: T.warning, fontSize: 10 }}>
                Fallos de guardrails: {bestAvailableRecommendation.failedGuardrails.length ? bestAvailableRecommendation.failedGuardrails.join(', ') : 'sin detalle'}
              </div>
              <div style={{ color: T.warning, fontSize: 10 }}>
                Este resultado no cumple estándar MIDAS. Sirve como alternativa de contingencia dentro de las opciones evaluadas, no como recomendación oficial apta.
              </div>
            </div>
            {fallbackGuardrailSummary ? (
              <details style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', background: T.surfaceEl }}>
                <summary style={{ cursor: 'pointer', color: T.textSecondary, fontSize: 10, fontWeight: 700 }}>
                  Diagnóstico de guardrails
                </summary>
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Mixes evaluados {fallbackGuardrailSummary.total} · pasan {fallbackGuardrailSummary.passed} · fallan {fallbackGuardrailSummary.failed}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Causas principales: {fallbackGuardrailSummary.topReasons.length
                      ? fallbackGuardrailSummary.topReasons.map(([reason, count]) => `${reason} (${count})`).join(' · ')
                      : 'Sin causas registradas'}
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {(baseDecisionProfiles?.rows ?? []).map((row) => (
                      <div key={`guardrail-${row.candidateId}`} style={{ color: T.textMuted, fontSize: 10, borderTop: `1px solid ${T.border}`, paddingTop: 4 }}>
                        {row.mixLabel} · QASR {formatScore100(row.qasrBase)} · Ruina {formatPctOrNA(row.ruinRate)} · Recorte {formatMonthsHuman(row.monthsInSevereCutMean)} · Racha P75 {formatMonthsHuman(row.maxConsecutiveSevereCutMonthsP75)} · {row.passesHardGuardrails ? 'pasa' : `falla (${row.failedGuardrails.join(', ') || 'sin detalle'})`}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl, display: 'grid', gap: 8 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>Qué cambia frente a tu mix actual — alternativa de contingencia</div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                {decisionFlowStatus?.stage === 'confirmed' ? 'Comparación confirmada' : 'Comparación preliminar'} entre el mix actual exacto de la fuente activa y la mejor opción disponible.
              </div>
              <div style={{ color: currentDecisionCandidate ? T.textMuted : T.warning, fontSize: 10 }}>
                {currentDecisionCandidate ? currentReconciliationMessage : 'Mix actual pendiente de evaluar en esta etapa.'}
              </div>
              {currentDecisionCandidate ? (
                <div style={{ display: 'grid', gap: 5 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textMuted, fontSize: 10, fontWeight: 800 }}>
                    <div>Variable</div>
                    <div>Actual</div>
                    <div>Contingencia</div>
                    <div>Cambio</div>
                  </div>
                  {currentVsMidasRows.map((row) => (
                    <div key={`fallback-${row.section}-${row.label}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textSecondary, fontSize: 10, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                      <div style={{ color: T.textPrimary, fontWeight: 700 }}>{row.label}</div>
                      <div>{row.current}</div>
                      <div>{row.recommended}</div>
                      <div>{row.change}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : hasDecisionRunResult ? (
          <div style={{ color: T.warning, fontSize: 10, fontWeight: 700 }}>
            No hay candidatos oficiales para evaluar.
          </div>
        ) : (
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            Ejecuta el cálculo para obtener una recomendación preliminar. La implementación queda bloqueada hasta confirmación oficial.
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 900 }}>Implementación sugerida</div>
        <div style={{ color: T.textSecondary, fontSize: 11 }}>
          Usa el resultado confirmado del candidato accionable actual (oficial o contingencia).
        </div>
        {recommendationIsContingency && decisionFlowStatus?.stage === 'confirmed' && actionableRecommendationCandidate ? (
          <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
            Implementación de contingencia: el candidato confirmado no cumple estándar MIDAS.
          </div>
        ) : null}
        {!decisionImplementationReady ? (
          <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
            {!decisionResultIsCurrent && decisionResultMeta
              ? `Resultado anterior: calculado con ${decisionResultMeta.sourceLabel}. Vuelve a ejecutar antes de implementar.`
              : decisionFlowStatus?.stage === 'confirmed' && !currentDecisionCandidate
              ? 'No se pudo evaluar el mix actual exacto. No se puede comparar ni implementar.'
              : 'Confirma con simulación completa antes de implementar.'}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={runImplementation}
            disabled={implementationRunning || !phase2ImplementationSelectedRow || !decisionImplementationReady}
            style={{
              background: implementationRunning ? T.surface : T.primary,
              border: `1px solid ${implementationRunning ? T.border : T.primary}`,
              color: implementationRunning ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 800,
              cursor: implementationRunning || !phase2ImplementationSelectedRow || !decisionImplementationReady ? 'not-allowed' : 'pointer',
              opacity: !phase2ImplementationSelectedRow || !decisionImplementationReady ? 0.6 : 1,
            }}
          >
            {implementationRunning ? 'Calculando implementación…' : 'Calcular implementación'}
          </button>
          <button
            type="button"
            onClick={runRealisticValidation}
            disabled={realisticValidationRunning || !implementationPlan || !implementationResultIsCurrent || implementationPlan.equivalentToIdeal}
            style={{
              background: realisticValidationRunning ? T.surface : T.surfaceEl,
              border: `1px solid ${T.border}`,
              color: realisticValidationRunning ? T.textMuted : T.textPrimary,
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 800,
              cursor: realisticValidationRunning || !implementationPlan || !implementationResultIsCurrent || implementationPlan.equivalentToIdeal ? 'not-allowed' : 'pointer',
              opacity: !implementationPlan || !implementationResultIsCurrent || implementationPlan.equivalentToIdeal ? 0.6 : 1,
            }}
          >
            {implementationPlan?.equivalentToIdeal ? 'Validación no necesaria' : realisticValidationRunning ? 'Validando mix alcanzable…' : 'Validar mix alcanzable'}
          </button>
        </div>
        {implementationError ? <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>{implementationError}</div> : null}
        {implementationPlan ? (
          <div style={{ display: 'grid', gap: 7 }}>
            {(() => {
              const gapAbsPp = Math.abs(implementationPlan.gapVsIdealRvPp);
              const statusLabel = gapAbsPp <= 1.5
                ? 'Implementable'
                : gapAbsPp <= 3
                  ? 'Parcial cercana'
                  : implementationPlan.restrictionsApplied.crossCurrency
                    ? 'Requiere cambio moneda'
                    : 'Implementación parcial';
              return (
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceEl, display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                    Operaciones: {implementationPlan.transfers.length} · Total a mover: {implementationMateriality ? formatClpShort(implementationMateriality.totalTradeClp) : '—'}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Objetivo {formatMixPair(implementationPlan.targetMixIdeal)} · Alcanzado {formatMixPair(implementationPlan.reachableMix)} · Gap restante {formatSignedPp(implementationPlan.gapVsIdealRvPp)} · Estado: {statusLabel}
                  </div>
                </div>
              );
            })()}
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceEl }}>
                <div style={{ color: T.textMuted, fontSize: 10 }}>Mix actual</div>
                <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>{formatMixPair(implementationPlan.currentMix)}</div>
              </div>
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceEl }}>
                <div style={{ color: T.textMuted, fontSize: 10 }}>Óptimo MIDAS recomendado</div>
                <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>{formatMixPair(implementationPlan.targetMixIdeal)}</div>
              </div>
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceEl }}>
                <div style={{ color: T.textMuted, fontSize: 10 }}>Gap RV/RF</div>
                <div style={{ color: implementationMateriality?.status === 'recommended' ? T.warning : T.positive, fontSize: 15, fontWeight: 800 }}>
                  {implementationMateriality ? formatSignedPp(implementationMateriality.gapRvPp) : formatSignedPp(Math.abs(implementationPlan.gapVsIdealRvPp))}
                </div>
              </div>
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceEl }}>
                <div style={{ color: T.textMuted, fontSize: 10 }}>Movimiento sugerido total</div>
                <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>{implementationMateriality ? formatClpShort(implementationMateriality.totalTradeClp) : '—'}</div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>{implementationMateriality ? `${implementationMateriality.totalTradePortfolioPct.toFixed(2).replace('.', ',')}% cartera` : 'No disponible'}</div>
              </div>
            </div>
            {implementationPlan.transfers.length ? (
              <div style={{ display: 'grid', gap: 8, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl }}>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 900 }}>
                  {recommendationIsContingency ? 'Implementación de contingencia por instrumentos' : 'Traspasos sugeridos por instrumento'}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Operaciones sugeridas: {implementationPlan.transfers.length} · Total a mover {implementationMateriality ? formatClpShort(implementationMateriality.totalTradeClp) : '—'} · Monto CLP como dato principal.
                </div>
                {implementationPlan.stageSummaries.length ? (
                  <div style={{ display: 'grid', gap: 4, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Resumen por tramo</div>
                    {implementationPlan.stageSummaries.map((stage) => (
                      <div key={`stage-summary-${stage.stage}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1.2fr) repeat(4, minmax(0, 1fr))', gap: 8, color: T.textMuted, fontSize: 10 }}>
                        <div style={{ color: T.textSecondary, fontWeight: 700 }}>
                          {implementationStageLabel(stage.stage)}
                        </div>
                        <div>{stage.used ? `${stage.operationCount} ops` : implementationStageReasonLabel(stage.statusReason)}</div>
                        <div>{stage.used ? formatClpShort(stage.movedClp) : '—'}</div>
                        <div>{formatMixPair(stage.reachedMix)}</div>
                        <div>Gap {formatSignedPp(stage.remainingGapRvPp)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, color: T.textSecondary }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: `1px solid ${T.border}` }}>
                        <th style={{ padding: '6px 6px' }}>Tramo</th>
                        <th style={{ padding: '6px 6px' }}>Monto</th>
                        <th style={{ padding: '6px 6px' }}>Desde</th>
                        <th style={{ padding: '6px 6px' }}>Hacia</th>
                        <th style={{ padding: '6px 6px' }}>Moneda</th>
                        <th style={{ padding: '6px 6px' }}>Manager</th>
                        <th style={{ padding: '6px 6px' }}>Razón</th>
                        <th style={{ padding: '6px 6px' }}>Restricción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...implementationPlan.transfers]
                        .sort((a, b) => b.amountClpMoved - a.amountClpMoved)
                        .map((transfer, index) => (
                          <tr key={`main-transfer-row-${transfer.fromInstrumentId}-${transfer.toInstrumentId}-${index}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                            <td style={{ padding: '6px 6px', whiteSpace: 'nowrap', color: T.textPrimary, fontWeight: 700 }}>
                              {implementationStageLabel(transfer.stage)}
                            </td>
                            <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                              <div style={{ color: T.textPrimary, fontWeight: 800 }}>{formatClpShort(transfer.amountClpMoved)}</div>
                              <div style={{ color: T.textMuted }}>{formatNativeAmount(transfer.amountNativeMoved, transfer.nativeCurrency)} ({(transfer.weightMoved * 100).toFixed(2)}%)</div>
                            </td>
                            <td style={{ padding: '6px 6px' }}>{transfer.fromName}</td>
                            <td style={{ padding: '6px 6px' }}>{transfer.toName}</td>
                            <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>{transfer.fromCurrency ?? transfer.nativeCurrency ?? 'ND'} → {transfer.toCurrency ?? 'ND'}</td>
                            <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>{transfer.fromManager ?? 'ND'} → {transfer.toManager ?? 'ND'}</td>
                            <td style={{ padding: '6px 6px' }}>{transfer.rationale}</td>
                            <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                              {transfer.constraints.crossCurrency
                                ? 'Cross-currency'
                                : transfer.constraints.crossManager
                                  ? 'Cross-manager'
                                  : 'Limpio'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 7, border: `1px solid ${T.warning}`, borderRadius: 10, padding: 10, background: T.surfaceEl }}>
                <div style={{ color: T.warning, fontSize: 12, fontWeight: 900 }}>No implementable automáticamente por instrumento</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  No se encontraron traspasos ejecutables con las restricciones actuales.
                </div>
                {implementationPlan.warnings.length ? (
                  <div style={{ display: 'grid', gap: 2 }}>
                    {implementationPlan.warnings.map((warning) => (
                      <div key={`main-warning-${warning}`} style={{ color: T.warning, fontSize: 10 }}>{warning}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Puede faltar instrumento destino compatible en el universo actual, metadata de moneda/manager/wrapper, o capacidad suficiente bajo restricciones operativas.
                  </div>
                )}
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Diagnóstico técnico de composición alcanzada</div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>Esto es una guía por sleeve, no una instrucción operativa por instrumento.</div>
                  {implementationSleeveMoneyGuide.length ? implementationSleeveMoneyGuide.map((line) => (
                    <div key={`main-money-guide-${line}`} style={{ color: T.textSecondary, fontSize: 10 }}>{line}</div>
                  )) : (
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      No hay suficiente información para convertir el gap por sleeve a montos CLP accionables.
                    </div>
                  )}
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Para implementar esto falta un instrumento destino compatible en RV/RF, con moneda compatible e idealmente mismo manager y wrapper.
                  </div>
                </div>
              </div>
            )}
            {implementationPlan.destinationDiagnostics.some((row) => !row.used) ? (
              <div style={{ display: 'grid', gap: 6, border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surfaceEl }}>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                  Candidatos RV no usados / parcialmente usados
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {implementationPlan.destinationDiagnostics
                    .filter((row) => !row.used && row.rv >= 0.5)
                    .slice(0, 8)
                    .map((row) => (
                      <div key={`diag-${row.instrumentId}`} style={{ color: T.textMuted, fontSize: 10 }}>
                        {row.name}: {row.eligible ? 'elegible' : 'no elegible'} · {row.reason}
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
            <div style={{ display: 'grid', gap: 7, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl }}>
              <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 900 }}>Mix objetivo vs mix alcanzado estimado</div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Este es el mix estimado después de aplicar los traspasos sugeridos. Puede diferir del objetivo MIDAS por restricciones de instrumentos.
              </div>
              <div style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textMuted, fontSize: 10, fontWeight: 800 }}>
                  <div>Variable</div>
                  <div>Objetivo</div>
                  <div>Alcanzado estimado</div>
                  <div>Gap</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textSecondary, fontSize: 10, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                  <div style={{ color: T.textPrimary, fontWeight: 800 }}>RV total</div>
                  <div>{formatPctValue(implementationPlan.targetMixIdeal.rv)}</div>
                  <div>{formatPctValue(implementationPlan.reachableMix.rv)}</div>
                  <div>{formatSignedPp(implementationPlan.gapVsIdealRvPp)}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textSecondary, fontSize: 10, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                  <div style={{ color: T.textPrimary, fontWeight: 800 }}>RF total</div>
                  <div>{formatPctValue(implementationPlan.targetMixIdeal.rf)}</div>
                  <div>{formatPctValue(implementationPlan.reachableMix.rf)}</div>
                  <div>{formatSignedPp(-implementationPlan.gapVsIdealRvPp)}</div>
                </div>
                {implementationMateriality?.sleeveValidation.rows.map((row) => (
                  <div key={`main-post-${row.label}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(3, minmax(0, 1fr))', gap: 8, color: T.textSecondary, fontSize: 10, borderTop: `1px solid ${T.border}`, paddingTop: 5 }}>
                    <div style={{ color: T.textPrimary, fontWeight: 700 }}>{row.label}</div>
                    <div>{formatPctValue(row.target)}</div>
                    <div>{formatPctValue(row.postTrade)}</div>
                    <div>{formatSignedPp((row.target - row.postTrade) * 100)}</div>
                  </div>
                ))}
              </div>
              {Math.abs(implementationPlan.gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9 ? (
                <div style={{ color: T.positive, fontSize: 10 }}>
                  La implementación se aproxima al objetivo RV/RF.
                </div>
              ) : (
                <div style={{ color: T.warning, fontSize: 10 }}>
                  {Math.abs(implementationPlan.gapVsIdealRvPp) > 3 + 1e-9
                    ? `Implementación parcial: falta ${formatSignedPp(Math.abs(implementationPlan.gapVsIdealRvPp))} RV para llegar al objetivo. Revisar instrumentos bloqueados o agregar destinos operables.`
                    : 'Validar mix alcanzado antes de ejecutar. Las métricas de éxito deben recalcularse sobre el mix alcanzado, no sobre el objetivo ideal.'}
                </div>
              )}
              {implementationMateriality?.sleeveValidation
              && implementationMateriality.sleeveValidation.maxGapPp > 1.5
              && Math.abs(implementationPlan.gapVsIdealRvPp) <= 3 + 1e-9 ? (
                <div style={{ color: T.warning, fontSize: 10 }}>
                  La implementación alcanza aproximadamente el RV/RF objetivo, pero cambia la composición global/local. Validar el mix alcanzado antes de ejecutar.
                </div>
              ) : null}
            </div>
            {implementationMateriality?.sleeveValidation ? (
              <details style={{ display: 'grid', gap: 6, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, background: T.surfaceEl }}>
                <summary style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Diagnóstico técnico por sleeve</summary>
                <div style={{ color: T.textMuted, fontSize: 10, marginTop: 6 }}>
                  La composición global/local es secundaria. La validación operativa principal es RV/RF total.
                </div>
                {implementationMateriality.sleeveValidation.rows.map((row) => (
                  <div key={`main-${row.label}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.3fr) repeat(4, minmax(0, 1fr))', gap: 8, color: T.textMuted, fontSize: 10, marginTop: 6 }}>
                    <div style={{ color: T.textSecondary, fontWeight: 700 }}>{row.label}</div>
                    <div>Actual {formatPctValue(row.current)}</div>
                    <div>Objetivo {formatPctValue(row.target)}</div>
                    <div>Post {formatPctValue(row.postTrade)}</div>
                    <div>Gap {formatSignedPp((row.target - row.postTrade) * 100)}</div>
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 900 }}>Diagnósticos opcionales</div>
        <button
          type="button"
          onClick={() => setTechnicalDiagnosticsOpen((prev) => !prev)}
          style={{
            background: 'transparent',
            border: 'none',
            color: T.textPrimary,
            fontSize: 13,
            fontWeight: 900,
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {technicalDiagnosticsOpen ? 'Ocultar diagnóstico técnico opcional' : 'Ver diagnóstico técnico'}
        </button>
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Sirven para auditar o explorar escenarios. No modifican la recomendación oficial salvo que confirmes una nueva corrida completa.
        </div>
      </div>

      {technicalDiagnosticsOpen ? (
      <>
      {decisionDiagnosticTrace ? (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 900, lineHeight: 1.25 }}>Traza diagnóstica de Optimización</div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            JSON read-only del flujo Express → Zoom → Confirmación → Implementación para auditar shortlist, fallback y target final.
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: T.textSecondary, fontSize: 10, background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
            {JSON.stringify(decisionDiagnosticTrace, null, 2)}
          </pre>
        </div>
      ) : null}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 900, lineHeight: 1.25 }}>Fase 1 · Óptimo técnico / financiero preliminar</div>
        <div style={{ color: T.textSecondary, fontSize: 11, lineHeight: 1.45 }}>
          Sweep RF/RV completo, refinamiento local y mix de la fuente activa preservado para estimar el óptimo financiero preliminar.
        </div>
        <div style={{ color: T.textMuted, fontSize: 9, lineHeight: 1.45 }}>
          En esta fase se apaga la venta de casa y se desactiva capital de riesgo. Los cuts se neutralizan vía parámetros (floors=1 y umbrales extremos) usando el mismo motor M8.
        </div>
        <div>
          <button
            type="button"
            onClick={runPhase1}
            disabled={phase1Running || mode !== 'light'}
            style={{
              background: phase1Running ? T.surfaceEl : T.primary,
              border: `1px solid ${phase1Running ? T.border : T.primary}`,
              color: phase1Running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: phase1Running || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: mode !== 'light' ? 0.65 : 1,
            }}
          >
            {phase1Running ? 'Calculando Fase 1…' : 'Ejecutar Fase 1'}
          </button>
        </div>
        {staleNotice ? (
          <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
            {staleNotice}
          </div>
        ) : null}
        {phase1SlowNotice ? (
          <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
            {phase1SlowNotice}
          </div>
        ) : null}
        {phase1Meta ? renderRunMeta(phase1Meta, phase1IsStale) : null}
        <details style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px 8px', background: T.surfaceEl }}>
          <summary style={{ cursor: 'pointer', color: T.textSecondary, fontSize: 10, fontWeight: 700 }}>
            Ver contexto técnico Fase 1
          </summary>
          {phase1Diagnostics ? (
            <div style={{ color: T.textMuted, fontSize: 9, marginTop: 6 }}>
              Diagnóstico Fase 1 · run #{phase1Diagnostics.runId} · total {phase1Diagnostics.totalEvaluations}/{phase1Diagnostics.cap} · sweep {phase1Diagnostics.coarseEvaluations} · actual {phase1Diagnostics.currentEvaluations} · ref 2.5 {phase1Diagnostics.local25Evaluations} · ref 1.0 {phase1Diagnostics.micro10Evaluations} · {phase1Diagnostics.elapsedMs} ms{phase1Diagnostics.capReached ? ' · cap alcanzado' : ''}
            </div>
          ) : null}
          <div style={{ color: T.textMuted, fontSize: 9, marginTop: 4 }}>
            Mix base Fase 1 (fuente activa): {phase1CurrentPoint ? `RV ${phase1CurrentPoint.rvPct}% / RF ${phase1CurrentPoint.rfPct}%` : `RV ${((activeParams.weights.rvGlobal + activeParams.weights.rvChile) * 100).toFixed(1)}% / RF ${(100 - ((activeParams.weights.rvGlobal + activeParams.weights.rvChile) * 100)).toFixed(1)}%`}
          </div>
        </details>

        {phase1Top3.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 7 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>Campeón + retador Fase 1</div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Este mix se ve mejor en la optimización preliminar. No es necesariamente la recomendación final para tu perfil.
              </div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800, lineHeight: 1.35 }}>
                Campeón Fase 1: {phase1ChampionChallenger.champion ? scenarioLabel(phase1ChampionChallenger.champion) : 'No disponible'}
                {phase1ChampionChallenger.champion ? ` · ${formatPct(phase1ChampionChallenger.champion.success40)}` : ''}
              </div>
              <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
                Retador Fase 1: {phase1ChampionChallenger.challenger ? scenarioLabel(phase1ChampionChallenger.challenger) : 'No disponible'}
                {phase1ChampionChallenger.challenger ? ` · ${formatPct(phase1ChampionChallenger.challenger.success40)}` : ''}
              </div>
              <div style={{ color: phase1ChampionChallenger.materialityLabel === 'Mejora material' ? T.positive : T.warning, fontSize: 12, fontWeight: 800 }}>
                {phase1ChampionChallenger.materialityLabel}
                {phase1ChampionChallenger.deltaSuccessPp !== null ? ` · Δ éxito ${formatSignedPp(phase1ChampionChallenger.deltaSuccessPp)}` : ''}
              </div>
              <div style={{ color: T.textMuted, fontSize: 9 }}>
                {phase1ChampionChallenger.message}
              </div>
            </div>

            <details style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
                Baseline + ranking técnico Fase 1
              </summary>
              <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
                  Baseline Fase 1: {scenarioLabel(phase1Top3[0])}
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Success40 autónomo = {formatPct(phase1Top3[0].success40)}
                </div>
                {phase1TechnicalTiePoints.length > 1 && phase1BalancedPoint && (
                  <>
                    <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                      Finalista Fase 1: {scenarioLabel(phase1BalancedPoint)}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      Criterio: menor Ruina20, luego RuinP10 más tardío, luego menor MaxDDP50 y menor RV.
                    </div>
                  </>
                )}
                {phase1Top3.slice(1).map((point, index) => (
                  <div key={`phase1-top-${point.rvPct}`} style={{ color: T.textSecondary, fontSize: 11 }}>
                    {index + 2}º mejor: {scenarioLabel(point)} · {formatPct(point.success40)} · {phase1BestSuccess !== null ? formatDeltaVsBest((point.success40 - phase1BestSuccess) * 100) : ''}
                  </div>
                ))}
                {phase1TechnicalTiePoints.length > 1 ? (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Meseta de éxito: {phase1TechnicalTiePoints.length} mixes quedan dentro de {TECHNICAL_TIE_BAND_PP.toFixed(1)} pp del mejor.
                    {' '}({phase1TechnicalTiePoints.map((point) => `${point.rvPct}/${point.rfPct}`).join(' · ')})
                  </div>
                ) : null}
              </div>
            </details>

            {phase1CurrentPoint && phase1SuggestedPoint && switchVerdict && (
              <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
                <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 900 }}>¿Vale la pena cambiar?</div>
                <div style={{ color: T.textSecondary, fontSize: 11, lineHeight: 1.4 }}>
                  Desde: RV {phase1CurrentPoint.rvPct}% / RF {phase1CurrentPoint.rfPct}% · Hacia: RV {phase1SuggestedPoint.rvPct}% / RF {phase1SuggestedPoint.rfPct}%
                </div>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
                  Cambio requerido: {switchVerdict.movePp.toFixed(1)} pp · Mejora en éxito: {switchVerdict.deltaSuccessPp >= 0 ? '+' : ''}{switchVerdict.deltaSuccessPp.toFixed(1)} pp
                </div>
                <div style={{ color: T.textMuted, fontSize: 9 }}>
                  Success40 actual: {formatPct(phase1CurrentPoint.success40)} · sugerido: {formatPct(phase1SuggestedPoint.success40)} · Ruina20 {formatPct(phase1CurrentPoint.ruin20)} → {formatPct(phase1SuggestedPoint.ruin20)}
                </div>
                <div style={{ color: T.textMuted, fontSize: 9 }}>
                  RuinP10 {formatYears(phase1CurrentPoint.ruinP10)} → {formatYears(phase1SuggestedPoint.ruinP10)} · MaxDDP50 {formatPct(phase1CurrentPoint.drawdownP50)} → {formatPct(phase1SuggestedPoint.drawdownP50)}
                </div>
                {phase2CurrentRow && phase2SuggestedRow ? (
                  <div style={{ color: T.textMuted, fontSize: 9 }}>
                    Assisted: éxito {formatPct(phase2CurrentRow.success40Assisted)} → {formatPct(phase2SuggestedRow.success40Assisted)} · casa {formatPct(phase2CurrentRow.houseSalePct)} → {formatPct(phase2SuggestedRow.houseSalePct)} · cuts {phase2CurrentRow.cutScenarioPct !== null ? formatPct(phase2CurrentRow.cutScenarioPct) : 'NA'} → {phase2SuggestedRow.cutScenarioPct !== null ? formatPct(phase2SuggestedRow.cutScenarioPct) : 'NA'}
                  </div>
                ) : null}
                <div style={{ color: switchVerdict.level === 'cambiar' ? T.positive : switchVerdict.level === 'considerar' ? T.warning : T.textSecondary, fontSize: 13, fontWeight: 900 }}>
                  Veredicto: {switchVerdict.label}
                </div>
                <div style={{ color: T.textMuted, fontSize: 9 }}>{switchVerdict.detail}</div>
              </div>
            )}

            <div style={{ display: 'grid', gap: 6 }}>
              {phase1Sweep.map((point) => {
                const deltaVsBest = phase1BestSuccess !== null ? (point.success40 - phase1BestSuccess) * 100 : 0;
                const isBest = phase1BestSuccess !== null && Math.abs(point.success40 - phase1BestSuccess) < 1e-9;
                const isTechnicalTie = phase1BestSuccess !== null
                  && ((phase1BestSuccess - point.success40) * 100) <= (TECHNICAL_TIE_BAND_PP + 1e-9);
                const isBalanced = Boolean(phase1BalancedPoint && phase1BalancedPoint.rvPct === point.rvPct);
                const isPhase1Champion = Boolean(phase1ChampionChallenger.champion && isSameMix(point, phase1ChampionChallenger.champion));
                const isPhase1Challenger = Boolean(phase1ChampionChallenger.challenger && isSameMix(point, phase1ChampionChallenger.challenger));
                const passesPhase2 = shortlist.some((candidate) => isSameMix(candidate, point));
                return (
                  <details
                    key={`phase1-sweep-${point.rvPct}`}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${isBest ? T.primary : isBalanced ? '#4e86ff' : isTechnicalTie ? T.warning : T.border}`,
                      borderRadius: 10,
                      padding: '7px 9px',
                    }}
                  >
                    <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span>{scenarioLabel(point)}</span>
                          {point.isCurrentMix ? <span style={{ color: '#fff', background: T.primary, borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 800 }}>Fuente activa</span> : null}
                          {isPhase1Champion ? <span style={{ color: '#fff', background: T.primary, borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 800 }}>Campeón</span> : null}
                          {isPhase1Challenger ? <span style={{ color: '#6c4a12', background: 'rgba(216, 162, 74, 0.18)', borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 800 }}>Retador</span> : null}
                          <span style={{ color: passesPhase2 ? '#fff' : T.textMuted, background: passesPhase2 ? T.positive : T.surface, border: `1px solid ${passesPhase2 ? T.positive : T.border}`, borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 800 }}>
                            {passesPhase2 ? 'Pasa F2' : 'No pasa F2'}
                          </span>
                        </div>
                        <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                          Éxito {formatPct(point.success40)} · Ruina20 {formatPct(point.ruin20)} · RuinP10 {formatYears(point.ruinP10)} · MaxDD {formatPct(point.drawdownP50)} · Δ {isBest ? '0.0 pp' : isTechnicalTie ? 'Empate técnico' : formatDeltaVsBest(deltaVsBest)}
                        </div>
                      </div>
                    </summary>
                    <div style={{ color: T.textMuted, fontSize: 10, marginTop: 6 }}>
                      Terminal P50 all: {formatMoney(point.terminalP50All)} · Terminal P50 survivors: {formatMoney(point.terminalP50Survivors)}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}

        {shortlist.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>Mixes competitivos (secundario)</div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Shortlist: {shortlist.length} mixes ({phase1Points.length} evaluados) · banda de éxito {Math.round(SHORTLIST_BEST_SUCCESS_BAND * 1000) / 10}pp · diversidad mínima {SHORTLIST_MIN_RV_DISTANCE}pp en RV.
            </div>
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 900, lineHeight: 1.25 }}>Fase 2 · Recomendación principal para tu perfil</div>
        <div style={{ color: T.textSecondary, fontSize: 11, lineHeight: 1.45 }}>
          Usa `decisionProfiles.mainRecommendation` como fuente oficial para elegir el mejor equilibrio entre calidad base y holgura futura.
        </div>
        <div style={{ color: T.textMuted, fontSize: 9 }}>
          Fuente oficial visible: Pareto + ratio vs referencia defensiva. La referencia defensiva y el benchmark extremo se muestran solo como comparadores.
        </div>
        <div style={{ color: T.textMuted, fontSize: 9 }}>
          Si quieres correr diagnósticos complementarios del modelo completo para sensibilidad y holgura, puedes prepararlos sin afectar la recomendación oficial.
        </div>
        <div>
          <button
            type="button"
            onClick={runPhase2}
            disabled={phase2Running || !phase1Points.length || mode !== 'light'}
            style={{
              background: phase2Running ? T.surfaceEl : T.primary,
              border: `1px solid ${phase2Running ? T.border : T.primary}`,
              color: phase2Running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: phase2Running || !phase1Points.length || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: (!phase1Points.length || mode !== 'light') ? 0.65 : 1,
            }}
          >
            {phase2Running ? 'Preparando diagnósticos…' : 'Preparar diagnósticos complementarios'}
          </button>
        </div>
        {phase2Meta ? renderRunMeta(phase2Meta, phase2IsStale) : null}

        {phase2Rows.length > 0 ? (
          <details style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10 }}>
            <summary style={{ cursor: 'pointer', color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
              Diagnóstico de frontera RV/RF
            </summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Supuestos efectivos del motor para esta corrida: retornos y volatilidades reales anuales, simulados mensualmente.
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Escenario activo: {phase2FrontierDiagnostics.assumptions.activeScenario} · salida interpretada en CLP real del modelo.
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                RV global {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rvGlobalReturn)} · RV local {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rvChileReturn)} · RF global {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rfGlobalReturn)} · RF local {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rfChileReturn)}
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Volatilidad anual aprox.: RV global {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rvGlobalVol)} · RV local {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rvChileVol)} · RF global {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rfGlobalVol)} · RF local {formatPctPrecise(phase2FrontierDiagnostics.assumptions.rfChileVol)}
              </div>
              <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                {phase2FrontierDiagnostics.winningMixReason}
              </div>
              <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                Benchmarks evaluados: 0/100 · 25/75 · 50/50 · 75/25 · 80/20 · 100/0
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {phase2FrontierDiagnostics.benchmarkRows.map((row) => {
                  const diag = phase2FrontierDiagnostics.candidateDiagnostics.find((item) => item.id === row.id) ?? null;
                  return (
                    <div
                      key={`benchmark-${row.id}`}
                      style={{
                        display: 'grid',
                        gap: 3,
                        border: `1px solid ${T.border}`,
                        borderRadius: 10,
                        padding: '8px 10px',
                        background: T.surface,
                      }}
                    >
                      <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                        RV/RF {row.rvPct}/{row.rfPct} · QASR {formatScorePrecise(row.qasrStrict)} · CSR {formatPctPrecise(row.csr85_4)}
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 10 }}>
                        Éxito clásico {formatPctPrecise(row.classicSuccessRate)} · Recorte severo promedio {formatMonthsHuman(row.monthsInSevereCutMean)} · Racha severa P75 {formatMonthsHuman(row.maxConsecutiveSevereCutMonthsP75)}
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 10 }}>
                        Patrimonio final P25 {formatClpShort(row.terminalWealthP25)} · Venta casa {formatPctPrecise(row.houseSaleRate)} · Prima efectiva RV-RF {formatPctPrecise(diag?.rvRfSpread ?? null)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        ) : null}

        {phase2Rows.length > 0 ? (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 900 }}>Sensibilidad prima RV/RF</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Prueba no oficial: muestra cómo cambiaría el mix recomendado si la rentabilidad esperada de RV fuera mayor. No modifica el escenario base ni la recomendación oficial.
            </div>
            <div>
              <button
                type="button"
                onClick={runSensitivity}
                disabled={sensitivityRunning || !phase2Rows.length}
                style={{
                  background: sensitivityRunning ? T.surface : T.primary,
                  border: `1px solid ${sensitivityRunning ? T.border : T.primary}`,
                  color: sensitivityRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: sensitivityRunning || !phase2Rows.length ? 'not-allowed' : 'pointer',
                  opacity: !phase2Rows.length ? 0.65 : 1,
                }}
              >
                {sensitivityRunning ? 'Ejecutando sensibilidad…' : 'Ejecutar sensibilidad'}
              </button>
            </div>
            {sensitivityError ? (
              <div style={{ color: T.warning, fontSize: 10 }}>{sensitivityError}</div>
            ) : null}
            {sensitivityResults.length > 0 ? (
              <>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                  {sensitivityInterpretation}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {sensitivityResults.map((result) => {
                    const winner = result.winner;
                    const winnerDiag = winner
                      ? result.frontier.candidateDiagnostics.find((item) => item.id === winner.qualityCandidate.id) ?? null
                      : null;
                    return (
                      <div
                        key={`sensitivity-${result.scenario.id}`}
                        style={{
                          display: 'grid',
                          gap: 3,
                          border: `1px solid ${T.border}`,
                          borderRadius: 10,
                          padding: '8px 10px',
                          background: T.surface,
                        }}
                      >
                        <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                          {result.scenario.label} · Prima RV-RF {formatPctPrecise(winnerDiag?.rvRfSpread ?? null)}
                        </div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Mix líder del escenario {winner ? `RV ${winner.source.rvPct}% / RF ${winner.source.rfPct}%` : 'No disponible'} · QASR {formatScorePrecise(winner?.qualityCandidate.qasrStrict ?? null)} · CSR {formatPctPrecise(winner?.qualityCandidate.csr85_4 ?? null)}
                        </div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Éxito clásico {formatPctPrecise(winner?.qualityCandidate.classicSuccessRate ?? null)} · Recorte severo {formatMonthsHuman(winner?.qualityCandidate.monthsInSevereCutMean ?? null)} · P25 final {formatClpShort(winner?.qualityCandidate.terminalWealthP25 ?? null)} · P50 final {formatClpShort(winner?.qualityCandidate.terminalWealthP50 ?? null)}
                        </div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Venta casa {formatPctPrecise(winner?.qualityCandidate.houseSaleRate ?? null)} · {result.frontier.winningMixReason}
                        </div>
                        {result.warnings.length > 0 ? (
                          <div style={{ color: T.warning, fontSize: 10 }}>
                            {result.warnings.join(' · ')}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {phase2Rows.length > 0 ? (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 900 }}>Holgura de gasto por mix</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Prueba no oficial: muestra qué mixes siguen sosteniendo calidad de vida si el gasto sube 20% o 30%. No modifica el escenario base.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={runSpendingHeadroom}
                disabled={spendingHeadroomRunning || !spendingHeadroomCandidates.length}
                style={{
                  background: spendingHeadroomRunning ? T.surface : T.primary,
                  border: `1px solid ${spendingHeadroomRunning ? T.border : T.primary}`,
                  color: spendingHeadroomRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: spendingHeadroomRunning || !spendingHeadroomCandidates.length ? 'not-allowed' : 'pointer',
                  opacity: !spendingHeadroomCandidates.length ? 0.65 : 1,
                }}
              >
                {spendingHeadroomRunning ? 'Calculando holgura…' : 'Evaluar holgura'}
              </button>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                Mixes incluidos: {spendingHeadroomCandidates.map((item) => `${item.rvPct}/${item.rfPct}`).join(' · ')}
              </div>
            </div>
            {spendingHeadroomError ? (
              <div style={{ color: T.warning, fontSize: 10 }}>{spendingHeadroomError}</div>
            ) : null}
            {spendingHeadroomResults.length > 0 ? (
              <>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                  {spendingHeadroomInterpretation}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {spendingHeadroomResults.map((result) => {
                    const baseEval = result.evaluations.find((item) => Math.abs(item.spendScale - 1) <= 1e-9) ?? null;
                    const plus20 = result.evaluations.find((item) => Math.abs(item.spendScale - 1.2) <= 1e-9) ?? null;
                    const plus30 = result.evaluations.find((item) => Math.abs(item.spendScale - 1.3) <= 1e-9) ?? null;
                    return (
                      <details
                        key={`headroom-${result.mix.candidateId}-${result.mix.rvPct}`}
                        style={{
                          display: 'grid',
                          gap: 3,
                          border: `1px solid ${T.border}`,
                          borderRadius: 10,
                          padding: '8px 10px',
                          background: T.surface,
                        }}
                      >
                        <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                          <div style={{ display: 'grid', gap: 3 }}>
                            <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                              {result.mix.label} · Máx. gasto probado con QoL OK {result.maxSpendScalePassingQoL !== null ? formatSpendScaleLabel(result.maxSpendScalePassingQoL as SpendingHeadroomScale) : 'No disponible'}
                            </div>
                            <div style={{ color: T.textMuted, fontSize: 10 }}>
                              Base QASR {formatScorePrecise(baseEval?.qasrStrict ?? null)} · CSR {formatPctPrecise(baseEval?.csr85_4 ?? null)} · +20% QASR {formatScorePrecise(plus20?.qasrStrict ?? null)} · CSR {formatPctPrecise(plus20?.csr85_4 ?? null)} · +30% QASR {formatScorePrecise(plus30?.qasrStrict ?? null)} · CSR {formatPctPrecise(plus30?.csr85_4 ?? null)}
                            </div>
                            <div style={{ color: T.textMuted, fontSize: 10 }}>
                              P25 final base {formatClpShort(baseEval?.terminalWealthP25 ?? null)} · P50 final base {formatClpShort(baseEval?.terminalWealthP50 ?? null)}
                            </div>
                          </div>
                        </summary>
                        <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                          <div style={{ color: T.textMuted, fontSize: 10 }}>
                            {result.mix.sourceLabel} · candidateId {result.mix.candidateId} · input real RV/RF {formatPctPrecise(baseEval?.rvReal ?? null)} / {formatPctPrecise(baseEval?.rfReal ?? null)}
                          </div>
                          <div style={{ color: T.textMuted, fontSize: 10 }}>
                            Sleeves: RV Global {formatPctPrecise(baseEval?.rvGlobal ?? null)} · RV Chile {formatPctPrecise(baseEval?.rvChile ?? null)} · RF Global {formatPctPrecise(baseEval?.rfGlobal ?? null)} · RF Chile {formatPctPrecise(baseEval?.rfChile ?? null)}
                          </div>
                          {result.evaluations.map((evaluation) => (
                            <div key={evaluation.resultKey} style={{ color: T.textMuted, fontSize: 10 }}>
                              {evaluation.spendLabel}: QASR {formatScorePrecise(evaluation.qasrStrict)} · CSR {formatPctPrecise(evaluation.csr85_4)} · Éxito {formatPctPrecise(evaluation.classicSuccessRate)} · Ruina {formatPctPrecise(evaluation.probRuin)} · Recorte severo {formatMonthsHuman(evaluation.monthsInSevereCutMean)} · Racha P75 {formatMonthsHuman(evaluation.maxConsecutiveSevereCutMonthsP75)} · P25 {formatClpShort(evaluation.terminalWealthP25)} · P50 {formatClpShort(evaluation.terminalWealthP50)} · Venta casa {formatPctPrecise(evaluation.houseSaleRate)} · Recorte severo mientras se vende {formatMonthsHuman(evaluation.severeCutMonthsDuringHouseSaleMedian)}
                            </div>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {phase2Rows.length > 0 ? (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 900 }}>Decision RV/RF por perfiles</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Cada perfil prioriza algo diferente. No hay una opcion superior en todas las dimensiones.
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              La recomendacion no usa un score unico. Primero filtra candidatos inviables, luego identifica la frontera eficiente entre calidad base y holgura, y finalmente avanza hacia mas RV solo cuando la mejora de holgura compensa la perdida de estabilidad base.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={runDecisionProfiles}
                disabled={decisionProfilesRunning}
                style={{
                  background: decisionProfilesRunning ? T.surface : T.primary,
                  border: `1px solid ${decisionProfilesRunning ? T.border : T.primary}`,
                  color: decisionProfilesRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: decisionProfilesRunning ? 'not-allowed' : 'pointer',
                }}
              >
                {decisionProfilesRunning ? 'Calculando óptimo MIDAS…' : 'Calcular Óptimo MIDAS recomendado'}
              </button>
              <button
                type="button"
                onClick={runDecisionConfirmation}
                disabled={decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed'}
                style={{
                  background: decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? T.surface : T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  color: decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? T.textMuted : T.textPrimary,
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: decisionProfilesRunning || !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? 'not-allowed' : 'pointer',
                  opacity: !actionableRecommendationCandidate || decisionFlowStatus?.stage === 'confirmed' ? 0.7 : 1,
                }}
              >
                {decisionFlowStatus?.stage === 'confirmed'
                  ? 'Confirmación completa lista'
                  : recommendationIsOfficial
                    ? 'Confirmar con simulación completa'
                    : 'Confirmar mejor opción disponible'}
              </button>
              {decisionProfilesRunning ? (
                <button
                  type="button"
                  onClick={() => {
                    decisionCancelRequestedRef.current = true;
                    setDecisionCancelRequested(true);
                  }}
                  style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    color: T.textPrimary,
                    borderRadius: 999,
                    padding: '7px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar cálculo
                </button>
              ) : null}
            </div>
            {decisionProfilesError ? <div style={{ color: T.warning, fontSize: 10 }}>{decisionProfilesError}</div> : null}
            {decisionFlowStatus ? (
              <div style={{ display: 'grid', gap: 4, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', background: T.surface }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: T.textPrimary, fontSize: 10, fontWeight: 800 }}>{decisionFlowStatus.badge}</span>
                  <span style={{ color: T.textMuted, fontSize: 10 }}>
                    {decisionFlowStatus.badge} · {decisionFlowStatus.candidateCount} mixes · {decisionProgress?.total ?? 0} unidades · nSim {decisionFlowStatus.nSim.toLocaleString('es-ES')} · seed {decisionFlowStatus.seed}{decisionFlowStatus.stepPp !== null ? ` · malla ${decisionFlowStatus.stepPp}pp` : ''}
                  </span>
                </div>
                <div style={{ color: T.textSecondary, fontSize: 10 }}>{decisionFlowStatus.message}</div>
                {decisionProgress ? (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Progreso: {decisionProgress.stage} · {decisionProgress.evaluated}/{decisionProgress.total} corridas · nSim {decisionProgress.nSim.toLocaleString('es-ES')} · seed {decisionProgress.seed}
                    {decisionCancelRequested ? ' · cancelación solicitada' : ''}
                  </div>
                ) : null}
              </div>
            ) : null}
            {actionableRecommendationCandidate ? (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 12, padding: 12, background: '#0d1224', display: 'grid', gap: 7 }}>
                <div style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>{recommendationIsOfficial ? 'Recomendación principal para tu perfil' : 'Mejor opción disponible (contingencia)'}</div>
                <div style={{ color: '#fff', fontSize: 22, fontWeight: 900 }}>
                  {actionableRecommendationCandidate.mixLabel}
                </div>
                <div style={{ color: T.textMuted, fontSize: 11 }}>
                  {recommendationIsOfficial ? 'Mejor equilibrio entre calidad base y holgura futura.' : 'No cumple todos los guardrails MIDAS, pero es la alternativa accionable menos mala evaluada.'}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Fuente: V2.7.2 / V2.7.4 · Pareto + ratio vs referencia defensiva · Referencia defensiva: {officialDefensiveReference?.mixLabel ?? 'No disponible'} · Benchmark extremo: {officialBenchmarkExtreme?.mixLabel ?? 'RV 100 / RF 0'}
                </div>
                {decisionFlowStatus ? (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Estado: {decisionFlowStatus.badge}
                  </div>
                ) : null}
                {officialRecommendationWarning ? (
                  <div style={{ color: T.warning, fontSize: 10 }}>{officialRecommendationWarning}</div>
                ) : null}
                {decisionFlowWarning ? (
                  <div style={{ color: T.warning, fontSize: 10 }}>{decisionFlowWarning}</div>
                ) : null}
              </div>
            ) : (
              <div style={{ color: T.warning, fontSize: 10 }}>
                {officialRecommendationWarning ?? 'Genera la decisión por perfiles para mostrar la recomendación principal oficial.'}
              </div>
            )}
            {recommendationTradeoffCards.length > 0 ? (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, background: T.surface, display: 'grid', gap: 8 }}>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Si eliges otra opción en vez de la recomendada</div>
                {recommendationTradeoffCards.map((card) => (
                  <div key={card.key} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', display: 'grid', gap: 4 }}>
                    <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                      {card.title}: {card.mixLabel}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 10 }}>
                      Qué ganas: {card.gains.length ? card.gains.join(' · ') : 'No gana nada material frente a la recomendación principal.'}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 10 }}>
                      Qué sacrificas: {card.sacrifices.length ? card.sacrifices.join(' · ') : 'No sacrifica nada material frente a la recomendación principal.'}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      {card.reading}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {decisionProfilesTables.map((table) => {
              const profiles = table.profiles;
              const ref = profiles.defensiveReference;
              const main = profiles.primaryRecommendation;
              const alt = profiles.headroomAlternative;
              const bench = profiles.benchmarkExtreme;
              const sameRefMain = ref && main && ref.candidateId === main.candidateId;
              const sameMainAlt = main && alt && main.candidateId === alt.candidateId;
              return (
                <details key={`profiles-${table.scenarioId}`} open={table.scenarioId === 'base'} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 10px', background: T.surface }}>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>{table.label}</div>
                  </summary>
                  <div style={{ display: 'grid', gap: 4, marginTop: 6, color: T.textMuted, fontSize: 10 }}>
                    <div>
                      SE_QASR max: {profiles.seQasrEstimated?.toFixed(3) ?? 'ND'} ({profiles.seQasrMaxCandidateId ?? 'sin candidato'}) · Tolerancia Pareto: {profiles.paretoToleranceUsed.toFixed(1)} · Frontera: {profiles.paretoFrontierSize}/{profiles.fineGridCount}
                    </div>
                    <div>
                      Ratio estabilidad/holgura: {profiles.ratioUsed.toFixed(1)} · Sensibilidad ratio 1.5={profiles.ratioSensitivity.ratio15CandidateId ?? 'ND'} / 2.0={profiles.ratioSensitivity.ratio20CandidateId ?? 'ND'} / 3.0={profiles.ratioSensitivity.ratio30CandidateId ?? 'ND'} {profiles.ratioSensitivity.recommendationSensitive ? '· sensible' : '· estable'}
                    </div>
                    {profiles.warnings.map((warning) => (
                      <div key={`warn-${table.scenarioId}-${warning}`} style={{ color: T.warning }}>{warning}</div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    {main ? (
                      <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3, background: '#0d1224' }}>
                        <div style={{ color: '#fff', fontSize: 10, fontWeight: 800 }}>Recomendacion principal: Equilibrio calidad + holgura · {main.mixLabel}</div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          QASR base {formatScorePrecise(main.qasrBase)} · QASR +20 {formatScorePrecise(main.qasrAt120)} · QASR +30 {formatScorePrecise(main.qasrAt130)} · CSR {formatPctPrecise(main.csrBase)} · Ruina {formatPctPrecise(main.ruinRate)}
                        </div>
                      </div>
                    ) : null}
                    {!sameRefMain && ref ? (
                      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
                        <div style={{ color: T.textPrimary, fontSize: 10, fontWeight: 800 }}>Referencia defensiva / maxima calidad base · {ref.mixLabel}</div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Esta opcion no es la recomendacion principal. Sirve como comparador de maxima estabilidad base: muestra que se gana en menor recorte y que se sacrifica en holgura frente a la recomendacion.
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: T.textMuted, fontSize: 10 }}>En este escenario, la recomendacion principal coincide con la referencia defensiva.</div>
                    )}
                    {alt && !sameMainAlt ? (
                      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
                        <div style={{ color: T.textPrimary, fontSize: 10, fontWeight: 800 }}>Alternativa de mayor holgura · {alt.mixLabel}</div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Prioriza crecimiento y capacidad de gasto futuro, aceptando potencialmente menor estabilidad base.
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: T.textMuted, fontSize: 10 }}>
                        {sameMainAlt ? 'La recomendacion principal tambien es la mejor alternativa de holgura disponible.' : 'No hay alternativa de mayor holgura con mejora material sin deterioro relevante de calidad base.'}
                      </div>
                    )}
                    {bench ? (
                      <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 3 }}>
                        <div style={{ color: T.textPrimary, fontSize: 10, fontWeight: 800 }}>Benchmark extremo: RV 100 / RF 0</div>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          Limite de crecimiento/riesgo para comparar. No se usa como recomendacion principal por defecto.
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                    {profiles.rows.filter((row) => row.inParetoFrontier || row.role !== 'none').map((row) => (
                      <div key={`pareto-row-${table.scenarioId}-${row.candidateId}`} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 8px', color: T.textMuted, fontSize: 10 }}>
                        {row.mixLabel} · rol {row.role} · guardrails {row.passesHardGuardrails ? 'si' : `no (${row.failedGuardrails.join(',')})`} · Pareto {row.inParetoFrontier ? 'si' : 'no'} · QASR base {formatScorePrecise(row.qasrBase)} · QASR +20 {formatScorePrecise(row.qasrAt120)} · QASR +30 {formatScorePrecise(row.qasrAt130)} · CSR {formatPctPrecise(row.csrBase)} · Ruina {formatPctPrecise(row.ruinRate)} · Recorte severo {formatMonthsHuman(row.monthsInSevereCutMean)} · P50 {formatClpShort(row.terminalWealthP50)} · diferencia principal: {row.mainDifference}
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}

        {phase2QualityMissingRows.length > 0 ? (
          <div style={{ color: T.warning, fontSize: 10 }}>
            Advertencia técnica: {phase2QualityMissingRows.length} candidato(s) no quedaron rankeables por calidad de vida porque la corrida no expuso `qualityOfLifeMetrics`.
          </div>
        ) : null}

        {false && phase2Rows.length > 0 && (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {phase2QualityRows.map((row) => {
              const decision = phase2Decisions.get(row.source.rvPct) ?? null;
              const isBaseline = Boolean(phase2BaselinePoint && isSameMix(row.source, phase2BaselinePoint));
              const isWinner = Boolean(phase2ChampionChallenger.champion && isSameMix(row.source, phase2ChampionChallenger.champion.source));
              const isRunnerUp = Boolean(phase2ChampionChallenger.challenger && isSameMix(row.source, phase2ChampionChallenger.challenger.source));
              const isOfficialMain = Boolean(officialMainRecommendationRow && isSameMix(row.source, officialMainRecommendationRow.source));
              const isOfficialDefensive = Boolean(officialDefensiveReferenceRow && isSameMix(row.source, officialDefensiveReferenceRow.source));
              const isOfficialHeadroom = Boolean(officialHeadroomAlternativeRow && isSameMix(row.source, officialHeadroomAlternativeRow.source));
              const cardBorderColor = isBaseline
                ? T.primary
                : isWinner
                  ? T.positive
                  : isRunnerUp
                    ? '#d8a24a'
                    : T.border;
              const cardBorderWidth = isWinner ? 2.5 : (isBaseline ? 2.5 : (isRunnerUp ? 1.5 : 1));
              const cardShadow = isWinner
                ? '0 0 0 1px rgba(72, 199, 116, 0.22), 0 6px 16px rgba(72, 199, 116, 0.10)'
                : isBaseline
                  ? '0 0 0 1px rgba(92, 128, 255, 0.24), 0 4px 12px rgba(92, 128, 255, 0.10)'
                  : 'none';
              return (
              <details
                key={`phase2-${row.source.rvPct}`}
                style={{
                  background: T.surfaceEl,
                  border: `${cardBorderWidth}px solid ${cardBorderColor}`,
                  borderRadius: 12,
                  boxShadow: cardShadow,
                  padding: 8,
                }}
              >
                <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{scenarioLabel(row.source)}</span>
                      {isBaseline ? (
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: T.primary, borderRadius: 999, padding: '2px 8px' }}>
                          Referencia
                        </span>
                      ) : null}
                      {!isBaseline && isWinner ? (
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: T.positive, borderRadius: 999, padding: '2px 8px' }}>
                          Top legacy
                        </span>
                      ) : null}
                      {!isBaseline && isRunnerUp ? (
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: '#d8a24a', borderRadius: 999, padding: '2px 8px' }}>
                          2do legacy
                        </span>
                      ) : null}
                      {isOfficialMain ? (
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: T.primary, borderRadius: 999, padding: '2px 8px' }}>
                          Fuente V2.7.2
                        </span>
                      ) : null}
                      {!isOfficialMain && isOfficialDefensive ? (
                        <span style={{ fontSize: 9, fontWeight: 800, color: T.textPrimary, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 8px' }}>
                          Ref. defensiva
                        </span>
                      ) : null}
                      {!isOfficialMain && isOfficialHeadroom ? (
                        <span style={{ fontSize: 9, fontWeight: 800, color: T.textPrimary, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 8px' }}>
                          Holgura
                        </span>
                      ) : null}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                      RV/RF {row.source.rvPct}/{row.source.rfPct} · QASR {formatScore100(row.qualityCandidate.qasrStrict)} · CSR {row.qualityCandidate.csr85_4 !== null ? formatPct(row.qualityCandidate.csr85_4) : 'No disponible'} · Éxito clásico {row.qualityCandidate.classicSuccessRate !== null ? formatPct(row.qualityCandidate.classicSuccessRate) : 'No disponible'}
                    </div>
                  </div>
                </summary>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Recorte severo promedio: {formatMonthsHuman(row.qualityCandidate.monthsInSevereCutMean)} · Racha severa P75: {formatMonthsHuman(row.qualityCandidate.maxConsecutiveSevereCutMonthsP75)}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Patrimonio final P25: {formatClpShort(row.qualityCandidate.terminalWealthP25)} · P50: {formatClpShort(row.qualityCandidate.terminalWealthP50)} · Venta casa: {row.qualityCandidate.houseSaleRate !== null ? formatPct(row.qualityCandidate.houseSaleRate) : 'No disponible'}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Referencia adicional: Ruina20 {formatPct(row.ruin20Assisted)} · Primer cut {formatYears(row.firstCutYearP50)} · MaxDD {formatPct(row.drawdownP50)}
                  </div>
                  {!isBaseline && decision && (
                    <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
                      <div style={{ color: T.textMuted, fontSize: 10 }}>
                        Éxito40 asistido vs autónomo: {row.success40Assisted >= row.source.success40 ? '+' : ''}{((row.success40Assisted - row.source.success40) * 100).toFixed(1)}pp
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 10 }}>{classifyRescueDependency(row)}</div>
                    </div>
                  )}
                  {row.qualityCandidate.warnings.length > 0 ? (
                    <div style={{ color: T.warning, fontSize: 10 }}>
                      Warning QoL: {row.qualityCandidate.warnings.join(' · ')}
                    </div>
                  ) : null}
                </div>
              </details>
              );
            })}
          </div>
        )}

        {phase2Rows.length > 0 && (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Implementación · Traspasos sugeridos desde la recomendación principal</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Traduce la recomendación principal oficial a instrumentos reales, sin usar ranking legacy ni resultados de Fase 3.
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Desde recomendación principal V2.7.4: {activeScenarioAfterPhase2 ? scenarioLabel(activeScenarioAfterPhase2.source) : 'No disponible'} · {phase2LongevitySelectedRow.reason}
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Objetivo oficial base (Implementation): {phase2ImplementationSelectedRow ? scenarioLabel(phase2ImplementationSelectedRow.source) : 'No disponible'}
            </div>
            {!decisionImplementationReady ? (
              <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
                Confirma con simulación completa antes de implementar.
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={runImplementation}
                disabled={implementationRunning || !phase2ImplementationSelectedRow || !decisionImplementationReady}
                style={{
                  background: implementationRunning ? T.surface : T.primary,
                  border: `1px solid ${implementationRunning ? T.border : T.primary}`,
                  color: implementationRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: implementationRunning || !phase2ImplementationSelectedRow || !decisionImplementationReady ? 'not-allowed' : 'pointer',
                  opacity: !phase2ImplementationSelectedRow || !decisionImplementationReady ? 0.6 : 1,
                }}
              >
                {implementationRunning ? 'Calculando implementación…' : 'Calcular implementación'}
              </button>
              <button
                type="button"
                onClick={runRealisticValidation}
                disabled={realisticValidationRunning || !implementationPlan || !implementationResultIsCurrent || implementationPlan.equivalentToIdeal}
                style={{
                  background: realisticValidationRunning ? T.surface : T.primary,
                  border: `1px solid ${realisticValidationRunning ? T.border : T.primary}`,
                  color: realisticValidationRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: realisticValidationRunning || !implementationPlan || !implementationResultIsCurrent || implementationPlan.equivalentToIdeal ? 'not-allowed' : 'pointer',
                  opacity: !implementationPlan || !implementationResultIsCurrent || implementationPlan.equivalentToIdeal ? 0.6 : 1,
                }}
              >
                {implementationPlan?.equivalentToIdeal
                  ? 'Validación no necesaria'
                  : realisticValidationRunning ? 'Validando mix alcanzable…' : 'Validar mix alcanzable'}
              </button>
            </div>
            {implementationError ? (
              <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>{implementationError}</div>
            ) : null}
            {implementationPlan ? (
              <div style={{ display: 'grid', gap: 7 }}>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Mix actual real</div>
                    <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>
                      {formatMixPair(implementationPlan.currentMix)}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Objetivo ideal</div>
                    <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>
                      {formatMixPair(implementationPlan.targetMixIdeal)}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Mix post-traspaso</div>
                    <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>
                      {formatMixPair(implementationPlan.reachableMix)}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Gap RV/RF</div>
                    <div style={{ color: implementationMateriality?.status === 'recommended' ? T.warning : T.positive, fontSize: 15, fontWeight: 800 }}>
                      {implementationMateriality ? formatSignedPp(implementationMateriality.gapRvPp) : formatSignedPp(Math.abs(implementationPlan.gapVsIdealRvPp))}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Movimiento sugerido total</div>
                    <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>
                      {implementationMateriality ? formatClpShort(implementationMateriality.totalTradeClp) : '—'}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      {implementationMateriality ? `${implementationMateriality.totalTradePortfolioPct.toFixed(2).replace('.', ',')}% cartera` : 'No disponible'}
                    </div>
                  </div>
                </div>
                {implementationMateriality ? (
                  <div style={{ display: 'grid', gap: 3 }}>
                    <div style={{ color: implementationMateriality.status === 'recommended' ? T.warning : T.positive, fontSize: 11, fontWeight: 800 }}>
                      Estado: {implementationMateriality.statusLabel}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                      {implementationMateriality.summary}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      {implementationMateriality.detail}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      Diagnóstico por sleeve disponible. La implementación operativa prioriza RV/RF total y los traspasos por instrumento.
                    </div>
                  </div>
                ) : null}
                {implementationMateriality?.sleeveValidation ? (
                  <div style={{ display: 'grid', gap: 6, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>Diagnóstico técnico por sleeve</div>
                    {implementationMateriality.sleeveValidation.rows.map((row) => (
                      <div key={row.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.3fr) repeat(4, minmax(0, 1fr))', gap: 8, color: T.textMuted, fontSize: 10 }}>
                        <div style={{ color: T.textSecondary, fontWeight: 700 }}>{row.label}</div>
                        <div>Actual {formatPctValue(row.current)}</div>
                        <div>Objetivo {formatPctValue(row.target)}</div>
                        <div>Post {formatPctValue(row.postTrade)}</div>
                        <div>Gap {formatSignedPp(row.gapPp)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: 'grid', gap: 6, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, background: T.surface }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                    {implementationPlan.transfers.length ? 'Traspasos sugeridos por instrumento' : 'No implementable automáticamente por instrumento'}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Operaciones sugeridas: {implementationPlan.transfers.length} · Total a mover {implementationMateriality ? formatClpShort(implementationMateriality.totalTradeClp) : '—'} ·
                    {' '}Misma moneda: {implementationPlan.restrictionsApplied.sameCurrency ? 'sí' : 'no'} ·
                    {' '}Misma administradora: {implementationPlan.restrictionsApplied.sameManager ? 'sí' : 'no'}
                  </div>
                  {implementationPlan.transfers.length ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {[...implementationPlan.transfers]
                        .sort((a, b) => b.amountClpMoved - a.amountClpMoved)
                        .map((transfer, index) => (
                          <div key={`${transfer.fromInstrumentId}-${transfer.toInstrumentId}-${index}`} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 8px', display: 'grid', gap: 4 }}>
                            <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                              Mover {formatClpShort(transfer.amountClpMoved)} desde {transfer.fromName} hacia {transfer.toName}
                            </div>
                            <div style={{ color: T.textMuted, fontSize: 10 }}>
                              {formatNativeAmount(transfer.amountNativeMoved, transfer.nativeCurrency)} ({(transfer.weightMoved * 100).toFixed(2)}% cartera)
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, color: T.textMuted, fontSize: 10 }}>
                              <div>Monto CLP principal: <span style={{ color: T.textSecondary }}>{formatClpShort(transfer.amountClpMoved)}</span></div>
                              <div>Monto nativo (ref): <span style={{ color: T.textSecondary }}>{formatNativeAmount(transfer.amountNativeMoved, transfer.nativeCurrency)}</span></div>
                              <div>% cartera (ref): <span style={{ color: T.textSecondary }}>{(transfer.weightMoved * 100).toFixed(2)}%</span></div>
                              <div>Moneda: <span style={{ color: T.textSecondary }}>{transfer.fromCurrency ?? transfer.nativeCurrency ?? 'No disponible'} → {transfer.toCurrency ?? 'No disponible'}</span></div>
                              <div>Compañía origen: <span style={{ color: T.textSecondary }}>{transfer.fromManager ?? 'No disponible'}</span></div>
                              <div>Compañía destino: <span style={{ color: T.textSecondary }}>{transfer.toManager ?? 'No disponible'}</span></div>
                              <div>Wrapper origen: <span style={{ color: T.textSecondary }}>{transfer.fromTaxWrapper ?? 'No disponible'}</span></div>
                              <div>Wrapper destino: <span style={{ color: T.textSecondary }}>{transfer.toTaxWrapper ?? 'No disponible'}</span></div>
                            </div>
                            <div style={{ color: T.textMuted, fontSize: 10 }}>
                              Razón: {transfer.rationale}
                            </div>
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', color: T.textMuted, fontSize: 9, fontWeight: 700 }}>
                              {transfer.constraints.sameCurrency ? <span style={{ border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 7px' }}>Misma moneda</span> : null}
                              {transfer.constraints.sameManager ? <span style={{ border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 7px' }}>Misma compañía</span> : <span style={{ border: `1px solid ${T.warning}`, borderRadius: 999, padding: '2px 7px', color: T.warning }}>Cross-company</span>}
                              {transfer.constraints.sameTaxWrapper ? <span style={{ border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 7px' }}>Mismo wrapper</span> : null}
                              {transfer.constraints.crossCurrency ? <span style={{ border: `1px solid ${T.warning}`, borderRadius: 999, padding: '2px 7px', color: T.warning }}>Cross-currency bloqueado/manual</span> : null}
                              {transfer.weightMoved * 100 >= IMPLEMENTATION_TRADE_RELEVANT_PORTFOLIO_PCT ? <span style={{ border: `1px solid ${T.primary}`, borderRadius: 999, padding: '2px 7px', color: T.primary }}>Monto material</span> : <span style={{ border: `1px solid ${T.border}`, borderRadius: 999, padding: '2px 7px' }}>Monto marginal</span>}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: T.warning, fontSize: 10, fontWeight: 800 }}>
                        No implementable automáticamente por instrumento.
                      </div>
                      <div style={{ color: T.warning, fontSize: 10 }}>
                        No se encontraron traspasos ejecutables con las restricciones actuales.
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 10 }}>
                        Esto es una guía por sleeve, no una instrucción operativa por instrumento.
                      </div>
                      {implementationSleeveMoneyGuide.length ? (
                        <div style={{ display: 'grid', gap: 3 }}>
                          {implementationSleeveMoneyGuide.map((line) => (
                            <div key={line} style={{ color: T.textSecondary, fontSize: 10 }}>{line}</div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: T.textMuted, fontSize: 10 }}>
                          No hay suficiente información para convertir el gap por sleeve a montos CLP accionables.
                        </div>
                      )}
                    </div>
                  )}
                  {implementationPlan.warnings.length ? (
                    <div style={{ display: 'grid', gap: 2 }}>
                      {implementationPlan.warnings.map((warning) => (
                        <div key={warning} style={{ color: T.warning, fontSize: 10 }}>{warning}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {realisticValidationError ? (
              <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>{realisticValidationError}</div>
            ) : null}
            {realisticValidation ? (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface, display: 'grid', gap: 4 }}>
                <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>Validación realista</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>{realisticValidation.message}</div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Éxito mix alcanzable: {formatPct(realisticValidation.row.success40Assisted)} · Δ vs ideal {formatSignedPp(realisticValidation.deltaVsIdealSuccessPp)}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Escenario activo tras implementación: {scenarioLabel(realisticValidation.row.source)}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Ruina20: {formatPct(realisticValidation.row.ruin20Assisted)} · Venta casa: {formatPct(realisticValidation.row.houseSalePct)} · MaxDD P50: {formatPct(realisticValidation.row.drawdownP50)}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {false ? <div /> : null}

        {phase2Rows.length > 0 && (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <button
              type="button"
              onClick={() => setLongevityOpen((prev) => !prev)}
              style={{
                background: 'transparent',
                border: 'none',
                color: T.textPrimary,
                fontSize: 12,
                fontWeight: 800,
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {longevityOpen ? '▾ Prórroga +5 años' : '▸ Prórroga +5 años'}
            </button>
            {longevityOpen ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Explora cuánto aguanta el plan completo si necesitara durar cinco años más. Esta métrica no cambia el resultado oficial a 40 años.
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Plan evaluado: {phase2LongevitySelectedRow.row ? `RV ${phase2LongevitySelectedRow.row.source.rvPct}% / RF ${phase2LongevitySelectedRow.row.source.rfPct}%` : 'No disponible'} · {phase2LongevitySelectedRow.reason}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Supuesto +5 años: se prolonga la última fase de gasto por 60 meses con el mismo gasto real.
                </div>
                <div>
                  <button
                    type="button"
                    onClick={runLongevityPlus5}
                    disabled={!phase2LongevitySelectedRow.row || longevityRunning}
                    style={{
                      background: longevityRunning ? T.surface : T.primary,
                      border: `1px solid ${longevityRunning ? T.border : T.primary}`,
                      color: longevityRunning ? T.textMuted : '#fff',
                      borderRadius: 999,
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: !phase2LongevitySelectedRow.row || longevityRunning ? 'not-allowed' : 'pointer',
                      opacity: !phase2LongevitySelectedRow.row ? 0.6 : 1,
                    }}
                  >
                    {longevityRunning ? 'Calculando prórroga +5…' : 'Calcular prórroga +5'}
                  </button>
                </div>
                {longevityError ? (
                  <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
                    {longevityError}
                  </div>
                ) : null}
                {longevityResult ? (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ color: T.textSecondary, fontSize: 11 }}>
                      Éxito 45 años: {formatPct(longevityResult.success45)}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11 }}>
                      Caída 40 → 45: {longevityResult.drop40To45Pp >= 0 ? '-' : '+'}{Math.abs(longevityResult.drop40To45Pp).toFixed(1)} pp
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11 }}>
                      Prórroga +5 entre quienes llegaron a 40: {longevityResult.carryAmong40 !== null ? formatPct(longevityResult.carryAmong40) : 'No disponible'}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      Terminal P50 all a 45: {formatMoney(longevityResult.terminalP50All45)}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
      </>
      ) : null}
    </div>
  );
}
