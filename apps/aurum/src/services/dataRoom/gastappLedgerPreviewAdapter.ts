import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { getGastappConfiguredProjectId, getGastappFirestore, isGastappFirestoreConfigured } from '../firebase';
import { buildCsv } from './csv';
import type {
  GastappLedgerPreviewAdapterResult,
  GastappLedgerPreviewManifest,
  GastappLedgerPreviewRow,
  GastappLedgerPreviewStatus,
} from './dataRoomTypes';

export const GASTAPP_LEDGER_PREVIEW_COLLECTION = 'gastapp_transaction_ledger_preview_v1';
export const GASTAPP_LEDGER_PREVIEW_MANIFEST_COLLECTION = 'gastapp_transaction_ledger_preview_manifest_v1';
const GASTAPP_LEDGER_PREVIEW_MANIFEST_DOC_ID = 'current';

const ALLOWED_READINESS = new Set(['preview_only', 'validation_only']);
const OK_RECONCILIATION = new Set(['matched', 'matched_with_rounding_tolerance']);

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

const readNumberMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, readNumber(item)] as const)
      .filter((entry): entry is [string, number] => entry[1] !== null),
  );
};

const normalizeManifest = (id: string, raw: Record<string, unknown>): GastappLedgerPreviewManifest => ({
  id,
  generatedAt: readString(raw.generatedAt) || readString(raw.publishedAt) || readString(raw.updatedAt),
  schemaVersion: readString(raw.schemaVersion),
  calculationVersion: readString(raw.calculationVersion),
  periodRange: readString(raw.periodRange),
  rowCounts: readNumberMap(raw.rowCounts),
  reconciliationStatus: readString(raw.reconciliationStatus),
  aurumReadinessStatus: readString(raw.aurum_readiness_status) || readString(raw.aurumReadinessStatus),
  dataQuality: readString(raw.dataQuality),
  warnings: readStringArray(raw.warnings),
  knownLimitations: readStringArray(raw.knownLimitations),
  reconciliationToleranceEur: readNumber(raw.reconciliationToleranceEur),
  maxAbsDiffEur: readNumber(raw.maxAbsDiffEur),
  roundingDiffCount: readNumber(raw.roundingDiffCount),
  needsReviewCount: readNumber(raw.needsReviewCount),
  totalsByView: readNumberMap(raw.totalsByView),
  totalsBySource: readNumberMap(raw.totalsBySource),
  raw,
});

const normalizeRow = (id: string, raw: Record<string, unknown>): GastappLedgerPreviewRow => ({
  ledger_id: readString(raw.ledger_id) || id,
  source_kind: readString(raw.source_kind),
  transaction_class: readString(raw.transaction_class),
  project_name: readString(raw.project_name),
  description: readString(raw.description),
  transaction_date: readString(raw.transaction_date),
  accounting_date: readString(raw.accounting_date),
  period_key: readString(raw.period_key),
  monthKey: readString(raw.monthKey),
  amount_eur: readNumber(raw.amount_eur),
  hybrid_contable_eur: readNumber(raw.hybrid_contable_eur),
  lifestyle_eur: readNumber(raw.lifestyle_eur),
  aurum_eur: readNumber(raw.aurum_eur),
  affects_aurum: readBoolean(raw.affects_aurum),
  affects_lifestyle: readBoolean(raw.affects_lifestyle),
  inclusion_reason: readString(raw.inclusion_reason),
  exclusion_reason: readString(raw.exclusion_reason),
  duplication_risk: readString(raw.duplication_risk),
  omission_risk: readString(raw.omission_risk),
  traceability_status: readString(raw.traceability_status),
  raw,
});

export const deriveGastappLedgerPreviewStatus = (input: {
  configured: boolean;
  manifest: GastappLedgerPreviewManifest | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): GastappLedgerPreviewStatus => {
  if (!input.configured) return 'missing_config';
  const code = String(input.errorCode || '');
  if (code === 'permission-denied') return 'permission_denied';
  if (code === 'unavailable') return 'unavailable';
  if (input.errorMessage) return 'error';
  if (!input.manifest) return 'missing_manifest';

  const readinessOk = ALLOWED_READINESS.has(String(input.manifest.aurumReadinessStatus || ''));
  const reconciliationOk = OK_RECONCILIATION.has(String(input.manifest.reconciliationStatus || ''));
  if (!readinessOk || !reconciliationOk) return 'mismatch';
  return 'available';
};

const buildWarningsPayload = (
  status: GastappLedgerPreviewStatus,
  manifest: GastappLedgerPreviewManifest | null,
  errorMessage: string | null,
) => {
  const warnings = [
    ...(manifest?.warnings || []),
    ...(manifest?.knownLimitations || []),
    ...(errorMessage ? [errorMessage] : []),
  ].filter(Boolean);
  if (warnings.length === 0 && status === 'available') return null;
  return {
    status,
    warnings,
    knownLimitations: manifest?.knownLimitations || [],
    dataQuality: manifest?.dataQuality || null,
    needsReviewCount: manifest?.needsReviewCount ?? null,
  };
};

const buildReconciliationPayload = (manifest: GastappLedgerPreviewManifest | null) => {
  if (!manifest) return null;
  return {
    reconciliationStatus: manifest.reconciliationStatus,
    maxAbsDiffEur: manifest.maxAbsDiffEur,
    roundingDiffCount: manifest.roundingDiffCount,
    reconciliationToleranceEur: manifest.reconciliationToleranceEur,
    totalsByView: manifest.totalsByView,
    totalsBySource: manifest.totalsBySource,
    rowCounts: manifest.rowCounts,
  };
};

const buildBaseResult = (
  status: GastappLedgerPreviewStatus,
  configuredProjectId: string | null,
  manifest: GastappLedgerPreviewManifest | null,
  rows: GastappLedgerPreviewRow[],
  errorMessage: string | null,
): GastappLedgerPreviewAdapterResult => ({
  status,
  included: status === 'available' && rows.length > 0,
  manifest,
  rows,
  warnings: [...(manifest?.warnings || []), ...(manifest?.knownLimitations || [])],
  errorMessage,
  configuredProjectId,
  collectionName: GASTAPP_LEDGER_PREVIEW_COLLECTION,
  manifestCollectionName: `${GASTAPP_LEDGER_PREVIEW_MANIFEST_COLLECTION}/${GASTAPP_LEDGER_PREVIEW_MANIFEST_DOC_ID}`,
  reconciliationStatus: manifest?.reconciliationStatus || null,
  aurumReadinessStatus: manifest?.aurumReadinessStatus || null,
  periodRange: manifest?.periodRange || null,
  rowCount: rows.length,
  warningsPayload: buildWarningsPayload(status, manifest, errorMessage),
  reconciliationPayload: buildReconciliationPayload(manifest),
});

export const buildGastappLedgerPreviewCsv = (rows: GastappLedgerPreviewRow[]) =>
  buildCsv([
    'ledger_id',
    'source_kind',
    'transaction_class',
    'project_name',
    'description',
    'transaction_date',
    'accounting_date',
    'period_key',
    'monthKey',
    'amount_eur',
    'hybrid_contable_eur',
    'lifestyle_eur',
    'aurum_eur',
    'affects_aurum',
    'affects_lifestyle',
    'inclusion_reason',
    'exclusion_reason',
    'duplication_risk',
    'omission_risk',
    'traceability_status',
  ], rows.map((row) => ({
    ledger_id: row.ledger_id,
    source_kind: row.source_kind,
    transaction_class: row.transaction_class,
    project_name: row.project_name,
    description: row.description,
    transaction_date: row.transaction_date,
    accounting_date: row.accounting_date,
    period_key: row.period_key,
    monthKey: row.monthKey,
    amount_eur: row.amount_eur,
    hybrid_contable_eur: row.hybrid_contable_eur,
    lifestyle_eur: row.lifestyle_eur,
    aurum_eur: row.aurum_eur,
    affects_aurum: row.affects_aurum,
    affects_lifestyle: row.affects_lifestyle,
    inclusion_reason: row.inclusion_reason,
    exclusion_reason: row.exclusion_reason,
    duplication_risk: row.duplication_risk,
    omission_risk: row.omission_risk,
    traceability_status: row.traceability_status,
  })));

export const loadGastappLedgerPreviewDataRoomData = async (): Promise<GastappLedgerPreviewAdapterResult> => {
  const configuredProjectId = getGastappConfiguredProjectId() || null;
  const configured = isGastappFirestoreConfigured();
  if (!configured) {
    return buildBaseResult('missing_config', configuredProjectId, null, [], null);
  }

  const db = getGastappFirestore();
  if (!db) {
    return buildBaseResult('unavailable', configuredProjectId, null, [], 'gastapp_firestore_unavailable');
  }

  try {
    const manifestRef = doc(db, GASTAPP_LEDGER_PREVIEW_MANIFEST_COLLECTION, GASTAPP_LEDGER_PREVIEW_MANIFEST_DOC_ID);
    const manifestSnap = await getDoc(manifestRef);
    const manifest = manifestSnap.exists()
      ? normalizeManifest(manifestSnap.id, (manifestSnap.data() || {}) as Record<string, unknown>)
      : null;
    const status = deriveGastappLedgerPreviewStatus({ configured, manifest });

    if (!manifest || status !== 'available') {
      return buildBaseResult(status, configuredProjectId, manifest, [], null);
    }

    const rowsSnap = await getDocs(collection(db, GASTAPP_LEDGER_PREVIEW_COLLECTION));
    const rows = rowsSnap.docs
      .map((docSnap) => normalizeRow(docSnap.id, (docSnap.data() || {}) as Record<string, unknown>))
      .sort((a, b) => {
        const monthCmp = String(a.monthKey || '').localeCompare(String(b.monthKey || ''));
        if (monthCmp !== 0) return monthCmp;
        const dateCmp = String(a.transaction_date || '').localeCompare(String(b.transaction_date || ''));
        if (dateCmp !== 0) return dateCmp;
        return a.ledger_id.localeCompare(b.ledger_id);
      });

    return buildBaseResult(status, configuredProjectId, manifest, rows, null);
  } catch (error: any) {
    const errorCode = String(error?.code || '');
    const errorMessage = String(error?.message || error || 'gastapp_ledger_preview_error');
    const status = deriveGastappLedgerPreviewStatus({
      configured,
      manifest: null,
      errorCode,
      errorMessage,
    });
    return buildBaseResult(status, configuredProjectId, null, [], errorMessage);
  }
};
