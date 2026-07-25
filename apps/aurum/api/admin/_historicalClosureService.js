import { randomUUID } from 'node:crypto';
import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import {
  applyCorrectionToRoot,
  buildHistoricalPreview,
  createBackupPackage,
  economicDateForMonth,
  fingerprintValue,
  historicalConfirmationText,
  normalizeConfirmationText,
  joinBackupPayload,
  locateClosure,
  restoreClosureInRoot,
} from './_historicalClosureCore.js';

const rootRef = (db, uid) => db.collection('aurum_wealth').doc(uid);
const backupRef = (db, uid, backupId) => db.collection('aurum_historical_backups').doc(uid).collection('operations').doc(backupId);
const checkpointRef = (db, uid, checkpointId) => db.collection('aurum_historical_checkpoints').doc(uid).collection('items').doc(checkpointId);
const auditRef = (db, uid, operationId) => db.collection('aurum_historical_audits').doc(uid).collection('entries').doc(operationId);
const chunkRef = (manifestRef, index) => manifestRef.collection('chunks').doc(String(index).padStart(4, '0'));
const updateTimeIso = (snapshot) => snapshot?.updateTime?.toDate?.().toISOString?.() || null;

const error = (message, statusCode = 400, code = 'invalid_request') => {
  throw Object.assign(new Error(message), { statusCode, code });
};

const requireRoot = (snapshot) => {
  if (!snapshot?.exists) error('No existe documento patrimonial cloud para el usuario.', 404, 'root_not_found');
  return snapshot.data();
};

const assertPreparedArtifacts = (backup, checkpoint, input) => {
  if (!backup || backup.status !== 'prepared') error('El backup no está preparado o ya fue utilizado.', 409, 'backup_not_prepared');
  if (!checkpoint || checkpoint.status !== 'prepared') error('El checkpoint no está preparado o no es válido.', 409, 'checkpoint_not_prepared');
  if (backup.backupId !== input.backupId || checkpoint.checkpointId !== input.checkpointId) {
    error('Backup o checkpoint no corresponden a la operación solicitada.', 409, 'artifact_mismatch');
  }
  if (backup.monthKey !== input.monthKey || checkpoint.monthKey !== input.monthKey || checkpoint.backupId !== backup.backupId) {
    error('Backup o checkpoint corresponden a otro cierre.', 409, 'artifact_month_mismatch');
  }
  if (backup.closureFingerprint !== input.expectedFingerprint || checkpoint.closureFingerprint !== input.expectedFingerprint) {
    error('El fingerprint aprobado no coincide con backup/checkpoint.', 409, 'artifact_fingerprint_mismatch');
  }
};

const writeBackupPackage = (transaction, db, identity, packageData) => {
  const manifestRef = backupRef(db, identity.uid, packageData.backupId);
  transaction.set(manifestRef, packageData.manifest, { merge: false });
  packageData.chunks.forEach((payload, index) => {
    transaction.set(chunkRef(manifestRef, index), {
      backupId: packageData.backupId,
      index,
      payload,
      fingerprint: fingerprintValue(payload),
    }, { merge: false });
  });
  transaction.set(checkpointRef(db, identity.uid, packageData.checkpointId), packageData.checkpoint, { merge: false });
};

const decodeFactories = (db) => ({
  timestamp: (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds),
  documentReference: (path) => db.doc(path),
  geoPoint: (latitude, longitude) => new GeoPoint(latitude, longitude),
  bytes: (bytes) => bytes,
});

const readBackupPayload = async ({ db, identity, backupId, get }) => {
  const manifestDocumentRef = backupRef(db, identity.uid, backupId);
  const manifestSnapshot = await get(manifestDocumentRef);
  if (!manifestSnapshot.exists) error('Backup histórico no encontrado.', 404, 'backup_not_found');
  const manifest = manifestSnapshot.data();
  const chunks = [];
  for (let index = 0; index < Number(manifest.chunkCount || 0); index += 1) {
    const chunkSnapshot = await get(chunkRef(manifestDocumentRef, index));
    if (!chunkSnapshot.exists) error(`Falta chunk ${index} del backup.`, 409, 'backup_chunk_missing');
    const chunk = chunkSnapshot.data();
    if (fingerprintValue(chunk.payload) !== chunk.fingerprint) error(`Chunk ${index} no supera integridad.`, 409, 'backup_chunk_corrupt');
    chunks.push(chunk.payload);
  }
  const decoded = joinBackupPayload(chunks, decodeFactories(db));
  if (fingerprintValue(decoded.rootDocument) !== manifest.rootDocumentFingerprint || fingerprintValue(decoded.closure) !== manifest.closureFingerprint) {
    error('El backup reconstruido no coincide con su manifest.', 409, 'backup_integrity_failed');
  }
  return { manifest, decoded };
};

const verificationMetadata = ({ identity, monthKey, adminContext, updateTime, fingerprint }) => ({
  projectId: adminContext?.projectId || null,
  databaseId: adminContext?.databaseId || '(default)',
  environment: adminContext?.environment || null,
  documentPath: `aurum_wealth/${identity.uid}`,
  uid: identity.uid,
  monthKey,
  updateTime,
  fingerprint,
});

export const readHistoricalClosure = async ({ db, identity, monthKey, adminContext }) => {
  // A direct Admin get has no browser cache and is independent from client hydration state.
  const documentRef = rootRef(db, identity.uid);
  const snapshot = await documentRef.get();
  const rootData = requireRoot(snapshot);
  const { closure } = locateClosure(rootData, monthKey);
  const records = Array.isArray(closure.records) ? closure.records : [];
  const checkpointSnapshot = await db.collection('aurum_historical_checkpoints')
    .doc(identity.uid).collection('items').where('monthKey', '==', monthKey).limit(20).get();
  return {
    monthKey,
    closure,
    recordCount: records.length,
    currencies: [...new Set(records.map((record) => record.currency).filter(Boolean))],
    assetCount: records.filter((record) => record.block !== 'debt').length,
    liabilityCount: records.filter((record) => record.block === 'debt').length,
    riskCapitalCount: records.filter((record) => String(record.label || '').toLowerCase().includes('capital de riesgo')).length,
    fingerprint: fingerprintValue(closure),
    rootFingerprint: fingerprintValue(rootData),
    rootUpdateTime: updateTimeIso(snapshot),
    checkpointCount: checkpointSnapshot.size,
    readAt: new Date().toISOString(),
    verification: verificationMetadata({ identity, monthKey, adminContext: { ...adminContext, db }, updateTime: updateTimeIso(snapshot), fingerprint: fingerprintValue(closure) }),
  };
};

export const previewHistoricalCorrection = async ({ db, identity, monthKey, expectedFingerprint, proposedFxRates, adminContext }) => {
  const read = await readHistoricalClosure({ db, identity, monthKey, adminContext });
  if (read.fingerprint !== expectedFingerprint) error('El cierre cambió desde la lectura aprobada.', 409, 'concurrent_modification');
  return { ...buildHistoricalPreview(read.closure, proposedFxRates), rootUpdateTime: read.rootUpdateTime };
};

export const prepareHistoricalCorrection = async ({ db, identity, monthKey, expectedFingerprint, proposedFxRates, reason, adminContext }) => {
  if (!String(reason || '').trim()) error('El motivo del backup es obligatorio.', 400, 'reason_required');
  const operationId = randomUUID();
  let prepared = null;
  await db.runTransaction(async (transaction) => {
    const ref = rootRef(db, identity.uid);
    const snapshot = await transaction.get(ref);
    const rootData = requireRoot(snapshot);
    const { closure } = locateClosure(rootData, monthKey);
    if (fingerprintValue(closure) !== expectedFingerprint) error('El cierre cambió antes de preparar el backup.', 409, 'concurrent_modification');
    const preview = buildHistoricalPreview(closure, proposedFxRates);
    const approvedCorrection = {
      monthKey,
      expectedOriginalFingerprint: expectedFingerprint,
      proposedFxRates: preview.proposedFxRates,
      expectedNetClp: preview.withoutRisk.after,
      expectedNetClpWithRisk: preview.withRisk.after,
      previewFingerprint: fingerprintValue(preview),
      reason: String(reason).trim(),
    };
    const unchangedFx = ['usdClp', 'eurClp', 'ufClp'].every((key) => Math.abs(Number(preview.currentFxRates[key]) - Number(preview.proposedFxRates[key])) <= 1e-9);
    if (unchangedFx && Math.abs(preview.withoutRisk.difference) <= 0.01 && Math.abs(preview.withRisk.difference) <= 0.01) {
      error('La corrección no produce ningún cambio. No se realizó ninguna escritura.', 409, 'no_op');
    }
    prepared = createBackupPackage({
      rootData,
      rawClosure: closure,
      identity,
      monthKey,
      reason: String(reason).trim(),
      rootUpdateTime: updateTimeIso(snapshot),
      operationId,
      approvedCorrection,
    });
    writeBackupPackage(transaction, db, identity, prepared);
  });
  const [backupCheck, checkpointCheck] = await Promise.all([
    backupRef(db, identity.uid, prepared.backupId).get(),
    checkpointRef(db, identity.uid, prepared.checkpointId).get(),
  ]);
  if (!backupCheck.exists || !checkpointCheck.exists) error('No pude releer backup/checkpoint después de crearlos.', 500, 'artifact_readback_failed');
  if (backupCheck.data().closureFingerprint !== expectedFingerprint || checkpointCheck.data().closureFingerprint !== expectedFingerprint) {
    error('Backup/checkpoint no superaron la verificación de fingerprint.', 500, 'artifact_integrity_failed');
  }
  await readBackupPayload({
    db,
    identity,
    backupId: prepared.backupId,
    get: (ref) => ref.get(),
  });
  return {
    backupId: prepared.backupId,
    checkpointId: prepared.checkpointId,
    operationId,
    closureFingerprint: expectedFingerprint,
    rootDocumentFingerprint: prepared.manifest.rootDocumentFingerprint,
    chunkCount: prepared.chunks.length,
    status: 'prepared',
    cloudVerified: true,
    approvedCorrection: prepared.checkpoint.approvedCorrection,
    approvedCorrectionFingerprint: prepared.checkpoint.approvedCorrectionFingerprint,
    verification: verificationMetadata({ identity, monthKey, adminContext: { ...adminContext, db }, updateTime: prepared.manifest.rootDocumentUpdateTime, fingerprint: expectedFingerprint }),
  };
};

export const exportHistoricalBackup = async ({ db, identity, backupId }) => {
  const { manifest, decoded } = await readBackupPayload({ db, identity, backupId, get: (ref) => ref.get() });
  return { manifest, exportPayload: decoded };
};

export const readHistoricalAudit = async ({ db, identity, operationId, adminContext }) => {
  const snapshot = await auditRef(db, identity.uid, operationId).get();
  if (!snapshot.exists) error('Auditoría histórica no encontrada.', 404, 'audit_not_found');
  const audit = snapshot.data();
  return {
    operationId,
    status: audit.status || 'unknown',
    type: audit.type || null,
    monthKey: audit.monthKey || null,
    projectId: audit.projectId || adminContext?.projectId || null,
    documentPath: audit.documentPath || `aurum_wealth/${identity.uid}`,
    rootUpdateTimeBefore: audit.rootUpdateTimeBefore || null,
    verification: {
      before: audit.beforeVerification || null,
      after: audit.afterVerification || null,
    },
  };
};

export const applyHistoricalCorrection = async ({ db, identity, input, adminContext }) => {
  if (normalizeConfirmationText(input.confirmationText) !== historicalConfirmationText(input.monthKey, 'apply')) error('Confirmación reforzada incorrecta.', 400, 'confirmation_mismatch');
  const operationId = randomUUID();
  let result = null;
  let beforeVerification = null;
  await db.runTransaction(async (transaction) => {
    const rootDocumentRef = rootRef(db, identity.uid);
    const backupDocumentRef = backupRef(db, identity.uid, input.backupId);
    const checkpointDocumentRef = checkpointRef(db, identity.uid, input.checkpointId);
    const [rootSnapshot, checkpointSnapshot] = await Promise.all([
      transaction.get(rootDocumentRef),
      transaction.get(checkpointDocumentRef),
    ]);
    const rootData = requireRoot(rootSnapshot);
    beforeVerification = verificationMetadata({ identity, monthKey: input.monthKey, adminContext: { ...adminContext, db }, updateTime: updateTimeIso(rootSnapshot), fingerprint: fingerprintValue(locateClosure(rootData, input.monthKey).closure) });
    const { manifest: backup, decoded: backupPayload } = await readBackupPayload({
      db,
      identity,
      backupId: input.backupId,
      get: (ref) => transaction.get(ref),
    });
    const checkpoint = checkpointSnapshot.exists ? checkpointSnapshot.data() : null;
    assertPreparedArtifacts(backup, checkpoint, input);
    const approved = checkpoint.approvedCorrection;
    if (!approved || checkpoint.approvedCorrectionFingerprint !== input.approvedCorrectionFingerprint || fingerprintValue(approved) !== checkpoint.approvedCorrectionFingerprint) {
      error('La propuesta aprobada no coincide con el checkpoint preparado.', 409, 'approved_correction_mismatch');
    }
    if (fingerprintValue(backupPayload.closure) !== input.expectedFingerprint) {
      error('El cierre recuperable del backup no coincide con la preview aprobada.', 409, 'backup_closure_mismatch');
    }
    result = applyCorrectionToRoot({
      rootData,
      monthKey: input.monthKey,
      expectedFingerprint: input.expectedFingerprint,
      proposedFxRates: approved.proposedFxRates,
      suggestedFxRates: approved.proposedFxRates,
      reason: approved.reason,
      identity,
      backupId: input.backupId,
      checkpointId: input.checkpointId,
      operationId,
    });
    transaction.set(rootDocumentRef, result.nextRootData, { merge: false });
    transaction.update(backupDocumentRef, { status: 'applied', appliedAt: result.auditEntry.editedAt, applyOperationId: operationId });
    transaction.update(checkpointDocumentRef, { status: 'applied', appliedAt: result.auditEntry.editedAt, applyOperationId: operationId });
    transaction.set(auditRef(db, identity.uid, operationId), {
      ...result.auditEntry,
      type: 'historical-closure-apply',
      finalDocumentFingerprint: result.finalFingerprint,
      rootUpdateTimeBefore: updateTimeIso(rootSnapshot),
      projectId: adminContext?.projectId || null,
      documentPath: rootDocumentRef.path,
      uid: identity.uid,
    }, { merge: false });
  });
  // Use a fresh document reference after the transaction; never reuse its snapshot or result object.
  const verified = await readHistoricalClosure({ db, identity, monthKey: input.monthKey, adminContext });
  const persistedFx = verified.closure.fxRates;
  const approved = result.preview.proposedFxRates;
  const ratesMatch = ['usdClp', 'eurClp', 'ufClp'].every((key) => Math.abs(Number(persistedFx?.[key]) - Number(approved[key])) <= 1e-9);
  const netsMatch = Math.abs(Number(verified.closure.summary?.netClp) - result.preview.withoutRisk.after) <= 0.01 && Math.abs(Number(verified.closure.summary?.netClpWithRisk) - result.preview.withRisk.after) <= 0.01;
  const beforeTime = Date.parse(String(beforeVerification?.updateTime || ''));
  const afterTime = Date.parse(String(verified.rootUpdateTime || ''));
  const updateTimeAdvanced = Number.isFinite(beforeTime) && Number.isFinite(afterTime) && afterTime > beforeTime;
  if (!updateTimeAdvanced || verified.fingerprint !== result.finalFingerprint || !ratesMatch || !netsMatch) {
    const status = !updateTimeAdvanced ? 'write_not_persisted' : 'verification_failed';
    await auditRef(db, identity.uid, operationId).set({ status, verifiedAt: new Date().toISOString(), beforeVerification, afterVerification: verified.verification }, { merge: true });
    if (!updateTimeAdvanced) error('La transacción no cambió el documento en Firestore. No se considera aplicada.', 500, 'write_not_persisted');
    error(`La verificación post-write no coincide. Operación ${operationId}.`, 500, 'post_write_verification_failed');
  }
  return { status: 'applied_verified', operationId, monthKey: input.monthKey, fingerprint: verified.fingerprint, persistedFxRates: persistedFx, persistedNetClp: verified.closure.summary?.netClp, persistedNetClpWithRisk: verified.closure.summary?.netClpWithRisk, preview: result.preview, reconciliation: result.preview.reconciliation, verification: { before: beforeVerification, after: verified.verification } };
};

const FX_KEYS = [
  ['usd', 'usdClp'],
  ['eur', 'eurClp'],
  ['uf', 'ufClp'],
];
const FX_SERIALIZATION_TOLERANCE = 1e-9;
const canonicalFxMetadataConfirmation = (monthKey) => `RECONFIRMO FX ${String(monthKey || '').trim().toUpperCase()}`;

const validateOfficialFxEvidence = ({ monthKey, closure, evidence }) => {
  const rates = closure?.fxRates || {};
  if (!evidence || typeof evidence !== 'object') error('La evidencia oficial es obligatoria.', 400, 'evidence_required');
  if (evidence.monthKey !== monthKey || evidence.economicDate !== economicDateForMonth(monthKey)) {
    error('La evidencia no corresponde al mes económico del cierre.', 400, 'evidence_month_mismatch');
  }
  if (!Number.isFinite(Date.parse(String(evidence.retrievedAt || '')))) {
    error('La evidencia oficial no tiene timestamp verificable.', 400, 'evidence_timestamp_invalid');
  }
  const references = evidence.references || {};
  const mismatches = FX_KEYS.map(([key, field]) => {
    const sealed = Number(rates[field]);
    const reference = references[key] || {};
    const official = Number(reference.value);
    const difference = sealed - official;
    const source = String(reference.source || '').trim();
    const effectiveDate = String(reference.effectiveDate || '').trim();
    const valid = Number.isFinite(sealed) && sealed > 0 && Number.isFinite(official) && official > 0 &&
      Math.abs(difference) <= FX_SERIALIZATION_TOLERANCE && source && effectiveDate === economicDateForMonth(monthKey);
    return { key, field, sealed, official, difference, source, effectiveDate, valid };
  });
  const invalid = mismatches.filter((item) => !item.valid);
  if (invalid.length) {
    const detail = invalid.map((item) => `${item.field}: sellada=${item.sealed}, oficial=${item.official}, diferencia=${item.difference}`).join('; ');
    error(`La evidencia oficial no coincide exactamente con las FX del cierre. ${detail}`, 409, 'official_fx_mismatch');
  }
  return mismatches;
};

export const reconfirmHistoricalFxMetadata = async ({ db, identity, input, adminContext }) => {
  const monthKey = String(input.monthKey || '');
  if (normalizeConfirmationText(input.confirmationText) !== canonicalFxMetadataConfirmation(monthKey)) {
    error(`Confirmación requerida: ${canonicalFxMetadataConfirmation(monthKey)}.`, 400, 'confirmation_mismatch');
  }
  const operationId = randomUUID();
  let result = null;
  await db.runTransaction(async (transaction) => {
    const documentRef = rootRef(db, identity.uid);
    const snapshot = await transaction.get(documentRef);
    const rootData = requireRoot(snapshot);
    const { closure, index } = locateClosure(rootData, monthKey);
    const currentFingerprint = fingerprintValue(closure);
    if (currentFingerprint !== String(input.expectedFingerprint || '')) {
      error('El cierre cambió desde el diagnóstico. Vuelve a leerlo antes de confirmar.', 409, 'concurrent_modification');
    }
    const matches = validateOfficialFxEvidence({ monthKey, closure, evidence: input.evidence });
    const expectedSources = Object.fromEntries(matches.map((item) => [item.key, item.source]));
    const metadata = closure.fxMetadata || {};
    const alreadyVerified = metadata.economicMonthKey === monthKey && metadata.economicDate === economicDateForMonth(monthKey) &&
      FX_KEYS.every(([key, field]) => Number(metadata.usedFxRates?.[field]) === Number(closure.fxRates?.[field]) &&
        String(metadata.source?.[key] || '').trim() === expectedSources[key]);
    if (alreadyVerified) {
      result = { status: 'already_verified', fingerprint: currentFingerprint, backupId: null };
      return;
    }
    const backup = createBackupPackage({
      rootData,
      rawClosure: closure,
      identity,
      monthKey,
      reason: 'Reconfirmación manual de metadata FX histórica oficial para publicación MIDAS.',
      rootUpdateTime: updateTimeIso(snapshot),
      operationId,
      approvedCorrection: { type: 'midas_fx_metadata_only', evidence: input.evidence, expectedFingerprint: currentFingerprint },
    });
    const auditEntry = {
      operationId,
      repairedAt: new Date().toISOString(),
      repairedBy: identity.email,
      kind: 'midas_fx_metadata_reconfirmation',
      monthKey,
      rates: Object.fromEntries(matches.map((item) => [item.field, item.sealed])),
      officialEvidence: input.evidence,
      tolerance: FX_SERIALIZATION_TOLERANCE,
      sourceDocuments: Object.fromEntries(matches.map((item) => [item.key, item.source])),
      backupId: backup.backupId,
      checkpointId: backup.checkpointId,
      originalFingerprint: currentFingerprint,
    };
    const nextClosure = {
      ...closure,
      fxMetadata: {
        ...metadata,
        economicMonthKey: monthKey,
        economicDate: economicDateForMonth(monthKey),
        usedFxRates: { ...closure.fxRates },
        suggestedFxRates: { ...closure.fxRates },
        rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
        source: expectedSources,
        retrievedAt: input.evidence.retrievedAt,
        reconciliation: { status: 'reconciled', checkedAt: auditEntry.repairedAt },
        provenance: { kind: 'official_historical_reconfirmation', operationId, evidence: input.evidence },
      },
      midasFxMetadataRepairAudit: [...(Array.isArray(closure.midasFxMetadataRepairAudit) ? closure.midasFxMetadataRepairAudit : []), auditEntry].slice(-24),
    };
    const closures = [...rootData.closures];
    closures[index] = nextClosure;
    writeBackupPackage(transaction, db, identity, backup);
    transaction.set(documentRef, { ...rootData, updatedAt: auditEntry.repairedAt, closures }, { merge: false });
    transaction.set(auditRef(db, identity.uid, operationId), { ...auditEntry, type: 'midas-fx-metadata-reconfirmation', documentPath: documentRef.path }, { merge: false });
    result = { status: 'applied_verified', fingerprint: fingerprintValue(nextClosure), backupId: backup.backupId };
  });
  const verified = await readHistoricalClosure({ db, identity, monthKey, adminContext });
  const metadata = verified.closure.fxMetadata || {};
  const fxRatesPreserved = FX_KEYS.every(([, field]) => Number(verified.closure.fxRates?.[field]) === Number(input.evidence.rates?.[field]));
  const metadataCanonical = metadata.economicMonthKey === monthKey && metadata.economicDate === economicDateForMonth(monthKey) &&
    FX_KEYS.every(([key, field]) => Number(metadata.usedFxRates?.[field]) === Number(verified.closure.fxRates?.[field]) && String(metadata.source?.[key] || '').trim());
  if (!fxRatesPreserved || !metadataCanonical || verified.fingerprint !== result.fingerprint) {
    error('La relectura no verificó la reparación de metadata FX.', 500, 'post_write_verification_failed');
  }
  return {
    status: result.status,
    monthKey,
    fingerprint: verified.fingerprint,
    operationId: result.status === 'applied_verified' ? operationId : null,
    backupId: result.backupId,
    verification: { fxRatesPreserved, metadataCanonical, projectId: adminContext?.projectId || null, documentPath: `aurum_wealth/${identity.uid}` },
  };
};

export const previewHistoricalRollback = async ({ db, identity, monthKey, checkpointId }) => {
  const [read, checkpointSnapshot] = await Promise.all([
    readHistoricalClosure({ db, identity, monthKey }),
    checkpointRef(db, identity.uid, checkpointId).get(),
  ]);
  if (!checkpointSnapshot.exists) error('Checkpoint histórico no encontrado.', 404, 'checkpoint_not_found');
  const checkpoint = checkpointSnapshot.data();
  if (checkpoint.monthKey !== monthKey || !checkpoint.backupId) error('Checkpoint no corresponde al cierre.', 409, 'checkpoint_mismatch');
  const { decoded } = await readBackupPayload({ db, identity, backupId: checkpoint.backupId, get: (ref) => ref.get() });
  const rawClosure = decoded.closure;
  if (fingerprintValue(rawClosure) !== checkpoint.closureFingerprint) error('Checkpoint corrupto.', 409, 'checkpoint_integrity_failed');
  return {
    monthKey,
    checkpointId,
    currentFingerprint: read.fingerprint,
    restoredFingerprint: checkpoint.closureFingerprint,
    currentFxRates: read.closure.fxRates,
    restoredFxRates: rawClosure.fxRates,
    currentNetClp: read.closure.summary?.netClp,
    restoredNetClp: rawClosure.summary?.netClp,
  };
};

export const rollbackHistoricalCorrection = async ({ db, identity, input }) => {
  if (normalizeConfirmationText(input.confirmationText) !== historicalConfirmationText(input.monthKey, 'rollback')) error('Confirmación reforzada de rollback incorrecta.', 400, 'confirmation_mismatch');
  if (!String(input.reason || '').trim()) error('El motivo del rollback es obligatorio.', 400, 'reason_required');
  const operationId = randomUUID();
  let result = null;
  let safetyBackup = null;
  await db.runTransaction(async (transaction) => {
    const rootDocumentRef = rootRef(db, identity.uid);
    const sourceCheckpointRef = checkpointRef(db, identity.uid, input.checkpointId);
    const [rootSnapshot, checkpointSnapshot] = await Promise.all([
      transaction.get(rootDocumentRef),
      transaction.get(sourceCheckpointRef),
    ]);
    const rootData = requireRoot(rootSnapshot);
    if (!checkpointSnapshot.exists) error('Checkpoint histórico no encontrado.', 404, 'checkpoint_not_found');
    const checkpoint = checkpointSnapshot.data();
    const { decoded } = await readBackupPayload({
      db,
      identity,
      backupId: checkpoint.backupId,
      get: (ref) => transaction.get(ref),
    });
    const checkpointWithClosure = { ...checkpoint, rawClosure: decoded.closure };
    const currentClosure = locateClosure(rootData, input.monthKey).closure;
    safetyBackup = createBackupPackage({
      rootData,
      rawClosure: currentClosure,
      identity,
      monthKey: input.monthKey,
      reason: `Backup previo a rollback: ${String(input.reason).trim()}`,
      rootUpdateTime: updateTimeIso(rootSnapshot),
      operationId,
    });
    result = restoreClosureInRoot({
      rootData,
      monthKey: input.monthKey,
      expectedFingerprint: input.expectedFingerprint,
      checkpoint: checkpointWithClosure,
      identity,
      reason: String(input.reason).trim(),
      operationId,
    });
    writeBackupPackage(transaction, db, identity, safetyBackup);
    transaction.set(rootDocumentRef, result.nextRootData, { merge: false });
    transaction.update(sourceCheckpointRef, { status: 'rolled_back', rolledBackAt: result.auditEntry.editedAt, rollbackOperationId: operationId });
    transaction.set(auditRef(db, identity.uid, operationId), {
      ...result.auditEntry,
      type: 'historical-closure-rollback',
      safetyBackupId: safetyBackup.backupId,
      rootUpdateTimeBefore: updateTimeIso(rootSnapshot),
    }, { merge: false });
  });
  const [verified] = await Promise.all([
    readHistoricalClosure({ db, identity, monthKey: input.monthKey }),
    exportHistoricalBackup({ db, identity, backupId: safetyBackup.backupId }),
  ]);
  if (verified.fingerprint !== fingerprintValue(result.restoredClosure)) error('La restauración no coincide con el checkpoint.', 500, 'rollback_verification_failed');
  return { operationId, monthKey: input.monthKey, fingerprint: verified.fingerprint, safetyBackupId: safetyBackup.backupId };
};
