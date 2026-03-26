import assert from 'node:assert/strict';
import type { ModelParameters } from '../model/types';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import { runSimulationParametric } from './engineParametric';
import { buildMortgageProjection } from './mortgageProjection';
import { runAnnualRebalance } from './blockState';

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
