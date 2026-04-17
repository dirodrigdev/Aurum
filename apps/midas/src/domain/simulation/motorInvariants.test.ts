import assert from 'node:assert/strict';
import type { ModelParameters } from '../model/types';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { InstrumentBaseItem, InstrumentBaseSnapshot } from '../instrumentBase';
import { buildRealisticInstrumentProposal, validateInstrumentBaseJson } from '../instrumentBase';
import { validateInstrumentUniverseJson } from '../instrumentUniverse';
import {
  applyActiveDistributionToParams,
  applyOfficialDistributionToParams,
  deriveOfficialDistributionWeights,
  resolveOfficialDistributionState,
  shouldEnterSimulationWeightsMode,
} from '../model/officialDistribution';
import { runSimulationParametric } from './engineParametric';
import { applyScenarioVariant, runSimulationCore } from './engine';
import { evaluateOptimizerPoint } from '../optimizer/gridSearch';
import { buildMortgageProjection } from './mortgageProjection';
import { applyExpenseWaterfall, runAnnualRebalance } from './blockState';
import { updateSpendingMultiplier } from './spendingMultiplier';
import { evaluateConcordance } from './concordance';
import { snapshotToParams, snapshotToSimulationComposition } from '../../integrations/aurum/adapters';
import { resolveCapital } from './capitalResolver';
import { fromM8Output, toM8Input, validateM8Preconditions } from './m8Adapter';
import { runM8 } from './engineM8';
import {
  stripManualAdjustmentImpactFromParams,
  type ManualAdjustmentImpact,
} from './manualCapitalAdjustments';
import {
  M8_CANONICAL_CORRELATION_MATRIX,
  M8_CANONICAL_LEGACY_CORRELATION_MATRIX,
  M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS,
  M8_CANONICAL_PORTFOLIO_MIX,
  M8_CANONICAL_CASH_RETURN_ASSUMPTIONS,
  M8_CANONICAL_CASH_VOLATILITY_ASSUMPTIONS,
  remapLegacyCorrelationMatrixToM8,
} from './m8Calibration';
import { runSimulationCentral, runSimulationCentralAudit } from './engineCentral';
import { getMidasEngineFor } from './policy';
import type { M8Input } from './m8.types';

type TestFn = () => void;

const tests: Array<{ name: string; fn: TestFn }> = [];

const test = (name: string, fn: TestFn) => {
  tests.push({ name, fn });
};

const identityMatrix = () => [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

const cloneParams = (params: ModelParameters): ModelParameters => structuredClone(params);

const approxEqual = (actual: number, expected: number, tol = 1e-6) => {
  const scale = Math.max(1, Math.abs(expected));
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol * scale, `expected ${actual} to be within ${tol} of ${expected}`);
};

const makeBaseParams = (): ModelParameters => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.simulation = {
    ...params.simulation,
    nSim: 1,
    horizonMonths: 12,
    seed: 123,
    useHistoricalData: false,
  };
  params.weights = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  params.returns = {
    ...params.returns,
    rvGlobalAnnual: 0,
    rfGlobalAnnual: 0,
    rvChileAnnual: 0,
    rfChileUFAnnual: 0,
    rvGlobalVolAnnual: 0,
    rfGlobalVolAnnual: 0,
    rvChileVolAnnual: 0,
    rfChileVolAnnual: 0,
    correlationMatrix: identityMatrix(),
  };
  params.inflation = {
    ipcChileAnnual: 0,
    ipcChileVolAnnual: 0,
    hipcEurAnnual: 0,
    hipcEurVolAnnual: 0,
  };
  params.fx = {
    ...params.fx,
    clpUsdInitial: 1,
    usdEurFixed: 1,
    tcrealLT: 1,
    mrHalfLifeYears: 1,
  };
  params.spendingRule = {
    ...params.spendingRule,
    adjustmentAlpha: 0,
  };
  params.spendingPhases = [
    { durationMonths: 480, amountReal: 0, currency: 'CLP' },
  ];
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 0,
    optimizableInvestmentsCLP: 0,
    nonOptimizable: {
      banksCLP: 1,
      nonMortgageDebtCLP: 0,
      realEstate: {
        propertyValueCLP: 1_000_000,
        realEstateEquityCLP: 1_000_000,
        ufSnapshotCLP: 35_000,
        snapshotMonth: '2026-02',
      },
    },
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };
  params.realEstatePolicy = {
    enabled: false,
    triggerRunwayMonths: 36,
    saleDelayMonths: 12,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  params.ruinThresholdMonths = 0;
  return params;
};

const makeM8ContractParams = (): ModelParameters => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.capitalSource = 'aurum';
  params.capitalInitial = 650_000_000;
  params.manualCapitalInput = { financialCapitalCLP: 650_000_000 };
  params.simulationBaseMonth = '2026-03';
  params.activeScenario = 'optimistic';
  params.generatorType = 'student_t';
  params.bucketMonths = 24;
  params.simulation = {
    ...params.simulation,
    nSim: 3_000,
    horizonMonths: 480,
    seed: 321,
    useHistoricalData: false,
  };
  params.weights = {
    rvGlobal: 0.438,
    rfGlobal: 0.138,
    rvChile: 0.146,
    rfChile: 0.194,
  };
  params.spendingPhases = [
    { durationMonths: 36, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 204, amountReal: 3_900_000, currency: 'CLP' },
    { durationMonths: 240, amountReal: 4_800_000, currency: 'CLP' },
  ];
  params.spendingRule = {
    ...params.spendingRule,
    dd15Threshold: 0.15,
    dd25Threshold: 0.25,
    consecutiveMonths: 3,
    softCut: 0.9,
    hardCut: 0.8,
    adjustmentAlpha: 0.2,
    recoveryAlpha: 0.8,
  };
  params.realEstatePolicy = {
    enabled: true,
    triggerRunwayMonths: 36,
    saleDelayMonths: 12,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  params.futureCapitalEvents = [];
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 900_000_000,
    optimizableInvestmentsCLP: 650_000_000,
    nonOptimizable: {
      banksCLP: 80_000_000,
      nonMortgageDebtCLP: 0,
      realEstate: {
        propertyValueCLP: 300_000_000,
        mortgageDebtOutstandingCLP: 120_000_000,
        monthlyMortgagePaymentCLP: 1_500_000,
        ufSnapshotCLP: 40_000,
        snapshotMonth: '2026-03',
      },
    },
    mortgageProjectionStatus: 'uf_schedule',
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };
  return params;
};

const runtimeIdentity6 = () => [
  [1, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 1],
];

const makeRuntimeInput = (overrides: Partial<M8Input> = {}): M8Input => {
  const base: M8Input = {
    years: 4,
    n_paths: 24,
    seed: 42,
    simulation_frequency: 'monthly',
    use_real_terms: true,
    simulation_base_month: '2026-03',
    capital_initial_clp: 120_000_000,
    capital_source: 'manual',
    capital_source_label: 'manual',
    portfolio_mix: {
      eq_global: 0.438,
      eq_chile: 0.146,
      fi_global: 0.138,
      fi_chile: 0.194,
      usd_liquidity: 0.080,
      clp_cash: 0.004,
    },
    phase1MonthlyClp: 1_000_000,
    phase2MonthlyClp: 1_200_000,
    phase3MonthlyClp: 1_500_000,
    phase4MonthlyClp: 1_300_000,
    phase1EndYear: 1,
    phase2EndYear: 2,
    phase3EndYear: 3,
    return_assumptions: {
      eq_global_real_annual: 0.069,
      eq_chile_real_annual: 0.074,
      fi_global_real_annual: 0.024,
      fi_chile_real_annual: 0.019,
      usd_liquidity_real_annual: 0.018,
      clp_cash_real_annual: 0.0025,
    },
    generator_type: 'student_t',
    generator_params: {
      distribution: 'student_t',
      degrees_of_freedom: 7,
      sleeves: {
        eq_global: { mean_annual: 0.069, vol_annual: 0.15 },
        eq_chile: { mean_annual: 0.074, vol_annual: 0.19 },
        fi_global: { mean_annual: 0.024, vol_annual: 0.045 },
        fi_chile: { mean_annual: 0.019, vol_annual: 0.035 },
        usd_liquidity: { mean_annual: 0.018, vol_annual: 0.015 },
        clp_cash: { mean_annual: 0.0025, vol_annual: 0.002 },
      },
      correlation_matrix: runtimeIdentity6(),
    },
    scenario_overrides: { scenario_id: 'base' },
    bucket: {
      bucket_mode: 'operational_simple',
      bucket_months: 24,
    },
    cuts: {
      cut1_floor: 0.9,
      cut2_floor: 0.8,
      recovery_cut2_to_cut1_months: 2,
      recovery_cut1_to_normal_months: 3,
      adjustment_alpha: 0.2,
      dd15_threshold: 0.15,
      dd25_threshold: 0.25,
      consecutive_months: 3,
    },
    future_events: [],
  };

  return {
    ...base,
    ...overrides,
    portfolio_mix: { ...base.portfolio_mix, ...(overrides.portfolio_mix ?? {}) },
    return_assumptions: { ...base.return_assumptions, ...(overrides.return_assumptions ?? {}) },
    bucket: { ...base.bucket, ...(overrides.bucket ?? {}) },
    cuts: { ...base.cuts, ...(overrides.cuts ?? {}) },
    generator_params: overrides.generator_params ?? base.generator_params,
    scenario_overrides: overrides.scenario_overrides ?? base.scenario_overrides,
    future_events: overrides.future_events ?? base.future_events,
    house: overrides.house ?? base.house,
  };
};

const runtimeFlatGaussianParams: M8Input['generator_params'] = {
  distribution: 'gaussian_iid',
  sleeves: {
    eq_global: { mean_annual: 0, vol_annual: 0 },
    eq_chile: { mean_annual: 0, vol_annual: 0 },
    fi_global: { mean_annual: 0, vol_annual: 0 },
    fi_chile: { mean_annual: 0, vol_annual: 0 },
    usd_liquidity: { mean_annual: 0, vol_annual: 0 },
    clp_cash: { mean_annual: 0, vol_annual: 0 },
  },
  correlation_matrix: runtimeIdentity6(),
};

test('equity uf with zero inflation matches amortization sum', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 3;
  const realEstate = params.simulationComposition!.nonOptimizable.realEstate!;
  const projection = buildMortgageProjection(realEstate, params.simulation.horizonMonths);
  const sumUF = projection.amortizationUF.reduce((acc, v) => acc + v, 0);
  const expected = (realEstate.realEstateEquityCLP ?? 0) + sumUF * (realEstate.ufSnapshotCLP ?? 0) + 1;
  const result = runSimulationParametric(params);
  const actual = result.terminalWealthPercentiles[50];
  approxEqual(actual, expected, 1e-6);
});

test('positive inflation increases equity in CLP vs inflation 0', () => {
  const base = makeBaseParams();
  base.simulation.horizonMonths = 3;
  const resultBase = runSimulationParametric(base);
  const baseEquity = resultBase.terminalWealthPercentiles[50];

  const infl = makeBaseParams();
  infl.simulation.horizonMonths = 3;
  infl.inflation.ipcChileAnnual = 0.06;
  infl.inflation.ipcChileVolAnnual = 0;
  const resultInfl = runSimulationParametric(infl);
  const inflEquity = resultInfl.terminalWealthPercentiles[50];
  assert.ok(inflEquity > baseEquity, 'inflation should lift CLP equity');
});

test('amortization table end sets amortization to 0', () => {
  const realEstate = {
    propertyValueCLP: 1,
    realEstateEquityCLP: 1,
    ufSnapshotCLP: 1,
    snapshotMonth: '2026-02',
  };
  const csv = 'date,amortizationUF\n2026-03,1\n2026-04,1\n';
  const projection = buildMortgageProjection(realEstate, 5, { csvOverride: csv });
  assert.equal(projection.amortizationUF[2], 0);
  assert.ok(projection.notes.some((note) => note.startsWith('warn-and-run:amortization-ended')));
});

test('alignment ok when first month matches snapshot + 1', () => {
  const realEstate = {
    propertyValueCLP: 1,
    realEstateEquityCLP: 1,
    ufSnapshotCLP: 1,
    snapshotMonth: '2026-02',
  };
  const csv = 'date,amortizationUF\n2026-03,1\n';
  const projection = buildMortgageProjection(realEstate, 1, { csvOverride: csv });
  assert.ok(!projection.notes.some((note) => note.includes('amortization-first-month-mismatch')));
});

test('alignment mismatch emits warning', () => {
  const realEstate = {
    propertyValueCLP: 1,
    realEstateEquityCLP: 1,
    ufSnapshotCLP: 1,
    snapshotMonth: '2026-02',
  };
  const csv = 'date,amortizationUF\n2026-04,1\n';
  const projection = buildMortgageProjection(realEstate, 1, { csvOverride: csv });
  assert.ok(projection.notes.some((note) => note.includes('amortization-first-month-mismatch')));
});

test('missing month uses previous value and emits warning', () => {
  const realEstate = {
    propertyValueCLP: 1,
    realEstateEquityCLP: 1,
    ufSnapshotCLP: 1,
    snapshotMonth: '2026-02',
  };
  const csv = 'date,amortizationUF\n2026-03,10\n2026-05,20\n';
  const projection = buildMortgageProjection(realEstate, 3, { csvOverride: csv });
  assert.equal(projection.amortizationUF[1], 10);
  assert.ok(projection.notes.some((note) => note.includes('amortization-missing-months')));
});

test('missing first month falls back to next value', () => {
  const realEstate = {
    propertyValueCLP: 1,
    realEstateEquityCLP: 1,
    ufSnapshotCLP: 1,
    snapshotMonth: '2026-02',
  };
  const csv = 'date,amortizationUF\n2026-04,12\n';
  const projection = buildMortgageProjection(realEstate, 1, { csvOverride: csv });
  assert.equal(projection.amortizationUF[0], 12);
  assert.ok(projection.notes.some((note) => note.includes('amortization-first-month-mismatch')));
});

test('invalid ufSnapshotCLP yields fallback status', () => {
  const realEstate = {
    propertyValueCLP: 1,
    realEstateEquityCLP: 1,
    ufSnapshotCLP: 0,
    snapshotMonth: '2026-02',
  };
  const projection = buildMortgageProjection(realEstate, 2);
  assert.equal(projection.status, 'fallback_incomplete');
  assert.ok(projection.notes.includes('mortgage-uf-missing-uf'));
});

test('invalid nSim throws controlled validation error', () => {
  const params = makeBaseParams();
  params.simulation.nSim = 0;
  assert.throws(
    () => runSimulationParametric(params),
    /invalid_simulation_input: .*simulation\.nSim/,
  );
});

test('invalid correlation matrix shape throws controlled validation error', () => {
  const params = makeBaseParams();
  params.returns.correlationMatrix = [[1, 0.2], [0.2, 1]] as unknown as number[][];
  assert.throws(
    () => runSimulationParametric(params),
    /invalid_simulation_input: .*correlationMatrix/,
  );
});

test('invalid weights (sum zero) throws controlled validation error', () => {
  const params = makeBaseParams();
  params.weights = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 0 };
  assert.throws(
    () => runSimulationParametric(params),
    /invalid_simulation_input: .*weights must sum to a positive value/,
  );
});

test('invalid weights (NaN) throws controlled validation error', () => {
  const params = makeBaseParams();
  params.weights = { rvGlobal: Number.NaN, rfGlobal: 0.5, rvChile: 0.3, rfChile: 0.2 };
  assert.throws(
    () => runSimulationParametric(params),
    /invalid_simulation_input: .*weights\.rvGlobal/,
  );
});

test('invalid fee or FX throws controlled validation error', () => {
  const params = makeBaseParams();
  params.feeAnnual = 0.2;
  params.fx.clpUsdInitial = 0;
  assert.throws(
    () => runSimulationParametric(params),
    /invalid_simulation_input: .*feeAnnual.*fx\.clpUsdInitial/,
  );
});

test('exposes p50 terminal for all paths and survivors', () => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.simulation = {
    ...params.simulation,
    nSim: 300,
    seed: 42,
    useHistoricalData: false,
  };
  const result = runSimulationParametric(params);
  assert.equal(typeof result.p50TerminalAllPaths, 'number');
  assert.equal(typeof result.p50TerminalSurvivors, 'number');
  assert.ok((result.p50TerminalAllPaths ?? 0) <= (result.p50TerminalSurvivors ?? 0));
});

test('fallback mortgage keeps base equity instead of dropping to zero', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 1;
  const realEstate = params.simulationComposition?.nonOptimizable.realEstate;
  assert.ok(realEstate);
  realEstate.realEstateEquityCLP = 500_000;
  realEstate.ufSnapshotCLP = 0;
  realEstate.snapshotMonth = '2026-02';
  const result = runSimulationParametric(params);
  const actual = result.terminalWealthPercentiles[50];
  approxEqual(actual, 500_001, 1e-6);
});

test('sale before year 20 keeps expense at 6MM', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 12;
  params.spendingPhases = [
    { durationMonths: 480, amountReal: 6_000_000, currency: 'CLP' },
  ];
  params.realEstatePolicy = {
    enabled: true,
    triggerRunwayMonths: 36,
    saleDelayMonths: 0,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  const realEstate = params.simulationComposition?.nonOptimizable.realEstate;
  assert.ok(realEstate);
  realEstate.realEstateEquityCLP = 600_000_000;
  const result = runSimulationParametric(params);
  const diagnostics = result.params.simulationComposition?.diagnostics;
  assert.equal(diagnostics?.saleExecutedMonth, 2);
  const expectedBucket = 6_000_000 * 36;
  approxEqual(diagnostics?.bucketTarget ?? 0, expectedBucket, 1e-6);
});

test('sale after year 20 lifts expense from 4MM to 6MM', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 12;
  params.spendingPhases = [
    { durationMonths: 480, amountReal: 4_000_000, currency: 'CLP' },
  ];
  params.realEstatePolicy = {
    enabled: true,
    triggerRunwayMonths: 36,
    saleDelayMonths: 0,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  const realEstate = params.simulationComposition?.nonOptimizable.realEstate;
  assert.ok(realEstate);
  realEstate.realEstateEquityCLP = 600_000_000;
  const result = runSimulationParametric(params);
  const diagnostics = result.params.simulationComposition?.diagnostics;
  assert.equal(diagnostics?.saleExecutedMonth, 2);
  const expectedBucket = 6_000_000 * 36;
  approxEqual(diagnostics?.bucketTarget ?? 0, expectedBucket, 1e-6);
});

test('no double count on sale month', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 1;
  const realEstate = params.simulationComposition?.nonOptimizable.realEstate;
  assert.ok(realEstate);
  realEstate.realEstateEquityCLP = 100;
  realEstate.ufSnapshotCLP = 1;
  realEstate.snapshotMonth = '';
  params.realEstatePolicy = {
    enabled: true,
    triggerRunwayMonths: 36,
    saleDelayMonths: 0,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  const result = runSimulationParametric(params);
  const actual = result.terminalWealthPercentiles[50];
  approxEqual(actual, 101, 1e-6);
});

test('non-mortgage debt only affects terminal wealth', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 1;
  const realEstate = params.simulationComposition?.nonOptimizable.realEstate;
  assert.ok(realEstate);
  realEstate.realEstateEquityCLP = 100;
  realEstate.ufSnapshotCLP = 1;
  params.simulationComposition = {
    ...params.simulationComposition!,
    nonOptimizable: {
      ...params.simulationComposition!.nonOptimizable,
      nonMortgageDebtCLP: -100,
      realEstate,
    },
  };
  params.realEstatePolicy = {
    enabled: false,
    triggerRunwayMonths: 36,
    saleDelayMonths: 12,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  const result = runSimulationParametric(params);
  const actual = result.terminalWealthPercentiles[50];
  const projection = buildMortgageProjection(realEstate, params.simulation.horizonMonths);
  const expected = realEstate.realEstateEquityCLP + (projection.amortizationUF[0] ?? 0) * realEstate.ufSnapshotCLP + 1 - (0.7 * 100);
  approxEqual(actual, expected, 1e-6);
});

test('bucket rebalance does not create magic capital', () => {
  const params = makeBaseParams();
  const stateA = {
    banks: 0,
    usdLiquidityCLP: 0,
    riskUsdCLP: 0,
    sleeves: {
      rvGlobal: 0,
      rvChile: 0,
      rfGlobal: 0,
      rfChile: 1000,
    },
  };
  const resultA = runAnnualRebalance(stateA, params, 800);
  assert.equal(resultA.bucketAfterRebalance, 800);

  const stateB = {
    banks: 0,
    usdLiquidityCLP: 0,
    riskUsdCLP: 0,
    sleeves: {
      rvGlobal: 0,
      rvChile: 100,
      rfGlobal: 200,
      rfChile: 100,
    },
  };
  const resultB = runAnnualRebalance(stateB, params, 800);
  assert.ok(resultB.bucketAfterRebalance < 800);
});

test('eur phase waterfall uses usd liquidity before rf and keeps risk last', () => {
  const state = {
    banks: 10,
    usdLiquidityCLP: 20,
    riskUsdCLP: 30,
    sleeves: {
      rvGlobal: 0,
      rvChile: 0,
      rfGlobal: 0,
      rfChile: 100,
    },
  };
  const flow = applyExpenseWaterfall(state, 25, 0, true);
  assert.equal(flow.shortfall, 0);
  assert.equal(state.banks, 0);
  assert.equal(state.usdLiquidityCLP, 5);
  assert.equal(state.sleeves.rfChile, 100);
  assert.equal(state.riskUsdCLP, 30);
});

test('aurum adapter maps cash/other conservatively to rfChile', () => {
  const params = snapshotToParams({
    version: '1.0',
    snapshotDate: '2026-02-28',
    publishedAt: '2026-03-01',
    totalCapitalCLP: 1_000_000_000,
    allocation: {
      rvGlobal: 0.20,
      rfGlobal: 0.15,
      rvChile: 0.10,
      rfChile: 0.25,
      cash: 0.20,
      other: 0.10,
    },
    fxReference: {
      clpUsd: 1000,
      usdEur: 1.05,
      clpEur: 952,
    },
    source: 'test',
  } as any, cloneParams(DEFAULT_PARAMETERS));
  approxEqual(params.weights.rvGlobal, 0.2);
  approxEqual(params.weights.rfGlobal, 0.15);
  approxEqual(params.weights.rvChile, 0.10);
  approxEqual(params.weights.rfChile, 0.55);
});

test('optimizable snapshot maps usd liquidity into nonOptimizable blocks', () => {
  const composition = snapshotToSimulationComposition({
    version: 2,
    publishedAt: '2026-03-01',
    snapshotMonth: '2026-02',
    snapshotLabel: 'test',
    currency: 'CLP',
    totalNetWorthCLP: 1_000_000_000,
    optimizableInvestmentsCLP: 600_000_000,
    riskCapital: { totalCLP: 0 },
    nonOptimizable: {
      banksCLP: 100_000_000,
      usdLiquidityCLP: 50_000_000,
      nonMortgageDebtCLP: 0,
    },
    source: { app: 'aurum', basis: 'latest_confirmed_closure' },
  } as any);
  assert.ok(composition);
  assert.equal(composition.nonOptimizable.usdLiquidityCLP, 50_000_000);
});

test('real estate appreciation base 0% with sensitivities 0.5% and 1.0% is monotonic', () => {
  const mk = (realAppreciationAnnual: number) => {
    const params = makeBaseParams();
    params.simulation.horizonMonths = 24;
    params.inflation.ipcChileAnnual = 0;
    params.realEstatePolicy = {
      ...params.realEstatePolicy!,
      enabled: false,
      realAppreciationAnnual,
    };
    return runSimulationParametric(params).p50TerminalAllPaths ?? 0;
  };
  const p0 = mk(0);
  const p05 = mk(0.005);
  const p10 = mk(0.01);
  assert.ok(p05 >= p0, '0.5% real should not underperform 0% real');
  assert.ok(p10 >= p05, '1.0% real should not underperform 0.5% real');
});

test('spending multiplier recovers in <=2 months after stress release', () => {
  const rule = {
    ...DEFAULT_PARAMETERS.spendingRule,
    adjustmentAlpha: 0.2,
    recoveryAlpha: 0.8,
  };
  const month1 = updateSpendingMultiplier(0.8, 1, rule);
  const month2 = updateSpendingMultiplier(month1, 1, rule);
  assert.ok(month2 >= 0.99, `expected recovery >=0.99 in 2 months, got ${month2}`);
});

test('bootstrap control motor runs and returns bounded probRuin', () => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.simulation = { ...params.simulation, nSim: 200, seed: 99, useHistoricalData: true };
  const result = runSimulationCore(params);
  assert.ok(result.probRuin >= 0 && result.probRuin <= 1);
});

test('bootstrap scenario variants shift terminal wealth directionally', () => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.simulation = {
    ...params.simulation,
    nSim: 1,
    horizonMonths: 12,
    seed: 123,
    useHistoricalData: false,
  };
  params.weights = { rvGlobal: 1, rfGlobal: 0, rvChile: 0, rfChile: 0 };
  params.spendingPhases = [
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
  ];
  params.returns = {
    rvGlobalAnnual: 0,
    rfGlobalAnnual: 0,
    rvChileAnnual: 0,
    rfChileUFAnnual: 0,
    rvGlobalVolAnnual: 0,
    rfGlobalVolAnnual: 0,
    rvChileVolAnnual: 0,
    rfChileVolAnnual: 0,
    correlationMatrix: identityMatrix(),
  };
  params.inflation = {
    ipcChileAnnual: 0,
    ipcChileVolAnnual: 0,
    hipcEurAnnual: 0,
    hipcEurVolAnnual: 0,
  };
  params.fx = {
    ...params.fx,
    clpUsdInitial: 1,
    usdEurFixed: 1,
    tcrealLT: 1,
    mrHalfLifeYears: 1,
  };

  const base = { id: 'base' } as any;
  const pessimistic = {
    id: 'pessimistic',
    rvGlobalAnnual: -0.05,
    rfGlobalAnnual: 0.0,
    rvChileAnnual: -0.05,
    rfChileUFAnnual: 0.0,
  } as any;
  const optimistic = {
    id: 'optimistic',
    rvGlobalAnnual: 0.05,
    rfGlobalAnnual: 0.02,
    rvChileAnnual: 0.05,
    rfChileUFAnnual: 0.02,
  } as any;

  const baseResult = runSimulationCore(applyScenarioVariant(params, base));
  const pessResult = runSimulationCore(applyScenarioVariant(params, pessimistic));
  const optResult = runSimulationCore(applyScenarioVariant(params, optimistic));

  const baseP50 = baseResult.terminalWealthPercentiles[50] ?? 0;
  const pessP50 = pessResult.terminalWealthPercentiles[50] ?? 0;
  const optP50 = optResult.terminalWealthPercentiles[50] ?? 0;

  assert.ok(pessP50 <= baseP50, 'pessimistic should not exceed base terminal wealth');
  assert.ok(optP50 >= baseP50, 'optimistic should not underperform base terminal wealth');
});

test('bootstrap block mode includes all-paths terminal and applies non-mortgage debt adjustment', () => {
  const params = makeBaseParams();
  params.simulation = {
    ...params.simulation,
    nSim: 1,
    horizonMonths: 1,
    seed: 321,
    useHistoricalData: false,
  };
  params.spendingPhases = [
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
  ];
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 100,
    optimizableInvestmentsCLP: 0,
    nonOptimizable: {
      banksCLP: 100,
      nonMortgageDebtCLP: -100,
      riskCapital: { totalCLP: 0 },
      realEstate: {
        propertyValueCLP: 0,
        realEstateEquityCLP: 0,
        ufSnapshotCLP: 0,
        snapshotMonth: '',
      },
    },
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };
  params.realEstatePolicy = {
    enabled: false,
    triggerRunwayMonths: 36,
    saleDelayMonths: 12,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };
  const result = runSimulationCore(params);
  assert.ok(Array.isArray(result.terminalWealthAllPaths));
  const expected = 29;
  approxEqual(result.p50TerminalAllPaths ?? 0, expected, 1e-6);
});

test('concordance semaphore classifies green/yellow/red/double-red as defined', () => {
  const green = evaluateConcordance(0.12, 0.135);
  assert.equal(green.status, 'green');

  const yellow = evaluateConcordance(0.17, 0.12);
  assert.equal(yellow.status, 'yellow');

  const redByDiff = evaluateConcordance(0.12, 0.17);
  assert.equal(redByDiff.status, 'red');

  const doubleRedByZoneJump = evaluateConcordance(0.08, 0.18);
  assert.equal(doubleRedByZoneJump.status, 'double-red');
});

test('official distribution weights are derived from instrument base JSON snapshot', () => {
  const snapshot: InstrumentBaseSnapshot = {
    version: 1,
    savedAt: '2026-03-29T00:00:00.000Z',
    rawJson: '[]',
    instruments: [
      {
        id: 'global-rv',
        name: 'Global RV',
        manager: 'Test',
        currency: 'CLP',
        currentAmountCLP: 100,
        exposure: { rv: 1, rf: 0, global: 1, local: 0 },
      },
      {
        id: 'local-rf',
        name: 'Local RF',
        manager: 'Test',
        currency: 'CLP',
        currentAmountCLP: 100,
        exposure: { rv: 0, rf: 1, global: 0, local: 1 },
      },
    ],
  };
  const weights = deriveOfficialDistributionWeights(snapshot);
  assert.ok(weights, 'expected weights from valid instrument snapshot');
  approxEqual(weights!.rvGlobal, 0.25);
  approxEqual(weights!.rfGlobal, 0.25);
  approxEqual(weights!.rvChile, 0.25);
  approxEqual(weights!.rfChile, 0.25);
});

test('official distribution overrides params weights without changing capital blocks', () => {
  const params = makeBaseParams();
  params.weights = { rvGlobal: 0.4, rfGlobal: 0.3, rvChile: 0.2, rfChile: 0.1 };
  params.capitalInitial = 777_000_000;
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 777_000_000,
    optimizableInvestmentsCLP: 600_000_000,
    nonOptimizable: {
      banksCLP: 120_000_000,
      nonMortgageDebtCLP: 20_000_000,
      riskCapital: { totalCLP: 57_000_000 },
      realEstate: {
        propertyValueCLP: 300_000_000,
        realEstateEquityCLP: 240_000_000,
        ufSnapshotCLP: 35_000,
        snapshotMonth: '2026-03',
      },
    },
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };
  const official = { rvGlobal: 0.1, rfGlobal: 0.2, rvChile: 0.3, rfChile: 0.4 };
  const next = applyOfficialDistributionToParams(params, official);
  approxEqual(next.weights.rvGlobal, 0.1);
  approxEqual(next.weights.rfGlobal, 0.2);
  approxEqual(next.weights.rvChile, 0.3);
  approxEqual(next.weights.rfChile, 0.4);
  assert.equal(next.capitalInitial, 777_000_000);
  assert.equal(next.simulationComposition?.optimizableInvestmentsCLP, 600_000_000);
  assert.equal(next.simulationComposition?.nonOptimizable?.banksCLP, 120_000_000);
  assert.equal(next.simulationComposition?.nonOptimizable?.nonMortgageDebtCLP, 20_000_000);
});

test('manual capital ledger delete restores block capital to clean base', () => {
  const cleanBase = makeBaseParams();
  cleanBase.capitalInitial = 720_000_000;
  cleanBase.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 1_020_000_000,
    optimizableInvestmentsCLP: 600_000_000,
    nonOptimizable: {
      banksCLP: 120_000_000,
      nonMortgageDebtCLP: 0,
      realEstate: {
        propertyValueCLP: 360_000_000,
        realEstateEquityCLP: 300_000_000,
        ufSnapshotCLP: 35_000,
        snapshotMonth: '2026-03',
      },
    },
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };
  const cleanComposition = cleanBase.simulationComposition!;
  cleanBase.cashflowEvents = [
    {
      id: 'base-event',
      description: 'base inflow',
      month: 12,
      type: 'inflow',
      amount: 1_000_000,
      currency: 'CLP',
      amountType: 'real',
    },
  ];
  cleanBase.futureCapitalEvents = [
    {
      id: 'base-future',
      description: 'base future',
      type: 'inflow',
      amount: 2_000_000,
      currency: 'CLP',
      effectiveDate: '2027-01',
    },
  ];

  const addImpact: ManualAdjustmentImpact = {
    currentTotalDelta: 120_000_000,
    currentBanksDelta: 50_000_000,
    currentInvestmentsDelta: 70_000_000,
    currentRiskDelta: 0,
    futureEvents: [],
    futureCapitalEvents: [],
  };
  const withManualAdd = cloneParams(cleanBase);
  withManualAdd.capitalInitial = 840_000_000;
  withManualAdd.simulationComposition!.optimizableInvestmentsCLP = 670_000_000;
  withManualAdd.simulationComposition!.nonOptimizable.banksCLP = 170_000_000;
  withManualAdd.cashflowEvents = [
    ...withManualAdd.cashflowEvents,
    {
      id: 'manual-a',
      description: 'manual future',
      month: 18,
      type: 'inflow',
      amount: 3_000_000,
      currency: 'CLP',
      amountType: 'real',
    },
  ];
  withManualAdd.futureCapitalEvents = [
    ...(withManualAdd.futureCapitalEvents ?? []),
    {
      id: 'manual-a',
      description: 'manual future',
      type: 'inflow',
      amount: 3_000_000,
      currency: 'CLP',
      effectiveDate: '2027-06',
    },
  ];

  assert.equal(withManualAdd.capitalInitial, cleanBase.capitalInitial + addImpact.currentTotalDelta);
  const afterDelete = stripManualAdjustmentImpactFromParams(withManualAdd, addImpact);
  assert.equal(afterDelete.capitalInitial, cleanBase.capitalInitial);
  assert.equal(afterDelete.simulationComposition?.optimizableInvestmentsCLP, cleanComposition.optimizableInvestmentsCLP);
  assert.equal(afterDelete.simulationComposition?.nonOptimizable?.banksCLP, cleanComposition.nonOptimizable.banksCLP);
  assert.deepEqual(afterDelete.cashflowEvents.map((event) => event.id), ['base-event']);
  assert.deepEqual(afterDelete.futureCapitalEvents?.map((event) => event.id), ['base-future']);

  const editedImpact: ManualAdjustmentImpact = {
    currentTotalDelta: 40_000_000,
    currentBanksDelta: 10_000_000,
    currentInvestmentsDelta: 30_000_000,
    currentRiskDelta: 0,
    futureEvents: [],
    futureCapitalEvents: [],
  };
  const afterEditBase = stripManualAdjustmentImpactFromParams(withManualAdd, addImpact);
  const withEditedManual = cloneParams(afterEditBase);
  withEditedManual.capitalInitial += editedImpact.currentTotalDelta;
  withEditedManual.simulationComposition!.optimizableInvestmentsCLP += editedImpact.currentInvestmentsDelta;
  withEditedManual.simulationComposition!.nonOptimizable.banksCLP += editedImpact.currentBanksDelta;
  assert.equal(withEditedManual.capitalInitial, cleanBase.capitalInitial + editedImpact.currentTotalDelta);
  const afterEditedDelete = stripManualAdjustmentImpactFromParams(withEditedManual, editedImpact);
  assert.equal(afterEditedDelete.capitalInitial, cleanBase.capitalInitial);
  assert.equal(afterEditedDelete.simulationComposition?.optimizableInvestmentsCLP, cleanComposition.optimizableInvestmentsCLP);
  assert.equal(afterEditedDelete.simulationComposition?.nonOptimizable?.banksCLP, cleanComposition.nonOptimizable.banksCLP);
});

test('invalid current JSON with last known valid falls back to last known official', () => {
  const lastKnown = { rvGlobal: 0.4, rfGlobal: 0.3, rvChile: 0.2, rfChile: 0.1 };
  const resolved = resolveOfficialDistributionState({
    jsonOfficialWeights: null,
    lastKnownOfficialWeights: lastKnown,
    defaultWeights: DEFAULT_PARAMETERS.weights,
  });
  assert.equal(resolved.weightsSourceMode, 'last-known-official');
  approxEqual(resolved.activeWeights.rvGlobal, 0.4);
  approxEqual(resolved.activeWeights.rfGlobal, 0.3);
  approxEqual(resolved.activeWeights.rvChile, 0.2);
  approxEqual(resolved.activeWeights.rfChile, 0.1);
});

test('valid current JSON takes precedence as official source', () => {
  const jsonOfficial = { rvGlobal: 0.15, rfGlobal: 0.35, rvChile: 0.25, rfChile: 0.25 };
  const lastKnown = { rvGlobal: 0.4, rfGlobal: 0.3, rvChile: 0.2, rfChile: 0.1 };
  const resolved = resolveOfficialDistributionState({
    jsonOfficialWeights: jsonOfficial,
    lastKnownOfficialWeights: lastKnown,
    defaultWeights: DEFAULT_PARAMETERS.weights,
  });
  assert.equal(resolved.weightsSourceMode, 'json-official');
  assert.equal(resolved.fallbackReason, null);
  approxEqual(resolved.officialWeights?.rvGlobal ?? 0, jsonOfficial.rvGlobal);
  approxEqual(resolved.lastKnownOfficialWeights?.rfGlobal ?? 0, jsonOfficial.rfGlobal);
  approxEqual(resolved.activeWeights.rvChile, jsonOfficial.rvChile);
  approxEqual(resolved.activeWeights.rfChile, jsonOfficial.rfChile);
});

test('without current or last known JSON uses explicit system defaults', () => {
  const resolved = resolveOfficialDistributionState({
    jsonOfficialWeights: null,
    lastKnownOfficialWeights: null,
    defaultWeights: DEFAULT_PARAMETERS.weights,
  });
  assert.equal(resolved.weightsSourceMode, 'system-defaults');
  approxEqual(
    resolved.activeWeights.rvGlobal +
      resolved.activeWeights.rfGlobal +
      resolved.activeWeights.rvChile +
      resolved.activeWeights.rfChile,
    1,
  );
});

test('manual weight edit enters simulation mode and restore can return to official', () => {
  const official = { rvGlobal: 0.25, rfGlobal: 0.25, rvChile: 0.25, rfChile: 0.25 };
  const simulated = { rvGlobal: 0.5, rfGlobal: 0.1, rvChile: 0.2, rfChile: 0.2 };
  assert.equal(shouldEnterSimulationWeightsMode(official, simulated), true);
  const backToOfficial = applyActiveDistributionToParams(cloneParams(DEFAULT_PARAMETERS), official);
  approxEqual(backToOfficial.weights.rvGlobal, official.rvGlobal);
  approxEqual(backToOfficial.weights.rfGlobal, official.rfGlobal);
  approxEqual(backToOfficial.weights.rvChile, official.rvChile);
  approxEqual(backToOfficial.weights.rfChile, official.rfChile);
});

test('active distribution updates only financial weights and keeps non-optimizable blocks/events intact', () => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.cashflowEvents = [
    {
      id: 'cf-1',
      description: 'inflow clp',
      month: 12,
      type: 'inflow',
      amount: 5_000_000,
      currency: 'CLP',
      sleeve: 'rfChile',
    },
    {
      id: 'cf-2',
      description: 'outflow eur',
      month: 24,
      type: 'outflow',
      amount: 2_000,
      currency: 'EUR',
    },
  ];
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 900_000_000,
    optimizableInvestmentsCLP: 500_000_000,
    nonOptimizable: {
      banksCLP: 120_000_000,
      nonMortgageDebtCLP: 35_000_000,
      riskCapital: { totalCLP: 90_000_000, usdTotal: 100_000, usdSnapshotCLP: 900 },
      realEstate: {
        propertyValueCLP: 400_000_000,
        realEstateEquityCLP: 245_000_000,
        ufSnapshotCLP: 35_000,
        snapshotMonth: '2026-03',
      },
    },
    diagnostics: {
      sourceVersion: 2,
      mode: 'full',
      compositionGapCLP: 0,
      compositionGapPct: 0,
      notes: [],
    },
  };

  const next = applyActiveDistributionToParams(
    params,
    { rvGlobal: 0.55, rfGlobal: 0.1, rvChile: 0.2, rfChile: 0.15 },
  );
  approxEqual(next.weights.rvGlobal, 0.55);
  approxEqual(next.weights.rfGlobal, 0.1);
  approxEqual(next.weights.rvChile, 0.2);
  approxEqual(next.weights.rfChile, 0.15);

  assert.deepEqual(next.cashflowEvents, params.cashflowEvents);
  assert.equal(next.simulationComposition?.optimizableInvestmentsCLP, 500_000_000);
  assert.equal(next.simulationComposition?.nonOptimizable?.banksCLP, 120_000_000);
  assert.equal(next.simulationComposition?.nonOptimizable?.nonMortgageDebtCLP, 35_000_000);
  assert.equal(next.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP, 90_000_000);
  assert.equal(next.simulationComposition?.nonOptimizable?.realEstate?.realEstateEquityCLP, 245_000_000);
});

test('active distribution parity can be enforced consistently across consumer params', () => {
  const active = { rvGlobal: 0.3, rfGlobal: 0.2, rvChile: 0.1, rfChile: 0.4 };
  const baseParams = cloneParams(DEFAULT_PARAMETERS);
  const optimizerParams = cloneParams(DEFAULT_PARAMETERS);
  optimizerParams.weights = { rvGlobal: 0.9, rfGlobal: 0.05, rvChile: 0.03, rfChile: 0.02 };
  const nextBase = applyActiveDistributionToParams(baseParams, active);
  const nextOptimizer = applyActiveDistributionToParams(optimizerParams, active);
  approxEqual(nextBase.weights.rvGlobal, nextOptimizer.weights.rvGlobal);
  approxEqual(nextBase.weights.rfGlobal, nextOptimizer.weights.rfGlobal);
  approxEqual(nextBase.weights.rvChile, nextOptimizer.weights.rvChile);
  approxEqual(nextBase.weights.rfChile, nextOptimizer.weights.rfChile);
});

test('cashflow CLP nominal stays fixed while CLP real scales over time', () => {
  const base = makeBaseParams();
  base.capitalInitial = 0;
  base.feeAnnual = 0;
  base.simulation.horizonMonths = 120;
  base.simulation.nSim = 1;
  base.simulation.seed = 7;
  base.weights = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  base.returns = {
    ...base.returns,
    rvGlobalAnnual: 0,
    rfGlobalAnnual: 0,
    rvChileAnnual: 0,
    rfChileUFAnnual: 0,
    rvGlobalVolAnnual: 0,
    rfGlobalVolAnnual: 0,
    rvChileVolAnnual: 0,
    rfChileVolAnnual: 0,
    correlationMatrix: identityMatrix(),
  };
  base.inflation = {
    ...base.inflation,
    ipcChileAnnual: 0.10,
    ipcChileVolAnnual: 0,
    hipcEurAnnual: 0,
    hipcEurVolAnnual: 0,
  };
  base.spendingPhases = [{ durationMonths: 120, amountReal: 0, currency: 'CLP' }];

  const nominal = cloneParams(base);
  nominal.cashflowEvents = [
    {
      id: 'cf-nominal',
      description: 'aporte nominal',
      month: 120,
      type: 'inflow',
      amount: 10_000_000,
      currency: 'CLP',
      amountType: 'nominal',
    },
  ];

  const real = cloneParams(base);
  real.cashflowEvents = [
    {
      id: 'cf-real',
      description: 'aporte real',
      month: 120,
      type: 'inflow',
      amount: 10_000_000,
      currency: 'CLP',
      amountType: 'real',
    },
  ];

  const nominalResult = runSimulationCore(nominal);
  const realResult = runSimulationCore(real);
  assert.ok(
    (realResult.p50TerminalAllPaths ?? 0) > (nominalResult.p50TerminalAllPaths ?? 0),
    'CLP real cashflow should be larger in nominal future terms than CLP nominal',
  );
});

test('legacy CLP cashflow without amountType defaults to real behavior', () => {
  const base = makeBaseParams();
  base.capitalInitial = 0;
  base.feeAnnual = 0;
  base.simulation.horizonMonths = 84;
  base.simulation.nSim = 1;
  base.weights = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  base.returns = {
    ...base.returns,
    rvGlobalAnnual: 0,
    rfGlobalAnnual: 0,
    rvChileAnnual: 0,
    rfChileUFAnnual: 0,
    rvGlobalVolAnnual: 0,
    rfGlobalVolAnnual: 0,
    rvChileVolAnnual: 0,
    rfChileVolAnnual: 0,
    correlationMatrix: identityMatrix(),
  };
  base.inflation = {
    ...base.inflation,
    ipcChileAnnual: 0.08,
    ipcChileVolAnnual: 0,
    hipcEurAnnual: 0,
    hipcEurVolAnnual: 0,
  };
  base.spendingPhases = [{ durationMonths: 84, amountReal: 0, currency: 'CLP' }];

  const legacy = cloneParams(base);
  legacy.cashflowEvents = [
    {
      id: 'cf-legacy',
      description: 'aporte legacy',
      month: 84,
      type: 'inflow',
      amount: 8_000_000,
      currency: 'CLP',
    },
  ];

  const explicitReal = cloneParams(base);
  explicitReal.cashflowEvents = [
    {
      id: 'cf-real',
      description: 'aporte real',
      month: 84,
      type: 'inflow',
      amount: 8_000_000,
      currency: 'CLP',
      amountType: 'real',
    },
  ];

  const legacyResult = runSimulationCore(legacy);
  const realResult = runSimulationCore(explicitReal);
  approxEqual(legacyResult.p50TerminalAllPaths ?? 0, realResult.p50TerminalAllPaths ?? 0, 1e-6);
});

test('optimizer decision share 0 keeps current mix outcome', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 12;
  params.weights = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  params.returns = {
    ...params.returns,
    rvGlobalAnnual: 0.24,
    rfGlobalAnnual: 0,
    rvChileAnnual: 0,
    rfChileUFAnnual: 0,
    rvGlobalVolAnnual: 0,
    rfGlobalVolAnnual: 0,
    rvChileVolAnnual: 0,
    rfChileVolAnnual: 0,
    correlationMatrix: identityMatrix(),
  };
  params.inflation = {
    ipcChileAnnual: 0,
    ipcChileVolAnnual: 0,
    hipcEurAnnual: 0,
    hipcEurVolAnnual: 0,
  };
  params.fx = {
    ...params.fx,
    clpUsdInitial: 1,
    usdEurFixed: 1,
    tcrealLT: 1,
    mrHalfLifeYears: 1,
  };
  params.spendingPhases = [
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
  ];
  params.returns = {
    ...params.returns,
    rvGlobalAnnual: 0.12,
    rfGlobalAnnual: 0.00,
    rvChileAnnual: 0.00,
    rfChileUFAnnual: 0.00,
    rvGlobalVolAnnual: 0.00,
    rfGlobalVolAnnual: 0.00,
    rvChileVolAnnual: 0.00,
    rfChileVolAnnual: 0.00,
    correlationMatrix: identityMatrix(),
  };
  params.simulationComposition = {
    ...params.simulationComposition!,
    optimizableInvestmentsCLP: 100,
    nonOptimizable: {
      ...params.simulationComposition!.nonOptimizable,
      banksCLP: 0,
    },
  };
  const candidate = { rvGlobal: 1, rfGlobal: 0, rvChile: 0, rfChile: 0 };

  const currentPoint = evaluateOptimizerPoint(params, params.weights, 1, { decisionShare: 1 });
  const lockedPoint = evaluateOptimizerPoint(params, candidate, 1, { decisionShare: 0 });
  approxEqual(lockedPoint.probRuin, currentPoint.probRuin);
  approxEqual(lockedPoint.terminalP50, currentPoint.terminalP50);
});

test('optimizer decision share 1 applies candidate mix impact', () => {
  const params = makeBaseParams();
  params.simulation.horizonMonths = 12;
  params.weights = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  params.returns = {
    ...params.returns,
    rvGlobalAnnual: 0.24,
    rfGlobalAnnual: 0,
    rvChileAnnual: 0,
    rfChileUFAnnual: 0,
    rvGlobalVolAnnual: 0,
    rfGlobalVolAnnual: 0,
    rvChileVolAnnual: 0,
    rfChileVolAnnual: 0,
    correlationMatrix: identityMatrix(),
  };
  params.inflation = {
    ipcChileAnnual: 0,
    ipcChileVolAnnual: 0,
    hipcEurAnnual: 0,
    hipcEurVolAnnual: 0,
  };
  params.fx = {
    ...params.fx,
    clpUsdInitial: 1,
    usdEurFixed: 1,
    tcrealLT: 1,
    mrHalfLifeYears: 1,
  };
  params.spendingPhases = [
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
    { durationMonths: 12, amountReal: 1, currency: 'CLP' },
  ];
  params.simulationComposition = {
    ...params.simulationComposition!,
    optimizableInvestmentsCLP: 100,
    nonOptimizable: {
      ...params.simulationComposition!.nonOptimizable,
      banksCLP: 0,
    },
  };
  const candidate = { rvGlobal: 1, rfGlobal: 0, rvChile: 0, rfChile: 0 };

  const currentPoint = evaluateOptimizerPoint(params, params.weights, 1, { decisionShare: 1 });
  const fullDecisionPoint = evaluateOptimizerPoint(params, candidate, 1, { decisionShare: 1 });
  assert.ok(Number.isFinite(currentPoint.terminalP50));
  assert.ok(Number.isFinite(fullDecisionPoint.terminalP50));
  assert.ok(Number.isFinite(currentPoint.probRuin));
  assert.ok(Number.isFinite(fullDecisionPoint.probRuin));
});

test('instrument proposal keeps currency and prefers same manager', () => {
  const instruments: InstrumentBaseItem[] = [
    {
      id: 'a-rvclp',
      name: 'RV Chile',
      manager: 'Admin A',
      currency: 'CLP',
      currentAmountCLP: 100,
      exposure: { rv: 1, rf: 0, global: 0, local: 1 },
    },
    {
      id: 'a-rfclp',
      name: 'RF Chile',
      manager: 'Admin A',
      currency: 'CLP',
      currentAmountCLP: 100,
      exposure: { rv: 0, rf: 1, global: 0, local: 1 },
    },
    {
      id: 'b-rvg',
      name: 'RV Global',
      manager: 'Admin B',
      currency: 'CLP',
      currentAmountCLP: 50,
      exposure: { rv: 1, rf: 0, global: 1, local: 0 },
    },
    {
      id: 'b-rfg',
      name: 'RF Global',
      manager: 'Admin B',
      currency: 'CLP',
      currentAmountCLP: 50,
      exposure: { rv: 0, rf: 1, global: 1, local: 0 },
    },
    {
      id: 'usd-rvg',
      name: 'USD RV Global',
      manager: 'Admin USD',
      currency: 'USD',
      currentAmountCLP: 80,
      exposure: { rv: 1, rf: 0, global: 1, local: 0 },
    },
  ];

  const target = { rvGlobal: 0.6, rfGlobal: 0.2, rvChile: 0.1, rfChile: 0.1 };
  const proposal = buildRealisticInstrumentProposal(instruments, target, { minMoveClp: 1 });
  assert.ok(proposal, 'proposal should be produced');
  if (!proposal) return;

  const hasUnknownCurrency = proposal.moves.some((move) => !move.currency);
  assert.equal(hasUnknownCurrency, false);
  const usdMoves = proposal.moves.filter((move) => move.currency === 'USD');
  assert.equal(usdMoves.length, 0, 'USD bucket should not mix with CLP bucket');
  const hasCrossCurrencyMove = proposal.moves.some((move) => (move.fromCurrency || move.currency) !== (move.toCurrency || move.currency));
  assert.equal(hasCrossCurrencyMove, false, 'proposal must not include cross-currency executable moves');
  const crossManagerMoves = proposal.moves.filter((move) => move.reason.includes('Entre administradoras'));
  assert.equal(crossManagerMoves.length, 0, 'should stay within manager when possible');
});

test('instrument proposal flags new destination when sleeve is missing', () => {
  const instruments: InstrumentBaseItem[] = [
    {
      id: 'only-rv-usd',
      name: 'Only RV USD',
      manager: 'Admin A',
      currency: 'USD',
      currentAmountCLP: 100,
      exposure: { rv: 1, rf: 0, global: 1, local: 0 },
    },
  ];
  const target = { rvGlobal: 0.2, rfGlobal: 0.8, rvChile: 0, rfChile: 0 };
  const proposal = buildRealisticInstrumentProposal(instruments, target, { minMoveClp: 1 });
  assert.ok(proposal, 'proposal should exist');
  if (!proposal) return;
  assert.ok(proposal.gaps.length > 0, 'proposal should surface gaps when sleeve is missing');
  assert.equal(proposal.requiresNewInstruments, true, 'proposal should require a new destination instrument when missing sleeve');
});

test('instrument base currency resolves moneda_origen for USD instruments', () => {
  const payload = JSON.stringify({
    instrumentos: [
      {
        administradora: 'SURA',
        instrumento: 'SURA Multiactivo Agresivo (Seguro + APVs)',
        moneda_origen: 'CLP',
        monto_clp_eq: 1000000,
        porcentaje_rv: 70,
        porcentaje_rf: 30,
        porcentaje_global: 60,
        porcentaje_local: 40,
      },
      {
        administradora: 'Offshore',
        instrumento: 'BGF US Dollar Short Duration (Offshore)',
        moneda_origen: 'USD',
        monto_clp_eq: 1000000,
        porcentaje_rv: 0,
        porcentaje_rf: 100,
        porcentaje_global: 100,
        porcentaje_local: 0,
      },
    ],
  });
  const validated = validateInstrumentBaseJson(payload, null);
  assert.equal(validated.ok, true, 'instrument base payload should be valid');
  if (!validated.snapshot) return;
  const sura = validated.snapshot.instruments.find((item) => item.name.includes('SURA Multiactivo Agresivo'));
  const bgf = validated.snapshot.instruments.find((item) => item.name.includes('BGF US Dollar Short Duration'));
  assert.equal(sura?.currency, 'CLP');
  assert.equal(bgf?.currency, 'USD');
});

test('instrument universe v1 computes current mix and reachable RV band separately', () => {
  const payload = JSON.stringify({
    instrument_master: [
      {
        instrument_id: 'fund-a',
        name: 'Fund A',
        vehicle_type: 'fund',
        currency: 'CLP',
        tax_wrapper: 'general',
        is_captive: false,
        is_sellable: true,
      },
      {
        instrument_id: 'fund-b',
        name: 'Fund B',
        vehicle_type: 'fund',
        currency: 'USD',
        tax_wrapper: 'general',
        is_captive: false,
        is_sellable: true,
      },
    ],
    instrument_mix_profile: [
      {
        instrument_id: 'fund-a',
        current_mix_used: { rv: 0.6, rf: 0.4, cash: 0, other: 0 },
        historical_used_range: { rv: { min: 0.4, max: 0.7 }, rf: { min: 0.3, max: 0.6 } },
        legal_range: {},
        observed_window_months: 24,
        observed_from: '2024-01',
        observed_to: '2025-12',
        estimation_method: 'reported',
        confidence_score: 0.9,
        source_preference: 'reported',
      },
      {
        instrument_id: 'fund-b',
        current_mix_used: { rv: 0.8, rf: 0.2, cash: 0, other: 0 },
        historical_used_range: { rv: { min: 0.5, max: 0.9 }, rf: { min: 0.1, max: 0.5 } },
        legal_range: {},
        observed_window_months: 24,
        observed_from: '2024-01',
        observed_to: '2025-12',
        estimation_method: 'estimated',
        confidence_score: 0.7,
        source_preference: 'estimated',
      },
    ],
    portfolio_position: [
      {
        instrument_id: 'fund-a',
        amount_clp: 40,
        weight_portfolio: 0.4,
        role: 'core',
        structural_mix_driver: 'rv_rf',
        estimated_mix_impact_points: 24,
        replaceability_score: 0.8,
        replacement_constraint: 'none',
      },
      {
        instrument_id: 'fund-b',
        amount_clp: 60,
        weight_portfolio: 0.6,
        role: 'core',
        structural_mix_driver: 'rv_rf',
        estimated_mix_impact_points: 48,
        replaceability_score: 0.6,
        replacement_constraint: 'same_currency',
      },
    ],
    optimizer_metadata: {},
    portfolio_summary: {},
    methodology: {},
  });

  const validation = validateInstrumentUniverseJson(payload, {
    rvGlobal: 0.75,
    rvChile: 0,
    rfGlobal: 0.25,
    rfChile: 0,
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.snapshot?.instruments.length, 2);
  assert.equal(validation.summary?.structuralChangeRequired, false);
  approxEqual(validation.summary?.currentMix?.rv ?? 0, 0.72);
  approxEqual(validation.summary?.historicalUsedRange?.rv.min ?? 0, 0.46);
  approxEqual(validation.summary?.historicalUsedRange?.rv.max ?? 0, 0.82);
});

test('instrument proposal picks best multi-factor destination within manager and currency', () => {
  const instruments: InstrumentBaseItem[] = [
    {
      id: 'a-rvg',
      name: 'A RV Global',
      manager: 'SURA',
      currency: 'CLP',
      currentAmountCLP: 100,
      exposure: { rv: 1, rf: 0, global: 1, local: 0 },
    },
    {
      id: 'b-rfg',
      name: 'B RF Global',
      manager: 'SURA',
      currency: 'CLP',
      currentAmountCLP: 10,
      exposure: { rv: 0, rf: 1, global: 1, local: 0 },
    },
    {
      id: 'c-rfch',
      name: 'C RF Chile',
      manager: 'SURA',
      currency: 'CLP',
      currentAmountCLP: 10,
      exposure: { rv: 0, rf: 1, global: 0, local: 1 },
    },
  ];

  const target = { rvGlobal: 0.2, rfGlobal: 0.4, rvChile: 0, rfChile: 0.4 };
  const proposal = buildRealisticInstrumentProposal(instruments, target, { minMoveClp: 1 });
  assert.ok(proposal, 'proposal should exist');
  if (!proposal) return;
  assert.ok(proposal.moves.length > 0, 'proposal should include movements');
  assert.equal(proposal.moves[0]?.toId, 'c-rfch', 'first movement should choose the destination that improves RV/RF and Global/Local jointly');
});

test('m8 adapter maps aurum capital, house, cuts and scenario overrides', () => {
  const params = makeM8ContractParams();
  const aurumSnapshot = {
    version: 2,
    publishedAt: '2026-04-01T00:00:00Z',
    snapshotMonth: '2026-03',
    snapshotLabel: 'marzo 2026',
    currency: 'CLP',
    totalNetWorthCLP: 900_000_000,
    optimizableInvestmentsCLP: 650_000_000,
    nonOptimizable: {
      banksCLP: 80_000_000,
      usdLiquidityCLP: 0,
      nonMortgageDebtCLP: 0,
      realEstate: {
        propertyValueCLP: 300_000_000,
        mortgageDebtOutstandingCLP: 120_000_000,
        monthlyMortgagePaymentCLP: 1_500_000,
        ufSnapshotCLP: 40_000,
        snapshotMonth: '2026-03',
      },
    },
    source: { app: 'aurum', basis: 'latest_confirmed_closure' },
  } as any;

  const capitalResolution = resolveCapital({ params, aurumSnapshot });
  const input = toM8Input(params, capitalResolution, { usd_liquidity: 0.08, clp_cash: 0.02 });

  assert.equal(input.capital_initial_clp, 730_000_000);
  assert.equal(input.capital_source, 'aurum');
  assert.equal(input.capital_source_label, 'Aurum · marzo 2026');
  assert.equal(input.simulation_base_month, '2026-03');
  assert.equal(input.portfolio_mix.usd_liquidity > 0, true);
  assert.equal(input.portfolio_mix.clp_cash > 0, true);
  assert.equal(input.generator_params.distribution, 'student_t');
  assert.equal((input.generator_params as any).degrees_of_freedom, 7);
  assert.equal(input.cuts.cut1_floor, 0.9);
  assert.equal(input.cuts.cut2_floor, 0.8);
  assert.equal(input.cuts.recovery_cut2_to_cut1_months, 4);
  assert.equal(input.cuts.recovery_cut1_to_normal_months, 6);
  assert.equal(input.scenario_overrides?.scenario_id, 'optimistic');
  assert.equal(input.scenario_overrides?.rv_chile_annual, 0.11);
  assert.equal(input.house?.houseValueUf, 7_500);
  assert.equal(input.house?.mortgageBalanceUfNow, 3_000);
  assert.equal(input.house?.monthlyAmortizationUf, 37.5);
  assert.equal(input.future_events?.length ?? 0, 0);
});

test('m8 calibration remaps legacy 4x4 correlation into M8 order', () => {
  const remapped = remapLegacyCorrelationMatrixToM8(M8_CANONICAL_LEGACY_CORRELATION_MATRIX);

  assert.equal(remapped.length, M8_CANONICAL_CORRELATION_MATRIX.length);
  assert.equal(remapped[0]?.[1], M8_CANONICAL_CORRELATION_MATRIX[0][1]);
  assert.equal(remapped[0]?.[2], M8_CANONICAL_CORRELATION_MATRIX[0][2]);
  assert.equal(remapped[0]?.[3], M8_CANONICAL_CORRELATION_MATRIX[0][3]);
  assert.equal(remapped[1]?.[2], M8_CANONICAL_CORRELATION_MATRIX[1][2]);
  assert.equal(remapped[1]?.[3], M8_CANONICAL_CORRELATION_MATRIX[1][3]);
  assert.equal(remapped[2]?.[3], M8_CANONICAL_CORRELATION_MATRIX[2][3]);
});

test('m8 calibration exposes canonical mix and cash sleeve assumptions', () => {
  assert.equal(M8_CANONICAL_PORTFOLIO_MIX.eq_global, 0.438);
  assert.equal(M8_CANONICAL_PORTFOLIO_MIX.eq_chile, 0.146);
  assert.equal(M8_CANONICAL_PORTFOLIO_MIX.fi_global, 0.138);
  assert.equal(M8_CANONICAL_PORTFOLIO_MIX.fi_chile, 0.194);
  assert.equal(M8_CANONICAL_PORTFOLIO_MIX.usd_liquidity, 0.08);
  assert.equal(M8_CANONICAL_PORTFOLIO_MIX.clp_cash, 0.004);
  assert.equal(M8_CANONICAL_CASH_RETURN_ASSUMPTIONS.usd_liquidity_real_annual, 0.018);
  assert.equal(M8_CANONICAL_CASH_RETURN_ASSUMPTIONS.clp_cash_real_annual, 0.0025);
  assert.equal(M8_CANONICAL_CASH_VOLATILITY_ASSUMPTIONS.usd_liquidity_vol_annual, 0.015);
  assert.equal(M8_CANONICAL_CASH_VOLATILITY_ASSUMPTIONS.clp_cash_vol_annual, 0.002);
  assert.equal(M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvGlobalAnnual, 0.069);
  assert.equal(M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfGlobalAnnual, 0.024);
  assert.equal(M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rvChileAnnual, 0.074);
  assert.equal(M8_CANONICAL_LEGACY_RETURN_ASSUMPTIONS.rfChileRealAnnual, 0.019);
});

test('capitalResolver can derive aurum capital from simulationComposition when snapshot is absent', () => {
  const params = makeM8ContractParams();
  const capitalResolution = resolveCapital({ params });

  assert.equal(capitalResolution.capitalInitial, 730_000_000);
  assert.equal(capitalResolution.simulationComposition.optimizableInvestmentsCLP, 650_000_000);
  assert.equal(capitalResolution.simulationComposition.nonOptimizable.banksCLP, 80_000_000);
  assert.equal(capitalResolution.sourceLabel.startsWith('Aurum ·'), true);
});

test('policy routes every simulation channel to M8', () => {
  assert.equal(getMidasEngineFor('primary'), 'm8');
  assert.equal(getMidasEngineFor('favorable'), 'm8');
  assert.equal(getMidasEngineFor('prudent'), 'm8');
});

test('engineCentral delegates to the M8 adapter contract', () => {
  const params = makeM8ContractParams();
  params.simulation = {
    ...params.simulation,
    nSim: 128,
    seed: 987,
  };

  const capitalResolution = resolveCapital({ params });
  const expectedInput = toM8Input(params, capitalResolution);
  const expected = fromM8Output(runM8(expectedInput), params);
  const actual = runSimulationCentral(params);
  const audit = runSimulationCentralAudit(params);

  approxEqual(actual.probRuin, expected.probRuin, 1e-12);
  approxEqual(actual.p50TerminalAllPaths ?? 0, expected.p50TerminalAllPaths ?? 0, 1e-12);
  approxEqual(actual.p50TerminalSurvivors ?? 0, expected.p50TerminalSurvivors ?? 0, 1e-12);
  approxEqual(actual.terminalP25AllPaths ?? 0, expected.terminalP25AllPaths ?? 0, 1e-12);
  approxEqual(actual.terminalP25IfSuccess ?? 0, expected.terminalP25IfSuccess ?? 0, 1e-12);
  approxEqual(actual.maxDrawdownPercentiles[50] ?? 0, expected.maxDrawdownPercentiles[50] ?? 0, 1e-12);
  approxEqual(actual.fanChartData[0]?.p50 ?? 0, expected.fanChartData[0]?.p50 ?? 0, 1e-12);
  assert.equal(audit.probRuin, actual.probRuin);
  assert.equal(audit.successRate, actual.success40);
});

test('m8 runtime reacts to return assumptions visible in product controls', () => {
  const base = makeM8ContractParams();
  base.simulation = {
    ...base.simulation,
    nSim: 512,
    seed: 42,
  };
  base.activeScenario = 'base';

  const highReturn = cloneParams(base);
  highReturn.returns = {
    ...highReturn.returns,
    rvGlobalAnnual: highReturn.returns.rvGlobalAnnual + 0.10,
    rvChileAnnual: highReturn.returns.rvChileAnnual + 0.10,
    rfGlobalAnnual: highReturn.returns.rfGlobalAnnual + 0.03,
    rfChileUFAnnual: highReturn.returns.rfChileUFAnnual + 0.03,
  };

  const baseResult = runSimulationCentral(base);
  const highResult = runSimulationCentral(highReturn);

  assert.ok((highResult.success40 ?? 0) > (baseResult.success40 ?? 0));
  assert.ok((highResult.probRuin40 ?? 1) < (baseResult.probRuin40 ?? 1));
  assert.ok((highResult.p50TerminalAllPaths ?? 0) > (baseResult.p50TerminalAllPaths ?? 0));
});

test('m8 adapter builds two-regime generator params with canonical cash sleeves', () => {
  const params = makeM8ContractParams();
  params.generatorType = 'two_regime';

  const capitalResolution = resolveCapital({
    params,
    aurumSnapshot: {
      version: 2,
      publishedAt: '2026-04-01T00:00:00Z',
      snapshotMonth: '2026-03',
      snapshotLabel: 'marzo 2026',
      currency: 'CLP',
      totalNetWorthCLP: 900_000_000,
      optimizableInvestmentsCLP: 650_000_000,
      nonOptimizable: {
        banksCLP: 80_000_000,
        realEstate: {
          propertyValueCLP: 300_000_000,
          mortgageDebtOutstandingCLP: 120_000_000,
          ufSnapshotCLP: 40_000,
          snapshotMonth: '2026-03',
        },
      },
      source: { app: 'aurum', basis: 'latest_confirmed_closure' },
    } as any,
  });

  const input = toM8Input(params, capitalResolution);
  const generator = input.generator_params as any;

  assert.equal(generator.distribution, 'two_regime');
  assert.equal(generator.transition_matrix.normal.normal, 0.9975);
  assert.equal(generator.transition_matrix.normal.stress, 0.0025);
  assert.equal(generator.transition_matrix.stress.stress, 0.85);
  assert.equal(generator.transition_matrix.stress.normal, 0.15);
  assert.ok(generator.regimes.normal);
  assert.ok(generator.regimes.stress);
  assert.equal(generator.regimes.recovery, undefined);
  assert.equal(generator.sleeves.usd_liquidity.vol_annual, 0.015);
  assert.equal(generator.sleeves.clp_cash.vol_annual, 0.002);
});

test('m8 adapter uses product mix from params.weights while keeping canonical calibration', () => {
  const params = makeM8ContractParams();
  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);

  assert.equal(input.return_assumptions.eq_global_real_annual, 0.069);
  assert.equal(input.return_assumptions.eq_chile_real_annual, 0.074);
  assert.equal(input.return_assumptions.fi_global_real_annual, 0.024);
  assert.equal(input.return_assumptions.fi_chile_real_annual, 0.019);
  assert.equal(input.return_assumptions.usd_liquidity_real_annual, 0.018);
  assert.equal(input.return_assumptions.clp_cash_real_annual, 0.0025);
  assert.equal(input.generator_params.sleeves.eq_global.mean_annual, 0.069);
  assert.equal(input.generator_params.sleeves.eq_global.vol_annual, 0.15);
  assert.equal(input.generator_params.sleeves.eq_chile.vol_annual, 0.19);
  assert.equal(input.generator_params.sleeves.fi_global.vol_annual, 0.045);
  assert.equal(input.generator_params.sleeves.fi_chile.vol_annual, 0.035);
  assert.equal(input.generator_params.sleeves.usd_liquidity.mean_annual, 0.018);
  assert.equal(input.generator_params.sleeves.usd_liquidity.vol_annual, 0.015);
  assert.equal(input.generator_params.sleeves.clp_cash.mean_annual, 0.0025);
  assert.equal(input.generator_params.sleeves.clp_cash.vol_annual, 0.002);
  approxEqual(input.portfolio_mix.eq_global, 0.4781659388646288);
  approxEqual(input.portfolio_mix.eq_chile, 0.1593886462882096);
  approxEqual(input.portfolio_mix.fi_global, 0.15065502183406113);
  approxEqual(input.portfolio_mix.fi_chile, 0.21179039301310045);
  approxEqual(input.portfolio_mix.usd_liquidity, 0);
  approxEqual(input.portfolio_mix.clp_cash, 0);
  assert.deepEqual(input.generator_params.correlation_matrix, M8_CANONICAL_CORRELATION_MATRIX);
});

test('m8 adapter preserves product mix from params.weights when present', () => {
  const params = makeM8ContractParams();
  params.weights = {
    rvGlobal: 0.35935935935935936,
    rfGlobal: 0.11911911911911911,
    rvChile: 0.2642642642642643,
    rfChile: 0.2572572572572573,
  };

  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);

  approxEqual(input.portfolio_mix.eq_global, 0.35935935935935936);
  approxEqual(input.portfolio_mix.eq_chile, 0.2642642642642643);
  approxEqual(input.portfolio_mix.fi_global, 0.11911911911911911);
  approxEqual(input.portfolio_mix.fi_chile, 0.2572572572572573);
  approxEqual(input.portfolio_mix.usd_liquidity, 0);
  approxEqual(input.portfolio_mix.clp_cash, 0);
});

test('m8 adapter maps manual capital without house', () => {
  const params = makeM8ContractParams();
  params.capitalSource = 'manual';
  params.realEstatePolicy = {
    ...params.realEstatePolicy!,
    enabled: false,
  };
  params.manualCapitalInput = {
    financialCapitalCLP: 123_000_000,
  };
  params.simulationComposition = undefined;

  const capitalResolution = resolveCapital({ params });
  const input = toM8Input(params, capitalResolution);

  assert.equal(input.capital_initial_clp, 123_000_000);
  assert.equal(input.capital_source, 'manual');
  assert.equal(input.house, undefined);
});

test('m8 adapter normalizes future inflow and outflow against simulation base month', () => {
  const params = makeM8ContractParams();
  params.futureCapitalEvents = [
    { id: 'f1', type: 'inflow', amount: 10_000_000, currency: 'CLP', effectiveDate: '2026-05', description: 'aporte' },
    { id: 'f2', type: 'outflow', amount: 2_000_000, currency: 'CLP', effectiveDate: '2026-06', description: 'gasto' },
  ];

  const capitalResolution = resolveCapital({
    params,
    aurumSnapshot: {
      version: 2,
      publishedAt: '2026-04-01T00:00:00Z',
      snapshotMonth: '2026-03',
      snapshotLabel: 'marzo 2026',
      currency: 'CLP',
      totalNetWorthCLP: 900_000_000,
      optimizableInvestmentsCLP: 650_000_000,
      nonOptimizable: {
        banksCLP: 80_000_000,
        realEstate: {
          propertyValueCLP: 300_000_000,
          mortgageDebtOutstandingCLP: 120_000_000,
          ufSnapshotCLP: 40_000,
          snapshotMonth: '2026-03',
        },
      },
      source: { app: 'aurum', basis: 'latest_confirmed_closure' },
    } as any,
  });
  const input = toM8Input(params, capitalResolution);

  assert.equal(input.future_events?.[0]?.effective_month, 3);
  assert.equal(input.future_events?.[1]?.effective_month, 4);
});

test('m8 adapter rejects future events without simulation base month', () => {
  const params = makeM8ContractParams();
  params.simulationBaseMonth = undefined;
  params.futureCapitalEvents = [
    { id: 'f1', type: 'inflow', amount: 10_000_000, currency: 'CLP', effectiveDate: '2026-05', description: 'aporte' },
  ];

  const capitalResolution = resolveCapital({
    params,
    aurumSnapshot: {
      version: 2,
      publishedAt: '2026-04-01T00:00:00Z',
      snapshotMonth: '2026-03',
      snapshotLabel: 'marzo 2026',
      currency: 'CLP',
      totalNetWorthCLP: 900_000_000,
      optimizableInvestmentsCLP: 650_000_000,
      nonOptimizable: {
        banksCLP: 80_000_000,
        realEstate: {
          propertyValueCLP: 300_000_000,
          mortgageDebtOutstandingCLP: 120_000_000,
          ufSnapshotCLP: 40_000,
          snapshotMonth: '2026-03',
        },
      },
      source: { app: 'aurum', basis: 'latest_confirmed_closure' },
    } as any,
  });

  assert.throws(
    () => toM8Input(params, capitalResolution),
    /simulationBaseMonth/,
  );
});

test('m8 adapter rejects invalid horizon and missing uf snapshot, while normalizing legacy EUR spend', () => {
  const badHorizon = makeM8ContractParams();
  badHorizon.capitalSource = 'manual';
  badHorizon.manualCapitalInput = { financialCapitalCLP: 650_000_000 };
  badHorizon.realEstatePolicy = { ...badHorizon.realEstatePolicy!, enabled: false };
  badHorizon.simulation.horizonMonths = 25;
  const badCapital = resolveCapital({ params: badHorizon });
  assert.throws(
    () => toM8Input(badHorizon, badCapital),
    /multiplo de 12/,
  );

  const badSpend = makeM8ContractParams();
  badSpend.capitalSource = 'manual';
  badSpend.manualCapitalInput = { financialCapitalCLP: 650_000_000 };
  badSpend.realEstatePolicy = { ...badSpend.realEstatePolicy!, enabled: false };
  badSpend.spendingPhases = [
    { durationMonths: 36, amountReal: 6_000_000, currency: 'EUR' },
    { durationMonths: 204, amountReal: 3_900_000, currency: 'CLP' },
    { durationMonths: 240, amountReal: 4_800_000, currency: 'CLP' },
  ];
  const badSpendCapital = resolveCapital({ params: badSpend });
  const normalizedInput = toM8Input(badSpend, badSpendCapital);
  assert.equal(normalizedInput.phase1MonthlyClp > 6_000_000, true);

  const badHouse = makeM8ContractParams();
  const badHouseCapital = resolveCapital({
    params: badHouse,
    aurumSnapshot: {
      version: 2,
      publishedAt: '2026-04-01T00:00:00Z',
      snapshotMonth: '2026-03',
      snapshotLabel: 'marzo 2026',
      currency: 'CLP',
      totalNetWorthCLP: 900_000_000,
      optimizableInvestmentsCLP: 650_000_000,
      nonOptimizable: {
        banksCLP: 80_000_000,
        realEstate: {
          propertyValueCLP: 300_000_000,
          mortgageDebtOutstandingCLP: 120_000_000,
          snapshotMonth: '2026-03',
        },
      },
      source: { app: 'aurum', basis: 'latest_confirmed_closure' },
    } as any,
  });
  assert.throws(
    () => toM8Input(badHouse, badHouseCapital),
    /ufSnapshotCLP invalido/,
  );
});

test('m8 output maps canonical ruin and controlled placeholders', () => {
  const params = makeM8ContractParams();
  const result = fromM8Output(
    {
      Success40: 0.84,
      ProbRuin20: 0.08,
      ProbRuin40: 0.16,
      RuinYearMedian: 24,
      RuinYearP25: 18,
      RuinYearP75: 31,
      TerminalMedianCLP: 987_000_000,
      TerminalMedianIfSuccessCLP: 1_024_000_000,
      TerminalP25AllPaths: 780_000_000,
      TerminalP25IfSuccess: 800_000_000,
      TerminalP75AllPaths: 1_180_000_000,
      TerminalP75IfSuccess: 1_200_000_000,
      HouseSalePct: 0.25,
      TriggerYearMedian: 12,
      SaleYearMedian: 13,
      SpendFactorTotal: 0.92,
      SpendFactorPhase2: 0.95,
      SpendFactorPhase3: 0.97,
      SpendFactorCutMonths: 11,
      SpendFactorNoCutMonths: 469,
      SpendFactorCut1Months: 9,
      SpendFactorCut2Months: 2,
      CutTimeShare: 0.08,
      terminalWealthAllPaths: [0, 750_000_000, 2_200_000_000, 1_100_000_000],
      maxDrawdownPercentiles: {
        10: 0.12,
        50: 0.24,
      },
      StressTimeShare: 0.12,
      Cut1TimeShare: 0.05,
      Cut2TimeShare: 0.03,
      fanChart: [
        { year: 1, p5: 100, p10: 200, p25: 300, p50: 400, p75: 500, p90: 600, p95: 700 },
        { year: 2, p5: 90, p10: 180, p25: 270, p50: 360, p75: 450, p90: 540, p95: 630 },
      ],
    },
    params,
    1234,
  );

  assert.equal(result.probRuin, 0.16);
  assert.equal(result.success40, 0.84);
  assert.equal(result.probRuin40, 0.16);
  assert.equal(result.probRuin20, 0.08);
  assert.equal(result.spendFactorTotal, 0.92);
  assert.equal(result.houseSalePct, 0.25);
  assert.equal(result.triggerYearMedian, 12);
  assert.equal(result.saleYearMedian, 13);
  assert.equal(result.spendFactorPhase2, 0.95);
  assert.equal(result.spendFactorPhase3, 0.97);
  assert.equal(result.spendFactorCutMonths, 11);
  assert.equal(result.spendFactorNoCutMonths, 469);
  assert.equal(result.spendFactorCut1Months, 9);
  assert.equal(result.spendFactorCut2Months, 2);
  assert.equal(result.cutTimeShare, 0.08);
  assert.equal(result.stressTimeShare, 0.12);
  assert.equal(result.cut1TimeShare, 0.05);
  assert.equal(result.cut2TimeShare, 0.03);
  assert.equal(result.fanChartData.length, 2);
  assert.equal(result.durationMs, 1234);
  assert.equal(result.maxDrawdownPercentiles[10], 0.12);
  assert.equal(result.maxDrawdownPercentiles[50], 0.24);
  assert.equal(result.terminalWealthPercentiles[25], 800_000_000);
  assert.equal(result.terminalWealthPercentiles[50], 1_024_000_000);
  assert.equal(result.terminalWealthPercentiles[75], 1_200_000_000);
  assert.equal(result.terminalP25AllPaths, 780_000_000);
  assert.equal(result.terminalP25IfSuccess, 800_000_000);
  assert.equal(result.terminalP75AllPaths, 1_180_000_000);
  assert.equal(result.terminalP75IfSuccess, 1_200_000_000);
  assert.deepEqual(result.terminalWealthAllPaths, [0, 750_000_000, 2_200_000_000, 1_100_000_000]);
  assert.deepEqual(result.terminalWealthAll, [750_000_000, 1_100_000_000, 2_200_000_000]);
});

test('m8 output requires real max drawdown percentiles for cutover', () => {
  const params = makeM8ContractParams();
  assert.throws(
    () => fromM8Output(
      {
        Success40: 0.84,
        ProbRuin20: 0.08,
        ProbRuin40: 0.16,
        RuinYearMedian: 24,
        RuinYearP25: 18,
        RuinYearP75: 31,
        TerminalMedianCLP: 987_000_000,
        TerminalMedianIfSuccessCLP: 1_024_000_000,
        TerminalP25AllPaths: 780_000_000,
        TerminalP25IfSuccess: 800_000_000,
        TerminalP75AllPaths: 1_180_000_000,
        TerminalP75IfSuccess: 1_200_000_000,
        HouseSalePct: 0.25,
        TriggerYearMedian: 12,
        SaleYearMedian: 13,
        SpendFactorTotal: 0.92,
        SpendFactorPhase2: 0.95,
        SpendFactorPhase3: 0.97,
        SpendFactorCutMonths: 11,
        SpendFactorNoCutMonths: 469,
        SpendFactorCut1Months: 9,
        SpendFactorCut2Months: 2,
        CutTimeShare: 0.08,
        fanChart: [{ year: 1, p5: 100, p10: 200, p25: 300, p50: 400, p75: 500, p90: 600, p95: 700 }],
      } as any,
      params,
      1234,
    ),
    /maxDrawdownPercentiles/,
  );
});

test('m8 runtime smoke runs and returns canonical outputs', () => {
  const input = makeRuntimeInput({
    generator_type: 'gaussian_iid',
    generator_params: runtimeFlatGaussianParams,
  });
  const result = runM8(input);

  assert.equal(result.ReturnGenerator, 'gaussian_iid');
  assert.equal(result.StudentTDF, undefined);
  assert.equal(result.wealthPaths.length, input.years * 12 + 1);
  assert.equal(result.wealthPaths[0].length, input.n_paths);
  assert.equal(result.terminalWealthAllPaths?.length ?? 0, input.n_paths);
  assert.ok(Number.isFinite(result.Success40));
  assert.ok(Number.isFinite(result.ProbRuin40));
  assert.ok(Number.isFinite(result.maxDrawdownPercentiles[50]));
  assert.ok((result.maxDrawdownPercentiles[10] ?? 0) <= (result.maxDrawdownPercentiles[25] ?? 0));
  assert.ok((result.maxDrawdownPercentiles[25] ?? 0) <= (result.maxDrawdownPercentiles[50] ?? 0));
  assert.ok((result.maxDrawdownPercentiles[50] ?? 0) <= (result.maxDrawdownPercentiles[75] ?? 0));
  assert.ok((result.maxDrawdownPercentiles[75] ?? 0) <= (result.maxDrawdownPercentiles[90] ?? 0));
  assert.ok((result.maxDrawdownPercentiles[10] ?? 0) >= 0 && (result.maxDrawdownPercentiles[90] ?? 0) <= 1);
  assert.ok((result.fanChart?.length ?? 0) > 0);
});

test('m8 runtime counts future inflow and outflow totals', () => {
  const input = makeRuntimeInput({
    future_events: [
      { id: 'in-1', type: 'inflow', amount: 5_000_000, currency: 'CLP', effective_month: 2, description: 'aporte' },
      { id: 'out-1', type: 'outflow', amount: 2_000_000, currency: 'CLP', effective_month: 3, description: 'gasto' },
    ],
  });
  const result = runM8(input);

  assert.equal(result.FutureInflowTotalCLP, 5_000_000);
  assert.equal(result.FutureOutflowTotalCLP, 2_000_000);
});

test('m8 runtime with house includes house equity in the starting wealth', () => {
  const input = makeRuntimeInput({
    house: {
      include_house: true,
      houseValueUf: 10_000,
      mortgageBalanceUfNow: 1_000,
      monthlyAmortizationUf: 0,
      ufClpStart: 40_000,
      house_sale_trigger_years_of_spend: 2,
      house_sale_lag_months: 0,
    },
  });
  const result = runM8(input);

  assert.ok(result.wealthPaths[0][0] > input.capital_initial_clp);
  assert.ok(Number.isFinite(result.HouseSalePct));
});

test('m8 runtime exposes student_t df 7 explicitly', () => {
  const input = makeRuntimeInput();
  const result = runM8(input);

  assert.equal(result.ReturnGenerator, 'student_t');
  assert.equal(result.StudentTDF, 7);
});

const failures: string[] = [];
for (const entry of tests) {
  try {
    entry.fn();
    console.log(`ok: ${entry.name}`);
  } catch (error) {
    failures.push(entry.name);
    console.error(`fail: ${entry.name}`);
    console.error(error);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} test(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
