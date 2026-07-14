import { expect, test } from '@playwright/test';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

test('local emulator session loads Dashboard without external traffic', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const networkGuard = await installLocalNetworkGuard(page);

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('Aurum', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Patrimonio', exact: true })).toBeVisible();
  await expect(page.getByText('Entrar con Google', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Evolución patrimonial', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Patrimonio', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('Evolución patrimonial', { exact: true })).toBeVisible();

  await networkGuard.assertClean(testInfo);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
