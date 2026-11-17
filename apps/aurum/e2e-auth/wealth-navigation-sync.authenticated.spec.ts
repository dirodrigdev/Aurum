import { expect, test } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

type SyncTrace = { status: string; route: string; stack: string };
function wealthRef() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw new Error('Navigation sync tests require the local Firestore Emulator.');
  }
  const name = 'aurum-navigation-sync';
  const app = getApps().find((item) => item.name === name) || initializeApp({ projectId: 'aurum-e2e-local' }, name);
  return getFirestore(app).doc('aurum_wealth/aurum-e2e-user');
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`reading routes does not dirty or write wealth without edits on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000); // Auth bootstrap plus two complete navigation rounds.
    const guard = await installLocalNetworkGuard(page);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const today = new Date();
      localStorage.setItem('aurum.incomplete-closure.prompt.day.v1',
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
      const traces: SyncTrace[] = [];
      (window as Window & { navigationSyncTrace?: SyncTrace[] }).navigationSyncTrace = traces;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === window.localStorage && key === 'aurum:wealth-sync-status-v1') {
          traces.push({ status: JSON.parse(value).status, route: location.hash, stack: new Error().stack || '' });
        }
        return original.call(this, key, value);
      };
    });
    const ref = wealthRef();
    const original = (await ref.get()).data()!;
    const writes: { url: string; documents: string[] }[] = [];
    try {
      await page.goto('/#/dashboard');
      await expect(page.getByRole('navigation')).toBeVisible();
      // Establish a confirmed baseline before measuring read-only navigation.
      await page.evaluate(async () => {
        const hydrationPath = '/src/services/wealthHydration.ts';
        await (await import(hydrationPath)).hydrateWealthFromCloudShared({ force: true, minIntervalMs: 0 });
        const path = '/src/services/wealthStorage.ts';
        if (!await (await import(path)).syncWealthNow()) throw new Error('Synthetic baseline sync failed');
      });
      const before = (await ref.get()).data()!;
      await page.evaluate(() => {
        (window as Window & { navigationSyncTrace?: SyncTrace[] }).navigationSyncTrace!.length = 0;
      });
      page.on('request', (request) => {
        if (request.method() !== 'POST') return;
        const url = request.url();
        if (!/documents:commit|\/Write\/channel/.test(url)) return;
        const body = request.postData() || '';
        const payloads = url.includes('documents:commit') ? [body] : [...new URLSearchParams(body).values()];
        for (const payload of payloads) {
          if (!/"writes"\s*:\s*\[\s*\{/.test(payload)) continue;
          writes.push({ url, documents: [...payload.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((match) => match[1]) });
        }
      });
      for (let round = 0; round < 2; round += 1) {
        for (const label of ['Patrimonio', 'Ajustes', 'Cierre', 'Análisis', 'Dashboard']) {
          await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
          // Observe entry effects and their immediate writes; no fields are edited.
          await page.waitForTimeout(700);
        }
      }
      const traces = await page.evaluate(() => (window as Window & { navigationSyncTrace?: SyncTrace[] }).navigationSyncTrace || []);
      const after = (await ref.get()).data()!;
      const changedKeys = Object.keys({ ...before, ...after }).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      await testInfo.attach('navigation-sync-evidence', {
        body: JSON.stringify({ traces, writes, changedKeys, beforeUpdatedAt: before.updatedAt, afterUpdatedAt: after.updatedAt }, null, 2),
        contentType: 'application/json',
      });
      console.log('[Navigation sync evidence]', JSON.stringify({ viewport: viewport.name, traces, writes, changedKeys }));
      expect(traces.filter((trace) => trace.status !== 'synced')).toEqual([]);
      expect(writes).toEqual([]);
      expect(after).toEqual(before);
      await expect(page.getByText('Pendiente de sincronización', { exact: true })).toHaveCount(0);

      // Opening the investment reader must also remain read-only. Persist a new
      // instrument only after the user explicitly asks to create it.
      await page.getByRole('navigation').getByRole('link', { name: 'Patrimonio', exact: true }).click();
      await page.getByRole('button', { name: 'Entrar a Inversiones', exact: true }).click();
      await page.getByRole('button', { name: /Gestionar instrumentos/ }).click();
      await expect(page.getByRole('button', { name: '+ Agregar instrumento', exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`read-only-investments-${viewport.name}.png`), fullPage: true });
      expect((await ref.get()).data()).toEqual(before);
      expect(writes).toEqual([]);
      const readTraces = await page.evaluate(() => (window as Window & { navigationSyncTrace?: SyncTrace[] }).navigationSyncTrace || []);
      expect(readTraces.filter((trace) => trace.status !== 'synced')).toEqual([]);

      await page.getByRole('button', { name: '+ Agregar instrumento', exact: true }).click();
      const label = `Explicit synthetic investment ${viewport.name}`;
      await page.getByPlaceholder('Nombre del instrumento', { exact: true }).fill(label);
      await page.getByRole('button', { name: 'Crear instrumento', exact: true }).click();
      await expect.poll(async () => (await ref.get()).data()?.instruments?.some((item: { label: string }) => item.label === label)).toBe(true);
      await expect.poll(() => page.evaluate(async () => {
        const path = '/src/services/wealthStorage.ts';
        return (await import(path)).loadWealthSyncUiState().status;
      })).toBe('synced');
      const edited = (await ref.get()).data()!;
      expect(edited.instruments).toHaveLength(before.instruments.length + 1);
      expect(edited.records).toEqual(before.records);
      expect(edited.closures).toEqual(before.closures);
      expect(edited.fx).toEqual(before.fx);
      expect(writes.length).toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`explicit-investment-synced-${viewport.name}.png`), fullPage: true });

      // A pending sync notice must stay at the page top without covering the
      // content after the reader scrolls, and this UI-only state must not write.
      const writesAfterEdit = writes.length;
      await page.evaluate(async () => {
        const path = '/src/services/wealthStorage.ts';
        (await import(path)).scheduleWealthCloudSync(300_000);
      });
      const pendingBanner = page.getByText('Pendiente de sincronización', { exact: true });
      await expect(pendingBanner).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`sync-pending-top-${viewport.name}.png`) });
      await page.evaluate(() => window.scrollTo(0, 200));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(4);
      await expect(pendingBanner).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`sync-pending-scrolled-${viewport.name}.png`) });
      expect(writes).toHaveLength(writesAfterEdit);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(pendingBanner).toBeVisible();
      await guard.assertClean(testInfo);
    } finally {
      await page.close();
      await ref.set(original);
    }
  });
}
