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
  buildBankIntegrityAudit,
  buildBankRefreshSafetyAudit,
  buildMonthInitializationIntegrityAudit,
} from '../src/services/wealthIntegrityAudit';
import {
  BANK_BALANCE_CLP_LABEL,
  BANK_BCHILE_CLP_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  buildCanonicalClosureSummary,
  computeWealthHomeSectionAmounts,
  createMonthlyClosure,
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
});
