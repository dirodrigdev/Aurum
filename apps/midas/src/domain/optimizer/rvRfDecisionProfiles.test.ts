import assert from 'node:assert/strict';
import {
  applyHardGuardrails,
  buildDecisionProfiles,
  buildFineRvRfGrid,
  buildParetoFrontierBaseVsHeadroom,
  diagnoseFallbackSelection,
  estimateQasrStandardError,
  selectBestAvailableFallbackCandidate,
  selectDefensiveReferenceFromGuardrailPool,
} from './rvRfDecisionProfiles';

const base = {
  candidateId: 'c',
  mixLabel: 'RV 50 / RF 50',
  rvPct: 50,
  rfPct: 50,
  rvReal: 0.5,
  rfReal: 0.5,
  qasrBase: 0.9,
  qasrAt120: 0.88,
  qasrAt130: 0.86,
  csrBase: 0.8,
  ruinRate: 0.09,
  monthsInSevereCutMean: 24,
  maxConsecutiveSevereCutMonthsP75: 18,
  terminalWealthP25: 1_000,
  terminalWealthP50: 3_000,
  houseSaleRate: 0.2,
  severeCutDuringSaleMonths: 3,
  recSevPctBase: 24 / 480,
};

{
  assert.equal(applyHardGuardrails({ ...base, qasrBase: 0.85 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...base, ruinRate: 0.12 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...base, monthsInSevereCutMean: 52 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...base, maxConsecutiveSevereCutMonthsP75: 34 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...base, midasEvaluationComparable: false }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...base, qasrBase: 0.89, csrBase: 0.6 }).passesHardGuardrails, true);
}

{
  const grid = buildFineRvRfGrid(5);
  assert.equal(grid[0], 0);
  assert.equal(grid[grid.length - 1], 100);
}

{
  const a = { ...base, candidateId: 'a', qasrBase: 0.92, qasrAt120: 0.90 };
  const b = { ...base, candidateId: 'b', qasrBase: 0.90, qasrAt120: 0.88 };
  const c = { ...base, candidateId: 'c', qasrBase: 0.92, qasrAt120: 0.90 };
  const frontier = buildParetoFrontierBaseVsHeadroom([a, b, c], 0.5);
  assert.equal(frontier.some((item) => item.candidateId === 'b'), false);
  assert.equal(frontier.some((item) => item.candidateId === 'a'), true);
  assert.equal(frontier.some((item) => item.candidateId === 'c'), true);
}

{
  const seLow = estimateQasrStandardError(90, 3000);
  const seHigh = estimateQasrStandardError(50, 50);
  assert.equal((seLow ?? 99) < 0.8, true);
  assert.equal((seHigh ?? 0) > 0.8, true);
}

{
  const guard = [
    { ...base, candidateId: 'ref_a', rvPct: 25, rfPct: 75, qasrBase: 0.915, csrBase: 0.79, monthsInSevereCutMean: 22, maxConsecutiveSevereCutMonthsP75: 20 },
    { ...base, candidateId: 'ref_b', rvPct: 35, rfPct: 65, qasrBase: 0.912, csrBase: 0.83, monthsInSevereCutMean: 21, maxConsecutiveSevereCutMonthsP75: 19 },
    { ...base, candidateId: 'ref_c', rvPct: 45, rfPct: 55, qasrBase: 0.905, csrBase: 0.88, monthsInSevereCutMean: 20, maxConsecutiveSevereCutMonthsP75: 18 },
  ];
  const ref = selectDefensiveReferenceFromGuardrailPool(guard, 0.5);
  assert.equal(ref?.candidateId, 'ref_b');
}

{
  const baseline = { ...base, candidateId: 'current', mixLabel: 'RV 59.2 / RF 40.8', rvPct: 59.2, rfPct: 40.8, qasrBase: 0.93, qasrAt120: 0.90, csrBase: 0.92, ruinRate: 0.04 };
  const dominated = {
    ...base,
    candidateId: 'rv_0_rf_100',
    mixLabel: 'RV 0 / RF 100',
    rvPct: 0,
    rfPct: 100,
    qasrBase: 0.89,
    qasrAt120: 0.82,
    csrBase: 0.86,
    ruinRate: 0.07,
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min'],
    inParetoFrontier: true,
    role: 'benchmark_extreme' as const,
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'benchmark',
  };
  const balanced = {
    ...base,
    candidateId: 'rv_70_rf_30',
    mixLabel: 'RV 70 / RF 30',
    rvPct: 70,
    rfPct: 30,
    qasrBase: 0.935,
    qasrAt120: 0.905,
    csrBase: 0.925,
    ruinRate: 0.035,
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min'],
    inParetoFrontier: true,
    role: 'none' as const,
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'candidate',
  };
  const selected = selectBestAvailableFallbackCandidate([dominated, balanced], baseline);
  assert.equal(selected?.candidateId, 'rv_70_rf_30');
  const none = selectBestAvailableFallbackCandidate([dominated], baseline);
  assert.equal(none, null);
  const diagnostic = diagnoseFallbackSelection([dominated, balanced], baseline);
  assert.equal(diagnostic.selectedCandidateId, 'rv_70_rf_30');
  assert.equal(diagnostic.diagnostics.find((row) => row.candidateId === 'rv_0_rf_100')?.rejectedByBaselineDominance, true);
}

{
  const baseline = { ...base, candidateId: 'current', mixLabel: 'RV 59.2 / RF 40.8', rvPct: 59.2, rfPct: 40.8, qasrBase: 0.90, qasrAt120: 0.88, csrBase: 0.85, ruinRate: 0.06 };
  const mix70 = {
    ...base,
    candidateId: 'rv_70_rf_30',
    mixLabel: 'RV 70 / RF 30',
    rvPct: 70,
    rfPct: 30,
    qasrBase: 0.93,
    qasrAt120: 0.90,
    csrBase: 0.90,
    ruinRate: 0.05,
    passesHardGuardrails: false,
    failedGuardrails: [],
    inParetoFrontier: true,
    role: 'none' as const,
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'candidate',
  };
  const mix100 = {
    ...base,
    candidateId: 'rv_100_rf_0',
    mixLabel: 'RV 100 / RF 0',
    rvPct: 100,
    rfPct: 0,
    qasrBase: 0.95,
    qasrAt120: 0.92,
    csrBase: 0.93,
    ruinRate: 0.03,
    passesHardGuardrails: false,
    failedGuardrails: [],
    inParetoFrontier: true,
    role: 'benchmark_extreme' as const,
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'benchmark',
  };
  const selected = selectBestAvailableFallbackCandidate([mix70, mix100], baseline);
  assert.equal(selected?.candidateId, 'rv_100_rf_0');

  const selectedAgain = selectBestAvailableFallbackCandidate([mix70, mix100], baseline);
  assert.equal(selectedAgain?.candidateId, selected?.candidateId);
}

{
  const candidates = [
    { ...base, candidateId: 'rv_25_rf_75', mixLabel: 'RV 25 / RF 75', rvPct: 25, rfPct: 75, qasrBase: 0.915, qasrAt120: 0.80, qasrAt130: 0.75, ruinRate: 0.08, monthsInSevereCutMean: 26, maxConsecutiveSevereCutMonthsP75: 20 },
    { ...base, candidateId: 'rv_50_rf_50', mixLabel: 'RV 50 / RF 50', rvPct: 50, rfPct: 50, qasrBase: 0.910, qasrAt120: 0.84, qasrAt130: 0.80, ruinRate: 0.08, monthsInSevereCutMean: 28, maxConsecutiveSevereCutMonthsP75: 20 },
    { ...base, candidateId: 'rv_60_rf_40', mixLabel: 'RV 60 / RF 40', rvPct: 60, rfPct: 40, qasrBase: 0.909, qasrAt120: 0.86, qasrAt130: 0.82, ruinRate: 0.08, monthsInSevereCutMean: 29, maxConsecutiveSevereCutMonthsP75: 21 },
    { ...base, candidateId: 'rv_80_rf_20', mixLabel: 'RV 80 / RF 20', rvPct: 80, rfPct: 20, qasrBase: 0.89, qasrAt120: 0.87, qasrAt130: 0.83, ruinRate: 0.09, monthsInSevereCutMean: 35, maxConsecutiveSevereCutMonthsP75: 23 },
    { ...base, candidateId: 'rv_100_rf_0', mixLabel: 'RV 100 / RF 0', rvPct: 100, rfPct: 0, qasrBase: 0.885, qasrAt120: 0.88, qasrAt130: 0.84, ruinRate: 0.09, monthsInSevereCutMean: 36, maxConsecutiveSevereCutMonthsP75: 24 },
    { ...base, candidateId: 'rv_0_rf_100', mixLabel: 'RV 0 / RF 100', rvPct: 0, rfPct: 100, qasrBase: 0.86, qasrAt120: 0.60, qasrAt130: 0.50, ruinRate: 0.2, monthsInSevereCutMean: 60, maxConsecutiveSevereCutMonthsP75: 40 },
  ];
  const profiles = buildDecisionProfiles(candidates, 3000);
  assert.equal(profiles.defensiveReferenceSource, 'guardrail_pool');
  assert.equal(profiles.benchmarkExtreme?.candidateId, 'rv_100_rf_0');
  assert.equal(profiles.primaryRecommendation?.candidateId === 'rv_60_rf_40' || profiles.primaryRecommendation?.candidateId === 'rv_50_rf_50', true);
  assert.equal((profiles.headroomAlternative?.qasrAt120 ?? 0) - (profiles.primaryRecommendation?.qasrAt120 ?? 0) > profiles.paretoToleranceUsed || profiles.headroomAlternative === null, true);
}

{
  const candidates = [
    { ...base, candidateId: 'x1', mixLabel: 'RV 10 / RF 90', rvPct: 10, rfPct: 90, qasrBase: 0.5, qasrAt120: 0.5, qasrAt130: 0.5, csrBase: 0.9, ruinRate: 0.01, monthsInSevereCutMean: 10, maxConsecutiveSevereCutMonthsP75: 8 },
    { ...base, candidateId: 'x2', mixLabel: 'RV 20 / RF 80', rvPct: 20, rfPct: 80, qasrBase: 0.95, qasrAt120: 0.95, qasrAt130: 0.95, csrBase: 0.9, ruinRate: 0.01, monthsInSevereCutMean: 10, maxConsecutiveSevereCutMonthsP75: 8 },
  ];
  const profiles = buildDecisionProfiles(candidates, 50);
  assert.equal(profiles.paretoToleranceUsed, 1.0);
  assert.equal(profiles.seQasrMaxCandidateId !== null, true);
}

console.log('rvRfDecisionProfiles tests passed');
