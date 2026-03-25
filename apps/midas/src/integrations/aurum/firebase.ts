import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
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
export const aurumDb = app ? getFirestore(app) : null;
export const aurumAuth = app ? getAuth(app) : null;

let persistencePromise: Promise<void> | null = null;
let anonymousAuthPromise: Promise<void> | null = null;

export function ensureAurumIntegrationAuth(): Promise<void> {
  if (!aurumIntegrationConfigured || !aurumAuth) return Promise.resolve();

  if (!persistencePromise) {
    persistencePromise = setPersistence(aurumAuth, browserLocalPersistence).catch(() => {});
  }

  if (!anonymousAuthPromise) {
    anonymousAuthPromise = persistencePromise.then(async () => {
      if (aurumAuth.currentUser) return;
      await signInAnonymously(aurumAuth);
    });
  }

  return anonymousAuthPromise;
}
