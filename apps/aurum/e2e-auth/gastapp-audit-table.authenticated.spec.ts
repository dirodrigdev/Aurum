import { test, expect } from '@playwright/test';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

test('read-only audit shows monthly evidence across viewports', async ({ page }, testInfo) => {
  const guard = await installLocalNetworkGuard(page);
  await page.goto('/#/analysis');
  await expect(page.getByRole('button', { name: 'Actualizar análisis', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default || ReactModule;
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDOM.createRoot || ReactDOM.default.createRoot;
    const { GastappRevisionAuditTable } = await import('/src/components/analysis/GastappRevisionAuditTable.tsx');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;overflow:auto;padding:16px';
    document.body.appendChild(host);
    createRoot(host).render(React.createElement(GastappRevisionAuditTable, { rows: ['01', '02', '04', '09'].map((month, i) => ({
      monthKey: `2026-${month}`, closureId: month, status: i === 3 ? 'current' : 'stale', effectiveSource: 'sidecar',
      currentTotalEur: 7764.01, currentContractHash: `sha256:${'b'.repeat(64)}`,
      closureSnapshot: { status: 'missing', totalEur: null, contractHash: null },
      sidecarSnapshot: { status: 'stale', totalEur: 7675.01, contractHash: `sha256:${'a'.repeat(64)}` }, message: null,
    })) }));
  });
  const audit = page.getByRole('region', { name: 'Auditoría mensual GastApp', exact: true });
  await expect(audit).toContainText('2026-04');
  await expect(audit).toContainText('89,00');
  for (const [width, height] of [[1280, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(audit).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`audit-${width}.png`) });
  }
  await guard.assertClean(testInfo);
});
