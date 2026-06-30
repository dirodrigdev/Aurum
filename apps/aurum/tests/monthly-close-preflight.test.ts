import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BCHILE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  type WealthFxRates,
  type WealthRecord,
} from '../src/services/wealthStorage';
import { buildMonthlyClosePreflightDiagnostic } from '../src/services/monthlyClosePreflight';

const fx: WealthFxRates = { usdClp: 950, eurClp: 1030, ufClp: 39000 };

const record = (input: Partial<WealthRecord> & Pick<WealthRecord, 'id' | 'block' | 'label' | 'amount' | 'currency' | 'snapshotDate' | 'createdAt'>): WealthRecord => ({
  source: 'manual',
  ...input,
});

describe('monthly close preflight diagnostic', () => {
  it('returns GO when UI equivalent, freshness and close target reconcile', () => {
    const records: WealthRecord[] = [
      record({
        id: 'inv-jun',
        block: 'investment',
        label: 'BTG total valorizacion',
        amount: 200_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
        updatedAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'bank-jun',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 20_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
        updatedAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'prop-jun',
        block: 'real_estate',
        label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
        amount: 3000,
        currency: 'UF',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
        updatedAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'mort-jun',
        block: 'debt',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 1000,
        currency: 'UF',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
        updatedAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'closure-may-bank',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 10_000_000,
        currency: 'CLP',
        snapshotDate: '2026-05-31',
        createdAt: '2026-05-31T10:00:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [
        {
          id: 'close-may',
          monthKey: '2026-05',
          closedAt: '2026-05-31T20:00:00Z',
          fxRates: fx,
          summary: {
            netByCurrency: { CLP: 10_000_000, USD: 0, EUR: 0, UF: 0 },
            assetsByCurrency: { CLP: 10_000_000, USD: 0, EUR: 0, UF: 0 },
            debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
            netConsolidatedClp: 10_000_000,
            byBlock: {
              bank: { CLP: 10_000_000, USD: 0, EUR: 0, UF: 0 },
              investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
              real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
              debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
            },
            investmentClp: 0,
            riskCapitalClp: 0,
            investmentClpWithRisk: 0,
            netClp: 10_000_000,
            netClpWithRisk: 10_000_000,
            bankClp: 10_000_000,
            nonMortgageDebtClp: 0,
            realEstateNetClp: 0,
            realEstateAssetsClp: 0,
            mortgageDebtClp: 0,
          },
          records: records.filter((item) => item.snapshotDate.startsWith('2026-05')),
        },
      ],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
    expect(diagnostic.fillMissingWarning.wouldRun).toBe(false);
    expect(diagnostic.checks.find((check) => check.key === 'ui_amounts_vs_close')?.status).toBe('ok');
  });

  it('returns NO_GO_SOURCE_OF_TRUTH_UNCLEAR when previous closure would auto-fill missing assets', () => {
    const previousProperty = record({
      id: 'prop-may',
      block: 'real_estate',
      label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
      amount: 3000,
      currency: 'UF',
      snapshotDate: '2026-05-31',
      createdAt: '2026-05-31T10:00:00Z',
    });
    const records: WealthRecord[] = [
      record({
        id: 'bank-jun',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 20_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      previousProperty,
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [
        {
          id: 'close-may',
          monthKey: '2026-05',
          closedAt: '2026-05-31T20:00:00Z',
          fxRates: fx,
          summary: {
            netByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 3000 },
            assetsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 3000 },
            debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
            netConsolidatedClp: 117_000_000,
            byBlock: {
              bank: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
              investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
              real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 3000 },
              debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
            },
            investmentClp: 0,
            riskCapitalClp: 0,
            investmentClpWithRisk: 0,
            netClp: 117_000_000,
            netClpWithRisk: 117_000_000,
            bankClp: 0,
            nonMortgageDebtClp: 0,
            realEstateNetClp: 117_000_000,
            realEstateAssetsClp: 117_000_000,
            mortgageDebtClp: 0,
          },
          records: [previousProperty],
        },
      ],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    expect(diagnostic.fillMissingWarning.wouldRun).toBe(true);
    expect(diagnostic.decision).toBe('NO_GO_SOURCE_OF_TRUTH_UNCLEAR');
    expect(diagnostic.checks.find((check) => check.key === 'fill_missing')?.status).toBe('warn');
  });

  it('returns NO_GO_DATA_QUALITY when FX is invalid', () => {
    const records: WealthRecord[] = [
      record({
        id: 'debt-jun',
        block: 'debt',
        label: DEBT_CARD_CLP_LABEL,
        amount: 5_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: { usdClp: 0, eurClp: 0, ufClp: 0 },
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    expect(diagnostic.decision).toBe('NO_GO_DATA_QUALITY');
    expect(diagnostic.checks.find((check) => check.key === 'fx_complete')?.status).toBe('fail');
  });
});
