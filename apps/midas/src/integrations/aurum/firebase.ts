import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const viteEnv = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {});

export function resolveAurumIntegrationAuthDomain(input: {
  configuredAuthDomain: string | undefined;
  hostname?: string | null;
  vercelEnv?: string | null;
}): string | undefined {
  const configured = input.configuredAuthDomain?.trim() || undefined;
  const hostname = input.hostname?.trim() || undefined;
  const vercelEnv = input.vercelEnv?.trim() || undefined;
  const isKnownProductionHost = hostname === 'midas-neon.vercel.app';
  const configuredIsFirebaseHost = Boolean(configured && /\.firebaseapp\.com$/i.test(configured));
  if (isKnownProductionHost && configuredIsFirebaseHost && vercelEnv === 'production') {
    return hostname;
  }
  return configured;
}

export function shouldUseAurumIntegrationAuthProxy(input: {
  configuredAuthDomain: string | undefined;
  effectiveAuthDomain: string | undefined;
  hostname?: string | null;
}): boolean {
  const configured = input.configuredAuthDomain?.trim() || '';
  const effective = input.effectiveAuthDomain?.trim() || '';
  const hostname = input.hostname?.trim() || '';
  return Boolean(hostname && effective && effective === hostname && configured !== effective);
}

const runtimeHostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
const runtimeVercelEnv = viteEnv.VITE_VERCEL_ENV ?? viteEnv.VERCEL_ENV ?? null;
const effectiveAuthDomain = resolveAurumIntegrationAuthDomain({
  configuredAuthDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN,
  hostname: runtimeHostname,
  vercelEnv: runtimeVercelEnv,
});

const firebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY,
  authDomain: effectiveAuthDomain,
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID,
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: viteEnv.VITE_FIREBASE_APP_ID,
};

const MIDAS_E2E_PROJECT_ID = 'midas-e2e-local';
const MIDAS_E2E_AUTH_EMAIL = 'midas.e2e@example.test';
const MIDAS_E2E_AUTH_PASSWORD = 'midas-e2e-only-not-a-secret';

export const isMidasE2EFirebaseEmulatorEnabled = () =>
  viteEnv.VITE_E2E_USE_FIREBASE_EMULATOR === 'true';

const assertSafeMidasE2EFirebaseConfig = () => {
  if (!isMidasE2EFirebaseEmulatorEnabled()) return;
  if (firebaseConfig.projectId !== MIDAS_E2E_PROJECT_ID) {
    throw new Error(`MIDAS E2E requires the local project ${MIDAS_E2E_PROJECT_ID}.`);
  }
};

const isConfigured = () =>
  Boolean(firebaseConfig.projectId && firebaseConfig.apiKey && firebaseConfig.appId);

const app = isConfigured() ? initializeApp(firebaseConfig) : null;

export const aurumIntegrationConfigured = isConfigured();
export const aurumFirebaseProjectId = firebaseConfig.projectId ? String(firebaseConfig.projectId) : null;
export const aurumFirebaseConfiguredAuthDomain = viteEnv.VITE_FIREBASE_AUTH_DOMAIN ? String(viteEnv.VITE_FIREBASE_AUTH_DOMAIN) : null;
export const aurumFirebaseEffectiveAuthDomain = firebaseConfig.authDomain ? String(firebaseConfig.authDomain) : null;
export const aurumDb = app ? getFirestore(app) : null;
export const aurumAuth = app ? getAuth(app) : null;
const googleProvider = new GoogleAuthProvider();

if (isMidasE2EFirebaseEmulatorEnabled()) {
  assertSafeMidasE2EFirebaseConfig();
  if (!aurumDb || !aurumAuth) throw new Error('MIDAS E2E requires Firebase Auth and Firestore configuration.');
  connectAuthEmulator(aurumAuth, 'http://127.0.0.1:9199', { disableWarnings: true });
  connectFirestoreEmulator(aurumDb, '127.0.0.1', 8180);
}

let persistencePromise: Promise<void> | null = null;
let persistenceState: 'idle' | 'pending' | 'ready' | 'error' = 'idle';
let persistenceErrorMessage: string | null = null;

const REDIRECT_PENDING_KEY = 'midas:auth-redirect-pending';
const REDIRECT_RETURNED_AT_KEY = 'midas:auth-redirect-returned-at';
const LAST_SIGNIN_ATTEMPT_METHOD_KEY = 'midas:auth-last-signin-attempt-method';
const CLICKED_GOOGLE_AT_KEY = 'midas:auth-clicked-google-at';
const SIGNOUT_ANON_BEFORE_GOOGLE_KEY = 'midas:auth-signout-anon-before-google';
const SIGNOUT_ANON_ERROR_KEY = 'midas:auth-signout-anon-error';
const REDIRECT_STARTED_AT_KEY = 'midas:auth-redirect-started-at';
const PERSISTENCE_TIMEOUT_MS = 1500;
const REDIRECT_RESULT_TIMEOUT_MS = 8000;
const AUTH_STATE_TIMEOUT_MS = 12000;

export type AurumIntegrationAuthStatus =
  | 'checkingAuth'
  | 'loginRequired'
  | 'signingIn'
  | 'redirectPending'
  | 'authenticatedGoogle'
  | 'authenticatedButAnonymous'
  | 'authError';

export type AurumIntegrationAuthBootstrapDiagnostics = {
  authStatus: AurumIntegrationAuthStatus;
  authUid: string | null;
  authEmail: string | null;
  isAnonymous: boolean;
  providerIds: string[];
  currentUserUid: string | null;
  currentUserIsAnonymous: boolean;
  currentUserProviderIds: string[];
  firebaseConfigAuthDomain: string | null;
  effectiveAuthDomain: string | null;
  expectedAuthHandlerUrl: string | null;
  currentHostname: string | null;
  isAuthDomainSameAsAppHost: boolean;
  usesAuthProxy: boolean;
  signInMethod: string | null;
  persistenceMode: 'browserLocalPersistence' | 'unavailable';
  persistenceReady: boolean;
  persistenceErrorMessage: string | null;
  lastSignInAttemptMethod: string | null;
  clickedGoogleAt: string | null;
  signOutAnonymousBeforeGoogle: boolean;
  signOutAnonymousError: string | null;
  redirectPendingBeforeStart: boolean;
  redirectStartedAt: string | null;
  redirectReturnedAt: string | null;
  redirectResultProcessed: boolean;
  redirectResultUserUid: string | null;
  redirectResultProviderIds: string[];
  redirectResultErrorCode: string | null;
  redirectResultErrorMessage: string | null;
  redirectPending: boolean;
  lastAuthErrorCode: string | null;
  lastAuthErrorMessage: string | null;
  authCheckStartedAt: string;
  authResolvedAt: string;
  authElapsedMs: number;
  timedOut: boolean;
  onAuthStateChangedEvents: Array<{
    uid: string | null;
    isAnonymous: boolean;
    providerIds: string[];
    timestamp: string;
  }>;
};

export type AurumIntegrationAuthBootstrapResult = {
  user: User | null;
  diagnostics: AurumIntegrationAuthBootstrapDiagnostics;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T | undefined>;
}

function getRedirectPending(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
}

function getSessionValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(key);
}

function setSessionValue(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(key, value);
}

function clearSessionValue(key: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(key);
}

function markRedirectPending(): void {
  setSessionValue(REDIRECT_PENDING_KEY, '1');
  setSessionValue(REDIRECT_STARTED_AT_KEY, new Date().toISOString());
}

function clearRedirectPending(): void {
  clearSessionValue(REDIRECT_PENDING_KEY);
}

function userProviderIds(user: User | null): string[] {
  if (!user) return [];
  const values = user.providerData
    .map((item) => item.providerId)
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

function buildBootstrapDiagnostics(input: {
  status: AurumIntegrationAuthStatus;
  startedAtMs: number;
  startedAtIso: string;
  user: User | null;
  currentUserAtStart: User | null;
  redirectResultProcessed: boolean;
  redirectResultUserUid: string | null;
  redirectResultProviderIds: string[];
  redirectResultErrorCode: string | null;
  redirectResultErrorMessage: string | null;
  redirectPending: boolean;
  lastAuthErrorCode: string | null;
  lastAuthErrorMessage: string | null;
  timedOut: boolean;
  onAuthStateChangedEvents: Array<{
    uid: string | null;
    isAnonymous: boolean;
    providerIds: string[];
    timestamp: string;
  }>;
}): AurumIntegrationAuthBootstrapDiagnostics {
  const resolvedAtMs = Date.now();
  const providerIds = userProviderIds(input.user);
  const currentUserProviderIds = userProviderIds(input.currentUserAtStart);
  return {
    authStatus: input.status,
    authUid: input.user?.uid ?? null,
    authEmail: input.user?.email ?? null,
    isAnonymous: Boolean(input.user?.isAnonymous),
    providerIds,
    currentUserUid: input.currentUserAtStart?.uid ?? null,
    currentUserIsAnonymous: Boolean(input.currentUserAtStart?.isAnonymous),
    currentUserProviderIds,
    firebaseConfigAuthDomain: aurumFirebaseConfiguredAuthDomain,
    effectiveAuthDomain: aurumFirebaseEffectiveAuthDomain,
    expectedAuthHandlerUrl: aurumFirebaseEffectiveAuthDomain ? `https://${aurumFirebaseEffectiveAuthDomain}/__/auth/handler` : null,
    currentHostname: runtimeHostname ?? null,
    isAuthDomainSameAsAppHost: Boolean(runtimeHostname && aurumFirebaseEffectiveAuthDomain && runtimeHostname === aurumFirebaseEffectiveAuthDomain),
    usesAuthProxy: shouldUseAurumIntegrationAuthProxy({
      configuredAuthDomain: aurumFirebaseConfiguredAuthDomain ?? undefined,
      effectiveAuthDomain: aurumFirebaseEffectiveAuthDomain ?? undefined,
      hostname: runtimeHostname,
    }),
    signInMethod: providerIds[0] ?? null,
    persistenceMode: aurumAuth ? 'browserLocalPersistence' : 'unavailable',
    persistenceReady: persistenceState === 'ready',
    persistenceErrorMessage,
    lastSignInAttemptMethod: getSessionValue(LAST_SIGNIN_ATTEMPT_METHOD_KEY),
    clickedGoogleAt: getSessionValue(CLICKED_GOOGLE_AT_KEY),
    signOutAnonymousBeforeGoogle: getSessionValue(SIGNOUT_ANON_BEFORE_GOOGLE_KEY) === '1',
    signOutAnonymousError: getSessionValue(SIGNOUT_ANON_ERROR_KEY),
    redirectPendingBeforeStart: input.redirectPending,
    redirectStartedAt: getSessionValue(REDIRECT_STARTED_AT_KEY),
    redirectReturnedAt: getSessionValue(REDIRECT_RETURNED_AT_KEY),
    redirectResultProcessed: input.redirectResultProcessed,
    redirectResultUserUid: input.redirectResultUserUid,
    redirectResultProviderIds: input.redirectResultProviderIds,
    redirectResultErrorCode: input.redirectResultErrorCode,
    redirectResultErrorMessage: input.redirectResultErrorMessage,
    redirectPending: input.redirectPending,
    lastAuthErrorCode: input.lastAuthErrorCode,
    lastAuthErrorMessage: input.lastAuthErrorMessage,
    authCheckStartedAt: input.startedAtIso,
    authResolvedAt: new Date(resolvedAtMs).toISOString(),
    authElapsedMs: Math.max(0, resolvedAtMs - input.startedAtMs),
    timedOut: input.timedOut,
    onAuthStateChangedEvents: input.onAuthStateChangedEvents.slice(-3),
  };
}

export function ensureAurumIntegrationAuthPersistence(): Promise<void> {
  if (!aurumIntegrationConfigured || !aurumAuth) return Promise.resolve();

  if (!persistencePromise) {
    persistenceState = 'pending';
    persistencePromise = withTimeout(setPersistence(aurumAuth, browserLocalPersistence), PERSISTENCE_TIMEOUT_MS)
      .then(() => {
        persistenceState = 'ready';
        persistenceErrorMessage = null;
      })
      .catch((error: unknown) => {
        persistenceState = 'error';
        persistenceErrorMessage = error instanceof Error ? error.message : String(error);
      });
  }

  return persistencePromise;
}

export function detectAurumIntegrationGoogleRedirectMode(userAgent: string = typeof navigator === 'undefined' ? '' : (navigator.userAgent || '')): boolean {
  const ua = userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isIosBrowser = /CriOS|FxiOS|EdgiOS/.test(ua);
  const isMobileSafari = /Mobile/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
  return isIos || isIosBrowser || isMobileSafari;
}

export function shouldSignOutAnonymousBeforeGoogle(user: Pick<User, 'isAnonymous'> | null): boolean {
  return Boolean(user?.isAnonymous);
}

export async function signInToAurumIntegrationWithGoogle(): Promise<void> {
  if (isMidasE2EFirebaseEmulatorEnabled()) {
    throw new Error('Google real está deshabilitado en MIDAS E2E local.');
  }
  if (!aurumIntegrationConfigured || !aurumAuth) return;
  await ensureAurumIntegrationAuthPersistence();
  setSessionValue(CLICKED_GOOGLE_AT_KEY, new Date().toISOString());
  setSessionValue(LAST_SIGNIN_ATTEMPT_METHOD_KEY, detectAurumIntegrationGoogleRedirectMode() ? 'redirect' : 'popup_or_redirect');
  clearSessionValue(SIGNOUT_ANON_ERROR_KEY);
  clearSessionValue(REDIRECT_RETURNED_AT_KEY);
  const hadAnonymous = shouldSignOutAnonymousBeforeGoogle(aurumAuth.currentUser);
  if (hadAnonymous) {
    setSessionValue(SIGNOUT_ANON_BEFORE_GOOGLE_KEY, '1');
    try {
      await signOut(aurumAuth);
    } catch (error: any) {
      setSessionValue(SIGNOUT_ANON_ERROR_KEY, String(error?.message || 'anonymous_signout_failed'));
      throw error;
    }
  } else {
    clearSessionValue(SIGNOUT_ANON_BEFORE_GOOGLE_KEY);
  }
  if (detectAurumIntegrationGoogleRedirectMode()) {
    markRedirectPending();
    await signInWithRedirect(aurumAuth, googleProvider);
    return;
  }

  try {
    await signInWithPopup(aurumAuth, googleProvider);
  } catch (error: any) {
    const code = String(error?.code || '');
    const needsRedirect =
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment';
    if (!needsRedirect) throw error;
    setSessionValue(LAST_SIGNIN_ATTEMPT_METHOD_KEY, 'redirect_fallback');
    markRedirectPending();
    await signInWithRedirect(aurumAuth, googleProvider);
  }
}

async function ensureMidasE2EEmulatorAuthentication(): Promise<void> {
  if (!isMidasE2EFirebaseEmulatorEnabled()) return;
  assertSafeMidasE2EFirebaseConfig();
  if (!aurumAuth) throw new Error('MIDAS E2E no pudo inicializar Auth Emulator.');
  if (aurumAuth.currentUser) return;
  await signInWithEmailAndPassword(aurumAuth, MIDAS_E2E_AUTH_EMAIL, MIDAS_E2E_AUTH_PASSWORD);
}

export async function signOutAurumIntegrationUser(): Promise<void> {
  if (!aurumAuth) return;
  clearRedirectPending();
  clearSessionValue(REDIRECT_RETURNED_AT_KEY);
  clearSessionValue(SIGNOUT_ANON_BEFORE_GOOGLE_KEY);
  clearSessionValue(SIGNOUT_ANON_ERROR_KEY);
  await signOut(aurumAuth);
}

export async function bootstrapAurumIntegrationAuthSession(): Promise<AurumIntegrationAuthBootstrapResult> {
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  if (!aurumIntegrationConfigured || !aurumAuth) {
    return {
      user: null,
      diagnostics: buildBootstrapDiagnostics({
        status: 'loginRequired',
        startedAtMs,
        startedAtIso,
        user: null,
        currentUserAtStart: null,
        redirectResultProcessed: false,
        redirectResultUserUid: null,
        redirectResultProviderIds: [],
        redirectResultErrorCode: null,
        redirectResultErrorMessage: null,
        redirectPending: false,
        lastAuthErrorCode: null,
        lastAuthErrorMessage: null,
        timedOut: false,
        onAuthStateChangedEvents: [],
      }),
    };
  }

  let lastAuthErrorCode: string | null = null;
  let lastAuthErrorMessage: string | null = null;
  let redirectResultProcessed = false;
  let redirectResultUserUid: string | null = null;
  let redirectResultProviderIds: string[] = [];
  let redirectResultErrorCode: string | null = null;
  let redirectResultErrorMessage: string | null = null;
  const redirectPending = getRedirectPending();
  const currentUserAtStart = aurumAuth.currentUser ?? null;
  const authStateEvents: Array<{
    uid: string | null;
    isAnonymous: boolean;
    providerIds: string[];
    timestamp: string;
  }> = [];

  await ensureAurumIntegrationAuthPersistence();
  await ensureMidasE2EEmulatorAuthentication();

  try {
    const redirectResult = await withTimeout(getRedirectResult(aurumAuth), REDIRECT_RESULT_TIMEOUT_MS);
    if (redirectResult !== undefined) {
      redirectResultProcessed = true;
      redirectResultUserUid = redirectResult?.user?.uid ?? null;
      redirectResultProviderIds = userProviderIds(redirectResult?.user ?? null);
      setSessionValue(REDIRECT_RETURNED_AT_KEY, new Date().toISOString());
      clearRedirectPending();
    }
  } catch (error: any) {
    redirectResultProcessed = true;
    setSessionValue(REDIRECT_RETURNED_AT_KEY, new Date().toISOString());
    clearRedirectPending();
    lastAuthErrorCode = String(error?.code || 'auth/redirect-result-failed');
    lastAuthErrorMessage = String(error?.message || 'No pude procesar el retorno de Google.');
    redirectResultErrorCode = lastAuthErrorCode;
    redirectResultErrorMessage = lastAuthErrorMessage;
  }

  try {
    const authUser = await new Promise<User | null | undefined>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        aurumAuth,
        (user) => {
          authStateEvents.push({
            uid: user?.uid ?? null,
            isAnonymous: Boolean(user?.isAnonymous),
            providerIds: userProviderIds(user),
            timestamp: new Date().toISOString(),
          });
          unsubscribe();
          resolve(user);
        },
        (error) => {
          unsubscribe();
          reject(error);
        },
      );
      setTimeout(() => {
        unsubscribe();
        resolve(undefined);
      }, AUTH_STATE_TIMEOUT_MS);
    });

    const user = authUser === undefined ? aurumAuth.currentUser ?? null : authUser;
    if (user && !user.isAnonymous) {
      return {
        user,
        diagnostics: buildBootstrapDiagnostics({
          status: 'authenticatedGoogle',
          startedAtMs,
          startedAtIso,
          user,
          currentUserAtStart,
          redirectResultProcessed,
          redirectResultUserUid,
          redirectResultProviderIds,
          redirectResultErrorCode,
          redirectResultErrorMessage,
          redirectPending,
          lastAuthErrorCode,
          lastAuthErrorMessage,
          timedOut: false,
          onAuthStateChangedEvents: authStateEvents,
        }),
      };
    }
    if (redirectPending && redirectResultProcessed && (!redirectResultUserUid || userProviderIds(user).includes('anonymous') || user?.isAnonymous)) {
      return {
        user,
        diagnostics: buildBootstrapDiagnostics({
          status: 'authError',
          startedAtMs,
          startedAtIso,
          user,
          currentUserAtStart,
          redirectResultProcessed,
          redirectResultUserUid,
          redirectResultProviderIds,
          redirectResultErrorCode: redirectResultErrorCode ?? 'auth/google-did-not-replace-anonymous',
          redirectResultErrorMessage:
            redirectResultErrorMessage ?? 'Google no reemplazó la sesión anónima existente.',
          redirectPending,
          lastAuthErrorCode: lastAuthErrorCode ?? 'auth/google-did-not-replace-anonymous',
          lastAuthErrorMessage:
            lastAuthErrorMessage ?? 'Google no reemplazó la sesión anónima existente.',
          timedOut: false,
          onAuthStateChangedEvents: authStateEvents,
        }),
      };
    }
    if (user?.isAnonymous) {
      return {
        user,
        diagnostics: buildBootstrapDiagnostics({
          status: 'authenticatedButAnonymous',
          startedAtMs,
          startedAtIso,
          user,
          currentUserAtStart,
          redirectResultProcessed,
          redirectResultUserUid,
          redirectResultProviderIds,
          redirectResultErrorCode,
          redirectResultErrorMessage,
          redirectPending,
          lastAuthErrorCode,
          lastAuthErrorMessage,
          timedOut: false,
          onAuthStateChangedEvents: authStateEvents,
        }),
      };
    }
    if (authUser === undefined) {
      return {
        user: null,
        diagnostics: buildBootstrapDiagnostics({
          status: 'authError',
          startedAtMs,
          startedAtIso,
          user: null,
          currentUserAtStart,
          redirectResultProcessed,
          redirectResultUserUid,
          redirectResultProviderIds,
          redirectResultErrorCode,
          redirectResultErrorMessage,
          redirectPending,
          lastAuthErrorCode: lastAuthErrorCode ?? 'auth/timeout',
          lastAuthErrorMessage:
            lastAuthErrorMessage ?? 'La validación de sesión tardó demasiado. Reintenta o vuelve a iniciar sesión.',
          timedOut: true,
          onAuthStateChangedEvents: authStateEvents,
        }),
      };
    }
    return {
      user: null,
      diagnostics: buildBootstrapDiagnostics({
        status: redirectPending ? 'redirectPending' : 'loginRequired',
        startedAtMs,
        startedAtIso,
        user: null,
        currentUserAtStart,
        redirectResultProcessed,
        redirectResultUserUid,
        redirectResultProviderIds,
        redirectResultErrorCode,
        redirectResultErrorMessage,
        redirectPending,
        lastAuthErrorCode,
        lastAuthErrorMessage,
        timedOut: false,
        onAuthStateChangedEvents: authStateEvents,
      }),
    };
  } catch (error: any) {
    const user = aurumAuth.currentUser ?? null;
    return {
      user,
      diagnostics: buildBootstrapDiagnostics({
        status: 'authError',
        startedAtMs,
        startedAtIso,
        user,
        currentUserAtStart,
        redirectResultProcessed,
        redirectResultUserUid,
        redirectResultProviderIds,
        redirectResultErrorCode,
        redirectResultErrorMessage,
        redirectPending,
        lastAuthErrorCode: String(error?.code || lastAuthErrorCode || 'auth/bootstrap-failed'),
        lastAuthErrorMessage: String(error?.message || lastAuthErrorMessage || 'No pude validar la sesión Google.'),
        timedOut: false,
        onAuthStateChangedEvents: authStateEvents,
      }),
    };
  }
}

export function subscribeAurumIntegrationAuthState(
  listener: (user: User | null) => void,
  onError?: (error: Error) => void,
): () => void {
  if (!aurumAuth) {
    listener(null);
    return () => {};
  }
  void ensureAurumIntegrationAuthPersistence();
  return onAuthStateChanged(
    aurumAuth,
    listener,
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}
