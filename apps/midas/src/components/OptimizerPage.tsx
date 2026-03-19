import React, { useState } from 'react';
import type { ModelParameters, OptimizerResult, OptimizerObjective } from '../domain/model/types';
import { DEFAULT_OPTIMIZER_CONSTRAINTS } from '../domain/model/defaults';
import { runOptimizer } from '../domain/optimizer/gridSearch';
import { T, css } from './theme';

export function OptimizerPage({ params }: { params: ModelParameters }) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [running, setRunning] = useState(false);
  const [objective, setObjective] = useState<OptimizerObjective>('minRuin');
  const [progress, setProgress] = useState(0);

  const run = () => {
    setRunning(true);
    setProgress(0);
    window.setTimeout(() => {
      // TODO: mover a Web Worker si el grid search sigue bloqueando UI.
      const r = runOptimizer(params, DEFAULT_OPTIMIZER_CONSTRAINTS, objective, 500, setProgress);
      setResult(r);
      setRunning(false);
    }, 0);
  };

  const OBJECTIVES: Array<[OptimizerObjective, string, string]> = [
    ['minRuin', 'Minimizar ruina', 'Menor prob. de ruina'],
    ['maxP50', 'Maximizar patrimonio', 'Mayor P50 terminal'],
    ['balanced', 'Equilibrado', 'Balance entre ruina y patrimonio'],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>Optimizador</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>Ajusta pesos para minimizar riesgo o maximizar patrimonio</div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Objetivo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 8 }}>
          {OBJECTIVES.map(([id, label, desc]) => (
            <button
              key={id}
              onClick={() => setObjective(id)}
              style={{
                background: objective === id ? T.surfaceEl : 'transparent',
                border: `1px solid ${objective === id ? T.primary : T.border}`,
                color: objective === id ? T.primary : T.textSecondary,
                borderRadius: 10,
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700 }}>{label}</div>
              <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 8 }}>RV vs RF total</div>
        <AllocationBar weights={params.weights} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginTop: 10 }}>
          <Stat label="RV total" value={`${((params.weights.rvGlobal + params.weights.rvChile) * 100).toFixed(0)}%`} />
          <Stat label="RF total" value={`${((params.weights.rfGlobal + params.weights.rfChile) * 100).toFixed(0)}%`} />
        </div>
      </div>

      <button
        onClick={run}
        disabled={running}
        style={{
          width: '100%',
          background: running ? T.border : T.primary,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          padding: '14px 0',
          fontWeight: 800,
          fontSize: 14,
          cursor: running ? 'wait' : 'pointer',
        }}
      >
        {running ? `Optimizando... ${progress}%` : '▶ Optimizar'}
      </button>
      {running && (
        <div style={{ color: T.textMuted, fontSize: 11, textAlign: 'center' }}>
          El optimizador puede tardar 30-60 segundos. La app no está bloqueada.
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11 }}>Resultado esperado</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginTop: 8 }}>
              <Stat label="Prob. ruina óptima" value={`${(result.probRuin * 100).toFixed(1)}%`} accent={T.positive} />
              <Stat label="Patrimonio P50" value={`$${(result.terminalP50 / 1e9).toFixed(2)}B`} />
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 8 }}>Movimientos recomendados</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.moves.map((m) => (
                <div key={m.sleeve} style={{ background: T.surfaceEl, borderRadius: 10, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: T.textPrimary, fontWeight: 700 }}>{m.sleeve}</div>
                    <div style={{ color: T.textMuted, fontSize: 11 }}>
                      {m.direction === 'up' ? 'Aumentar' : m.direction === 'down' ? 'Reducir' : 'Mantener'}
                    </div>
                  </div>
                  <div style={{ ...css.mono, color: m.direction === 'up' ? T.positive : m.direction === 'down' ? T.negative : T.textSecondary, fontWeight: 700 }}>
                    {m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '—'} {m.delta.toFixed(2)}pp
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, color: accent ?? T.textPrimary, fontSize: 16, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function AllocationBar({ weights }: { weights: ModelParameters['weights'] }) {
  const total = weights.rvGlobal + weights.rfGlobal + weights.rvChile + weights.rfChile;
  const slices: Array<[number, string]> = [
    [weights.rvGlobal, T.primary],
    [weights.rfGlobal, T.secondary],
    [weights.rvChile, T.warning],
    [weights.rfChile, T.metalBase],
  ];
  return (
    <div style={{ height: 12, background: T.surfaceEl, borderRadius: 10, overflow: 'hidden', display: 'flex' }}>
      {slices.map(([v, c], idx) => (
        <div key={idx} style={{ width: `${(v / total) * 100}%`, background: c }} />
      ))}
    </div>
  );
}
