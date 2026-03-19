import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelParameters, SimulationResults, ScenarioVariantId } from '../domain/model/types';
import { SCENARIO_VARIANTS } from '../domain/model/defaults';
import { runSimulation } from '../domain/simulation/engine';
import { T, css } from './theme';
import { HeroCard } from './HeroCard';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

type FanChartDatum = SimulationResults['fanChartData'][number] & {
  outerBase: number;
  outerSpan: number;
  innerBase: number;
  innerSpan: number;
};

export type SimulationOverrides = {
  active: boolean;
  returnPct?: number;
  horizonYears?: number;
  capital?: number;
  preset?: 'optimista' | 'actual' | 'pesimista' | 'custom';
};

const computeWeightedReturn = (p: ModelParameters) =>
  p.weights.rvGlobal * p.returns.rvGlobalAnnual +
  p.weights.rfGlobal * p.returns.rfGlobalAnnual +
  p.weights.rvChile * p.returns.rvChileAnnual +
  p.weights.rfChile * p.returns.rfChileUFAnnual;

const formatCapital = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const millions = value / 1_000_000;
  return `$${millions.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}MM`;
};
const formatNumber = (value: number) =>
  value.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const clampSuccessPct = (value: number) => Math.max(60, Math.min(100, value));
const ruinToSuccessPct = (probRuin: number) => clampSuccessPct((1 - probRuin) * 100);

const applyOverrides = (p: ModelParameters, overrides: SimulationOverrides | null): ModelParameters => {
  if (!overrides || !overrides.active) return p;
  const baseReturn = computeWeightedReturn(p);
  const targetReturn = overrides.returnPct ?? baseReturn;
  const factor = baseReturn > 0 ? targetReturn / baseReturn : 1;
  const horizonYears = overrides.horizonYears ?? Math.round(p.simulation.horizonMonths / 12);
  const horizonMonths = Math.max(12, Math.round(horizonYears * 12));
  return {
    ...p,
    capitalInitial: overrides.capital ?? p.capitalInitial,
    simulation: {
      ...p.simulation,
      horizonMonths,
      nSim: Math.min(1200, p.simulation.nSim),
      seed: 42,
    },
    returns: {
      ...p.returns,
      rvGlobalAnnual: p.returns.rvGlobalAnnual * factor,
      rfGlobalAnnual: p.returns.rfGlobalAnnual * factor,
      rvChileAnnual: p.returns.rvChileAnnual * factor,
      rfChileUFAnnual: p.returns.rfChileUFAnnual * factor,
    },
  };
};

export function SimulationPage({
  result,
  params,
  simOverrides,
  onScenarioChange,
  onSimOverridesChange,
  onResetSim,
}: {
  result: SimulationResults | null;
  params: ModelParameters;
  simOverrides: SimulationOverrides | null;
  onScenarioChange: (next: ScenarioVariantId) => void;
  onSimOverridesChange: (next: SimulationOverrides | null) => void;
  onResetSim: () => void;
}) {
  const [previewResult, setPreviewResult] = useState<SimulationResults | null>(null);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [showSimToast, setShowSimToast] = useState(false);
  const [activeChip, setActiveChip] = useState<'return' | 'years' | 'capital' | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const prevSimActive = useRef(false);

  const baseReturn = useMemo(() => computeWeightedReturn(params), [params]);
  const baseYears = Math.round(params.simulation.horizonMonths / 12);
  const baseCapital = params.capitalInitial;
  const effectiveReturn = simOverrides?.returnPct ?? baseReturn;
  const effectiveYears = simOverrides?.horizonYears ?? baseYears;
  const effectiveCapital = simOverrides?.capital ?? baseCapital;
  const simActive = Boolean(simOverrides?.active);

  useEffect(() => {
    if (simActive && !prevSimActive.current) {
      setShowSimToast(true);
      const timeout = window.setTimeout(() => setShowSimToast(false), 2600);
      return () => window.clearTimeout(timeout);
    }
    prevSimActive.current = simActive;
    return undefined;
  }, [simActive]);

  useEffect(() => {
    if (!simActive) {
      setPreviewResult(null);
      setPreviewRunning(false);
      return;
    }
    setPreviewRunning(true);
    const timeout = window.setTimeout(() => {
      const nextParams = applyOverrides(params, simOverrides);
      const res = runSimulation(nextParams);
      setPreviewResult(res);
      setPreviewRunning(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [params, simOverrides, simActive]);

  const displayResult = simActive ? previewResult ?? result : result;
  const probSuccess = displayResult ? 1 - displayResult.probRuin : null;
  const ruinPct = displayResult ? displayResult.probRuin * 100 : null;
  const ruinMedian = displayResult?.ruinTimingMedian ?? null;
  const uncertaintyBand = displayResult?.uncertaintyBand ?? null;
  const scenarioComparison = displayResult?.scenarioComparison ?? null;
  const activeScenario = params.activeScenario;
  const scenarioCards = scenarioComparison
    ? [
        {
          id: 'pessimistic' as const,
          label: 'Pesimista',
          point: scenarioComparison.pessimistic,
          active: activeScenario === 'pessimistic',
        },
        {
          id: 'base' as const,
          label: 'Base',
          point: scenarioComparison.base,
          active: activeScenario === 'base',
        },
        {
          id: 'optimistic' as const,
          label: 'Optimista',
          point: scenarioComparison.optimistic,
          active: activeScenario === 'optimistic',
        },
      ]
    : [];
  const scenarioBarPoints = scenarioCards.length
    ? scenarioCards.map((card) => ({
        ...card,
        successPct: ruinToSuccessPct(card.point.probRuin),
      }))
    : [];
  const spendRatio = displayResult?.spendingRatioMedian ?? null;
  const p50 = displayResult?.terminalWealthPercentiles[50] ?? null;
  const fanChartData: FanChartDatum[] = displayResult
    ? displayResult.fanChartData.map((point) => ({
        ...point,
        outerBase: point.p5,
        outerSpan: Math.max(0, point.p95 - point.p5),
        innerBase: point.p25,
        innerSpan: Math.max(0, point.p75 - point.p25),
      }))
    : [];
  const percentileRows = [10, 25, 50, 75, 90] as const;
  const eurRate = params.fx.clpUsdInitial * params.fx.usdEurFixed;

  const openChip = (chip: 'return' | 'years' | 'capital') => {
    setActiveChip(chip);
    if (chip === 'return') setDraftValue((effectiveReturn * 100).toFixed(2));
    if (chip === 'years') setDraftValue(String(effectiveYears));
    if (chip === 'capital') setDraftValue(String(Math.round(effectiveCapital)));
  };

  const applyChip = () => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      setActiveChip(null);
      return;
    }
    const next: SimulationOverrides = {
      active: true,
      returnPct: simOverrides?.returnPct ?? baseReturn,
      horizonYears: simOverrides?.horizonYears ?? baseYears,
      capital: simOverrides?.capital ?? baseCapital,
      preset: 'custom',
    };
    if (activeChip === 'return') next.returnPct = parsed / 100;
    if (activeChip === 'years') next.horizonYears = Math.max(1, Math.round(parsed));
    if (activeChip === 'capital') next.capital = Math.max(1, parsed);
    onSimOverridesChange(next);
    setActiveChip(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {SCENARIO_VARIANTS.map((variant) => {
            const active = params.activeScenario === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                onClick={() => onScenarioChange(variant.id)}
                style={{
                  background: active ? T.surfaceEl : T.surface,
                  border: `1px solid ${active ? T.primary : T.border}`,
                  color: active ? T.textPrimary : T.textMuted,
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {variant.label}
              </button>
            );
          })}
        </div>
        <HeroCard
          label="¿LLEGARÁS AL AÑO 40?"
          valuePct={probSuccess}
          subtitle={
            displayResult
              ? `${Math.round(displayResult.nRuin)} de ${displayResult.nTotal} simulaciones en ruina`
              : 'Corre una simulación para ver resultados'
          }
          ruinCopy={ruinMedian ? `Timing mediano Año ${(ruinMedian / 12).toFixed(1)}` : 'Timing mediano: —'}
          mode={simActive ? 'sim' : 'real'}
          onResetSim={simActive ? onResetSim : undefined}
          chips={[
            { id: 'return', value: `${(effectiveReturn * 100).toFixed(1)}%`, onClick: () => openChip('return') },
            { id: 'years', value: `${formatNumber(effectiveYears)} años`, onClick: () => openChip('years') },
            { id: 'capital', value: formatCapital(effectiveCapital), onClick: () => openChip('capital') },
          ]}
        />
        {showSimToast && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 6,
              background: T.surfaceEl,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '8px 12px',
              color: T.textSecondary,
              fontSize: 11,
            }}
          >
            Esta simulación no se guardará.
          </div>
        )}
        {activeChip && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: showSimToast ? 42 : 6,
              width: 320,
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 12,
              boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 8 }}>
              {activeChip === 'return'
                ? 'Retorno promedio (%)'
                : activeChip === 'years'
                  ? 'Horizonte (años)'
                  : 'Capital inicial (CLP)'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="number"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                style={{
                  flex: 1,
                  background: T.surfaceEl,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  color: T.textPrimary,
                }}
              />
              <button
                onClick={applyChip}
                style={{
                  background: T.primary,
                  border: 'none',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Aplicar
              </button>
              <button
                onClick={() => setActiveChip(null)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.border}`,
                  color: T.textSecondary,
                  borderRadius: 10,
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {previewRunning && simActive && (
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: showSimToast ? 88 : 30, color: T.textMuted, fontSize: 11 }}>
            Recalculando simulación...
          </div>
        )}
      </div>

      {displayResult && probSuccess !== null && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PROBABILIDAD DE ÉXITO</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>60%</span>
            <div style={{ position: 'relative', flex: 1, height: 8, background: T.border, borderRadius: 999 }}>
              {scenarioBarPoints.map((card) => {
                const left = clampSuccessPct(card.successPct);
                const zoneColor = card.successPct >= 90 ? T.positive : card.successPct >= 80 ? T.warning : T.negative;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onScenarioChange(card.id)}
                    title={`${card.label}: ${card.successPct.toFixed(1)}%`}
                    style={{
                      position: 'absolute',
                      left: `${((left - 60) / 40) * 100}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: card.active ? 14 : 12,
                      height: card.active ? 14 : 12,
                      borderRadius: '50%',
                      border: `2px solid ${zoneColor}`,
                      background: card.active ? zoneColor : T.surface,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                );
              })}
            </div>
            <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>100%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, ...css.mono, color: T.textSecondary }}>
            <span>Escenario pesimista</span>
            <span>Escenario base</span>
            <span>Escenario optimista</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 10 }}>
            Banda de incertidumbre (±6pp estimado):{' '}
            {uncertaintyBand ? `${(uncertaintyBand.low * 100).toFixed(0)}% — ${(uncertaintyBand.high * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
      )}

      {scenarioCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          {scenarioCards.map((card) => {
            const successPct = ruinToSuccessPct(card.point.probRuin);
            const terminalB = card.point.terminalP50 / 1e9;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onScenarioChange(card.id)}
                style={{
                  textAlign: 'left',
                  borderRadius: 14,
                  padding: 14,
                  border: `1px solid ${card.active ? T.primary : T.border}`,
                  background: card.active ? T.surfaceEl : T.surface,
                  cursor: 'pointer',
                  color: card.active ? T.textPrimary : T.textSecondary,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{card.label}</span>
                  <span style={{ ...css.mono, fontSize: 11, color: card.active ? T.primary : T.textMuted }}>
                    {successPct.toFixed(0)}%
                  </span>
                </div>
                <div style={{ marginTop: 6, ...css.mono, fontSize: 20, fontWeight: 800, color: card.active ? T.textPrimary : T.textSecondary }}>
                  ${terminalB.toFixed(1)}B
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: T.textMuted }}>
                  Ruina {(card.point.probRuin * 100).toFixed(1)}%
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
        <InfoCard
          label="Gasto efectivo / planificado"
          value={spendRatio !== null ? `${(spendRatio * 100).toFixed(1)}%` : '—'}
        />
        <InfoCard
          label="Patrimonio P50"
          value={p50 !== null ? `$${(p50 / 1e9).toFixed(2)}B` : '—'}
        />
      </div>

      {displayResult && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>FAN CHART</div>
              {simOverrides?.preset === 'custom' && <span style={{ color: T.textMuted, fontSize: 10 }}>Custom</span>}
            </div>
            <div style={{ marginTop: 8 }}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={fanChartData} margin={{ top: 8, right: 6, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: T.textMuted, fontSize: 10 }}
                    tickFormatter={(v: number | string) => `${v}a`}
                    stroke={T.border}
                  />
                  <YAxis
                    tick={{ fill: T.textMuted, fontSize: 10 }}
                    tickFormatter={(v: number | string) => `${v}B`}
                    stroke={T.border}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      color: T.textPrimary,
                      fontSize: 11,
                    }}
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)}B CLP`]}
                    labelFormatter={(label: unknown) => `Año ${String(label)}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="outerBase"
                    stackId="outer"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="outerSpan"
                    stackId="outer"
                    stroke="none"
                    fill={T.fan1}
                    fillOpacity={0.4}
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="innerBase"
                    stackId="inner"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="innerSpan"
                    stackId="inner"
                    stroke="none"
                    fill={T.fan2}
                    fillOpacity={0.5}
                    isAnimationActive={false}
                    dot={false}
                  />
                  <Line type="monotone" dataKey="p50" stroke={T.primary} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="p10" stroke={T.negative} strokeWidth={1} strokeDasharray="3 3" dot={false} />
                  <ReferenceLine y={0} stroke={T.negative} strokeDasharray="4 2" />
                  <ReferenceLine x={3} stroke={T.metalDeep} strokeDasharray="2 3" label={{ value: 'Fase 1', fill: T.textMuted, fontSize: 9 }} />
                  <ReferenceLine x={20} stroke={T.metalDeep} strokeDasharray="2 3" label={{ value: 'Fase 2', fill: T.textMuted, fontSize: 9 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8, color: T.textSecondary, fontSize: 11 }}>
              <span>Año 3 - fin gasto EUR</span>
              <span>Año 20 - fin Fase 2</span>
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PERCENTILES</div>
            <div style={{ marginTop: 8, overflow: 'hidden', border: `1px solid ${T.border}`, borderRadius: 10 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '56px repeat(3, minmax(0, 1fr))',
                  gap: 0,
                  background: T.surfaceEl,
                  color: T.textMuted,
                  fontSize: 11,
                  padding: '10px 12px',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span>P</span>
                <span>CLP real</span>
                <span>EUR equiv</span>
                <span>DD máx</span>
              </div>
              {percentileRows.map((p) => {
                const clp = displayResult.terminalWealthPercentiles[p];
                const eur = clp / eurRate / 1e6;
                const dd = displayResult.maxDrawdownPercentiles[p];
                const highlight = p === 50;
                return (
                  <div
                    key={p}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '56px repeat(3, minmax(0, 1fr))',
                      gap: 0,
                      padding: '10px 12px',
                      background: highlight ? 'rgba(91, 140, 255, 0.10)' : T.surface,
                      borderBottom: p === 90 ? 'none' : `1px solid ${T.border}`,
                      color: highlight ? T.primary : T.textPrimary,
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: highlight ? T.primary : T.textMuted }}>P{p}</span>
                    <span style={{ ...css.mono, fontWeight: 700 }}>{`$${(clp / 1e9).toFixed(2)}B`}</span>
                    <span style={{ ...css.mono }}>{`€${eur.toFixed(1)}M`}</span>
                    <span style={{ ...css.mono }}>{`${(dd * 100).toFixed(1)}%`}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em', marginBottom: 4 }}>TCREAL</div>
            <div style={{ color: T.warning, fontSize: 12 }}>
              PRELIMINARY: Este parámetro usa supuestos internos, revísalo antes de tomar decisiones.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, fontSize: 18, fontWeight: 700, color: T.textPrimary, marginTop: 6 }}>{value}</div>
    </div>
  );
}
