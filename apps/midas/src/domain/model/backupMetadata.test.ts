import assert from 'node:assert/strict';
import {
  buildBackupMetadata,
  hasVerifiableTimestamp,
  selectBestBackupCandidate,
} from './backupMetadata';

const oldLocal = buildBackupMetadata({
  sourceMode: 'local_cache',
  economicDate: '2026-05-01T00:00:00.000Z',
  capturedAt: '2026-05-02T00:00:00.000Z',
  payloadHash: 'old',
});
const recentLocal = buildBackupMetadata({
  sourceMode: 'local_cache',
  economicDate: '2026-06-01T00:00:00.000Z',
  capturedAt: '2026-06-02T00:00:00.000Z',
  payloadHash: 'recent',
});
const bundled = buildBackupMetadata({
  sourceMode: 'bundled',
  economicDate: '2026-07-01T00:00:00.000Z',
  capturedAt: '2026-07-02T00:00:00.000Z',
  payloadHash: 'bundled',
});

assert.equal(hasVerifiableTimestamp(buildBackupMetadata({ sourceMode: 'local_cache' })), false);
assert.equal(hasVerifiableTimestamp(recentLocal), true);
assert.equal(selectBestBackupCandidate([{ value: 'missing', metadata: buildBackupMetadata({ sourceMode: 'local_cache' }) }]), null);

const selected = selectBestBackupCandidate([
  { value: 'old', metadata: oldLocal },
  { value: 'recent', metadata: recentLocal },
  { value: 'bundled', metadata: bundled },
]);
assert.equal(selected?.value, 'recent', 'local valid backup must win over bundled and older local data');
assert.equal(selected?.metadata.selectedReason, 'highest_source_and_economic_date');

const online = selectBestBackupCandidate([
  { value: 'recent', metadata: recentLocal },
  { value: 'online', metadata: buildBackupMetadata({
    sourceMode: 'online',
    economicDate: '2026-01-01T00:00:00.000Z',
    retrievedAt: '2026-07-03T00:00:00.000Z',
  }) },
]);
assert.equal(online?.value, 'online', 'online source must outrank backup source');

console.log('backupMetadata tests passed');
