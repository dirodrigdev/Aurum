import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { M8Output } from './m8.types';
import { fromM8Output } from './m8Adapter';
import { buildPathQualityDiagnosticsFromM8Output } from './pathQualityDiagnostics';

const assertNear = (actual: number | null, expected: number, epsilon = 1e-12) => {
  assert.ok(actual !== null, 'expected a numeric value');
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be near ${expected}`);
};

const diagnostics = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 2,
  horizonMonths: 24,
  pathSummaries: [
    {
      pathId: 0,
      ruined: true,
      ruinMonth: 18,
      terminalWealthClp: 0,
      monthlyConsumptionRatios: [1, 0.9, 0.75, 0.7, 0.8, 1],
      cutStates: [0, 1, 2, 2, 1, 0],
      houseSaleMonth: 5,
      liquidWealthAfterHouseSaleClp: 120_000_000,
    },
    {
      pathId: 1,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 300_000_000,
      monthlyConsumptionRatios: [],
      cutStates: [],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
});

assert.equal(diagnostics.schemaVersion, 1);
assert.equal(diagnostics.pathCount, 2);
assert.equal(diagnostics.horizonMonths, 24);
assert.equal(diagnostics.paths.length, 2);

const ruined = diagnostics.paths[0];
assert.equal(ruined.ruined, true);
assert.equal(ruined.ruinMonth, 18);
assert.equal(ruined.ruinYear, 1.5);
assert.equal(ruined.terminalWealthClp, 0);
assert.equal(ruined.qasrAlpha, 1.5);
const ruinedExpectedPenalty = [1, 0.9, 0.75, 0.7, 0.8, 1]
  .map((ratio) => Math.pow(Math.max(0, 1 - ratio), 1.5))
  .reduce((sum, penalty) => sum + penalty, 0) / 6;
assertNear(ruined.meanShortfallPenaltyAlpha15, ruinedExpectedPenalty);
assertNear(ruined.qualityScoreAlpha15, 1 - ruinedExpectedPenalty);
assert.equal(ruined.observedConsumptionMonths, 6);
assert.equal(ruined.postRuinMonths, 6);
assert.equal(ruined.monthsInCut, 4);
assert.equal(ruined.monthsInSevereCut, 2);
assert.equal(ruined.maxConsecutiveCutMonths, 4);
assert.equal(ruined.maxConsecutiveSevereCutMonths, 2);
assert.equal(ruined.houseSold, true);
assert.equal(ruined.houseSaleMonth, 5);
assert.equal(ruined.houseSaleYear, 5 / 12);
assert.equal(ruined.monthsInCutBeforeHouseSale, 3);
assert.equal(ruined.monthsInSevereCutBeforeHouseSale, 2);
assert.equal(ruined.liquidWealthAfterHouseSaleClp, 120_000_000);
assert.equal(ruined.minMonthlyConsumptionRatio, 0.7);
assertNear(ruined.minAnnualConsumptionRatio, 0.8583333333333334);
assert.equal(ruined.p25MonthlyConsumptionRatio, 0.7625);

const incomplete = diagnostics.paths[1];
assert.equal(incomplete.ruined, false);
assert.equal(incomplete.ruinMonth, null);
assert.equal(incomplete.houseSold, false);
assert.equal(incomplete.meanShortfallPenaltyAlpha15, null);
assert.equal(incomplete.qualityScoreAlpha15, null);
assert.equal(incomplete.observedConsumptionMonths, 0);
assert.equal(incomplete.postRuinMonths, 0);
assert.equal(incomplete.averageConsumptionRatio, null);
assert.deepEqual(incomplete.warnings, ['consumption_ratios_missing', 'cut_states_missing']);

const mismatch = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 3,
  horizonMonths: 12,
  pathSummaries: [],
});
assert.deepEqual(mismatch.warnings, ['path_summary_count_mismatch']);

const perfectConsumption = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 1,
  horizonMonths: 3,
  pathSummaries: [
    {
      pathId: 0,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 10,
      monthlyConsumptionRatios: [1, 1, 1],
      cutStates: [0, 0, 0],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths[0];
assert.equal(perfectConsumption.meanShortfallPenaltyAlpha15, 0);
assert.equal(perfectConsumption.qualityScoreAlpha15, 1);
assert.equal(perfectConsumption.observedConsumptionMonths, 3);

const simpleShortfall = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 1,
  horizonMonths: 2,
  pathSummaries: [
    {
      pathId: 0,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 10,
      monthlyConsumptionRatios: [1, 0.8],
      cutStates: [0, 1],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths[0];
const shortfallPenalty = Math.pow(0.2, 1.5);
assertNear(simpleShortfall.meanShortfallPenaltyAlpha15, shortfallPenalty / 2);
assertNear(simpleShortfall.qualityScoreAlpha15, 1 - shortfallPenalty / 2);

const aboveTarget = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 1,
  horizonMonths: 2,
  pathSummaries: [
    {
      pathId: 0,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 10,
      monthlyConsumptionRatios: [1.2, 1],
      cutStates: [0, 0],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths[0];
assert.equal(aboveTarget.meanShortfallPenaltyAlpha15, 0);
assert.equal(aboveTarget.qualityScoreAlpha15, 1);

const lighterShortfall = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 1,
  horizonMonths: 1,
  pathSummaries: [
    {
      pathId: 0,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 10,
      monthlyConsumptionRatios: [0.8],
      cutStates: [1],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths[0];
const heavierShortfall = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 1,
  horizonMonths: 1,
  pathSummaries: [
    {
      pathId: 0,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 10,
      monthlyConsumptionRatios: [0.6],
      cutStates: [2],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths[0];
assert.ok((heavierShortfall.meanShortfallPenaltyAlpha15 ?? 0) > (lighterShortfall.meanShortfallPenaltyAlpha15 ?? 0));

const sameRatiosWithSale = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 2,
  horizonMonths: 2,
  pathSummaries: [
    {
      pathId: 0,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 50,
      monthlyConsumptionRatios: [0.9, 0.8],
      cutStates: [1, 1],
      houseSaleMonth: 2,
      liquidWealthAfterHouseSaleClp: 20,
    },
    {
      pathId: 1,
      ruined: false,
      ruinMonth: null,
      terminalWealthClp: 999,
      monthlyConsumptionRatios: [0.9, 0.8],
      cutStates: [1, 1],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths;
assertNear(sameRatiosWithSale[0].qualityScoreAlpha15, sameRatiosWithSale[1].qualityScoreAlpha15 ?? 0);
assertNear(sameRatiosWithSale[0].meanShortfallPenaltyAlpha15, sameRatiosWithSale[1].meanShortfallPenaltyAlpha15 ?? 0);

const ruinedButScored = buildPathQualityDiagnosticsFromM8Output({
  pathCount: 1,
  horizonMonths: 6,
  pathSummaries: [
    {
      pathId: 0,
      ruined: true,
      ruinMonth: 4,
      terminalWealthClp: 0,
      monthlyConsumptionRatios: [1, 0.8, 0.6, 0.5],
      cutStates: [0, 1, 2, 2],
      houseSaleMonth: null,
      liquidWealthAfterHouseSaleClp: null,
    },
  ],
}).paths[0];
assert.ok((ruinedButScored.qualityScoreAlpha15 ?? 0) > 0);
assert.equal(ruinedButScored.postRuinMonths, 2);
assert.ok(ruinedButScored.warnings.includes('observed_consumption_months_incomplete'));
assert.ok(ruinedButScored.warnings.includes('post_ruin_months_unobserved'));

const outputFixture: M8Output = {
  Success40: 1,
  ProbRuin20: 0,
  ProbRuin40: 0,
  RuinYearMedian: Number.NaN,
  RuinYearP25: Number.NaN,
  RuinYearP75: Number.NaN,
  TerminalMedianCLP: 100,
  TerminalMedianIfSuccessCLP: 100,
  TerminalP25AllPaths: 100,
  TerminalP25IfSuccess: 100,
  TerminalP75AllPaths: 100,
  TerminalP75IfSuccess: 100,
  HouseSalePct: 0,
  TriggerYearMedian: Number.NaN,
  SaleYearMedian: Number.NaN,
  SpendFactorTotal: 1,
  SpendFactorPhase2: 1,
  SpendFactorCutMonths: 1,
  SpendFactorNoCutMonths: 1,
  SpendFactorCut1Months: 1,
  SpendFactorCut2Months: 1,
  CutTimeShare: 0,
  terminalWealthAllPaths: [100],
  maxDrawdownPercentiles: { 10: 0, 25: 0, 50: 0, 75: 0, 90: 0 },
  pathQualityDiagnostics: diagnostics,
};
const adapted = fromM8Output(outputFixture, DEFAULT_PARAMETERS);
assert.equal(adapted.pathQualityDiagnostics?.schemaVersion, 1);
assert.equal(adapted.pathQualityDiagnostics?.paths[0]?.ruinMonth, 18);

const adaptedWithoutDiagnostics = fromM8Output(
  { ...outputFixture, pathQualityDiagnostics: undefined },
  DEFAULT_PARAMETERS,
);
assert.equal(adaptedWithoutDiagnostics.pathQualityDiagnostics, undefined);

console.log('pathQualityDiagnostics tests passed');
