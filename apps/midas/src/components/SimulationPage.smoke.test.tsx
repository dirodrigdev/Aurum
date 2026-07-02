import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildAssumptionModeDiagnostics } from '../domain/model/assumptionMode';
import { DEFAULT_PARAMETERS, SCENARIO_VARIANTS } from '../domain/model/defaults';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import type { M8ReplayTrace } from '../domain/model/m8ReplayTrace';
import type { ResultConfidence } from '../domain/model/resultConfidence';
import { buildSimulationResultDiagnostics } from '../domain/model/simulationResultDigest';
import { buildSourceFreshnessPolicy, type SourceFreshnessPolicy } from '../domain/model/sourceFreshnessPolicy';
import type { ModelParameters, SimulationResults } from '../domain/model/types';
import { applyScenarioVariant } from '../domain/simulation/engine';
import { runM8 } from '../domain/simulation/engineM8';
import type { M8Input } from '../domain/simulation/m8.types';
import { fromM8Output } from '../domain/simulation/m8Adapter';
import { SimulationPage, type SimulationOverrides } from './SimulationPage';

type ProductionGoldenFixture = {
  createdAt: string;
  fingerprint: string;
  effectiveEngineInputHash: string;
  diagnosticHash: string;
  normalizedInput: M8Input;
  warnings: string[];
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
  sourcePolicy: {
    sources: Array<{
      id: string;
      savedAt: string | null;
    }>;
  };
  simulationResultDiagnostics: {
    completedAt: string;
  };
};

const FIXTURE_PATH = new URL('../domain/simulation/__fixtures__/productionGoldenRun.v1.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ProductionGoldenFixture;

const cloneParams = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function sourceEntry(id: string) {
  return fixture.sourcePolicy.sources.find((entry) => entry.id === id) ?? null;
}

function buildBaseParams(): ModelParameters {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.label = 'Modelo Base MIDAS';
  params.capitalInitial = fixture.replayTrace.canonicalInput.effectiveCapitalInitialClp;
  params.capitalSource = fixture.normalizedInput.capital_source;
  params.simulationBaseMonth = fixture.normalizedInput.simulation_base_month;
  params.simulation = {
    ...params.simulation,
    nSim: fixture.normalizedInput.n_paths,
    seed: fixture.normalizedInput.seed,
    horizonMonths: fixture.normalizedInput.years * 12,
  };
  return params;
}

function buildScenarioParams(): ModelParameters {
  const variant = SCENARIO_VARIANTS.find((item) => item.id === 'pessimistic');
  assert(variant, 'pessimistic scenario variant must exist');
  const scenario = applyScenarioVariant({
    ...buildBaseParams(),
    activeScenario: 'pessimistic',
  }, variant);
  return scenario as ModelParameters;
}

function buildSourcePolicy(): SourceFreshnessPolicy {
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
      localCacheAvailable: false,
    },
    aurumSnapshot: {
      source: fixture.replayTrace.sourceMetadata.aurumSnapshot.source as 'cloud' | 'fallback',
      month: fixture.replayTrace.sourceMetadata.aurumSnapshot.month,
      label: fixture.replayTrace.sourceMetadata.aurumSnapshot.label,
      publishedAt: fixture.replayTrace.sourceMetadata.aurumSnapshot.publishedAt,
      hash: fixture.replayTrace.sourceMetadata.aurumSnapshot.hash,
    },
    localDiagnostics: {
      persistedBaseExists: true,
      localReadOnlyFallbackActive: false,
    },
    capitalDerivation: {
      manualAdjustmentsCount: fixture.replayTrace.sourceMetadata.capitalDerivation.manualAdjustmentsCount,
      manualAdjustmentsSource: fixture.replayTrace.sourceMetadata.capitalDerivation.manualAdjustmentsSource,
      manualLocalAdjustmentsAffectEngine: fixture.replayTrace.sourceMetadata.capitalDerivation.manualLocalAdjustmentsAffectEngine,
    },
    warnings: [],
  });
}

function buildSimulationResult(params: ModelParameters): SimulationResults {
  const runtime = runM8(fixture.normalizedInput);
  const result = fromM8Output(runtime, params);
  result.params = params;
  return result;
}

function buildDiagnostics(result: SimulationResults, effectiveEngineInputHash: string) {
  return buildSimulationResultDiagnostics({
    result,
    resultInputHash: effectiveEngineInputHash,
    effectiveEngineInputHash,
    resultSeed: fixture.normalizedInput.seed,
    expectedSeed: fixture.normalizedInput.seed,
    resultNSim: fixture.normalizedInput.n_paths,
    expectedNSim: fixture.normalizedInput.n_paths,
    completedAt: fixture.simulationResultDiagnostics.completedAt,
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: effectiveEngineInputHash,
    lastRenderedResultHash: effectiveEngineInputHash,
  });
}

function buildFingerprint(sourcePolicy: SourceFreshnessPolicy, effectiveEngineInputHash: string): M8InputFingerprint {
  const replayTrace: M8ReplayTrace = {
    traceVersion: 1,
    canonicalInput: {
      label: 'Modelo Base MIDAS',
      baseLabel: null,
      m8Input: fixture.normalizedInput as unknown as Record<string, unknown>,
      simulationBaseMonth: fixture.normalizedInput.simulation_base_month ?? null,
      effectiveCapitalInitialClp: fixture.normalizedInput.capital_initial_clp,
      spendingPhases: {
        F1: fixture.normalizedInput.phase1MonthlyClp,
        F2: fixture.normalizedInput.phase2MonthlyClp,
        F3: fixture.normalizedInput.phase3MonthlyClp,
        F4: fixture.normalizedInput.phase4MonthlyClp,
      },
      portfolioMix: fixture.normalizedInput.portfolio_mix as unknown as Record<string, unknown>,
      houseConfig: (fixture.normalizedInput.house ?? null) as Record<string, unknown> | null,
      riskConfig: {
        riskCapitalClp: fixture.normalizedInput.risk_capital_clp ?? null,
        riskCapitalPolicy: fixture.normalizedInput.risk_capital_policy ?? null,
        riskCapitalBtcDriver: fixture.normalizedInput.risk_capital_btc_driver ?? null,
      },
      cutsConfig: fixture.normalizedInput.cuts as unknown as Record<string, unknown>,
      bucketConfig: fixture.normalizedInput.bucket as unknown as Record<string, unknown>,
      futureEvents: fixture.normalizedInput.future_events ?? [],
    },
    sourceMetadata: {
      simulationActiveV1: {
        pathLogical: 'users/{uid}/midas_config/simulationActiveV1',
        source: 'cloud',
        savedAt: sourceEntry('simulationActiveV1')?.savedAt ?? null,
        hash: fixture.replayTrace.fingerprints.simulationConfigHash,
        label: 'Modelo Base MIDAS',
        baseLabel: null,
        readStatus: 'loaded',
        exists: true,
        missingFields: [],
      },
      instrumentUniverse: {
        source: 'cloud',
        sourceOrigin: 'firestore',
        weightsMode: fixture.replayTrace.sourceMetadata.instrumentUniverse.weightsMode,
        savedAt: fixture.replayTrace.sourceMetadata.instrumentUniverse.savedAt,
        hash: fixture.replayTrace.sourceMetadata.instrumentUniverse.hash,
        cloudReadStatus: 'loaded',
        detail: null,
      },
      aurumSnapshot: {
        source: 'cloud',
        month: fixture.replayTrace.sourceMetadata.aurumSnapshot.month,
        label: fixture.replayTrace.sourceMetadata.aurumSnapshot.label,
        publishedAt: fixture.replayTrace.sourceMetadata.aurumSnapshot.publishedAt,
        hash: fixture.replayTrace.sourceMetadata.aurumSnapshot.hash,
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
      years: fixture.normalizedInput.years,
      nPaths: fixture.normalizedInput.n_paths,
      seed: fixture.normalizedInput.seed,
      simulationFrequency: fixture.normalizedInput.simulation_frequency,
      useRealTerms: fixture.normalizedInput.use_real_terms,
      generatorType: fixture.normalizedInput.generator_type,
      generatorParams: fixture.normalizedInput.generator_params as unknown as Record<string, unknown>,
      studentTdf: Number((fixture.normalizedInput.generator_params as { degrees_of_freedom?: number }).degrees_of_freedom ?? 7),
      bucketMonths: fixture.normalizedInput.bucket?.bucket_months ?? null,
    },
    fingerprints: {
      effectiveEngineInputFingerprint: effectiveEngineInputHash,
      m8Fingerprint: effectiveEngineInputHash,
      diagnosticFingerprint: fixture.diagnosticHash,
      simulationConfigHash: fixture.replayTrace.fingerprints.simulationConfigHash,
      instrumentUniverseFingerprint: fixture.replayTrace.fingerprints.instrumentUniverseFingerprint,
      aurumSnapshotFingerprint: fixture.replayTrace.fingerprints.aurumSnapshotFingerprint,
    },
    sourcePolicy,
    warnings: [],
  };

  return {
    hash: effectiveEngineInputHash,
    effectiveEngineInputHash,
    diagnosticHash: fixture.diagnosticHash,
    hashIncludesDiagnostics: false,
    manualLocalAdjustmentsAffectEngine: false,
    normalizedInput: fixture.normalizedInput as unknown as Record<string, unknown>,
    diagnosticInput: {
      runtimeDiagnostics: {
        simulationRunStatus: 'completed',
        canonicalInputReady: true,
        canonicalInputBlockedReason: null,
        canonicalInputStatusMessage: null,
        canonicalInputPendingSource: null,
      },
      instrumentUniverseDiagnostics: {
        cloudReadStatus: 'loaded',
      },
      sourcePolicy,
      replayTrace,
    },
    sources: {
      aurumSnapshot: {
        source: 'cloud',
        savedAt: sourceEntry('aurumSnapshot')?.savedAt ?? null,
        hash: fixture.replayTrace.fingerprints.aurumSnapshotFingerprint,
        detail: fixture.replayTrace.sourceMetadata.aurumSnapshot.label,
      },
      instrumentUniverse: {
        source: 'cloud',
        savedAt: fixture.replayTrace.sourceMetadata.instrumentUniverse.savedAt,
        hash: fixture.replayTrace.fingerprints.instrumentUniverseFingerprint,
        detail: fixture.replayTrace.sourceMetadata.instrumentUniverse.weightsMode,
      },
      simulationParams: {
        source: 'cloud',
        savedAt: sourceEntry('simulationActiveV1')?.savedAt ?? null,
        hash: fixture.replayTrace.fingerprints.simulationConfigHash,
        detail: 'loaded',
      },
      spendingPhases: {
        source: 'cloud',
        savedAt: sourceEntry('simulationActiveV1')?.savedAt ?? null,
        hash: 'spending-phases-smoke',
        detail: '4 fases',
      },
      fx: {
        source: 'mixed',
        hash: 'fx-smoke',
        detail: 'USD/CLP fixture',
      },
    },
    warnings: [],
    createdAt: fixture.createdAt,
  };
}

function buildCanonicalResultConfidence(): ResultConfidence {
  return {
    status: 'canonical',
    label: 'OK',
    headline: 'Resultado vigente',
    message: 'Resultado auditable.',
    reasons: [],
    criticalSources: {
      aurumSnapshot: 'canonical',
      simulationConfig: 'canonical',
      instrumentUniverse: 'canonical',
      fx: 'canonical',
      capitalAdjustments: 'canonical',
      runResult: 'canonical',
      sandbox: 'canonical',
    },
    canUseForDecision: true,
    isCanonicalForDecision: true,
  };
}

function buildProps(mode: 'base' | 'pending' | 'scenario'): Parameters<typeof SimulationPage>[0] {
  const sourcePolicy = buildSourcePolicy();
  const baseParams = buildBaseParams();
  const scenarioParams = buildScenarioParams();
  const params = mode === 'scenario' ? scenarioParams : baseParams;
  const effectiveHash = mode === 'scenario' ? 'fnv1a-scenario-ui' : fixture.effectiveEngineInputHash;
  const result = buildSimulationResult(params);
  const diagnostics = buildDiagnostics(result, effectiveHash);
  const fingerprint = buildFingerprint(sourcePolicy, effectiveHash);
  const visibleInputFingerprint = mode === 'pending' ? 'fnv1a-pending-ui' : effectiveHash;
  const lastEvaluatedInputFingerprint = effectiveHash;
  const simOverrides: SimulationOverrides | null =
    mode === 'scenario' || mode === 'pending'
      ? {
          active: true,
          returnPct: 4,
          preset: 'custom',
        }
      : null;

  return {
    resultCentral: result,
    params,
    simOverrides,
    simActive: mode !== 'base',
    simWorking: false,
    simUiState: 'ready',
    heroPhase: 'ready',
    lastStableCentral: result,
    simUiError: null,
    lastRecalcCause: mode === 'pending' ? 'scenario' : null,
    simulationPreset: mode === 'base' ? 'base' : 'pessimistic',
    isScenarioAdjusted: mode !== 'base',
    hasVisibleScenarioChanges: mode !== 'base',
    aurumIntegrationStatus: 'available',
    aurumSnapshotLabel: fixture.replayTrace.sourceMetadata.aurumSnapshot.label,
    aurumSnapshotPublishedAt: fixture.replayTrace.sourceMetadata.aurumSnapshot.publishedAt,
    baseUpdatePending: false,
    hasPendingSnapshot: false,
    pendingSnapshotLabel: null,
    pendingSnapshotApplying: false,
    snapshotApplied: true,
    aurumSyncState: 'synced',
    aurumSyncDiff: 0,
    aurumSyncBaseOpt: params.capitalInitial,
    aurumSyncLatestOpt: params.capitalInitial,
    manualCapitalAdjustments: [],
    riskCapitalEnabled: false,
    riskCapitalEffective: false,
    riskCapitalCLP: 0,
    riskCapitalUsdSnapshotCLP: 0,
    recalcWorkerStatus: 'idle',
    activeRecalcRequestId: null,
    appliedRecalcRequestId: 42,
    activeRecalcSeed: null,
    appliedRecalcSeed: fixture.normalizedInput.seed,
    activeRecalcOwner: null,
    runtimeTimeline: [],
    bootstrapControlStatus: 'idle',
    bootstrapControlResult: null,
    controlConcordance: {
      status: 'na',
      message: null,
      diffAbsPp: null,
      centralProbRuin: null,
      controlProbRuin: null,
      centralZone: null,
      controlZone: null,
    },
    patrimonioSourceTechnical: 'Aurum snapshot cloud',
    distributionSourceTechnical: 'Instrument Universe cloud',
    fxSpotSourceTechnical: 'FX fixture',
    nonOptimizableBlocksTechnical: 'Bloques consistentes',
    aurumFxSpotCLP: params.fx.clpUsdInitial,
    aurumFxSpotUsdEur: 0.86,
    aurumFxSourceUsdEur: 0.86,
    aurumFxSpotSource: 'aurum',
    operativeFxResolution: {
      sourceMode: 'aurum-current',
      reasonCode: 'aurum_current_applied',
      aurumSource: 'aurum_active',
      aurumCandidateClp: params.fx.clpUsdInitial,
      aurumCurrentAvailable: true,
      aurumCurrentClp: params.fx.clpUsdInitial,
      runtimeClp: params.fx.clpUsdInitial,
      manualOverrideClp: null,
      appliedClp: params.fx.clpUsdInitial,
      usingAurumCurrent: true,
    },
    weightsSourceMode: 'instrument-universe',
    weightsSourceLabel: 'Mix oficial',
    universeSourceOrigin: 'firestore',
    cloudHydrationReady: true,
    simulationConfigSource: 'cloud',
    simulationConfigSavedAt: sourceEntry('simulationActiveV1')?.savedAt ?? null,
    visibleInputFingerprint,
    lastEvaluatedInputFingerprint,
    resultFingerprint: lastEvaluatedInputFingerprint,
    m8InputFingerprint: fingerprint,
    simulationResultDiagnostics: diagnostics,
    resultConfidence: buildCanonicalResultConfidence(),
    assumptionModeDiagnostics: buildAssumptionModeDiagnostics({ assumptionMode: mode === 'base' ? 'base' : 'scenario' }),
    officialReferenceWeights: params.weights,
    instrumentUniverseReferenceWeights: params.weights,
    instrumentBaseReferenceWeights: params.weights,
    activeWeights: params.weights,
    auditModeEnabled: false,
    auditProbe: {
      heroSource: 'simResult',
      requestId: 42,
      seed: fixture.normalizedInput.seed,
      nPaths: fixture.normalizedInput.n_paths,
      capitalInitial: fixture.normalizedInput.capital_initial_clp,
      capitalSource: params.capitalSource ?? 'aurum',
      sourceLabel: fixture.normalizedInput.capital_source_label ?? 'Aurum',
      riskCapitalEnabled: false,
      houseInclude: true,
      futureEventsCount: 0,
      inputHash: effectiveHash,
      m8Input: fixture.normalizedInput,
      heroResult: null,
      success40: result.success40 ?? null,
      probRuin40: result.probRuin40 ?? result.probRuin ?? null,
      probRuin20: result.probRuin20 ?? null,
    },
    localReadOnlyMode: {
      enabled: false,
      reason: null,
    },
    applyAurumHarness: {
      status: 'idle',
      startedAtMs: null,
      finishedAtMs: null,
      failureStep: null,
      details: null,
    },
    onApplyPendingSnapshot: () => undefined,
    onRunApplyAurumHarness: () => undefined,
    onToggleRiskCapital: () => undefined,
    onCommitManualCapitalAdjustments: () => undefined,
    onSimulationTouch: () => undefined,
    onScenarioChange: () => undefined,
    onRestoreScenarioPreset: () => undefined,
    onRestoreOfficialDistribution: () => undefined,
    onSimOverridesChange: () => undefined,
    onUpdateParams: () => undefined,
    onRunSimulation: () => undefined,
    onResetSim: () => undefined,
    onOpenOptimization: () => undefined,
  };
}

function renderHeroMarkup(mode: 'base' | 'pending' | 'scenario'): string {
  const markup = renderToStaticMarkup(React.createElement(SimulationPage, buildProps(mode)));
  const start = markup.indexOf('data-simulation-section="hero-result"');
  const end = markup.indexOf('data-simulation-section="hero-express-controls"', start);
  assert(start >= 0, 'hero-result section must be present');
  return markup.slice(start, end >= 0 ? end : undefined);
}

function assertNoVisualGarbage(markup: string) {
  assert.equal(markup.includes('Revisar'), false);
  assert.equal(markup.includes('No usar'), false);
  assert.equal(markup.includes('NaN'), false);
  assert.equal(markup.includes('undefined'), false);
  assert.equal(markup.includes('[object Object]'), false);
}

const baseHero = renderHeroMarkup('base');
assert(baseHero.includes('Resultado vigente.'));
assert.equal(baseHero.includes('Configuración pendiente de recalcular.'), false);
assert.equal(baseHero.includes('>Pendiente<'), false);
assert.equal(baseHero.includes('>Error<'), false);
assertNoVisualGarbage(baseHero);

const pendingHero = renderHeroMarkup('pending');
assert(pendingHero.includes('>Pendiente<'));
assert(pendingHero.includes('Configuración pendiente de recalcular.'));
assert(pendingHero.includes('Hay un resultado anterior visible.'));
assert.equal(pendingHero.includes('Resultado vigente.'), false);
assert.equal(pendingHero.includes('>Escenario<'), false);
assertNoVisualGarbage(pendingHero);

const scenarioHero = renderHeroMarkup('scenario');
assert(scenarioHero.includes('>Escenario<'));
assert(scenarioHero.includes('Resultado vigente.'));
assert.equal(scenarioHero.includes('>Pendiente<'), false);
assert.equal(scenarioHero.includes('>Error<'), false);
assert.equal(scenarioHero.includes('Resultado usable con salvedades'), false);
assert.equal(scenarioHero.includes('Hay ajustes locales de capital incorporados'), false);
assert.equal(scenarioHero.includes('Confirmar o descartar'), false);
assertNoVisualGarbage(scenarioHero);

console.log('SimulationPage smoke tests passed');
