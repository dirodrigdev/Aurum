import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db, ensureAuthPersistence, getCurrentUid } from './firebase';
import {
  PERFORMANCE_FINAL_MONTH,
  isFinancialPerformanceConfirmationValid,
  isFinancialPerformanceFlowValid,
  type FinancialPerformanceConfirmation,
  type FinancialPerformanceFlow,
} from './financialPerformance';

const PERFORMANCE_COLLECTION = 'aurum_financial_performance';
const MONTHS_SUBCOLLECTION = 'months';
const REVISIONS_SUBCOLLECTION = 'revisions';

const requireUid = async (): Promise<string> => {
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) throw new Error('financial_performance_auth_required');
  return uid;
};

const monthDocument = (uid: string, monthKey: string) =>
  doc(db, PERFORMANCE_COLLECTION, uid, MONTHS_SUBCOLLECTION, monthKey);

const normalizeTimestamp = (value: unknown): string | undefined => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const parsed = (value as Timestamp).toDate();
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
  }
  return typeof value === 'string' ? value : undefined;
};

const normalizeFlow = (raw: unknown): FinancialPerformanceFlow | null => {
  if (!isFinancialPerformanceFlowValid(raw)) return null;
  const item = raw as FinancialPerformanceFlow;
  return {
    id: item.id,
    direction: item.direction,
    effectiveDate: item.effectiveDate,
    amountClp: Number(item.amountClp),
    ...(typeof item.note === 'string' && item.note.trim() ? { note: item.note.trim() } : {}),
    ...(typeof item.reference === 'string' && item.reference.trim() ? { reference: item.reference.trim() } : {}),
  };
};

const normalizeConfirmation = (
  raw: Record<string, unknown>,
  revision: number,
  revisionId: string,
  uid: string,
): FinancialPerformanceConfirmation | null => {
  if (
    raw.schemaVersion !== 1 ||
    raw.monthKey !== PERFORMANCE_FINAL_MONTH ||
    raw.revision !== revision ||
    raw.revisionId !== revisionId ||
    raw.createdByUid !== uid ||
    (raw.flowCompleteness !== 'complete' && raw.flowCompleteness !== 'incomplete') ||
    (raw.positionMovementCompleteness !== 'no_unrecorded_movements' &&
      raw.positionMovementCompleteness !== 'unconfirmed') ||
    !Array.isArray(raw.flows)
  ) return null;
  const updatedAt = normalizeTimestamp(raw.createdAt);
  if (!updatedAt) return null;
  const flows = raw.flows.map(normalizeFlow);
  if (flows.some((flow) => flow === null)) return null;
  const confirmation: FinancialPerformanceConfirmation = {
    schemaVersion: 1,
    monthKey: PERFORMANCE_FINAL_MONTH,
    flowCompleteness: raw.flowCompleteness,
    positionMovementCompleteness: raw.positionMovementCompleteness,
    flows: flows as FinancialPerformanceFlow[],
    revision,
    updatedAt,
  };
  return isFinancialPerformanceConfirmationValid(confirmation) ? confirmation : null;
};

/** Reads only the latest revision of the July→August 2026 confirmation. */
export const loadFinancialPerformanceConfirmation = async (): Promise<FinancialPerformanceConfirmation | null> => {
  const uid = await requireUid();
  const monthRef = monthDocument(uid, PERFORMANCE_FINAL_MONTH);
  const monthSnapshot = await getDoc(monthRef);
  if (!monthSnapshot.exists()) return null;
  const monthData = monthSnapshot.data();
  const revision = Number(monthData?.currentRevision);
  const revisionId = String(revision);
  if (
    monthData?.schemaVersion !== 1 ||
    monthData.monthKey !== PERFORMANCE_FINAL_MONTH ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    monthData.currentRevisionId !== revisionId
  ) throw new Error('financial_performance_invalid_head');
  const revisionRef = doc(collection(monthRef, REVISIONS_SUBCOLLECTION), revisionId);
  const revisionSnapshot = await getDoc(revisionRef);
  if (!revisionSnapshot.exists()) throw new Error('financial_performance_missing_revision');
  const confirmation = normalizeConfirmation(revisionSnapshot.data(), revision, revisionId, uid);
  const headUpdatedAt = normalizeTimestamp(monthData.updatedAt);
  if (!confirmation || confirmation.updatedAt !== headUpdatedAt) {
    throw new Error('financial_performance_invalid_revision');
  }
  return confirmation;
};

/** Appends an immutable revision and advances the month document's current pointer atomically. */
export const appendFinancialPerformanceConfirmation = async (
  input: FinancialPerformanceConfirmation,
): Promise<FinancialPerformanceConfirmation> => {
  if (!isFinancialPerformanceConfirmationValid(input)) {
    throw new Error('financial_performance_invalid_month_or_schema');
  }
  const uid = await requireUid();
  const monthRef = monthDocument(uid, PERFORMANCE_FINAL_MONTH);
  const revision = await runTransaction(db, async (transaction) => {
    const monthSnapshot = await transaction.get(monthRef);
    const monthData = monthSnapshot.data();
    const currentRevision = monthSnapshot.exists() ? Number(monthData?.currentRevision) : 0;
    if (
      monthSnapshot.exists() &&
      (monthData?.schemaVersion !== 1 ||
        monthData.monthKey !== PERFORMANCE_FINAL_MONTH ||
        !Number.isInteger(currentRevision) ||
        currentRevision < 1 ||
        monthData.currentRevisionId !== String(currentRevision))
    ) throw new Error('financial_performance_invalid_head');
    const nextRevision = Number.isInteger(currentRevision) && currentRevision > 0 ? currentRevision + 1 : 1;
    const revisionId = String(nextRevision);
    const revisionRef = doc(collection(monthRef, REVISIONS_SUBCOLLECTION), revisionId);
    const existingRevision = await transaction.get(revisionRef);
    if (existingRevision.exists()) throw new Error('financial_performance_revision_conflict');

    const flows = input.flows.map((flow) => ({
      id: flow.id,
      direction: flow.direction,
      effectiveDate: flow.effectiveDate,
      amountClp: Number(flow.amountClp),
      ...(flow.note?.trim() ? { note: flow.note.trim() } : {}),
      ...(flow.reference?.trim() ? { reference: flow.reference.trim() } : {}),
    }));
    transaction.set(revisionRef, {
      schemaVersion: 1,
      monthKey: PERFORMANCE_FINAL_MONTH,
      revision: nextRevision,
      revisionId,
      flowCompleteness: input.flowCompleteness,
      positionMovementCompleteness: input.positionMovementCompleteness,
      flows,
      createdAt: serverTimestamp(),
      createdByUid: uid,
    });
    transaction.set(monthRef, {
      schemaVersion: 1,
      monthKey: PERFORMANCE_FINAL_MONTH,
      currentRevision: nextRevision,
      currentRevisionId: revisionId,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return nextRevision;
  });

  return {
    ...input,
    flows: input.flows.map((flow) => ({ ...flow })),
    revision,
    updatedAt: new Date().toISOString(),
  };
};
