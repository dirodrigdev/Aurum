import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { ModelParameters } from '../../domain/model/types';
import { aurumDb, aurumIntegrationConfigured, ensureAurumIntegrationAuth } from '../aurum/firebase';
import { buildSimulationConfigHash } from './simulationConfigCanonical';

export const SIMULATION_CONFIG_COLLECTION = 'midas_config';
export const SIMULATION_CONFIG_DOC_ID = 'simulationActiveV1';
export const SIMULATION_CONFIG_PATH = `${SIMULATION_CONFIG_COLLECTION}/${SIMULATION_CONFIG_DOC_ID}`;

export type PersistedSimulationConfigVersion = {
  schemaVersion: 1;
  savedAt: string;
  hash: string;
  source: string;
  paramsJson: string;
  spendingPhases: Array<{ id: string; durationMonths: number; amountReal: number; currency: string }>;
  nSim: number;
  seed: number;
  bucketMonths: number;
  capitalInitialClp: number;
};

type PersistedSimulationConfigDocument = {
  active?: PersistedSimulationConfigVersion | null;
  previous?: PersistedSimulationConfigVersion | null;
  lastFailedImport?: {
    attemptedAt: string;
    reason: string;
    source: string;
  } | null;
};

export type LoadPersistedSimulationConfigResult =
  | { ok: true; params: ModelParameters; active: PersistedSimulationConfigVersion }
  | { ok: false; reason: string };

export type PersistSimulationConfigResult =
  | { ok: true; active: PersistedSimulationConfigVersion; previous: PersistedSimulationConfigVersion | null }
  | { ok: false; reason: string };

const ref = () => {
  if (!aurumIntegrationConfigured || !aurumDb) return null;
  return doc(aurumDb, SIMULATION_CONFIG_COLLECTION, SIMULATION_CONFIG_DOC_ID);
};

function toPersistedVersion(params: ModelParameters, source: string): PersistedSimulationConfigVersion {
  const paramsJson = JSON.stringify(params);
  const savedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    savedAt,
    hash: buildSimulationConfigHash(params),
    source,
    paramsJson,
    spendingPhases: (params.spendingPhases ?? []).map((phase, index) => ({
      id: `F${index + 1}`,
      durationMonths: Number(phase.durationMonths ?? 0),
      amountReal: Number(phase.amountReal ?? 0),
      currency: phase.currency ?? 'CLP',
    })),
    nSim: Number(params.simulation?.nSim ?? 0),
    seed: Number(params.simulation?.seed ?? 0),
    bucketMonths: Number(params.bucketMonths ?? 0),
    capitalInitialClp: Number(params.capitalInitial ?? 0),
  };
}

function isPersistedVersion(value: unknown): value is PersistedSimulationConfigVersion {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedSimulationConfigVersion>;
  return candidate.schemaVersion === 1 && typeof candidate.paramsJson === 'string' && typeof candidate.hash === 'string';
}

function parseParams(active: PersistedSimulationConfigVersion): ModelParameters | null {
  try {
    const parsed = JSON.parse(active.paramsJson) as ModelParameters;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isFinite(Number(parsed.capitalInitial ?? NaN))) return null;
    if (!Array.isArray(parsed.spendingPhases) || parsed.spendingPhases.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadActiveSimulationConfigFromFirestore(): Promise<LoadPersistedSimulationConfigResult> {
  const docRef = ref();
  if (!docRef) return { ok: false, reason: 'firestore_not_configured' };
  try {
    await ensureAurumIntegrationAuth();
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { ok: false, reason: 'active_not_found' };
    const data = snap.data() as PersistedSimulationConfigDocument;
    if (!isPersistedVersion(data.active)) return { ok: false, reason: 'active_payload_invalid' };
    const parsed = parseParams(data.active);
    if (!parsed) return { ok: false, reason: 'active_params_parse_failed' };
    return { ok: true, params: parsed, active: data.active };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function persistActiveSimulationConfigToFirestore(input: {
  params: ModelParameters;
  source?: string;
}): Promise<PersistSimulationConfigResult> {
  const docRef = ref();
  if (!docRef) return { ok: false, reason: 'firestore_not_configured' };
  try {
    await ensureAurumIntegrationAuth();
    const existing = await getDoc(docRef);
    const existingData = existing.exists() ? (existing.data() as PersistedSimulationConfigDocument) : {};
    const previous = isPersistedVersion(existingData.active) ? existingData.active : null;
    const active = toPersistedVersion(input.params, input.source ?? 'simulation_runtime');
    await setDoc(docRef, { active, previous, updatedAt: serverTimestamp() });
    return { ok: true, active, previous };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
