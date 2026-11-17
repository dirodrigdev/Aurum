import { expect, test } from '@playwright/test';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`confirmed manual sync consumes an earlier debounce on ${viewport.name}`, async ({ page }, testInfo) => {
    const guard = await installLocalNetworkGuard(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The unrelated daily closure reminder must not cover the sync button.
    await page.addInitScript(() => {
      const today = new Date();
      localStorage.setItem('aurum.incomplete-closure.prompt.day.v1',
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
    });
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: /Integración con GastApp Estado de conexión/ }).click();
    const syncButton = page.getByRole('button', { name: 'Sincronizar ahora', exact: true });
    await expect(syncButton).toBeVisible();
    await page.evaluate(async () => {
      const path = '/src/services/wealthStorage.ts';
      if (!await (await import(path)).syncWealthNow()) throw new Error('Synthetic initial sync failed');
    });

    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let started!: () => void;
    const firstCommit = new Promise<void>((resolve) => { started = resolve; });
    let commits = 0;
    await page.route(/\/documents:commit/, async (route) => {
      commits += 1;
      if (commits === 1) started();
      await gate;
      await route.continue();
    });
    try {
      await page.evaluate(async () => {
        const path = '/src/services/wealthStorage.ts';
        const service = await import(path);
        service.scheduleWealthCloudSync(1500);
        service.requestImmediateWealthSync();
      });
      await firstCommit;
      await expect(page.getByText('Pendiente de sincronización', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`sync-pending-${viewport.name}.png`), fullPage: true });
      await syncButton.click();
      resume();
      await expect(page.getByText('Sincronizado', { exact: true })).toBeVisible();
      // Cross the original debounce deadline: it must not restart a save.
      await page.waitForTimeout(1800);
      await expect(page.getByText('Pendiente de sincronización', { exact: true })).toHaveCount(0);
      expect(await page.evaluate(async () => {
        const path = '/src/services/wealthStorage.ts';
        const service = await import(path);
        return { status: service.loadWealthSyncUiState().status, issue: service.getLastWealthSyncIssue() };
      })).toEqual({ status: 'synced', issue: '' });
      await page.screenshot({ path: testInfo.outputPath(`sync-confirmed-${viewport.name}.png`), fullPage: true });
      expect(errors).toEqual([]);
      await guard.assertClean(testInfo);
    } finally {
      resume();
      if (!page.isClosed()) await page.unroute(/\/documents:commit/);
    }
  });
}
