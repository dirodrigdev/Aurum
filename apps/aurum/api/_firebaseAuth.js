const IDENTITY_TOOLKIT_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

const resolveFirebaseWebApiKey = () =>
  String(process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();

const extractBearerToken = (authorizationHeader) => {
  const header = String(authorizationHeader || '').trim();
  if (!header) return '';
  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token) return '';
  if (scheme.toLowerCase() !== 'bearer') return '';
  return token.trim();
};

const parseErrorMessage = (payload, fallback) => {
  const msg = String(payload?.error?.message || payload?.message || fallback || '').trim();
  return msg || fallback || 'Error de autenticación';
};

export const requireFirebaseAuth = async (req, res) => {
  const idToken = extractBearerToken(req.headers?.authorization || req.headers?.Authorization);
  if (!idToken) {
    res.status(401).json({ ok: false, error: 'Falta token de sesión (Bearer).' });
    return null;
  }

  const apiKey = resolveFirebaseWebApiKey();
  if (!apiKey) {
    res.status(500).json({
      ok: false,
      error: 'Falta FIREBASE_WEB_API_KEY (o VITE_FIREBASE_API_KEY) en el backend.',
    });
    return null;
  }

  try {
    const response = await fetch(`${IDENTITY_TOOLKIT_LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const details = parseErrorMessage(payload, `lookup_failed_${response.status}`);
      const isKeyIssue =
        details.includes('API_KEY') ||
        details.includes('API key not valid') ||
        details.includes('invalid api key');
      res.status(isKeyIssue ? 500 : 401).json({
        ok: false,
        error: isKeyIssue
          ? `No pude validar Firebase Auth por configuración de API key (${details}).`
          : 'Sesión inválida o vencida. Vuelve a iniciar sesión.',
      });
      return null;
    }

    const user = Array.isArray(payload?.users) ? payload.users[0] : null;
    const uid = String(user?.localId || '').trim();
    if (!uid) {
      res.status(401).json({ ok: false, error: 'No se pudo validar usuario en Firebase.' });
      return null;
    }

    return {
      uid,
      email: String(user?.email || ''),
    };
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: `No pude validar sesión Firebase (${error?.message || 'error de red'}).`,
    });
    return null;
  }
};
