import type { ModelParameters } from './types';

export type M8InputFingerprintSource = {
  source: 'cloud' | 'local_cache' | 'fallback' | 'mixed' | 'unknown';
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
  riskCapitalEnabled: boolean;
  riskCapitalEffective: boolean;
  weightsSourceMode: string;
  universeSourceOrigin: 'firestore' | 'cache-local' | 'none';
  aurumSnapshotLabel: string | null;
  aurumSnapshotPublishedAt: string | null;
  aurumSnapshotSignature: string | null;
  simulationConfigSource: 'cloud' | 'local_cache' | 'fallback';
  simulationConfigSavedAt: string | null;
  simulationConfigHash: string | null;
  instrumentUniverseSavedAt: string | null;
  instrumentUniverseHash: string | null;
  hydratedCloudSources: boolean;
};

export type M8InputFingerprint = {
  hash: string;
  normalizedInput: Record<string, unknown>;
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

function buildSources(input: M8InputFingerprintInput): M8InputFingerprintSources {
  const mixSource =
    input.weightsSourceMode === 'instrument-universe'
      ? (input.universeSourceOrigin === 'firestore' ? 'cloud' : 'local_cache')
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
      detail: input.hydratedCloudSources ? 'cloud_hydrated' : 'pending_hydration',
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
  const normalizedInput = {
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
    bucketMonths: Number(input.params.bucketMonths ?? 0),
    fx: {
      clpUsdInitial: Number(input.params.fx?.clpUsdInitial ?? 0),
      usdEurFixed: Number(input.params.fx?.usdEurFixed ?? 0),
    },
    house: {
      includeHouse: Boolean(input.params.realEstatePolicy?.enabled ?? true),
      saleDelayMonths: Number(input.params.realEstatePolicy?.saleDelayMonths ?? 0),
      triggerRunwayMonths: Number(input.params.realEstatePolicy?.triggerRunwayMonths ?? 0),
    },
    simulation: {
      horizonMonths: Number(input.params.simulation?.horizonMonths ?? 0),
      nSim: Number(input.params.simulation?.nSim ?? 0),
      seed: Number(input.params.simulation?.seed ?? 0),
      blockLength: Number(input.params.simulation?.blockLength ?? 0),
    },
    flags: {
      weightsSourceMode: input.weightsSourceMode,
      includeRiskCapital: input.riskCapitalEnabled,
      cloudHydrated: input.hydratedCloudSources,
    },
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
  if (sources.instrumentUniverse.source === 'local_cache') {
    warnings.push('Instrument Universe desde cache local: valida sincronización cross-device.');
  }
  if (!input.aurumSnapshotSignature) {
    warnings.push('Snapshot Aurum sin firma cloud aplicada.');
  }

  const hash = hashString(stableSerialize(normalizedInput));
  return {
    hash,
    normalizedInput,
    sources,
    warnings,
    createdAt: new Date().toISOString(),
  };
}
