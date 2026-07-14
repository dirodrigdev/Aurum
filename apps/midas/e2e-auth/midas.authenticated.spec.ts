import { expect, test } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

test('local emulator session loads MIDAS without external traffic', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const blockedRequests: string[] = [];
  const requests: Array<{ method: string; origin: string; pathname: string }> = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), origin: url.origin, pathname: url.pathname });
    if (!LOCAL_HOSTS.has(url.hostname)) {
      blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('Midas', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulación', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeVisible();
  await expect(page.getByText('Entrar con Google', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Carga oficial del Instrument Universe' })).toBeVisible();
  await page.getByRole('button', { name: 'Simulación', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simulación', exact: true })).toBeVisible();

  await testInfo.attach('network-requests.json', {
    body: JSON.stringify(requests, null, 2),
    contentType: 'application/json',
  });
  expect(blockedRequests, `external requests: ${blockedRequests.join(', ')}`).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
