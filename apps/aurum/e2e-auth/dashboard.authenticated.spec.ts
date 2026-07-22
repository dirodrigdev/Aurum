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

test('authenticated Settings can regenerate the canonical MIDAS publication', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const networkGuard = await installLocalNetworkGuard(page);

  const response = await page.goto('/#/settings');
  expect(response?.ok()).toBe(true);
  const dismissIncompleteClosure = page.getByRole('button', { name: 'Omitir', exact: true });
  await expect(dismissIncompleteClosure).toBeVisible({ timeout: 30_000 });
  await dismissIncompleteClosure.click();
  const syncSection = page.getByRole('button', { name: /Sincronización/ });
  await expect(syncSection).toBeVisible({ timeout: 30_000 });
  await syncSection.click();

  const regenerate = page.getByRole('button', { name: 'Regenerar publicación MIDAS', exact: true });
  await expect(regenerate).toBeVisible();
  await expect(page.getByText(/Listo para publicar 2026-06/)).toBeVisible();
  await regenerate.click();
  await expect(page.getByText(/Publicado 2026-06 con FX económico al 2026-06-30/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('aurum-midas-publication-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(regenerate).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('aurum-midas-publication-mobile.png'), fullPage: true });

  await networkGuard.assertClean(testInfo);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('Ecosystem is reachable from Aurum Dashboard and works on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const networkGuard = await installLocalNetworkGuard(page);

  await page.goto('/#/dashboard');
  const dismissIncompleteClosure = page.getByRole('button', { name: 'Omitir', exact: true });
  await expect(dismissIncompleteClosure).toBeVisible({ timeout: 30_000 });
  await dismissIncompleteClosure.click();
  const ecosystemButton = page.getByRole('button', { name: 'Ver ecosistema', exact: true });
  await expect(ecosystemButton).toBeVisible({ timeout: 30_000 });
  await ecosystemButton.click();
  await expect(page).toHaveURL(/#\/ecosystem$/);
  const ecosystem = page.getByTestId('aurum-ecosystem');
  await expect(ecosystem).toBeVisible();
  await expect(page.getByText('Cierre mensual incompleto', { exact: true })).toHaveCount(0);
  await expect(ecosystem).toContainText('GastApp observa. Aurum integra. MIDAS proyecta.');
  await expect(ecosystem).toContainText('Acceso protegido');
  await expect(ecosystem).toContainText('Pruebas automáticas');
  await expect(ecosystem).toContainText('Firebase Auth · Firestore · GitHub · Vercel · Playwright');
  await page.evaluate(() => window.scrollTo(0, 0));
  const ecosystemHtml = await ecosystem.evaluate((element) => element.outerHTML);
  const pageText = await page.locator('body').innerText();
  expect(ecosystemHtml).not.toMatch(/(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
  expect(ecosystemHtml).not.toMatch(/(?:\$|€)\s*\d/);
  expect(pageText).not.toMatch(/(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
  expect(pageText).not.toMatch(/(?:\$|€)\s*\d/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('aurum-ecosystem-mobile.png'), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desktopOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('aurum-ecosystem-desktop.png'), fullPage: true });

  await networkGuard.assertClean(testInfo);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
