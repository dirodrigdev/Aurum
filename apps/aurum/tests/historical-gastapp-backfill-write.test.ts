import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {
    auditResults: [] as unknown[],
    auditRoots: [] as unknown[],
    sidecarReads: [] as unknown[],
    transactionRoot: null as unknown,
    transactionSidecar: null as unknown,
    rootReadback: null as unknown,
    backup: null as unknown,
    writtenSidecar: null as unknown,
  },
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  runTransaction: vi.fn(),
  runAudit: vi.fn(),
  readRoot: vi.fn(),
  readSidecar: vi.fn(),
  getCurrentUid: vi.fn(),
  auth: { currentUser: { uid: 'test-user', email: 'diegorp.1978@gmail.com' } },
}));

vi.stubGlobal('crypto', webcrypto);
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mocks.doc(...args),
  getDocFromServer: (...args: unknown[]) => mocks.getDocFromServer(...args),
  runTransaction: (...args: unknown[]) => mocks.runTransaction(...args),
  setDoc: (...args: unknown[]) => mocks.setDoc(...args),
}));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: mocks.auth, getCurrentUid: mocks.getCurrentUid }));
vi.mock('../src/services/wealthStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/wealthStorage')>();
  return { ...actual, readWealthCloudDocumentForAudit: mocks.readRoot };
});
vi.mock('../src/services/historicalGastappSidecar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/historicalGastappSidecar')>();
  return {
    ...actual,
    historicalGastappSidecarRef: (uid: string) => ({ path: `aurum_wealth/${uid}/gastapp_snapshots/historical_v1` }),
    readHistoricalGastappSidecarFromServer: mocks.readSidecar,
  };
});
vi.mock('../src/services/historicalGastappSnapshotBackfill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/historicalGastappSnapshotBackfill')>();
  return { ...actual, runHistoricalGastappBackfillAudit: mocks.runAudit };
});

import {
  buildGastappMonthlyExpenseCloseSnapshot,
  type GastappMonthlyExpenseCloseInput,
  type WealthMonthlyClosure,
} from '../src/services/wealthStorage';
import {
  fingerprintHistoricalClosureSource,
  type HistoricalGastappBackfillPreview,
} from '../src/services/historicalGastappSnapshotBackfill';
import {
  executeHistoricalGastappSidecarBackfill,
  type HistoricalGastappBackfillWriteResult,
} from '../src/services/historicalGastappBackfillWrite';
import type { HistoricalGastappSidecarDocument } from '../src/services/historicalGastappSidecar';

const sha = 'sha256:' + 'a'.repeat(64);
const fxRates = { usdClp: 900, eurClp: 1_000, ufClp: 38_000 };

const makeClosure = (monthKey = '2024-07'): WealthMonthlyClosure => ({
  id: `closure-${monthKey}`,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59.000Z`,
  summary: { netClp: 123_456 },
  records: [{ id: `record-${monthKey}`, amount: 123_456 } as WealthMonthlyClosure['records'][number]],
  fxRates,
  fxMetadata: { economicMonthKey: monthKey, usedFxRates: fxRates },
  fxMissing: [],
  previousVersions: [],
});

const makeSnapshot = (monthKey = '2024-07') => buildGastappMonthlyExpenseCloseSnapshot({
  monthKey,
  calendarMonthKey: monthKey,
  totalEur: 50,
  byFamilyEur: { dayToDay: 20, trips: 15, others: 15 },
  canonicalDataHash: sha,
  operationalDataHash: sha,
  operationalRevision: 3,
  sourceGeneration: 3,
  monthContractRevision: 2,
  monthContractHash: sha,
  certificationStatus: 'certified',
  certificationRevision: 2,
  certificationHash: sha,
  contractHash: sha,
  contractVersion: 'gastapp-aurum-calendar-months-v2',
  generatedAt: '2026-10-05T10:00:00.000Z',
} satisfies GastappMonthlyExpenseCloseInput, fxRates, '2026-10-05T11:00:00.000Z');

const makeCoverage = (valid: number, expected: number) => ({ valid, expected });
const makePreview = async (
  rawClosures: WealthMonthlyClosure[],
  options: {
    eligible?: boolean;
    totalClosures?: number;
    comparableMonths?: number;
    lastOfficialMonth?: string;
    projected?: { sinceStart: { valid: number; expected: number }; last12m: { valid: number; expected: number }; ytd: { valid: number; expected: number } };
    manifestTag?: string;
  } = {},
): Promise<HistoricalGastappBackfillPreview> => {
  const eligible = options.eligible ?? true;
  const closure = rawClosures.find((row) => row.monthKey === '2024-07') || rawClosures[0];
  const projected = options.projected || {
    sinceStart: makeCoverage(2, 2),
    last12m: makeCoverage(1, 1),
    ytd: makeCoverage(1, 1),
  };
  const row = eligible
    ? {
        monthKey: closure.monthKey,
        closureId: closure.id,
        status: 'eligible_for_backfill',
        blockers: [],
        snapshotPresent: false,
        candidateStatus: 'complete',
        certificationStatus: 'certified',
        totalEur: 50,
        byFamilyEur: { dayToDay: 20, trips: 15, others: 15 },
        canonicalDataHash: sha,
        operationalDataHash: sha,
        operationalRevision: 3,
        sourceGeneration: 3,
        monthContractRevision: 2,
        monthContractHash: sha,
        certificationHash: sha,
        certificationRevision: 2,
        contractVersion: 'gastapp-aurum-calendar-months-v2',
        generatedAt: options.manifestTag || '2026-10-05T10:00:00.000Z',
        fxRates,
        proposedSnapshot: makeSnapshot(closure.monthKey),
        preFingerprint: sha,
        postFingerprint: sha,
        fingerprintsMatch: true,
      }
    : {
        monthKey: closure.monthKey,
        closureId: closure.id,
        status: 'snapshot_present',
        blockers: [],
        snapshotPresent: true,
        candidateStatus: 'complete',
        certificationStatus: 'certified',
        totalEur: 50,
        byFamilyEur: { dayToDay: 20, trips: 15, others: 15 },
        canonicalDataHash: sha,
        operationalDataHash: sha,
        operationalRevision: 3,
        sourceGeneration: 3,
        monthContractRevision: 2,
        monthContractHash: sha,
        certificationHash: sha,
        certificationRevision: 2,
        contractVersion: 'gastapp-aurum-calendar-months-v2',
        generatedAt: options.manifestTag || '2026-10-05T10:00:00.000Z',
        fxRates,
      };
  return {
    schemaVersion: 'aurum-gastapp-historical-snapshot-preview-v1',
    reconstructionAt: '2026-10-05T11:00:00.000Z',
    closureSourceFingerprint: await fingerprintHistoricalClosureSource(rawClosures),
    totalClosures: options.totalClosures ?? rawClosures.length,
    baseMonth: rawClosures[0]?.monthKey || null,
    lastOfficialMonth: options.lastOfficialMonth ?? rawClosures.at(-1)?.monthKey ?? null,
    comparableMonths: options.comparableMonths ?? Math.max(rawClosures.length - 1, 0),
    snapshotsPresent: eligible ? 0 : 1,
    snapshotsToComplete: eligible ? 1 : 0,
    blockers: 0,
    blockersByStatus: {},
    coverage: {
      current: {
        sinceStart: makeCoverage(eligible ? 1 : projected.sinceStart.valid, projected.sinceStart.expected),
        last12m: makeCoverage(eligible ? 0 : projected.last12m.valid, projected.last12m.expected),
        ytd: makeCoverage(eligible ? 0 : projected.ytd.valid, projected.ytd.expected),
      },
      projected,
    },
    documentSize: { available: true, currentApproxBytes: 100, projectedApproxBytes: 100, incrementApproxBytes: 0, maxBytes: 1_048_576, reserveBytes: 131_072, status: 'within_limit' },
    sidecarSize: { currentApproxBytes: 0, projectedApproxBytes: 500, maxBytes: 1_048_576, reserveBytes: 131_072, status: 'within_limit' },
    manifest: [row],
    simulatedClosures: structuredClone(rawClosures),
    allowedPersistentFields: ['gastappExpenseClose', 'repairAudit'],
    writesPerformed: false,
  } as unknown as HistoricalGastappBackfillPreview;
};

const rootDocument = (closures: unknown[], extra: Record<string, unknown> = {}) => ({
  ownerUid: 'test-user',
  closures,
  updatedAt: '2026-10-05T11:00:00.000Z',
  currentWealth: 123456,
  ...extra,
});
const snap = (data: unknown) => ({ exists: () => data !== null, data: () => data });

const configure = async (options: {
  closures?: WealthMonthlyClosure[];
  initialRootExtra?: Record<string, unknown>;
  secondRootExtra?: Record<string, unknown>;
  transactionClosures?: unknown[];
  transactionRootExtra?: Record<string, unknown>;
  transactionSidecar?: unknown;
  secondManifestTag?: string;
  finalCoverage?: HistoricalGastappBackfillPreview['coverage']['projected'];
} = {}) => {
  const closures = options.closures || [makeClosure('2024-06'), makeClosure('2024-07'), makeClosure('2024-08')];
  const firstPreview = await makePreview(closures, { totalClosures: closures.length, comparableMonths: closures.length - 1, lastOfficialMonth: closures.at(-1)?.monthKey });
  const secondPreview = await makePreview(closures, {
    totalClosures: closures.length,
    comparableMonths: closures.length - 1,
    lastOfficialMonth: closures.at(-1)?.monthKey,
    manifestTag: options.secondManifestTag,
  });
  const finalPreview = await makePreview(closures, {
    eligible: false,
    totalClosures: closures.length,
    comparableMonths: closures.length - 1,
    lastOfficialMonth: closures.at(-1)?.monthKey,
    projected: options.finalCoverage || firstPreview.coverage.projected,
  });
  const rootOne = rootDocument(closures, options.initialRootExtra);
  const rootTwo = rootDocument(closures, options.secondRootExtra);
  const rootTx = rootDocument(options.transactionClosures || closures, options.transactionRootExtra);
  const rootReadback = rootDocument(closures, { updatedAt: 'changed-during-readback' });
  const rootFinal = rootDocument(closures, { updatedAt: 'changed-after-readback' });
  mocks.state.auditResults = [
    { preview: firstPreview },
    { preview: secondPreview },
    { preview: finalPreview },
  ];
  mocks.state.auditRoots = [rootOne, rootTwo, rootFinal];
  mocks.state.sidecarReads = [null, null, null];
  mocks.state.transactionRoot = rootTx;
  mocks.state.transactionSidecar = options.transactionSidecar ?? null;
  mocks.state.rootReadback = rootReadback;
  mocks.state.backup = null;
  mocks.state.writtenSidecar = null;
  mocks.runAudit.mockImplementation(async () => mocks.state.auditResults.shift());
  mocks.readRoot.mockImplementation(async () => ({ document: mocks.state.auditRoots.shift() }));
  mocks.readSidecar.mockImplementation(async () => {
    const data = mocks.state.sidecarReads.shift();
    return { uid: 'test-user', exists: data !== null, document: data, raw: data };
  });
  mocks.getCurrentUid.mockReturnValue('test-user');
  mocks.doc.mockImplementation((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }));
  mocks.setDoc.mockImplementation(async (_ref: { path: string }, value: unknown) => { mocks.state.backup = value; });
  mocks.getDocFromServer.mockImplementation(async (ref: { path: string }) => {
    if (ref.path.includes('gastapp_snapshots_backups')) return snap(mocks.state.backup);
    if (ref.path === 'aurum_wealth/test-user') return snap(mocks.state.rootReadback);
    if (ref.path.includes('gastapp_snapshots/')) return snap(mocks.state.writtenSidecar);
    return snap(null);
  });
  mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
    const transaction = {
      get: async (ref: { path: string }) => snap(ref.path === 'aurum_wealth/test-user'
        ? mocks.state.transactionRoot
        : mocks.state.transactionSidecar),
      set: (ref: { path: string }, value: unknown) => {
        mocks.state.writtenSidecar = value;
        mocks.state.sidecarReads = [value];
      },
    };
    return callback(transaction);
  });
  return { closures, firstPreview };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.auditResults = [];
  mocks.state.auditRoots = [];
  mocks.state.sidecarReads = [];
  mocks.state.transactionRoot = null;
  mocks.state.transactionSidecar = null;
  mocks.state.rootReadback = null;
  mocks.state.backup = null;
  mocks.state.writtenSidecar = null;
});

describe('historical GastApp sidecar write guards', () => {
  it('fingerprints the full closure objects deterministically, independent of array order', async () => {
    const closures = [makeClosure('2024-06'), makeClosure('2024-07')];
    const ordered = await fingerprintHistoricalClosureSource(closures);
    const reversed = await fingerprintHistoricalClosureSource([...closures].reverse());
    const changed = await fingerprintHistoricalClosureSource([
      closures[0],
      { ...closures[1], futurePersistedField: { revision: 2 } },
    ]);
    expect(reversed).toBe(ordered);
    expect(changed).not.toBe(ordered);
  });

  it.each([
    ['root.updatedAt', { initialRootExtra: { updatedAt: 'before' }, secondRootExtra: { updatedAt: 'after' }, transactionRootExtra: { updatedAt: 'during' } }],
    ['unrelated root state', { initialRootExtra: { currentWealth: 10 }, secondRootExtra: { currentWealth: 20 }, transactionRootExtra: { currentWealth: 30 } }],
  ])('continues when only %s changes and reports dynamic preview totals', async (_label, rootChanges) => {
    const { closures, firstPreview } = await configure(rootChanges);
    const result: HistoricalGastappBackfillWriteResult = await executeHistoricalGastappSidecarBackfill();
    expect(result.created).toBe(1);
    expect(result.coverage).toEqual(firstPreview.coverage.projected);
    expect(firstPreview.totalClosures).toBe(3);
    expect(firstPreview.comparableMonths).toBe(2);
    expect(firstPreview.lastOfficialMonth).toBe('2024-08');
    expect(mocks.state.writtenSidecar).not.toBeNull();
    expect(closures).toHaveLength(3);
  });

  it.each([
    ['any persisted closure property', (closures: unknown[]) => ({ ...closures[1] as object, futureField: 'changed' })],
    ['a concurrent embedded gastappExpenseClose', (closures: unknown[]) => ({ ...closures[1] as object, gastappExpenseClose: makeSnapshot() })],
  ])('aborts with zero writes when %s changes before transaction', async (_label, mutate) => {
    const { closures } = await configure();
    mocks.state.transactionRoot = rootDocument([closures[0], mutate(structuredClone(closures)), closures[2]]);
    await expect(executeHistoricalGastappSidecarBackfill()).rejects.toThrow('Cambio concurrente detectado');
    expect(mocks.state.writtenSidecar).toBeNull();
  });

  it('aborts with zero writes when the sidecar appears or changes concurrently', async () => {
    const { closures } = await configure();
    mocks.state.transactionSidecar = { schemaVersion: 'concurrent-sidecar' };
    await expect(executeHistoricalGastappSidecarBackfill()).rejects.toThrow('Cambio concurrente detectado');
    expect(mocks.state.writtenSidecar).toBeNull();
    expect(closures).toHaveLength(3);
  });

  it('aborts before the transaction when GastApp changes the manifest', async () => {
    await configure({ secondManifestTag: 'changed-manifest-source' });
    await expect(executeHistoricalGastappSidecarBackfill()).rejects.toThrow('El manifest cambió');
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.state.writtenSidecar).toBeNull();
  });

  it('uses the first preview projection and returns the eligible count for datasets unlike the production photo', async () => {
    const closures = [makeClosure('2024-06'), makeClosure('2024-07'), makeClosure('2024-08')];
    const projected = {
      sinceStart: makeCoverage(2, 2),
      last12m: makeCoverage(1, 1),
      ytd: makeCoverage(1, 1),
    };
    const { firstPreview } = await configure({ closures, finalCoverage: projected });
    const result = await executeHistoricalGastappSidecarBackfill();
    expect(result.created).toBe(firstPreview.manifest.filter((row) => row.status === 'eligible_for_backfill').length);
    expect(result.created).toBe(1);
    expect(result.coverage).toEqual(projected);
  });

  it('makes the follow-up execution a zero-change idempotent no-op without a backup', async () => {
    const { closures } = await configure();
    await executeHistoricalGastappSidecarBackfill();
    const existing = mocks.state.writtenSidecar as HistoricalGastappSidecarDocument;
    mocks.setDoc.mockClear();
    mocks.runTransaction.mockClear();
    const noOpPreview = await makePreview(closures, {
      eligible: false,
      totalClosures: 3,
      comparableMonths: 2,
      lastOfficialMonth: '2024-08',
    });
    mocks.state.auditResults = [{ preview: noOpPreview }];
    mocks.state.auditRoots = [rootDocument(closures)];
    mocks.state.sidecarReads = [existing];
    mocks.runAudit.mockClear();
    mocks.readSidecar.mockImplementation(async () => ({ uid: 'test-user', exists: true, document: existing, raw: existing }));
    const beforeRoot = structuredClone(mocks.state.auditRoots[0]);
    const beforeSidecar = structuredClone(existing);
    const result = await executeHistoricalGastappSidecarBackfill();
    expect(result.created).toBe(0);
    expect(result.backupId).toBeNull();
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.state.auditRoots).toEqual([]);
    expect(beforeRoot.closures).toEqual(closures);
    expect(beforeSidecar).toEqual(existing);
  });
});
