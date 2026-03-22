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

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const event = req.body || {};
  const type = String(event?.type || '');
  const data = event?.data || {};
  const refreshedObjectId = String(data?.refreshed_object_id || '').trim();
  const status = String(data?.status || '').trim();

  if (!refreshedObjectId || !status) {
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
    const snapshot = await db
      .collection('fintoc_refresh_intents')
      .where('accountIds', 'array-contains', refreshedObjectId)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ ok: true });
    }

    const now = new Date().toISOString();
    const updates = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const accountStatus = { ...(data.accountStatus || {}), [refreshedObjectId]: status };
      const nextStatus = resolveNextStatus(accountStatus, (data.accountIds || []).length);
      return doc.ref.update({
        accountStatus,
        status: nextStatus,
        updatedAt: now,
      });
    });

    await Promise.all(updates);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: true });
  }
}
