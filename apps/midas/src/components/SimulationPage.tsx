import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ModelParameters, SimulationResults, ScenarioVariantId } from '../domain/model/types';
import { SCENARIO_VARIANTS } from '../domain/model/defaults';
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

export type SimulationPreset = ScenarioVariantId | 'custom';

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

const formatMillionsMM = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const decimals = value !== 0 && Math.abs(value) < 1000 ? 1 : 0;
  return `${value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}MM`;
};
const formatCapital = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  return `$${formatMillionsMM(value / 1_000_000)}`;
};
const formatNumber = (value: number) =>
  value.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const ruinToSuccessPct = (probRuin: number) => (1 - probRuin) * 100;

export function SimulationPage({
  resultCentral,
  resultFavorable,
  resultPrudent,
  params,
  simOverrides,
  simActive,
  simulationPreset,
  onSimulationTouch,
  onScenarioChange,
  onSimOverridesChange,
  onResetSim,
}: {
  resultCentral: SimulationResults | null;
  resultFavorable: SimulationResults | null;
  resultPrudent: SimulationResults | null;
  params: ModelParameters;
  simOverrides: SimulationOverrides | null;
  simActive: boolean;
  simulationPreset: SimulationPreset;
  onSimulationTouch: (next?: SimulationPreset) => void;
  onScenarioChange: (next: ScenarioVariantId) => void;
  onSimOverridesChange: (next: SimulationOverrides | null) => void;
  onResetSim: () => void;
}) {
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

  useEffect(() => {
    if (simActive && !prevSimActive.current) {
      setShowSimToast(true);
      const timeout = window.setTimeout(() => setShowSimToast(false), 2600);
      return () => window.clearTimeout(timeout);
    }
    prevSimActive.current = simActive;
    return undefined;
  }, [simActive]);

  useLayoutEffect(() => {
    if (!simActive) {
      setActiveChip(null);
      setDraftValue('');
    }
  }, [simActive]);

  const displayResult = resultCentral;
  const probSuccess = displayResult ? 1 - displayResult.probRuin : null;
  const ruinMedian = displayResult?.ruinTimingMedian ?? null;
  const plausibleLow = resultPrudent ? ruinToSuccessPct(resultPrudent.probRuin) : null;
  const plausibleHigh = resultFavorable ? ruinToSuccessPct(resultFavorable.probRuin) : null;
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
  const fanChartYears = displayResult ? Math.max(5, Math.ceil((displayResult.fanChartData.at(-1)?.year ?? 40) / 5) * 5) : 40;
  const fanChartTicks = Array.from({ length: Math.floor(fanChartYears / 5) }, (_, idx) => (idx + 1) * 5);
  const scenarioSuccessValues = SCENARIO_VARIANTS.map((variant) => {
    const key = variant.id === 'pessimistic'
      ? 'pessimistic'
      : variant.id === 'optimistic'
        ? 'optimistic'
        : 'base';
    const scenario = displayResult?.scenarioComparison?.[key];
    return scenario ? ruinToSuccessPct(scenario.probRuin) : null;
  }).filter((value): value is number => value !== null);
  const successValues = [
    ...scenarioSuccessValues,
    plausibleLow,
    plausibleHigh,
    probSuccess !== null ? probSuccess * 100 : null,
  ].filter((value): value is number => Number.isFinite(value));
  const axisMinCandidate = successValues.length
    ? Math.max(0, Math.floor((Math.min(...successValues) - 5) / 5) * 5)
    : 60;
  const axisMaxCandidate = successValues.length
    ? Math.min(100, Math.ceil((Math.max(...successValues) + 5) / 5) * 5)
    : 100;
  const successAxisMin = Math.max(0, Math.min(axisMinCandidate, axisMaxCandidate - 5));
  const successAxisMax = Math.min(100, Math.max(axisMaxCandidate, successAxisMin + 5));
  const successAxisSpan = Math.max(1, successAxisMax - successAxisMin);
  const mapSuccessPct = (value: number) =>
    Math.min(100, Math.max(0, ((value - successAxisMin) / successAxisSpan) * 100));
  const openChip = (chip: 'return' | 'years' | 'capital') => {
    onSimulationTouch('custom');
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
              background: 'rgba(21, 25, 34, 0.98)',
              border: `1px solid rgba(91, 140, 255, 0.26)`,
              borderRadius: 12,
              padding: 12,
              boxShadow: '0 18px 34px rgba(0,0,0,0.36)',
              backdropFilter: 'blur(10px)',
              zIndex: 40,
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
      </div>

      {displayResult && probSuccess !== null && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>PROBABILIDAD DE ÉXITO</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{`${Math.round(successAxisMin)}%`}</span>
            <div style={{ position: 'relative', flex: 1, height: 8, background: T.border, borderRadius: 999 }}>
              {plausibleLow !== null && plausibleHigh !== null && (() => {
                const left = mapSuccessPct(plausibleLow);
                const right = mapSuccessPct(plausibleHigh);
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${Math.min(left, right)}%`,
                      width: `${Math.max(0, Math.abs(right - left))}%`,
                      top: 0,
                      bottom: 0,
                      background: 'rgba(91, 140, 255, 0.22)',
                      borderRadius: 999,
                    }}
                  />
                );
              })()}
              {SCENARIO_VARIANTS.map((variant) => {
                const scenario = displayResult.scenarioComparison?.[variant.id === 'pessimistic' ? 'pessimistic' : variant.id === 'optimistic' ? 'optimistic' : 'base'];
                const point = scenario ?? null;
                const successPct = point ? ruinToSuccessPct(point.probRuin) : 0;
                const left = mapSuccessPct(successPct);
                const zoneColor = successPct >= 90 ? T.positive : successPct >= 80 ? T.warning : T.negative;
                const active = simulationPreset !== 'custom' && variant.id === simulationPreset;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => onScenarioChange(variant.id)}
                    title={`${variant.label}: ${successPct.toFixed(1)}%`}
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: active ? 14 : 12,
                      height: active ? 14 : 12,
                      borderRadius: '50%',
                      border: `2px solid ${zoneColor}`,
                      background: active ? zoneColor : T.surface,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                );
              })}
            </div>
            <span style={{ color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{`${Math.round(successAxisMax)}%`}</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 10 }}>
            Rango plausible:{' '}
            {plausibleLow !== null && plausibleHigh !== null
              ? `${Math.min(plausibleLow, plausibleHigh).toFixed(0)}% — ${Math.max(plausibleLow, plausibleHigh).toFixed(0)}%`
              : '—'}{' '}
            <span style={{ color: T.textMuted }}>Favorable ↔ Prudente</span>
          </div>
        </div>
      )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
        <InfoCard
          label="Gasto modelado / planificado"
          value={spendRatio !== null ? `${(spendRatio * 100).toFixed(1)}%` : '—'}
        />
          <InfoCard
            label="Patrimonio P50"
            value={p50 !== null ? `$${formatMillionsMM(p50 / 1e6)}` : '—'}
          />
        </div>

      {displayResult && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>FAN CHART</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', flex: 1 }}>
                {[SCENARIO_VARIANTS[1], SCENARIO_VARIANTS[0], SCENARIO_VARIANTS[2]].map((variant) => {
                  const isBase = variant.id === 'base';
                  const active = simulationPreset === variant.id;
                  const custom = simulationPreset === 'custom';
                  const highlightedReset = isBase && custom;
                  const working = false;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => onScenarioChange(variant.id)}
                      style={{
                        background: active
                          ? T.primary
                          : highlightedReset
                            ? 'rgba(91, 140, 255, 0.12)'
                            : T.surfaceEl,
                        border: highlightedReset
                          ? `2px solid rgba(91, 140, 255, 0.72)`
                          : `1px solid ${active ? T.primary : T.border}`,
                        color: active || highlightedReset ? T.textPrimary : T.textSecondary,
                        fontSize: 11,
                        padding: '5px 10px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        opacity: custom && !isBase ? 0.45 : 1,
                        boxShadow: highlightedReset ? 'inset 0 0 0 1px rgba(91, 140, 255, 0.25)' : working ? '0 0 0 2px rgba(91, 140, 255, 0.28)' : 'none',
                      }}
                    >
                      {variant.label}
                    </button>
                  );
                })}
                {simulationPreset === 'custom' && (
                  <span style={{ color: T.textMuted, fontSize: 10, alignSelf: 'center' }}>Custom</span>
                )}
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={fanChartData} margin={{ top: 8, right: 6, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                  <XAxis
                    dataKey="year"
                    type="number"
                    domain={[0, fanChartYears]}
                    ticks={fanChartTicks}
                    tick={{ fill: T.textMuted, fontSize: 10 }}
                    tickFormatter={(v: number | string) => String(v)}
                    stroke={T.border}
                    tickMargin={8}
                    label={{ value: 'Años', position: 'insideBottom', offset: -2, fill: T.textMuted, fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: T.textMuted, fontSize: 10 }}
                    tickFormatter={(v: number | string) => formatMillionsMM(Number(v))}
                    stroke={T.border}
                    width={46}
                  />
                  <Tooltip
                    contentStyle={{
                      background: T.surfaceEl,
                      border: `1px solid ${T.border}`,
                      color: T.textPrimary,
                      fontSize: 11,
                    }}
                    formatter={(value: unknown) => [`${formatMillionsMM(Number(value))} CLP`]}
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
                  <ReferenceLine x={5} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={10} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={15} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={20} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={25} stroke={T.metalDeep} strokeDasharray="2 3" />
                  <ReferenceLine x={30} stroke={T.metalDeep} strokeDasharray="2 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8, color: T.textSecondary, fontSize: 11 }}>
              <span>Años en cortes de 5</span>
              <span>Fases marcadas en la barra</span>
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
                  <span style={{ ...css.mono, fontWeight: 700 }}>{`$${formatMillionsMM(clp / 1e6)}`}</span>
                  <span style={{ ...css.mono }}>{`€${formatMillionsMM(eur)}`}</span>
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
