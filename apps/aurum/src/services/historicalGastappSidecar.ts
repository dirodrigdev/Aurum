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

let activeUid: string | null = null;
let analysisEntries: Record<string, HistoricalGastappSidecarEntry> = {};

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
  const entry = analysisEntries[monthKey];
  return entry?.closureId === closureId ? entry.snapshot : undefined;
};

export const setHistoricalGastappSidecarForAnalysis = (
  uid: string | null,
  document: HistoricalGastappSidecarDocument | null,
) => {
  activeUid = uid;
  analysisEntries = document?.snapshotsByMonth || {};
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WEALTH_DATA_UPDATED_EVENT));
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

/** Separate analysis-only subscription. No sidecar data enters loadClosures or cloud sync. */
export const subscribeHistoricalGastappSidecarForAnalysis = async (): Promise<() => void> => {
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) return () => {};
  if (activeUid !== uid) setHistoricalGastappSidecarForAnalysis(uid, null);
  return onSnapshot(historicalGastappSidecarRef(uid), (snap) => {
    const parsed = snap.exists() ? parseHistoricalGastappSidecar(snap.data()) : null;
    setHistoricalGastappSidecarForAnalysis(uid, parsed);
  }, () => setHistoricalGastappSidecarForAnalysis(uid, null));
};
