import type { SimulationConfigCloudDiagnostics } from '../../integrations/midas/simulationConfigPersistence';
import { buildSourceFreshnessPolicy, type SourceFreshnessPolicy } from './sourceFreshnessPolicy';

export type M8ReplayTraceInput = {
  paramsLabel: string | null;
  effectiveEngineInput: Record<string, unknown>;
  effectiveEngineInputFingerprint: string;
  m8Fingerprint: string | null;
  diagnosticFingerprint: string | null;
  simulationConfigSource: 'cloud' | 'local_cache' | 'fallback';
  simulationConfigSavedAt: string | null;
  simulationConfigHash: string | null;
  simulationConfigDiagnostics?: SimulationConfigCloudDiagnostics;
  weightsSourceMode: string;
  universeSourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
  instrumentUniverseSavedAt: string | null;
  instrumentUniverseHash: string | null;
  instrumentUniverseDiagnostics?: Record<string, unknown>;
  aurumSnapshotMonth: string | null;
  aurumSnapshotLabel: string | null;
  aurumSnapshotPublishedAt: string | null;
  aurumSnapshotSignature: string | null;
  aurumSnapshotResolution?: 'loading' | 'missing' | 'invalid' | 'pending_apply' | 'applied' | 'permission_error' | 'network_error';
  runtimeDiagnostics?: Record<string, unknown>;
  fieldSources?: Record<string, unknown>;
  capitalDerivationDiagnostics?: Record<string, unknown>;
  warnings?: string[];
};

export type M8ReplayTrace = {
  traceVersion: 1;
  canonicalInput: {
    label: string | null;
    baseLabel: string | null;
    m8Input: Record<string, unknown>;
    simulationBaseMonth: string | null;
    effectiveCapitalInitialClp: number | null;
    spendingPhases: {
      F1: number | null;
      F2: number | null;
      F3: number | null;
      F4: number | null;
    };
    portfolioMix: Record<string, unknown> | null;
    houseConfig: Record<string, unknown> | null;
    riskConfig: {
      riskCapitalClp: number | null;
      riskCapitalPolicy: string | null;
      riskCapitalBtcDriver: string | null;
    };
    cutsConfig: Record<string, unknown> | null;
    bucketConfig: Record<string, unknown> | null;
    futureEvents: unknown[];
  };
  sourceMetadata: {
    simulationActiveV1: {
      pathLogical: string | null;
      source: 'cloud' | 'local_cache' | 'fallback';
      savedAt: string | null;
      hash: string | null;
      label: string | null;
      baseLabel: string | null;
      readStatus: string | null;
      exists: boolean | null;
      missingFields: string[];
    };
    instrumentUniverse: {
      source: 'cloud' | 'bundled' | 'local_cache' | 'none' | 'fallback';
      sourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
      weightsMode: string;
      savedAt: string | null;
      hash: string | null;
      cloudReadStatus: string | null;
      detail: string | null;
    };
    aurumSnapshot: {
      source: 'cloud' | 'fallback';
      month: string | null;
      label: string | null;
      publishedAt: string | null;
      hash: string | null;
      resolution?: 'loading' | 'missing' | 'invalid' | 'pending_apply' | 'applied' | 'permission_error' | 'network_error';
    };
    fieldSources: Record<string, unknown>;
    capitalDerivation: Record<string, unknown>;
  };
  readiness: {
    canonicalInputReady: boolean;
    state: 'ready' | 'blocked';
    pendingSource: string | null;
    blockedReason: string | null;
    statusMessage: string | null;
    simulationRunStatus: string | null;
    simulated: boolean;
    resultMetricsAvailable: boolean;
  };
  engineSettings: {
    years: number | null;
    nPaths: number | null;
    seed: number | null;
    simulationFrequency: string | null;
    useRealTerms: boolean | null;
    generatorType: string | null;
    generatorParams: Record<string, unknown> | null;
    studentTdf: number | null;
    bucketMonths: number | null;
  };
  fingerprints: {
    effectiveEngineInputFingerprint: string;
    m8Fingerprint: string | null;
    diagnosticFingerprint: string | null;
    simulationConfigHash: string | null;
    instrumentUniverseFingerprint: string | null;
    aurumSnapshotFingerprint: string | null;
  };
  sourcePolicy: SourceFreshnessPolicy;
  warnings: string[];
};

const numberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const objectOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const arrayOrEmpty = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const sanitizeLogicalPath = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.replace(/^users\/[^/]+\/midas_config\/simulationActiveV1$/, 'users/{uid}/midas_config/simulationActiveV1');
};

const resolveInstrumentUniverseSource = (
  sourceOrigin: M8ReplayTraceInput['universeSourceOrigin'],
  weightsSourceMode: string,
): M8ReplayTrace['sourceMetadata']['instrumentUniverse']['source'] => {
  if (sourceOrigin === 'firestore') return 'cloud';
  if (sourceOrigin === 'bundled') return 'bundled';
  if (sourceOrigin === 'cache-local') return 'local_cache';
  if (weightsSourceMode === 'missing-instrument-universe') return 'none';
  return (
    weightsSourceMode === 'instrument-universe'
    || weightsSourceMode === 'instrument-universe-cloud'
    || weightsSourceMode === 'instrument-universe-bundled'
  )
    ? 'none'
    : 'fallback';
};

export function buildM8ReplayTrace(input: M8ReplayTraceInput): M8ReplayTrace {
  const runtime = input.runtimeDiagnostics ?? {};
  const m8Input = input.effectiveEngineInput;
  const generatorParams = objectOrNull(m8Input.generator_params);
  const simulationRunStatus = stringOrNull(runtime.simulationRunStatus);
  const canonicalInputReady = runtime.canonicalInputReady !== false;

  return {
    traceVersion: 1,
    canonicalInput: {
      label: input.paramsLabel,
      baseLabel: null,
      m8Input,
      simulationBaseMonth: stringOrNull(m8Input.simulation_base_month),
      effectiveCapitalInitialClp: numberOrNull(m8Input.capital_initial_clp),
      spendingPhases: {
        F1: numberOrNull(m8Input.phase1MonthlyClp),
        F2: numberOrNull(m8Input.phase2MonthlyClp),
        F3: numberOrNull(m8Input.phase3MonthlyClp),
        F4: numberOrNull(m8Input.phase4MonthlyClp),
      },
      portfolioMix: objectOrNull(m8Input.portfolio_mix),
      houseConfig: objectOrNull(m8Input.house),
      riskConfig: {
        riskCapitalClp: numberOrNull(m8Input.risk_capital_clp),
        riskCapitalPolicy: stringOrNull(m8Input.risk_capital_policy),
        riskCapitalBtcDriver: stringOrNull(m8Input.risk_capital_btc_driver),
      },
      cutsConfig: objectOrNull(m8Input.cuts),
      bucketConfig: objectOrNull(m8Input.bucket),
      futureEvents: arrayOrEmpty(m8Input.future_events),
    },
    sourceMetadata: {
      simulationActiveV1: {
        pathLogical: sanitizeLogicalPath(input.simulationConfigDiagnostics?.path ?? null),
        source: input.simulationConfigSource,
        savedAt: input.simulationConfigSavedAt,
        hash: input.simulationConfigHash,
        label: input.paramsLabel,
        baseLabel: null,
        readStatus: input.simulationConfigDiagnostics?.readStatus ?? null,
        exists: input.simulationConfigDiagnostics?.exists ?? null,
        missingFields: input.simulationConfigDiagnostics?.missingFields ?? [],
      },
      instrumentUniverse: {
        source: resolveInstrumentUniverseSource(input.universeSourceOrigin, input.weightsSourceMode),
        sourceOrigin: input.universeSourceOrigin,
        weightsMode: input.weightsSourceMode,
        savedAt: input.instrumentUniverseSavedAt,
        hash: input.instrumentUniverseHash,
        cloudReadStatus: stringOrNull(input.instrumentUniverseDiagnostics?.cloudReadStatus),
        detail: stringOrNull(input.instrumentUniverseDiagnostics?.fallbackReason),
      },
      aurumSnapshot: {
        source: input.aurumSnapshotSignature ? 'cloud' : 'fallback',
        month: input.aurumSnapshotMonth,
        label: input.aurumSnapshotLabel,
        publishedAt: input.aurumSnapshotPublishedAt,
        hash: input.aurumSnapshotSignature,
        resolution: input.aurumSnapshotResolution,
      },
      fieldSources: input.fieldSources ?? {},
      capitalDerivation: input.capitalDerivationDiagnostics ?? {},
    },
    readiness: {
      canonicalInputReady,
      state: canonicalInputReady ? 'ready' : 'blocked',
      pendingSource: stringOrNull(runtime.canonicalInputPendingSource),
      blockedReason: stringOrNull(runtime.canonicalInputBlockedReason ?? runtime.blockedReason),
      statusMessage: stringOrNull(runtime.canonicalInputStatusMessage),
      simulationRunStatus,
      simulated: simulationRunStatus === 'completed',
      resultMetricsAvailable: Boolean(runtime.resultMetricsAvailable),
    },
    engineSettings: {
      years: numberOrNull(m8Input.years),
      nPaths: numberOrNull(m8Input.n_paths),
      seed: numberOrNull(m8Input.seed),
      simulationFrequency: stringOrNull(m8Input.simulation_frequency),
      useRealTerms: typeof m8Input.use_real_terms === 'boolean' ? m8Input.use_real_terms : null,
      generatorType: stringOrNull(m8Input.generator_type),
      generatorParams,
      studentTdf: numberOrNull(generatorParams?.df),
      bucketMonths: numberOrNull(objectOrNull(m8Input.bucket)?.bucket_months),
    },
    fingerprints: {
      effectiveEngineInputFingerprint: input.effectiveEngineInputFingerprint,
      m8Fingerprint: input.m8Fingerprint,
      diagnosticFingerprint: input.diagnosticFingerprint,
      simulationConfigHash: input.simulationConfigHash,
      instrumentUniverseFingerprint: input.instrumentUniverseHash,
      aurumSnapshotFingerprint: input.aurumSnapshotSignature,
    },
    sourcePolicy: buildSourceFreshnessPolicy({
      canonicalInputReady,
      blockedReason: stringOrNull(runtime.canonicalInputBlockedReason ?? runtime.blockedReason),
      hasReplayTrace: true,
      m8Fingerprint: input.m8Fingerprint,
      diagnosticFingerprint: input.diagnosticFingerprint,
      simulationActiveV1: {
        source: input.simulationConfigSource,
        savedAt: input.simulationConfigSavedAt,
        hash: input.simulationConfigHash,
        readStatus: input.simulationConfigDiagnostics?.readStatus ?? null,
        exists: input.simulationConfigDiagnostics?.exists ?? null,
        missingFields: input.simulationConfigDiagnostics?.missingFields ?? [],
        legacyGlobalReadStatus: input.simulationConfigDiagnostics?.legacyGlobalReadStatus ?? null,
        legacyGlobalExists: input.simulationConfigDiagnostics?.legacyGlobalExists ?? null,
      },
      instrumentUniverse: {
        source: resolveInstrumentUniverseSource(input.universeSourceOrigin, input.weightsSourceMode),
        sourceOrigin: input.universeSourceOrigin,
        weightsMode: input.weightsSourceMode,
        savedAt: input.instrumentUniverseSavedAt,
        hash: input.instrumentUniverseHash,
        cloudReadStatus: stringOrNull(input.instrumentUniverseDiagnostics?.cloudReadStatus),
        localCacheAvailable: Boolean(input.instrumentUniverseDiagnostics?.localCacheAvailable),
      },
      aurumSnapshot: {
        source: input.aurumSnapshotSignature ? 'cloud' : 'fallback',
        month: input.aurumSnapshotMonth,
        label: input.aurumSnapshotLabel,
        publishedAt: input.aurumSnapshotPublishedAt,
        hash: input.aurumSnapshotSignature,
        resolution: input.aurumSnapshotResolution,
      },
      localDiagnostics: {
        persistedBaseExists: Boolean(runtime.localPersistedBaseExists),
        localReadOnlyFallbackActive: Boolean(runtime.localReadOnlyFallbackActive),
      },
      capitalDerivation: {
        manualAdjustmentsCount: Number(input.capitalDerivationDiagnostics?.manualAdjustmentsCount ?? 0),
        manualAdjustmentsSource: stringOrNull(input.capitalDerivationDiagnostics?.manualAdjustmentsSource),
        manualLocalAdjustmentsAffectEngine: Boolean(input.capitalDerivationDiagnostics?.manualLocalAdjustmentsAffectEngine),
      },
      warnings: input.warnings ?? [],
    }),
    warnings: [...(input.warnings ?? [])],
  };
}
