import { getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
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

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

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

export const getGastappFirestore = () => {
  if (!hasGastappFirebaseConfig()) return null;
  if (gastappDbSingleton) return gastappDbSingleton;

  const appName = 'gastapp-shared';
  const existing = getApps().find((item) => item.name === appName);
  const gastappApp = existing ?? initializeApp(gastappFirebaseConfig, appName);
  gastappDbSingleton = getFirestore(gastappApp);
  return gastappDbSingleton;
};

export const isGastappFirestoreConfigured = () => hasGastappFirebaseConfig();

let _authInitPromise: Promise<void> | null = null;
let _persistenceInitPromise: Promise<void> | null = null;

export function ensureAuthPersistence(): Promise<void> {
  if (_persistenceInitPromise) return _persistenceInitPromise;
  _persistenceInitPromise = setPersistence(auth, browserLocalPersistence).catch(() => {});
  return _persistenceInitPromise;
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
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment';

    if (!needsRedirect) throw err;
    await signInWithRedirect(auth, googleProvider);
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
