import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  type QueryConstraint,
  query,
  startAfter,
} from 'firebase/firestore';
import { getGastappConfiguredProjectId, getGastappFirestore, isGastappFirestoreConfigured } from '../firebase';
import type {
  GastappDataRoomV2Manifest,
  GastappDataRoomV2ManifestResult,
  GastappDataRoomV2PeriodSummariesResult,
  GastappDataRoomV2PeriodSummary,
  GastappDataRoomV2Row,
  GastappDataRoomV2RowsPage,
  GastappDataRoomV2RowsPageResult,
  GastappDataRoomV2Status,
} from './dataRoomTypes';

export const GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION = 'gastapp_data_room_v2';
export const GASTAPP_DATA_ROOM_V2_CURRENT_DOC_ID = 'current';
const DEFAULT_ROWS_PAGE_SIZE = 100;
const MAX_ROWS_PAGE_SIZE = 250;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
      .map((item) => readString(item))
      .filter((item): item is string => Boolean(item))
    : [];

const normalizePageSize = (value?: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ROWS_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_ROWS_PAGE_SIZE);
};

export const normalizeGastappDataRoomV2RunId = (dataHash: string | null | undefined): string | null => {
  const clean = readString(dataHash);
  if (!clean) return null;
  return clean.replace(/:/g, '_');
};

export const normalizeGastappDataRoomV2Manifest = (
  id: string,
  raw: Record<string, unknown>,
): GastappDataRoomV2Manifest => {
  const dataHash = readString(raw.dataHash) || readString(raw.data_hash);
  const runId = normalizeGastappDataRoomV2RunId(dataHash);
  return {
    id,
    runId,
    schemaVersion: readString(raw.schemaVersion) || readString(raw.schema_version),
    calculationVersion: readString(raw.calculationVersion) || readString(raw.calculation_version),
    dataHash,
    sourceCommit: readString(raw.sourceCommit) || readString(raw.source_commit),
    readinessStatus: readString(raw.readinessStatus) || readString(raw.readiness_status),
    officialRefreshAllowed: readBoolean(raw.officialRefreshAllowed ?? raw.official_refresh_allowed),
    consumerRefreshRequired: readBoolean(raw.consumerRefreshRequired ?? raw.consumer_refresh_required),
    blockers: readStringArray(raw.blockers),
    warnings: readStringArray(raw.warnings),
    rowCount: readNumber(raw.rowCount ?? raw.rows ?? raw.totalRows),
    periodSummariesCount: readNumber(raw.periodSummariesCount ?? raw.periodSummaries ?? raw.period_summaries),
    generatedAt: readString(raw.generatedAt) || readString(raw.generated_at) || readString(raw.publishedAt),
    raw,
  };
};

export const isGastappDataRoomV2Usable = (manifest: GastappDataRoomV2Manifest | null | undefined): boolean => {
  if (!manifest) return false;
  if (manifest.officialRefreshAllowed !== true) return false;
  if ((manifest.blockers || []).length > 0) return false;
  const readiness = String(manifest.readinessStatus || '');
  return readiness === 'ok' || readiness === 'warning';
};

export const deriveGastappDataRoomV2Status = (input: {
  configured: boolean;
  manifest: GastappDataRoomV2Manifest | null;
  hasRun: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}): GastappDataRoomV2Status => {
  if (!input.configured) return 'missing_config';
  const code = String(input.errorCode || '');
  if (code === 'permission-denied') return 'permission_denied';
  if (code === 'unavailable') return 'unavailable';
  if (input.errorMessage) return 'error';
  if (!input.manifest) return 'missing_current';
  if (!input.hasRun) return 'missing_run';
  return isGastappDataRoomV2Usable(input.manifest) ? 'usable' : 'not_usable';
};

const buildManifestWarnings = (manifest: GastappDataRoomV2Manifest | null, status: GastappDataRoomV2Status) => {
  const manifestWarnings = manifest?.warnings || [];
  if (status === 'not_usable' && manifest) {
    return [
      ...manifestWarnings,
      manifest.officialRefreshAllowed !== true ? 'official_refresh_not_allowed' : null,
      ...(manifest.blockers || []).map((item) => `blocker:${item}`),
      manifest.readinessStatus === 'blocked' ? 'readiness_blocked' : null,
    ].filter((item): item is string => Boolean(item));
  }
  return manifestWarnings;
};

const normalizePeriodSummary = (id: string, raw: Record<string, unknown>): GastappDataRoomV2PeriodSummary => ({
  id,
  period: readString(raw.period) || id,
  periodPolicy: readString(raw.periodPolicy) || readString(raw.period_policy),
  readinessStatus: readString(raw.readinessStatus) || readString(raw.readiness_status),
  officialAmountEur: readNumber(
    raw.officialAmountEur ??
    raw.official_amount_eur ??
    raw.totalAmountEur ??
    raw.total_amount_eur,
  ),
  canonicalRowCount: readNumber(raw.canonicalRowCount ?? raw.canonical_row_count),
  rowCount: readNumber(raw.rowCount ?? raw.row_count ?? raw.totalRows),
  periodStart: readString(raw.periodStart) || readString(raw.period_start),
  periodEnd: readString(raw.periodEnd) || readString(raw.period_end),
  warnings: readStringArray(raw.warnings),
  blockers: readStringArray(raw.blockers),
  raw,
});

const normalizeRow = (id: string, raw: Record<string, unknown>): GastappDataRoomV2Row => ({
  id,
  sourceKind: readString(raw.source_kind) || readString(raw.sourceKind),
  sourceId: readString(raw.source_id) || readString(raw.sourceId),
  period: readString(raw.period),
  periodStart: readString(raw.period_start) || readString(raw.periodStart),
  periodEnd: readString(raw.period_end) || readString(raw.periodEnd),
  bucket: readString(raw.bucket),
  category: readString(raw.category),
  subcategory: readString(raw.subcategory),
  label: readString(raw.label),
  description: readString(raw.description),
  amountEur: readNumber(raw.amount_eur ?? raw.amountEur),
  isCanonical: readBoolean(raw.is_canonical ?? raw.isCanonical),
  affectsAurum: readBoolean(raw.affects_aurum ?? raw.affectsAurum),
  affectsDataRoomOfficial: readBoolean(raw.affects_data_room_official ?? raw.affectsDataRoomOfficial),
  blocksReadiness: readBoolean(raw.blocks_readiness ?? raw.blocksReadiness),
  requiresReview: readBoolean(raw.requires_review ?? raw.requiresReview),
  raw,
});

const buildManifestResult = (
  status: GastappDataRoomV2Status,
  configuredProjectId: string | null,
  manifest: GastappDataRoomV2Manifest | null,
  errorMessage: string | null,
): GastappDataRoomV2ManifestResult => ({
  status,
  usable: isGastappDataRoomV2Usable(manifest),
  manifest,
  warnings: buildManifestWarnings(manifest, status),
  errorMessage,
  configuredProjectId,
  rootCollection: GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION,
  currentDocumentPath: `${GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION}/${GASTAPP_DATA_ROOM_V2_CURRENT_DOC_ID}`,
});

const buildPeriodSummariesResult = (
  status: GastappDataRoomV2Status,
  configuredProjectId: string | null,
  manifest: GastappDataRoomV2Manifest | null,
  summaries: GastappDataRoomV2PeriodSummary[],
  errorMessage: string | null,
): GastappDataRoomV2PeriodSummariesResult => ({
  status,
  usable: isGastappDataRoomV2Usable(manifest),
  manifest,
  summaries,
  warnings: buildManifestWarnings(manifest, status),
  errorMessage,
  configuredProjectId,
  collectionPath: manifest?.runId
    ? `${GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION}/${manifest.runId}/period_summaries`
    : null,
});

const buildRowsPageResult = (
  status: GastappDataRoomV2Status,
  configuredProjectId: string | null,
  manifest: GastappDataRoomV2Manifest | null,
  page: GastappDataRoomV2RowsPage,
  errorMessage: string | null,
): GastappDataRoomV2RowsPageResult => ({
  status,
  usable: isGastappDataRoomV2Usable(manifest),
  manifest,
  page,
  warnings: buildManifestWarnings(manifest, status),
  errorMessage,
  configuredProjectId,
  collectionPath: manifest?.runId
    ? `${GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION}/${manifest.runId}/rows`
    : null,
});

export const getGastappDataRoomV2Manifest = async (): Promise<GastappDataRoomV2ManifestResult> => {
  const configuredProjectId = getGastappConfiguredProjectId() || null;
  const configured = isGastappFirestoreConfigured();
  if (!configured) {
    return buildManifestResult('missing_config', configuredProjectId, null, null);
  }

  const db = getGastappFirestore();
  if (!db) {
    return buildManifestResult('unavailable', configuredProjectId, null, 'gastapp_firestore_unavailable');
  }

  try {
    const currentRef = doc(db, GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION, GASTAPP_DATA_ROOM_V2_CURRENT_DOC_ID);
    const currentSnap = await getDoc(currentRef);
    const manifest = currentSnap.exists()
      ? normalizeGastappDataRoomV2Manifest(currentSnap.id, (currentSnap.data() || {}) as Record<string, unknown>)
      : null;
    const status = deriveGastappDataRoomV2Status({
      configured,
      manifest,
      hasRun: Boolean(manifest?.runId),
    });
    return buildManifestResult(status, configuredProjectId, manifest, null);
  } catch (error: any) {
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || error || 'gastapp_data_room_v2_current_error');
    const status = deriveGastappDataRoomV2Status({
      configured,
      manifest: null,
      hasRun: false,
      errorCode,
      errorMessage,
    });
    return buildManifestResult(status, configuredProjectId, null, errorMessage);
  }
};

export const getGastappDataRoomV2PeriodSummaries = async (): Promise<GastappDataRoomV2PeriodSummariesResult> => {
  const manifestResult = await getGastappDataRoomV2Manifest();
  const { manifest, configuredProjectId } = manifestResult;
  if (!manifest || !manifest.runId) {
    return buildPeriodSummariesResult(manifestResult.status, configuredProjectId, manifest, [], manifestResult.errorMessage);
  }

  const db = getGastappFirestore();
  if (!db) {
    return buildPeriodSummariesResult('unavailable', configuredProjectId, manifest, [], 'gastapp_firestore_unavailable');
  }

  try {
    const snapshot = await getDocs(collection(db, GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION, manifest.runId, 'period_summaries'));
    const summaries = snapshot.docs
      .map((docSnap) => normalizePeriodSummary(docSnap.id, (docSnap.data() || {}) as Record<string, unknown>))
      .sort((a, b) => a.period.localeCompare(b.period));
    return buildPeriodSummariesResult(manifestResult.status, configuredProjectId, manifest, summaries, null);
  } catch (error: any) {
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || error || 'gastapp_data_room_v2_period_summaries_error');
    const status = deriveGastappDataRoomV2Status({
      configured: true,
      manifest,
      hasRun: true,
      errorCode,
      errorMessage,
    });
    return buildPeriodSummariesResult(status, configuredProjectId, manifest, [], errorMessage);
  }
};

export const getGastappDataRoomV2RowsPage = async (args?: {
  pageSize?: number;
  cursor?: string | null;
}): Promise<GastappDataRoomV2RowsPageResult> => {
  const manifestResult = await getGastappDataRoomV2Manifest();
  const { manifest, configuredProjectId } = manifestResult;
  const emptyPage: GastappDataRoomV2RowsPage = {
    rows: [],
    pageSize: normalizePageSize(args?.pageSize),
    nextCursor: null,
  };

  if (!manifest || !manifest.runId) {
    return buildRowsPageResult(manifestResult.status, configuredProjectId, manifest, emptyPage, manifestResult.errorMessage);
  }

  const db = getGastappFirestore();
  if (!db) {
    return buildRowsPageResult('unavailable', configuredProjectId, manifest, emptyPage, 'gastapp_firestore_unavailable');
  }

  try {
    const pageSize = normalizePageSize(args?.pageSize);
    const rowsCollection = collection(db, GASTAPP_DATA_ROOM_V2_ROOT_COLLECTION, manifest.runId, 'rows');
    const constraints: QueryConstraint[] = [
      orderBy(documentId()),
      limit(pageSize),
    ];
    const cleanCursor = readString(args?.cursor);
    if (cleanCursor) {
      constraints.splice(1, 0, startAfter(cleanCursor));
    }
    const rowsQuery = query(rowsCollection, ...constraints);
    const snapshot = await getDocs(rowsQuery);
    const rows = snapshot.docs.map((docSnap) => normalizeRow(docSnap.id, (docSnap.data() || {}) as Record<string, unknown>));
    const nextCursor = rows.length === pageSize ? rows.at(-1)?.id || null : null;
    return buildRowsPageResult(
      manifestResult.status,
      configuredProjectId,
      manifest,
      { rows, pageSize, nextCursor },
      null,
    );
  } catch (error: any) {
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || error || 'gastapp_data_room_v2_rows_error');
    const status = deriveGastappDataRoomV2Status({
      configured: true,
      manifest,
      hasRun: true,
      errorCode,
      errorMessage,
    });
    return buildRowsPageResult(status, configuredProjectId, manifest, emptyPage, errorMessage);
  }
};
