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
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30_000 });
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

test('authenticated Dashboard is directly addressable and privacy-safe', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const networkGuard = await installLocalNetworkGuard(page);

  const response = await page.goto('/#/dashboard');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30_000 });
  // The isolated authenticated harness intentionally has no Aurum snapshot.
  // Dashboard must represent that incomplete canonical state without synthetic results.
  const dashboardState = page.getByTestId('dashboard-empty-state');
  await expect(dashboardState).toBeVisible({ timeout: 30_000 });
  await expect(dashboardState).toContainText('Preparando una lectura segura del plan');

  const dashboardHtml = await dashboardState.evaluate((element) => element.outerHTML);
  const dashboardText = await dashboardState.innerText();
  expect(dashboardHtml).not.toMatch(/(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
  expect(dashboardHtml).not.toMatch(/(?:\$|€)\s*\d/);
  expect(dashboardHtml).not.toContain('12500000');
  expect(dashboardHtml).not.toContain('900000');
  expect(dashboardText).toContain('valores monetarios permanecen ocultos');
  expect(dashboardText).not.toContain('NaN');
  expect(dashboardText).not.toContain('undefined');
  expect(dashboardText).not.toContain('[object Object]');

  await page.getByRole('button', { name: 'Simulación', exact: true }).click();
  await expect(page).not.toHaveURL(/#\/dashboard$/);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByTestId('dashboard-empty-state')).toBeVisible();

  await networkGuard.assertClean(testInfo);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
