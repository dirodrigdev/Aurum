import assert from 'node:assert/strict';
import type { InstrumentUniverseInstrument, InstrumentUniverseSnapshot } from '../instrumentUniverse';
import { buildOperationalBucketProfile } from './operationalBucketProfile';
import { runOperationalBucketStress } from './operationalBucketStress';
import { runBucketTradeoffAnalysis } from './bucketTradeoff';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
const test = (name: string, fn: TestFn) => tests.push({ name, fn });

const makeInstrument = (
  id: string,
  amountClp: number,
  overrides: Partial<InstrumentUniverseInstrument> = {},
): InstrumentUniverseInstrument => ({
  instrumentId: id,
  name: id,
  vehicleType: 'fund',
  currency: 'CLP',
  taxWrapper: null,
  isCaptive: false,
  isSellable: true,
  currentMixUsed: { rv: 0, rf: 1, cash: 0, other: 0 },
  legalRange: null,
  legalRangeMix: null,
  historicalUsedRange: null,
  optimizerSafeRange: null,
  operationalRange: null,
  observedWindowMonths: null,
  observedFrom: null,
  observedTo: null,
  estimationMethod: null,
  confidenceScore: null,
  sourcePreference: null,
  exposureUsed: null,
  amountClp,
  amountNative: amountClp,
  amountNativeCurrency: 'CLP',
  fxToClpUsed: 1,
  weightPortfolio: null,
  role: 'core',
  structuralMixDriver: null,
  estimatedMixImpactPoints: null,
  replaceabilityScore: null,
  replacementConstraint: null,
  sameCurrencyCandidates: [],
  sameManagerCandidates: [],
  sameTaxWrapperCandidates: [],
  decisionEligible: true,
  missingCriticalFields: [],
  warnings: [],
  usable: true,
  ...overrides,
});

const makeSnapshot = (instruments: InstrumentUniverseInstrument[]): InstrumentUniverseSnapshot => ({
  version: 1,
  savedAt: '2026-05-02T00:00:00.000Z',
  rawJson: '{}',
  instruments,
  optimizerMetadata: null,
  portfolioSummary: null,
  methodology: null,
});

test('classifies bank liquidity as hard_cash', () => {
  const snapshot = makeSnapshot([
    makeInstrument('bank-1', 10_000_000, { name: 'Banco de Chile cuenta corriente', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.hardCashClp, 10_000_000);
});

test('classifies money market as near_cash', () => {
  const snapshot = makeSnapshot([
    makeInstrument('mm-1', 8_000_000, { name: 'Money Market CLP', currentMixUsed: { rv: 0, rf: 0.9, cash: 0.1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.nearCashClp, 8_000_000);
});

test('classifies pure fixed-income correctly', () => {
  const snapshot = makeSnapshot([
    makeInstrument('rf-1', 9_000_000, { name: 'Renta local UF', currentMixUsed: { rv: 0.01, rf: 0.95, cash: 0.04, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.pureFixedIncomeClp, 9_000_000);
});

test('balanced 60/40 computes embedded equity and FI', () => {
  const snapshot = makeSnapshot([
    makeInstrument('bal-60-40', 10_000_000, { name: 'Balanceado Activo', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.mixedFundClp, 10_000_000);
  assert.equal(profile.embeddedEquityClp, 6_000_000);
  assert.equal(profile.embeddedFixedIncomeClp, 4_000_000);
});

test('conservative balanced has lower embedded equity than moderate', () => {
  const snapshot = makeSnapshot([
    makeInstrument('bal-cons', 10_000_000, { name: 'Balanceado Conservador', currentMixUsed: { rv: 0.15, rf: 0.8, cash: 0.05, other: 0 } }),
    makeInstrument('bal-mod', 10_000_000, { name: 'Balanceado Moderado', currentMixUsed: { rv: 0.35, rf: 0.6, cash: 0.05, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const consEq = profile.instruments.find((item) => item.instrumentId === 'bal-cons')?.embeddedEquityClp ?? 0;
  const modEq = profile.instruments.find((item) => item.instrumentId === 'bal-mod')?.embeddedEquityClp ?? 0;
  assert.ok(consEq < modEq);
});

test('missing mix lands in unknown layer', () => {
  const snapshot = makeSnapshot([
    makeInstrument('unknown-1', 7_000_000, { currentMixUsed: null }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.unknownClp, 7_000_000);
});

test('clean defensive runway excludes embedded RF from mixed funds', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 12_000_000, { name: 'Caja CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 12_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 3_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.cleanDefensiveRunwayMonths, 4);
  assert.equal(profile.mixedFundRunwayMonths, 4);
});

test('stress uses clean defense before selling balanced funds', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 24_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 36_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 3_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({
    profile,
    scenarios: [{ crisisMonths: 16, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  assert.equal(stress[0].cleanDefensiveEnough, false);
  assert.equal(stress[0].cleanDefensiveExhaustedMonth, 8);
  assert.equal(stress[0].balancedSoldClp, 24_000_000);
});

test('stress computes embedded equity sold', () => {
  const snapshot = makeSnapshot([
    makeInstrument('balanced', 20_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 2_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({
    profile,
    scenarios: [{ crisisMonths: 12, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  assert.equal(stress[0].embeddedEquitySoldClp, 12_000_000);
});

test('tradeoff computes annual opportunity cost', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 36_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 3_000_000, includeCaptive: false, includeRiskCapital: false });
  const rows = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [24, 48],
    currentBucketMonths: 24,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].extraDefensiveCapitalClp, 72_000_000);
  assert.equal(rows[1].opportunityCostAnnual, 3_600_000);
});

test('helpers do not mutate snapshot inputs', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 10_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 10_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const original = JSON.stringify(snapshot);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  runOperationalBucketStress({ profile });
  runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [24, 36, 48],
    currentBucketMonths: 24,
    expectedGrowthReturnAnnual: 0.07,
    expectedDefensiveReturnAnnual: 0.03,
  });
  assert.equal(JSON.stringify(snapshot), original);
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
