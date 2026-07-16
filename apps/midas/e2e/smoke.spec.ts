import { expect, test } from '@playwright/test';

const heroQuestionPattern = /¿Llegarás a (los )?\d+ años\?/i;

async function openApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Simulación', exact: true })).toBeVisible();
}

async function expectStableSimulationShell(page: import('@playwright/test').Page) {
  const hero = page.locator('[data-simulation-section="hero-result"]');
  const body = page.locator('body');

  await expect(hero).toBeVisible();
  await expect(hero).toContainText(heroQuestionPattern);
  await expect(body).not.toContainText(/NaN/);
  await expect(body).not.toContainText(/undefined/);
  await expect(body).not.toContainText('[object Object]');
  await expect(body).not.toContainText(/error boundary/i);
}

async function openTab(
  page: import('@playwright/test').Page,
  label: string,
  expected: string | RegExp,
  timeoutMs = 10000,
) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const body = page.locator('body');
  try {
    await expect(body).toContainText(expected, { timeout: timeoutMs });
  } catch (error) {
    const loaderVisible = await page.getByText('Cargando sección…').first().isVisible().catch(() => false);
    const visibleSnippet = (await body.innerText().catch(() => ''))
      .replace(/\s+/g, ' ')
      .slice(0, 600);
    throw new Error(
      `Tab "${label}" did not finish loading. Expected ${String(expected)}. Loader visible=${String(loaderVisible)}. URL=${page.url()}. Visible body="${visibleSnippet}"`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

test('simulation home loads in local read-only mode', async ({ page }) => {
  test.setTimeout(30000);
  await openApp(page);
  const technicalDetailLine = page.getByText(/Bloques fuera del motor:/);

  await expectStableSimulationShell(page);
  await expect(page.locator('body')).not.toContainText(/Calculando/i);
  await expect(page.getByText(/Fuente de datos/i).last()).toBeVisible();
  await expect(technicalDetailLine).toBeHidden();
  await expect(page.getByRole('button', { name: 'Asistida', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sensibilidad', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lab técnico', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Optimización', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeVisible();

  await page.getByText('Ver detalle técnico', { exact: true }).last().click();
  await expect(technicalDetailLine).toBeVisible();
});

test('privacy-safe Dashboard direct route handles unavailable canonical input', async ({ page }) => {
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();

  const dashboard = page.getByTestId('dashboard-empty-state');
  await expect(dashboard).toBeVisible({ timeout: 30_000 });
  await expect(dashboard).toContainText(/Preparando una lectura segura del plan|No pudimos completar la lectura/);

  const dashboardHtml = await dashboard.evaluate((element) => element.outerHTML);
  const dashboardText = await dashboard.innerText();
  expect(dashboardHtml).not.toMatch(/(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
  expect(dashboardHtml).not.toMatch(/(?:\$|€)\s*\d/);
  expect(dashboardHtml).not.toContain('1401000000');
  expect(dashboardHtml).not.toContain('6000000');
  expect(dashboardText).toContain('valores monetarios permanecen ocultos');
  expect(dashboardText).not.toMatch(/NaN|undefined|\[object Object\]|error boundary/i);

  await page.reload();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByTestId('dashboard-empty-state')).toBeVisible({ timeout: 30_000 });
});

test.skip('assisted tab loads from the bottom nav', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Asistida', 'No sincronizado con Simulación principal');
});

test.skip('sensitivity tab loads from the bottom nav', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Sensibilidad', 'Análisis de sensibilidad');
});

test.skip('lab tab loads from the bottom nav', async ({ page }) => {
  test.setTimeout(45000);
  await openApp(page);
  await openTab(page, 'Lab técnico', 'Fuente de probabilidades', 30000);
});

test.skip('optimization tab loads from the bottom nav', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Optimización', 'Optimización MIDAS · Candidatos', 15000);
});

test.skip('scenario lab tab loads official exploratory evaluation shell', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Laboratorio', 'Laboratorio de Escenarios', 15000);
  await expect(page.getByText('Exploratorio · no decisional', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evaluar candidatos con M8' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Baseline M8 sellado');
});

test('settings tab stays read-only in local fallback', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Ajustes', /Cargar Instrument Universe V1|Guardar mix aperturado cloud/);
  const localReadOnlyBanner = page.getByText('Modo local de revisión', { exact: true }).last();
  const bannerVisible = await localReadOnlyBanner.isVisible().catch(() => false);
  if (bannerVisible) {
    await expect(page.getByRole('button', { name: 'Guardar mix aperturado cloud' })).toBeDisabled();
  }
  await expect(page.getByText('Recuperación legacy avanzada', { exact: true })).toBeVisible();
});

test.describe('mobile smoke', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('loads without horizontal overflow', async ({ page }) => {
    await openApp(page);

    await expectStableSimulationShell(page);
    await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth > 1;
    });

    expect(hasHorizontalOverflow).toBeFalsy();
  });

  test('Dashboard remains usable without horizontal page overflow', async ({ page }) => {
    await page.goto('/#/dashboard');
    await expect(page.getByTestId('dashboard-empty-state')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-empty-state')).toContainText(/Preparando una lectura segura del plan|No pudimos completar la lectura/);

    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth > 1;
    });
    expect(hasHorizontalOverflow).toBeFalsy();
  });
});
