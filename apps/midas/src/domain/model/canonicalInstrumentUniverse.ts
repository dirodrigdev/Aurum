import {
  buildInstrumentUniverseSnapshotMetadata,
  type InstrumentUniverseSnapshot,
  type InstrumentUniverseSnapshotMetadata,
  validateInstrumentUniverseJson,
  validateInstrumentUniverseSnapshot,
} from '../instrumentUniverse';
import {
  BUNDLED_INSTRUMENT_UNIVERSE_FILE_NAME,
  BUNDLED_INSTRUMENT_UNIVERSE_RAW,
  BUNDLED_INSTRUMENT_UNIVERSE_SAVED_AT,
} from '../../data/instrumentUniverseBundled';
import {
  deriveOfficialDistributionWeights,
  deriveInstrumentUniverseDistributionWeights,
  isMissingInstrumentUniverseMode,
  normalizePortfolioWeights,
  resolveEffectiveMixFromUniverseFirst,
  type EffectiveMixDiagnostics,
  type EffectiveMixResolution,
} from './officialDistribution';
import type { InstrumentBaseSnapshot } from '../instrumentBase';
import type { PortfolioWeights, ReturnAssumptions } from './types';

const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const bundledValidationRaw = BUNDLED_INSTRUMENT_UNIVERSE_RAW
  ? validateInstrumentUniverseJson(BUNDLED_INSTRUMENT_UNIVERSE_RAW)
  : null;
const bundledSnapshot = bundledValidationRaw?.ok && bundledValidationRaw.snapshot
  ? { ...bundledValidationRaw.snapshot, savedAt: BUNDLED_INSTRUMENT_UNIVERSE_SAVED_AT ?? bundledValidationRaw.snapshot.savedAt }
  : null;
const bundledValidation = bundledSnapshot
  ? validateInstrumentUniverseSnapshot(bundledSnapshot)
  : null;
const bundledMetadata = bundledSnapshot && bundledValidation
  ? buildInstrumentUniverseSnapshotMetadata(bundledSnapshot, bundledValidation, {
      fileName: BUNDLED_INSTRUMENT_UNIVERSE_FILE_NAME,
      source: 'bundled',
      loadedAt: BUNDLED_INSTRUMENT_UNIVERSE_SAVED_AT ?? bundledSnapshot.savedAt,
    })
  : null;

export type CanonicalInstrumentUniverseSource =
  | 'cloud'
  | 'bundled'
  | 'local_cache'
  | 'missing-instrument-universe'
  | 'error';
export type CanonicalUniverseSourceOrigin = 'firestore' | 'bundled' | 'cache-local' | 'none';

export type InstrumentUniverseDiagnostics = {
  requestedSourceMode: 'cloud_first';
  effectiveSource: CanonicalInstrumentUniverseSource;
  effectiveHash: string | null;
  effectiveVersion: number | null;
  cloudAvailable: boolean;
  cloudHash: string | null;
  bundledAvailable: boolean;
  bundledHash: string | null;
  localCacheAvailable: boolean;
  localCacheHash: string | null;
  localCacheAccepted: boolean;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  weightsResolvedFrom: CanonicalInstrumentUniverseSource;
  rvRf: { rv: number; rf: number } | null;
  globalLocal: { global: number; local: number } | null;
};

export type CanonicalInstrumentUniverseState = {
  universeWeights: PortfolioWeights | null;
  instrumentBaseWeights: PortfolioWeights | null;
  activeWeights: PortfolioWeights;
  weightsSourceMode: EffectiveMixResolution['weightsSourceMode'];
  activeWeightsSavedAt: string | null;
  fallbackReason: string | null;
  universeSourceOrigin: CanonicalUniverseSourceOrigin;
  diagnostics: EffectiveMixDiagnostics;
  metadata: InstrumentUniverseSnapshotMetadata | null;
  snapshot: InstrumentUniverseSnapshot | null;
  instrumentUniverseDiagnostics: InstrumentUniverseDiagnostics;
};

const summarizeWeights = (weights: PortfolioWeights | null) => {
  if (!weights) return { rvRf: null, globalLocal: null };
  const normalized = normalizePortfolioWeights(weights);
  return {
    rvRf: {
      rv: normalized.rvGlobal + normalized.rvChile,
      rf: normalized.rfGlobal + normalized.rfChile,
    },
    globalLocal: {
      global: normalized.rvGlobal + normalized.rfGlobal,
      local: normalized.rvChile + normalized.rfChile,
    },
  };
};

export function getBundledInstrumentUniverseSnapshot(): InstrumentUniverseSnapshot | null {
  return bundledSnapshot ? { ...bundledSnapshot, instruments: [...bundledSnapshot.instruments] } : null;
}

export function getBundledInstrumentUniverseMetadata(): InstrumentUniverseSnapshotMetadata | null {
  return bundledMetadata ? { ...bundledMetadata } : null;
}

export function resolveCanonicalInstrumentUniverseState(input: {
  cloudSnapshot: InstrumentUniverseSnapshot | null;
  cloudMetadata?: InstrumentUniverseSnapshotMetadata | null;
  localCacheSnapshot: InstrumentUniverseSnapshot | null;
  localCacheMetadata?: InstrumentUniverseSnapshotMetadata | null;
  instrumentBaseSnapshot: InstrumentBaseSnapshot | null;
  bundledSnapshotOverride?: InstrumentUniverseSnapshot | null;
  bundledMetadataOverride?: InstrumentUniverseSnapshotMetadata | null;
  returns: Pick<ReturnAssumptions, 'rfGlobalAnnual' | 'rfChileUFAnnual'>;
  defaultWeights: PortfolioWeights;
}): CanonicalInstrumentUniverseState {
  const bundledSnapshotValue = Object.prototype.hasOwnProperty.call(input, 'bundledSnapshotOverride')
    ? (input.bundledSnapshotOverride ?? null)
    : getBundledInstrumentUniverseSnapshot();
  const bundledMetadataValue = Object.prototype.hasOwnProperty.call(input, 'bundledMetadataOverride')
    ? (input.bundledMetadataOverride ?? null)
    : getBundledInstrumentUniverseMetadata();
  const cloudDerived = deriveInstrumentUniverseDistributionWeights({
    snapshot: input.cloudSnapshot,
    returns: input.returns,
  });
  const bundledDerived = deriveInstrumentUniverseDistributionWeights({
    snapshot: bundledSnapshotValue,
    returns: input.returns,
  });
  const instrumentBaseWeights = deriveOfficialDistributionWeights(input.instrumentBaseSnapshot);
  const localCacheHash = input.localCacheMetadata?.checksum
    ?? (input.localCacheSnapshot?.rawJson ? hashString(input.localCacheSnapshot.rawJson) : null);

  const resolveFromUniverse = (
    source: 'cloud' | 'bundled',
    snapshot: InstrumentUniverseSnapshot,
    metadata: InstrumentUniverseSnapshotMetadata | null,
    derived: NonNullable<typeof cloudDerived>,
  ): CanonicalInstrumentUniverseState => {
    const resolved = resolveEffectiveMixFromUniverseFirst({
      universeWeights: derived.weights,
      instrumentBaseWeights,
      defaultWeights: input.defaultWeights,
      universeSavedAt: metadata?.loadedAt ?? snapshot.savedAt,
      instrumentBaseSavedAt: input.instrumentBaseSnapshot?.savedAt ?? null,
      diagnostics: derived.diagnostics,
      universeSourceMode: source === 'cloud' ? 'instrument-universe-cloud' : 'instrument-universe-bundled',
    });
    const summaries = summarizeWeights(resolved.activeWeights);
    return {
      universeWeights: resolved.universeWeights,
      instrumentBaseWeights: resolved.instrumentBaseWeights,
      activeWeights: resolved.activeWeights,
      weightsSourceMode: resolved.weightsSourceMode,
      activeWeightsSavedAt: resolved.activeWeightsSavedAt,
      fallbackReason: source === 'bundled' && !input.cloudSnapshot ? 'cloud_universe_missing_using_bundled' : source === 'bundled' ? 'cloud_universe_invalid_using_bundled' : null,
      universeSourceOrigin: source === 'cloud' ? 'firestore' : 'bundled',
      diagnostics: resolved.diagnostics,
      metadata,
      snapshot,
      instrumentUniverseDiagnostics: {
        requestedSourceMode: 'cloud_first',
        effectiveSource: source,
        effectiveHash: metadata?.checksum ?? null,
        effectiveVersion: snapshot.version,
        cloudAvailable: Boolean(input.cloudSnapshot && cloudDerived),
        cloudHash: input.cloudMetadata?.checksum ?? null,
        bundledAvailable: Boolean(bundledSnapshotValue && bundledDerived),
        bundledHash: bundledMetadataValue?.checksum ?? null,
        localCacheAvailable: Boolean(input.localCacheSnapshot),
        localCacheHash: localCacheHash,
        localCacheAccepted: false,
        fallbackUsed: source !== 'cloud',
        fallbackReason: source === 'bundled' && !input.cloudSnapshot ? 'cloud_universe_missing_using_bundled' : source === 'bundled' ? 'cloud_universe_invalid_using_bundled' : null,
        weightsResolvedFrom: source,
        rvRf: summaries.rvRf,
        globalLocal: summaries.globalLocal,
      },
    };
  };

  if (input.cloudSnapshot && input.cloudMetadata && cloudDerived) {
    return resolveFromUniverse('cloud', input.cloudSnapshot, input.cloudMetadata, cloudDerived);
  }
  if (bundledSnapshotValue && bundledMetadataValue && bundledDerived) {
    return resolveFromUniverse('bundled', bundledSnapshotValue, bundledMetadataValue, bundledDerived);
  }

  const resolved = resolveEffectiveMixFromUniverseFirst({
    universeWeights: null,
    instrumentBaseWeights,
    defaultWeights: input.defaultWeights,
    instrumentBaseSavedAt: input.instrumentBaseSnapshot?.savedAt ?? null,
    diagnostics: null,
  });
  const summaries = summarizeWeights(resolved.activeWeights);
  const effectiveSource: CanonicalInstrumentUniverseSource = isMissingInstrumentUniverseMode(resolved.weightsSourceMode)
    ? 'missing-instrument-universe'
    : 'error';
  return {
    universeWeights: resolved.universeWeights,
    instrumentBaseWeights: resolved.instrumentBaseWeights,
    activeWeights: resolved.activeWeights,
    weightsSourceMode: resolved.weightsSourceMode,
    activeWeightsSavedAt: resolved.activeWeightsSavedAt,
    fallbackReason: resolved.fallbackReason,
    universeSourceOrigin: 'none',
    diagnostics: resolved.diagnostics,
    metadata: null,
    snapshot: null,
    instrumentUniverseDiagnostics: {
      requestedSourceMode: 'cloud_first',
      effectiveSource,
      effectiveHash: null,
      effectiveVersion: null,
      cloudAvailable: Boolean(input.cloudSnapshot && cloudDerived),
      cloudHash: input.cloudMetadata?.checksum ?? null,
      bundledAvailable: Boolean(bundledSnapshotValue && bundledDerived),
      bundledHash: bundledMetadataValue?.checksum ?? null,
      localCacheAvailable: Boolean(input.localCacheSnapshot),
      localCacheHash,
      localCacheAccepted: false,
      fallbackUsed: true,
      fallbackReason: resolved.fallbackReason,
      weightsResolvedFrom: effectiveSource,
      rvRf: summaries.rvRf,
      globalLocal: summaries.globalLocal,
    },
  };
}
