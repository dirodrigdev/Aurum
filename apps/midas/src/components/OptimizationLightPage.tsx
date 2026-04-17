import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelParameters, PortfolioWeights, SimulationResults } from '../domain/model/types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import { loadInstrumentImplementationUniverse } from '../domain/instrumentImplementationLoader';
import { buildInstrumentImplementationPlan } from '../domain/instrumentImplementationPlanner';
import type { InstrumentImplementationPlan } from '../domain/instrumentImplementationTypes';
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
const MIX_COMPARISON_THRESHOLDS = optimizerPolicyConfig.moveRecommendation;

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

function formatNativeAmount(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const label = currency || 'Nativo';
  if (label.toUpperCase() === 'CLP') return formatClpShort(value);
  return `${label.toUpperCase()} ${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}

function formatPctValue(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

function formatSignedPp(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} pp`;
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

function buildCandidateWeights(currentWeights: PortfolioWeights, rvPct: number): PortfolioWeights {
  const globalShare = Math.max(0, Math.min(1, (currentWeights.rvGlobal + currentWeights.rfGlobal) || 0.5));
  const localShare = Math.max(0, Math.min(1, 1 - globalShare));
  const rv = rvPct / 100;
  const rf = 1 - rv;
  return {
    rvGlobal: rv * globalShare,
    rvChile: rv * localShare,
    rfGlobal: rf * globalShare,
    rfChile: rf * localShare,
  };
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
    ? 'El mix actual sigue siendo el mejor resultado técnico en Fase 1. Se mantiene un retador para validación comparativa.'
    : 'Fase 1 propone un campeón técnico distinto y conserva el mix actual como retador cuando está disponible.';

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
      detail: 'El mix actual ya es el campeón técnico de Fase 1.',
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
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
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
  const [realisticValidationRunning, setRealisticValidationRunning] = useState(false);
  const [realisticValidation, setRealisticValidation] = useState<RealisticValidationResult | null>(null);
  const [realisticValidationError, setRealisticValidationError] = useState<string | null>(null);
  const [phase3Running, setPhase3Running] = useState(false);
  const [phase3Result, setPhase3Result] = useState<Phase3Result | null>(null);
  const [phase3Error, setPhase3Error] = useState<string | null>(null);

  const activeParams = sourceMode === 'simulation' && simulationActive ? simulationParams : baseParams;
  const activeLabel = sourceMode === 'simulation' && simulationActive ? (simulationLabel ?? 'Simulación activa') : 'Base vigente';
  const sourceDescription = sourceMode === 'simulation' && simulationActive
    ? 'Simulación activa: usa los cambios temporales que estás probando'
    : 'Base vigente: usa la configuración persistida del caso';
  const sourceDeltaSummary = sourceMode === 'simulation' && simulationActive
    ? buildDeltaSummary(baseParams, simulationParams)
    : 'Sin cambios temporales respecto de la base vigente';
  const expectedPhase1Hash = useMemo(
    () => buildRunMeta(activeParams, activeLabel, 'phase1').scenarioHash,
    [activeLabel, activeParams],
  );
  const expectedPhase2Hash = useMemo(
    () => buildRunMeta(activeParams, activeLabel, 'phase2').scenarioHash,
    [activeLabel, activeParams],
  );
  const phase1IsStale = Boolean(phase1Meta && phase1Meta.scenarioHash !== expectedPhase1Hash);
  const phase2IsStale = Boolean(phase2Meta && phase2Meta.scenarioHash !== expectedPhase2Hash);

  useEffect(() => {
    const stalePhase1 = phase1Meta && phase1Meta.scenarioHash !== expectedPhase1Hash;
    const stalePhase2 = phase2Meta && phase2Meta.scenarioHash !== expectedPhase2Hash;
    if (!stalePhase1 && !stalePhase2) return;
    setStaleNotice('Resultados desactualizados: cambió la fuente o el escenario. Vuelve a ejecutar.');
    setLongevityResult(null);
    setLongevityError(null);
    setImplementationPlan(null);
    setImplementationError(null);
    setRealisticValidation(null);
    setRealisticValidationError(null);
    setPhase3Result(null);
    setPhase3Error(null);
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
  }, [expectedPhase1Hash, expectedPhase2Hash, phase1Meta, phase2Meta]);

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
    setRealisticValidation(null);
    setRealisticValidationError(null);
    setPhase3Result(null);
    setPhase3Error(null);
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
          : buildCandidateWeights(autonomousBase.weights, normalizedRv);
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
      setPhase1Meta(buildRunMeta(activeParams, activeLabel, 'phase1'));
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
  }, [activeLabel, activeParams, phase1Diagnostics?.runId, phase1Running]);

  const runPhase2 = useCallback(async () => {
    if (phase2Running || !shortlist.length) return;
    setPhase2Running(true);
    setStaleNotice(null);
    setPhase2Rows([]);
    setLongevityResult(null);
    setLongevityError(null);
    setImplementationPlan(null);
    setImplementationError(null);
    setRealisticValidation(null);
    setRealisticValidationError(null);
    setPhase3Result(null);
    setPhase3Error(null);
    try {
      // Permite pintar feedback de loading inmediatamente antes del trabajo pesado.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const baselinePoint = choosePhase1Baseline(phase1Points);
      const currentPoint = phase1Points.find((point) => point.isCurrentMix) ?? null;
      const evaluationPoints = [...shortlist];
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
        rows.push({
          source: point,
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
        });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      setPhase2Rows(rows);
      setPhase2Meta(buildRunMeta(activeParams, activeLabel, 'phase2'));
    } finally {
      setPhase2Running(false);
    }
  }, [activeLabel, activeParams, phase1Points, phase2Running, shortlist]);

  const modeCards = useMemo(
    () => ([
      { id: 'light', label: 'Light', active: mode === 'light', enabled: true, hint: 'Fase 1 + Fase 2' },
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
    if (!phase2Rows.length) return { champion: null as Phase2Point | null, challenger: null as Phase2Point | null, reason: 'Sin Fase 2 calculada' };
    const ranked = [...phase2Rows].sort((a, b) => {
      const decisionA = phase2Decisions.get(a.source.rvPct);
      const decisionB = phase2Decisions.get(b.source.rvPct);
      return (
        Number(Boolean(decisionB?.displacesPhase1)) - Number(Boolean(decisionA?.displacesPhase1))
        || Number(Boolean(decisionB?.competesWithPhase1)) - Number(Boolean(decisionA?.competesWithPhase1))
        || (b.success40Assisted - a.success40Assisted)
        || (a.ruin20Assisted - b.ruin20Assisted)
        || (a.houseSalePct - b.houseSalePct)
      );
    });
    const champion = ranked[0] ?? null;
    const challenger = (
      phase2CurrentRow && champion && !isSameMix(phase2CurrentRow.source, champion.source)
        ? phase2CurrentRow
        : ranked.find((row) => champion && !isSameMix(row.source, champion.source)) ?? null
    );
    const championDecision = champion ? phase2Decisions.get(champion.source.rvPct) : null;
    const reason = championDecision?.displacesPhase1
      ? 'Desplaza por mejoras materiales sin red flags'
      : championDecision?.competesWithPhase1
        ? 'Compite por mejor balance downside/supervivencia'
        : 'Campeón por mayor éxito asistido dentro del pool';
    return { champion, challenger, reason };
  }, [phase2CurrentRow, phase2Decisions, phase2Rows]);
  const phase3BaseSpendingVector = useMemo(
    () => getSpendingVector(activeParams),
    [activeParams],
  );
  const phase2LongevitySelectedRow = useMemo(() => {
    return {
      row: phase2ChampionChallenger.champion,
      reason: phase2ChampionChallenger.reason,
    };
  }, [phase2ChampionChallenger.champion, phase2ChampionChallenger.reason]);
  const phase2ImplementationSelectedRow = useMemo(() => phase2LongevitySelectedRow.row, [phase2LongevitySelectedRow.row]);
  const activeScenarioAfterPhase2 = useMemo(
    () => phase2ImplementationSelectedRow,
    [phase2ImplementationSelectedRow],
  );
  const activeScenarioAfterImplementation = useMemo(() => {
    if (!activeScenarioAfterPhase2) {
      return {
        row: null as Phase2Point | null,
        sourceLabel: 'Sin escenario activo post-Fase 2',
        blockedReason: 'Primero ejecuta Fase 2 para definir un escenario activo.',
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
        sourceLabel: 'Escenario activo recibido desde Fase 2',
        blockedReason: null as string | null,
        roleLabel: 'Activo post-Fase 2',
      };
    }
    if (!materialGap) {
      return {
        row: activeScenarioAfterPhase2,
        sourceLabel: 'Fase 3 usando escenario implementado equivalente',
        blockedReason: null as string | null,
        roleLabel: 'Implementado equivalente',
      };
    }
    if (realisticValidation?.row) {
      return {
        row: realisticValidation.row,
        sourceLabel: 'Fase 3 usando escenario validado tras implementación',
        blockedReason: null as string | null,
        roleLabel: 'Validado tras implementación',
      };
    }
    return {
      row: null as Phase2Point | null,
      sourceLabel: 'Escenario implementable pendiente de validación realista',
      blockedReason: 'Para ejecutar Fase 3 primero debes correr la Validación realista.',
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

  const runImplementation = useCallback(async () => {
    if (implementationRunning) return;
    const idealRow = phase2ImplementationSelectedRow;
    if (!idealRow) {
      setImplementationError('No hay escenario ideal de Fase 2 para construir implementación.');
      return;
    }
    setImplementationRunning(true);
    setImplementationError(null);
    setImplementationPlan(null);
    setRealisticValidation(null);
    setRealisticValidationError(null);
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
      setImplementationPlan(plan);
    } catch (error) {
      setImplementationError(error instanceof Error ? error.message : String(error));
    } finally {
      setImplementationRunning(false);
    }
  }, [implementationRunning, phase2ImplementationSelectedRow]);

  const runRealisticValidation = useCallback(async () => {
    if (realisticValidationRunning) return;
    const idealRow = phase2ImplementationSelectedRow;
    if (!implementationPlan || !idealRow) {
      setRealisticValidationError('Primero ejecuta Implementación para validar el mix alcanzable.');
      return;
    }
    if (Math.abs(implementationPlan.gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP + 1e-9) {
      setRealisticValidation({
        row: idealRow,
        deltaVsIdealSuccessPp: 0,
        message: 'Implementación equivalente al objetivo ideal (no requiere validación adicional).',
      });
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
      const row: Phase2Point = {
        source: {
          ...idealRow.source,
          rvPct: Number(reachableRv.toFixed(1)),
          rfPct: Number(reachableRf.toFixed(1)),
          weights: cloneParams(implementationPlan.reachableWeights),
        },
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
      };
      const deltaVsIdealSuccessPp = (row.success40Assisted - idealRow.success40Assisted) * 100;
      const message = Math.abs(deltaVsIdealSuccessPp) <= optimizerPolicyConfig.implementation.realisticValidationGapRvPp
        ? 'Implementación equivalente al objetivo (resultado prácticamente igual).'
        : 'La implementación real modifica el resultado del escenario ideal.';
      setRealisticValidation({ row, deltaVsIdealSuccessPp, message });
    } catch (error) {
      setRealisticValidationError(error instanceof Error ? error.message : String(error));
    } finally {
      setRealisticValidationRunning(false);
    }
  }, [activeParams, implementationPlan, phase2ImplementationSelectedRow, realisticValidationRunning]);

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
          Fase 1: optimización autónoma del portafolio. Fase 2: validación del shortlist. Fase 3: gasto cómodo dentro de banda de seguridad.
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
          <div style={{ color: T.textMuted, fontSize: 11 }}>Fuente del escenario</div>
          <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>{activeLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSourceMode('base')}
            style={{
              background: sourceMode === 'base' ? T.primary : T.surfaceEl,
              border: `1px solid ${sourceMode === 'base' ? T.primary : T.border}`,
              color: sourceMode === 'base' ? '#fff' : T.textSecondary,
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
            style={{
              background: sourceMode === 'simulation' ? T.primary : T.surfaceEl,
              border: `1px solid ${sourceMode === 'simulation' ? T.primary : T.border}`,
              color: sourceMode === 'simulation' ? '#fff' : T.textSecondary,
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
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>Fase 1 · Portafolio autónomo</div>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Sweep RF/RV completo, refinamiento local y mix actual preservado para elegir política de inversión por sí sola.
        </div>
        <div style={{ color: T.textMuted, fontSize: 10 }}>
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
        {phase1Diagnostics ? (
          <div style={{ color: T.textMuted, fontSize: 10 }}>
            Diagnóstico Fase 1 · run #{phase1Diagnostics.runId} · total {phase1Diagnostics.totalEvaluations}/{phase1Diagnostics.cap} · sweep {phase1Diagnostics.coarseEvaluations} · actual {phase1Diagnostics.currentEvaluations} · ref 2.5 {phase1Diagnostics.local25Evaluations} · ref 1.0 {phase1Diagnostics.micro10Evaluations} · {phase1Diagnostics.elapsedMs} ms{phase1Diagnostics.capReached ? ' · cap alcanzado' : ''}
          </div>
        ) : null}
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Mix actual: {phase1CurrentPoint ? `RV ${phase1CurrentPoint.rvPct}% / RF ${phase1CurrentPoint.rfPct}%` : `RV ${((activeParams.weights.rvGlobal + activeParams.weights.rvChile) * 100).toFixed(1)}% / RF ${(100 - ((activeParams.weights.rvGlobal + activeParams.weights.rvChile) * 100)).toFixed(1)}%`}
        </div>

        {phase1Top3.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: 'grid', gap: 5 }}>
              <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Campeón + retador Fase 1</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Campeón Fase 1: {phase1ChampionChallenger.champion ? scenarioLabel(phase1ChampionChallenger.champion) : 'No disponible'}
                {phase1ChampionChallenger.champion ? ` · ${formatPct(phase1ChampionChallenger.champion.success40)}` : ''}
              </div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Retador Fase 1: {phase1ChampionChallenger.challenger ? scenarioLabel(phase1ChampionChallenger.challenger) : 'No disponible'}
                {phase1ChampionChallenger.challenger ? ` · ${formatPct(phase1ChampionChallenger.challenger.success40)}` : ''}
              </div>
              <div style={{ color: phase1ChampionChallenger.materialityLabel === 'Mejora material' ? T.positive : T.warning, fontSize: 11, fontWeight: 700 }}>
                {phase1ChampionChallenger.materialityLabel}
                {phase1ChampionChallenger.deltaSuccessPp !== null ? ` · Δ éxito ${formatSignedPp(phase1ChampionChallenger.deltaSuccessPp)}` : ''}
              </div>
              <div style={{ color: T.textMuted, fontSize: 10 }}>
                {phase1ChampionChallenger.message}
              </div>
            </div>

            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: 'grid', gap: 5 }}>
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

            {phase1CurrentPoint && phase1SuggestedPoint && switchVerdict && (
              <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: 'grid', gap: 4 }}>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>¿Vale la pena cambiar?</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Desde: RV {phase1CurrentPoint.rvPct}% / RF {phase1CurrentPoint.rfPct}% · Hacia: RV {phase1SuggestedPoint.rvPct}% / RF {phase1SuggestedPoint.rfPct}%
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Cambio requerido: {switchVerdict.movePp.toFixed(1)} pp · Mejora en éxito: {switchVerdict.deltaSuccessPp >= 0 ? '+' : ''}{switchVerdict.deltaSuccessPp.toFixed(1)} pp
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Success40 actual: {formatPct(phase1CurrentPoint.success40)} · sugerido: {formatPct(phase1SuggestedPoint.success40)} · Ruina20 {formatPct(phase1CurrentPoint.ruin20)} → {formatPct(phase1SuggestedPoint.ruin20)}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  RuinP10 {formatYears(phase1CurrentPoint.ruinP10)} → {formatYears(phase1SuggestedPoint.ruinP10)} · MaxDDP50 {formatPct(phase1CurrentPoint.drawdownP50)} → {formatPct(phase1SuggestedPoint.drawdownP50)}
                </div>
                {phase2CurrentRow && phase2SuggestedRow ? (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Assisted: éxito {formatPct(phase2CurrentRow.success40Assisted)} → {formatPct(phase2SuggestedRow.success40Assisted)} · casa {formatPct(phase2CurrentRow.houseSalePct)} → {formatPct(phase2SuggestedRow.houseSalePct)} · cuts {phase2CurrentRow.cutScenarioPct !== null ? formatPct(phase2CurrentRow.cutScenarioPct) : 'NA'} → {phase2SuggestedRow.cutScenarioPct !== null ? formatPct(phase2SuggestedRow.cutScenarioPct) : 'NA'}
                  </div>
                ) : null}
                <div style={{ color: switchVerdict.level === 'cambiar' ? T.positive : switchVerdict.level === 'considerar' ? T.warning : T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                  Veredicto: {switchVerdict.label}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>{switchVerdict.detail}</div>
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
                  <div
                    key={`phase1-sweep-${point.rvPct}`}
                    style={{
                      background: T.surfaceEl,
                      border: `1px solid ${isBest ? T.primary : isBalanced ? '#4e86ff' : isTechnicalTie ? T.warning : T.border}`,
                      borderRadius: 10,
                      padding: '9px 10px',
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>{scenarioLabel(point)}</span>
                        {point.isCurrentMix ? <span style={{ color: '#fff', background: T.primary, borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>Mix actual</span> : null}
                        {isPhase1Champion ? <span style={{ color: '#fff', background: T.primary, borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>Campeón Fase 1</span> : null}
                        {isPhase1Challenger ? <span style={{ color: '#6c4a12', background: 'rgba(216, 162, 74, 0.16)', borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>Retador Fase 1</span> : null}
                        {isBest ? <span style={{ color: '#fff', background: T.primary, borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>Baseline Fase 1</span> : null}
                        {!isBest && (isBalanced || isTechnicalTie) ? <span style={{ color: '#6c4a12', background: 'rgba(216, 162, 74, 0.16)', borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>Finalista Fase 1</span> : null}
                        <span style={{ color: passesPhase2 ? '#fff' : T.textMuted, background: passesPhase2 ? T.positive : T.surface, border: `1px solid ${passesPhase2 ? T.positive : T.border}`, borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>
                          {passesPhase2 ? 'Pasa a Fase 2' : 'No pasa a Fase 2'}
                        </span>
                      </div>
                      <div style={{ color: isBest ? T.primary : T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                        Δ vs mejor: {isBest ? '0.0 pp' : isTechnicalTie ? 'Empate técnico' : formatDeltaVsBest(deltaVsBest)}
                      </div>
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11 }}>
                      Success40 autónomo: {formatPct(point.success40)} · Ruina20 autónoma: {formatPct(point.ruin20)}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      RuinP10: {formatYears(point.ruinP10)} · MaxDDP50: {formatPct(point.drawdownP50)} · Terminal P50 all: {formatMoney(point.terminalP50All)}
                    </div>
                  </div>
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

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>Fase 2 · Validación modelo completo</div>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Evalúa el shortlist de Fase 1 con el modelo completo (casa + cuts + protecciones activas). Esta fase no reoptimiza: solo valida costo de supervivencia.
        </div>
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Baseline Fase 1: {phase2BaselinePoint ? scenarioLabel(phase2BaselinePoint) : 'No disponible'} ·
          {' '}{phase1BalancedPoint ? 'Mejor balanceado en mundo autónomo' : 'Mejor bruto en mundo autónomo'}
        </div>
        <div>
          <button
            type="button"
            onClick={runPhase2}
            disabled={phase2Running || !shortlist.length || mode !== 'light'}
            style={{
              background: phase2Running ? T.surfaceEl : T.primary,
              border: `1px solid ${phase2Running ? T.border : T.primary}`,
              color: phase2Running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: phase2Running || !shortlist.length || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: (!shortlist.length || mode !== 'light') ? 0.65 : 1,
            }}
          >
            {phase2Running ? 'Calculando Fase 2…' : 'Evaluar Fase 2'}
          </button>
        </div>
        {phase2Meta ? renderRunMeta(phase2Meta, phase2IsStale) : null}
        {!phase2BaselineRow && phase2Rows.length > 0 ? (
          <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
            No se pudo determinar baseline de Fase 2 para comparar competencia.
          </div>
        ) : null}

        {phase2Rows.length > 0 && (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {phase2Rows.map((row) => {
              const decision = phase2Decisions.get(row.source.rvPct) ?? null;
              const isBaseline = Boolean(phase2BaselinePoint && isSameMix(row.source, phase2BaselinePoint));
              const isPhase1Finalist = Boolean(
                !isBaseline && phase1TechnicalTiePoints.some((point) => isSameMix(point, row.source)),
              );
              const isCompeting = Boolean(!isBaseline && decision?.competesWithPhase1);
              const isDisplacing = Boolean(!isBaseline && decision?.displacesPhase1);
              const phase3Eligible = phase3InputRows.some((candidate) => isSameMix(candidate.source, row.source));
              const cardBorderColor = isBaseline
                ? T.primary
                : isDisplacing
                  ? T.positive
                  : isCompeting
                    ? '#d8a24a'
                    : T.border;
              const cardBorderWidth = isDisplacing ? 2.5 : (isBaseline ? 2.5 : (isCompeting ? 1.5 : 1));
              const cardShadow = isDisplacing
                ? '0 0 0 1px rgba(72, 199, 116, 0.22), 0 6px 16px rgba(72, 199, 116, 0.10)'
                : isBaseline
                  ? '0 0 0 1px rgba(92, 128, 255, 0.24), 0 4px 12px rgba(92, 128, 255, 0.10)'
                  : 'none';
              return (
              <div
                key={`phase2-${row.source.rvPct}`}
                style={{
                  background: T.surfaceEl,
                  border: `${cardBorderWidth}px solid ${cardBorderColor}`,
                  borderRadius: 12,
                  boxShadow: cardShadow,
                  padding: 10,
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>{scenarioLabel(row.source)}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {isBaseline ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: T.primary, borderRadius: 999, padding: '2px 8px' }}>
                      Referencia
                    </span>
                  ) : null}
                  {!isBaseline && decision ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: decision.competesWithPhase1 ? '#fff' : T.textSecondary,
                        background: decision.competesWithPhase1 ? T.positive : T.surface,
                        border: `1px solid ${decision.competesWithPhase1 ? T.positive : T.border}`,
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      {decision.competesWithPhase1 ? 'Compite con Fase 1' : 'No compite'}
                    </span>
                  ) : null}
                  {!isBaseline && isPhase1Finalist ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#6c4a12',
                        background: 'rgba(216, 162, 74, 0.16)',
                        border: '1px solid rgba(216, 162, 74, 0.35)',
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      Finalista Fase 1
                    </span>
                  ) : null}
                  {!isBaseline && decision?.displacesPhase1 ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: T.positive, borderRadius: 999, padding: '2px 8px' }}>
                      Desplaza a Fase 1
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: phase3Eligible ? '#fff' : T.textMuted,
                      background: phase3Eligible ? '#d8a24a' : T.surface,
                      border: `1px solid ${phase3Eligible ? '#d8a24a' : T.border}`,
                      borderRadius: 999,
                      padding: '2px 8px',
                    }}
                  >
                    {phase3Eligible ? 'Elegible Fase 3' : 'No elegible Fase 3'}
                  </span>
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Éxito40 asistido: {formatPct(row.success40Assisted)} ({row.success40Assisted >= row.source.success40 ? '+' : ''}{((row.success40Assisted - row.source.success40) * 100).toFixed(1)}pp vs autónomo)</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Ruina20 asistida: {formatPct(row.ruin20Assisted)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Venta de casa: {formatPct(row.houseSalePct)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Año venta P50: {formatYears(row.houseSaleYearP50)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Escenarios con cuts: {row.cutScenarioPct !== null ? formatPct(row.cutScenarioPct) : 'No disponible'}
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Recorte medio: {row.cutSeverityMean !== null ? formatPct(row.cutSeverityMean) : 'No disponible'}
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Primer cut año P50: {formatYears(row.firstCutYearP50)}</div>
                <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>{classifyRescueDependency(row)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Terminal P50 (all): {formatMoney(row.terminalP50All)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Terminal P50 (survivors): {formatMoney(row.terminalP50Survivors)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>MaxDD P50: {formatPct(row.drawdownP50)}</div>
                {!isBaseline && decision ? (
                  <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
                    {decision.reasons.map((reason) => (
                      <div key={`${row.source.rvPct}-${reason}`} style={{ color: T.textMuted, fontSize: 10 }}>
                        {reason}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        )}

        {phase2ChampionChallenger.champion ? (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 4 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Champion / challenger persistentes</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Campeón provisional: {scenarioLabel(phase2ChampionChallenger.champion.source)} · {formatPct(phase2ChampionChallenger.champion.success40Assisted)} · {phase2ChampionChallenger.reason}
            </div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Retador final: {phase2ChampionChallenger.challenger ? `${scenarioLabel(phase2ChampionChallenger.challenger.source)} · ${formatPct(phase2ChampionChallenger.challenger.success40Assisted)}` : 'No disponible'}
            </div>
          </div>
        ) : null}

        {phase2Rows.length > 0 && (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Implementación · Traspasos sugeridos</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Traduce el objetivo ideal a instrumentos reales (sin tocar el JSON abstracto del optimizador).
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Escenario activo recibido desde Fase 2: {activeScenarioAfterPhase2 ? scenarioLabel(activeScenarioAfterPhase2.source) : 'No disponible'} · {phase2LongevitySelectedRow.reason}
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Objetivo ideal base (Implementation): {phase2ImplementationSelectedRow ? scenarioLabel(phase2ImplementationSelectedRow.source) : 'No disponible'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={runImplementation}
                disabled={implementationRunning || !phase2ImplementationSelectedRow}
                style={{
                  background: implementationRunning ? T.surface : T.primary,
                  border: `1px solid ${implementationRunning ? T.border : T.primary}`,
                  color: implementationRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: implementationRunning || !phase2ImplementationSelectedRow ? 'not-allowed' : 'pointer',
                  opacity: !phase2ImplementationSelectedRow ? 0.6 : 1,
                }}
              >
                {implementationRunning ? 'Calculando implementación…' : 'Calcular implementación'}
              </button>
              <button
                type="button"
                onClick={runRealisticValidation}
                disabled={realisticValidationRunning || !implementationPlan || implementationPlan.equivalentToIdeal}
                style={{
                  background: realisticValidationRunning ? T.surface : T.primary,
                  border: `1px solid ${realisticValidationRunning ? T.border : T.primary}`,
                  color: realisticValidationRunning ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: realisticValidationRunning || !implementationPlan || implementationPlan.equivalentToIdeal ? 'not-allowed' : 'pointer',
                  opacity: !implementationPlan || implementationPlan.equivalentToIdeal ? 0.6 : 1,
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
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Mix post-traspasos</div>
                    <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>
                      {formatMixPair(implementationPlan.reachableMix)}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Gap vs ideal (RV)</div>
                    <div style={{ color: Math.abs(implementationPlan.gapVsIdealRvPp) <= REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP ? T.positive : T.warning, fontSize: 15, fontWeight: 800 }}>
                      {formatSignedPp(-implementationPlan.gapVsIdealRvPp)}
                    </div>
                  </div>
                </div>
                <div style={{ color: implementationPlan.equivalentToIdeal ? T.positive : T.warning, fontSize: 11, fontWeight: 700 }}>
                  {implementationPlan.equivalentToIdeal
                    ? 'Con estos traspasos se llega al objetivo ideal dentro de tolerancia.'
                    : 'Gap material detectado: se requiere Validación realista para pasar a Fase 3.'}
                </div>
                <div style={{ color: T.textMuted, fontSize: 10 }}>
                  Restricciones aplicadas · misma moneda: {implementationPlan.restrictionsApplied.sameCurrency ? 'sí' : 'no'} ·
                  {' '}misma administradora: {implementationPlan.restrictionsApplied.sameManager ? 'sí' : 'no'} ·
                  {' '}mismo wrapper: {implementationPlan.restrictionsApplied.sameTaxWrapper ? 'sí' : 'no'} ·
                  {' '}cross-manager: {implementationPlan.restrictionsApplied.crossManager ? 'sí' : 'no'} ·
                  {' '}cross-currency: {implementationPlan.restrictionsApplied.crossCurrency ? 'sí' : 'no'}
                </div>
                {implementationPlan.transfers.length ? (
                  <div style={{ display: 'grid', gap: 3 }}>
                    {implementationPlan.transfers.slice(0, 6).map((transfer, index) => (
                      <div key={`${transfer.fromInstrumentId}-${transfer.toInstrumentId}-${index}`} style={{ color: T.textSecondary, fontSize: 10, display: 'grid', gap: 2 }}>
                        <div style={{ color: T.textPrimary, fontWeight: 800 }}>
                          {transfer.fromName} → {transfer.toName}
                        </div>
                        <div>
                          {formatNativeAmount(transfer.amountNativeMoved, transfer.nativeCurrency)} · {formatClpShort(transfer.amountClpMoved)} · {(transfer.weightMoved * 100).toFixed(2)}% cartera
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', color: T.textMuted }}>
                          <span>{transfer.rationale}</span>
                          {transfer.constraints.crossManager ? <span style={{ color: '#6c4a12' }}>Cross-manager</span> : null}
                          {transfer.constraints.crossCurrency ? <span style={{ color: T.warning }}>Cross-currency</span> : null}
                          {!transfer.constraints.sameManager || transfer.constraints.crossCurrency ? <span>Fallback por falta de alternativa</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    No hay traspasos sugeridos con el universo cargado.
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

        {phase2Rows.length > 0 && (
          <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Fase 3 · Calidad de vida / gasto</div>
            <div style={{ color: T.textSecondary, fontSize: 11 }}>
              Busca variantes de gasto más cómodas sobre el escenario final validado y dentro de la banda aceptable de éxito.
            </div>
            <div style={{ color: T.textMuted, fontSize: 10 }}>
              Fuente Fase 3: {phase3Input.sourceLabel} · Escenarios base: {phase3InputRows.length
                ? phase3InputRows.map((row) => scenarioLabel(row.source)).join(' · ')
                : 'No disponibles'} · banda pool {formatPct(phase3Input.poolBand)} · grilla {PHASE3_SPENDING_VARIANTS.length} variantes.
            </div>
            {phase3Input.blockedReason ? (
              <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
                {phase3Input.blockedReason}
              </div>
            ) : null}
            {phase3InputRows.length > 0 ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                  Escenarios base evaluados en Fase 3
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {phase3InputRows.map((row) => {
                    const decision = phase2Decisions.get(row.source.rvPct) ?? null;
                    const isActive = Boolean(phase3Input.activeRow && isSameMix(row.source, phase3Input.activeRow.source));
                    const isChallenger = Boolean(phase3Input.challengerRow && isSameMix(row.source, phase3Input.challengerRow.source));
                    const roleLabel = isActive
                      ? phase3Input.activeRoleLabel
                      : isChallenger
                        ? 'Retador desde Fase 2'
                        : decision?.displacesPhase1
                          ? 'Desplaza'
                          : decision?.competesWithPhase1
                            ? 'Compite'
                            : 'Finalista';
                    return (
                      <div
                        key={`phase3-base-${row.source.rvPct}-${roleLabel}`}
                        style={{
                          border: `1px solid ${isActive ? T.primary : decision?.displacesPhase1 ? T.positive : T.border}`,
                          background: T.surface,
                          borderRadius: 10,
                          padding: '6px 8px',
                          display: 'grid',
                          gap: 2,
                          minWidth: 158,
                        }}
                      >
                        <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 800 }}>
                          {scenarioLabel(row.source)}
                        </div>
                        <div style={{ color: T.textSecondary, fontSize: 10 }}>
                          {roleLabel} · {formatPct(row.success40Assisted)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div>
              <button
                type="button"
                onClick={runPhase3}
                disabled={phase3Running || !phase3InputRows.length}
                style={{
                  background: phase3Running ? T.surface : T.primary,
                  border: `1px solid ${phase3Running ? T.border : T.primary}`,
                  color: phase3Running ? T.textMuted : '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: phase3Running || !phase3InputRows.length ? 'not-allowed' : 'pointer',
                  opacity: !phase3InputRows.length ? 0.6 : 1,
                }}
              >
                {phase3Running ? 'Calculando Fase 3…' : 'Ejecutar Fase 3'}
              </button>
            </div>
            {phase3Error ? (
              <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>{phase3Error}</div>
            ) : null}
            {phase3Result ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 9 }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Techo del pool Fase 3</div>
                    <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{formatPct(phase3Result.bestSuccessRow.success40Assisted)}</div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      {scenarioLabel(phase3Result.bestSuccessRow.source)} · banda entrada {formatPct(phase3Result.poolBand)}
                    </div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 9 }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Banda usada</div>
                    <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{formatPct(phase3Result.successBand)}</div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Mínimo aceptado: {formatPct(phase3Result.minimumSuccess)}</div>
                  </div>
                  <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 9 }}>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Candidatos evaluados</div>
                    <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{phase3Result.candidatesEvaluated}</div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>Elegibles: {phase3Result.eligibleCandidates}</div>
                  </div>
                </div>

                {phase3Result.preferred ? (
                  <div style={{ border: `1px solid ${T.positive}`, borderRadius: 12, padding: 10, display: 'grid', gap: 5 }}>
                    <div style={{ color: T.positive, fontSize: 11, fontWeight: 800 }}>
                      Escenario recomendado final
                    </div>
                    <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
                      Ganador: {scenarioLabel(phase3Result.preferred.baseRow.source)}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      Fuente final: {realisticValidation?.row && phase3Result.preferred.baseRow === realisticValidation.row
                        ? 'Mix implementable revalidado'
                        : 'Mix ideal equivalente'}
                      {' '}· Veredicto: {switchVerdict?.level === 'cambiar' ? 'Mover' : switchVerdict?.level === 'considerar' ? 'Considerar' : 'No mover'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>Éxito final elegido (Fase 3)</div>
                        <div style={{ color: T.textPrimary, fontSize: 20, fontWeight: 900 }}>{formatPct(phase3Result.preferred.success40)}</div>
                      </div>
                      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, background: T.surface }}>
                        <div style={{ color: T.textMuted, fontSize: 10 }}>Mejora ponderada de gasto</div>
                        <div style={{ color: phase3Result.preferred.weightedSpendingImprovementPct >= 0 ? T.positive : T.warning, fontSize: 20, fontWeight: 900 }}>
                          {formatSignedPct(phase3Result.preferred.weightedSpendingImprovementPct)}
                        </div>
                      </div>
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11 }}>
                      Variante: {phase3Result.preferred.variant.label} · Δ vs techo de éxito {formatSignedPp(phase3Result.preferred.deltaVsBestSuccessPp)}
                    </div>
                    <div style={{ color: T.textSecondary, fontSize: 11 }}>
                      QoL score {phase3Result.preferred.qualityOfLifeScore.toFixed(3)}
                    </div>
                    <div style={{ display: 'grid', gap: 3 }}>
                      {phase3Result.preferred.spendingVector.map((target, index) => {
                        const base = phase3BaseSpendingVector[index] ?? target;
                        const changePct = base > 0 ? ((target / base) - 1) * 100 : 0;
                        return (
                          <div key={`phase3-spend-breakdown-${index}`} style={{ color: T.textMuted, fontSize: 10 }}>
                            Fase {index + 1}: {formatMoney(base)} → {formatMoney(target)} ({formatSignedPct(changePct)})
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 10 }}>
                      Guardrails: {phase3Result.preferred.guardrailsPassed ? 'OK' : phase3Result.preferred.guardrailViolations.join(' · ')}
                    </div>
                    {phase3Result.runnerUp ? (
                      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 6, color: T.textSecondary, fontSize: 11 }}>
                        Retador final: {scenarioLabel(phase3Result.runnerUp.baseRow.source)} · {phase3Result.runnerUp.variant.label} · éxito {formatPct(phase3Result.runnerUp.success40)} · mejora gasto {formatSignedPct(phase3Result.runnerUp.weightedSpendingImprovementPct)}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ color: T.warning, fontSize: 11, fontWeight: 700 }}>
                    No se encontró una variante de gasto que mejore calidad de vida dentro de la banda de seguridad.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

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
    </div>
  );
}
