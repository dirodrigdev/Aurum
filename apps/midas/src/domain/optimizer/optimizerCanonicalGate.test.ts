import assert from 'node:assert/strict';
import type { M8InputFingerprint } from '../model/m8InputFingerprint';
import { evaluateOptimizerCanonicalGate } from './optimizerCanonicalGate';

const baseFingerprint = (overrides: Partial<M8InputFingerprint> = {}): M8InputFingerprint => ({
  hash: 'fnv1a-input',
  effectiveEngineInputHash: 'fnv1a-input',
  diagnosticHash: 'fnv1a-diagnostic',
  hashIncludesDiagnostics: false,
  manualLocalAdjustmentsAffectEngine: false,
  normalizedInput: {},
  diagnosticInput: {
    replayTrace: {
      traceVersion: 1,
      canonicalInput: {
        label: 'Base',
        baseLabel: null,
        m8Input: {},
        simulationBaseMonth: '2026-04',
        effectiveCapitalInitialClp: 1,
        spendingPhases: { F1: 1, F2: 1, F3: 1, F4: 1 },
        portfolioMix: {},
        houseConfig: {},
        riskConfig: {
          riskCapitalClp: 0,
          riskCapitalPolicy: 'disabled',
          riskCapitalBtcDriver: null,
        },
        cutsConfig: {},
        bucketConfig: {},
        futureEvents: [],
      },
      sourceMetadata: {
        simulationActiveV1: {
          pathLogical: 'users/{uid}/midas_config/simulationActiveV1',
          source: 'cloud',
          savedAt: '2026-04-01T00:00:00.000Z',
          hash: 'config-hash',
          label: 'Base',
          baseLabel: null,
          readStatus: 'loaded',
          exists: true,
          missingFields: [],
        },
        instrumentUniverse: {
          source: 'cloud',
          sourceOrigin: 'firestore',
          weightsMode: 'instrument-universe',
          savedAt: '2026-04-01T00:00:00.000Z',
          hash: 'universe-hash',
          cloudReadStatus: 'loaded',
          detail: null,
        },
        aurumSnapshot: {
          source: 'cloud',
          month: '2026-04',
          label: 'Aurum',
          publishedAt: '2026-04-01T00:00:00.000Z',
          hash: 'snapshot-hash',
        },
        fieldSources: {},
        capitalDerivation: {},
      },
      readiness: {
        canonicalInputReady: true,
        state: 'ready',
        pendingSource: null,
        blockedReason: null,
        statusMessage: null,
        simulationRunStatus: 'completed',
        simulated: true,
        resultMetricsAvailable: true,
      },
      engineSettings: {
        years: 40,
        nPaths: 3000,
        seed: 42,
        simulationFrequency: 'monthly',
        useRealTerms: true,
        generatorType: 'student_t',
        generatorParams: { df: 7 },
        studentTdf: 7,
        bucketMonths: 36,
      },
      fingerprints: {
        effectiveEngineInputFingerprint: 'fnv1a-input',
        m8Fingerprint: 'fnv1a-input',
        diagnosticFingerprint: 'fnv1a-diagnostic',
        simulationConfigHash: 'config-hash',
        instrumentUniverseFingerprint: 'universe-hash',
        aurumSnapshotFingerprint: 'snapshot-hash',
      },
      sourcePolicy: {
        status: 'canonical_pure',
        label: 'Canónico puro',
        shortLabel: 'Canónico',
        isComparable: true,
        isPureCanonical: true,
        effectiveSourceSummary: 'Modelo Base cloud · Universe cloud · Foto vigente',
        photoStatus: 'current_snapshot',
        freshness: {
          observedAt: '2026-04-01T00:00:00.000Z',
          ageDays: 0,
          freshness: 'fresh',
          maxAcceptedAgeDays: 120,
          expired: false,
        },
        sources: [],
        warnings: [],
        decisionWarnings: [],
        technicalNotes: [],
        blockingReasons: [],
        forbiddenSourcesUsed: [],
      },
      warnings: [],
    },
  },
  sources: {
    aurumSnapshot: { source: 'cloud', hash: 'snapshot-hash' },
    instrumentUniverse: { source: 'cloud', hash: 'universe-hash' },
    simulationParams: { source: 'cloud', hash: 'config-hash' },
    spendingPhases: { source: 'cloud', hash: 'spending-hash' },
    fx: { source: 'cloud', hash: 'fx-hash' },
  },
  warnings: [],
  createdAt: '2026-04-01T00:00:00.000Z',
  ...overrides,
});

{
  const result = evaluateOptimizerCanonicalGate({
    canonicalInputReady: false,
    canonicalInputBlockedReason: 'config_missing',
    m8InputFingerprint: baseFingerprint(),
  });
  assert.equal(result.ready, false);
  if (!result.ready) assert.equal(result.reason, 'canonical_input_blocked');
}

{
  const result = evaluateOptimizerCanonicalGate({
    canonicalInputReady: true,
    canonicalInputBlockedReason: null,
    m8InputFingerprint: null,
  });
  assert.equal(result.ready, false);
  if (!result.ready) assert.equal(result.reason, 'fingerprint_missing');
}

{
  const fingerprint = baseFingerprint({
    diagnosticInput: {} as M8InputFingerprint['diagnosticInput'],
  });
  const result = evaluateOptimizerCanonicalGate({
    canonicalInputReady: true,
    canonicalInputBlockedReason: null,
    m8InputFingerprint: fingerprint,
  });
  assert.equal(result.ready, false);
  if (!result.ready) assert.equal(result.reason, 'replay_trace_missing');
}

{
  const fingerprint = baseFingerprint();
  fingerprint.diagnosticInput.replayTrace.readiness = {
    ...fingerprint.diagnosticInput.replayTrace.readiness,
    canonicalInputReady: false,
    state: 'blocked',
    blockedReason: 'config_missing',
    pendingSource: 'config cloud',
  };
  const result = evaluateOptimizerCanonicalGate({
    canonicalInputReady: true,
    canonicalInputBlockedReason: null,
    m8InputFingerprint: fingerprint,
  });
  assert.equal(result.ready, false);
  if (!result.ready) assert.equal(result.reason, 'replay_trace_blocked');
}

{
  const result = evaluateOptimizerCanonicalGate({
    canonicalInputReady: true,
    canonicalInputBlockedReason: null,
    m8InputFingerprint: baseFingerprint({
      warnings: ['Config cloud no existe: usando fallback local no comparable cross-device.'],
    }),
  });
  assert.equal(result.ready, false);
  if (!result.ready) assert.equal(result.reason, 'non_comparable_warning');
}

{
  const result = evaluateOptimizerCanonicalGate({
    canonicalInputReady: true,
    canonicalInputBlockedReason: null,
    m8InputFingerprint: baseFingerprint(),
  });
  assert.equal(result.ready, true);
}

console.log('optimizerCanonicalGate tests passed');
