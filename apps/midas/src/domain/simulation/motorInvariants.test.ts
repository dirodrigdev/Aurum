import assert from 'node:assert/strict';
import type { ModelParameters } from '../model/types';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { InstrumentBaseSnapshot } from '../instrumentBase';
import {
  applyActiveDistributionToParams,
  applyOfficialDistributionToParams,
  deriveOfficialDistributionWeights,
  resolveOfficialDistributionState,
  shouldEnterSimulationWeightsMode,
} from '../model/officialDistribution';
import { runSimulationParametric } from './engineParametric';
import { runSimulationCore } from './engine';
import { buildMortgageProjection } from './mortgageProjection';
import { runAnnualRebalance } from './blockState';
import { updateSpendingMultiplier } from './spendingMultiplier';
import { evaluateConcordance } from './concordance';
import { snapshotToParams } from '../../integrations/aurum/adapters';

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

test('bootstrap block mode includes all-paths terminal and applies non-mortgage debt adjustment', () => {
  const params = makeBaseParams();
  params.simulation = {
    ...params.simulation,
    nSim: 1,
    horizonMonths: 1,
    seed: 321,
    useHistoricalData: false,
  };
  params.spendingPhases = [{ durationMonths: 12, amountReal: 0, currency: 'CLP' }];
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
  const expected = Math.max(0, 100 - (0.7 * 100));
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
        currentAmountCLP: 100,
        exposure: { rv: 1, rf: 0, global: 1, local: 0 },
      },
      {
        id: 'local-rf',
        name: 'Local RF',
        manager: 'Test',
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
