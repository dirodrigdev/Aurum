import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDoc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore';

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
  const orderBy = vi.fn((field: string, direction: string) => ({ kind: 'orderBy', field, direction }));
  const limit = vi.fn((value: number) => ({ kind: 'limit', value }));
  const query = vi.fn((ref: MockDoc, ...constraints: any[]) => ({
    __path: ref?.__path,
    __constraints: constraints,
  }));
  const getDoc = vi.fn(async (ref: MockDoc) => {
    const value = cloudStore.get(ref.__path);
    return {
      exists: () => value !== undefined,
      data: () => value,
    };
  });
  const getDocFromServer = vi.fn(async (ref: MockDoc) => {
    const value = cloudStore.get(ref.__path);
    return {
      exists: () => value !== undefined,
      data: () => value,
    };
  });
  const getDocs = vi.fn(async (refOrQuery: any) => {
    const basePath = String(refOrQuery?.__path || '');
    const constraints = Array.isArray(refOrQuery?.__constraints) ? refOrQuery.__constraints : [];
    let docs = [...cloudStore.entries()]
      .filter(([path]) => path.startsWith(`${basePath}/`) && !path.slice(basePath.length + 1).includes('/'))
      .map(([path, value]) => ({
        id: path.split('/').pop() || '',
        data: () => value,
      }));
    const orderConstraint = constraints.find((item: any) => item?.kind === 'orderBy');
    if (orderConstraint) {
      docs = docs.sort((a, b) => {
        const left = String(a.data()?.[orderConstraint.field] || '');
        const right = String(b.data()?.[orderConstraint.field] || '');
        return orderConstraint.direction === 'desc'
          ? right.localeCompare(left)
          : left.localeCompare(right);
      });
    }
    const limitConstraint = constraints.find((item: any) => item?.kind === 'limit');
    if (limitConstraint?.value) {
      docs = docs.slice(0, limitConstraint.value);
    }
    return { docs };
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
    deleteDoc: vi.fn(async (ref: MockDoc) => {
      cloudStore.delete(ref.__path);
    }),
    doc,
    getDoc,
    getDocFromServer,
    getDocs,
    limit,
    onSnapshot: vi.fn(() => () => {}),
    orderBy,
    query,
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
  hydrateWealthFromCloud,
  loadClosures,
  loadWealthRecords,
  previewUndoMonthlyClose,
  RISK_CAPITAL_LABEL_CLP,
  rollbackLegacyMonthlyClose,
  resolveClosureSectionAmounts,
  saveClosures,
  saveWealthRecords,
  syncWealthNow,
  undoMonthlyCloseToCheckpoint,
  upsertMonthlyClosure,
  verifyMonthlyCloseCheckpointReadiness,
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

const withCarryNote = (record: WealthRecord, fromMonthKey: string): WealthRecord => ({
  ...record,
  note: `Mes anterior: cierre ${fromMonthKey}`,
});

const removeCheckpointState = (monthKey: string) => {
  const localRaw = JSON.parse(localStorage.getItem('wealth_monthly_close_checkpoints_v1') || '[]');
  const localNext = localRaw.map((item: any) =>
    item?.monthKey === monthKey ? { ...item, state: undefined } : item,
  );
  localStorage.setItem('wealth_monthly_close_checkpoints_v1', JSON.stringify(localNext));
  const cloudRoot = cloudStore.get('aurum_wealth/test-user') || {};
  if (cloudRoot.monthlyCloseCheckpoints?.[monthKey]) {
    cloudStore.set('aurum_wealth/test-user', {
      ...cloudRoot,
      monthlyCloseCheckpoints: {
        ...cloudRoot.monthlyCloseCheckpoints,
        [monthKey]: {
          ...cloudRoot.monthlyCloseCheckpoints[monthKey],
          state: undefined,
        },
      },
    });
  }
  const subPath = `aurum_wealth/test-user/monthly_close_checkpoints/${monthKey}`;
  if (cloudStore.has(subPath)) {
    cloudStore.set(subPath, {
      ...cloudStore.get(subPath),
      state: undefined,
    });
  }
};

describe('monthly close undo checkpoint', () => {
  beforeEach(() => {
    cloudStore.clear();
    vi.clearAllMocks();
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
    expect(cloudStore.has('aurum_wealth/test-user/monthly_close_checkpoints/2026-04')).toBe(true);
    expect(cloudStore.get('aurum_wealth/test-user')?.monthlyCloseCheckpoints).toBeUndefined();
  });

  it('blocks close immediately when monthKey is invalid', async () => {
    await expect(
      closeMonthlyWithCheckpoint({
        monthKey: '2026-99',
        records: recordsForMonth('2026-04'),
        fxRates,
        closedAt: '2026-04-15T12:00:00.000Z',
      }),
    ).rejects.toThrow('Mes de cierre inválido. No se ejecutó el checkpoint ni el cierre.');

    expect(loadClosures()).toHaveLength(0);
    expect(getMonthlyCloseCheckpoint('2026-99')).toBeNull();
    expect(vi.mocked(setDoc)).not.toHaveBeenCalled();
  });

  it('persists non-mortgage debt consistently in the saved close summary', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 12_000_000, 93_200_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    const persisted = loadClosures().find((closure) => closure.monthKey === '2026-05') || null;

    expect(created.summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(persisted?.summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(resolveClosureSectionAmounts({ closure: persisted }).nonMortgageDebtClp).toBe(93_200_000);
  });

  it('does not report close success when cloud read-after-write does not include the month closure', async () => {
    vi.mocked(getDocFromServer).mockImplementationOnce(async () => ({
      exists: () => true,
      data: () => ({
        updatedAt: '2026-06-01T00:00:00.000Z',
        records: [],
        closures: [],
        closureDeletionTombstones: [],
        instruments: [],
        bankTokens: {},
        deletedRecordIds: [],
        deletedRecordAssetMonthKeys: [],
        fx: fxRates,
      }),
    }));

    await expect(
      closeMonthlyWithCheckpoint({
        monthKey: '2026-05',
        records: recordsForMonth('2026-05', 12_000_000, 93_200_000),
        fxRates,
        closedAt: '2026-05-31T23:59:59.000Z',
      }),
    ).rejects.toThrow('El cierre no quedó guardado. No se actualizó el historial.');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(false);
  });

  it('persists non-whitelisted debt block records in the saved close summary', async () => {
    const records = [
      ...recordsForMonth('2026-05', 21_007_516, 0).filter((record) => record.label !== DEBT_CARD_CLP_LABEL),
      makeRecord(
        {
          block: 'investment',
          source: 'Manual',
          label: RISK_CAPITAL_LABEL_CLP,
          amount: 279_822_000,
          currency: 'CLP',
        },
        '2026-05',
      ),
      makeRecord(
        {
          block: 'real_estate',
          source: 'Manual',
          label: 'Valor propiedad',
          amount: 252_754_619,
          currency: 'CLP',
        },
        '2026-05',
      ),
      makeRecord(
        {
          block: 'debt',
          source: 'Manual',
          label: 'Deuda no hipotecaria vigente',
          amount: 93_200_000,
          currency: 'CLP',
        },
        '2026-05',
      ),
    ];

    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    const persisted = loadClosures().find((closure) => closure.monthKey === '2026-05') || null;

    expect(created.summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(persisted?.summary.nonMortgageDebtClp).toBe(93_200_000);
    expect(resolveClosureSectionAmounts({ closure: persisted }).nonMortgageDebtClp).toBe(93_200_000);
    expect(resolveClosureSectionAmounts({ closure: persisted }).totalNetClp).toBe(280_562_135);
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
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === monthKey),
    ).toBe(false);
  });

  it('preview uses checkpoint state for first close instead of showing previous zero', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });

    const preview = await previewUndoMonthlyClose('2026-05');
    expect(preview.ok).toBe(true);
    expect(preview.actionMode).toBe('undo_full');
    expect(preview.previousStateSource).toBe('checkpoint_state');
    expect(preview.previous?.netClp).toBeGreaterThan(0);
    expect(preview.previous?.nonMortgageDebtClp).toBe(93_200_000);
    expect(preview.delta).not.toBeNull();
  });

  it('preview current uses persisted closure totals without inflating risk capital', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 12_000_000, 93_200_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    const persisted = loadClosures().find((closure) => closure.monthKey === created.monthKey);
    expect(Number(persisted?.summary.netClp || 0)).toBeGreaterThan(0);
    if (persisted?.summary) {
      persisted.summary.netClpWithRisk = Number(persisted.summary.netClp || 0) + 280_150_924;
      saveClosures([persisted]);
    }

    const preview = await previewUndoMonthlyClose('2026-05');
    expect(preview.current?.netClp).toBe(Number(persisted?.summary.netClp || 0));
    expect(preview.current?.investmentClp).toBe(Number(persisted?.summary.investmentClp || 0));
  });

  it('legacy checkpoint without state blocks normal undo preview and enables legacy rollback instead', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const preview = await previewUndoMonthlyClose('2026-05');
    expect(preview.ok).toBe(true);
    expect(preview.actionMode).toBe('legacy_rollback');
    expect(preview.previous).toBeNull();
    expect(preview.delta).toBeNull();
    expect(preview.message).toContain('checkpoint antiguo sin snapshot completo');

    const undo = await undoMonthlyCloseToCheckpoint('2026-05');
    expect(undo.ok).toBe(false);
    expect(undo.message).toContain('solo permite retirar el cierre legacy');
  });

  it('restores full checkpoint state from subcollection cloud and keeps may removed after hydration', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });

    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });

    const juneCarried = recordsForMonth('2026-06', 1_000_000, 500_000).map((record) =>
      withCarryNote(record, '2026-05'),
    );
    saveWealthRecords(juneCarried, { skipCloudSync: true });

    const result = await undoMonthlyCloseToCheckpoint('2026-05');
    expect(result.ok).toBe(true);
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(false);
    expect(loadWealthRecords().map((record) => record.snapshotDate)).toEqual(
      preCloseRecords.map((record) => record.snapshotDate),
    );

    await hydrateWealthFromCloud();

    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(false);
    expect(loadWealthRecords().map((record) => record.snapshotDate)).toEqual(
      preCloseRecords.map((record) => record.snapshotDate),
    );
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === '2026-05'),
    ).toBe(false);
  });

  it('restores full checkpoint state from legacy root doc checkpoint when subcollection is absent', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });

    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    const subcollectionPath = 'aurum_wealth/test-user/monthly_close_checkpoints/2026-05';
    const checkpoint = cloudStore.get(subcollectionPath);
    cloudStore.set('aurum_wealth/test-user', {
      ...(cloudStore.get('aurum_wealth/test-user') || {}),
      monthlyCloseCheckpoints: {
        '2026-05': checkpoint,
      },
    });
    cloudStore.delete(subcollectionPath);
    localStorage.setItem('wealth_monthly_close_checkpoints_v1', '[]');
    saveWealthRecords(recordsForMonth('2026-06', 1_000_000, 500_000).map((record) => withCarryNote(record, '2026-05')), {
      skipCloudSync: true,
    });

    const result = await undoMonthlyCloseToCheckpoint('2026-05');
    expect(result.ok).toBe(true);
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(false);
    expect(
      cloudStore.get('aurum_wealth/test-user')?.monthlyCloseCheckpoints?.['2026-05']?.state?.records?.length,
    ).toBe(preCloseRecords.length);
  });

  it('legacy rollback removes the bad close cloud-first without touching current records', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');
    const currentRecords = loadWealthRecords();

    const result = await rollbackLegacyMonthlyClose('2026-05');
    expect(result.ok).toBe(true);
    expect(result.actionMode).toBe('legacy_rollback');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(false);
    expect(loadClosures()[0]?.monthKey).toBe('2026-04');
    expect(loadWealthRecords()).toEqual(currentRecords);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === '2026-05'),
    ).toBe(false);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closureDeletionTombstones || []).some(
        (item: any) =>
          item.monthKey === '2026-05' &&
          item.reason === 'legacy_close_rollback_no_full_checkpoint' &&
          item.source === 'legacy_rollback',
      ),
    ).toBe(true);
  });

  it('legacy rollback writes the canonical root closures payload without 2026-05', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const setDocMock = vi.mocked(setDoc);
    setDocMock.mockClear();

    const result = await rollbackLegacyMonthlyClose('2026-05');
    expect(result.ok).toBe(true);

    const rootWrite = setDocMock.mock.calls.find(
      ([ref, payload]) => String((ref as any)?.__path || '') === 'aurum_wealth/test-user' && Array.isArray((payload as any)?.closures),
    );
    expect(rootWrite).toBeTruthy();
    const payload = rootWrite?.[1] as any;
    expect(payload?.closures.some((closure: any) => closure.monthKey === '2026-05')).toBe(false);
    expect(payload?.closureDeletionTombstones?.some((item: any) => item.monthKey === '2026-05')).toBe(true);
    expect(payload).not.toHaveProperty('records');
    expect(payload).not.toHaveProperty('instruments');
    expect(payload).not.toHaveProperty('fx');
  });

  it('hydrate does not revive a local close suppressed by a rollback tombstone', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    const april = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    const may = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const rolledBack = await rollbackLegacyMonthlyClose('2026-05');
    expect(rolledBack.ok).toBe(true);
    saveClosures([may, april], { skipCloudSync: true });

    await hydrateWealthFromCloud();

    expect(loadClosures().map((closure) => closure.monthKey)).toEqual(['2026-04']);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === '2026-05'),
    ).toBe(false);
  });

  it('sync after rollback does not upload a local stale close suppressed by tombstone', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    const april = await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    const may = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const rolledBack = await rollbackLegacyMonthlyClose('2026-05');
    expect(rolledBack.ok).toBe(true);
    saveClosures([may, april], { skipCloudSync: true });

    await syncWealthNow();

    expect(loadClosures().map((closure) => closure.monthKey)).toEqual(['2026-04']);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === '2026-05'),
    ).toBe(false);
  });

  it('legacy rollback verifies with server read instead of stale cache reads', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const staleCloudSnapshot = {
      ...(cloudStore.get('aurum_wealth/test-user') || {}),
      closures: loadClosures(),
      records: preCloseRecords,
      fx: fxRates,
    };

    const getDocMock = vi.mocked(getDoc);
    const getDocFromServerMock = vi.mocked(getDocFromServer);
    const originalGetDoc = getDocMock.getMockImplementation();
    const originalGetDocFromServer = getDocFromServerMock.getMockImplementation();

    getDocMock.mockImplementation(async (ref: any) => {
      if (String(ref?.__path || '') === 'aurum_wealth/test-user') {
        return {
          exists: () => true,
          data: () => staleCloudSnapshot,
        };
      }
      return originalGetDoc ? originalGetDoc(ref) : { exists: () => false, data: () => undefined };
    });

    try {
      const result = await rollbackLegacyMonthlyClose('2026-05');
      expect(result.ok).toBe(true);
      expect(getDocFromServerMock).toHaveBeenCalled();
      expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(false);
      expect(
        (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === '2026-05'),
      ).toBe(false);
    } finally {
      if (originalGetDoc) {
        getDocMock.mockImplementation(originalGetDoc);
      } else {
        getDocMock.mockReset();
      }
      if (originalGetDocFromServer) {
        getDocFromServerMock.mockImplementation(originalGetDocFromServer);
      } else {
        getDocFromServerMock.mockReset();
      }
    }
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
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === monthKey),
    ).toBe(true);
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
    ).rejects.toThrow('No hay una sesión Firebase válida para guardar el checkpoint cloud del cierre');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-04')).toBe(false);
    expect(getMonthlyCloseCheckpoint('2026-04')).toBeNull();

    const preview = await previewUndoMonthlyClose('2026-04');
    expect(preview.ok).toBe(false);
    expect(preview.checkpointSource).toBeNull();
  });

  it('does not leave a local close applied when persistence fails after checkpoint', async () => {
    const getDocFromServerMock = vi.mocked(getDocFromServer);
    const originalGetDocFromServer = getDocFromServerMock.getMockImplementation();
    getDocFromServerMock.mockImplementationOnce(async () => ({
      exists: () => true,
      data: () => ({
        updatedAt: '2026-06-01T00:00:00.000Z',
        records: [],
        closures: [],
        closureDeletionTombstones: [],
        instruments: [],
        bankTokens: {},
        deletedRecordIds: [],
        deletedRecordAssetMonthKeys: [],
        fx: fxRates,
      }),
    }));

    await expect(
      closeMonthlyWithCheckpoint({
        monthKey: '2026-06',
        records: recordsForMonth('2026-06', 12_000_000, 93_200_000),
        fxRates,
        closedAt: '2026-06-30T23:59:59.000Z',
      }),
    ).rejects.toThrow('El cierre no quedó guardado. No se actualizó el historial.');

    expect(loadClosures().some((closure) => closure.monthKey === '2026-06')).toBe(false);

    if (originalGetDocFromServer) {
      getDocFromServerMock.mockImplementation(originalGetDocFromServer);
    } else {
      getDocFromServerMock.mockReset();
    }
  });

  it('verifies checkpoint readiness without creating a monthly close and keeps schema v2', async () => {
    const result = await verifyMonthlyCloseCheckpointReadiness({
      monthKey: '2026-06',
      records: recordsForMonth('2026-06', 12_000_000, 93_200_000),
      fxRates,
    });

    expect(result.status).toBe('BACKUP_READY_FOR_JUNE_CLOSE');
    expect(result.monthKey).toBe('2026-06');
    expect(result.schemaVersion).toBe(2);
    expect(result.cloudVerified).toBe(true);
    expect(result.cleanupOk).toBe(true);
    expect(loadClosures().some((closure) => closure.monthKey === '2026-06')).toBe(false);
    expect(getMonthlyCloseCheckpoint('2026-06')).toBeNull();
    expect(
      vi.mocked(setDoc).mock.calls.some(([ref]) => String((ref as any)?.__path || '') === 'aurum_wealth/test-user'),
    ).toBe(false);
    expect(
      [...cloudStore.keys()].some((key) => key.includes('/monthly_close_checkpoints/probe_2026-06_')),
    ).toBe(false);
  });

  it('reports external blocker when backup readiness cannot confirm cloud session', async () => {
    const getUidMock = vi.mocked(getCurrentUid);
    getUidMock.mockReturnValueOnce(null as unknown as string);

    const result = await verifyMonthlyCloseCheckpointReadiness({
      monthKey: '2026-06',
      records: recordsForMonth('2026-06', 12_000_000, 93_200_000),
      fxRates,
    });

    expect(result.status).toBe('BACKUP_NOT_READY');
    expect(result.cloudVerified).toBe(false);
    expect(loadClosures().some((closure) => closure.monthKey === '2026-06')).toBe(false);
  });

  it('returns BACKUP_NOT_READY when backup verification cannot write the probe subcollection', async () => {
    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      if (String(ref?.__path || '').includes('/monthly_close_checkpoints/')) {
        const err: any = new Error('permission denied');
        err.code = 'permission-denied';
        throw err;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    const result = await verifyMonthlyCloseCheckpointReadiness({
      monthKey: '2026-06',
      records: recordsForMonth('2026-06', 12_000_000, 93_200_000),
      fxRates,
    });

    expect(result.status).toBe('BACKUP_NOT_READY');
    expect(result.cloudVerified).toBe(false);
    expect(cloudStore.get('aurum_wealth/test-user')?.monthlyCloseCheckpoints).toBeUndefined();

    if (original) {
      setDocMock.mockImplementation(original);
    } else {
      setDocMock.mockReset();
    }
  });

  it('does not depend on writing the root doc when it is already oversized and subcollection works', async () => {
    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      if (String(ref?.__path || '') === 'aurum_wealth/test-user' && payload?.monthlyCloseCheckpoints) {
        const err: any = new Error("Document too large");
        err.code = 'resource-exhausted';
        throw err;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    const result = await verifyMonthlyCloseCheckpointReadiness({
      monthKey: '2026-06',
      records: recordsForMonth('2026-06', 12_000_000, 93_200_000),
      fxRates,
    });

    expect(result.status).toBe('BACKUP_READY_FOR_JUNE_CLOSE');
    expect(result.cloudVerified).toBe(true);
    expect(
      vi.mocked(setDoc).mock.calls.some(([ref, payload]) =>
        String((ref as any)?.__path || '') === 'aurum_wealth/test-user' && !!(payload as any)?.monthlyCloseCheckpoints,
      ),
    ).toBe(false);

    if (original) {
      setDocMock.mockImplementation(original);
    } else {
      setDocMock.mockReset();
    }
  });

  it('retains at most two real checkpoints in subcollection', async () => {
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 10_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 11_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-06',
      records: recordsForMonth('2026-06', 12_000_000, 3_000_000),
      fxRates,
      closedAt: '2026-06-30T23:59:59.000Z',
    });

    const checkpointPaths = [...cloudStore.keys()].filter((key) =>
      key.startsWith('aurum_wealth/test-user/monthly_close_checkpoints/'),
    );
    expect(checkpointPaths).toHaveLength(2);
    expect(checkpointPaths).toContain('aurum_wealth/test-user/monthly_close_checkpoints/2026-05');
    expect(checkpointPaths).toContain('aurum_wealth/test-user/monthly_close_checkpoints/2026-06');
  });

  it('keeps at least the latest checkpoint when retention cleanup fails', async () => {
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 10_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 11_000_000, 2_000_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });

    const deleteDocMock = vi.mocked(deleteDoc);
    const originalDelete = deleteDocMock.getMockImplementation();
    deleteDocMock.mockImplementation(async (ref: any) => {
      if (String(ref?.__path || '').endsWith('/2026-04')) {
        throw new Error('cleanup failed');
      }
      cloudStore.delete(ref.__path);
    });

    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-06',
      records: recordsForMonth('2026-06', 12_000_000, 3_000_000),
      fxRates,
      closedAt: '2026-06-30T23:59:59.000Z',
    });

    expect(created.monthKey).toBe('2026-06');
    expect(cloudStore.has('aurum_wealth/test-user/monthly_close_checkpoints/2026-06')).toBe(true);

    if (originalDelete) {
      deleteDocMock.mockImplementation(originalDelete);
    } else {
      deleteDocMock.mockReset();
    }
  });

  it('blocks close when subcollection checkpoint write is denied and does not write root doc fallback', async () => {
    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      if (String(ref?.__path || '').includes('/monthly_close_checkpoints/')) {
        const err: any = new Error('permission denied');
        err.code = 'permission-denied';
        throw err;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    await expect(
      closeMonthlyWithCheckpoint({
        monthKey: '2026-04',
        records: recordsForMonth('2026-04'),
        fxRates,
        closedAt: '2026-04-15T12:00:00.000Z',
      }),
    ).rejects.toThrow();
    expect(loadClosures().some((closure) => closure.monthKey === '2026-04')).toBe(false);
    expect(cloudStore.get('aurum_wealth/test-user')?.monthlyCloseCheckpoints).toBeUndefined();

    if (original) {
      setDocMock.mockImplementation(original);
    } else {
      setDocMock.mockReset();
    }
  });

  it('preview undo reads legacy root doc checkpoint as cloud source', async () => {
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 12_000_000, 1_500_000),
      fxRates,
      closedAt: '2026-04-15T12:00:00.000Z',
    });
    const checkpoint = cloudStore.get('aurum_wealth/test-user/monthly_close_checkpoints/2026-04');
    cloudStore.set('aurum_wealth/test-user', {
      ...(cloudStore.get('aurum_wealth/test-user') || {}),
      monthlyCloseCheckpoints: {
        '2026-04': checkpoint,
      },
    });
    cloudStore.delete('aurum_wealth/test-user/monthly_close_checkpoints/2026-04');
    localStorage.setItem('wealth_monthly_close_checkpoints_v1', '[]');

    const preview = await previewUndoMonthlyClose('2026-04');

    expect(preview.ok).toBe(true);
    expect(preview.checkpointSource).toBe('cloud');
    expect(preview.checkpoint?.monthKey).toBe('2026-04');
  });

  it('does not report undo success when cloud persistence fails', async () => {
    const created = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 12_000_000, 1_500_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    expect(loadClosures().some((closure) => closure.monthKey === created.monthKey)).toBe(true);

    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      const path = String(ref?.__path || '');
      if (path === 'aurum_wealth/test-user' && payload?.closures) {
        const err: any = new Error('unavailable');
        err.code = 'unavailable';
        throw err;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    const result = await undoMonthlyCloseToCheckpoint('2026-05');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('No se aplicaron cambios locales');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(true);

    if (original) {
      setDocMock.mockImplementation(original);
    } else {
      setDocMock.mockReset();
    }
  });

  it('fails undo when cloud verification still returns the removed month', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 1_500_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });

    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    cloudStore.set('aurum_wealth/test-user', {
      ...(cloudStore.get('aurum_wealth/test-user') || {}),
      updatedAt: '2026-05-31T23:59:59.000Z',
      closures: loadClosures(),
      records: preCloseRecords,
      fx: fxRates,
    });
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      const path = String(ref?.__path || '');
      if (path === 'aurum_wealth/test-user' && payload?.closures) {
        const previous = cloudStore.get(ref.__path) || {};
        cloudStore.set(ref.__path, { ...previous, ...payload, closures: previous.closures });
        return;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    try {
      const result = await undoMonthlyCloseToCheckpoint('2026-05');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('siguió devolviendo el cierre deshecho');
      expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(true);
    } finally {
      if (original) {
        setDocMock.mockImplementation(original);
      } else {
        setDocMock.mockReset();
      }
    }
  });

  it('legacy rollback fails if cloud verification still returns the removed month', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 1_500_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');
    cloudStore.set('aurum_wealth/test-user', {
      ...(cloudStore.get('aurum_wealth/test-user') || {}),
      updatedAt: '2026-05-31T23:59:59.000Z',
      closures: loadClosures(),
      records: preCloseRecords,
      fx: fxRates,
    });

    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      const path = String(ref?.__path || '');
      if (path === 'aurum_wealth/test-user' && payload?.closures) {
        const previous = cloudStore.get(ref.__path) || {};
        cloudStore.set(ref.__path, { ...previous, ...payload, closures: previous.closures });
        return;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    try {
      const result = await rollbackLegacyMonthlyClose('2026-05');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('no confirmó el retiro del cierre legacy');
      expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(true);
    } finally {
      if (original) {
        setDocMock.mockImplementation(original);
      } else {
        setDocMock.mockReset();
      }
    }
  });

  it('legacy rollback surfaces timeout-style cloud errors without touching local state', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 1_500_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const setDocMock = vi.mocked(setDoc);
    const original = setDocMock.getMockImplementation();
    setDocMock.mockImplementation(async (ref: any, payload: any, options?: { merge?: boolean }) => {
      const path = String(ref?.__path || '');
      if (path === 'aurum_wealth/test-user' && payload?.closures) {
        const err: any = new Error('timeout');
        err.code = 'undo_cloud_write_timeout';
        throw err;
      }
      if (options?.merge && cloudStore.has(ref.__path)) {
        cloudStore.set(ref.__path, { ...cloudStore.get(ref.__path), ...payload });
        return;
      }
      cloudStore.set(ref.__path, payload);
    });

    try {
      const result = await rollbackLegacyMonthlyClose('2026-05');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('No se pudo confirmar la operación en la nube');
      expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(true);
    } finally {
      if (original) {
        setDocMock.mockImplementation(original);
      } else {
        setDocMock.mockReset();
      }
    }
  });

  it('allows closing the month again after undo restores april as latest closure', async () => {
    saveWealthRecords(recordsForMonth('2026-05', 12_000_000, 93_200_000), { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-04',
      records: recordsForMonth('2026-04', 8_000_000, 1_000_000),
      fxRates,
      closedAt: '2026-04-30T23:59:59.000Z',
    });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 12_000_000, 93_200_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });

    const undone = await undoMonthlyCloseToCheckpoint('2026-05');
    expect(undone.ok).toBe(true);
    expect(loadClosures()[0]?.monthKey).toBe('2026-04');

    const reclosed = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: recordsForMonth('2026-05', 12_000_000, 93_200_000),
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    expect(reclosed.monthKey).toBe('2026-05');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(true);
  });

  it('allows re-closing may after legacy rollback', async () => {
    const preCloseRecords = recordsForMonth('2026-05', 12_000_000, 93_200_000);
    saveWealthRecords(preCloseRecords, { skipCloudSync: true });
    await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2026-05-31T23:59:59.000Z',
    });
    await syncWealthNow();
    removeCheckpointState('2026-05');

    const rolledBack = await rollbackLegacyMonthlyClose('2026-05');
    expect(rolledBack.ok).toBe(true);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closureDeletionTombstones || []).some(
        (item: any) => item.monthKey === '2026-05',
      ),
    ).toBe(true);

    const reclosed = await closeMonthlyWithCheckpoint({
      monthKey: '2026-05',
      records: preCloseRecords,
      fxRates,
      closedAt: '2030-05-31T23:59:59.000Z',
    });
    await syncWealthNow();

    expect(reclosed.monthKey).toBe('2026-05');
    expect(loadClosures().some((closure) => closure.monthKey === '2026-05')).toBe(true);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closures || []).some((closure: any) => closure.monthKey === '2026-05'),
    ).toBe(true);
    expect(
      (cloudStore.get('aurum_wealth/test-user')?.closureDeletionTombstones || []).some(
        (item: any) => item.monthKey === '2026-05',
      ),
    ).toBe(false);
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
