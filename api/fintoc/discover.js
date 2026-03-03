const FINTOC_BASE_URL = process.env.FINTOC_BASE_URL || 'https://api.fintoc.com/v1';

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeCurrency = (value) => String(value || '').trim().toUpperCase();

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

const parseArrayPayload = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.accounts)) return payload.accounts;
  if (Array.isArray(payload.movements)) return payload.movements;
  if (Array.isArray(payload.transactions)) return payload.transactions;
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

      const movementsProbe = await probeEndpoint(`/accounts/${encodeURIComponent(accountId)}/movements`, secretKey);
      probes.push({
        endpoint: movementsProbe.endpoint,
        ok: movementsProbe.ok,
        status: movementsProbe.status,
        items: movementsProbe.items,
        error: movementsProbe.error,
      });

      const altTransactionsProbe = await probeEndpoint(
        `/accounts/${encodeURIComponent(accountId)}/transactions`,
        secretKey,
      );
      probes.push({
        endpoint: altTransactionsProbe.endpoint,
        ok: altTransactionsProbe.ok,
        status: altTransactionsProbe.status,
        items: altTransactionsProbe.items,
        error: altTransactionsProbe.error,
      });

      const movementCount = movementsProbe.items || altTransactionsProbe.items || 0;
      movementTotal += movementCount;

      normalizedAccounts.push({
        id: accountId,
        name: String(account?.name || account?.official_name || account?.holder_name || 'Cuenta'),
        currency: normalizeCurrency(account?.currency || account?.balance?.currency),
        balance: readBalance(account),
        type: String(account?.type || account?.subtype || ''),
        number: String(account?.number || account?.masked_number || ''),
        holder: String(account?.holder_name || account?.holder || ''),
        movementCount,
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

    return res.status(200).json({
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
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: `Error explorando Fintoc: ${error?.message || 'desconocido'}`,
    });
  }
}

