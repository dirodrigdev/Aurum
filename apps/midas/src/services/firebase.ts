import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
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

let persistencePromise: Promise<void> | null = null;
let authInitPromise: Promise<void> | null = null;

export function ensureAuthPersistence(): Promise<void> {
  if (persistencePromise) return persistencePromise;
  persistencePromise = setPersistence(auth, browserLocalPersistence).catch(() => {});
  return persistencePromise;
}

export function ensureAnonymousAuth(): Promise<void> {
  if (authInitPromise) return authInitPromise;

  authInitPromise = new Promise<void>((resolve, reject) => {
    let done = false;

    const finishOk = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const finishErr = (err: unknown) => {
      if (done) return;
      done = true;
      authInitPromise = null;
      reject(err);
    };

    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        try {
          unsub();
          if (user || auth.currentUser) {
            finishOk();
            return;
          }
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
      },
    );
  });

  return authInitPromise;
}

export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
