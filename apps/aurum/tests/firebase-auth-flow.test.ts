import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as any },
  getRedirectResult: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  setPersistence: vi.fn(async () => undefined),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: vi.fn(),
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  connectAuthEmulator: vi.fn(),
  getAuth: vi.fn(() => mocks.auth),
  getRedirectResult: mocks.getRedirectResult,
  GoogleAuthProvider: vi.fn(),
  onAuthStateChanged: vi.fn(),
  setPersistence: mocks.setPersistence,
  signInWithEmailAndPassword: vi.fn(),
  signInAnonymously: vi.fn(),
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signOut: vi.fn(),
}));

const loadFirebase = async () => {
  vi.resetModules();
  return import('../src/services/firebase');
};

describe('Firebase Google authentication flow', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.auth.currentUser = null;
    mocks.getRedirectResult.mockReset().mockResolvedValue(null);
    mocks.signInWithPopup.mockReset().mockResolvedValue({ user: { uid: 'google-user' } });
    mocks.signInWithRedirect.mockReset().mockResolvedValue(undefined);
    mocks.setPersistence.mockClear();
  });

  it('tries popup first, including on mobile user agents', async () => {
    const firebase = await loadFirebase();
    await firebase.signInWithGoogle();

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('falls back to redirect only when popup is blocked', async () => {
    mocks.signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    const firebase = await loadFirebase();
    await firebase.signInWithGoogle();

    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('uses the same mobile-safe redirect fallback for the GastApp connection', async () => {
    vi.stubEnv('VITE_GASTAPP_FIREBASE_API_KEY', 'test-key');
    vi.stubEnv('VITE_GASTAPP_FIREBASE_AUTH_DOMAIN', 'gastapp-test.firebaseapp.com');
    vi.stubEnv('VITE_GASTAPP_FIREBASE_PROJECT_ID', 'duofin-c1894');
    vi.stubEnv('VITE_GASTAPP_FIREBASE_STORAGE_BUCKET', 'gastapp-test.appspot.com');
    vi.stubEnv('VITE_GASTAPP_FIREBASE_MESSAGING_SENDER_ID', '123');
    vi.stubEnv('VITE_GASTAPP_FIREBASE_APP_ID', '1:123:web:test');
    mocks.signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    const firebase = await loadFirebase();

    await firebase.signInWithGastappGoogle();

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('consumes a successful redirect result during bootstrap', async () => {
    const user = { uid: 'redirect-user' };
    mocks.getRedirectResult.mockResolvedValueOnce({ user });
    const firebase = await loadFirebase();

    await expect(firebase.consumeRedirectAuthResult()).resolves.toEqual({ user, error: null });
    expect(mocks.getRedirectResult).toHaveBeenCalledWith(mocks.auth);
  });

  it('returns a redirect error so the AuthGate can show it without looping', async () => {
    const error = new Error('Google callback failed');
    mocks.getRedirectResult.mockRejectedValueOnce(error);
    const firebase = await loadFirebase();

    await expect(firebase.consumeRedirectAuthResult()).resolves.toEqual({ user: null, error });
    expect(mocks.getRedirectResult).toHaveBeenCalledTimes(1);
  });
});
