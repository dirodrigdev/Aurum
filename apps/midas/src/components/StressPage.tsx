import React, { useState } from 'react';
import type { ModelParameters, StressResult } from '../domain/model/types';
import { STRESS_SCENARIOS } from '../domain/model/defaults';
import { runStressTest } from '../domain/simulation/engine';
import { T, css } from './theme';

export function StressPage({ params }: { params: ModelParameters }) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STRESS_SCENARIOS.map((s) => [s.id, true])),
  );
  const [results, setResults] = useState<StressResult[]>([]);
  const [running, setRunning] = useState(false);

  const toggle = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const run = () => {
    const ids = STRESS_SCENARIOS.filter((s) => selected[s.id]);
    setRunning(true);
    setTimeout(() => {
      setResults(ids.map((sc) => runStressTest(params, sc)));
      setRunning(false);
    }, 30);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>Stress tests</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Escenarios determinísticos (separados de Optimista/Base/Pesimista) · usan tu configuración vigente
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STRESS_SCENARIOS.map((sc) => (
          <label
            key={sc.id}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <input
              type="checkbox"
              checked={!!selected[sc.id]}
              onChange={() => toggle(sc.id)}
              style={{ marginTop: 4 }}
            />
            <div>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{sc.label}</div>
              <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>{sc.description}</div>
            </div>
          </label>
        ))}
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
        {running ? 'Ejecutando...' : '▶ Ejecutar stress tests seleccionados'}
      </button>

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map((r) => (
            <div key={r.scenario.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{r.scenario.label}</div>
              <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>{r.scenario.description}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 10 }}>
                <Stat label="Ruina" value={r.ruinMonth ? `Año ${(r.ruinMonth / 12).toFixed(1)}` : 'No'} />
                <Stat label="Max DD" value={`${(r.maxDrawdownReal * 100).toFixed(1)}%`} />
                <Stat label="Gasto mín" value={`${(r.minSpendingMult * 100).toFixed(1)}%`} />
              </div>
              {!r.ruinMonth && (
                <div style={{ marginTop: 10 }}>
                  <Stat label="Patrimonio terminal" value={`$${(r.terminalWealthReal / 1e6).toFixed(0)}MM`} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, color: T.textPrimary, fontSize: 14, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
