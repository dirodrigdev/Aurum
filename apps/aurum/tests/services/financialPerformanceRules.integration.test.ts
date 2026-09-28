import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

// Runs only under the repository's local Auth and Firestore emulator harness.
const describeRules = process.env.RUN_CLOUD_TESTS === '1' ? describe : describe.skip;

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let ownerUid = '';

const periodRef = (userId: string, monthKey: string) =>
  doc(db, 'aurum_financial_performance', userId, 'months', monthKey);

const writePeriod = async (
  monthKey: string,
  period: { startMonth: string; endMonth: string },
  options: { userId?: string; schemaVersion?: number } = {},
) => {
  const userId = options.userId || ownerUid;
  const head = periodRef(userId, monthKey);
  const revision = doc(head, 'revisions', '1');
  const batch = writeBatch(db);
  batch.set(revision, {
    schemaVersion: options.schemaVersion ?? 1,
    monthKey,
    ...period,
    revision: 1,
    revisionId: '1',
    flowCompleteness: 'complete',
    positionMovementCompleteness: 'unconfirmed',
    flows: [],
    createdAt: serverTimestamp(),
    createdByUid: userId,
  });
  batch.set(head, {
    schemaVersion: 1,
    monthKey,
    ...period,
    currentRevision: 1,
    currentRevisionId: '1',
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return { head, revision };
};

const expectPermissionDenied = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toMatchObject({ code: 'permission-denied' });
};

describeRules('financial performance Firestore rules', () => {
  beforeAll(async () => {
    app = initializeApp({
      apiKey: 'aurum-e2e-local-api-key',
      authDomain: 'aurum-e2e.local',
      projectId: 'aurum-e2e-local',
      appId: '1:123456789012:web:aurume2elocal',
    }, 'financial-performance-rules-tests');
    auth = getAuth(app);
    db = getFirestore(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  });

  beforeEach(async () => {
    await signOut(auth);
    ownerUid = (await signInAnonymously(auth)).user.uid;
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it('allows July→August, another monthly interval, and valid future month keys', async () => {
    const cases = [
      { startMonth: '2026-07', endMonth: '2026-08' },
      { startMonth: '2026-06', endMonth: '2026-07' },
      { startMonth: '2034-12', endMonth: '2035-01' },
    ];
    for (const period of cases) {
      const { head } = await writePeriod(period.endMonth, period);
      expect((await getDoc(head)).exists()).toBe(true);
    }
  }, 20_000);

  it.each([
    {
      name: 'malformed month key',
      monthKey: '2026-13',
      period: { startMonth: '2026-12', endMonth: '2026-13' },
    },
    {
      name: 'non-consecutive start and end months',
      monthKey: '2026-08',
      period: { startMonth: '2026-06', endMonth: '2026-08' },
    },
    {
      name: 'end month different from the route key',
      monthKey: '2026-07',
      period: { startMonth: '2026-07', endMonth: '2026-08' },
    },
    {
      name: 'invalid document schema',
      monthKey: '2026-07',
      period: { startMonth: '2026-06', endMonth: '2026-07' },
      schemaVersion: 2,
    },
  ])('rejects $name', async ({ monthKey, period, schemaVersion }) => {
    await expectPermissionDenied(writePeriod(monthKey, period, { schemaVersion }));
  }, 15_000);

  it('isolates reads and writes to the authenticated user', async () => {
    const otherUser = 'another-user';
    await expectPermissionDenied(writePeriod('2026-07', {
      startMonth: '2026-06',
      endMonth: '2026-07',
    }, { userId: otherUser }));
    await expectPermissionDenied(getDoc(periodRef(otherUser, '2026-07')));
  }, 15_000);

  it('keeps revisions immutable and prevents deleting revisions or period pointers', async () => {
    const { head, revision } = await writePeriod('2026-08', {
      startMonth: '2026-07',
      endMonth: '2026-08',
    });
    await expectPermissionDenied(updateDoc(revision, { flows: [{ id: 'changed' }] }));
    await expectPermissionDenied(deleteDoc(revision));
    await expectPermissionDenied(deleteDoc(head));
  }, 15_000);
});
