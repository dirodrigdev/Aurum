import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isConfigured = () =>
  Boolean(firebaseConfig.projectId && firebaseConfig.apiKey && firebaseConfig.appId);

const app = isConfigured() ? initializeApp(firebaseConfig) : null;

export const aurumIntegrationConfigured = isConfigured();
export const aurumFirebaseProjectId = firebaseConfig.projectId ? String(firebaseConfig.projectId) : null;
export const aurumDb = app ? getFirestore(app) : null;
export const aurumAuth = app ? getAuth(app) : null;
const googleProvider = new GoogleAuthProvider();

let persistencePromise: Promise<void> | null = null;

export function ensureAurumIntegrationAuthPersistence(): Promise<void> {
  if (!aurumIntegrationConfigured || !aurumAuth) return Promise.resolve();

  if (!persistencePromise) {
    persistencePromise = setPersistence(aurumAuth, browserLocalPersistence).catch(() => {});
  }

  return persistencePromise;
}

const shouldUseRedirectSignIn = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isIosBrowser = /CriOS|FxiOS|EdgiOS/.test(ua);
  const isMobileSafari = /Mobile/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
  return isIos || isIosBrowser || isMobileSafari;
};

export async function signInToAurumIntegrationWithGoogle(): Promise<void> {
  if (!aurumIntegrationConfigured || !aurumAuth) return;
  await ensureAurumIntegrationAuthPersistence();
  if (shouldUseRedirectSignIn()) {
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
    await signInWithRedirect(aurumAuth, googleProvider);
  }
}

export async function signOutAurumIntegrationUser(): Promise<void> {
  if (!aurumAuth) return;
  await signOut(aurumAuth);
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
