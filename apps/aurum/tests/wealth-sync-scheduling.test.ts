/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), transaction: vi.fn(), publish: vi.fn(), snapshot: vi.fn(),
}));
vi.mock('../src/services/firebase', () => ({
  db: {}, ensureAuthPersistence: mocks.auth, getCurrentUid: () => 'synthetic-user',
  isE2EFirebaseEmulatorEnabled: () => false,
}));
vi.mock('../src/services/midasPublished', () => ({ publishAurumOptimizableInvestmentsSnapshot: mocks.publish }));
vi.mock('firebase/firestore', async (original) => ({
  ...await original<typeof import('firebase/firestore')>(),
  doc: () => ({ path: 'aurum_wealth/synthetic-user' }),
  runTransaction: mocks.transaction, onSnapshot: mocks.snapshot,
}));

type Cloud = Record<string, unknown>;
let cloud: Cloud;
let service: typeof import('../src/services/wealthStorage');
let onSnapshot: ((snapshot: { exists: () => boolean; data: () => Cloud }) => void) | undefined;
let onCommit: (() => void) | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
const record = (amount: number) => ({
  id: 'synthetic-bank', amount, block: 'bank' as const, source: 'Manual', label: 'Synthetic bank',
  currency: 'CLP' as const, snapshotDate: '2026-07-15', createdAt: '2026-07-15T12:00:00.000Z',
});

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  onSnapshot = undefined; onCommit = undefined;
  mocks.auth.mockResolvedValue(undefined);
  mocks.publish.mockResolvedValue({ ok: true, snapshot: null });
  mocks.snapshot.mockImplementation((_ref, next) => { onSnapshot = next; return () => {}; });
  cloud = { records: [], closures: [], fx: { usdClp: 900, eurClp: 1000, ufClp: 39000 } };
  mocks.transaction.mockImplementation(async (_db, callback) => {
    const result = await callback({
      get: async () => ({ exists: () => true, data: () => structuredClone(cloud) }),
      set: (_ref: unknown, data: Cloud) => { cloud = structuredClone(data); },
    });
    onCommit?.();
    return result;
  });
  service = await import('../src/services/wealthStorage');
  service.saveWealthRecords([record(123)], { skipCloudSync: true, silent: true });
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; container?.remove(); container = undefined;
  service.unsubscribeWealthCloud(); vi.clearAllTimers(); vi.useRealTimers();
});

// Flush the async Firestore/publication chain without advancing debounce timers.
const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

describe('wealth sync scheduling acknowledgement', () => {
  it('does not leave the yellow banner behind a successful immediate/manual sync', async () => {
    service.scheduleWealthCloudSync(5000);
    service.requestImmediateWealthSync();
    const pushed = await service.syncWealthNow();
    expect(pushed).toBe(true);
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    const writes = mocks.transaction.mock.calls.length;
    const { WealthSyncBanner } = await import('../src/components/Components');
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(React.Fragment, null,
        React.createElement('span', null, pushed ? 'Sincronizado' : 'Error al sincronizar'),
        React.createElement(WealthSyncBanner),
      ));
    });
    // A stale debounce must not start a new write after success was reported.
    mocks.transaction.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.textContent).toContain('Sincronizado');
    expect(container.textContent).not.toContain('Pendiente de sincronización');
    expect(mocks.transaction).toHaveBeenCalledTimes(writes);
  });

  it('acknowledges edits queued during auth that the transaction already includes', async () => {
    let edits = 0;
    mocks.auth.mockImplementation(async () => {
      edits += 1;
      service.saveWealthRecords([record(123 + edits)]);
      service.scheduleWealthCloudSync(20);
    });
    const ok = await service.syncWealthNow();
    expect({ ok, issue: service.getLastWealthSyncIssue(), status: service.loadWealthSyncUiState().status })
      .toEqual({ ok: true, issue: '', status: 'synced' });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(cloud.records).toEqual(service.loadWealthRecords());
    const writes = mocks.transaction.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.transaction).toHaveBeenCalledTimes(writes);
  });

  it('ignores redundant scheduling while the acknowledged snapshot is in flight', async () => {
    onCommit = () => service.scheduleWealthCloudSync(20);
    const ok = await service.syncWealthNow();
    expect({ ok, issue: service.getLastWealthSyncIssue() })
      .toEqual({ ok: true, issue: '' });
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const writes = mocks.transaction.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.transaction).toHaveBeenCalledTimes(writes);
  });

  it('converges with the Firestore subscriber echo and retains remote records', async () => {
    cloud.records = [{ ...record(456), id: 'remote-bank', label: 'Remote bank' }];
    await service.subscribeWealthCloud();
    onCommit = () => onSnapshot?.({ exists: () => true, data: () => structuredClone(cloud) });
    expect(await service.syncWealthNow()).toBe(true);
    expect(service.loadWealthRecords()).toEqual(cloud.records);
    expect(service.loadWealthRecords()).toHaveLength(2);
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(service.getLastWealthSyncIssue()).toBe('');
    const writes = mocks.transaction.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.transaction).toHaveBeenCalledTimes(writes);
  });

  it('keeps an actual edit during immediate sync pending until its next write', async () => {
    mocks.publish.mockImplementationOnce(async () => {
      service.saveWealthRecords([record(789)], { skipCloudSync: true, silent: true });
      service.requestImmediateWealthSync();
      return { ok: true, snapshot: null };
    });
    expect(await service.syncWealthNow()).toBe(true);
    expect(cloud.records).toEqual(service.loadWealthRecords());
    expect(service.loadWealthRecords()[0].amount).toBe(789);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(service.loadWealthSyncUiState().status).toBe('synced');
  });

  it('does not announce success for an edit made by a synchronous data subscriber', async () => {
    cloud.records = [{ ...record(456), id: 'remote-bank', label: 'Remote bank' }];
    const edit = () => service.saveWealthRecords([record(999)]);
    const confirmations: boolean[] = [];
    const observe = () => {
      if (service.loadWealthSyncUiState().status === 'synced') {
        confirmations.push(JSON.stringify(cloud.records) === JSON.stringify(service.loadWealthRecords()));
      }
    };
    window.addEventListener(service.WEALTH_DATA_UPDATED_EVENT, edit, { once: true });
    window.addEventListener(service.WEALTH_SYNC_STATUS_UPDATED_EVENT, observe);
    try {
      expect(await service.syncWealthNow()).toBe(true);
      expect(confirmations).toEqual([true]);
      expect(service.loadWealthRecords()).toContainEqual(expect.objectContaining({ amount: 999 }));
      expect(cloud.records).toEqual(service.loadWealthRecords());
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(service.WEALTH_DATA_UPDATED_EVENT, edit);
      window.removeEventListener(service.WEALTH_SYNC_STATUS_UPDATED_EVENT, observe);
    }
  });

  it('retains automatic retry after bounded attempts with genuinely changing data', async () => {
    let edits = 0;
    onCommit = () => service.saveWealthRecords([record(200 + ++edits)]);
    expect(await service.syncWealthNow()).toBe(false);
    expect(service.getLastWealthSyncIssue()).toBe('cloud_sync_kept_changing_during_close');
    expect(service.loadWealthSyncUiState().status).toBe('dirty');
    onCommit = undefined;
    await vi.advanceTimersByTimeAsync(40); await settle();
    expect(cloud.records).toEqual(service.loadWealthRecords());
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(service.getLastWealthSyncIssue()).toBe('');
  });
});
