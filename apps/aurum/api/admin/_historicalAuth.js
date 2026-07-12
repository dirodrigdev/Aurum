import { getAdminAuth } from '../_firestoreAdmin.js';
import { assertAuthorizedIdentity } from './_historicalClosureCore.js';

const bearerToken = (req) => {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
};

export const requireHistoricalAdmin = async (req, res) => {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, code: 'unauthenticated', error: 'Falta token Firebase Bearer.' });
    return null;
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    return assertAuthorizedIdentity({
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
    }, req.body?.uid || req.query?.uid);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 401);
    const code = error?.code || 'invalid_token';
    const isConfigurationError = code === 'project_mismatch' || code === 'admin_credentials_missing';
    res.status(statusCode).json({
      ok: false,
      code,
      error: isConfigurationError || statusCode === 403
        ? error.message
        : 'Sesión Firebase inválida o vencida. Vuelve a iniciar sesión con Google e inténtalo otra vez.',
    });
    return null;
  }
};
