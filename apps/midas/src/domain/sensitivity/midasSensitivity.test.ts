import assert from 'node:assert/strict';
import type { M8Input } from '../simulation/m8.types';
import {
  buildSensitivityGrid,
  buildSensitivityLeverSummary,
  computeExpectedPortfolioReturn,
  estimateTargetFromPoints,
  findChangeForSuccessTarget,
  runOneVariableSensitivity,
  addSensitivityMarginals,
  type SensitivityMetrics,
  type SensitivityRow,
} from './midasSensitivity';

function buildBaseInput(): M8Input {
  return {
    years: 40,
    n_paths: 12,
    seed: 42,
    simulation_frequency: 'monthly',
    use_real_terms: true,
    simulation_base_month: '2026-06',
    capital_initial_clp: 1_500_000_000,
    capital_source: 'aurum',
    portfolio_mix: {
      eq_global: 0.3,
      eq_chile: 0.1,
      fi_global: 0.2,
      fi_chile: 0.3,
      usd_liquidity: 0.05,
      clp_cash: 0.05,
    },
    phase1MonthlyClp: 6_000_000,
    phase2MonthlyClp: 6_000_000,
    phase3MonthlyClp: 3_900_000,
    phase4MonthlyClp: 5_400_000,
    phase1EndYear: 4,
    phase2EndYear: 20,
    phase3EndYear: 35,
    return_assumptions: {
      eq_global_real_annual: 0.07,
      eq_chile_real_annual: 0.06,
      fi_global_real_annual: 0.025,
      fi_chile_real_annual: 0.025,
      usd_liquidity_real_annual: 0.01,
      clp_cash_real_annual: 0.005,
    },
    generator_type: 'student_t',
    generator_params: {
      distribution: 'student_t',
      degrees_of_freedom: 7,
      sleeves: {
        eq_global: { mean_annual: 0.07, vol_annual: 0.18 },
        eq_chile: { mean_annual: 0.06, vol_annual: 0.2 },
        fi_global: { mean_annual: 0.025, vol_annual: 0.08 },
        fi_chile: { mean_annual: 0.025, vol_annual: 0.07 },
        usd_liquidity: { mean_annual: 0.01, vol_annual: 0.02 },
        clp_cash: { mean_annual: 0.005, vol_annual: 0.01 },
      },
      correlation_matrix: [
        [1, 0.7, 0.3, 0.2, 0.1, 0],
        [0.7, 1, 0.25, 0.2, 0.1, 0],
        [0.3, 0.25, 1, 0.45, 0.3, 0.1],
        [0.2, 0.2, 0.45, 1, 0.2, 0.15],
        [0.1, 0.1, 0.3, 0.2, 1, 0.2],
        [0, 0, 0.1, 0.15, 0.2, 1],
      ],
    },
    bucket: {
      bucket_mode: 'operational_simple',
      bucket_months: 24,
    },
    cuts: {
      cut1_floor: 0.92,
      cut2_floor: 0.84,
      recovery_cut2_to_cut1_months: 4,
      recovery_cut1_to_normal_months: 6,
      adjustment_alpha: 0.6,
      dd15_threshold: 0.15,
      dd25_threshold: 0.25,
      consecutive_months: 3,
    },
    house: {
      include_house: true,
      houseValueUf: 12_000,
      mortgageBalanceUfNow: 0,
      monthlyAmortizationUf: 0,
      ufClpStart: 38_000,
      house_sale_trigger_years_of_spend: 2,
      house_sale_lag_months: 6,
    },
    future_events: [
      { id: 'bonus-2039', type: 'inflow', amount: 200_000_000, currency: 'CLP', effective_month: 156 },
    ],
  };
}

const baseInput = buildBaseInput();
const baseSnapshot = JSON.stringify(baseInput);
const grid = buildSensitivityGrid(baseInput);

assert.deepEqual(
  grid.filter((variant) => variant.groupId === 'horizon').map((variant) => variant.value),
  [10, 15, 20, 25, 30, 35, 40, 45, 50],
);
assert.deepEqual(
  grid.filter((variant) => variant.groupId === 'bucket').map((variant) => variant.value),
  [6, 12, 18, 24, 30, 36, 42, 48],
);
assert.equal(grid.filter((variant) => variant.groupId === 'return').some((variant) => variant.value === computeExpectedPortfolioReturn(baseInput)), true);
const returnBaselineInput = structuredClone(baseInput);
Object.values((returnBaselineInput.generator_params as { sleeves: Record<string, { mean_annual: number }> }).sleeves)
  .forEach((sleeve) => { sleeve.mean_annual += 0.01075; });
const returnBaselineGrid = buildSensitivityGrid(returnBaselineInput)
  .filter((variant) => variant.groupId === 'return')
  .map((variant) => Number(variant.value));
assert.deepEqual(returnBaselineGrid.map((value) => Number(value.toFixed(3))), [0.03, 0.035, 0.04, 0.045, 0.05, 0.051, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08]);
assert.equal(grid.some((variant) => String(variant.variable).includes('house')), false);
assert.equal(grid.some((variant) => variant.id.includes('houseSaleTrigger')), false);

const f1Variant = grid.find((variant) => variant.variable === 'phase1MonthlyClp' && variant.value !== baseInput.phase1MonthlyClp);
assert(f1Variant);
const f1Input = f1Variant.apply(baseInput);
assert.equal(f1Input.phase1MonthlyClp !== baseInput.phase1MonthlyClp, true);
assert.equal(f1Input.phase2MonthlyClp, baseInput.phase2MonthlyClp);
assert.equal(f1Input.capital_initial_clp, baseInput.capital_initial_clp);
assert.deepEqual(f1Input.future_events, baseInput.future_events);

const returnVariant = grid.find((variant) => variant.variable === 'expectedRealReturn' && variant.value === 0.08);
assert(returnVariant);
const returnInput = returnVariant.apply(baseInput);
assert.equal(Math.abs(computeExpectedPortfolioReturn(returnInput) - 0.08) < 0.000001, true);
assert.equal(baseInput.return_assumptions.eq_global_real_annual, 0.07);

const horizonVariant = grid.find((variant) => variant.variable === 'horizonYears' && variant.value === 10);
assert.equal(horizonVariant?.comparableSuccess, false);
assert.match(horizonVariant?.note ?? '', /Éxito al horizonte evaluado/);

const result = runOneVariableSensitivity(baseInput, null, { nPathsOverride: 8, targetDeltaPp: 2 });
assert.equal(result.rows.length, grid.length);
assert.equal(result.rows.some((row) => row.groupId === 'return'), true);
assert.equal(result.rows.some((row) => row.groupId === 'cutRules'), true);
assert.equal(result.rows.every((row) => row.metrics.houseSalePct === null || row.metrics.houseSalePct >= 0), true);
assert.equal(result.warnings.some((warning) => warning.includes('Modo rápido')), true);
assert.equal(result.sensitivityNPaths, 8);
assert.equal(result.fastMode, true);
assert.equal(result.officialBaseline, null);
assert.equal(JSON.stringify(baseInput), baseSnapshot);

const baselineMetrics: SensitivityMetrics = {
  horizonYears: 40,
  success: 0.9,
  successAtHorizon: 0.9,
  ruin: 0.1,
  nRuin: 10,
  houseSalePct: 0.2,
  houseSaleYearMedian: 24,
  terminalWealthRatio: 2,
  qolScore: 50,
  qolLabel: 'Base',
  csr85_4: 0.7,
  qualitySurvivalRate: 0.2,
  averageEffectiveSpendingRatio: 0.95,
  severeCutYearsMean: 2,
};
const syntheticRows: SensitivityRow[] = [
  {
    id: 'f1-base',
    groupId: 'phase1',
    variable: 'phase1MonthlyClp',
    label: 'F1',
    value: 6_000_000,
    valueLabel: '6MM',
    baseline: true,
    comparableSuccess: true,
    note: null,
    metrics: baselineMetrics,
    deltaVsBaseline: { success: 0, ruin: 0, qolScore: 0, terminalWealthRatio: 0, houseSalePct: 0, qualitySurvivalRate: 0, severeCutYearsMean: 0 },
    marginal: { deltaSuccess: null, stepLabel: null, classification: null },
    warnings: [],
  },
  {
    id: 'f1-hit',
    groupId: 'phase1',
    variable: 'phase1MonthlyClp',
    label: 'F1',
    value: 5_500_000,
    valueLabel: '5.5MM',
    baseline: false,
    comparableSuccess: true,
    note: null,
    metrics: { ...baselineMetrics, success: 0.925, terminalWealthRatio: 2.2, houseSalePct: 0.18 },
    deltaVsBaseline: { success: 0.025, ruin: -0.025, qolScore: 0, terminalWealthRatio: 0.2, houseSalePct: -0.02, qualitySurvivalRate: 0, severeCutYearsMean: 0 },
    marginal: { deltaSuccess: null, stepLabel: null, classification: null },
    warnings: [],
  },
  {
    id: 'bucket-miss',
    groupId: 'bucket',
    variable: 'bucketMonths',
    label: 'Bucket',
    value: 36,
    valueLabel: '36 meses',
    baseline: false,
    comparableSuccess: true,
    note: null,
    metrics: { ...baselineMetrics, success: 0.91 },
    deltaVsBaseline: { success: 0.01, ruin: -0.01, qolScore: 0, terminalWealthRatio: 0, houseSalePct: 0, qualitySurvivalRate: 0, severeCutYearsMean: 0 },
    marginal: { deltaSuccess: null, stepLabel: null, classification: null },
    warnings: [],
  },
];
const marginalRows = addSensitivityMarginals(syntheticRows);
assert.equal(marginalRows.find((row) => row.id === 'f1-hit')?.marginal.classification, 'Alta');
assert.match(marginalRows.find((row) => row.id === 'f1-hit')?.marginal.stepLabel ?? '', /\$500k/);

const leverSummary = buildSensitivityLeverSummary({ rows: marginalRows });
assert.equal(leverSummary.levers.length, 8);
assert.equal(leverSummary.levers.some((lever) => String(lever.variableId).includes('house')), false);
assert.equal(leverSummary.levers.find((lever) => lever.variableId === 'expectedRealReturn')?.controllability, 'exógena');
assert.equal(leverSummary.levers.find((lever) => lever.variableId === 'phase2MonthlyClp')?.controllability, 'alta');
assert.equal(leverSummary.levers.find((lever) => lever.variableId === 'phase2MonthlyClp')?.effortOrSacrifice, 'alto');
assert.equal(leverSummary.levers.find((lever) => lever.variableId === 'phase3MonthlyClp')?.effortOrSacrifice, 'medio');
assert.equal(leverSummary.highestImpact?.variableId, 'phase1MonthlyClp');
assert.notEqual(leverSummary.mostActionable?.controllability, 'exógena');

const interpolation = estimateTargetFromPoints(
  { variable: 'phase1MonthlyClp', searchMode: 'monotonic-down', comparableSuccess: true },
  [
    { value: 5_000_000, metrics: { ...baselineMetrics, success: 0.946 } },
    { value: 5_200_000, metrics: { ...baselineMetrics, success: 0.941 } },
  ],
  0.944,
);
assert.equal(interpolation.interpolated, true);
assert.equal(Math.abs(interpolation.point.value - 5_080_000) < 0.001, true);
assert.equal(Math.abs((interpolation.point.metrics.success ?? 0) - 0.944) < 0.000001, true);
assert.match(interpolation.observation, /Interpolado/);

const closest = estimateTargetFromPoints(
  { variable: 'bucketMonths', searchMode: 'closest', comparableSuccess: true },
  [
    { value: 18, metrics: { ...baselineMetrics, success: 0.941 } },
    { value: 24, metrics: { ...baselineMetrics, success: 0.946 } },
  ],
  0.944,
);
assert.equal(closest.interpolated, false);
assert.equal(closest.point.value, 24);
assert.match(closest.observation, /Punto simulado más cercano/);

const inverseTargets = findChangeForSuccessTarget(baseInput, result.baseline, 2);
const f4Target = inverseTargets.find((row) => row.variable === 'phase4MonthlyClp');
const returnTarget = inverseTargets.find((row) => row.variable === 'expectedRealReturn');
const bucketTarget = inverseTargets.find((row) => row.variable === 'bucketMonths');
const horizonTarget = inverseTargets.find((row) => row.variable === 'horizonYears');
assert(f4Target);
assert.equal(f4Target.observation.includes('grilla'), false);
assert.equal(Number(f4Target.testedValue) >= Math.max(500_000, baseInput.phase4MonthlyClp * 0.2), true);
assert.equal(f4Target.targetSuccess, result.baseline.success === null ? null : result.baseline.success + 0.02);
assert.equal(f4Target.errorVsTarget === null || Number.isFinite(f4Target.errorVsTarget), true);
assert(returnTarget);
assert.equal(Number(returnTarget.testedValue) <= 0.08, true);
assert(bucketTarget);
assert.equal(Number(bucketTarget.testedValue) >= 6 && Number(bucketTarget.testedValue) <= 48, true);
assert.match(horizonTarget?.observation ?? '', /No comparable directo/);

console.log('midasSensitivity tests passed');
