import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelParameters, PortfolioWeights, SimulationResults } from '../domain/model/types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import { T } from './theme';

type OptimizationMode = 'light' | 'normal' | 'decision';
type SourceMode = 'base' | 'simulation';

type Phase1Point = {
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

const SHORTLIST_BEST_SUCCESS_BAND = 0.015;
const SHORTLIST_MIN_RV_DISTANCE = 10;
const SHORTLIST_TARGET = 5;
const PHASE1_SWEEP_MIN_RV = 0;
const PHASE1_SWEEP_MAX_RV = 100;
const PHASE1_SWEEP_STEP = 10;
const TECHNICAL_TIE_BAND_PP = 0.2;
const DELTA_ZERO_EPSILON_PP = 0.05;
const PHASE2_COMPETITION_THRESHOLDS = {
  autonomousEligibilityGapPp: 1.0,
  material: {
    houseSalePctPpLower: 5.0,
    houseSaleYearLaterYears: 2.0,
    cutScenarioPctPpLower: 5.0,
    cutSeverityPpLower: 2.0,
    firstCutYearLaterYears: 2.0,
    ruin20PpLower: 0.5,
    maxDDP50PpLower: 3.0,
  },
  redFlags: {
    success40AssistedPpWorse: 0.5,
    houseSalePctPpWorse: 5.0,
    cutScenarioPctPpWorse: 5.0,
    cutSeverityPpWorse: 2.0,
    firstCutYearEarlierYears: 2.0,
    ruin20AssistedPpWorse: 0.5,
    maxDDP50PpWorse: 3.0,
  },
  compete: {
    minMaterialImprovements: 2,
  },
  displace: {
    success40AssistedMaxWorsePp: 0.2,
    minMaterialImprovements: 3,
  },
} as const;

const MIX_COMPARISON_THRESHOLDS = {
  successPpConsiderMin: 0.5,
  successPpStrongMin: 1.5,
  ruin20PpImprovement: 0.5,
  ruinP10YearsImprovement: 1.0,
  maxDDP50PpImprovement: 3.0,
} as const;

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

function formatPctValue(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

function formatDeltaVsBest(deltaVsBestPp: number): string {
  if (Math.abs(deltaVsBestPp) < DELTA_ZERO_EPSILON_PP) return '0.0 pp';
  return `${deltaVsBestPp.toFixed(1)} pp`;
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
  const [phase2Meta, setPhase2Meta] = useState<PhaseRunMeta | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [longevityOpen, setLongevityOpen] = useState(false);
  const [longevityRunning, setLongevityRunning] = useState(false);
  const [longevityResult, setLongevityResult] = useState<LongevityPlus5Result | null>(null);
  const [longevityError, setLongevityError] = useState<string | null>(null);

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
    if (stalePhase1) {
      setPhase1Points([]);
      setShortlist([]);
      setPhase1Meta(null);
    }
    if (stalePhase2 || stalePhase1) {
      setPhase2Rows([]);
      setPhase2Meta(null);
    }
  }, [expectedPhase1Hash, expectedPhase2Hash, phase1Meta, phase2Meta]);

  const runPhase1 = useCallback(async () => {
    if (phase1Running) return;
    setPhase1Running(true);
    setStaleNotice(null);
    setPhase1Points([]);
    setShortlist([]);
    setPhase2Rows([]);
    setLongevityResult(null);
    setLongevityError(null);
    try {
      // Permite pintar feedback de loading inmediatamente antes del trabajo pesado.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const autonomousBase = buildAutonomousParams(activeParams);
      const points: Phase1Point[] = [];
      for (let rvPct = PHASE1_SWEEP_MIN_RV; rvPct <= PHASE1_SWEEP_MAX_RV; rvPct += PHASE1_SWEEP_STEP) {
        const candidate = cloneParams(autonomousBase);
        const nextWeights = buildCandidateWeights(autonomousBase.weights, rvPct);
        candidate.weights = nextWeights;
        const sim = runSimulationCentral(candidate);
        points.push(toPhase1Point(rvPct, nextWeights, sim));
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      const currentRvPct = (autonomousBase.weights.rvGlobal + autonomousBase.weights.rvChile) * 100;
      const currentPointCandidate = toPhase1Point(currentRvPct, cloneParams(autonomousBase.weights), runSimulationCentral(autonomousBase), { isCurrentMix: true });
      if (!points.some((point) => isSameMix(point, currentPointCandidate))) {
        points.push(currentPointCandidate);
      } else {
        points.forEach((point) => {
          if (isSameMix(point, currentPointCandidate)) point.isCurrentMix = true;
        });
      }
      setPhase1Points(points);
      setShortlist(buildShortlist(points));
      setPhase1Meta(buildRunMeta(activeParams, activeLabel, 'phase1'));
      setPhase2Rows([]);
      setPhase2Meta(null);
    } finally {
      setPhase1Running(false);
    }
  }, [activeLabel, activeParams, phase1Running]);

  const runPhase2 = useCallback(async () => {
    if (phase2Running || !shortlist.length) return;
    setPhase2Running(true);
    setStaleNotice(null);
    setPhase2Rows([]);
    setLongevityResult(null);
    setLongevityError(null);
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
  const phase1SuggestedPoint = useMemo(
    () => choosePhase1Baseline(phase1Points),
    [phase1Points],
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
  const phase2DisplacingRows = useMemo(
    () => phase2Rows.filter((row) => phase2Decisions.get(row.source.rvPct)?.displacesPhase1),
    [phase2Decisions, phase2Rows],
  );
  const phase2LongevitySelectedRow = useMemo(() => {
    if (phase2DisplacingRows.length) {
      const sorted = [...phase2DisplacingRows].sort((a, b) => (
        (b.success40Assisted - a.success40Assisted)
        || (a.ruin20Assisted - b.ruin20Assisted)
        || (a.houseSalePct - b.houseSalePct)
      ));
      return {
        row: sorted[0] ?? null,
        reason: 'Seleccionado por desplazar a la referencia Fase 1',
      };
    }
    return {
      row: phase2BaselineRow,
      reason: 'Se usa la referencia Fase 1 (no hay desplazador claro)',
    };
  }, [phase2BaselineRow, phase2DisplacingRows]);
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
          Fase 1: optimización autónoma del portafolio. Fase 2: validación del shortlist en el modelo completo.
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
          Sweep RF/RV completo (RV 0% a 100%, paso 10) para elegir política de inversión por sí sola, sin casa y con cuts neutralizados de forma controlada.
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
        {phase1Meta ? renderRunMeta(phase1Meta, phase1IsStale) : null}
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          Mix actual: {phase1CurrentPoint ? `RV ${phase1CurrentPoint.rvPct}% / RF ${phase1CurrentPoint.rfPct}%` : `RV ${((activeParams.weights.rvGlobal + activeParams.weights.rvChile) * 100).toFixed(1)}% / RF ${(100 - ((activeParams.weights.rvGlobal + activeParams.weights.rvChile) * 100)).toFixed(1)}%`}
        </div>

        {phase1Top3.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: 'grid', gap: 5 }}>
              <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
                Referencia Fase 1 (mejor bruto): RV {phase1Top3[0].rvPct}% / RF {phase1Top3[0].rfPct}%
              </div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>
                Success40 autónomo = {formatPct(phase1Top3[0].success40)}
              </div>
              {phase1TechnicalTiePoints.length > 1 && phase1BalancedPoint && (
                <>
                  <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>
                    Empate técnico / finalista: RV {phase1BalancedPoint.rvPct}% / RF {phase1BalancedPoint.rfPct}
                  </div>
                  <div style={{ color: T.textMuted, fontSize: 10 }}>
                    Criterio: menor Ruina20, luego RuinP10 más tardío, luego menor MaxDDP50 y menor RV.
                  </div>
                </>
              )}
              {phase1Top3.slice(1).map((point, index) => (
                <div key={`phase1-top-${point.rvPct}`} style={{ color: T.textSecondary, fontSize: 11 }}>
                  {index + 2}º mejor: RV {point.rvPct}% / RF {point.rfPct}% · {formatPct(point.success40)} · {phase1BestSuccess !== null ? formatDeltaVsBest((point.success40 - phase1BestSuccess) * 100) : ''}
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
                      <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>
                        RV {point.rvPct}% / RF {point.rfPct}%
                        {point.isCurrentMix ? ' · mix actual' : ''}
                        {isBest ? ' · referencia Fase 1' : ''}
                        {!isBest && isBalanced ? ' · empate técnico (finalista)' : ''}
                        {!isBest && !isBalanced && isTechnicalTie ? ' · finalista Fase 1' : ''}
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
          Referencia Fase 1: {phase2BaselinePoint ? `RV ${phase2BaselinePoint.rvPct}% / RF ${phase2BaselinePoint.rfPct}%` : 'No disponible'} ·
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
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>RV {row.source.rvPct}% · RF {row.source.rfPct}%</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {isBaseline ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: T.primary, borderRadius: 999, padding: '2px 8px' }}>
                      Referencia Fase 1
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
