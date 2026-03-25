import { getAdminDb } from '../_firestoreAdmin.js';

const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const resolveNextStatus = (accountStatus, totalAccounts) => {
  const statuses = Object.values(accountStatus || {});
  if (statuses.includes('rejected')) return 'rejected';
  if (statuses.includes('failed')) return 'failed';
  if (totalAccounts > 0 && statuses.length >= totalAccounts && statuses.every((s) => s === 'succeeded')) {
    return 'succeeded';
  }
  return 'pending';
};

const isTerminalStatus = (value) => value === 'succeeded' || value === 'failed' || value === 'rejected';

const normalizeWebhookStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'succeeded') return 'succeeded';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'rejected') return 'rejected';
  return 'pending';
};

const parseIsoMs = (value) => {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
};

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const event = req.body || {};
  const type = String(event?.type || '');
  const data = event?.data || {};
  const rawStatus = String(data?.status || '').trim();
  const refreshIntentId = String(
    data?.id ||
      data?.refresh_intent_id ||
      data?.refresh_intent?.id ||
      event?.refresh_intent_id ||
      '',
  ).trim();
  const refreshedObjectId = String(data?.refreshed_object_id || '').trim();
  const status = normalizeWebhookStatus(rawStatus);

  if ((!refreshIntentId && !refreshedObjectId) || !rawStatus) {
    return res.status(200).json({ ok: true });
  }

  if (
    type !== 'account.refresh_intent.succeeded' &&
    type !== 'account.refresh_intent.failed' &&
    type !== 'account.refresh_intent.rejected'
  ) {
    return res.status(200).json({ ok: true });
  }

  try {
    const db = getAdminDb();
    const candidateDocs = new Map();

    if (refreshIntentId) {
      const exactDoc = await db.collection('fintoc_refresh_intents').doc(refreshIntentId).get();
      if (exactDoc.exists) {
        candidateDocs.set(exactDoc.id, {
          doc: exactDoc,
          correlationMethod: 'refresh_intent_id',
          correlationValue: refreshIntentId,
        });
      }
    }

    if (!candidateDocs.size && refreshedObjectId) {
      const snapshot = await db
        .collection('fintoc_refresh_intents')
        .where('accountIds', 'array-contains', refreshedObjectId)
        .get();

      const nowMs = Date.now();
      snapshot.docs.forEach((doc) => {
        const payload = doc.data() || {};
        const createdAtMs = parseIsoMs(payload.createdAt);
        const recentlyCreated = Number.isFinite(createdAtMs) && nowMs - createdAtMs <= 30 * 60 * 1000;
        const stillOpen = !isTerminalStatus(String(payload.status || '').trim().toLowerCase());
        if (!stillOpen && !recentlyCreated) return;
        candidateDocs.set(doc.id, {
          doc,
          correlationMethod: 'account_id',
          correlationValue: refreshedObjectId,
        });
      });
    }

    if (!candidateDocs.size) {
      return res.status(200).json({ ok: true });
    }

    const now = new Date().toISOString();
    const updates = [...candidateDocs.values()].map(({ doc, correlationMethod, correlationValue }) => {
      const payload = doc.data() || {};
      const accountStatus = refreshedObjectId
        ? { ...(payload.accountStatus || {}), [refreshedObjectId]: status }
        : { ...(payload.accountStatus || {}) };
      const totalAccounts = Array.isArray(payload.accountIds) ? payload.accountIds.length : 0;
      const nextStatus =
        refreshedObjectId && totalAccounts > 0
          ? resolveNextStatus(accountStatus, totalAccounts)
          : status;
      return doc.ref.update({
        accountStatus,
        status: nextStatus,
        upstreamStatus: status,
        updatedAt: now,
        lastEventType: type,
        lastEventAt: now,
        lastEventStatus: status,
        lastCorrelationMethod: correlationMethod,
        lastCorrelationValue: correlationValue,
        webhookReceivedAt: now,
        webhookEventCount: Number(payload.webhookEventCount || 0) + 1,
        lastError: nextStatus === 'failed' || nextStatus === 'rejected' ? `Webhook ${nextStatus}` : null,
      });
    });

    await Promise.all(updates);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: true });
  }
}
