import React, { useMemo, useState } from 'react';
import { buildMidasEvaluation } from '../domain/model/midasEvaluation';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import type { SimulationResults } from '../domain/model/types';
import type { M8Input } from '../domain/simulation/m8.types';
import {
  buildSensitivityLeverSummary,
  runOneVariableSensitivity,
  type SensitivityGroupId,
  type SensitivityLever,
  type SensitivityMetricDeltas,
  type SensitivityMetrics,
  type SensitivityRow,
  type SensitivityRunResult,
} from '../domain/sensitivity/midasSensitivity';
import { T } from './theme';

type SensitivityPageProps = {
  canonicalInputReady: boolean;
  m8InputFingerprint: M8InputFingerprint;
  simResult: SimulationResults | null;
};

const groupLabels: Record<SensitivityGroupId, string> = {
  horizon: 'Horizonte',
  return: 'Retorno real esperado',
  phase1: 'F1',
  phase2: 'F2',
  phase3: 'F3',
  phase4: 'F4',
  bucket: 'Bucket',
  cutRules: 'Reglas de recorte',
};

const tableGroups: SensitivityGroupId[] = ['horizon', 'return', 'phase1', 'phase2', 'phase3', 'phase4', 'bucket', 'cutRules'];

const finiteOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

function formatPercent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function formatDeltaPercent(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)} pp`;
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatDeltaNumber(value: number | null, digits = 2): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

function formatMarginal(row: SensitivityRow): string {
  if (row.marginal.deltaSuccess === null || row.marginal.stepLabel === null) return '—';
  return `${formatDeltaPercent(row.marginal.deltaSuccess)} / ${row.marginal.stepLabel}`;
}

function buildBaselineMetrics(simResult: SimulationResults | null): SensitivityMetrics | null {
  if (!simResult) return null;
  const quality = simResult.qualityOfLifeMetrics ?? null;
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: quality,
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  return {
    horizonYears: 40,
    success: finiteOrNull(simResult.success40 ?? (typeof simResult.probRuin40 === 'number' ? 1 - simResult.probRuin40 : null)),
    successAtHorizon: finiteOrNull(simResult.success40 ?? (typeof simResult.probRuin40 === 'number' ? 1 - simResult.probRuin40 : null)),
    ruin: finiteOrNull(simResult.probRuin40 ?? simResult.probRuin),
    nRuin: finiteOrNull(simResult.nRuin),
    houseSalePct: finiteOrNull(simResult.houseSalePct),
    houseSaleYearMedian: finiteOrNull(simResult.saleYearMedian),
    terminalWealthRatio: finiteOrNull(quality?.terminalWealthRatio),
    qolScore: finiteOrNull(evaluation.cappedScore),
    qolLabel: evaluation.label,
    csr85_4: finiteOrNull(quality?.csr85_4),
    qualitySurvivalRate: finiteOrNull(quality?.qualitySurvivalRate),
    averageEffectiveSpendingRatio: finiteOrNull(quality?.averageEffectiveSpendingRatio),
    severeCutYearsMean: finiteOrNull(quality?.severeCutYearsMean),
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', background: T.surfaceEl }}>
      <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 700 }}>{label}</div>
      <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 850 }}>{value}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  color: T.textMuted,
  fontSize: 11,
  fontWeight: 800,
  padding: '8px 10px',
  borderBottom: `1px solid ${T.border}`,
};

const tdStyle: React.CSSProperties = {
  color: T.textSecondary,
  fontSize: 12,
  padding: '8px 10px',
  borderBottom: `1px solid ${T.border}`,
  verticalAlign: 'top',
};

function RowsTable({ rows, fastMode, sensitivityNPaths }: { rows: SensitivityRow[]; fastMode: boolean; sensitivityNPaths: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 1160, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Valor probado</th>
            <th style={thStyle}>Success</th>
            <th style={thStyle}>{fastMode ? 'Delta vs base sensibilidad' : 'Delta success'}</th>
            <th style={thStyle}>Sensibilidad marginal</th>
            <th style={thStyle}>Ruin</th>
            <th style={thStyle}>QoL</th>
            <th style={thStyle}>Quality survival</th>
            <th style={thStyle}>Severe cut years</th>
            <th style={thStyle}>Terminal wealth</th>
            <th style={thStyle}>House sale</th>
            <th style={thStyle}>Nota</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ background: row.baseline ? 'rgba(208,168,92,0.08)' : 'transparent' }}>
              <td style={{ ...tdStyle, color: row.baseline ? T.primary : T.textPrimary, fontWeight: 800 }}>
                {row.valueLabel}{row.baseline ? fastMode ? ` · base sensibilidad · n=${sensitivityNPaths}` : ' · baseline' : ''}
              </td>
              <td style={tdStyle}>{row.comparableSuccess ? formatPercent(row.metrics.success) : `${formatPercent(row.metrics.successAtHorizon)} al horizonte`}</td>
              <td style={tdStyle}>{row.comparableSuccess ? formatDeltaPercent(row.deltaVsBaseline.success) : 'No comparable 40a'}</td>
              <td style={tdStyle}>
                {formatMarginal(row)}
                {row.marginal.classification ? ` · ${row.marginal.classification}` : ''}
              </td>
              <td style={tdStyle}>{formatPercent(row.metrics.ruin)}</td>
              <td style={tdStyle}>{formatNumber(row.metrics.qolScore, 1)}</td>
              <td style={tdStyle}>{formatPercent(row.metrics.qualitySurvivalRate)}</td>
              <td style={tdStyle}>{formatNumber(row.metrics.severeCutYearsMean, 1)}</td>
              <td style={tdStyle}>{formatNumber(row.metrics.terminalWealthRatio, 2)}x</td>
              <td style={tdStyle}>{formatPercent(row.metrics.houseSalePct)}</td>
              <td style={tdStyle}>{row.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const leverStatusColor: Record<SensitivityLever['status'], string> = {
  verde: T.positive,
  amarillo: T.warning,
  rojo: T.negative,
  gris: T.textMuted,
};

function LeverCard({ title, lever }: { title: string; lever: SensitivityLever | null }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', background: T.surfaceEl, display: 'grid', gap: 3 }}>
      <div style={{ color: T.textMuted, fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{title}</div>
      <div style={{ color: lever ? leverStatusColor[lever.status] : T.textMuted, fontSize: 15, fontWeight: 900 }}>{lever?.label ?? '—'}</div>
      <div style={{ color: T.textSecondary, fontSize: 12 }}>{lever?.suggestedUse ?? 'Sin datos calculados.'}</div>
    </div>
  );
}

export function SensitivityPage({ canonicalInputReady, m8InputFingerprint, simResult }: SensitivityPageProps) {
  const [result, setResult] = useState<SensitivityRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fastMode, setFastMode] = useState(true);
  const officialBaseline = useMemo(() => buildBaselineMetrics(simResult), [simResult]);
  const baseInput = m8InputFingerprint.normalizedInput as unknown as M8Input;
  const canRun = canonicalInputReady && Boolean(m8InputFingerprint.effectiveEngineInputHash) && Boolean(simResult);

  const handleRun = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      setResult(runOneVariableSensitivity(baseInput, officialBaseline, {
        nPathsOverride: fastMode ? Math.min(baseInput.n_paths, 500) : undefined,
        targetDeltaPp: 2,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo calcular sensibilidad.');
    } finally {
      setRunning(false);
    }
  };

  const sensitivityBaseline = result?.baseline ?? null;
  const leverSummary = useMemo(() => result ? buildSensitivityLeverSummary(result) : null, [result]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, background: T.surface, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>MIDAS M8</div>
            <div style={{ color: T.textPrimary, fontSize: 28, fontWeight: 900 }}>Análisis de sensibilidad</div>
            <div style={{ color: T.textSecondary, fontSize: 14, lineHeight: 1.5 }}>
              Sensibilidad one-variable-at-a-time. No guarda cambios. No modifica fuente oficial, Aurum, Instrument Universe ni política de casa.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleRun();
            }}
            disabled={!canRun || running}
            style={{
              alignSelf: 'start',
              border: `1px solid ${canRun ? T.primary : T.border}`,
              background: canRun ? T.primary : T.surfaceEl,
              color: canRun ? '#0D1425' : T.textMuted,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 900,
              cursor: !canRun || running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Calculando sensibilidad...' : 'Calcular sensibilidad'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Stat label="Fingerprint" value={m8InputFingerprint.effectiveEngineInputHash ?? '—'} />
          <Stat label="Baseline oficial" value={formatPercent(officialBaseline?.success ?? null)} />
          <Stat label="QoL oficial" value={officialBaseline?.qolLabel ?? '—'} />
          <Stat label="Terminal wealth oficial" value={`${formatNumber(officialBaseline?.terminalWealthRatio ?? null, 2)}x`} />
          {sensitivityBaseline && result?.fastMode ? <Stat label={`Base sensibilidad rápida · n=${result.sensitivityNPaths}`} value={formatPercent(sensitivityBaseline.success)} /> : null}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textSecondary, fontSize: 13 }}>
          <input type="checkbox" checked={fastMode} onChange={(event) => setFastMode(event.target.checked)} />
          Modo rápido: sensibilidad aproximada con menos paths; la simulación oficial usa el nSim del baseline.
        </label>

        {!canRun ? (
          <div style={{ color: T.warning, fontSize: 13 }}>Esperando input canónico y resultado M8 vigente para calcular sensibilidad.</div>
        ) : null}
        {error ? <div style={{ color: T.warning, fontSize: 13 }}>{error}</div> : null}
      </section>

      <section style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 900 }}>Valor requerido para subir +2 pp de éxito</div>
        <div style={{ color: T.textSecondary, fontSize: 13 }}>
          Estimación inversa manteniendo el resto constante. En modo rápido usa n reducido; los valores pueden diferir del baseline oficial. Cuando se interpola, el valor requerido es estimado y no una corrida M8 exacta.
        </div>
        {result?.fastMode ? (
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Baseline oficial: {formatPercent(officialBaseline?.success ?? null)} · Base sensibilidad rápida: {formatPercent(result.baseline.success)} con n={result.sensitivityNPaths}
          </div>
        ) : null}
        {result ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Variable</th>
                  <th style={thStyle}>Valor baseline</th>
                  <th style={thStyle}>Valor requerido estimado</th>
                  <th style={thStyle}>Success objetivo</th>
                  <th style={thStyle}>Success estimado/simulado</th>
                  <th style={thStyle}>Error vs target</th>
                  <th style={thStyle}>Delta QoL</th>
                  <th style={thStyle}>Delta terminal</th>
                  <th style={thStyle}>Delta house sale</th>
                  <th style={thStyle}>Observación</th>
                </tr>
              </thead>
              <tbody>
                {result.targetResults.map((row) => (
                  <tr key={row.variable}>
                    <td style={{ ...tdStyle, color: T.textPrimary, fontWeight: 800 }}>{row.label}</td>
                    <td style={tdStyle}>{row.baselineValueLabel}</td>
                    <td style={tdStyle}>{row.testedValueLabel}</td>
                    <td style={tdStyle}>{formatPercent(row.targetSuccess)}</td>
                    <td style={tdStyle}>{formatPercent(row.success)}</td>
                    <td style={tdStyle}>{formatDeltaPercent(row.errorVsTarget)}</td>
                    <td style={tdStyle}>{formatDeltaNumber(row.deltaQolScore, 1)}</td>
                    <td style={tdStyle}>{formatDeltaNumber(row.deltaTerminalWealthRatio, 2)}</td>
                    <td style={tdStyle}>{formatDeltaPercent(row.deltaHouseSalePct)}</td>
                    <td style={tdStyle}>{row.observation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: T.textMuted, fontSize: 13 }}>Ejecuta el cálculo para estimar el valor requerido para +2 pp de éxito.</div>
        )}
      </section>

      {leverSummary ? (
        <section style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
          <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 900 }}>Resumen de palancas</div>
          <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.5 }}>
            Este resumen interpreta la sensibilidad calculada. No es recomendación automática. Ayuda a detectar palancas con mayor impacto, control y sacrificio relativo.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <LeverCard title="Más impacto" lever={leverSummary.highestImpact} />
            <LeverCard title="Más accionable" lever={leverSummary.mostActionable} />
            <LeverCard title="Mejor para calibrar" lever={leverSummary.bestForCalibration} />
            <LeverCard title="Solo informativa / exógena" lever={leverSummary.informative} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Palanca</th>
                  <th style={thStyle}>Impacto éxito</th>
                  <th style={thStyle}>Control</th>
                  <th style={thStyle}>Sacrificio</th>
                  <th style={thStyle}>Trade-off</th>
                  <th style={thStyle}>Lectura</th>
                </tr>
              </thead>
              <tbody>
                {leverSummary.levers.map((lever) => (
                  <tr key={lever.variableId}>
                    <td style={{ ...tdStyle, color: leverStatusColor[lever.status], fontWeight: 850 }}>{lever.label}</td>
                    <td style={tdStyle}>{lever.impactLevel} · {lever.impactOnSuccess.toFixed(1)} pp</td>
                    <td style={tdStyle}>{lever.controllability}</td>
                    <td style={tdStyle}>{lever.effortOrSacrifice}</td>
                    <td style={tdStyle}>{lever.tradeoffLevel}</td>
                    <td style={tdStyle}>{lever.suggestedUse}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>Retorno esperado puede ser una variable muy sensible, pero no es directamente controlable por el usuario.</div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>Fases de gasto tempranas y largas suelen tener mayor pendiente porque afectan más años y más secuencia de retornos.</div>
        </section>
      ) : null}

      <section style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, background: T.surface, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 900 }}>Tablas one-variable-at-a-time</div>
        <div style={{ color: T.textSecondary, fontSize: 13 }}>
          Cada tabla modifica una variable o grupo explícito y conserva todo lo demás constante. House sale aparece solo como métrica resultado.
        </div>
        {result?.warnings.map((warning) => (
          <div key={warning} style={{ color: T.warning, fontSize: 12 }}>{warning}</div>
        ))}
        {result ? tableGroups.map((groupId) => (
          <details key={groupId} open={groupId === 'horizon' || groupId === 'return'} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, background: T.surfaceEl }}>
            <summary style={{ color: T.textPrimary, fontSize: 15, fontWeight: 900, cursor: 'pointer' }}>{groupLabels[groupId]}</summary>
            <div style={{ marginTop: 10 }}>
              <RowsTable rows={result.rows.filter((row) => row.groupId === groupId)} fastMode={result.fastMode} sensitivityNPaths={result.sensitivityNPaths} />
            </div>
          </details>
        )) : (
          <div style={{ color: T.textMuted, fontSize: 13 }}>Las tablas aparecerán después del cálculo.</div>
        )}
      </section>
    </div>
  );
}
