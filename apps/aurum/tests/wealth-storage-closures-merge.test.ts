import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: async () => {},
  getCurrentUid: () => null,
}));
import {
  isWealthCloudWriteStale,
  mergeClosuresForSync,
  protectRemoteClosuresFromEmptyOverwrite,
  type GastappMonthlyExpenseCloseSnapshot,
  type WealthMonthlyClosure,
} from '../src/services/wealthStorage';

const makeClosure = (monthKey: string, id: string, closedAt: string): WealthMonthlyClosure => ({
  id,
  monthKey,
  closedAt,
  summary: {
    netByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: 0,
    byBlock: {
      bank: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    },
  },
});

const makeGastappSnapshot = (revision: number, hash: string, capturedAt: string): GastappMonthlyExpenseCloseSnapshot => ({
  schemaVersion: 'aurum-gastapp-monthly-close-v2',
  sourcePath: 'gastapp_aurum_contracts_v2/months_current',
  monthKey: '2026-07',
  calendarMonthKey: '2026-07',
  totalEur: revision * 100,
  byFamilyEur: { dayToDay: revision * 80, trips: revision * 10, others: revision * 10 },
  canonicalDataHash: hash,
  operationalDataHash: hash,
  operationalRevision: revision,
  sourceGeneration: revision,
  monthContractRevision: revision,
  monthContractHash: hash,
  certificationStatus: revision === 1 ? 'certified' : 'revised',
  certificationRevision: revision,
  certificationHash: hash,
  contractHash: hash,
  contractVersion: 'gastapp-canonical-v2',
  generatedAt: capturedAt,
  capturedAt,
  fxRates: { usdClp: 900, eurClp: 1000, ufClp: 39000 },
  amountsByCurrency: {
    EUR: { total: revision * 100, dayToDay: revision * 80, trips: revision * 10, others: revision * 10 },
    CLP: { total: revision * 100_000, dayToDay: revision * 80_000, trips: revision * 10_000, others: revision * 10_000 },
    USD: { total: revision * 100_000 / 900, dayToDay: revision * 80_000 / 900, trips: revision * 10_000 / 900, others: revision * 10_000 / 900 },
    UF: { total: revision * 100_000 / 39_000, dayToDay: revision * 80_000 / 39_000, trips: revision * 10_000 / 39_000, others: revision * 10_000 / 39_000 },
  },
});

describe('wealth storage closures merge', () => {
  it('does not create a replacement version when synchronizing the identical frozen closure', () => {
    const closure = makeClosure('2026-07', 'july', '2026-08-01T12:00:00.000Z');
    const previous = makeClosure('2026-07', 'july-original', '2026-07-31T12:00:00.000Z');
    closure.previousVersions = [previous];
    const merged = mergeClosuresForSync([closure], [structuredClone(closure)]);
    expect(merged).toEqual([closure]);
    expect(mergeClosuresForSync(merged, [structuredClone(closure)])).toEqual([closure]);
  });

  it('preserves a different financial snapshot even when its id and timestamp match', () => {
    const local = makeClosure('2026-07', 'july', '2026-08-01T12:00:00.000Z');
    const remote = structuredClone(local);
    remote.summary.netConsolidatedClp = 1000;
    const merged = mergeClosuresForSync([local], [remote]);
    expect(merged[0].summary.netConsolidatedClp).toBe(1000);
    expect(merged[0].previousVersions).toHaveLength(1);
    expect(merged[0].previousVersions?.[0].summary.netConsolidatedClp).toBe(0);
  });

  it('keeps the newest accepted GastApp revision when a stale browser prefers local state', () => {
    const older = makeClosure('2026-07', 'july', '2026-08-01T12:00:00.000Z');
    const newer = structuredClone(older);
    older.gastappExpenseClose = makeGastappSnapshot(1, `sha256:${'a'.repeat(64)}`, '2026-08-02T12:00:00.000Z');
    newer.gastappExpenseClose = makeGastappSnapshot(2, `sha256:${'b'.repeat(64)}`, '2026-08-03T12:00:00.000Z');

    const merged = mergeClosuresForSync([older], [newer], true);

    expect(merged[0].gastappExpenseClose?.contractHash).toBe(newer.gastappExpenseClose?.contractHash);
    expect(merged[0].summary).toEqual(older.summary);
    expect(merged[0].previousVersions).toContainEqual(expect.objectContaining({
      id: expect.stringContaining(':gastapp:1:'),
      gastappExpenseClose: expect.objectContaining({ contractHash: older.gastappExpenseClose?.contractHash }),
    }));
  });

  it('does not add an empty revision archive when both browsers have the same accepted snapshot', () => {
    const closure = makeClosure('2026-07', 'july', '2026-08-01T12:00:00.000Z');
    closure.gastappExpenseClose = makeGastappSnapshot(2, `sha256:${'b'.repeat(64)}`, '2026-08-03T12:00:00.000Z');

    expect(mergeClosuresForSync([closure], [structuredClone(closure)], true)).toEqual([closure]);
  });

  it('detects a newer local revision before an in-flight cloud write', () => {
    expect(isWealthCloudWriteStale('2026-07-13T10:00:00.001Z', '2026-07-13T10:00:00.001Z')).toBe(false);
    expect(isWealthCloudWriteStale('2026-07-13T10:00:00.001Z', '2026-07-13T10:00:00.002Z')).toBe(true);
  });

  it('preserves remote closures when local closures are empty and preferLocal=true', () => {
    const remote = [makeClosure('2026-04', 'remote-apr', '2026-05-01T00:00:00.000Z')];
    const merged = mergeClosuresForSync([], remote, true);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('remote-apr');
    expect(merged[0].monthKey).toBe('2026-04');
  });

  it('unions local and remote closures by month when preferLocal=true', () => {
    const local = [
      makeClosure('2026-04', 'local-apr', '2026-05-03T00:00:00.000Z'),
    ];
    const remote = [
      makeClosure('2026-04', 'remote-apr', '2026-05-01T00:00:00.000Z'),
      makeClosure('2026-03', 'remote-mar', '2026-04-01T00:00:00.000Z'),
    ];
    const merged = mergeClosuresForSync(local, remote, true);
    expect(merged.map((item) => item.monthKey)).toEqual(['2026-04', '2026-03']);
    expect(merged.find((item) => item.monthKey === '2026-04')?.id).toBe('local-apr');
    expect(merged.find((item) => item.monthKey === '2026-03')?.id).toBe('remote-mar');
  });

  it('prevents cloud overwrite with empty closures when remote already has history', () => {
    const remote = [makeClosure('2026-04', 'remote-apr', '2026-05-01T00:00:00.000Z')];
    const result = protectRemoteClosuresFromEmptyOverwrite({
      mergedClosures: [],
      remoteClosures: remote,
    });
    expect(result.prevented).toBe(true);
    expect(result.closuresForCloud).toHaveLength(1);
    expect(result.closuresForCloud[0].id).toBe('remote-apr');
  });

  it('does not reintroduce a local closure removed by tombstone', () => {
    const removedMay = makeClosure('2026-05', 'bad-may', '2026-06-01T10:00:00.000Z');
    const april = makeClosure('2026-04', 'remote-apr', '2026-05-01T00:00:00.000Z');
    const merged = mergeClosuresForSync([removedMay], [april], false, [
      {
        monthKey: '2026-05',
        removedAt: '2026-06-01T12:00:00.000Z',
        reason: 'legacy_close_rollback_no_full_checkpoint',
        source: 'legacy_rollback',
        removedClosureFingerprint: JSON.stringify({
          id: removedMay.id,
          monthKey: removedMay.monthKey,
          closedAt: removedMay.closedAt,
          netClp: 0,
          investmentClp: 0,
          bankClp: 0,
          realEstateNetClp: 0,
          nonMortgageDebtClp: 0,
        }),
        removedClosureSummary: {
          bankClp: 0,
          investmentClp: 0,
          realEstateNetClp: 0,
          nonMortgageDebtClp: 0,
          netClp: 0,
        },
        removedClosedAt: removedMay.closedAt,
      },
    ]);

    expect(merged.map((item) => item.monthKey)).toEqual(['2026-04']);
  });

  it('allows a new re-close for the same month when tombstone fingerprint differs', () => {
    const removedMay = makeClosure('2026-05', 'bad-may', '2026-05-01T00:00:00.000Z');
    const newMay = {
      ...makeClosure('2026-05', 'new-may', '2026-05-01T00:00:00.000Z'),
      summary: {
        ...removedMay.summary,
        netConsolidatedClp: 1706517319,
      },
    };
    const merged = mergeClosuresForSync([newMay], [], false, [
      {
        monthKey: '2026-05',
        removedAt: '2026-06-01T12:00:00.000Z',
        reason: 'legacy_close_rollback_no_full_checkpoint',
        source: 'legacy_rollback',
        removedClosureFingerprint: JSON.stringify({
          id: removedMay.id,
          monthKey: removedMay.monthKey,
          closedAt: removedMay.closedAt,
          netClp: 0,
          investmentClp: 0,
          bankClp: 0,
          realEstateNetClp: 0,
          nonMortgageDebtClp: 0,
        }),
        removedClosureSummary: {
          bankClp: 0,
          investmentClp: 0,
          realEstateNetClp: 0,
          nonMortgageDebtClp: 0,
          netClp: 0,
        },
        removedClosedAt: removedMay.closedAt,
      },
    ]);

    expect(merged.map((item) => item.monthKey)).toEqual(['2026-05']);
    expect(merged[0].id).toBe('new-may');
  });
});
