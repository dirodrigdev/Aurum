import assert from 'node:assert/strict';
import { evaluateSimulationRunGate } from './simulationRunGate';

const base = () => ({
  isCanonicalUserSession: true,
  hasEffectiveInput: true,
  cloudHydrationReady: true,
  simulationConfigHydrationStatus: 'cloud' as const,
  aurumIntegrationStatus: 'available' as const,
  universeSourceOrigin: 'cache-local' as const,
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
    simResultAvailable: true,
    lastRenderedResultHash: 'hash-1',
  });
  assert.equal(result.status, 'completed');
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

console.log('simulationRunGate tests passed');
