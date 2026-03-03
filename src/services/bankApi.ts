export interface FintocAccountNormalized {
  id: string;
  name: string;
  currency: string;
  balance: number;
}

export interface FintocSyncResponse {
  ok: boolean;
  accounts: FintocAccountNormalized[];
  totals: {
    clp: number;
    usd: number;
  };
  debug?: {
    source: string;
    count: number;
  };
  error?: string;
}

export const syncFintocAccounts = async (linkToken: string): Promise<FintocSyncResponse> => {
  const response = await fetch('/api/fintoc/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link_token: linkToken }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error || `Fintoc respondió ${response.status}. Revisa FINTOC_SECRET_KEY o link_token.`;
    return { ok: false, accounts: [], totals: { clp: 0, usd: 0 }, error: message };
  }

  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  const totals = {
    clp: Number(payload?.totals?.clp || 0),
    usd: Number(payload?.totals?.usd || 0),
  };

  return {
    ok: true,
    accounts,
    totals,
    debug: payload?.debug,
  };
};

