import React, { useState } from 'react';
import type { ModelParameters } from '../domain/model/types';
import { runSimulationCentralV2 } from '../domain/simulation/engineCentralV2';
import { SENSITIVITY_PARAMS } from '../domain/model/defaults';
import { T, css } from './theme';

const PARAM_LABELS: Record<string, string> = {
  blockLength: 'Largo de bloque bootstrap',
  tcrealLT: 'Tipo de cambio real LT',
  feeAnnual: 'Fee total anual',
  rvGlobalAnnual: 'Retorno esperado RV Global',
  rvChileAnnual: 'Retorno esperado RV Chile',
  ipcChileAnnual: 'Inflación Chile base',
  spendingPhase2: 'Gasto mensual Fase 2',
  rvChileWeight: 'Peso RV Chile en portafolio',
};

export function SensitivityPage({ params }: { params: ModelParameters }) {
  const [results, setResults] = useState<Record<string, Array<{ label: string; probRuin: number; p50: number }>>>({});
  const [running, setRunning] = useState(false);
  const ACTIVE_PARAMS = SENSITIVITY_PARAMS.filter((p) => p.paramPath !== 'simulation.blockLength');
  const [active, setActive] = useState(ACTIVE_PARAMS[0].id);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const out: typeof results = {};
      for (const sp of ACTIVE_PARAMS) {
        out[sp.id] = sp.values.map((val, idx) => {
          const p = JSON.parse(JSON.stringify(params)) as ModelParameters;
          p.simulation.nSim = 1500; p.simulation.seed = 42;
          const parts = sp.paramPath.split('.');
          let obj = p as unknown as Record<string, unknown>;
          for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
          obj[parts[parts.length - 1]] = val;
          const r = runSimulationCentralV2(p);
          return { label: sp.valueLabels[idx], probRuin: r.probRuin, p50: r.terminalWealthPercentiles[50] || 0 };
        });
      }
      setResults(out);
      setRunning(false);
    }, 30);
  };

  const curr = results[active] || [];
  const maxRuin = Math.max(...curr.map((r) => r.probRuin), 0.01);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>Sensibilidades</div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>Impacto de cada parámetro sobre ruina</div>
        </div>
        <button
          onClick={run}
          disabled={running}
          style={{
            background: running ? T.border : T.primaryStrong,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '10px 14px',
            fontWeight: 700,
            cursor: running ? 'wait' : 'pointer',
          }}
        >
          {running ? '...' : 'Ejecutar'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {SENSITIVITY_PARAMS.map((sp) => (
            <button
              key={sp.id}
              disabled={sp.paramPath === 'simulation.blockLength'}
              onClick={() => setActive(sp.id)}
              style={{
                background: active === sp.id ? T.surfaceEl : T.surface,
                border: `1px solid ${active === sp.id ? T.primary : T.border}`,
                color: active === sp.id ? T.primary : T.textSecondary,
                borderRadius: 10,
                padding: '10px 12px',
                textAlign: 'left',
                cursor: sp.paramPath === 'simulation.blockLength' ? 'not-allowed' : 'pointer',
                opacity: sp.paramPath === 'simulation.blockLength' ? 0.45 : 1,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 12 }}>{sp.label}</div>
              <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>
                {sp.paramPath === 'simulation.blockLength'
                  ? 'No aplica en Motor 6'
                  : (PARAM_LABELS[sp.id] ?? sp.label)}
              </div>
            </button>
          ))}
        </div>

      {curr.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          {curr.map((r) => (
            <div key={r.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>{r.label}</div>
              <div
                style={{
                  ...css.mono,
                  fontSize: 28,
                  fontWeight: 700,
                  color: r.probRuin > 0.1 ? T.negative : r.probRuin > 0.06 ? T.warning : T.positive,
                  marginTop: 4,
                }}
              >
                {(r.probRuin * 100).toFixed(1)}%
              </div>
              <div style={{ ...css.mono, color: T.textSecondary, fontSize: 11, marginTop: 6 }}>P50: ${(r.p50 / 1e6).toFixed(0)}MM</div>
              <div style={{ marginTop: 8, height: 4, background: T.surfaceEl, borderRadius: 2 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${(r.probRuin / maxRuin) * 100}%`,
                    borderRadius: 2,
                    background: r.probRuin > 0.1 ? T.negative : r.probRuin > 0.06 ? T.warning : T.positive,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 32, textAlign: 'center', color: T.textMuted }}>
          Ejecuta para ver resultados
        </div>
      )}
    </div>
  );
}
