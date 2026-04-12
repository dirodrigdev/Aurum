import { collection, getDocs } from 'firebase/firestore';
import { GASTAPP_TOTALS } from '../data/gastappTotals';
import {
  getGastappConfiguredProjectId,
  getGastappFirestore,
  isGastappFirestoreConfigured,
} from './firebase';

export type GastosMonthStatus = 'complete' | 'pending' | 'missing';
export type GastosMonthSource = 'gastapp_firestore' | 'legacy_static';

export type GastosMonthResolution = {
  monthKey: string;
  status: GastosMonthStatus;
  gastosEur: number | null;
  source: GastosMonthSource;
};

type GastappMonthlyContableDoc = {
  monthKey?: unknown;
  status?: unknown;
  total_contable_eur?: unknown;
};

type GastappMonthlyContableEntry = {
  status: GastosMonthStatus;
  gastosEur: number | null;
};

export const GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT = 'aurum:gastapp-monthly-source-updated';
const GASTAPP_DIAG_PREFIX = '[AURUM][gastapp-monthly][diag]';

const gastappMonthlyRuntime: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: 'firestore' | 'legacy' | null;
  map: Record<string, GastappMonthlyContableEntry>;
  loadPromise: Promise<void> | null;
  error: string | null;
  lastUpdatedAt: string | null;
} = {
  status: 'idle',
  mode: null,
  map: {},
  loadPromise: null,
  error: null,
  lastUpdatedAt: null,
};

const gastappMonthlyDiag = {
  didLogMode: false,
  lastMarchSignature: '',
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

const resolveFromLegacy = (monthKey: string, now: Date): GastosMonthResolution => {
  const raw = GASTAPP_TOTALS[monthKey];
  if (Number.isFinite(raw)) {
    return {
      monthKey,
      status: 'complete',
      gastosEur: Number(raw),
      source: 'legacy_static',
    };
  }

  return {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'legacy_static',
  };
};

const normalizeDocStatus = (value: unknown): GastosMonthStatus | null => {
  if (value === 'complete' || value === 'pending' || value === 'missing') return value;
  return null;
};

const isValidMonthKey = (value: string) => /^\d{4}-\d{2}$/.test(value);

const emitGastappSourceUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT));
};

const logSourceModeOnce = () => {
  if (gastappMonthlyDiag.didLogMode) return;
  if (gastappMonthlyRuntime.mode === 'firestore') {
    console.info(
      `${GASTAPP_DIAG_PREFIX} source=gastapp_firestore projectId_configured=${getGastappConfiguredProjectId() || 'n/a'}`,
    );
    gastappMonthlyDiag.didLogMode = true;
    return;
  }
  if (gastappMonthlyRuntime.mode === 'legacy') {
    console.error(
      `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=${gastappMonthlyRuntime.error || 'unknown'} projectId_configured=${getGastappConfiguredProjectId() || 'n/a'}`,
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
  console.warn(
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
    };
    logMarchResolutionIfNeeded('firestore', resolution, 'doc_found_in_firestore');
    return resolution;
  }

  const resolution: GastosMonthResolution = {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'gastapp_firestore',
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
  console.info(
    `${GASTAPP_DIAG_PREFIX} loading_start firestore_configured=${isGastappFirestoreConfigured()} projectId_configured=${getGastappConfiguredProjectId() || 'n/a'}`,
  );
  gastappMonthlyRuntime.loadPromise = (async () => {
    if (!isGastappFirestoreConfigured()) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = 'gastapp_firestore_not_configured';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=gastapp_firestore_not_configured projectId_configured=${getGastappConfiguredProjectId() || 'n/a'}`,
      );
      logSourceModeOnce();
      emitGastappSourceUpdated();
      return;
    }

    const db = getGastappFirestore();
    if (!db) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = 'gastapp_firestore_unavailable';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=gastapp_firestore_unavailable projectId_configured=${getGastappConfiguredProjectId() || 'n/a'}`,
      );
      logSourceModeOnce();
      emitGastappSourceUpdated();
      return;
    }

    try {
      const runtimeProjectId = String(db.app.options.projectId || '');
      console.info(
        `${GASTAPP_DIAG_PREFIX} query_start collection=aurum_monthly_contable projectId_runtime=${runtimeProjectId || 'n/a'}`,
      );
      const snapshot = await getDocs(collection(db, 'aurum_monthly_contable'));
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
        const rawTotal = Number(data.total_contable_eur);
        const hasTotal = Number.isFinite(rawTotal);

        let status: GastosMonthStatus = normalizedStatus ?? inferStatusWithoutTotal(rawMonthKey, now);
        let gastosEur: number | null = hasTotal ? rawTotal : null;

        if (status === 'complete' && gastosEur === null) {
          status = inferStatusWithoutTotal(rawMonthKey, now);
        }
        if (status !== 'complete') {
          gastosEur = null;
        }

        loaded[rawMonthKey] = {
          status,
          gastosEur,
        };
      });

      gastappMonthlyRuntime.map = loaded;
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'firestore';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      logSourceModeOnce();
      const march = loaded['2026-03'] || null;
      console.info(
        `${GASTAPP_DIAG_PREFIX} query_done collection=aurum_monthly_contable docs=${snapshot.size} month_2026_03_found=${Boolean(march)} projectId_runtime=${runtimeProjectId || 'n/a'}`,
      );
      if (march) {
        console.info(
          `${GASTAPP_DIAG_PREFIX} month=2026-03 status=${march.status} total_contable_eur=${march.gastosEur ?? 'null'} source=gastapp_firestore`,
        );
      } else {
        const reason = snapshot.empty ? 'collection_empty' : 'month_doc_not_found';
        console.warn(
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
        `${GASTAPP_DIAG_PREFIX} source=legacy_fallback reason=firestore_query_exception error=${gastappMonthlyRuntime.error} projectId_configured=${getGastappConfiguredProjectId() || 'n/a'}`,
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
