import {
  aggregateRows,
  computeMonthlyRows,
  enumerateMonthKeys,
} from './returnsAnalysis';
import {
  buildGastappMonthlyExpenseCloseSnapshot,
  type GastappMonthlyExpenseCloseInput,
  type GastappMonthlyExpenseCloseSnapshot,
  type WealthMonthlyClosure,
  type WealthCurrency,
  readWealthCloudDocumentForAudit,
} from './wealthStorage';
import type { GastappMonthlyCloseCandidate } from './gastosMonthly';
import {
  getGastappCanonicalV2ConfiguredProjectId,
  GASTAPP_CANONICAL_V2_PROJECT_ID,
  loadGastappCanonicalV2OfficialMonthContractFresh,
} from './gastappCanonicalV2';
import {
  readHistoricalGastappSidecarFromServer,
  type HistoricalGastappSidecarDocument,
} from './historicalGastappSidecar';

const AURUM_PRODUCTION_PROJECT_ID = 'aurum-prod-a1918';

export const HISTORICAL_GASTAPP_BACKFILL_PREVIEW_SCHEMA = 'aurum-gastapp-historical-snapshot-preview-v1';
export const FIRESTORE_MAX_DOCUMENT_BYTES = 1_048_576;
export const FIRESTORE_DOCUMENT_RESERVE_BYTES = 131_072;

export type HistoricalGastappBackfillStatus =
  | 'snapshot_present'
  | 'eligible_for_backfill'
  | 'base_month_non_comparable'
  | 'missing_closure'
  | 'missing_fx'
  | 'gastapp_not_certified'
  | 'gastapp_missing'
  | 'gastapp_invalid'
  | 'gastapp_unavailable'
  | 'conflict_existing_snapshot'
  | 'invalid_wealth_closure'
  | 'fingerprint_mismatch';

type GastappCandidateBlocker = Extract<
  HistoricalGastappBackfillStatus,
  'gastapp_not_certified' | 'gastapp_missing' | 'gastapp_invalid' | 'gastapp_unavailable'
>;

export type HistoricalGastappBackfillCoverage = {
  valid: number;
  expected: number;
};

export type HistoricalGastappBackfillManifestRow = {
  monthKey: string;
  closureId: string | null;
  status: HistoricalGastappBackfillStatus;
  blockers: string[];
  snapshotPresent: boolean;
  candidateStatus: GastappMonthlyCloseCandidate['status'] | null;
  certificationStatus: 'certified' | 'revised' | null;
  totalEur: number | null;
  byFamilyEur: GastappMonthlyCloseCandidate['partialByFamilyEur'];
  canonicalDataHash: string | null;
  operationalDataHash: string | null;
  operationalRevision: number | null;
  sourceGeneration: number | null;
  monthContractRevision: number | null;
  monthContractHash: string | null;
  certificationHash: string | null;
  certificationRevision: number | null;
  contractVersion: string | null;
  generatedAt: string | null;
  fxRates: WealthMonthlyClosure['fxRates'] | null;
  proposedSnapshot?: GastappMonthlyExpenseCloseSnapshot;
  preFingerprint?: string;
  postFingerprint?: string;
  fingerprintsMatch?: boolean;
};

export type HistoricalGastappBackfillPreview = {
  schemaVersion: typeof HISTORICAL_GASTAPP_BACKFILL_PREVIEW_SCHEMA;
  reconstructionAt: string;
  /** Deterministic fingerprint of every persisted closure, independent of root metadata and array order. */
  closureSourceFingerprint: string;
  totalClosures: number;
  baseMonth: string | null;
  lastOfficialMonth: string | null;
  comparableMonths: number;
  snapshotsPresent: number;
  snapshotsToComplete: number;
  blockers: number;
  blockersByStatus: Partial<Record<HistoricalGastappBackfillStatus, number>>;
  coverage: {
    current: {
      sinceStart: HistoricalGastappBackfillCoverage;
      last12m: HistoricalGastappBackfillCoverage;
      ytd: HistoricalGastappBackfillCoverage;
    };
    projected: {
      sinceStart: HistoricalGastappBackfillCoverage;
      last12m: HistoricalGastappBackfillCoverage;
      ytd: HistoricalGastappBackfillCoverage;
    };
  };
  documentSize: {
    available: boolean;
    currentApproxBytes: number | null;
    projectedApproxBytes: number | null;
    incrementApproxBytes: number | null;
    maxBytes: number;
    reserveBytes: number;
    status: 'within_limit' | 'near_limit' | 'over_limit' | 'unavailable';
  };
  sidecarSize: {
    currentApproxBytes: number;
    projectedApproxBytes: number;
    maxBytes: number;
    reserveBytes: number;
    status: 'within_limit' | 'near_limit' | 'over_limit';
  };
  manifest: HistoricalGastappBackfillManifestRow[];
  simulatedClosures: WealthMonthlyClosure[];
  allowedPersistentFields: ['gastappExpenseClose', 'repairAudit'];
  writesPerformed: false;
};

type BuildHistoricalGastappBackfillPreviewInput = {
  closures: readonly WealthMonthlyClosure[];
  candidatesByMonth: Readonly<Record<string, GastappMonthlyCloseCandidate | undefined>>;
  reconstructionAt: string;
  includeRiskCapitalInTotals?: boolean;
  currency?: WealthCurrency;
  /** Raw aurum_wealth document returned by a read-only cloud read. */
  wealthDocument?: Record<string, unknown> | null;
  sidecar?: HistoricalGastappSidecarDocument | null;
};

export type HistoricalGastappBackfillAuditResult = {
  auditedAt: string;
  sources: {
    wealthProjectId: string;
    wealthDocumentExists: boolean;
    wealthUpdatedAt: string | null;
    gastappProjectId: string | null;
    gastappContractVersion: string;
    gastappGeneratedAt: string;
    gastappMonthsRead: number;
    readMode: 'server_only';
  };
  preview: HistoricalGastappBackfillPreview;
};

const FINGERPRINT_FIELDS = [
  'id',
  'monthKey',
  'closedAt',
  'summary',
  'records',
  'fxRates',
  'fxMetadata',
  'fxMissing',
  'previousVersions',
] as const;

const BLOCKER_STATUSES = new Set<HistoricalGastappBackfillStatus>([
  'missing_closure',
  'missing_fx',
  'gastapp_not_certified',
  'gastapp_missing',
  'gastapp_invalid',
  'gastapp_unavailable',
  'conflict_existing_snapshot',
  'invalid_wealth_closure',
  'fingerprint_mismatch',
]);

const monthShift = (monthKey: string, delta: number): string | null => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(monthKey);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const closureFingerprintPayload = (closure: WealthMonthlyClosure | Record<string, unknown>) =>
  Object.fromEntries(FINGERPRINT_FIELDS.map((field) => [field, closure[field]]));

const rawClosuresByMonth = (wealthDocument: Record<string, unknown> | null | undefined) => {
  const rows = Array.isArray(wealthDocument?.closures) ? wealthDocument.closures : [];
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const closure = item as Record<string, unknown>;
    const monthKey = typeof closure.monthKey === 'string' ? closure.monthKey : '';
    if (!monthKey) continue;
    grouped.set(monthKey, [...(grouped.get(monthKey) || []), closure]);
  }
  return grouped;
};

const getRawClosure = (
  monthKey: string,
  closure: WealthMonthlyClosure | undefined,
  groupedRawClosures: Map<string, Record<string, unknown>[]>,
) => {
  const matches = groupedRawClosures.get(monthKey) || [];
  if (closure) {
    const byId = matches.find((raw) => String(raw.id || '') === closure.id);
    if (byId) return byId;
  }
  return matches.length === 1 ? matches[0] : undefined;
};

const normalizeForStableJson = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : normalizeForStableJson(item));
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input)
        .filter((key) => input[key] !== undefined)
        .sort()
        .map((key) => [key, normalizeForStableJson(input[key])]),
    );
  }
  return null;
};

export const stableStringify = (value: unknown) => JSON.stringify(normalizeForStableJson(value));

export const sha256Fingerprint = async (value: unknown): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto no está disponible para calcular fingerprints financieros.');
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
};

/** Fingerprints the complete persisted closure objects, sorted by monthKey/id and stable content. */
export const fingerprintHistoricalClosureSource = async (closures: readonly unknown[]): Promise<string> => {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const sorted = closures.map((closure) => {
    const row = closure && typeof closure === 'object' && !Array.isArray(closure)
      ? closure as Record<string, unknown>
      : {};
    return {
      closure,
      monthKey: typeof row.monthKey === 'string' ? row.monthKey : '',
      id: typeof row.id === 'string' ? row.id : '',
      stableContent: stableStringify(closure),
    };
  }).sort((left, right) => compare(left.monthKey, right.monthKey) ||
    compare(left.id, right.id) || compare(left.stableContent, right.stableContent));
  return sha256Fingerprint(sorted.map(({ closure }) => closure));
};

export const fingerprintHistoricalClosuresInWealthDocument = async (
  wealthDocument: Record<string, unknown> | null | undefined,
): Promise<string> => {
  if (!wealthDocument || !Array.isArray(wealthDocument.closures)) {
    throw new Error('El documento no contiene un array de cierres para verificar.');
  }
  return fingerprintHistoricalClosureSource(wealthDocument.closures);
};

const getCandidateBlocker = (
  candidate: GastappMonthlyCloseCandidate | undefined,
): GastappCandidateBlocker | null => {
  if (!candidate) return 'gastapp_missing';
  if (candidate.status === 'missing') {
    return candidate.partialGastosEur === null ? 'gastapp_missing' : 'gastapp_not_certified';
  }
  if (candidate.status === 'pending' || candidate.status === 'stale') return 'gastapp_not_certified';
  if (candidate.status === 'invalid') return 'gastapp_invalid';
  if (candidate.status === 'unavailable') return 'gastapp_unavailable';
  if (!candidate.snapshot) return 'gastapp_invalid';
  if (candidate.snapshot.certificationStatus !== 'certified' && candidate.snapshot.certificationStatus !== 'revised') {
    return 'gastapp_not_certified';
  }
  return null;
};

const makeCoverage = (
  rows: ReturnType<typeof computeMonthlyRows>,
  expectedMonthKeys: string[],
): HistoricalGastappBackfillCoverage => {
  if (!expectedMonthKeys.length) return { valid: 0, expected: 0 };
  const result = aggregateRows('historical-backfill-preview', 'Preview', rows, null, {
    expectedMonthKeys,
    expectedMonths: expectedMonthKeys.length,
    periodStartMonthKey: expectedMonthKeys[0],
    periodEndMonthKey: expectedMonthKeys.at(-1),
  });
  return { valid: result.coverage.validMonths, expected: result.coverage.expectedMonths };
};

const utf8Size = (value: unknown): number => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('El documento no se puede representar como JSON.');
  return new TextEncoder().encode(json).byteLength;
};

const buildDocumentSizeAssessment = (
  wealthDocument: Record<string, unknown> | null | undefined,
): HistoricalGastappBackfillPreview['documentSize'] => {
  const unavailable = {
    available: false,
    currentApproxBytes: null,
    projectedApproxBytes: null,
    incrementApproxBytes: null,
    maxBytes: FIRESTORE_MAX_DOCUMENT_BYTES,
    reserveBytes: FIRESTORE_DOCUMENT_RESERVE_BYTES,
    status: 'unavailable' as const,
  };
  if (!wealthDocument || !Array.isArray(wealthDocument.closures)) return unavailable;

  try {
    const currentApproxBytes = utf8Size(wealthDocument);
    // The root is never a write target for this repair.
    const projectedApproxBytes = currentApproxBytes;
    const incrementApproxBytes = 0;
    const status: HistoricalGastappBackfillPreview['documentSize']['status'] =
      projectedApproxBytes > FIRESTORE_MAX_DOCUMENT_BYTES
        ? 'over_limit'
        : projectedApproxBytes > FIRESTORE_MAX_DOCUMENT_BYTES - FIRESTORE_DOCUMENT_RESERVE_BYTES
          ? 'near_limit'
          : 'within_limit';
    return {
      available: true,
      currentApproxBytes,
      projectedApproxBytes,
      incrementApproxBytes,
      maxBytes: FIRESTORE_MAX_DOCUMENT_BYTES,
      reserveBytes: FIRESTORE_DOCUMENT_RESERVE_BYTES,
      status,
    };
  } catch {
    return unavailable;
  }
};

const comparableMonthKeys = (closures: WealthMonthlyClosure[]): string[] => {
  if (closures.length < 2) return [];
  const sorted = [...closures].sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  const allMonths = enumerateMonthKeys(sorted[0].monthKey, sorted.at(-1)!.monthKey);
  return allMonths.slice(1);
};

const manifestEntry = (
  monthKey: string,
  closure: WealthMonthlyClosure | undefined,
  candidate: GastappMonthlyCloseCandidate | undefined,
  status: HistoricalGastappBackfillStatus,
  blockers: string[],
  proposedSnapshot?: GastappMonthlyExpenseCloseSnapshot,
): HistoricalGastappBackfillManifestRow => ({
  monthKey,
  closureId: closure?.id ?? null,
  status,
  blockers,
  snapshotPresent: Boolean(closure?.gastappExpenseClose),
  candidateStatus: candidate?.status ?? null,
  certificationStatus: candidate?.snapshot?.certificationStatus ?? null,
  totalEur: candidate?.snapshot?.totalEur ?? candidate?.partialGastosEur ?? null,
  byFamilyEur: candidate?.snapshot?.byFamilyEur ?? candidate?.partialByFamilyEur ?? null,
  canonicalDataHash: candidate?.snapshot?.canonicalDataHash ?? null,
  operationalDataHash: candidate?.snapshot?.operationalDataHash ?? null,
  operationalRevision: candidate?.snapshot?.operationalRevision ?? null,
  sourceGeneration: candidate?.snapshot?.sourceGeneration ?? null,
  monthContractRevision: candidate?.snapshot?.monthContractRevision ?? null,
  monthContractHash: candidate?.snapshot?.monthContractHash ?? null,
  certificationHash: candidate?.snapshot?.certificationHash ?? null,
  certificationRevision: candidate?.snapshot?.certificationRevision ?? null,
  contractVersion: candidate?.snapshot?.contractVersion ?? null,
  generatedAt: candidate?.snapshot?.generatedAt ?? null,
  fxRates: closure?.fxRates ?? null,
  ...(proposedSnapshot ? { proposedSnapshot } : {}),
});

/** Builds a read-only, deterministic manifest and in-memory preview from sealed Aurum closures and Canonical V2 candidates. */
export const buildHistoricalGastappBackfillPreview = async (
  input: BuildHistoricalGastappBackfillPreviewInput,
): Promise<HistoricalGastappBackfillPreview> => {
  const closures = [...input.closures].sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  const reconstructionAt = new Date(input.reconstructionAt);
  if (!Number.isFinite(reconstructionAt.getTime())) throw new Error('reconstructionAt debe ser una fecha ISO válida.');
  const at = reconstructionAt.toISOString();
  const includeRiskCapital = input.includeRiskCapitalInTotals ?? false;
  const currency = input.currency ?? 'CLP';
  const baseMonth = closures[0]?.monthKey ?? null;
  const lastOfficialMonth = closures.at(-1)?.monthKey ?? null;
  const allComparableMonths = comparableMonthKeys(closures);
  const closureByMonth = new Map(closures.map((closure) => [closure.monthKey, closure]));
  const closuresByMonth = new Map<string, number>();
  closures.forEach((closure) => closuresByMonth.set(closure.monthKey, (closuresByMonth.get(closure.monthKey) || 0) + 1));
  const rawByMonth = rawClosuresByMonth(input.wealthDocument);
  const sidecarEntries = input.sidecar?.snapshotsByMonth || {};
  const withExistingSidecar = closures.map((closure) => {
    const entry = sidecarEntries[closure.monthKey];
    return !closure.gastappExpenseClose && entry?.closureId === closure.id
      ? { ...closure, gastappExpenseClose: entry.snapshot }
      : closure;
  });
  const currentRows = computeMonthlyRows(withExistingSidecar, includeRiskCapital, currency);
  const rowByMonth = new Map(currentRows.map((row) => [row.monthKey, row]));
  const manifest: HistoricalGastappBackfillManifestRow[] = [];

  if (baseMonth) {
    const baseClosure = closureByMonth.get(baseMonth);
    const baseEntry = manifestEntry(baseMonth, baseClosure, input.candidatesByMonth[baseMonth], 'base_month_non_comparable', []);
    const rawBaseClosure = getRawClosure(baseMonth, baseClosure, rawByMonth);
    baseEntry.snapshotPresent = Boolean(
      baseClosure?.gastappExpenseClose ||
      (rawBaseClosure && Object.prototype.hasOwnProperty.call(rawBaseClosure, 'gastappExpenseClose') && rawBaseClosure.gastappExpenseClose !== null),
    );
    manifest.push(baseEntry);
  }

  for (const monthKey of allComparableMonths) {
    const closure = closureByMonth.get(monthKey);
    const rawClosure = getRawClosure(monthKey, closure, rawByMonth);
    const candidate = input.candidatesByMonth[monthKey];
    if (!closure) {
      manifest.push(manifestEntry(monthKey, undefined, candidate, 'missing_closure', ['No existe cierre patrimonial para este mes.']));
      continue;
    }
    if ((closuresByMonth.get(monthKey) || 0) > 1) {
      manifest.push(manifestEntry(monthKey, closure, candidate, 'invalid_wealth_closure', ['Hay más de un cierre patrimonial para este mes.']));
      continue;
    }
    const rawHasSnapshot = rawClosure
      ? Object.prototype.hasOwnProperty.call(rawClosure, 'gastappExpenseClose') && rawClosure.gastappExpenseClose !== null
      : false;
    const sidecarEntry = sidecarEntries[monthKey];
    if (sidecarEntry && sidecarEntry.closureId !== closure.id) {
      manifest.push(manifestEntry(monthKey, closure, candidate, 'conflict_existing_snapshot', ['El sidecar existe para otro cierre; no se sobrescribe.']));
      continue;
    }
    if (sidecarEntry && !closure.gastappExpenseClose && !rawHasSnapshot) {
      const entry = manifestEntry(monthKey, closure, candidate, 'snapshot_present', []);
      entry.snapshotPresent = true;
      manifest.push(entry);
      continue;
    }
    if (closure.gastappExpenseClose || rawHasSnapshot) {
      const candidateContractHash = candidate?.snapshot?.contractHash || candidate?.currentContractHash || null;
      const candidateHasDifferentContract = Boolean(
        closure.gastappExpenseClose && candidateContractHash && candidateContractHash !== closure.gastappExpenseClose.contractHash,
      );
      const invalidStoredSnapshot = rawHasSnapshot && !closure.gastappExpenseClose;
      const existingEntry = manifestEntry(
        monthKey,
        closure,
        candidate,
        candidateHasDifferentContract || invalidStoredSnapshot ? 'conflict_existing_snapshot' : 'snapshot_present',
        invalidStoredSnapshot
          ? ['Existe un snapshot persistido que no pudo normalizarse; se conserva y no se sobrescribe.']
          : candidateHasDifferentContract
            ? ['El snapshot existente se conserva; la certificación actual es distinta.']
            : [],
      );
      existingEntry.snapshotPresent = true;
      manifest.push(existingEntry);
      continue;
    }

    const row = rowByMonth.get(monthKey);
    const blockerStatuses: HistoricalGastappBackfillStatus[] = [];
    const blockers: string[] = [];
    if (!row?.fxAuditable) {
      blockerStatuses.push('missing_fx');
      blockers.push('El cierre no tiene FX histórico auditable según Retornos.');
    }
    if (!row || row.invalidNet) {
      blockerStatuses.push('invalid_wealth_closure');
      blockers.push('El patrimonio neto sellado no permite calcular el retorno mensual.');
    }
    if (input.wealthDocument && !rawClosure) {
      blockerStatuses.push('invalid_wealth_closure');
      blockers.push('El cierre normalizado no se pudo vincular inequívocamente al documento cloud crudo.');
    }
    const candidateBlocker = getCandidateBlocker(candidate);
    if (candidateBlocker) {
      const messages: Record<GastappCandidateBlocker, string> = {
        gastapp_not_certified: 'GastApp no certificó el mes como certified o revised.',
        gastapp_missing: 'GastApp no publicó un contrato de mes calendario para este mes.',
        gastapp_invalid: 'El contrato GastApp no tiene identidad o familias conciliadas.',
        gastapp_unavailable: 'No se pudo leer el contrato mensual oficial de GastApp.',
      };
      blockerStatuses.push(candidateBlocker);
      blockers.push(messages[candidateBlocker]);
    }
    if (blockers.length) {
      manifest.push(manifestEntry(monthKey, closure, candidate, blockerStatuses[0], blockers));
      continue;
    }

    try {
      const proposedSnapshot = buildGastappMonthlyExpenseCloseSnapshot(
        candidate!.snapshot as GastappMonthlyExpenseCloseInput,
        closure.fxRates!,
        at,
      );
      manifest.push(manifestEntry(monthKey, closure, candidate, 'eligible_for_backfill', [], proposedSnapshot));
    } catch (error) {
      manifest.push(manifestEntry(
        monthKey,
        closure,
        candidate,
        'gastapp_invalid',
        [error instanceof Error ? error.message : 'El contrato GastApp no se puede convertir en snapshot válido.'],
      ));
    }
  }

  const rowByMonthForManifest = new Map(manifest.map((row) => [row.monthKey, row]));
  const simulatedClosures = withExistingSidecar.map((closure) => {
    const row = rowByMonthForManifest.get(closure.monthKey);
    return row?.status === 'eligible_for_backfill' && row.proposedSnapshot
      ? { ...closure, gastappExpenseClose: row.proposedSnapshot }
      : closure;
  });
  const eligibleRows = manifest.filter((row) => row.status === 'eligible_for_backfill' && row.proposedSnapshot);
  const originalByMonth = new Map(closures.map((closure) => [closure.monthKey, closure]));
  const simulatedByMonth = new Map(simulatedClosures.map((closure) => [closure.monthKey, closure]));
  await Promise.all(eligibleRows.map(async (row) => {
    const original = originalByMonth.get(row.monthKey)!;
    const simulated = simulatedByMonth.get(row.monthKey)!;
    const rawClosure = getRawClosure(row.monthKey, original, rawByMonth);
    const financialFieldsBefore = closureFingerprintPayload(rawClosure || original);
    // The projection adds only the GastApp snapshot; the audit trail is metadata too.
    const financialFieldsAfter = closureFingerprintPayload(rawClosure || simulated);
    row.preFingerprint = await sha256Fingerprint(financialFieldsBefore);
    row.postFingerprint = await sha256Fingerprint(financialFieldsAfter);
    row.fingerprintsMatch = row.preFingerprint === row.postFingerprint;
    if (!row.fingerprintsMatch) {
      row.status = 'fingerprint_mismatch';
      row.blockers = ['El fingerprint pre/post de campos financieros sellados cambió en la simulación.'];
      delete row.proposedSnapshot;
    }
  }));

  // If a fingerprint check ever fails, that month is removed from the projection too.
  const safeMonthKeys = new Set(manifest
    .filter((row) => row.status === 'eligible_for_backfill' && row.proposedSnapshot && row.fingerprintsMatch)
    .map((row) => row.monthKey));
  const safeSimulatedClosures = withExistingSidecar.map((closure) => {
    if (!safeMonthKeys.has(closure.monthKey)) return closure;
    const row = rowByMonthForManifest.get(closure.monthKey)!;
    return { ...closure, gastappExpenseClose: row.proposedSnapshot! };
  });
  const safeSimulatedRows = computeMonthlyRows(safeSimulatedClosures, includeRiskCapital, currency);
  const latestComparableMonth = allComparableMonths.at(-1) ?? null;
  const last12MonthKeys = allComparableMonths.slice(-12);
  const yearStart = latestComparableMonth ? `${latestComparableMonth.slice(0, 4)}-01` : null;
  const ytdMonthKeys = yearStart ? allComparableMonths.filter((monthKey) => monthKey >= yearStart) : [];
  const blockersByStatus: Partial<Record<HistoricalGastappBackfillStatus, number>> = {};
  for (const row of manifest) {
    if (!BLOCKER_STATUSES.has(row.status)) continue;
    blockersByStatus[row.status] = (blockersByStatus[row.status] || 0) + 1;
  }
  const snapshotsPresent = manifest.filter((row) => row.snapshotPresent).length;
  const snapshotsToComplete = manifest.filter((row) => row.status === 'eligible_for_backfill').length;

  return {
    schemaVersion: HISTORICAL_GASTAPP_BACKFILL_PREVIEW_SCHEMA,
    reconstructionAt: at,
    closureSourceFingerprint: await fingerprintHistoricalClosureSource(
      input.wealthDocument && Array.isArray(input.wealthDocument.closures)
        ? input.wealthDocument.closures
        : input.closures,
    ),
    totalClosures: closures.length,
    baseMonth,
    lastOfficialMonth,
    comparableMonths: allComparableMonths.length,
    snapshotsPresent,
    snapshotsToComplete,
    blockers: manifest.filter((row) => row.blockers.length > 0).length,
    blockersByStatus,
    coverage: {
      current: {
        sinceStart: makeCoverage(currentRows, allComparableMonths),
        last12m: makeCoverage(currentRows, last12MonthKeys),
        ytd: makeCoverage(currentRows, ytdMonthKeys),
      },
      projected: {
        sinceStart: makeCoverage(safeSimulatedRows, allComparableMonths),
        last12m: makeCoverage(safeSimulatedRows, last12MonthKeys),
        ytd: makeCoverage(safeSimulatedRows, ytdMonthKeys),
      },
    },
    documentSize: buildDocumentSizeAssessment(input.wealthDocument),
    sidecarSize: (() => {
      const current = input.sidecar || { schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: {} };
      const additions = Object.fromEntries(manifest.filter((row) => row.status === 'eligible_for_backfill' && row.proposedSnapshot).map((row) => [row.monthKey, {
        closureId: row.closureId,
        snapshot: row.proposedSnapshot,
        repairAudit: {
          reason: 'historical_schema_compatibility_reconstruction',
          reconstructedAt: at,
          originalClosureAt: closureByMonth.get(row.monthKey)?.closedAt,
          preFingerprint: row.preFingerprint,
          postFingerprint: row.postFingerprint,
          sourceContractHash: row.proposedSnapshot?.contractHash,
        },
      }]));
      const currentApproxBytes = utf8Size(current);
      const projectedApproxBytes = utf8Size({ ...current, snapshotsByMonth: { ...current.snapshotsByMonth, ...additions } });
      return {
        currentApproxBytes,
        projectedApproxBytes,
        maxBytes: FIRESTORE_MAX_DOCUMENT_BYTES,
        reserveBytes: FIRESTORE_DOCUMENT_RESERVE_BYTES,
        status: projectedApproxBytes > FIRESTORE_MAX_DOCUMENT_BYTES ? 'over_limit' as const :
          projectedApproxBytes > FIRESTORE_MAX_DOCUMENT_BYTES - FIRESTORE_DOCUMENT_RESERVE_BYTES ? 'near_limit' as const : 'within_limit' as const,
      };
    })(),
    manifest,
    simulatedClosures: safeSimulatedClosures,
    allowedPersistentFields: ['gastappExpenseClose', 'repairAudit'],
    writesPerformed: false,
  };
};

const candidateFromOfficialMonth = (
  month: Awaited<ReturnType<typeof loadGastappCanonicalV2OfficialMonthContractFresh>>['months'][number],
  source: Awaited<ReturnType<typeof loadGastappCanonicalV2OfficialMonthContractFresh>>,
): GastappMonthlyCloseCandidate => {
  const certification = month.calendarCertification;
  const complete = month.status === 'complete' &&
    month.calendarStatus === 'complete' &&
    month.eligibleForAurumReturns &&
    Boolean(certification);
  const snapshot: GastappMonthlyExpenseCloseInput | null = complete && certification
    ? {
        monthKey: month.calendarMonthKey,
        calendarMonthKey: month.calendarMonthKey,
        totalEur: month.totalEur,
        byFamilyEur: month.byFamily,
        canonicalDataHash: source.canonicalDataHash,
        operationalDataHash: source.operationalDataHash,
        operationalRevision: source.operationalRevision,
        sourceGeneration: certification.sourceGeneration,
        monthContractRevision: month.monthContractRevision,
        monthContractHash: month.monthContractHash,
        certificationStatus: certification.status,
        certificationRevision: certification.certificationRevision,
        certificationHash: certification.certificationHash,
        contractHash: month.monthContractHash,
        contractVersion: source.version,
        generatedAt: source.generatedAt,
      }
    : null;
  return {
    monthKey: month.calendarMonthKey,
    status: complete ? 'complete' : month.status === 'pending' ? 'pending' : 'stale',
    partialGastosEur: month.totalEur,
    partialByFamilyEur: month.byFamily,
    snapshot,
    sourceChangedAfterClosure: false,
    currentContractHash: month.monthContractHash,
    storedContractHash: null,
    message: complete ? 'Mes oficial certificado por Canonical V2.' : `Mes no elegible: ${month.calendarStatus}.`,
  };
};

/** Reads current server documents and produces the complete audit without writing to either project. */
export const runHistoricalGastappBackfillAudit = async (options: {
  reconstructionAt?: string;
  includeRiskCapitalInTotals?: boolean;
  currency?: WealthCurrency;
} = {}): Promise<HistoricalGastappBackfillAuditResult> => {
  const auditedAt = new Date().toISOString();
  const reconstructionAt = options.reconstructionAt || auditedAt;
  const [wealth, gastapp, sidecar] = await Promise.all([
    readWealthCloudDocumentForAudit(),
    loadGastappCanonicalV2OfficialMonthContractFresh(),
    readHistoricalGastappSidecarFromServer(),
  ]);
  if (wealth.projectId !== AURUM_PRODUCTION_PROJECT_ID) {
    throw new Error(`Auditoría detenida: Aurum está conectado a ${wealth.projectId || 'un proyecto desconocido'}, no a ${AURUM_PRODUCTION_PROJECT_ID}.`);
  }
  const gastappProjectId = getGastappCanonicalV2ConfiguredProjectId();
  if (gastappProjectId !== GASTAPP_CANONICAL_V2_PROJECT_ID) {
    throw new Error(`Auditoría detenida: GastApp está conectado a ${gastappProjectId || 'un proyecto desconocido'}, no a ${GASTAPP_CANONICAL_V2_PROJECT_ID}.`);
  }
  const candidatesByMonth = Object.fromEntries(
    gastapp.months.map((month) => [month.calendarMonthKey, candidateFromOfficialMonth(month, gastapp)]),
  );
  const preview = await buildHistoricalGastappBackfillPreview({
    closures: wealth.closures,
    candidatesByMonth,
    reconstructionAt,
    includeRiskCapitalInTotals: options.includeRiskCapitalInTotals,
    currency: options.currency,
    wealthDocument: wealth.document,
    sidecar: sidecar.document,
  });
  return {
    auditedAt,
    sources: {
      wealthProjectId: wealth.projectId,
      wealthDocumentExists: wealth.exists,
      wealthUpdatedAt: wealth.updatedAt,
      gastappProjectId,
      gastappContractVersion: gastapp.version,
      gastappGeneratedAt: gastapp.generatedAt,
      gastappMonthsRead: gastapp.months.length,
      readMode: 'server_only',
    },
    preview,
  };
};
