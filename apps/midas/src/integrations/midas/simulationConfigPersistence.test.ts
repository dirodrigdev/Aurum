import assert from 'node:assert/strict';
import {
  getUserScopedSimulationConfigPath,
  shouldSeedUserScopedSimulationConfig,
} from './simulationConfigCanonical';

(() => {
  const uid = 'google-user-123';
  assert.equal(
    getUserScopedSimulationConfigPath(uid),
    'users/google-user-123/midas_config/simulationActiveV1',
    'same Google user must map to the same scoped config path',
  );
})();

(() => {
  assert.equal(
    'midas_config/simulationActiveV1',
    'midas_config/simulationActiveV1',
    'legacy global path stays explicit for migration diagnostics',
  );
})();

(() => {
  assert.equal(
    shouldSeedUserScopedSimulationConfig({
      readStatus: 'missing',
      isCanonicalUserSession: true,
      hasLocalCandidate: true,
      cloudExists: false,
    }),
    true,
    'missing user config may be seeded from a local candidate after canonical auth',
  );
  assert.equal(
    shouldSeedUserScopedSimulationConfig({
      readStatus: 'error',
      isCanonicalUserSession: true,
      hasLocalCandidate: true,
      cloudExists: null,
    }),
    false,
    'permission/error states must not auto-seed cloud',
  );
  assert.equal(
    shouldSeedUserScopedSimulationConfig({
      readStatus: 'missing',
      isCanonicalUserSession: false,
      hasLocalCandidate: true,
      cloudExists: false,
    }),
    false,
    'anonymous or missing auth must not seed user-scoped config',
  );
})();

console.log('simulationConfigPersistence tests passed');
