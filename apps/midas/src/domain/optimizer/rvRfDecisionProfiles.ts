export const GUARDRAIL_QASR_MIN = 87;
export const GUARDRAIL_RUIN_MAX = 0.10;
export const GUARDRAIL_SEVERE_CUT_MONTHS_MAX = 48;
export const GUARDRAIL_SEVERE_CUT_STREAK_P75_MAX = 30;

export const PARETO_TOLERANCE_DEFAULT = 0.5;
export const PARETO_TOLERANCE_HIGH = 1.0;
export const SE_QASR_THRESHOLD = 0.8;

export const HEADROOM_QUALITY_TRADEOFF_RATIO = 2.0;
export const MAX_BASE_LOSS_VS_DEFENSIVE = 1.0;
export const MAX_HEADROOM_ALT_BASE_DROP = 2.0;

const DIFFERENCE_Z_TIE_BAND = 0.05;

export type RvRfDecisionCandidate = {
  candidateId: string;
  mixLabel: string;
  rvPct: number;
  rfPct: number;
  rvReal: number;
  rfReal: number;
  qasrBase: number | null;
  qasrAt120: number | null;
  qasrAt130: number | null;
  csrBase: number | null;
  ruinRate: number | null;
  monthsInSevereCutMean: number | null;
  maxConsecutiveSevereCutMonthsP75: number | null;
  terminalWealthP25: number | null;
  terminalWealthP50: number | null;
  houseSaleRate: number | null;
  severeCutDuringSaleMonths: number | null;
  recSevPctBase: number | null;
};

export type RvRfDecisionCandidateAnnotated = RvRfDecisionCandidate & {
  passesHardGuardrails: boolean;
  failedGuardrails: string[];
  inParetoFrontier: boolean;
  role: 'reference_defensive' | 'primary_recommendation' | 'headroom_alternative' | 'benchmark_extreme' | 'none';
  deltaQasrBaseVsDefensive: number | null;
  deltaQasr120VsDefensive: number | null;
  tradeoffRatioVsDefensive: number | null;
  mainDifference: string;
};

export type RvRfDecisionProfiles = {
  seQasrEstimated: number | null;
  seQasrMaxCandidateId: string | null;
  paretoToleranceUsed: number;
  defensiveReferenceSource: 'guardrail_pool';
  warnings: string[];
  guardrails: {
    qasrMin: number;
    ruinMax: number;
    severeCutMonthsMax: number;
    severeCutStreakP75Max: number;
  };
  fineGridCount: number;
  paretoFrontierSize: number;
  ratioUsed: number;
  ratioSensitivity: {
    ratio15CandidateId: string | null;
    ratio20CandidateId: string | null;
    ratio30CandidateId: string | null;
    recommendationSensitive: boolean;
  };
  defensiveReference: RvRfDecisionCandidate | null;
  primaryRecommendation: RvRfDecisionCandidate | null;
  headroomAlternative: RvRfDecisionCandidate | null;
  benchmarkExtreme: RvRfDecisionCandidate | null;
  rows: RvRfDecisionCandidateAnnotated[];
};

const FALLBACK_QASR_WORSE_POINTS = 1;
const FALLBACK_RATE_WORSE_PCT = 0.01;

function fallbackMetricDiff(current: number | null, candidate: number | null): number | null {
  if (current === null || candidate === null || !Number.isFinite(current) || !Number.isFinite(candidate)) return null;
  return candidate - current;
}

function isMateriallyWorseVsBaseline(
  baseline: RvRfDecisionCandidate,
  candidate: RvRfDecisionCandidate,
): boolean {
  const qasrBaseDiff = fallbackMetricDiff(toScore100(baseline.qasrBase), toScore100(candidate.qasrBase));
  const qasr120Diff = fallbackMetricDiff(toScore100(baseline.qasrAt120), toScore100(candidate.qasrAt120));
  const csrDiff = fallbackMetricDiff(baseline.csrBase, candidate.csrBase);
  const ruinDiff = fallbackMetricDiff(baseline.ruinRate, candidate.ruinRate);

  const materiallyWorseFlags = [
    qasrBaseDiff !== null && qasrBaseDiff < -FALLBACK_QASR_WORSE_POINTS,
    qasr120Diff !== null && qasr120Diff < -FALLBACK_QASR_WORSE_POINTS,
    csrDiff !== null && csrDiff < -FALLBACK_RATE_WORSE_PCT,
    ruinDiff !== null && ruinDiff > FALLBACK_RATE_WORSE_PCT,
  ];
  return materiallyWorseFlags.filter(Boolean).length >= 3;
}

function fallbackCandidateDominates(
  challenger: RvRfDecisionCandidateAnnotated,
  candidate: RvRfDecisionCandidateAnnotated,
): boolean {
  const qasrBaseCh = toScore100(challenger.qasrBase);
  const qasrBaseCa = toScore100(candidate.qasrBase);
  const qasr120Ch = toScore100(challenger.qasrAt120);
  const qasr120Ca = toScore100(candidate.qasrAt120);
  const csrCh = challenger.csrBase;
  const csrCa = candidate.csrBase;
  const ruinCh = challenger.ruinRate;
  const ruinCa = candidate.ruinRate;

  if (
    qasrBaseCh === null || qasrBaseCa === null
    || qasr120Ch === null || qasr120Ca === null
    || csrCh === null || csrCa === null
    || ruinCh === null || ruinCa === null
  ) return false;

  const noWorse = (
    qasrBaseCh >= qasrBaseCa - FALLBACK_QASR_WORSE_POINTS
    && qasr120Ch >= qasr120Ca - FALLBACK_QASR_WORSE_POINTS
    && csrCh >= csrCa - FALLBACK_RATE_WORSE_PCT
    && ruinCh <= ruinCa + FALLBACK_RATE_WORSE_PCT
  );
  const strictlyBetter = (
    qasrBaseCh > qasrBaseCa + FALLBACK_QASR_WORSE_POINTS
    || qasr120Ch > qasr120Ca + FALLBACK_QASR_WORSE_POINTS
    || csrCh > csrCa + FALLBACK_RATE_WORSE_PCT
    || ruinCh < ruinCa - FALLBACK_RATE_WORSE_PCT
  );
  return noWorse && strictlyBetter;
}

function fallbackRankingScore(a: RvRfDecisionCandidateAnnotated, b: RvRfDecisionCandidateAnnotated): number {
  const safeMetric = (value: number | null, fallback: number) => (value === null || Number.isNaN(value) ? fallback : value);
  return (
    (a.failedGuardrails.length - b.failedGuardrails.length)
    || (safeMetric(b.qasrBase, Number.NEGATIVE_INFINITY) - safeMetric(a.qasrBase, Number.NEGATIVE_INFINITY))
    || (safeMetric(a.ruinRate, Number.POSITIVE_INFINITY) - safeMetric(b.ruinRate, Number.POSITIVE_INFINITY))
    || (safeMetric(a.monthsInSevereCutMean, Number.POSITIVE_INFINITY) - safeMetric(b.monthsInSevereCutMean, Number.POSITIVE_INFINITY))
    || (safeMetric(a.maxConsecutiveSevereCutMonthsP75, Number.POSITIVE_INFINITY) - safeMetric(b.maxConsecutiveSevereCutMonthsP75, Number.POSITIVE_INFINITY))
    || (safeMetric(b.csrBase, Number.NEGATIVE_INFINITY) - safeMetric(a.csrBase, Number.NEGATIVE_INFINITY))
    || (safeMetric(b.qasrAt120, Number.NEGATIVE_INFINITY) - safeMetric(a.qasrAt120, Number.NEGATIVE_INFINITY))
    || (a.rvPct - b.rvPct)
    || (safeMetric(b.terminalWealthP50, Number.NEGATIVE_INFINITY) - safeMetric(a.terminalWealthP50, Number.NEGATIVE_INFINITY))
  );
}

export function selectBestAvailableFallbackCandidate(
  rows: RvRfDecisionCandidateAnnotated[] | null | undefined,
  baselineCandidate: RvRfDecisionCandidate | null = null,
): RvRfDecisionCandidateAnnotated | null {
  if (!rows || rows.length === 0) return null;

  const filteredByBaseline = baselineCandidate
    ? rows.filter((candidate) => !isMateriallyWorseVsBaseline(baselineCandidate, candidate))
    : rows;
  const baselineProtectedPool = filteredByBaseline.length > 0 ? filteredByBaseline : rows;

  const nonDominated = baselineProtectedPool.filter((candidate) => (
    !baselineProtectedPool.some((challenger) => (
      challenger.candidateId !== candidate.candidateId
      && fallbackCandidateDominates(challenger, candidate)
    ))
  ));

  const actionablePool = nonDominated.length > 0 ? nonDominated : baselineProtectedPool;
  const selected = [...actionablePool].sort(fallbackRankingScore)[0] ?? null;

  if (!selected) return null;
  if (!baselineCandidate) return selected;

  const baselineInRows = rows.find((row) => row.candidateId === baselineCandidate.candidateId) ?? null;
  const baselineClearlyBetter = isMateriallyWorseVsBaseline(baselineCandidate, selected);
  if (baselineClearlyBetter && baselineInRows) return baselineInRows;
  if (baselineClearlyBetter) return null;
  return selected;
}

function toScore100(value: number | null): number | null {
  return value === null ? null : value * 100;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

export function buildFineRvRfGrid(stepPp = 5): number[] {
  const step = Math.max(1, Math.floor(stepPp));
  const list: number[] = [];
  for (let rv = 0; rv <= 100; rv += step) list.push(rv);
  if (list[list.length - 1] !== 100) list.push(100);
  return list;
}

export function estimateQasrStandardError(qasrScore: number | null, nSimulations: number): number | null {
  if (qasrScore === null || !Number.isFinite(qasrScore) || nSimulations <= 0) return null;
  const p = clamp01(qasrScore / 100);
  return Math.sqrt((p * (1 - p)) / nSimulations) * 100;
}

export function applyHardGuardrails(candidate: RvRfDecisionCandidate): {
  passesHardGuardrails: boolean;
  failedGuardrails: string[];
} {
  const failures: string[] = [];
  const qasr = toScore100(candidate.qasrBase);
  if (qasr === null || qasr < GUARDRAIL_QASR_MIN) failures.push('qasr_base_below_min');
  if (candidate.ruinRate === null || candidate.ruinRate > GUARDRAIL_RUIN_MAX) failures.push('ruin_rate_above_max');
  if (candidate.monthsInSevereCutMean === null || candidate.monthsInSevereCutMean > GUARDRAIL_SEVERE_CUT_MONTHS_MAX) failures.push('severe_cut_mean_above_max');
  if (
    candidate.maxConsecutiveSevereCutMonthsP75 === null
    || candidate.maxConsecutiveSevereCutMonthsP75 > GUARDRAIL_SEVERE_CUT_STREAK_P75_MAX
  ) failures.push('severe_cut_streak_p75_above_max');
  return { passesHardGuardrails: failures.length === 0, failedGuardrails: failures };
}

function dominates2d(
  a: RvRfDecisionCandidate,
  b: RvRfDecisionCandidate,
  tolerance: number,
): boolean {
  const aBase = toScore100(a.qasrBase);
  const bBase = toScore100(b.qasrBase);
  const a120 = toScore100(a.qasrAt120);
  const b120 = toScore100(b.qasrAt120);
  if (aBase === null || bBase === null || a120 === null || b120 === null) return false;
  const betterOrEqual = aBase >= (bBase - tolerance) && a120 >= (b120 - tolerance);
  const strictlyBetter = (aBase - bBase) > tolerance || (a120 - b120) > tolerance;
  return betterOrEqual && strictlyBetter;
}

export function buildParetoFrontierBaseVsHeadroom(
  candidates: RvRfDecisionCandidate[],
  tolerance: number,
): RvRfDecisionCandidate[] {
  return candidates.filter((candidateA) => !candidates.some((candidateB) => (
    candidateA.candidateId !== candidateB.candidateId && dominates2d(candidateB, candidateA, tolerance)
  )));
}

export function selectDefensiveReference(candidates: RvRfDecisionCandidate[]): RvRfDecisionCandidate | null {
  return [...candidates].sort((a, b) => (
    ((toScore100(b.qasrBase) ?? Number.NEGATIVE_INFINITY) - (toScore100(a.qasrBase) ?? Number.NEGATIVE_INFINITY))
    || ((b.csrBase ?? Number.NEGATIVE_INFINITY) - (a.csrBase ?? Number.NEGATIVE_INFINITY))
    || ((a.monthsInSevereCutMean ?? Number.POSITIVE_INFINITY) - (b.monthsInSevereCutMean ?? Number.POSITIVE_INFINITY))
    || (a.rvPct - b.rvPct)
  ))[0] ?? null;
}

export function selectDefensiveReferenceFromGuardrailPool(
  guardPassed: RvRfDecisionCandidate[],
  tolerance: number,
): RvRfDecisionCandidate | null {
  if (!guardPassed.length) return null;
  const maxQasr = Math.max(...guardPassed.map((candidate) => toScore100(candidate.qasrBase) ?? Number.NEGATIVE_INFINITY));
  const pool = guardPassed.filter((candidate) => ((toScore100(candidate.qasrBase) ?? Number.NEGATIVE_INFINITY) >= (maxQasr - tolerance)));
  return [...pool].sort((a, b) => (
    ((b.csrBase ?? Number.NEGATIVE_INFINITY) - (a.csrBase ?? Number.NEGATIVE_INFINITY))
    || ((a.monthsInSevereCutMean ?? Number.POSITIVE_INFINITY) - (b.monthsInSevereCutMean ?? Number.POSITIVE_INFINITY))
    || ((a.maxConsecutiveSevereCutMonthsP75 ?? Number.POSITIVE_INFINITY) - (b.maxConsecutiveSevereCutMonthsP75 ?? Number.POSITIVE_INFINITY))
    || (a.rvPct - b.rvPct)
  ))[0] ?? null;
}

function scoreTradeoffCandidate(
  candidate: RvRfDecisionCandidate,
  defensiveReference: RvRfDecisionCandidate,
  ratio: number,
): {
  accepted: boolean;
  deltaBase: number | null;
  deltaHeadroom: number | null;
  tradeoffRatio: number | null;
} {
  const deltaBase = safeDiff(toScore100(candidate.qasrBase), toScore100(defensiveReference.qasrBase));
  const deltaHeadroom = safeDiff(toScore100(candidate.qasrAt120), toScore100(defensiveReference.qasrAt120));
  if (deltaBase === null || deltaHeadroom === null) return { accepted: false, deltaBase, deltaHeadroom, tradeoffRatio: null };
  if (deltaBase >= 0 && deltaHeadroom >= 0) {
    return { accepted: true, deltaBase, deltaHeadroom, tradeoffRatio: Infinity };
  }
  if (deltaBase < 0 && deltaHeadroom > 0) {
    const tradeoffRatio = deltaHeadroom / Math.abs(deltaBase);
    const accepted = (
      tradeoffRatio >= ratio
      && Math.abs(deltaBase) <= MAX_BASE_LOSS_VS_DEFENSIVE + 1e-12
    );
    return { accepted, deltaBase, deltaHeadroom, tradeoffRatio };
  }
  return { accepted: false, deltaBase, deltaHeadroom, tradeoffRatio: null };
}

export function selectPrimaryBalancedRecommendation(
  candidates: RvRfDecisionCandidate[],
  defensiveReference: RvRfDecisionCandidate | null,
  ratio: number,
): { selected: RvRfDecisionCandidate | null; acceptedIds: string[] } {
  if (!defensiveReference) return { selected: null, acceptedIds: [] };
  const feasible = candidates.filter((candidate) => candidate.rvPct > defensiveReference.rvPct && candidate.rvPct > 0 && candidate.rvPct < 100);
  const accepted = feasible
    .map((candidate) => ({ candidate, check: scoreTradeoffCandidate(candidate, defensiveReference, ratio) }))
    .filter((item) => item.check.accepted)
    .sort((a, b) => (
      ((b.check.deltaHeadroom ?? Number.NEGATIVE_INFINITY) - (a.check.deltaHeadroom ?? Number.NEGATIVE_INFINITY))
      || (Math.abs(a.check.deltaBase ?? Number.POSITIVE_INFINITY) - Math.abs(b.check.deltaBase ?? Number.POSITIVE_INFINITY))
      || (a.candidate.rvPct - b.candidate.rvPct)
    ));
  if (!accepted.length) return { selected: defensiveReference, acceptedIds: [] };
  return { selected: accepted[0]?.candidate ?? defensiveReference, acceptedIds: accepted.map((item) => item.candidate.candidateId) };
}

export function selectHeadroomAlternative(
  candidates: RvRfDecisionCandidate[],
  primaryRecommendation: RvRfDecisionCandidate | null,
  tolerance: number,
): RvRfDecisionCandidate | null {
  if (!primaryRecommendation) return null;
  const primaryHeadroom = toScore100(primaryRecommendation.qasrAt120);
  const eligible = candidates.filter((candidate) => (
    candidate.candidateId !== primaryRecommendation.candidateId
    && (
      toScore100(candidate.qasrBase) !== null
      && toScore100(primaryRecommendation.qasrBase) !== null
      && (toScore100(candidate.qasrBase) as number) >= (toScore100(primaryRecommendation.qasrBase) as number) - MAX_HEADROOM_ALT_BASE_DROP
    )
    && (
      toScore100(candidate.qasrAt120) !== null
      && primaryHeadroom !== null
      && ((toScore100(candidate.qasrAt120) as number) - primaryHeadroom) > (tolerance + 1e-12)
    )
  ));
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => (
    ((toScore100(b.qasrAt120) ?? Number.NEGATIVE_INFINITY) - (toScore100(a.qasrAt120) ?? Number.NEGATIVE_INFINITY))
    || ((toScore100(b.qasrAt130) ?? Number.NEGATIVE_INFINITY) - (toScore100(a.qasrAt130) ?? Number.NEGATIVE_INFINITY))
    || (a.rvPct - b.rvPct)
  ));
  const best = sorted[0] ?? null;
  if (!best) return null;
  if (best.rvPct < 100) return best;
  const lessExtremeEquivalent = sorted.find((candidate) => (
    candidate.rvPct < 100
    && Math.abs((toScore100(candidate.qasrAt120) ?? -Infinity) - (toScore100(best.qasrAt120) ?? Infinity)) <= tolerance + 1e-12
    && Math.abs((toScore100(candidate.qasrBase) ?? -Infinity) - (toScore100(best.qasrBase) ?? Infinity)) <= tolerance + 1e-12
  )) ?? null;
  return lessExtremeEquivalent ?? best;
}

export function selectExtremeBenchmark(candidates: RvRfDecisionCandidate[]): RvRfDecisionCandidate | null {
  return candidates.find((candidate) => candidate.rvPct === 100) ?? null;
}

function rangeFor(rows: RvRfDecisionCandidate[], selector: (row: RvRfDecisionCandidate) => number | null): number {
  const values = rows.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return 1;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.max(1e-9, max - min);
}

export function buildMainDifference(
  candidate: RvRfDecisionCandidate,
  baseline: RvRfDecisionCandidate,
  contextRows: RvRfDecisionCandidate[],
): string {
  if (candidate.candidateId === baseline.candidateId) return 'Base de comparación para este perfil.';

  const q120Diff = safeDiff(toScore100(candidate.qasrAt120), toScore100(baseline.qasrAt120));
  const qBaseDiff = safeDiff(toScore100(candidate.qasrBase), toScore100(baseline.qasrBase));
  const sevDiff = safeDiff(candidate.monthsInSevereCutMean, baseline.monthsInSevereCutMean);
  const p50Diff = safeDiff(candidate.terminalWealthP50, baseline.terminalWealthP50);
  const p25Diff = safeDiff(candidate.terminalWealthP25, baseline.terminalWealthP25);
  const csrDiff = safeDiff(candidate.csrBase, baseline.csrBase);
  const ruinDiff = safeDiff(candidate.ruinRate, baseline.ruinRate);

  const ranges = {
    q120: rangeFor(contextRows, (row) => toScore100(row.qasrAt120)),
    sev: rangeFor(contextRows, (row) => row.monthsInSevereCutMean),
    p50: rangeFor(contextRows, (row) => row.terminalWealthP50),
    p25: rangeFor(contextRows, (row) => row.terminalWealthP25),
    qBase: rangeFor(contextRows, (row) => toScore100(row.qasrBase)),
    csr: rangeFor(contextRows, (row) => row.csrBase),
    ruin: rangeFor(contextRows, (row) => row.ruinRate),
  };

  const candidates = [
    { key: 'q120', z: q120Diff === null ? -1 : Math.abs(q120Diff) / ranges.q120, rank: 1 },
    { key: 'sev', z: sevDiff === null ? -1 : Math.abs(sevDiff) / ranges.sev, rank: 2 },
    { key: 'p50', z: p50Diff === null ? -1 : Math.abs(p50Diff) / ranges.p50, rank: 3 },
    { key: 'p25', z: p25Diff === null ? -1 : Math.abs(p25Diff) / ranges.p25, rank: 4 },
    { key: 'qBase', z: qBaseDiff === null ? -1 : Math.abs(qBaseDiff) / ranges.qBase, rank: 5 },
    { key: 'csr', z: csrDiff === null ? -1 : Math.abs(csrDiff) / ranges.csr, rank: 6 },
    { key: 'ruin', z: ruinDiff === null ? -1 : Math.abs(ruinDiff) / ranges.ruin, rank: 7 },
  ].filter((item) => item.z >= 0);

  if (!candidates.length) return 'Sin diferencia material detectable con la información disponible.';
  candidates.sort((a, b) => (b.z - a.z) || (a.rank - b.rank));
  const first = candidates[0];
  const second = candidates[1];
  const chosen = second && Math.abs(first.z - second.z) <= DIFFERENCE_Z_TIE_BAND
    ? [first, second].sort((a, b) => a.rank - b.rank)[0]
    : first;

  if (chosen.key === 'q120' && q120Diff !== null && qBaseDiff !== null) {
    if (q120Diff >= 0) return `Gana ${q120Diff.toFixed(2)} puntos de holgura (+20), con ${qBaseDiff.toFixed(2)} puntos de diferencia en QASR base.`;
    return `Sacrifica ${Math.abs(q120Diff).toFixed(2)} puntos de holgura (+20), con ${qBaseDiff.toFixed(2)} puntos de diferencia en QASR base.`;
  }
  if (chosen.key === 'sev' && sevDiff !== null) {
    return `${sevDiff <= 0 ? 'Reduce' : 'Aumenta'} recortes severos en ${Math.abs(sevDiff).toFixed(1)} meses.`;
  }
  if (chosen.key === 'p50' && p50Diff !== null && baseline.terminalWealthP50 && baseline.terminalWealthP50 > 0) {
    const pct = (p50Diff / baseline.terminalWealthP50) * 100;
    return `Aporta ${pct.toFixed(1)}% ${pct >= 0 ? 'más' : 'menos'} patrimonio terminal P50.`;
  }
  if (chosen.key === 'p25' && p25Diff !== null && baseline.terminalWealthP25 && baseline.terminalWealthP25 > 0) {
    const pct = (p25Diff / baseline.terminalWealthP25) * 100;
    return `Aporta ${pct.toFixed(1)}% ${pct >= 0 ? 'más' : 'menos'} patrimonio terminal P25 en escenarios exigentes.`;
  }
  if (chosen.key === 'qBase' && qBaseDiff !== null) {
    if (qBaseDiff >= 0) return `Gana ${qBaseDiff.toFixed(2)} puntos de calidad base, con menor holgura relativa.`;
    return `Sacrifica ${Math.abs(qBaseDiff).toFixed(2)} puntos de calidad base para ganar holgura.`;
  }
  if (chosen.key === 'csr' && csrDiff !== null) {
    return `Cambia la probabilidad de calidad de vida en ${(csrDiff * 100).toFixed(2)} pp.`;
  }
  if (chosen.key === 'ruin' && ruinDiff !== null) {
    return `Cambia la probabilidad de ruina en ${(ruinDiff * 100).toFixed(2)} pp.`;
  }
  return 'Diferencia principal no concluyente.';
}

export function buildDecisionProfiles(
  allCandidates: RvRfDecisionCandidate[],
  nSimulations: number,
): RvRfDecisionProfiles {
  const warnings: string[] = [];
  const annotatedGuards = allCandidates.map((candidate) => ({
    candidate,
    ...applyHardGuardrails(candidate),
  }));
  const guardPassed = annotatedGuards.filter((item) => item.passesHardGuardrails).map((item) => item.candidate);
  const seCandidates = guardPassed
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      se: estimateQasrStandardError(toScore100(candidate.qasrBase), nSimulations),
    }))
    .filter((item) => item.se !== null) as Array<{ candidateId: string; se: number }>;
  const maxSeCandidate = seCandidates.sort((a, b) => b.se - a.se)[0] ?? null;
  const seQasr = maxSeCandidate?.se ?? null;
  const tolerance = seQasr === null
    ? PARETO_TOLERANCE_DEFAULT
    : (seQasr > SE_QASR_THRESHOLD ? PARETO_TOLERANCE_HIGH : PARETO_TOLERANCE_DEFAULT);
  if (seQasr === null) warnings.push('No se pudo estimar SE_QASR; se usa tolerancia Pareto 0.5 por defecto.');

  const frontier = buildParetoFrontierBaseVsHeadroom(guardPassed, tolerance);
  if (frontier.length > 10) warnings.push('La frontera es amplia; la recomendación depende del ratio de intercambio estabilidad/holgura.');

  const defensiveReference = selectDefensiveReferenceFromGuardrailPool(guardPassed, tolerance);
  const inFrontierOrNear = guardPassed.filter((candidate) => (
    frontier.some((front) => front.candidateId === candidate.candidateId)
    || frontier.some((front) => (
      toScore100(candidate.qasrBase) !== null
      && toScore100(front.qasrBase) !== null
      && toScore100(candidate.qasrAt120) !== null
      && toScore100(front.qasrAt120) !== null
      && Math.abs((toScore100(candidate.qasrBase) as number) - (toScore100(front.qasrBase) as number)) <= tolerance + 1e-12
      && Math.abs((toScore100(candidate.qasrAt120) as number) - (toScore100(front.qasrAt120) as number)) <= tolerance + 1e-12
    ))
  ));
  const primary20 = selectPrimaryBalancedRecommendation(inFrontierOrNear, defensiveReference, HEADROOM_QUALITY_TRADEOFF_RATIO);
  const primary15 = selectPrimaryBalancedRecommendation(inFrontierOrNear, defensiveReference, 1.5);
  const primary30 = selectPrimaryBalancedRecommendation(inFrontierOrNear, defensiveReference, 3.0);

  const primaryRecommendation = primary20.selected;
  const headroomAlternative = selectHeadroomAlternative(inFrontierOrNear, primaryRecommendation, tolerance);
  const benchmarkExtreme = selectExtremeBenchmark(allCandidates);

  const primaryId = primaryRecommendation?.candidateId ?? null;
  const defensiveId = defensiveReference?.candidateId ?? null;
  const headroomId = headroomAlternative?.candidateId ?? null;
  const benchmarkId = benchmarkExtreme?.candidateId ?? null;

  const rows: RvRfDecisionCandidateAnnotated[] = allCandidates.map((candidate) => {
    const guard = annotatedGuards.find((item) => item.candidate.candidateId === candidate.candidateId);
    const inParetoFrontier = frontier.some((item) => item.candidateId === candidate.candidateId);
    let role: RvRfDecisionCandidateAnnotated['role'] = 'none';
    if (candidate.candidateId === benchmarkId) role = 'benchmark_extreme';
    if (candidate.candidateId === defensiveId) role = 'reference_defensive';
    if (candidate.candidateId === primaryId) role = role === 'reference_defensive' ? 'primary_recommendation' : 'primary_recommendation';
    if (candidate.candidateId === headroomId && candidate.candidateId !== primaryId) role = 'headroom_alternative';

    const deltaBase = defensiveReference ? safeDiff(toScore100(candidate.qasrBase), toScore100(defensiveReference.qasrBase)) : null;
    const delta120 = defensiveReference ? safeDiff(toScore100(candidate.qasrAt120), toScore100(defensiveReference.qasrAt120)) : null;
    const tradeoff = (deltaBase !== null && delta120 !== null && deltaBase < 0 && delta120 > 0)
      ? delta120 / Math.abs(deltaBase)
      : null;
    const baselineForDifference = primaryRecommendation ?? defensiveReference ?? candidate;

    return {
      ...candidate,
      passesHardGuardrails: guard?.passesHardGuardrails ?? false,
      failedGuardrails: guard?.failedGuardrails ?? ['no_guardrail_data'],
      inParetoFrontier,
      role,
      deltaQasrBaseVsDefensive: deltaBase,
      deltaQasr120VsDefensive: delta120,
      tradeoffRatioVsDefensive: tradeoff,
      mainDifference: buildMainDifference(candidate, baselineForDifference, allCandidates),
    };
  });

  return {
    seQasrEstimated: seQasr,
    seQasrMaxCandidateId: maxSeCandidate?.candidateId ?? null,
    paretoToleranceUsed: tolerance,
    defensiveReferenceSource: 'guardrail_pool',
    warnings,
    guardrails: {
      qasrMin: GUARDRAIL_QASR_MIN,
      ruinMax: GUARDRAIL_RUIN_MAX,
      severeCutMonthsMax: GUARDRAIL_SEVERE_CUT_MONTHS_MAX,
      severeCutStreakP75Max: GUARDRAIL_SEVERE_CUT_STREAK_P75_MAX,
    },
    fineGridCount: allCandidates.length,
    paretoFrontierSize: frontier.length,
    ratioUsed: HEADROOM_QUALITY_TRADEOFF_RATIO,
    ratioSensitivity: {
      ratio15CandidateId: primary15.selected?.candidateId ?? null,
      ratio20CandidateId: primary20.selected?.candidateId ?? null,
      ratio30CandidateId: primary30.selected?.candidateId ?? null,
      recommendationSensitive: (primary15.selected?.candidateId ?? null) !== (primary30.selected?.candidateId ?? null),
    },
    defensiveReference,
    primaryRecommendation,
    headroomAlternative,
    benchmarkExtreme,
    rows: rows.sort((a, b) => a.rvPct - b.rvPct),
  };
}
