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

const { clearGastappCanonicalV2CacheMock, loadGastappCanonicalV2MonthContractMock } = vi.hoisted(() => ({
  clearGastappCanonicalV2CacheMock: vi.fn(),
  loadGastappCanonicalV2MonthContractMock: vi.fn(),
}));

vi.mock('../src/services/gastappCanonicalV2', () => ({
  loadGastappCanonicalV2MonthContract: loadGastappCanonicalV2MonthContractMock,
  loadGastappCanonicalV2MonthContractCached: loadGastappCanonicalV2MonthContractMock,
  clearGastappCanonicalV2Cache: clearGastappCanonicalV2CacheMock,
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
  clearGastappCanonicalV2CacheMock.mockReset();
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

  it('uses the validated calendar contract as the official Firestore source within its €1 reconciliation tolerance', async () => {
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({
      metadata: {},
      months: {
        version: 'gastapp-aurum-calendar-months-v2',
        canonicalDataHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        contractHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
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
          byFamily: { day_to_day: 1233.5, trips: 0, others: 0 },
          byCategory: {},
          byProject: {},
          raw: {},
        }],
      },
    });
    const { resolveGastappMonthlyCloseCandidate, resolveGastappMonthlySpend, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    const resolution = resolveGastappMonthlySpend('2026-02', new Date('2026-05-09T12:00:00Z'));

    expect(resolution.source).toBe('gastapp_firestore');
    expect(resolution.gastosEur).toBe(1234);
    expect(resolution.contractSource).toBe('gastapp-aurum-calendar-months-v2');
    expect(resolution.dayToDaySource).toBe('gastapp-canonical-calendar-v2');
    expect(resolution.schemaVersion).toBe('gastapp-aurum-calendar-months-v2');
    expect(resolution.methodologyVersion).toBe('gastapp-canonical-calendar-offline-v2');
    expect(resolution.publishedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(resolveGastappMonthlyCloseCandidate('2026-02', {
      previousSnapshot: { contractHash: 'sha256:old' },
    })).toMatchObject({
      status: 'complete',
      sourceChangedAfterClosure: true,
      currentContractHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      storedContractHash: 'sha256:old',
      snapshot: {
        totalEur: 1234,
        byFamilyEur: { dayToDay: 1233.5, trips: 0, others: 0 },
      },
    });
    expect(resolution.gastosEur).not.toBe(7928);
    expect(firestoreMock.collection).not.toHaveBeenCalled();
    expect(loadGastappCanonicalV2MonthContractMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cached official document exactly when the close flow requests freshness', async () => {
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({
      metadata: {},
      months: {
        version: 'gastapp-aurum-calendar-months-v2',
        canonicalDataHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        contractHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        generatedAt: '2026-03-01T00:00:00.000Z',
        raw: {},
        months: [],
      },
    });
    const { refreshGastappMonthlyContable, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    await refreshGastappMonthlyContable();

    expect(clearGastappCanonicalV2CacheMock).toHaveBeenCalledTimes(1);
    expect(loadGastappCanonicalV2MonthContractMock).toHaveBeenCalledTimes(2);
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
          byFamily: { day_to_day: 2000, trips: 500, others: 67.05 },
          byCategory: {},
          byProject: {},
          raw: {},
        }],
      },
    });
    const { resolveGastappMonthlyCloseCandidate, resolveGastappMonthlySpend, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    const resolution = resolveGastappMonthlySpend('2026-08', new Date('2026-08-14T12:00:00Z'));

    expect(resolution.status).toBe('pending');
    expect(resolution.gastosEur).toBeNull();
    expect(resolution.partialGastosEur).toBe(2567.05);
    expect(resolution.partialByFamilyEur).toEqual({ dayToDay: 2000, trips: 500, others: 67.05 });
    expect(resolution.contractSource).toBe('gastapp-aurum-calendar-months-v2');
    expect(resolveGastappMonthlyCloseCandidate('2026-08')).toMatchObject({
      status: 'pending',
      partialGastosEur: 2567.05,
      snapshot: null,
    });
  });

  it('requires GastApp calendar-close attestation once the producer activates the protocol', async () => {
    const baseContract = {
      version: 'gastapp-aurum-calendar-months-v2',
      canonicalDataHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      contractHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      generatedAt: '2026-08-01T00:00:01.000Z',
      raw: {},
      months: [{
        calendarMonthKey: '2026-07',
        status: 'complete',
        calendarStatus: 'complete',
        eligibleForAurumReturns: true,
        fromYmd: '2026-07-01',
        toYmd: '2026-07-31',
        rowCount: 1,
        totalEur: 210,
        byFamily: { day_to_day: 120, trips: 60, others: 30 },
        byCategory: {},
        byProject: {},
        raw: {},
      }],
    };
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({
      metadata: {
        raw: {
          calendarMonthCloseProtocolVersion: 'gastapp-calendar-month-close-v1',
          calendarMonthClosures: {},
        },
      },
      months: baseContract,
    });
    const { resolveGastappMonthlyCloseCandidate, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    expect(resolveGastappMonthlyCloseCandidate('2026-07')).toMatchObject({
      status: 'stale',
      snapshot: null,
    });

    vi.resetModules();
    resetFirestoreMock();
    loadGastappCanonicalV2MonthContractMock.mockResolvedValue({
      metadata: {
        raw: {
          calendarMonthCloseProtocolVersion: 'gastapp-calendar-month-close-v1',
          calendarMonthClosures: {
            '2026-07': {
              state: 'closed',
              monthKey: '2026-07',
              closedAt: '2026-08-01T00:00:01.000Z',
              updatedAt: '2026-08-01T00:00:01.000Z',
              revision: 1,
              canonicalDataHash: baseContract.canonicalDataHash,
              sourceContractGeneratedAt: baseContract.generatedAt,
              totalEur: 210,
              byFamily: { day_to_day: 120, trips: 60, others: 30 },
            },
          },
        },
      },
      months: baseContract,
    });
    const freshModule = await import('../src/services/gastosMonthly');

    await freshModule.warmGastappMonthlyContable();
    expect(freshModule.resolveGastappMonthlyCloseCandidate('2026-07')).toMatchObject({
      status: 'complete',
      snapshot: { totalEur: 210 },
    });
  });

  it('uses the calendar boundary, not the retired day-12 cutoff, when the contract is unavailable', async () => {
    const { hasGastappCalendarMonthEnded } = await import('../src/services/gastosMonthly');

    expect(hasGastappCalendarMonthEnded('2026-08', new Date('2026-08-31T23:59:59'))).toBe(false);
    expect(hasGastappCalendarMonthEnded('2026-08', new Date('2026-09-01T00:00:00'))).toBe(true);
  });
});
