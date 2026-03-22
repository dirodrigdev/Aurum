import crypto from 'node:crypto';
import { requireFirebaseAuth } from '../_firebaseAuth.js';
import { getAdminDb } from '../_firestoreAdmin.js';

const FINTOC_BASE_URL = process.env.FINTOC_BASE_URL || 'https://api.fintoc.com/v1';

const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const requestFintoc = async (path, secretKey, method = 'GET') => {
  const response = await fetch(`${FINTOC_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: secretKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json, rawText };
};

const parseArrayPayload = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.accounts)) return payload.accounts;
  return [];
};

const hashLinkToken = (linkToken) =>
  crypto.createHash('sha256').update(String(linkToken || '')).digest('hex');

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const auth = await requireFirebaseAuth(req, res);
  if (!auth) return;

  const secretKey = process.env.FINTOC_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ ok: false, error: 'Falta FINTOC_SECRET_KEY en el backend' });
  }

  const linkToken = String(req.body?.link_token || '').trim();
  if (!linkToken) {
    return res.status(400).json({ ok: false, error: 'Debes enviar link_token' });
  }

  try {
    const refreshResponse = await requestFintoc(
      `/refresh_intents?link_token=${encodeURIComponent(linkToken)}`,
      secretKey,
      'POST',
    );

    if (!refreshResponse.ok) {
      const message = refreshResponse.json?.message || refreshResponse.rawText || 'No pude crear Refresh Intent.';
      return res.status(502).json({ ok: false, error: message });
    }

    const refreshIntent = refreshResponse.json;
    const refreshIntentId = String(refreshIntent?.id || '').trim();
    if (!refreshIntentId) {
      return res.status(502).json({ ok: false, error: 'Respuesta inválida de Refresh Intent.' });
    }

    const accountsResponse = await requestFintoc(
      `/accounts?link_token=${encodeURIComponent(linkToken)}`,
      secretKey,
      'GET',
    );
    const accounts = accountsResponse.ok ? parseArrayPayload(accountsResponse.json) : [];
    const accountIds = accounts.map((acc) => String(acc?.id || '')).filter(Boolean);

    const db = getAdminDb();
    const now = new Date().toISOString();
    await db.collection('fintoc_refresh_intents').doc(refreshIntentId).set({
      id: refreshIntentId,
      uid: auth.uid,
      linkTokenHash: hashLinkToken(linkToken),
      status: String(refreshIntent?.status || 'created'),
      requiresMfa: refreshIntent?.requires_mfa || null,
      refreshedObject: String(refreshIntent?.refreshed_object || 'link'),
      refreshedObjectId: String(refreshIntent?.refreshed_object_id || ''),
      type: String(refreshIntent?.type || ''),
      accountIds,
      accountStatus: {},
      createdAt: now,
      updatedAt: now,
    });

    return res.status(200).json({
      ok: true,
      refresh_intent_id: refreshIntentId,
      status: String(refreshIntent?.status || 'created'),
      requires_mfa: refreshIntent?.requires_mfa || null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Error creando Refresh Intent.',
    });
  }
}
