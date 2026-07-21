import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import { buildMidasEvaluation } from '../model/midasEvaluation';
import { buildResultConfidence } from '../model/resultConfidence';
import { buildSimulationResultDiagnostics } from '../model/simulationResultDigest';
import { buildSourceFreshnessPolicy } from '../model/sourceFreshnessPolicy';
import type { ModelParameters } from '../model/types';
import { runM8, type M8RuntimeResult } from './engineM8';
import { fromM8Output } from './m8Adapter';
import { buildQualityOfLifeMetricsFromPathDiagnostics } from './qualityOfLifeMetrics';
import type { M8Input } from './m8.types';

type ProductionGoldenFixture = {
  createdAt: string;
  fingerprint: string;
  effectiveEngineInputHash: string;
  diagnosticHash: string;
  normalizedInput: M8Input;
  warnings: string[];
  sourcePolicy: {
    status: string;
    isComparable: boolean;
    forbiddenSourcesUsed: string[];
    blockingReasons: string[];
    sources: Array<{
      id: string;
      source: string;
      role: string;
      usedForRun: boolean;
      savedAt: string | null;
      warning: string | null;
      freshness: {
        expired: boolean;
      };
    }>;
  };
  replayTrace: {
    canonicalInput: {
      effectiveCapitalInitialClp: number;
    };
    sourceMetadata: {
      simulationActiveV1: {
        source: string;
      };
      instrumentUniverse: {
        source: string;
        sourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
        weightsMode: string;
        savedAt: string | null;
        hash: string | null;
        cloudReadStatus: string | null;
      };
      aurumSnapshot: {
        source: string;
        month: string | null;
        label: string | null;
        publishedAt: string | null;
        hash: string | null;
      };
      capitalDerivation: {
        manualAdjustmentsCount: number;
        manualAdjustmentsSource: string | null;
        manualLocalAdjustmentsAffectEngine: boolean;
      };
    };
    readiness: {
      canonicalInputReady: boolean;
      blockedReason: string | null;
    };
    fingerprints: {
      effectiveEngineInputFingerprint: string;
      m8Fingerprint: string | null;
      diagnosticFingerprint: string | null;
      simulationConfigHash: string | null;
      instrumentUniverseFingerprint: string | null;
      aurumSnapshotFingerprint: string | null;
    };
  };
  simulationResultDiagnostics: {
    resultDigest: string;
    completedAt: string;
  };
  qualityOfLifeMetrics: {
    warnings: string[];
    ruinedPathCount: number;
    csr85_4: number;
    qasrStrict: number;
    averageEffectiveSpendingRatio: number;
    monthsBelow85: number;
    maxConsecutiveMonthsBelow85: number;
    qualitySurvivalRate: number;
    severeCutYearsMean: number;
    houseSaleYearMedian: number;
    terminalWealthP25: number;
    terminalWealthP50: number;
    terminalWealthRatio: number;
  };
  midasEvaluation: {
    label: string;
    cappedScore: number;
    isComparable: boolean;
    confidenceBand: string;
    warnings: string[];
  };
  resultConfidence: {
    status: string;
    canUseForDecision: boolean;
    isCanonicalForDecision: boolean;
    criticalSources: Record<string, string>;
  };
};

const FIXTURE_PATH = new URL('./__fixtures__/productionGoldenRun.v1.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ProductionGoldenFixture;

const EXPECTED_FINGERPRINT = 'fnv1a-959dded4';
const EXPECTED_RESULT_DIGEST = 'b0c9e8da6ae590f0bcd327c3b2b5d202d7d52cf118a98f829bd09007d292baba';

function sourceEntry(id: string) {
  return fixture.sourcePolicy.sources.find((entry) => entry.id === id) ?? null;
}

function assertClose(actual: number | null | undefined, expected: number, tolerance: number, label: string) {
  assert.equal(typeof actual, 'number', `${label} must be numeric`);
  const numericActual = Number(actual);
  assert.ok(Number.isFinite(numericActual), `${label} must be finite`);
  assert.ok(
    Math.abs(numericActual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${numericActual}, tolerance ${tolerance}`,
  );
}

function buildStubParams(): ModelParameters {
  const params = JSON.parse(JSON.stringify(DEFAULT_PARAMETERS)) as ModelParameters;
  params.capitalInitial = fixture.replayTrace.canonicalInput.effectiveCapitalInitialClp;
  params.capitalSource = fixture.normalizedInput.capital_source;
  params.simulation = {
    ...params.simulation,
    nSim: fixture.normalizedInput.n_paths,
    seed: fixture.normalizedInput.seed,
    horizonMonths: fixture.normalizedInput.years * 12,
  };
  return params;
}

function buildCurrentSourcePolicy() {
  return buildSourceFreshnessPolicy({
    nowMs: Date.parse(fixture.createdAt),
    canonicalInputReady: fixture.replayTrace.readiness.canonicalInputReady,
    blockedReason: fixture.replayTrace.readiness.blockedReason,
    hasReplayTrace: true,
    m8Fingerprint: fixture.replayTrace.fingerprints.m8Fingerprint,
    diagnosticFingerprint: fixture.replayTrace.fingerprints.diagnosticFingerprint,
    simulationActiveV1: {
      source: fixture.replayTrace.sourceMetadata.simulationActiveV1.source as 'cloud' | 'local_cache' | 'fallback',
      savedAt: sourceEntry('simulationActiveV1')?.savedAt ?? null,
      hash: fixture.replayTrace.fingerprints.simulationConfigHash,
      readStatus: 'loaded',
      exists: true,
      missingFields: [],
      legacyGlobalReadStatus: null,
      legacyGlobalExists: null,
    },
    instrumentUniverse: {
      source: fixture.replayTrace.sourceMetadata.instrumentUniverse.source as 'cloud' | 'bundled' | 'local_cache' | 'none' | 'fallback',
      sourceOrigin: fixture.replayTrace.sourceMetadata.instrumentUniverse.sourceOrigin,
      weightsMode: fixture.replayTrace.sourceMetadata.instrumentUniverse.weightsMode,
      savedAt: fixture.replayTrace.sourceMetadata.instrumentUniverse.savedAt,
      hash: fixture.replayTrace.sourceMetadata.instrumentUniverse.hash,
      cloudReadStatus: fixture.replayTrace.sourceMetadata.instrumentUniverse.cloudReadStatus,
      localCacheAvailable: fixture.sourcePolicy.sources.some((entry) => entry.id === 'instrument_universe_local_cache'),
    },
    aurumSnapshot: {
      source: fixture.replayTrace.sourceMetadata.aurumSnapshot.source as 'cloud' | 'fallback',
      month: fixture.replayTrace.sourceMetadata.aurumSnapshot.month,
      label: fixture.replayTrace.sourceMetadata.aurumSnapshot.label,
      publishedAt: fixture.replayTrace.sourceMetadata.aurumSnapshot.publishedAt,
      hash: fixture.replayTrace.sourceMetadata.aurumSnapshot.hash,
    },
    localDiagnostics: {
      persistedBaseExists: fixture.sourcePolicy.sources.some((entry) => entry.id === 'local_base_draft'),
      localReadOnlyFallbackActive: false,
    },
    capitalDerivation: {
      manualAdjustmentsCount: fixture.replayTrace.sourceMetadata.capitalDerivation.manualAdjustmentsCount,
      manualAdjustmentsSource: fixture.replayTrace.sourceMetadata.capitalDerivation.manualAdjustmentsSource,
      manualLocalAdjustmentsAffectEngine: fixture.replayTrace.sourceMetadata.capitalDerivation.manualLocalAdjustmentsAffectEngine,
    },
    warnings: fixture.warnings,
  });
}

function buildDerivedArtifacts(runtime: M8RuntimeResult) {
  const params = buildStubParams();
  const result = fromM8Output(runtime, params);
  const qualityOfLifeMetrics = buildQualityOfLifeMetricsFromPathDiagnostics(runtime.pathQualityDiagnostics, {
    initialSimulableCapitalClp: fixture.replayTrace.canonicalInput.effectiveCapitalInitialClp,
  });
  const simulationResultDiagnostics = buildSimulationResultDiagnostics({
    result,
    resultInputHash: fixture.effectiveEngineInputHash,
    effectiveEngineInputHash: fixture.effectiveEngineInputHash,
    resultSeed: fixture.normalizedInput.seed,
    expectedSeed: fixture.normalizedInput.seed,
    resultNSim: fixture.normalizedInput.n_paths,
    expectedNSim: fixture.normalizedInput.n_paths,
    completedAt: fixture.simulationResultDiagnostics.completedAt,
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: fixture.effectiveEngineInputHash,
    lastRenderedResultHash: fixture.effectiveEngineInputHash,
  });
  const resultConfidence = buildResultConfidence({
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
      resultDigest: simulationResultDiagnostics.resultDigest,
      isFinalForCurrentInput: simulationResultDiagnostics.isFinalForCurrentInput,
      resultInputHash: simulationResultDiagnostics.resultInputHash,
      effectiveEngineInputHash: fixture.effectiveEngineInputHash,
      resultSeed: simulationResultDiagnostics.resultSeed,
      expectedSeed: fixture.normalizedInput.seed,
      resultNSim: simulationResultDiagnostics.resultNSim,
      expectedNSim: fixture.normalizedInput.n_paths,
      simulationRunStatus: 'completed',
      resultMetricsAvailable: true,
      lastRunInputHash: fixture.effectiveEngineInputHash,
      lastRenderedResultHash: fixture.effectiveEngineInputHash,
    },
  });
  return { result, qualityOfLifeMetrics, simulationResultDiagnostics, resultConfidence };
}

assert.equal(fixture.normalizedInput.seed, 42);
assert.equal(fixture.normalizedInput.n_paths, 1000);
assert.equal(fixture.normalizedInput.years, 40);
assert.equal(fixture.fingerprint, EXPECTED_FINGERPRINT);
assert.equal(fixture.effectiveEngineInputHash, EXPECTED_FINGERPRINT);
assert.ok(typeof fixture.diagnosticHash === 'string' && fixture.diagnosticHash.length > 0);

assert.equal(fixture.sourcePolicy.status, 'canonical_with_warnings');
assert.equal(fixture.sourcePolicy.isComparable, true);
assert.deepEqual(fixture.sourcePolicy.forbiddenSourcesUsed, []);
assert.deepEqual(fixture.sourcePolicy.blockingReasons, []);

const simulationConfigSource = fixture.sourcePolicy.sources.find((entry) => entry.id === 'simulationActiveV1');
const instrumentUniverseSource = sourceEntry('instrumentUniverse');
const aurumSnapshotSource = sourceEntry('aurumSnapshot');
const localBaseDraft = sourceEntry('local_base_draft');
const localUniverseCache = sourceEntry('instrument_universe_local_cache');

assert.equal(simulationConfigSource?.source, 'cloud');
assert.equal(simulationConfigSource?.usedForRun, true);
assert.equal(instrumentUniverseSource?.source, 'cloud');
assert.equal(instrumentUniverseSource?.usedForRun, true);
assert.equal(aurumSnapshotSource?.source, 'cloud');
assert.equal(aurumSnapshotSource?.usedForRun, true);
assert.equal(localBaseDraft?.usedForRun, false);
assert.equal(localBaseDraft?.role, 'draft_only');
assert.equal(localUniverseCache?.usedForRun, false);
assert.equal(localUniverseCache?.role, 'display_cache');
assert.equal(instrumentUniverseSource?.freshness.expired, true);
assert.equal(instrumentUniverseSource?.warning, null);

const firstRuntime = runM8(fixture.normalizedInput);
const secondRuntime = runM8(fixture.normalizedInput);
assert.deepEqual(secondRuntime, firstRuntime, 'production normalizedInput must be deterministic');

const { result, qualityOfLifeMetrics, simulationResultDiagnostics, resultConfidence } = buildDerivedArtifacts(firstRuntime);

assertClose(result.success40, 0.91, 1e-12, 'success40');
assertClose(result.probRuin40, 0.09, 1e-12, 'probRuin40');
assert.equal(result.nRuin, 90);
assertClose(result.houseSalePct, 0.217, 1e-12, 'houseSalePct');
assertClose(result.saleYearMedian, 27, 1e-12, 'houseSaleYearMedian');
assertClose(qualityOfLifeMetrics.terminalWealthP25, 997341679.0395597, 1e-3, 'terminalWealthP25');
assertClose(qualityOfLifeMetrics.terminalWealthP50, 3357104872.753105, 1e-3, 'terminalWealthP50');
assertClose(qualityOfLifeMetrics.terminalWealthRatio, 2.1702750161339943, 1e-12, 'terminalWealthRatio');
assertClose(qualityOfLifeMetrics.monthsBelow85, 35.762, 1e-12, 'monthsBelow85');
assert.equal(qualityOfLifeMetrics.maxConsecutiveMonthsBelow85, 23);
assertClose(qualityOfLifeMetrics.qualitySurvivalRate, 0.153, 1e-12, 'qualitySurvivalRate');
assertClose(qualityOfLifeMetrics.csr85_4, 0.732, 1e-12, 'csr85_4');
assertClose(qualityOfLifeMetrics.qasrStrict, 0.898479199798155, 1e-12, 'qasrStrict');
assertClose(qualityOfLifeMetrics.averageEffectiveSpendingRatio, 0.9592675084884893, 1e-12, 'averageEffectiveSpendingRatio');
assertClose(qualityOfLifeMetrics.severeCutYearsMean, 2.980166666666666, 1e-12, 'severeCutYearsMean');

assert.equal(simulationResultDiagnostics.resultDigest, EXPECTED_RESULT_DIGEST);
assert.equal(fixture.simulationResultDiagnostics.resultDigest, EXPECTED_RESULT_DIGEST);

const currentSourcePolicy = buildCurrentSourcePolicy();
const currentInstrumentUniverseSource = currentSourcePolicy.sources.find((entry) => entry.id === 'instrumentUniverse');
assert.equal(currentSourcePolicy.status, 'canonical_pure');
assert.equal(currentSourcePolicy.isComparable, true);
assert.deepEqual(currentSourcePolicy.forbiddenSourcesUsed, []);
assert.deepEqual(currentSourcePolicy.blockingReasons, []);
assert.ok(!currentSourcePolicy.warnings.includes('instrument_universe_effective_source_expired'));
assert.equal(currentInstrumentUniverseSource?.freshness.maxAcceptedAgeDays, 60);
assert.equal(currentInstrumentUniverseSource?.freshness.expired, false);
assert.equal(currentInstrumentUniverseSource?.warning, null);
assert.ok(currentSourcePolicy.warnings.includes('instrument_universe_local_cache_present_not_used'));
assert.equal(currentSourcePolicy.decisionWarnings.length, 0);
assert.ok(currentSourcePolicy.technicalNotes.some((notice) => notice.code === 'local_base_draft_present_not_used'));
assert.ok(currentSourcePolicy.technicalNotes.some((notice) => notice.code === 'instrument_universe_local_cache_present_not_used'));

const currentMidasEvaluation = buildMidasEvaluation({
  qualityOfLifeMetrics,
  inputAuditable: true,
  canUseForDecision: resultConfidence.canUseForDecision && currentSourcePolicy.isComparable,
  decisionStatus: resultConfidence.status,
  comparabilityWarnings: [
    ...currentSourcePolicy.warnings,
    `source_policy:${currentSourcePolicy.status}`,
  ],
});

assert.equal(fixture.midasEvaluation.label, 'Frágil');
assert.equal(fixture.midasEvaluation.cappedScore, 51.9);
assert.equal(fixture.midasEvaluation.isComparable, true);
assert.equal(fixture.midasEvaluation.confidenceBand, 'low');
assert.ok(fixture.midasEvaluation.warnings.includes('observed_consumption_months_incomplete'));
assert.ok(fixture.midasEvaluation.warnings.includes('post_ruin_months_present'));
assert.ok(fixture.midasEvaluation.warnings.includes('source_policy:canonical_with_warnings'));
assert.equal(currentMidasEvaluation.label, 'Frágil');
assert.equal(currentMidasEvaluation.cappedScore, 51.9);
assert.equal(currentMidasEvaluation.isComparable, true);
assert.equal(currentMidasEvaluation.confidenceBand, 'low');

assert.equal(fixture.resultConfidence.status, 'canonical');
assert.equal(fixture.resultConfidence.canUseForDecision, true);
assert.equal(fixture.resultConfidence.isCanonicalForDecision, true);
assert.deepEqual(fixture.resultConfidence.criticalSources, {
  aurumSnapshot: 'canonical',
  simulationConfig: 'canonical',
  instrumentUniverse: 'canonical',
  fx: 'canonical',
  capitalAdjustments: 'canonical',
  runResult: 'canonical',
  sandbox: 'canonical',
});
assert.equal(resultConfidence.status, 'canonical');
assert.equal(resultConfidence.canUseForDecision, true);
assert.equal(resultConfidence.isCanonicalForDecision, true);

console.log('productionGoldenRun tests passed');
