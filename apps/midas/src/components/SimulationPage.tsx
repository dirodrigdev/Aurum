import React from 'react';
import type { ModelParameters, SimulationResults } from '../domain/model/types';
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

export function SimulationPage({ result, params }: { result: SimulationResults | null; params: ModelParameters }) {
  const probSuccess = result ? 1 - result.probRuin : null;
  const ruinPct = result ? result.probRuin * 100 : null;
  const ruinMedian = result?.ruinTimingMedian ?? null;
  const interval = probSuccess === null ? null : [Math.max(0, probSuccess - 0.06), Math.min(1, probSuccess + 0.06)];
  const spendRatio = result?.spendingRatioMedian ?? null;
  const p50 = result?.terminalWealthPercentiles[50] ?? null;
  const fanChartData: FanChartDatum[] = result
    ? result.fanChartData.map((point) => ({
        ...point,
        outerBase: point.p5,
        outerSpan: Math.max(0, point.p95 - point.p5),
        innerBase: point.p25,
        innerSpan: Math.max(0, point.p75 - point.p25),
      }))
    : [];
  const percentileRows = [10, 25, 50, 75, 90] as const;
  const eurRate = params.fx.clpUsdInitial * params.fx.usdEurFixed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <HeroCard
        label="¿LLEGARÁS AL AÑO 40?"
        valuePct={probSuccess}
        subtitle={result ? `${Math.round(result.nRuin)} de ${result.nTotal} simulaciones en ruina` : 'Corre una simulación para ver resultados'}
        ruinCopy={ruinMedian ? `Timing mediano Año ${(ruinMedian / 12).toFixed(1)}` : 'Timing mediano: —'}
      />

      {interval && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>RANGO ESTIMADO</div>
          <div style={{ marginTop: 10, height: 10, background: T.surfaceEl, borderRadius: 10, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                left: `${interval[0] * 100}%`,
                right: `${(1 - interval[1]) * 100}%`,
                top: 0,
                bottom: 0,
                background: T.primary,
                borderRadius: 10,
                opacity: 0.8,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, ...css.mono, color: T.textSecondary }}>
            <span>{(interval[0] * 100).toFixed(1)}%</span>
            <span>{(interval[1] * 100).toFixed(1)}%</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 8 }}>
            Refleja incertidumbre en los supuestos del modelo (±6 pp)
          </div>
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

      {result && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: '0.08em' }}>FAN CHART</div>
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
                const clp = result.terminalWealthPercentiles[p];
                const eur = clp / eurRate / 1e6;
                const dd = result.maxDrawdownPercentiles[p];
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
