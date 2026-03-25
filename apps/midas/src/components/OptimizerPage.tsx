import React, { startTransition, useEffect, useRef, useState } from 'react';
import type { ModelParameters, OptimizerResult, OptimizerObjective } from '../domain/model/types';
import { T, css } from './theme';

type OptimizerWorkerMessage =
  | {
      type: 'baseline';
      runId: number;
      probRuin: number;
      terminalP50: number;
    }
  | {
      type: 'progress';
      runId: number;
      phase: 'quick' | 'full';
      pct: number;
      detail: string;
    }
  | {
      type: 'quick-result';
      runId: number;
      result: OptimizerResult;
    }
  | {
      type: 'done';
      runId: number;
      result: OptimizerResult;
    }
  | {
      type: 'error';
      runId: number;
      message: string;
      baselineProbRuin?: number;
      baselineP50?: number;
      quickResult?: OptimizerResult;
    };

const OPTIMIZER_TIMEOUT_MS = 45_000;

export function OptimizerPage({ params, stateLabel }: { params: ModelParameters; stateLabel?: string }) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [objective, setObjective] = useState<OptimizerObjective>('minRuin');
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [currentProbRuin, setCurrentProbRuin] = useState<number | null>(null);
  const [currentP50, setCurrentP50] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'quick' | 'full'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopWorker();
    };
  }, []);

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

  const finishRun = (runId: number) => {
    if (!isMountedRef.current || runIdRef.current !== runId) return;
    stopWorker();
    setIsOptimizing(false);
    setPhase('idle');
  };

  const handleOptimize = () => {
    if (isOptimizing) return;
    if (typeof Worker === 'undefined') {
      setErrorMessage('Este navegador no soporta el modo estable del optimizador.');
      startTransition(() => {
        setResult(buildFallbackResult(params, null, null));
      });
      return;
    }

    const runId = Date.now();
    runIdRef.current = runId;
    stopWorker();
    setIsOptimizing(true);
    setResult(null);
    setProgress(0);
    setProgressDetail('Inicializando cálculo en segundo plano...');
    setErrorMessage(null);
    setPhase('quick');
    let quickResult: OptimizerResult | null = null;
    let baselineP50: number | null = null;
    let baselineRuin: number | null = null;

    const worker = new Worker(new URL('../domain/optimizer/optimizer.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    timeoutRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || runIdRef.current !== runId || workerRef.current !== worker) return;
      stopWorker();
      startTransition(() => {
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(params, baselineRuin, baselineP50), params));
      });
      setErrorMessage('La optimización tardó demasiado. Dejé un resultado de respaldo para que la app siga usable.');
      setProgressDetail('Tiempo máximo alcanzado');
      setProgress((prev) => Math.max(prev, 100));
      setIsOptimizing(false);
      setPhase('idle');
    }, OPTIMIZER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<OptimizerWorkerMessage>) => {
      const message = event.data;
      if (!message || message.runId !== runId || !isMountedRef.current || runIdRef.current !== runId) return;

      if (message.type === 'baseline') {
        baselineRuin = message.probRuin;
        baselineP50 = message.terminalP50;
        setCurrentProbRuin(message.probRuin);
        setCurrentP50(message.terminalP50);
        setProgressDetail('Simulación base lista');
        return;
      }

      if (message.type === 'progress') {
        setPhase(message.phase);
        setProgress((prev) => Math.max(prev, Math.max(0, Math.min(99, message.pct))));
        setProgressDetail(message.detail);
        return;
      }

      if (message.type === 'quick-result') {
        quickResult = sanitizeResult(message.result, params);
        setProgress((prev) => Math.max(prev, 35));
        return;
      }

      if (message.type === 'done') {
        startTransition(() => {
          setResult(sanitizeResult(message.result, params));
        });
        setProgress(100);
        setProgressDetail('Optimización completada');
        setErrorMessage(null);
        finishRun(runId);
        return;
      }

      if (message.type === 'error') {
        baselineRuin = message.baselineProbRuin ?? baselineRuin;
        baselineP50 = message.baselineP50 ?? baselineP50;
        quickResult = message.quickResult ? sanitizeResult(message.quickResult, params) : quickResult;
        startTransition(() => {
          setResult(sanitizeResult(quickResult ?? buildFallbackResult(params, baselineRuin, baselineP50), params));
        });
        setErrorMessage(
          'No pude completar la optimización. Te dejo un resultado de respaldo para que no pierdas continuidad.',
        );
        setProgressDetail('Optimización interrumpida');
        setProgress((prev) => Math.max(prev, 100));
        finishRun(runId);
      }
    };

    worker.onerror = () => {
      if (!isMountedRef.current || runIdRef.current !== runId) return;
      stopWorker();
      startTransition(() => {
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(params, baselineRuin, baselineP50), params));
      });
      setErrorMessage('El cálculo falló en segundo plano. Dejé un resultado de respaldo para mantener la app estable.');
      setProgressDetail('Error en optimización');
      setProgress((prev) => Math.max(prev, 100));
      setIsOptimizing(false);
      setPhase('idle');
    };

    worker.onmessageerror = () => {
      if (!isMountedRef.current || runIdRef.current !== runId) return;
      stopWorker();
      startTransition(() => {
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(params, baselineRuin, baselineP50), params));
      });
      setErrorMessage('No pude leer la respuesta del optimizador. Te dejo un resultado de respaldo.');
      setProgressDetail('Error de comunicación');
      setProgress((prev) => Math.max(prev, 100));
      setIsOptimizing(false);
      setPhase('idle');
    };

    worker.postMessage({
      type: 'start',
      runId,
      params,
      objective,
    });
  };

  const OBJECTIVES: Array<[OptimizerObjective, string, string]> = [
    ['minRuin', 'Minimizar ruina', 'Menor prob. de ruina'],
    ['maxP50', 'Maximizar patrimonio', 'Mayor P50 terminal'],
    ['balanced', 'Equilibrado', 'Balance entre ruina y patrimonio'],
  ];
  const currentRuin = currentProbRuin ?? result?.probRuin ?? null;
  const insight = result ? renderInsight(result.moves) : null;
  const optimizedWeights = result?.weights ?? params.weights;
  const rvTotalCurrent = params.weights.rvGlobal + params.weights.rvChile;
  const rfTotalCurrent = params.weights.rfGlobal + params.weights.rfChile;
  const rvTotalOptim = optimizedWeights.rvGlobal + optimizedWeights.rvChile;
  const rfTotalOptim = optimizedWeights.rfGlobal + optimizedWeights.rfChile;
  const instrumentSuggestions = result ? buildInstrumentSuggestions(result.moves) : [];
  const visibleResult = !isOptimizing ? result : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 700 }}>Optimizador</div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>Ajusta pesos para minimizar riesgo o maximizar patrimonio</div>
        </div>
        {stateLabel && <div style={{ color: T.textSecondary, fontSize: 11 }}>{stateLabel}</div>}
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
          <div style={{ color: T.textMuted, fontSize: 11 }}>
            {phase === 'quick' ? 'Estimación rápida en curso…' : 'Refinando con más iteraciones…'}
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>Evaluando combinaciones de pesos · puede tardar 30–60 segundos</div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>{progressDetail || 'Procesando...'}</div>
          <div
            style={{
              marginTop: 10,
              height: 8,
              borderRadius: 999,
              background: T.surfaceEl,
              border: `1px solid ${T.border}`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, progress))}%`,
                height: '100%',
                background: T.primary,
                transition: 'width 140ms linear',
              }}
            />
          </div>
          <div style={{ ...css.mono, color: T.textSecondary, fontSize: 12, marginTop: 6 }}>{progress}%</div>
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

      {errorMessage && (
        <div
          style={{
            background: T.surface,
            border: `1px solid ${T.warning}`,
            borderRadius: 10,
            padding: 12,
            color: T.textSecondary,
            fontSize: 12,
          }}
        >
          {errorMessage}
        </div>
      )}

      {visibleResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16 }}>
            <p style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 12 }}>
              Antes vs Despues
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
              <div>
                <div style={{ color: T.textSecondary, fontSize: 12, marginBottom: 6 }}>Actual</div>
                <AllocationBar weights={params.weights} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 8 }}>
                  <Stat label="RV total" value={`${(rvTotalCurrent * 100).toFixed(0)}%`} />
                  <Stat label="RF total" value={`${(rfTotalCurrent * 100).toFixed(0)}%`} />
                </div>
              </div>
              <div>
                <div style={{ color: T.textSecondary, fontSize: 12, marginBottom: 6 }}>Optimizado</div>
                <AllocationBar weights={optimizedWeights} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 8 }}>
                  <Stat label="RV total" value={`${(rvTotalOptim * 100).toFixed(0)}%`} />
                  <Stat label="RF total" value={`${(rfTotalOptim * 100).toFixed(0)}%`} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16 }}>
            <p style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 12 }}>
              Movimientos recomendados
            </p>
            {visibleResult.moves.map((m) => (
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
            {visibleResult.moves.length === 0 && (
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
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Patrimonio P50 actual</span>
              <span style={{ ...css.mono, color: T.textPrimary, fontSize: 13 }}>
                {currentP50 === null ? '—' : `$${(currentP50 / 1e6).toFixed(0)}MM`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Prob. ruina óptima</span>
              <span style={{ ...css.mono, color: T.positive, fontSize: 13 }}>
                {(visibleResult.probRuin * 100).toFixed(1)}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Mejora</span>
              <span style={{ ...css.mono, color: T.positive, fontSize: 13, fontWeight: 700 }}>
                {(visibleResult.vsCurrentRuin * 100).toFixed(1)}pp ▼
              </span>
            </div>
            <div style={{ height: 1, background: T.border, marginBottom: 12 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: T.textSecondary, fontSize: 12 }}>Patrimonio P50</span>
              <span style={{ ...css.mono, color: T.primary, fontSize: 13 }}>
                ${(visibleResult.terminalP50 / 1e6).toFixed(0)}MM
              </span>
            </div>
          </div>

          {instrumentSuggestions.length > 0 && (
            <div style={{ marginTop: 10, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16 }}>
              <p style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', marginBottom: 10 }}>
                Instrumentos sugeridos
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {instrumentSuggestions.map((item) => (
                  <div key={item} style={{ color: T.textSecondary, fontSize: 12 }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

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
  const safeTotal = total > 0 ? total : 1;
  const slices: Array<[number, string]> = [
    [weights.rvGlobal, T.primary],
    [weights.rfGlobal, T.secondary],
    [weights.rvChile, T.warning],
    [weights.rfChile, T.metalBase],
  ];
  return (
    <div style={{ height: 12, background: T.surfaceEl, borderRadius: 10, overflow: 'hidden', display: 'flex' }}>
      {slices.map(([v, c], idx) => (
        <div key={idx} style={{ width: `${Math.max(0, (v / safeTotal) * 100)}%`, background: c }} />
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

function buildInstrumentSuggestions(moves: OptimizerResult['moves']): string[] {
  const map: Record<string, string> = {
    'RV Global': 'RV Global: ETF MSCI World o Global ACWI',
    'RF Global': 'RF Global: ETF bonos globales (aggregate)',
    'RV Chile': 'RV Chile: ETF/IGPA o fondo renta variable local',
    'RF Chile UF': 'RF Chile UF: fondo renta fija UF o depósitos UF',
  };
  const picks = moves
    .filter((m) => m.direction === 'up')
    .map((m) => map[m.sleeve])
    .filter((m): m is string => Boolean(m));
  return Array.from(new Set(picks));
}

function buildFallbackResult(
  params: ModelParameters,
  baselineProbRuin: number | null,
  baselineP50: number | null,
): OptimizerResult {
  return {
    weights: params.weights,
    probRuin: baselineProbRuin ?? 0,
    terminalP50: baselineP50 ?? 0,
    terminalP10: 0,
    vsCurrentRuin: 0,
    vsCurrentP50: 0,
    moves: [],
  };
}

function sanitizeResult(raw: OptimizerResult, params: ModelParameters): OptimizerResult {
  const safeWeight = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  const safeMoves = Array.isArray(raw.moves)
    ? raw.moves.filter((move) => Number.isFinite(move.delta) && (move.direction === 'up' || move.direction === 'down'))
    : [];

  return {
    weights: {
      rvGlobal: safeWeight(raw.weights?.rvGlobal, params.weights.rvGlobal),
      rfGlobal: safeWeight(raw.weights?.rfGlobal, params.weights.rfGlobal),
      rvChile: safeWeight(raw.weights?.rvChile, params.weights.rvChile),
      rfChile: safeWeight(raw.weights?.rfChile, params.weights.rfChile),
    },
    probRuin: Number.isFinite(raw.probRuin) ? raw.probRuin : 0,
    terminalP50: Number.isFinite(raw.terminalP50) ? raw.terminalP50 : 0,
    terminalP10: Number.isFinite(raw.terminalP10) ? raw.terminalP10 : 0,
    vsCurrentRuin: Number.isFinite(raw.vsCurrentRuin) ? raw.vsCurrentRuin : 0,
    vsCurrentP50: Number.isFinite(raw.vsCurrentP50) ? raw.vsCurrentP50 : 0,
    moves: safeMoves,
  };
}
