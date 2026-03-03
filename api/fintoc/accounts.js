const FINTOC_BASE_URL = process.env.FINTOC_BASE_URL || 'https://api.fintoc.com/v1';

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
});

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const secretKey = process.env.FINTOC_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ ok: false, error: 'Falta FINTOC_SECRET_KEY en Vercel' });
  }

  const linkToken = String(req.body?.link_token || '').trim();
  if (!linkToken) {
    return res.status(400).json({ ok: false, error: 'Debes enviar link_token' });
  }

  try {
    // Intento 1: endpoint de cuentas por link_token (más directo para MVP).
    const byQuery = await requestFintoc(`/accounts?link_token=${encodeURIComponent(linkToken)}`, secretKey);
    let accounts = parseAccountsFromPayload(byQuery.json);
    let source = 'accounts_by_query';

    // Intento 2 (fallback): obtener el link y usar sus cuentas embebidas.
    if (!accounts.length) {
      const byLink = await requestFintoc(`/links/${encodeURIComponent(linkToken)}`, secretKey);
      const fromLink = byLink.json?.accounts;
      if (Array.isArray(fromLink) && fromLink.length) {
        accounts = fromLink;
        source = 'links_retrieve_embedded_accounts';
      }
    }

    const normalized = accounts
      .map(normalizeAccount)
      .filter((a) => a.id && a.currency && Number.isFinite(a.balance));

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
      debug: { source, count: normalized.length },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `Error consultando Fintoc: ${error?.message || 'desconocido'}`,
    });
  }
}

