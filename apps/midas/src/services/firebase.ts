import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
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

let persistencePromise: Promise<void> | null = null;
let authReadyPromise: Promise<void> | null = null;

export function ensureAuthPersistence(): Promise<void> {
  if (persistencePromise) return persistencePromise;
  persistencePromise = setPersistence(auth, browserLocalPersistence).catch(() => {});
  return persistencePromise;
}

export function waitForAuthRestore(): Promise<void> {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = new Promise<void>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      () => {
        unsub();
        resolve();
      },
      (err) => {
        try {
          unsub();
        } catch {
          // ignore cleanup
        }
        reject(err);
      },
    );
  });
  return authReadyPromise;
}

export function getCurrentUid(): string | null {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  return user.uid;
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
