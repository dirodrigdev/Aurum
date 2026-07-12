import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { buildAvailableConversionHorizons, elapsedMonthsBetween } from '../src/services/conversionHorizons';
import {
  buildCanonicalClosureSummary,
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  type WealthCurrency,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../src/services/wealthStorage';

const defaultFx: WealthFxRates = { usdClp: 891, eurClp: 1038, ufClp: 40628 };

const recordsFor = (monthKey: string, scale = 1): WealthRecord[] => [
  {
    id: `clp-${monthKey}`,
    block: 'investment',
    source: 'test',
    label: 'Inversión CLP',
    amount: 100_000_000 * scale,
    currency: 'CLP',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
  {
    id: `usd-${monthKey}`,
    block: 'investment',
    source: 'test',
    label: 'Inversión USD',
    amount: 10_000 * scale,
    currency: 'USD',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
  {
    id: `risk-${monthKey}`,
    block: 'investment',
    source: 'test',
    label: RISK_CAPITAL_LABEL_CLP,
    amount: 5_000_000 * scale,
    currency: 'CLP',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
  {
    id: `property-${monthKey}`,
    block: 'real_estate',
    source: 'test',
    label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
    amount: 10_000 * scale,
    currency: 'UF',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
  {
    id: `mortgage-${monthKey}`,
    block: 'debt',
    source: 'test',
    label: MORTGAGE_DEBT_BALANCE_LABEL,
    amount: 5_000 * scale,
    currency: 'UF',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
];

export const detailedClosureFixture = (
  monthKey: string,
  scale = 1,
  fx: WealthFxRates = defaultFx,
): WealthMonthlyClosure => {
  const records = recordsFor(monthKey, scale);
  return {
    id: `closure-${monthKey}`,
    monthKey,
    closedAt: `${monthKey}-28T23:59:59Z`,
    fxRates: fx,
    records,
    summary: buildCanonicalClosureSummary(records, fx),
  };
};

export const currentDetailedClosureFixtures = () => [
  detailedClosureFixture('2025-12', 0.95),
  detailedClosureFixture('2026-01', 1),
  detailedClosureFixture('2026-02', 1.01),
  detailedClosureFixture('2026-03', 1.02),
  detailedClosureFixture('2026-04', 1.03),
  detailedClosureFixture('2026-05', 1.04),
  detailedClosureFixture('2026-06', 1.05),
].map((closure) => (closure.monthKey === '2025-12' ? { ...closure, records: undefined } : closure));

const build = (
  closures: WealthMonthlyClosure[],
  reportingCurrency: WealthCurrency = 'CLP',
  includeRiskCapitalInTotals = false,
) => buildAvailableConversionHorizons({ closures, reportingCurrency, includeRiskCapitalInTotals });

describe('available conversion horizons', () => {
  it('shows only last month and since complete records with the current lineage', () => {
    const horizons = build(currentDetailedClosureFixtures());

    expect(horizons.map((item) => item.key)).toEqual(['1M', 'SINCE_COMPLETE']);
    expect(horizons[0]).toMatchObject({ initialMonthKey: '2026-05', finalMonthKey: '2026-06', elapsedMonths: 1 });
    expect(horizons[1]).toMatchObject({ initialMonthKey: '2026-01', finalMonthKey: '2026-06', elapsedMonths: 5 });
    expect(elapsedMonthsBetween('2026-01', '2026-06')).toBe(5);
  });

  it('unlocks 6M automatically when July 2026 makes January the exact endpoint', () => {
    const closures = [...currentDetailedClosureFixtures(), detailedClosureFixture('2026-07', 1.06)];
    const horizons = build(closures);

    expect(horizons.find((item) => item.key === '6M')).toMatchObject({
      initialMonthKey: '2026-01',
      finalMonthKey: '2026-07',
      elapsedMonths: 6,
    });
  });

  it('unlocks 12M, 24M and 36M only when their exact endpoints exist', () => {
    const closures = [
      ...currentDetailedClosureFixtures(),
      detailedClosureFixture('2023-07', 0.7),
      detailedClosureFixture('2024-07', 0.8),
      detailedClosureFixture('2025-07', 0.9),
      detailedClosureFixture('2026-07', 1.06),
    ];
    const horizons = build(closures);

    expect(horizons.find((item) => item.key === '12M')?.initialMonthKey).toBe('2025-07');
    expect(horizons.find((item) => item.key === '24M')?.initialMonthKey).toBe('2024-07');
    expect(horizons.find((item) => item.key === '36M')?.initialMonthKey).toBe('2023-07');
  });

  it('does not use summary-only endpoints or intermediate monthly accumulation', () => {
    const original = currentDetailedClosureFixtures();
    const distortedIntermediate = original.map((closure) =>
      closure.monthKey === '2026-03' ? detailedClosureFixture('2026-03', 25) : closure,
    );
    const baseline = build(original).find((item) => item.key === 'SINCE_COMPLETE')?.result;
    const distorted = build(distortedIntermediate).find((item) => item.key === 'SINCE_COMPLETE')?.result;

    expect(build(original).some((item) => item.key === '6M')).toBe(false);
    expect(distorted?.reportedChangeAmount).toBeCloseTo(baseline?.reportedChangeAmount || 0, 8);
    expect(distorted?.conversionEffectAmount).toBeCloseTo(baseline?.conversionEffectAmount || 0, 8);
  });

  it('keeps January as the complete endpoint when a position changes native currency', () => {
    const closures = currentDetailedClosureFixtures();
    const january = closures.find((closure) => closure.monthKey === '2026-01')!;
    const june = closures.find((closure) => closure.monthKey === '2026-06')!;
    const changedCurrency = {
      ...june,
      records: june.records!.map((record) => record.label === 'Inversión USD'
        ? { ...record, currency: 'CLP' as const, amount: 9_500_000 }
        : record),
    };
    changedCurrency.summary = buildCanonicalClosureSummary(changedCurrency.records!, changedCurrency.fxRates!);
    const horizons = build(closures.map((closure) => closure.monthKey === '2026-06' ? changedCurrency : closure));

    expect(horizons.find((item) => item.key === 'SINCE_COMPLETE')).toMatchObject({
      initialMonthKey: january.monthKey,
      finalMonthKey: '2026-06',
      elapsedMonths: 5,
    });
  });

  it('reconciles final versus initial in every currency and both risk universes', () => {
    const closures = currentDetailedClosureFixtures();
    const constantPercentages: number[] = [];

    for (const includeRisk of [false, true]) {
      for (const currency of ['CLP', 'USD', 'EUR', 'UF'] as const) {
        const result = build(closures, currency, includeRisk).find((item) => item.key === 'SINCE_COMPLETE')?.result;
        expect(result?.status).toBe('available');
        expect(result?.reportedChangeAmount).toBeCloseTo(
          (result?.constantConversionChangeAmount || 0) + (result?.conversionEffectAmount || 0),
          8,
        );
        if (!includeRisk && result) constantPercentages.push(result.constantConversionChangePct);
      }
    }

    constantPercentages.forEach((value) => expect(value).toBeCloseTo(constantPercentages[0], 12));
  });

  it('produces zero conversion effect when May and June use identical rates', () => {
    for (const currency of ['CLP', 'USD', 'EUR', 'UF'] as const) {
      const result = build(currentDetailedClosureFixtures(), currency).find((item) => item.key === '1M')?.result;
      expect(result?.conversionEffectAmount).toBeCloseTo(0, 8);
      expect(result?.conversionEffectPctPoints).toBeCloseTo(0, 12);
      expect(result?.reportedChangeAmount).toBeCloseTo(result?.constantConversionChangeAmount || 0, 8);
    }
  });

  it('uses the latest confirmed closure and ignores a newer unconfirmed entry', () => {
    const unconfirmed = { ...detailedClosureFixture('2026-07', 1.06), closedAt: '' };
    const horizons = build([...currentDetailedClosureFixtures(), unconfirmed]);
    expect(horizons.every((item) => item.finalMonthKey === '2026-06')).toBe(true);
  });
});
