import { doc, getDocFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, ensureAuthPersistence, getCurrentUid } from './firebase';
import {
  normalizeGastappMonthlyExpenseCloseSnapshot,
  buildGastappMonthlyExpenseCloseSnapshot,
  WEALTH_DATA_UPDATED_EVENT,
  type GastappMonthlyExpenseCloseInput,
  type GastappMonthlyExpenseCloseSnapshot,
} from './wealthStorage';

export const HISTORICAL_GASTAPP_SIDECAR_ID = 'historical_v1';
export const HISTORICAL_GASTAPP_SIDECAR_SCHEMA = 'aurum-gastapp-historical-sidecar-v1';

export type HistoricalGastappSidecarEntry = {
  closureId: string;
  snapshot: GastappMonthlyExpenseCloseSnapshot;
  previousVersions?: HistoricalGastappSidecarVersion[];
  repairAudit: {
    reason: 'historical_schema_compatibility_reconstruction';
    reconstructedAt: string;
    originalClosureAt: string;
    preFingerprint: string;
    postFingerprint: string;
    sourceContractHash: string;
  };
};

export type HistoricalGastappSidecarVersion = {
  snapshot: GastappMonthlyExpenseCloseSnapshot;
  repairAudit: HistoricalGastappSidecarEntry['repairAudit'];
  replacedAt: string;
};

export type HistoricalGastappSidecarRevisionUpdate = {
  monthKey: string;
  closureId: string;
  expectedPreviousContractHash: string;
  expectedCandidateContractHash: string;
  snapshot: GastappMonthlyExpenseCloseInput;
};

export type HistoricalGastappSidecarRevisionWriteResult = {
  document: HistoricalGastappSidecarDocument;
  changed: string[];
  unchanged: string[];
  failed: Array<{ monthKey: string; message: string }>;
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
    if (!entry.closureId || !snapshot) return null;
    const parseAudit = (audit: unknown, auditedSnapshot: GastappMonthlyExpenseCloseSnapshot) => {
      if (!audit || typeof audit !== 'object') return null;
      const value = audit as HistoricalGastappSidecarEntry['repairAudit'];
      if (value.reason !== 'historical_schema_compatibility_reconstruction' ||
          value.sourceContractHash !== auditedSnapshot.contractHash ||
          !value.preFingerprint || value.preFingerprint !== value.postFingerprint) return null;
      return value;
    };
    const repairAudit = parseAudit(entry.repairAudit, snapshot);
    if (!repairAudit) return null;
    const previousVersionsRaw = Array.isArray(entry.previousVersions) ? entry.previousVersions : [];
    const previousVersions: HistoricalGastappSidecarVersion[] = [];
    for (const rawVersion of previousVersionsRaw) {
      if (!rawVersion || typeof rawVersion !== 'object') return null;
      const version = rawVersion as HistoricalGastappSidecarVersion;
      const previousSnapshot = normalizeGastappMonthlyExpenseCloseSnapshot(version.snapshot, monthKey);
      const previousRepairAudit = previousSnapshot ? parseAudit(version.repairAudit, previousSnapshot) : null;
      if (!previousSnapshot || !previousRepairAudit || !Number.isFinite(Date.parse(version.replacedAt)) ||
          previousSnapshot.contractHash === snapshot.contractHash) return null;
      previousVersions.push({ snapshot: previousSnapshot, repairAudit: previousRepairAudit, replacedAt: version.replacedAt });
    }
    entries[monthKey] = {
      ...entry,
      snapshot,
      repairAudit,
      ...(previousVersions.length ? { previousVersions } : {}),
    };
  }
  return { schemaVersion: HISTORICAL_GASTAPP_SIDECAR_SCHEMA, snapshotsByMonth: entries };
};

const SIDE_CAR_REVISION_HISTORY_LIMIT = 36;
const SIDE_CAR_MAX_SAFE_BYTES = 1_048_576 - 131_072;

/**
 * Applies certified GastApp revisions to analysis-only sidecar snapshots.
 * The root closure is read in the same transaction to ensure the sidecar still
 * belongs to that exact closure and remains the effective snapshot source.
 */
export const applyCertifiedHistoricalGastappSidecarRevisions = async (
  updates: HistoricalGastappSidecarRevisionUpdate[],
): Promise<HistoricalGastappSidecarRevisionWriteResult> => {
  if (!updates.length) {
    const document = analysisState.document;
    return { document: document || { schemaVersion: HISTORICAL_GASTAPP_SIDECAR_SCHEMA, snapshotsByMonth: {} }, changed: [], unchanged: [], failed: [] };
  }
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) throw new Error('Sin sesión para conciliar snapshots históricos de GastApp.');
  const rootRef = doc(db, 'aurum_wealth', uid);
  const sidecarRef = historicalGastappSidecarRef(uid);
  const acceptedAt = new Date().toISOString();
  const result = await runTransaction(db, async (transaction) => {
    const rootSnap = await transaction.get(rootRef);
    const sidecarSnap = await transaction.get(sidecarRef);
    if (!rootSnap.exists() || !sidecarSnap.exists()) throw new Error('Falta el cierre o sidecar cloud vigente.');
    const rawRoot = rootSnap.data() || {};
    const rawClosures = Array.isArray(rawRoot.closures) ? rawRoot.closures : [];
    const parsedSidecar = parseHistoricalGastappSidecar(sidecarSnap.data());
    if (!parsedSidecar) throw new Error('Sidecar histórico incompatible; no se modificó.');
    const nextEntries = { ...parsedSidecar.snapshotsByMonth };
    const changed: string[] = [];
    const unchanged: string[] = [];
    const failed: HistoricalGastappSidecarRevisionWriteResult['failed'] = [];

    for (const update of updates) {
      const closureMatches = rawClosures.filter((raw: any) => String(raw?.monthKey || '') === update.monthKey);
      if (closureMatches.length !== 1 || String(closureMatches[0]?.id || '') !== update.closureId) {
        failed.push({ monthKey: update.monthKey, message: 'El cierre histórico desapareció o cambió de identidad.' });
        continue;
      }
      if (closureMatches[0]?.gastappExpenseClose) {
        failed.push({ monthKey: update.monthKey, message: 'El cierre principal ya tiene snapshot; el sidecar no es la fuente efectiva.' });
        continue;
      }
      const current = nextEntries[update.monthKey];
      if (!current || current.closureId !== update.closureId) {
        failed.push({ monthKey: update.monthKey, message: 'El sidecar ya no corresponde al cierre histórico.' });
        continue;
      }
      if (update.snapshot.contractHash !== update.expectedCandidateContractHash ||
          update.snapshot.monthContractHash !== update.expectedCandidateContractHash ||
          !['certified', 'revised'].includes(update.snapshot.certificationStatus)) {
        failed.push({ monthKey: update.monthKey, message: 'El contrato candidato no conserva una identidad certificada coherente.' });
        continue;
      }
      if (current.snapshot.contractHash === update.expectedCandidateContractHash) {
        if (current.snapshot.totalEur !== update.snapshot.totalEur) {
          failed.push({ monthKey: update.monthKey, message: 'Mismo hash con importe distinto; revisión manual requerida.' });
        } else {
          unchanged.push(update.monthKey);
        }
        continue;
      }
      if (current.snapshot.contractHash !== update.expectedPreviousContractHash) {
        failed.push({ monthKey: update.monthKey, message: 'El hash sidecar cambió en otro dispositivo; se reintentará con el estado actual.' });
        continue;
      }

      const nextSnapshot = buildGastappMonthlyExpenseCloseSnapshot(
        update.snapshot,
        current.snapshot.fxRates,
        acceptedAt,
      );
      const archived: HistoricalGastappSidecarVersion = {
        snapshot: current.snapshot,
        repairAudit: current.repairAudit,
        replacedAt: acceptedAt,
      };
      const previousVersions = [
        archived,
        ...(current.previousVersions || []).filter((version) =>
          version.snapshot.contractHash !== archived.snapshot.contractHash),
      ].slice(0, SIDE_CAR_REVISION_HISTORY_LIMIT);
      nextEntries[update.monthKey] = {
        ...current,
        snapshot: nextSnapshot,
        previousVersions,
        repairAudit: {
          ...current.repairAudit,
          sourceContractHash: nextSnapshot.contractHash,
        },
      };
      changed.push(update.monthKey);
    }

    const nextDocument = { ...parsedSidecar, snapshotsByMonth: nextEntries };
    if (changed.length && new TextEncoder().encode(JSON.stringify(nextDocument)).byteLength > SIDE_CAR_MAX_SAFE_BYTES) {
      return {
        document: parsedSidecar,
        changed: [],
        unchanged,
        failed: [
          ...failed,
          ...changed.map((monthKey) => ({
            monthKey,
            message: 'El sidecar superaría el límite seguro de Firestore; no se escribió.',
          })),
        ],
      };
    }
    if (changed.length) transaction.set(sidecarRef, nextDocument);
    return { document: nextDocument, changed, unchanged, failed };
  });

  if (result.changed.length) publishReady(uid, result.document);
  return result;
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
