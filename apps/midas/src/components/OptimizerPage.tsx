import React, { startTransition, useEffect, useRef, useState } from 'react';
import type { ModelParameters, OptimizerObjective, OptimizerResult, PortfolioWeights } from '../domain/model/types';
import { T, css } from './theme';

type OptimizerSourceMode = 'base' | 'simulation';

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

export function OptimizerPage({
  baseParams,
  simulationParams,
  simulationActive,
  simulationLabel,
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
}) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [objective, setObjective] = useState<OptimizerObjective>('minRuin');
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [currentProbRuin, setCurrentProbRuin] = useState<number | null>(null);
  const [currentP50, setCurrentP50] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'quick' | 'full'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<OptimizerSourceMode>('base');
  const runIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const usingSimulation = simulationActive && sourceMode === 'simulation';
  const activeParams = usingSimulation ? simulationParams : baseParams;
  const sourceLabel = usingSimulation ? simulationLabel ?? 'SIMULACION ACTIVA' : 'BASE REAL';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopWorker();
    };
  }, []);

  useEffect(() => {
    if (!simulationActive && sourceMode === 'simulation') {
      setSourceMode('base');
    }
  }, [simulationActive, sourceMode]);

  useEffect(() => {
    setResult(null);
    setCurrentProbRuin(null);
    setCurrentP50(null);
    setErrorMessage(null);
    setProgress(0);
    setProgressDetail('');
    setPhase('idle');
  }, [sourceMode, objective, activeParams]);

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
        setResult(buildFallbackResult(activeParams, null, null));
      });
      return;
    }

    const runId = Date.now();
    runIdRef.current = runId;
    stopWorker();
    setIsOptimizing(true);
    setResult(null);
    setProgress(0);
    setProgressDetail('Inicializando calculo en segundo plano...');
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
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(activeParams, baselineRuin, baselineP50), activeParams));
      });
      setErrorMessage('La optimizacion tardó demasiado. Dejé un resultado de respaldo para que la app siga usable.');
      setProgressDetail('Tiempo maximo alcanzado');
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
        setProgressDetail('Linea base lista');
        return;
      }

      if (message.type === 'progress') {
        setPhase(message.phase);
        setProgress((prev) => Math.max(prev, Math.max(0, Math.min(99, message.pct))));
        setProgressDetail(message.detail);
        return;
      }

      if (message.type === 'quick-result') {
        quickResult = sanitizeResult(message.result, activeParams);
        setProgress((prev) => Math.max(prev, 35));
        return;
      }

      if (message.type === 'done') {
        startTransition(() => {
          setResult(sanitizeResult(message.result, activeParams));
        });
        setProgress(100);
        setProgressDetail('Optimizacion completada');
        setErrorMessage(null);
        finishRun(runId);
        return;
      }

      if (message.type === 'error') {
        baselineRuin = message.baselineProbRuin ?? baselineRuin;
        baselineP50 = message.baselineP50 ?? baselineP50;
        quickResult = message.quickResult ? sanitizeResult(message.quickResult, activeParams) : quickResult;
        startTransition(() => {
          setResult(sanitizeResult(quickResult ?? buildFallbackResult(activeParams, baselineRuin, baselineP50), activeParams));
        });
        setErrorMessage(
          'No pude completar la optimizacion. Te dejo un resultado de respaldo para que no pierdas continuidad.',
        );
        setProgressDetail('Optimizacion interrumpida');
        setProgress((prev) => Math.max(prev, 100));
        finishRun(runId);
      }
    };

    worker.onerror = () => {
      if (!isMountedRef.current || runIdRef.current !== runId) return;
      stopWorker();
      startTransition(() => {
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(activeParams, baselineRuin, baselineP50), activeParams));
      });
      setErrorMessage('El calculo falló en segundo plano. Dejé un resultado de respaldo para mantener la app estable.');
      setProgressDetail('Error en optimizacion');
      setProgress((prev) => Math.max(prev, 100));
      setIsOptimizing(false);
      setPhase('idle');
    };

    worker.onmessageerror = () => {
      if (!isMountedRef.current || runIdRef.current !== runId) return;
      stopWorker();
      startTransition(() => {
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(activeParams, baselineRuin, baselineP50), activeParams));
      });
      setErrorMessage('No pude leer la respuesta del optimizador. Te dejo un resultado de respaldo.');
      setProgressDetail('Error de comunicacion');
      setProgress((prev) => Math.max(prev, 100));
      setIsOptimizing(false);
      setPhase('idle');
    };

    worker.postMessage({
      type: 'start',
      runId,
      params: activeParams,
      objective,
    });
  };

  const OBJECTIVES: Array<[OptimizerObjective, string, string]> = [
    ['minRuin', 'Maximizar exito', 'Prioriza reducir la prob. de ruina'],
    ['maxP50', 'Maximizar patrimonio', 'Busca mayor P50 terminal'],
    ['balanced', 'Equilibrado', 'Mantiene un balance provisional entre exito y P50'],
  ];

  const currentWeights = activeParams.weights;
  const optimizedWeights = result?.weights ?? currentWeights;
  const visibleResult = !isOptimizing ? result : null;
  const currentSuccess = currentProbRuin === null ? null : 1 - currentProbRuin;
  const optimizedSuccess = visibleResult ? 1 - visibleResult.probRuin : null;
  const successDeltaPp =
    currentSuccess !== null && optimizedSuccess !== null ? (optimizedSuccess - currentSuccess) * 100 : null;
  const riskCurrent = summarizeRisk(currentWeights);
  const riskOptimized = summarizeRisk(optimizedWeights);
  const rvSplitCurrent = summarizeWithinBlock(currentWeights, 'rv');
  const rvSplitOptimized = summarizeWithinBlock(optimizedWeights, 'rv');
  const rfSplitCurrent = summarizeWithinBlock(currentWeights, 'rf');
  const rfSplitOptimized = summarizeWithinBlock(optimizedWeights, 'rf');
  const movementAmounts = visibleResult ? buildMoveAmounts(currentWeights, optimizedWeights, activeParams.capitalInitial) : [];
  const movementNetAmount = movementAmounts.reduce((sum, move) => sum + move.amount, 0);
  const insight = visibleResult ? renderInsight(visibleResult, movementAmounts, usingSimulation) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 800 }}>Optimizador</div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Salida orientada a decision: exito primero, RF/RV como eje principal y desglose operativo debajo.
          </div>
        </div>
        <Pill tone={usingSimulation ? 'warning' : 'neutral'}>{sourceLabel}</Pill>
      </div>

      {simulationActive && (
        <div
          style={{
            background: usingSimulation ? 'rgba(255, 176, 32, 0.12)' : T.surface,
            border: `1px solid ${usingSimulation ? 'rgba(255, 176, 32, 0.45)' : T.border}`,
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>
            {usingSimulation ? 'Optimizando una simulacion activa' : 'Hay una simulacion activa disponible'}
          </div>
          <div style={{ color: T.textSecondary, fontSize: 12 }}>
            El optimizador usa por defecto la cartera base. Si quieres optimizar la simulacion activa, debes elegirla
            explicitamente aqui.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <SourceButton active={sourceMode === 'base'} onClick={() => setSourceMode('base')}>
              Cartera base
            </SourceButton>
            <SourceButton active={sourceMode === 'simulation'} onClick={() => setSourceMode('simulation')}>
              Simulacion activa
            </SourceButton>
          </div>
        </div>
      )}

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ color: T.textMuted, fontSize: 11 }}>Objetivo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
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
        <SectionTitle
          eyebrow="Base de partida"
          title={usingSimulation ? 'Cartera seleccionada: simulacion activa' : 'Cartera seleccionada: base real'}
          subtitle="El optimizador parte desde esta distribucion, no desde una cartera implicita."
        />
        <RiskBar summary={riskCurrent} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
          <Stat label="Exito actual" value={currentSuccess === null ? 'Aun no calculado' : formatPercent(currentSuccess)} />
          <Stat label="Ruina actual" value={currentProbRuin === null ? 'Aun no calculado' : formatPercent(currentProbRuin)} />
          <Stat label="P50 actual" value={currentP50 === null ? 'Aun no calculado' : formatMoneyCompact(currentP50)} />
          <Stat label="Capital base" value={formatMoneyCompact(activeParams.capitalInitial)} />
        </div>
      </div>

      {isOptimizing ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ color: T.primary, fontSize: 14, marginBottom: 8 }}>Optimizando portafolio...</div>
          <div style={{ color: T.textMuted, fontSize: 11 }}>
            {phase === 'quick' ? 'Estimacion rapida en curso...' : 'Refinando con mas iteraciones...'}
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>
            La UI sigue usable mientras el worker explora combinaciones en segundo plano.
          </div>
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
          ▶ Optimizar {usingSimulation ? 'simulacion activa' : 'cartera base'}
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
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
            <SectionTitle
              eyebrow="Resultado principal"
              title="Actual vs optimizado teorico"
              subtitle={
                usingSimulation
                  ? 'Este resultado esta calculado sobre la simulacion activa seleccionada.'
                  : 'Este resultado esta calculado sobre la cartera base real.'
              }
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <ResultCard
                title="Actual"
                tone="neutral"
                sourceLabel={sourceLabel}
                success={currentSuccess}
                ruin={currentProbRuin}
                p50={currentP50}
              />
              <ResultCard
                title="Optimizado teorico"
                tone="positive"
                sourceLabel={sourceLabel}
                success={optimizedSuccess}
                ruin={visibleResult.probRuin}
                p50={visibleResult.terminalP50}
                deltaPp={successDeltaPp}
              />
            </div>
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
            <SectionTitle
              eyebrow="Capa 1"
              title="Renta fija vs renta variable"
              subtitle="Este es el eje principal de decision. Primero se entiende el cambio grande; despues el detalle."
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <AllocationCompareCard title="Actual" summary={riskCurrent} />
              <AllocationCompareCard title="Optimizado teorico" summary={riskOptimized} />
            </div>
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
            <SectionTitle
              eyebrow="Capa 2"
              title="Desglose Global / Local"
              subtitle="Una vez definido RF vs RV, aqui se ve como se distribuye cada bloque por geografia."
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <BlockSplitCard title="Dentro de renta variable" current={rvSplitCurrent} optimized={rvSplitOptimized} />
              <BlockSplitCard title="Dentro de renta fija" current={rfSplitCurrent} optimized={rfSplitOptimized} />
            </div>
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
            <SectionTitle
              eyebrow="Capa 3"
              title="Montos y movimientos"
              subtitle="Traduccion operativa aproximada en CLP desde la cartera seleccionada."
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Stat
                label="Mover hacia RV"
                value={`${formatSignedPp(riskOptimized.rv - riskCurrent.rv)} · ${formatSignedMoney(
                  (riskOptimized.rv - riskCurrent.rv) * activeParams.capitalInitial,
                )}`}
                accent={riskOptimized.rv >= riskCurrent.rv ? T.positive : T.negative}
              />
              <Stat
                label="Mover hacia RF"
                value={`${formatSignedPp(riskOptimized.rf - riskCurrent.rf)} · ${formatSignedMoney(
                  (riskOptimized.rf - riskCurrent.rf) * activeParams.capitalInitial,
                )}`}
                accent={riskOptimized.rf >= riskCurrent.rf ? T.positive : T.negative}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {movementAmounts.map((move) => (
                <div key={move.sleeve} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 18, color: move.direction === 'up' ? T.positive : T.negative }}>
                    {move.direction === 'up' ? '↑' : '↓'}
                  </span>
                  <span style={{ color: T.textSecondary, fontSize: 13, flex: 1 }}>{move.sleeve}</span>
                  <span style={{ ...css.mono, color: T.textPrimary, fontSize: 12 }}>{formatSignedPp(move.deltaPp / 100)}</span>
                  <span
                    style={{
                      ...css.mono,
                      color: move.direction === 'up' ? T.positive : T.negative,
                      fontSize: 12,
                      minWidth: 86,
                      textAlign: 'right',
                    }}
                  >
                    {formatSignedMoney(move.amount)}
                  </span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 4,
                  paddingTop: 10,
                  borderTop: `1px solid ${T.border}`,
                }}
              >
                <span style={{ color: T.textMuted, fontSize: 11 }}>Neto total</span>
                <span style={{ ...css.mono, color: T.textSecondary, fontSize: 12 }}>{formatSignedMoney(movementNetAmount)}</span>
              </div>
              {movementAmounts.length === 0 && (
                <p style={{ color: T.textMuted, fontSize: 12, margin: 0 }}>
                  La cartera ya está muy cerca del punto teorico para este objetivo.
                </p>
              )}
            </div>
          </div>

          {insight && (
            <div style={{ background: T.surfaceEl, borderRadius: 10, padding: 14 }}>
              <p style={{ color: T.textSecondary, fontSize: 12, lineHeight: 1.5, margin: 0 }}>{insight}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? T.surfaceEl : 'transparent',
        border: `1px solid ${active ? T.primary : T.border}`,
        color: active ? T.primary : T.textSecondary,
        borderRadius: 10,
        padding: '10px 12px',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warning' }) {
  const border = tone === 'warning' ? 'rgba(255, 176, 32, 0.45)' : T.border;
  const color = tone === 'warning' ? T.warning : T.textSecondary;
  const background = tone === 'warning' ? 'rgba(255, 176, 32, 0.1)' : T.surface;
  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: 999,
        border: `1px solid ${border}`,
        background,
        color,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: T.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2 }}>{eyebrow}</div>
      <div style={{ color: T.textPrimary, fontSize: 15, fontWeight: 700, marginTop: 4 }}>{title}</div>
      <div style={{ color: T.textMuted, fontSize: 12, marginTop: 4 }}>{subtitle}</div>
    </div>
  );
}

function ResultCard({
  title,
  sourceLabel,
  success,
  ruin,
  p50,
  deltaPp,
  tone,
}: {
  title: string;
  sourceLabel: string;
  success: number | null;
  ruin: number | null;
  p50: number | null;
  deltaPp?: number | null;
  tone: 'neutral' | 'positive';
}) {
  const accent = tone === 'positive' ? T.positive : T.textPrimary;
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, background: T.surface }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{title}</div>
        <Pill tone={tone === 'positive' ? 'warning' : 'neutral'}>{sourceLabel}</Pill>
      </div>
      <div style={{ color: T.textMuted, fontSize: 11, marginTop: 10 }}>Probabilidad de exito</div>
      <div style={{ ...css.mono, color: accent, fontSize: 30, fontWeight: 800, marginTop: 4 }}>
        {success === null ? '—' : formatPercent(success)}
      </div>
      {deltaPp !== null && deltaPp !== undefined && (
        <div style={{ color: deltaPp >= 0 ? T.positive : T.negative, fontSize: 12, marginTop: 4 }}>
          {deltaPp >= 0 ? '+' : ''}
          {deltaPp.toFixed(1)}pp vs actual
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginTop: 14 }}>
        <Stat label="Ruina" value={ruin === null ? '—' : formatPercent(ruin)} />
        <Stat label="P50" value={p50 === null ? '—' : formatMoneyCompact(p50)} />
      </div>
    </div>
  );
}

function AllocationCompareCard({
  title,
  summary,
}: {
  title: string;
  summary: { rv: number; rf: number };
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <RiskBar summary={summary} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginTop: 12 }}>
        <Stat label="Renta variable" value={formatPercent(summary.rv)} />
        <Stat label="Renta fija" value={formatPercent(summary.rf)} />
      </div>
    </div>
  );
}

function RiskBar({ summary }: { summary: { rv: number; rf: number } }) {
  return (
    <div style={{ height: 14, background: T.surfaceEl, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: `${summary.rf * 100}%`, background: T.secondary }} />
      <div style={{ width: `${summary.rv * 100}%`, background: T.primary }} />
    </div>
  );
}

function BlockSplitCard({
  title,
  current,
  optimized,
}: {
  title: string;
  current: { global: number; local: number; total: number };
  optimized: { global: number; local: number; total: number };
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>
        Peso del bloque en cartera: actual {formatPercent(current.total)} · optimizado {formatPercent(optimized.total)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginTop: 12 }}>
        <div>
          <div style={{ color: T.textSecondary, fontSize: 12, marginBottom: 8 }}>Actual</div>
          <SplitBar globalShare={current.global} localShare={current.local} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 8 }}>
            <Stat label="Global" value={formatPercent(current.global)} />
            <Stat label="Local" value={formatPercent(current.local)} />
          </div>
        </div>
        <div>
          <div style={{ color: T.textSecondary, fontSize: 12, marginBottom: 8 }}>Optimizado teorico</div>
          <SplitBar globalShare={optimized.global} localShare={optimized.local} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 8 }}>
            <Stat label="Global" value={formatPercent(optimized.global)} />
            <Stat label="Local" value={formatPercent(optimized.local)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SplitBar({ globalShare, localShare }: { globalShare: number; localShare: number }) {
  return (
    <div style={{ height: 12, background: T.surfaceEl, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: `${globalShare * 100}%`, background: T.primary }} />
      <div style={{ width: `${localShare * 100}%`, background: T.warning }} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ color: T.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ ...css.mono, color: accent ?? T.textPrimary, fontSize: 15, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function summarizeRisk(weights: PortfolioWeights) {
  const rv = clamp01(weights.rvGlobal + weights.rvChile);
  const rf = clamp01(weights.rfGlobal + weights.rfChile);
  return { rv, rf };
}

function summarizeWithinBlock(weights: PortfolioWeights, block: 'rv' | 'rf') {
  const globalValue = block === 'rv' ? weights.rvGlobal : weights.rfGlobal;
  const localValue = block === 'rv' ? weights.rvChile : weights.rfChile;
  const total = Math.max(0, globalValue + localValue);
  if (total <= 0) return { global: 0, local: 0, total: 0 };
  return {
    global: globalValue / total,
    local: localValue / total,
    total,
  };
}

function buildMoveAmounts(currentWeights: PortfolioWeights, optimizedWeights: PortfolioWeights, capitalInitial: number) {
  const sleeves: Array<{ sleeve: string; current: number; optimized: number }> = [
    { sleeve: 'RV Global', current: currentWeights.rvGlobal, optimized: optimizedWeights.rvGlobal },
    { sleeve: 'RF Global', current: currentWeights.rfGlobal, optimized: optimizedWeights.rfGlobal },
    { sleeve: 'RV Chile', current: currentWeights.rvChile, optimized: optimizedWeights.rvChile },
    { sleeve: 'RF Chile UF', current: currentWeights.rfChile, optimized: optimizedWeights.rfChile },
  ];

  return sleeves
    .map((item) => {
      const deltaPp = (item.optimized - item.current) * 100;
      return {
        sleeve: item.sleeve,
        deltaPp,
        direction: (deltaPp >= 0 ? 'up' : 'down') as 'up' | 'down',
        amount: (deltaPp / 100) * capitalInitial,
      };
    })
    .filter((move) => Math.abs(move.deltaPp) >= 0.01 || Math.abs(move.amount) >= 1)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function renderInsight(
  result: OptimizerResult,
  movementAmounts: Array<{ sleeve: string; deltaPp: number; direction: 'up' | 'down'; amount: number }>,
  usingSimulation: boolean,
): string | null {
  const successGainPp = result.vsCurrentRuin * 100;
  const source = usingSimulation ? 'la simulacion activa' : 'la cartera base';
  const topMove = movementAmounts[0];
  if (!topMove) {
    return `Sobre ${source}, el optimizador no detecta un cambio teorico material para este objetivo.`;
  }
  return `Sobre ${source}, la mejora teorica de exito es de ${successGainPp.toFixed(
    1,
  )}pp. El ajuste dominante es ${topMove.direction === 'up' ? 'subir' : 'bajar'} ${topMove.sleeve}.`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPp(value: number) {
  const pp = Math.abs(value) < 0.00005 ? 0 : value * 100;
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp`;
}

function formatMoneyCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}MM`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatSignedMoney(value: number) {
  const safeValue = Math.abs(value) < 1 ? 0 : value;
  return `${safeValue >= 0 ? '+' : '-'}${formatMoneyCompact(Math.abs(safeValue))}`;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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
