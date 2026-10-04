import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

const actorHtml = resolve('.playwright/aurum-e2e/aud03-actor.html');
test.beforeAll(() => {
  mkdirSync(dirname(actorHtml), { recursive: true });
  writeFileSync(actorHtml, '<!doctype html><title>AUD-03 isolated actor</title>');
});
test.afterAll(() => rmSync(actorHtml, { force: true }));

const hash = (revision: number) => `sha256:${String(revision).repeat(64)}`;
const candidate = (revision: number) => ({
  monthKey: '2026-06', calendarMonthKey: '2026-06', totalEur: revision * 100,
  byFamilyEur: { dayToDay: revision * 100, trips: 0, others: 0 },
  canonicalDataHash: hash(revision), operationalDataHash: hash(revision), operationalRevision: revision,
  sourceGeneration: revision, monthContractRevision: revision, monthContractHash: hash(revision),
  certificationStatus: 'revised', certificationRevision: revision, certificationHash: hash(revision),
  contractHash: hash(revision), contractVersion: 'gastapp-aurum-calendar-months-v2',
  generatedAt: '2026-07-01T12:00:00.000Z',
});
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function wealthRef() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw new Error('AUD-03 requires the local Firestore Emulator.');
  }
  const name = 'aurum-aud03';
  const app = getApps().find((item) => item.name === name) || initializeApp({ projectId: 'aurum-e2e-local' }, name);
  return getFirestore(app).doc('aurum_wealth/aurum-e2e-user');
}
async function actor(page: Page) {
  // Load only service modules: no UI subscriptions or automatic sync can hide the race.
  await page.goto(`/@fs${actorHtml}`);
  await page.evaluate(async () => {
    const path = '/src/services/firebase.ts';
    await (await import(path)).ensureE2EEmulatorAuthentication();
  });
}
async function hydrate(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/services/wealthStorage.ts';
    await (await import(path)).hydrateWealthFromCloud();
  });
}
async function addRecord(page: Page, label: string) {
  await page.evaluate(async (label) => {
    const path = '/src/services/wealthStorage.ts'; const service = await import(path);
    service.saveWealthRecords([...service.loadWealthRecords(), {
      id: label, label, block: 'bank', source: 'Manual', amount: 12345, currency: 'CLP',
      snapshotDate: '2026-06-15', createdAt: new Date().toISOString(),
    }], { skipCloudSync: true, silent: true });
  }, label);
}
async function sync(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/wealthStorage.ts'; return (await import(path)).syncWealthNow();
  });
}

for (const revision of [2, 3]) {
  test(`AUD-03 real transaction retries R1 against confirmed R${revision}`, async ({ browser }, testInfo) => {
    const contextA = await browser.newContext(); const contextB = await browser.newContext();
    const a = await contextA.newPage(); const b = await contextB.newPage();
    const guards = [await installLocalNetworkGuard(a), await installLocalNetworkGuard(b)];
    const ref = wealthRef(); const original = (await ref.get()).data()!;
    const blocked = barrier(); const resume = barrier(); let commits = 0;
    try {
      await actor(a); await actor(b);
      const r1 = await a.evaluate(async (input) => {
        const path = '/src/services/wealthStorage.ts'; const service = await import(path);
        const fx = { usdClp: 934, eurClp: 1052, ufClp: 39560 };
        return service.buildGastappMonthlyExpenseCloseSnapshot(input, fx, '2026-07-01T12:00:00.000Z');
      }, candidate(1));
      const closures = original.closures.map((closure: { monthKey: string }) => closure.monthKey === '2026-06'
        ? { ...closure, gastappExpenseClose: r1, previousVersions: [] } : closure);
      await ref.update({ closures }); await hydrate(a); await hydrate(b);
      await addRecord(b, 'AUD03 B legitimate wealth');
      await b.route(/\/documents:commit/, async (route) => {
        commits += 1;
        if (commits === 1) {
          expect(route.request().postData()).toContain(hash(1));
          expect(route.request().postData()).toContain('AUD03 B legitimate wealth');
          blocked.release(); await resume.promise;
        }
        await route.continue();
      });
      const syncing = sync(b);
      await blocked.promise;
      for (let r = 2; r <= revision; r += 1) {
        await a.evaluate(async (input) => {
          const path = '/src/services/wealthStorage.ts';
          return (await import(path)).acceptGastappMonthlyClosureRevision(input);
        }, { monthKey: '2026-06', expectedPreviousContractHash: hash(r - 1),
          expectedCandidateContractHash: hash(r), snapshot: candidate(r) });
      }
      const accepted = (await ref.get()).data()!.closures.find((c: { monthKey: string }) => c.monthKey === '2026-06');
      expect(accepted.gastappExpenseClose.contractHash).toBe(hash(revision));
      resume.release(); expect(await syncing).toBe(true);
      expect(commits).toBeGreaterThan(1);
      const final = (await ref.get()).data()!;
      const closure = final.closures.find((c: { monthKey: string }) => c.monthKey === '2026-06');
      expect(closure.gastappExpenseClose.contractHash).toBe(hash(revision));
      for (let r = 1; r < revision; r += 1) expect(closure.previousVersions).toContainEqual(expect.objectContaining({
        gastappExpenseClose: expect.objectContaining({ contractHash: hash(r) }),
      }));
      expect(final.records).toContainEqual(expect.objectContaining({ id: 'AUD03 B legitimate wealth', amount: 12345 }));
      expect(await sync(b)).toBe(true);
      expect((await ref.get()).data()!.closures).toEqual(final.closures);
      for (const guard of guards) await guard.assertClean(testInfo);
    } finally {
      resume.release(); await contextA.close(); await contextB.close(); await ref.set(original);
    }
  });
}

test('AUD-03 two general sync actors retain both legitimate changes', async ({ browser }, testInfo) => {
  const contextA = await browser.newContext(); const contextB = await browser.newContext();
  const a = await contextA.newPage(); const b = await contextB.newPage();
  const guards = [await installLocalNetworkGuard(a), await installLocalNetworkGuard(b)];
  const ref = wealthRef(); const original = (await ref.get()).data()!;
  const read = barrier(); const resume = barrier(); let blocked = false;
  try {
    await actor(a); await actor(b); await hydrate(a); await hydrate(b);
    await addRecord(a, 'AUD03 actor A'); await addRecord(b, 'AUD03 actor B');
    await b.route(/\/documents:commit/, async (route) => {
      if (!blocked) { blocked = true; read.release(); await resume.promise; }
      await route.continue();
    });
    const syncing = sync(b); await read.promise;
    expect(await sync(a)).toBe(true); resume.release(); expect(await syncing).toBe(true);
    const final = (await ref.get()).data()!;
    for (const id of ['AUD03 actor A', 'AUD03 actor B']) expect(final.records).toContainEqual(expect.objectContaining({ id, amount: 12345 }));
    for (const guard of guards) await guard.assertClean(testInfo);
  } finally {
    resume.release(); await contextA.close(); await contextB.close(); await ref.set(original);
  }
});
