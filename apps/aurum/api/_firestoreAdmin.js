import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const EXPECTED_AURUM_PROJECT_ID = 'aurum-prod-a1918';

const parseServiceAccount = () => {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    '';
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const tryJson = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const jsonDirect = tryJson(trimmed);
  if (jsonDirect) return jsonDirect;

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return tryJson(decoded);
  } catch {
    return null;
  }
};

const getAdminApp = () => {
  if (!getApps().length) {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      throw new Error('Falta configurar una service account Firebase Admin válida.');
    }
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getApps()[0];
};

export const getAdminFirestoreContext = () => {
  const app = getAdminApp();
  const projectId = String(app.options.projectId || '').trim();
  const environment = String(process.env.VERCEL_ENV || process.env.NODE_ENV || 'development');
  if (environment === 'production' && projectId !== EXPECTED_AURUM_PROJECT_ID) {
    throw Object.assign(new Error('El servicio administrativo está conectado a un proyecto Firebase inesperado.'), {
      statusCode: 503,
      code: 'project_mismatch',
    });
  }
  return {
    db: getFirestore(app),
    projectId,
    databaseId: '(default)',
    environment,
  };
};

export const getAdminDb = () => {
  return getAdminFirestoreContext().db;
};

export const getAdminAuth = () => {
  getAdminDb();
  return getAuth();
};
