export type DecisionScaleMetrics = {
  qasrStrict: number | null;
  csr85_4: number | null;
  classicSuccessRate: number | null;
  probRuin: number | null;
  monthsInSevereCutMean: number | null;
  maxConsecutiveSevereCutMonthsP75: number | null;
  terminalWealthP25: number | null;
  terminalWealthP50: number | null;
  houseSaleRate: number | null;
  severeCutMonthsDuringHouseSale: number | null;
};

export type DecisionInputRow = {
  candidateId: string;
  mixLabel: string;
  rvReal: number;
  rfReal: number;
  effectiveReturn: number | null;
  scale100: DecisionScaleMetrics;
  scale120: DecisionScaleMetrics;
  scale130: DecisionScaleMetrics;
  maxSpendScalePassingQoL: number | null;
};

export type EquivalenceResult = {
  equivalent: boolean;
  difference: number | null;
  threshold: number;
};

export type DecisionComparisonRow = DecisionInputRow & {
  severeCutPctBase: number | null;
  severeCutPct120: number | null;
  severeCutPct130: number | null;
  qasrEquivalentVsWinner: EquivalenceResult;
  csrEquivalentVsWinner: EquivalenceResult;
  successEquivalentVsWinner: EquivalenceResult;
  ruinEquivalentVsWinner: EquivalenceResult;
  severeCutMonthsEquivalentVsWinner: EquivalenceResult;
  severeCutPctEquivalentVsWinner: EquivalenceResult;
  baseReliabilityScore: number | null;
  headroomScore: number | null;
  cutComfortScore: number | null;
  terminalMarginScore: number | null;
  decisionScorePreview: number | null;
  scoreRank: number;
};

export type DecisionComparisonTable = {
  winnerByQasrBaseCandidateId: string | null;
  winnerByBaseReliabilityCandidateId: string | null;
  winnerByHeadroomCandidateId: string | null;
  winnerByCutComfortCandidateId: string | null;
  winnerByTerminalMarginCandidateId: string | null;
  winnerByDecisionScoreCandidateId: string | null;
  rows: DecisionComparisonRow[];
};

export type EquivalenceThresholds = {
  qasrScoreAbs: number;
  csrProbAbs: number;
  successProbAbs: number;
  ruinProbAbs: number;
  severeCutMonthsAbs: number;
  severeCutPctAbs: number;
  terminalRelativeAbs: number;
  houseSaleProbAbs: number;
  severeCutDuringSaleMonthsAbs: number;
};

export const DEFAULT_EQUIVALENCE_THRESHOLDS: EquivalenceThresholds = {
  qasrScoreAbs: 0.005,
  csrProbAbs: 0.02,
  successProbAbs: 0.02,
  ruinProbAbs: 0.02,
  severeCutMonthsAbs: 3,
  severeCutPctAbs: 0.0075,
  terminalRelativeAbs: 0.05,
  houseSaleProbAbs: 0.02,
  severeCutDuringSaleMonthsAbs: 2,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function safeScore(values: Array<number | null>, weights: number[]): number | null {
  let acc = 0;
  let w = 0;
  values.forEach((value, index) => {
    if (value === null) return;
    acc += value * weights[index];
    w += weights[index];
  });
  if (w <= 0) return null;
  return acc / w;
}

function binomialSe(prob: number, nSim: number): number {
  if (nSim <= 0) return 0;
  return Math.sqrt((prob * (1 - prob)) / nSim);
}

function normalizeLog(values: Array<number | null>): number[] {
  const transformed = values.map((value) => (value === null || value <= 0 ? 0 : Math.log1p(value)));
  const min = Math.min(...transformed);
  const max = Math.max(...transformed);
  if (max - min <= 1e-12) return transformed.map(() => 0.5);
  return transformed.map((value) => (value - min) / (max - min));
}

function rankDescending(rows: Array<{ id: string; score: number | null }>): string | null {
  const best = rows
    .filter((row) => row.score !== null && Number.isFinite(row.score))
    .sort((a, b) => (b.score as number) - (a.score as number))[0];
  return best?.id ?? null;
}

export function buildEquivalenceThresholds(
  nSim: number,
  candidateA: DecisionScaleMetrics,
  candidateB: DecisionScaleMetrics,
  base: EquivalenceThresholds = DEFAULT_EQUIVALENCE_THRESHOLDS,
): EquivalenceThresholds {
  const csrA = candidateA.csr85_4;
  const csrB = candidateB.csr85_4;
  const successA = candidateA.classicSuccessRate;
  const successB = candidateB.classicSuccessRate;
  const ruinA = candidateA.probRuin;
  const ruinB = candidateB.probRuin;
  const csrThresh = (csrA === null || csrB === null)
    ? base.csrProbAbs
    : Math.max(base.csrProbAbs, 1.96 * Math.sqrt(binomialSe(csrA, nSim) ** 2 + binomialSe(csrB, nSim) ** 2));
  const successThresh = (successA === null || successB === null)
    ? base.successProbAbs
    : Math.max(base.successProbAbs, 1.96 * Math.sqrt(binomialSe(successA, nSim) ** 2 + binomialSe(successB, nSim) ** 2));
  const ruinThresh = (ruinA === null || ruinB === null)
    ? base.ruinProbAbs
    : Math.max(base.ruinProbAbs, 1.96 * Math.sqrt(binomialSe(ruinA, nSim) ** 2 + binomialSe(ruinB, nSim) ** 2));
  return {
    ...base,
    csrProbAbs: csrThresh,
    successProbAbs: successThresh,
    ruinProbAbs: ruinThresh,
  };
}

export function compareIndicatorDifference(
  a: number | null,
  b: number | null,
  threshold: number,
): EquivalenceResult {
  const difference = safeDiff(a, b);
  return {
    equivalent: difference !== null && difference <= threshold + 1e-12,
    difference,
    threshold,
  };
}

export function computeIndicatorEquivalence(
  candidate: DecisionScaleMetrics,
  winner: DecisionScaleMetrics,
  nSim: number,
  horizonMonths: number,
  thresholds: EquivalenceThresholds = DEFAULT_EQUIVALENCE_THRESHOLDS,
): {
  qasr: EquivalenceResult;
  csr: EquivalenceResult;
  success: EquivalenceResult;
  ruin: EquivalenceResult;
  severeCutMonths: EquivalenceResult;
  severeCutPct: EquivalenceResult;
} {
  const dynamic = buildEquivalenceThresholds(nSim, candidate, winner, thresholds);
  const candidateSeverePct = candidate.monthsInSevereCutMean === null ? null : candidate.monthsInSevereCutMean / Math.max(1, horizonMonths);
  const winnerSeverePct = winner.monthsInSevereCutMean === null ? null : winner.monthsInSevereCutMean / Math.max(1, horizonMonths);
  return {
    qasr: compareIndicatorDifference(candidate.qasrStrict, winner.qasrStrict, dynamic.qasrScoreAbs),
    csr: compareIndicatorDifference(candidate.csr85_4, winner.csr85_4, dynamic.csrProbAbs),
    success: compareIndicatorDifference(candidate.classicSuccessRate, winner.classicSuccessRate, dynamic.successProbAbs),
    ruin: compareIndicatorDifference(candidate.probRuin, winner.probRuin, dynamic.ruinProbAbs),
    severeCutMonths: compareIndicatorDifference(candidate.monthsInSevereCutMean, winner.monthsInSevereCutMean, dynamic.severeCutMonthsAbs),
    severeCutPct: compareIndicatorDifference(candidateSeverePct, winnerSeverePct, dynamic.severeCutPctAbs),
  };
}

export function buildDecisionComparisonTable(
  rows: DecisionInputRow[],
  options: { horizonMonths: number; nSim: number; thresholds?: EquivalenceThresholds },
): DecisionComparisonTable {
  const horizonMonths = Math.max(1, options.horizonMonths);
  const nSim = Math.max(1, options.nSim);
  const thresholds = options.thresholds ?? DEFAULT_EQUIVALENCE_THRESHOLDS;
  const winnerByQasr = [...rows]
    .filter((row) => row.scale100.qasrStrict !== null)
    .sort((a, b) => (b.scale100.qasrStrict as number) - (a.scale100.qasrStrict as number))[0] ?? null;

  const p25Norm = normalizeLog(rows.map((row) => row.scale100.terminalWealthP25));
  const p50Norm = normalizeLog(rows.map((row) => row.scale100.terminalWealthP50));

  const enriched = rows.map((row, index): DecisionComparisonRow => {
    const severeCutPctBase = row.scale100.monthsInSevereCutMean === null ? null : row.scale100.monthsInSevereCutMean / horizonMonths;
    const severeCutPct120 = row.scale120.monthsInSevereCutMean === null ? null : row.scale120.monthsInSevereCutMean / horizonMonths;
    const severeCutPct130 = row.scale130.monthsInSevereCutMean === null ? null : row.scale130.monthsInSevereCutMean / horizonMonths;

    const qBase = row.scale100.qasrStrict === null ? null : row.scale100.qasrStrict * 100;
    const csrBase = row.scale100.csr85_4 === null ? null : row.scale100.csr85_4 * 100;
    const successBase = row.scale100.classicSuccessRate === null ? null : row.scale100.classicSuccessRate * 100;

    const quality120 = safeScore([
      row.scale120.qasrStrict === null ? null : row.scale120.qasrStrict * 100,
      row.scale120.csr85_4 === null ? null : row.scale120.csr85_4 * 100,
      row.scale120.classicSuccessRate === null ? null : row.scale120.classicSuccessRate * 100,
    ], [0.45, 0.30, 0.25]);
    const quality130 = safeScore([
      row.scale130.qasrStrict === null ? null : row.scale130.qasrStrict * 100,
      row.scale130.csr85_4 === null ? null : row.scale130.csr85_4 * 100,
      row.scale130.classicSuccessRate === null ? null : row.scale130.classicSuccessRate * 100,
    ], [0.45, 0.30, 0.25]);

    const baseReliabilityScore = safeScore([qBase, csrBase, successBase], [0.45, 0.30, 0.25]);
    const headroomScore = safeScore([quality120, quality130], [0.6, 0.4]);

    const meanPenalty = row.scale100.monthsInSevereCutMean === null
      ? null
      : clamp01((row.scale100.monthsInSevereCutMean - 12) / 36);
    const streakPenalty = row.scale100.maxConsecutiveSevereCutMonthsP75 === null
      ? null
      : clamp01((row.scale100.maxConsecutiveSevereCutMonthsP75 - 12) / 36);
    const cutPenalty = safeScore([meanPenalty, streakPenalty], [0.6, 0.4]);
    const cutComfortScore = cutPenalty === null ? null : 100 * (1 - cutPenalty);

    const terminalMarginScore = 100 * (0.65 * p25Norm[index] + 0.35 * p50Norm[index]);

    const decisionScorePreview = safeScore(
      [baseReliabilityScore, headroomScore, cutComfortScore, terminalMarginScore],
      [0.35, 0.30, 0.20, 0.15],
    );

    const equivalence = winnerByQasr
      ? computeIndicatorEquivalence(row.scale100, winnerByQasr.scale100, nSim, horizonMonths, thresholds)
      : {
        qasr: compareIndicatorDifference(null, null, thresholds.qasrScoreAbs),
        csr: compareIndicatorDifference(null, null, thresholds.csrProbAbs),
        success: compareIndicatorDifference(null, null, thresholds.successProbAbs),
        ruin: compareIndicatorDifference(null, null, thresholds.ruinProbAbs),
        severeCutMonths: compareIndicatorDifference(null, null, thresholds.severeCutMonthsAbs),
        severeCutPct: compareIndicatorDifference(null, null, thresholds.severeCutPctAbs),
      };

    return {
      ...row,
      severeCutPctBase,
      severeCutPct120,
      severeCutPct130,
      qasrEquivalentVsWinner: equivalence.qasr,
      csrEquivalentVsWinner: equivalence.csr,
      successEquivalentVsWinner: equivalence.success,
      ruinEquivalentVsWinner: equivalence.ruin,
      severeCutMonthsEquivalentVsWinner: equivalence.severeCutMonths,
      severeCutPctEquivalentVsWinner: equivalence.severeCutPct,
      baseReliabilityScore,
      headroomScore,
      cutComfortScore,
      terminalMarginScore,
      decisionScorePreview,
      scoreRank: 0,
    };
  });

  const ranked = [...enriched]
    .sort((a, b) => (b.decisionScorePreview ?? Number.NEGATIVE_INFINITY) - (a.decisionScorePreview ?? Number.NEGATIVE_INFINITY));
  ranked.forEach((row, index) => {
    row.scoreRank = index + 1;
  });

  const getId = (winner: string | null): string | null => winner;
  return {
    winnerByQasrBaseCandidateId: winnerByQasr?.candidateId ?? null,
    winnerByBaseReliabilityCandidateId: getId(rankDescending(enriched.map((row) => ({ id: row.candidateId, score: row.baseReliabilityScore })))),
    winnerByHeadroomCandidateId: getId(rankDescending(enriched.map((row) => ({ id: row.candidateId, score: row.headroomScore })))),
    winnerByCutComfortCandidateId: getId(rankDescending(enriched.map((row) => ({ id: row.candidateId, score: row.cutComfortScore })))),
    winnerByTerminalMarginCandidateId: getId(rankDescending(enriched.map((row) => ({ id: row.candidateId, score: row.terminalMarginScore })))),
    winnerByDecisionScoreCandidateId: ranked[0]?.candidateId ?? null,
    rows: ranked,
  };
}
