import type { SimulationConfigHydrationStatus } from '../../integrations/midas/simulationConfigCanonical';
import type { AurumIntegrationAuthStatus } from '../../integrations/aurum/firebase';

export type LocalReadOnlyCloudFallbackInput = {
  aurumIntegrationConfigured: boolean;
  authStatus: AurumIntegrationAuthStatus;
  isCanonicalUserSession: boolean;
  simulationConfigHydrationStatus: SimulationConfigHydrationStatus;
  hostname?: string | null;
  isDev?: boolean;
};

export function isLocalQaHostname(hostname?: string | null): boolean {
  const value = hostname?.trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0' || value === '::1';
}

export function shouldEnableLocalReadOnlyCloudFallback(
  input: LocalReadOnlyCloudFallbackInput,
): boolean {
  if (!input.aurumIntegrationConfigured) return false;
  if (!input.isCanonicalUserSession) return false;
  if (input.authStatus !== 'authenticatedGoogle') return false;
  if (input.simulationConfigHydrationStatus !== 'error' && input.simulationConfigHydrationStatus !== 'missing') {
    return false;
  }
  return Boolean(input.isDev || isLocalQaHostname(input.hostname));
}
