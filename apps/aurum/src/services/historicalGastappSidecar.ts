import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { db, ensureAuthPersistence, getCurrentUid } from './firebase';
import {
  normalizeGastappMonthlyExpenseCloseSnapshot,
  WEALTH_DATA_UPDATED_EVENT,
  type GastappMonthlyExpenseCloseSnapshot,
} from './wealthStorage';

export const HISTORICAL_GASTAPP_SIDECAR_ID = 'historical_v1';
export const HISTORICAL_GASTAPP_SIDECAR_SCHEMA = 'aurum-gastapp-historical-sidecar-v1';

export type HistoricalGastappSidecarEntry = {
  closureId: string;
  snapshot: GastappMonthlyExpenseCloseSnapshot;
  repairAudit: {
    reason: 'historical_schema_compatibility_reconstruction';
    reconstructedAt: string;
    originalClosureAt: string;
    preFingerprint: string;
    postFingerprint: string;
    sourceContractHash: string;
  };
};

export type HistoricalGastappSidecarDocument = {
  schemaVersion: typeof HISTORICAL_GASTAPP_SIDECAR_SCHEMA;
  snapshotsByMonth: Record<string, HistoricalGastappSidecarEntry>;
};

export type HistoricalGastappSidecarAnalysisState = {
  uid: string | null;
  status: 'loading' | 'ready' | 'error';
  document: HistoricalGastappSidecarDocument | null;
  hasAuthoritativeSnapshot: boolean;
  dataRevision: number;
  revision: number;
  error: string | null;
};

const initialAnalysisState = (): HistoricalGastappSidecarAnalysisState => ({
  uid: null,
  status: 'loading',
  document: null,
  hasAuthoritativeSnapshot: false,
  dataRevision: 0,
  revision: 0,
  error: null,
});

let analysisState = initialAnalysisState();
const analysisStateSubscribers = new Set<() => void>();

const publishAnalysisState = (
  next: Omit<HistoricalGastappSidecarAnalysisState, 'revision'>,
  historicalDataChanged = false,
) => {
  analysisState = { ...next, revision: analysisState.revision + 1 };
  analysisStateSubscribers.forEach((subscriber) => subscriber());
  if (historicalDataChanged && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WEALTH_DATA_UPDATED_EVENT));
  }
};

export const getHistoricalGastappSidecarAnalysisState = () => analysisState;

export const subscribeHistoricalGastappSidecarAnalysisState = (subscriber: () => void) => {
  analysisStateSubscribers.add(subscriber);
  return () => analysisStateSubscribers.delete(subscriber);
};

export const canUseHistoricalGastappSidecarForAnalysis = (
  state: HistoricalGastappSidecarAnalysisState,
  uid: string | null,
) => Boolean(uid && state.uid === uid && state.hasAuthoritativeSnapshot);

const publishLoading = (uid: string) => {
  const sameAccount = analysisState.uid === uid;
  publishAnalysisState({
    uid,
    status: 'loading',
    document: sameAccount ? analysisState.document : null,
    hasAuthoritativeSnapshot: sameAccount && analysisState.hasAuthoritativeSnapshot,
    dataRevision: analysisState.dataRevision,
    error: null,
  });
};

const publishReady = (uid: string, document: HistoricalGastappSidecarDocument | null) => {
  const sameAccount = analysisState.uid === uid;
  const changed = !sameAccount || !analysisState.hasAuthoritativeSnapshot ||
    JSON.stringify(analysisState.document) !== JSON.stringify(document);
  publishAnalysisState({
    uid,
    status: 'ready',
    document,
    hasAuthoritativeSnapshot: true,
    dataRevision: analysisState.dataRevision + (changed ? 1 : 0),
    error: null,
  }, changed);
};

const errorText = (error: unknown) => String((error as { message?: unknown })?.message || error || 'Error de lectura.');

const publishError = (uid: string, error: unknown) => {
  const sameAccount = analysisState.uid === uid;
  publishAnalysisState({
    uid,
    status: 'error',
    document: sameAccount ? analysisState.document : null,
    hasAuthoritativeSnapshot: sameAccount && analysisState.hasAuthoritativeSnapshot,
    dataRevision: analysisState.dataRevision,
    error: errorText(error),
  });
};

export const clearHistoricalGastappSidecarForAnalysis = (uid?: string | null) => {
  if (uid && analysisState.uid !== uid) return;
  publishAnalysisState({
    uid: null,
    status: 'loading',
    document: null,
    hasAuthoritativeSnapshot: false,
    dataRevision: analysisState.dataRevision,
    error: null,
  });
};

export const parseHistoricalGastappSidecar = (raw: unknown): HistoricalGastappSidecarDocument | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== HISTORICAL_GASTAPP_SIDECAR_SCHEMA || !value.snapshotsByMonth ||
      typeof value.snapshotsByMonth !== 'object' || Array.isArray(value.snapshotsByMonth)) return null;
  const entries: Record<string, HistoricalGastappSidecarEntry> = {};
  for (const [monthKey, untrusted] of Object.entries(value.snapshotsByMonth as Record<string, unknown>)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) || !untrusted || typeof untrusted !== 'object') return null;
    const entry = untrusted as HistoricalGastappSidecarEntry;
    const snapshot = normalizeGastappMonthlyExpenseCloseSnapshot(entry.snapshot, monthKey);
    if (!entry.closureId || !snapshot || !entry.repairAudit ||
        entry.repairAudit.reason !== 'historical_schema_compatibility_reconstruction' ||
        entry.repairAudit.sourceContractHash !== snapshot.contractHash ||
        !entry.repairAudit.preFingerprint ||
        entry.repairAudit.preFingerprint !== entry.repairAudit.postFingerprint) return null;
    entries[monthKey] = { ...entry, snapshot };
  }
  return { schemaVersion: HISTORICAL_GASTAPP_SIDECAR_SCHEMA, snapshotsByMonth: entries };
};

export const getHistoricalGastappSnapshotForAnalysis = (
  monthKey: string,
  closureId: string,
): GastappMonthlyExpenseCloseSnapshot | undefined => {
  const entry = analysisState.document?.snapshotsByMonth[monthKey];
  return entry?.closureId === closureId ? entry.snapshot : undefined;
};

export const setHistoricalGastappSidecarForAnalysis = (
  uid: string | null,
  document: HistoricalGastappSidecarDocument | null,
) => {
  if (!uid) {
    clearHistoricalGastappSidecarForAnalysis();
    return;
  }
  publishReady(uid, document);
};

export const historicalGastappSidecarRef = (uid: string) =>
  doc(db, 'aurum_wealth', uid, 'gastapp_snapshots', HISTORICAL_GASTAPP_SIDECAR_ID);

/** Server-only read for audit and write preflight. Never hydrates wealth closures. */
export const readHistoricalGastappSidecarFromServer = async () => {
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) throw new Error('Sin sesión para leer el sidecar histórico.');
  const snap = await getDocFromServer(historicalGastappSidecarRef(uid));
  const parsed = snap.exists() ? parseHistoricalGastappSidecar(snap.data()) : null;
  if (snap.exists() && !parsed) throw new Error('Sidecar histórico existente incompatible; escritura detenida.');
  return { uid, exists: snap.exists(), document: parsed, raw: snap.exists() ? snap.data() : null };
};

const readAndPublishAuthoritativeSidecar = async (uid: string, isActive: () => boolean) => {
  try {
    await ensureAuthPersistence();
    if (!isActive() || getCurrentUid() !== uid) return false;
    const snap = await getDocFromServer(historicalGastappSidecarRef(uid));
    if (!isActive() || getCurrentUid() !== uid) return false;
    const parsed = snap.exists() ? parseHistoricalGastappSidecar(snap.data()) : null;
    if (snap.exists() && !parsed) throw new Error('Sidecar histórico incompatible.');
    publishReady(uid, parsed);
    return true;
  } catch (error) {
    if (isActive() && getCurrentUid() === uid) publishError(uid, error);
    return false;
  }
};

/** Retries an authoritative server read without clearing the last valid analysis overlay. */
export const retryHistoricalGastappSidecarRead = async () => {
  const uid = getCurrentUid();
  if (!uid) return false;
  return readAndPublishAuthoritativeSidecar(uid, () => getCurrentUid() === uid);
};

/**
 * Analysis-only subscription. It publishes a server read before accepting listener data,
 * and never feeds the overlay into closure hydration or cloud sync.
 */
export const subscribeHistoricalGastappSidecarForAnalysis = (): (() => void) => {
  const uid = getCurrentUid();
  if (!uid) {
    clearHistoricalGastappSidecarForAnalysis();
    return () => {};
  }

  publishLoading(uid);
  let disposed = false;
  let unsubscribe = () => {};
  const isActive = () => !disposed && getCurrentUid() === uid;

  void (async () => {
    await readAndPublishAuthoritativeSidecar(uid, isActive);
    if (!isActive()) return;

    try {
      unsubscribe = onSnapshot(
        historicalGastappSidecarRef(uid),
        { includeMetadataChanges: true },
        (snap) => {
          if (!isActive() || snap.metadata?.fromCache) return;
          try {
            const parsed = snap.exists() ? parseHistoricalGastappSidecar(snap.data()) : null;
            if (snap.exists() && !parsed) throw new Error('Sidecar histórico incompatible.');
            publishReady(uid, parsed);
          } catch (error) {
            publishError(uid, error);
          }
        },
        (error) => {
          if (isActive()) publishError(uid, error);
        },
      );
    } catch (error) {
      if (isActive()) publishError(uid, error);
    }
  })();

  return () => {
    disposed = true;
    unsubscribe();
    clearHistoricalGastappSidecarForAnalysis(uid);
  };
};
