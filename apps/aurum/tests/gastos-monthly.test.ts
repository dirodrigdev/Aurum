import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMock = vi.hoisted(() => {
  const state = {
    docs: [] as Array<{ id: string; data: Record<string, unknown> }>,
    writes: [] as Array<{ ref: any; payload: any; options: any }>,
    db: { app: { options: { projectId: 'gastapp-test' } } },
  };
  return {
    state,
    collection: vi.fn((db: any, path: string) => ({ db, path })),
    doc: vi.fn((db: any, path: string, id: string) => ({ db, path, id })),
    getDocs: vi.fn(async () => ({
      size: state.docs.length,
      empty: state.docs.length === 0,
      forEach: (callback: (doc: { id: string; data: () => Record<string, unknown> }) => void) => {
        state.docs.forEach((item) => callback({ id: item.id, data: () => item.data }));
      },
    })),
    getDoc: vi.fn(async (ref: { id: string }) => ({
      exists: () => state.docs.some((item) => item.id === ref.id),
    })),
    setDoc: vi.fn(async (ref: any, payload: any, options: any) => {
      state.writes.push({ ref, payload, options });
    }),
  };
});

const { loadGastappCanonicalV2MonthContractMock } = vi.hoisted(() => ({
  loadGastappCanonicalV2MonthContractMock: vi.fn(),
}));

vi.mock('../src/services/gastappCanonicalV2', () => ({
  loadGastappCanonicalV2MonthContract: loadGastappCanonicalV2MonthContractMock,
  loadGastappCanonicalV2MonthContractCached: loadGastappCanonicalV2MonthContractMock,
}));

vi.mock('firebase/firestore', () => ({
  collection: firestoreMock.collection,
  doc: firestoreMock.doc,
  getDoc: firestoreMock.getDoc,
  getDocs: firestoreMock.getDocs,
  setDoc: firestoreMock.setDoc,
}));

vi.mock('../src/services/firebase', () => ({
  getGastappConfiguredProjectId: () => 'gastapp-test',
  isGastappFirestoreConfigured: () => true,
  isE2EFirebaseEmulatorEnabled: () => false,
  getGastappFirestore: () => firestoreMock.state.db,
}));

const resetFirestoreMock = () => {
  firestoreMock.state.docs = [];
  firestoreMock.state.writes = [];
  loadGastappCanonicalV2MonthContractMock.mockReset();
  firestoreMock.collection.mockClear();
  firestoreMock.doc.mockClear();
  firestoreMock.getDoc.mockClear();
  firestoreMock.getDocs.mockClear();
  firestoreMock.setDoc.mockClear();
};

describe('gastosMonthly canonical source', () => {
  beforeEach(() => {
    vi.resetModules();
    resetFirestoreMock();
  });

  it('uses the validated calendar contract as the official Firestore source', async () => {
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({
      metadata: {},
      months: {
        version: 'gastapp-aurum-calendar-months-v2',
        generatedAt: '2026-03-01T00:00:00.000Z',
        raw: { dateSemantics: 'gastapp-canonical-calendar-offline-v2' },
        months: [{
          calendarMonthKey: '2026-02',
          status: 'complete',
          calendarStatus: 'complete',
          eligibleForAurumReturns: true,
          fromYmd: '2026-02-01',
          toYmd: '2026-02-28',
          rowCount: 1,
          totalEur: 1234,
          byFamily: { day_to_day: 1234 },
          byCategory: {},
          byProject: {},
          raw: {},
        }],
      },
    });
    const { resolveGastappMonthlySpend, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    const resolution = resolveGastappMonthlySpend('2026-02', new Date('2026-05-09T12:00:00Z'));

    expect(resolution.source).toBe('gastapp_firestore');
    expect(resolution.gastosEur).toBe(1234);
    expect(resolution.contractSource).toBe('gastapp-aurum-calendar-months-v2');
    expect(resolution.dayToDaySource).toBe('gastapp-canonical-calendar-v2');
    expect(resolution.schemaVersion).toBe('gastapp-aurum-calendar-months-v2');
    expect(resolution.methodologyVersion).toBe('gastapp-canonical-calendar-offline-v2');
    expect(resolution.publishedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(resolution.gastosEur).not.toBe(7928);
    expect(firestoreMock.collection).not.toHaveBeenCalled();
    expect(loadGastappCanonicalV2MonthContractMock).toHaveBeenCalledTimes(1);
  });

  it('does not use legacy as official when Firestore is loading or missing a canonical doc', async () => {
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({ metadata: {}, months: { version: 'gastapp-aurum-calendar-months-v2', generatedAt: null, raw: {}, months: [] } });
    const { previewGastappMonthlyLegacyBackfill, resolveGastappMonthlySpend, warmGastappMonthlyContable } = await import(
      '../src/services/gastosMonthly'
    );

    const loadingResolution = resolveGastappMonthlySpend('2026-02', new Date('2026-05-09T12:00:00Z'));
    expect(loadingResolution.source).toBe('gastapp_firestore');
    expect(loadingResolution.gastosEur).toBeNull();

    await warmGastappMonthlyContable();
    const missingCanonical = resolveGastappMonthlySpend('2026-02', new Date('2026-05-09T12:00:00Z'));
    const preview = await previewGastappMonthlyLegacyBackfill(['2026-02']);

    expect(missingCanonical.source).toBe('gastapp_firestore');
    expect(missingCanonical.status).toBe('missing');
    expect(missingCanonical.gastosEur).toBeNull();
    expect(preview.status).toBe('unavailable');
    expect(preview.candidates).toEqual([]);
    expect(preview.error).toBe('period_legacy_backfill_disabled_for_calendar_contract');
  });

  it('refuses to backfill period-labelled legacy values into the calendar contract', async () => {
    const { backfillGastappMonthlyFromLegacy } = await import('../src/services/gastosMonthly');

    const result = await backfillGastappMonthlyFromLegacy(['2026-02']);

    expect(result.backfilled).toEqual([]);
    expect(result.skipped).toEqual([{ monthKey: '2026-02', reason: 'period_legacy_backfill_disabled' }]);
    expect(firestoreMock.getDoc).not.toHaveBeenCalled();
    expect(firestoreMock.setDoc).not.toHaveBeenCalled();
  });

  it('does not use totals from partial calendar months', async () => {
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({
      metadata: {},
      months: {
        version: 'gastapp-aurum-calendar-months-v2',
        generatedAt: null,
        raw: {},
        months: [{
          calendarMonthKey: '2026-08',
          status: 'pending',
          calendarStatus: 'partial_boundary_end',
          eligibleForAurumReturns: false,
          fromYmd: '2026-08-01',
          toYmd: '2026-08-11',
          rowCount: 1,
          totalEur: 2567.05,
          byFamily: {},
          byCategory: {},
          byProject: {},
          raw: {},
        }],
      },
    });
    const { resolveGastappMonthlySpend, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    const resolution = resolveGastappMonthlySpend('2026-08', new Date('2026-08-14T12:00:00Z'));

    expect(resolution.status).toBe('pending');
    expect(resolution.gastosEur).toBeNull();
    expect(resolution.contractSource).toBe('gastapp-aurum-calendar-months-v2');
  });
});
