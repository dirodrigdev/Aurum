import { expect, test } from '@playwright/test';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

test('local emulator session loads MIDAS without external traffic', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const networkGuard = await installLocalNetworkGuard(page);

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('Midas', { exact: true })).toBeVisible();
  // Firestore Emulator startup can delay MIDAS's authenticated cloud-config hydration.
  await expect(page.getByRole('button', { name: 'Simulación', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Entrar con Google', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Carga oficial del Instrument Universe' })).toBeVisible();
  await page.getByRole('button', { name: 'Simulación', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simulación', exact: true })).toBeVisible();

  await networkGuard.assertClean(testInfo);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
