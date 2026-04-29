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
  buildCanonicalClosureSummary,
  computeWealthHomeSectionAmounts,
  importHistoricalClosuresFromCsv,
  loadClosures,
  loadClosuresFromRaw,
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
});
