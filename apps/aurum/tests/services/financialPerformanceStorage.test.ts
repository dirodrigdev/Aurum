import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreState = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
  readError: null as Error | null,
}));

vi.mock('firebase/firestore', () => {
  const pathFor = (base: { path?: string } | undefined, parts: string[]) =>
    [base?.path, ...parts].filter(Boolean).join('/');
  const snapshotFor = (path: string) => {
    const data = firestoreState.docs.get(path);
    return { exists: () => data !== undefined, data: () => data };
  };
  return {
    collection: vi.fn((parent: { path?: string } | undefined, ...parts: string[]) => ({ path: pathFor(parent, parts) })),
    doc: vi.fn((first: { path?: string } | undefined, ...parts: string[]) => ({ path: pathFor(first, parts) })),
    getDoc: vi.fn(async (reference: { path: string }) => {
      firestoreState.reads.push(reference.path);
      if (firestoreState.readError) throw firestoreState.readError;
      return snapshotFor(reference.path);
    }),
    runTransaction: vi.fn(async (_db: unknown, callback: (transaction: {
      get: (reference: { path: string }) => Promise<ReturnType<typeof snapshotFor>>;
      set: (reference: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>) => {
      const staged = new Map<string, Record<string, unknown>>();
      const transaction = {
        get: async (reference: { path: string }) => {
          firestoreState.reads.push(reference.path);
          return snapshotFor(reference.path);
        },
        set: (reference: { path: string }, data: Record<string, unknown>) => {
          staged.set(reference.path, data);
          firestoreState.writes.push({ path: reference.path, data });
        },
      };
      const result = await callback(transaction);
      staged.forEach((data, path) => firestoreState.docs.set(path, data));
      return result;
    }),
    serverTimestamp: vi.fn(() => ({ toDate: () => new Date('2026-09-01T00:00:00.000Z') })),
  };
});

const authState = vi.hoisted(() => ({ uid: 'target-uid' as string | null }));
vi.mock('../../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => authState.uid),
}));

import {
  appendFinancialPerformanceConfirmation,
  loadFinancialPerformanceConfirmation,
} from '../../src/services/financialPerformanceStorage';
import type { FinancialPerformanceConfirmation } from '../../src/services/financialPerformance';

const augustPeriod = { startMonth: '2026-07', endMonth: '2026-08' } as const;
const juneToJulyPeriod = { startMonth: '2026-06', endMonth: '2026-07' } as const;

const confirmation = (
  flows: FinancialPerformanceConfirmation['flows'] = [],
  monthKey = '2026-08',
): FinancialPerformanceConfirmation => ({
  schemaVersion: 1,
  monthKey,
  flowCompleteness: 'complete',
  positionMovementCompleteness: 'unconfirmed',
  flows,
});

describe('financial performance confirmation storage', () => {
  beforeEach(() => {
    firestoreState.docs.clear();
    firestoreState.reads.length = 0;
    firestoreState.writes.length = 0;
    firestoreState.readError = null;
    authState.uid = 'target-uid';
  });

  it('appends immutable revisions and reads only the pointed revision for the signed-in user', async () => {
    const first = await appendFinancialPerformanceConfirmation(confirmation());
    const second = await appendFinancialPerformanceConfirmation(confirmation([
      { id: 'flow-1', direction: 'aporte', effectiveDate: '2026-08-12', amountClp: 1_000_000 },
    ]));
    const loaded = await loadFinancialPerformanceConfirmation();

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(loaded?.revision).toBe(2);
    expect(loaded?.flows[0]).toMatchObject({ id: 'flow-1', amountClp: 1_000_000 });
    expect(firestoreState.docs.has('aurum_financial_performance/target-uid/months/2026-08/revisions/1')).toBe(true);
    expect(firestoreState.docs.has('aurum_financial_performance/target-uid/months/2026-08/revisions/2')).toBe(true);
    expect(firestoreState.docs.get('aurum_financial_performance/target-uid/months/2026-08')?.currentRevision).toBe(2);
    expect(firestoreState.docs.get('aurum_financial_performance/target-uid/months/2026-08')?.currentRevisionId).toBe('2');
    expect(firestoreState.reads).toContain('aurum_financial_performance/target-uid/months/2026-08/revisions/2');
    expect(firestoreState.reads).not.toContain('aurum_financial_performance/another-user/months/2026-08');
  });

  it('rejects a head with an invalid schema, wrong month, or mismatched revision id', async () => {
    const headPath = 'aurum_financial_performance/target-uid/months/2026-08';
    const revisionPath = `${headPath}/revisions/1`;
    const invalidHeads = [
      { schemaVersion: 2, monthKey: '2026-08', currentRevision: 1, currentRevisionId: '1' },
      { schemaVersion: 1, monthKey: '2026-07', currentRevision: 1, currentRevisionId: '1' },
      { schemaVersion: 1, monthKey: '2026-08', currentRevision: 1, currentRevisionId: '2' },
    ];
    for (const head of invalidHeads) {
      firestoreState.docs.set(headPath, head);
      firestoreState.reads.length = 0;
      await expect(loadFinancialPerformanceConfirmation()).rejects.toThrow('financial_performance_invalid_head');
      expect(firestoreState.reads).not.toContain(revisionPath);
    }
  });

  it('rejects a pointed revision with a different revision number or creator', async () => {
    await appendFinancialPerformanceConfirmation(confirmation());
    const revisionPath = 'aurum_financial_performance/target-uid/months/2026-08/revisions/1';
    const revision = firestoreState.docs.get(revisionPath)!;
    firestoreState.docs.set(revisionPath, { ...revision, createdByUid: 'different-user' });
    await expect(loadFinancialPerformanceConfirmation()).rejects.toThrow('financial_performance_invalid_revision');

    firestoreState.docs.set(revisionPath, { ...revision, revision: 2 });
    await expect(loadFinancialPerformanceConfirmation()).rejects.toThrow('financial_performance_invalid_revision');
  });

  it('rejects malformed or out-of-window flows before writing', async () => {
    await expect(appendFinancialPerformanceConfirmation(confirmation([
      { id: 'flow-1', direction: 'aporte', effectiveDate: '2026-08-31', amountClp: 1_000_000 },
      { id: 'flow-1', direction: 'retiro', effectiveDate: '2026-02-31', amountClp: 10 },
    ]))).rejects.toThrow('financial_performance_invalid_month_or_schema');
    expect(firestoreState.writes).toHaveLength(0);
  });

  it('restores the existing July→August revision 3 from its original schema', async () => {
    const headPath = 'aurum_financial_performance/target-uid/months/2026-08';
    const revisionPath = `${headPath}/revisions/3`;
    const timestamp = { toDate: () => new Date('2026-08-31T23:59:00.000Z') };
    firestoreState.docs.set(headPath, {
      schemaVersion: 1,
      monthKey: '2026-08',
      currentRevision: 3,
      currentRevisionId: '3',
      updatedAt: timestamp,
    });
    firestoreState.docs.set(revisionPath, {
      schemaVersion: 1,
      monthKey: '2026-08',
      revision: 3,
      revisionId: '3',
      flowCompleteness: 'complete',
      positionMovementCompleteness: 'no_unrecorded_movements',
      flows: [{
        id: 'legacy-flow',
        direction: 'aporte',
        effectiveDate: '2026-08-10',
        amountClp: 250_000,
        note: 'existing revision',
      }],
      createdAt: timestamp,
      createdByUid: 'target-uid',
    });

    const loaded = await loadFinancialPerformanceConfirmation(augustPeriod);

    expect(loaded).toMatchObject({
      monthKey: '2026-08',
      revision: 3,
      flowCompleteness: 'complete',
      positionMovementCompleteness: 'no_unrecorded_movements',
      flows: [{ id: 'legacy-flow', amountClp: 250_000, note: 'existing revision' }],
    });
    expect(firestoreState.reads).toContain(revisionPath);
  });

  it('keeps June→July revisions independent from the existing July→August revision 3', async () => {
    const augustHead = 'aurum_financial_performance/target-uid/months/2026-08';
    const timestamp = { toDate: () => new Date('2026-08-31T23:59:00.000Z') };
    firestoreState.docs.set(augustHead, {
      schemaVersion: 1,
      monthKey: '2026-08',
      currentRevision: 3,
      currentRevisionId: '3',
      updatedAt: timestamp,
    });
    firestoreState.docs.set(`${augustHead}/revisions/3`, {
      schemaVersion: 1,
      monthKey: '2026-08',
      revision: 3,
      revisionId: '3',
      flowCompleteness: 'complete',
      positionMovementCompleteness: 'unconfirmed',
      flows: [],
      createdAt: timestamp,
      createdByUid: 'target-uid',
    });

    expect(await loadFinancialPerformanceConfirmation(juneToJulyPeriod)).toBeNull();
    const july = await appendFinancialPerformanceConfirmation(
      confirmation([{ id: 'july-flow', direction: 'aporte', effectiveDate: '2026-07-15', amountClp: 100 }], '2026-07'),
      juneToJulyPeriod,
    );

    expect(july.revision).toBe(1);
    expect(await loadFinancialPerformanceConfirmation(juneToJulyPeriod)).toMatchObject({
      monthKey: '2026-07',
      revision: 1,
      flows: [{ id: 'july-flow' }],
    });
    expect(await loadFinancialPerformanceConfirmation(augustPeriod)).toMatchObject({ monthKey: '2026-08', revision: 3 });
    expect(firestoreState.docs.get(augustHead)?.currentRevision).toBe(3);

    const august = await appendFinancialPerformanceConfirmation(confirmation());
    expect(august.revision).toBe(4);
    expect(await loadFinancialPerformanceConfirmation(juneToJulyPeriod)).toMatchObject({ monthKey: '2026-07', revision: 1 });
    expect(firestoreState.docs.get('aurum_financial_performance/target-uid/months/2026-07')?.currentRevision).toBe(1);
  });

  it('rejects invalid periods, malformed month keys, and confirmations for another end month', async () => {
    const invalidPeriods = [
      { startMonth: '2026-06', endMonth: '2026-08' },
      { startMonth: '2026-12', endMonth: '2026-13' },
    ];
    for (const period of invalidPeriods) {
      await expect(loadFinancialPerformanceConfirmation(period)).rejects.toThrow('financial_performance_invalid_period');
      await expect(appendFinancialPerformanceConfirmation(confirmation(), period)).rejects.toThrow('financial_performance_invalid_period');
    }
    await expect(appendFinancialPerformanceConfirmation(confirmation(), juneToJulyPeriod))
      .rejects.toThrow('financial_performance_invalid_month_or_schema');
    expect(firestoreState.writes).toHaveLength(0);
  });

  it('distinguishes a missing revision, incompatible period metadata, and a read error', async () => {
    const headPath = 'aurum_financial_performance/target-uid/months/2026-07';
    firestoreState.docs.set(headPath, {
      schemaVersion: 1,
      monthKey: '2026-07',
      startMonth: '2026-05',
      endMonth: '2026-07',
      currentRevision: 1,
      currentRevisionId: '1',
      updatedAt: { toDate: () => new Date('2026-07-31T23:59:00.000Z') },
    });
    await expect(loadFinancialPerformanceConfirmation(juneToJulyPeriod))
      .rejects.toThrow('financial_performance_invalid_head');

    firestoreState.docs.set(headPath, {
      schemaVersion: 1,
      monthKey: '2026-07',
      startMonth: '2026-06',
      endMonth: '2026-07',
      currentRevision: 1,
      currentRevisionId: '1',
      updatedAt: { toDate: () => new Date('2026-07-31T23:59:00.000Z') },
    });
    await expect(loadFinancialPerformanceConfirmation(juneToJulyPeriod))
      .rejects.toThrow('financial_performance_missing_revision');

    firestoreState.readError = new Error('emulator read failed');
    await expect(loadFinancialPerformanceConfirmation(juneToJulyPeriod)).rejects.toThrow('emulator read failed');
  });

  it('requires the current authenticated account and does not write without one', async () => {
    authState.uid = null;
    await expect(appendFinancialPerformanceConfirmation(confirmation())).rejects.toThrow('financial_performance_auth_required');
    expect(firestoreState.writes).toHaveLength(0);
  });
});
