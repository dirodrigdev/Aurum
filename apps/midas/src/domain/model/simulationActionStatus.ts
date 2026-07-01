export type SimulationInputSyncState = {
  visibleInputFingerprint: string | null;
  lastEvaluatedInputFingerprint: string | null;
  resultFingerprint: string | null;
  status: 'current' | 'stale' | 'missing_result';
  isResultCurrent: boolean;
};

export type SimulationActionStatus = {
  ready: boolean;
  label: 'OK' | 'Revisar';
};

export function buildSimulationInputSyncState(input: {
  visibleInputFingerprint: string | null;
  lastEvaluatedInputFingerprint?: string | null;
  resultFingerprint?: string | null;
}): SimulationInputSyncState {
  const visibleInputFingerprint = input.visibleInputFingerprint ?? null;
  const resultFingerprint = input.resultFingerprint ?? input.lastEvaluatedInputFingerprint ?? null;
  const lastEvaluatedInputFingerprint = input.lastEvaluatedInputFingerprint ?? resultFingerprint;
  const isResultCurrent = Boolean(
    visibleInputFingerprint
      && resultFingerprint
      && visibleInputFingerprint === resultFingerprint,
  );

  return {
    visibleInputFingerprint,
    lastEvaluatedInputFingerprint,
    resultFingerprint,
    status: !resultFingerprint
      ? 'missing_result'
      : isResultCurrent
        ? 'current'
        : 'stale',
    isResultCurrent,
  };
}

export function buildSimulationActionStatus(input: {
  authResolved: boolean;
  isCanonicalUserSession: boolean;
  authErrorMessage: string | null;
  cloudHydrationReady: boolean;
  simulationConfigSource: 'cloud' | 'local_cache' | 'fallback';
  universeSourceOrigin: 'firestore' | 'bundled' | 'cache-local' | 'none';
  aurumIntegrationStatus: string;
  hasValidSpendingPhases: boolean;
  hasValidCapital: boolean;
  hasValidUniverseMix: boolean;
  fingerprint: { effectiveEngineInputHash?: string | null } | null;
}): SimulationActionStatus {
  const ready = Boolean(
    input.authResolved
      && input.isCanonicalUserSession
      && !input.authErrorMessage
      && input.cloudHydrationReady
      && input.hasValidSpendingPhases
      && input.hasValidCapital
      && input.hasValidUniverseMix
      && input.fingerprint?.effectiveEngineInputHash,
  );
  return {
    ready,
    label: ready ? 'OK' : 'Revisar',
  };
}
