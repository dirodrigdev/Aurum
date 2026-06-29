import type { ModelParameters } from './types';
import type { SimulationConfigCloudDiagnostics } from '../../integrations/midas/simulationConfigPersistence';
import { buildM8ReplayTrace, type M8ReplayTrace } from './m8ReplayTrace';

export type M8InputFingerprintSource = {
  source: 'cloud' | 'bundled' | 'local_cache' | 'fallback' | 'mixed' | 'unknown';
  savedAt?: string | null;
  hash?: string | null;
  detail?: string | null;
};

export type M8InputFingerprintSources = {
  aurumSnapshot: M8InputFingerprintSource;
  instrumentUniverse: M8InputFingerprintSource;
  simulationParams: M8InputFingerprintSource;
  spendingPhases: M8InputFingerprintSource;
  fx: M8InputFingerprintSource;
};

export type M8InputFingerprintInput = {
  params: ModelParameters;
  effectiveEngineInput?: unknown;
  riskCapitalEnabled: boolean;
  riskCapitalEffective: boolean;
  weightsSourceMode: string;
  universeSourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
  aurumSnapshotMonth: string | null;
  aurumSnapshotLabel: string | null;
  aurumSnapshotPublishedAt: string | null;
  aurumSnapshotSignature: string | null;
  simulationConfigSource: 'cloud' | 'local_cache' | 'fallback';
  simulationConfigSavedAt: string | null;
  simulationConfigHash: string | null;
  simulationConfigDiagnostics?: SimulationConfigCloudDiagnostics;
  runtimeDiagnostics?: Record<string, unknown>;
  authDiagnostics?: Record<string, unknown>;
  instrumentUniverseDiagnostics?: Record<string, unknown>;
  fieldSources?: Record<string, unknown>;
  capitalDerivationDiagnostics?: Record<string, unknown>;
  instrumentUniverseSavedAt: string | null;
  instrumentUniverseHash: string | null;
  hydratedCloudSources: boolean;
};

export type M8InputFingerprint = {
  hash: string;
  effectiveEngineInputHash: string;
  diagnosticHash: string;
  hashIncludesDiagnostics: false;
  manualLocalAdjustmentsAffectEngine: boolean;
  normalizedInput: Record<string, unknown>;
  diagnosticInput: Record<string, unknown> & { replayTrace: M8ReplayTrace };
  sources: M8InputFingerprintSources;
  warnings: string[];
  createdAt: string;
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function summarizeSpendingPhases(params: ModelParameters) {
  return (params.spendingPhases ?? []).map((phase, index) => ({
    id: `F${index + 1}`,
    months: Number(phase.durationMonths ?? 0),
    amountRealClp: Number(phase.amountReal ?? 0),
    currency: phase.currency ?? 'CLP',
  }));
}

function summarizeCashflowEvents(params: ModelParameters) {
  return (params.cashflowEvents ?? []).map((event) => ({
    id: event.id,
    description: event.description,
    month: Number(event.month ?? 0),
    type: event.type,
    amount: Number(event.amount ?? 0),
    currency: event.currency,
    amountType: event.amountType ?? null,
    sleeve: event.sleeve ?? null,
  }));
}

function summarizeFutureCapitalEvents(params: ModelParameters) {
  return (params.futureCapitalEvents ?? []).map((event) => ({
    id: event.id,
    type: event.type,
    amount: Number(event.amount ?? 0),
    currency: event.currency,
    effectiveDate: event.effectiveDate,
    description: event.description ?? null,
  }));
}

function buildSources(input: M8InputFingerprintInput): M8InputFingerprintSources {
  const mixSource =
    input.weightsSourceMode === 'instrument-universe'
      ? input.universeSourceOrigin === 'firestore'
        ? 'cloud'
        : input.universeSourceOrigin === 'bundled'
          ? 'bundled'
          : 'local_cache'
      : 'fallback';

  const fxSource =
    input.params.fx?.clpUsdInitial && Number.isFinite(Number(input.params.fx.clpUsdInitial))
      ? 'mixed'
      : 'fallback';

  return {
    aurumSnapshot: {
      source: input.aurumSnapshotSignature ? 'cloud' : 'fallback',
      savedAt: input.aurumSnapshotPublishedAt,
      hash: input.aurumSnapshotSignature,
      detail: input.aurumSnapshotLabel,
    },
    instrumentUniverse: {
      source: mixSource,
      savedAt: input.instrumentUniverseSavedAt,
      hash: input.instrumentUniverseHash,
      detail: input.weightsSourceMode,
    },
    simulationParams: {
      source: input.simulationConfigSource,
      savedAt: input.simulationConfigSavedAt,
      hash: input.simulationConfigHash,
      detail: input.simulationConfigDiagnostics
        ? `${input.simulationConfigDiagnostics.readStatus}:${input.simulationConfigDiagnostics.errorMessage ?? 'ok'}`
        : input.hydratedCloudSources ? 'cloud_hydrated' : 'pending_hydration',
    },
    spendingPhases: {
      source: input.simulationConfigSource,
      savedAt: input.simulationConfigSavedAt,
      hash: hashString(stableSerialize(summarizeSpendingPhases(input.params))),
      detail: `${(input.params.spendingPhases ?? []).length} fases`,
    },
    fx: {
      source: fxSource,
      hash: hashString(stableSerialize({ clpUsdInitial: Number(input.params.fx?.clpUsdInitial ?? 0) })),
      detail: Number.isFinite(Number(input.params.fx?.clpUsdInitial ?? NaN))
        ? `USD/CLP ${Number(input.params.fx?.clpUsdInitial ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 0 })}`
        : 'sin fx operativo',
    },
  };
}

export function buildM8InputFingerprint(input: M8InputFingerprintInput): M8InputFingerprint {
  const composition = input.params.simulationComposition;
  const normalizedInput: Record<string, unknown> = (input.effectiveEngineInput as Record<string, unknown> | null) ?? {
    capitalInitialClp: Number(input.params.capitalInitial ?? 0),
    capitalSource: input.params.capitalSource ?? 'unknown',
    totalNetWorthClp: Number(composition?.totalNetWorthCLP ?? 0),
    optimizableInvestmentsClp: Number(composition?.optimizableInvestmentsCLP ?? 0),
    nonOptimizableClp: {
      banks: Number(composition?.nonOptimizable?.banksCLP ?? 0),
      usdLiquidity: Number(composition?.nonOptimizable?.usdLiquidityCLP ?? 0),
      realEstateEquity: Number(composition?.nonOptimizable?.realEstate?.realEstateEquityCLP ?? 0),
      nonMortgageDebt: Number(composition?.nonOptimizable?.nonMortgageDebtCLP ?? 0),
      riskCapital: Number(composition?.nonOptimizable?.riskCapital?.totalCLP ?? 0),
    },
    riskCapital: {
      enabled: input.riskCapitalEnabled,
      effective: input.riskCapitalEffective,
    },
    weights: {
      rvGlobal: Number(input.params.weights?.rvGlobal ?? 0),
      rfGlobal: Number(input.params.weights?.rfGlobal ?? 0),
      rvChile: Number(input.params.weights?.rvChile ?? 0),
      rfChile: Number(input.params.weights?.rfChile ?? 0),
    },
    spendingPhases: summarizeSpendingPhases(input.params),
    cashflowEvents: summarizeCashflowEvents(input.params),
    futureCapitalEvents: summarizeFutureCapitalEvents(input.params),
    activeScenario: input.params.activeScenario ?? 'base',
    feeAnnual: Number(input.params.feeAnnual ?? 0),
    generatorType: input.params.generatorType ?? 'unknown',
    returns: {
      rvGlobalAnnual: Number(input.params.returns?.rvGlobalAnnual ?? 0),
      rfGlobalAnnual: Number(input.params.returns?.rfGlobalAnnual ?? 0),
      rvChileAnnual: Number(input.params.returns?.rvChileAnnual ?? 0),
      rfChileUFAnnual: Number(input.params.returns?.rfChileUFAnnual ?? 0),
      rvGlobalVolAnnual: Number(input.params.returns?.rvGlobalVolAnnual ?? 0),
      rfGlobalVolAnnual: Number(input.params.returns?.rfGlobalVolAnnual ?? 0),
      rvChileVolAnnual: Number(input.params.returns?.rvChileVolAnnual ?? 0),
      rfChileVolAnnual: Number(input.params.returns?.rfChileVolAnnual ?? 0),
      correlationMatrix: input.params.returns?.correlationMatrix ?? [],
    },
    inflation: {
      ipcChileAnnual: Number(input.params.inflation?.ipcChileAnnual ?? 0),
      hipcEurAnnual: Number(input.params.inflation?.hipcEurAnnual ?? 0),
      ipcChileVolAnnual: Number(input.params.inflation?.ipcChileVolAnnual ?? 0),
      hipcEurVolAnnual: Number(input.params.inflation?.hipcEurVolAnnual ?? 0),
    },
    spendingRule: {
      dd15Threshold: Number(input.params.spendingRule?.dd15Threshold ?? 0),
      dd25Threshold: Number(input.params.spendingRule?.dd25Threshold ?? 0),
      consecutiveMonths: Number(input.params.spendingRule?.consecutiveMonths ?? 0),
      softCut: Number(input.params.spendingRule?.softCut ?? 0),
      hardCut: Number(input.params.spendingRule?.hardCut ?? 0),
      adjustmentAlpha: Number(input.params.spendingRule?.adjustmentAlpha ?? 0),
      recoveryAlpha: Number(input.params.spendingRule?.recoveryAlpha ?? 0),
    },
    bucketMonths: Number(input.params.bucketMonths ?? 0),
    fx: {
      clpUsdInitial: Number(input.params.fx?.clpUsdInitial ?? 0),
      usdEurFixed: Number(input.params.fx?.usdEurFixed ?? 0),
      tcrealLT: Number(input.params.fx?.tcrealLT ?? 0),
      mrHalfLifeYears: Number(input.params.fx?.mrHalfLifeYears ?? 0),
    },
    house: {
      includeHouse: Boolean(input.params.realEstatePolicy?.enabled ?? true),
      saleDelayMonths: Number(input.params.realEstatePolicy?.saleDelayMonths ?? 0),
      triggerRunwayMonths: Number(input.params.realEstatePolicy?.triggerRunwayMonths ?? 0),
      saleCostPct: Number(input.params.realEstatePolicy?.saleCostPct ?? 0),
      realAppreciationAnnual: Number(input.params.realEstatePolicy?.realAppreciationAnnual ?? 0),
    },
    simulation: {
      horizonMonths: Number(input.params.simulation?.horizonMonths ?? 0),
      nSim: Number(input.params.simulation?.nSim ?? 0),
      seed: Number(input.params.simulation?.seed ?? 0),
      blockLength: Number(input.params.simulation?.blockLength ?? 0),
      useHistoricalData: Boolean(input.params.simulation?.useHistoricalData),
    },
    simulationBaseMonth: input.params.simulationBaseMonth ?? null,
    ruinThresholdMonths: Number(input.params.ruinThresholdMonths ?? 0),
    sources: {
      aurumSnapshotSignature: input.aurumSnapshotSignature,
      instrumentUniverseHash: input.instrumentUniverseHash,
      simulationConfigHash: input.simulationConfigHash,
    },
  };
  const manualLocalAdjustmentsAffectEngine = Boolean(
    input.capitalDerivationDiagnostics?.manualLocalAdjustmentsAffectEngine,
  );
  const effectiveEngineInputHash = hashString(stableSerialize(normalizedInput));
  const diagnosticInput: Record<string, unknown> = {
    flags: {
      weightsSourceMode: input.weightsSourceMode,
      universeSourceOrigin: input.universeSourceOrigin,
      simulationConfigSource: input.simulationConfigSource,
      includeRiskCapital: input.riskCapitalEnabled,
      cloudHydrated: input.hydratedCloudSources,
    },
    runtimeDiagnostics: input.runtimeDiagnostics ?? {},
    authDiagnostics: input.authDiagnostics ?? {},
    instrumentUniverseDiagnostics: input.instrumentUniverseDiagnostics ?? {},
    fieldSources: input.fieldSources ?? {},
    cloudConfig: input.simulationConfigDiagnostics ?? null,
    capitalDerivation: input.capitalDerivationDiagnostics ?? {},
    sources: {
      aurumSnapshotSignature: input.aurumSnapshotSignature,
      instrumentUniverseHash: input.instrumentUniverseHash,
      simulationConfigHash: input.simulationConfigHash,
    },
  };

  const sources = buildSources(input);
  const warnings: string[] = [];

  if (!input.hydratedCloudSources) {
    warnings.push('Hydratación cloud incompleta: resultado potencialmente provisional.');
  }
  if (sources.simulationParams.source !== 'cloud') {
    warnings.push('Parámetros de simulación no vienen desde cloud canónico.');
  }
  if (input.simulationConfigDiagnostics?.readStatus === 'error') {
    warnings.push(`Config cloud no hidratada: ${input.simulationConfigDiagnostics.errorMessage ?? 'error desconocido'}.`);
  }
  if (input.simulationConfigDiagnostics?.readStatus === 'missing') {
    warnings.push('Config cloud no existe: usando fallback local no comparable cross-device.');
  }
  if (sources.instrumentUniverse.source === 'local_cache') {
    warnings.push('Instrument Universe desde cache local: valida sincronización cross-device.');
  }
  if (sources.instrumentUniverse.source === 'bundled') {
    warnings.push('Instrument Universe usando versión bundled canónica; válido cross-browser mientras cloud no exista.');
  }
  const manualAdjustmentsCount = Number(input.capitalDerivationDiagnostics?.manualAdjustmentsCount ?? 0);
  if (manualLocalAdjustmentsAffectEngine) {
    warnings.push('Ajustes manuales locales siguen contaminando el input canónico: revisar antes de comparar dispositivos.');
  } else if (manualAdjustmentsCount > 0) {
    warnings.push('Hay ajustes manuales locales fuera del modo canónico: no cambian el input M8 comparable.');
  }
  if (!input.aurumSnapshotSignature) {
    warnings.push('Snapshot Aurum sin firma cloud aplicada.');
  }

  const replayTrace = buildM8ReplayTrace({
    paramsLabel: input.params.label ?? null,
    effectiveEngineInput: normalizedInput,
    effectiveEngineInputFingerprint: effectiveEngineInputHash,
    m8Fingerprint: effectiveEngineInputHash,
    diagnosticFingerprint: 'pending-diagnostic-fingerprint',
    simulationConfigSource: input.simulationConfigSource,
    simulationConfigSavedAt: input.simulationConfigSavedAt,
    simulationConfigHash: input.simulationConfigHash,
    simulationConfigDiagnostics: input.simulationConfigDiagnostics,
    weightsSourceMode: input.weightsSourceMode,
    universeSourceOrigin: input.universeSourceOrigin,
    instrumentUniverseSavedAt: input.instrumentUniverseSavedAt,
    instrumentUniverseHash: input.instrumentUniverseHash,
    instrumentUniverseDiagnostics: input.instrumentUniverseDiagnostics,
    aurumSnapshotMonth: input.aurumSnapshotMonth,
    aurumSnapshotLabel: input.aurumSnapshotLabel,
    aurumSnapshotPublishedAt: input.aurumSnapshotPublishedAt,
    aurumSnapshotSignature: input.aurumSnapshotSignature,
    runtimeDiagnostics: input.runtimeDiagnostics,
    fieldSources: input.fieldSources,
    capitalDerivationDiagnostics: input.capitalDerivationDiagnostics,
    warnings,
  });
  diagnosticInput.replayTrace = replayTrace;
  diagnosticInput.sourcePolicy = replayTrace.sourcePolicy;
  const diagnosticHash = hashString(stableSerialize(diagnosticInput));
  const finalReplayTrace = buildM8ReplayTrace({
    paramsLabel: input.params.label ?? null,
    effectiveEngineInput: normalizedInput,
    effectiveEngineInputFingerprint: effectiveEngineInputHash,
    m8Fingerprint: effectiveEngineInputHash,
    diagnosticFingerprint: diagnosticHash,
    simulationConfigSource: input.simulationConfigSource,
    simulationConfigSavedAt: input.simulationConfigSavedAt,
    simulationConfigHash: input.simulationConfigHash,
    simulationConfigDiagnostics: input.simulationConfigDiagnostics,
    weightsSourceMode: input.weightsSourceMode,
    universeSourceOrigin: input.universeSourceOrigin,
    instrumentUniverseSavedAt: input.instrumentUniverseSavedAt,
    instrumentUniverseHash: input.instrumentUniverseHash,
    instrumentUniverseDiagnostics: input.instrumentUniverseDiagnostics,
    aurumSnapshotMonth: input.aurumSnapshotMonth,
    aurumSnapshotLabel: input.aurumSnapshotLabel,
    aurumSnapshotPublishedAt: input.aurumSnapshotPublishedAt,
    aurumSnapshotSignature: input.aurumSnapshotSignature,
    runtimeDiagnostics: input.runtimeDiagnostics,
    fieldSources: input.fieldSources,
    capitalDerivationDiagnostics: input.capitalDerivationDiagnostics,
    warnings,
  });
  return {
    hash: effectiveEngineInputHash,
    effectiveEngineInputHash,
    diagnosticHash,
    hashIncludesDiagnostics: false,
    manualLocalAdjustmentsAffectEngine,
    normalizedInput,
    diagnosticInput: {
      ...diagnosticInput,
      replayTrace: finalReplayTrace,
      sourcePolicy: finalReplayTrace.sourcePolicy,
    },
    sources,
    warnings,
    createdAt: new Date().toISOString(),
  };
}
