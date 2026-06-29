import type { MidasEvaluationLabel } from '../model/types';

export type OptimizerEvaluationCandidate = {
  id: string;
  isComparable?: boolean;
  evaluationScore?: number | null;
  qasrStrict?: number | null;
  csr85_4?: number | null;
  classicSuccessRate?: number | null;
  qualitySurvivalRate?: number | null;
  monthsBelow85?: number | null;
  maxConsecutiveMonthsBelow85?: number | null;
  earlyStressMonths?: number | null;
  terminalWealthRatio?: number | null;
  houseSaleRate?: number | null;
  warnings?: string[];
  midasEvaluation?: {
    label: MidasEvaluationLabel;
    rawScore: number | null;
    cappedScore: number | null;
    capsApplied: string[];
    alerts: string[];
    warnings: string[];
    isComparable: boolean;
  } | null;
};

export type RankedOptimizerCandidate = {
  rank: number;
  candidateId: string;
  label: MidasEvaluationLabel;
  score: number | null;
  isComparable: boolean;
  rankingReason: string;
  primaryAlerts: string[];
  capsApplied: string[];
  tradeoffs: string[];
  warningCount: number;
};

export type OptimizerCandidateRankingResult = {
  ranked: RankedOptimizerCandidate[];
  recommendedCandidateId: string | null;
  discardedCandidateIds: string[];
};

const PRIMARY_TIE_TOLERANCE = 0.005;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const compareDescWithTolerance = (
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance = 0,
): number => {
  const leftValid = isFiniteNumber(left);
  const rightValid = isFiniteNumber(right);
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;
  if (!leftValid && !rightValid) return 0;
  const delta = (right as number) - (left as number);
  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
};

const compareAscWithTolerance = (
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance = 0,
): number => {
  const leftValid = isFiniteNumber(left);
  const rightValid = isFiniteNumber(right);
  if (leftValid && !rightValid) return -1;
  if (!leftValid && rightValid) return 1;
  if (!leftValid && !rightValid) return 0;
  const delta = (left as number) - (right as number);
  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
};

const warningCount = (candidate: OptimizerEvaluationCandidate): number =>
  new Set([...(candidate.warnings ?? []), ...(candidate.midasEvaluation?.warnings ?? [])]).size;

const hasStress = (candidate: OptimizerEvaluationCandidate): boolean =>
  isFiniteNumber(candidate.monthsBelow85) && candidate.monthsBelow85 > 0;

const buildRankingReason = (
  candidate: OptimizerEvaluationCandidate,
  leader: OptimizerEvaluationCandidate | null,
): string => {
  if ((candidate.isComparable ?? candidate.midasEvaluation?.isComparable ?? false) === false) {
    return 'No comparable: queda fuera de recomendación.';
  }
  if (!leader || leader.id === candidate.id) {
    if (isFiniteNumber(candidate.qualitySurvivalRate) && candidate.qualitySurvivalRate >= 0.8) {
      return 'Gana por mejor calidad de vida agregada y estrés contenido.';
    }
    if (isFiniteNumber(candidate.earlyStressMonths) && candidate.earlyStressMonths <= 2) {
      return 'Gana por menor estrés temprano y continuidad más limpia.';
    }
    return 'Gana por mejor balance entre calidad, recortes y margen terminal.';
  }
  if (
    isFiniteNumber(candidate.qualitySurvivalRate)
    && isFiniteNumber(leader.qualitySurvivalRate)
    && candidate.qualitySurvivalRate < leader.qualitySurvivalRate - PRIMARY_TIE_TOLERANCE
  ) {
    return 'Queda debajo por menor qualitySurvivalRate.';
  }
  if (
    isFiniteNumber(candidate.earlyStressMonths)
    && isFiniteNumber(leader.earlyStressMonths)
    && candidate.earlyStressMonths > leader.earlyStressMonths
  ) {
    return 'Queda debajo por mayor estrés temprano.';
  }
  if (
    isFiniteNumber(candidate.maxConsecutiveMonthsBelow85)
    && isFiniteNumber(leader.maxConsecutiveMonthsBelow85)
    && candidate.maxConsecutiveMonthsBelow85 > leader.maxConsecutiveMonthsBelow85
  ) {
    return 'Queda debajo por peor racha bajo 85%.';
  }
  return 'Queda debajo por balance QoL inferior frente al líder.';
};

const buildTradeoffs = (candidate: OptimizerEvaluationCandidate): string[] => {
  const items: string[] = [];
  if (isFiniteNumber(candidate.qualitySurvivalRate) && candidate.qualitySurvivalRate < 0.7) {
    items.push('qualitySurvivalRate limitado');
  }
  if (isFiniteNumber(candidate.earlyStressMonths) && candidate.earlyStressMonths > 2) {
    items.push('estrés temprano visible');
  }
  if (isFiniteNumber(candidate.maxConsecutiveMonthsBelow85) && candidate.maxConsecutiveMonthsBelow85 > 6) {
    items.push('racha bajo 85% prolongada');
  }
  if (hasStress(candidate) && isFiniteNumber(candidate.terminalWealthRatio) && candidate.terminalWealthRatio > 0.75) {
    items.push('patrimonio terminal alto con recortes');
  }
  return items.slice(0, 3);
};

export function compareOptimizerEvaluationCandidates(
  left: OptimizerEvaluationCandidate,
  right: OptimizerEvaluationCandidate,
): number {
  const leftComparable = left.isComparable ?? left.midasEvaluation?.isComparable ?? false;
  const rightComparable = right.isComparable ?? right.midasEvaluation?.isComparable ?? false;
  if (leftComparable && !rightComparable) return -1;
  if (!leftComparable && rightComparable) return 1;

  const evaluationScoreComparison = compareDescWithTolerance(
    left.evaluationScore ?? left.midasEvaluation?.cappedScore ?? left.midasEvaluation?.rawScore ?? null,
    right.evaluationScore ?? right.midasEvaluation?.cappedScore ?? right.midasEvaluation?.rawScore ?? null,
  );
  if (evaluationScoreComparison !== 0) return evaluationScoreComparison;

  const qualitySurvivalComparison = compareDescWithTolerance(left.qualitySurvivalRate, right.qualitySurvivalRate, PRIMARY_TIE_TOLERANCE);
  if (qualitySurvivalComparison !== 0) return qualitySurvivalComparison;

  const monthsBelowComparison = compareAscWithTolerance(left.monthsBelow85, right.monthsBelow85);
  if (monthsBelowComparison !== 0) return monthsBelowComparison;

  const streakComparison = compareAscWithTolerance(left.maxConsecutiveMonthsBelow85, right.maxConsecutiveMonthsBelow85);
  if (streakComparison !== 0) return streakComparison;

  const earlyStressComparison = compareAscWithTolerance(left.earlyStressMonths, right.earlyStressMonths);
  if (earlyStressComparison !== 0) return earlyStressComparison;

  const leftStressPenalty = hasStress(left) && isFiniteNumber(left.terminalWealthRatio) ? left.terminalWealthRatio : null;
  const rightStressPenalty = hasStress(right) && isFiniteNumber(right.terminalWealthRatio) ? right.terminalWealthRatio : null;
  const terminalStressComparison = compareAscWithTolerance(leftStressPenalty, rightStressPenalty);
  if (terminalStressComparison !== 0) return terminalStressComparison;

  const warningComparison = warningCount(left) - warningCount(right);
  if (warningComparison !== 0) return warningComparison;

  const qasrComparison = compareDescWithTolerance(left.qasrStrict, right.qasrStrict, PRIMARY_TIE_TOLERANCE);
  if (qasrComparison !== 0) return qasrComparison;

  const csrComparison = compareDescWithTolerance(left.csr85_4, right.csr85_4, PRIMARY_TIE_TOLERANCE);
  if (csrComparison !== 0) return csrComparison;

  const successComparison = compareDescWithTolerance(left.classicSuccessRate, right.classicSuccessRate, PRIMARY_TIE_TOLERANCE);
  if (successComparison !== 0) return successComparison;

  return left.id.localeCompare(right.id);
}

export function rankOptimizerCandidates(
  candidates: OptimizerEvaluationCandidate[],
): OptimizerCandidateRankingResult {
  const sorted = [...candidates].sort(compareOptimizerEvaluationCandidates);
  const leader = sorted[0] ?? null;
  const ranked = sorted.map((candidate, index) => ({
    rank: index + 1,
    candidateId: candidate.id,
    label: candidate.midasEvaluation?.label ?? 'No comparable',
    score: candidate.evaluationScore ?? candidate.midasEvaluation?.cappedScore ?? candidate.midasEvaluation?.rawScore ?? null,
    isComparable: candidate.isComparable ?? candidate.midasEvaluation?.isComparable ?? false,
    rankingReason: buildRankingReason(candidate, leader),
    primaryAlerts: (candidate.midasEvaluation?.alerts ?? []).slice(0, 2),
    capsApplied: [...(candidate.midasEvaluation?.capsApplied ?? [])],
    tradeoffs: buildTradeoffs(candidate),
    warningCount: warningCount(candidate),
  }));

  return {
    ranked,
    recommendedCandidateId: ranked.find((candidate) => candidate.isComparable)?.candidateId ?? null,
    discardedCandidateIds: ranked.filter((candidate) => !candidate.isComparable).map((candidate) => candidate.candidateId),
  };
}
