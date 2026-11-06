/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../src/services/firebase', () => ({ db: {}, getCurrentUid: () => 'owner', ensureAuthPersistence: async () => {}, isE2EFirebaseEmulatorEnabled: () => false }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) }), runTransaction: mocks.transaction,
}));
import { acknowledgeGastappRevisionNotices, buildGastappMonthlyExpenseCloseSnapshot } from '../src/services/wealthStorage';
const monthKey = '2026-07';
const snapshot = (revision: number) => buildGastappMonthlyExpenseCloseSnapshot({
  monthKey, calendarMonthKey: monthKey, totalEur: revision * 100,
  byFamilyEur: { dayToDay: revision * 100, trips: 0, others: 0 },
  canonicalDataHash: `sha256:${'a'.repeat(64)}`, operationalDataHash: `sha256:${'a'.repeat(64)}`,
  operationalRevision: revision, sourceGeneration: revision, monthContractRevision: revision,
  monthContractHash: `sha256:${String(revision).repeat(64)}`, contractHash: `sha256:${String(revision).repeat(64)}`,
  certificationStatus: 'revised', certificationRevision: revision, certificationHash: `sha256:${'b'.repeat(64)}`,
  contractVersion: 'gastapp-aurum-calendar-months-v2', generatedAt: '2026-08-01T12:00:00Z',
}, { usdClp: 900, eurClp: 1000, ufClp: 40000 });
let root: any, sidecar: any, writes: number, version: number, conflict: (() => void) | undefined;
const notice = (revision: number) => ({ monthKey, contractHash: snapshot(revision).contractHash, certificationRevision: revision });
beforeEach(() => {
  writes = 0; version = 0; conflict = undefined; sidecar = null;
  root = { closures: [{ id: 'july', monthKey, gastappExpenseClose: snapshot(2) }], gastappRevisionNoticeSeenV1: { [monthKey]: snapshot(2).contractHash } };
  mocks.transaction.mockImplementation(async (_db, callback) => {
    for (;;) {
      const readVersion = version, values = { root: structuredClone(root), sidecar: structuredClone(sidecar) };
      let update: any;
      const result = await callback({
        get: async (ref: { path: string }) => {
          const value = ref.path.endsWith('historical_v1') ? values.sidecar : values.root;
          return { exists: () => value !== null, data: () => value };
        },
        set: (_ref: unknown, value: any) => { update = value; },
      });
      const hook = conflict; conflict = undefined; hook?.();
      if (version !== readVersion) continue;
      if (update) { root = { ...root, ...update }; writes++; version++; }
      return result;
    }
  });
});
it('does not let session A acknowledge R1 after session B has read R2', async () => {
  await Promise.all([acknowledgeGastappRevisionNotices([notice(1)]), acknowledgeGastappRevisionNotices([notice(2)])]);
  expect(root.gastappRevisionNoticeSeenV1[monthKey]).toBe(snapshot(2).contractHash);
  expect(writes).toBe(0);
});
it('revalidates revision identity when the accepted closure changes during the transaction', async () => {
  root.closures[0].gastappExpenseClose = snapshot(1); root.gastappRevisionNoticeSeenV1 = {};
  conflict = () => { root.closures[0].gastappExpenseClose = snapshot(2); root.gastappRevisionNoticeSeenV1[monthKey] = snapshot(2).contractHash; version++; };
  await acknowledgeGastappRevisionNotices([notice(1)]);
  expect(root.gastappRevisionNoticeSeenV1[monthKey]).toBe(snapshot(2).contractHash); expect(writes).toBe(0);
});
it('acknowledges the current sidecar revision exactly once without changing the closure', async () => {
  delete root.closures[0].gastappExpenseClose; root.gastappRevisionNoticeSeenV1 = {};
  sidecar = { schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: { [monthKey]: {
    closureId: 'july', snapshot: snapshot(2), repairAudit: { reason: 'historical_schema_compatibility_reconstruction',
      reconstructedAt: '2026-08-02', originalClosureAt: '2026-08-01', preFingerprint: 'same', postFingerprint: 'same', sourceContractHash: snapshot(2).contractHash },
  } } };
  const original = structuredClone(root.closures);
  await acknowledgeGastappRevisionNotices([notice(2)]); await acknowledgeGastappRevisionNotices([notice(2)]);
  expect(writes).toBe(1); expect(root.closures).toEqual(original);
});
it('checks certified revision numbers even when an obsolete message carries the same hash', async () => {
  root.gastappRevisionNoticeSeenV1 = {};
  await acknowledgeGastappRevisionNotices([{ ...notice(2), certificationRevision: 1 }]);
  expect(writes).toBe(0);
});
