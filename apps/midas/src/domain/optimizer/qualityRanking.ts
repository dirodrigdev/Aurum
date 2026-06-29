import { buildMidasEvaluation } from '../model/midasEvaluation';
import type { MidasEvaluationV1, QualityOfLifeMetricsV1, SimulationResults } from '../model/types';
import { compareOptimizerEvaluationCandidates } from './optimizerCandidateRanking';

export type QualityOptimizationCandidate = {
  id: string;
  rvWeight: number;
  rfWeight: number;
  qualityOfLifeMetrics: QualityOfLifeMetricsV1 | null;
  midasEvaluation: MidasEvaluationV1 | null;
  isComparable: boolean;
  evaluationScore: number | null;
  qualitySurvivalRate: number | null;
  monthsBelow85: number | null;
  maxConsecutiveMonthsBelow85: number | null;
  earlyStressMonths: number | null;
  terminalWealthRatio: number | null;
  qasrStrict: number | null;
  csr85_4: number | null;
  classicSuccessRate: number | null;
  monthsInSevereCutMean: number | null;
  maxConsecutiveSevereCutMonthsP75: number | null;
  terminalWealthP25: number | null;
  terminalWealthP50: number | null;
  houseSaleRate: number | null;
  warnings: string[];
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function buildQualityOptimizationCandidate(input: {
  id: string;
  rvWeight: number;
  rfWeight: number;
  result: SimulationResults;
}): QualityOptimizationCandidate {
  const { id, rvWeight, rfWeight, result } = input;
  const metrics = result.qualityOfLifeMetrics;
  const midasEvaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: metrics,
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
    comparabilityWarnings: metrics?.warnings ?? [],
  });
  const warnings = [...(metrics?.warnings ?? []), ...(midasEvaluation.warnings ?? [])];

  if (!metrics) {
    warnings.push('quality_of_life_metrics_missing');
  }
  if (!isFiniteNumber(metrics?.qasrStrict)) {
    warnings.push('candidate_not_rankable_by_quality');
  }

  return {
    id,
    rvWeight,
    rfWeight,
    qualityOfLifeMetrics: metrics ?? null,
    midasEvaluation,
    isComparable: midasEvaluation.isComparable,
    evaluationScore: midasEvaluation.cappedScore ?? midasEvaluation.rawScore,
    qualitySurvivalRate: metrics?.qualitySurvivalRate ?? null,
    monthsBelow85: metrics?.monthsBelow85 ?? null,
    maxConsecutiveMonthsBelow85: metrics?.maxConsecutiveMonthsBelow85 ?? null,
    earlyStressMonths: metrics?.earlyStressMonths ?? null,
    terminalWealthRatio: metrics?.terminalWealthRatio ?? null,
    qasrStrict: metrics?.qasrStrict ?? null,
    csr85_4: metrics?.csr85_4 ?? null,
    classicSuccessRate: metrics?.classicSuccessRate ?? null,
    monthsInSevereCutMean: metrics?.monthsInSevereCutMean ?? null,
    maxConsecutiveSevereCutMonthsP75: metrics?.maxConsecutiveSevereCutMonthsP75 ?? null,
    terminalWealthP25: metrics?.terminalWealthP25 ?? null,
    terminalWealthP50: metrics?.terminalWealthP50 ?? null,
    houseSaleRate: metrics?.houseSaleRate ?? null,
    warnings,
  };
}

export function compareQualityOptimizationCandidates(
  left: QualityOptimizationCandidate,
  right: QualityOptimizationCandidate,
): number {
  return compareOptimizerEvaluationCandidates(left, right);
}

export function rankQualityOptimizationCandidates(
  candidates: QualityOptimizationCandidate[],
): QualityOptimizationCandidate[] {
  return [...candidates].sort(compareQualityOptimizationCandidates);
}
