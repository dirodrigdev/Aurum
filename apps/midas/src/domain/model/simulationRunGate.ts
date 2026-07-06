export type SimulationRunBlockedReason =
  | 'effective_input_missing'
  | 'auth_loading'
  | 'auth_not_canonical'
  | 'config_loading'
  | 'config_missing'
  | 'config_error'
  | 'aurum_snapshot_missing'
  | 'aurum_snapshot_error'
  | 'instrument_universe_loading'
  | 'instrument_universe_timeout'
  | 'instrument_universe_error'
  | 'instrument_universe_missing'
  | 'cloud_hydration_incomplete';

export type EvaluateSimulationRunGateInput = {
  authResolved: boolean;
  isCanonicalUserSession: boolean;
  hasEffectiveInput: boolean;
  cloudHydrationReady: boolean;
  simulationConfigHydrationStatus: 'loading' | 'cloud' | 'missing' | 'error';
  aurumIntegrationStatus: 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
  aurumSnapshotAvailable: boolean;
  cloudUniverseReadStatus: 'loading' | 'loaded' | 'missing' | 'timeout' | 'error';
  universeSourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
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

export type CanonicalInputReadinessResult =
  | { ready: true }
  | { ready: false; blockedReason: SimulationRunBlockedReason };

export function evaluateCanonicalInputReadiness(
  input: Pick<
    EvaluateSimulationRunGateInput,
    | 'authResolved'
    | 'isCanonicalUserSession'
    | 'hasEffectiveInput'
    | 'cloudHydrationReady'
    | 'simulationConfigHydrationStatus'
    | 'aurumIntegrationStatus'
    | 'aurumSnapshotAvailable'
    | 'cloudUniverseReadStatus'
    | 'universeSourceOrigin'
    | 'effectiveEngineInputHash'
  >,
): CanonicalInputReadinessResult {
  if (!input.authResolved) return { ready: false, blockedReason: 'auth_loading' };
  if (!input.isCanonicalUserSession) return { ready: false, blockedReason: 'auth_not_canonical' };
  if (input.simulationConfigHydrationStatus === 'loading') return { ready: false, blockedReason: 'config_loading' };
  if (input.simulationConfigHydrationStatus === 'missing') return { ready: false, blockedReason: 'config_missing' };
  if (input.simulationConfigHydrationStatus === 'error') return { ready: false, blockedReason: 'config_error' };
  if (input.cloudUniverseReadStatus === 'loading') {
    return { ready: false, blockedReason: 'instrument_universe_loading' };
  }
  if (input.cloudUniverseReadStatus === 'timeout' && input.universeSourceOrigin !== 'bundled') {
    return { ready: false, blockedReason: 'instrument_universe_timeout' };
  }
  if (input.cloudUniverseReadStatus === 'error' && input.universeSourceOrigin !== 'bundled') {
    return { ready: false, blockedReason: 'instrument_universe_error' };
  }
  if (
    (input.universeSourceOrigin !== 'firestore' && input.universeSourceOrigin !== 'bundled')
    || (input.cloudUniverseReadStatus === 'missing' && input.universeSourceOrigin !== 'bundled')
  ) {
    return { ready: false, blockedReason: 'instrument_universe_missing' };
  }
  if (!input.aurumSnapshotAvailable) {
    if (
      input.aurumIntegrationStatus === 'loading'
      || input.aurumIntegrationStatus === 'refreshing'
      || input.aurumIntegrationStatus === 'missing'
    ) {
      return { ready: false, blockedReason: 'aurum_snapshot_missing' };
    }
    if (input.aurumIntegrationStatus === 'error') {
      return { ready: false, blockedReason: 'aurum_snapshot_error' };
    }
  }
  if (!input.hasEffectiveInput || !input.effectiveEngineInputHash) {
    return { ready: false, blockedReason: 'effective_input_missing' };
  }
  if (!input.cloudHydrationReady) return { ready: false, blockedReason: 'cloud_hydration_incomplete' };
  return { ready: true };
}

export function evaluateSimulationRunGate(input: EvaluateSimulationRunGateInput): EvaluateSimulationRunGateResult {
  const readiness = evaluateCanonicalInputReadiness(input);
  if (!readiness.ready) {
    return { status: 'blocked', blockedReason: readiness.blockedReason };
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
