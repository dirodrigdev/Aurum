import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUid: { value: 'owner-1' as string | null },
  getDocFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  normalizeSnapshot: vi.fn((raw: unknown, monthKey: string) => {
    const value = raw as { monthKey?: string } | null;
    return value?.monthKey === monthKey ? raw : undefined;
  }),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...parts: string[]) => parts.join('/')),
  getDocFromServer: mocks.getDocFromServer,
  onSnapshot: mocks.onSnapshot,
}));
vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: () => mocks.currentUid.value,
}));
vi.mock('../src/services/wealthStorage', () => ({
  normalizeGastappMonthlyExpenseCloseSnapshot: mocks.normalizeSnapshot,
  WEALTH_DATA_UPDATED_EVENT: 'aurum:wealth-data-updated',
}));

import {
  canUseHistoricalGastappSidecarForAnalysis,
  getHistoricalGastappSidecarAnalysisState,
  getHistoricalGastappSnapshotForAnalysis,
  subscribeHistoricalGastappSidecarForAnalysis,
  subscribeHistoricalGastappSidecarAnalysisState,
} from '../src/services/historicalGastappSidecar';

const makeDocument = (monthKey = '2026-07', closureId = 'closure-july', totalEur = 2450) => ({
  schemaVersion: 'aurum-gastapp-historical-sidecar-v1' as const,
  snapshotsByMonth: {
    [monthKey]: {
      closureId,
      snapshot: { monthKey, totalEur, contractHash: 'sha256:source' },
      repairAudit: {
        reason: 'historical_schema_compatibility_reconstruction' as const,
        reconstructedAt: '2026-10-05T10:00:00.000Z',
        originalClosureAt: `${monthKey}-28T23:59:59.000Z`,
        preFingerprint: 'sha256:stable-history',
        postFingerprint: 'sha256:stable-history',
        sourceContractHash: 'sha256:source',
      },
    },
  },
});

const serverSnapshot = (document: ReturnType<typeof makeDocument> | null) => ({
  exists: () => document !== null,
  data: () => document,
});

describe('historical GastApp sidecar analysis state', () => {
  let listenerNext: ((snapshot: ReturnType<typeof serverSnapshot> & { metadata?: { fromCache?: boolean } }) => void) | null;
  let listenerError: ((error: Error) => void) | null;

  beforeEach(() => {
    mocks.currentUid.value = 'owner-1';
    mocks.normalizeSnapshot.mockImplementation((raw: unknown, monthKey: string) => {
      const value = raw as { monthKey?: string } | null;
      return value?.monthKey === monthKey ? raw : undefined;
    });
    mocks.getDocFromServer.mockReset();
    mocks.onSnapshot.mockReset();
    listenerNext = null;
    listenerError = null;
    mocks.onSnapshot.mockImplementation((_ref, _options, next, error) => {
      listenerNext = next;
      listenerError = error;
      return vi.fn();
    });
  });

  it('keeps historical analysis unavailable until the server read is authoritative', async () => {
    let resolveRead!: (value: ReturnType<typeof serverSnapshot>) => void;
    mocks.getDocFromServer.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));

    const stop = subscribeHistoricalGastappSidecarForAnalysis();
    expect(getHistoricalGastappSidecarAnalysisState().status).toBe('loading');
    expect(canUseHistoricalGastappSidecarForAnalysis(getHistoricalGastappSidecarAnalysisState(), 'owner-1')).toBe(false);

    await vi.waitFor(() => expect(mocks.getDocFromServer).toHaveBeenCalledTimes(1));
    resolveRead(serverSnapshot(makeDocument()));
    await vi.waitFor(() => expect(getHistoricalGastappSidecarAnalysisState().status).toBe('ready'));

    expect(canUseHistoricalGastappSidecarForAnalysis(getHistoricalGastappSidecarAnalysisState(), 'owner-1')).toBe(true);
    expect(getHistoricalGastappSnapshotForAnalysis('2026-07', 'closure-july')?.totalEur).toBe(2450);
    stop();
  });

  it('preserves the last valid snapshots when the live listener reports a transient error', async () => {
    mocks.getDocFromServer.mockResolvedValue(serverSnapshot(makeDocument()));
    const stop = subscribeHistoricalGastappSidecarForAnalysis();
    await vi.waitFor(() => expect(getHistoricalGastappSidecarAnalysisState().status).toBe('ready'));
    await vi.waitFor(() => expect(listenerError).not.toBeNull());
    const dataRevision = getHistoricalGastappSidecarAnalysisState().dataRevision;

    listenerError?.(new Error('temporary listener failure'));

    const state = getHistoricalGastappSidecarAnalysisState();
    expect(state.status).toBe('error');
    expect(state.hasAuthoritativeSnapshot).toBe(true);
    expect(state.dataRevision).toBe(dataRevision);
    expect(canUseHistoricalGastappSidecarForAnalysis(state, 'owner-1')).toBe(true);
    expect(getHistoricalGastappSnapshotForAnalysis('2026-07', 'closure-july')?.totalEur).toBe(2450);
    expect(getHistoricalGastappSnapshotForAnalysis('2026-07', 'different-closure')).toBeUndefined();
    stop();
  });

  it('publishes valid listener updates as a new analysis revision', async () => {
    mocks.getDocFromServer.mockResolvedValue(serverSnapshot(makeDocument()));
    const stop = subscribeHistoricalGastappSidecarForAnalysis();
    const onStateChange = vi.fn();
    const unsubscribeState = subscribeHistoricalGastappSidecarAnalysisState(onStateChange);
    await vi.waitFor(() => expect(getHistoricalGastappSidecarAnalysisState().status).toBe('ready'));
    await vi.waitFor(() => expect(listenerNext).not.toBeNull());
    const initialDataRevision = getHistoricalGastappSidecarAnalysisState().dataRevision;

    listenerNext?.({ ...serverSnapshot(makeDocument('2026-07', 'closure-july', 3100)), metadata: { fromCache: false } });

    expect(getHistoricalGastappSidecarAnalysisState().dataRevision).toBe(initialDataRevision + 1);
    expect(getHistoricalGastappSnapshotForAnalysis('2026-07', 'closure-july')?.totalEur).toBe(3100);
    expect(onStateChange).toHaveBeenCalled();
    unsubscribeState();
    stop();
  });

  it('shows an explicit error after first-load failure and ignores cached listener data', async () => {
    mocks.getDocFromServer.mockRejectedValue(new Error('offline server read'));
    const stop = subscribeHistoricalGastappSidecarForAnalysis();
    await vi.waitFor(() => expect(getHistoricalGastappSidecarAnalysisState().status).toBe('error'));
    await vi.waitFor(() => expect(listenerNext).not.toBeNull());

    listenerNext?.({ ...serverSnapshot(makeDocument()), metadata: { fromCache: true } });
    expect(getHistoricalGastappSidecarAnalysisState().status).toBe('error');
    expect(getHistoricalGastappSidecarAnalysisState().hasAuthoritativeSnapshot).toBe(false);
    expect(canUseHistoricalGastappSidecarForAnalysis(getHistoricalGastappSidecarAnalysisState(), 'owner-1')).toBe(false);

    listenerNext?.({ ...serverSnapshot(makeDocument()), metadata: { fromCache: false } });
    expect(getHistoricalGastappSidecarAnalysisState().status).toBe('ready');
    expect(canUseHistoricalGastappSidecarForAnalysis(getHistoricalGastappSidecarAnalysisState(), 'owner-1')).toBe(true);
    stop();
  });

  it('does not reuse authoritative data from another account', async () => {
    mocks.getDocFromServer.mockResolvedValue(serverSnapshot(makeDocument()));
    const stop = subscribeHistoricalGastappSidecarForAnalysis();
    await vi.waitFor(() => expect(getHistoricalGastappSidecarAnalysisState().status).toBe('ready'));
    mocks.currentUid.value = 'owner-2';

    expect(canUseHistoricalGastappSidecarForAnalysis(getHistoricalGastappSidecarAnalysisState(), 'owner-2')).toBe(false);
    stop();
  });
});
