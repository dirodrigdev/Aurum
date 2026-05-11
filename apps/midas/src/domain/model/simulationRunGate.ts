export type SimulationRunBlockedReason =
  | 'effective_input_missing'
  | 'auth_not_canonical'
  | 'config_loading'
  | 'config_missing'
  | 'config_error'
  | 'aurum_loading'
  | 'aurum_refreshing'
  | 'instrument_universe_missing'
  | 'cloud_hydration_incomplete';

export type EvaluateSimulationRunGateInput = {
  isCanonicalUserSession: boolean;
  hasEffectiveInput: boolean;
  cloudHydrationReady: boolean;
  simulationConfigHydrationStatus: 'loading' | 'cloud' | 'missing' | 'error';
  aurumIntegrationStatus: 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
  universeSourceOrigin: 'firestore' | 'cache-local' | 'none';
  simWorking: boolean;
  recalcWorkerStatus: 'idle' | 'queued' | 'running' | 'done' | 'error';
  simResultAvailable: boolean;
  effectiveEngineInputHash: string | null;
  lastRenderedResultHash: string | null;
  lastRequestedRunHash: string | null;
};

export type EvaluateSimulationRunGateResult =
  | { status: 'blocked'; blockedReason: SimulationRunBlockedReason }
  | { status: 'running' }
  | { status: 'completed' }
  | { status: 'should_run' };

export function evaluateSimulationRunGate(input: EvaluateSimulationRunGateInput): EvaluateSimulationRunGateResult {
  if (!input.hasEffectiveInput || !input.effectiveEngineInputHash) {
    return { status: 'blocked', blockedReason: 'effective_input_missing' };
  }
  if (!input.cloudHydrationReady) {
    if (!input.isCanonicalUserSession) return { status: 'blocked', blockedReason: 'auth_not_canonical' };
    if (input.simulationConfigHydrationStatus === 'loading') return { status: 'blocked', blockedReason: 'config_loading' };
    if (input.simulationConfigHydrationStatus === 'missing') return { status: 'blocked', blockedReason: 'config_missing' };
    if (input.simulationConfigHydrationStatus === 'error') return { status: 'blocked', blockedReason: 'config_error' };
    if (input.aurumIntegrationStatus === 'loading') return { status: 'blocked', blockedReason: 'aurum_loading' };
    if (input.aurumIntegrationStatus === 'refreshing') return { status: 'blocked', blockedReason: 'aurum_refreshing' };
    if (input.universeSourceOrigin === 'none') return { status: 'blocked', blockedReason: 'instrument_universe_missing' };
    return { status: 'blocked', blockedReason: 'cloud_hydration_incomplete' };
  }
  if (input.simWorking || input.recalcWorkerStatus === 'queued' || input.recalcWorkerStatus === 'running') {
    return { status: 'running' };
  }
  if (input.simResultAvailable && input.lastRenderedResultHash === input.effectiveEngineInputHash) {
    return { status: 'completed' };
  }
  if (input.simResultAvailable && input.lastRequestedRunHash === input.effectiveEngineInputHash) {
    return { status: 'completed' };
  }
  return { status: 'should_run' };
}
