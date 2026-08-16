import { getApps, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const E2E_LOCAL_PROJECT_ID = 'aurum-e2e-local';
const E2E_AUTH_EMAIL = 'aurum.e2e@example.test';
const E2E_AUTH_PASSWORD = 'aurum-e2e-only-not-a-secret';
const isLocalProjectId = (projectId: string) => /^(aurum-e2e|local-|demo-)/.test(projectId);

export const isE2EFirebaseEmulatorEnabled = () =>
  import.meta.env.VITE_E2E_USE_FIREBASE_EMULATOR === 'true';

const assertSafeE2EFirebaseConfig = () => {
  if (!isE2EFirebaseEmulatorEnabled()) return;
  const projectId = String(firebaseConfig.projectId || '');
  if (!isLocalProjectId(projectId) || projectId !== E2E_LOCAL_PROJECT_ID) {
    throw new Error(`E2E Firebase requires the local project ${E2E_LOCAL_PROJECT_ID}.`);
  }
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

if (isE2EFirebaseEmulatorEnabled()) {
  assertSafeE2EFirebaseConfig();
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const gastappFirebaseConfig = {
  apiKey: import.meta.env.VITE_GASTAPP_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_GASTAPP_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_GASTAPP_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_GASTAPP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_GASTAPP_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_GASTAPP_FIREBASE_APP_ID,
};

const hasGastappFirebaseConfig = () =>
  Boolean(
    gastappFirebaseConfig.apiKey &&
      gastappFirebaseConfig.authDomain &&
      gastappFirebaseConfig.projectId &&
      gastappFirebaseConfig.storageBucket &&
      gastappFirebaseConfig.messagingSenderId &&
      gastappFirebaseConfig.appId,
  );

let gastappDbSingleton: ReturnType<typeof getFirestore> | null = null;
let gastappAuthSingleton: ReturnType<typeof getAuth> | null = null;
let gastappGoogleProviderSingleton: GoogleAuthProvider | null = null;
let gastappPersistencePromise: Promise<void> | null = null;

const getGastappFirebaseApp = () => {
  if (isE2EFirebaseEmulatorEnabled() || !hasGastappFirebaseConfig()) return null;
  const appName = 'gastapp-shared';
  return getApps().find((item) => item.name === appName) ?? initializeApp(gastappFirebaseConfig, appName);
};

export const getGastappFirestore = () => {
  if (gastappDbSingleton) return gastappDbSingleton;
  const gastappApp = getGastappFirebaseApp();
  if (!gastappApp) return null;
  gastappDbSingleton = getFirestore(gastappApp);
  return gastappDbSingleton;
};

export const getGastappAuth = () => {
  if (gastappAuthSingleton) return gastappAuthSingleton;
  const gastappApp = getGastappFirebaseApp();
  if (!gastappApp) return null;
  gastappAuthSingleton = getAuth(gastappApp);
  return gastappAuthSingleton;
};

export const ensureGastappAuthPersistence = async (): Promise<void> => {
  const gastappAuth = getGastappAuth();
  if (!gastappAuth) throw new Error('gastapp_secondary_auth_unavailable');
  if (!gastappPersistencePromise) {
    gastappPersistencePromise = setPersistence(gastappAuth, browserLocalPersistence).catch((error) => {
      gastappPersistencePromise = null;
      throw error;
    });
  }
  await gastappPersistencePromise;
};

export const waitForGastappAuthUser = async () => {
  const gastappAuth = getGastappAuth();
  if (!gastappAuth) return null;
  await ensureGastappAuthPersistence();
  if (gastappAuth.currentUser) return gastappAuth.currentUser;
  return new Promise<typeof gastappAuth.currentUser>((resolve, reject) => {
    let unsubscribe = () => undefined;
    unsubscribe = onAuthStateChanged(
      gastappAuth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
};

export const signInWithGastappGoogle = async () => {
  const gastappAuth = getGastappAuth();
  if (!gastappAuth) throw new Error('gastapp_secondary_auth_unavailable');
  await ensureGastappAuthPersistence();
  if (!gastappGoogleProviderSingleton) gastappGoogleProviderSingleton = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(gastappAuth, gastappGoogleProviderSingleton);
    return result.user;
  } catch (error: any) {
    const code = String(error?.code || '');
    const needsRedirect =
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment';
    if (!needsRedirect) throw error;
    await signInWithRedirect(gastappAuth, gastappGoogleProviderSingleton);
    return gastappAuth.currentUser;
  }
};

export const isGastappFirestoreConfigured = () => hasGastappFirebaseConfig();
export const getGastappConfiguredProjectId = () =>
  String(gastappFirebaseConfig.projectId || '');

let _authInitPromise: Promise<void> | null = null;
let _persistenceInitPromise: Promise<void> | null = null;
let _redirectResultPromise: Promise<{ user: ReturnType<typeof getAuth>['currentUser']; error: unknown | null }> | null = null;

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T | undefined> => {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
};

export function ensureAuthPersistence(): Promise<void> {
  if (_persistenceInitPromise) return _persistenceInitPromise;
  // Safari/iOS can occasionally leave persistence setup slow or unresolved.
  // Auth bootstrap must remain bounded so the login gate never spins forever.
  _persistenceInitPromise = withTimeout(setPersistence(auth, browserLocalPersistence), 1500)
    .then(() => undefined)
    .catch(() => undefined);
  return _persistenceInitPromise;
}

/**
 * Consume the OAuth callback before the auth gate subscribes to the session.
 * Firebase returns null when the current page was not reached through a
 * redirect. Errors are returned to the caller so the login screen can show a
 * useful message instead of silently restarting the flow.
 */
export function consumeRedirectAuthResult() {
  if (_redirectResultPromise) return _redirectResultPromise;
  _redirectResultPromise = (async () => {
    await ensureAuthPersistence();
    try {
      const result = await getRedirectResult(auth);
      return { user: result?.user ?? auth.currentUser, error: null };
    } catch (error) {
      return { user: auth.currentUser, error };
    }
  })();
  return _redirectResultPromise;
}

export async function ensureE2EEmulatorAuthentication(): Promise<void> {
  if (!isE2EFirebaseEmulatorEnabled()) return;
  assertSafeE2EFirebaseConfig();
  await ensureAuthPersistence();
  if (auth.currentUser) return;
  await signInWithEmailAndPassword(auth, E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD);
}

export function ensureAnonymousAuth(): Promise<void> {
  // Importante:
  // - En un reload, Firebase rehidrata la sesión async. Durante un rato, `auth.currentUser`
  //   puede ser null aunque exista sesión persistida.
  // - Si llamamos `signInAnonymously` antes de esa rehidratación, generamos un UID nuevo
  //   y rompes el whitelist.
  // Por eso esperamos el primer `onAuthStateChanged` y recién ahí decidimos.

  if (_authInitPromise) return _authInitPromise;

  _authInitPromise = new Promise<void>((resolve, reject) => {
    let done = false;

    const finishOk = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const finishErr = (err: any) => {
      if (done) return;
      done = true;
      _authInitPromise = null;
      reject(err);
    };

    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        try {
          unsub();

          // Si ya hay user rehidratado, no hacemos nada.
          if (user || auth.currentUser) {
            finishOk();
            return;
          }

          // Si no hay user, recién ahí hacemos login anónimo.
          await signInAnonymously(auth);
          finishOk();
        } catch (err) {
          finishErr(err);
        }
      },
      (err) => {
        try {
          unsub();
        } catch {
          // ignore cleanup error
        }
        finishErr(err);
      }
    );
  });

  return _authInitPromise;
}

export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

export async function signInWithGoogle(): Promise<void> {
  await ensureAuthPersistence();
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err: any) {
    const code = String(err?.code || '');
    const needsRedirect =
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment';

    if (!needsRedirect) throw err;
    await signInWithRedirect(auth, googleProvider);
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
