import type { ModelParameters } from '../../domain/model/types';

export type SimulationConfigHydrationStatus = 'loading' | 'cloud' | 'missing' | 'error';

export type PersistSimulationConfigDecisionInput = {
  hydrationStatus: SimulationConfigHydrationStatus;
  nextHash: string;
  cloudHash: string | null;
};

export type SeedUserScopedSimulationConfigInput = {
  readStatus: 'loading' | 'loaded' | 'missing' | 'error';
  isCanonicalUserSession: boolean;
  hasLocalCandidate: boolean;
  cloudExists: boolean | null;
};

export function stableSerializeSimulationConfig(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerializeSimulationConfig(entry)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerializeSimulationConfig(entryValue)}`)
    .join(',')}}`;
}

export function hashSimulationConfigString(value: string): string {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildSimulationConfigHash(params: ModelParameters): string {
  return hashSimulationConfigString(stableSerializeSimulationConfig(params));
}

export function shouldPersistActiveSimulationConfig(input: PersistSimulationConfigDecisionInput): boolean {
  if (input.hydrationStatus === 'loading' || input.hydrationStatus === 'error') return false;
  if (input.hydrationStatus === 'cloud') return input.nextHash !== input.cloudHash;
  return false;
}

export function getUserScopedSimulationConfigPath(uid: string): string {
  return `users/${uid}/midas_config/simulationActiveV1`;
}

export function shouldSeedUserScopedSimulationConfig(input: SeedUserScopedSimulationConfigInput): boolean {
  return input.isCanonicalUserSession && input.readStatus === 'missing' && input.cloudExists === false && input.hasLocalCandidate;
}
