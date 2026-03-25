import crypto from 'node:crypto';
import { getAdminDb } from '../_firestoreAdmin.js';
import { requireFirebaseAuth } from '../_firebaseAuth.js';

const FINTOC_BASE_URL = process.env.FINTOC_BASE_URL || 'https://api.fintoc.com/v1';
const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeCurrency = (value) => String(value || '').trim().toUpperCase();
const hashLinkToken = (linkToken) =>
  crypto.createHash('sha256').update(String(linkToken || '')).digest('hex');

const readBalance = (account) => {
  if (!account || typeof account !== 'object') return 0;
  const b = account.balance;
  if (typeof b === 'number') return asNumber(b);
  if (b && typeof b === 'object') {
    return (
      asNumber(b.available) ||
      asNumber(b.current) ||
      asNumber(b.balance) ||
      asNumber(b.amount) ||
      0
    );
  }
  return (
    asNumber(account.available_balance) ||
    asNumber(account.current_balance) ||
    asNumber(account.amount) ||
    0
  );
};

const maybeRescaleFxBalance = (currency, balance) => {
  const normalized = String(currency || '').toUpperCase();
  const n = asNumber(balance);
  if ((normalized === 'USD' || normalized === 'EUR') && Number.isInteger(n) && Math.abs(n) >= 100000) {
    return n / 100;
  }
  return n;
};

const parseArrayPayload = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.accounts)) return payload.accounts;
  if (Array.isArray(payload.movements)) return payload.movements;
  return [];
};

const requestFintoc = async (path, secretKey) => {
  const response = await fetch(`${FINTOC_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: secretKey,
      Accept: 'application/json',
    },
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  return {
    endpoint: path,
    ok: response.ok,
    status: response.status,
    json,
    rawText,
  };
};

const probeEndpoint = async (path, secretKey) => {
  const response = await requestFintoc(path, secretKey);
  const items = parseArrayPayload(response.json).length;
  const error = response.ok ? undefined : String(response.json?.message || response.rawText || 'error');

  return {
    endpoint: path,
    ok: response.ok,
    status: response.status,
    items,
    response,
    error,
  };
};

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
    return res.status(500).json({ ok: false, error: 'Falta FINTOC_SECRET_KEY en Vercel' });
  }

  const debugEnabled =
    String(req.headers['x-debug-fintoc'] || '').toLowerCase() === 'true' ||
    req.body?.debug === true;

  const linkToken = String(req.body?.link_token || '').trim();
  const refreshIntentId = String(req.body?.refresh_intent_id || '').trim();
  if (!linkToken) {
    return res.status(400).json({ ok: false, error: 'Debes enviar link_token' });
  }

  try {
    let refreshDocRef = null;
    if (refreshIntentId) {
      const db = getAdminDb();
      refreshDocRef = db.collection('fintoc_refresh_intents').doc(refreshIntentId);
      const refreshDoc = await refreshDocRef.get();
      if (!refreshDoc.exists) {
        return res.status(404).json({ ok: false, error: 'Refresh Intent no encontrado para discover.' });
      }
      const refreshData = refreshDoc.data() || {};
      if (String(refreshData.uid || '') !== String(auth.uid || '')) {
        return res.status(403).json({ ok: false, error: 'No autorizado para este Refresh Intent.' });
      }
      if (String(refreshData.linkTokenHash || '') !== hashLinkToken(linkToken)) {
        return res.status(409).json({ ok: false, error: 'El link_token no coincide con el Refresh Intent.' });
      }
      if (String(refreshData.status || '').toLowerCase() !== 'succeeded') {
        await refreshDocRef.update({
          discoverStatus: 'blocked',
          updatedAt: new Date().toISOString(),
          lastEventType: 'discover.blocked',
          lastEventAt: new Date().toISOString(),
          lastError: 'Discover intentó correr antes de que el refresh quedara succeeded.',
        });
        return res.status(409).json({ ok: false, error: 'El refresh todavía no está confirmado.' });
      }
      await refreshDocRef.update({
        discoverStatus: 'running',
        discoverStartedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastEventType: 'discover.started',
        lastEventAt: new Date().toISOString(),
        lastError: null,
      });
    }

    const probes = [];

    const linkProbe = await probeEndpoint(`/links/${encodeURIComponent(linkToken)}`, secretKey);
    probes.push({
      endpoint: linkProbe.endpoint,
      ok: linkProbe.ok,
      status: linkProbe.status,
      items: linkProbe.items,
      error: linkProbe.error,
    });

    const accountsProbe = await probeEndpoint(`/accounts?link_token=${encodeURIComponent(linkToken)}`, secretKey);
    probes.push({
      endpoint: accountsProbe.endpoint,
      ok: accountsProbe.ok,
      status: accountsProbe.status,
      items: accountsProbe.items,
      error: accountsProbe.error,
    });

    let accounts = parseArrayPayload(accountsProbe.response.json);
    if (!accounts.length && Array.isArray(linkProbe.response.json?.accounts)) {
      accounts = linkProbe.response.json.accounts;
    }

    const normalizedAccounts = [];
    let movementTotal = 0;

    for (const account of accounts) {
      const accountId = String(account?.id || '');
      if (!accountId) continue;

      const movementsProbe = await probeEndpoint(
        `/accounts/${encodeURIComponent(accountId)}/movements?link_token=${encodeURIComponent(linkToken)}`,
        secretKey,
      );
      probes.push({
        endpoint: movementsProbe.endpoint,
        ok: movementsProbe.ok,
        status: movementsProbe.status,
        items: movementsProbe.items,
        error: movementsProbe.error,
      });

      const movementCount = movementsProbe.items || 0;
      movementTotal += movementCount;
      const movementRows = parseArrayPayload(movementsProbe.response.json);
      // Mantener una muestra amplia para poder mostrar scroll completo en UI.
      const movementsSample = movementRows.slice(0, 200).map((m) => ({
        id: String(m?.id || ''),
        description: String(m?.description || m?.memo || m?.name || ''),
        amount: asNumber(m?.amount || m?.amount_in_account_currency || m?.transaction_amount),
        currency: normalizeCurrency(
          m?.currency || m?.amount_currency || account?.currency || account?.balance?.currency,
        ),
        date: String(m?.post_date || m?.date || m?.transaction_date || ''),
      }));
      const accountCurrency = normalizeCurrency(account?.currency || account?.balance?.currency);
      const normalizedSample = movementsSample.map((movement) => {
        if ((accountCurrency === 'USD' || accountCurrency === 'EUR') && Math.abs(movement.amount) >= 100000) {
          return { ...movement, amount: movement.amount / 100 };
        }
        return movement;
      });

      normalizedAccounts.push({
        id: accountId,
        name: String(account?.name || account?.official_name || account?.holder_name || 'Cuenta'),
        currency: accountCurrency,
        balance: maybeRescaleFxBalance(
          accountCurrency,
          readBalance(account),
        ),
        type: String(account?.type || account?.subtype || ''),
        number: String(account?.number || account?.masked_number || ''),
        holder: String(account?.holder_name || account?.holder || ''),
        movementCount,
        movementsSample: normalizedSample,
      });
    }

    const totals = normalizedAccounts.reduce(
      (acc, account) => {
        if (account.currency === 'CLP') acc.clp += account.balance;
        if (account.currency === 'USD') acc.usd += account.balance;
        return acc;
      },
      { clp: 0, usd: 0 },
    );

    const responsePayload = {
      ok: true,
      summary: {
        institution: String(linkProbe.response.json?.institution?.name || linkProbe.response.json?.institution || 'N/D'),
        accounts: normalizedAccounts.length,
        clp: totals.clp,
        usd: totals.usd,
        movements: movementTotal,
      },
      accounts: normalizedAccounts,
      probes,
    };

    if (debugEnabled) {
      responsePayload.debug = {
        link: {
          updatedAt: linkProbe.response.json?.updated_at || linkProbe.response.json?.last_updated || null,
          status: linkProbe.status,
          ok: linkProbe.ok,
        },
        accounts: {
          count: normalizedAccounts.length,
          totals: totals,
          status: accountsProbe.status,
          ok: accountsProbe.ok,
        },
      };
    }

    if (refreshDocRef) {
      await refreshDocRef.update({
        discoverStatus: 'completed',
        discoverCompletedAt: new Date().toISOString(),
        discoverSummary: {
          institution: responsePayload.summary.institution,
          accounts: responsePayload.summary.accounts,
          clp: responsePayload.summary.clp,
          usd: responsePayload.summary.usd,
          movements: responsePayload.summary.movements,
        },
        updatedAt: new Date().toISOString(),
        lastEventType: 'discover.completed',
        lastEventAt: new Date().toISOString(),
        lastEventStatus: 'completed',
        lastError: null,
      });
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    if (refreshIntentId) {
      try {
        await getAdminDb().collection('fintoc_refresh_intents').doc(refreshIntentId).update({
          discoverStatus: 'failed',
          discoverCompletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastEventType: 'discover.failed',
          lastEventAt: new Date().toISOString(),
          lastEventStatus: 'failed',
          lastError: error?.message || 'Error explorando Fintoc.',
        });
      } catch {
        // ignore secondary trace errors
      }
    }
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Error explorando Fintoc.',
    });
  }
}
