import assert from 'node:assert/strict';
import {
  isLocalQaHostname,
  shouldEnableLocalReadOnlyCloudFallback,
} from './localReadOnlyCloudFallback';

assert.equal(isLocalQaHostname('localhost'), true);
assert.equal(isLocalQaHostname('127.0.0.1'), true);
assert.equal(isLocalQaHostname('midas-neon.vercel.app'), false);

assert.equal(shouldEnableLocalReadOnlyCloudFallback({
  aurumIntegrationConfigured: true,
  authStatus: 'authenticatedGoogle',
  isCanonicalUserSession: true,
  simulationConfigHydrationStatus: 'cloud',
  hostname: 'localhost',
  isDev: true,
}), false, 'cloud OK must keep normal flow');

assert.equal(shouldEnableLocalReadOnlyCloudFallback({
  aurumIntegrationConfigured: true,
  authStatus: 'authenticatedGoogle',
  isCanonicalUserSession: true,
  simulationConfigHydrationStatus: 'error',
  hostname: 'midas-neon.vercel.app',
  isDev: false,
}), false, 'production must not enable local fallback');

assert.equal(shouldEnableLocalReadOnlyCloudFallback({
  aurumIntegrationConfigured: true,
  authStatus: 'authenticatedGoogle',
  isCanonicalUserSession: true,
  simulationConfigHydrationStatus: 'error',
  hostname: 'localhost',
  isDev: true,
}), true, 'localhost/dev cloud error should allow read-only shell');

assert.equal(shouldEnableLocalReadOnlyCloudFallback({
  aurumIntegrationConfigured: true,
  authStatus: 'authenticatedGoogle',
  isCanonicalUserSession: true,
  simulationConfigHydrationStatus: 'missing',
  hostname: '127.0.0.1',
  isDev: false,
}), true, 'localhost missing cloud config should allow read-only shell');

assert.equal(shouldEnableLocalReadOnlyCloudFallback({
  aurumIntegrationConfigured: true,
  authStatus: 'authenticatedButAnonymous',
  isCanonicalUserSession: false,
  simulationConfigHydrationStatus: 'error',
  hostname: 'localhost',
  isDev: true,
}), false, 'fallback must not bypass canonical auth');

console.log('localReadOnlyCloudFallback tests passed');
