// App.tsx — Midas: sistema patrimonial de largo plazo
import React, { useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, LineChart, Line, ScatterChart, Scatter,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { runSimulation, runStressTest } from './domain/simulation/engine';
import { runOptimizer } from './domain/optimizer/gridSearch';
import { DEFAULT_PARAMETERS, SENSITIVITY_PARAMS, STRESS_SCENARIOS, DEFAULT_OPTIMIZER_CONSTRAINTS } from './domain/model/defaults';
import type { ModelParameters, SimulationResults, StressResult, OptimizerResult, OptimizerObjective } from './domain/model/types';

// ── Design tokens ─────────────────────────────────────────────
const T = {
  bg:            '#0E1116',
  surface:       '#151922',
  surfaceEl:     '#1B2130',
  border:        '#262C3D',
  textPrimary:   '#E8ECF3',
  textSecondary: '#A3ACBB',
  textMuted:     '#6F788A',
  primary:       '#5B8CFF',
  primaryStrong: '#3E6AE1',
  secondary:     '#8DA2FB',
  metalBase:     '#8A94A6',
  metalHi:       '#B6C0D4',
  metalDeep:     '#5F687A',
  positive:      '#3FBF7F',
  warning:       '#D4A65A',
  negative:      '#D45A5A',
  fan1:          '#1B2D55',
  fan2:          '#1E3A6E',
  fan3:          '#243F82',
};

const css = {
  app: {
    background: T.bg,
    minHeight: '100vh',
    color: T.textPrimary,
    fontFamily: '"SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
    WebkitFontSmoothing: 'antialiased' as const,
  },
  mono: { fontFamily: '"SF Mono", "Fira Code", monospace' },
};

// ── Formatters ────────────────────────────────────────────────
const f = {
  pct:  (v: number, d = 1) => `${(v * 100).toFixed(d)}%`,
  bn:   (v: number) => v >= 1e9 ? `${(v/1e9).toFixed(2)}B` : `${(v/1e6).toFixed(0)}M`,
  bnCL: (v: number) => `$${f.bn(v)}`,
  eur:  (v: number, fx: number) => `€${(v / fx / 1e6).toFixed(1)}M`,
  yr:   (m: number) => `Año ${(m/12).toFixed(1)}`,
  dp:   (v: number, d = 1) => `${(v*100).toFixed(d)}pp`,
};

// ── Hooks ─────────────────────────────────────────────────────
function useParams() {
  const [params, setParams] = useState<ModelParameters>(
    JSON.parse(JSON.stringify(DEFAULT_PARAMETERS))
  );
  const update = useCallback((path: string, value: unknown) => {
    setParams(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as ModelParameters;
      const parts = path.split('.');
      let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }, []);
  const reset = useCallback(() => setParams(JSON.parse(JSON.stringify(DEFAULT_PARAMETERS))), []);
  return { params, update, reset };
}

// ── Primitivos UI ─────────────────────────────────────────────

function Divider() {
  return <div style={{ height: 1, background: T.border, margin: '16px 0' }} />;
}

function Label({ children, level = 3 }: { children: React.ReactNode; level?: 1|2|3 }) {
  const styles = {
    1: { color: T.textPrimary, fontSize: 13, fontWeight: 600 },
    2: { color: T.textSecondary, fontSize: 12, fontWeight: 500 },
    3: { color: T.textMuted, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  };
  return <span style={styles[level]}>{children}</span>;
}

function StatusDot({ status }: { status: 'CONFIRMED'|'PRELIMINARY'|'PLACEHOLDER' }) {
  const c = { CONFIRMED: T.positive, PRELIMINARY: T.warning, PLACEHOLDER: T.negative };
  return <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: c[status], marginRight: 4 }} />;
}

// ── Hero KPI ──────────────────────────────────────────────────

function HeroKPI({
  value, label, sublabel, color = T.primary, size = 'xl'
}: {
  value: string; label: string; sublabel?: string; color?: string; size?: 'xl'|'lg';
}) {
  return (
    <div style={{ padding: '32px 0 24px' }}>
      <Label level={3}>{label}</Label>
      <div style={{
        ...css.mono,
        color,
        fontSize: size === 'xl' ? 56 : 40,
        fontWeight: 700,
        lineHeight: 1.05,
        marginTop: 8,
        letterSpacing: '-0.03em',
      }}>
        {value}
      </div>
      {sublabel && (
        <div style={{ color: T.textMuted, fontSize: 13, marginTop: 8 }}>{sublabel}</div>
      )}
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────

function MetricCard({
  label, value, sub, highlight = false, right
}: {
  label: string; value: string; sub?: string; highlight?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div style={{
      background: T.surfaceEl,
      border: `1px solid ${highlight ? T.metalDeep : T.border}`,
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    }}>
      <div>
        <Label level={3}>{label}</Label>
        <div style={{
          ...css.mono, color: T.textPrimary,
          fontSize: 20, fontWeight: 600, marginTop: 6, lineHeight: 1,
        }}>
          {value}
        </div>
        {sub && <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────

function ParamSlider({
  label, value, min, max, step, onChange, fmt: fmtFn, status = 'CONFIRMED', tooltip
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
  status?: 'CONFIRMED'|'PRELIMINARY'|'PLACEHOLDER'; tooltip?: string;
}) {
  const display = fmtFn ? fmtFn(value) : value.toString();
  return (
    <div style={{ marginBottom: 14 }} title={tooltip}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <StatusDot status={status} />
          <Label level={2}>{label}</Label>
        </div>
        <span style={{ ...css.mono, color: T.primary, fontSize: 12, fontWeight: 600 }}>
          {display}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: T.primary, cursor: 'pointer', height: 3 }}
      />
    </div>
  );
}

// ── Fan Chart ─────────────────────────────────────────────────

function MidasFanChart({ data }: { data: SimulationResults['fanChartData'] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id="gFan1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={T.fan1} stopOpacity={0.8}/>
            <stop offset="95%" stopColor={T.fan1} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
        <XAxis dataKey="year" stroke={T.border} tick={{ fill: T.textMuted, fontSize: 10 }}
               tickFormatter={v => `${v}a`} />
        <YAxis stroke={T.border} tick={{ fill: T.textMuted, fontSize: 10 }}
               tickFormatter={v => `${v}B`} width={32} />
        <Tooltip
          contentStyle={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, fontSize: 11 }}
          formatter={(v: number, n: string) => [`${v.toFixed(2)}B CLP`, n]}
          labelFormatter={v => `Año ${v}`}
        />
        <Area type="monotone" dataKey="p95" stroke="none" fill={T.fan1} fillOpacity={0.4} />
        <Area type="monotone" dataKey="p75" stroke="none" fill={T.fan2} fillOpacity={0.5} />
        <Area type="monotone" dataKey="p50" stroke={T.primary} strokeWidth={2.5} fill={T.fan3} fillOpacity={0.2} />
        <Area type="monotone" dataKey="p25" stroke="none" fill={T.bg} fillOpacity={1} />
        <Line type="monotone" dataKey="p10" stroke={T.negative} strokeWidth={1} strokeDasharray="3 3" dot={false} />
        <ReferenceLine y={0} stroke={T.negative} strokeDasharray="4 2" strokeWidth={1} />
        <ReferenceLine x={3} stroke={T.metalDeep} strokeDasharray="2 3" strokeWidth={1} />
        <ReferenceLine x={20} stroke={T.metalDeep} strokeDasharray="2 3" strokeWidth={1} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Allocation Bar ────────────────────────────────────────────

function AllocationBar({
  weights, showLabels = true, height = 8
}: {
  weights: { rvGlobal: number; rfGlobal: number; rvChile: number; rfChile: number };
  showLabels?: boolean; height?: number;
}) {
  const segments = [
    { key: 'rvGlobal', label: 'RV Global', color: T.primary,    value: weights.rvGlobal },
    { key: 'rfGlobal', label: 'RF Global', color: T.secondary,  value: weights.rfGlobal },
    { key: 'rvChile',  label: 'RV Chile',  color: T.warning,    value: weights.rvChile  },
    { key: 'rfChile',  label: 'RF Chile',  color: T.metalBase,  value: weights.rfChile  },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
        {segments.map(s => (
          <div key={s.key} style={{ width: `${s.value * 100}%`, background: s.color }} />
        ))}
      </div>
      {showLabels && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {segments.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              <span style={{ color: T.textMuted, fontSize: 10 }}>{s.label}</span>
              <span style={{ ...css.mono, color: T.textSecondary, fontSize: 10 }}>
                {(s.value * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Página: Dashboard ─────────────────────────────────────────

function Dashboard({ results, params }: { results: SimulationResults | null; params: ModelParameters }) {
  const FX = params.fx.clpUsdInitial * params.fx.usdEurFixed;
  if (!results) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '70vh', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: T.metalBase, fontSize: 40 }}>◇</div>
        <div style={{ color: T.textSecondary, fontSize: 15 }}>Configura y ejecuta la simulación</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>5.000 trayectorias · horizonte 40 años</div>
      </div>
    );
  }

  const pr  = results.probRuin;
  const pct = results.terminalWealthPercentiles;
  const rm  = results.ruinTimingMedian;
  const p50 = pct[50] || 0;
  const prColor = pr > 0.10 ? T.negative : pr > 0.06 ? T.warning : T.positive;

  return (
    <div>
      {/* Hero */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: T.border, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ background: T.surface, padding: '28px 28px 20px' }}>
          <HeroKPI
            value={f.pct(1 - pr)}
            label="Probabilidad de llegar al año 40"
            sublabel={`${results.nRuin.toLocaleString()} de ${results.nTotal.toLocaleString()} simulaciones en ruina`}
            color={prColor}
          />
        </div>
        <div style={{ background: T.surface, padding: '28px 28px 20px' }}>
          <HeroKPI
            value={f.bnCL(p50)}
            label="Patrimonio terminal — Mediana"
            sublabel={f.eur(p50, FX) + ' · poder adquisitivo hoy'}
            color={T.textPrimary}
            size="lg"
          />
        </div>
      </div>

      {/* Métricas secundarias */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        <MetricCard
          label="Prob. ruina"
          value={f.pct(pr)}
          sub={pr < 0.06 ? 'Zona segura' : pr < 0.10 ? 'Zona de atención' : 'Zona de alerta'}
          highlight={pr > 0.08}
        />
        <MetricCard
          label="Ruina — timing mediano"
          value={rm > 0 ? f.yr(rm) : '—'}
          sub={rm > 0 ? `Rango: ${f.yr(results.ruinTimingP25)}–${f.yr(results.ruinTimingP75)}` : 'Sin ruinas en este escenario'}
        />
        <MetricCard
          label="Gasto efectivo/planificado"
          value={f.pct(results.spendingRatioMedian)}
          sub="Mediana de simulaciones. Regla dinámica activa si < 100%"
        />
      </div>

      {/* Fan chart */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 20px 12px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Label level={2}>Trayectoria patrimonial — 40 años</Label>
          <div style={{ display: 'flex', gap: 12 }}>
            {[['Mediana', T.primary],['P25–P75', T.fan2],['P10', T.negative]] .map(([l, c]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 12, height: 2, background: c as string, borderRadius: 1 }} />
                <span style={{ color: T.textMuted, fontSize: 10 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
        <MidasFanChart data={results.fanChartData} />
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          {[3, 20].map(yr => (
            <div key={yr} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 1, height: 12, background: T.metalDeep }} />
              <span style={{ color: T.textMuted, fontSize: 10 }}>Año {yr} — cambio de fase</span>
            </div>
          ))}
        </div>
      </div>

      {/* Percentiles */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
        <Label level={3} >Distribución del patrimonio terminal</Label>
        <div style={{ marginTop: 14 }}>
          {[5, 10, 25, 50, 75, 90, 95].map(p => {
            const v = pct[p] || 0;
            const maxV = pct[95] || 1;
            const barW = Math.max(4, (v / maxV) * 100);
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ ...css.mono, color: T.textMuted, fontSize: 10, width: 24, textAlign: 'right' }}>P{p}</span>
                <div style={{ flex: 1, height: 6, background: T.surfaceEl, borderRadius: 3, position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${barW}%`,
                    background: p === 50 ? T.primary : p <= 25 ? T.metalDeep : T.metalBase,
                    borderRadius: 3,
                  }} />
                </div>
                <span style={{ ...css.mono, color: p === 50 ? T.primary : T.textSecondary, fontSize: 12, fontWeight: p === 50 ? 600 : 400, width: 72, textAlign: 'right' }}>
                  {f.bnCL(v)}
                </span>
                <span style={{ color: T.textMuted, fontSize: 10, width: 56, textAlign: 'right' }}>
                  {f.eur(v, FX)}
                </span>
                <span style={{ color: T.textMuted, fontSize: 10, width: 60, textAlign: 'right' }}>
                  {f.pct(results.maxDrawdownPercentiles[p] || 0)} DD
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Advertencia PLACEHOLDER */}
      {params.fx.tcrealLT !== Math.round(params.fx.tcrealLT / 10) * 10 || true ? (
        <div style={{
          marginTop: 12, background: `${T.warning}10`,
          border: `1px solid ${T.warning}30`, borderRadius: 8, padding: '10px 14px',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ color: T.warning, fontSize: 14 }}>⚠</span>
          <div>
            <span style={{ color: T.warning, fontSize: 11, fontWeight: 600 }}>
              TCREAL_LT = {params.fx.tcrealLT} — supuesto PRELIMINARY
            </span>
            <span style={{ color: T.textMuted, fontSize: 11, marginLeft: 8 }}>
              Rango calibrado: 574 (LT 2010-2024) — 727 (nivel actual). Sensibilizar antes de interpretar.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Página: Sensibilidades ────────────────────────────────────

function SensitivityPage({ params }: { params: ModelParameters }) {
  const [results, setResults] = useState<Record<string, Array<{label:string;probRuin:number;p50:number}>>>({});
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(SENSITIVITY_PARAMS[0].id);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const out: typeof results = {};
      for (const sp of SENSITIVITY_PARAMS) {
        out[sp.id] = sp.values.map((val, idx) => {
          const p = JSON.parse(JSON.stringify(params)) as ModelParameters;
          p.simulation.nSim = 1500; p.simulation.seed = 42;
          const parts = sp.paramPath.split('.');
          let obj = p as Record<string, unknown>;
          for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
          obj[parts[parts.length - 1]] = val;
          const r = runSimulation(p);
          return { label: sp.valueLabels[idx], probRuin: r.probRuin, p50: r.terminalWealthPercentiles[50] || 0 };
        });
      }
      setResults(out);
      setRunning(false);
    }, 50);
  };

  const curr = results[active] || [];
  const maxRuin = Math.max(...curr.map(r => r.probRuin), 0.01);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 600 }}>Análisis de Sensibilidad</div>
          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Impacto de cada parámetro sobre la probabilidad de ruina</div>
        </div>
        <button onClick={run} disabled={running} style={{
          background: running ? T.border : T.primaryStrong, color: running ? T.textMuted : '#fff',
          border: 'none', borderRadius: 8, padding: '8px 20px',
          cursor: running ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600,
        }}>
          {running ? '...' : 'Ejecutar'}
        </button>
      </div>

      {/* Selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {SENSITIVITY_PARAMS.map(sp => (
          <button key={sp.id} onClick={() => setActive(sp.id)} style={{
            background: active === sp.id ? T.surfaceEl : 'transparent',
            color: active === sp.id ? T.textPrimary : T.textMuted,
            border: `1px solid ${active === sp.id ? T.metalDeep : T.border}`,
            borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 11,
          }}>
            {sp.label}
          </button>
        ))}
      </div>

      {curr.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${curr.length}, 1fr)`, gap: 10, marginBottom: 24 }}>
          {curr.map(r => (
            <div key={r.label} style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 14px',
            }}>
              <Label level={3}>{r.label}</Label>
              <div style={{
                ...css.mono, marginTop: 8,
                fontSize: 28, fontWeight: 700, lineHeight: 1,
                color: r.probRuin > 0.10 ? T.negative : r.probRuin > 0.06 ? T.warning : T.positive,
              }}>
                {f.pct(r.probRuin)}
              </div>
              <div style={{ ...css.mono, color: T.textMuted, fontSize: 11, marginTop: 6 }}>
                P50: {f.bnCL(r.p50)}
              </div>
              <div style={{ marginTop: 10, height: 4, background: T.surfaceEl, borderRadius: 2 }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${(r.probRuin / maxRuin) * 100}%`,
                  background: r.probRuin > 0.10 ? T.negative : r.probRuin > 0.06 ? T.warning : T.positive,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {curr.length === 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <div style={{ color: T.textMuted, fontSize: 13 }}>Ejecuta el análisis para ver los resultados</div>
        </div>
      )}
    </div>
  );
}

// ── Página: Stress Tests ──────────────────────────────────────

function StressPage({ params }: { params: ModelParameters }) {
  const [results, setResults] = useState<StressResult[]>([]);
  const [running, setRunning] = useState(false);
  const COLORS = [T.negative, T.warning, T.positive, T.secondary];

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      setResults(STRESS_SCENARIOS.map(sc => runStressTest(params, sc)));
      setRunning(false);
    }, 50);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 600 }}>Stress Tests</div>
          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Escenarios determinísticos — trayectorias fijas</div>
        </div>
        <button onClick={run} disabled={running} style={{
          background: running ? T.border : T.primaryStrong, color: running ? T.textMuted : '#fff',
          border: 'none', borderRadius: 8, padding: '8px 20px',
          cursor: running ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600,
        }}>
          {running ? '...' : 'Ejecutar'}
        </button>
      </div>

      {results.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
            {results.map((r, i) => (
              <div key={r.scenario.id} style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${COLORS[i]}`, borderRadius: 10, padding: 18,
              }}>
                <div style={{ color: COLORS[i], fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {r.scenario.label}
                </div>
                <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 14 }}>
                  {r.scenario.description}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {[
                    ['Ruina', r.ruinMonth ? f.yr(r.ruinMonth) : 'No', r.ruinMonth ? T.negative : T.positive],
                    ['Max DD', f.pct(r.maxDrawdownReal), T.warning],
                    ['G mín', f.pct(r.minSpendingMult), T.textSecondary],
                  ].map(([l, v, c]) => (
                    <div key={l as string}>
                      <Label level={3}>{l as string}</Label>
                      <div style={{ ...css.mono, color: c as string, fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                        {v as string}
                      </div>
                    </div>
                  ))}
                </div>
                {!r.ruinMonth && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                    <Label level={3}>Patrimonio terminal</Label>
                    <div style={{ ...css.mono, color: T.textSecondary, fontSize: 13, marginTop: 4 }}>
                      {f.bnCL(r.terminalWealthReal)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Trayectorias */}
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
            <Label level={3}>Trayectorias de patrimonio real (B CLP)</Label>
            <div style={{ marginTop: 16 }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
                  <XAxis dataKey="year" type="number" domain={[0, 40]} stroke={T.border}
                         tick={{ fill: T.textMuted, fontSize: 10 }} tickFormatter={v => `${v}a`} />
                  <YAxis stroke={T.border} tick={{ fill: T.textMuted, fontSize: 10 }}
                         tickFormatter={v => `${v}B`} width={32} />
                  <Tooltip contentStyle={{ background: T.surfaceEl, border: `1px solid ${T.border}`, color: T.textPrimary, fontSize: 11 }} />
                  <ReferenceLine y={0} stroke={T.negative} strokeDasharray="3 3" />
                  {results.map((r, i) => (
                    <Line key={r.scenario.id} data={r.wealthTrajectory}
                          type="monotone" dataKey="wealth" stroke={COLORS[i]}
                          strokeWidth={1.8} dot={false} name={r.scenario.label.split(' ')[0]} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {results.length === 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <div style={{ color: T.textMuted, fontSize: 13 }}>Ejecuta los stress tests para ver las trayectorias</div>
        </div>
      )}
    </div>
  );
}

// ── Página: Optimizador ───────────────────────────────────────

function OptimizerPage({ params }: { params: ModelParameters }) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [running, setRunning] = useState(false);
  const [objective, setObjective] = useState<OptimizerObjective>('minRuin');
  const [progress, setProgress] = useState(0);

  const run = () => {
    setRunning(true); setProgress(0);
    setTimeout(() => {
      const r = runOptimizer(params, DEFAULT_OPTIMIZER_CONSTRAINTS, objective, 1000, setProgress);
      setResult(r);
      setRunning(false);
    }, 50);
  };

  const OBJECTIVES: Array<[OptimizerObjective, string, string]> = [
    ['minRuin',  'Minimizar ruina',     'Encuentra la composición con menor probabilidad de ruina'],
    ['maxP50',   'Maximizar patrimonio', 'Maximiza el patrimonio terminal esperado (P50)'],
    ['balanced', 'Equilibrado',          'Balance entre menor ruina y mayor patrimonio'],
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 600 }}>Optimizador de Portafolio</div>
        <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>
          Grid search sobre composiciones válidas · {DEFAULT_OPTIMIZER_CONSTRAINTS.step * 100}pp de paso
        </div>
      </div>

      {/* Objetivo */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <Label level={3}>Objetivo de optimización</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
          {OBJECTIVES.map(([id, label, desc]) => (
            <button key={id} onClick={() => setObjective(id)} style={{
              background: objective === id ? T.surfaceEl : 'transparent',
              border: `1px solid ${objective === id ? T.primary : T.border}`,
              borderRadius: 8, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ color: objective === id ? T.primary : T.textSecondary, fontSize: 12, fontWeight: 600 }}>{label}</div>
              <div style={{ color: T.textMuted, fontSize: 10, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Restricciones actuales */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <Label level={3}>Portafolio actual</Label>
        <div style={{ marginTop: 12 }}>
          <AllocationBar weights={params.weights} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 }}>
          {[
            ['RV Global', params.weights.rvGlobal, T.primary],
            ['RF Global', params.weights.rfGlobal, T.secondary],
            ['RV Chile', params.weights.rvChile, T.warning],
            ['RF Chile UF', params.weights.rfChile, T.metalBase],
          ].map(([l, v, c]) => (
            <div key={l as string}>
              <Label level={3}>{l as string}</Label>
              <div style={{ ...css.mono, color: c as string, fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                {f.pct(v as number)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={run} disabled={running} style={{
        width: '100%', background: running ? T.border : T.primaryStrong,
        color: running ? T.textMuted : '#fff', border: 'none', borderRadius: 10,
        padding: '14px 0', cursor: running ? 'wait' : 'pointer',
        fontSize: 14, fontWeight: 700, marginBottom: 20,
      }}>
        {running ? `Optimizando... ${progress}%` : '▶ Ejecutar optimizador'}
      </button>

      {result && (
        <>
          {/* Hero: resultado */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: T.border, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ background: T.surface, padding: '24px 24px 20px' }}>
              <Label level={3}>Prob. ruina óptima</Label>
              <div style={{ ...css.mono, fontSize: 40, fontWeight: 700, color: T.positive, marginTop: 8, lineHeight: 1 }}>
                {f.pct(result.probRuin)}
              </div>
              <div style={{
                ...css.mono, marginTop: 8, fontSize: 13,
                color: result.vsCurrentRuin < 0 ? T.positive : T.negative,
              }}>
                {result.vsCurrentRuin < 0 ? '▼' : '▲'} {f.dp(Math.abs(result.vsCurrentRuin))} vs actual
              </div>
            </div>
            <div style={{ background: T.surface, padding: '24px 24px 20px' }}>
              <Label level={3}>Patrimonio P50 óptimo</Label>
              <div style={{ ...css.mono, fontSize: 32, fontWeight: 700, color: T.textPrimary, marginTop: 8, lineHeight: 1 }}>
                {f.bnCL(result.terminalP50)}
              </div>
              <div style={{
                ...css.mono, marginTop: 8, fontSize: 13,
                color: result.vsCurrentP50 > 0 ? T.positive : T.negative,
              }}>
                {result.vsCurrentP50 > 0 ? '▲' : '▼'} {f.bnCL(Math.abs(result.vsCurrentP50))} vs actual
              </div>
            </div>
          </div>

          {/* Composición óptima */}
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <Label level={3}>Composición óptima</Label>
            <div style={{ marginTop: 12 }}>
              <AllocationBar weights={result.weights} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 }}>
              {[
                ['RV Global', result.weights.rvGlobal, params.weights.rvGlobal, T.primary],
                ['RF Global', result.weights.rfGlobal, params.weights.rfGlobal, T.secondary],
                ['RV Chile',  result.weights.rvChile,  params.weights.rvChile,  T.warning],
                ['RF Chile',  result.weights.rfChile,  params.weights.rfChile,  T.metalBase],
              ].map(([l, vOpt, vCurr, c]) => {
                const delta = (vOpt as number) - (vCurr as number);
                return (
                  <div key={l as string}>
                    <Label level={3}>{l as string}</Label>
                    <div style={{ ...css.mono, color: c as string, fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                      {f.pct(vOpt as number)}
                    </div>
                    <div style={{
                      ...css.mono, fontSize: 11, marginTop: 2,
                      color: Math.abs(delta) < 0.01 ? T.textMuted : delta > 0 ? T.positive : T.negative,
                    }}>
                      {Math.abs(delta) < 0.01 ? '—' : `${delta > 0 ? '+' : ''}${(delta*100).toFixed(0)}pp`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Movimientos recomendados */}
          {result.moves.length > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
              <Label level={3}>Movimientos recomendados</Label>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.moves.map(m => (
                  <div key={m.sleeve} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: T.surfaceEl, borderRadius: 8, padding: '10px 14px',
                  }}>
                    <span style={{
                      fontSize: 16,
                      color: m.direction === 'up' ? T.positive : m.direction === 'down' ? T.negative : T.textMuted,
                    }}>
                      {m.direction === 'up' ? '↑' : '↓'}
                    </span>
                    <span style={{ color: T.textSecondary, fontSize: 13, flex: 1 }}>{m.sleeve}</span>
                    <span style={{
                      ...css.mono, fontWeight: 700, fontSize: 14,
                      color: m.direction === 'up' ? T.positive : T.negative,
                    }}>
                      {m.delta > 0 ? '+' : ''}{m.delta.toFixed(1)}pp
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sidebar de parámetros ─────────────────────────────────────

function ParamSidebar({ params, update, reset, onRun, running }: {
  params: ModelParameters; update: (p: string, v: unknown) => void;
  reset: () => void; onRun: () => void; running: boolean;
}) {
  const totalW = Object.values(params.weights).reduce((a, b) => a + b, 0);
  const wOk = Math.abs(totalW - 1) < 0.01;

  return (
    <div style={{
      width: 264, background: T.surface, borderRight: `1px solid ${T.border}`,
      overflowY: 'auto', padding: '16px 16px 24px', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Label level={1}>Parámetros</Label>
        <button onClick={reset} style={{
          background: 'transparent', color: T.textMuted,
          border: `1px solid ${T.border}`, borderRadius: 4,
          padding: '3px 8px', cursor: 'pointer', fontSize: 10,
        }}>
          Reset
        </button>
      </div>

      {/* Capital */}
      <Label level={3}>Capital</Label>
      <div style={{ marginTop: 8, marginBottom: 20 }}>
        <ParamSlider label="Capital inicial" value={params.capitalInitial}
          min={200_000_000} max={5_000_000_000} step={50_000_000}
          onChange={v => update('capitalInitial', v)}
          fmt={v => `$${(v/1e9).toFixed(2)}B`} status="CONFIRMED" />
      </div>

      <Divider />

      {/* Portafolio */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <Label level={3}>Portafolio</Label>
        <span style={{ ...css.mono, color: wOk ? T.positive : T.negative, fontSize: 10 }}>
          {(totalW * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ marginBottom: 4 }}>
        <AllocationBar weights={params.weights} showLabels={false} height={5} />
      </div>
      <div style={{ marginTop: 12 }}>
        <ParamSlider label="RV Global" value={params.weights.rvGlobal} min={0} max={0.80} step={0.01}
          onChange={v => update('weights.rvGlobal', v)} fmt={v => `${(v*100).toFixed(0)}%`} status="CONFIRMED" />
        <ParamSlider label="RF Global USD" value={params.weights.rfGlobal} min={0} max={0.50} step={0.01}
          onChange={v => update('weights.rfGlobal', v)} fmt={v => `${(v*100).toFixed(0)}%`} status="CONFIRMED" />
        <ParamSlider label="RV Chile" value={params.weights.rvChile} min={0} max={0.60} step={0.01}
          onChange={v => update('weights.rvChile', v)} fmt={v => `${(v*100).toFixed(0)}%`} status="CONFIRMED" />
        <ParamSlider label="RF Chile UF" value={params.weights.rfChile} min={0} max={0.60} step={0.01}
          onChange={v => update('weights.rfChile', v)} fmt={v => `${(v*100).toFixed(0)}%`} status="CONFIRMED" />
      </div>

      <Divider />

      {/* Gasto */}
      <Label level={3}>Gasto</Label>
      <div style={{ marginTop: 8 }}>
        <ParamSlider label="Fase 1 — EUR/mes" value={params.spendingPhases[0].amountReal}
          min={2000} max={15000} step={500} fmt={v => `€${v.toLocaleString()}`}
          onChange={v => update('spendingPhases.0.amountReal', v)} status="CONFIRMED" />
        <ParamSlider label="Fase 2 — M CLP/mes" value={params.spendingPhases[1].amountReal}
          min={2_000_000} max={12_000_000} step={500_000}
          fmt={v => `$${(v/1e6).toFixed(1)}M`}
          onChange={v => update('spendingPhases.1.amountReal', v)} status="CONFIRMED" />
        <ParamSlider label="Fase 3 — M CLP/mes" value={params.spendingPhases[2].amountReal}
          min={1_000_000} max={8_000_000} step={500_000}
          fmt={v => `$${(v/1e6).toFixed(1)}M`}
          onChange={v => update('spendingPhases.2.amountReal', v)} status="CONFIRMED" />
      </div>

      <Divider />

      {/* Inflación */}
      <Label level={3}>Inflación</Label>
      <div style={{ marginTop: 8 }}>
        <ParamSlider label="IPC Chile" value={params.inflation.ipcChileAnnual}
          min={0.015} max={0.12} step={0.005} fmt={v => `${(v*100).toFixed(1)}%`}
          onChange={v => update('inflation.ipcChileAnnual', v)} status="CONFIRMED" />
        <ParamSlider label="HICP Eurozona" value={params.inflation.hipcEurAnnual}
          min={0.005} max={0.08} step={0.005} fmt={v => `${(v*100).toFixed(1)}%`}
          onChange={v => update('inflation.hipcEurAnnual', v)} status="PRELIMINARY" />
      </div>

      <Divider />

      {/* FX */}
      <Label level={3}>FX</Label>
      <div style={{ marginTop: 8 }}>
        <ParamSlider label="TCREAL LT (CLP/USD)" value={params.fx.tcrealLT}
          min={450} max={850} step={10} fmt={v => `${v}`}
          onChange={v => update('fx.tcrealLT', v)} status="PRELIMINARY"
          tooltip="Ancla de mean reversion. Rango: 574-727. Sensibilizar siempre." />
      </div>

      <Divider />

      {/* Simulación */}
      <Label level={3}>Simulación</Label>
      <div style={{ marginTop: 8 }}>
        <ParamSlider label="N° simulaciones" value={params.simulation.nSim}
          min={500} max={10000} step={500} fmt={v => v.toLocaleString()}
          onChange={v => update('simulation.nSim', v)} status="CONFIRMED" />
        <ParamSlider label="Block length" value={params.simulation.blockLength}
          min={3} max={24} step={1} fmt={v => `${v}m`}
          onChange={v => update('simulation.blockLength', v)} status="PRELIMINARY" />
      </div>

      <Divider />

      <button onClick={onRun} disabled={running || !wOk} style={{
        width: '100%',
        background: running || !wOk ? T.border : T.primaryStrong,
        color: running || !wOk ? T.textMuted : '#fff',
        border: 'none', borderRadius: 8, padding: '12px 0',
        cursor: running || !wOk ? 'not-allowed' : 'pointer',
        fontSize: 13, fontWeight: 700,
      }}>
        {running ? '◌ Simulando...' : '▶ Ejecutar'}
      </button>

      {!wOk && (
        <div style={{ color: T.negative, fontSize: 10, textAlign: 'center', marginTop: 6 }}>
          Los pesos deben sumar 100%
        </div>
      )}
    </div>
  );
}

// ── App principal ─────────────────────────────────────────────

const TABS = [
  { id: 'dashboard',    label: 'Dashboard' },
  { id: 'sensitivity',  label: 'Sensibilidades' },
  { id: 'stress',       label: 'Stress' },
  { id: 'optimizer',    label: 'Optimizador' },
] as const;
type TabId = typeof TABS[number]['id'];

export default function App() {
  const { params, update, reset } = useParams();
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<TabId>('dashboard');

  const run = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      setResults(runSimulation(params));
      setRunning(false);
    }, 50);
  }, [params]);

  return (
    <div style={css.app}>
      {/* Header */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: '0 24px', height: 52,
        display: 'flex', alignItems: 'center', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: T.primary, fontSize: 18, lineHeight: 1 }}>◆</span>
          <span style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Midas
          </span>
          <span style={{ color: T.metalDeep, fontSize: 11, background: T.surfaceEl, padding: '2px 6px', borderRadius: 4 }}>
            V1.2
          </span>
        </div>

        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 14px', borderRadius: 6,
              color: tab === t.id ? T.textPrimary : T.textMuted,
              background: tab === t.id ? T.surfaceEl : 'transparent' as any,
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
            }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {results && (
            <span style={{ color: T.textMuted, fontSize: 11 }}>
              {results.nTotal.toLocaleString()} sim · {results.durationMs}ms
            </span>
          )}
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: results ? T.positive : T.metalDeep,
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1 }}>
        <ParamSidebar params={params} update={update} reset={reset} onRun={run} running={running} />
        <main style={{ flex: 1, overflowY: 'auto', padding: 24, maxWidth: 900 }}>
          {tab === 'dashboard'   && <Dashboard results={results} params={params} />}
          {tab === 'sensitivity' && <SensitivityPage params={params} />}
          {tab === 'stress'      && <StressPage params={params} />}
          {tab === 'optimizer'   && <OptimizerPage params={params} />}
        </main>
      </div>
    </div>
  );
}
