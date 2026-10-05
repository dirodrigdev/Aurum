import { doc, getDocFromServer, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db, getCurrentUid } from './firebase';
import {
  FIRESTORE_DOCUMENT_RESERVE_BYTES,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  fingerprintHistoricalClosuresInWealthDocument,
  runHistoricalGastappBackfillAudit,
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
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const getEligibleMonths = (preview: HistoricalGastappBackfillPreview) => preview.manifest
  .filter((row) => row.status === 'eligible_for_backfill')
  .map((row) => row.monthKey)
  .sort((left, right) => left.localeCompare(right));

const previewIdentity = (preview: HistoricalGastappBackfillPreview) => ({
  totalClosures: preview.totalClosures,
  comparableMonths: preview.comparableMonths,
  lastOfficialMonth: preview.lastOfficialMonth,
  eligibleMonths: getEligibleMonths(preview),
  coverageProjected: preview.coverage.projected,
  manifest: preview.manifest,
});

export const buildHistoricalGastappSidecarPlan = (
  preview: HistoricalGastappBackfillPreview,
  existing: HistoricalGastappSidecarDocument | null,
): HistoricalGastappSidecarDocument => {
  const eligibleRows = preview.manifest.filter((row) => row.status === 'eligible_for_backfill');
  if (preview.blockers !== 0 || eligibleRows.length !== preview.snapshotsToComplete) {
    throw new Error('El manifest tiene blockers o no coincide con la cantidad elegible.');
  }
  const entries: Record<string, HistoricalGastappSidecarEntry> = { ...existing?.snapshotsByMonth };
  for (const row of eligibleRows) {
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
  /** Closure-source fingerprint; root-level metadata is intentionally excluded. */
  rootPreFingerprint: string;
  rootPostFingerprint: string;
  sidecarBytes: number;
  coverage: HistoricalGastappBackfillPreview['coverage']['current'];
};

/** Admin-only operation; revalidates closure history, GastApp manifest, and sidecar before its atomic write. */
export const executeHistoricalGastappSidecarBackfill = async (): Promise<HistoricalGastappBackfillWriteResult> => {
  if (auth.currentUser?.email?.toLowerCase() !== ADMIN_EMAIL) throw new Error('Solo la sesión administradora puede ejecutar el backfill.');
  const uid = getCurrentUid();
  if (!uid || uid !== auth.currentUser.uid) throw new Error('Sesión cambió durante el backfill.');

  const first = await runHistoricalGastappBackfillAudit();
  const firstRoot = await readWealthCloudDocumentForAudit();
  const firstSidecar = await readHistoricalGastappSidecarFromServer();
  if (!firstRoot.document || firstSidecar.uid !== uid) throw new Error('Fuente cloud no disponible.');
  const closureSourceFingerprint = await fingerprintHistoricalClosuresInWealthDocument(firstRoot.document);
  if (first.preview.closureSourceFingerprint !== closureSourceFingerprint) {
    throw new Error('Los cierres cambiaron entre la auditoría inicial y su lectura de servidor.');
  }
  const expectedIdentity = previewIdentity(first.preview);
  const expectedEligibleMonths = getEligibleMonths(first.preview);
  const expectedCreated = expectedEligibleMonths.length;
  const firstPlan = buildHistoricalGastappSidecarPlan(first.preview, firstSidecar.document);

  // Idempotent no-op: do not create another cloud backup when nothing is eligible.
  if (expectedCreated === 0) {
    if (stableStringify(first.preview.coverage.current) !== stableStringify(first.preview.coverage.projected)) {
      throw new Error('La vista idempotente tiene cobertura actual y proyectada distintas; escritura detenida.');
    }
    return {
      created: 0,
      backupId: null,
      rootPreFingerprint: closureSourceFingerprint,
      rootPostFingerprint: closureSourceFingerprint,
      sidecarBytes: utf8Bytes(firstPlan),
      coverage: first.preview.coverage.current,
    };
  }

  const backupId = `historical_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const backupRef = doc(db, 'aurum_wealth', uid, 'gastapp_snapshots_backups', backupId);
  const backup = {
    schemaVersion: 1,
    reason: 'before_historical_gastapp_sidecar_backfill',
    createdAt: new Date().toISOString(),
    closureSourceFingerprint,
    sidecarBefore: firstSidecar.raw || null,
    proposedMonths: expectedEligibleMonths,
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
      await fingerprintHistoricalClosuresInWealthDocument(secondRoot.document) !== closureSourceFingerprint ||
      second.preview.closureSourceFingerprint !== closureSourceFingerprint ||
      stableStringify(secondSidecar.raw) !== stableStringify(firstSidecar.raw)) {
    throw new Error('Las fuentes cambiaron después del backup; escritura detenida.');
  }
  const secondPlan = buildHistoricalGastappSidecarPlan(second.preview, secondSidecar.document);
  if (stableStringify(firstPlan) !== stableStringify(secondPlan) ||
      stableStringify(previewIdentity(second.preview)) !== stableStringify(expectedIdentity) ||
      second.preview.blockers !== 0 || getEligibleMonths(second.preview).length !== expectedCreated) {
    throw new Error('El manifest cambió después del backup; escritura detenida.');
  }

  const rootRef = doc(db, 'aurum_wealth', uid);
  const sidecarRef = historicalGastappSidecarRef(uid);
  await runTransaction(db, async (transaction) => {
    const rootSnap = await transaction.get(rootRef);
    const sidecarSnap = await transaction.get(sidecarRef);
    const currentSidecar = sidecarSnap.exists() ? sidecarSnap.data() : null;
    if (!rootSnap.exists() ||
        await fingerprintHistoricalClosuresInWealthDocument(rootSnap.data()) !== closureSourceFingerprint ||
        stableStringify(currentSidecar) !== stableStringify(firstSidecar.raw)) {
      throw new Error('Cambio concurrente detectado; transacción abortada.');
    }
    transaction.set(sidecarRef, firstPlan);
  });

  const rootReadback = await getDocFromServer(rootRef);
  const sidecarReadback = await getDocFromServer(sidecarRef);
  const rootPostFingerprint = rootReadback.exists()
    ? await fingerprintHistoricalClosuresInWealthDocument(rootReadback.data())
    : '';
  const parsedSidecar = sidecarReadback.exists() ? parseHistoricalGastappSidecar(sidecarReadback.data()) : null;
  if (rootPostFingerprint !== closureSourceFingerprint || !parsedSidecar ||
      stableStringify(parsedSidecar) !== stableStringify(firstPlan)) {
    throw new Error('El readback autoritativo no coincide; inspección requerida.');
  }

  const finalAudit = await runHistoricalGastappBackfillAudit();
  const finalRoot = await readWealthCloudDocumentForAudit();
  const finalSidecar = await readHistoricalGastappSidecarFromServer();
  const expectedSidecarMonths = Object.keys(firstPlan.snapshotsByMonth).sort();
  const actualSidecarMonths = Object.keys(finalSidecar.document?.snapshotsByMonth || {}).sort();
  if (!finalRoot.document || finalSidecar.uid !== uid ||
      await fingerprintHistoricalClosuresInWealthDocument(finalRoot.document) !== closureSourceFingerprint ||
      finalAudit.preview.closureSourceFingerprint !== closureSourceFingerprint ||
      finalAudit.preview.snapshotsToComplete !== 0 || finalAudit.preview.blockers !== 0 ||
      stableStringify(finalAudit.preview.coverage.current) !== stableStringify(first.preview.coverage.projected) ||
      finalAudit.preview.totalClosures !== first.preview.totalClosures ||
      finalAudit.preview.comparableMonths !== first.preview.comparableMonths ||
      finalAudit.preview.lastOfficialMonth !== first.preview.lastOfficialMonth ||
      stableStringify(actualSidecarMonths) !== stableStringify(expectedSidecarMonths) ||
      stableStringify(finalSidecar.document) !== stableStringify(firstPlan)) {
    throw new Error('Sidecar escrito, pero readback, manifest o cobertura final no coincide; inspección requerida.');
  }

  return {
    created: expectedCreated,
    backupId,
    rootPreFingerprint: closureSourceFingerprint,
    rootPostFingerprint,
    sidecarBytes: utf8Bytes(firstPlan),
    coverage: finalAudit.preview.coverage.current,
  };
};
