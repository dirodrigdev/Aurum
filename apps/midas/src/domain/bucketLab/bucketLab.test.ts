import assert from 'node:assert/strict';
import type { InstrumentUniverseInstrument, InstrumentUniverseSnapshot } from '../instrumentUniverse';
import { buildOperationalBucketProfile } from './operationalBucketProfile';
import { runOperationalBucketStress } from './operationalBucketStress';
import { runBucketTradeoffAnalysis } from './bucketTradeoff';
import { buildBucketExpectedCostAnalysis } from './bucketExpectedCostAnalysis';
import { buildBucketDecisionSummary } from './bucketDecisionSummary';

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

test('80/20 balanced is conservative and does not count as clean defense', () => {
  const snapshot = makeSnapshot([
    makeInstrument('bal-80-20', 10_000_000, {
      name: 'Balanceado 80 RF 20 RV',
      currentMixUsed: { rv: 0.2, rf: 0.8, cash: 0, other: 0 },
    }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  assert.equal(profile.instruments[0].layer, 'conservative_balanced');
  assert.equal(profile.cleanDefensiveClp, 0);
  assert.equal(profile.mixedFundClp, 10_000_000);
  assert.equal(profile.embeddedEquityClp, 2_000_000);
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

test('decision summary recommends maintain near target', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 45_400_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({
    profile,
    scenarios: [{ crisisMonths: 60, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0.12 },
      { crisisMonths: 48, probability: 0.08 },
      { crisisMonths: 60, probability: 0.05 },
      { crisisMonths: 72, probability: 0.03 },
      { crisisMonths: 96, probability: 0.02 },
    ],
  });
  const summary = buildBucketDecisionSummary({ profile, stressRows: stress, tradeoffRows: tradeoff, targetBucketMonths: 48, expectedCostAnalysis: expected });
  assert.equal(summary.recommendation, 'maintain');
  assert.ok(summary.gapMonths < 3);
});

test('decision summary recommends consider increase when higher bucket wins by expected cost', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 30_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 40_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({
    profile,
    scenarios: [
      { crisisMonths: 48, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
    ],
  });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [36, 48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [
      { crisisMonths: 48, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
    ],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.9,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0 },
      { crisisMonths: 48, probability: 0.12 },
      { crisisMonths: 60, probability: 0.10 },
      { crisisMonths: 72, probability: 0.08 },
      { crisisMonths: 96, probability: 0.06 },
    ],
  });
  const summary = buildBucketDecisionSummary({ profile, stressRows: stress, tradeoffRows: tradeoff, targetBucketMonths: 48, expectedCostAnalysis: expected });
  assert.equal(summary.recommendation, 'consider_increase');
});

test('decision summary recommends review data with low coverage', () => {
  const snapshot = makeSnapshot([
    makeInstrument('unknown', 10_000_000, { name: 'Sin mix', currentMixUsed: null }),
    makeInstrument('cash', 10_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({ profile, scenarios: [{ crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }] });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0.12 },
      { crisisMonths: 48, probability: 0.08 },
      { crisisMonths: 60, probability: 0.05 },
      { crisisMonths: 72, probability: 0.03 },
      { crisisMonths: 96, probability: 0.02 },
    ],
  });
  const summary = buildBucketDecisionSummary({ profile, stressRows: stress, tradeoffRows: tradeoff, targetBucketMonths: 48, expectedCostAnalysis: expected });
  assert.equal(summary.recommendation, 'review_data');
});

test('decision summary calculates gap and first stress failure', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 24_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 24_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({
    profile,
    scenarios: [
      { crisisMonths: 24, equityDrawdown: -0.2, fixedIncomeShock: 0 },
      { crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
    ],
  });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0.12 },
      { crisisMonths: 48, probability: 0.08 },
      { crisisMonths: 60, probability: 0.05 },
      { crisisMonths: 72, probability: 0.03 },
      { crisisMonths: 96, probability: 0.02 },
    ],
  });
  const summary = buildBucketDecisionSummary({ profile, stressRows: stress, tradeoffRows: tradeoff, targetBucketMonths: 48, expectedCostAnalysis: expected });
  assert.equal(summary.gapMonths, 24);
  assert.equal(summary.gapClp, 24_000_000);
  assert.equal(summary.stressFirstFailureMonths, 48);
});

test('expected cost scenario uses probability * embedded equity sold * penalty pct', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 24_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 24_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [24],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [{ crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0 },
      { crisisMonths: 48, probability: 0.1 },
      { crisisMonths: 60, probability: 0 },
      { crisisMonths: 72, probability: 0 },
      { crisisMonths: 96, probability: 0 },
    ],
  });
  assert.equal(expected.rows.find((row) => row.bucketMonths === 24)?.expectedForcedSaleCostClp, 432_000);
});

test('current bucket cost row is preserved in expected analysis', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 24_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 24_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [24, 48],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [{ crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0 },
      { crisisMonths: 48, probability: 0.1 },
      { crisisMonths: 60, probability: 0 },
      { crisisMonths: 72, probability: 0 },
      { crisisMonths: 96, probability: 0 },
    ],
  });
  assert.equal(expected.currentBucketMonths, 48);
});

test('larger bucket carries positive opportunity cost annual', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 48_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
  });
  const row60 = tradeoff.find((row) => row.bucketMonths === 60)!;
  assert.ok(row60.opportunityCostAnnual > 0);
});

test('smaller bucket carries expected growth benefit annual', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 48_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [36, 48],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
  });
  const row36 = tradeoff.find((row) => row.bucketMonths === 36)!;
  assert.equal(row36.expectedGrowthBenefitAnnual, 600_000);
});

test('probabilities zero make permanent cost dominate', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 48_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [36, 48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [{ crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0 },
      { crisisMonths: 48, probability: 0 },
      { crisisMonths: 60, probability: 0 },
      { crisisMonths: 72, probability: 0 },
      { crisisMonths: 96, probability: 0 },
    ],
  });
  assert.equal(expected.bestBucketMonths, 36);
});

test('high penalty can make higher bucket preferable', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 24_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 48_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [24, 48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [
      { crisisMonths: 36, equityDrawdown: -0.35, fixedIncomeShock: -0.05 },
      { crisisMonths: 48, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
    ],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.9,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0.12 },
      { crisisMonths: 48, probability: 0.10 },
      { crisisMonths: 60, probability: 0.08 },
      { crisisMonths: 72, probability: 0.06 },
      { crisisMonths: 96, probability: 0.05 },
    ],
  });
  assert.ok(expected.bestBucketMonths >= 48);
});

test('break-even probability is calculated for higher bucket', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 24_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
    makeInstrument('balanced', 48_000_000, { name: 'Balanceado 60/40', currentMixUsed: { rv: 0.6, rf: 0.4, cash: 0, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [
      { crisisMonths: 60, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 72, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
      { crisisMonths: 96, equityDrawdown: -0.5, fixedIncomeShock: -0.1 },
    ],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0 },
      { crisisMonths: 48, probability: 0 },
      { crisisMonths: 60, probability: 0.05 },
      { crisisMonths: 72, probability: 0.03 },
      { crisisMonths: 96, probability: 0.02 },
    ],
  });
  const higher = expected.rows.find((row) => row.bucketMonths === 60)!;
  assert.ok(higher.breakEvenProbability !== null);
});

test('decision summary uses expected cost analysis to recommend', () => {
  const snapshot = makeSnapshot([
    makeInstrument('cash', 48_000_000, { name: 'Banco CLP', currentMixUsed: { rv: 0, rf: 0, cash: 1, other: 0 } }),
  ]);
  const profile = buildOperationalBucketProfile({ snapshot, monthlySpendClp: 1_000_000, includeCaptive: false, includeRiskCapital: false });
  const stress = runOperationalBucketStress({ profile, scenarios: [{ crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }] });
  const tradeoff = runBucketTradeoffAnalysis({
    profile,
    candidateMonths: [36, 48, 60],
    currentBucketMonths: 48,
    expectedGrowthReturnAnnual: 0.08,
    expectedDefensiveReturnAnnual: 0.03,
    stressScenarios: [{ crisisMonths: 48, equityDrawdown: -0.35, fixedIncomeShock: -0.05 }],
  });
  const expected = buildBucketExpectedCostAnalysis({
    profile,
    tradeoffRows: tradeoff,
    currentBucketMonths: 48,
    forcedSalePenaltyPct: 0.3,
    crisisScenarioProbabilities: [
      { crisisMonths: 36, probability: 0 },
      { crisisMonths: 48, probability: 0 },
      { crisisMonths: 60, probability: 0 },
      { crisisMonths: 72, probability: 0 },
      { crisisMonths: 96, probability: 0 },
    ],
  });
  const summary = buildBucketDecisionSummary({
    profile,
    stressRows: stress,
    tradeoffRows: tradeoff,
    targetBucketMonths: 48,
    expectedCostAnalysis: expected,
  });
  assert.equal(summary.bestBucketMonths, 36);
  assert.equal(summary.recommendation, 'top_up_to_target');
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

test('uses weight scaling when universe amount mismatches optimizable capital', () => {
  const snapshot = makeSnapshot([
    makeInstrument('a', 70_000_000, {
      name: 'Balanceado A',
      weightPortfolio: 0.5,
      currentMixUsed: { rv: 0.4, rf: 0.6, cash: 0, other: 0 },
    }),
    makeInstrument('b', 30_000_000, {
      name: 'Balanceado B',
      weightPortfolio: 0.5,
      currentMixUsed: { rv: 0.4, rf: 0.6, cash: 0, other: 0 },
    }),
  ]);
  const profile = buildOperationalBucketProfile({
    snapshot,
    monthlySpendClp: 1_000_000,
    includeCaptive: false,
    includeRiskCapital: false,
    optimizableInvestmentsClp: 200_000_000,
  });
  assert.equal(profile.amountSource, 'weight_scaled_optimizable');
  assert.equal(Math.round(profile.mixedFundClp), 200_000_000);
  assert.ok(profile.warnings.some((warning) => warning.includes('difiere del optimizable vigente')));
});

test('keeps direct amount when universe amount reasonably matches optimizable capital', () => {
  const snapshot = makeSnapshot([
    makeInstrument('a', 101_000_000, {
      name: 'Balanceado A',
      weightPortfolio: 0.5,
      currentMixUsed: { rv: 0.4, rf: 0.6, cash: 0, other: 0 },
    }),
    makeInstrument('b', 99_000_000, {
      name: 'Balanceado B',
      weightPortfolio: 0.5,
      currentMixUsed: { rv: 0.4, rf: 0.6, cash: 0, other: 0 },
    }),
  ]);
  const profile = buildOperationalBucketProfile({
    snapshot,
    monthlySpendClp: 1_000_000,
    includeCaptive: false,
    includeRiskCapital: false,
    optimizableInvestmentsClp: 200_000_000,
  });
  assert.equal(profile.amountSource, 'instrument_amount_clp');
  assert.equal(Math.round(profile.mixedFundClp), 200_000_000);
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
