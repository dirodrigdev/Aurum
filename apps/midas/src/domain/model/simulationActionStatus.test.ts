import assert from 'node:assert/strict';
import { buildSimulationInputSyncState } from './simulationActionStatus';

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

console.log('simulationActionStatus tests passed');
