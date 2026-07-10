import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { calculateMonthlyConversionAttribution } from '../src/services/monthlyConversionAttribution';
import {
  DEBT_CARD_USD_LABEL,
  type WealthCurrency,
  type WealthFxRates,
  type WealthRecord,
} from '../src/services/wealthStorage';

const previousFx: WealthFxRates = { usdClp: 900, eurClp: 1000, ufClp: 40_000 };
const currentFx: WealthFxRates = { usdClp: 990, eurClp: 1050, ufClp: 41_000 };

const record = (
  id: string,
  amount: number,
  currency: WealthCurrency,
  monthKey: string,
  options: Partial<Pick<WealthRecord, 'block' | 'label'>> = {},
): WealthRecord => ({
  id,
  block: options.block || 'investment',
  source: 'test',
  label: options.label || id,
  amount,
  currency,
  snapshotDate: `${monthKey}-30`,
  createdAt: `${monthKey}-30T12:00:00Z`,
});

const calculate = (overrides: Partial<Parameters<typeof calculateMonthlyConversionAttribution>[0]> = {}) =>
  calculateMonthlyConversionAttribution({
    reportingCurrency: 'CLP',
    previousMonthKey: '2026-05',
    currentMonthKey: '2026-06',
    previousRecords: [record('usd-fund', 100_000, 'USD', '2026-05')],
    currentRecords: [record('usd-fund', 102_000, 'USD', '2026-06')],
    previousFx,
    currentFx,
    includeRiskCapitalInTotals: true,
    ...overrides,
  });

describe('monthly conversion attribution', () => {
  it('reconciles reported variation with constant-rate variation and conversion effect', () => {
    const result = calculate();
    expect(result.status).toBe('available');
    expect(result.reportedChangeAmount).toBeCloseTo(
      result.constantConversionChangeAmount + result.conversionEffectAmount,
      8,
    );
    expect(result.reportedChangeAmount).toBe(10_980_000);
    expect(result.constantConversionChangeAmount).toBe(1_800_000);
    expect(result.conversionEffectAmount).toBe(9_180_000);
  });

  it('reconciles reconstructed values with the visible UI values', () => {
    const result = calculate({
      expectedPreviousReportedValue: 90_000_000,
      expectedCurrentReportedValue: 100_980_000,
    });
    expect(result.status).toBe('available');
    expect(result.previousReportedValue).toBe(90_000_000);
    expect(result.currentReportedValue).toBe(100_980_000);
    expect(result.reportedChangeAmount).toBe(10_980_000);
  });

  it('explains a positive constant variation and a negative reported USD variation', () => {
    const result = calculate({ reportingCurrency: 'USD' });
    expect(result.status).toBe('available');
    expect(result.constantConversionChangePct).toBeGreaterThan(0);
    expect(result.reportedChangePct).toBeCloseTo(0.02, 8);

    const clpOnly = calculate({
      reportingCurrency: 'USD',
      previousRecords: [record('clp-fund', 90_000_000, 'CLP', '2026-05')],
      currentRecords: [record('clp-fund', 91_800_000, 'CLP', '2026-06')],
    });
    expect(clpOnly.constantConversionChangePct).toBeCloseTo(0.02, 8);
    expect(clpOnly.reportedChangePct).toBeLessThan(0);
  });

  it('attributes a positive CLP conversion effect to positive USD exposure when USD/CLP rises', () => {
    const result = calculate();
    expect(result.conversionEffectAmount).toBeGreaterThan(0);
    expect(result.ratesUsed.map((item) => item.pair)).toEqual(['USD/CLP']);
  });

  it.each([
    ['USD', 'USD'],
    ['EUR', 'EUR'],
    ['UF', 'UF'],
  ] as const)('does not assign conversion effect to a native %s position in %s view', (currency, reportingCurrency) => {
    const result = calculate({
      reportingCurrency,
      previousRecords: [record('native', 100, currency, '2026-05')],
      currentRecords: [record('native', 110, currency, '2026-06')],
    });
    expect(result.status).toBe('available');
    expect(result.conversionEffectAmount).toBeCloseTo(0, 8);
    expect(result.ratesUsed).toEqual([]);
  });

  it('keeps foreign-currency debt sign and produces an adverse conversion effect', () => {
    const result = calculate({
      previousRecords: [record('card-usd', 10_000, 'USD', '2026-05', { block: 'debt', label: DEBT_CARD_USD_LABEL })],
      currentRecords: [record('card-usd', 10_000, 'USD', '2026-06', { block: 'debt', label: DEBT_CARD_USD_LABEL })],
    });
    expect(result.status).toBe('available');
    expect(result.conversionEffectAmount).toBeLessThan(0);
  });

  it('classifies new and removed positions in constant-rate variation', () => {
    const added = calculate({
      previousRecords: [record('base', 100_000_000, 'CLP', '2026-05')],
      currentRecords: [
        record('base', 100_000_000, 'CLP', '2026-06'),
        record('new-usd', 1_000, 'USD', '2026-06'),
      ],
    });
    expect(added.constantConversionChangeAmount).toBe(900_000);

    const removed = calculate({
      previousRecords: [
        record('base', 100_000_000, 'CLP', '2026-05'),
        record('removed-usd', 1_000, 'USD', '2026-05'),
      ],
      currentRecords: [record('base', 100_000_000, 'CLP', '2026-06')],
    });
    expect(removed.constantConversionChangeAmount).toBe(-900_000);
  });

  it('keeps constant-rate percentage invariant across CLP, USD, EUR and UF', () => {
    const previousRecords = [
      record('clp', 100_000_000, 'CLP', '2026-05'),
      record('usd', 20_000, 'USD', '2026-05'),
      record('eur', 10_000, 'EUR', '2026-05'),
      record('uf', 500, 'UF', '2026-05'),
    ];
    const currentRecords = [
      record('clp', 104_000_000, 'CLP', '2026-06'),
      record('usd', 21_000, 'USD', '2026-06'),
      record('eur', 10_500, 'EUR', '2026-06'),
      record('uf', 525, 'UF', '2026-06'),
    ];
    const values = (['CLP', 'USD', 'EUR', 'UF'] as const).map((reportingCurrency) =>
      calculate({ reportingCurrency, previousRecords, currentRecords }).constantConversionChangePct,
    );
    values.slice(1).forEach((value) => expect(value).toBeCloseTo(values[0], 10));
  });

  it('lists only rates that intervene in conversion', () => {
    const result = calculate({
      reportingCurrency: 'EUR',
      previousRecords: [record('eur', 100, 'EUR', '2026-05'), record('usd', 100, 'USD', '2026-05')],
      currentRecords: [record('eur', 100, 'EUR', '2026-06'), record('usd', 100, 'USD', '2026-06')],
    });
    expect(result.ratesUsed.map((item) => item.pair).sort()).toEqual(['EUR/CLP', 'USD/CLP']);
  });

  it('returns unavailable instead of inventing values when FX or records are missing', () => {
    expect(calculate({ previousFx: null }).status).toBe('unavailable');
    expect(calculate({ previousRecords: [] }).status).toBe('unavailable');
    const missingRequiredRate = calculate({ previousFx: { ...previousFx, usdClp: 0 } });
    expect(missingRequiredRate.status).toBe('unavailable');
    expect(Number.isNaN(missingRequiredRate.reportedChangePct)).toBe(false);
  });

  it('returns unavailable when a position changes currency under the same identity', () => {
    const result = calculate({
      previousRecords: [record('fund', 100, 'USD', '2026-05', { label: 'Fondo global' })],
      currentRecords: [record('fund', 100, 'EUR', '2026-06', { label: 'Fondo global' })],
    });
    expect(result.status).toBe('unavailable');
    expect(result.unavailableReason).toContain('cambió de moneda');
  });
});
