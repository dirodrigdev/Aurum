import assert from 'node:assert/strict';
import { buildAuthGateStatus } from './authGateStatus';

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'loginRequired',
    authResolved: true,
    authSigningIn: false,
    authErrorMessage: null,
    simulationConfigHydrationStatus: 'loading',
    simulationConfigErrorMessage: null,
  });
  assert.equal(status.status, 'loginRequired');
  assert.equal(status.primaryActionLabel, 'Entrar con Google');
})();

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'authenticatedGoogle',
    authResolved: true,
    authSigningIn: false,
    authErrorMessage: null,
    simulationConfigHydrationStatus: 'loading',
    simulationConfigErrorMessage: null,
  });
  assert.equal(status.status, 'cloudConfigLoading');
  assert.match(status.message, /configuración canónica M8/i);
})();

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'authenticatedGoogle',
    authResolved: true,
    authSigningIn: false,
    authErrorMessage: null,
    simulationConfigHydrationStatus: 'missing',
    simulationConfigErrorMessage: null,
  });
  assert.equal(status.status, 'cloudConfigMissing');
})();

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'authenticatedGoogle',
    authResolved: true,
    authSigningIn: false,
    authErrorMessage: null,
    simulationConfigHydrationStatus: 'error',
    simulationConfigErrorMessage: 'Missing or insufficient permissions.',
  });
  assert.equal(status.status, 'cloudConfigError');
  assert.match(status.detail ?? '', /permissions/i);
})();

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'authError',
    authResolved: true,
    authSigningIn: false,
    authErrorMessage: 'auth/timeout',
    simulationConfigHydrationStatus: 'loading',
    simulationConfigErrorMessage: null,
  });
  assert.equal(status.status, 'authError');
  assert.equal(status.showSecondaryAction, true);
})();

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'authenticatedButAnonymous',
    authResolved: true,
    authSigningIn: false,
    authErrorMessage: null,
    simulationConfigHydrationStatus: 'loading',
    simulationConfigErrorMessage: null,
  });
  assert.equal(status.status, 'authenticatedButAnonymous');
})();

(() => {
  const status = buildAuthGateStatus({
    authStatus: 'checkingAuth',
    authResolved: false,
    authSigningIn: false,
    authErrorMessage: null,
    simulationConfigHydrationStatus: 'loading',
    simulationConfigErrorMessage: null,
  });
  assert.equal(status.status, 'checkingAuth');
})();

console.log('authGateStatus tests passed');
