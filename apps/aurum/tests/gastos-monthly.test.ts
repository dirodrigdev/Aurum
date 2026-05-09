import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

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
  getGastappFirestore: () => firestoreMock.state.db,
}));

const resetFirestoreMock = () => {
  firestoreMock.state.docs = [];
  firestoreMock.state.writes = [];
  firestoreMock.collection.mockClear();
  firestoreMock.doc.mockClear();
  firestoreMock.getDoc.mockClear();
  firestoreMock.getDocs.mockClear();
  firestoreMock.setDoc.mockClear();
};

const makeClosure = (monthKey: string, netClp: number): WealthMonthlyClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59-03:00`,
  summary: {
    netByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: netClp,
    byBlock: {
      bank: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    },
    netClp,
    netClpWithRisk: netClp,
  },
  fxRates: {
    usdClp: 900,
    eurClp: 1000,
    ufClp: 38000,
  },
});

describe('gastosMonthly canonical source', () => {
  beforeEach(() => {
    vi.resetModules();
    resetFirestoreMock();
  });

  it('uses Firestore docs from aurum_monthly_from_periods_v1 over legacy values', async () => {
    firestoreMock.state.docs = [
      {
        id: '2026-02',
        data: {
          status: 'complete',
          total_contable_eur: 1234,
          dataQuality: 'ok',
          source: 'monthly_reports',
          day_to_day_source: 'period_summaries',
        },
      },
    ];
    const { resolveGastappMonthlySpend, warmGastappMonthlyContable } = await import('../src/services/gastosMonthly');

    await warmGastappMonthlyContable();
    const resolution = resolveGastappMonthlySpend('2026-02', new Date('2026-05-09T12:00:00Z'));

    expect(resolution.source).toBe('gastapp_firestore');
    expect(resolution.gastosEur).toBe(1234);
    expect(resolution.contractSource).toBe('monthly_reports');
    expect(resolution.gastosEur).not.toBe(7928);
  });

  it('does not use legacy as official when Firestore is loading or missing a canonical doc', async () => {
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
    expect(preview.candidates).toEqual([
      expect.objectContaining({ monthKey: '2026-02', gastosEur: 7928, source: 'legacy_static' }),
    ]);
  });

  it('backfills legacy values into the canonical collection with audit metadata', async () => {
    const { backfillGastappMonthlyFromLegacy, resolveGastappMonthlySpend } = await import('../src/services/gastosMonthly');
    const { aggregateRows, computeMonthlyRows } = await import('../src/services/returnsAnalysis');

    const result = await backfillGastappMonthlyFromLegacy(['2026-02']);
    const resolution = resolveGastappMonthlySpend('2026-02', new Date('2026-05-09T12:00:00Z'));
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', 1_000_000_000),
        makeClosure('2026-02', 1_050_000_000),
      ],
      false,
      'CLP',
    );
    const summary = aggregateRows('backfilled', 'Backfilled', rows.slice(1), rows[1].prevNetDisplay, {
      expectedMonthKeys: ['2026-02'],
    });

    expect(result.backfilled).toHaveLength(1);
    expect(firestoreMock.setDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMock.state.writes[0].ref).toMatchObject({
      path: 'aurum_monthly_from_periods_v1',
      id: '2026-02',
    });
    expect(firestoreMock.state.writes[0].payload).toMatchObject({
      monthKey: '2026-02',
      status: 'complete',
      total_contable_eur: 7928,
      dataQuality: 'ok',
      source: 'gastapp_monthly_backfill',
      day_to_day_source: 'legacy_static_backfill',
      reason: 'gastapp_monthly_backfill',
      migratedFrom: 'legacy_static',
      backfillAudit: expect.objectContaining({
        monthKey: '2026-02',
        valueEur: 7928,
        migratedFrom: 'legacy_static',
        reason: 'gastapp_monthly_backfill',
      }),
    });
    expect(resolution.source).toBe('gastapp_firestore');
    expect(resolution.gastosEur).toBe(7928);
    expect(resolution.dataQuality).toBe('ok');
    expect(resolution.reason).toBe('gastapp_monthly_backfill');
    expect(summary.validMonths).toBe(1);
    expect(summary.coverage.status).toBe('complete');
  });
});
