import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Unit tests must use the repository's local emulator-shaped configuration.
  // This keeps Firebase initialisation deterministic without ever loading
  // production credentials into the test process.
  const env = loadEnv(mode === 'test' ? 'e2e' : mode, process.cwd(), '');
  // The emulator flag belongs to authenticated browser E2E only. Unit tests
  // must keep the normal Firestore bridge disabled so their explicit mocks and
  // local fixtures remain authoritative.
  if (mode === 'test') env.VITE_E2E_USE_FIREBASE_EMULATOR = 'false';
  const firebaseEnv = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => key.startsWith('VITE_'))
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return defineConfig({
    define: firebaseEnv,
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  });
});
