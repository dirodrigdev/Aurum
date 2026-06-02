import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { computeClosureSummary } from '../src/components/settings/ClosureReviewModal';
import { buildEditedClosureRecordsFromDraft } from '../src/pages/ClosingAurum';
import {
  buildMonthStartConfirmationCopy,
  buildMonthStartEligibility,
  buildMonthPreparationStepViews,
  buildMonthStartMortgageAudit,
  buildStartMonthBankErrorView,
} from '../src/pages/Patrimonio';
import {
  buildBankIntegrityAudit,
  buildBankRefreshSafetyAudit,
  buildClosureBlockIntegrityAudit,
  buildClosureDetailRecoveryAudit,
  buildMonthInitializationIntegrityAudit,
} from '../src/services/wealthIntegrityAudit';
import {
  BANK_BALANCE_CLP_LABEL,
  BANK_BALANCE_USD_LABEL,
  BANK_BCHILE_CLP_LABEL,
  BANK_BCHILE_USD_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  BANK_SCOTIA_USD_LABEL,
  BANK_SANTANDER_CLP_LABEL,
  BANK_SANTANDER_USD_LABEL,
  CLOSURE_RECONCILIATION_BANK_LABEL,
  CLOSURE_RECONCILIATION_DEBT_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_AMORTIZATION_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  MORTGAGE_DIVIDEND_LABEL,
  MORTGAGE_INSURANCE_LABEL,
  MORTGAGE_INTEREST_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  buildCanonicalClosureSummary,
  computeWealthHomeSectionAmounts,
  createMonthlyClosure,
  reconcileBankClosureDetails,
  reconcileNonMortgageDebtClosureDetails,
  resolveClosureSectionAmounts,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../src/services/wealthStorage';

const fx: WealthFxRates = { usdClp: 950, eurClp: 1030, ufClp: 39000 };

const makeMemoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    clear: vi.fn(() => {
      map.clear();
    }),
    key: vi.fn((index: number) => [...map.keys()][index] ?? null),
    get length() {
      return map.size;
    },
  };
};

const record = (
  input: Omit<WealthRecord, 'id' | 'snapshotDate' | 'createdAt'> & { id: string },
): WealthRecord => ({
  snapshotDate: '2026-05-31',
  createdAt: '2026-05-31T12:00:00Z',
  ...input,
});

const closureFrom = (summary: WealthMonthlyClosure['summary'], records?: WealthRecord[]): WealthMonthlyClosure => ({
  id: 'closure-invariant',
  monthKey: '2026-05',
  closedAt: '2026-05-31T23:59:59Z',
  fxRates: fx,
  summary,
  ...(records ? { records } : {}),
});

const baseBankDebtRecords = (): WealthRecord[] => [
  record({
    id: 'bank-bchile',
    block: 'bank',
    source: 'Fintoc',
    label: BANK_BCHILE_CLP_LABEL,
    amount: 5_315_725,
    currency: 'CLP',
  }),
  record({
    id: 'bank-scotia',
    block: 'bank',
    source: 'Fintoc',
    label: BANK_SCOTIA_CLP_LABEL,
    amount: 15_691_791,
    currency: 'CLP',
  }),
  record({
    id: 'debt-card',
    block: 'bank',
    source: 'Fintoc',
    label: DEBT_CARD_CLP_LABEL,
    amount: 93_200_000,
    currency: 'CLP',
  }),
  record({
    id: 'inv-btg',
    block: 'investment',
    source: 'BTG',
    label: 'BTG total valorizacion',
    amount: 1_525_849_377,
    currency: 'CLP',
  }),
  record({
    id: 're-prop',
    block: 'real_estate',
    source: 'Manual',
    label: 'Valor propiedad',
    amount: 252_860_424,
    currency: 'CLP',
  }),
];

describe('wealth data lineage invariants', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
  });

  it('resolves canonical non-mortgage debt from records even when summary and byBlock say zero', () => {
    const records = baseBankDebtRecords();
    const canonicalSummary = buildCanonicalClosureSummary(records, fx);
    const poisonedSummary: WealthMonthlyClosure['summary'] = {
      ...canonicalSummary,
      nonMortgageDebtClp: 0,
      netClp: canonicalSummary.netClp + 93_200_000,
      netClpWithRisk: canonicalSummary.netClpWithRisk + 93_200_000,
      netConsolidatedClp: canonicalSummary.netConsolidatedClp + 93_200_000,
      byBlock: {
        ...canonicalSummary.byBlock,
        debt: { ...canonicalSummary.byBlock.debt, CLP: 0 },
      },
    };

    const closure = closureFrom(poisonedSummary, records);
    const sectionAmounts = resolveClosureSectionAmounts({ closure, includeRiskCapitalInTotals: false });
    const reviewSummary = computeClosureSummary(closure);

    expect(sectionAmounts.source).toBe('records_canonical');
    expect(sectionAmounts.nonMortgageDebtClp).toBe(93_200_000);
    expect(sectionAmounts.totalNetClp).toBe(canonicalSummary.netClp);
    expect(reviewSummary.source).toBe('records_canonical');
    expect(reviewSummary.nonMortgageDebtClp).toBe(93_200_000);
  });

  it('does not let byBlock legacy prevail over closure records when both exist', () => {
    const records = [
      record({ id: 'bank', block: 'bank', source: 'Fintoc', label: BANK_BCHILE_CLP_LABEL, amount: 300_000, currency: 'CLP' }),
      record({ id: 'debt', block: 'bank', source: 'Fintoc', label: DEBT_CARD_CLP_LABEL, amount: 50_000, currency: 'CLP' }),
      record({ id: 'investment', block: 'investment', source: 'BTG', label: 'BTG total valorizacion', amount: 1_000_000, currency: 'CLP' }),
    ];
    const summary = {
      ...buildCanonicalClosureSummary(records, fx),
      bankClp: 999_999,
      nonMortgageDebtClp: 999_999,
      byBlock: {
        bank: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
      },
    } satisfies WealthMonthlyClosure['summary'];

    const closure = closureFrom(summary, records);
    const resolved = resolveClosureSectionAmounts({ closure });

    expect(resolved.source).toBe('records_canonical');
    expect(resolved.bankClp).toBe(300_000);
    expect(resolved.nonMortgageDebtClp).toBe(50_000);
  });

  it('keeps total patrimonio tied to canonical subtotals instead of stale netConsolidatedClp when records exist', () => {
    const records = [
      ...baseBankDebtRecords(),
      record({
        id: 'risk',
        block: 'investment',
        source: 'Manual',
        label: RISK_CAPITAL_LABEL_CLP,
        amount: 279_822_000,
        currency: 'CLP',
      }),
    ];

    const summary = buildCanonicalClosureSummary(records, fx);
    const closure = closureFrom(
      {
        ...summary,
        netConsolidatedClp: 1_999_999_999,
        netClp: 1_999_999_999,
        netClpWithRisk: 2_111_111_111,
      },
      records,
    );

    const resolved = resolveClosureSectionAmounts({ closure, includeRiskCapitalInTotals: false });
    const expectedTotal = resolved.investmentClp + resolved.bankClp + resolved.realEstateNetClp - resolved.nonMortgageDebtClp;

    expect(resolved.source).toBe('records_canonical');
    expect(resolved.totalNetClp).toBe(expectedTotal);
    expect(resolved.totalNetClp).not.toBe(1_999_999_999);
  });

  it('preserves rich bank detail during closure edit when bank fields are not dirty', () => {
    const { records } = buildEditedClosureRecordsFromDraft({
      records: baseBankDebtRecords(),
      draft: {
        suraFin: '',
        suraPrev: '',
        btg: '',
        planvital: '',
        global66: '',
        wise: '',
        riskCapitalClp: '',
        riskCapitalUsd: '',
        tenencia: '999000',
        valorProp: '',
        saldoHipoteca: '',
        bancosClp: '21007516',
        bancosUsd: '',
        tarjetasClp: '',
        tarjetasUsd: '',
      },
      dirtyFields: { tenencia: true },
      monthKey: '2026-05',
      createdAt: '2026-05-31T13:00:00.000Z',
    });

    const summary = buildCanonicalClosureSummary(records, fx);

    expect(records.some((item) => item.label === BANK_BCHILE_CLP_LABEL)).toBe(true);
    expect(records.some((item) => item.label === BANK_SCOTIA_CLP_LABEL)).toBe(true);
    expect(records.some((item) => item.label === BANK_BALANCE_CLP_LABEL)).toBe(false);
    expect(summary.bankClp).toBe(21_007_516);
    expect(summary.nonMortgageDebtClp).toBe(93_200_000);
  });

  it('creates monthly closures whose persisted summary matches the canonical records even without manual edits', () => {
    const records = baseBankDebtRecords();
    const closure = createMonthlyClosure(records, fx, new Date('2026-05-31T23:59:59.000Z'));
    const canonicalSummary = buildCanonicalClosureSummary(records, fx);
    const home = computeWealthHomeSectionAmounts(records, fx);

    expect(closure.summary.bankClp).toBe(canonicalSummary.bankClp);
    expect(closure.summary.nonMortgageDebtClp).toBe(canonicalSummary.nonMortgageDebtClp);
    expect(closure.summary.netClp).toBe(canonicalSummary.netClp);
    expect(closure.summary.nonMortgageDebtClp).toBe(home.nonMortgageDebt);
    expect(closure.summary.netClp).toBe(home.totalNetClp);
  });

  it('prefers granular provider bank records over poor bank aggregates in canonical closure totals', () => {
    const records = [
      record({
        id: 'bank-bchile-clp',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 163_846,
        currency: 'CLP',
      }),
      record({
        id: 'bank-scotia-clp',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_CLP_LABEL,
        amount: 0,
        currency: 'CLP',
      }),
      record({
        id: 'bank-santander-clp',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SANTANDER_CLP_LABEL,
        amount: 0,
        currency: 'CLP',
      }),
      record({
        id: 'bank-bchile-usd',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 5_590,
        currency: 'USD',
      }),
      record({
        id: 'bank-scotia-usd',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_USD_LABEL,
        amount: 15_000,
        currency: 'USD',
      }),
      record({
        id: 'bank-santander-usd',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SANTANDER_USD_LABEL,
        amount: 2_803.57,
        currency: 'USD',
      }),
      record({
        id: 'bank-aggregate-clp',
        block: 'bank',
        source: 'Histórico manual',
        label: BANK_BALANCE_CLP_LABEL,
        amount: 3_659_143,
        currency: 'CLP',
      }),
      record({
        id: 'bank-aggregate-usd',
        block: 'bank',
        source: 'Histórico manual',
        label: BANK_BALANCE_USD_LABEL,
        amount: 4_622.47,
        currency: 'USD',
      }),
    ];

    const summary = buildCanonicalClosureSummary(records, { ...fx, usdClp: 891 });

    expect(summary.bankClp).toBe(21_007_517);
  });

  it('detects bank inconsistency when visible closure subtotal is richer than editable and operative detail', () => {
    const audit = buildBankIntegrityAudit({
      visibleBankClp: 21_007_516,
      editableBankClp: 3_659_143,
      editableBankUsd: 4_622.47,
      operativeBankClp: 1_194_156,
      operativeBankUsd: 4_622,
      fx: { usdClp: 893 },
    });

    expect(audit.status).toBe('blocked');
    expect(audit.editableTotalClp).toBe(7_787_009);
    expect(audit.operativeTotalClp).toBe(5_321_602);
    expect(audit.reasons).toContain('editable_detail_diverges_from_visible_bank_total');
    expect(audit.reasons).toContain('operative_detail_diverges_from_visible_bank_total');
    expect(audit.reasons).toContain('multiple_active_bank_sources_disagree');
  });

  it('blocks closure edit when visible bank subtotal is richer than editable records and banks were not explicitly touched', () => {
    const visibleClosure = closureFrom({
      netByCurrency: { CLP: 1_706_517_319, USD: 0, EUR: 0, UF: 0 },
      assetsByCurrency: { CLP: 1_799_717_319, USD: 0, EUR: 0, UF: 0 },
      debtsByCurrency: { CLP: 93_200_000, USD: 0, EUR: 0, UF: 0 },
      netConsolidatedClp: 1_706_517_319,
      byBlock: {
        bank: { CLP: 21_007_516, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 1_525_849_377, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 252_860_424, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: 93_200_000, USD: 0, EUR: 0, UF: 0 },
      },
      bankClp: 21_007_516,
      investmentClp: 1_525_849_377,
      investmentClpWithRisk: 1_525_849_377,
      realEstateAssetsClp: 252_860_424,
      mortgageDebtClp: 0,
      realEstateNetClp: 252_860_424,
      nonMortgageDebtClp: 93_200_000,
      netClp: 1_706_517_319,
      netClpWithRisk: 1_706_517_319,
      riskCapitalClp: 0,
    });
    const editableRecords = [
      record({ id: 'edit-bank-clp', block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 3_659_143, currency: 'CLP' }),
      record({ id: 'edit-bank-usd', block: 'bank', source: 'Edición cierre', label: 'Saldo bancos USD', amount: 4_622.47, currency: 'USD' }),
      record({ id: 'edit-debt', block: 'bank', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
      record({ id: 'edit-inv', block: 'investment', source: 'Edición cierre', label: 'BTG total valorizacion', amount: 1_525_849_377, currency: 'CLP' }),
      record({ id: 'edit-re', block: 'real_estate', source: 'Edición cierre', label: 'Valor propiedad', amount: 252_860_424, currency: 'CLP' }),
    ];

    const audit = buildClosureBlockIntegrityAudit({
      closure: visibleClosure,
      editableRecords,
      fxRates: { ...fx, usdClp: 893 },
    });

    expect(audit.status).toBe('blocked');
    expect(audit.visibleBankClp).toBe(21_007_516);
    expect(audit.editableBankClp).toBe(7_787_009);
    expect(audit.reasons).toContain('editable_detail_diverges_from_visible_bank_total');
  });

  it('does not create an automatic bank reconciliation line in normal flow when no real detail explains the visible subtotal', () => {
    const records = [
      record({ id: 'edit-bank-clp', block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 3_659_143, currency: 'CLP' }),
      record({ id: 'edit-bank-usd', block: 'bank', source: 'Edición cierre', label: 'Saldo bancos USD', amount: 4_622.47, currency: 'USD' }),
      record({ id: 'edit-debt', block: 'debt', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];

    const result = reconcileBankClosureDetails({
      visibleSubtotalClp: 21_007_516,
      records,
      fxRates: { ...fx, usdClp: 893 },
      monthKey: '2026-05',
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('bank_visible_subtotal_requires_breakdown');
    expect(result.records.some((item) => item.label === CLOSURE_RECONCILIATION_BANK_LABEL)).toBe(false);
  });

  it('only creates a bank reconciliation line when legacy synthetic reconciliation is explicitly enabled', () => {
    const records = [
      record({ id: 'edit-bank-clp', block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 3_659_143, currency: 'CLP' }),
      record({ id: 'edit-bank-usd', block: 'bank', source: 'Edición cierre', label: 'Saldo bancos USD', amount: 4_622.47, currency: 'USD' }),
      record({ id: 'edit-debt', block: 'debt', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];

    const result = reconcileBankClosureDetails({
      visibleSubtotalClp: 21_007_516,
      records,
      fxRates: { ...fx, usdClp: 893 },
      monthKey: '2026-05',
      allowLegacySyntheticReconciliation: true,
    });

    expect(result.status).toBe('reconciled');
    expect(result.records.some((item) => item.label === CLOSURE_RECONCILIATION_BANK_LABEL)).toBe(true);
  });

  it('does not create an automatic debt reconciliation line in normal flow when only summary is richer', () => {
    const records = [
      record({ id: 'edit-bank', block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 21_007_516, currency: 'CLP' }),
    ];

    const result = reconcileNonMortgageDebtClosureDetails({
      visibleSubtotalClp: 93_200_000,
      records,
      fxRates: fx,
      monthKey: '2026-05',
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('debt_visible_subtotal_requires_breakdown');
    expect(result.records.some((item) => item.label === CLOSURE_RECONCILIATION_DEBT_LABEL)).toBe(false);
  });

  it('explains when a visible subtotal requires real record recovery instead of synthetic reconciliation', () => {
    const visibleClosure = closureFrom({
      netByCurrency: { CLP: 1_706_517_319, USD: 0, EUR: 0, UF: 0 },
      assetsByCurrency: { CLP: 1_799_717_319, USD: 0, EUR: 0, UF: 0 },
      debtsByCurrency: { CLP: 93_200_000, USD: 0, EUR: 0, UF: 0 },
      netConsolidatedClp: 1_706_517_319,
      byBlock: {
        bank: { CLP: 21_007_516, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 1_525_849_377, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 252_860_424, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: 93_200_000, USD: 0, EUR: 0, UF: 0 },
      },
      bankClp: 21_007_516,
      investmentClp: 1_525_849_377,
      investmentClpWithRisk: 1_525_849_377,
      realEstateAssetsClp: 252_860_424,
      mortgageDebtClp: 0,
      realEstateNetClp: 252_860_424,
      nonMortgageDebtClp: 93_200_000,
      netClp: 1_706_517_319,
      netClpWithRisk: 1_706_517_319,
      riskCapitalClp: 0,
    });
    const editableRecords = [
      record({ id: 'edit-bank-clp', block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 3_659_143, currency: 'CLP' }),
      record({ id: 'edit-bank-usd', block: 'bank', source: 'Edición cierre', label: 'Saldo bancos USD', amount: 4_622.47, currency: 'USD' }),
      record({ id: 'edit-debt', block: 'debt', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 0, currency: 'CLP' }),
    ];

    const audit = buildClosureDetailRecoveryAudit({
      closure: visibleClosure,
      editableRecords,
      fxRates: { ...fx, usdClp: 893 },
    });

    expect(audit.requiresBreakdown).toBe(true);
    expect(audit.reasons).toContain('bank_visible_subtotal_requires_breakdown');
    expect(audit.reasons).toContain('debt_visible_subtotal_requires_breakdown');
  });

  it('audits month initialization as exact and idempotent copy of the last valid closure', () => {
    const previousRecords = [
      ...baseBankDebtRecords(),
      record({
        id: 'risk',
        block: 'investment',
        source: 'Manual',
        label: RISK_CAPITAL_LABEL_CLP,
        amount: 279_822_000,
        currency: 'CLP',
      }),
    ];
    const previousClosure = closureFrom(buildCanonicalClosureSummary(previousRecords, fx), previousRecords);
    const initializedRecords = previousRecords.map((item) => ({
      ...item,
      id: `${item.id}-next`,
      snapshotDate: '2026-06-30',
      createdAt: '2026-06-30T12:00:00Z',
    }));
    const rerunRecords = initializedRecords.map((item) => ({ ...item }));

    const audit = buildMonthInitializationIntegrityAudit({
      previousClosure,
      initializedRecords,
      rerunRecords,
      fxRates: fx,
    });

    expect(audit.status).toBe('ok');
    expect(audit.missingAssetKeys).toEqual([]);
    expect(audit.extraAssetKeys).toEqual([]);
    expect(audit.changedAssetKeys).toEqual([]);
    expect(audit.rerunChangedAssetKeys).toEqual([]);
    expect(audit.initializedSummary.bankClp).toBe(audit.previousSummary?.bankClp);
    expect(audit.initializedSummary.nonMortgageDebtClp).toBe(audit.previousSummary?.nonMortgageDebtClp);
    expect(audit.initializedSummary.netClp).toBe(audit.previousSummary?.netClp);
  });

  it('blocks month initialization when a synthetic aggregate tries to replace previous detailed bank assets', () => {
    const previousRecords = baseBankDebtRecords();
    const previousClosure = closureFrom(buildCanonicalClosureSummary(previousRecords, fx), previousRecords);
    const initializedRecords = [
      record({
        id: 'bank-default',
        block: 'bank',
        source: 'cierre_resumen',
        label: BANK_BALANCE_CLP_LABEL,
        amount: 21_007_516,
        currency: 'CLP',
      }),
      record({
        id: 'debt-next',
        block: 'bank',
        source: 'cierre_resumen',
        label: DEBT_CARD_CLP_LABEL,
        amount: 93_200_000,
        currency: 'CLP',
      }),
      record({
        id: 'inv-next',
        block: 'investment',
        source: 'cierre_resumen',
        label: 'BTG total valorizacion',
        amount: 1_525_849_377,
        currency: 'CLP',
      }),
      record({
        id: 're-next',
        block: 'real_estate',
        source: 'cierre_resumen',
        label: 'Valor propiedad',
        amount: 252_860_424,
        currency: 'CLP',
      }),
    ];

    const audit = buildMonthInitializationIntegrityAudit({
      previousClosure,
      initializedRecords,
      fxRates: fx,
    });

    expect(audit.status).toBe('blocked');
    expect(audit.reasons).toContain('initialized_month_missing_previous_assets');
    expect(audit.reasons).toContain('initialized_month_added_unexpected_assets');
  });

  it('flags partial bank refresh as destructive when it would erase previous valid balances', () => {
    const previousRecords = [
      record({ id: 'prev-clp', block: 'bank', source: 'Fintoc', label: BANK_BCHILE_CLP_LABEL, amount: 21_007_516, currency: 'CLP' }),
      record({ id: 'prev-debt', block: 'bank', source: 'Fintoc', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];
    const refreshedRecords = [
      record({ id: 'new-clp', block: 'bank', source: 'Fintoc API', label: BANK_BCHILE_CLP_LABEL, amount: 1_194_156, currency: 'CLP' }),
      record({ id: 'new-usd', block: 'bank', source: 'Fintoc API', label: 'Banco de Chile USD', amount: 4_622, currency: 'USD' }),
      record({ id: 'new-debt', block: 'bank', source: 'Fintoc', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];

    const audit = buildBankRefreshSafetyAudit({
      previousRecords,
      refreshedRecords,
      fxRates: { ...fx, usdClp: 893 },
      providerStatus: 'partial',
    });

    expect(audit.status).toBe('blocked');
    expect(audit.previousBankClp).toBe(21_007_516);
    expect(audit.refreshedBankClp).toBe(5_321_602);
    expect(audit.reasons).toContain('partial_refresh_reduced_bank_balance');
    expect(audit.previousDebtClp).toBe(93_200_000);
    expect(audit.refreshedDebtClp).toBe(93_200_000);
  });

  it('blocks failed bank refreshes that would replace previous valid balances with defaults or aggregates', () => {
    const previousRecords = [
      record({ id: 'prev-clp', block: 'bank', source: 'Fintoc', label: BANK_BCHILE_CLP_LABEL, amount: 21_007_516, currency: 'CLP' }),
      record({ id: 'prev-debt', block: 'bank', source: 'Fintoc', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];
    const refreshedRecords = [
      record({ id: 'aggregate-clp', block: 'bank', source: 'Calculado', label: BANK_BALANCE_CLP_LABEL, amount: 0, currency: 'CLP' }),
      record({ id: 'aggregate-usd', block: 'bank', source: 'Calculado', label: 'Saldo bancos USD', amount: 0, currency: 'USD' }),
      record({ id: 'debt-preserved', block: 'bank', source: 'Fintoc', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];

    const audit = buildBankRefreshSafetyAudit({
      previousRecords,
      refreshedRecords,
      fxRates: fx,
      providerStatus: 'failed',
    });

    expect(audit.status).toBe('blocked');
    expect(audit.refreshedBankClp).toBe(0);
    expect(audit.reasons).toContain('partial_refresh_reduced_bank_balance');
  });

  it('treats a copied month with records as pending start until hipoteca is applied', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'pending',
        fx: 'applied',
        banks: 'pending',
        realEstate: 'pending',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
    });

    const carry = steps.find((step) => step.key === 'carry');
    expect(carry?.tone).toBe('ready');
    expect(carry?.detail).toBe('Copiado desde cierre anterior · pendiente de iniciar');
    expect(carry?.showAction).toBe(false);
  });

  it('normalizes legacy applied banks and failed badge into copied-from-close state before explicit start', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'applied',
        banks: 'applied',
        realEstate: 'applied',
      },
      failedStep: 'banks',
      canCarryFromPrevious: true,
      banksEnabled: true,
      explicitMonthStarted: false,
    });

    const banks = steps.find((step) => step.key === 'banks');
    const carry = steps.find((step) => step.key === 'carry');
    const realEstate = steps.find((step) => step.key === 'realEstate');

    expect(banks?.tone).toBe('ready');
    expect(banks?.detail).toBe('Copiados desde cierre anterior');
    expect(carry?.detail).toBe('Copiado desde cierre anterior · pendiente de iniciar');
    expect(realEstate?.detail).toBe('Pendiente de iniciar');
  });

  it('suppresses the main red banner and retry CTA for legacy bank failures', () => {
    const errorView = buildStartMonthBankErrorView({
      flowError:
        'La actualización bancaria devolvió un resultado parcial que degradaba saldos válidos. Mantuvimos el estado anterior.',
      failedStep: 'banks',
      explicitMonthStarted: false,
      manualBankAttempted: false,
    });

    expect(errorView.showMainBanner).toBe(false);
    expect(errorView.showRetryButton).toBe(false);
    expect(errorView.secondaryNote).toContain('API bancaria experimental no aplicada');
  });

  it('keeps copy-last-close as fallback only when the current month is empty and previous closure exists', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: false,
      actionStatus: {
        carry: 'pending',
        fx: 'pending',
        banks: 'pending',
        realEstate: 'pending',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
    });

    const carry = steps.find((step) => step.key === 'carry');
    expect(carry?.tone).toBe('pending');
    expect(carry?.showAction).toBe(true);
    expect(carry?.actionLabel).toBe('Copiar último cierre');
  });

  it('keeps banks as a secondary fallback and not as a primary toolbar action', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'applied',
        banks: 'pending',
        realEstate: 'pending',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
    });

    const banks = steps.find((step) => step.key === 'banks');
    expect(banks?.detail).toBe('Copiados desde cierre anterior');
    expect(banks?.showAction).toBe(true);
    expect(banks?.actionLabel).toBe('Actualizar bancos desde API (experimental/manual)');
  });

  it('keeps the bank API note as secondary info inside Estado del mes', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'pending',
        banks: 'pending',
        realEstate: 'pending',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
      bankInfoNote: 'API bancaria experimental no aplicada. Se mantienen bancos copiados/manuales.',
    });

    const banks = steps.find((step) => step.key === 'banks');
    expect(banks?.note).toContain('API bancaria experimental no aplicada');
  });

  it('only allows Iniciar mes when the selected month is open, copied from the immediate previous closure and mortgage is pending', () => {
    const previous = closureFrom(buildCanonicalClosureSummary(baseBankDebtRecords(), fx), baseBankDebtRecords());
    const eligibility = buildMonthStartEligibility({
      monthKey: '2026-06',
      activeClosure: null,
      previousClosure: previous,
      monthHasRecords: true,
      copiedFromPrevious: true,
      mortgageStatus: 'pending',
    });

    expect(eligibility.canStart).toBe(true);
    expect(eligibility.reason).toBe('ready');
  });

  it('blocks Iniciar mes when hipoteca is already applied or requires review', () => {
    const previous = closureFrom(buildCanonicalClosureSummary(baseBankDebtRecords(), fx), baseBankDebtRecords());

    expect(
      buildMonthStartEligibility({
        monthKey: '2026-06',
        activeClosure: null,
        previousClosure: previous,
        monthHasRecords: true,
        copiedFromPrevious: true,
        mortgageStatus: 'applied',
      }),
    ).toMatchObject({ canStart: false, reason: 'mortgage_applied' });

    expect(
      buildMonthStartEligibility({
        monthKey: '2026-06',
        activeClosure: null,
        previousClosure: previous,
        monthHasRecords: true,
        copiedFromPrevious: true,
        mortgageStatus: 'review',
      }),
    ).toMatchObject({ canStart: false, reason: 'mortgage_review' });
  });

  it('blocks Iniciar mes when the previous closure is missing, non-adjacent or the selected month was not copied', () => {
    const mayClosure = closureFrom(buildCanonicalClosureSummary(baseBankDebtRecords(), fx), baseBankDebtRecords());

    expect(
      buildMonthStartEligibility({
        monthKey: '2026-06',
        activeClosure: null,
        previousClosure: null,
        monthHasRecords: true,
        copiedFromPrevious: true,
        mortgageStatus: 'pending',
      }),
    ).toMatchObject({ canStart: false, reason: 'missing_previous_closure' });

    expect(
      buildMonthStartEligibility({
        monthKey: '2026-07',
        activeClosure: null,
        previousClosure: mayClosure,
        monthHasRecords: true,
        copiedFromPrevious: true,
        mortgageStatus: 'pending',
      }),
    ).toMatchObject({ canStart: false, reason: 'non_adjacent_previous_closure' });

    expect(
      buildMonthStartEligibility({
        monthKey: '2026-06',
        activeClosure: null,
        previousClosure: mayClosure,
        monthHasRecords: false,
        copiedFromPrevious: false,
        mortgageStatus: 'pending',
      }),
    ).toMatchObject({ canStart: false, reason: 'month_not_copied_from_previous' });
  });

  it('builds month-start confirmation copy using the selected month and its previous closure', () => {
    const copy = buildMonthStartConfirmationCopy({
      monthKey: '2026-06',
      previousClosureMonthKey: '2026-05',
    });

    expect(copy.title).toBe('Iniciar Junio de 2026');
    expect(copy.message).toContain('JUNIO DE 2026');
    expect(copy.message).toContain('MAYO DE 2026');
    expect(copy.confirmText).toBe('Iniciar junio de 2026');
    expect(copy.details).toContain('No se tocarán bancos');
  });

  it('marks the month as started only after explicit new-flow start is recorded', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'pending',
        banks: 'pending',
        realEstate: 'applied',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
      explicitMonthStarted: false,
    });

    const carry = steps.find((step) => step.key === 'carry');
    const realEstate = steps.find((step) => step.key === 'realEstate');
    expect(carry?.detail).toBe('Copiado desde cierre anterior · pendiente de iniciar');
    expect(realEstate?.detail).toBe('Pendiente de iniciar');
  });

  it('shows the month as started only when the explicit start flag is present', () => {
    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'applied',
        banks: 'applied',
        realEstate: 'applied',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
      explicitMonthStarted: true,
    });

    const carry = steps.find((step) => step.key === 'carry');
    const realEstate = steps.find((step) => step.key === 'realEstate');
    expect(carry?.detail).toBe('Mes iniciado');
    expect(realEstate?.detail).toBe('Hipoteca actualizada');
  });

  it('marks hipoteca as applied when debt delta matches expected amortization', () => {
    const previousRecords = [
      record({
        id: 'mortgage-balance-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 2_800,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-dividend-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_DIVIDEND_LABEL,
        amount: 20,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-interest-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_INTEREST_LABEL,
        amount: 8,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-insurance-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_INSURANCE_LABEL,
        amount: 2,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-amortization-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_AMORTIZATION_LABEL,
        amount: 10,
        currency: 'UF',
      }),
    ];
    const currentRecords = previousRecords.map((item) =>
      item.label === MORTGAGE_DEBT_BALANCE_LABEL
        ? { ...item, id: 'mortgage-balance-current', snapshotDate: '2026-06-30', amount: 2_790 }
        : { ...item, id: `${item.id}-current`, snapshotDate: '2026-06-30' },
    );

    const audit = buildMonthStartMortgageAudit({
      monthKey: '2026-06',
      monthRecords: currentRecords,
      previousClosure: closureFrom(buildCanonicalClosureSummary(previousRecords, fx), previousRecords),
      fxRates: fx,
    });

    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'pending',
        banks: 'pending',
        realEstate: 'pending',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
      explicitMonthStarted: false,
      mortgageStatus: audit.status,
    });

    const realEstate = steps.find((step) => step.key === 'realEstate');
    expect(audit.status).toBe('applied');
    expect(audit.principalDeltaUf).toBe(10);
    expect(audit.amortizationExpectedUf).toBe(10);
    expect(audit.differenceUf).toBe(0);
    expect(audit.principalDeltaClp).toBe(390000);
    expect(realEstate?.tone).toBe('ready');
    expect(realEstate?.detail).toBe('Hipoteca aplicada');
  });

  it('marks hipoteca as review-required when debt delta does not match expected amortization', () => {
    const previousRecords = [
      record({
        id: 'mortgage-balance-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 2_800,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-dividend-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_DIVIDEND_LABEL,
        amount: 20,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-interest-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_INTEREST_LABEL,
        amount: 8,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-insurance-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_INSURANCE_LABEL,
        amount: 2,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-amortization-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_AMORTIZATION_LABEL,
        amount: 10,
        currency: 'UF',
      }),
    ];
    const currentRecords = previousRecords.map((item) =>
      item.label === MORTGAGE_DEBT_BALANCE_LABEL
        ? { ...item, id: 'mortgage-balance-current', snapshotDate: '2026-06-30', amount: 2_794 }
        : { ...item, id: `${item.id}-current`, snapshotDate: '2026-06-30' },
    );

    const audit = buildMonthStartMortgageAudit({
      monthKey: '2026-06',
      monthRecords: currentRecords,
      previousClosure: closureFrom(buildCanonicalClosureSummary(previousRecords, fx), previousRecords),
      fxRates: fx,
    });

    const steps = buildMonthPreparationStepViews({
      monthKey: '2026-06',
      realCurrentMonthKey: '2026-06',
      monthHasRecords: true,
      actionStatus: {
        carry: 'applied',
        fx: 'pending',
        banks: 'pending',
        realEstate: 'pending',
      },
      failedStep: null,
      canCarryFromPrevious: true,
      banksEnabled: true,
      explicitMonthStarted: false,
      mortgageStatus: audit.status,
    });

    const realEstate = steps.find((step) => step.key === 'realEstate');
    expect(audit.status).toBe('review');
    expect(audit.principalDeltaUf).toBe(6);
    expect(audit.amortizationExpectedUf).toBe(10);
    expect(audit.differenceUf).toBe(-4);
    expect(realEstate?.tone).toBe('warning');
    expect(realEstate?.detail).toBe('Hipoteca requiere revisión');
  });

  it('keeps iniciar mes available when the copied mortgage detail still matches the previous closure', () => {
    const previousRecords = [
      record({
        id: 'mortgage-balance-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 2_800,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-dividend-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_DIVIDEND_LABEL,
        amount: 20,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-interest-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_INTEREST_LABEL,
        amount: 8,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-insurance-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_INSURANCE_LABEL,
        amount: 2,
        currency: 'UF',
      }),
      record({
        id: 'mortgage-amortization-prev',
        block: 'debt',
        source: 'Scotiabank',
        label: MORTGAGE_AMORTIZATION_LABEL,
        amount: 10,
        currency: 'UF',
      }),
    ];

    const audit = buildMonthStartMortgageAudit({
      monthKey: '2026-06',
      monthRecords: previousRecords.map((item) => ({ ...item, id: `${item.id}-current`, snapshotDate: '2026-06-30' })),
      previousClosure: closureFrom(buildCanonicalClosureSummary(previousRecords, fx), previousRecords),
      fxRates: fx,
    });

    expect(audit.status).toBe('pending');
    expect(audit.changedLabels).toEqual([]);
  });
});
