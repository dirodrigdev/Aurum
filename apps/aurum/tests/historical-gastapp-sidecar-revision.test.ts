import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUid: { value: 'owner-1' as string | null },
  runTransaction: vi.fn(),
  root: null as any,
  sidecar: null as any,
  writes: [] as Array<{ path: string; value: unknown }>,
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => parts.join('/')),
  getDocFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: mocks.runTransaction,
}));
vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: () => mocks.currentUid.value,
}));
vi.mock('../src/services/wealthStorage', () => ({
  buildGastappMonthlyExpenseCloseSnapshot: (input: any, fxRates: any, capturedAt: string) => ({
    ...input,
    schemaVersion: 'aurum-gastapp-monthly-close-v2',
    sourcePath: 'gastapp_aurum_contracts_v2/months_current',
    calendarMonthKey: input.monthKey,
    capturedAt,
    fxRates,
    amountsByCurrency: { EUR: { total: input.totalEur } },
  }),
  normalizeGastappMonthlyExpenseCloseSnapshot: (raw: any, monthKey: string) =>
    raw?.monthKey === monthKey ? raw : undefined,
  WEALTH_DATA_UPDATED_EVENT: 'aurum:wealth-data-updated',
}));

import {
  applyCertifiedHistoricalGastappSidecarRevisions,
  parseHistoricalGastappSidecar,
  setHistoricalGastappSidecarForAnalysis,
} from '../src/services/historicalGastappSidecar';

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const snapshot = (monthKey: string, letter: string, totalEur: number, revision: number) => ({
  monthKey,
  calendarMonthKey: monthKey,
  totalEur,
  byFamilyEur: { dayToDay: totalEur, trips: 0, others: 0 },
  canonicalDataHash: hash('1'),
  operationalDataHash: hash('2'),
  operationalRevision: revision,
  sourceGeneration: revision,
  monthContractRevision: revision,
  monthContractHash: hash(letter),
  certificationStatus: 'revised' as const,
  certificationRevision: revision,
  certificationHash: hash('3'),
  contractHash: hash(letter),
  contractVersion: 'gastapp-aurum-calendar-months-v2',
  generatedAt: '2026-10-01T12:00:00.000Z',
  schemaVersion: 'aurum-gastapp-monthly-close-v2',
  sourcePath: 'gastapp_aurum_contracts_v2/months_current',
  capturedAt: '2026-10-01T12:00:00.000Z',
  fxRates: { usdClp: 900, eurClp: 1000, ufClp: 40000 },
  amountsByCurrency: { EUR: { total: totalEur } },
});
const repairAudit = (contractHash: string) => ({
  reason: 'historical_schema_compatibility_reconstruction' as const,
  reconstructedAt: '2026-10-01T00:00:00.000Z',
  originalClosureAt: '2026-04-30T00:00:00.000Z',
  preFingerprint: hash('4'),
  postFingerprint: hash('4'),
  sourceContractHash: contractHash,
});
const sidecarEntry = (monthKey: string, closureId: string, letter: string, totalEur: number, revision: number) => ({
  closureId,
  snapshot: snapshot(monthKey, letter, totalEur, revision),
  repairAudit: repairAudit(hash(letter)),
});
const sidecarDocument = () => ({
  schemaVersion: 'aurum-gastapp-historical-sidecar-v1' as const,
  snapshotsByMonth: { '2026-04': sidecarEntry('2026-04', 'closure-apr', 'a', 5830.86, 1) },
});
const candidate = (monthKey = '2026-04', letter = 'b', totalEur = 11378.28, revision = 2) => ({
  ...snapshot(monthKey, letter, totalEur, revision),
  schemaVersion: undefined,
  sourcePath: undefined,
  capturedAt: undefined,
  fxRates: undefined,
  amountsByCurrency: undefined,
});
const snap = (value: unknown) => ({ exists: () => value !== null, data: () => value });

describe('certified GastApp revision for historical sidecar', () => {
  beforeEach(() => {
    mocks.currentUid.value = 'owner-1';
    mocks.root = { closures: [{ id: 'closure-apr', monthKey: '2026-04', gastappExpenseClose: null }] };
    mocks.sidecar = sidecarDocument();
    mocks.writes = [];
    mocks.runTransaction.mockReset();
    mocks.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: async (ref: string) => ref === 'aurum_wealth/owner-1' ? snap(mocks.root) : snap(mocks.sidecar),
      set: (ref: string, value: unknown) => {
        mocks.writes.push({ path: ref, value });
        if (ref === 'aurum_wealth/owner-1/gastapp_snapshots/historical_v1') mocks.sidecar = value;
      },
    }));
    setHistoricalGastappSidecarForAnalysis(null, null);
  });

  it('continues reading sidecars written before revision history existed', () => {
    expect(parseHistoricalGastappSidecar(sidecarDocument())).toMatchObject({
      snapshotsByMonth: { '2026-04': { snapshot: { contractHash: hash('a') } } },
    });
  });

  it('archives the predecessor and updates only the sidecar snapshot while leaving closure finances intact', async () => {
    const result = await applyCertifiedHistoricalGastappSidecarRevisions([{
      monthKey: '2026-04', closureId: 'closure-apr',
      expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b'), snapshot: candidate(),
    }]);

    expect(result).toMatchObject({ changed: ['2026-04'], unchanged: [], failed: [] });
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0].path).toBe('aurum_wealth/owner-1/gastapp_snapshots/historical_v1');
    expect(mocks.root.closures[0]).toEqual({ id: 'closure-apr', monthKey: '2026-04', gastappExpenseClose: null });
    const saved = mocks.sidecar.snapshotsByMonth['2026-04'];
    expect(saved.snapshot).toMatchObject({ contractHash: hash('b'), monthContractHash: hash('b'), totalEur: 11378.28 });
    expect(saved.previousVersions).toEqual([{
      snapshot: expect.objectContaining({ contractHash: hash('a'), totalEur: 5830.86 }),
      repairAudit: expect.objectContaining({ sourceContractHash: hash('a') }),
      replacedAt: expect.any(String),
    }]);
    expect(saved.repairAudit).toMatchObject({ sourceContractHash: hash('b'), preFingerprint: hash('4'), postFingerprint: hash('4') });
    expect(parseHistoricalGastappSidecar(structuredClone(mocks.sidecar))).toEqual(mocks.sidecar);
  });

  it('does not write or create another history item when the contract hash is already current', async () => {
    const current = sidecarDocument();
    current.snapshotsByMonth['2026-04'] = {
      ...current.snapshotsByMonth['2026-04'],
      snapshot: snapshot('2026-04', 'b', 11378.28, 2),
      repairAudit: repairAudit(hash('b')),
    };
    mocks.sidecar = current;
    const result = await applyCertifiedHistoricalGastappSidecarRevisions([{
      monthKey: '2026-04', closureId: 'closure-apr',
      expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b'), snapshot: candidate(),
    }]);
    expect(result).toMatchObject({ changed: [], unchanged: ['2026-04'], failed: [] });
    expect(mocks.writes).toEqual([]);
  });

  it('archives every successive certified correction in order for the same month', async () => {
    const first = await applyCertifiedHistoricalGastappSidecarRevisions([{
      monthKey: '2026-04', closureId: 'closure-apr',
      expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b'), snapshot: candidate(),
    }]);
    const second = await applyCertifiedHistoricalGastappSidecarRevisions([{
      monthKey: '2026-04', closureId: 'closure-apr',
      expectedPreviousContractHash: hash('b'), expectedCandidateContractHash: hash('c'),
      snapshot: candidate('2026-04', 'c', 12500, 3),
    }]);

    expect(first.changed).toEqual(['2026-04']);
    expect(second.changed).toEqual(['2026-04']);
    expect(mocks.sidecar.snapshotsByMonth['2026-04'].snapshot).toMatchObject({ contractHash: hash('c'), totalEur: 12500 });
    expect(mocks.sidecar.snapshotsByMonth['2026-04'].previousVersions.map((version: any) => [
      version.snapshot.contractHash, version.snapshot.totalEur,
    ])).toEqual([[hash('b'), 11378.28], [hash('a'), 5830.86]]);
  });

  it('blocks a concurrent hash change without overwriting the latest sidecar', async () => {
    mocks.sidecar.snapshotsByMonth['2026-04'] = sidecarEntry('2026-04', 'closure-apr', 'c', 12000, 3);
    const before = structuredClone(mocks.sidecar);
    const result = await applyCertifiedHistoricalGastappSidecarRevisions([{
      monthKey: '2026-04', closureId: 'closure-apr',
      expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b'), snapshot: candidate(),
    }]);
    expect(result.changed).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ monthKey: '2026-04' })]);
    expect(mocks.writes).toEqual([]);
    expect(mocks.sidecar).toEqual(before);
  });

  it('refuses to change a sidecar if a main closure snapshot became authoritative', async () => {
    mocks.root.closures[0].gastappExpenseClose = snapshot('2026-04', 'c', 12000, 3);
    const result = await applyCertifiedHistoricalGastappSidecarRevisions([{
      monthKey: '2026-04', closureId: 'closure-apr',
      expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b'), snapshot: candidate(),
    }]);
    expect(result.changed).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ monthKey: '2026-04' })]);
    expect(mocks.writes).toEqual([]);
  });
});
