import React, { useCallback, useMemo, useState } from 'react';
import type { ModelParameters, SimulationResults } from '../domain/model/types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import { T } from './theme';

type OptimizationMode = 'light' | 'normal' | 'decision';
type SourceMode = 'base' | 'simulation';

type LightOptimizationPoint = {
  rvPct: number;
  rfPct: number;
  success40: number;
  probRuin20: number;
  houseSalePct: number;
  earlyRuinP10: number | null;
  ruinCentral80: string;
  drawdownP50: number;
  cutTimeShare: number;
};

function cloneParams(params: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(params)) as ModelParameters;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatYears(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No disponible';
  return `${value.toFixed(1)} años`;
}

function buildRuinCentral80(result: SimulationResults): string {
  const p10 = result.ruinTimingP10;
  const p90 = result.ruinTimingP90;
  if (!Number.isFinite(p10 ?? Number.NaN) || !Number.isFinite(p90 ?? Number.NaN)) return 'No disponible';
  return `${(p10 as number).toFixed(1)}–${(p90 as number).toFixed(1)} años`;
}

function formatPctValue(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

function summarizeRiskMix(params: ModelParameters): string {
  const rv = params.weights.rvGlobal + params.weights.rvChile;
  const rf = params.weights.rfGlobal + params.weights.rfChile;
  return `${Math.round(rv * 100)}/${Math.round(rf * 100)}`;
}

function hasRiskCapitalEnabled(params: ModelParameters): boolean {
  const risk = Number(params.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
  return Number.isFinite(risk) && risk > 0;
}

function buildDeltaSummary(baseParams: ModelParameters, candidateParams: ModelParameters): string {
  const deltas: string[] = [];
  const baseMix = summarizeRiskMix(baseParams);
  const candidateMix = summarizeRiskMix(candidateParams);
  if (baseMix !== candidateMix) deltas.push(`mix ${candidateMix}`);
  if (!approxEqual(baseParams.feeAnnual, candidateParams.feeAnnual)) {
    deltas.push(`fee ${formatPctValue(candidateParams.feeAnnual)}`);
  }
  if (baseParams.simulation.nSim !== candidateParams.simulation.nSim) {
    deltas.push(`nSim ${candidateParams.simulation.nSim}`);
  }
  const baseHouseEnabled = Boolean(baseParams.realEstatePolicy?.enabled);
  const candidateHouseEnabled = Boolean(candidateParams.realEstatePolicy?.enabled);
  if (baseHouseEnabled !== candidateHouseEnabled) {
    deltas.push(`venta de casa ${candidateHouseEnabled ? 'ON' : 'OFF'}`);
  }
  const baseRiskCapital = hasRiskCapitalEnabled(baseParams);
  const candidateRiskCapital = hasRiskCapitalEnabled(candidateParams);
  if (baseRiskCapital !== candidateRiskCapital) {
    deltas.push(`capital de riesgo ${candidateRiskCapital ? 'ON' : 'OFF'}`);
  }
  return deltas.length ? `Cambios vs base: ${deltas.join(' · ')}` : 'Sin cambios temporales respecto de la base vigente';
}

export function OptimizationLightPage({
  baseParams,
  simulationParams,
  simulationActive,
  simulationLabel,
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
}) {
  const [mode, setMode] = useState<OptimizationMode>('light');
  const [sourceMode, setSourceMode] = useState<SourceMode>(simulationActive ? 'simulation' : 'base');
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<null | {
    bestSuccess: LightOptimizationPoint;
    minHouseSale: LightOptimizationPoint;
    maxEarlyRuinDelay: LightOptimizationPoint;
    scanned: number;
  }>(null);

  const activeParams = sourceMode === 'simulation' && simulationActive ? simulationParams : baseParams;
  const activeLabel = sourceMode === 'simulation' && simulationActive ? (simulationLabel ?? 'Simulación activa') : 'Base vigente';
  const sourceDescription = sourceMode === 'simulation' && simulationActive
    ? 'Simulación activa: usa los cambios temporales que estás probando'
    : 'Base vigente: usa la configuración persistida del caso';
  const sourceDeltaSummary = sourceMode === 'simulation' && simulationActive
    ? buildDeltaSummary(baseParams, simulationParams)
    : 'Sin cambios temporales respecto de la base vigente';

  const runLightOptimization = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setSummary(null);
    try {
      const currentWeights = activeParams.weights;
      const globalShare = Math.max(0, Math.min(1, (currentWeights.rvGlobal + currentWeights.rfGlobal) || 0.5));
      const localShare = Math.max(0, Math.min(1, 1 - globalShare));
      const points: LightOptimizationPoint[] = [];

      for (let rvPct = 20; rvPct <= 90; rvPct += 5) {
        const rv = rvPct / 100;
        const rf = 1 - rv;
        const candidate = cloneParams(activeParams);
        candidate.weights = {
          rvGlobal: rv * globalShare,
          rvChile: rv * localShare,
          rfGlobal: rf * globalShare,
          rfChile: rf * localShare,
        };
        const sim = runSimulationCentral(candidate);
        const earlyP10 = Number.isFinite(sim.ruinTimingP10 ?? Number.NaN) ? (sim.ruinTimingP10 as number) : null;
        points.push({
          rvPct,
          rfPct: Math.round(rf * 100),
          success40: sim.success40 ?? (1 - (sim.probRuin40 ?? sim.probRuin)),
          probRuin20: sim.probRuin20 ?? 0,
          houseSalePct: sim.houseSalePct ?? 0,
          earlyRuinP10: earlyP10,
          ruinCentral80: buildRuinCentral80(sim),
          drawdownP50: sim.maxDrawdownPercentiles[50] ?? 0,
          cutTimeShare: sim.cutTimeShare ?? 0,
        });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }

      if (!points.length) return;
      const bestSuccess = [...points].sort((a, b) => (b.success40 - a.success40) || (a.probRuin20 - b.probRuin20))[0];
      const minHouseSale = [...points].sort((a, b) => (a.houseSalePct - b.houseSalePct) || (b.success40 - a.success40))[0];
      const maxEarlyRuinDelay = [...points].sort((a, b) => {
        const aScore = a.earlyRuinP10 ?? Number.NEGATIVE_INFINITY;
        const bScore = b.earlyRuinP10 ?? Number.NEGATIVE_INFINITY;
        return (bScore - aScore) || (b.success40 - a.success40);
      })[0];

      setSummary({
        bestSuccess,
        minHouseSale,
        maxEarlyRuinDelay,
        scanned: points.length,
      });
    } finally {
      setRunning(false);
    }
  }, [activeParams, running]);

  const modeCards = useMemo(
    () => ([
      { id: 'light', label: 'Light', active: mode === 'light', enabled: true, hint: 'Barrido RF/RV rápido y explicable' },
      { id: 'normal', label: 'Normal', active: mode === 'normal', enabled: false, hint: 'Próximamente' },
      { id: 'decision', label: 'Decisión', active: mode === 'decision', enabled: false, hint: 'Próximamente' },
    ] as const),
    [mode],
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Optimización</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Explora combinaciones para mejorar el escenario actual.
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Modo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
          {modeCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => card.enabled && setMode(card.id)}
              disabled={!card.enabled}
              style={{
                background: card.active ? T.primary : T.surfaceEl,
                border: `1px solid ${card.active ? T.primary : T.border}`,
                color: card.active ? '#fff' : card.enabled ? T.textSecondary : T.textMuted,
                borderRadius: 10,
                padding: '8px 10px',
                textAlign: 'left',
                cursor: card.enabled ? 'pointer' : 'not-allowed',
                opacity: card.enabled ? 1 : 0.75,
                display: 'grid',
                gap: 3,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{card.label}</span>
              <span style={{ fontSize: 10 }}>{card.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: T.textMuted, fontSize: 11 }}>Fuente del escenario</div>
          <div style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700 }}>{activeLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSourceMode('base')}
            style={{
              background: sourceMode === 'base' ? T.primary : T.surfaceEl,
              border: `1px solid ${sourceMode === 'base' ? T.primary : T.border}`,
              color: sourceMode === 'base' ? '#fff' : T.textSecondary,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Base vigente
          </button>
          <button
            type="button"
            onClick={() => simulationActive && setSourceMode('simulation')}
            disabled={!simulationActive}
            style={{
              background: sourceMode === 'simulation' ? T.primary : T.surfaceEl,
              border: `1px solid ${sourceMode === 'simulation' ? T.primary : T.border}`,
              color: sourceMode === 'simulation' ? '#fff' : T.textSecondary,
              borderRadius: 999,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: simulationActive ? 'pointer' : 'not-allowed',
              opacity: simulationActive ? 1 : 0.65,
            }}
          >
            Simulación activa
          </button>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ color: T.textSecondary, fontSize: 11 }}>{sourceDescription}</div>
          <div style={{ color: T.textMuted, fontSize: 10 }}>{sourceDeltaSummary}</div>
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Barrido RF/RV: RV 20% → 90% (paso 5%). Se mantiene fijo el resto de parámetros activos.
        </div>
        <div>
          <button
            type="button"
            onClick={runLightOptimization}
            disabled={running || mode !== 'light'}
            style={{
              background: running ? T.surfaceEl : T.primary,
              border: `1px solid ${running ? T.border : T.primary}`,
              color: running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: running || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: mode !== 'light' ? 0.65 : 1,
            }}
          >
            {running ? 'Analizando…' : 'Ejecutar optimización Light'}
          </button>
        </div>
      </div>

      {summary && (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {[
            { title: 'Mejor mix para maximizar éxito', point: summary.bestSuccess },
            { title: 'Mejor mix para minimizar venta de casa', point: summary.minHouseSale },
            { title: 'Mejor mix para retrasar primeras ruinas', point: summary.maxEarlyRuinDelay },
          ].map(({ title, point }) => (
            <div key={title} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 4 }}>
              <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>{title}</div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>
                RV {point.rvPct}% · RF {point.rfPct}%
              </div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Éxito 40 años: {formatPct(point.success40)}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Ruina 20 años: {formatPct(point.probRuin20)}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Venta de casa: {formatPct(point.houseSalePct)}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Primeras ruinas relevantes: {formatYears(point.earlyRuinP10)}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Rango central de ruina (P10–P90): {point.ruinCentral80}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Drawdown máximo (P50): {formatPct(point.drawdownP50)}</div>
              <div style={{ color: T.textSecondary, fontSize: 11 }}>Tiempo en recorte: {formatPct(point.cutTimeShare)}</div>
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1', color: T.textMuted, fontSize: 10 }}>
            Escaneados: {summary.scanned} mixes RF/RV.
          </div>
        </div>
      )}
    </div>
  );
}
