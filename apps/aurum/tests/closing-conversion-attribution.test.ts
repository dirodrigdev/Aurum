import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { buildClosureConversionAttribution } from '../src/pages/ClosingAurum';
import { buildCanonicalClosureSummary, type WealthCurrency, type WealthFxRates, type WealthMonthlyClosure, type WealthRecord } from '../src/services/wealthStorage';

const fxByMonth: Record<string, WealthFxRates> = {
  '2026-03': { usdClp: 890, eurClp: 980, ufClp: 39_000 },
  '2026-04': { usdClp: 900, eurClp: 990, ufClp: 39_500 },
  '2026-05': { usdClp: 920, eurClp: 1_010, ufClp: 40_000 },
  '2026-06': { usdClp: 950, eurClp: 1_040, ufClp: 40_500 },
};

const recordsFor = (monthKey: string, usdAmount: number): WealthRecord[] => [
  {
    id: `clp-${monthKey}`,
    block: 'investment',
    source: 'test',
    label: 'Fondo CLP',
    amount: 100_000_000 + Number(monthKey.slice(-2)) * 100_000,
    currency: 'CLP',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
  {
    id: `usd-${monthKey}`,
    block: 'investment',
    source: 'test',
    label: 'Fondo USD',
    amount: usdAmount,
    currency: 'USD',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00Z`,
  },
];

const detailedClosure = (monthKey: string, usdAmount: number): WealthMonthlyClosure => {
  const records = recordsFor(monthKey, usdAmount);
  return {
    id: `closure-${monthKey}`,
    monthKey,
    closedAt: `${monthKey}-28T23:59:59Z`,
    fxRates: fxByMonth[monthKey],
    records,
    summary: buildCanonicalClosureSummary(records, fxByMonth[monthKey]),
  };
};

const closures = [
  detailedClosure('2026-03', 10_000),
  detailedClosure('2026-04', 10_200),
  detailedClosure('2026-05', 10_100),
  detailedClosure('2026-06', 10_400),
];

const attributionFor = (currentMonthKey: string, currency: WealthCurrency = 'CLP') => {
  const index = closures.findIndex((closure) => closure.monthKey === currentMonthKey);
  return buildClosureConversionAttribution({
    selectedClosure: closures[index] || null,
    previousClosure: index > 0 ? closures[index - 1] : null,
    currency,
    includeRiskCapitalInTotals: false,
  });
};

describe('closure conversion attribution', () => {
  it('compares each selected closure with the immediately previous closure', () => {
    expect(attributionFor('2026-06')?.previousMonthKey).toBe('2026-05');
    expect(attributionFor('2026-05')?.previousMonthKey).toBe('2026-04');
    expect(attributionFor('2026-04')?.previousMonthKey).toBe('2026-03');
  });

  it('reconciles the selected closure variation and is available in CLP, USD, EUR and UF', () => {
    (['CLP', 'USD', 'EUR', 'UF'] as const).forEach((currency) => {
      const result = attributionFor('2026-06', currency);
      expect(result?.status).toBe('available');
      expect(result?.reportedChangeAmount).toBeCloseTo(
        (result?.constantConversionChangeAmount || 0) + (result?.conversionEffectAmount || 0),
        8,
      );
    });
  });

  it('does not calculate when a closure is summary-only, has missing FX, or skips the immediate month', () => {
    const current = detailedClosure('2026-06', 10_400);
    const summaryOnly: WealthMonthlyClosure = { ...detailedClosure('2026-05', 10_100), records: [] };
    const missingFx: WealthMonthlyClosure = { ...detailedClosure('2026-05', 10_100), fxRates: undefined };
    const march = detailedClosure('2026-03', 10_000);

    expect(buildClosureConversionAttribution({ selectedClosure: current, previousClosure: summaryOnly, currency: 'CLP', includeRiskCapitalInTotals: false })).toBeNull();
    expect(buildClosureConversionAttribution({ selectedClosure: current, previousClosure: missingFx, currency: 'CLP', includeRiskCapitalInTotals: false })).toBeNull();
    expect(buildClosureConversionAttribution({ selectedClosure: current, previousClosure: march, currency: 'CLP', includeRiskCapitalInTotals: false })).toBeNull();
  });
});
