import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { ModelParameters } from '../domain/model/types';
import { db, ensureAnonymousAuth, ensureAuthPersistence, getCurrentUid } from './firebase';

const MIDAS_BASE_MODEL_VERSION = 1;

type BaseModelDoc = {
  version: number;
  model: ModelParameters;
  updatedAt?: unknown;
};

async function getBaseModelDocRef() {
  await ensureAuthPersistence();
  await ensureAnonymousAuth();
  const uid = getCurrentUid();
  if (!uid) throw new Error('No Firebase user available for base model persistence.');
  return doc(db, 'users', uid, 'midas', 'baseModel');
}

function isModelParameters(value: unknown): value is ModelParameters {
  const model = value as ModelParameters | null;
  return Boolean(
    model &&
      typeof model.capitalInitial === 'number' &&
      typeof model.feeAnnual === 'number' &&
      model.weights &&
      model.returns &&
      model.simulation &&
      Array.isArray(model.spendingPhases),
  );
}

export async function loadBaseModelFromCloud(): Promise<ModelParameters | null> {
  const ref = await getBaseModelDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<BaseModelDoc>;
  if (!isModelParameters(data.model)) return null;
  return JSON.parse(JSON.stringify(data.model)) as ModelParameters;
}

export async function saveBaseModelToCloud(model: ModelParameters): Promise<void> {
  const ref = await getBaseModelDocRef();
  await setDoc(
    ref,
    {
      version: MIDAS_BASE_MODEL_VERSION,
      model,
      updatedAt: serverTimestamp(),
    } satisfies BaseModelDoc,
    { merge: true },
  );
}
