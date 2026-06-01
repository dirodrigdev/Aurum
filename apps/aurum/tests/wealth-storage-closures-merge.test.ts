import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: async () => {},
  getCurrentUid: () => null,
}));
import {
  mergeClosuresForSync,
  protectRemoteClosuresFromEmptyOverwrite,
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

describe('wealth storage closures merge', () => {
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
});
