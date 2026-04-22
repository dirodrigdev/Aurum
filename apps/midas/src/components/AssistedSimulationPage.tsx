import React, { useMemo, useState } from 'react';
import { runAssistedSimulation, ASSISTED_FUND_OPTIONS, type AssistedFundId, type AssistedInputs, type AssistedOptimizationResult } from '../domain/simulation/assistedSimulation';
import { T } from './theme';

const formatMoney = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}MM`;
  return `$${Math.round(value).toLocaleString('es-CL')}`;
};

const formatPct = (value: number): string => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

const defaultInputs: AssistedInputs = {
  initialCapitalClp: 1_500_000_000,
  extraContributionEnabled: false,
  extraContributionClp: 100_000_000,
  extraContributionYear: 5,
  horizonYears: 40,
  spendingMode: 'fixed',
  fixedMonthlyClp: 6_000_000,
  phase1MonthlyClp: 6_000_000,
  phase1Years: 10,
  phase2MonthlyClp: 4_000_000,
  portfolioMode: 'optimize',
  manualRvPct: 60,
  selectedFunds: [],
  includeTwoOfThreeCheck: true,
  successThreshold: 0.85,
  gridStepPct: 5,
  nSim: 1000,
  seed: 42,
};

const mixLabel = (weights: AssistedOptimizationResult['best']['weights']): string =>
  `RV ${(weights.rvGlobal + weights.rvChile) * 100 >= 0 ? ((weights.rvGlobal + weights.rvChile) * 100).toFixed(1) : '0.0'}% · RF ${((weights.rfGlobal + weights.rfChile) * 100).toFixed(1)}%`;

function MiniFanChart({ data }: { data: Array<{ year: number; p50: number }> }) {
  const width = 540;
  const height = 170;
  if (!data || data.length < 2) {
    return <div style={{ color: T.textMuted, fontSize: 12 }}>Sin trayectoria suficiente para graficar.</div>;
  }
  const xs = data.map((p) => p.year);
  const ys = data.map((p) => p.p50);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(1e-9, maxX - minX);
  const rangeY = Math.max(1e-9, maxY - minY);
  const points = data
    .map((p) => {
      const x = ((p.year - minX) / rangeX) * (width - 24) + 12;
      const y = height - 12 - ((p.p50 - minY) / rangeY) * (height - 24);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: 'block', background: T.surfaceEl, borderRadius: 10, border: `1px solid ${T.border}` }}>
      <line x1={12} y1={height - 12} x2={width - 12} y2={height - 12} stroke={T.border} strokeWidth="1" />
      <line x1={12} y1={12} x2={12} y2={height - 12} stroke={T.border} strokeWidth="1" />
      <polyline fill="none" stroke={T.primary} strokeWidth="2.5" points={points} />
    </svg>
  );
}

export function AssistedSimulationPage() {
  const [inputs, setInputs] = useState<AssistedInputs>(defaultInputs);
  const [result, setResult] = useState<AssistedOptimizationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(inputs.selectedFunds), [inputs.selectedFunds]);

  const updateInput = <K extends keyof AssistedInputs>(key: K, value: AssistedInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const toggleFund = (fundId: AssistedFundId) => {
    setInputs((prev) => {
      const next = new Set(prev.selectedFunds);
      if (next.has(fundId)) next.delete(fundId);
      else {
        if (next.size >= 3) return prev;
        next.add(fundId);
      }
      return { ...prev, selectedFunds: [...next] as AssistedFundId[] };
    });
  };

  const run = () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const output = runAssistedSimulation(inputs);
      setResult(output);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
        <div style={{ color: T.textPrimary, fontWeight: 800, fontSize: 18 }}>Simulación Asistida</div>
        <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Hoja separada para escenarios asesoría, usando motor M8 real.</div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Capital y horizonte</div>
        <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
          Capital inicial (CLP)
          <input type="number" value={inputs.initialCapitalClp} onChange={(e) => updateInput('initialCapitalClp', Number(e.target.value) || 0)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
        </label>
        <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
          Horizonte (años)
          <input type="number" min={4} max={60} value={inputs.horizonYears} onChange={(e) => updateInput('horizonYears', Number(e.target.value) || 40)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: T.textPrimary, fontSize: 12 }}>
          <input type="checkbox" checked={inputs.extraContributionEnabled} onChange={(e) => updateInput('extraContributionEnabled', e.target.checked)} />
          Aporte único adicional
        </label>
        {inputs.extraContributionEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Monto (CLP)
              <input type="number" value={inputs.extraContributionClp} onChange={(e) => updateInput('extraContributionClp', Number(e.target.value) || 0)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Año aporte
              <input type="number" min={0} max={40} value={inputs.extraContributionYear} onChange={(e) => updateInput('extraContributionYear', Number(e.target.value) || 0)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
            </label>
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Gasto</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ color: T.textPrimary, fontSize: 12 }}><input type="radio" checked={inputs.spendingMode === 'fixed'} onChange={() => updateInput('spendingMode', 'fixed')} /> Fijo mensual</label>
          <label style={{ color: T.textPrimary, fontSize: 12 }}><input type="radio" checked={inputs.spendingMode === 'two_phase'} onChange={() => updateInput('spendingMode', 'two_phase')} /> Dos fases</label>
        </div>
        {inputs.spendingMode === 'fixed' ? (
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Gasto mensual objetivo (CLP)
            <input type="number" value={inputs.fixedMonthlyClp} onChange={(e) => updateInput('fixedMonthlyClp', Number(e.target.value) || 0)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
          </label>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Fase 1 mensual
              <input type="number" value={inputs.phase1MonthlyClp} onChange={(e) => updateInput('phase1MonthlyClp', Number(e.target.value) || 0)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Fase 1 años
              <input type="number" min={1} max={40} value={inputs.phase1Years} onChange={(e) => updateInput('phase1Years', Number(e.target.value) || 1)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Fase 2 mensual
              <input type="number" value={inputs.phase2MonthlyClp} onChange={(e) => updateInput('phase2MonthlyClp', Number(e.target.value) || 0)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
            </label>
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Portafolio</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ color: T.textPrimary, fontSize: 12 }}><input type="radio" checked={inputs.portfolioMode === 'manual'} onChange={() => updateInput('portfolioMode', 'manual')} /> Manual</label>
          <label style={{ color: T.textPrimary, fontSize: 12 }}><input type="radio" checked={inputs.portfolioMode === 'optimize'} onChange={() => updateInput('portfolioMode', 'optimize')} /> Optimizar</label>
        </div>
        {inputs.portfolioMode === 'manual' ? (
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            RV % (RF es complemento)
            <input type="range" min={0} max={100} step={1} value={inputs.manualRvPct} onChange={(e) => updateInput('manualRvPct', Number(e.target.value) || 0)} />
            <span style={{ color: T.textMuted }}>RV {inputs.manualRvPct}% · RF {100 - inputs.manualRvPct}%</span>
          </label>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ color: T.textMuted, fontSize: 12 }}>
              Fondos específicos (0, 2 o 3). Si dejas 0, optimiza solo RF/RV.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {ASSISTED_FUND_OPTIONS.map((fund) => (
                <label key={fund.id} style={{ color: T.textPrimary, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(fund.id)}
                    onChange={() => toggleFund(fund.id)}
                  /> {fund.label}
                </label>
              ))}
            </div>
            {inputs.selectedFunds.length === 3 && (
              <label style={{ color: T.textPrimary, fontSize: 12 }}>
                <input type="checkbox" checked={inputs.includeTwoOfThreeCheck} onChange={(e) => updateInput('includeTwoOfThreeCheck', e.target.checked)} /> Evaluar también mejor combinación 2-de-3
              </label>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Threshold éxito
                <input type="number" min={0.5} max={0.99} step={0.01} value={inputs.successThreshold} onChange={(e) => updateInput('successThreshold', Number(e.target.value) || 0.85)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Paso grilla %
                <input type="number" min={5} max={25} step={5} value={inputs.gridStepPct} onChange={(e) => updateInput('gridStepPct', Number(e.target.value) || 5)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                nSim
                <input type="number" min={200} max={5000} step={100} value={inputs.nSim} onChange={(e) => updateInput('nSim', Number(e.target.value) || 1000)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Seed
                <input type="number" min={1} max={999999} step={1} value={inputs.seed} onChange={(e) => updateInput('seed', Number(e.target.value) || 42)} style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }} />
              </label>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={run}
          disabled={running || (inputs.portfolioMode === 'optimize' && inputs.selectedFunds.length === 1)}
          style={{
            background: T.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 9,
            padding: '10px 12px',
            fontWeight: 800,
            cursor: running ? 'not-allowed' : 'pointer',
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? 'Calculando...' : inputs.portfolioMode === 'manual' ? 'Simular' : 'Optimizar'}
        </button>
        {inputs.portfolioMode === 'optimize' && inputs.selectedFunds.length === 1 && (
          <div style={{ color: T.negative, fontSize: 12 }}>Con selección específica, el modo optimize requiere exactamente 2 o 3 fondos.</div>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(255,80,80,0.15)', border: `1px solid ${T.negative}`, borderRadius: 12, padding: 12, color: T.textPrimary, fontSize: 12 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Resultado recomendado</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 850 }}>{mixLabel(result.best.weights)}</div>
            </div>
            <div>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Gasto sostenible (equivalente mensual)</div>
              <div style={{ color: T.primary, fontSize: 20, fontWeight: 900 }}>{formatMoney(result.best.sustainableMonthlyClp)}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Success40</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatPct(result.best.success40)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P10</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p10)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P50</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p50)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P90</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p90)}</div>
            </div>
          </div>

          <MiniFanChart data={(result.best.fanChartData ?? []).map((p) => ({ year: p.year, p50: p.p50 }))} />

          <div style={{ color: T.textSecondary, fontSize: 12 }}>
            {result.mode === 'manual'
              ? `Modo manual ejecutado en motor M8 real.`
              : `Optimización discreta ${inputs.gridStepPct}% (${result.evaluatedCandidates} candidatos evaluados) con objetivo de gasto sostenible sujeto a éxito mínimo ${formatPct(inputs.successThreshold)}.`}
          </div>
          {result.bestThreeFunds && result.bestTwoOfThree && (
            <div style={{ color: T.textPrimary, fontSize: 12, background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              Mejor 3 fondos: {formatMoney(result.bestThreeFunds.equivalentMonthlyClp)} · Mejor 2-de-3: {formatMoney(result.bestTwoOfThree.equivalentMonthlyClp)}.
              {' '}
              {result.bestTwoOfThree.equivalentMonthlyClp > result.bestThreeFunds.equivalentMonthlyClp
                ? 'La alternativa 2-de-3 es superior en este caso.'
                : 'La combinación de 3 fondos mantiene ventaja o empate.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
