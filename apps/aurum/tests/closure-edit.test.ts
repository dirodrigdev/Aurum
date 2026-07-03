import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  auth: {},
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import {
  buildHistoricalClosureSnapshot,
  buildApril2026BankRepairPreview,
  buildClosureAuditDiagnosis,
  buildClosureAuditSnapshot,
  buildClosureEditDraftFromRecords,
  buildClosureRecordsFromDetailDraft,
  buildEditedClosureRecordsFromDraft,
  resolveHistoricalClosureEditFx,
} from '../src/pages/ClosingAurum';
import { buildClosureBlockIntegrityAudit, buildClosureDetailRecoveryAudit } from '../src/services/wealthIntegrityAudit';
import {
  BANK_BCHILE_CLP_LABEL,
  BANK_BALANCE_CLP_LABEL,
  BANK_BALANCE_USD_LABEL,
  BANK_BCHILE_USD_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  BANK_SCOTIA_USD_LABEL,
  BANK_SANTANDER_CLP_LABEL,
  BANK_SANTANDER_USD_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  TENENCIA_CXC_PREFIX_LABEL,
  buildCanonicalClosureSummary,
  createMonthlyClosure,
  loadWealthRecords,
  loadClosures,
  reconcileClosureDetailRecords,
  saveClosures,
  saveWealthRecords,
  upsertMonthlyClosure,
} from '../src/services/wealthStorage';
import type { WealthRecord } from '../src/services/wealthStorage';

const fxRates = {
  usdClp: 900,
  eurClp: 1000,
  ufClp: 40000,
};

const makeRecord = (
  input: Pick<WealthRecord, 'block' | 'source' | 'label' | 'amount' | 'currency'>,
): WealthRecord => ({
  id: `${input.block}-${input.label}`,
  snapshotDate: '2026-04-30',
  createdAt: '2026-04-30T12:00:00.000Z',
  ...input,
});

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

const baseRecords = (): WealthRecord[] => [
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_BCHILE_CLP_LABEL,
    amount: 5_315_725,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_SCOTIA_CLP_LABEL,
    amount: 26_170_993,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: DEBT_CARD_CLP_LABEL,
    amount: 93_256_478,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'investment',
    source: 'Manual',
    label: TENENCIA_CXC_PREFIX_LABEL,
    amount: 1_000_000,
    currency: 'CLP',
  }),
];

const emptyDraft = {
  suraFin: '',
  suraPrev: '',
  btg: '',
  planvital: '',
  global66: '',
  wise: '',
  riskCapitalClp: '',
  riskCapitalUsd: '',
  tenencia: '',
  valorProp: '',
  saldoHipoteca: '',
  bancosClp: '',
  bancosUsd: '',
  tarjetasClp: '',
  tarjetasUsd: '',
};

const may2026GranularBankRecords = (): WealthRecord[] => [
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_BCHILE_CLP_LABEL,
    amount: 163_846,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_SCOTIA_CLP_LABEL,
    amount: 0,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_SANTANDER_CLP_LABEL,
    amount: 0,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_BCHILE_USD_LABEL,
    amount: 5_590,
    currency: 'USD',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_SCOTIA_USD_LABEL,
    amount: 15_000,
    currency: 'USD',
  }),
  makeRecord({
    block: 'bank',
    source: 'Fintoc',
    label: BANK_SANTANDER_USD_LABEL,
    amount: 2_803.57,
    currency: 'USD',
  }),
];

const poorAggregateBankRecords = (): WealthRecord[] => [
  makeRecord({
    block: 'bank',
    source: 'Histórico manual',
    label: BANK_BALANCE_CLP_LABEL,
    amount: 3_659_143,
    currency: 'CLP',
  }),
  makeRecord({
    block: 'bank',
    source: 'Histórico manual',
    label: BANK_BALANCE_USD_LABEL,
    amount: 4_622.47,
    currency: 'USD',
  }),
];

describe('closure edit record draft', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
  });

  it('preserves bank records when only tenencia is edited', () => {
    const { records } = buildEditedClosureRecordsFromDraft({
      records: baseRecords(),
      draft: {
        ...emptyDraft,
        bancosClp: '5315725',
        tenencia: '999000',
      },
      dirtyFields: { tenencia: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T13:00:00.000Z',
    });

    const summary = buildCanonicalClosureSummary(records, fxRates);
    expect(records.some((record) => record.label === BANK_BCHILE_CLP_LABEL)).toBe(true);
    expect(records.some((record) => record.label === BANK_SCOTIA_CLP_LABEL)).toBe(true);
    expect(records.some((record) => record.label === BANK_BALANCE_CLP_LABEL)).toBe(false);
    expect(summary.bankClp).toBe(31_486_718);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
  });

  it('does not replace detailed bank records with a derived aggregate when bank subtotal is edited', () => {
    const { records } = buildEditedClosureRecordsFromDraft({
      records: baseRecords(),
      draft: {
        ...emptyDraft,
        bancosClp: '40000000',
      },
      dirtyFields: { bancosClp: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T13:00:00.000Z',
    });

    const summary = buildCanonicalClosureSummary(records, fxRates);
    expect(records.some((record) => record.label === BANK_BCHILE_CLP_LABEL)).toBe(true);
    expect(records.some((record) => record.label === BANK_SCOTIA_CLP_LABEL)).toBe(true);
    expect(records.some((record) => record.label === BANK_BALANCE_CLP_LABEL && record.amount === 40_000_000)).toBe(false);
    expect(records.some((record) => record.label === DEBT_CARD_CLP_LABEL)).toBe(true);
    expect(summary.bankClp).toBe(31_486_718);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
  });

  it('adds a detailed USD bank adjustment and recalculates summary from closure records', () => {
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 10_135,
        currency: 'USD',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_USD_LABEL,
        amount: 15_000,
        currency: 'USD',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 1_000_000,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'debt',
        source: 'Manual',
        label: DEBT_CARD_CLP_LABEL,
        amount: 500_000,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'real_estate',
        source: 'Manual',
        label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
        amount: 3000,
        currency: 'UF',
      }),
      makeRecord({
        block: 'debt',
        source: 'Manual',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 1000,
        currency: 'UF',
      }),
    ];
    const before = buildCanonicalClosureSummary(records, fxRates);
    const detailDraft = Object.fromEntries(records.map((record) => [record.id, String(record.amount)]));

    const nextRecords = buildClosureRecordsFromDetailDraft({
      records,
      detailDraft,
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      bankUsdAdjustment: 3000,
      note: 'Corrección bancos USD',
    });
    const after = buildCanonicalClosureSummary(nextRecords, fxRates);
    const bankUsdNative = nextRecords
      .filter((record) => record.block === 'bank' && record.currency === 'USD')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    expect(bankUsdNative).toBe(28_135);
    expect(nextRecords.some((record) => record.label === 'Ajuste bancos USD — Junio de 2026')).toBe(true);
    expect(nextRecords.some((record) => record.label === BANK_BALANCE_USD_LABEL)).toBe(false);
    expect(after.bankClp - before.bankClp).toBe(3000 * fxRates.usdClp);
    expect(after.nonMortgageDebtClp).toBe(before.nonMortgageDebtClp);
    expect(after.realEstateAssetsClp).toBe(before.realEstateAssetsClp);
    expect(after.mortgageDebtClp).toBe(before.mortgageDebtClp);
    expect(after.netClp - before.netClp).toBe(3000 * fxRates.usdClp);
    expect(JSON.stringify(nextRecords)).not.toMatch(/NaN|undefined/);
  });

  it('uses closure fx when adding usd bank adjustment', () => {
    const closureFx = {
      usdClp: 891,
      eurClp: 991,
      ufClp: 39_111,
    };
    localStorage.setItem(
      'wealth_fx_rates_v1',
      JSON.stringify({ usdClp: 1000, eurClp: 1200, ufClp: 45_000 }),
    );
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 10_135,
        currency: 'USD',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_USD_LABEL,
        amount: 15_000,
        currency: 'USD',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 1_000_000,
        currency: 'CLP',
      }),
    ];
    const closure = {
      id: 'closure-jun-2026',
      monthKey: '2026-06',
      closedAt: '2026-06-30T23:59:59.000Z',
      fxRates: closureFx,
    };
    const before = buildHistoricalClosureSnapshot({ closure, records });
    const nextRecords = buildClosureRecordsFromDetailDraft({
      records,
      detailDraft: Object.fromEntries(records.map((record) => [record.id, String(record.amount)])),
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      bankUsdAdjustment: 3000,
      note: 'Correccion bancos USD',
      closureFx,
      closureId: closure.id,
      closureClosedAt: closure.closedAt,
    });
    const after = buildHistoricalClosureSnapshot({ closure, records: nextRecords });
    const finalUsd = nextRecords
      .filter((record) => record.block === 'bank' && record.currency === 'USD')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    expect(before?.fx.usdClp).toBe(891);
    expect(after?.fx.usdClp).toBe(891);
    expect(finalUsd).toBe(28_135);
    expect(after?.summary.bankClp).toBe(before!.summary.bankClp + 3000 * 891);
    expect(after?.summary.bankClp).not.toBe(before!.summary.bankClp + 3000 * 950);
    expect(after?.summary.bankClp).not.toBe(before!.summary.bankClp + 3000 * 1000);
    expect(after?.summary.netClp).toBe(before!.summary.netClp + 3000 * 891);
  });

  it('uses closure uf when editing uf fields', () => {
    const closure = {
      id: 'closure-jun-2026',
      monthKey: '2026-06',
      closedAt: '2026-06-30T23:59:59.000Z',
      fxRates: {
        usdClp: 891,
        eurClp: 991,
        ufClp: 38_765,
      },
    };
    localStorage.setItem(
      'wealth_fx_rates_v1',
      JSON.stringify({ usdClp: 1000, eurClp: 1200, ufClp: 42_000 }),
    );
    const records: WealthRecord[] = [
      makeRecord({
        block: 'real_estate',
        source: 'Manual',
        label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
        amount: 3000,
        currency: 'UF',
      }),
      makeRecord({
        block: 'debt',
        source: 'Manual',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 1000,
        currency: 'UF',
      }),
    ];
    const before = buildHistoricalClosureSnapshot({ closure, records });
    const nextRecords = buildClosureRecordsFromDetailDraft({
      records,
      detailDraft: {
        [records[0].id]: '3100',
        [records[1].id]: '1000',
      },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      closureFx: closure.fxRates,
      closureId: closure.id,
      closureClosedAt: closure.closedAt,
    });
    const after = buildHistoricalClosureSnapshot({ closure, records: nextRecords });

    expect(after?.summary.realEstateAssetsClp).toBe(before!.summary.realEstateAssetsClp + 100 * 38_765);
    expect(after?.summary.realEstateAssetsClp).not.toBe(before!.summary.realEstateAssetsClp + 100 * 42_000);
    expect(after?.summary.realEstateNetClp).toBe(before!.summary.realEstateNetClp + 100 * 38_765);
  });

  it('does not read live month records during historical closure edit', () => {
    const closure = {
      id: 'closure-jun-2026',
      monthKey: '2026-06',
      closedAt: '2026-06-30T23:59:59.000Z',
      fxRates: {
        usdClp: 891,
        eurClp: 991,
        ufClp: 38_765,
      },
    };
    const juneRecords: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 25_135,
        currency: 'USD',
      }),
    ];
    const julyLiveRecords: WealthRecord[] = [
      {
        ...makeRecord({
          block: 'bank',
          source: 'Fintoc',
          label: BANK_BCHILE_CLP_LABEL,
          amount: 50_000_000,
          currency: 'CLP',
        }),
        id: 'live-july-bank',
        snapshotDate: '2026-07-01',
      },
    ];
    saveWealthRecords(julyLiveRecords, { skipCloudSync: true, silent: true });

    const nextRecords = buildClosureRecordsFromDetailDraft({
      records: juneRecords,
      detailDraft: { [juneRecords[0].id]: '28135' },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      closureFx: closure.fxRates,
      closureId: closure.id,
      closureClosedAt: closure.closedAt,
    });
    const after = buildHistoricalClosureSnapshot({ closure, records: nextRecords });

    expect(loadWealthRecords()).toEqual(julyLiveRecords);
    expect(after?.summary.bankClp).toBe(28_135 * 891);
    expect(after?.summary.bankClp).not.toBe(50_000_000 + 28_135 * 891);
  });

  it('does not mutate live records', () => {
    const liveRecords: WealthRecord[] = [
      {
        ...makeRecord({
          block: 'investment',
          source: 'Manual',
          label: TENENCIA_CXC_PREFIX_LABEL,
          amount: 77_000_000,
          currency: 'CLP',
        }),
        id: 'live-current-record',
        snapshotDate: '2026-07-01',
      },
    ];
    const closureRecords: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 25_135,
        currency: 'USD',
      }),
    ];
    saveWealthRecords(liveRecords, { skipCloudSync: true, silent: true });

    buildClosureRecordsFromDetailDraft({
      records: closureRecords,
      detailDraft: { [closureRecords[0].id]: '28135' },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      closureFx: { usdClp: 891, eurClp: 991, ufClp: 38_765 },
      closureId: 'closure-jun-2026',
      closureClosedAt: '2026-06-30T23:59:59.000Z',
    });

    expect(loadWealthRecords()).toEqual(liveRecords);
  });

  it('manual adjustment metadata stores closure context', () => {
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 25_135,
        currency: 'USD',
      }),
    ];
    const nextRecords = buildClosureRecordsFromDetailDraft({
      records,
      detailDraft: { [records[0].id]: '25135' },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      bankUsdAdjustment: 3000,
      note: 'Correccion bancos USD',
      closureFx: { usdClp: 891, eurClp: 991, ufClp: 38_765 },
      closureId: 'closure-jun-2026',
      closureClosedAt: '2026-06-30T23:59:59.000Z',
    });
    const adjustment = nextRecords.find((record) => record.label === 'Ajuste bancos USD — Junio de 2026');
    const metadata = adjustment ? JSON.parse(String(adjustment.note || '{}')) : null;

    expect(metadata).toMatchObject({
      type: 'manual_closure_detail_adjustment',
      monthKey: '2026-06',
      currency: 'USD',
      deltaNative: 3000,
      closureId: 'closure-jun-2026',
      closureClosedAt: '2026-06-30T23:59:59.000Z',
      closureSnapshotDate: '2026-06-01',
      fxUsed: {
        usdClp: 891,
        eurClp: 991,
        ufClp: 38_765,
      },
    });
  });

  it('requires stored snapshot fx for historical closure edit', () => {
    expect(resolveHistoricalClosureEditFx(null)).toBe(null);
    expect(
      resolveHistoricalClosureEditFx({
        fxRates: {
          usdClp: 0,
          eurClp: 991,
          ufClp: 38_765,
        },
      }),
    ).toBe(null);
    expect(
      resolveHistoricalClosureEditFx({
        fxRates: {
          usdClp: 891,
          eurClp: 991,
          ufClp: 38_765,
        },
      }),
    ).toEqual({
      usdClp: 891,
      eurClp: 991,
      ufClp: 38_765,
    });
  });

  it('does not remove non-mortgage debt stored as bank when unrelated fields change', () => {
    const { records } = buildEditedClosureRecordsFromDraft({
      records: baseRecords(),
      draft: {
        ...emptyDraft,
        tenencia: '1100000',
      },
      dirtyFields: { tenencia: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T13:00:00.000Z',
    });

    const summary = buildCanonicalClosureSummary(records, fxRates);
    expect(records.some((record) => record.block === 'bank' && record.label === DEBT_CARD_CLP_LABEL)).toBe(true);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
  });

  it('preserves bank and non-mortgage debt through close then minor investment edit', () => {
    const created = createMonthlyClosure(baseRecords(), fxRates, new Date('2026-04-30T23:59:59.000Z'));
    const persisted = loadClosures().find((closure) => closure.monthKey === created.monthKey);

    expect(persisted?.summary.bankClp).toBe(31_486_718);
    expect(persisted?.summary.nonMortgageDebtClp).toBe(93_256_478);

    const { records } = buildEditedClosureRecordsFromDraft({
      records: persisted?.records || [],
      draft: {
        ...emptyDraft,
        bancosClp: '5315725',
        tenencia: '999000',
      },
      dirtyFields: { tenencia: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T23:59:59.000Z',
    });

    const summary = buildCanonicalClosureSummary(records, fxRates);
    expect(records.some((record) => record.label === BANK_BCHILE_CLP_LABEL)).toBe(true);
    expect(records.some((record) => record.label === BANK_SCOTIA_CLP_LABEL)).toBe(true);
    expect(records.some((record) => record.label === DEBT_CARD_CLP_LABEL)).toBe(true);
    expect(summary.bankClp).toBe(31_486_718);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
  });

  it('flags a partial bank closure and prefers a richer previous version in audit preview', () => {
    const currentSummary = {
      netClp: 1_660_054_327,
      netClpWithRisk: 1_660_054_327,
      netConsolidatedClp: 1_660_054_327,
      investmentClp: 1_499_488_194,
      riskCapitalClp: 0,
      investmentClpWithRisk: 1_499_488_194,
      bankClp: 5_315_725,
      nonMortgageDebtClp: 93_256_478,
      realEstateNetClp: 248_506_886,
    };
    const previousSummary = buildCanonicalClosureSummary(baseRecords(), fxRates);
    const currentSnapshot = buildClosureAuditSnapshot({
      closure: {
        id: 'current-april',
        monthKey: '2026-04',
        closedAt: '2026-04-30T23:59:59.000Z',
        summary: currentSummary,
        fxRates,
        records: [
          baseRecords()[0],
          baseRecords()[2],
          baseRecords()[3],
        ],
      },
      includeRiskCapitalInTotals: false,
      fallbackFx: fxRates,
    });
    const previousCandidate = {
      ...buildClosureAuditSnapshot({
        closure: {
          id: 'prev-april',
          monthKey: '2026-04',
          closedAt: '2026-04-30T21:00:00.000Z',
          summary: previousSummary,
          fxRates,
          records: baseRecords(),
        },
        includeRiskCapitalInTotals: false,
        fallbackFx: fxRates,
      }),
      bankDeltaVsCurrent: 31_486_718 - 5_315_725,
      debtDeltaVsCurrent: 93_256_478 - 93_256_478,
      totalDeltaVsCurrent: previousSummary.netClp - currentSummary.netClp,
      candidateScore: 0,
      candidateReason: 'PreviousVersion 1 contiene más bancos que la versión actual.',
    };

    const diagnosis = buildClosureAuditDiagnosis({
      current: currentSnapshot,
      previousVersions: [previousCandidate],
      comparisonBankClp: 31_486_718,
    });

    expect(diagnosis.recommendedCandidateId).toBe('prev-april');
    expect(diagnosis.messages.some((message) => message.includes('Actual parece incompleto en bancos'))).toBe(true);
    expect(diagnosis.messages.some((message) => message.includes('contiene más bancos'))).toBe(true);
  });

  it('restores only banks from previousVersion 2 and preserves current debt and investment', () => {
    const currentRecords = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BALANCE_CLP_LABEL,
        amount: 5_315_725,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: DEBT_CARD_CLP_LABEL,
        amount: 93_256_478,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'investment',
        source: 'Manual',
        label: TENENCIA_CXC_PREFIX_LABEL,
        amount: 999_000,
        currency: 'CLP',
      }),
    ];
    const sourceRecords = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 5_315_725,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_CLP_LABEL,
        amount: 26_170_993,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'investment',
        source: 'Manual',
        label: TENENCIA_CXC_PREFIX_LABEL,
        amount: 1_000_000,
        currency: 'CLP',
      }),
    ];
    const currentClosure = {
      id: 'current-april',
      monthKey: '2026-04',
      closedAt: '2026-04-30T23:59:59.000Z',
      summary: buildCanonicalClosureSummary(currentRecords, fxRates),
      fxRates,
      records: currentRecords,
      previousVersions: [
        {
          id: 'prev-1',
          monthKey: '2026-04',
          closedAt: '2026-04-30T22:00:00.000Z',
          summary: buildCanonicalClosureSummary(currentRecords, fxRates),
          fxRates,
          records: currentRecords,
        },
        {
          id: 'prev-2',
          monthKey: '2026-04',
          closedAt: '2026-04-30T21:00:00.000Z',
          summary: buildCanonicalClosureSummary(sourceRecords, fxRates),
          fxRates,
          records: sourceRecords,
        },
      ],
    };
    const preview = buildApril2026BankRepairPreview({
      currentClosure,
      sourceVersion: currentClosure.previousVersions[1],
      includeRiskCapitalInTotals: false,
      fallbackFx: fxRates,
      createdAt: '2026-04-30T23:59:59.000Z',
    });

    expect(preview.ok).toBe(true);
    expect(preview.proposed?.bankClp).toBe(31_486_718);
    expect(preview.proposed?.nonMortgageDebtClp).toBe(93_256_478);
    expect(preview.proposed?.investmentClp).toBe(999_000);
    expect(preview.records.some((record) => record.label === BANK_SCOTIA_CLP_LABEL)).toBe(true);
    expect(preview.records.some((record) => record.label === BANK_BALANCE_CLP_LABEL)).toBe(false);
    expect(preview.records.some((record) => record.label === DEBT_CARD_CLP_LABEL)).toBe(true);

    saveClosures([currentClosure]);
    const repaired = upsertMonthlyClosure({
      monthKey: '2026-04',
      records: preview.records,
      fxRates,
      closedAt: '2026-05-01T00:00:00.000Z',
    });
    const persisted = loadClosures().find((closure) => closure.monthKey === '2026-04');

    expect(repaired.summary.bankClp).toBe(31_486_718);
    expect(repaired.summary.nonMortgageDebtClp).toBe(93_256_478);
    expect(repaired.summary.investmentClp).toBe(999_000);
    expect(persisted?.previousVersions?.[0]?.summary.bankClp).toBe(5_315_725);
    expect(persisted?.previousVersions?.[0]?.summary.nonMortgageDebtClp).toBe(93_256_478);
  });

  it('blocks inconsistent banks even when bank fields are dirty', () => {
    const visibleClosure = createMonthlyClosure(baseRecords(), fxRates, new Date('2026-04-30T23:59:59.000Z'));

    const { records } = buildEditedClosureRecordsFromDraft({
      records: visibleClosure.records || [],
      draft: {
        ...emptyDraft,
        bancosClp: '3659143',
        bancosUsd: '4622.47',
      },
      dirtyFields: { bancosClp: true, bancosUsd: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T23:59:59.000Z',
    });

    const audit = buildClosureBlockIntegrityAudit({
      closure: visibleClosure,
      editableRecords: records,
      fxRates: { ...fxRates, usdClp: 893 },
    });

    expect(audit.status).toBe('blocked');
    expect(audit.reasons).toContain('editable_detail_diverges_from_visible_bank_total');
  });

  it('allows dirty bank edits when editable detail matches the visible subtotal', () => {
    const visibleClosure = createMonthlyClosure(baseRecords(), fxRates, new Date('2026-04-30T23:59:59.000Z'));

    const { records } = buildEditedClosureRecordsFromDraft({
      records: visibleClosure.records || [],
      draft: {
        ...emptyDraft,
        bancosClp: '31486718',
      },
      dirtyFields: { bancosClp: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T23:59:59.000Z',
    });

    const audit = buildClosureBlockIntegrityAudit({
      closure: visibleClosure,
      editableRecords: records,
      fxRates,
    });

    expect(audit.status).toBe('ok');
    expect(audit.editableBankClp).toBe(31_486_718);
  });

  it('blocks inconsistent debt even when debt fields are dirty', () => {
    const visibleClosure = createMonthlyClosure(baseRecords(), fxRates, new Date('2026-04-30T23:59:59.000Z'));

    const { records } = buildEditedClosureRecordsFromDraft({
      records: visibleClosure.records || [],
      draft: {
        ...emptyDraft,
        tarjetasClp: '0',
      },
      dirtyFields: { tarjetasClp: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T23:59:59.000Z',
    });

    const audit = buildClosureBlockIntegrityAudit({
      closure: visibleClosure,
      editableRecords: records,
      fxRates,
    });

    expect(audit.status).toBe('blocked');
    expect(audit.reasons).toContain('editable_detail_diverges_from_visible_non_mortgage_debt');
  });

  it('allows dirty debt edits when editable detail matches the visible subtotal', () => {
    const visibleClosure = createMonthlyClosure(baseRecords(), fxRates, new Date('2026-04-30T23:59:59.000Z'));

    const { records } = buildEditedClosureRecordsFromDraft({
      records: visibleClosure.records || [],
      draft: {
        ...emptyDraft,
        tarjetasClp: '93256478',
      },
      dirtyFields: { tarjetasClp: true },
      monthKey: '2026-04',
      createdAt: '2026-04-30T23:59:59.000Z',
    });

    const audit = buildClosureBlockIntegrityAudit({
      closure: visibleClosure,
      editableRecords: records,
      fxRates,
    });

    expect(audit.status).toBe('ok');
    expect(audit.editableDebtClp).toBe(93_256_478);
  });

  it('does not allow touching a bank cell to collapse a visible 21MM subtotal into ~7MM', () => {
    const visibleClosure = {
      id: 'visible-may',
      monthKey: '2026-05',
      closedAt: '2026-05-31T23:59:59.000Z',
      fxRates: { ...fxRates, usdClp: 893 },
      summary: {
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
      },
    };

    const { records } = buildEditedClosureRecordsFromDraft({
      records: [
        makeRecord({ block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 21_007_516, currency: 'CLP' }),
        makeRecord({ block: 'bank', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
        makeRecord({ block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_USD_LABEL, amount: 0, currency: 'USD' }),
      ],
      draft: {
        ...emptyDraft,
        bancosClp: '3659143',
        bancosUsd: '4622.47',
      },
      dirtyFields: { bancosClp: true, bancosUsd: true },
      monthKey: '2026-05',
      createdAt: '2026-05-31T23:59:59.000Z',
    });

    const audit = buildClosureBlockIntegrityAudit({
      closure: visibleClosure as any,
      editableRecords: records,
      fxRates: { ...fxRates, usdClp: 893 },
    });

    expect(audit.status).toBe('blocked');
    expect(audit.visibleBankClp).toBe(21_007_516);
    expect(audit.editableBankClp).toBe(7_787_009);
  });

  it('does not create a reconciliation line automatically when a bank cell is touched in normal flow', () => {
    const visibleClosure = {
      id: 'visible-may',
      monthKey: '2026-05',
      closedAt: '2026-05-31T23:59:59.000Z',
      fxRates: { ...fxRates, usdClp: 893 },
      summary: {
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
      },
    };

    const { records } = buildEditedClosureRecordsFromDraft({
      records: [
        makeRecord({ block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 21_007_516, currency: 'CLP' }),
        makeRecord({ block: 'debt', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
      ],
      draft: {
        ...emptyDraft,
        bancosClp: '3659143',
        bancosUsd: '4622.47',
      },
      dirtyFields: { bancosClp: true, bancosUsd: true },
      monthKey: '2026-05',
      createdAt: '2026-05-31T23:59:59.000Z',
    });

    const recovery = reconcileClosureDetailRecords({
      closure: visibleClosure as any,
      records,
      fxRates: { ...fxRates, usdClp: 893 },
      monthKey: '2026-05',
      allowLegacySyntheticReconciliation: false,
    });

    expect(recovery.status).toBe('blocked');
    expect(recovery.records.some((item) => item.label === 'Saldo bancario no desglosado')).toBe(false);
  });

  it('reports requiresBreakdown when editable bank detail cannot recover the visible subtotal', () => {
    const visibleClosure = {
      id: 'visible-may',
      monthKey: '2026-05',
      closedAt: '2026-05-31T23:59:59.000Z',
      fxRates: { ...fxRates, usdClp: 893 },
      summary: {
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
      },
    };
    const editableRecords = [
      makeRecord({ block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_CLP_LABEL, amount: 3_659_143, currency: 'CLP' }),
      makeRecord({ block: 'bank', source: 'Edición cierre', label: BANK_BALANCE_USD_LABEL, amount: 4_622.47, currency: 'USD' }),
      makeRecord({ block: 'debt', source: 'Edición cierre', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000, currency: 'CLP' }),
    ];

    const audit = buildClosureDetailRecoveryAudit({
      closure: visibleClosure as any,
      editableRecords,
      fxRates: { ...fxRates, usdClp: 893 },
    });

    expect(audit.requiresBreakdown).toBe(true);
    expect(audit.reasons).toContain('bank_visible_subtotal_requires_breakdown');
  });

  it('loads closure edit draft from granular bank records instead of poor aggregates for may 2026', () => {
    const draft = buildClosureEditDraftFromRecords([
      ...may2026GranularBankRecords(),
      ...poorAggregateBankRecords(),
      makeRecord({
        block: 'debt',
        source: 'Fintoc',
        label: DEBT_CARD_CLP_LABEL,
        amount: 93_200_000,
        currency: 'CLP',
      }),
    ]);

    expect(draft.bancosClp).toBe('163846');
    expect(draft.bancosUsd).toBe('23393.57');
  });

  it('loads closure edit draft from june provider rows when granular bank records exist', () => {
    const draft = buildClosureEditDraftFromRecords([
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 163_846,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_CLP_LABEL,
        amount: 1_002_297,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SANTANDER_CLP_LABEL,
        amount: 28_013,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_USD_LABEL,
        amount: 5_819,
        currency: 'USD',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SCOTIA_USD_LABEL,
        amount: 14_000,
        currency: 'USD',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_SANTANDER_USD_LABEL,
        amount: 2_803.57,
        currency: 'USD',
      }),
      ...poorAggregateBankRecords(),
    ]);

    expect(draft.bancosClp).toBe('1194156');
    expect(draft.bancosUsd).toBe('22622.57');
  });
});
