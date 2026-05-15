import assert from 'node:assert/strict';
import {
  applyHardGuardrails,
  buildFineRvRfGrid,
  buildParetoFrontierBaseVsHeadroom,
  buildDecisionProfiles,
  estimateQasrStandardError,
  HEADROOM_QUALITY_TRADEOFF_RATIO,
} from './rvRfDecisionProfiles';

const baseCandidate = {
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
  assert.equal(applyHardGuardrails({ ...baseCandidate, qasrBase: 0.85 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...baseCandidate, ruinRate: 0.12 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...baseCandidate, monthsInSevereCutMean: 52 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...baseCandidate, maxConsecutiveSevereCutMonthsP75: 34 }).passesHardGuardrails, false);
  assert.equal(applyHardGuardrails({ ...baseCandidate, qasrBase: 0.89, csrBase: 0.6 }).passesHardGuardrails, true);
}

{
  const grid = buildFineRvRfGrid(5);
  assert.equal(grid[0], 0);
  assert.equal(grid[grid.length - 1], 100);
}

{
  const a = { ...baseCandidate, candidateId: 'a', qasrBase: 0.92, qasrAt120: 0.90 };
  const b = { ...baseCandidate, candidateId: 'b', qasrBase: 0.90, qasrAt120: 0.88 };
  const c = { ...baseCandidate, candidateId: 'c', qasrBase: 0.92, qasrAt120: 0.90 };
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
  const candidates = [
    { ...baseCandidate, candidateId: 'rv_25_rf_75', mixLabel: 'RV 25 / RF 75', rvPct: 25, rfPct: 75, qasrBase: 0.915, qasrAt120: 0.80, qasrAt130: 0.75, ruinRate: 0.08, monthsInSevereCutMean: 26, maxConsecutiveSevereCutMonthsP75: 20 },
    { ...baseCandidate, candidateId: 'rv_50_rf_50', mixLabel: 'RV 50 / RF 50', rvPct: 50, rfPct: 50, qasrBase: 0.910, qasrAt120: 0.84, qasrAt130: 0.80, ruinRate: 0.08, monthsInSevereCutMean: 28, maxConsecutiveSevereCutMonthsP75: 20 },
    { ...baseCandidate, candidateId: 'rv_60_rf_40', mixLabel: 'RV 60 / RF 40', rvPct: 60, rfPct: 40, qasrBase: 0.909, qasrAt120: 0.86, qasrAt130: 0.82, ruinRate: 0.08, monthsInSevereCutMean: 29, maxConsecutiveSevereCutMonthsP75: 21 },
    { ...baseCandidate, candidateId: 'rv_80_rf_20', mixLabel: 'RV 80 / RF 20', rvPct: 80, rfPct: 20, qasrBase: 0.89, qasrAt120: 0.87, qasrAt130: 0.83, ruinRate: 0.09, monthsInSevereCutMean: 35, maxConsecutiveSevereCutMonthsP75: 23 },
    { ...baseCandidate, candidateId: 'rv_100_rf_0', mixLabel: 'RV 100 / RF 0', rvPct: 100, rfPct: 0, qasrBase: 0.885, qasrAt120: 0.88, qasrAt130: 0.84, ruinRate: 0.09, monthsInSevereCutMean: 36, maxConsecutiveSevereCutMonthsP75: 24 },
    { ...baseCandidate, candidateId: 'rv_0_rf_100', mixLabel: 'RV 0 / RF 100', rvPct: 0, rfPct: 100, qasrBase: 0.86, qasrAt120: 0.60, qasrAt130: 0.50, ruinRate: 0.2, monthsInSevereCutMean: 60, maxConsecutiveSevereCutMonthsP75: 40 },
  ];
  const profiles = buildDecisionProfiles(candidates, 3000);
  assert.equal(profiles.ratioUsed, HEADROOM_QUALITY_TRADEOFF_RATIO);
  assert.equal(profiles.fineGridCount, candidates.length);
  assert.equal(profiles.benchmarkExtreme?.candidateId, 'rv_100_rf_0');
  assert.equal(profiles.rows.find((row) => row.candidateId === 'rv_0_rf_100')?.passesHardGuardrails, false);
  assert.equal(profiles.primaryRecommendation?.candidateId === 'rv_60_rf_40' || profiles.primaryRecommendation?.candidateId === 'rv_50_rf_50', true);
}

{
  const candidates = [
    { ...baseCandidate, candidateId: 'a', mixLabel: 'RV 50 / RF 50', rvPct: 50, rfPct: 50, qasrBase: 0.915, qasrAt120: 0.85, qasrAt130: 0.82, ruinRate: 0.08, monthsInSevereCutMean: 26, maxConsecutiveSevereCutMonthsP75: 20 },
    { ...baseCandidate, candidateId: 'b', mixLabel: 'RV 70 / RF 30', rvPct: 70, rfPct: 30, qasrBase: 0.905, qasrAt120: 0.871, qasrAt130: 0.84, ruinRate: 0.08, monthsInSevereCutMean: 30, maxConsecutiveSevereCutMonthsP75: 21 },
  ];
  const profiles = buildDecisionProfiles(candidates, 3000);
  assert.equal(profiles.primaryRecommendation?.candidateId, 'b');
}

console.log('rvRfDecisionProfiles tests passed');
