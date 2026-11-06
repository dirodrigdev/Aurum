import { test, expect } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';
const app = getApps().find(app => app.name === 'notice-regressions') || initializeApp({ projectId: 'aurum-e2e-local' }, 'notice-regressions');
const root = getFirestore(app).doc('aurum_wealth/aurum-e2e-user');
let original: any;
test.beforeEach(async () => { original = (await root.get()).data(); });
test.afterEach(async ({ context }) => { await context.close(); if (original) await root.set(original); });

test('global notice read failure is explicit, persistent and recovers without reloading', async ({ page }, testInfo) => {
  const guard = await installLocalNetworkGuard(page);
  await page.addInitScript(() => {
    (window as any).__failNoticeReads = true;
    const today = new Date();
    window.localStorage.setItem('aurum.incomplete-closure.prompt.day.v1', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  });
  await page.route('**/src/services/wealthStorage.ts*', async route => {
    const response = await route.fetch(); const body = await response.text();
    const marker = 'export const readGastappRevisionSeenHashes = async () => {';
    expect(body).toContain(marker);
    await route.fulfill({ response, body: body.replace(marker, `${marker}
      if (window.__failNoticeReads) throw new Error('synthetic notice read unavailable');`) });
  });
  await page.goto('/#/dashboard');
  const error = page.getByRole('alert').filter({ hasText: 'Avisos de GastApp: no verificable' });
  await expect(error).toBeVisible();
  const reminder = page.getByRole('button', { name: 'Omitir', exact: true });
  if (await reminder.isVisible()) await reminder.click();
  await error.getByRole('button', { name: 'Reintentar lectura de avisos' }).click();
  await expect(error).toBeVisible();
  for (const [name, width, height] of [['desktop', 1280, 800], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await error.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`notice-not-verifiable-${name}.png`) });
  }
  await page.evaluate(() => { (window as any).__failNoticeReads = false; });
  await error.getByRole('button', { name: 'Reintentar lectura de avisos' }).click();
  await expect(error).toHaveCount(0);
  expect((await root.get()).data()?.gastappRevisionNoticeSeenV1).toEqual(original.gastappRevisionNoticeSeenV1);
  await guard.assertClean(testInfo);
});

test('two sessions cannot replace a current R2 acknowledgement with delayed R1', async ({ page, browser }, testInfo) => {
  const guard = await installLocalNetworkGuard(page);
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const other = await otherContext.newPage(); const otherGuard = await installLocalNetworkGuard(other);
  let acknowledgementWrites = 0;
  for (const actor of [page, other]) actor.on('response', response => {
    if (response.status() !== 200 || !new URL(response.url()).pathname.endsWith('/documents:commit')) return;
    const body = response.request().postDataJSON();
    if (body.writes?.some((write: any) => write.update?.fields?.gastappRevisionNoticeSeenV1)) acknowledgementWrites++;
  });
  try {
    await page.goto('/#/presentation'); await other.goto('/#/presentation');
    for (const actor of [page, other]) await expect.poll(() => actor.evaluate(async () => {
      const storage = await import('/src/services/wealthStorage.ts'); return storage.loadWealthSyncUiState().status;
    })).toBe('synced');
    const r1 = `sha256:${'1'.repeat(64)}`, r2 = `sha256:${'2'.repeat(64)}`;
    const cloud = (await root.get()).data()!;
    const accepted = await page.evaluate(async ({ closure, hash }) => {
      const { buildGastappMonthlyExpenseCloseSnapshot } = await import('/src/services/wealthStorage.ts');
      return buildGastappMonthlyExpenseCloseSnapshot({
        monthKey: closure.monthKey, calendarMonthKey: closure.monthKey, totalEur: 104,
        byFamilyEur: { dayToDay: 104, trips: 0, others: 0 },
        canonicalDataHash: hash, operationalDataHash: hash, operationalRevision: 2, sourceGeneration: 2,
        monthContractRevision: 2, monthContractHash: hash, certificationStatus: 'revised',
        certificationRevision: 2, certificationHash: hash, contractHash: hash,
        contractVersion: 'gastapp-aurum-calendar-months-v2', generatedAt: '2026-11-06T00:00:00Z',
      }, closure.fxRates);
    }, { closure: cloud.closures[0], hash: r2 });
    const closures = cloud.closures.map((closure: any, index: number) => index ? closure : ({ ...closure, gastappExpenseClose: accepted }));
    const monthKey = closures[0].monthKey;
    await root.update({ closures, gastappRevisionNoticeSeenV1: { [monthKey]: r1 } });
    // The preceding full-suite tests can leave legitimate general-sync work.
    // Drain it through the real API before establishing the acknowledgement
    // baseline; keep exact closure/history equality across the acknowledgements.
    for (const actor of [page, other]) {
      expect(await actor.evaluate(async () => {
        const storage = await import('/src/services/wealthStorage.ts');
        await storage.hydrateWealthFromCloud();
        return storage.syncWealthNow();
      })).toBe(true);
    }
    const closuresBeforeAcknowledgement = (await root.get()).data()!.closures;
    expect(closuresBeforeAcknowledgement[0].gastappExpenseClose).toEqual(accepted);
    for (const closure of closures) {
      const current = closuresBeforeAcknowledgement.find((value: any) => value.id === closure.id);
      expect(current.records).toEqual(closure.records);
      expect(current.summary).toEqual(closure.summary);
      expect(current.fxRates).toEqual(closure.fxRates);
      expect(current.previousVersions || []).toEqual(expect.arrayContaining(closure.previousVersions || []));
    }
    const ack = (actor: typeof page, hash: string, certificationRevision: number) => actor.evaluate(async input => {
      const storage = await import('/src/services/wealthStorage.ts');
      return storage.acknowledgeGastappRevisionNotices([input]);
    }, { monthKey, contractHash: hash, certificationRevision });
    await Promise.all([ack(page, r1, 1), ack(other, r2, 2)]);
    expect((await root.get()).data()?.gastappRevisionNoticeSeenV1[monthKey]).toBe(r2);
    await expect.poll(() => acknowledgementWrites).toBe(1);
    await ack(page, r1, 1); await ack(other, r2, 2);
    // Other devices may still perform legitimate general sync writes. Count
    // notice writes specifically, rather than the whole root's updateTime.
    expect(acknowledgementWrites).toBe(1);
    expect((await root.get()).data()?.gastappRevisionNoticeSeenV1[monthKey]).toBe(r2);
    expect((await root.get()).data()?.closures).toEqual(closuresBeforeAcknowledgement);
    await guard.assertClean(testInfo); await otherGuard.assertClean(testInfo);
  } finally { await otherContext.close(); }
});
