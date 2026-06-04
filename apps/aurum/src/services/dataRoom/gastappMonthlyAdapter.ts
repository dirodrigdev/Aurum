import { collection, getDocs } from 'firebase/firestore';
import { getGastappConfiguredProjectId, getGastappFirestore, isGastappFirestoreConfigured } from '../firebase';
import type { GastappMonthlyAdapterResult, GastappMonthlyExportRow } from './dataRoomTypes';

const COLLECTION_PATH = 'aurum_monthly_from_periods_v1';

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const readNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const buildWarnings = (row: GastappMonthlyExportRow) => {
  const warnings = [
    row.dataQuality && row.dataQuality !== 'ok' ? `dataQuality:${row.dataQuality}` : null,
    row.isStale ? `stale:${row.staleReason || 'true'}` : null,
    row.status && row.status !== 'complete' ? `status:${row.status}` : null,
  ].filter(Boolean);
  return warnings.join(' | ');
};

export const loadGastappMonthlyDataRoomData = async (): Promise<GastappMonthlyAdapterResult> => {
  const configuredProjectId = getGastappConfiguredProjectId() || null;
  if (!isGastappFirestoreConfigured()) {
    return {
      status: 'missing_config',
      included: false,
      rows: [],
      warnings: ['gastapp_firestore_not_configured'],
      errorMessage: null,
      configuredProjectId,
    };
  }

  const db = getGastappFirestore();
  if (!db) {
    return {
      status: 'unavailable',
      included: false,
      rows: [],
      warnings: ['gastapp_firestore_unavailable'],
      errorMessage: null,
      configuredProjectId,
    };
  }

  try {
    const snapshot = await getDocs(collection(db, COLLECTION_PATH));
    const rows: GastappMonthlyExportRow[] = [];
    snapshot.forEach((docSnap) => {
      const data = (docSnap.data() || {}) as Record<string, unknown>;
      const monthKey = readString(data.monthKey) || docSnap.id;
      const row: GastappMonthlyExportRow = {
        monthKey,
        periodNumber: readNumber(data.periodNumber),
        periodLabel: readString(data.periodLabel),
        periodKey: readString(data.periodKey),
        periodStartYMD: readString(data.periodStartYMD),
        periodEndYMD: readString(data.periodEndYMD),
        status: readString(data.status),
        dataQuality: readString(data.dataQuality ?? data.data_quality),
        isStale: readBoolean(data.isStale),
        staleReason: readString(data.staleReason ?? data.stale_reason),
        total_contable_eur: readNumber(data.total_contable_eur),
        day_to_day_eur: readNumber(data.day_to_day_eur),
        trips_eur: readNumber(data.trips_eur),
        others_eur: readNumber(data.others_eur),
        legacy_csv_eur: readNumber(data.legacy_csv_eur),
        app_projects_eur: readNumber(data.app_projects_eur),
        sum_over_csv_eur: readNumber(data.sum_over_csv_eur),
        closedAt: readString(data.closedAt),
        reportUpdatedAt: readString(data.reportUpdatedAt),
        summaryUpdatedAt: readString(data.summaryUpdatedAt),
        lastExpenseUpdatedAt: readString(data.lastExpenseUpdatedAt),
        publishedAt: readString(data.publishedAt),
        updated_at: readString(data.updated_at),
        revision: readNumber(data.revision),
        source: readString(data.source),
        day_to_day_source: readString(data.day_to_day_source),
        warnings: '',
      };
      row.warnings = buildWarnings(row);
      rows.push(row);
    });

    rows.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    return {
      status: 'ok',
      included: rows.length > 0,
      rows,
      warnings: rows.length > 0 ? [] : ['gastapp_monthly_collection_empty'],
      errorMessage: null,
      configuredProjectId,
    };
  } catch (error: any) {
    const code = String(error?.code || '');
    return {
      status: code === 'permission-denied' ? 'permission_denied' : code === 'unavailable' ? 'unavailable' : 'error',
      included: false,
      rows: [],
      warnings: [code || 'gastapp_monthly_query_error'],
      errorMessage: String(error?.message || error || 'gastapp_monthly_query_error'),
      configuredProjectId,
    };
  }
};
