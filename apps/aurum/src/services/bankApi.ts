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

export interface FintocRefreshIntentResponse {
  ok: boolean;
  refresh_intent_id?: string;
  status?: string;
  requires_mfa?: { widget_token: string } | null;
  error?: string;
}

export interface FintocRefreshStatusResponse {
  ok: boolean;
  status?: string;
  upstream_status?: string | null;
  requires_mfa?: { widget_token: string } | null;
  updated_at?: string | null;
  last_event_type?: string | null;
  last_event_status?: string | null;
  last_error?: string | null;
  webhook_received_at?: string | null;
  discover_status?: string | null;
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

export const createFintocRefreshIntent = async (
  linkToken: string,
): Promise<FintocRefreshIntentResponse> => {
  const headers = await getAuthHeaders();
  if (!headers) {
    return { ok: false, error: 'Debes iniciar sesión nuevamente para consultar bancos.' };
  }

  const response = await fetch('/api/fintoc/refresh-intent', {
    method: 'POST',
    headers,
    body: JSON.stringify({ link_token: linkToken }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    return { ok: false, error: payload?.error || 'No pude crear Refresh Intent.' };
  }

  return {
    ok: true,
    refresh_intent_id: String(payload?.refresh_intent_id || ''),
    status: payload?.status ? String(payload.status) : undefined,
    requires_mfa: payload?.requires_mfa || null,
  };
};

export const getFintocRefreshStatus = async (
  refreshIntentId: string,
): Promise<FintocRefreshStatusResponse> => {
  const headers = await getAuthHeaders();
  if (!headers) {
    return { ok: false, error: 'Debes iniciar sesión nuevamente para consultar bancos.' };
  }

  const response = await fetch(
    `/api/fintoc/refresh-status?refresh_intent_id=${encodeURIComponent(refreshIntentId)}`,
    {
      method: 'GET',
      headers,
    },
  );

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    return { ok: false, error: payload?.error || 'No pude consultar estado de refresh.' };
  }

  return {
    ok: true,
    status: payload?.status ? String(payload.status) : undefined,
    upstream_status: payload?.upstream_status ? String(payload.upstream_status) : null,
    requires_mfa: payload?.requires_mfa || null,
    updated_at: payload?.updated_at ? String(payload.updated_at) : null,
    last_event_type: payload?.last_event_type ? String(payload.last_event_type) : null,
    last_event_status: payload?.last_event_status ? String(payload.last_event_status) : null,
    last_error: payload?.last_error ? String(payload.last_error) : null,
    webhook_received_at: payload?.webhook_received_at ? String(payload.webhook_received_at) : null,
    discover_status: payload?.discover_status ? String(payload.discover_status) : null,
  };
};

export const discoverFintocData = async (
  linkToken: string,
  options?: { refreshIntentId?: string },
): Promise<FintocDiscoverResponse> => {
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
      ...(options?.refreshIntentId ? { refresh_intent_id: options.refreshIntentId } : {}),
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
