import assert from 'node:assert/strict';
import { buildSimulationActionStatus } from './simulationActionStatus';
import type { M8InputFingerprint } from './m8InputFingerprint';

const baseFingerprint: M8InputFingerprint = {
  hash: 'abc123',
  effectiveEngineInputHash: 'abc123',
  diagnosticHash: 'diag123',
  hashIncludesDiagnostics: false,
  manualLocalAdjustmentsAffectEngine: false,
  normalizedInput: {},
  diagnosticInput: {
    replayTrace: {
      traceVersion: 1,
      canonicalInput: {
        label: null,
        baseLabel: null,
        m8Input: {},
        simulationBaseMonth: null,
        effectiveCapitalInitialClp: null,
        spendingPhases: { F1: null, F2: null, F3: null, F4: null },
        portfolioMix: null,
        houseConfig: null,
        riskConfig: {
          riskCapitalClp: null,
          riskCapitalPolicy: null,
          riskCapitalBtcDriver: null,
        },
        cutsConfig: null,
        bucketConfig: null,
        futureEvents: [],
      },
      sourceMetadata: {
        simulationActiveV1: {
          pathLogical: null,
          source: 'cloud',
          savedAt: null,
          hash: null,
          label: null,
          baseLabel: null,
          readStatus: null,
          exists: null,
          missingFields: [],
        },
        instrumentUniverse: {
          source: 'cloud',
          sourceOrigin: 'firestore',
          weightsMode: 'instrument-universe',
          savedAt: null,
          hash: null,
          cloudReadStatus: null,
          detail: null,
        },
        aurumSnapshot: {
          source: 'cloud',
          month: null,
          label: null,
          publishedAt: null,
          hash: null,
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
        simulationRunStatus: null,
        simulated: false,
        resultMetricsAvailable: false,
      },
      engineSettings: {
        years: null,
        nPaths: null,
        seed: null,
        simulationFrequency: null,
        useRealTerms: null,
        generatorType: null,
        generatorParams: null,
        studentTdf: null,
        bucketMonths: null,
      },
      fingerprints: {
        effectiveEngineInputFingerprint: 'abc123',
        m8Fingerprint: 'abc123',
        diagnosticFingerprint: 'diag123',
        simulationConfigHash: null,
        instrumentUniverseFingerprint: null,
        aurumSnapshotFingerprint: null,
      },
      warnings: [],
    },
  },
  sources: {
    aurumSnapshot: { source: 'cloud' },
    instrumentUniverse: { source: 'cloud' },
    simulationParams: { source: 'cloud' },
    spendingPhases: { source: 'cloud' },
    fx: { source: 'cloud' },
  },
  warnings: [],
  createdAt: new Date().toISOString(),
};

(() => {
  const status = buildSimulationActionStatus({
    authResolved: true,
    isCanonicalUserSession: true,
    authErrorMessage: null,
    cloudHydrationReady: true,
    simulationConfigSource: 'cloud',
    universeSourceOrigin: 'firestore',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'ok');
  assert.equal(status.canUseForDecision, true);
})();

(() => {
  const status = buildSimulationActionStatus({
    authResolved: true,
    isCanonicalUserSession: true,
    authErrorMessage: null,
    cloudHydrationReady: false,
    simulationConfigSource: 'local_cache',
    universeSourceOrigin: 'cache-local',
    aurumIntegrationStatus: 'refreshing',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: { ...baseFingerprint, warnings: ['Hydratación cloud incompleta'] },
  });
  assert.equal(status.level, 'provisional');
})();

(() => {
  const status = buildSimulationActionStatus({
    authResolved: true,
    isCanonicalUserSession: true,
    authErrorMessage: null,
    cloudHydrationReady: true,
    simulationConfigSource: 'cloud',
    universeSourceOrigin: 'none',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: false,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'blocked');
  assert.ok(status.actionItems.length <= 3);
})();

(() => {
  const status = buildSimulationActionStatus({
    authResolved: true,
    isCanonicalUserSession: true,
    authErrorMessage: null,
    cloudHydrationReady: true,
    simulationConfigSource: 'local_cache',
    universeSourceOrigin: 'cache-local',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'review');
})();

(() => {
  const status = buildSimulationActionStatus({
    authResolved: true,
    isCanonicalUserSession: true,
    authErrorMessage: null,
    cloudHydrationReady: true,
    simulationConfigSource: 'cloud',
    universeSourceOrigin: 'bundled',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: {
      ...baseFingerprint,
      sources: {
        ...baseFingerprint.sources,
        instrumentUniverse: { source: 'bundled' },
      },
      warnings: ['Instrument Universe usando versión bundled canónica; válido cross-browser mientras cloud no exista.'],
    },
  });
  assert.equal(status.level, 'ok');
})();

(() => {
  const status = buildSimulationActionStatus({
    authResolved: true,
    isCanonicalUserSession: false,
    authErrorMessage: null,
    cloudHydrationReady: false,
    simulationConfigSource: 'fallback',
    universeSourceOrigin: 'none',
    aurumIntegrationStatus: 'loading',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'blocked');
  assert.equal(status.primaryActionLabel, 'Entrar con Google');
})();

console.log('simulationActionStatus tests passed');
