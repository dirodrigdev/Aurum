import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { QualityOfLifeMetricsV1, SimulationResults } from '../model/types';
import type { M8Input } from '../simulation/m8.types';
import { buildStrategyDashboardModel } from './strategyDashboardModel';

const m8Input: M8Input = {
  years: 40,
  n_paths: 500,
  seed: 42,
  simulation_frequency: 'monthly',
  use_real_terms: true,
  capital_initial_clp: 1_234_567_890,
  capital_source: 'aurum',
  feeAnnual: 0.004,
  risk_capital_clp: 67_890_123,
  portfolio_mix: {
    eq_global: 0.4,
    eq_chile: 0.2,
    fi_global: 0.18,
    fi_chile: 0.17,
    usd_liquidity: 0.03,
    clp_cash: 0.02,
  },
  phase1MonthlyClp: 4_321_987,
  phase2MonthlyClp: 4_000_000,
  phase3MonthlyClp: 3_200_000,
  phase4MonthlyClp: 2_800_000,
  phase1EndYear: 4,
  phase2EndYear: 20,
  phase3EndYear: 35,
  return_assumptions: {
    eq_global_real_annual: 0.07,
    eq_chile_real_annual: 0.06,
    fi_global_real_annual: 0.025,
    fi_chile_real_annual: 0.02,
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
      fi_chile: { mean_annual: 0.02, vol_annual: 0.07 },
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
  bucket: { bucket_mode: 'operational_simple', bucket_months: 24 },
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
    houseValueUf: 18_765,
    mortgageBalanceUfNow: 2_345,
    monthlyAmortizationUf: 17,
    ufClpStart: 39_123,
    house_sale_trigger_years_of_spend: 3,
    house_sale_lag_months: 12,
  },
};

const quality = {
  warnings: [],
  classicSuccessRate: 0.918,
  csr85_4: 0.79,
  qasrStrict: 0.73,
  averageEffectiveSpendingRatio: 0.965,
  monthsBelow85: 18,
  maxConsecutiveMonthsBelow85: 5,
  qualitySurvivalRate: 0.61,
  severeCutYearsMean: 1.5,
  houseSaleYearMedian: 23,
  houseSaleIncidence: 0.18,
  terminalWealthRatio: 0.82,
} as unknown as QualityOfLifeMetricsV1;

const result = {
  success40: 0.918,
  probRuin40: 0.082,
  probRuin: 0.082,
  houseSalePct: 0.18,
  saleYearMedian: 23,
  maxDrawdownPercentiles: { 50: 0.28 },
  scenarioComparison: {
    optimistic: { probRuin: 0.04 },
    base: { probRuin: 0.082 },
    pessimistic: { probRuin: 0.17 },
  },
  qualityOfLifeMetrics: quality,
} as unknown as SimulationResults;

const model = buildStrategyDashboardModel({
  result,
  params: structuredClone(DEFAULT_PARAMETERS),
  m8Input,
  currentAge: 48,
  scenarioLabel: 'Base',
  canonicalInputReady: true,
  simulationWorking: false,
  simulationError: null,
  riskCapitalEnabled: true,
  riskCapitalEffective: true,
});

assert.equal(model.status, 'ready');
assert.equal(model.primaryMetrics.find((metric) => metric.id === 'success')?.value, 0.918);
assert(Math.abs(Number(model.primaryMetrics.find((metric) => metric.id === 'ruin')?.value) - 0.082) < 1e-12);
assert.equal(
  Number(model.primaryMetrics.find((metric) => metric.id === 'success')?.value)
    + Number(model.primaryMetrics.find((metric) => metric.id === 'ruin')?.value),
  1,
);
assert.equal(model.currentAge, 48);
assert.equal(model.targetAge, 88);
assert.equal(model.horizonYears, 40);
assert.equal(model.house.active, true);
assert.equal(model.house.expectedAge, 71);
assert.equal(model.riskReserve.active, true);
assert.equal(model.mix.reduce((sum, item) => sum + item.share, 0), 1);
assert(model.rates.every((rate) => rate.value === null || (rate.value >= 0 && rate.value < 1)));
assert(model.quality.length >= 4);
assert(model.signals.length >= 6);

const serialized = JSON.stringify(model);
for (const privateValue of ['1234567890', '67890123', '4321987', '18765', '39123']) {
  assert.equal(serialized.includes(privateValue), false, `Dashboard model leaked private input ${privateValue}`);
}
for (const privateKey of ['capital_initial_clp', 'phase1MonthlyClp', 'houseValueUf', 'risk_capital_clp']) {
  assert.equal(serialized.includes(privateKey), false, `Dashboard model exposed private field ${privateKey}`);
}
assert.doesNotMatch(serialized, /(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);

const loading = buildStrategyDashboardModel({
  result: null,
  params: structuredClone(DEFAULT_PARAMETERS),
  m8Input: null,
  currentAge: 48,
  scenarioLabel: 'Base',
  canonicalInputReady: false,
  simulationWorking: true,
  simulationError: null,
  riskCapitalEnabled: false,
  riskCapitalEffective: false,
});
assert.equal(loading.status, 'loading');
assert.equal(loading.primaryMetrics.length, 0);

const empty = buildStrategyDashboardModel({
  result: null,
  params: structuredClone(DEFAULT_PARAMETERS),
  m8Input,
  currentAge: 48,
  scenarioLabel: 'Base',
  canonicalInputReady: true,
  simulationWorking: false,
  simulationError: null,
  riskCapitalEnabled: false,
  riskCapitalEffective: false,
});
assert.equal(empty.status, 'empty');
assert.match(empty.statusMessage, /Ejecuta una simulación/);

console.log('Strategy Dashboard model tests passed');
