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

const normalizeCurrency = (value) => String(value || '').trim().toUpperCase();

const normalizeAccount = (account) => ({
  id: String(account?.id || ''),
  name: String(account?.name || account?.official_name || account?.holder_name || 'Cuenta'),
  currency: normalizeCurrency(account?.currency || account?.balance?.currency),
  balance: readBalance(account),
  type: String(account?.type || account?.subtype || ''),
  number: String(account?.number || account?.masked_number || ''),
  holder: String(account?.holder_name || account?.holder || ''),
});

const maybeRescaleFxBalance = (account, movements) => {
  if (!account || (account.currency !== 'USD' && account.currency !== 'EUR')) return account;
  const absBalance = Math.abs(asNumber(account.balance));
  if (!absBalance) return account;
  // En varios bancos Fintoc entrega moneda dura en centavos (181890 -> 1,818.90).
  const looksLikeCents = Number.isInteger(account.balance) && absBalance >= 100000;
  if (!looksLikeCents) return account;

  return {
    ...account,
    balance: account.balance / 100,
    scaleFix: 'cents_to_units',
  };
};

const requestFintoc = async (path, secretKey) => {
  const response = await fetch(`${FINTOC_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: secretKey,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    rawText: text,
  };
};

const parseAccountsFromPayload = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.accounts)) return payload.accounts;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
};

const parseMovementsFromPayload = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.movements)) return payload.movements;
  return [];
};

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  if (!(await requireFirebaseAuth(req, res))) return;

  const secretKey = process.env.FINTOC_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ ok: false, error: 'Falta FINTOC_SECRET_KEY en Vercel' });
  }

  const linkToken = String(req.body?.link_token || '').trim();
  if (!linkToken) {
    return res.status(400).json({ ok: false, error: 'Debes enviar link_token' });
  }

  try {
    const byLink = await requestFintoc(`/links/${encodeURIComponent(linkToken)}`, secretKey);
    const institution =
      String(byLink.json?.institution?.name || byLink.json?.institution || byLink.json?.holder_name || '').trim() || 'Banco';

    // Intento 1: endpoint de cuentas por link_token (más directo para MVP).
    const byQuery = await requestFintoc(`/accounts?link_token=${encodeURIComponent(linkToken)}`, secretKey);
    let accounts = parseAccountsFromPayload(byQuery.json);
    let source = 'accounts_by_query';

    // Intento 2 (fallback): obtener el link y usar sus cuentas embebidas.
    if (!accounts.length) {
      const fromLink = byLink.json?.accounts;
      if (Array.isArray(fromLink) && fromLink.length) {
        accounts = fromLink;
        source = 'links_retrieve_embedded_accounts';
      }
    }

    const normalized = accounts
      .map(normalizeAccount)
      .filter((a) => a.id && a.currency && Number.isFinite(a.balance));

    // Enriquecer con movimientos por cuenta para identificar qué tan útil es cada conexión.
    let movementsTotal = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      const account = normalized[index];
      const movementResponse = await requestFintoc(
        `/accounts/${encodeURIComponent(account.id)}/movements?link_token=${encodeURIComponent(linkToken)}`,
        secretKey,
      );
      const movements = movementResponse.ok ? parseMovementsFromPayload(movementResponse.json) : [];
      // Mantener una muestra amplia para poder mostrar scroll completo en UI.
      const sample = movements.slice(0, 200).map((m) => ({
        id: String(m?.id || ''),
        description: String(m?.description || m?.memo || m?.name || ''),
        amount: asNumber(m?.amount || m?.amount_in_account_currency || m?.transaction_amount),
        currency: normalizeCurrency(m?.currency || m?.amount_currency || account.currency),
        date: String(m?.post_date || m?.date || m?.transaction_date || ''),
      }));
      const normalizedAccount = maybeRescaleFxBalance(account, sample);
      const normalizedSample = sample.map((movement) => {
        if ((normalizedAccount.currency === 'USD' || normalizedAccount.currency === 'EUR') && Math.abs(movement.amount) >= 100000) {
          return { ...movement, amount: movement.amount / 100 };
        }
        return movement;
      });
      normalizedAccount.movementCount = movements.length;
      normalizedAccount.movementsSample = normalizedSample;
      normalized[index] = normalizedAccount;
      movementsTotal += movements.length;
    }

    const totals = normalized.reduce(
      (acc, account) => {
        if (account.currency === 'CLP') acc.clp += account.balance;
        if (account.currency === 'USD') acc.usd += account.balance;
        return acc;
      },
      { clp: 0, usd: 0 },
    );

    return res.status(200).json({
      ok: true,
      accounts: normalized,
      totals,
      summary: {
        institution,
      },
      debug: { source, count: normalized.length, movements: movementsTotal },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Error consultando Fintoc.',
    });
  }
}
