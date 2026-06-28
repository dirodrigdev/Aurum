import assert from 'node:assert/strict';
import {
  shouldPersistActiveSimulationConfig,
  shouldSeedUserScopedSimulationConfig,
} from './simulationConfigCanonical';

assert.equal(shouldPersistActiveSimulationConfig({
  hydrationStatus: 'cloud',
  nextHash: 'hash-next',
  cloudHash: 'hash-prev',
}), true, 'cloud config should still persist when the canonical hash changes');

assert.equal(shouldPersistActiveSimulationConfig({
  hydrationStatus: 'cloud',
  nextHash: 'hash-same',
  cloudHash: 'hash-same',
}), false, 'cloud config should not persist when the canonical hash is unchanged');

assert.equal(shouldPersistActiveSimulationConfig({
  hydrationStatus: 'missing',
  nextHash: 'hash-local',
  cloudHash: null,
}), false, 'missing cloud config must not be auto-created from local/cache state');

assert.equal(shouldPersistActiveSimulationConfig({
  hydrationStatus: 'error',
  nextHash: 'hash-local',
  cloudHash: null,
}), false, 'error cloud state must not auto-persist config');

assert.equal(shouldSeedUserScopedSimulationConfig({
  readStatus: 'missing',
  isCanonicalUserSession: true,
  hasLocalCandidate: true,
  cloudExists: false,
}), true, 'legacy helper shape stays documented for explicit future flows');

console.log('simulationConfigCanonical tests passed');
