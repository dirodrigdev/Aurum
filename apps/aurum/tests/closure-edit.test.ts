import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  auth: {},
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import { buildEditedClosureRecordsFromDraft } from '../src/pages/ClosingAurum';
import {
  BANK_BCHILE_CLP_LABEL,
  BANK_BALANCE_CLP_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  TENENCIA_CXC_PREFIX_LABEL,
  buildCanonicalClosureSummary,
  createMonthlyClosure,
  loadClosures,
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

  it('replaces bank records with an aggregate only when bank is explicitly edited', () => {
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
    expect(records.some((record) => record.label === BANK_BCHILE_CLP_LABEL)).toBe(false);
    expect(records.some((record) => record.label === BANK_SCOTIA_CLP_LABEL)).toBe(false);
    expect(records.some((record) => record.label === BANK_BALANCE_CLP_LABEL && record.amount === 40_000_000)).toBe(true);
    expect(records.some((record) => record.label === DEBT_CARD_CLP_LABEL)).toBe(true);
    expect(summary.bankClp).toBe(40_000_000);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
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
});
