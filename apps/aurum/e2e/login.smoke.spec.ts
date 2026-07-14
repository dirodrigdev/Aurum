import { expect, test } from '@playwright/test';

const KNOWN_TAILWIND_CDN_WARNING = /^cdn\.tailwindcss\.com should not be used in production\. To use Tailwind CSS in production, install it as a PostCSS plugin or use the Tailwind CLI: https:\/\/tailwindcss\.com\/docs\/installation$/;
const KNOWN_APP_BUILD_WARNING = /^\[APP_BUILD\] Cambio detectado \(none -> [A-Za-z0-9._-]+\)\. Forzando hard refresh\.\.\.$/;
const MUTATING_OWN_ROUTE = /publish|closure|close-period|sync|delete|rollback|apply|prepare|backup|undo|fintoc|refresh-intent|discover|webhook|historical-closure|admin/i;

type RequestRecord = {
  method: string;
  origin: string;
  pathname: string;
};

test('unauthenticated login screen mounts safely', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const unexpectedWarnings: string[] = [];
  const failedRequests: string[] = [];
  const blockedRequests: string[] = [];
  const requests: RequestRecord[] = [];
  const ownOrigin = new URL(testInfo.project.use.baseURL ?? 'http://127.0.0.1:3000').origin;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (
      message.type() === 'warning' &&
      !KNOWN_TAILWIND_CDN_WARNING.test(message.text()) &&
      !KNOWN_APP_BUILD_WARNING.test(message.text())
    ) {
      unexpectedWarnings.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    failedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), origin: url.origin, pathname: url.pathname });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isOwnApi = url.origin === ownOrigin && url.pathname.startsWith('/api/');
    const isBlocked = isOwnApi && (MUTATING_OWN_ROUTE.test(url.pathname) || request.method() !== 'GET');

    if (isBlocked) {
      blockedRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }

    await route.continue();
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('Aurum', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Inicia sesión con tu cuenta Google para sincronizar el mismo patrimonio en todos tus dispositivos.'),
  ).toBeVisible();
  const loginButton = page.getByRole('button', { name: 'Entrar con Google', exact: true });
  await expect(loginButton).toBeVisible();
  await expect(loginButton).toBeEnabled();
  await expect(page.getByText('Firebase: Error (auth/invalid-api-key)', { exact: false })).toHaveCount(0);
  await expect(page.locator('#root')).not.toBeEmpty();

  await testInfo.attach('network-requests.json', {
    body: JSON.stringify(requests, null, 2),
    contentType: 'application/json',
  });

  expect(blockedRequests, `blocked own routes: ${blockedRequests.join(', ')}`).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  expect(unexpectedWarnings, `unexpected warnings: ${unexpectedWarnings.join(' | ')}`).toEqual([]);
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
});
