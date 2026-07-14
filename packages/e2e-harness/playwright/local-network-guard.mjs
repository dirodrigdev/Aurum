const DEFAULT_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export async function installLocalNetworkGuard(page, options = {}) {
  const allowedHosts = new Set(options.approvedHosts ?? DEFAULT_LOCAL_HOSTS);
  const forbiddenLocalPaths = options.forbiddenLocalPaths ?? [];
  const blockedRequests = [];
  const requests = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), origin: url.origin, pathname: url.pathname });
    const forbiddenPath = forbiddenLocalPaths.some((rule) => (
      typeof rule === 'string' ? url.pathname.includes(rule) : rule.test(url.pathname)
    ));
    if (!allowedHosts.has(url.hostname) || forbiddenPath) {
      blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });

  return {
    async assertClean(testInfo) {
      await testInfo.attach('network-requests.json', {
        body: JSON.stringify(requests, null, 2),
        contentType: 'application/json',
      });
      if (blockedRequests.length > 0) {
        throw new Error(`La prueba bloqueó solicitudes no permitidas: ${blockedRequests.join(', ')}`);
      }
    },
  };
}
