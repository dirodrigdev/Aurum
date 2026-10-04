import { doc, getDocFromServer, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db, getCurrentUid } from './firebase';
import {
  FIRESTORE_DOCUMENT_RESERVE_BYTES,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  runHistoricalGastappBackfillAudit,
  sha256Fingerprint,
  stableStringify,
  type HistoricalGastappBackfillPreview,
} from './historicalGastappSnapshotBackfill';
import {
  HISTORICAL_GASTAPP_SIDECAR_SCHEMA,
  historicalGastappSidecarRef,
  parseHistoricalGastappSidecar,
  readHistoricalGastappSidecarFromServer,
  type HistoricalGastappSidecarDocument,
  type HistoricalGastappSidecarEntry,
} from './historicalGastappSidecar';
import { readWealthCloudDocumentForAudit } from './wealthStorage';

const ADMIN_EMAIL = 'diegorp.1978@gmail.com';
const EXPECTED_MONTHS = 38;
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const buildHistoricalGastappSidecarPlan = (
  preview: HistoricalGastappBackfillPreview,
  existing: HistoricalGastappSidecarDocument | null,
): HistoricalGastappSidecarDocument => {
  if (preview.blockers !== 0 || preview.totalClosures !== 40 || preview.comparableMonths !== 39 ||
      preview.lastOfficialMonth !== '2026-08' || ![0, EXPECTED_MONTHS].includes(preview.snapshotsToComplete)) {
    throw new Error('El manifest ya no coincide con los 40 cierres y 38 meses elegibles certificados.');
  }
  const entries: Record<string, HistoricalGastappSidecarEntry> = { ...existing?.snapshotsByMonth };
  for (const row of preview.manifest) {
    if (row.status !== 'eligible_for_backfill') continue;
    if (!row.closureId || !row.proposedSnapshot || !row.preFingerprint ||
        row.preFingerprint !== row.postFingerprint || !row.fingerprintsMatch) {
      throw new Error(`Fingerprint o snapshot inválido en ${row.monthKey}.`);
    }
    if (entries[row.monthKey]) throw new Error(`El sidecar de ${row.monthKey} ya existe.`);
    const originalClosure = preview.simulatedClosures.find((closure) => closure.id === row.closureId);
    if (!originalClosure) throw new Error(`Cierre original de ${row.monthKey} no encontrado.`);
    entries[row.monthKey] = {
      closureId: row.closureId,
      snapshot: row.proposedSnapshot,
      repairAudit: {
        reason: 'historical_schema_compatibility_reconstruction',
        reconstructedAt: preview.reconstructionAt,
        originalClosureAt: originalClosure.closedAt,
        preFingerprint: row.preFingerprint,
        postFingerprint: row.postFingerprint,
        sourceContractHash: row.proposedSnapshot.contractHash,
      },
    };
  }
  const planned: HistoricalGastappSidecarDocument = { schemaVersion: HISTORICAL_GASTAPP_SIDECAR_SCHEMA, snapshotsByMonth: entries };
  if (!parseHistoricalGastappSidecar(planned)) throw new Error('El sidecar proyectado no valida contra el formato canónico.');
  if (utf8Bytes(planned) > FIRESTORE_MAX_DOCUMENT_BYTES - FIRESTORE_DOCUMENT_RESERVE_BYTES) {
    throw new Error('El sidecar proyectado está peligrosamente cerca del límite de Firestore.');
  }
  return planned;
};

export type HistoricalGastappBackfillWriteResult = {
  created: number;
  backupId: string | null;
  rootPreFingerprint: string;
  rootPostFingerprint: string;
  sidecarBytes: number;
  coverage: HistoricalGastappBackfillPreview['coverage']['current'];
};

/** Admin-only operation; reads both projects afresh, backs up the target, and commits only the sidecar. */
export const executeHistoricalGastappSidecarBackfill = async (): Promise<HistoricalGastappBackfillWriteResult> => {
  if (auth.currentUser?.email?.toLowerCase() !== ADMIN_EMAIL) throw new Error('Solo la sesión administradora puede ejecutar el backfill.');
  const uid = getCurrentUid();
  if (!uid || uid !== auth.currentUser.uid) throw new Error('Sesión cambió durante el backfill.');
  const first = await runHistoricalGastappBackfillAudit();
  const firstRoot = await readWealthCloudDocumentForAudit();
  const firstSidecar = await readHistoricalGastappSidecarFromServer();
  if (!firstRoot.document || firstSidecar.uid !== uid) throw new Error('Fuente cloud no disponible.');
  const rootPreFingerprint = await sha256Fingerprint(firstRoot.document);
  const firstPlan = buildHistoricalGastappSidecarPlan(first.preview, firstSidecar.document);
  if (first.preview.snapshotsToComplete === 0) {
    return {
      created: 0,
      backupId: null,
      rootPreFingerprint,
      rootPostFingerprint: rootPreFingerprint,
      sidecarBytes: utf8Bytes(firstPlan),
      coverage: first.preview.coverage.current,
    };
  }

  // Only this sidecar is mutated. Preserve its previous state plus the exact root identity in cloud.
  const backupId = `historical_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const backupRef = doc(db, 'aurum_wealth', uid, 'gastapp_snapshots_backups', backupId);
  const backup = {
    schemaVersion: 1,
    reason: 'before_historical_gastapp_sidecar_backfill',
    createdAt: new Date().toISOString(),
    rootFingerprint: rootPreFingerprint,
    sidecarBefore: firstSidecar.raw || null,
    proposedMonths: first.preview.manifest.filter((row) => row.status === 'eligible_for_backfill').map((row) => row.monthKey),
  };
  await setDoc(backupRef, backup);
  const backupReadback = await getDocFromServer(backupRef);
  if (!backupReadback.exists() || stableStringify(backupReadback.data()) !== stableStringify(backup)) {
    throw new Error('Backup cloud no confirmado; escritura detenida.');
  }

  const second = await runHistoricalGastappBackfillAudit({ reconstructionAt: first.preview.reconstructionAt });
  const secondRoot = await readWealthCloudDocumentForAudit();
  const secondSidecar = await readHistoricalGastappSidecarFromServer();
  if (!secondRoot.document || secondSidecar.uid !== uid ||
      await sha256Fingerprint(secondRoot.document) !== rootPreFingerprint ||
      stableStringify(secondSidecar.raw) !== stableStringify(firstSidecar.raw)) {
    throw new Error('Las fuentes cambiaron después del backup; escritura detenida.');
  }
  const secondPlan = buildHistoricalGastappSidecarPlan(second.preview, secondSidecar.document);
  if (stableStringify(firstPlan) !== stableStringify(secondPlan) ||
      second.preview.snapshotsToComplete !== EXPECTED_MONTHS || second.preview.blockers !== 0) {
    throw new Error('El manifest cambió después del backup; escritura detenida.');
  }
  const rootRef = doc(db, 'aurum_wealth', uid);
  const sidecarRef = historicalGastappSidecarRef(uid);
  await runTransaction(db, async (transaction) => {
    const rootSnap = await transaction.get(rootRef);
    const sidecarSnap = await transaction.get(sidecarRef);
    if (!rootSnap.exists() || await sha256Fingerprint(rootSnap.data()) !== rootPreFingerprint ||
        stableStringify(sidecarSnap.exists() ? sidecarSnap.data() : null) !== stableStringify(firstSidecar.raw)) {
      throw new Error('Cambio concurrente detectado; transacción abortada.');
    }
    transaction.set(sidecarRef, firstPlan);
  });

  const rootReadback = await getDocFromServer(rootRef);
  const sidecarReadback = await getDocFromServer(sidecarRef);
  const rootPostFingerprint = rootReadback.exists() ? await sha256Fingerprint(rootReadback.data()) : '';
  const parsedSidecar = sidecarReadback.exists() ? parseHistoricalGastappSidecar(sidecarReadback.data()) : null;
  if (rootPostFingerprint !== rootPreFingerprint || !parsedSidecar ||
      stableStringify(parsedSidecar) !== stableStringify(firstPlan)) {
    throw new Error('El readback autoritativo no coincide; inspección requerida.');
  }
  const finalAudit = await runHistoricalGastappBackfillAudit();
  if (finalAudit.preview.snapshotsToComplete !== 0 || finalAudit.preview.blockers !== 0 ||
      finalAudit.preview.coverage.current.sinceStart.valid !== 39 ||
      finalAudit.preview.coverage.current.last12m.valid !== 12 ||
      finalAudit.preview.coverage.current.ytd.valid !== 8) {
    throw new Error('Sidecar escrito, pero la cobertura final no coincide; inspección requerida.');
  }
  return {
    created: EXPECTED_MONTHS,
    backupId,
    rootPreFingerprint,
    rootPostFingerprint,
    sidecarBytes: utf8Bytes(firstPlan),
    coverage: finalAudit.preview.coverage.current,
  };
};
