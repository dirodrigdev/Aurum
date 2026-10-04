/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), publish: vi.fn(), setDoc: vi.fn(), getDoc: vi.fn() }));
vi.mock('../src/services/firebase', () => ({
  db: {}, ensureAuthPersistence: async () => {}, getCurrentUid: () => 'synthetic-user',
  isE2EFirebaseEmulatorEnabled: () => false,
}));
vi.mock('../src/services/midasPublished', () => ({ publishAurumOptimizableInvestmentsSnapshot: mocks.publish }));
vi.mock('firebase/firestore', async (original) => ({
  ...await original<typeof import('firebase/firestore')>(),
  doc: () => ({ path: 'aurum_wealth/synthetic-user' }),
  runTransaction: mocks.transaction, setDoc: mocks.setDoc, getDoc: mocks.getDoc,
}));
import {
  buildGastappMonthlyExpenseCloseSnapshot, acceptGastappMonthlyClosureRevision, loadClosures, loadWealthRecords, saveClosures,
  saveWealthRecords, summarizeWealth, syncWealthNow, requestImmediateWealthSync,
  type GastappMonthlyExpenseCloseInput, type WealthMonthlyClosure, type WealthRecord,
} from '../src/services/wealthStorage';

const fx = { usdClp: 900, eurClp: 1000, ufClp: 39000 };
const snapshot = (revision: number): GastappMonthlyExpenseCloseInput => ({
  monthKey: '2026-07', calendarMonthKey: '2026-07', totalEur: revision * 100,
  byFamilyEur: { dayToDay: revision * 100, trips: 0, others: 0 },
  contractHash: `sha256:${String(revision).repeat(64)}`, canonicalDataHash: `sha256:${'a'.repeat(64)}`, operationalDataHash: `sha256:${'a'.repeat(64)}`,
  operationalRevision: revision, sourceGeneration: revision, monthContractRevision: revision,
  monthContractHash: `sha256:${String(revision).repeat(64)}`, certificationStatus: 'revised',
  certificationRevision: revision, certificationHash: `sha256:${'b'.repeat(64)}`, contractVersion: 'gastapp-aurum-calendar-months-v2',
  generatedAt: '2026-08-01T12:00:00.000Z',
});
const record = (id: string, amount: number): WealthRecord => ({
  id, amount, block: 'bank', source: 'Manual', label: id, currency: 'CLP',
  snapshotDate: '2026-07-15', createdAt: '2026-07-15T12:00:00.000Z',
});
const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

type Cloud = Record<string, any>;
let cloud: Cloud;
let version: number;
let attempts: number;
let pause: (() => Promise<void>) | undefined;
let beforeCommit: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); version = 0; attempts = 0; pause = undefined; beforeCommit = undefined;
  mocks.publish.mockResolvedValue({ ok: true, snapshot: null });
  const closure: WealthMonthlyClosure = {
    id: 'july', monthKey: '2026-07', closedAt: '2026-08-01T12:00:00.000Z',
    fxRates: fx, summary: summarizeWealth([], fx),
    gastappExpenseClose: buildGastappMonthlyExpenseCloseSnapshot(snapshot(1), fx, '2026-08-01T12:00:00.000Z'),
  };
  saveClosures([closure], { skipCloudSync: true, silent: true });
  saveWealthRecords([record('B', 123)], { skipCloudSync: true, silent: true });
  cloud = { closures: loadClosures(), records: [], fx, updatedAt: '2026-08-01T12:00:00.000Z' };
  // Model the former non-transactional path too: on baseline it must lose R2,
  // rather than fail because the old Firestore API was not mocked.
  mocks.getDoc.mockImplementation(async () => {
    const read = structuredClone(cloud); const hook = pause; pause = undefined;
    if (hook) await hook();
    return { exists: () => true, data: () => read };
  });
  mocks.setDoc.mockImplementation(async (_ref, data) => {
    cloud = { ...cloud, ...data }; version += 1;
  });
  mocks.transaction.mockImplementation(async (_db, callback) => {
    for (;;) {
      attempts += 1;
      const readVersion = version;
      const read = structuredClone(cloud);
      let write: Cloud | undefined;
      const result = await callback({
        get: async () => {
          const hook = pause; pause = undefined;
          if (hook) await hook();
          return { exists: () => true, data: () => read };
        },
        set: (_ref: unknown, data: Cloud) => { write = data; },
      });
      const commitHook = beforeCommit; beforeCommit = undefined;
      if (commitHook) await commitHook();
      if (readVersion !== version) continue;
      if (write) { cloud = { ...cloud, ...write }; version += 1; }
      return result;
    }
  });
});

async function accept(revision: number) {
  // Actor A has its own local cache. Restore B's storage after A confirms.
  const cache = { ...localStorage };
  saveClosures(cloud.closures, { skipCloudSync: true, silent: true });
  await acceptGastappMonthlyClosureRevision({
    monthKey: '2026-07', expectedPreviousContractHash: snapshot(revision - 1).contractHash,
    expectedCandidateContractHash: snapshot(revision).contractHash, snapshot: snapshot(revision),
  });
  localStorage.clear();
  for (const [key, value] of Object.entries(cache)) localStorage.setItem(key, value);
}

describe('AUD-03 general sync transaction', () => {
  it.each([2, 3])('retries a stale R1 read and preserves R%s plus archives and B wealth', async (revision) => {
    const read = barrier(); const resume = barrier();
    pause = async () => { read.release(); await resume.promise; };
    const sync = syncWealthNow(); await read.promise;
    for (let r = 2; r <= revision; r += 1) await accept(r);
    expect(cloud.closures[0].gastappExpenseClose.contractHash).toBe(snapshot(revision).contractHash);
    expect(mocks.publish).not.toHaveBeenCalled();
    resume.release(); expect(await sync).toBe(true);
    expect(cloud.closures[0].gastappExpenseClose.contractHash).toBe(snapshot(revision).contractHash);
    for (let r = 1; r < revision; r += 1) {
      expect(cloud.closures[0].previousVersions).toContainEqual(expect.objectContaining({
        gastappExpenseClose: expect.objectContaining({ contractHash: snapshot(r).contractHash }),
      }));
    }
    expect(cloud.records).toContainEqual(expect.objectContaining({ id: 'B', amount: 123 }));
    expect(attempts).toBe(revision + 1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0][0]).toEqual(cloud.closures);
    expect(mocks.setDoc).not.toHaveBeenCalled(); expect(mocks.getDoc).not.toHaveBeenCalled();
    const previous = structuredClone(cloud);
    expect(await syncWealthNow()).toBe(true);
    expect(cloud.closures).toEqual(previous.closures); expect(cloud.records).toEqual(previous.records);
  });

  it('preserves a local edit during the read and schedules a fresh sync', async () => {
    const read = barrier(); const resume = barrier();
    pause = async () => { read.release(); await resume.promise; };
    const sync = syncWealthNow(); await read.promise;
    saveWealthRecords([record('B', 456)], { skipCloudSync: true, silent: true });
    resume.release(); expect(await sync).toBe(true);
    expect(loadWealthRecords()[0].amount).toBe(456);
    expect(cloud.records[0].amount).toBe(456); expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('preserves local edits arriving after the read while confirmation is in flight', async () => {
    const pending = barrier(); const resume = barrier();
    beforeCommit = async () => { pending.release(); await resume.promise; };
    const sync = syncWealthNow(); await pending.promise;
    saveWealthRecords([record('B', 999)], { skipCloudSync: true, silent: true });
    resume.release(); expect(await sync).toBe(true);
    expect(loadWealthRecords()[0].amount).toBe(999); expect(cloud.records[0].amount).toBe(999);
  });

  it('preserves local edits made during the MIDAS publication', async () => {
    mocks.publish.mockImplementationOnce(async () => {
      saveWealthRecords([record('B', 789)], { skipCloudSync: true, silent: true });
      return { ok: true, snapshot: null };
    });
    expect(await syncWealthNow()).toBe(true);
    expect(loadWealthRecords()[0].amount).toBe(789); expect(cloud.records[0].amount).toBe(789);
  });

  it('coalesces simultaneous calls and converges without losing changes', async () => {
    const read = barrier(); const resume = barrier();
    pause = async () => { read.release(); await resume.promise; };
    const first = syncWealthNow(); await read.promise;
    requestImmediateWealthSync(); resume.release();
    expect(await first).toBe(true);
    expect(cloud.records[0].amount).toBe(123); expect(cloud.closures[0].gastappExpenseClose.contractHash).toBe(snapshot(1).contractHash);
  });

  it('does not publish when the transaction fails to confirm', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('synthetic transaction failure'));
    // syncWealthNow retries failures, so fail every outer attempt as well.
    mocks.transaction.mockRejectedValue(new Error('synthetic transaction failure'));
    expect(await syncWealthNow()).toBe(false); expect(mocks.publish).not.toHaveBeenCalled();
  });
});
