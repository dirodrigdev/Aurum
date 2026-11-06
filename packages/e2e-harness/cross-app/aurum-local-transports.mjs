// Local transport adapters only. Production parsers, publishers, Auth lookup,
// authorization and Firestore transactions execute unchanged.
export function crossAppLocalTransports() {
  if (!process.env.CROSS_APP_SCENARIO_PATH) return null;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (process.env.GCLOUD_PROJECT !== 'aurum-e2e-local' ||
      authHost !== '127.0.0.1:9099' || firestoreHost !== '127.0.0.1:8080') {
    throw new Error('cross_app_local_transport_requires_aurum_emulators');
  }
  const bridge = '\0cross-app-gastapp-firebase';
  return {
    name: 'cross-app-local-transports', enforce: 'pre',
    resolveId(id, importer) {
      if (id === './firebase' && /\/services\/(gastosMonthly|gastappCanonicalV2)\.ts$/.test(importer || '')) return bridge;
    },
    load(id) {
      if (id !== bridge) return;
      return `import { initializeApp, getApps } from 'firebase/app';
        import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
        import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
        const app = getApps().find(a => a.name === 'cross-app-gastapp') || initializeApp({
          apiKey: 'synthetic-local-key', projectId: 'gastapp-e2e-local', authDomain: 'gastapp-e2e.local'
        }, 'cross-app-gastapp');
        const auth = getAuth(app); connectAuthEmulator(auth, 'http://${authHost}', { disableWarnings: true });
        const database = getFirestore(app); connectFirestoreEmulator(database, '127.0.0.1', 8080);
        await signInWithEmailAndPassword(auth, 'gastapp-e2e@example.test', 'gastapp-e2e-password');
        export const getGastappConfiguredProjectId = () => 'gastapp-e2e-local';
        export const getGastappFirestore = () => database;
        export const isGastappFirestoreConfigured = () => true;
        export const isE2EFirebaseEmulatorEnabled = () => false;`;
    },
    transform(code, id) {
      if (id.endsWith('/services/gastappCanonicalV2.ts')) {
        return code.replace("GASTAPP_CANONICAL_V2_PROJECT_ID = 'duofin-c1894'", "GASTAPP_CANONICAL_V2_PROJECT_ID = 'gastapp-e2e-local'");
      }
      if (id.endsWith('/services/gastosMonthly.ts')) {
        return code.replace("const USE_E2E_GASTAPP_FIXTURE = import.meta.env.VITE_E2E_USE_FIREBASE_EMULATOR === 'true';", 'const USE_E2E_GASTAPP_FIXTURE = false;');
      }
      if (id.endsWith('/services/midasPublished.ts')) {
        const bypass = 'if (isE2EFirebaseEmulatorEnabled()) {\n    return { ok: true, snapshot, selection: prepared.selection };\n  }';
        if (!code.includes(bypass)) throw new Error('cross_app_publication_transport_boundary_changed');
        return code.replace(bypass, '');
      }
    },
    async configureServer(server) {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      if (!getApps().length) initializeApp({ projectId: 'aurum-e2e-local' });
      process.env.FIREBASE_WEB_API_KEY = 'synthetic-local-key';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url || input.href);
        if (url.origin === 'https://identitytoolkit.googleapis.com' && url.pathname === '/v1/accounts:lookup') {
          // Real Auth Emulator validates the browser's actual ID token.
          return originalFetch(`http://${authHost}/identitytoolkit.googleapis.com${url.pathname}${url.search}`, init);
        }
        return originalFetch(input, init);
      };
      const { default: handler } = await import('../../../apps/aurum/api/midas/publish-snapshot.js');
      server.middlewares.use('/api/midas/publish-snapshot', async (req, res) => {
        try {
          let body = ''; for await (const chunk of req) body += chunk;
          req.body = body ? JSON.parse(body) : {};
          res.status = status => { res.statusCode = status; return res; };
          res.json = payload => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); return res; };
          await handler(req, res);
        } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(error) })); }
      });
    },
  };
}
