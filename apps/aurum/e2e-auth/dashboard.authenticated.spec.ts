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

test('monthly-close preflight exposes temporary confirmations before final close', async ({ page }, testInfo) => {
  await page.goto('/#/dashboard');
  const dismissIncompleteClosure = page.getByRole('button', { name: 'Omitir', exact: true });
  await expect(dismissIncompleteClosure).toBeVisible({ timeout: 30_000 });
  await dismissIncompleteClosure.click();

  await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
  const preflightToggle = page.getByRole('button', { name: 'Simular cierre / Preflight', exact: true });
  await expect(preflightToggle).toBeVisible({ timeout: 30_000 });
  await preflightToggle.click();

  await expect(page.getByText('Confirmaciones para simular el cierre', { exact: true })).toBeVisible();
  const economicConfirmation = page.getByRole('checkbox', {
    name: /tasas utilizadas corresponden al cierre económico/i,
  });
  await expect(economicConfirmation).toBeVisible();
  await economicConfirmation.check();

  const fallbackConfirmation = page.getByRole('checkbox', {
    name: /revisé manualmente las tasas utilizadas sin referencia automática/i,
  });
  if (await fallbackConfirmation.count()) await fallbackConfirmation.check();

  await page.screenshot({ path: testInfo.outputPath('aurum-close-preflight-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('aurum-close-preflight-mobile.png'), fullPage: true });
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

test('monthly close keeps final FX stable and carries July balances into August', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem('aurum.banks.update.mode.v1', 'manual');
    window.localStorage.setItem('aurum.closing.config.v1', JSON.stringify({
      rules: {
        investments_value: { enabled: false, maxAgeDays: null },
        banks_fintoc: { enabled: false, maxAgeDays: null },
        tenencia: { enabled: false, maxAgeDays: null },
        cards_used: { enabled: false, maxAgeDays: null },
        property_value: { enabled: false, maxAgeDays: null },
        mortgage_balance: { enabled: false, maxAgeDays: null },
        mortgage_amortization: { enabled: false, maxAgeDays: null },
      },
    }));
  });

  let fxRequestCount = 0;
  await page.route('**/api/fx/closure?**', async (route) => {
    fxRequestCount += 1;
    if (fxRequestCount > 1) await new Promise((resolve) => setTimeout(resolve, 750));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        monthKey: '2026-07',
        economicDate: '2026-07-31',
        rates: { usdClp: 924.78, eurClp: 1066.4, ufClp: 40844.79 },
        sources: { usd: 'e2e-official', eur: 'e2e-official', uf: 'e2e-official' },
        effectiveDates: { usd: '2026-07-31', eur: '2026-07-31', uf: '2026-07-31' },
        references: {
          usd: { value: 924.78, availability: 'final', effectiveDate: '2026-07-31', source: 'e2e-official' },
          eur: { value: 1066.4, availability: 'final', effectiveDate: '2026-07-31', source: 'e2e-official' },
          uf: { value: 40844.79, availability: 'final', effectiveDate: '2026-07-31', source: 'e2e-official' },
        },
        retrievedAt: '2026-08-01T12:00:00.000Z',
        warnings: [],
      }),
    });
  });

  await page.goto('/#/dashboard');
  const dismissIncompleteClosure = page.getByRole('button', { name: 'Omitir', exact: true });
  await expect(dismissIncompleteClosure).toBeVisible({ timeout: 30_000 });
  await dismissIncompleteClosure.click();
  await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
  await page.evaluate(() => {
    const config = JSON.parse(window.localStorage.getItem('aurum.closing.config.v1') || '{"rules":{}}');
    const instruments = JSON.parse(window.localStorage.getItem('wealth_investment_instruments_v1') || '[]');
    instruments.forEach((instrument: { id?: string }) => {
      if (instrument.id) config.rules[`investment:${instrument.id}`] = { enabled: false, maxAgeDays: null };
    });
    window.localStorage.setItem('aurum.closing.config.v1', JSON.stringify(config));
  });

  const preflightToggle = page.getByRole('button', { name: 'Simular cierre / Preflight', exact: true });
  await expect(preflightToggle).toBeVisible({ timeout: 30_000 });
  await preflightToggle.click();
  await expect(page.getByText('Final al 2026-07-31', { exact: true })).toHaveCount(3);

  await page.getByRole('button', { name: 'Cerrar mes', exact: true }).click();
  await expect(page.getByText('Confirmar cierre mensual', { exact: true })).toBeVisible();
  const closeModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Confirmar cierre mensual' });
  await page.waitForTimeout(300);
  await expect(closeModal.getByText('No disponible', { exact: true })).toHaveCount(0);
  await expect(closeModal.getByText('Final al 2026-07-31', { exact: true })).toHaveCount(3);
  await expect(page.locator('#close-fx-eur')).toHaveValue('1066.4');
  await expect(page.locator('#close-fx-uf')).toHaveValue('40844.79');

  await page.locator('#close-fx-usd').fill('930');
  await page.locator('#close-fx-manual-reason').fill('Corrección valor E2E');
  await closeModal.getByRole('checkbox', { name: /tasas utilizadas corresponden al cierre económico/i }).check();
  await closeModal.getByRole('checkbox', { name: /deseo utilizar tasas particulares distintas/i }).check();
  await page.screenshot({ path: testInfo.outputPath('aurum-monthly-close-mobile.png'), fullPage: true });
  await closeModal.getByRole('button', { name: /Confirmar cierre|Cerrar con arrastres/ }).click();
  await expect(closeModal.getByRole('status')).toContainText('Guardando cierre');
  await expect(closeModal.getByRole('button', { name: 'Guardando cierre…', exact: true })).toBeDisabled();

  await expect(page.getByText('Confirmar cierre mensual', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/Resumen estratégico agosto de 2026/i)).toBeVisible();

  const persisted = await page.evaluate(() => {
    const closures = JSON.parse(window.localStorage.getItem('wealth_closures_v1') || '[]');
    const records = JSON.parse(window.localStorage.getItem('wealth_records_v1') || '[]');
    const julyClosure = closures.find((closure: { monthKey?: string }) => closure.monthKey === '2026-07');
    const augustRecords = records.filter((record: { snapshotDate?: string }) =>
      String(record.snapshotDate || '').startsWith('2026-08-'));
    const amountByBlock = (block: string) => augustRecords
      .filter((record: { block?: string }) => record.block === block)
      .reduce((sum: number, record: { amount?: number }) => sum + Number(record.amount || 0), 0);
    const allJulyRecordsCarried = (julyClosure?.records || []).every((source: {
      block?: string; label?: string; currency?: string; amount?: number;
    }) => augustRecords.some((target: {
      block?: string; label?: string; currency?: string; amount?: number;
    }) =>
      target.block === source.block &&
      target.label === source.label &&
      target.currency === source.currency &&
      Number(target.amount || 0) === Number(source.amount || 0)));
    return {
      julyUsdClp: julyClosure?.fxRates?.usdClp || 0,
      julyEconomicDate: julyClosure?.fxMetadata?.economicDate || '',
      augustInvestment: amountByBlock('investment'),
      augustBank: amountByBlock('bank'),
      augustRealEstate: amountByBlock('real_estate'),
      allJulyRecordsCarried,
    };
  });

  expect(persisted).toMatchObject({
    julyUsdClp: 930,
    julyEconomicDate: '2026-07-31',
  });
  expect(persisted.augustInvestment).toBeGreaterThan(0);
  expect(persisted.augustBank).toBeGreaterThan(0);
  expect(persisted.augustRealEstate).toBeGreaterThan(0);
  expect(persisted.allJulyRecordsCarried).toBe(true);

  const closeSummaryButton = page.getByRole('button', { name: 'Cerrar ventana', exact: true });
  await expect(closeSummaryButton).toBeVisible();
  await closeSummaryButton.click();
  const snoozeButton = page.getByRole('button', { name: 'Recordarme después', exact: true }).last();
  await expect(snoozeButton).toBeVisible();
  await snoozeButton.click();

  await expect(page.getByRole('button', { name: 'Entrar a Inversiones' })).toContainText('+$0 (+0,0%)');
  await expect(page.getByRole('button', { name: 'Entrar a Bancos' })).toContainText('+$0 (+0,0%)');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('aurum-august-carry-mobile.png'), fullPage: true });
});
