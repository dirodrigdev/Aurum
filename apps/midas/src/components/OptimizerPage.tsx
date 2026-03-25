import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelParameters, OptimizerObjective, OptimizerResult, PortfolioWeights } from '../domain/model/types';
import { T, css } from './theme';
import {
  classifyCoverageQuality,
  inferImplicitMixFromInstrumentBase,
  loadInstrumentBaseSnapshot,
  summarizeInstrumentBase,
  type CoverageQuality,
  type OptimizableBaseReference,
} from '../domain/instrumentBase';

type OptimizerSourceMode = 'base' | 'simulation';
type BaselineSnapshot = { probRuin: number; terminalP50: number };
type BaselineBySource = Record<OptimizerSourceMode, BaselineSnapshot | null>;

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
  preloadedBaseStats,
  preloadedSimulationStats,
  optimizableBaseReference,
}: {
  baseParams: ModelParameters;
  simulationParams: ModelParameters;
  simulationActive: boolean;
  simulationLabel?: string;
  preloadedBaseStats?: BaselineSnapshot | null;
  preloadedSimulationStats?: BaselineSnapshot | null;
  optimizableBaseReference: OptimizableBaseReference;
}) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [objective, setObjective] = useState<OptimizerObjective>('minRuin');
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [baselineBySource, setBaselineBySource] = useState<BaselineBySource>({
    base: preloadedBaseStats ?? null,
    simulation: preloadedSimulationStats ?? null,
  });
  const [phase, setPhase] = useState<'idle' | 'quick' | 'full'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<OptimizerSourceMode>('base');
  const [instrumentBaseSnapshot, setInstrumentBaseSnapshot] = useState(() => loadInstrumentBaseSnapshot());
  const runIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const usingSimulation = simulationActive && sourceMode === 'simulation';
  const activeParams = usingSimulation ? simulationParams : baseParams;
  const sourceLabel = usingSimulation ? simulationLabel ?? 'SIMULACION ACTIVA' : 'BASE REAL';
  const activeSource: OptimizerSourceMode = usingSimulation ? 'simulation' : 'base';
  const activeBaseline = baselineBySource[activeSource];
  const currentProbRuin = activeBaseline?.probRuin ?? null;
  const currentP50 = activeBaseline?.terminalP50 ?? null;

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
    setBaselineBySource((prev) => ({
      base: preloadedBaseStats ?? prev.base,
      simulation: preloadedSimulationStats ?? prev.simulation,
    }));
  }, [preloadedBaseStats, preloadedSimulationStats]);

  useEffect(() => {
    const refreshSnapshot = () => setInstrumentBaseSnapshot(loadInstrumentBaseSnapshot());
    refreshSnapshot();
    window.addEventListener('focus', refreshSnapshot);
    return () => {
      window.removeEventListener('focus', refreshSnapshot);
    };
  }, []);

  useEffect(() => {
    if (baselineBySource[activeSource]) return;
    if (typeof Worker === 'undefined') return;

    const runId = Date.now();
    const worker = new Worker(new URL('../domain/optimizer/optimizer.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<OptimizerWorkerMessage>) => {
      const message = event.data;
      if (!message || message.runId !== runId) return;
      if (message.type === 'baseline') {
        setBaselineBySource((prev) => ({
          ...prev,
          [activeSource]: {
            probRuin: message.probRuin,
            terminalP50: message.terminalP50,
          },
        }));
        worker.terminate();
      }
    };

    worker.postMessage({
      type: 'baseline-only',
      runId,
      params: activeParams,
    });

    return () => {
      worker.terminate();
    };
  }, [activeParams, activeSource, baselineBySource]);

  useEffect(() => {
    setResult(null);
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
    const runSourceMode: OptimizerSourceMode = sourceMode;
    const paramsForRun = activeParams;
    if (typeof Worker === 'undefined') {
      setErrorMessage('Este navegador no soporta el modo estable del optimizador.');
      startTransition(() => {
        setResult(buildFallbackResult(paramsForRun, null, null));
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
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(paramsForRun, baselineRuin, baselineP50), paramsForRun));
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
        setBaselineBySource((prev) => ({
          ...prev,
          [runSourceMode]: {
            probRuin: message.probRuin,
            terminalP50: message.terminalP50,
          },
        }));
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
        quickResult = sanitizeResult(message.result, paramsForRun);
        setProgress((prev) => Math.max(prev, 35));
        return;
      }

      if (message.type === 'done') {
        startTransition(() => {
          setResult(sanitizeResult(message.result, paramsForRun));
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
        quickResult = message.quickResult ? sanitizeResult(message.quickResult, paramsForRun) : quickResult;
        startTransition(() => {
          setResult(sanitizeResult(quickResult ?? buildFallbackResult(paramsForRun, baselineRuin, baselineP50), paramsForRun));
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
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(paramsForRun, baselineRuin, baselineP50), paramsForRun));
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
        setResult(sanitizeResult(quickResult ?? buildFallbackResult(paramsForRun, baselineRuin, baselineP50), paramsForRun));
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
      params: paramsForRun,
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
  const instrumentBaseSummary = useMemo(
    () => summarizeInstrumentBase(instrumentBaseSnapshot, optimizableBaseReference.amountClp),
    [instrumentBaseSnapshot, optimizableBaseReference.amountClp],
  );
  const implicitMix = useMemo(
    () => inferImplicitMixFromInstrumentBase(instrumentBaseSnapshot),
    [instrumentBaseSnapshot],
  );
  const coverageQuality = classifyCoverageQuality(instrumentBaseSummary?.coverageVsOptimizableBaseRatio ?? null);
  const theoreticalMix = normalizeWeights(optimizedWeights);
  const theoreticalRisk = summarizeRisk(theoreticalMix);
  const theoreticalGeo = summarizeGlobalLocalFromWeights(theoreticalMix);

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
            (() => {
              const isActive = objective === id;
              const isPrimary = id === 'minRuin';
              const background = isPrimary
                ? isActive
                  ? T.primary
                  : 'rgba(91, 140, 255, 0.14)'
                : isActive
                  ? T.surfaceEl
                  : 'transparent';
              const borderColor = isPrimary ? T.primary : isActive ? T.primary : T.border;
              const titleColor = isPrimary ? (isActive ? '#FFFFFF' : T.primary) : isActive ? T.textPrimary : T.textSecondary;
              const descColor = isPrimary ? (isActive ? 'rgba(255,255,255,0.82)' : T.textSecondary) : T.textMuted;
              return (
                <button
                  key={id}
                  onClick={() => setObjective(id)}
                  style={{
                    background,
                    border: `1px solid ${borderColor}`,
                    color: titleColor,
                    borderRadius: 10,
                    padding: '10px 12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>{label}</div>
                    {isPrimary && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: 999,
                          border: `1px solid ${isActive ? 'rgba(255,255,255,0.6)' : 'rgba(91, 140, 255, 0.45)'}`,
                          color: isActive ? '#FFFFFF' : T.primary,
                        }}
                      >
                        Principal
                      </span>
                    )}
                  </div>
                  <div style={{ color: descColor, fontSize: 11, marginTop: 4 }}>{desc}</div>
                </button>
              );
            })()
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
          <Stat label="Exito actual" value={currentSuccess === null ? 'Calculando...' : formatPercent(currentSuccess)} />
          <Stat label="Ruina actual" value={currentProbRuin === null ? 'Calculando...' : formatPercent(currentProbRuin)} />
          <Stat label="P50 actual" value={currentP50 === null ? 'Calculando...' : formatMoneyCompact(currentP50)} />
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
              eyebrow="Fase Instrumental"
              title="Mix inferido de instrumentos vs optimizado teorico"
              subtitle="El mix actual se infiere desde exposiciones por instrumento. Aun no es una propuesta final de movimientos."
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
              <Stat
                label="Base instrumental cargada"
                value={instrumentBaseSummary ? formatMoneyCompact(instrumentBaseSummary.totalAmountCLP) : 'No cargada'}
              />
              <Stat
                label="Base optimizable oficial"
                value={optimizableBaseReference.amountClp ? formatMoneyCompact(optimizableBaseReference.amountClp) : 'Pendiente'}
              />
              <Stat
                label="Cobertura"
                value={formatCoverageRatio(instrumentBaseSummary?.coverageVsOptimizableBaseRatio ?? null)}
                accent={coverageToneColor(coverageQuality)}
              />
              <div>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Calidad cobertura</div>
                <div style={{ marginTop: 4 }}>
                  <CoverageBadge quality={coverageQuality} />
                </div>
              </div>
            </div>

            {!implicitMix ? (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: 10,
                  padding: 12,
                  color: T.textSecondary,
                  fontSize: 12,
                }}
              >
                No hay base instrumental util para inferir el mix actual. Carga JSON en Ajustes para habilitar esta comparacion.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <PairGapCard
                    title="RV / RF"
                    currentLeft={implicitMix.rv}
                    currentRight={implicitMix.rf}
                    targetLeft={theoreticalRisk.rv}
                    targetRight={theoreticalRisk.rf}
                    leftLabel="RV"
                    rightLabel="RF"
                  />
                  <PairGapCard
                    title="Global / Local"
                    currentLeft={implicitMix.global}
                    currentRight={implicitMix.local}
                    targetLeft={theoreticalGeo.global}
                    targetRight={theoreticalGeo.local}
                    leftLabel="Global"
                    rightLabel="Local"
                  />
                </div>
                <SleeveGapTable current={implicitMix.sleeves} target={theoreticalMix} />
              </div>
            )}
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
                    {formatSignedMoneyClp(move.amount)}
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
                <span style={{ ...css.mono, color: T.textSecondary, fontSize: 12 }}>{formatSignedMoneyClp(movementNetAmount)}</span>
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
      <div style={{ width: `${summary.rv * 100}%`, background: T.primary }} />
      <div style={{ width: `${summary.rf * 100}%`, background: T.secondary }} />
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

function CoverageBadge({ quality }: { quality: CoverageQuality }) {
  const config =
    quality === 'high'
      ? { label: 'Alta', color: T.positive, border: 'rgba(61, 212, 141, 0.4)', bg: 'rgba(61, 212, 141, 0.1)' }
      : quality === 'partial'
        ? { label: 'Parcial', color: T.warning, border: 'rgba(255, 176, 32, 0.45)', bg: 'rgba(255, 176, 32, 0.12)' }
        : quality === 'insufficient'
          ? { label: 'Insuficiente', color: T.negative, border: 'rgba(255, 90, 90, 0.45)', bg: 'rgba(255, 90, 90, 0.1)' }
          : { label: 'Sin referencia', color: T.textMuted, border: T.border, bg: T.surfaceEl };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 9px',
        borderRadius: 999,
        border: `1px solid ${config.border}`,
        background: config.bg,
        color: config.color,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {config.label}
    </span>
  );
}

function PairGapCard({
  title,
  currentLeft,
  currentRight,
  targetLeft,
  targetRight,
  leftLabel,
  rightLabel,
}: {
  title: string;
  currentLeft: number;
  currentRight: number;
  targetLeft: number;
  targetRight: number;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4 }}>Inferido actual vs objetivo teorico</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <Stat label={`${leftLabel} actual`} value={formatPercent(currentLeft)} />
        <Stat label={`${leftLabel} teorico`} value={formatPercent(targetLeft)} />
        <Stat label={`${rightLabel} actual`} value={formatPercent(currentRight)} />
        <Stat label={`${rightLabel} teorico`} value={formatPercent(targetRight)} />
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Stat
          label={`Brecha ${leftLabel}`}
          value={formatSignedPp(targetLeft - currentLeft)}
          accent={targetLeft - currentLeft >= 0 ? T.positive : T.negative}
        />
        <Stat
          label={`Brecha ${rightLabel}`}
          value={formatSignedPp(targetRight - currentRight)}
          accent={targetRight - currentRight >= 0 ? T.positive : T.negative}
        />
      </div>
    </div>
  );
}

function SleeveGapTable({
  current,
  target,
}: {
  current: { rvGlobal: number; rvChile: number; rfGlobal: number; rfChile: number };
  target: PortfolioWeights;
}) {
  const rows: Array<{ key: keyof PortfolioWeights; label: string }> = [
    { key: 'rvGlobal', label: 'RV Global' },
    { key: 'rvChile', label: 'RV Chile' },
    { key: 'rfGlobal', label: 'RF Global' },
    { key: 'rfChile', label: 'RF Chile UF' },
  ];

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Brecha por 4 sleeves (inferido)</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => {
          const currentValue = current[row.key];
          const targetValue = target[row.key];
          const delta = targetValue - currentValue;
          return (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(90px, 1fr) minmax(64px, auto) minmax(64px, auto) minmax(64px, auto)',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <span style={{ color: T.textSecondary, fontSize: 12 }}>{row.label}</span>
              <span style={{ ...css.mono, color: T.textMuted, fontSize: 12 }}>{formatPercent(currentValue)}</span>
              <span style={{ ...css.mono, color: T.textPrimary, fontSize: 12 }}>{formatPercent(targetValue)}</span>
              <span style={{ ...css.mono, color: delta >= 0 ? T.positive : T.negative, fontSize: 12 }}>
                {formatSignedPp(delta)}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, color: T.textMuted, fontSize: 11 }}>
        Nota: este mix actual es inferido desde exposiciones por instrumento; puede no replicar exactamente el mix teorico.
      </div>
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
  const normalized = normalizeWeights(weights);
  const rv = clamp01(normalized.rvGlobal + normalized.rvChile);
  const rf = clamp01(normalized.rfGlobal + normalized.rfChile);
  return { rv, rf };
}

function summarizeWithinBlock(weights: PortfolioWeights, block: 'rv' | 'rf') {
  const normalized = normalizeWeights(weights);
  const globalValue = block === 'rv' ? normalized.rvGlobal : normalized.rfGlobal;
  const localValue = block === 'rv' ? normalized.rvChile : normalized.rfChile;
  const total = Math.max(0, globalValue + localValue);
  if (total <= 0) return { global: 0, local: 0, total: 0 };
  return {
    global: globalValue / total,
    local: localValue / total,
    total,
  };
}

function buildMoveAmounts(currentWeights: PortfolioWeights, optimizedWeights: PortfolioWeights, capitalInitial: number) {
  const safeCapital = Number.isFinite(capitalInitial) ? Math.max(0, capitalInitial) : 0;
  if (safeCapital <= 0) return [];
  const current = normalizeWeights(currentWeights);
  const optimized = normalizeWeights(optimizedWeights);

  const sleeves: Array<{ sleeve: string; current: number; optimized: number }> = [
    { sleeve: 'RV Global', current: current.rvGlobal, optimized: optimized.rvGlobal },
    { sleeve: 'RF Global', current: current.rfGlobal, optimized: optimized.rfGlobal },
    { sleeve: 'RV Chile', current: current.rvChile, optimized: optimized.rvChile },
    { sleeve: 'RF Chile UF', current: current.rfChile, optimized: optimized.rfChile },
  ];

  const moves = sleeves
    .map((item) => {
      const deltaPp = (item.optimized - item.current) * 100;
      return {
        sleeve: item.sleeve,
        deltaPp,
        direction: (deltaPp >= 0 ? 'up' : 'down') as 'up' | 'down',
        amount: Math.round((deltaPp / 100) * safeCapital),
      };
    })
    // Evita deriva visual por redondeo en CLP: fuerza neto exactamente 0 en el desglose mostrado.
    .map((move) => ({ ...move, amount: Number.isFinite(move.amount) ? move.amount : 0 }));

  const residual = moves.reduce((sum, move) => sum + move.amount, 0);
  if (Math.abs(residual) >= 1) {
    let largestIndex = -1;
    let largestAmount = -1;
    for (let i = 0; i < moves.length; i += 1) {
      const amount = Math.abs(moves[i].amount);
      if (amount > largestAmount) {
        largestAmount = amount;
        largestIndex = i;
      }
    }
    if (largestIndex >= 0) moves[largestIndex].amount -= residual;
  }

  return moves
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

function formatCoverageRatio(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
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

function formatSignedMoneyClp(value: number) {
  const rounded = Math.abs(value) < 1 ? 0 : Math.round(value);
  return `${rounded >= 0 ? '+' : '-'}$${Math.abs(rounded).toLocaleString('es-CL')}`;
}

function summarizeGlobalLocalFromWeights(weights: PortfolioWeights) {
  const normalized = normalizeWeights(weights);
  return {
    global: clamp01(normalized.rvGlobal + normalized.rfGlobal),
    local: clamp01(normalized.rvChile + normalized.rfChile),
  };
}

function coverageToneColor(quality: CoverageQuality) {
  if (quality === 'high') return T.positive;
  if (quality === 'partial') return T.warning;
  if (quality === 'insufficient') return T.negative;
  return T.textMuted;
}

function normalizeWeights(weights: PortfolioWeights): PortfolioWeights {
  const rvGlobal = clamp01(Number.isFinite(weights.rvGlobal) ? weights.rvGlobal : 0);
  const rfGlobal = clamp01(Number.isFinite(weights.rfGlobal) ? weights.rfGlobal : 0);
  const rvChile = clamp01(Number.isFinite(weights.rvChile) ? weights.rvChile : 0);
  const rfChile = clamp01(Number.isFinite(weights.rfChile) ? weights.rfChile : 0);
  const sum = rvGlobal + rfGlobal + rvChile + rfChile;
  if (sum <= 0) {
    return { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  }
  return {
    rvGlobal: rvGlobal / sum,
    rfGlobal: rfGlobal / sum,
    rvChile: rvChile / sum,
    rfChile: rfChile / sum,
  };
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
