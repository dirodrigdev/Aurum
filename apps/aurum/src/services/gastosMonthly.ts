import { collection, getDocs } from 'firebase/firestore';
import { GASTAPP_TOTALS } from '../data/gastappTotals';
import { getGastappFirestore, isGastappFirestoreConfigured } from './firebase';

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

const resolveFromFirestore = (monthKey: string, now: Date): GastosMonthResolution => {
  const fromMap = gastappMonthlyRuntime.map[monthKey];
  if (fromMap) {
    return {
      monthKey,
      status: fromMap.status,
      gastosEur: fromMap.gastosEur,
      source: 'gastapp_firestore',
    };
  }

  return {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'gastapp_firestore',
  };
};

const loadGastappMonthlyContable = async () => {
  if (gastappMonthlyRuntime.status === 'loading' && gastappMonthlyRuntime.loadPromise) {
    return gastappMonthlyRuntime.loadPromise;
  }
  if (gastappMonthlyRuntime.status === 'ready') return;

  gastappMonthlyRuntime.status = 'loading';
  gastappMonthlyRuntime.error = null;
  gastappMonthlyRuntime.loadPromise = (async () => {
    if (!isGastappFirestoreConfigured()) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = 'gastapp_firestore_not_configured';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.warn('[AURUM][gastapp-monthly] fallback legacy (missing GastApp Firebase env vars)');
      emitGastappSourceUpdated();
      return;
    }

    const db = getGastappFirestore();
    if (!db) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = 'gastapp_firestore_unavailable';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.warn('[AURUM][gastapp-monthly] fallback legacy (GastApp Firestore unavailable)');
      emitGastappSourceUpdated();
      return;
    }

    try {
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
      emitGastappSourceUpdated();
    } catch (error: any) {
      gastappMonthlyRuntime.status = 'error';
      gastappMonthlyRuntime.mode = 'legacy';
      gastappMonthlyRuntime.error = String(error?.message || error || 'unknown_error');
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.warn('[AURUM][gastapp-monthly] firestore unavailable, fallback legacy', {
        error: gastappMonthlyRuntime.error,
      });
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

  return resolveFromLegacy(monthKey, now);
};
