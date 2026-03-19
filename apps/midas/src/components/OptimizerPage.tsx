import React, { useState } from 'react';
import type { ModelParameters, OptimizerResult, OptimizerObjective } from '../domain/model/types';
import { DEFAULT_OPTIMIZER_CONSTRAINTS } from '../domain/model/defaults';
import { runOptimizer } from '../domain/optimizer/gridSearch';
import { runSimulation } from '../domain/simulation/engine';
import { T, css } from './theme';

export function OptimizerPage({ params }: { params: ModelParameters }) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [objective, setObjective] = useState<OptimizerObjective>('minRuin');
  const [progress, setProgress] = useState(0);
  const [currentProbRuin, setCurrentProbRuin] = useState<number | null>(null);

  const handleOptimize = () => {
    setIsOptimizing(true);
    setResult(null);
    setProgress(0);
    window.setTimeout(() => {
      window.setTimeout(() => {
        // TODO: mover a Web Worker si el grid search sigue bloqueando UI.
        const baseline = runSimulation({
          ...params,
          simulation: { ...params.simulation, nSim: 500, seed: 42 },
        });
        const r = runOptimizer(params, DEFAULT_OPTIMIZER_CONSTRAINTS, objective, 500, setProgress);
        setCurrentProbRuin(baseline.probRuin);
        setResult(r);
        setIsOptimizing(false);
      }, 50);
    }, 0);
  };

  const OBJECTIVES: Array<[OptimizerObjective, string, string]> = [
    ['minRuin', 'Minimizar ruina', 'Menor prob. de ruina'],
    ['maxP50', 'Maximizar patrimonio', 'Mayor P50 terminal'],
    ['balanced', 'Equilibrado', 'Balance entre ruina y patrimonio'],
  ];
  const currentRuin = currentProbRuin ?? result?.probRuin ?? null;
  const insight = result ? renderInsight(result.moves) : null;

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

      {isOptimizing ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ color: T.primary, fontSize: 14, marginBottom: 8 }}>Optimizando portafolio...</div>
          <div style={{ color: T.textMuted, fontSize: 11 }}>Evaluando combinaciones de pesos · puede tardar 30–60 segundos</div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>La app sigue activa — puedes navegar a otras secciones</div>
        </div>
      ) : (
        <button
          onClick={handleOptimize}
          style={{
            width: '100%',
            background: T.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '14px 0',
            fontWeight: 800,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          ▶ Optimizar
        </button>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16 }}>
            <p style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 12 }}>
              Movimientos recomendados
            </p>
            {result.moves.map((m) => (
              <div key={m.sleeve} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 18, color: m.direction === 'up' ? T.positive : T.negative }}>
                  {m.direction === 'up' ? '↑' : '↓'}
                </span>
                <span style={{ color: T.textSecondary, fontSize: 13, flex: 1 }}>{m.sleeve}</span>
                <span
                  style={{
                    ...css.mono,
                    fontWeight: 700,
                    fontSize: 14,
                    color: m.direction === 'up' ? T.positive : T.negative,
                  }}
                >
                  {m.delta > 0 ? '+' : ''}
                  {m.delta.toFixed(1)}pp
                </span>
              </div>
            ))}
            {result.moves.length === 0 && (
              <p style={{ color: T.textMuted, fontSize: 12 }}>El portafolio actual ya es óptimo para este objetivo.</p>
            )}
          </div>

          <div style={{ marginTop: 10, background: T.surface, borderRadius: 10, padding: 16 }}>
            <p style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 12 }}>
              Resultado esperado
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Prob. ruina actual</span>
              <span style={{ ...css.mono, color: T.textPrimary, fontSize: 13 }}>
                {currentRuin === null ? '—' : `${(currentRuin * 100).toFixed(1)}%`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Prob. ruina óptima</span>
              <span style={{ ...css.mono, color: T.positive, fontSize: 13 }}>
                {(result.probRuin * 100).toFixed(1)}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Mejora</span>
              <span style={{ ...css.mono, color: T.positive, fontSize: 13, fontWeight: 700 }}>
                {(result.vsCurrentRuin * 100).toFixed(1)}pp ▼
              </span>
            </div>
            <div style={{ height: 1, background: T.border, marginBottom: 12 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Patrimonio P50</span>
              <span style={{ ...css.mono, color: T.primary, fontSize: 13 }}>
                ${(result.terminalP50 / 1e9).toFixed(2)}B
              </span>
            </div>
          </div>

          {insight && (
            <div style={{ marginTop: 10, background: T.surfaceEl, borderRadius: 10, padding: 14 }}>
              <p style={{ color: T.textSecondary, fontSize: 12, lineHeight: 1.5, margin: 0 }}>{insight}</p>
            </div>
          )}
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

function renderInsight(moves: OptimizerResult['moves']): string | null {
  if (moves.find((m) => m.sleeve === 'RV Global' && m.direction === 'up')) {
    return 'Aumentar RV Global mejora el retorno esperado aprovechando diversificación internacional.';
  }
  if (moves.find((m) => m.sleeve === 'RF Chile UF' && m.direction === 'down')) {
    return 'Reducir RF Chile UF libera capital hacia activos con mayor retorno real histórico.';
  }
  if (moves.find((m) => m.sleeve === 'RV Chile' && m.direction === 'up')) {
    return 'Mayor RV Chile aprovecha el ciclo local, históricamente fuerte en superciclos de commodities.';
  }
  if (moves.find((m) => m.sleeve === 'RF Global' && m.direction === 'up')) {
    return 'Más RF Global reduce volatilidad sin sacrificar retorno en el largo plazo.';
  }
  return null;
}
