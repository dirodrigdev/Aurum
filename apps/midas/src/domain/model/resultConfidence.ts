export type SourceStatus =
  | 'canonical'
  | 'fallback'
  | 'local'
  | 'sandbox'
  | 'provisional'
  | 'missing'
  | 'error';

export type ResultConfidenceStatus = 'canonical' | 'review' | 'not_decisional';
export type ResultConfidenceLabel = 'OK' | 'Revisar' | 'No usar';
export type ResultConfidenceReasonSeverity = 'info' | 'review' | 'blocking';

export type ResultConfidenceReason = {
  code: string;
  severity: ResultConfidenceReasonSeverity;
  source: string;
  message: string;
};

export type ResultConfidenceCriticalSources = {
  aurumSnapshot: SourceStatus;
  simulationConfig: SourceStatus;
  instrumentUniverse: SourceStatus;
  fx: SourceStatus;
  capitalAdjustments: SourceStatus;
  runResult: SourceStatus;
  sandbox: SourceStatus;
};

export type ResultConfidence = {
  status: ResultConfidenceStatus;
  label: ResultConfidenceLabel;
  headline: string;
  message: string;
  reasons: ResultConfidenceReason[];
  criticalSources: ResultConfidenceCriticalSources;
  canUseForDecision: boolean;
  isCanonicalForDecision: boolean;
};

export type ResultConfidenceRunInput = {
  resultDigest: string | null;
  isFinalForCurrentInput: boolean;
  resultInputHash: string | null;
  effectiveEngineInputHash: string | null;
  resultSeed: number | null;
  expectedSeed: number | null;
  resultNSim: number | null;
  expectedNSim: number | null;
  simulationRunStatus: string;
  resultMetricsAvailable: boolean;
  lastRunInputHash: string | null;
  lastRenderedResultHash: string | null;
};

export type BuildResultConfidenceInput = {
  criticalSources: ResultConfidenceCriticalSources;
  run: ResultConfidenceRunInput;
  sandboxActive?: boolean;
};

const SOURCE_LABELS: Record<keyof ResultConfidenceCriticalSources, string> = {
  aurumSnapshot: 'Aurum snapshot',
  simulationConfig: 'Configuración M8',
  instrumentUniverse: 'Instrument Universe',
  fx: 'FX aplicado',
  capitalAdjustments: 'Ajustes de capital',
  runResult: 'Resultado M8',
  sandbox: 'Sandbox',
};

function reason(
  code: string,
  severity: ResultConfidenceReasonSeverity,
  source: string,
  message: string,
): ResultConfidenceReason {
  return { code, severity, source, message };
}

function isBlockingSource(status: SourceStatus) {
  return status === 'missing' || status === 'error' || status === 'provisional';
}

function isReviewSource(status: SourceStatus) {
  return status === 'fallback' || status === 'local' || status === 'sandbox';
}

function buildRunReasons(run: ResultConfidenceRunInput): ResultConfidenceReason[] {
  const reasons: ResultConfidenceReason[] = [];
  if (!run.resultDigest) {
    reasons.push(reason(
      'result_digest_missing',
      'blocking',
      'runResult',
      'El resultado visible no tiene digest auditado.',
    ));
  }
  if (run.simulationRunStatus !== 'completed') {
    reasons.push(reason(
      'run_not_completed',
      'blocking',
      'runResult',
      `La corrida no está completada: ${run.simulationRunStatus}.`,
    ));
  }
  if (!run.resultMetricsAvailable) {
    reasons.push(reason(
      'result_metrics_missing',
      'blocking',
      'runResult',
      'Las métricas visibles del resultado no están disponibles.',
    ));
  }
  if (!run.isFinalForCurrentInput) {
    reasons.push(reason(
      'result_not_final_for_input',
      'blocking',
      'runResult',
      'El resultado no está marcado como final para el input M8 actual.',
    ));
  }
  if (run.resultInputHash !== run.effectiveEngineInputHash) {
    reasons.push(reason(
      'result_input_hash_mismatch',
      'blocking',
      'runResult',
      'El hash del resultado no coincide con el input efectivo actual.',
    ));
  }
  if (run.resultSeed !== run.expectedSeed) {
    reasons.push(reason(
      'result_seed_mismatch',
      'blocking',
      'runResult',
      'La seed del resultado no coincide con la seed del input actual.',
    ));
  }
  if (run.resultNSim !== run.expectedNSim) {
    reasons.push(reason(
      'result_nsim_mismatch',
      'blocking',
      'runResult',
      'El nSim del resultado no coincide con el input actual.',
    ));
  }
  if (run.lastRunInputHash !== run.effectiveEngineInputHash) {
    reasons.push(reason(
      'last_run_hash_mismatch',
      'blocking',
      'runResult',
      'La última corrida no corresponde al input efectivo actual.',
    ));
  }
  if (run.lastRenderedResultHash !== run.effectiveEngineInputHash) {
    reasons.push(reason(
      'last_rendered_hash_mismatch',
      'blocking',
      'runResult',
      'El resultado renderizado no corresponde al input efectivo actual.',
    ));
  }
  return reasons;
}

export function buildResultConfidence(input: BuildResultConfidenceInput): ResultConfidence {
  const criticalSources = input.criticalSources;
  const reasons: ResultConfidenceReason[] = [];
  reasons.push(...buildRunReasons(input.run));

  (Object.keys(criticalSources) as Array<keyof ResultConfidenceCriticalSources>).forEach((sourceKey) => {
    const status = criticalSources[sourceKey];
    if (isBlockingSource(status)) {
      reasons.push(reason(
        `${sourceKey}_${status}`,
        'blocking',
        sourceKey,
        `${SOURCE_LABELS[sourceKey]} está en estado ${status}.`,
      ));
    } else if (isReviewSource(status)) {
      reasons.push(reason(
        `${sourceKey}_${status}`,
        'review',
        sourceKey,
        `${SOURCE_LABELS[sourceKey]} usa fuente ${status}; puede calcular, pero no da OK canónico.`,
      ));
    }
  });

  if (input.sandboxActive) {
    reasons.push(reason(
      'sandbox_active',
      'review',
      'sandbox',
      'Hay una simulación temporal activa; no modifica el Modelo Base Oficial.',
    ));
  }

  const hasBlocking = reasons.some((item) => item.severity === 'blocking');
  if (hasBlocking) {
    return {
      status: 'not_decisional',
      label: 'No usar',
      headline: 'Resultado no decisional',
      message: 'Falta una fuente crítica o el resultado no está auditado para el input actual.',
      reasons,
      criticalSources,
      canUseForDecision: false,
      isCanonicalForDecision: false,
    };
  }

  const hasReview = reasons.some((item) => item.severity === 'review');
  if (hasReview) {
    return {
      status: 'review',
      label: 'Revisar',
      headline: 'Resultado usable con salvedades',
      message: 'El resultado final existe, pero alguna fuente crítica no es canónica.',
      reasons,
      criticalSources,
      canUseForDecision: true,
      isCanonicalForDecision: false,
    };
  }

  return {
    status: 'canonical',
    label: 'OK',
    headline: 'Resultado canónico',
    message: 'Todas las fuentes críticas están sincronizadas y el resultado final corresponde al input M8 actual.',
    reasons: [
      reason(
        'all_sources_canonical',
        'info',
        'resultConfidence',
        'Todas las fuentes críticas están en estado canónico.',
      ),
    ],
    criticalSources,
    canUseForDecision: true,
    isCanonicalForDecision: true,
  };
}
