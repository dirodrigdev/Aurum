import type { M8InputFingerprint } from '../model/m8InputFingerprint';
import type { SimulationRunBlockedReason } from '../model/simulationRunGate';

export type OptimizerCanonicalGateInput = {
  canonicalInputReady: boolean;
  canonicalInputBlockedReason: SimulationRunBlockedReason | null;
  m8InputFingerprint: M8InputFingerprint | null;
};

export type OptimizerCanonicalGateResult =
  | {
      ready: true;
      effectiveEngineInputFingerprint: string;
      replayTraceState: 'ready';
    }
  | {
      ready: false;
      reason:
        | 'canonical_input_blocked'
        | 'fingerprint_missing'
        | 'replay_trace_missing'
        | 'replay_trace_blocked'
        | 'non_comparable_warning';
      message: string;
      pendingSource: string | null;
    };

const NON_COMPARABLE_WARNING_PATTERNS = [
  /no comparable/i,
  /contaminando el input can[oó]nico/i,
  /hydrataci[oó]n cloud incompleta/i,
  /no vienen desde cloud/i,
  /cache local/i,
  /sin firma cloud/i,
];

function hasNonComparableWarning(warnings: string[]): string | null {
  return warnings.find((warning) => NON_COMPARABLE_WARNING_PATTERNS.some((pattern) => pattern.test(warning))) ?? null;
}

export function evaluateOptimizerCanonicalGate(input: OptimizerCanonicalGateInput): OptimizerCanonicalGateResult {
  if (!input.canonicalInputReady) {
    return {
      ready: false,
      reason: 'canonical_input_blocked',
      message: `Optimización bloqueada: input canónico no listo (${input.canonicalInputBlockedReason ?? 'sin detalle'}).`,
      pendingSource: input.canonicalInputBlockedReason,
    };
  }

  const fingerprint = input.m8InputFingerprint;
  if (!fingerprint?.effectiveEngineInputHash) {
    return {
      ready: false,
      reason: 'fingerprint_missing',
      message: 'Optimización bloqueada: falta fingerprint M8 efectivo.',
      pendingSource: 'fingerprint M8',
    };
  }

  const replayTrace = fingerprint.diagnosticInput.replayTrace;
  if (!replayTrace) {
    return {
      ready: false,
      reason: 'replay_trace_missing',
      message: 'Optimización bloqueada: falta replay trace del input M8 aplicado.',
      pendingSource: 'replay trace M8',
    };
  }

  if (replayTrace.readiness.state !== 'ready' || replayTrace.readiness.canonicalInputReady !== true) {
    return {
      ready: false,
      reason: 'replay_trace_blocked',
      message: `Optimización bloqueada: replay trace no está listo (${replayTrace.readiness.blockedReason ?? 'sin detalle'}).`,
      pendingSource: replayTrace.readiness.pendingSource,
    };
  }

  const nonComparableWarning = hasNonComparableWarning(fingerprint.warnings);
  if (nonComparableWarning) {
    return {
      ready: false,
      reason: 'non_comparable_warning',
      message: `Optimización bloqueada: ${nonComparableWarning}`,
      pendingSource: 'warning de comparabilidad',
    };
  }

  return {
    ready: true,
    effectiveEngineInputFingerprint: fingerprint.effectiveEngineInputHash,
    replayTraceState: 'ready',
  };
}
