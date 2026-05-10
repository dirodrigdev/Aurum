import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { ModelParameters } from '../../domain/model/types';
import {
  aurumAuth,
  aurumDb,
  aurumFirebaseProjectId,
  aurumIntegrationConfigured,
  ensureAurumIntegrationAuth,
} from '../aurum/firebase';
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

export type SimulationConfigCloudReadStatus = 'loading' | 'loaded' | 'missing' | 'error';

export type SimulationConfigCloudDiagnostics = {
  path: string;
  projectId: string | null;
  configured: boolean;
  authUid: string | null;
  readStatus: SimulationConfigCloudReadStatus;
  errorMessage: string | null;
  exists: boolean | null;
  updatedAt: string | null;
  activeHash: string | null;
  activeSavedAt: string | null;
  activeParamsJsonExists: boolean;
  activeSpendingPhasesExists: boolean;
  activeSeedExists: boolean;
  activeNSimExists: boolean;
  activeBucketMonthsExists: boolean;
  missingFields: string[];
};

export type LoadPersistedSimulationConfigResult =
  | { ok: true; params: ModelParameters; active: PersistedSimulationConfigVersion; diagnostics: SimulationConfigCloudDiagnostics }
  | { ok: false; reason: string; diagnostics: SimulationConfigCloudDiagnostics };

export type PersistSimulationConfigResult =
  | { ok: true; active: PersistedSimulationConfigVersion; previous: PersistedSimulationConfigVersion | null }
  | { ok: false; reason: string };

const ref = () => {
  if (!aurumIntegrationConfigured || !aurumDb) return null;
  return doc(aurumDb, SIMULATION_CONFIG_COLLECTION, SIMULATION_CONFIG_DOC_ID);
};

const timestampToIso = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
};

export function createSimulationConfigCloudDiagnostics(
  overrides: Partial<SimulationConfigCloudDiagnostics> = {},
): SimulationConfigCloudDiagnostics {
  return {
    path: SIMULATION_CONFIG_PATH,
    projectId: aurumFirebaseProjectId,
    configured: aurumIntegrationConfigured,
    authUid: aurumAuth?.currentUser?.uid ?? null,
    readStatus: 'loading',
    errorMessage: null,
    exists: null,
    updatedAt: null,
    activeHash: null,
    activeSavedAt: null,
    activeParamsJsonExists: false,
    activeSpendingPhasesExists: false,
    activeSeedExists: false,
    activeNSimExists: false,
    activeBucketMonthsExists: false,
    missingFields: [],
    ...overrides,
  };
}

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

function buildDiagnosticsFromDocument(input: {
  data: PersistedSimulationConfigDocument & { updatedAt?: unknown };
  exists: boolean;
  readStatus: SimulationConfigCloudReadStatus;
  errorMessage?: string | null;
}): SimulationConfigCloudDiagnostics {
  const active = input.data.active;
  const parsedParams = active?.paramsJson ? parseParams(active) : null;
  const checks = {
    activeParamsJsonExists: typeof active?.paramsJson === 'string' && active.paramsJson.length > 0,
    activeSpendingPhasesExists: Array.isArray(parsedParams?.spendingPhases) && parsedParams.spendingPhases.length > 0,
    activeSeedExists: Number.isFinite(Number(parsedParams?.simulation?.seed ?? NaN)),
    activeNSimExists: Number.isFinite(Number(parsedParams?.simulation?.nSim ?? NaN)),
    activeBucketMonthsExists: Number.isFinite(Number(parsedParams?.bucketMonths ?? NaN)),
  };
  const missingFields = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  return createSimulationConfigCloudDiagnostics({
    readStatus: input.readStatus,
    errorMessage: input.errorMessage ?? null,
    exists: input.exists,
    updatedAt: timestampToIso(input.data.updatedAt),
    activeHash: typeof active?.hash === 'string' ? active.hash : null,
    activeSavedAt: typeof active?.savedAt === 'string' ? active.savedAt : null,
    ...checks,
    missingFields,
  });
}

export async function loadActiveSimulationConfigFromFirestore(): Promise<LoadPersistedSimulationConfigResult> {
  const docRef = ref();
  if (!docRef) {
    return {
      ok: false,
      reason: 'firestore_not_configured',
      diagnostics: createSimulationConfigCloudDiagnostics({
        readStatus: 'error',
        errorMessage: 'firestore_not_configured',
        exists: null,
      }),
    };
  }
  try {
    await ensureAurumIntegrationAuth();
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return {
        ok: false,
        reason: 'active_not_found',
        diagnostics: createSimulationConfigCloudDiagnostics({
          readStatus: 'missing',
          exists: false,
        }),
      };
    }
    const data = snap.data() as PersistedSimulationConfigDocument & { updatedAt?: unknown };
    const diagnostics = buildDiagnosticsFromDocument({ data, exists: true, readStatus: 'loaded' });
    if (!isPersistedVersion(data.active)) {
      return {
        ok: false,
        reason: 'active_payload_invalid',
        diagnostics: {
          ...diagnostics,
          readStatus: 'error',
          errorMessage: 'active_payload_invalid',
        },
      };
    }
    const parsed = parseParams(data.active);
    if (!parsed) {
      return {
        ok: false,
        reason: 'active_params_parse_failed',
        diagnostics: {
          ...diagnostics,
          readStatus: 'error',
          errorMessage: 'active_params_parse_failed',
        },
      };
    }
    return { ok: true, params: parsed, active: data.active, diagnostics };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason,
      diagnostics: createSimulationConfigCloudDiagnostics({
        readStatus: 'error',
        errorMessage: reason,
        exists: null,
      }),
    };
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
