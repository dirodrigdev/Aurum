import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelParameters } from '../domain/model/types';
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

export function SensitivityPage({ params, stateLabel }: { params: ModelParameters; stateLabel?: string }) {
  const [results, setResults] = useState<
    Record<
      string,
      Array<{
        label: string;
        probRuin: number;
        p50: number;
        probRuinDelta: number;
        p50Delta: number;
      }>
    >
  >({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; detail: string } | null>(null);
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState<{ probRuin: number; p50: number } | null>(null);
  const [groupOrder, setGroupOrder] = useState<Array<{ id: string; label: string }>>([]);
  const [active, setActive] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = () => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../domain/analysis/scenario.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunning(true);
    setError('');
    setProgress({ pct: 0, detail: 'Preparando sensibilidad' });

    worker.onmessage = (event) => {
      const data = event.data as
        | {
            type: 'progress';
            runId: number;
            pct: number;
            detail: string;
          }
        | {
            type: 'sensitivity-done';
            runId: number;
            baseline: { probRuin: number; p50: number };
            groups: Array<{
              id: string;
              label: string;
              points: Array<{
                label: string;
                probRuin: number;
                p50: number;
                probRuinDelta: number;
                p50Delta: number;
              }>;
            }>;
          }
        | { type: 'error'; runId: number; message: string };
      if (!data || data.runId !== runIdRef.current) return;
      if (data.type === 'progress') {
        setProgress({ pct: data.pct, detail: data.detail });
        return;
      }
      if (data.type === 'sensitivity-done') {
        const out: typeof results = {};
        const order: Array<{ id: string; label: string }> = [];
        data.groups.forEach((group) => {
          out[group.id] = group.points;
          order.push({ id: group.id, label: group.label });
        });
        setBaseline(data.baseline);
        setResults(out);
        setGroupOrder(order);
        if (!active && order.length > 0) setActive(order[0].id);
        if (active && !out[active] && order.length > 0) setActive(order[0].id);
        setProgress({ pct: 100, detail: 'Sensibilidades listas' });
        setRunning(false);
        return;
      }
      if (data.type === 'error') {
        setError('No pude ejecutar sensibilidades. Reintenta.');
        setRunning(false);
        setProgress(null);
      }
    };

    worker.onerror = () => {
      setError('No pude ejecutar sensibilidades. Reintenta.');
      setRunning(false);
      setProgress(null);
    };

    worker.postMessage({
      type: 'sensitivity-start',
      runId,
      params,
    });
  };

  const curr = results[active] || [];
  const maxRuin = Math.max(...curr.map((r) => r.probRuin), 0.01);
  const activeLabel = useMemo(
    () => groupOrder.find((param) => param.id === active)?.label || '',
    [groupOrder, active],
  );

  const formatDeltaPp = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
  const formatDeltaMm = (value: number) => `${value >= 0 ? '+' : ''}$${(value / 1e6).toFixed(0)}MM`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>Sensibilidades</div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Impacto de cada parámetro sobre ruina · usando tu configuración actual
          </div>
        </div>
        {stateLabel && <div style={{ color: T.textSecondary, fontSize: 11 }}>{stateLabel}</div>}
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

      {baseline && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11 }}>Base actual · Ruina</div>
            <div style={{ ...css.mono, color: T.textPrimary, fontSize: 24, fontWeight: 700, marginTop: 4 }}>
              {(baseline.probRuin * 100).toFixed(1)}%
            </div>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11 }}>Base actual · P50</div>
            <div style={{ ...css.mono, color: T.textPrimary, fontSize: 24, fontWeight: 700, marginTop: 4 }}>
              ${(baseline.p50 / 1e6).toFixed(0)}MM
            </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {groupOrder.map((sp) => (
          <button
            key={sp.id}
            onClick={() => setActive(sp.id)}
            style={{
              background: active === sp.id ? T.surfaceEl : T.surface,
              border: `1px solid ${active === sp.id ? T.primary : T.border}`,
              color: active === sp.id ? T.primary : T.textSecondary,
              borderRadius: 10,
              padding: '10px 12px',
              textAlign: 'left',
              cursor: 'pointer',
              opacity: 1,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12 }}>{sp.label}</div>
            <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>{PARAM_LABELS[sp.id] ?? sp.label}</div>
          </button>
        ))}
      </div>

      {curr.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Comparando contra la base actual. Parámetro activo: <span style={{ color: T.textPrimary }}>{activeLabel}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
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
              <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 6 }}>
                vs base: <span style={{ ...css.mono }}>{formatDeltaPp(r.probRuinDelta)}</span>
              </div>
              <div style={{ ...css.mono, color: T.textSecondary, fontSize: 11, marginTop: 6 }}>P50: ${(r.p50 / 1e6).toFixed(0)}MM</div>
              <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 4 }}>
                vs base: <span style={{ ...css.mono }}>{formatDeltaMm(r.p50Delta)}</span>
              </div>
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
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 32, textAlign: 'center', color: T.textMuted }}>
          Ejecuta para ver sensibilidad contra la base actual
        </div>
      )}
    </div>
  );
}
