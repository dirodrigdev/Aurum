import assert from 'node:assert/strict';
import { buildSourceFreshnessPolicy } from './sourceFreshnessPolicy';

const NOW = Date.parse('2026-06-29T12:00:00.000Z');

const base = () => ({
  nowMs: NOW,
  canonicalInputReady: true,
  blockedReason: null,
  hasReplayTrace: true,
  m8Fingerprint: 'm8-123',
  diagnosticFingerprint: 'diag-123',
  simulationActiveV1: {
    source: 'cloud' as const,
    savedAt: '2026-06-28T12:00:00.000Z',
    hash: 'cfg-1',
    readStatus: 'loaded',
    exists: true,
    missingFields: [],
    legacyGlobalReadStatus: null,
    legacyGlobalExists: null,
  },
  instrumentUniverse: {
    source: 'cloud' as const,
    sourceOrigin: 'firestore' as const,
    weightsMode: 'instrument-universe',
    savedAt: '2026-06-28T12:00:00.000Z',
    hash: 'uni-1',
    cloudReadStatus: 'loaded',
    localCacheAvailable: false,
  },
  aurumSnapshot: {
    source: 'cloud' as const,
    month: '2026-06',
    label: '2026-06 cierre',
    publishedAt: '2026-06-27T12:00:00.000Z',
    hash: 'snap-1',
  },
  localDiagnostics: {
    persistedBaseExists: false,
    localReadOnlyFallbackActive: false,
  },
  capitalDerivation: {
    manualAdjustmentsCount: 0,
    manualAdjustmentsSource: null,
    manualLocalAdjustmentsAffectEngine: false,
  },
  warnings: [],
});

{
  const policy = buildSourceFreshnessPolicy(base());
  assert.equal(policy.status, 'canonical_pure');
  assert.equal(policy.isComparable, true);
  assert.equal(policy.photoStatus, 'current_snapshot');
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    localDiagnostics: { persistedBaseExists: true, localReadOnlyFallbackActive: false },
  });
  assert.equal(policy.status, 'canonical_with_warnings');
  assert.ok(policy.warnings.includes('local_base_draft_present_not_used'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    instrumentUniverse: { ...base().instrumentUniverse, localCacheAvailable: true },
  });
  assert.equal(policy.status, 'canonical_with_warnings');
  assert.ok(policy.warnings.includes('instrument_universe_local_cache_present_not_used'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    simulationActiveV1: { ...base().simulationActiveV1, source: 'local_cache' },
  });
  assert.equal(policy.status, 'using_recent_fallback');
  assert.equal(policy.isComparable, true);
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    instrumentUniverse: {
      ...base().instrumentUniverse,
      source: 'local_cache',
      sourceOrigin: 'cache-local',
    },
  });
  assert.equal(policy.status, 'not_comparable');
  assert.ok(policy.forbiddenSourcesUsed.includes('instrument_universe_local_cache_effective'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    simulationActiveV1: {
      ...base().simulationActiveV1,
      legacyGlobalExists: true,
      legacyGlobalReadStatus: 'loaded',
    },
  });
  assert.equal(policy.status, 'not_comparable');
  assert.ok(policy.forbiddenSourcesUsed.includes('legacy_global_config_detected'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    capitalDerivation: {
      manualAdjustmentsCount: 2,
      manualAdjustmentsSource: 'localStorage:midas:manualCapitalAdjustments',
      manualLocalAdjustmentsAffectEngine: false,
    },
  });
  assert.equal(policy.status, 'canonical_with_warnings');
  assert.ok(policy.warnings.includes('manual_local_adjustments_stripped'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    capitalDerivation: {
      manualAdjustmentsCount: 1,
      manualAdjustmentsSource: 'localStorage:midas:manualCapitalAdjustments',
      manualLocalAdjustmentsAffectEngine: true,
    },
  });
  assert.equal(policy.status, 'not_comparable');
  assert.ok(policy.forbiddenSourcesUsed.includes('manual_local_adjustments_effective'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    aurumSnapshot: { ...base().aurumSnapshot, publishedAt: '2026-01-01T12:00:00.000Z' },
  });
  assert.equal(policy.photoStatus, 'stale_snapshot');
  assert.equal(policy.status, 'not_comparable');
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    hasReplayTrace: false,
  });
  assert.equal(policy.status, 'not_comparable');
  assert.ok(policy.blockingReasons.includes('missing_replay_trace'));
}

{
  const policy = buildSourceFreshnessPolicy({
    ...base(),
    m8Fingerprint: null,
  });
  assert.equal(policy.status, 'not_comparable');
  assert.ok(policy.blockingReasons.includes('missing_m8_fingerprint'));
}

console.log('sourceFreshnessPolicy tests passed');
