import { auth } from './firebase';

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

const getAuthHeaders = async (): Promise<Record<string, string> | null> => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const idToken = await currentUser.getIdToken();
    if (!idToken) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
  } catch {
    return null;
  }
};

export const discoverFintocData = async (linkToken: string): Promise<FintocDiscoverResponse> => {
  const headers = await getAuthHeaders();
  if (!headers) {
    return {
      ok: false,
      summary: { institution: 'N/D', accounts: 0, clp: 0, usd: 0, movements: 0 },
      accounts: [],
      probes: [],
      error: 'Debes iniciar sesión nuevamente para consultar bancos.',
    };
  }

  const debugFintoc =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug-fintoc');

  const response = await fetch('/api/fintoc/discover', {
    method: 'POST',
    headers: {
      ...headers,
      ...(debugFintoc ? { 'x-debug-fintoc': 'true' } : {}),
    },
    body: JSON.stringify({
      link_token: linkToken,
      ...(debugFintoc ? { debug: true } : {}),
    }),
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
