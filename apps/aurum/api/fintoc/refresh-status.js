import { requireFirebaseAuth } from '../_firebaseAuth.js';
import { getAdminDb } from '../_firestoreAdmin.js';

const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const auth = await requireFirebaseAuth(req, res);
  if (!auth) return;

  const refreshIntentId = String(req.query?.refresh_intent_id || '').trim();
  if (!refreshIntentId) {
    return res.status(400).json({ ok: false, error: 'Falta refresh_intent_id' });
  }

  try {
    const db = getAdminDb();
    const doc = await db.collection('fintoc_refresh_intents').doc(refreshIntentId).get();
    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: 'Refresh Intent no encontrado' });
    }
    const data = doc.data() || {};
    if (String(data.uid || '') !== String(auth.uid || '')) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    return res.status(200).json({
      ok: true,
      status: String(data.status || 'pending'),
      upstream_status: data.upstreamStatus ? String(data.upstreamStatus) : null,
      requires_mfa: data.requiresMfa || null,
      updated_at: data.updatedAt || null,
      last_event_type: data.lastEventType ? String(data.lastEventType) : null,
      last_event_status: data.lastEventStatus ? String(data.lastEventStatus) : null,
      last_error: data.lastError ? String(data.lastError) : null,
      webhook_received_at: data.webhookReceivedAt || null,
      discover_status: data.discoverStatus ? String(data.discoverStatus) : null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Error consultando Refresh Intent.',
    });
  }
}
