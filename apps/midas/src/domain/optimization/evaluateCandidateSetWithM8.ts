import type { SimulationResults } from '../model/types';
import { buildMidasEvaluation } from '../model/midasEvaluation';
import type { MidasCandidateSet } from './candidateSet';
import { applyCandidateToM8Input, type AppliedCandidateChange } from './applyCandidateToM8Input';
import type { M8Input } from '../simulation/m8.types';
import { runM8 } from '../simulation/engineM8';
import { buildQualityOfLifeMetricsFromPathDiagnostics } from '../simulation/qualityOfLifeMetrics';

export type ScenarioLabM8Metrics = {
  success40: number | null;
  ruin40: number | null;
  nRuin: number | null;
  houseSalePct: number | null;
  houseSaleYearMedian: number | null;
  terminalWealthRatio: number | null;
  qolScore: number | null;
  qolLabel: string | null;
  csr85_4: number | null;
  qualitySurvivalRate: number | null;
  averageEffectiveSpendingRatio: number | null;
  severeCutYearsMean: number | null;
};

export type ScenarioLabM8MetricDeltas = {
  success40: number | null;
  ruin40: number | null;
  houseSalePct: number | null;
  terminalWealthRatio: number | null;
  qolScore: number | null;
  csr85_4: number | null;
  qualitySurvivalRate: number | null;
  averageEffectiveSpendingRatio: number | null;
  severeCutYearsMean: number | null;
};

export type ScenarioLabCandidateM8Result = {
  candidateId: string;
  label: string | null;
  candidateFamily: string | null;
  hypothesis: string | null;
  status: 'evaluated' | 'invalid' | 'engine_error';
  appliedChanges: AppliedCandidateChange[];
  proxy: {
    heuristicPriority: string | null;
    preM8Score: number | null;
    preM8ScoreExplanation: string | null;
    expectedDirectionalEffects: Record<string, string>;
  };
  metrics: ScenarioLabM8Metrics | null;
  deltaVsBaseline: ScenarioLabM8MetricDeltas | null;
  warnings: string[];
  errors: string[];
};

export type ScenarioLabCandidateSetM8Evaluation = {
  type: 'midas_optimization_results';
  version: '1.0';
  generatedAt: string;
  packFingerprint: string;
  baseline: {
    fingerprint: string | null;
    metrics: ScenarioLabM8Metrics;
  };
  candidates: ScenarioLabCandidateM8Result[];
};

const finiteOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const metricDelta = (candidate: number | null, baseline: number | null): number | null =>
  candidate === null || baseline === null ? null : candidate - baseline;

function buildMetricsFromBaseline(simResult: SimulationResults): ScenarioLabM8Metrics {
  const quality = simResult.qualityOfLifeMetrics ?? null;
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: quality,
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  return {
    success40: finiteOrNull(simResult.success40 ?? (typeof simResult.probRuin40 === 'number' ? 1 - simResult.probRuin40 : null)),
    ruin40: finiteOrNull(simResult.probRuin40 ?? simResult.probRuin),
    nRuin: finiteOrNull(simResult.nRuin),
    houseSalePct: finiteOrNull(simResult.houseSalePct),
    houseSaleYearMedian: finiteOrNull(simResult.saleYearMedian),
    terminalWealthRatio: finiteOrNull(quality?.terminalWealthRatio),
    qolScore: finiteOrNull(evaluation.cappedScore),
    qolLabel: evaluation.label,
    csr85_4: finiteOrNull(quality?.csr85_4),
    qualitySurvivalRate: finiteOrNull(quality?.qualitySurvivalRate),
    averageEffectiveSpendingRatio: finiteOrNull(quality?.averageEffectiveSpendingRatio),
    severeCutYearsMean: finiteOrNull(quality?.severeCutYearsMean),
  };
}

function buildMetricsFromRuntime(input: M8Input, startedAtMs: number): {
  metrics: ScenarioLabM8Metrics;
  warnings: string[];
} {
  const runtime = runM8(input);
  void startedAtMs;
  const quality = buildQualityOfLifeMetricsFromPathDiagnostics(runtime.pathQualityDiagnostics, {
    initialSimulableCapitalClp: input.capital_initial_clp,
  });
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: quality,
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'review',
  });
  return {
    metrics: {
      success40: finiteOrNull(runtime.Success40),
      ruin40: finiteOrNull(runtime.ProbRuin40),
      nRuin: Number.isFinite(runtime.ProbRuin40) ? Math.round(runtime.ProbRuin40 * input.n_paths) : null,
      houseSalePct: finiteOrNull(runtime.HouseSalePct),
      houseSaleYearMedian: finiteOrNull(runtime.SaleYearMedian),
      terminalWealthRatio: finiteOrNull(quality.terminalWealthRatio),
      qolScore: finiteOrNull(evaluation.cappedScore),
      qolLabel: evaluation.label,
      csr85_4: finiteOrNull(quality.csr85_4),
      qualitySurvivalRate: finiteOrNull(quality.qualitySurvivalRate),
      averageEffectiveSpendingRatio: finiteOrNull(quality.averageEffectiveSpendingRatio),
      severeCutYearsMean: finiteOrNull(quality.severeCutYearsMean),
    },
    warnings: Array.from(new Set([
      ...(quality.warnings ?? []),
      ...(evaluation.warnings ?? []),
    ])),
  };
}

function buildMetricDeltas(
  baseline: ScenarioLabM8Metrics,
  candidate: ScenarioLabM8Metrics,
): ScenarioLabM8MetricDeltas {
  return {
    success40: metricDelta(candidate.success40, baseline.success40),
    ruin40: metricDelta(candidate.ruin40, baseline.ruin40),
    houseSalePct: metricDelta(candidate.houseSalePct, baseline.houseSalePct),
    terminalWealthRatio: metricDelta(candidate.terminalWealthRatio, baseline.terminalWealthRatio),
    qolScore: metricDelta(candidate.qolScore, baseline.qolScore),
    csr85_4: metricDelta(candidate.csr85_4, baseline.csr85_4),
    qualitySurvivalRate: metricDelta(candidate.qualitySurvivalRate, baseline.qualitySurvivalRate),
    averageEffectiveSpendingRatio: metricDelta(candidate.averageEffectiveSpendingRatio, baseline.averageEffectiveSpendingRatio),
    severeCutYearsMean: metricDelta(candidate.severeCutYearsMean, baseline.severeCutYearsMean),
  };
}

export function evaluateCandidateSetWithM8(params: {
  baseInput: M8Input;
  baselineFingerprint: string | null;
  baselineResult: SimulationResults;
  candidateSet: MidasCandidateSet;
}): ScenarioLabCandidateSetM8Evaluation {
  const baselineMetrics = buildMetricsFromBaseline(params.baselineResult);

  const candidates = params.candidateSet.candidates.map<ScenarioLabCandidateM8Result>((candidate) => {
    const proxy = {
      heuristicPriority: candidate.heuristicPriority ?? null,
      preM8Score: finiteOrNull(candidate.preM8Score),
      preM8ScoreExplanation: candidate.preM8ScoreExplanation ?? null,
      expectedDirectionalEffects: { ...(candidate.expectedDirectionalEffects ?? {}) },
    };

    const applied = applyCandidateToM8Input(params.baseInput, candidate);
    if (!applied.ok) {
      return {
        candidateId: candidate.candidateId,
        label: candidate.label ?? null,
        candidateFamily: candidate.candidateFamily ?? null,
        hypothesis: candidate.hypothesis ?? null,
        status: 'invalid',
        appliedChanges: [],
        proxy,
        metrics: null,
        deltaVsBaseline: null,
        warnings: [],
        errors: applied.errors,
      };
    }

    try {
      const startedAtMs = Date.now();
      const evaluated = buildMetricsFromRuntime(applied.input, startedAtMs);
      return {
        candidateId: candidate.candidateId,
        label: candidate.label ?? null,
        candidateFamily: candidate.candidateFamily ?? null,
        hypothesis: candidate.hypothesis ?? null,
        status: 'evaluated',
        appliedChanges: applied.appliedChanges,
        proxy,
        metrics: evaluated.metrics,
        deltaVsBaseline: buildMetricDeltas(baselineMetrics, evaluated.metrics),
        warnings: evaluated.warnings,
        errors: [],
      };
    } catch (error) {
      return {
        candidateId: candidate.candidateId,
        label: candidate.label ?? null,
        candidateFamily: candidate.candidateFamily ?? null,
        hypothesis: candidate.hypothesis ?? null,
        status: 'engine_error',
        appliedChanges: applied.appliedChanges,
        proxy,
        metrics: null,
        deltaVsBaseline: null,
        warnings: [],
        errors: [error instanceof Error ? error.message : 'Error desconocido al correr M8 oficial.'],
      };
    }
  });

  return {
    type: 'midas_optimization_results',
    version: '1.0',
    generatedAt: new Date().toISOString(),
    packFingerprint: params.candidateSet.packFingerprint,
    baseline: {
      fingerprint: params.baselineFingerprint,
      metrics: baselineMetrics,
    },
    candidates,
  };
}
