import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { ModelParameters } from '../../domain/model/types';
import {
  aurumAuth,
  aurumDb,
  aurumFirebaseProjectId,
  aurumIntegrationConfigured,
  ensureAurumIntegrationAuthPersistence,
} from '../aurum/firebase';
import {
  buildSimulationConfigHash,
  getUserScopedSimulationConfigPath,
  shouldSeedUserScopedSimulationConfig,
} from './simulationConfigCanonical';

export const LEGACY_SIMULATION_CONFIG_COLLECTION = 'midas_config';
export const SIMULATION_CONFIG_COLLECTION = 'midas_config';
export const SIMULATION_CONFIG_DOC_ID = 'simulationActiveV1';
export const LEGACY_SIMULATION_CONFIG_PATH = `${LEGACY_SIMULATION_CONFIG_COLLECTION}/${SIMULATION_CONFIG_DOC_ID}`;

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
  previousGlobalConfigPath: string | null;
  projectId: string | null;
  configured: boolean;
  authUid: string | null;
  authEmail: string | null;
  authProvider: string | null;
  isAnonymous: boolean;
  loginRequired: boolean;
  isCanonicalUserSession: boolean;
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
  legacyGlobalReadStatus: SimulationConfigCloudReadStatus | null;
  legacyGlobalErrorMessage: string | null;
  legacyGlobalExists: boolean | null;
  legacyGlobalHash: string | null;
  missingFields: string[];
};

export type LoadPersistedSimulationConfigResult =
  | { ok: true; params: ModelParameters; active: PersistedSimulationConfigVersion; diagnostics: SimulationConfigCloudDiagnostics }
  | { ok: false; reason: string; diagnostics: SimulationConfigCloudDiagnostics };

export type PersistSimulationConfigResult =
  | { ok: true; active: PersistedSimulationConfigVersion; previous: PersistedSimulationConfigVersion | null }
  | { ok: false; reason: string };

const currentUserDiagnostics = () => {
  const user = aurumAuth?.currentUser ?? null;
  const authProvider =
    user?.providerData.find((item) => item.providerId && item.providerId !== 'firebase')?.providerId
    ?? user?.providerData[0]?.providerId
    ?? (user?.isAnonymous ? 'anonymous' : null);
  return {
    authUid: user?.uid ?? null,
    authEmail: user?.email ?? null,
    authProvider,
    isAnonymous: Boolean(user?.isAnonymous),
    loginRequired: !user || user.isAnonymous,
    isCanonicalUserSession: Boolean(user && !user.isAnonymous),
  };
};

const userScopedRef = (uid: string | null | undefined) => {
  if (!aurumIntegrationConfigured || !aurumDb || !uid) return null;
  return doc(aurumDb, 'users', uid, SIMULATION_CONFIG_COLLECTION, SIMULATION_CONFIG_DOC_ID);
};

const legacyGlobalRef = () => {
  if (!aurumIntegrationConfigured || !aurumDb) return null;
  return doc(aurumDb, LEGACY_SIMULATION_CONFIG_COLLECTION, SIMULATION_CONFIG_DOC_ID);
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
  const auth = currentUserDiagnostics();
  return {
    path: auth.authUid ? getUserScopedSimulationConfigPath(auth.authUid) : LEGACY_SIMULATION_CONFIG_PATH,
    previousGlobalConfigPath: LEGACY_SIMULATION_CONFIG_PATH,
    projectId: aurumFirebaseProjectId,
    configured: aurumIntegrationConfigured,
    authUid: auth.authUid,
    authEmail: auth.authEmail,
    authProvider: auth.authProvider,
    isAnonymous: auth.isAnonymous,
    loginRequired: auth.loginRequired,
    isCanonicalUserSession: auth.isCanonicalUserSession,
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
    legacyGlobalReadStatus: null,
    legacyGlobalErrorMessage: null,
    legacyGlobalExists: null,
    legacyGlobalHash: null,
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
  path: string;
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
    path: input.path,
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

async function readPersistedConfigDocument(input: {
  path: string;
  refFactory: () => ReturnType<typeof doc> | null;
}): Promise<LoadPersistedSimulationConfigResult> {
  const docRef = input.refFactory();
  if (!docRef) {
    return {
      ok: false,
      reason: 'firestore_not_configured',
      diagnostics: createSimulationConfigCloudDiagnostics({
        path: input.path,
        readStatus: 'error',
        errorMessage: 'firestore_not_configured',
        exists: null,
      }),
    };
  }

  try {
    await ensureAurumIntegrationAuthPersistence();
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return {
        ok: false,
        reason: 'active_not_found',
        diagnostics: createSimulationConfigCloudDiagnostics({
          path: input.path,
          readStatus: 'missing',
          exists: false,
        }),
      };
    }
    const data = snap.data() as PersistedSimulationConfigDocument & { updatedAt?: unknown };
    const diagnostics = buildDiagnosticsFromDocument({
      data,
      exists: true,
      readStatus: 'loaded',
      path: input.path,
    });
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
        path: input.path,
        readStatus: 'error',
        errorMessage: reason,
        exists: null,
      }),
    };
  }
}

export async function loadLegacyGlobalSimulationConfigFromFirestore(): Promise<LoadPersistedSimulationConfigResult> {
  return readPersistedConfigDocument({
    path: LEGACY_SIMULATION_CONFIG_PATH,
    refFactory: () => legacyGlobalRef(),
  });
}

export async function loadActiveSimulationConfigFromFirestore(): Promise<LoadPersistedSimulationConfigResult> {
  const auth = currentUserDiagnostics();
  if (!auth.isCanonicalUserSession || !auth.authUid) {
    return {
      ok: false,
      reason: 'google_auth_required',
      diagnostics: createSimulationConfigCloudDiagnostics({
        path: auth.authUid ? getUserScopedSimulationConfigPath(auth.authUid) : LEGACY_SIMULATION_CONFIG_PATH,
        readStatus: 'error',
        errorMessage: 'google_auth_required',
        exists: null,
      }),
    };
  }

  const userScoped = await readPersistedConfigDocument({
    path: getUserScopedSimulationConfigPath(auth.authUid),
    refFactory: () => userScopedRef(auth.authUid),
  });

  if (userScoped.ok || userScoped.reason !== 'active_not_found') {
    return userScoped;
  }

  const legacy = await loadLegacyGlobalSimulationConfigFromFirestore();
  return {
    ...userScoped,
    diagnostics: {
      ...userScoped.diagnostics,
      previousGlobalConfigPath: LEGACY_SIMULATION_CONFIG_PATH,
      legacyGlobalReadStatus: legacy.diagnostics.readStatus,
      legacyGlobalErrorMessage: legacy.diagnostics.errorMessage,
      legacyGlobalExists: legacy.diagnostics.exists,
      legacyGlobalHash: legacy.diagnostics.activeHash,
    },
  };
}

export async function persistActiveSimulationConfigToFirestore(input: {
  params: ModelParameters;
  source?: string;
}): Promise<PersistSimulationConfigResult> {
  const auth = currentUserDiagnostics();
  const docRef = userScopedRef(auth.authUid);
  if (!auth.isCanonicalUserSession || !auth.authUid) return { ok: false, reason: 'google_auth_required' };
  if (!docRef) return { ok: false, reason: 'firestore_not_configured' };
  try {
    await ensureAurumIntegrationAuthPersistence();
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
