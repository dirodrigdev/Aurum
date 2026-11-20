/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), transaction: vi.fn(), publish: vi.fn(), snapshot: vi.fn(), getDoc: vi.fn(),
}));
vi.mock('../src/services/firebase', () => ({
  db: {}, ensureAuthPersistence: mocks.auth, getCurrentUid: () => 'synthetic-user',
  isE2EFirebaseEmulatorEnabled: () => false,
}));
vi.mock('../src/services/midasPublished', () => ({ publishAurumOptimizableInvestmentsSnapshot: mocks.publish }));
vi.mock('firebase/firestore', async (original) => ({
  ...await original<typeof import('firebase/firestore')>(),
  doc: () => ({ path: 'aurum_wealth/synthetic-user' }),
  runTransaction: mocks.transaction, onSnapshot: mocks.snapshot, getDoc: mocks.getDoc,
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
  mocks.getDoc.mockImplementation(async () => ({ exists: () => true, data: () => structuredClone(cloud) }));
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

describe('read-only hydration and Firestore subscription', () => {
  it.each([false, true])('does not dirty or write on identical hydration (legacy catalog missing: %s)', async (legacy) => {
    expect(await service.syncWealthNow()).toBe(true);
    if (legacy) delete cloud.instruments;
    const stamp = localStorage.getItem('wealth_updated_at_v1');
    const before = structuredClone(cloud);
    vi.clearAllMocks();
    for (let i = 0; i < 3; i += 1) await service.hydrateWealthFromCloud();
    await vi.advanceTimersByTimeAsync(300_001);
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(localStorage.getItem('wealth_updated_at_v1')).toBe(stamp);
    expect(cloud).toEqual(before);
    expect(mocks.getDoc).toHaveBeenCalledTimes(3);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not dirty or write on identical snapshots (legacy catalog missing: %s)', async (legacy) => {
    expect(await service.syncWealthNow()).toBe(true);
    if (legacy) delete cloud.instruments;
    await service.subscribeWealthCloud();
    const stamp = localStorage.getItem('wealth_updated_at_v1');
    const before = structuredClone(cloud);
    vi.clearAllMocks();
    for (let i = 0; i < 3; i += 1) {
      onSnapshot?.({ exists: () => true, data: () => structuredClone(cloud) });
    }
    await vi.advanceTimersByTimeAsync(300_001);
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(localStorage.getItem('wealth_updated_at_v1')).toBe(stamp);
    expect(cloud).toEqual(before);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('still immediately persists an explicitly created instrument', async () => {
    expect(await service.syncWealthNow()).toBe(true);
    vi.clearAllMocks();
    const instrument = service.upsertInvestmentInstrument({ label: 'Explicit synthetic instrument', currency: 'CLP' });
    expect(service.loadWealthSyncUiState().status).toBe('dirty');
    expect(await service.syncWealthNow()).toBe(true);
    expect(cloud.instruments).toContainEqual(expect.objectContaining({ id: instrument?.id, label: 'Explicit synthetic instrument' }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(service.loadWealthSyncUiState().status).toBe('synced');
  });
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; container?.remove(); container = undefined;
  service.unsubscribeWealthCloud(); vi.clearAllTimers(); vi.useRealTimers();
});

// Flush the async Firestore/publication chain without advancing debounce timers.
const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

const mountSyncBanner = async () => {
  const { WealthSyncBanner } = await import('../src/components/Components');
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(React.createElement(WealthSyncBanner)); });
};

describe('user save feedback and silent recovery', () => {
  it('keeps automatic writes silent while still persisting them', async () => {
    await mountSyncBanner();
    await act(async () => {
      service.saveWealthRecords([record(456)], { notifyUser: false });
      await settle();
    });
    expect(service.loadWealthSyncUiState().status).toBe('dirty');
    expect(container.textContent).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(cloud.records).toEqual(service.loadWealthRecords());
    expect(container.textContent).toBe('');
  });

  it('shows feedback for a user edit and dismisses success after three seconds', async () => {
    await mountSyncBanner();
    await act(async () => { service.saveWealthRecords([record(456)]); });
    expect(container.textContent).toContain('Pendiente de sincronización');
    await act(async () => { expect(await service.syncWealthNow()).toBe(true); });
    expect(container.textContent).toContain('Sincronización realizada');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.textContent).toBe('');
  });

  it('shows feedback for an explicit sync even without a new edit', async () => {
    await mountSyncBanner();
    await act(async () => { expect(await service.syncWealthNow({ notifyUser: true })).toBe(true); });
    expect(container.textContent).toContain('Sincronización realizada');
  });

  it.each(['dirty', 'syncing', 'error'])('recovers a legacy %s state silently in a new session', async (status) => {
    localStorage.setItem('aurum:wealth-sync-status-v1', JSON.stringify({ status, at: '2026-07-15T12:00:00.000Z' }));
    await mountSyncBanner();
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
  });

  it('explains a cloud failure once without red, preserves local data, and retries silently', async () => {
    await mountSyncBanner();
    mocks.transaction.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => {
      service.saveWealthRecords([record(789)]);
      service.requestImmediateWealthSync();
      await settle();
    });
    expect(service.loadWealthSyncUiState().status).toBe('error');
    expect(service.loadWealthRecords()[0].amount).toBe(789);
    expect(container.textContent).toContain('Guardado aquí. Pendiente de sincronizar.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(container.textContent).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(56_000); });
    expect(service.loadWealthSyncUiState().status).toBe('synced');
    expect(cloud.records).toEqual(service.loadWealthRecords());
    expect(container.textContent).toBe('');
  });

  it('does not let an unrelated storage event keep the green notice visible', async () => {
    await mountSyncBanner();
    await act(async () => {
      service.saveWealthRecords([record(456)]);
      expect(await service.syncWealthNow()).toBe(true);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-preference' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.textContent).toBe('');
  });

  it('confirms a new user edit after an earlier cloud failure', async () => {
    await mountSyncBanner();
    mocks.transaction.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => {
      service.saveWealthRecords([record(456)]);
      service.requestImmediateWealthSync();
      await settle();
    });
    expect(service.loadWealthSyncUiState().status).toBe('error');
    await act(async () => { service.saveWealthRecords([record(789)]); });
    expect(container.textContent).toContain('Pendiente de sincronización');
    await act(async () => { expect(await service.syncWealthNow()).toBe(true); });
    expect(container.textContent).toContain('Sincronización realizada');
    expect(service.loadWealthRecords()[0].amount).toBe(789);
  });

  it('shows red only for a failed local user write and does not clear it with a background refresh', async () => {
    await mountSyncBanner();
    const original = Storage.prototype.setItem;
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'wealth_records_v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    try {
      await act(async () => {
        expect(() => service.saveWealthRecords([record(999)])).toThrow('Storage full');
      });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se guardó aquí. Reintenta antes de cerrar.');
      expect(service.loadWealthRecords()[0].amount).toBe(123);
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally {
      fail.mockRestore();
    }
    await act(async () => {
      service.saveWealthRecords([record(123)], { skipCloudSync: true, silent: true });
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => { service.saveWealthRecords([record(999)]); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(service.loadWealthRecords()[0].amount).toBe(999);
  });

  it('keeps connection loss amber while showing a local save failure even offline and scrolled', async () => {
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    const scrollDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 200 });
    const { ConnectionBanner, WealthSyncBanner } = await import('../src/components/Components');
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    try {
      await act(async () => { root?.render(React.createElement(React.Fragment, null,
        React.createElement(ConnectionBanner), React.createElement(WealthSyncBanner),
      )); });
      expect(container.querySelector('.bg-red-600')).toBeNull();
      expect(container.textContent).toContain('Sin conexión');
      const original = Storage.prototype.setItem;
      const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === 'wealth_records_v1') throw new DOMException('Storage full', 'QuotaExceededError');
        return original.call(this, key, value);
      });
      try {
        await act(async () => { expect(() => service.saveWealthRecords([record(999)])).toThrow('Storage full'); });
        expect(container.querySelector('[role="alert"]')?.classList.contains('bg-red-600')).toBe(true);
      } finally {
        fail.mockRestore();
      }
    } finally {
      if (onlineDescriptor) Object.defineProperty(navigator, 'onLine', onlineDescriptor);
      else Reflect.deleteProperty(navigator, 'onLine');
      if (scrollDescriptor) Object.defineProperty(window, 'scrollY', scrollDescriptor);
      else Reflect.deleteProperty(window, 'scrollY');
    }
  });
});

describe('wealth sync scheduling acknowledgement', () => {
  it('hides pending and success banners while scrolled and restores them at the top', async () => {
    const { WealthSyncBanner } = await import('../src/components/Components');
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(React.createElement(WealthSyncBanner)); });

    const scrollDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY');
    const scrollToY = async (y: number) => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
      await act(async () => { window.dispatchEvent(new Event('scroll')); });
    };
    try {
      await act(async () => {
        service.scheduleWealthCloudSync(5000);
        await settle();
      });
      expect(container.textContent).toContain('Pendiente de sincronización');

      await scrollToY(120);
      expect(container.textContent).not.toContain('Pendiente de sincronización');
      await scrollToY(0);
      expect(container.textContent).toContain('Pendiente de sincronización');

      await act(async () => { expect(await service.syncWealthNow()).toBe(true); });
      expect(container.textContent).toContain('Sincronización realizada');
      await scrollToY(120);
      expect(container.textContent).not.toContain('Sincronización realizada');
      await scrollToY(0);
      expect(container.textContent).toContain('Sincronización realizada');
    } finally {
      if (scrollDescriptor) Object.defineProperty(window, 'scrollY', scrollDescriptor);
      else Reflect.deleteProperty(window, 'scrollY');
    }
  });

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
