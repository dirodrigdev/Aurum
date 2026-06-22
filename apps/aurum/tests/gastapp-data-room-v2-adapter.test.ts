import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMock = vi.hoisted(() => {
  const state = {
    currentDoc: null as Record<string, unknown> | null,
    periodSummaries: [] as Array<{ id: string; data: Record<string, unknown> }>,
    rows: [] as Array<{ id: string; data: Record<string, unknown> }>,
    queries: [] as unknown[],
    db: { app: { options: { projectId: 'gastapp-test' } } },
  };
  return {
    state,
    doc: vi.fn((db: any, path: string, id: string) => ({ kind: 'doc', db, path, id })),
    collection: vi.fn((db: any, ...segments: string[]) => ({ kind: 'collection', db, path: segments.join('/') })),
    documentId: vi.fn(() => '__name__'),
    orderBy: vi.fn((field: string) => ({ type: 'orderBy', field })),
    limit: vi.fn((value: number) => ({ type: 'limit', value })),
    startAfter: vi.fn((value: string) => ({ type: 'startAfter', value })),
    query: vi.fn((collectionRef: any, ...constraints: any[]) => {
      const built = { kind: 'query', collectionRef, constraints };
      state.queries.push(built);
      return built;
    }),
    getDoc: vi.fn(async (ref: { path: string; id: string }) => ({
      exists: () => ref.path === 'gastapp_data_room_v2' && ref.id === 'current' && Boolean(state.currentDoc),
      id: ref.id,
      data: () => state.currentDoc || {},
    })),
    getDocs: vi.fn(async (target: any) => {
      const path = target?.path || target?.collectionRef?.path || '';
      if (path.endsWith('/period_summaries')) {
        return {
          docs: state.periodSummaries.map((item) => ({ id: item.id, data: () => item.data })),
        };
      }
      if (path.endsWith('/rows')) {
        const limitConstraint = target?.constraints?.find((item: any) => item.type === 'limit');
        const startAfterConstraint = target?.constraints?.find((item: any) => item.type === 'startAfter');
        let rows = [...state.rows];
        if (startAfterConstraint?.value) {
          const index = rows.findIndex((item) => item.id === startAfterConstraint.value);
          rows = index >= 0 ? rows.slice(index + 1) : rows;
        }
        if (limitConstraint?.value) {
          rows = rows.slice(0, limitConstraint.value);
        }
        return {
          docs: rows.map((item) => ({ id: item.id, data: () => item.data })),
        };
      }
      return { docs: [] };
    }),
  };
});

vi.mock('firebase/firestore', () => ({
  doc: firestoreMock.doc,
  collection: firestoreMock.collection,
  documentId: firestoreMock.documentId,
  orderBy: firestoreMock.orderBy,
  limit: firestoreMock.limit,
  startAfter: firestoreMock.startAfter,
  query: firestoreMock.query,
  getDoc: firestoreMock.getDoc,
  getDocs: firestoreMock.getDocs,
}));

vi.mock('../src/services/firebase', () => ({
  getGastappConfiguredProjectId: () => 'gastapp-test',
  isGastappFirestoreConfigured: () => true,
  getGastappFirestore: () => firestoreMock.state.db,
}));

const usableManifest = {
  schemaVersion: 'gastapp-data-room-v2',
  calculationVersion: 'deep-ledger-v2-cutoff-2026-01-01',
  dataHash: 'fnv1a64:22f103202e980cfc',
  sourceCommit: 'd24402d',
  readinessStatus: 'warning',
  officialRefreshAllowed: true,
  consumerRefreshRequired: false,
  blockers: [],
  warnings: ['P32:mixed_period_cutoff_review'],
  rows: 2295,
  periodSummaries: 37,
};

const resetFirestoreMock = () => {
  firestoreMock.state.currentDoc = null;
  firestoreMock.state.periodSummaries = [];
  firestoreMock.state.rows = [];
  firestoreMock.state.queries = [];
  firestoreMock.doc.mockClear();
  firestoreMock.collection.mockClear();
  firestoreMock.documentId.mockClear();
  firestoreMock.orderBy.mockClear();
  firestoreMock.limit.mockClear();
  firestoreMock.startAfter.mockClear();
  firestoreMock.query.mockClear();
  firestoreMock.getDoc.mockClear();
  firestoreMock.getDocs.mockClear();
};

describe('gastappDataRoomV2Adapter', () => {
  beforeEach(() => {
    vi.resetModules();
    resetFirestoreMock();
  });

  it('marks warning manifests as usable when official refresh is allowed and blockers are empty', async () => {
    const mod = await import('../src/services/dataRoom/gastappDataRoomV2Adapter');
    const manifest = mod.normalizeGastappDataRoomV2Manifest('current', usableManifest);

    expect(mod.isGastappDataRoomV2Usable(manifest)).toBe(true);
    expect(manifest.runId).toBe('fnv1a64_22f103202e980cfc');
  });

  it('marks blocked manifests as not usable', async () => {
    const mod = await import('../src/services/dataRoom/gastappDataRoomV2Adapter');
    const manifest = mod.normalizeGastappDataRoomV2Manifest('current', {
      ...usableManifest,
      readinessStatus: 'blocked',
      blockers: ['P33:missing_granular'],
    });

    expect(mod.isGastappDataRoomV2Usable(manifest)).toBe(false);
  });

  it('marks manifests with officialRefreshAllowed=false as not usable', async () => {
    const mod = await import('../src/services/dataRoom/gastappDataRoomV2Adapter');
    const manifest = mod.normalizeGastappDataRoomV2Manifest('current', {
      ...usableManifest,
      officialRefreshAllowed: false,
    });

    expect(mod.isGastappDataRoomV2Usable(manifest)).toBe(false);
  });

  it('normalizes dataHash into the run document id format', async () => {
    const mod = await import('../src/services/dataRoom/gastappDataRoomV2Adapter');
    expect(mod.normalizeGastappDataRoomV2RunId('fnv1a64:22f103202e980cfc')).toBe('fnv1a64_22f103202e980cfc');
  });

  it('does not load rows when only reading the current manifest', async () => {
    firestoreMock.state.currentDoc = usableManifest;
    const mod = await import('../src/services/dataRoom/gastappDataRoomV2Adapter');

    const result = await mod.getGastappDataRoomV2Manifest();

    expect(result.status).toBe('usable');
    expect(result.usable).toBe(true);
    expect(firestoreMock.getDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMock.getDocs).not.toHaveBeenCalled();
  });

  it('loads period summaries from the run path and rows only when explicitly requested', async () => {
    firestoreMock.state.currentDoc = usableManifest;
    firestoreMock.state.periodSummaries = [
      {
        id: 'P31',
        data: {
          period: 'P31',
          periodPolicy: 'accepted_historical_reference',
          readinessStatus: 'warning',
          officialAmountEur: 100,
          canonicalRowCount: 12,
          rowCount: 12,
        },
      },
    ];
    firestoreMock.state.rows = [
      { id: 'row-1', data: { source_kind: 'legacy_csv', amount_eur: 10, period: 'P31' } },
      { id: 'row-2', data: { source_kind: 'monthly_expenses', amount_eur: 20, period: 'P32' } },
    ];
    const mod = await import('../src/services/dataRoom/gastappDataRoomV2Adapter');

    const summaries = await mod.getGastappDataRoomV2PeriodSummaries();
    expect(summaries.summaries).toHaveLength(1);
    expect(summaries.collectionPath).toBe('gastapp_data_room_v2/fnv1a64_22f103202e980cfc/period_summaries');

    const beforeRowsCalls = firestoreMock.getDocs.mock.calls.length;
    const page = await mod.getGastappDataRoomV2RowsPage({ pageSize: 1 });
    expect(page.page.rows).toHaveLength(1);
    expect(page.page.nextCursor).toBe('row-1');
    expect(page.collectionPath).toBe('gastapp_data_room_v2/fnv1a64_22f103202e980cfc/rows');
    expect(firestoreMock.getDocs.mock.calls.length).toBe(beforeRowsCalls + 1);
  });

  it('keeps the v1 collection path unchanged as regression guard', async () => {
    const { loadGastappMonthlyDataRoomData } = await import('../src/services/dataRoom/gastappMonthlyAdapter');
    await loadGastappMonthlyDataRoomData();

    expect(firestoreMock.collection).toHaveBeenCalledWith(
      firestoreMock.state.db,
      'aurum_monthly_from_periods_v1',
    );
  });
});
