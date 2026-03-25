import React, { useEffect, useRef, useState } from 'react';
import type { ModelParameters, StressResult } from '../domain/model/types';
import { STRESS_SCENARIOS } from '../domain/model/defaults';
import { T, css } from './theme';

export function StressPage({ params, stateLabel }: { params: ModelParameters; stateLabel?: string }) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STRESS_SCENARIOS.map((s) => [s.id, true])),
  );
  const [results, setResults] = useState<
    Array<{
      result: StressResult;
      terminalWealthDelta: number;
      maxDrawdownDelta: number;
      minSpendingMultDelta: number;
      ruinMonthDelta: number | null;
    }>
  >([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; detail: string } | null>(null);
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState<StressResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const toggle = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const run = () => {
    const ids = STRESS_SCENARIOS.filter((s) => selected[s.id]);
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../domain/analysis/scenario.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunning(true);
    setError('');
    setProgress({ pct: 0, detail: 'Preparando stress tests' });

    worker.onmessage = (event) => {
      const data = event.data as
        | {
            type: 'progress';
            runId: number;
            pct: number;
            detail: string;
          }
        | {
            type: 'stress-done';
            runId: number;
            baseline: StressResult;
            scenarios: Array<{
              result: StressResult;
              terminalWealthDelta: number;
              maxDrawdownDelta: number;
              minSpendingMultDelta: number;
              ruinMonthDelta: number | null;
            }>;
          }
        | { type: 'error'; runId: number; message: string };
      if (!data || data.runId !== runIdRef.current) return;
      if (data.type === 'progress') {
        setProgress({ pct: data.pct, detail: data.detail });
        return;
      }
      if (data.type === 'stress-done') {
        setBaseline(data.baseline);
        setResults(data.scenarios);
        setProgress({ pct: 100, detail: 'Stress tests listos' });
        setRunning(false);
        return;
      }
      if (data.type === 'error') {
        setError('No pude ejecutar los stress tests. Reintenta.');
        setRunning(false);
        setProgress(null);
      }
    };

    worker.onerror = () => {
      setError('No pude ejecutar los stress tests. Reintenta.');
      setRunning(false);
      setProgress(null);
    };

    worker.postMessage({
      type: 'stress-start',
      runId,
      params,
      scenarioIds: ids.map((sc) => sc.id),
    });
  };

  const formatPctDelta = (value: number) =>
    `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
  const formatMoneyDelta = (value: number) =>
    `${value >= 0 ? '+' : ''}$${(value / 1e6).toFixed(0)}MM`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>Stress tests</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>
          Escenarios determinísticos (separados de Optimista/Base/Pesimista) · usan tu configuración vigente
        </div>
      </div>
      {stateLabel && <div style={{ color: T.textSecondary, fontSize: 11 }}>{stateLabel}</div>}

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

      {baseline && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>Base de comparación</div>
          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>
            Escenario determinista sin shocks adicionales
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 10 }}>
            <Stat label="Ruina" value={baseline.ruinMonth ? `Año ${(baseline.ruinMonth / 12).toFixed(1)}` : 'No'} />
            <Stat label="Max DD" value={`${(baseline.maxDrawdownReal * 100).toFixed(1)}%`} />
            <Stat label="Gasto mín" value={`${(baseline.minSpendingMult * 100).toFixed(1)}%`} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Stat label="Patrimonio terminal" value={`$${(baseline.terminalWealthReal / 1e6).toFixed(0)}MM`} />
          </div>
        </div>
      )}

      {(running || progress) && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
            <div style={{ color: T.textPrimary, fontWeight: 700 }}>Ejecución</div>
            <div style={{ color: T.textSecondary }}>{progress?.pct ?? 0}%</div>
          </div>
          <div style={{ marginTop: 8, height: 6, background: T.surfaceEl, borderRadius: 999 }}>
            <div
              style={{
                height: '100%',
                width: `${progress?.pct ?? 0}%`,
                background: T.primary,
                borderRadius: 999,
                transition: 'width 180ms ease',
              }}
            />
          </div>
          <div style={{ color: T.textMuted, fontSize: 12, marginTop: 8 }}>
            {progress?.detail || 'Procesando'}
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12, padding: 12, color: '#be123c', fontSize: 12 }}>
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map((r) => (
            <div key={r.result.scenario.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{r.result.scenario.label}</div>
              <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>{r.result.scenario.description}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 10 }}>
                <Stat label="Ruina" value={r.result.ruinMonth ? `Año ${(r.result.ruinMonth / 12).toFixed(1)}` : 'No'} />
                <Stat label="Max DD" value={`${(r.result.maxDrawdownReal * 100).toFixed(1)}%`} />
                <Stat label="Gasto mín" value={`${(r.result.minSpendingMult * 100).toFixed(1)}%`} />
              </div>
              {!r.result.ruinMonth && (
                <div style={{ marginTop: 10 }}>
                  <Stat label="Patrimonio terminal" value={`$${(r.result.terminalWealthReal / 1e6).toFixed(0)}MM`} />
                </div>
              )}
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
                <DeltaStat label="vs base terminal" value={formatMoneyDelta(r.terminalWealthDelta)} />
                <DeltaStat label="vs base Max DD" value={formatPctDelta(r.maxDrawdownDelta)} />
                <DeltaStat label="vs base gasto mín" value={formatPctDelta(r.minSpendingMultDelta)} />
              </div>
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

function DeltaStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: T.surfaceEl, borderRadius: 10, padding: 10 }}>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, color: T.textPrimary, fontSize: 13, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
