import type { SimulationResults } from '../model/types';

export type QualityOptimizationCandidate = {
  id: string;
  rvWeight: number;
  rfWeight: number;
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

const PRIMARY_TIE_TOLERANCE = 0.005;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function compareDescWithTolerance(
  left: number | null,
  right: number | null,
  tolerance = 0,
): number {
  const leftValid = isFiniteNumber(left);
  const rightValid = isFiniteNumber(right);
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;
  if (!leftValid && !rightValid) return 0;
  const delta = (right as number) - (left as number);
  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
}

function compareAscWithTolerance(
  left: number | null,
  right: number | null,
  tolerance = 0,
): number {
  const leftValid = isFiniteNumber(left);
  const rightValid = isFiniteNumber(right);
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;
  if (!leftValid && !rightValid) return 0;
  const delta = (left as number) - (right as number);
  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
}

export function buildQualityOptimizationCandidate(input: {
  id: string;
  rvWeight: number;
  rfWeight: number;
  result: SimulationResults;
}): QualityOptimizationCandidate {
  const { id, rvWeight, rfWeight, result } = input;
  const metrics = result.qualityOfLifeMetrics;
  const warnings = [...(metrics?.warnings ?? [])];

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
  const rankableComparison = compareDescWithTolerance(left.qasrStrict, right.qasrStrict, PRIMARY_TIE_TOLERANCE);
  if (rankableComparison !== 0) return rankableComparison;

  const qasrLeftValid = isFiniteNumber(left.qasrStrict);
  const qasrRightValid = isFiniteNumber(right.qasrStrict);
  if (!qasrLeftValid && !qasrRightValid) {
    return 0;
  }

  const csrComparison = compareDescWithTolerance(left.csr85_4, right.csr85_4, PRIMARY_TIE_TOLERANCE);
  if (csrComparison !== 0) return csrComparison;

  const successComparison = compareDescWithTolerance(left.classicSuccessRate, right.classicSuccessRate, PRIMARY_TIE_TOLERANCE);
  if (successComparison !== 0) return successComparison;

  const severeCutComparison = compareAscWithTolerance(left.monthsInSevereCutMean, right.monthsInSevereCutMean);
  if (severeCutComparison !== 0) return severeCutComparison;

  const severeStreakComparison = compareAscWithTolerance(
    left.maxConsecutiveSevereCutMonthsP75,
    right.maxConsecutiveSevereCutMonthsP75,
  );
  if (severeStreakComparison !== 0) return severeStreakComparison;

  const terminalP25Comparison = compareDescWithTolerance(left.terminalWealthP25, right.terminalWealthP25);
  if (terminalP25Comparison !== 0) return terminalP25Comparison;

  const terminalP50Comparison = compareDescWithTolerance(left.terminalWealthP50, right.terminalWealthP50);
  if (terminalP50Comparison !== 0) return terminalP50Comparison;

  return 0;
}

export function rankQualityOptimizationCandidates(
  candidates: QualityOptimizationCandidate[],
): QualityOptimizationCandidate[] {
  return [...candidates].sort(compareQualityOptimizationCandidates);
}
