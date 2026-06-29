export type SourcePolicyStatus =
  | 'canonical_pure'
  | 'canonical_with_warnings'
  | 'using_recent_fallback'
  | 'not_comparable';

export type SourcePolicyPhotoStatus =
  | 'current_snapshot'
  | 'recent_snapshot'
  | 'stale_snapshot'
  | 'missing_snapshot'
  | 'unknown';

export type SourcePolicySourceRole =
  | 'effective_primary'
  | 'effective_fallback'
  | 'display_cache'
  | 'draft_only'
  | 'not_effective_for_run';

export type SourcePolicyFreshness = {
  observedAt: string | null;
  ageDays: number | null;
  freshness: 'fresh' | 'recent' | 'stale' | 'unknown';
  maxAcceptedAgeDays: number | null;
  expired: boolean;
};

export type SourcePolicyEntry = {
  id: string;
  label: string;
  source: string;
  role: SourcePolicySourceRole;
  usedForRun: boolean;
  savedAt: string | null;
  hash: string | null;
  freshness: SourcePolicyFreshness;
  warning: string | null;
};

export type SourceFreshnessPolicy = {
  status: SourcePolicyStatus;
  label: string;
  shortLabel: string;
  isComparable: boolean;
  isPureCanonical: boolean;
  effectiveSourceSummary: string;
  photoStatus: SourcePolicyPhotoStatus;
  freshness: SourcePolicyFreshness;
  sources: SourcePolicyEntry[];
  warnings: string[];
  blockingReasons: string[];
  forbiddenSourcesUsed: string[];
};

export type BuildSourceFreshnessPolicyInput = {
  nowMs?: number;
  canonicalInputReady: boolean;
  blockedReason?: string | null;
  hasReplayTrace: boolean;
  m8Fingerprint: string | null;
  diagnosticFingerprint: string | null;
  simulationActiveV1: {
    source: 'cloud' | 'local_cache' | 'fallback';
    savedAt: string | null;
    hash: string | null;
    readStatus: string | null;
    exists: boolean | null;
    missingFields: string[];
    legacyGlobalReadStatus?: string | null;
    legacyGlobalExists?: boolean | null;
  };
  instrumentUniverse: {
    source: 'cloud' | 'bundled' | 'local_cache' | 'none' | 'fallback';
    sourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
    weightsMode: string;
    savedAt: string | null;
    hash: string | null;
    cloudReadStatus: string | null;
    localCacheAvailable?: boolean | null;
  };
  aurumSnapshot: {
    source: 'cloud' | 'fallback';
    month: string | null;
    label: string | null;
    publishedAt: string | null;
    hash: string | null;
  };
  localDiagnostics?: {
    persistedBaseExists?: boolean;
    localReadOnlyFallbackActive?: boolean;
  };
  capitalDerivation?: {
    manualAdjustmentsCount?: number | null;
    manualAdjustmentsSource?: string | null;
    manualLocalAdjustmentsAffectEngine?: boolean | null;
  };
  warnings?: string[];
};

const EXPIRED_EFFECTIVE_SOURCE_WARNING_LABELS: Record<string, string> = {
  simulationActiveV1: 'simulation_config_effective_source_expired',
  instrumentUniverse: 'instrument_universe_effective_source_expired',
  aurumSnapshot: 'aurum_snapshot_effective_source_expired',
};

const RECENT_FALLBACK_MAX_AGE_DAYS = 14;
const INSTRUMENT_UNIVERSE_MAX_AGE_DAYS = 60;
const CURRENT_SNAPSHOT_MAX_AGE_DAYS = 45;
const RECENT_SNAPSHOT_MAX_AGE_DAYS = 120;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const parseIso = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dedupe = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));

const formatMonthShort = (value: string | null | undefined): string | null => {
  const parsed = parseIso(value);
  if (parsed === null) return null;
  return new Date(parsed).toLocaleDateString('es-CL', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function addExpiredEffectiveSourceWarning(entry: SourcePolicyEntry): SourcePolicyEntry {
  if (!entry.usedForRun || !entry.freshness.expired) return entry;
  const expiryWarning = `${entry.label}${entry.source === 'cloud' ? ' cloud' : ''} esta vencido segun politica de frescura; sigue siendo fuente efectiva ${entry.source}, pero requiere revision.`;
  return {
    ...entry,
    warning: entry.warning ? `${entry.warning} · ${expiryWarning}` : expiryWarning,
  };
}

function buildFreshness(
  savedAt: string | null,
  nowMs: number,
  maxAcceptedAgeDays: number | null,
): SourcePolicyFreshness {
  const parsed = parseIso(savedAt);
  if (parsed === null) {
    return {
      observedAt: savedAt,
      ageDays: null,
      freshness: 'unknown',
      maxAcceptedAgeDays,
      expired: maxAcceptedAgeDays !== null,
    };
  }
  const ageDays = Math.max(0, (nowMs - parsed) / (1000 * 60 * 60 * 24));
  const roundedAgeDays = Number(ageDays.toFixed(3));
  const freshness =
    ageDays <= 2
      ? 'fresh'
      : ageDays <= RECENT_SNAPSHOT_MAX_AGE_DAYS
        ? 'recent'
        : 'stale';
  return {
    observedAt: savedAt,
    ageDays: roundedAgeDays,
    freshness,
    maxAcceptedAgeDays,
    expired: maxAcceptedAgeDays !== null && ageDays > maxAcceptedAgeDays,
  };
}

function resolvePhotoStatus(input: BuildSourceFreshnessPolicyInput, nowMs: number): SourcePolicyPhotoStatus {
  if (!input.aurumSnapshot.hash && !input.aurumSnapshot.publishedAt) return 'missing_snapshot';
  const parsed = parseIso(input.aurumSnapshot.publishedAt);
  if (parsed === null) return 'unknown';
  const ageDays = (nowMs - parsed) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays < 0) return 'unknown';
  if (ageDays <= CURRENT_SNAPSHOT_MAX_AGE_DAYS) return 'current_snapshot';
  if (ageDays <= RECENT_SNAPSHOT_MAX_AGE_DAYS) return 'recent_snapshot';
  return 'stale_snapshot';
}

function photoStatusLabel(status: SourcePolicyPhotoStatus, publishedAt: string | null): string {
  const month = formatMonthShort(publishedAt);
  if (status === 'current_snapshot') return month ? `Foto ${month}` : 'Foto vigente';
  if (status === 'recent_snapshot') return month ? `Foto ${month}` : 'Foto reciente';
  if (status === 'stale_snapshot') return month ? `Foto ${month}` : 'Foto antigua';
  if (status === 'missing_snapshot') return 'Sin foto';
  return 'Foto sin fecha';
}

export function buildSourceFreshnessPolicy(input: BuildSourceFreshnessPolicyInput): SourceFreshnessPolicy {
  const nowMs = input.nowMs ?? Date.now();
  const baseWarnings = dedupe(input.warnings ?? []);
  const blockingReasons = dedupe([
    input.canonicalInputReady ? null : stringOrNull(input.blockedReason) ?? 'canonical_input_not_ready',
    !input.hasReplayTrace ? 'missing_replay_trace' : null,
    !input.m8Fingerprint ? 'missing_m8_fingerprint' : null,
    !input.diagnosticFingerprint ? 'missing_diagnostic_fingerprint' : null,
  ]);

  const simulationConfigFreshness = buildFreshness(input.simulationActiveV1.savedAt, nowMs, RECENT_FALLBACK_MAX_AGE_DAYS);
  const instrumentUniverseFreshness = buildFreshness(input.instrumentUniverse.savedAt, nowMs, INSTRUMENT_UNIVERSE_MAX_AGE_DAYS);
  const snapshotFreshness = buildFreshness(input.aurumSnapshot.publishedAt, nowMs, RECENT_SNAPSHOT_MAX_AGE_DAYS);
  const photoStatus = resolvePhotoStatus(input, nowMs);
  const localDraftExists = Boolean(input.localDiagnostics?.persistedBaseExists);
  const localReadOnlyFallbackActive = Boolean(input.localDiagnostics?.localReadOnlyFallbackActive);
  const manualAdjustmentsCount = Number(input.capitalDerivation?.manualAdjustmentsCount ?? 0);
  const manualAdjustmentsSource = stringOrNull(input.capitalDerivation?.manualAdjustmentsSource);
  const manualAdjustmentsAffectEngine = Boolean(input.capitalDerivation?.manualLocalAdjustmentsAffectEngine);

  const sources: SourcePolicyEntry[] = [
    {
      id: 'simulationActiveV1',
      label: 'Modelo Base',
      source: input.simulationActiveV1.source,
      role: input.simulationActiveV1.source === 'cloud' ? 'effective_primary' : 'effective_fallback',
      usedForRun: true,
      savedAt: input.simulationActiveV1.savedAt,
      hash: input.simulationActiveV1.hash,
      freshness: simulationConfigFreshness,
      warning: input.simulationActiveV1.source === 'cloud' ? null : 'Fuente de reserva para parámetros de simulación',
    },
    {
      id: 'instrumentUniverse',
      label: 'Instrument Universe',
      source: input.instrumentUniverse.source,
      role:
        input.instrumentUniverse.weightsMode === 'instrument-universe'
          ? input.instrumentUniverse.source === 'cloud'
            ? 'effective_primary'
            : 'effective_fallback'
          : 'not_effective_for_run',
      usedForRun: input.instrumentUniverse.weightsMode === 'instrument-universe',
      savedAt: input.instrumentUniverse.savedAt,
      hash: input.instrumentUniverse.hash,
      freshness: instrumentUniverseFreshness,
      warning:
        input.instrumentUniverse.source === 'bundled'
          ? 'Versión bundled aplicada como respaldo'
          : input.instrumentUniverse.source === 'local_cache'
            ? 'Cache local aplicada como fuente efectiva'
            : input.instrumentUniverse.source === 'none'
              ? 'No hay Instrument Universe efectivo'
              : null,
    },
    {
      id: 'aurumSnapshot',
      label: 'Snapshot Aurum',
      source: input.aurumSnapshot.source,
      role: input.aurumSnapshot.source === 'cloud' ? 'effective_primary' : 'effective_fallback',
      usedForRun: true,
      savedAt: input.aurumSnapshot.publishedAt,
      hash: input.aurumSnapshot.hash,
      freshness: snapshotFreshness,
      warning:
        photoStatus === 'stale_snapshot'
          ? 'Foto Aurum antigua'
          : photoStatus === 'missing_snapshot'
            ? 'Sin snapshot auditable'
            : null,
    },
  ];

  if (localDraftExists) {
    sources.push({
      id: 'local_base_draft',
      label: 'Borrador local',
      source: 'localStorage:midas:base-vigente.v1',
      role: 'draft_only',
      usedForRun: false,
      savedAt: null,
      hash: null,
      freshness: buildFreshness(null, nowMs, null),
      warning: 'Existe borrador local no usado como fuente canónica',
    });
  }

  if (input.instrumentUniverse.localCacheAvailable && input.instrumentUniverse.source !== 'local_cache') {
    sources.push({
      id: 'instrument_universe_local_cache',
      label: 'Instrument Universe cache local',
      source: 'cache-local',
      role: 'display_cache',
      usedForRun: false,
      savedAt: input.instrumentUniverse.savedAt,
      hash: input.instrumentUniverse.hash,
      freshness: instrumentUniverseFreshness,
      warning: 'Existe cache local, pero no es la fuente efectiva de la corrida',
    });
  }

  if (manualAdjustmentsSource) {
    sources.push({
      id: 'manual_capital_adjustments',
      label: 'Ajustes manuales',
      source: manualAdjustmentsSource,
      role: manualAdjustmentsAffectEngine ? 'effective_fallback' : 'draft_only',
      usedForRun: manualAdjustmentsAffectEngine,
      savedAt: null,
      hash: null,
      freshness: buildFreshness(null, nowMs, null),
      warning: manualAdjustmentsAffectEngine
        ? 'Ajustes manuales locales alteran el input comparable'
        : 'Hay ajustes manuales locales, pero fueron excluidos del input comparable',
    });
  }

  const effectiveSources = sources.map(addExpiredEffectiveSourceWarning);

  const forbiddenSourcesUsed = dedupe([
    input.simulationActiveV1.source === 'local_cache' && simulationConfigFreshness.expired ? 'simulation_config_local_cache_stale' : null,
    input.simulationActiveV1.source === 'local_cache' && !input.simulationActiveV1.hash ? 'simulation_config_local_cache_without_hash' : null,
    input.simulationActiveV1.source === 'fallback' ? 'simulation_config_fallback_effective' : null,
    input.instrumentUniverse.weightsMode === 'instrument-universe' && input.instrumentUniverse.source === 'bundled'
      ? 'instrument_universe_bundled_effective'
      : null,
    input.instrumentUniverse.weightsMode === 'instrument-universe' && input.instrumentUniverse.source === 'local_cache'
      ? 'instrument_universe_local_cache_effective'
      : null,
    input.instrumentUniverse.weightsMode === 'instrument-universe' && input.instrumentUniverse.source === 'none'
      ? 'instrument_universe_missing_effective'
      : null,
    photoStatus === 'stale_snapshot' ? 'aurum_snapshot_stale' : null,
    photoStatus === 'missing_snapshot' ? 'aurum_snapshot_missing' : null,
    manualAdjustmentsAffectEngine ? 'manual_local_adjustments_effective' : null,
    input.simulationActiveV1.legacyGlobalExists ? 'legacy_global_config_detected' : null,
  ]);

  const warnings = dedupe([
    ...baseWarnings,
    ...effectiveSources
      .filter((entry) => entry.usedForRun && entry.freshness.expired)
      .map((entry) => EXPIRED_EFFECTIVE_SOURCE_WARNING_LABELS[entry.id] ?? `${entry.id}_effective_source_expired`),
    localDraftExists ? 'local_base_draft_present_not_used' : null,
    localReadOnlyFallbackActive ? 'local_read_only_fallback_active' : null,
    input.instrumentUniverse.localCacheAvailable && input.instrumentUniverse.source !== 'local_cache'
      ? 'instrument_universe_local_cache_present_not_used'
      : null,
    manualAdjustmentsCount > 0 && !manualAdjustmentsAffectEngine ? 'manual_local_adjustments_stripped' : null,
    input.simulationActiveV1.legacyGlobalReadStatus ? `legacy_global_${input.simulationActiveV1.legacyGlobalReadStatus}` : null,
    photoStatus === 'recent_snapshot' ? 'aurum_snapshot_recent_not_current' : null,
    photoStatus === 'unknown' ? 'aurum_snapshot_unknown_age' : null,
  ]);

  const effectiveFallbacks = effectiveSources.filter((entry) => entry.usedForRun && entry.role === 'effective_fallback');
  const hasRecentTraceableFallback = effectiveFallbacks.length === 1
    && forbiddenSourcesUsed.length === 0
    && Boolean(effectiveFallbacks[0].hash)
    && !effectiveFallbacks[0].freshness.expired
    && effectiveFallbacks[0].freshness.freshness !== 'unknown';

  let status: SourcePolicyStatus;
  if (blockingReasons.length > 0 || forbiddenSourcesUsed.length > 0) {
    status = 'not_comparable';
  } else if (hasRecentTraceableFallback) {
    status = 'using_recent_fallback';
  } else if (warnings.length > 0) {
    status = 'canonical_with_warnings';
  } else {
    status = 'canonical_pure';
  }

  return {
    status,
    label:
      status === 'canonical_pure'
        ? 'Canónico puro'
        : status === 'canonical_with_warnings'
          ? 'Canónico con aviso'
          : status === 'using_recent_fallback'
            ? 'Reserva reciente'
            : 'No comparable',
    shortLabel:
      status === 'canonical_pure'
        ? 'Canónico'
        : status === 'canonical_with_warnings'
          ? 'Canónico + aviso'
          : status === 'using_recent_fallback'
            ? 'Reserva'
            : 'No comparable',
    isComparable: status !== 'not_comparable',
    isPureCanonical: status === 'canonical_pure',
    effectiveSourceSummary: [
      input.simulationActiveV1.source === 'cloud'
        ? 'Modelo Base cloud'
        : input.simulationActiveV1.source === 'local_cache'
          ? 'Modelo Base cache local'
          : 'Modelo Base fallback',
      input.instrumentUniverse.weightsMode === 'instrument-universe'
        ? input.instrumentUniverse.source === 'cloud'
          ? 'Universe cloud'
          : input.instrumentUniverse.source === 'bundled'
            ? 'Universe bundled'
            : input.instrumentUniverse.source === 'local_cache'
              ? 'Universe local'
              : 'Universe faltante'
        : 'Mix respaldo',
      photoStatusLabel(photoStatus, input.aurumSnapshot.publishedAt),
    ].join(' · '),
    photoStatus,
    freshness: snapshotFreshness,
    sources: effectiveSources,
    warnings,
    blockingReasons,
    forbiddenSourcesUsed,
  };
}
