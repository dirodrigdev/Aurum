import assert from 'node:assert/strict';
import { buildSimulationInputSyncState, buildSimulationVisualStatus } from './simulationActionStatus';

const current = buildSimulationInputSyncState({
  visibleInputFingerprint: 'fnv1a-current',
  resultFingerprint: 'fnv1a-current',
  lastEvaluatedInputFingerprint: 'fnv1a-current',
});
assert.equal(current.status, 'current');
assert.equal(current.isResultCurrent, true);

const stale = buildSimulationInputSyncState({
  visibleInputFingerprint: 'fnv1a-visible',
  resultFingerprint: 'fnv1a-old',
  lastEvaluatedInputFingerprint: 'fnv1a-old',
});
assert.equal(stale.status, 'stale');
assert.equal(stale.isResultCurrent, false);

const missing = buildSimulationInputSyncState({
  visibleInputFingerprint: 'fnv1a-visible',
  resultFingerprint: null,
  lastEvaluatedInputFingerprint: null,
});
assert.equal(missing.status, 'missing_result');
assert.equal(missing.isResultCurrent, false);

const base = buildSimulationVisualStatus({
  inputSyncStatus: 'current',
  hasVisibleScenarioChanges: false,
  hasBlockingError: false,
});
assert.equal(base.status, 'base');
assert.equal(base.label, 'Base');

const scenario = buildSimulationVisualStatus({
  inputSyncStatus: 'current',
  hasVisibleScenarioChanges: true,
  hasBlockingError: false,
});
assert.equal(scenario.status, 'scenario');
assert.equal(scenario.label, 'Escenario');

const pending = buildSimulationVisualStatus({
  inputSyncStatus: 'stale',
  hasVisibleScenarioChanges: true,
  hasBlockingError: false,
});
assert.equal(pending.status, 'pending');
assert.equal(pending.label, 'Pendiente');

const error = buildSimulationVisualStatus({
  inputSyncStatus: 'current',
  hasVisibleScenarioChanges: true,
  hasBlockingError: true,
});
assert.equal(error.status, 'error');
assert.equal(error.label, 'Error');

console.log('simulationActionStatus tests passed');
