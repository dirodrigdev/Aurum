import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  parseStoredInstrumentUniverseSnapshot,
  saveInstrumentUniverseSnapshot,
  validateInstrumentUniverseJson,
  type InstrumentUniverseSnapshot,
} from '../../domain/instrumentUniverse';
import { aurumDb, aurumIntegrationConfigured, ensureAurumIntegrationAuth } from '../aurum/firebase';

const COLLECTION = 'midas_config';
const DOC_ID = 'instrumentUniverseV1';

export type PersistedInstrumentUniverseVersion = {
  schemaVersion: 1;
  savedAt: string;
  hash: string;
  fileName: string | null;
  payloadJson: string;
  instrumentCount: number;
  usableInstrumentCount: number;
};

type PersistedInstrumentUniverseDocument = {
  active?: PersistedInstrumentUniverseVersion | null;
  previous?: PersistedInstrumentUniverseVersion | null;
};

export type PersistInstrumentUniverseResult =
  | { ok: true; active: PersistedInstrumentUniverseVersion; previous: PersistedInstrumentUniverseVersion | null }
  | { ok: false; reason: string };

export type LoadPersistedInstrumentUniverseResult =
  | { ok: true; snapshot: InstrumentUniverseSnapshot; active: PersistedInstrumentUniverseVersion }
  | { ok: false; reason: string };

const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export function buildPersistedInstrumentUniverseVersion(
  snapshot: InstrumentUniverseSnapshot,
  fileName: string | null = null,
): PersistedInstrumentUniverseVersion {
  const summary = validateInstrumentUniverseJson(snapshot.rawJson).summary;
  return {
    schemaVersion: 1,
    savedAt: snapshot.savedAt || new Date().toISOString(),
    hash: hashString(snapshot.rawJson),
    fileName,
    payloadJson: snapshot.rawJson,
    instrumentCount: snapshot.instruments.length,
    usableInstrumentCount: summary?.usableInstrumentCount ?? snapshot.instruments.filter((item) => item.usable).length,
  };
}

const isPersistedVersion = (value: unknown): value is PersistedInstrumentUniverseVersion => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PersistedInstrumentUniverseVersion>;
  return record.schemaVersion === 1 && typeof record.payloadJson === 'string' && typeof record.hash === 'string';
};

const ref = () => {
  if (!aurumIntegrationConfigured || !aurumDb) return null;
  return doc(aurumDb, COLLECTION, DOC_ID);
};

export async function loadActiveInstrumentUniverseFromFirestore(): Promise<LoadPersistedInstrumentUniverseResult> {
  const docRef = ref();
  if (!docRef) return { ok: false, reason: 'firestore_not_configured' };
  try {
    await ensureAurumIntegrationAuth();
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { ok: false, reason: 'active_not_found' };
    const data = snap.data() as PersistedInstrumentUniverseDocument;
    const active = data.active;
    if (!isPersistedVersion(active)) return { ok: false, reason: 'active_payload_missing_or_invalid_shape' };
    const snapshot = parseStoredInstrumentUniverseSnapshot(active.payloadJson);
    if (!snapshot) return { ok: false, reason: 'active_payload_failed_validation' };
    return { ok: true, snapshot: { ...snapshot, savedAt: active.savedAt }, active };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function persistInstrumentUniverseActiveToFirestore(input: {
  snapshot: InstrumentUniverseSnapshot;
  fileName?: string | null;
}): Promise<PersistInstrumentUniverseResult> {
  const docRef = ref();
  if (!docRef) return { ok: false, reason: 'firestore_not_configured' };
  try {
    await ensureAurumIntegrationAuth();
    const existing = await getDoc(docRef);
    const existingData = existing.exists() ? (existing.data() as PersistedInstrumentUniverseDocument) : {};
    const previous = isPersistedVersion(existingData.active) ? existingData.active : null;
    const active = buildPersistedInstrumentUniverseVersion(input.snapshot, input.fileName ?? null);
    await setDoc(docRef, {
      active,
      previous,
      updatedAt: serverTimestamp(),
    });
    return { ok: true, active, previous };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function hydrateInstrumentUniverseCacheFromFirestore(): Promise<LoadPersistedInstrumentUniverseResult> {
  const loaded = await loadActiveInstrumentUniverseFromFirestore();
  if (loaded.ok) saveInstrumentUniverseSnapshot(loaded.snapshot);
  return loaded;
}
