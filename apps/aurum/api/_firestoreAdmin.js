import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

export const getAdminDb = () => {
  if (!getApps().length) {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON para escribir refresh intents.');
    }
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
};
