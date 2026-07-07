import React, { useMemo, useState } from 'react';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import type { ResultConfidence } from '../domain/model/resultConfidence';
import type { SimulationResultDiagnostics } from '../domain/model/simulationResultDigest';
import type { SimulationRunBlockedReason } from '../domain/model/simulationRunGate';
import type { SimulationResults } from '../domain/model/types';
import type { M8Input } from '../domain/simulation/m8.types';
import { validateCandidateSet, type CandidateSetValidationResult } from '../domain/optimization/candidateSet';
import {
  evaluateCandidateSetWithM8,
  type ScenarioLabCandidateSetM8Evaluation,
  type ScenarioLabM8Metrics,
} from '../domain/optimization/evaluateCandidateSetWithM8';
import { buildOptimizationPack, type OptimizationPack } from '../domain/optimization/optimizationPack';
import { T } from './theme';

type ScenarioLabPageProps = {
  canonicalInputReady: boolean;
  canonicalInputBlockedReason: SimulationRunBlockedReason | null;
  m8InputFingerprint: M8InputFingerprint;
  simulationResultDiagnostics: SimulationResultDiagnostics;
  resultConfidence: ResultConfidence;
  simResult: SimulationResults | null;
};

type ScenarioLabExportState = {
  enabled: boolean;
  reason: string | null;
};

type ScenarioLabEvaluationState = {
  enabled: boolean;
  reason: string | null;
};

const BLOCK_REASON_LABELS: Record<SimulationRunBlockedReason, string> = {
  effective_input_missing: 'Falta input efectivo M8.',
  auth_loading: 'Auth de usuario todavía no resuelta.',
  auth_not_canonical: 'La sesión no es canónica.',
  config_loading: 'Config cloud todavía cargando.',
  config_missing: 'Falta config cloud simulationActiveV1.',
  config_error: 'Config cloud con error.',
  aurum_snapshot_missing: 'Falta snapshot Aurum aplicable.',
  aurum_snapshot_error: 'Snapshot Aurum con error.',
  instrument_universe_loading: 'Instrument Universe todavía cargando.',
  instrument_universe_timeout: 'Instrument Universe venció por timeout.',
  instrument_universe_error: 'Instrument Universe con error.',
  instrument_universe_missing: 'Falta Instrument Universe activo.',
  cloud_hydration_incomplete: 'Hydration cloud incompleta.',
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function finiteOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatRatio(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}x`;
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatDelta(value: number | null, kind: 'percent' | 'score' | 'ratio' | 'years'): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  if (kind === 'percent') return `${sign}${(value * 100).toFixed(1)} pp`;
  if (kind === 'ratio') return `${sign}${value.toFixed(2)}x`;
  if (kind === 'years') return `${sign}${value.toFixed(1)}a`;
  return `${sign}${value.toFixed(1)}`;
}

function buildCandidateValidationSummary(validation: CandidateSetValidationResult | null) {
  if (!validation?.ok) return [];
  return validation.value.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    label: candidate.label ?? '—',
    variables: Object.keys(candidate.changes).join(', '),
    hypothesis: candidate.hypothesis ?? '—',
    riskNotes: candidate.riskNotes?.length ? candidate.riskNotes.join(' · ') : '—',
    proxyScore: typeof candidate.preM8Score === 'number' ? candidate.preM8Score : null,
    proxyExplanation: candidate.preM8ScoreExplanation ?? null,
  }));
}

export function buildScenarioLabExportState(params: {
  canonicalInputReady: boolean;
  canonicalInputBlockedReason: SimulationRunBlockedReason | null;
  fingerprint: M8InputFingerprint;
  simulationResultDiagnostics: SimulationResultDiagnostics;
  resultConfidence: ResultConfidence;
  simResult: SimulationResults | null;
}): ScenarioLabExportState {
  if (!params.canonicalInputReady) {
    return {
      enabled: false,
      reason: params.canonicalInputBlockedReason
        ? `Esperando input canónico: ${BLOCK_REASON_LABELS[params.canonicalInputBlockedReason]}`
        : 'Esperando input canónico.',
    };
  }
  if (!params.fingerprint.effectiveEngineInputHash) {
    return { enabled: false, reason: 'Falta fingerprint efectivo M8.' };
  }
  if (!params.simulationResultDiagnostics.resultDigest) {
    return { enabled: false, reason: 'Falta resultado vigente auditado.' };
  }
  if (!params.fingerprint.diagnosticInput.replayTrace.sourcePolicy.isComparable) {
    return { enabled: false, reason: 'La fuente actual no es comparable según source policy.' };
  }
  if (!params.resultConfidence.canUseForDecision) {
    return { enabled: false, reason: 'El resultado actual no es usable para decisión y no puede sellar baseline.' };
  }
  if (!params.simResult) {
    return { enabled: false, reason: 'Falta la corrida visible para construir el baseline.' };
  }
  return { enabled: true, reason: null };
}

export function validateScenarioLabCandidateSetText(
  rawText: string,
  expectedPackFingerprint: string | null,
): CandidateSetValidationResult {
  if (!expectedPackFingerprint) {
    return { ok: false, errors: ['No hay Optimization Pack vigente para validar el Candidate Set.'] };
  }
  return validateCandidateSet(rawText, { expectedPackFingerprint });
}

export function buildScenarioLabM8EvaluationState(params: {
  exportState: ScenarioLabExportState;
  optimizationPack: OptimizationPack | null;
  candidateValidation: CandidateSetValidationResult | null;
}): ScenarioLabEvaluationState {
  if (!params.exportState.enabled) {
    return { enabled: false, reason: params.exportState.reason ?? 'Falta baseline canónico para evaluar candidatos.' };
  }
  if (!params.optimizationPack) {
    return { enabled: false, reason: 'Falta Optimization Pack vigente.' };
  }
  if (!params.candidateValidation?.ok) {
    return { enabled: false, reason: 'Valida un Candidate Set compatible antes de correr M8.' };
  }
  if (params.candidateValidation.value.candidates.length === 0) {
    return { enabled: false, reason: 'El Candidate Set no trae candidatos para evaluar.' };
  }
  return { enabled: true, reason: null };
}

function buildScenarioLabPack(params: ScenarioLabPageProps): OptimizationPack | null {
  if (!params.simResult) return null;
  return buildOptimizationPack({
    fingerprint: params.m8InputFingerprint,
    simulationResultDiagnostics: params.simulationResultDiagnostics,
    resultConfidence: params.resultConfidence,
    simResult: params.simResult,
  });
}

export function ScenarioLabPage(props: ScenarioLabPageProps) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [candidateText, setCandidateText] = useState('');
  const [candidateValidation, setCandidateValidation] = useState<CandidateSetValidationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResults, setEvaluationResults] = useState<ScenarioLabCandidateSetM8Evaluation | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationCopyFeedback, setEvaluationCopyFeedback] = useState<string | null>(null);

  const exportState = useMemo(
    () => buildScenarioLabExportState({
      canonicalInputReady: props.canonicalInputReady,
      canonicalInputBlockedReason: props.canonicalInputBlockedReason,
      fingerprint: props.m8InputFingerprint,
      simulationResultDiagnostics: props.simulationResultDiagnostics,
      resultConfidence: props.resultConfidence,
      simResult: props.simResult,
    }),
    [
      props.canonicalInputBlockedReason,
      props.canonicalInputReady,
      props.m8InputFingerprint,
      props.resultConfidence,
      props.simResult,
      props.simulationResultDiagnostics,
    ],
  );

  const optimizationPack = useMemo(() => (
    exportState.enabled ? buildScenarioLabPack(props) : null
  ), [exportState.enabled, props]);

  const expectedPackFingerprint = optimizationPack?.baseline.fingerprint ?? null;
  const baselineMetrics = evaluationResults?.baseline.metrics ?? {
    success40: finiteOrNull(optimizationPack?.baseline.success40),
    ruin40: finiteOrNull(optimizationPack?.baseline.ruin40),
    nRuin: finiteOrNull(props.simResult?.nRuin),
    houseSalePct: finiteOrNull(optimizationPack?.baseline.houseSalePct),
    houseSaleYearMedian: finiteOrNull(props.simResult?.saleYearMedian),
    terminalWealthRatio: finiteOrNull(optimizationPack?.baseline.terminalWealthRatio),
    qolScore: finiteOrNull(optimizationPack?.baseline.qolScore),
    qolLabel: optimizationPack?.baseline.qolLabel ?? null,
    csr85_4: finiteOrNull(optimizationPack?.baseline.csr85_4),
    qualitySurvivalRate: finiteOrNull(optimizationPack?.baseline.qualitySurvivalRate),
    averageEffectiveSpendingRatio: finiteOrNull(props.simResult?.qualityOfLifeMetrics?.averageEffectiveSpendingRatio),
    severeCutYearsMean: finiteOrNull(props.simResult?.qualityOfLifeMetrics?.severeCutYearsMean),
  } satisfies ScenarioLabM8Metrics;
  const evaluationState = useMemo(() => buildScenarioLabM8EvaluationState({
    exportState,
    optimizationPack,
    candidateValidation,
  }), [candidateValidation, exportState, optimizationPack]);

  const handleCopyPack = async () => {
    if (!optimizationPack || !exportState.enabled) return;
    try {
      await navigator.clipboard.writeText(prettyJson(optimizationPack));
      setCopyFeedback('Optimization Pack copiado.');
    } catch {
      setCopyFeedback('No se pudo copiar automáticamente. Puedes copiar el JSON desde el preview.');
    }
  };

  const handleValidateCandidateSet = () => {
    setCandidateValidation(validateScenarioLabCandidateSetText(candidateText, expectedPackFingerprint));
    setEvaluationResults(null);
    setEvaluationError(null);
    setEvaluationCopyFeedback(null);
  };

  const handleEvaluateCandidates = async () => {
    if (!evaluationState.enabled || !candidateValidation?.ok || !props.simResult || !expectedPackFingerprint) return;
    setIsEvaluating(true);
    setEvaluationError(null);
    setEvaluationCopyFeedback(null);
    setEvaluationResults(null);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const results = evaluateCandidateSetWithM8({
        baseInput: props.m8InputFingerprint.normalizedInput as unknown as M8Input,
        baselineFingerprint: expectedPackFingerprint,
        baselineResult: props.simResult,
        candidateSet: candidateValidation.value,
      });
      setEvaluationResults(results);
    } catch (error) {
      setEvaluationError(error instanceof Error ? error.message : 'No se pudo ejecutar la evaluación oficial M8.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleCopyEvaluationResults = async () => {
    if (!evaluationResults) return;
    try {
      await navigator.clipboard.writeText(prettyJson(evaluationResults));
      setEvaluationCopyFeedback('Resultados M8 exploratorios copiados.');
    } catch {
      setEvaluationCopyFeedback('No se pudo copiar automáticamente. Puedes copiar el JSON desde el preview.');
    }
  };

  const validatedCandidates = candidateValidation?.ok ? candidateValidation.value.candidates : [];
  const candidateRows = buildCandidateValidationSummary(candidateValidation);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section
        style={{
          background: 'linear-gradient(180deg, rgba(208,168,92,0.14), rgba(208,168,92,0.04))',
          border: `1px solid rgba(208,168,92,0.28)`,
          borderRadius: 24,
          padding: 20,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              Laboratorio
            </div>
            <div style={{ color: T.textPrimary, fontSize: 28, fontWeight: 800 }}>Laboratorio de Escenarios</div>
            <div style={{ color: '#E0B45F', fontSize: 14, fontWeight: 700 }}>Optimización Asistida</div>
          </div>
          <div
            style={{
              alignSelf: 'start',
              border: `1px solid rgba(208,168,92,0.35)`,
              borderRadius: 999,
              padding: '8px 12px',
              color: '#F3D38A',
              fontSize: 12,
              fontWeight: 800,
              background: 'rgba(208,168,92,0.12)',
            }}
          >
            Exploratorio · no decisional
          </div>
        </div>

        <div style={{ color: T.textSecondary, fontSize: 15, lineHeight: 1.6 }}>
          Entrada estricta → conversación guiada/flexible → salida estricta → evaluación por M8 oficial.
        </div>
        <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>
          La IA genera candidatos. MIDAS calcula resultados. Tú decides.
        </div>
        <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.6 }}>
          La IA externa puede hacer pre-screening heurístico. Puede calcular scores proxy, pero no resultados M8.
          Pídele que te muestre una preselección antes del JSON final y que te deje depurar candidatos si hace falta.
        </div>
        <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.6 }}>
          La política de venta de casa está definida por el motor. El Laboratorio no propone vender/no vender casa como decisión libre: solo lee las métricas de casa que devuelve M8.
        </div>
      </section>

      <section style={{ border: `1px solid ${T.border}`, borderRadius: 20, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Exportar Optimization Pack</div>
        <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.6 }}>
          El pack sale sellado con fingerprint, baseline, source lineage, variables permitidas/prohibidas y el contrato de salida esperado para IA.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              void handleCopyPack();
            }}
            disabled={!exportState.enabled}
            style={{
              border: `1px solid ${exportState.enabled ? T.primary : T.border}`,
              background: exportState.enabled ? T.primary : T.surfaceEl,
              color: exportState.enabled ? '#0D1425' : T.textMuted,
              borderRadius: 14,
              padding: '12px 14px',
              fontWeight: 800,
              cursor: exportState.enabled ? 'pointer' : 'default',
            }}
          >
            Copiar Optimization Pack
          </button>
        </div>
        {exportState.reason ? (
          <div style={{ color: T.warning, fontSize: 13, lineHeight: 1.5 }}>
            Exportación bloqueada: {exportState.reason}
          </div>
        ) : null}
        {copyFeedback ? (
          <div style={{ color: '#A8D5A2', fontSize: 13, lineHeight: 1.5 }}>{copyFeedback}</div>
        ) : null}
        {optimizationPack ? (
          <details style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: '10px 12px', background: T.surfaceEl }}>
            <summary style={{ color: T.textPrimary, cursor: 'pointer', fontWeight: 700 }}>Preview del Optimization Pack</summary>
            <pre
              style={{
                marginTop: 10,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: T.textSecondary,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {prettyJson(optimizationPack)}
            </pre>
          </details>
        ) : null}
      </section>

      <section style={{ border: `1px solid ${T.border}`, borderRadius: 20, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Instrucciones para el chat</div>
        <ol style={{ margin: 0, paddingLeft: 18, color: T.textSecondary, lineHeight: 1.7, fontSize: 14 }}>
          <li>Copia el Optimization Pack.</li>
          <li>Pégalo en una IA externa.</li>
          <li>Elige objetivos y restricciones.</li>
          <li>Cuando termines, la IA debe preseleccionar candidatos.</li>
          <li>Revisa si quieres depurar.</li>
          <li>Luego pide “generar JSON”.</li>
          <li>Pega aquí el Candidate Set.</li>
        </ol>
        <div style={{ color: T.textMuted, fontSize: 13, lineHeight: 1.6 }}>
          Flujo recomendado: la IA puede calcular para pensar, pero todavía no puede calcular resultados oficiales M8.
        </div>
      </section>

      {optimizationPack ? (
        <section style={{ border: `1px solid ${T.border}`, borderRadius: 20, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
          <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Baseline M8 sellado</div>
          <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.6 }}>
            Este baseline es el punto de comparación oficial del Laboratorio. La evaluación de candidatos es exploratoria y no muta el Modelo Base.
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {[
              ['Success40', formatPercent(baselineMetrics.success40)],
              ['QoL', baselineMetrics.qolLabel ? `${baselineMetrics.qolLabel} · ${formatNumber(baselineMetrics.qolScore)}` : '—'],
              ['CSR-85/4', formatPercent(baselineMetrics.csr85_4)],
              ['Venta casa', formatPercent(baselineMetrics.houseSalePct)],
              ['Terminal ratio', formatRatio(baselineMetrics.terminalWealthRatio)],
              ['Fingerprint', expectedPackFingerprint ?? '—'],
            ].map(([label, value]) => (
              <div key={label} style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 12, background: T.surfaceEl }}>
                <div style={{ color: T.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                <div style={{ color: T.textPrimary, fontSize: label === 'Fingerprint' ? 12 : 18, fontWeight: 800, marginTop: 6, wordBreak: 'break-word' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ border: `1px solid ${T.border}`, borderRadius: 20, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Importar Candidate Set</div>
        <textarea
          value={candidateText}
          onChange={(event) => setCandidateText(event.target.value)}
          placeholder="Pegar Candidate Set JSON"
          style={{
            minHeight: 220,
            width: '100%',
            borderRadius: 16,
            border: `1px solid ${T.border}`,
            background: T.surfaceEl,
            color: T.textPrimary,
            padding: 14,
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleValidateCandidateSet}
            style={{
              border: `1px solid ${T.primary}`,
              background: T.surfaceEl,
              color: T.textPrimary,
              borderRadius: 14,
              padding: '12px 14px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Validar Candidate Set
          </button>
          <button
            type="button"
            onClick={() => {
              void handleEvaluateCandidates();
            }}
            disabled={!evaluationState.enabled || isEvaluating}
            style={{
              border: `1px solid ${evaluationState.enabled && !isEvaluating ? T.primary : T.border}`,
              background: evaluationState.enabled && !isEvaluating ? T.primary : T.surfaceEl,
              color: evaluationState.enabled && !isEvaluating ? '#0D1425' : T.textMuted,
              borderRadius: 14,
              padding: '12px 14px',
              fontWeight: 800,
              cursor: evaluationState.enabled && !isEvaluating ? 'pointer' : 'default',
            }}
          >
            {isEvaluating ? 'Evaluando candidatos con M8…' : 'Evaluar candidatos con M8'}
          </button>
        </div>
        <div style={{ color: evaluationState.reason ? T.warning : T.textMuted, fontSize: 13, lineHeight: 1.5 }}>
          {evaluationState.reason ?? 'La evaluación corre M8 oficial de forma exploratoria. No guarda candidatos, no muta el baseline y no escribe en cloud.'}
        </div>
        {isEvaluating ? (
          <div style={{ color: '#F3D38A', fontSize: 13, lineHeight: 1.5 }}>
            Ejecutando {validatedCandidates.length} candidatos con M8 oficial sobre el input canónico vigente…
          </div>
        ) : null}
        {evaluationError ? (
          <div style={{ color: T.negative, fontSize: 13, lineHeight: 1.5 }}>
            Error al evaluar candidatos: {evaluationError}
          </div>
        ) : null}

        {candidateValidation?.ok === false ? (
          <div style={{ border: `1px solid ${T.negative}`, borderRadius: 14, padding: 12, background: 'rgba(255,92,92,0.10)' }}>
            <div style={{ color: T.textPrimary, fontWeight: 800, marginBottom: 8 }}>Errores de validación</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: T.textSecondary, lineHeight: 1.6, fontSize: 13 }}>
              {candidateValidation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidateValidation?.ok ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: '#A8D5A2', fontSize: 13, fontWeight: 800 }}>
              Candidate Set válido: {validatedCandidates.length} candidatos listos para revisión exploratoria.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    {['candidateId', 'label', 'variables modificadas', 'hypothesis', 'riskNotes', 'proxy IA'].map((label) => (
                      <th
                        key={label}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          color: T.textMuted,
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidateRows.map((candidate) => (
                    <tr key={candidate.candidateId}>
                      <td style={{ padding: '10px', color: T.textPrimary, borderBottom: `1px solid ${T.border}` }}>{candidate.candidateId}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{candidate.label}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{candidate.variables}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{candidate.hypothesis}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>
                        {candidate.riskNotes}
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>
                        {candidate.proxyScore !== null ? (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div
                              style={{
                                display: 'inline-flex',
                                width: 'fit-content',
                                alignItems: 'center',
                                gap: 6,
                                border: `1px solid rgba(208,168,92,0.35)`,
                                borderRadius: 999,
                                padding: '4px 8px',
                                color: '#F3D38A',
                                fontSize: 11,
                                fontWeight: 800,
                                background: 'rgba(208,168,92,0.12)',
                              }}
                            >
                              Proxy IA · no M8
                            </div>
                            <div style={{ color: T.textPrimary, fontWeight: 700 }}>{candidate.proxyScore}/100</div>
                            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                              {candidate.proxyExplanation}
                            </div>
                            <div style={{ color: T.warning, fontSize: 11, lineHeight: 1.5 }}>
                              Este score es preliminar. M8 todavía no evaluó el candidato.
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {evaluationResults ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: '#A8D5A2', fontSize: 13, fontWeight: 800 }}>
                Evaluación oficial completada: {evaluationResults.candidates.filter((candidate) => candidate.status === 'evaluated').length}/{evaluationResults.candidates.length} candidatos evaluados por M8.
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleCopyEvaluationResults();
                }}
                style={{
                  border: `1px solid ${T.border}`,
                  background: T.surfaceEl,
                  color: T.textPrimary,
                  borderRadius: 14,
                  padding: '10px 12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Copiar resultados M8
              </button>
            </div>
            {evaluationCopyFeedback ? (
              <div style={{ color: '#A8D5A2', fontSize: 13, lineHeight: 1.5 }}>{evaluationCopyFeedback}</div>
            ) : null}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1160 }}>
                <thead>
                  <tr>
                    {['candidate', 'family', 'hypothesis', 'proxy IA', 'éxito M8', 'QoL M8', 'CSR-85/4', 'venta casa', 'recortes', 'terminal ratio', 'delta vs baseline', 'estado'].map((label) => (
                      <th
                        key={label}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          color: T.textMuted,
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evaluationResults.candidates.map((candidate) => (
                    <tr key={candidate.candidateId}>
                      <td style={{ padding: '10px', color: T.textPrimary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div style={{ fontWeight: 800 }}>{candidate.label ?? candidate.candidateId}</div>
                          <div style={{ color: T.textMuted, fontSize: 12 }}>{candidate.candidateId}</div>
                        </div>
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>{candidate.candidateFamily ?? '—'}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>{candidate.hypothesis ?? '—'}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              width: 'fit-content',
                              alignItems: 'center',
                              gap: 6,
                              border: `1px solid rgba(208,168,92,0.35)`,
                              borderRadius: 999,
                              padding: '4px 8px',
                              color: '#F3D38A',
                              fontSize: 11,
                              fontWeight: 800,
                              background: 'rgba(208,168,92,0.12)',
                            }}
                          >
                            Proxy IA
                          </div>
                          <div>{candidate.proxy.preM8Score !== null ? `${candidate.proxy.preM8Score}/100` : '—'}</div>
                          <div style={{ fontSize: 12, lineHeight: 1.5 }}>{candidate.proxy.preM8ScoreExplanation ?? 'Sin score heurístico.'}</div>
                        </div>
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>{formatPercent(candidate.metrics?.success40 ?? null)}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        {candidate.metrics ? `${candidate.metrics.qolLabel ?? '—'} · ${formatNumber(candidate.metrics.qolScore)}` : '—'}
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>{formatPercent(candidate.metrics?.csr85_4 ?? null)}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        {candidate.metrics ? `${formatPercent(candidate.metrics.houseSalePct)} · año ${formatNumber(candidate.metrics.houseSaleYearMedian)}` : '—'}
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        {candidate.metrics ? `Severe ${formatNumber(candidate.metrics.severeCutYearsMean)}a · Spend ${formatPercent(candidate.metrics.averageEffectiveSpendingRatio)}` : '—'}
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>{formatRatio(candidate.metrics?.terminalWealthRatio ?? null)}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        {candidate.deltaVsBaseline ? (
                          <div style={{ display: 'grid', gap: 4, fontSize: 12, lineHeight: 1.4 }}>
                            <div>Success {formatDelta(candidate.deltaVsBaseline.success40, 'percent')}</div>
                            <div>QoL {formatDelta(candidate.deltaVsBaseline.qolScore, 'score')}</div>
                            <div>CSR {formatDelta(candidate.deltaVsBaseline.csr85_4, 'percent')}</div>
                            <div>Casa {formatDelta(candidate.deltaVsBaseline.houseSalePct, 'percent')}</div>
                            <div>Terminal {formatDelta(candidate.deltaVsBaseline.terminalWealthRatio, 'ratio')}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                        <div style={{ display: 'grid', gap: 6 }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              width: 'fit-content',
                              alignItems: 'center',
                              gap: 6,
                              border: `1px solid ${candidate.status === 'evaluated' ? 'rgba(168,213,162,0.35)' : candidate.status === 'invalid' ? 'rgba(255,92,92,0.35)' : 'rgba(243,211,138,0.35)'}`,
                              borderRadius: 999,
                              padding: '4px 8px',
                              color: candidate.status === 'evaluated' ? '#A8D5A2' : candidate.status === 'invalid' ? T.negative : '#F3D38A',
                              fontSize: 11,
                              fontWeight: 800,
                              background: candidate.status === 'evaluated' ? 'rgba(168,213,162,0.12)' : candidate.status === 'invalid' ? 'rgba(255,92,92,0.12)' : 'rgba(243,211,138,0.12)',
                            }}
                          >
                            {candidate.status === 'evaluated' ? 'Exploratorio evaluado por M8' : candidate.status === 'invalid' ? 'Bloqueado por mapping' : 'Error al correr M8'}
                          </div>
                          {candidate.warnings.length > 0 ? (
                            <div style={{ color: '#F3D38A', fontSize: 12, lineHeight: 1.4 }}>
                              {candidate.warnings.join(' · ')}
                            </div>
                          ) : null}
                          {candidate.errors.length > 0 ? (
                            <div style={{ color: T.negative, fontSize: 12, lineHeight: 1.4 }}>
                              {candidate.errors.join(' · ')}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: '10px 12px', background: T.surfaceEl }}>
              <summary style={{ color: T.textPrimary, cursor: 'pointer', fontWeight: 700 }}>Preview JSON resultados exploratorios</summary>
              <pre
                style={{
                  marginTop: 10,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: T.textSecondary,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {prettyJson(evaluationResults)}
              </pre>
            </details>
          </div>
        ) : null}
      </section>
    </div>
  );
}
