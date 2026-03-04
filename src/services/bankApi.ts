export interface FintocAccountNormalized {
  id: string;
  name: string;
  currency: string;
  balance: number;
  type?: string;
  number?: string;
  holder?: string;
  movementCount?: number;
  bank?: string;
  movementsSample?: Array<{
    id: string;
    description: string;
    amount: number;
    currency: string;
    date: string;
  }>;
}

export interface FintocSyncResponse {
  ok: boolean;
  summary?: {
    institution?: string;
  };
  accounts: FintocAccountNormalized[];
  totals: {
    clp: number;
    usd: number;
  };
  debug?: {
    source: string;
    count: number;
    movements?: number;
  };
  error?: string;
}

export interface FintocDiscoverEndpointResult {
  endpoint: string;
  ok: boolean;
  status: number;
  items: number;
  error?: string;
}

export interface FintocDiscoverResponse {
  ok: boolean;
  summary: {
    institution: string;
    accounts: number;
    clp: number;
    usd: number;
    movements: number;
  };
  accounts: Array<
    FintocAccountNormalized & {
      type?: string;
      number?: string;
      holder?: string;
      movementCount?: number;
    }
  >;
  probes: FintocDiscoverEndpointResult[];
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
    summary: payload?.summary,
    accounts,
    totals,
    debug: payload?.debug,
  };
};

export const discoverFintocData = async (linkToken: string): Promise<FintocDiscoverResponse> => {
  const response = await fetch('/api/fintoc/discover', {
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
    return {
      ok: false,
      summary: { institution: 'N/D', accounts: 0, clp: 0, usd: 0, movements: 0 },
      accounts: [],
      probes: [],
      error: message,
    };
  }

  return {
    ok: Boolean(payload?.ok),
    summary: {
      institution: String(payload?.summary?.institution || 'N/D'),
      accounts: Number(payload?.summary?.accounts || 0),
      clp: Number(payload?.summary?.clp || 0),
      usd: Number(payload?.summary?.usd || 0),
      movements: Number(payload?.summary?.movements || 0),
    },
    accounts: Array.isArray(payload?.accounts) ? payload.accounts : [],
    probes: Array.isArray(payload?.probes) ? payload.probes : [],
    error: payload?.error ? String(payload.error) : undefined,
  };
};
