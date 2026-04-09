import React, { useCallback, useMemo, useState } from 'react';
import type { ModelParameters, PortfolioWeights, SimulationResults } from '../domain/model/types';
import { runSimulationCentral } from '../domain/simulation/engineCentral';
import { T } from './theme';

type OptimizationMode = 'light' | 'normal' | 'decision';
type SourceMode = 'base' | 'simulation';

type Phase1Point = {
  rvPct: number;
  rfPct: number;
  success40: number;
  ruin20: number;
  ruinP10: number | null;
  drawdownP50: number;
  terminalP50All: number | null;
  terminalP50Survivors: number | null;
  weights: PortfolioWeights;
};

type Phase2Point = {
  source: Phase1Point;
  success40Assisted: number;
  ruin20Assisted: number;
  houseSalePct: number;
  houseSaleYearP50: number | null;
  cutScenarioPct: number | null;
  cutSeverityMean: number | null;
  firstCutYearP50: number | null;
  terminalP50All: number | null;
  terminalP50Survivors: number | null;
  drawdownP50: number;
};

const SHORTLIST_BEST_SUCCESS_BAND = 0.015;
const SHORTLIST_MIN_RV_DISTANCE = 10;
const SHORTLIST_TARGET = 5;

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

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-CL', { maximumFractionDigits: 0 });
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

function buildCandidateWeights(currentWeights: PortfolioWeights, rvPct: number): PortfolioWeights {
  const globalShare = Math.max(0, Math.min(1, (currentWeights.rvGlobal + currentWeights.rfGlobal) || 0.5));
  const localShare = Math.max(0, Math.min(1, 1 - globalShare));
  const rv = rvPct / 100;
  const rf = 1 - rv;
  return {
    rvGlobal: rv * globalShare,
    rvChile: rv * localShare,
    rfGlobal: rf * globalShare,
    rfChile: rf * localShare,
  };
}

function toPhase1Point(rvPct: number, weights: PortfolioWeights, sim: SimulationResults): Phase1Point {
  return {
    rvPct,
    rfPct: Math.round((1 - (rvPct / 100)) * 100),
    success40: sim.success40 ?? (1 - (sim.probRuin40 ?? sim.probRuin)),
    ruin20: sim.probRuin20 ?? 0,
    ruinP10: Number.isFinite(sim.ruinTimingP10 ?? Number.NaN) ? (sim.ruinTimingP10 as number) : null,
    drawdownP50: sim.maxDrawdownPercentiles[50] ?? 0,
    terminalP50All: sim.p50TerminalAllPaths ?? null,
    terminalP50Survivors: sim.p50TerminalSurvivors ?? null,
    weights,
  };
}

function buildAutonomousParams(params: ModelParameters): ModelParameters {
  const next = cloneParams(params);
  next.realEstatePolicy = {
    ...(next.realEstatePolicy ?? {
      enabled: false,
      triggerRunwayMonths: 36,
      saleDelayMonths: 12,
      saleCostPct: 0,
      realAppreciationAnnual: 0,
    }),
    enabled: false,
  };
  next.spendingRule = {
    ...next.spendingRule,
    softCut: 1,
    hardCut: 1,
    dd15Threshold: 10,
    dd25Threshold: 10,
    consecutiveMonths: 999,
  };
  if (next.simulationComposition?.nonOptimizable?.riskCapital) {
    next.simulationComposition.nonOptimizable.riskCapital = {
      ...next.simulationComposition.nonOptimizable.riskCapital,
      totalCLP: 0,
      clp: 0,
      usd: 0,
      usdTotal: 0,
      source: 'autonomous_phase1_disabled',
    };
  }
  return next;
}

function buildShortlist(points: Phase1Point[]): Phase1Point[] {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => (
    (b.success40 - a.success40)
      || ((b.ruinP10 ?? Number.NEGATIVE_INFINITY) - (a.ruinP10 ?? Number.NEGATIVE_INFINITY))
      || (a.ruin20 - b.ruin20)
      || (a.drawdownP50 - b.drawdownP50)
  ));
  const bestSuccess = sorted[0].success40;
  const candidatePool = sorted.filter((point) => point.success40 >= bestSuccess - SHORTLIST_BEST_SUCCESS_BAND);
  const shortlist: Phase1Point[] = [];

  for (const point of candidatePool) {
    if (shortlist.length >= SHORTLIST_TARGET) break;
    const hasNearbyMix = shortlist.some((chosen) => Math.abs(chosen.rvPct - point.rvPct) < SHORTLIST_MIN_RV_DISTANCE);
    if (!hasNearbyMix) shortlist.push(point);
  }

  if (shortlist.length < 3) {
    for (const point of sorted) {
      if (shortlist.length >= 3) break;
      const alreadyIncluded = shortlist.some((chosen) => chosen.rvPct === point.rvPct);
      if (!alreadyIncluded) shortlist.push(point);
    }
  }

  if (shortlist.length < SHORTLIST_TARGET) {
    for (const point of sorted) {
      if (shortlist.length >= SHORTLIST_TARGET) break;
      const alreadyIncluded = shortlist.some((chosen) => chosen.rvPct === point.rvPct);
      if (!alreadyIncluded) shortlist.push(point);
    }
  }

  return shortlist;
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
  const [phase1Running, setPhase1Running] = useState(false);
  const [phase2Running, setPhase2Running] = useState(false);
  const [phase1Points, setPhase1Points] = useState<Phase1Point[]>([]);
  const [shortlist, setShortlist] = useState<Phase1Point[]>([]);
  const [phase2Rows, setPhase2Rows] = useState<Phase2Point[]>([]);

  const activeParams = sourceMode === 'simulation' && simulationActive ? simulationParams : baseParams;
  const activeLabel = sourceMode === 'simulation' && simulationActive ? (simulationLabel ?? 'Simulación activa') : 'Base vigente';
  const sourceDescription = sourceMode === 'simulation' && simulationActive
    ? 'Simulación activa: usa los cambios temporales que estás probando'
    : 'Base vigente: usa la configuración persistida del caso';
  const sourceDeltaSummary = sourceMode === 'simulation' && simulationActive
    ? buildDeltaSummary(baseParams, simulationParams)
    : 'Sin cambios temporales respecto de la base vigente';

  const runPhase1 = useCallback(async () => {
    if (phase1Running) return;
    setPhase1Running(true);
    setPhase1Points([]);
    setShortlist([]);
    setPhase2Rows([]);
    try {
      const autonomousBase = buildAutonomousParams(activeParams);
      const points: Phase1Point[] = [];
      for (let rvPct = 20; rvPct <= 90; rvPct += 5) {
        const candidate = cloneParams(autonomousBase);
        const nextWeights = buildCandidateWeights(autonomousBase.weights, rvPct);
        candidate.weights = nextWeights;
        const sim = runSimulationCentral(candidate);
        points.push(toPhase1Point(rvPct, nextWeights, sim));
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      setPhase1Points(points);
      setShortlist(buildShortlist(points));
    } finally {
      setPhase1Running(false);
    }
  }, [activeParams, phase1Running]);

  const runPhase2 = useCallback(async () => {
    if (phase2Running || !shortlist.length) return;
    setPhase2Running(true);
    setPhase2Rows([]);
    try {
      const rows: Phase2Point[] = [];
      for (const point of shortlist) {
        const assistedParams = cloneParams(activeParams);
        assistedParams.weights = point.weights;
        const sim = runSimulationCentral(assistedParams);
        rows.push({
          source: point,
          success40Assisted: sim.success40 ?? (1 - (sim.probRuin40 ?? sim.probRuin)),
          ruin20Assisted: sim.probRuin20 ?? 0,
          houseSalePct: sim.houseSalePct ?? 0,
          houseSaleYearP50: Number.isFinite(sim.saleYearMedian ?? Number.NaN) ? (sim.saleYearMedian as number) : null,
          cutScenarioPct: Number.isFinite(sim.cutScenarioPct ?? Number.NaN) ? (sim.cutScenarioPct as number) : null,
          cutSeverityMean: Number.isFinite(sim.cutSeverityMean ?? Number.NaN) ? (sim.cutSeverityMean as number) : null,
          firstCutYearP50: Number.isFinite(sim.firstCutYearMedian ?? Number.NaN) ? (sim.firstCutYearMedian as number) : null,
          terminalP50All: sim.p50TerminalAllPaths ?? null,
          terminalP50Survivors: sim.p50TerminalSurvivors ?? null,
          drawdownP50: sim.maxDrawdownPercentiles[50] ?? 0,
        });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      setPhase2Rows(rows);
    } finally {
      setPhase2Running(false);
    }
  }, [activeParams, phase2Running, shortlist]);

  const modeCards = useMemo(
    () => ([
      { id: 'light', label: 'Light', active: mode === 'light', enabled: true, hint: 'Fase 1 + Fase 2' },
      { id: 'normal', label: 'Normal', active: mode === 'normal', enabled: false, hint: 'Próximamente' },
      { id: 'decision', label: 'Decisión', active: mode === 'decision', enabled: false, hint: 'Próximamente' },
    ] as const),
    [mode],
  );

  const phase1BestSuccess = useMemo(() => (
    phase1Points.length ? Math.max(...phase1Points.map((p) => p.success40)) : null
  ), [phase1Points]);

  const classifyRescueDependency = useCallback((row: Phase2Point): string => {
    const house = row.houseSalePct;
    const cut = row.cutScenarioPct ?? 0;
    if (house > 0.30 || cut > 0.35) return 'Dependencia alta de rescates';
    if (house > 0.15 || cut > 0.20) return 'Dependencia media de rescates';
    return 'Dependencia baja de rescates';
  }, []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Optimización</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Fase 1: optimización autónoma del portafolio. Fase 2: validación del shortlist en el modelo completo.
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
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>Fase 1 · Portafolio autónomo</div>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Sweep RF/RV (20% a 90%, paso 5) para elegir política de inversión por sí sola, sin casa y con cuts neutralizados de forma controlada.
        </div>
        <div style={{ color: T.textMuted, fontSize: 10 }}>
          En esta fase se apaga la venta de casa y se desactiva capital de riesgo. Los cuts se neutralizan vía parámetros (floors=1 y umbrales extremos) usando el mismo motor M8.
        </div>
        <div>
          <button
            type="button"
            onClick={runPhase1}
            disabled={phase1Running || mode !== 'light'}
            style={{
              background: phase1Running ? T.surfaceEl : T.primary,
              border: `1px solid ${phase1Running ? T.border : T.primary}`,
              color: phase1Running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: phase1Running || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: mode !== 'light' ? 0.65 : 1,
            }}
          >
            {phase1Running ? 'Ejecutando Fase 1…' : 'Ejecutar Fase 1'}
          </button>
        </div>

        {shortlist.length > 0 && (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {shortlist.map((point) => (
              <div key={`phase1-${point.rvPct}`} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 4 }}>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>RV {point.rvPct}% · RF {point.rfPct}%</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Éxito40 autónomo: {formatPct(point.success40)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Ruina20 autónoma: {formatPct(point.ruin20)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Primeras ruinas (P10): {formatYears(point.ruinP10)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>MaxDD P50: {formatPct(point.drawdownP50)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Terminal P50 (all): {formatMoney(point.terminalP50All)}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', color: T.textMuted, fontSize: 10 }}>
              Shortlist: {shortlist.length} mixes ({phase1Points.length} evaluados) · banda de éxito {Math.round(SHORTLIST_BEST_SUCCESS_BAND * 1000) / 10}pp · diversidad mínima {SHORTLIST_MIN_RV_DISTANCE}pp en RV.
              {phase1BestSuccess !== null ? ` Mejor éxito autónomo: ${formatPct(phase1BestSuccess)}.` : ''}
            </div>
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>Fase 2 · Validación modelo completo</div>
        <div style={{ color: T.textSecondary, fontSize: 12 }}>
          Evalúa el shortlist de Fase 1 con el modelo completo (casa + cuts + protecciones activas). Esta fase no reoptimiza: solo valida costo de supervivencia.
        </div>
        <div>
          <button
            type="button"
            onClick={runPhase2}
            disabled={phase2Running || !shortlist.length || mode !== 'light'}
            style={{
              background: phase2Running ? T.surfaceEl : T.primary,
              border: `1px solid ${phase2Running ? T.border : T.primary}`,
              color: phase2Running ? T.textMuted : '#fff',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: phase2Running || !shortlist.length || mode !== 'light' ? 'not-allowed' : 'pointer',
              opacity: (!shortlist.length || mode !== 'light') ? 0.65 : 1,
            }}
          >
            {phase2Running ? 'Ejecutando Fase 2…' : 'Ejecutar Fase 2'}
          </button>
        </div>

        {phase2Rows.length > 0 && (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {phase2Rows.map((row) => (
              <div key={`phase2-${row.source.rvPct}`} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 12, padding: 10, display: 'grid', gap: 4 }}>
                <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>RV {row.source.rvPct}% · RF {row.source.rfPct}%</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Éxito40 asistido: {formatPct(row.success40Assisted)} ({row.success40Assisted >= row.source.success40 ? '+' : ''}{((row.success40Assisted - row.source.success40) * 100).toFixed(1)}pp vs autónomo)</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Ruina20 asistida: {formatPct(row.ruin20Assisted)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Venta de casa: {formatPct(row.houseSalePct)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Año venta P50: {formatYears(row.houseSaleYearP50)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Escenarios con cuts: {row.cutScenarioPct !== null ? formatPct(row.cutScenarioPct) : 'No disponible'}
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>
                  Recorte medio: {row.cutSeverityMean !== null ? formatPct(row.cutSeverityMean) : 'No disponible'}
                </div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Primer cut año P50: {formatYears(row.firstCutYearP50)}</div>
                <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700 }}>{classifyRescueDependency(row)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Terminal P50 (all): {formatMoney(row.terminalP50All)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>Terminal P50 (survivors): {formatMoney(row.terminalP50Survivors)}</div>
                <div style={{ color: T.textSecondary, fontSize: 11 }}>MaxDD P50: {formatPct(row.drawdownP50)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
