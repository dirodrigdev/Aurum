import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelParameters, OptimizerObjective, OptimizerResult, PortfolioWeights } from '../domain/model/types';
import { T, css } from './theme';
import {
  loadInstrumentBaseSnapshot,
  type InstrumentBaseItem,
  type InstrumentBaseSnapshot,
} from '../domain/instrumentBase';

type Mode = 'base' | 'simulation';

type BaselineSnapshot = { probRuin: number; terminalP50: number } | null;

type OptimizerWorkerMessage =
  | { type: 'baseline'; runId: number; probRuin: number; terminalP50: number }
  | { type: 'progress'; runId: number; phase: 'quick' | 'full'; pct: number; detail: string }
  | { type: 'quick-result'; runId: number; result: OptimizerResult }
  | { type: 'done'; runId: number; result: OptimizerResult }
  | { type: 'error'; runId: number; message: string; baselineProbRuin?: number; baselineP50?: number; quickResult?: OptimizerResult };

const OPTIMIZER_TIMEOUT_MS = 45_000;

export function OptPage({
  baseParams,
  simulationParams,
  simulationActive,
  simulationLabel,
  preloadedBaseStats,
  preloadedSimulationStats,
  optimizableBaseReference,
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
  preloadedBaseStats?: BaselineSnapshot;
  preloadedSimulationStats?: BaselineSnapshot;
  optimizableBaseReference: { amountClp: number | null; asOf: string | null; sourceLabel: string; status: 'available' | 'pending' };
}) {
  const [mode, setMode] = useState<Mode>(() => (simulationActive ? 'simulation' : 'base'));
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [instrumentBaseSnapshot, setInstrumentBaseSnapshot] = useState<InstrumentBaseSnapshot | null>(() => loadInstrumentBaseSnapshot());
  const runIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!simulationActive && mode === 'simulation') setMode('base');
  }, [simulationActive, mode]);

  useEffect(() => {
    const refreshSnapshot = () => setInstrumentBaseSnapshot(loadInstrumentBaseSnapshot());
    refreshSnapshot();
    window.addEventListener('focus', refreshSnapshot);
    return () => window.removeEventListener('focus', refreshSnapshot);
  }, []);

  const activeParams = mode === 'simulation' && simulationActive ? simulationParams : baseParams;
  const activeLabel = mode === 'simulation' && simulationActive ? simulationLabel ?? 'SIMULACION ACTIVA' : 'BASE OFICIAL';

  const baseBaseline = preloadedBaseStats ?? null;
  const simulationBaseline = simulationActive ? preloadedSimulationStats ?? null : null;

  const totalOptimizable = useMemo(() => {
    if (mode === 'simulation' && simulationActive) {
      const simOpt = Number(simulationParams.simulationComposition?.optimizableInvestmentsCLP ?? NaN);
      if (Number.isFinite(simOpt) && simOpt > 0) return simOpt;
    }
    const baseOpt = Number(optimizableBaseReference.amountClp ?? NaN);
    return Number.isFinite(baseOpt) && baseOpt > 0 ? baseOpt : Math.max(0, activeParams.capitalInitial);
  }, [mode, simulationActive, simulationParams.simulationComposition?.optimizableInvestmentsCLP, optimizableBaseReference.amountClp, activeParams.capitalInitial]);

  const jasonSavedAt = instrumentBaseSnapshot?.savedAt ?? null;
  const jasonAgeDays = useMemo(() => {
    if (!jasonSavedAt) return null;
    const ts = new Date(jasonSavedAt).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  }, [jasonSavedAt]);

  const reconstructedInstruments = useMemo(() => {
    if (!instrumentBaseSnapshot?.instruments?.length) return null;
    const totalJason = instrumentBaseSnapshot.instruments.reduce((sum, item) => sum + item.currentAmountCLP, 0);
    if (!(totalJason > 0)) return null;
    return instrumentBaseSnapshot.instruments.map((item) => {
      const weight = item.currentAmountCLP / totalJason;
      return {
        ...item,
        currentAmountCLP: totalOptimizable * weight,
        __jasonWeight: weight,
      } as InstrumentBaseItem & { __jasonWeight: number };
    });
  }, [instrumentBaseSnapshot, totalOptimizable]);

  const reconstructedMix = useMemo(() => {
    if (!reconstructedInstruments) return null;
    const total = reconstructedInstruments.reduce((sum, item) => sum + item.currentAmountCLP, 0);
    if (!(total > 0)) return null;
    const acc = { rv: 0, rf: 0, global: 0, local: 0 };
    reconstructedInstruments.forEach((item) => {
      const weight = item.currentAmountCLP / total;
      acc.rv += item.exposure.rv * weight;
      acc.rf += item.exposure.rf * weight;
      acc.global += item.exposure.global * weight;
      acc.local += item.exposure.local * weight;
    });
    return acc;
  }, [reconstructedInstruments]);

  const currentSuccess = useMemo(() => {
    const snapshot = mode === 'simulation' ? simulationBaseline : baseBaseline;
    if (!snapshot) return null;
    return 1 - snapshot.probRuin;
  }, [mode, baseBaseline, simulationBaseline]);

  const stopWorker = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleOptimize = () => {
    if (isOptimizing) return;
    if (typeof Worker === 'undefined') {
      setErrorMessage('Este navegador no soporta el modo estable del optimizador.');
      return;
    }
    if (!reconstructedInstruments) {
      setErrorMessage('No hay base instrumental Jason válida para reconstruir la cartera.');
      return;
    }

    const runId = Date.now();
    runIdRef.current = runId;
    stopWorker();
    setIsOptimizing(true);
    setResult(null);
    setProgress(0);
    setProgressDetail('Inicializando optimizacion...');
    setErrorMessage(null);

    const worker = new Worker(new URL('../domain/optimizer/optimizer.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    timeoutRef.current = window.setTimeout(() => {
      stopWorker();
      setErrorMessage('La optimizacion tardó demasiado.');
      setIsOptimizing(false);
      setProgressDetail('Tiempo maximo alcanzado');
      setProgress(100);
    }, OPTIMIZER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<OptimizerWorkerMessage>) => {
      const message = event.data;
      if (!message || message.runId !== runId) return;
      if (message.type === 'progress') {
        setProgress((prev) => Math.max(prev, message.pct));
        setProgressDetail(message.detail);
        return;
      }
      if (message.type === 'quick-result') {
        setProgress((prev) => Math.max(prev, 35));
        return;
      }
      if (message.type === 'done') {
        startTransition(() => {
          setResult(message.result);
        });
        setProgress(100);
        setProgressDetail('Optimizacion completada');
        setIsOptimizing(false);
        stopWorker();
      }
      if (message.type === 'error') {
        setErrorMessage(message.message || 'No pude completar la optimizacion.');
        setIsOptimizing(false);
        stopWorker();
      }
    };

    const reconstructedWeights = inferWeightsFromMix(reconstructedMix);

    worker.postMessage({
      type: 'start',
      runId,
      params: {
        ...activeParams,
        weights: reconstructedWeights,
      },
      objective: 'minRuin' as OptimizerObjective,
      decisionShare: computeDecisionShare(activeParams.capitalInitial, totalOptimizable),
      instrumentBase: reconstructedInstruments,
      optimizableBaseClp: totalOptimizable,
    });
  };

  const optimizedWeights = result?.weights ?? inferWeightsFromMix(reconstructedMix);
  const theoreticalRisk = summarizeRisk(optimizedWeights);
  const theoreticalGeo = summarizeGlobalLocalFromWeights(optimizedWeights);
  const realistic = result?.realistic ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>OPT</div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Version v0 para validar baseline, logica y direccion numerica sin ruido estetico.
          </div>
        </div>
        <div style={{ ...css.mono, color: T.textMuted, fontSize: 11 }}>{activeLabel}</div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11, marginBottom: 6 }}>Selector de modo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <ModeCard
            active={mode === 'base'}
            title="Base oficial"
            subtitle="Estado guardado actual del modelo"
            success={baseBaseline ? 1 - baseBaseline.probRuin : null}
            onClick={() => setMode('base')}
          />
          <ModeCard
            active={mode === 'simulation'}
            title="Simulacion actual"
            subtitle="Ultimo estado modificado no persistido"
            success={simulationBaseline ? 1 - simulationBaseline.probRuin : null}
            onClick={() => setMode('simulation')}
            disabled={!simulationActive}
          />
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Resumen del escenario activo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
          <Stat label="Total optimizable (Aurum)" value={formatMoneyCompact(totalOptimizable)} />
          <Stat label="Jason actualizado" value={formatDate(jasonSavedAt)} />
          <Stat label="Frescura Jason" value={jasonAgeDays === null ? '—' : jasonAgeDays < 30 ? 'Vigente' : 'Alerta'} />
          <Stat label="Dias desde Jason" value={jasonAgeDays === null ? '—' : `${jasonAgeDays} dias`} />
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Mix actual reconstruido</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
          <Stat label="RV" value={reconstructedMix ? formatPercent(reconstructedMix.rv) : '—'} />
          <Stat label="RF" value={reconstructedMix ? formatPercent(reconstructedMix.rf) : '—'} />
          <Stat label="Global" value={reconstructedMix ? formatPercent(reconstructedMix.global) : '—'} />
          <Stat label="Local" value={reconstructedMix ? formatPercent(reconstructedMix.local) : '—'} />
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Target teorico</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
          <Stat label="RV" value={formatPercent(theoreticalRisk.rv)} />
          <Stat label="RF" value={formatPercent(theoreticalRisk.rf)} />
          <Stat label="Global" value={formatPercent(theoreticalGeo.global)} />
          <Stat label="Local" value={formatPercent(theoreticalGeo.local)} />
        </div>
      </div>

      <button
        onClick={handleOptimize}
        disabled={isOptimizing}
        style={{
          width: '100%',
          background: T.primary,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          padding: '14px 0',
          fontWeight: 800,
          fontSize: 14,
          cursor: isOptimizing ? 'not-allowed' : 'pointer',
          opacity: isOptimizing ? 0.7 : 1,
        }}
      >
        {isOptimizing ? 'Optimizando...' : '▶ Ejecutar OPT v0'}
      </button>

      {errorMessage && (
        <div style={{ background: T.surface, border: `1px solid ${T.warning}`, borderRadius: 10, padding: 12, fontSize: 12 }}>
          {errorMessage}
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11 }}>Comparativo simple</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 8 }}>
              <Stat label="Exito actual" value={currentSuccess === null ? '—' : formatPercent(currentSuccess)} />
              <Stat label="Exito teorico" value={formatPercent(1 - result.probRuin)} />
              <Stat label="Exito ejecutable" value={realistic ? formatPercent(1 - realistic.probRuin) : '—'} />
            </div>
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.textMuted, fontSize: 11 }}>Propuesta de movimientos</div>
            {realistic?.moves?.length ? (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {realistic.moves.map((move) => (
                  <div
                    key={`${move.fromId}-${move.toId}-${move.amountClp}`}
                    style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{move.fromName} → {move.toName}</div>
                    <div style={{ fontSize: 11, color: T.textMuted }}>
                      {move.fromManager} ({move.fromCurrency}) → {move.toManager} ({move.toCurrency}) · {formatMoneyCompact(move.amountClp)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: T.textMuted, fontSize: 12, marginTop: 8 }}>No hay movimientos ejecutables.</div>
            )}
          </div>
        </div>
      )}

      <details style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <summary style={{ cursor: 'pointer', color: T.textPrimary, fontWeight: 700 }}>Base Jason*</summary>
        <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted }}>
          Reconstruccion usando total optimizable vigente + distribucion instrumental Jason.
        </div>
        {reconstructedInstruments ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {reconstructedInstruments.map((item) => (
              <div key={item.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{item.manager} · {item.name}</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>
                  {item.currency} · Jason {formatPercent(item.__jasonWeight)} · {formatMoneyCompact(item.currentAmountCLP)}
                </div>
                <div style={{ fontSize: 11, color: T.textMuted }}>
                  RV {formatPercent(item.exposure.rv)} · RF {formatPercent(item.exposure.rf)} · Global {formatPercent(item.exposure.global)} · Local {formatPercent(item.exposure.local)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: T.textMuted }}>No hay base Jason disponible.</div>
        )}
      </details>
    </div>
  );
}

function computeDecisionShare(totalCapital: number, optimizableCapital: number) {
  if (!(totalCapital > 0)) return 0;
  return clamp01(optimizableCapital / totalCapital);
}

function inferWeightsFromMix(mix: { rv: number; rf: number; global: number; local: number } | null): PortfolioWeights {
  if (!mix) return { rvGlobal: 0.25, rvChile: 0.25, rfGlobal: 0.25, rfChile: 0.25 };
  const rvGlobal = mix.rv * mix.global;
  const rvChile = mix.rv * mix.local;
  const rfGlobal = mix.rf * mix.global;
  const rfChile = mix.rf * mix.local;
  return normalizeWeights({ rvGlobal, rvChile, rfGlobal, rfChile });
}

function normalizeWeights(weights: PortfolioWeights): PortfolioWeights {
  const rvGlobal = clamp01(weights.rvGlobal);
  const rfGlobal = clamp01(weights.rfGlobal);
  const rvChile = clamp01(weights.rvChile);
  const rfChile = clamp01(weights.rfChile);
  const sum = rvGlobal + rfGlobal + rvChile + rfChile;
  if (sum <= 0) return { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  return {
    rvGlobal: rvGlobal / sum,
    rfGlobal: rfGlobal / sum,
    rvChile: rvChile / sum,
    rfChile: rfChile / sum,
  };
}

function summarizeRisk(weights: PortfolioWeights) {
  const normalized = normalizeWeights(weights);
  return {
    rv: clamp01(normalized.rvGlobal + normalized.rvChile),
    rf: clamp01(normalized.rfGlobal + normalized.rfChile),
  };
}

function summarizeGlobalLocalFromWeights(weights: PortfolioWeights) {
  const normalized = normalizeWeights(weights);
  return {
    global: clamp01(normalized.rvGlobal + normalized.rfGlobal),
    local: clamp01(normalized.rvChile + normalized.rfChile),
  };
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoneyCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}MM`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: '2-digit' });
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function ModeCard({
  active,
  title,
  subtitle,
  success,
  disabled,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  success: number | null;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? 'rgba(91, 140, 255, 0.18)' : 'transparent',
        border: `1px solid ${active ? T.primary : T.border}`,
        color: active ? T.textPrimary : T.textSecondary,
        borderRadius: 12,
        padding: 12,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{subtitle}</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>Exito: {success === null ? '—' : formatPercent(success)}</div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, background: T.surfaceEl }}>
      <div style={{ fontSize: 11, color: T.textMuted }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
