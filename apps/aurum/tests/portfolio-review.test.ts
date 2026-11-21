import { describe, expect, it, vi } from 'vitest';
import { buildAnnualComparisonPeriod, buildWealthAvailability, buildWealthChangeBridge } from '../src/services/portfolioReview';
import { computeMonthlyRows, enumerateMonthKeys } from '../src/services/returnsAnalysis';
import {
  buildCanonicalClosureSummary,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../src/services/wealthStorage';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

const fx: WealthFxRates = { usdClp: 900, eurClp: 1000, ufClp: 40000 };

const record = (block: WealthRecord['block'], label: string, amount: number, currency: WealthRecord['currency'] = 'CLP'): WealthRecord => ({
  id: label,
  block,
  label,
  amount,
  currency,
  source: 'Test',
  snapshotDate: '2026-10-31',
  createdAt: '2026-10-31T12:00:00Z',
});

const closure = (monthKey: string, records: WealthRecord[], rates = fx): WealthMonthlyClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T12:00:00Z`,
  fxRates: rates,
  records,
  summary: buildCanonicalClosureSummary(records, rates),
  gastappExpenseClose: {
    totalEur: 1_000,
    byFamilyEur: { dayToDay: 1_000, trips: 0, others: 0 },
  } as NonNullable<WealthMonthlyClosure['gastappExpenseClose']>,
});

describe('vistas de análisis patrimonial', () => {
  it('compares fixed calendar years without filling gaps with earlier months or estimates', () => {
    const history = enumerateMonthKeys('2024-10', '2026-10').map((month, index) =>
      closure(month, [record('investment', 'BTG total valorización', 100_000_000 + index * 2_000_000)]));
    const rows = computeMonthlyRows(history, false, 'EUR');
    const current = buildAnnualComparisonPeriod(rows, '2026-10');
    expect(current).toMatchObject({
      startMonth: '2025-11', economicReturn: 36_000, spend: 12_000, spendMonths: 12, wealthChange: 24_000, monthlySpendEur: 1_000,
    });
    expect(buildAnnualComparisonPeriod(rows, '2025-10').wealthChangePct).toBe(24);
    expect(current.economicReturnPct).toBeGreaterThan(0);

    const estimates = rows.map((row) => row.monthKey === '2026-01' ? { ...row, isEstimated: true } : row);
    expect(buildAnnualComparisonPeriod(estimates, '2026-10')).toMatchObject({
      spendMonths: 11, spend: null, economicReturn: null, wealthChange: 24_000,
    });
  });

  it('separates USD and UF effects from balance changes and reconciles with the closing net', () => {
    const assets = [
      record('investment', 'Global66 Cuenta Vista USD', 10_000, 'USD'),
      record('real_estate', 'Valor propiedad', 1000, 'UF'),
      record('debt', 'Saldo deuda hipotecaria', 400, 'UF'),
    ];
    const initial = closure('2026-09', assets);
    const final = closure('2026-10', [...assets, record('investment', 'BTG total valorización', 500_000)], {
      ...fx, usdClp: 1000, ufClp: 41000,
    });
    const bridge = buildWealthChangeBridge(initial, final, 'CLP', false);
    expect(bridge?.total).toBe(2_100_000);
    expect(bridge?.steps).toContainEqual({ label: 'Efecto cambiario', value: 1_600_000 });
    expect(bridge?.steps.reduce((sum, step) => sum + step.value, 0)).toBe(bridge?.total);
    expect(buildWealthChangeBridge({ ...initial, fxMissing: ['usdClp'] }, final, 'EUR', false)).toBeNull();
    expect(buildWealthChangeBridge({ ...initial, records: undefined }, final, 'CLP', false)?.hasFxBreakdown).toBe(false);
  });

  it('does not count pensions, property or other assets as spendable', () => {
    const current = closure('2026-10', [
      record('bank', 'Cuenta corriente', 3_000_000),
      record('debt', 'Deuda tarjetas CLP', 1_000_000),
      record('investment', 'Wise Cuenta principal USD', 1_000, 'USD'),
      record('investment', 'SURA inversión financiera', 10_000_000),
      record('investment', 'PlanVital saldo total', 20_000_000),
      record('investment', 'Tenencia / CxC', 5_000_000),
      record('real_estate', 'Valor propiedad', 35_000_000),
    ]);
    const availability = buildWealthAvailability(current, 'CLP', false, 1_000);
    expect(availability).toMatchObject({ immediate: 2_900_000, net: 72_900_000, monthsFromCash: 2.9, monthsWithRescues: 12.9 });
    expect(availability?.breakdown.reduce((sum, item) => sum + item.value, 0)).toBe(availability?.net);
    expect(buildWealthAvailability(current, 'USD', false, null)?.monthsFromCash).toBeNull();
  });
});
