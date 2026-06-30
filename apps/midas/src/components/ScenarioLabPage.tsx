import React, { useMemo, useState } from 'react';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import type { ResultConfidence } from '../domain/model/resultConfidence';
import type { SimulationResultDiagnostics } from '../domain/model/simulationResultDigest';
import type { SimulationRunBlockedReason } from '../domain/model/simulationRunGate';
import type { SimulationResults } from '../domain/model/types';
import { validateCandidateSet, type CandidateSetValidationResult } from '../domain/optimization/candidateSet';
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
  };

  const validatedCandidates = candidateValidation?.ok ? candidateValidation.value.candidates : [];

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
          <li>Pégalo en un chat de IA.</li>
          <li>Elige objetivos.</li>
          <li>Responde seguir o terminé.</li>
          <li>Cuando termines, la IA debe devolver un <code>midas_candidate_set.json</code>.</li>
          <li>Pega ese JSON aquí para validarlo o correrlo después.</li>
        </ol>
      </section>

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
            disabled
            style={{
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              color: T.textMuted,
              borderRadius: 14,
              padding: '12px 14px',
              fontWeight: 800,
              cursor: 'default',
            }}
          >
            Evaluación M8 pendiente
          </button>
        </div>
        <div style={{ color: T.textMuted, fontSize: 13, lineHeight: 1.5 }}>
          La evaluación M8 oficial queda pendiente en este slice. No se ejecuta motor automáticamente desde Laboratorio.
        </div>

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
                    {['candidateId', 'label', 'variables modificadas', 'hypothesis', 'riskNotes'].map((label) => (
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
                  {validatedCandidates.map((candidate) => (
                    <tr key={candidate.candidateId}>
                      <td style={{ padding: '10px', color: T.textPrimary, borderBottom: `1px solid ${T.border}` }}>{candidate.candidateId}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{candidate.label ?? '—'}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{Object.keys(candidate.changes).join(', ')}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>{candidate.hypothesis ?? '—'}</td>
                      <td style={{ padding: '10px', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>
                        {candidate.riskNotes?.length ? candidate.riskNotes.join(' · ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
