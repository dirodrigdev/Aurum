import assert from 'node:assert/strict';
import type { PathQualityDiagnosticsV1, PathQualityPathDiagnosticsV1 } from '../model/types';
import { buildQualityOfLifeMetricsFromPathDiagnostics } from './qualityOfLifeMetrics';

const assertNear = (actual: number | null, expected: number, epsilon = 1e-12) => {
  assert.ok(actual !== null, 'expected numeric value');
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} ~ ${expected}`);
};

const makePath = (overrides: Partial<PathQualityPathDiagnosticsV1>): PathQualityPathDiagnosticsV1 => ({
  pathId: 0,
  ruined: false,
  ruinMonth: null,
  ruinYear: null,
  terminalWealthClp: 100,
  qasrAlpha: 1.5,
  meanShortfallPenaltyAlpha15: 0.05,
  qualityScoreAlpha15: 0.95,
  observedConsumptionMonths: 120,
  postRuinMonths: 0,
  averageConsumptionRatio: 0.9,
  minMonthlyConsumptionRatio: 0.8,
  minAnnualConsumptionRatio: 0.85,
  p10MonthlyConsumptionRatio: 0.82,
  p25MonthlyConsumptionRatio: 0.86,
  monthsBelow85: 12,
  maxConsecutiveMonthsBelow85: 6,
  monthsBelow90: 18,
  maxConsecutiveMonthsBelow90: 8,
  earlyStressMonthsBelow85: 4,
  phaseStress: [
    { phaseIndex: 1, startMonth: 1, endMonth: 48, monthsObserved: 48, monthsBelow85: 4, monthsBelow90: 6, maxConsecutiveMonthsBelow85: 2, maxConsecutiveMonthsBelow90: 3 },
    { phaseIndex: 2, startMonth: 49, endMonth: 120, monthsObserved: 72, monthsBelow85: 8, monthsBelow90: 12, maxConsecutiveMonthsBelow85: 4, maxConsecutiveMonthsBelow90: 5 },
  ],
  monthsInCut: 12,
  monthsInSevereCut: 24,
  maxConsecutiveCutMonths: 8,
  maxConsecutiveSevereCutMonths: 6,
  houseSold: false,
  houseSaleTriggerMonth: null,
  houseSaleTriggerYear: null,
  houseSaleMonth: null,
  houseSaleYear: null,
  monthsBetweenHouseSaleTriggerAndSale: null,
  monthsInCutBetweenHouseSaleTriggerAndSale: null,
  monthsInSevereCutBetweenHouseSaleTriggerAndSale: null,
  monthsInCutBeforeHouseSale: null,
  monthsInSevereCutBeforeHouseSale: null,
  liquidWealthAfterHouseSaleClp: null,
  warnings: [],
  ...overrides,
});

const build = (paths: PathQualityPathDiagnosticsV1[], horizonMonths = 120): QualityCase =>
  buildQualityOfLifeMetricsFromPathDiagnostics({
    schemaVersion: 1,
    source: 'm8_runtime_path_summary',
    warnings: [],
    pathCount: paths.length,
    horizonMonths,
    paths,
  }, { initialSimulableCapitalClp: 200 });

type QualityCase = ReturnType<typeof buildQualityOfLifeMetricsFromPathDiagnostics>;

{
  const metrics = build([makePath({})]);
  assert.equal(metrics.csr85_4, 1);
  assert.equal(metrics.csrPassingPathCount, 1);
  assert.equal(metrics.averageEffectiveSpendingRatio, 0.9);
  assert.equal(metrics.monthsBelow85, 12);
  assert.equal(metrics.maxConsecutiveMonthsBelow85, 6);
  assert.equal(metrics.earlyStressMonths, 4);
  assert.equal(metrics.qualitySurvivalRate, 1);
  assert.equal(metrics.terminalWealthRatio, 0.5);
}

{
  const metrics = build([makePath({ ruined: true, ruinMonth: 36, ruinYear: 3 })]);
  assert.equal(metrics.csr85_4, 0);
  assert.equal(metrics.csrPassingPathCount, 0);
}

{
  const metrics = build([makePath({ averageConsumptionRatio: 0.84 })]);
  assert.equal(metrics.csr85_4, 0);
  assert.equal(metrics.qualitySurvivalRate, 0);
}

{
  const metrics = build([makePath({ monthsInSevereCut: 49 })]);
  assert.equal(metrics.csr85_4, 0);
}

{
  const metrics = build([makePath({ maxConsecutiveMonthsBelow85: 7 })]);
  assert.equal(metrics.qualitySurvivalRate, 0);
}

{
  const metrics = build([makePath({ monthsBelow85: 25 })]);
  assert.equal(metrics.qualitySurvivalRate, 0);
}

{
  const metrics = build([
    makePath({ ruined: true, qualityScoreAlpha15: 0.99, ruinMonth: 12, ruinYear: 1, postRuinMonths: 108 }),
    makePath({ ruined: false, qualityScoreAlpha15: 0.5 }),
  ]);
  assertNear(metrics.qasrStrict, 0.25);
}

{
  const metrics = build([
    makePath({ qualityScoreAlpha15: 0.8 }),
    makePath({ qualityScoreAlpha15: 0.6, pathId: 1 }),
  ]);
  assertNear(metrics.qualityScoreMean, 0.7);
}

{
  const metrics = build([
    makePath({
      qualityScoreAlpha15: 0.77,
      houseSold: true,
      houseSaleTriggerMonth: 22,
      houseSaleTriggerYear: 22 / 12,
      houseSaleMonth: 24,
      houseSaleYear: 2,
      monthsBetweenHouseSaleTriggerAndSale: 2,
      monthsInCutBetweenHouseSaleTriggerAndSale: 1,
      monthsInSevereCutBetweenHouseSaleTriggerAndSale: 1,
      monthsInCutBeforeHouseSale: 3,
      monthsInSevereCutBeforeHouseSale: 1,
      liquidWealthAfterHouseSaleClp: 200,
    }),
    makePath({ qualityScoreAlpha15: 0.77, houseSold: false, pathId: 1 }),
  ]);
  assertNear(metrics.qualityScoreMean, 0.77);
}

{
  const metrics = build([
    makePath({ qualityScoreAlpha15: 0.8, terminalWealthClp: 10 }),
    makePath({ qualityScoreAlpha15: 0.8, terminalWealthClp: 10_000, pathId: 1 }),
  ]);
  assertNear(metrics.qualityScoreMean, 0.8);
}

{
  const metrics = build([
    makePath({ terminalWealthClp: 100, qualityScoreAlpha15: 0.4 }),
    makePath({ terminalWealthClp: 200, qualityScoreAlpha15: 0.6, pathId: 1 }),
    makePath({ terminalWealthClp: 300, qualityScoreAlpha15: 0.8, pathId: 2 }),
    makePath({ terminalWealthClp: 400, qualityScoreAlpha15: 0.9, pathId: 3 }),
  ]);
  assertNear(metrics.terminalWealthP25, 175);
  assertNear(metrics.terminalWealthP50, 250);
  assertNear(metrics.terminalWealthP75, 325);
  assertNear(metrics.terminalWealthRatio, 1.25);
  assertNear(metrics.qualityScoreP25, 0.55);
  assertNear(metrics.qualityScoreP50, 0.7);
}

{
  const metrics = build([
    makePath({
      houseSold: true,
      houseSaleTriggerMonth: 10,
      houseSaleTriggerYear: 10 / 12,
      houseSaleMonth: 12,
      houseSaleYear: 1,
      monthsBetweenHouseSaleTriggerAndSale: 2,
      monthsInCutBetweenHouseSaleTriggerAndSale: 2,
      monthsInSevereCutBetweenHouseSaleTriggerAndSale: 0,
      monthsInCutBeforeHouseSale: 100,
      monthsInSevereCutBeforeHouseSale: 99,
    }),
    makePath({
      pathId: 1,
      houseSold: true,
      houseSaleTriggerMonth: 20,
      houseSaleTriggerYear: 20 / 12,
      houseSaleMonth: 25,
      houseSaleYear: 25 / 12,
      monthsBetweenHouseSaleTriggerAndSale: 5,
      monthsInCutBetweenHouseSaleTriggerAndSale: 5,
      monthsInSevereCutBetweenHouseSaleTriggerAndSale: 3,
      monthsInCutBeforeHouseSale: 70,
      monthsInSevereCutBeforeHouseSale: 60,
    }),
  ]);
  assertNear(metrics.houseSaleTriggerToSaleMonthsMean, 3.5);
  assertNear(metrics.houseSaleTriggerToSaleMonthsMedian, 3.5);
  assertNear(metrics.houseSaleTriggerToSaleMonthsP75, 4.25);
  assertNear(metrics.severeCutMonthsDuringHouseSaleMean, 1.5);
  assertNear(metrics.severeCutMonthsDuringHouseSaleMedian, 1.5);
  assertNear(metrics.severeCutMonthsDuringHouseSaleP75, 2.25);
}

{
  const metrics = build([
    makePath({
      phaseStress: [
        { phaseIndex: 1, startMonth: 1, endMonth: 48, monthsObserved: 48, monthsBelow85: 2, monthsBelow90: 4, maxConsecutiveMonthsBelow85: 2, maxConsecutiveMonthsBelow90: 3 },
        { phaseIndex: 2, startMonth: 49, endMonth: 120, monthsObserved: 72, monthsBelow85: 10, monthsBelow90: 12, maxConsecutiveMonthsBelow85: 5, maxConsecutiveMonthsBelow90: 6 },
      ],
    }),
    makePath({
      pathId: 1,
      phaseStress: [
        { phaseIndex: 1, startMonth: 1, endMonth: 48, monthsObserved: 48, monthsBelow85: 4, monthsBelow90: 8, maxConsecutiveMonthsBelow85: 3, maxConsecutiveMonthsBelow90: 4 },
        { phaseIndex: 2, startMonth: 49, endMonth: 120, monthsObserved: 72, monthsBelow85: 8, monthsBelow90: 10, maxConsecutiveMonthsBelow85: 4, maxConsecutiveMonthsBelow90: 5 },
      ],
    }),
  ]);
  assert.equal(metrics.phaseStress.length, 2);
  assert.equal(metrics.phaseStress[0]?.label, 'F1');
  assertNear(metrics.phaseStress[0]?.monthsBelow85 ?? null, 3);
  assertNear(metrics.phaseStress[1]?.monthsBelow90 ?? null, 11);
}

{
  const metrics = build([
    makePath({
      qualityScoreAlpha15: null,
      meanShortfallPenaltyAlpha15: null,
      averageConsumptionRatio: null,
      minMonthlyConsumptionRatio: null,
      minAnnualConsumptionRatio: null,
      monthsBelow85: null,
      maxConsecutiveMonthsBelow85: null,
      monthsBelow90: null,
      maxConsecutiveMonthsBelow90: null,
      earlyStressMonthsBelow85: null,
      phaseStress: [],
      terminalWealthClp: null,
      observedConsumptionMonths: 0,
      monthsInCut: null,
      monthsInSevereCut: null,
      maxConsecutiveSevereCutMonths: null,
      pathId: 1,
    }),
  ]);
  assert.equal(metrics.qualityScoreMean, null);
  assert.equal(metrics.qasrStrict, null);
  assert.equal(metrics.terminalWealthP50, null);
  assert.equal(metrics.terminalWealthRatio, null);
  assert.equal(metrics.qualitySurvivalRate, 0);
  assert.ok(metrics.warnings.includes('quality_score_missing'));
  assert.ok(metrics.warnings.includes('average_consumption_ratio_missing'));
  assert.ok(metrics.warnings.includes('terminal_wealth_missing'));
  assert.ok(metrics.warnings.includes('months_below_85_missing'));
  assert.ok(metrics.warnings.includes('phase_stress_missing'));
}

console.log('qualityOfLifeMetrics tests passed');
