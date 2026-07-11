import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BCHILE_CLP_LABEL,
  BANK_BALANCE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  buildCanonicalClosureSummary,
  computeWealthHomeSectionAmounts,
  importHistoricalClosuresFromCsv,
  listSuspiciousHistoricalUfClosures,
  loadClosures,
  loadClosuresFromRaw,
  repairKnownHistoricalUfClpClosures,
  repairHistoricalUfClpMonth,
  saveClosures,
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

describe('canonical closure summary', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
  });

  it('persists canonical bank and non-mortgage debt subtotals for new closures', () => {
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 5_315_725,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Calculado',
        label: BANK_BALANCE_CLP_LABEL,
        amount: 31_486_718,
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
        source: 'BTG',
        label: 'BTG total valorizacion',
        amount: 1_499_488_194,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'real_estate',
        source: 'Manual',
        label: 'Valor propiedad',
        amount: 248_506_886,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'debt',
        source: 'Banco',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 10_000_000,
        currency: 'CLP',
      }),
    ];

    const summary = buildCanonicalClosureSummary(records, fxRates);

    expect(summary.bankClp).toBe(5_315_725);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
    expect(summary.realEstateNetClp).toBe(238_506_886);
    expect(summary.realEstateAssetsClp).toBe(248_506_886);
    expect(summary.mortgageDebtClp).toBe(10_000_000);
    expect(summary.netClp).toBe(1_650_054_327);

    const closureLikeAmounts = computeWealthHomeSectionAmounts(records, fxRates);
    expect(summary.bankClp).toBe(closureLikeAmounts.bank);
    expect(summary.nonMortgageDebtClp).toBe(closureLikeAmounts.nonMortgageDebt);
    expect(summary.realEstateNetClp).toBe(closureLikeAmounts.realEstateNet);
    expect(summary.netClp).toBe(closureLikeAmounts.totalNetClp);
  });

  it('treats non-mortgage block debt outside the whitelist as close debt', () => {
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 21_007_516,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'investment',
        source: 'BTG',
        label: 'BTG total valorizacion',
        amount: 1_525_849_377,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'investment',
        source: 'Manual',
        label: RISK_CAPITAL_LABEL_CLP,
        amount: 279_822_000,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'real_estate',
        source: 'Manual',
        label: 'Valor propiedad',
        amount: 252_754_619,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'debt',
        source: 'Manual',
        label: 'Deuda no hipotecaria vigente',
        amount: 93_200_000,
        currency: 'CLP',
      }),
    ];

    const summary = buildCanonicalClosureSummary(records, fxRates);
    const previewAmounts = computeWealthHomeSectionAmounts(
      records.filter((record) => record.label !== RISK_CAPITAL_LABEL_CLP),
      fxRates,
    );

    expect(summary.investmentClp).toBe(1_525_849_377);
    expect(summary.riskCapitalClp).toBe(279_822_000);
    expect(summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(summary.netClp).toBe(1_706_411_512);
    expect(previewAmounts.nonMortgageDebt).toBe(93_200_000);
    expect(previewAmounts.totalNetClp).toBe(summary.netClp);
  });

  it('normalizes raw closures and previous versions with canonical fields when records exist', () => {
    const records: WealthRecord[] = [
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_BCHILE_CLP_LABEL, amount: 500, currency: 'CLP' }),
      makeRecord({ block: 'bank', source: 'Calculado', label: BANK_BALANCE_CLP_LABEL, amount: 900, currency: 'CLP' }),
      makeRecord({ block: 'bank', source: 'Fintoc', label: DEBT_CARD_CLP_LABEL, amount: 100, currency: 'CLP' }),
      makeRecord({ block: 'investment', source: 'BTG', label: 'BTG total valorizacion', amount: 1000, currency: 'CLP' }),
      makeRecord({ block: 'real_estate', source: 'Manual', label: 'Valor propiedad', amount: 400, currency: 'CLP' }),
      makeRecord({ block: 'debt', source: 'Banco', label: MORTGAGE_DEBT_BALANCE_LABEL, amount: 80, currency: 'CLP' }),
    ];

    const [closure] = loadClosuresFromRaw([
      {
        id: 'raw-closure',
        monthKey: '2026-04',
        closedAt: '2026-04-30T23:59:59.000Z',
        fxRates,
        records,
        summary: {
          netConsolidatedClp: 9999,
          byBlock: {
            bank: { CLP: 900, USD: 0, EUR: 0, UF: 0 },
            investment: { CLP: 1000, USD: 0, EUR: 0, UF: 0 },
            real_estate: { CLP: 400, USD: 0, EUR: 0, UF: 0 },
            debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
          },
        },
        previousVersions: [
          {
            id: 'previous-version',
            monthKey: '2026-04',
            closedAt: '2026-04-29T23:59:59.000Z',
            fxRates,
            records,
            summary: { netConsolidatedClp: 9999 },
          },
        ],
      },
    ]);

    expect(closure.summary.bankClp).toBe(500);
    expect(closure.summary.nonMortgageDebtClp).toBe(100);
    expect(closure.summary.realEstateAssetsClp).toBe(400);
    expect(closure.summary.mortgageDebtClp).toBe(80);
    expect(closure.summary.realEstateNetClp).toBe(320);
    expect(closure.summary.netClp).toBe(1720);
    expect(closure.previousVersions?.[0]?.summary.bankClp).toBe(500);
    expect(closure.previousVersions?.[0]?.summary.nonMortgageDebtClp).toBe(100);
  });

  it('keeps legacy summary-only closures untouched when records are missing', () => {
    const [closure] = loadClosuresFromRaw([
      {
        id: 'legacy-summary-only',
        monthKey: '2026-03',
        closedAt: '2026-03-31T23:59:59.000Z',
        summary: {
          netConsolidatedClp: 1234,
          byBlock: {
            bank: { CLP: 1234, USD: 0, EUR: 0, UF: 0 },
            investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
            real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
            debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
          },
        },
      },
    ]);

    expect(closure.summary.netConsolidatedClp).toBe(1234);
    expect(closure.summary.bankClp).toBeUndefined();
    expect(closure.summary.nonMortgageDebtClp).toBeUndefined();
    expect(closure.summary.realEstateNetClp).toBeUndefined();
  });

  it('rebuilds summary debt from canonical records even without manual edits', () => {
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 21_007_516,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'investment',
        source: 'BTG',
        label: 'BTG total valorizacion',
        amount: 1_525_849_377,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'real_estate',
        source: 'Manual',
        label: 'Valor propiedad',
        amount: 252_860_424,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'debt',
        source: 'Manual',
        label: DEBT_CARD_CLP_LABEL,
        amount: 93_200_000,
        currency: 'CLP',
      }),
    ];

    saveClosures([
      {
        id: 'bad-may-closure',
        monthKey: '2026-05',
        closedAt: '2026-05-31T12:00:00.000Z',
        fxRates,
        records,
        summary: {
          ...buildCanonicalClosureSummary(records, fxRates),
          nonMortgageDebtClp: 0,
          netClp: 1_799_717_317,
        },
      },
    ]);

    const repaired = upsertMonthlyClosure({
      monthKey: '2026-05',
      records,
      fxRates,
      closedAt: '2026-05-31T15:00:00.000Z',
    });

    expect(repaired.summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(repaired.summary.netClp).toBe(1_706_517_317);
  });

  it('imports detailed historical closures with canonical summary fields', async () => {
    const csv = [
      'month_key,usd_clp,eur_clp,uf_clp,btg_clp,valor_propiedad_uf,saldo_deuda_hipotecaria_uf,bancos_clp,tarjetas_clp',
      '2026-02,900,1000,40000,1000000,10,2,500000,100000',
    ].join('\n');

    const result = await importHistoricalClosuresFromCsv(csv);
    const [closure] = loadClosures();

    expect(result.importedMonths).toEqual(['2026-02']);
    expect(closure.summary.bankClp).toBe(500_000);
    expect(closure.summary.nonMortgageDebtClp).toBe(100_000);
    expect(closure.summary.realEstateAssetsClp).toBe(400_000);
    expect(closure.summary.mortgageDebtClp).toBe(80_000);
    expect(closure.summary.realEstateNetClp).toBe(320_000);
    expect(closure.summary.netClp).toBe(1_720_000);
  });

  it('detects suspicious historical UF months and repairs only uf_clp with versioning', async () => {
    saveClosures([
      {
        id: '2023-12',
        monthKey: '2023-12',
        closedAt: '2023-12-31T23:59:59.000Z',
        summary: { netConsolidatedClp: 1200, byBlock: { bank: { CLP: 1200, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 870, eurClp: 948.3, ufClp: 39903 },
      },
      {
        id: '2023-11',
        monthKey: '2023-11',
        closedAt: '2023-11-30T23:59:59.000Z',
        summary: { netConsolidatedClp: 1100, byBlock: { bank: { CLP: 1100, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 887, eurClp: 957.96, ufClp: 39784 },
      },
      {
        id: '2023-10',
        monthKey: '2023-10',
        closedAt: '2023-10-31T23:59:59.000Z',
        summary: { netConsolidatedClp: 1000, byBlock: { bank: { CLP: 1000, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 937, eurClp: 983.9, ufClp: 36272 },
      },
    ]);

    const suspicious = listSuspiciousHistoricalUfClosures(loadClosures());
    expect(suspicious.map((item) => item.monthKey)).toContain('2023-11');
    expect(suspicious.map((item) => item.monthKey)).toContain('2023-12');
    expect(suspicious.find((item) => item.monthKey === '2023-11')?.suggestedUfClp).toBe(36563.87);

    const result = await repairHistoricalUfClpMonth({ monthKey: '2023-11', nextUfClp: 36563.87 });
    expect(result.ok).toBe(true);

    const repaired = loadClosures().find((closure) => closure.monthKey === '2023-11');
    expect(repaired?.fxRates?.ufClp).toBe(36563.87);
    expect(repaired?.summary.netConsolidatedClp).toBe(1100);
    expect(repaired?.previousVersions?.[0]?.fxRates?.ufClp).toBe(39784);
    expect(repaired?.repairAudit?.[0]).toMatchObject({
      reason: 'uf_historical_repair',
      field: 'ufClp',
      previousValue: 39784,
      nextValue: 36563.87,
      source: 'official_closing_month_reference',
    });
  });

  it('auto-repairs known official historical UF months and leaves unknown months untouched', async () => {
    saveClosures([
      {
        id: '2024-01',
        monthKey: '2024-01',
        closedAt: '2024-01-31T23:59:59.000Z',
        summary: { netConsolidatedClp: 1300, byBlock: { bank: { CLP: 1300, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 870, eurClp: 948.3, ufClp: 33000 },
      },
      {
        id: '2023-12',
        monthKey: '2023-12',
        closedAt: '2023-12-31T23:59:59.000Z',
        summary: { netConsolidatedClp: 1200, byBlock: { bank: { CLP: 1200, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 870, eurClp: 948.3, ufClp: 39903 },
      },
      {
        id: '2023-11',
        monthKey: '2023-11',
        closedAt: '2023-11-30T23:59:59.000Z',
        summary: { netConsolidatedClp: 1100, byBlock: { bank: { CLP: 1100, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 887, eurClp: 957.96, ufClp: 39784 },
      },
      {
        id: '2023-10',
        monthKey: '2023-10',
        closedAt: '2023-10-31T23:59:59.000Z',
        summary: { netConsolidatedClp: 1000, byBlock: { bank: { CLP: 1000, USD: 0, EUR: 0, UF: 0 }, investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 }, debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 } } },
        fxRates: { usdClp: 937, eurClp: 983.9, ufClp: 36272 },
      },
    ]);

    const result = await repairKnownHistoricalUfClpClosures();
    expect(result.repairedMonthKeys).toEqual(['2023-11', '2023-12']);
    expect(result.skippedMonthKeys).toContain('2024-01');

    const closures = loadClosures();
    expect(closures.find((closure) => closure.monthKey === '2023-11')?.fxRates?.ufClp).toBe(36563.87);
    expect(closures.find((closure) => closure.monthKey === '2023-12')?.fxRates?.ufClp).toBe(36789.36);
    expect(closures.find((closure) => closure.monthKey === '2024-01')?.fxRates?.ufClp).toBe(33000);
  });

  it('persists economic FX metadata without allowing usedFxRates to diverge from fxRates', () => {
    const usedFxRates = { usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 };
    upsertMonthlyClosure({
      monthKey: '2026-06',
      records: [makeRecord({
        block: 'bank',
        source: 'Manual',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 10_000_000,
        currency: 'CLP',
      })],
      fxRates: usedFxRates,
      closedAt: '2026-07-03T10:42:00.000Z',
      fxMetadata: {
        economicMonthKey: '2026-06',
        economicDate: '2026-06-30',
        suggestedFxRates: usedFxRates,
        usedFxRates: { usdClp: 1, eurClp: 1, ufClp: 1 },
        rateOrigin: { usd: 'automatic', eur: 'automatic', uf: 'automatic' },
        source: { usd: 'sii.cl', eur: 'bcentral.cl', uf: 'sii.cl' },
        retrievedAt: '2026-07-03T10:40:00.000Z',
        reconciliation: { status: 'reconciled', checkedAt: '2026-07-03T10:41:00.000Z' },
      },
    });

    const persisted = loadClosures().find((closure) => closure.monthKey === '2026-06');
    expect(persisted?.closedAt).toBe('2026-07-03T10:42:00.000Z');
    expect(persisted?.fxMetadata?.economicDate).toBe('2026-06-30');
    expect(persisted?.fxMetadata?.usedFxRates).toEqual(usedFxRates);
    expect(persisted?.fxRates).toEqual(usedFxRates);

    upsertMonthlyClosure({
      monthKey: '2026-05',
      records: [],
      fxRates,
      closedAt: '2026-06-01T09:00:00.000Z',
    });
    expect(loadClosures().find((closure) => closure.monthKey === '2026-05')?.fxMetadata).toBeUndefined();
  });
});
