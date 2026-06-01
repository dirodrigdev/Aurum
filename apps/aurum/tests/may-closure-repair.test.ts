import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BCHILE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  buildCanonicalClosureSummary,
  loadClosures,
  repairMay2026NonMortgageDebtClosure,
  saveClosures,
  saveFxRates,
  saveWealthRecords,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../src/services/wealthStorage';

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

const fx = { usdClp: 893, eurClp: 970, ufClp: 39000 };

const record = (
  id: string,
  block: WealthRecord['block'],
  label: string,
  amount: number,
  currency: WealthRecord['currency'] = 'CLP',
): WealthRecord => ({
  id,
  block,
  source: 'Manual',
  label,
  amount,
  currency,
  snapshotDate: '2026-05-31',
  createdAt: '2026-05-31T12:00:00.000Z',
});

describe('may 2026 closure repair', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    saveFxRates(fx);
  });

  it('repairs same 2026-05 closure with canonical non-mortgage debt and no duplicate', async () => {
    const mayRecords: WealthRecord[] = [
      record('bank-1', 'bank', BANK_BCHILE_CLP_LABEL, 21_007_516),
      record('inv-1', 'investment', 'BTG total valorizacion', 1_525_849_377),
      record('risk-1', 'investment', RISK_CAPITAL_LABEL_CLP, 279_822_000),
      record('re-1', 'real_estate', 'Valor propiedad', 252_860_424),
      record('debt-1', 'debt', DEBT_CARD_CLP_LABEL, 93_200_000),
    ];
    saveWealthRecords(mayRecords, { skipCloudSync: true, silent: true });

    const wrongClosure: WealthMonthlyClosure = {
      id: 'closure-may-bad',
      monthKey: '2026-05',
      closedAt: '2026-05-31T23:00:00.000Z',
      fxRates: fx,
      records: mayRecords.filter((item) => item.block !== 'debt'),
      summary: {
        ...buildCanonicalClosureSummary(mayRecords.filter((item) => item.block !== 'debt'), fx),
        nonMortgageDebtClp: 0,
        netClp: 1_799_717_319,
      },
    };
    saveClosures([wrongClosure], { skipCloudSync: true, silent: true });

    const result = await repairMay2026NonMortgageDebtClosure();
    expect(result.ok).toBe(true);

    const repaired = loadClosures().filter((item) => item.monthKey === '2026-05');
    expect(repaired).toHaveLength(1);
    expect(repaired[0].summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(repaired[0].summary.netClp).toBe(1_706_517_317);
    expect(repaired[0].previousVersions?.length || 0).toBeGreaterThan(0);
    expect(repaired[0].repairAudit?.[0]?.reason).toBe(
      'repair_non_mortgage_debt_omitted_from_may_2026_closure',
    );
    expect(repaired[0].repairAudit?.[0]?.previousNonMortgageDebtClp).toBe(0);
    expect(repaired[0].repairAudit?.[0]?.repairedNonMortgageDebtClp).toBe(93_200_000);
  });

  it('fails when no canonical debt is present in source records', async () => {
    const mayRecords: WealthRecord[] = [
      record('bank-1', 'bank', BANK_BCHILE_CLP_LABEL, 21_007_516),
      record('inv-1', 'investment', 'BTG total valorizacion', 1_525_849_377),
      record('re-1', 'real_estate', 'Valor propiedad', 252_860_424),
    ];
    saveWealthRecords(mayRecords, { skipCloudSync: true, silent: true });

    const wrongClosure: WealthMonthlyClosure = {
      id: 'closure-may-bad',
      monthKey: '2026-05',
      closedAt: '2026-05-31T23:00:00.000Z',
      fxRates: fx,
      records: mayRecords,
      summary: {
        ...buildCanonicalClosureSummary(mayRecords, fx),
        nonMortgageDebtClp: 0,
      },
    };
    saveClosures([wrongClosure], { skipCloudSync: true, silent: true });

    const result = await repairMay2026NonMortgageDebtClosure();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('no hipotecaria');
  });
});

