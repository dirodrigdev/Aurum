import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildOptimizationPack,
  MAX_CANDIDATES_PER_SET,
  OPTIMIZATION_FORBIDDEN_VARIABLES,
  OPTIMIZATION_MENU,
  OPTIMIZATION_PACK_TYPE,
  TARGET_CANDIDATES_PER_SET,
} from './optimizationPack';
import type { M8InputFingerprint } from '../model/m8InputFingerprint';
import { buildResultConfidence } from '../model/resultConfidence';
import { buildSimulationResultDiagnostics } from '../model/simulationResultDigest';
import { buildSourceFreshnessPolicy } from '../model/sourceFreshnessPolicy';
import type { SimulationResults } from '../model/types';

const fixture = JSON.parse(
  readFileSync(new URL('../simulation/__fixtures__/productionGoldenRun.v1.json', import.meta.url), 'utf8'),
) as Record<string, any>;

function buildFingerprint(): M8InputFingerprint {
  const sourcePolicy = buildSourceFreshnessPolicy({
    nowMs: Date.parse(fixture.createdAt),
    canonicalInputReady: true,
    blockedReason: null,
    hasReplayTrace: true,
    m8Fingerprint: fixture.fingerprint,
    diagnosticFingerprint: fixture.diagnosticHash,
    simulationActiveV1: {
      source: 'cloud',
      savedAt: fixture.createdAt,
      hash: 'cfg-hash',
      readStatus: 'loaded',
      exists: true,
      missingFields: [],
      legacyGlobalReadStatus: null,
      legacyGlobalExists: null,
    },
    instrumentUniverse: {
      source: 'cloud',
      sourceOrigin: 'firestore',
      weightsMode: 'instrument-universe',
      savedAt: fixture.createdAt,
      hash: 'uni-hash',
      cloudReadStatus: 'loaded',
      localCacheAvailable: false,
    },
    aurumSnapshot: {
      source: 'cloud',
      month: '2026-06',
      label: '2026-06 cierre',
      publishedAt: fixture.createdAt,
      hash: 'snap-hash',
    },
    warnings: [],
  });
  return {
    hash: fixture.fingerprint,
    effectiveEngineInputHash: fixture.fingerprint,
    diagnosticHash: fixture.diagnosticHash,
    hashIncludesDiagnostics: false,
    manualLocalAdjustmentsAffectEngine: false,
    normalizedInput: fixture.normalizedInput,
    sources: {
      aurumSnapshot: { source: 'cloud', savedAt: fixture.createdAt, hash: 'snap-hash', detail: 'snapshot' },
      instrumentUniverse: { source: 'cloud', savedAt: fixture.createdAt, hash: 'uni-hash', detail: 'instrument-universe' },
      simulationParams: { source: 'cloud', savedAt: fixture.createdAt, hash: 'cfg-hash', detail: 'loaded' },
      spendingPhases: { source: 'cloud', savedAt: fixture.createdAt, hash: 'spend-hash', detail: '4 fases' },
      fx: { source: 'mixed', savedAt: fixture.createdAt, hash: 'fx-hash', detail: 'USD/CLP 900' },
    },
    warnings: [],
    createdAt: fixture.createdAt,
    diagnosticInput: {
      replayTrace: {
        traceVersion: 1,
        canonicalInput: {
          label: 'Modelo Base',
          baseLabel: null,
          m8Input: fixture.normalizedInput,
          simulationBaseMonth: fixture.normalizedInput.simulation_base_month ?? null,
          effectiveCapitalInitialClp: fixture.normalizedInput.capital_initial_clp,
          spendingPhases: { F1: 1, F2: 2, F3: 3, F4: 4 },
          portfolioMix: fixture.normalizedInput.portfolio_mix ?? {},
          houseConfig: fixture.normalizedInput.house ?? {},
          riskConfig: { riskCapitalClp: 0, riskCapitalPolicy: null, riskCapitalBtcDriver: null },
          cutsConfig: fixture.normalizedInput.cuts ?? {},
          bucketConfig: fixture.normalizedInput.bucket ?? {},
          futureEvents: fixture.normalizedInput.future_events ?? [],
        },
        sourceMetadata: {
          simulationActiveV1: {
            pathLogical: 'users/{uid}/midas_config/simulationActiveV1',
            source: 'cloud',
            savedAt: fixture.createdAt,
            hash: 'cfg-hash',
            label: 'Modelo Base',
            baseLabel: null,
            readStatus: 'loaded',
            exists: true,
            missingFields: [],
          },
          instrumentUniverse: {
            source: 'cloud',
            sourceOrigin: 'firestore',
            weightsMode: 'instrument-universe',
            savedAt: fixture.createdAt,
            hash: 'uni-hash',
            cloudReadStatus: 'loaded',
            detail: null,
          },
          aurumSnapshot: {
            source: 'cloud',
            month: '2026-06',
            label: '2026-06 cierre',
            publishedAt: fixture.createdAt,
            hash: 'snap-hash',
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
          nPaths: 1000,
          seed: 42,
          simulationFrequency: 'monthly',
          useRealTerms: true,
          generatorType: 'bootstrap',
          generatorParams: {},
          studentTdf: 7,
          bucketMonths: 24,
        },
        fingerprints: {
          effectiveEngineInputFingerprint: fixture.fingerprint,
          m8Fingerprint: fixture.fingerprint,
          diagnosticFingerprint: fixture.diagnosticHash,
          simulationConfigHash: 'cfg-hash',
          instrumentUniverseFingerprint: 'uni-hash',
          aurumSnapshotFingerprint: 'snap-hash',
        },
        sourcePolicy,
        warnings: [],
      },
    },
  };
}

function buildResult(): SimulationResults {
  return {
    probRuin: fixture.certifiedRuin40 ?? 0.084,
    success40: fixture.certifiedSuccess40 ?? 0.916,
    probRuin40: fixture.certifiedRuin40 ?? 0.084,
    nRuin: 84,
    nTotal: 1000,
    uncertaintyBand: { low: 0.024, high: 0.144 },
    terminalWealthPercentiles: { 50: 3374316533 },
    terminalWealthAll: [],
    terminalWealthAllPaths: [],
    p50TerminalAllPaths: 3374316533,
    p50TerminalSurvivors: 3374316533,
    terminalP25AllPaths: 1030503112,
    terminalP25IfSuccess: 1030503112,
    terminalP75AllPaths: 5000000000,
    terminalP75IfSuccess: 5000000000,
    maxDrawdownPercentiles: { 50: 0.23 },
    ruinTimingMedian: 0,
    ruinTimingP25: 0,
    ruinTimingP75: 0,
    fanChartData: [],
    spendingRatioMedian: 0.96,
    houseSalePct: 0.246,
    saleYearMedian: 24.708333333333336,
    computedAt: new Date(fixture.createdAt),
    durationMs: 1234,
    params: { simulation: { seed: 42, nSim: 1000 } } as any,
    qualityOfLifeMetrics: {
      schemaVersion: 1,
      source: 'path_quality_diagnostics_v1',
      warnings: [],
      pathCount: 1000,
      horizonMonths: 480,
      horizonYears: 40,
      classicSuccessRate: 0.916,
      ruinRate: 0.084,
      ruinedPathCount: 84,
      csr85_4: 0.737,
      csrPassingPathCount: 737,
      csrThresholds: { minAverageConsumptionRatio: 0.85, maxSevereCutMonths: 48 },
      qasrAlpha: 1.5,
      qasrStrict: 0.904,
      qualityScoreMean: 0.52,
      qualityScoreP25: 0.48,
      qualityScoreP50: 0.52,
      averageConsumptionRatioMean: 0.96,
      averageConsumptionRatioP25: 0.94,
      averageConsumptionRatioP50: 0.96,
      averageEffectiveSpendingRatio: 0.96,
      minMonthlyConsumptionRatioP10: 0.8,
      minMonthlyConsumptionRatioP25: 0.85,
      minAnnualConsumptionRatioP10: 0.8,
      minAnnualConsumptionRatioP25: 0.85,
      monthsBelow85: 35,
      maxConsecutiveMonthsBelow85: 12,
      monthsBelow90: 48,
      maxConsecutiveMonthsBelow90: 16,
      earlyStressMonths: 3,
      phaseStress: [],
      qualitySurvivalRate: 0.154,
      qualitySurvivalPassingPathCount: 154,
      qualitySurvivalThresholds: { minAverageConsumptionRatio: 0.9, maxConsecutiveMonthsBelow85: 6, maxTotalMonthsBelow85: 24 },
      monthsInCutMean: 24,
      monthsInCutP50: 18,
      monthsInSevereCutMean: 34.8,
      monthsInSevereCutP50: 20,
      maxConsecutiveSevereCutMonthsP50: 8,
      maxConsecutiveSevereCutMonthsP75: 14,
      severeCutYearsMean: 2.9,
      terminalWealthP25: 1030503112,
      terminalWealthP50: 3374316533,
      terminalWealthRatio: 2.1814,
      houseSaleIncidence: 0.246,
      houseSaleYearMedian: 24.708333333333336,
      severeCutMonthsDuringHouseSaleMean: 4,
      severeCutMonthsDuringHouseSaleMedian: 3,
    },
  } as any as SimulationResults;
}

const simResult = buildResult();
const diagnostics = buildSimulationResultDiagnostics({
  result: simResult,
  resultInputHash: fixture.fingerprint,
  effectiveEngineInputHash: fixture.fingerprint,
  resultSeed: 42,
  expectedSeed: 42,
  resultNSim: 1000,
  expectedNSim: 1000,
  completedAt: fixture.createdAt,
  simulationRunStatus: 'completed',
  resultMetricsAvailable: true,
  lastRunInputHash: fixture.fingerprint,
  lastRenderedResultHash: fixture.fingerprint,
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
    resultDigest: diagnostics.resultDigest,
    isFinalForCurrentInput: diagnostics.isFinalForCurrentInput,
    resultInputHash: diagnostics.resultInputHash,
    effectiveEngineInputHash: fixture.fingerprint,
    resultSeed: diagnostics.resultSeed,
    expectedSeed: 42,
    resultNSim: diagnostics.resultNSim,
    expectedNSim: 1000,
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: fixture.fingerprint,
    lastRenderedResultHash: fixture.fingerprint,
  },
});

const pack = buildOptimizationPack({
  fingerprint: buildFingerprint(),
  simulationResultDiagnostics: diagnostics,
  resultConfidence,
  simResult,
});

assert.equal(pack.packType, OPTIMIZATION_PACK_TYPE);
assert.equal(pack.baseline.fingerprint, fixture.fingerprint);
assert.equal(pack.optimizationMenu.some((item) => item.id === 'custom'), true);
assert.ok(pack.conversationProtocol);
assert.ok(pack.externalAiInstructions);
assert.ok(pack.candidatePreScreeningPolicy);
assert.ok(pack.candidateSetSchema);
assert.deepEqual(pack.forbiddenVariables, OPTIMIZATION_FORBIDDEN_VARIABLES);
assert.equal(pack.candidatePreScreeningPolicy.mode, 'ai_proxy_prescreening');
assert.equal(pack.candidatePreScreeningPolicy.allowProxyScores, true);
assert.equal(pack.candidatePreScreeningPolicy.requirePreJsonReviewPrompt, true);
assert.equal(pack.candidatePreScreeningPolicy.targetCandidateCount, TARGET_CANDIDATES_PER_SET);
assert.equal(pack.candidatePreScreeningPolicy.maxCandidateCount, MAX_CANDIDATES_PER_SET);
const interactionRules = (pack.externalAiInstructions as { interactionRules: string[] }).interactionRules;
assert.equal(
  interactionRules.some((item) => item.includes('preselección de candidatos')),
  true,
);
assert.equal(
  interactionRules.some((item) => item.includes('constraints debe salir como objeto JSON en la raíz')),
  true,
);
assert.equal(
  interactionRules.some((item) => item.includes('Score pre-M8 heurístico/no oficial; M8 es la fuente oficial de evaluación.')),
  true,
);
const candidateSetSchema = pack.candidateSetSchema as {
  heuristicFields?: { preM8ScoreExplanationPrefix?: string };
  constraintsShape?: { rootType?: string; legacyArrayRootForbidden?: boolean };
};
assert.equal(candidateSetSchema.heuristicFields?.preM8ScoreExplanationPrefix, 'Score pre-M8 heurístico/no oficial; M8 es la fuente oficial de evaluación.');
assert.equal(candidateSetSchema.constraintsShape?.rootType, 'object');
assert.equal(candidateSetSchema.constraintsShape?.legacyArrayRootForbidden, true);
const serializedLineage = JSON.stringify(pack.sourceLineage);
assert.equal(serializedLineage.includes('authDiagnostics'), false);
assert.equal(serializedLineage.includes('authEmail'), false);
assert.equal(serializedLineage.includes('authUid'), false);

console.log('optimizationPack tests passed');
