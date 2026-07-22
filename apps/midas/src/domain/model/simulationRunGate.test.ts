import assert from 'node:assert/strict';
import { evaluateCanonicalInputReadiness, evaluateSimulationRunGate } from './simulationRunGate';

const base = () => ({
  authResolved: true,
  isCanonicalUserSession: true,
  hasEffectiveInput: true,
  cloudHydrationReady: true,
  simulationConfigHydrationStatus: 'cloud' as const,
  aurumIntegrationStatus: 'available' as const,
  aurumSnapshotAvailable: true,
  cloudUniverseReadStatus: 'loaded' as const,
  universeSourceOrigin: 'firestore' as const,
  simWorking: false,
  recalcWorkerStatus: 'idle' as const,
  simResultAvailable: false,
  effectiveEngineInputHash: 'hash-1',
  lastRenderedResultHash: null,
  lastRequestedRunHash: null,
});

(() => {
  const result = evaluateSimulationRunGate(base());
  assert.equal(result.status, 'should_run');
})();

(() => {
  const result = evaluateSimulationRunGate({ ...base(), simWorking: true });
  assert.equal(result.status, 'running');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    recalcWorkerStatus: 'running',
    lastRequestedRunHash: 'hash-1',
  });
  assert.equal(result.status, 'running');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    simResultAvailable: true,
    lastRenderedResultHash: 'hash-1',
  });
  assert.equal(result.status, 'completed');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    simResultAvailable: true,
    lastRenderedResultHash: 'old-hash',
    lastRequestedRunHash: 'old-hash',
  });
  assert.equal(result.status, 'should_run');
})();

(() => {
  const result = evaluateCanonicalInputReadiness({ ...base() });
  assert.deepEqual(result, { ready: true });
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    authResolved: false,
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'auth_loading' });
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    cloudHydrationReady: false,
    simulationConfigHydrationStatus: 'loading',
  });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.blockedReason, 'config_loading');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    cloudHydrationReady: true,
    simResultAvailable: true,
    lastRenderedResultHash: 'hash-1',
    lastRequestedRunHash: 'old-hash',
  });
  assert.equal(result.status, 'completed');
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    simulationConfigHydrationStatus: 'missing',
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'config_missing' });
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    cloudHydrationReady: false,
    universeSourceOrigin: 'firestore',
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'cloud_hydration_incomplete' });
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    cloudUniverseReadStatus: 'loading',
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'instrument_universe_loading' });
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    cloudUniverseReadStatus: 'timeout',
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'instrument_universe_timeout' });
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    cloudUniverseReadStatus: 'error',
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'instrument_universe_error' });
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    cloudHydrationReady: false,
    universeSourceOrigin: 'none',
    cloudUniverseReadStatus: 'missing',
  });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.blockedReason, 'instrument_universe_missing');
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    cloudUniverseReadStatus: 'missing',
    universeSourceOrigin: 'bundled',
  });
  assert.deepEqual(result, { ready: true });
})();

(() => {
  const result = evaluateCanonicalInputReadiness({
    ...base(),
    universeSourceOrigin: 'cache-local',
  });
  assert.deepEqual(result, { ready: false, blockedReason: 'instrument_universe_missing' });
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    aurumIntegrationStatus: 'refreshing',
    aurumSnapshotAvailable: true,
  });
  assert.equal(result.status, 'should_run');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    aurumIntegrationStatus: 'refreshing',
    aurumSnapshotAvailable: false,
  });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.blockedReason, 'aurum_snapshot_missing');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    aurumIntegrationStatus: 'partial',
    aurumSnapshotAvailable: false,
  });
  assert.deepEqual(result, { status: 'blocked', blockedReason: 'aurum_snapshot_missing' });
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    aurumIntegrationStatus: 'unconfigured',
    aurumSnapshotAvailable: false,
  });
  assert.deepEqual(result, { status: 'blocked', blockedReason: 'aurum_snapshot_missing' });
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    aurumIntegrationStatus: 'error',
    aurumSnapshotAvailable: false,
  });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.blockedReason, 'aurum_snapshot_error');
})();

(() => {
  const result = evaluateSimulationRunGate({
    ...base(),
    aurumIntegrationStatus: 'error',
    aurumSnapshotAvailable: true,
  });
  assert.equal(result.status, 'should_run');
})();

console.log('simulationRunGate tests passed');
