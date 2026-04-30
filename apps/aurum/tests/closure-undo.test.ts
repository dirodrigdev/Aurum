import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockDoc = { __path: string };
const cloudStore = new Map<string, any>();
const pathOf = (segments: Array<string | undefined | null>) =>
  segments.filter(Boolean).join('/');

vi.mock('firebase/firestore', () => {
  const doc = (...args: any[]): MockDoc => {
    if (typeof args[0] === 'object' && args[0]?.__path && typeof args[1] === 'string') {
      return { __path: pathOf([args[0].__path, args[1]]) };
    }
    return { __path: pathOf(args.filter((item) => typeof item === 'string')) };
  };
  const collection = (ref: MockDoc, ...segments: string[]): MockDoc => ({
    __path: pathOf([ref?.__path, ...segments]),
  });
  const getDoc = vi.fn(async (ref: MockDoc) => {
    const value = cloudStore.get(ref.__path);
    return {
      exists: () => value !== undefined,
      data: () => value,
    };
  });
  const setDoc = vi.fn(async (ref: MockDoc, payload: any, options?: { merge?: boolean }) => {
    if (options?.merge && cloudStore.has(ref.__path)) {
      cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
      return;
    }
    cloudStore.set(ref.__path, payload);
  });
  return {
    collection,
    deleteDoc: vi.fn(async () => {}),
    doc,
    getDoc,
    getDocs: vi.fn(async () => ({ docs: [] })),
    limit: vi.fn((value: number) => value),
    onSnapshot: vi.fn(() => () => {}),
    orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
    query: vi.fn(() => ({})),
    setDoc,
  };
});

vi.mock('../src/services/firebase', () => ({
  auth: {},
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => 'test-user'),
}));

import {
  BANK_BCHILE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  buildCanonicalClosureSummary,
  captureMonthlyCloseCheckpoint,
  closeMonthlyWithCheckpoint,
  getMonthlyCloseCheckpoint,
  loadClosures,
  previewUndoMonthlyClose,
  undoMonthlyCloseToCheckpoint,
  upsertMonthlyClosure,
} from '../src/services/wealthStorage';
import type { WealthRecord } from '../src/services/wealthStorage';
import { getCurrentUid } from '../src/services/firebase';

const fxRates = {
  usdClp: 900,
  eurClp: 1000,
  ufClp: 40000,
};

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

const makeRecord = (
  input: Pick<WealthRecord, 'block' | 'source' | 'label' | 'amount' | 'currency'>,
  monthKey = '2026-04',
): WealthRecord => ({
  id: `${input.block}-${input.label}-${input.currency}`,
  snapshotDate: `${monthKey}-30`,
  createdAt: `${monthKey}-30T12:00:00.000Z`,
  ...input,
});

const recordsForMonth = (monthKey = '2026-04', bankClp = 10_000_000, debtClp = 2_000_000): WealthRecord[] => [
  makeRecord(
    {
      block: 'bank',
      source: 'Fintoc',
      label: BANK_BCHILE_CLP_LABEL,
      amount: bankClp,
      currency: 'CLP',
    },
    monthKey,
  ),
  makeRecord(
    {
      block: 'bank',
      source: 'Fintoc',
      label: DEBT_CARD_CLP_LABEL,
      amount: debtClp,
      currency: 'CLP',
    },
    monthKey,
  ),
  makeRecord(
    {
      block: 'investment',
      source: 'Manual',
      label: 'BTG total valorizacion',
      amount: 100_000_000,
      currency: 'CLP',
    },
    monthKey,
  ),
];

describe('monthly close undo checkpoint', () => {
  beforeEach(() => {
    cloudStore.clear();
    vi.stubGlobal('localStorage', makeMemoryStorage());
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app');
  });

  it('creates checkpoint before creating a close for a month without previous closure', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04'),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const checkpoint = getMonthlyCloseCheckpoint(created.monthKey);

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.monthKey).toBe(created.monthKey);
    expect(checkpoint?.hadPreviousClosure).toBe(false);
    expect(checkpoint?.previousClosure).toBeNull();
  });

  it('undoes close to no-closure state when month had no closure before closing', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04'),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const monthKey = created.monthKey;
    expect(loadClosures().some((closure) => closure.monthKey === monthKey)).toBe(true);

    const result = await undoMonthlyCloseToCheckpoint(monthKey);
    expect(result.ok).toBe(true);
    expect(result.restoredToNoClosure).toBe(true);
    expect(loadClosures().some((closure) => closure.monthKey === monthKey)).toBe(false);
  });

  it('undoes close to previous closure snapshot when month already had a closure', async () => {
    const initial = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 12_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-10T12:00:00.000Z',
    });
    const monthKey = initial.monthKey;
    const beforeSummary = buildCanonicalClosureSummary(initial.records || [], fxRates);

    const replacementRecords = recordsForMonth('2026-04', 30_000_000, 4_000_000);
    await closeMonthlyWithCheckpoint({
      monthKey: monthKey,
      records: replacementRecords,
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });

    const preview = await previewUndoMonthlyClose(monthKey);
    expect(preview.ok).toBe(true);
    expect(preview.checkpoint?.hadPreviousClosure).toBe(true);

    const result = await undoMonthlyCloseToCheckpoint(monthKey);
    expect(result.ok).toBe(true);
    expect(result.restoredToNoClosure).toBe(false);

    const restored = loadClosures().find((closure) => closure.monthKey === monthKey);
    expect(restored).not.toBeNull();
    expect(Number(restored?.summary.bankClp || 0)).toBe(Number(beforeSummary.bankClp || 0));
    expect(Number(restored?.summary.nonMortgageDebtClp || 0)).toBe(Number(beforeSummary.nonMortgageDebtClp || 0));
  });

  it('undoes to pre-close checkpoint even after multiple later edits', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 10_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const monthKey = created.monthKey;
    const checkpoint = getMonthlyCloseCheckpoint(monthKey);
    expect(checkpoint).not.toBeNull();

    upsertMonthlyClosure({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 11_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-05-01T10:00:00.000Z',
    });
    upsertMonthlyClosure({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 9_000_000, 1_500_000),
      fxRates,
      closedAt: '2026-05-01T11:00:00.000Z',
    });

    const result = await undoMonthlyCloseToCheckpoint(monthKey);
    expect(result.ok).toBe(true);

    const afterUndo = loadClosures().find((closure) => closure.monthKey === monthKey) || null;
    if (checkpoint?.hadPreviousClosure) {
      expect(afterUndo?.id).toBe(checkpoint.previousClosure?.id);
    } else {
      expect(afterUndo).toBeNull();
    }
  });

  it('stores current closure as backup previousVersion before undo restore', async () => {
    const base = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 500_000),
      fxRates,
      closedAt: '2026-04-10T12:00:00.000Z',
    });
    const monthKey = base.monthKey;
    await closeMonthlyWithCheckpoint({
      monthKey: monthKey,
      records: recordsForMonth('2026-04', 31_486_718, 93_256_478),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });

    const currentBeforeUndo = loadClosures().find((closure) => closure.monthKey === monthKey);
    const currentBeforeUndoId = currentBeforeUndo?.id;

    const result = await undoMonthlyCloseToCheckpoint(monthKey);
    expect(result.ok).toBe(true);

    const restored = loadClosures().find((closure) => closure.monthKey === monthKey);
    expect(restored).not.toBeNull();
    expect((restored?.previousVersions || []).some((version) => version.id === currentBeforeUndoId)).toBe(true);
  });

  it('returns clear error when checkpoint does not exist', async () => {
    const result = await undoMonthlyCloseToCheckpoint('2026-04');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('No hay checkpoint previo');
  });

  it('preview computes deltas and does not affect other months', async () => {
    const march = await closeMonthlyWithCheckpoint({
      monthKey: '2026-03',
      records: recordsForMonth('2026-03', 5_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-03-15T12:00:00.000Z',
    });
    const april = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 10_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const marchMonth = march.monthKey;
    const aprilMonth = april.monthKey;
    await closeMonthlyWithCheckpoint({
      monthKey: aprilMonth,
      records: recordsForMonth('2026-04', 9_500_000, 2_000_000),
      fxRates,
      closedAt: '2026-04-20T12:00:00.000Z',
    });
    upsertMonthlyClosure({
      monthKey: aprilMonth,
      records: recordsForMonth('2026-04', 7_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-05-01T10:00:00.000Z',
    });

    const preview = await previewUndoMonthlyClose(aprilMonth);
    expect(preview.ok).toBe(true);
    expect(preview.delta).not.toBeNull();
    expect(Number(preview.delta?.bankClp || 0)).not.toBe(0);

    const marchBefore = loadClosures().find((closure) => closure.monthKey === marchMonth);
    await undoMonthlyCloseToCheckpoint(aprilMonth);
    const marchAfter = loadClosures().find((closure) => closure.monthKey === marchMonth);
    expect(marchAfter?.id).toBe(marchBefore?.id);
  });

  it('checkpoint is not overwritten by later monthly edits', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 10_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const monthKey = created.monthKey;
    const checkpointBefore = getMonthlyCloseCheckpoint(monthKey);

    upsertMonthlyClosure({
      monthKey,
      records: recordsForMonth('2026-04', 9_999_000, 2_000_000),
      fxRates,
      closedAt: '2026-05-01T12:00:00.000Z',
    });

    const checkpointAfter = getMonthlyCloseCheckpoint(monthKey);
    expect(checkpointAfter?.id).toBe(checkpointBefore?.id);
  });

  it('captures checkpoint with previous closure when explicitly requested', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 12_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-10T12:00:00.000Z',
    });
    const manual = captureMonthlyCloseCheckpoint(created.monthKey, { overwrite: true });
    expect(manual?.hadPreviousClosure).toBe(true);
    expect(manual?.previousClosure?.monthKey).toBe(created.monthKey);
  });

  it('blocks formal close when cloud checkpoint cannot be persisted', async () => {
    const getUidMock = vi.mocked(getCurrentUid);
    getUidMock.mockReturnValueOnce(null as unknown as string);
    await expect(
      closeMonthlyWithCheckpoint({
        monthKey: '2026-04',
        records: recordsForMonth('2026-04'),
        fxRates,
        closedAt: '2026-04-15T12:00:00.000Z',
      }),
    ).rejects.toThrow('No se pudo guardar el punto de respaldo del cierre');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-04')).toBe(false);
    expect(getMonthlyCloseCheckpoint('2026-04')).toBeNull();

    const preview = await previewUndoMonthlyClose('2026-04');
    expect(preview.ok).toBe(false);
    expect(preview.checkpointSource).toBeNull();
  });

  it('prefers cloud checkpoint and keeps local as fallback only', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 12_000_000, 1_500_000),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const monthKey = created.monthKey;
    const local = getMonthlyCloseCheckpoint(monthKey);
    expect(local).not.toBeNull();
    if (local) {
      local.hadPreviousClosure = true;
      local.previousClosure = {
        ...created,
        summary: {
          ...created.summary,
          bankClp: 1,
        },
      };
      const raw = JSON.parse(localStorage.getItem('wealth_monthly_close_checkpoints_v1') || '[]');
      raw[0] = local;
      localStorage.setItem('wealth_monthly_close_checkpoints_v1', JSON.stringify(raw));
    }
    const preview = await previewUndoMonthlyClose(monthKey);
    expect(preview.ok).toBe(true);
    expect(preview.checkpointSource).toBe('cloud');
    expect(Number(preview.previous?.bankClp || 0)).not.toBe(1);
  });

  it('marks preview as local-only when checkpoint is not in cloud', async () => {
    upsertMonthlyClosure({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 12_000_000, 1_500_000),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    captureMonthlyCloseCheckpoint('2026-04', { overwrite: true });

    const preview = await previewUndoMonthlyClose('2026-04');
    expect(preview.ok).toBe(true);
    expect(preview.checkpointSource).toBe('local');
    expect(preview.message).toContain('Checkpoint solo local');
  });
});
