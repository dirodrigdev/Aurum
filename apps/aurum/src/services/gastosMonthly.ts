import { collection, getDocs } from 'firebase/firestore';
import { GASTAPP_TOTALS } from '../data/gastappTotals';

export type GastosMonthStatus = 'complete' | 'pending' | 'missing';
export type GastosContractStatus = GastosMonthStatus | 'stale';
export type GastosMonthSource = 'gastapp_firestore' | 'legacy_static';
export type GastosMonthDataQuality = 'ok' | 'warning' | 'error';

export type GastosMonthResolution = {
  monthKey: string;
  status: GastosMonthStatus;
  gastosEur: number | null;
  source: GastosMonthSource;
  contractStatus?: GastosContractStatus | null;
  dataQuality?: GastosMonthDataQuality | null;
  isStale?: boolean;
  staleReason?: string | null;
  dayToDaySource?: string | null;
  contractSource?: string | null;
  schemaVersion?: string | null;
  methodologyVersion?: string | null;
  periodKey?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  reportUpdatedAt?: string | null;
  summaryUpdatedAt?: string | null;
  lastExpenseUpdatedAt?: string | null;
  revision?: number | null;
  reportTotalEur?: number | null;
  summaryTotalEur?: number | null;
  directExpenseTotalEur?: number | null;
  reportVsDirectDiffEur?: number | null;
  summaryVsDirectDiffEur?: number | null;
  reportVsSummaryDiffEur?: number | null;
  categoryGapEur?: number | null;
};

type GastappMonthlyContableDoc = {
  monthKey?: unknown;
  status?: unknown;
  total_contable_eur?: unknown;
  dataQuality?: unknown;
  data_quality?: unknown;
  isStale?: unknown;
  staleReason?: unknown;
  stale_reason?: unknown;
  schema_version?: unknown;
  methodology_version?: unknown;
  periodKey?: unknown;
  source?: unknown;
  day_to_day_source?: unknown;
  closedAt?: unknown;
  reportUpdatedAt?: unknown;
  summaryUpdatedAt?: unknown;
  lastExpenseUpdatedAt?: unknown;
  publishedAt?: unknown;
  updated_at?: unknown;
  revision?: unknown;
  reportTotalEur?: unknown;
  summaryTotalEur?: unknown;
  directExpenseTotalEur?: unknown;
  reportVsDirectDiffEur?: unknown;
  summaryVsDirectDiffEur?: unknown;
  reportVsSummaryDiffEur?: unknown;
  categoryGapEur?: unknown;
};

type GastappMonthlyContableEntry = {
  status: GastosMonthStatus;
  contractStatus: GastosContractStatus | null;
  gastosEur: number | null;
  dataQuality: GastosMonthDataQuality | null;
  isStale: boolean;
  staleReason: string | null;
  dayToDaySource: string | null;
  contractSource: string | null;
  schemaVersion: string | null;
  methodologyVersion: string | null;
  periodKey: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  reportUpdatedAt: string | null;
  summaryUpdatedAt: string | null;
  lastExpenseUpdatedAt: string | null;
  revision: number | null;
  reportTotalEur: number | null;
  summaryTotalEur: number | null;
  directExpenseTotalEur: number | null;
  reportVsDirectDiffEur: number | null;
  summaryVsDirectDiffEur: number | null;
  reportVsSummaryDiffEur: number | null;
  categoryGapEur: number | null;
};

export const GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT = 'aurum:gastapp-monthly-source-updated';
const GASTAPP_DIAG_PREFIX = '[AURUM][gastapp-monthly][diag]';
const GASTAPP_MONTHLY_COLLECTION = 'aurum_monthly_from_periods_v1';
const GASTAPP_DIAG_ENABLED = Boolean(import.meta.env.DEV || import.meta.env.VITE_GASTAPP_DIAG === '1');

const diagInfo = (message: string) => {
  if (!GASTAPP_DIAG_ENABLED) return;
  console.info(message);
};

const diagWarn = (message: string) => {
  if (!GASTAPP_DIAG_ENABLED) return;
  console.warn(message);
};

const gastappMonthlyRuntime: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: 'firestore' | 'legacy' | null;
  map: Record<string, GastappMonthlyContableEntry>;
  loadPromise: Promise<void> | null;
  error: string | null;
  lastUpdatedAt: string | null;
  configuredProjectId: string;
} = {
  status: 'idle',
  mode: null,
  map: {},
  loadPromise: null,
  error: null,
  lastUpdatedAt: null,
  configuredProjectId: '',
};

const gastappMonthlyDiag = {
  didLogMode: false,
  lastMarchSignature: '',
};

type GastappFirebaseBridge = {
  getGastappConfiguredProjectId: () => string;
  isGastappFirestoreConfigured: () => boolean;
  getGastappFirestore: () => ReturnType<typeof import('firebase/firestore').getFirestore> | null;
};

const loadGastappFirebaseBridge = async (): Promise<GastappFirebaseBridge | null> => {
  try {
    const mod = await import('./firebase');
    return {
      getGastappConfiguredProjectId: mod.getGastappConfiguredProjectId,
      isGastappFirestoreConfigured: mod.isGastappFirestoreConfigured,
      getGastappFirestore: mod.getGastappFirestore,
    };
  } catch (error: any) {
    gastappMonthlyRuntime.error = `gastapp_firebase_bridge_unavailable:${String(error?.message || error || 'unknown_error')}`;
    return null;
  }
};

const parseMonthKey = (monthKey: string): { year: number; month: number } | null => {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
};

const monthCloseCutoff = (monthKey: string, closingDay = 11): Date | null => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  // Regla operativa: el mes YYYY-MM queda "cerrado" desde el día 12 del mes siguiente.
  const nextMonthIndex = parsed.month; // Date usa base 0
  return new Date(parsed.year, nextMonthIndex, closingDay + 1, 0, 0, 0, 0);
};

export const isGastappMonthClosed = (monthKey: string, now = new Date(), closingDay = 11): boolean => {
  const cutoff = monthCloseCutoff(monthKey, closingDay);
  if (!cutoff) return false;
  return now.getTime() >= cutoff.getTime();
};

const inferStatusWithoutTotal = (monthKey: string, now: Date): GastosMonthStatus =>
  isGastappMonthClosed(monthKey, now) ? 'missing' : 'pending';

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const readNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// TEMP LEGACY FALLBACK (deprecado): se mantiene solo para transición controlada.
// Retirar cuando la lectura desde `aurum_monthly_from_periods_v1` esté validada al 100%.
const resolveFromLegacy = (monthKey: string, now: Date): GastosMonthResolution => {
  const raw = GASTAPP_TOTALS[monthKey];
  if (Number.isFinite(raw)) {
    return {
      monthKey,
      status: 'complete',
      gastosEur: Number(raw),
      source: 'legacy_static',
      contractStatus: null,
      dataQuality: 'warning',
      isStale: false,
      staleReason: null,
      dayToDaySource: 'legacy',
      contractSource: 'legacy_static',
    };
  }

  return {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'legacy_static',
    contractStatus: null,
    dataQuality: 'warning',
    isStale: false,
    staleReason: null,
    dayToDaySource: 'legacy',
    contractSource: 'legacy_static',
  };
};

const normalizeDocStatus = (value: unknown): GastosContractStatus | null => {
  if (value === 'complete' || value === 'pending' || value === 'missing' || value === 'stale') return value;
  return null;
};

const normalizeDataQuality = (value: unknown): GastosMonthDataQuality | null => {
  if (value === 'ok' || value === 'warning' || value === 'error') return value;
  return null;
};

const isValidMonthKey = (value: string) => /^\d{4}-\d{2}$/.test(value);

const emitGastappSourceUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT));
};

const configuredProjectIdForLogs = () => gastappMonthlyRuntime.configuredProjectId || 'n/a';

const logSourceModeOnce = () => {
  if (gastappMonthlyDiag.didLogMode) return;
  if (gastappMonthlyRuntime.mode === 'firestore') {
    diagInfo(
      `${GASTAPP_DIAG_PREFIX} source=gastapp_firestore projectId_configured=${configuredProjectIdForLogs()}`,
    );
    gastappMonthlyDiag.didLogMode = true;
    return;
  }
  if (gastappMonthlyRuntime.mode === 'legacy') {
    console.error(
      `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=${gastappMonthlyRuntime.error || 'unknown'} projectId_configured=${configuredProjectIdForLogs()}`,
    );
    gastappMonthlyDiag.didLogMode = true;
  }
};

const logMarchResolutionIfNeeded = (
  origin: 'firestore' | 'legacy',
  resolution: GastosMonthResolution,
  reason: string,
) => {
  if (resolution.monthKey !== '2026-03') return;
  const signature = `${origin}|${resolution.source}|${resolution.status}|${resolution.gastosEur ?? 'null'}|${reason}|${gastappMonthlyRuntime.mode}|${gastappMonthlyRuntime.status}|${gastappMonthlyRuntime.error || 'none'}`;
  if (gastappMonthlyDiag.lastMarchSignature === signature) return;
  gastappMonthlyDiag.lastMarchSignature = signature;
  diagWarn(
    `${GASTAPP_DIAG_PREFIX} month=2026-03 source=${resolution.source} status=${resolution.status} total_contable_eur=${resolution.gastosEur ?? 'null'} reason=${reason} runtime_mode=${gastappMonthlyRuntime.mode || 'n/a'} runtime_status=${gastappMonthlyRuntime.status} runtime_error=${gastappMonthlyRuntime.error || 'none'}`,
  );
};

const resolveFromFirestore = (monthKey: string, now: Date): GastosMonthResolution => {
  const fromMap = gastappMonthlyRuntime.map[monthKey];
  if (fromMap) {
    const resolution: GastosMonthResolution = {
      monthKey,
      status: fromMap.status,
      gastosEur: fromMap.gastosEur,
      source: 'gastapp_firestore',
      contractStatus: fromMap.contractStatus,
      dataQuality: fromMap.dataQuality,
      isStale: fromMap.isStale,
      staleReason: fromMap.staleReason,
      dayToDaySource: fromMap.dayToDaySource,
      contractSource: fromMap.contractSource,
      schemaVersion: fromMap.schemaVersion,
      methodologyVersion: fromMap.methodologyVersion,
      periodKey: fromMap.periodKey,
      publishedAt: fromMap.publishedAt,
      updatedAt: fromMap.updatedAt,
      closedAt: fromMap.closedAt,
      reportUpdatedAt: fromMap.reportUpdatedAt,
      summaryUpdatedAt: fromMap.summaryUpdatedAt,
      lastExpenseUpdatedAt: fromMap.lastExpenseUpdatedAt,
      revision: fromMap.revision,
      reportTotalEur: fromMap.reportTotalEur,
      summaryTotalEur: fromMap.summaryTotalEur,
      directExpenseTotalEur: fromMap.directExpenseTotalEur,
      reportVsDirectDiffEur: fromMap.reportVsDirectDiffEur,
      summaryVsDirectDiffEur: fromMap.summaryVsDirectDiffEur,
      reportVsSummaryDiffEur: fromMap.reportVsSummaryDiffEur,
      categoryGapEur: fromMap.categoryGapEur,
    };
    logMarchResolutionIfNeeded('firestore', resolution, 'doc_found_in_firestore');
    return resolution;
  }

  const resolution: GastosMonthResolution = {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'gastapp_firestore',
    contractStatus: null,
    dataQuality: null,
    isStale: false,
    staleReason: null,
    dayToDaySource: null,
    contractSource: null,
  };
  const reason =
    gastappMonthlyRuntime.status === 'ready'
      ? 'doc_not_found_in_firestore_cache'
      : `firestore_runtime_${gastappMonthlyRuntime.status}`;
  logMarchResolutionIfNeeded('firestore', resolution, reason);
  return resolution;
};

const loadGastappMonthlyContable = async () => {
  if (gastappMonthlyRuntime.status === 'loading' && gastappMonthlyRuntime.loadPromise) {
    return gastappMonthlyRuntime.loadPromise;
  }
  if (gastappMonthlyRuntime.status === 'ready') return;

  gastappMonthlyRuntime.status = 'loading';
  gastappMonthlyRuntime.error = null;
  gastappMonthlyRuntime.loadPromise = (async () => {
    const firebaseBridge = await loadGastappFirebaseBridge();
    if (!firebaseBridge) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      logSourceModeOnce();
      emitGastappSourceUpdated();
      return;
    }

    gastappMonthlyRuntime.configuredProjectId = String(firebaseBridge.getGastappConfiguredProjectId() || '');
    const firestoreConfigured = firebaseBridge.isGastappFirestoreConfigured();
    diagInfo(
      `${GASTAPP_DIAG_PREFIX} loading_start firestore_configured=${firestoreConfigured} projectId_configured=${configuredProjectIdForLogs()}`,
    );

    if (!firestoreConfigured) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = 'gastapp_firestore_not_configured';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=gastapp_firestore_not_configured projectId_configured=${configuredProjectIdForLogs()}`,
      );
      logSourceModeOnce();
      emitGastappSourceUpdated();
      return;
    }

    const db = firebaseBridge.getGastappFirestore();
    if (!db) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = 'gastapp_firestore_unavailable';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=gastapp_firestore_unavailable projectId_configured=${configuredProjectIdForLogs()}`,
      );
      logSourceModeOnce();
      emitGastappSourceUpdated();
      return;
    }

    try {
      const runtimeProjectId = String(db.app.options.projectId || '');
      diagInfo(
        `${GASTAPP_DIAG_PREFIX} query_start collection=${GASTAPP_MONTHLY_COLLECTION} projectId_runtime=${runtimeProjectId || 'n/a'}`,
      );
      const snapshot = await getDocs(collection(db, GASTAPP_MONTHLY_COLLECTION));
      const loaded: Record<string, GastappMonthlyContableEntry> = {};
      const now = new Date();

      snapshot.forEach((doc) => {
        const data = (doc.data() || {}) as GastappMonthlyContableDoc;
        const rawMonthKey =
          typeof data.monthKey === 'string' && isValidMonthKey(data.monthKey)
            ? data.monthKey
            : isValidMonthKey(doc.id)
              ? doc.id
              : null;
        if (!rawMonthKey) return;

        const normalizedStatus = normalizeDocStatus(data.status);
        const normalizedDataQuality = normalizeDataQuality(data.dataQuality ?? data.data_quality);
        const rawTotal = Number(data.total_contable_eur);
        const hasTotal = Number.isFinite(rawTotal);
        const explicitIsStale = readBoolean(data.isStale);
        const staleReason = readString(data.staleReason ?? data.stale_reason);

        let status: GastosMonthStatus =
          normalizedStatus === 'complete' || normalizedStatus === 'stale'
            ? 'complete'
            : normalizedStatus ?? inferStatusWithoutTotal(rawMonthKey, now);
        let gastosEur: number | null = hasTotal ? rawTotal : null;

        if (status === 'complete' && gastosEur === null) {
          status = inferStatusWithoutTotal(rawMonthKey, now);
        }
        if (status !== 'complete') {
          gastosEur = null;
        }

        loaded[rawMonthKey] = {
          status,
          contractStatus: normalizedStatus,
          gastosEur,
          dataQuality: normalizedDataQuality,
          isStale: explicitIsStale ?? normalizedStatus === 'stale',
          staleReason,
          dayToDaySource: readString(data.day_to_day_source),
          contractSource: readString(data.source),
          schemaVersion: readString(data.schema_version),
          methodologyVersion: readString(data.methodology_version),
          periodKey: readString(data.periodKey),
          publishedAt: readString(data.publishedAt),
          updatedAt: readString(data.updated_at),
          closedAt: readString(data.closedAt),
          reportUpdatedAt: readString(data.reportUpdatedAt),
          summaryUpdatedAt: readString(data.summaryUpdatedAt),
          lastExpenseUpdatedAt: readString(data.lastExpenseUpdatedAt),
          revision: readNumber(data.revision),
          reportTotalEur: readNumber(data.reportTotalEur),
          summaryTotalEur: readNumber(data.summaryTotalEur),
          directExpenseTotalEur: readNumber(data.directExpenseTotalEur),
          reportVsDirectDiffEur: readNumber(data.reportVsDirectDiffEur),
          summaryVsDirectDiffEur: readNumber(data.summaryVsDirectDiffEur),
          reportVsSummaryDiffEur: readNumber(data.reportVsSummaryDiffEur),
          categoryGapEur: readNumber(data.categoryGapEur),
        };
      });

      gastappMonthlyRuntime.map = loaded;
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'firestore';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      logSourceModeOnce();
      const march = loaded['2026-03'] || null;
      diagInfo(
        `${GASTAPP_DIAG_PREFIX} query_done collection=${GASTAPP_MONTHLY_COLLECTION} docs=${snapshot.size} month_2026_03_found=${Boolean(march)} projectId_runtime=${runtimeProjectId || 'n/a'}`,
      );
      if (march) {
        diagInfo(
          `${GASTAPP_DIAG_PREFIX} month=2026-03 status=${march.status} total_contable_eur=${march.gastosEur ?? 'null'} source=gastapp_firestore`,
        );
      } else {
        const reason = snapshot.empty ? 'collection_empty' : 'month_doc_not_found';
        diagWarn(
          `${GASTAPP_DIAG_PREFIX} month=2026-03 not_found reason=${reason} fallback_status=${inferStatusWithoutTotal('2026-03', now)}`,
        );
      }
      emitGastappSourceUpdated();
    } catch (error: any) {
      gastappMonthlyRuntime.status = 'error';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = String(error?.message || error || 'unknown_error');
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=firestore_query_exception error=${gastappMonthlyRuntime.error} projectId_configured=${configuredProjectIdForLogs()}`,
      );
      logSourceModeOnce();
      emitGastappSourceUpdated();
    }
  })()
    .finally(() => {
      gastappMonthlyRuntime.loadPromise = null;
    });

  return gastappMonthlyRuntime.loadPromise;
};

export const warmGastappMonthlyContable = async () => {
  await loadGastappMonthlyContable();
};

export const resolveGastappMonthlySpend = (monthKey: string, now = new Date()): GastosMonthResolution => {
  if (gastappMonthlyRuntime.status === 'idle') {
    void loadGastappMonthlyContable();
  }

  if (gastappMonthlyRuntime.mode === 'firestore' && gastappMonthlyRuntime.status === 'ready') {
    return resolveFromFirestore(monthKey, now);
  }

  const legacy = resolveFromLegacy(monthKey, now);
  logSourceModeOnce();
  if (monthKey === '2026-03') {
    const reason =
      gastappMonthlyRuntime.mode === 'legacy'
        ? `legacy_mode_${gastappMonthlyRuntime.error || 'fallback'}`
        : `firestore_not_ready_${gastappMonthlyRuntime.status}`;
    logMarchResolutionIfNeeded('legacy', legacy, reason);
  }
  return legacy;
};
