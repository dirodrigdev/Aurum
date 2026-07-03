import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  auth: {},
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import { buildClosureRecordsFromDetailDraft } from '../src/pages/ClosingAurum';
import {
  BANK_BCHILE_USD_LABEL,
  BANK_SCOTIA_USD_LABEL,
  DEBT_CARD_CLP_LABEL,
  DEBT_CARD_USD_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  buildCanonicalClosureSummary,
  fillMissingWithPreviousClosure,
  latestRecordsForMonth,
  loadWealthRecords,
  propagateClosureEditToOpenMonth,
  saveClosures,
  saveWealthRecords,
  upsertWealthRecord,
} from '../src/services/wealthStorage';
import type { WealthMonthlyClosure, WealthRecord } from '../src/services/wealthStorage';

const fxJune = {
  usdClp: 891,
  eurClp: 991,
  ufClp: 38_765,
};

const makeRecord = (
  input: Pick<WealthRecord, 'block' | 'source' | 'label' | 'amount' | 'currency'>,
  snapshotDate = '2026-06-30',
): WealthRecord => ({
  id: `${snapshotDate}-${input.block}-${input.label}-${input.currency}`,
  snapshotDate,
  createdAt: `${snapshotDate}T12:00:00.000Z`,
  ...input,
});

const makeClosure = (
  monthKey: string,
  records: WealthRecord[],
  fx = fxJune,
): WealthMonthlyClosure => ({
  id: `closure-${monthKey}`,
  monthKey,
  closedAt: `${monthKey}-30T23:59:59.000Z`,
  fxRates: fx,
  records,
  summary: buildCanonicalClosureSummary(records, fx),
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

describe('closure edit propagation to open month', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
  });

  it('propagates usd bank adjustment from the latest closure to carry-forward live records', () => {
    const juneRecords = [
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_BCHILE_USD_LABEL, amount: 10_135, currency: 'USD' }),
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_SCOTIA_USD_LABEL, amount: 15_000, currency: 'USD' }),
    ];
    const previousClosure = makeClosure('2026-06', juneRecords);
    saveClosures([previousClosure]);
    saveWealthRecords([], { skipCloudSync: true, silent: true });
    fillMissingWithPreviousClosure('2026-07', '2026-07-01');

    const updatedClosureRecords = buildClosureRecordsFromDetailDraft({
      records: juneRecords,
      detailDraft: Object.fromEntries(juneRecords.map((record) => [record.id, String(record.amount)])),
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      bankUsdAdjustment: 3000,
      note: 'Correccion bancos USD',
      closureFx: fxJune,
      closureId: previousClosure.id,
      closureClosedAt: previousClosure.closedAt,
    });
    const updatedClosure = makeClosure('2026-06', updatedClosureRecords);

    const result = propagateClosureEditToOpenMonth({
      previousClosure,
      updatedClosure,
      targetMonthKey: '2026-07',
      snapshotDate: '2026-07-01',
    });
    const julyRecords = latestRecordsForMonth(loadWealthRecords(), '2026-07');
    const julyUsdTotal = julyRecords
      .filter((record) => record.block === 'bank' && record.currency === 'USD')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const propagatedAdjustment = julyRecords.find((record) => record.label === 'Ajuste bancos USD — Junio de 2026');

    expect(result.status).toBe('propagated');
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(julyUsdTotal).toBe(28_135);
    expect(propagatedAdjustment?.note).toContain('propagated_from_closure_edit');
    expect(propagatedAdjustment?.note).toContain('"sourceClosureMonthKey":"2026-06"');
  });

  it('does not duplicate the adjustment when the live month was already updated', () => {
    const juneRecords = [
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_BCHILE_USD_LABEL, amount: 10_135, currency: 'USD' }),
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_SCOTIA_USD_LABEL, amount: 15_000, currency: 'USD' }),
    ];
    const previousClosure = makeClosure('2026-06', juneRecords);
    saveClosures([previousClosure]);
    saveWealthRecords([], { skipCloudSync: true, silent: true });
    fillMissingWithPreviousClosure('2026-07', '2026-07-01');
    upsertWealthRecord({
      block: 'bank',
      source: 'Fintoc API',
      label: BANK_BCHILE_USD_LABEL,
      amount: 13_135,
      currency: 'USD',
      snapshotDate: '2026-07-01',
      note: 'Refresh proveedor julio',
    });

    const updatedClosureRecords = buildClosureRecordsFromDetailDraft({
      records: juneRecords,
      detailDraft: Object.fromEntries(juneRecords.map((record) => [record.id, String(record.amount)])),
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      bankUsdAdjustment: 3000,
      note: 'Correccion bancos USD',
      closureFx: fxJune,
      closureId: previousClosure.id,
      closureClosedAt: previousClosure.closedAt,
    });
    const updatedClosure = makeClosure('2026-06', updatedClosureRecords);

    const result = propagateClosureEditToOpenMonth({
      previousClosure,
      updatedClosure,
      targetMonthKey: '2026-07',
      snapshotDate: '2026-07-01',
    });
    const julyRecords = latestRecordsForMonth(loadWealthRecords(), '2026-07');
    const julyUsdTotal = julyRecords
      .filter((record) => record.block === 'bank' && record.currency === 'USD')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    expect(result.status).toBe('action_required');
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.warnings[0]).toContain('Revisa el mes abierto');
    expect(julyUsdTotal).toBe(28_135);
    expect(julyRecords.some((record) => record.label === 'Ajuste bancos USD — Junio de 2026')).toBe(false);
  });

  it('returns action_required when there is no compatible live record family', () => {
    const juneRecords = [
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_BCHILE_USD_LABEL, amount: 10_135, currency: 'USD' }),
    ];
    const previousClosure = makeClosure('2026-06', juneRecords);
    saveClosures([previousClosure]);
    saveWealthRecords([], { skipCloudSync: true, silent: true });

    const updatedClosureRecords = buildClosureRecordsFromDetailDraft({
      records: juneRecords,
      detailDraft: { [juneRecords[0].id]: '10135' },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      bankUsdAdjustment: 3000,
      note: 'Correccion bancos USD',
      closureFx: fxJune,
      closureId: previousClosure.id,
      closureClosedAt: previousClosure.closedAt,
    });
    const updatedClosure = makeClosure('2026-06', updatedClosureRecords);

    const result = propagateClosureEditToOpenMonth({
      previousClosure,
      updatedClosure,
      targetMonthKey: '2026-07',
      snapshotDate: '2026-07-01',
    });

    expect(result.status).toBe('action_required');
    expect(result.skippedMissing).toBeGreaterThan(0);
    expect(loadWealthRecords()).toEqual([]);
  });

  it('updates carried debt records without flipping their sign', () => {
    const juneRecords = [
      makeRecord({ block: 'debt', source: 'Manual', label: DEBT_CARD_CLP_LABEL, amount: 100_000, currency: 'CLP' }),
      makeRecord({ block: 'debt', source: 'Manual', label: DEBT_CARD_USD_LABEL, amount: 200, currency: 'USD' }),
    ];
    const previousClosure = makeClosure('2026-06', juneRecords);
    saveClosures([previousClosure]);
    saveWealthRecords([], { skipCloudSync: true, silent: true });
    fillMissingWithPreviousClosure('2026-07', '2026-07-01');

    const updatedClosureRecords = buildClosureRecordsFromDetailDraft({
      records: juneRecords,
      detailDraft: {
        [juneRecords[0].id]: '120000',
        [juneRecords[1].id]: '250',
      },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      closureFx: fxJune,
      closureId: previousClosure.id,
      closureClosedAt: previousClosure.closedAt,
    });
    const updatedClosure = makeClosure('2026-06', updatedClosureRecords);

    const result = propagateClosureEditToOpenMonth({
      previousClosure,
      updatedClosure,
      targetMonthKey: '2026-07',
      snapshotDate: '2026-07-01',
    });
    const julyRecords = latestRecordsForMonth(loadWealthRecords(), '2026-07');
    const debtClp = julyRecords.find((record) => record.label === DEBT_CARD_CLP_LABEL);
    const debtUsd = julyRecords.find((record) => record.label === DEBT_CARD_USD_LABEL);

    expect(result.status).toBe('propagated');
    expect(debtClp?.amount).toBe(120_000);
    expect(debtUsd?.amount).toBe(250);
    expect(Number(debtClp?.amount || 0)).toBeGreaterThan(0);
    expect(Number(debtUsd?.amount || 0)).toBeGreaterThan(0);
  });

  it('propagates atomic UF carry-forward fields only when still copied from the last closure', () => {
    const juneRecords = [
      makeRecord({ block: 'real_estate', source: 'Manual', label: REAL_ESTATE_PROPERTY_VALUE_LABEL, amount: 3000, currency: 'UF' }),
      makeRecord({ block: 'debt', source: 'Manual', label: MORTGAGE_DEBT_BALANCE_LABEL, amount: 1000, currency: 'UF' }),
    ];
    const previousClosure = makeClosure('2026-06', juneRecords);
    saveClosures([previousClosure]);
    saveWealthRecords([], { skipCloudSync: true, silent: true });
    fillMissingWithPreviousClosure('2026-07', '2026-07-01');
    upsertWealthRecord({
      block: 'debt',
      source: 'Autocálculo hipotecario',
      label: MORTGAGE_DEBT_BALANCE_LABEL,
      amount: 990,
      currency: 'UF',
      snapshotDate: '2026-07-01',
      note: 'Hipoteca aplicada julio',
    });

    const updatedClosureRecords = buildClosureRecordsFromDetailDraft({
      records: juneRecords,
      detailDraft: {
        [juneRecords[0].id]: '3100',
        [juneRecords[1].id]: '980',
      },
      monthKey: '2026-06',
      createdAt: '2026-07-03T10:00:00.000Z',
      closureFx: fxJune,
      closureId: previousClosure.id,
      closureClosedAt: previousClosure.closedAt,
    });
    const updatedClosure = makeClosure('2026-06', updatedClosureRecords);

    const result = propagateClosureEditToOpenMonth({
      previousClosure,
      updatedClosure,
      targetMonthKey: '2026-07',
      snapshotDate: '2026-07-01',
    });
    const julyRecords = latestRecordsForMonth(loadWealthRecords(), '2026-07');
    const property = julyRecords.find((record) => record.label === REAL_ESTATE_PROPERTY_VALUE_LABEL);
    const mortgage = julyRecords.find((record) => record.label === MORTGAGE_DEBT_BALANCE_LABEL);

    expect(result.status).toBe('partial');
    expect(property?.amount).toBe(3100);
    expect(mortgage?.amount).toBe(990);
  });

  it('does not propagate automatically when the edited closure is not adjacent to the open month', () => {
    const mayRecords = [
      makeRecord({ block: 'bank', source: 'Fintoc', label: BANK_BCHILE_USD_LABEL, amount: 25_135, currency: 'USD' }, '2026-05-31'),
    ];
    const previousClosure = makeClosure('2026-05', mayRecords);
    const updatedClosureRecords = buildClosureRecordsFromDetailDraft({
      records: mayRecords,
      detailDraft: { [mayRecords[0].id]: '28135' },
      monthKey: '2026-05',
      createdAt: '2026-07-03T10:00:00.000Z',
      closureFx: fxJune,
      closureId: previousClosure.id,
      closureClosedAt: previousClosure.closedAt,
    });
    const updatedClosure = makeClosure('2026-05', updatedClosureRecords);

    const result = propagateClosureEditToOpenMonth({
      previousClosure,
      updatedClosure,
      targetMonthKey: '2026-07',
      snapshotDate: '2026-07-01',
    });

    expect(result.status).toBe('skipped');
    expect(result.warnings[0]).toContain('no propaga automaticamente');
  });
});
