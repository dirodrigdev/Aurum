import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import { buildM8InputFingerprint, type M8InputFingerprint } from '../model/m8InputFingerprint';
import { buildMidasEvaluation } from '../model/midasEvaluation';
import { buildResultConfidence } from '../model/resultConfidence';
import { buildSimulationResultDiagnostics } from '../model/simulationResultDigest';
import type { ModelParameters, SimulationResults } from '../model/types';
import { resolveCapital } from './capitalResolver';
import { runM8, type M8RuntimeResult } from './engineM8';
import { fromM8Output, toM8Input } from './m8Adapter';
import type { M8Input } from './m8.types';

// This is a controlled fiduciary fixture, not the production 91.6% case.
// Production golden requires exporting the applied M8 input payload from Simulacion:
// 1. run the canonical production simulation;
// 2. copy "input M8 aplicado";
// 3. save that JSON as a fixture;
// 4. pin the expected fingerprint and core metrics with explicit tolerances.

const FIXED_NOW_MS = Date.parse('2026-06-29T12:00:00.000Z');
const EXPECTED_EFFECTIVE_HASH = 'fnv1a-3563c1a7';
const EXPECTED_DIAGNOSTIC_HASH = 'fnv1a-5a0738f7';
const EXPECTED_RESULT_DIGEST = 'c38b5dca53b5305be78d32a879b5543b774db8d2918485545efe8bd6cc5137da';

const EXPECTED_METRICS = {
  success40: 0.70703125,
  probRuin40: 0.29296875,
  probRuin20: 0.0546875,
  houseSalePct: 0,
  terminalWealthRatio: 1.210179901868155,
  qasrStrict: 0.6980182649611179,
  csr85_4: 0.58203125,
  qualitySurvivalRate: 0.11328125,
} as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withFixedNow<T>(run: () => T): T {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW_MS;
  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

function assertClose(actual: number | null | undefined, expected: number, label: string) {
  assert.equal(typeof actual, 'number', `${label} must be numeric`);
  const numericActual = Number(actual);
  assert.ok(Number.isFinite(numericActual), `${label} must be finite`);
  assert.ok(Math.abs(numericActual - expected) <= 1e-12, `${label}: expected ${expected}, got ${numericActual}`);
}

function buildControlledCanonicalParams(): ModelParameters {
  const params = clone(DEFAULT_PARAMETERS);
  params.label = 'MIDAS fiduciary controlled fixture v1';
  params.simulation = {
    ...params.simulation,
    nSim: 256,
    seed: 424242,
    horizonMonths: 480,
    useHistoricalData: false,
  };
  params.generatorType = 'gaussian_iid';
  params.simulationBaseMonth = '2026-06';
  params.cashflowEvents = [];
  params.futureCapitalEvents = [];
  params.activeScenario = 'base';
  return params;
}

function buildEngineInput(params: ModelParameters): M8Input {
  const capitalResolution = resolveCapital({ params });
  return toM8Input(params, capitalResolution);
}

function buildCanonicalFingerprint(
  params: ModelParameters,
  effectiveEngineInput: M8Input,
  overrides: Partial<Parameters<typeof buildM8InputFingerprint>[0]> = {},
): M8InputFingerprint {
  return withFixedNow(() => buildM8InputFingerprint({
    params,
    effectiveEngineInput,
    riskCapitalEnabled: false,
    riskCapitalEffective: false,
    weightsSourceMode: 'instrument-universe',
    universeSourceOrigin: 'firestore',
    aurumSnapshotMonth: '2026-06',
    aurumSnapshotLabel: 'Controlled fiduciary fixture snapshot',
    aurumSnapshotPublishedAt: '2026-06-28T12:00:00.000Z',
    aurumSnapshotSignature: 'aurum-controlled-fixture-snapshot-v1',
    simulationConfigSource: 'cloud',
    simulationConfigSavedAt: '2026-06-28T12:00:00.000Z',
    simulationConfigHash: 'simulation-active-controlled-fixture-v1',
    simulationConfigDiagnostics: {
      path: 'users/fixture-user/midas_config/simulationActiveV1',
      readStatus: 'loaded',
      errorMessage: null,
      exists: true,
      activeHash: 'simulation-active-controlled-fixture-v1',
      activeSavedAt: '2026-06-28T12:00:00.000Z',
      activeParamsJsonExists: true,
      activeSpendingPhasesExists: true,
      activeSeedExists: true,
      activeNSimExists: true,
      activeBucketMonthsExists: true,
      missingFields: [],
      legacyGlobalReadStatus: null,
      legacyGlobalErrorMessage: null,
      legacyGlobalExists: false,
      legacyGlobalHash: null,
      ...(overrides.simulationConfigDiagnostics ?? {}),
    } as NonNullable<Parameters<typeof buildM8InputFingerprint>[0]['simulationConfigDiagnostics']>,
    runtimeDiagnostics: {
      canonicalInputReady: true,
      canonicalInputPendingSource: null,
      canonicalInputBlockedReason: null,
      canonicalInputStatusMessage: null,
      simulationRunStatus: 'completed',
      resultMetricsAvailable: true,
      lastRunInputHash: 'pending',
      lastRenderedResultHash: 'pending',
      resultSource: 'simResult',
      staleResult: false,
      heroMetricsSource: 'simResult',
    },
    instrumentUniverseDiagnostics: {
      cloudReadStatus: 'loaded',
      localCacheAvailable: false,
      fallbackReason: null,
      ...(overrides.instrumentUniverseDiagnostics ?? {}),
    },
    fieldSources: {
      simulationParams: 'cloud',
      instrumentUniverse: 'cloud',
      aurumSnapshot: 'cloud',
    },
    capitalDerivationDiagnostics: {
      source: 'aurum_snapshot_cloud',
      manualAdjustmentsCount: 0,
      manualAdjustmentsSource: null,
      manualLocalAdjustmentsAffectEngine: false,
      ...(overrides.capitalDerivationDiagnostics ?? {}),
    },
    instrumentUniverseSavedAt: '2026-06-28T12:00:00.000Z',
    instrumentUniverseHash: 'instrument-universe-controlled-fixture-v1',
    hydratedCloudSources: true,
    ...overrides,
  }));
}

function buildConfidence(params: ModelParameters, fingerprint: M8InputFingerprint, result: SimulationResults) {
  const diagnostics = buildSimulationResultDiagnostics({
    result,
    resultInputHash: fingerprint.effectiveEngineInputHash,
    effectiveEngineInputHash: fingerprint.effectiveEngineInputHash,
    resultSeed: params.simulation.seed ?? null,
    expectedSeed: params.simulation.seed ?? null,
    resultNSim: params.simulation.nSim ?? null,
    expectedNSim: params.simulation.nSim ?? null,
    completedAt: '2026-06-29T12:00:02.000Z',
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: fingerprint.effectiveEngineInputHash,
    lastRenderedResultHash: fingerprint.effectiveEngineInputHash,
  });
  const confidence = buildResultConfidence({
    criticalSources: {
      aurumSnapshot: 'canonical',
      simulationConfig: 'canonical',
      instrumentUniverse: 'canonical',
      fx: 'canonical',
      capitalAdjustments: 'canonical',
      runResult: 'canonical',
      sandbox: 'canonical',
    },
    run: {
      resultDigest: diagnostics.resultDigest,
      isFinalForCurrentInput: diagnostics.isFinalForCurrentInput,
      resultInputHash: diagnostics.resultInputHash,
      effectiveEngineInputHash: fingerprint.effectiveEngineInputHash,
      resultSeed: diagnostics.resultSeed,
      expectedSeed: params.simulation.seed ?? null,
      resultNSim: diagnostics.resultNSim,
      expectedNSim: params.simulation.nSim ?? null,
      simulationRunStatus: 'completed',
      resultMetricsAvailable: true,
      lastRunInputHash: fingerprint.effectiveEngineInputHash,
      lastRenderedResultHash: fingerprint.effectiveEngineInputHash,
    },
  });
  return { diagnostics, confidence };
}

function assertDeterministicOutput(first: M8RuntimeResult, second: M8RuntimeResult) {
  assert.deepEqual(second, first, 'same controlled M8 input must produce the same runtime output');
}

const params = buildControlledCanonicalParams();
const m8Input = buildEngineInput(params);
const fingerprint = buildCanonicalFingerprint(params, m8Input);
const firstOutput = runM8(m8Input);
const secondOutput = runM8(m8Input);
const result = fromM8Output(firstOutput, params);
const { diagnostics, confidence } = buildConfidence(params, fingerprint, result);
const sourcePolicy = fingerprint.diagnosticInput.replayTrace.sourcePolicy;
const evaluation = buildMidasEvaluation({
  qualityOfLifeMetrics: result.qualityOfLifeMetrics ?? null,
  inputAuditable: true,
  canUseForDecision: confidence.canUseForDecision && sourcePolicy.isComparable,
  decisionStatus: confidence.status,
  comparabilityWarnings: [
    ...sourcePolicy.warnings,
    ...sourcePolicy.forbiddenSourcesUsed,
  ],
});

assert.equal(fingerprint.effectiveEngineInputHash, EXPECTED_EFFECTIVE_HASH);
assert.equal(fingerprint.diagnosticHash, EXPECTED_DIAGNOSTIC_HASH);
assert.equal(fingerprint.diagnosticInput.replayTrace.fingerprints.diagnosticFingerprint, EXPECTED_DIAGNOSTIC_HASH);
assert.equal((fingerprint.diagnosticInput.sourcePolicy as { status: string }).status, 'canonical_pure');
assert.equal(sourcePolicy.status, 'canonical_pure');
assert.equal(sourcePolicy.isComparable, true);
assert.deepEqual(sourcePolicy.forbiddenSourcesUsed, []);
assert.ok(JSON.stringify(fingerprint.diagnosticInput.replayTrace).includes('sourcePolicy'));
assert.ok(!JSON.stringify(fingerprint.diagnosticInput.replayTrace).includes('localStorage'));
assert.ok(!JSON.stringify(fingerprint.diagnosticInput.replayTrace).includes('legacy'));
assert.ok(!JSON.stringify(fingerprint.diagnosticInput.replayTrace).includes('fallback efectivo'));

assertDeterministicOutput(firstOutput, secondOutput);
assert.equal(diagnostics.resultDigest, EXPECTED_RESULT_DIGEST);
assert.equal(diagnostics.isFinalForCurrentInput, true);
assert.equal(confidence.status, 'canonical');
assert.equal(confidence.canUseForDecision, true);
assert.equal(evaluation.isComparable, true);

assertClose(result.success40, EXPECTED_METRICS.success40, 'success40');
assertClose(result.probRuin40, EXPECTED_METRICS.probRuin40, 'probRuin40');
assertClose(result.probRuin20, EXPECTED_METRICS.probRuin20, 'probRuin20');
assertClose(result.houseSalePct, EXPECTED_METRICS.houseSalePct, 'houseSalePct');
assertClose(result.qualityOfLifeMetrics?.terminalWealthRatio, EXPECTED_METRICS.terminalWealthRatio, 'terminalWealthRatio');
assertClose(result.qualityOfLifeMetrics?.qasrStrict, EXPECTED_METRICS.qasrStrict, 'qasrStrict');
assertClose(result.qualityOfLifeMetrics?.csr85_4, EXPECTED_METRICS.csr85_4, 'csr85_4');
assertClose(result.qualityOfLifeMetrics?.qualitySurvivalRate, EXPECTED_METRICS.qualitySurvivalRate, 'qualitySurvivalRate');

const localUniverseFingerprint = buildCanonicalFingerprint(params, m8Input, {
  universeSourceOrigin: 'cache-local',
  instrumentUniverseHash: 'instrument-universe-local-cache-v1',
  instrumentUniverseDiagnostics: {
    cloudReadStatus: 'loaded',
    localCacheAvailable: true,
    fallbackReason: null,
  },
});
const localUniversePolicy = localUniverseFingerprint.diagnosticInput.replayTrace.sourcePolicy;
const localUniverseEvaluation = buildMidasEvaluation({
  qualityOfLifeMetrics: result.qualityOfLifeMetrics ?? null,
  inputAuditable: true,
  canUseForDecision: confidence.canUseForDecision && localUniversePolicy.isComparable,
  decisionStatus: confidence.status,
  comparabilityWarnings: [
    ...localUniversePolicy.warnings,
    ...localUniversePolicy.forbiddenSourcesUsed,
  ],
});

assert.equal(localUniversePolicy.status, 'not_comparable');
assert.equal(localUniversePolicy.isComparable, false);
assert.ok(localUniversePolicy.forbiddenSourcesUsed.includes('instrument_universe_local_cache_effective'));
assert.equal(localUniverseEvaluation.isComparable, false);
assert.equal(localUniverseEvaluation.label, 'No comparable');

const fallbackConfigFingerprint = buildCanonicalFingerprint(params, m8Input, {
  simulationConfigSource: 'fallback',
  simulationConfigHash: 'simulation-config-fallback-fixture-v1',
});
const fallbackPolicy = fallbackConfigFingerprint.diagnosticInput.replayTrace.sourcePolicy;
assert.equal(fallbackPolicy.status, 'not_comparable');
assert.ok(fallbackPolicy.forbiddenSourcesUsed.includes('simulation_config_fallback_effective'));

console.log('goldenCanonicalRun tests passed');
