import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreState = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
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

const confirmation = (flows: FinancialPerformanceConfirmation['flows'] = []): FinancialPerformanceConfirmation => ({
  schemaVersion: 1,
  monthKey: '2026-08',
  flowCompleteness: 'complete',
  positionMovementCompleteness: 'unconfirmed',
  flows,
});

describe('financial performance confirmation storage', () => {
  beforeEach(() => {
    firestoreState.docs.clear();
    firestoreState.reads.length = 0;
    firestoreState.writes.length = 0;
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

  it('requires the current authenticated account and does not write without one', async () => {
    authState.uid = null;
    await expect(appendFinancialPerformanceConfirmation(confirmation())).rejects.toThrow('financial_performance_auth_required');
    expect(firestoreState.writes).toHaveLength(0);
  });
});
