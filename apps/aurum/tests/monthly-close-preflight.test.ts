import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BALANCE_CLP_LABEL,
  BANK_BALANCE_USD_LABEL,
  BANK_BCHILE_CLP_LABEL,
  BANK_BCHILE_USD_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  BANK_SCOTIA_USD_LABEL,
  CARD_MASTERCARD_SANTANDER_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  type WealthFxRates,
  type WealthRecord,
} from '../src/services/wealthStorage';
import {
  buildMonthlyClosePreflightDiagnostic,
  buildMonthlyClosePreflightReport,
} from '../src/services/monthlyClosePreflight';

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

  it('returns NO_GO_DATA_QUALITY when a target record has NaN amount', () => {
    const records: WealthRecord[] = [
      record({
        id: 'bank-jun',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: Number.NaN,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    expect(diagnostic.decision).toBe('NO_GO_DATA_QUALITY');
    expect(diagnostic.checks.find((check) => check.key === 'critical_values')?.status).toBe('fail');
  });

  it('dedupes equivalent property records so property is not included twice', () => {
    const records: WealthRecord[] = [
      record({
        id: 'prop-jun-a',
        block: 'real_estate',
        label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
        amount: 3000,
        currency: 'UF',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'prop-jun-b',
        block: 'real_estate',
        label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
        amount: 3000,
        currency: 'UF',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:05:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
    expect(diagnostic.closeTargetRecords.filter((item) => item.label === REAL_ESTATE_PROPERTY_VALUE_LABEL)).toHaveLength(1);
    expect(diagnostic.checks.find((check) => check.key === 'property_single')?.status).toBe('ok');
  });

  it('keeps non-mortgage debt canonical when aggregate and detailed rows coexist', () => {
    const records: WealthRecord[] = [
      record({
        id: 'bank-jun',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 120_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'card-detailed-jun',
        block: 'debt',
        label: CARD_MASTERCARD_SANTANDER_LABEL,
        amount: 93_200_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'card-aggregate-jun',
        block: 'debt',
        label: DEBT_CARD_CLP_LABEL,
        amount: 93_256_478,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:05:00Z',
        note: 'legacy aggregate fallback',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    const debtRow = diagnostic.blockRows.find((row) => row.block === 'tarjetas/deudas');
    const clpRow = diagnostic.blockRows.find((row) => row.block === 'CLP');
    const debtAssetRows = diagnostic.assetRows.filter((row) => row.assetType === 'card_debt');
    const aggregateUiRow = debtAssetRows.find((row) => row.label === DEBT_CARD_CLP_LABEL && row.includedInPatrimonioUI);

    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
    expect(debtRow?.valuePatrimonioUI).toBe(93_200_000);
    expect(debtRow?.valueCloseTarget).toBe(93_200_000);
    expect(clpRow?.status).toBe('ok');
    expect(debtAssetRows.reduce((sum, row) => sum + Math.abs(Number(row.amountClpCloseTarget || 0)), 0)).toBe(93_200_000);
    expect(aggregateUiRow).toBeUndefined();
    expect(diagnostic.checks.find((check) => check.key === 'debt_assets_match_blocks')?.status).toBe('ok');
    expect(diagnostic.checks.find((check) => check.key === 'aggregate_conflicts')?.status).toBe('warn');
    expect(diagnostic.aggregateCompetitionConflicts).toEqual([
      expect.objectContaining({
        family: 'non_mortgage_debt',
        currency: 'CLP',
        status: 'ignored_legacy',
      }),
    ]);
    expect(buildMonthlyClosePreflightReport(diagnostic)).toContain('Agregados legacy ignorados');
  });

  it('keeps patrimonio con riesgo aligned even when includeRiskCapitalInTotals is false', () => {
    const records: WealthRecord[] = [
      record({
        id: 'bank-jun',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 120_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'risk-capital-jun',
        block: 'investment',
        label: RISK_CAPITAL_LABEL_CLP,
        amount: 25_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    const row = diagnostic.blockRows.find((item) => item.block === 'patrimonio con riesgo');

    expect(row?.valuePatrimonioUI).toBe(145_000_000);
    expect(row?.valueCloseTarget).toBe(145_000_000);
    expect(row?.status).toBe('ok');
  });

  it('returns NO_GO_SOURCE_OF_TRUTH_UNCLEAR when bank aggregate competes with richer detail', () => {
    const records: WealthRecord[] = [
      record({
        id: 'bank-bchile-jun',
        block: 'bank',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 10_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'bank-scotia-jun',
        block: 'bank',
        label: BANK_SCOTIA_CLP_LABEL,
        amount: 5_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
      }),
      record({
        id: 'bank-aggregate-jun',
        block: 'bank',
        label: BANK_BALANCE_CLP_LABEL,
        amount: 21_000_000,
        currency: 'CLP',
        snapshotDate: '2026-06-30',
        createdAt: '2026-06-30T10:05:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-06',
      targetMonthKey: '2026-06',
      calendarMonthKey: '2026-06',
      investmentInstruments: [],
    });

    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
    expect(diagnostic.checks.find((check) => check.key === 'aggregate_conflicts')?.status).toBe('warn');
    expect(diagnostic.aggregateCompetitionConflicts).toEqual([
      expect.objectContaining({
        family: 'bank',
        currency: 'CLP',
        status: 'ignored_legacy',
        reason: 'canonical_detail_excludes_legacy_aggregate',
      }),
    ]);
  });

  it('ignores legacy bank usd aggregate when provider detail is canonical for close target', () => {
    const records: WealthRecord[] = [
      record({
        id: 'bank-usd-aggregate-jul',
        block: 'bank',
        source: 'Histórico manual',
        label: BANK_BALANCE_USD_LABEL,
        amount: 4408.376842105263,
        currency: 'USD',
        snapshotDate: '2026-07-31',
        createdAt: '2026-07-31T10:00:00Z',
      }),
      record({
        id: 'bank-usd-bchile-jul',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 14000,
        currency: 'USD',
        snapshotDate: '2026-07-31',
        createdAt: '2026-07-31T10:05:00Z',
      }),
      record({
        id: 'bank-usd-scotia-jul',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_USD_LABEL,
        amount: 9971.395789473683,
        currency: 'USD',
        snapshotDate: '2026-07-31',
        createdAt: '2026-07-31T10:06:00Z',
      }),
    ];

    const diagnostic = buildMonthlyClosePreflightDiagnostic({
      records,
      closures: [],
      fxForClose: fx,
      includeRiskCapitalInTotals: false,
      uiMonthKey: '2026-07',
      targetMonthKey: '2026-07',
      calendarMonthKey: '2026-07',
      investmentInstruments: [],
    });

    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
    expect(diagnostic.checks.find((check) => check.key === 'ui_assets_vs_close')?.status).toBe('ok');
    expect(diagnostic.checks.find((check) => check.key === 'ui_amounts_vs_close')?.status).toBe('ok');
    expect(diagnostic.checks.find((check) => check.key === 'summary_matches_records')?.status).toBe('ok');
    expect(diagnostic.checks.find((check) => check.key === 'aggregate_conflicts')?.status).toBe('warn');
    expect(diagnostic.aggregateCompetitionConflicts).toEqual([
      expect.objectContaining({
        family: 'bank',
        currency: 'USD',
        aggregateClp: 4_187_958,
        detailClp: 22_772_826,
        status: 'ignored_legacy',
        reason: 'canonical_detail_excludes_legacy_aggregate',
      }),
    ]);
    expect(buildMonthlyClosePreflightReport(diagnostic)).toContain('Agregados legacy ignorados');
  });
});
