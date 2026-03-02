import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';

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

let _authInitPromise: Promise<void> | null = null;

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
        } catch {}
        finishErr(err);
      }
    );
  });

  return _authInitPromise;
}

export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
