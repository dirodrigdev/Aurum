import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CashflowEvent,
  ManualCapitalAdjustment,
  ModelParameters,
  RiskCapitalInput,
  ScenarioVariant,
  ScenarioVariantId,
  SimulationCompositionInput,
  SimulationResults,
} from './domain/model/types';
import { DEFAULT_PARAMETERS, SCENARIO_VARIANTS } from './domain/model/defaults';
import { applyScenarioVariant } from './domain/simulation/engine';
import { evaluateConcordance } from './domain/simulation/concordance';
import { BottomNav, TabId } from './components/BottomNav';
import { ParamSheet } from './components/ParamSheet';
import { SimulationPage, SimulationOverrides, SimulationPreset } from './components/SimulationPage';
import { SensitivityPage } from './components/SensitivityPage';
import { StressPage } from './components/StressPage';
import { OptimizerPage } from './components/OptimizerPage';
import { SettingsPage } from './components/SettingsPage';
import { T, css } from './components/theme';
import type { OptimizableBaseReference } from './domain/instrumentBase';
import { optimizableSnapshotToReference, snapshotToSimulationComposition } from './integrations/aurum/adapters';
import {
  subscribeToPublishedOptimizableInvestmentsSnapshot,
} from './integrations/aurum/optimizableSnapshot';
import { aurumIntegrationConfigured } from './integrations/aurum/firebase';
import type { AurumOptimizableInvestmentsSnapshot } from './integrations/aurum/types';

const SIMULATION_TIMEOUT_MS = 10 * 60 * 1000;

type ScenarioEconomicsApplier = (p: ModelParameters, scenarioId: ScenarioVariantId) => ModelParameters;
type SimulationUiState = 'boot' | 'stale' | 'ready' | 'error';
type HeroPhase = 'boot' | 'stale' | 'ready';
type RecalcCause =
  | 'boot-init'
  | 'apply-aurum'
  | 'scenario'
  | 'risk-toggle'
  | 'ledger-commit'
  | 'params-change'
  | 'manual-run'
  | 'session-reset';
type AurumIntegrationStatus = 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
type RecalcWorkerStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';
type RecalcOwner = 'apply-aurum' | null;
type WorkerTraceScope = 'recalc' | 'baseline-optimizer' | 'bootstrap-control';
type RuntimeTimelineEntry = {
  atMs: number;
  event: string;
  payload: string;
};
type ActiveRecalcWorkerHandle = {
  worker: Worker;
  reject: (error: Error) => void;
  workerInstanceId: number;
  requestId: number;
  scope: WorkerTraceScope;
  clearTimeout?: () => void;
};
type ApplyAurumHarnessState = {
  status: 'idle' | 'running' | 'pass' | 'fail';
  startedAtMs: number | null;
  finishedAtMs: number | null;
  failureStep: string | null;
  details: string | null;
};
type ManualAdjustmentImpact = {
  currentTotalDelta: number;
  currentBanksDelta: number;
  currentInvestmentsDelta: number;
  currentRiskDelta: number;
  futureEvents: CashflowEvent[];
};

type OptimizerBaselineSnapshot = {
  probRuin: number;
  terminalP50: number;
};

type ControlConcordance = {
  status: 'green' | 'yellow' | 'red' | 'pending' | 'na';
  message: string | null;
  diffAbsPp: number | null;
  centralProbRuin: number | null;
  controlProbRuin: number | null;
  centralZone: string | null;
  controlZone: string | null;
};

type CentralWorkerStartMessage = {
  type: 'central-start';
  runId: number;
  channel: 'primary' | 'bootstrap-control';
  params: ModelParameters;
};

type CentralWorkerMessage =
  | {
      type: 'done';
      runId: number;
      result: SimulationResults;
    }
  | {
      type: 'error';
      runId: number;
      message: string;
    }
  | {
      type: 'trace';
      runId: number;
      event: 'worker_message_received' | 'worker_compute_started' | 'worker_compute_finished' | 'worker_post_done' | 'worker_post_error';
      atMs: number;
      summary?: {
        capitalInitial: number;
        compositionMode: string;
        banksCLP: number;
        optimizableInvestmentsCLP: number;
        riskBlockPresent: boolean;
        realEstateEnabled: boolean;
      };
      message?: string;
    };

class MidasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Error inesperado.',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('[Midas][ErrorBoundary]', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ ...css.app, padding: 24 }}>
        <div
          style={{
            border: `1px solid ${T.border}`,
            background: T.surface,
            borderRadius: 20,
            padding: 18,
            color: T.textPrimary,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.16em', color: T.textMuted }}>
            Midas
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Se produjo un error al renderizar</div>
          <div style={{ color: T.textSecondary, fontSize: 14 }}>
            {this.state.message || 'Intenta recargar la página o reintentar la sincronización.'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 6,
              alignSelf: 'start',
              borderRadius: 10,
              border: `1px solid ${T.border}`,
              background: T.surfaceEl,
              color: T.textPrimary,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}

function toOptimizerBaselineSnapshot(result: SimulationResults | null): OptimizerBaselineSnapshot | null {
  if (!result) return null;
  return {
    probRuin: result.probRuin,
    terminalP50: result.terminalWealthPercentiles[50] ?? 0,
  };
}

function cloneParams(p: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(p));
}

function updateByPath(target: ModelParameters, path: string, value: number): ModelParameters {
  const next = cloneParams(target);
  const parts = path.split('.');
  let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
  obj[parts[parts.length - 1]] = value;
  return next;
}

function isScenarioVariantId(value: unknown): value is ScenarioVariantId {
  return value === 'base' || value === 'pessimistic' || value === 'optimistic';
}

function resolveScenarioVariantId(value: unknown): ScenarioVariantId {
  return isScenarioVariantId(value) ? value : 'base';
}

function nextSimulationSeed(): number {
  if (typeof window !== 'undefined') {
    const fixedSeedRaw = window.localStorage.getItem('midas:debug-fixed-seed');
    const fixedSeed = Number(fixedSeedRaw);
    if (Number.isInteger(fixedSeed) && fixedSeed > 0) {
      return fixedSeed;
    }
    if (window.crypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      window.crypto.getRandomValues(buffer);
      return (buffer[0] % 2_147_483_646) + 1;
    }
  }
  return Math.floor(Math.random() * 2_147_483_646) + 1;
}

function computeWeightedReturn(p: ModelParameters) {
  return (
    p.weights.rvGlobal * p.returns.rvGlobalAnnual +
    p.weights.rfGlobal * p.returns.rfGlobalAnnual +
    p.weights.rvChile * p.returns.rvChileAnnual +
    p.weights.rfChile * p.returns.rfChileUFAnnual
  );
}

function applySimulationOverrides(p: ModelParameters, overrides: SimulationOverrides | null): ModelParameters {
  if (!overrides || !overrides.active) return p;
  const baseReturn = computeWeightedReturn(p);
  const targetReturn = overrides.returnPct ?? baseReturn;
  const factor = baseReturn > 0 ? targetReturn / baseReturn : 1;
  const horizonYears = overrides.horizonYears ?? Math.round(p.simulation.horizonMonths / 12);
  const horizonMonths = Math.max(12, Math.round(horizonYears * 12));
  return {
    ...p,
    capitalInitial: overrides.capital ?? p.capitalInitial,
    simulation: {
      ...p.simulation,
      horizonMonths,
      nSim: Math.min(1000, p.simulation.nSim),
      seed: 42,
    },
    returns: {
      ...p.returns,
      rvGlobalAnnual: p.returns.rvGlobalAnnual * factor,
      rfGlobalAnnual: p.returns.rfGlobalAnnual * factor,
      rvChileAnnual: p.returns.rvChileAnnual * factor,
      rfChileUFAnnual: p.returns.rfChileUFAnnual * factor,
    },
  };
}

function isBlocksCompositionMode(params: ModelParameters): boolean {
  const mode = params.simulationComposition?.mode;
  return mode === 'full' || mode === 'partial';
}

type NormalizedRiskCapitalExposure = {
  baseWithoutRiskCLP: number;
  baseWithRiskCLP: number;
  riskTotalCLP: number;
  usdTotal: number;
  usdSnapshotCLP: number;
  visibleCLP: number;
  source?: string;
};

function normalizeRiskCapitalExposure(
  risk: RiskCapitalInput | null | undefined,
  fallbackUsdSnapshotCLP: number,
  totalWithoutRiskCLP?: number,
  totalWithRiskCLP?: number,
): NormalizedRiskCapitalExposure {
  const rawTotalWithoutRisk = Number(totalWithoutRiskCLP ?? 0);
  const rawTotalWithRisk = Number(totalWithRiskCLP ?? 0);
  const baseWithoutRiskCLP = Number.isFinite(rawTotalWithoutRisk) && rawTotalWithoutRisk > 0 ? rawTotalWithoutRisk : 0;
  const baseWithRiskCLP = Number.isFinite(rawTotalWithRisk) && rawTotalWithRisk > 0 ? rawTotalWithRisk : 0;
  const riskFromTotals =
    baseWithoutRiskCLP > 0 && baseWithRiskCLP > baseWithoutRiskCLP
      ? baseWithRiskCLP - baseWithoutRiskCLP
      : 0;
  const rawTotalCLP = Number(risk?.totalCLP ?? 0);
  const hasExplicitTotalCLP =
    risk != null &&
    Object.prototype.hasOwnProperty.call(risk, 'totalCLP') &&
    Number.isFinite(rawTotalCLP);
  const rawCLP = Number(risk?.clp ?? 0);
  const rawUSD = Number(risk?.usd ?? 0);
  const rawUsdTotal = Number(risk?.usdTotal ?? 0);
  const usdSnapshotCLP = Number(risk?.usdSnapshotCLP ?? fallbackUsdSnapshotCLP);
  const safeUsdSnapshotCLP = Number.isFinite(usdSnapshotCLP) && usdSnapshotCLP > 0 ? usdSnapshotCLP : 1;
  const clpComponent = Number.isFinite(rawCLP) && rawCLP > 0 ? rawCLP : 0;
  const usdComponent = Number.isFinite(rawUSD) && rawUSD > 0 ? rawUSD : 0;
  const totalClpComponent = Number.isFinite(rawTotalCLP) && rawTotalCLP > 0 ? rawTotalCLP : 0;
  const usdTotalFromRaw = usdComponent + (clpComponent / safeUsdSnapshotCLP);
  const totalClpForExposure = hasExplicitTotalCLP ? Math.max(0, rawTotalCLP) : Math.max(totalClpComponent, riskFromTotals);
  const usdTotalFromTotalClp = totalClpForExposure / safeUsdSnapshotCLP;
  const usdTotalFromInput = Number.isFinite(rawUsdTotal) && rawUsdTotal > 0 ? rawUsdTotal : 0;
  const usdTotal = hasExplicitTotalCLP
    ? Math.max(0, usdTotalFromTotalClp)
    : Math.max(0, usdTotalFromInput, usdTotalFromRaw, usdTotalFromTotalClp);
  const riskTotalCLP = totalClpForExposure > 0 ? totalClpForExposure : usdTotal * safeUsdSnapshotCLP;
  const finalWithRisk = baseWithoutRiskCLP > 0
    ? baseWithoutRiskCLP + riskTotalCLP
    : baseWithRiskCLP > 0
      ? baseWithRiskCLP
      : riskTotalCLP;
  return {
    baseWithoutRiskCLP,
    baseWithRiskCLP: finalWithRisk,
    riskTotalCLP,
    usdTotal,
    usdSnapshotCLP: safeUsdSnapshotCLP,
    visibleCLP: riskTotalCLP,
    ...(risk?.source ? { source: risk.source } : {}),
  };
}

function deriveVisibleCapitalFromComposition(
  composition?: SimulationCompositionInput,
  includeRiskCapital = false,
): number | null {
  if (!composition) return null;
  const optimizable = Number(composition.optimizableInvestmentsCLP ?? 0);
  const banks = Number(composition.nonOptimizable?.banksCLP ?? 0);
  const realEstateEquity = Number(composition.nonOptimizable?.realEstate?.realEstateEquityCLP ?? 0);
  const nonMortgageDebt = Math.abs(Number(composition.nonOptimizable?.nonMortgageDebtCLP ?? 0));
  const riskCapital = includeRiskCapital
    ? normalizeRiskCapitalExposure(composition.nonOptimizable?.riskCapital, 1).visibleCLP
    : 0;
  const total = optimizable + banks + realEstateEquity + riskCapital - nonMortgageDebt;
  if (!Number.isFinite(total)) return null;
  return Math.max(1, total);
}

export default function App() {
  const [baseParams, setBaseParams] = useState<ModelParameters>(() => cloneParams(DEFAULT_PARAMETERS));
  const [simParams, setSimParams] = useState<ModelParameters>(() => cloneParams(DEFAULT_PARAMETERS));
  const [activeTab, setActiveTab] = useState<TabId>('sim');
  const [paramSheetOpen, setParamSheetOpen] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResults | null>(null);
  const [lastStableCentral, setLastStableCentral] = useState<SimulationResults | null>(null);
  const [simOverrides, setSimOverrides] = useState<SimulationOverrides | null>(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationPreset, setSimulationPreset] = useState<SimulationPreset>('base');
  const [baseOptimizerSnapshot, setBaseOptimizerSnapshot] = useState<OptimizerBaselineSnapshot | null>(null);
  const [bootstrapControlResult, setBootstrapControlResult] = useState<SimulationResults | null>(null);
  const [bootstrapControlStatus, setBootstrapControlStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [simWorking, setSimWorking] = useState(false);
  const [simUiState, setSimUiState] = useState<SimulationUiState>('boot');
  const [heroPhase, setHeroPhase] = useState<HeroPhase>('boot');
  const [bootReadyPending, setBootReadyPending] = useState(false);
  const [simUiError, setSimUiError] = useState<string | null>(null);
  const [lastRecalcCause, setLastRecalcCause] = useState<RecalcCause | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const [runtimeTimeline, setRuntimeTimeline] = useState<RuntimeTimelineEntry[]>([]);
  const [pendingSnapshot, setPendingSnapshot] = useState<AurumOptimizableInvestmentsSnapshot | null>(null);
  const [pendingSnapshotLabel, setPendingSnapshotLabel] = useState<string | null>(null);
  const [pendingSnapshotSignature, setPendingSnapshotSignature] = useState<string | null>(null);
  const [pendingSnapshotApplying, setPendingSnapshotApplying] = useState(false);
  const [baseUpdatePending, setBaseUpdatePending] = useState(false);
  const [snapshotApplied, setSnapshotApplied] = useState(false);
  const [recalcWorkerStatus, setRecalcWorkerStatus] = useState<RecalcWorkerStatus>('idle');
  const [activeRecalcRequestId, setActiveRecalcRequestId] = useState<number | null>(null);
  const [appliedRecalcRequestId, setAppliedRecalcRequestId] = useState<number | null>(null);
  const [activeRecalcSeed, setActiveRecalcSeed] = useState<number | null>(null);
  const [appliedRecalcSeed, setAppliedRecalcSeed] = useState<number | null>(null);
  const [activeRecalcOwner, setActiveRecalcOwner] = useState<RecalcOwner>(null);
  const [applyAurumHarness, setApplyAurumHarness] = useState<ApplyAurumHarnessState>({
    status: 'idle',
    startedAtMs: null,
    finishedAtMs: null,
    failureStep: null,
    details: null,
  });
  const [aurumSnapshotMonth, setAurumSnapshotMonth] = useState<string | null>(null);
  const [riskCapitalCLP, setRiskCapitalCLP] = useState(0);
  const [, setRiskCapitalUsdTotal] = useState(0);
  const [riskCapitalUsdSnapshotCLP, setRiskCapitalUsdSnapshotCLP] = useState(0);
  const [riskCapitalEnabled, setRiskCapitalEnabled] = useState(false);
  const [manualCapitalAdjustments, setManualCapitalAdjustments] = useState<ManualCapitalAdjustment[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('midas:manualCapitalAdjustments');
      return raw ? (JSON.parse(raw) as ManualCapitalAdjustment[]) : [];
    } catch {
      return [];
    }
  });
  const simulationTimerRef = useRef<number | null>(null);
  const calculationTimerRef = useRef<number | null>(null);
  const activityHandlerRef = useRef<() => void>();
  const baseParamsRef = useRef<ModelParameters>(baseParams);
  const simParamsRef = useRef<ModelParameters>(simParams);
  const simResultRef = useRef<SimulationResults | null>(simResult);
  const simUiStateRef = useRef<SimulationUiState>(simUiState);
  const heroPhaseRef = useRef<HeroPhase>(heroPhase);
  const runtimeTimelineRef = useRef<RuntimeTimelineEntry[]>(runtimeTimeline);
  const activeRecalcRequestIdRef = useRef<number | null>(activeRecalcRequestId);
  const appliedRecalcRequestIdRef = useRef<number | null>(appliedRecalcRequestId);
  const lastStableCentralRef = useRef<SimulationResults | null>(null);
  const lastSnapshotSignatureRef = useRef<string | null>(null);
  const lastAppliedSnapshotSignatureRef = useRef<string | null>(null);
  const applyingSnapshotRef = useRef(false);
  const pendingRecalcCauseRef = useRef<RecalcCause | null>(null);
  const recalcRequestIdRef = useRef(0);
  const baseSnapshotRequestIdRef = useRef(0);
  const recalcWatchdogRef = useRef<number | null>(null);
  const activeRecalcOwnerRef = useRef<RecalcOwner>(null);
  const controlRequestIdRef = useRef(0);
  const timelineStartRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const workerPayloadByRequestRef = useRef<Map<string, ModelParameters>>(new Map());
  const workerInstanceSeqRef = useRef(0);
  const activeRecalcWorkerRef = useRef<ActiveRecalcWorkerHandle | null>(null);

  const formatRuntimeError = useCallback((label: string, payload: unknown) => {
    if (payload instanceof Error) {
      const stack = payload.stack ? `\n${payload.stack}` : '';
      return `${label}: ${payload.name}: ${payload.message}${stack}`;
    }
    return `${label}: ${String(payload)}`;
  }, []);

  const appendRuntimeTimeline = useCallback((event: string, payload?: Record<string, unknown> | string) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const atMs = Math.max(0, Math.round(now - timelineStartRef.current));
    const payloadString = typeof payload === 'string'
      ? payload
      : payload
        ? JSON.stringify(payload)
        : '';
    setRuntimeTimeline((prev) => {
      const next = [...prev, { atMs, event, payload: payloadString }];
      return next.slice(-60);
    });
  }, []);

  useEffect(() => {
    baseParamsRef.current = baseParams;
  }, [baseParams]);

  useEffect(() => {
    simParamsRef.current = simParams;
  }, [simParams]);

  useEffect(() => {
    simResultRef.current = simResult;
  }, [simResult]);

  useEffect(() => {
    simUiStateRef.current = simUiState;
  }, [simUiState]);

  useEffect(() => {
    heroPhaseRef.current = heroPhase;
  }, [heroPhase]);

  useEffect(() => {
    runtimeTimelineRef.current = runtimeTimeline;
  }, [runtimeTimeline]);

  useEffect(() => {
    activeRecalcRequestIdRef.current = activeRecalcRequestId;
  }, [activeRecalcRequestId]);

  useEffect(() => {
    appliedRecalcRequestIdRef.current = appliedRecalcRequestId;
  }, [appliedRecalcRequestId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('midas:manualCapitalAdjustments', JSON.stringify(manualCapitalAdjustments));
  }, [manualCapitalAdjustments]);

  useEffect(() => {
    const ensureOverlay = () => {
      let panel = document.getElementById('midas-runtime-errors');
      if (panel) return panel;
      panel = document.createElement('div');
      panel.id = 'midas-runtime-errors';
      panel.style.position = 'fixed';
      panel.style.left = '12px';
      panel.style.right = '12px';
      panel.style.bottom = '86px';
      panel.style.zIndex = '9999';
      panel.style.background = 'rgba(255, 92, 92, 0.14)';
      panel.style.border = `1px solid ${T.negative}`;
      panel.style.borderRadius = '12px';
      panel.style.padding = '10px 12px';
      panel.style.color = T.textPrimary;
      panel.style.fontSize = '12px';
      panel.style.fontFamily = 'SF Mono, Menlo, monospace';
      panel.style.whiteSpace = 'pre-wrap';
      panel.style.maxHeight = '40vh';
      panel.style.overflow = 'auto';
      panel.style.display = 'none';
      document.body.appendChild(panel);
      return panel;
    };

    const report = (label: string, payload: unknown) => {
      const entry = formatRuntimeError(label, payload);
      setRuntimeErrors((prev) => [entry, ...prev].slice(0, 3));
      const panel = ensureOverlay();
      panel.textContent = entry;
      panel.style.display = 'block';
    };

    const onError = (event: ErrorEvent) => {
      report('window.onerror', event.error || event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      report('unhandledrejection', event.reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [formatRuntimeError]);

  const clearSimulationTimer = useCallback(() => {
    if (simulationTimerRef.current !== null) {
      window.clearTimeout(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
  }, []);

  const clearCalculationTimer = useCallback(() => {
    if (calculationTimerRef.current !== null) {
      window.clearTimeout(calculationTimerRef.current);
      calculationTimerRef.current = null;
    }
  }, []);

  const clearRecalcWatchdog = useCallback(() => {
    if (recalcWatchdogRef.current !== null) {
      window.clearTimeout(recalcWatchdogRef.current);
      recalcWatchdogRef.current = null;
    }
  }, []);

  const selectVariant = useCallback(
    (id: ScenarioVariantId): ScenarioVariant => SCENARIO_VARIANTS.find((v) => v.id === id) ?? SCENARIO_VARIANTS[0],
    [],
  );

  const applyScenarioEconomics: ScenarioEconomicsApplier = useCallback(
    (p, scenarioId) => {
      const variant = selectVariant(scenarioId);
      return applyScenarioVariant({ ...p, activeScenario: scenarioId }, variant);
    },
    [selectVariant],
  );

  const cancelActiveRecalcWorker = useCallback((
    reason: string = 'cancelled',
    caller: string = 'unknown',
    target?: { requestId?: number; workerInstanceId?: number },
  ) => {
    const active = activeRecalcWorkerRef.current;
    if (!active) return;
    if (target?.requestId != null && active.requestId !== target.requestId) return;
    if (target?.workerInstanceId != null && active.workerInstanceId !== target.workerInstanceId) return;
    activeRecalcWorkerRef.current = null;
    active.clearTimeout?.();
    active.worker.terminate();
    appendRuntimeTimeline('worker_cancelled', {
      reason,
      caller,
      cancelTargetRequestId: active.requestId,
      workerInstanceId: active.workerInstanceId,
      scope: active.scope,
    });
    active.reject(new Error('simulation_cancelled'));
  }, [appendRuntimeTimeline]);

  const runPrimaryRecalcWorker = useCallback(
    (
      params: ModelParameters,
      runId: number,
      cause: RecalcCause,
    ): Promise<SimulationResults> =>
      new Promise<SimulationResults>((resolve, reject) => {
        cancelActiveRecalcWorker('superseded_by_new_recalc', 'runPrimaryRecalcWorker');
        const worker = new Worker(new URL('./domain/simulation/central.worker.ts', import.meta.url), {
          type: 'module',
        });
        const workerInstanceId = workerInstanceSeqRef.current + 1;
        workerInstanceSeqRef.current = workerInstanceId;
        let settled = false;
        let timeoutId: number | null = null;

        const clearTimeoutForHandle = () => {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
          }
        };
        const isCurrentActive = () => {
          const active = activeRecalcWorkerRef.current;
          return Boolean(
            active &&
            active.workerInstanceId === workerInstanceId &&
            active.requestId === runId &&
            active.scope === 'recalc',
          );
        };
        const releaseActiveIfCurrent = () => {
          if (isCurrentActive()) {
            activeRecalcWorkerRef.current = null;
          }
        };
        const finalize = () => {
          clearTimeoutForHandle();
          releaseActiveIfCurrent();
          worker.terminate();
        };

        activeRecalcWorkerRef.current = {
          worker,
          reject,
          workerInstanceId,
          requestId: runId,
          scope: 'recalc',
          clearTimeout: clearTimeoutForHandle,
        };

        worker.onmessage = (event: MessageEvent<CentralWorkerMessage>) => {
          const payload = event.data;
          if (!payload || payload.runId !== runId) return;
          appendRuntimeTimeline('worker_message_main_received', {
            requestId: payload.runId,
            scope: 'recalc',
            workerInstanceId,
            type: payload.type,
            ...(payload.type === 'trace'
              ? {
                  workerEvent: payload.event,
                  workerAtMs: payload.atMs,
                  ...(payload.summary ?? {}),
                  ...(payload.message ? { message: payload.message } : {}),
                }
              : {}),
          });
          if (payload.type === 'trace') {
            appendRuntimeTimeline(payload.event, {
              requestId: payload.runId,
              scope: 'recalc',
              workerInstanceId,
              workerAtMs: payload.atMs,
              ...(payload.summary ?? {}),
              ...(payload.message ? { message: payload.message } : {}),
            });
            return;
          }
          if (!isCurrentActive() || settled) return;
          settled = true;
          finalize();
          if (payload.type === 'done') {
            appendRuntimeTimeline('worker_done', {
              requestId: payload.runId,
              scope: 'recalc',
              workerInstanceId,
              probRuin: Number(payload.result.probRuin ?? 0),
              p50TerminalAllPaths: Number(payload.result.p50TerminalAllPaths ?? 0),
              ruinMedianYear: payload.result.ruinTimingMedian != null
                ? Number(payload.result.ruinTimingMedian / 12)
                : null,
            });
            appendRuntimeTimeline('worker_done_main_applied', {
              requestId: payload.runId,
              scope: 'recalc',
              workerInstanceId,
            });
            resolve(payload.result);
            return;
          }
          appendRuntimeTimeline('worker_error', {
            requestId: payload.runId,
            scope: 'recalc',
            workerInstanceId,
            message: payload.message || 'simulation_worker_error',
          });
          appendRuntimeTimeline('worker_error_main_applied', {
            requestId: payload.runId,
            scope: 'recalc',
            workerInstanceId,
            message: payload.message || 'simulation_worker_error',
          });
          reject(new Error(payload.message || 'simulation_worker_error'));
        };
        worker.onerror = (event) => {
          if (!isCurrentActive() || settled) return;
          settled = true;
          finalize();
          appendRuntimeTimeline('worker_error', {
            requestId: runId,
            scope: 'recalc',
            workerInstanceId,
            message: event.message || 'simulation_worker_error',
          });
          appendRuntimeTimeline('worker_error_main_applied', {
            requestId: runId,
            scope: 'recalc',
            workerInstanceId,
            message: event.message || 'simulation_worker_error',
          });
          reject(new Error(event.message || 'simulation_worker_error'));
        };
        worker.onmessageerror = () => {
          if (!isCurrentActive() || settled) return;
          settled = true;
          finalize();
          appendRuntimeTimeline('worker_error', {
            requestId: runId,
            scope: 'recalc',
            workerInstanceId,
            message: 'simulation_worker_message_error',
          });
          appendRuntimeTimeline('worker_error_main_applied', {
            requestId: runId,
            scope: 'recalc',
            workerInstanceId,
            message: 'simulation_worker_message_error',
          });
          reject(new Error('simulation_worker_message_error'));
        };

        appendRuntimeTimeline('worker_request_sent', {
          requestId: runId,
          scope: 'recalc',
          workerInstanceId,
          activeScenario: resolveScenarioVariantId(params.activeScenario),
          simulationSeed: Number(params.simulation?.seed ?? 0),
          capitalInitial: Number(params.capitalInitial ?? 0),
          compositionMode: params.simulationComposition?.mode ?? 'legacy',
          banksCLP: Number(params.simulationComposition?.nonOptimizable?.banksCLP ?? 0),
          optimizableInvestmentsCLP: Number(params.simulationComposition?.optimizableInvestmentsCLP ?? 0),
          riskBlockPresent: Number(params.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0) > 0,
          realEstateEnabled: params.realEstatePolicy?.enabled ?? true,
        });
        workerPayloadByRequestRef.current.set(`recalc:${runId}`, cloneParams(params));
        if (workerPayloadByRequestRef.current.size > 20) {
          const oldestKey = workerPayloadByRequestRef.current.keys().next().value;
          if (oldestKey) workerPayloadByRequestRef.current.delete(oldestKey);
        }

        timeoutId = window.setTimeout(() => {
          if (!isCurrentActive() || settled) return;
          settled = true;
          appendRuntimeTimeline('worker_timeout_fired', { requestId: runId, cause, workerInstanceId });
          cancelActiveRecalcWorker('watchdog_timeout', 'runPrimaryRecalcWorker', {
            requestId: runId,
            workerInstanceId,
          });
          reject(new Error('simulation_timeout'));
        }, 30_000);

        const message: CentralWorkerStartMessage = {
          type: 'central-start',
          runId,
          channel: 'primary',
          params,
        };
        worker.postMessage(message);
      }),
    [appendRuntimeTimeline, cancelActiveRecalcWorker],
  );

  const runCentralSimulationInWorker = useCallback(
    (
      params: ModelParameters,
      runId: number,
      options?: { traceScope?: WorkerTraceScope; channel?: 'primary' | 'bootstrap-control' },
    ): Promise<SimulationResults> =>
      new Promise<SimulationResults>((resolve, reject) => {
        const traceScope = options?.traceScope ?? 'recalc';
        const channel = options?.channel ?? 'primary';
        const worker = new Worker(new URL('./domain/simulation/central.worker.ts', import.meta.url), {
          type: 'module',
        });
        const workerInstanceId = workerInstanceSeqRef.current + 1;
        workerInstanceSeqRef.current = workerInstanceId;
        let settled = false;
        const finalize = () => {
          worker.terminate();
        };

        worker.onmessage = (event: MessageEvent<CentralWorkerMessage>) => {
          const payload = event.data;
          if (!payload || payload.runId !== runId) return;
          appendRuntimeTimeline('worker_message_main_received', {
            requestId: payload.runId,
            scope: traceScope,
            workerInstanceId,
            type: payload.type,
            ...(payload.type === 'trace'
              ? {
                  workerEvent: payload.event,
                  workerAtMs: payload.atMs,
                  ...(payload.summary ?? {}),
                  ...(payload.message ? { message: payload.message } : {}),
                }
              : {}),
          });
          if (payload.type === 'trace') {
            appendRuntimeTimeline(payload.event, {
              requestId: payload.runId,
              scope: traceScope,
              workerInstanceId,
              workerAtMs: payload.atMs,
              ...(payload.summary ?? {}),
              ...(payload.message ? { message: payload.message } : {}),
            });
            return;
          }
          settled = true;
          finalize();
          if (payload.type === 'done') {
            appendRuntimeTimeline('worker_done', {
              requestId: payload.runId,
              scope: traceScope,
              workerInstanceId,
              probRuin: Number(payload.result.probRuin ?? 0),
              p50TerminalAllPaths: Number(payload.result.p50TerminalAllPaths ?? 0),
              ruinMedianYear: payload.result.ruinTimingMedian != null
                ? Number(payload.result.ruinTimingMedian / 12)
                : null,
            });
            appendRuntimeTimeline('worker_done_main_applied', {
              requestId: payload.runId,
              scope: traceScope,
              workerInstanceId,
            });
            resolve(payload.result);
            return;
          }
          appendRuntimeTimeline('worker_error', {
            requestId: payload.runId,
            scope: traceScope,
            workerInstanceId,
            message: payload.message || 'simulation_worker_error',
          });
          appendRuntimeTimeline('worker_error_main_applied', {
            requestId: payload.runId,
            scope: traceScope,
            workerInstanceId,
            message: payload.message || 'simulation_worker_error',
          });
          reject(new Error(payload.message || 'simulation_worker_error'));
        };
        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          finalize();
          appendRuntimeTimeline('worker_error', {
            requestId: runId,
            scope: traceScope,
            workerInstanceId,
            message: event.message || 'simulation_worker_error',
          });
          reject(new Error(event.message || 'simulation_worker_error'));
        };
        worker.onmessageerror = () => {
          if (settled) return;
          settled = true;
          finalize();
          appendRuntimeTimeline('worker_error', {
            requestId: runId,
            scope: traceScope,
            workerInstanceId,
            message: 'simulation_worker_message_error',
          });
          reject(new Error('simulation_worker_message_error'));
        };

        const message: CentralWorkerStartMessage = {
          type: 'central-start',
          runId,
          channel,
          params,
        };
        appendRuntimeTimeline('worker_request_sent', {
          requestId: runId,
          scope: traceScope,
          workerInstanceId,
          activeScenario: resolveScenarioVariantId(params.activeScenario),
          simulationSeed: Number(params.simulation?.seed ?? 0),
          capitalInitial: Number(params.capitalInitial ?? 0),
          compositionMode: params.simulationComposition?.mode ?? 'legacy',
          banksCLP: Number(params.simulationComposition?.nonOptimizable?.banksCLP ?? 0),
          optimizableInvestmentsCLP: Number(params.simulationComposition?.optimizableInvestmentsCLP ?? 0),
          riskBlockPresent: Number(params.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0) > 0,
          realEstateEnabled: params.realEstatePolicy?.enabled ?? true,
        });
        workerPayloadByRequestRef.current.set(`${traceScope}:${runId}`, cloneParams(params));
        if (workerPayloadByRequestRef.current.size > 20) {
          const oldestKey = workerPayloadByRequestRef.current.keys().next().value;
          if (oldestKey) workerPayloadByRequestRef.current.delete(oldestKey);
        }
        worker.postMessage(message);
      }),
    [appendRuntimeTimeline],
  );

  const runBootstrapControl = useCallback((params: ModelParameters) => {
    const requestId = controlRequestIdRef.current + 1;
    controlRequestIdRef.current = requestId;
    setBootstrapControlStatus('running');
    void runCentralSimulationInWorker(params, requestId, {
      traceScope: 'bootstrap-control',
      channel: 'bootstrap-control',
    })
      .then((result) => {
        if (requestId !== controlRequestIdRef.current) return;
        setBootstrapControlResult(result);
        setBootstrapControlStatus('done');
      })
      .catch((error) => {
        if (requestId !== controlRequestIdRef.current) return;
        if (String((error as Error)?.message || '') === 'simulation_cancelled') return;
        console.error('[Midas] Error en motor de control bootstrap', error);
        setBootstrapControlStatus('error');
      });
  }, [runCentralSimulationInWorker]);

  const parseYearMonth = useCallback((value: string) => {
    const [yearRaw, monthRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return { year, month };
  }, []);
  const resolveMonthIndex = useCallback((effectiveDate: string) => {
    const base = aurumSnapshotMonth ? parseYearMonth(aurumSnapshotMonth) : null;
    const target = parseYearMonth(effectiveDate);
    if (!base || !target) return 1;
    const diff = (target.year - base.year) * 12 + (target.month - base.month) + 1;
    const capped = Math.min(Math.max(1, diff), baseParams.simulation.horizonMonths);
    return capped;
  }, [aurumSnapshotMonth, baseParams.simulation.horizonMonths, parseYearMonth]);
  const toClp = useCallback((amount: number, currency: 'CLP' | 'USD' | 'EUR') => {
    if (currency === 'CLP') return amount;
    const usdToClp = baseParams.fx?.clpUsdInitial ?? 1;
    const usdToEur = baseParams.fx?.usdEurFixed ?? 1;
    if (currency === 'USD') return amount * usdToClp;
    return amount * usdToClp * usdToEur;
  }, [baseParams.fx]);
  const mapDestinationToSleeve = useCallback((destination: ManualCapitalAdjustment['destination']) => {
    if (destination === 'liquidity') return 'rfChile' as const;
    if (destination === 'investments') return 'rvGlobal' as const;
    if (destination === 'risk') return 'rvGlobal' as const;
    if (destination === 'other') return 'rfChile' as const;
    return undefined;
  }, []);

  const manualAdjustmentImpact = useMemo<ManualAdjustmentImpact>(() => {
    let currentLiquidityDelta = 0;
    let currentInvestmentsDelta = 0;
    let currentRiskDelta = 0;
    let currentOtherDelta = 0;
    const futureEvents: CashflowEvent[] = [];
    const todayKey = new Date().toISOString().slice(0, 7);
    manualCapitalAdjustments.forEach((adj) => {
      const amountClp = toClp(adj.amount, adj.currency);
      const signed = adj.direction === 'add' ? amountClp : -amountClp;
      if (adj.effectiveDate <= todayKey) {
        if (adj.destination === 'liquidity') currentLiquidityDelta += signed;
        if (adj.destination === 'investments') currentInvestmentsDelta += signed;
        if (adj.destination === 'risk') currentRiskDelta += signed;
        if (adj.destination === 'other') currentOtherDelta += signed;
        return;
      }
      const month = resolveMonthIndex(adj.effectiveDate);
      futureEvents.push({
        id: `manual-${adj.id}`,
        description: adj.note ?? adj.destination,
        month,
        type: signed > 0 ? 'inflow' : 'outflow',
        amount: Math.abs(amountClp),
        currency: 'CLP',
        sleeve: mapDestinationToSleeve(adj.destination),
      });
    });
    const currentBanksDelta = currentLiquidityDelta + currentOtherDelta;
    const currentTotalDelta = currentBanksDelta + currentInvestmentsDelta + currentRiskDelta;
    return {
      currentTotalDelta,
      currentBanksDelta,
      currentInvestmentsDelta,
      currentRiskDelta,
      futureEvents,
    };
  }, [manualCapitalAdjustments, mapDestinationToSleeve, resolveMonthIndex, toClp]);

  const manualOptimizableDelta = manualAdjustmentImpact.currentInvestmentsDelta;

  const getSnapshotSignature = useCallback((snapshot: AurumOptimizableInvestmentsSnapshot) => {
    const ufSnapshotClp =
      snapshot.version === 2
        ? snapshot.nonOptimizable?.realEstate?.ufSnapshotCLP ?? ''
        : '';
    const riskTotalClp =
      snapshot.version === 2
        ? snapshot.riskCapital?.totalCLP ?? ''
        : '';
    const riskClp =
      snapshot.version === 2
        ? snapshot.riskCapital?.clp ?? ''
        : '';
    const riskUsd =
      snapshot.version === 2
        ? snapshot.riskCapital?.usd ?? ''
        : '';
    return [
      snapshot.version,
      snapshot.publishedAt,
      snapshot.snapshotMonth,
      snapshot.snapshotLabel,
      snapshot.totalNetWorthCLP,
      snapshot.optimizableInvestmentsCLP,
      ufSnapshotClp,
      riskTotalClp,
      riskClp,
      riskUsd,
    ].join('|');
  }, []);
  const computeRiskCapital = useCallback((snapshot: AurumOptimizableInvestmentsSnapshot) => {
    const fallbackUsdSnapshotCLP = Number(baseParamsRef.current.fx?.clpUsdInitial ?? DEFAULT_PARAMETERS.fx.clpUsdInitial);
    const exposure = normalizeRiskCapitalExposure(
      snapshot.version === 2 ? snapshot.riskCapital : undefined,
      fallbackUsdSnapshotCLP,
      Number(snapshot.totalNetWorthCLP ?? 0),
      Number(snapshot.totalNetWorthWithRiskCLP ?? 0),
    );
    if (exposure.riskTotalCLP <= 0) {
      const fallbackFromOptimizable =
        Number.isFinite(snapshot.optimizableInvestmentsWithRiskCLP) && Number.isFinite(snapshot.optimizableInvestmentsCLP)
          ? Math.max(0, Number(snapshot.optimizableInvestmentsWithRiskCLP) - Number(snapshot.optimizableInvestmentsCLP))
          : 0;
      if (fallbackFromOptimizable > 0) {
        return normalizeRiskCapitalExposure(
          { totalCLP: fallbackFromOptimizable },
          fallbackUsdSnapshotCLP,
          Number(snapshot.totalNetWorthCLP ?? 0),
          Number(snapshot.totalNetWorthCLP ?? 0) + fallbackFromOptimizable,
        );
      }
    }
    return exposure;
  }, []);

  const summarizeParams = useCallback((params: ModelParameters) => {
    const composition = params.simulationComposition;
    return {
      activeScenario: resolveScenarioVariantId(params.activeScenario),
      simulationSeed: Number(params.simulation?.seed ?? 0),
      capitalInitial: Number(params.capitalInitial ?? 0),
      compositionMode: composition?.mode ?? 'legacy',
      banksCLP: Number(composition?.nonOptimizable?.banksCLP ?? 0),
      optimizableInvestmentsCLP: Number(composition?.optimizableInvestmentsCLP ?? 0),
      riskBlockPresent: Number(composition?.nonOptimizable?.riskCapital?.totalCLP ?? 0) > 0,
      realEstateEnabled: params.realEstatePolicy?.enabled ?? true,
    };
  }, []);

  const summarizeResult = useCallback((result: SimulationResults) => ({
    probRuin: Number(result.probRuin ?? 0),
    p50TerminalAllPaths: Number(result.p50TerminalAllPaths ?? 0),
    ruinMedianYear: result.ruinTimingMedian != null ? Number(result.ruinTimingMedian / 12) : null,
  }), []);

  const parseTimelinePayload = useCallback((payload: string): Record<string, unknown> | null => {
    if (!payload || !payload.trim().startsWith('{')) return null;
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, []);

  const runDirectSimulationDiagnostic = useCallback(async (requestId: number) => {
    const key = `recalc:${requestId}`;
    const payload = workerPayloadByRequestRef.current.get(key);
    if (!payload) {
      appendRuntimeTimeline('direct_compare_missing_payload', { requestId, key });
      return { status: 'missing' as const, message: `No payload cached for ${key}` };
    }
    appendRuntimeTimeline('direct_compare_started', {
      requestId,
      ...summarizeParams(payload),
    });
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const { runMidasSimulation } = await import('./domain/simulation/policy');
      appendRuntimeTimeline('direct_compute_started', { requestId });
      const result = runMidasSimulation(payload, 'primary');
      const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
      appendRuntimeTimeline('direct_compute_finished', {
        requestId,
        elapsedMs,
        ...summarizeResult(result),
      });
      return { status: 'ok' as const, elapsedMs, result };
    } catch (error: unknown) {
      const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      appendRuntimeTimeline('direct_compute_error', { requestId, elapsedMs, message });
      return { status: 'error' as const, elapsedMs, message };
    }
  }, [appendRuntimeTimeline, summarizeParams, summarizeResult]);

  const buildCanonicalSimParams = useCallback(
    (
      baseParamsCurrent: ModelParameters,
      currentSimParams: ModelParameters,
      options?: {
        applyCapital?: boolean;
      },
    ): ModelParameters => {
      const applyCapital = options?.applyCapital ?? true;
      const mergedEvents = [
        ...(baseParamsCurrent.cashflowEvents ?? []),
        ...manualAdjustmentImpact.futureEvents,
      ];
      const blocksMode = isBlocksCompositionMode(baseParamsCurrent);
      let next: ModelParameters = {
        ...currentSimParams,
        cashflowEvents: mergedEvents,
      };

      if (blocksMode && baseParamsCurrent.simulationComposition) {
        const baseComposition = JSON.parse(
          JSON.stringify(baseParamsCurrent.simulationComposition),
        ) as SimulationCompositionInput;
        let nextOptimizable = Math.max(
          0,
          Number(baseComposition.optimizableInvestmentsCLP ?? 0) + manualAdjustmentImpact.currentInvestmentsDelta,
        );
        let nextBanks = Math.max(
          0,
          Number(baseComposition.nonOptimizable?.banksCLP ?? 0) + manualAdjustmentImpact.currentBanksDelta,
        );
        const baseRiskExposure = normalizeRiskCapitalExposure(
          baseComposition.nonOptimizable?.riskCapital,
          riskCapitalUsdSnapshotCLP || baseParamsCurrent.fx.clpUsdInitial || DEFAULT_PARAMETERS.fx.clpUsdInitial,
          Number(baseComposition.totalNetWorthCLP ?? 0),
          Number(baseComposition.totalNetWorthCLP ?? 0) + Number(riskCapitalCLP ?? 0),
        );
        const riskUsdSnapshot = baseRiskExposure.usdSnapshotCLP;
        const riskBaseClp = Math.max(0, riskCapitalCLP || baseRiskExposure.riskTotalCLP);
        const riskManualClp = manualAdjustmentImpact.currentRiskDelta;
        const riskEnabledClpTotal = Math.max(0, riskBaseClp + riskManualClp);
        const riskUsdEnabledTotal = riskUsdSnapshot > 0
          ? riskEnabledClpTotal / riskUsdSnapshot
          : 0;
        const riskUsdApplied = riskCapitalEnabled ? riskUsdEnabledTotal : 0;
        const riskClpApplied = riskCapitalEnabled
          ? Math.max(0, riskUsdApplied * riskUsdSnapshot)
          : 0;

        const realEstateEquity = Math.max(0, Number(baseComposition.nonOptimizable?.realEstate?.realEstateEquityCLP ?? 0));
        const nonMortgageDebt = Math.abs(Number(baseComposition.nonOptimizable?.nonMortgageDebtCLP ?? 0));
        const targetWithoutRisk = Math.max(
          1,
          Number(baseComposition.totalNetWorthCLP ?? 0) +
            manualAdjustmentImpact.currentBanksDelta +
            manualAdjustmentImpact.currentInvestmentsDelta,
        );
        const modeledWithoutRisk = nextOptimizable + nextBanks + realEstateEquity - nonMortgageDebt;
        let gap = targetWithoutRisk - modeledWithoutRisk;
        if (Math.abs(gap) > 0.5) {
          nextBanks = Math.max(0, nextBanks + gap);
          const remainingGap = targetWithoutRisk - (nextOptimizable + nextBanks + realEstateEquity - nonMortgageDebt);
          if (Math.abs(remainingGap) > 0.5) {
            nextOptimizable = Math.max(0, nextOptimizable + remainingGap);
          }
        }

        const targetVisibleCapital = riskCapitalEnabled
          ? targetWithoutRisk + riskClpApplied
          : targetWithoutRisk;

        const nextComposition: SimulationCompositionInput = {
          ...baseComposition,
          optimizableInvestmentsCLP: nextOptimizable,
          nonOptimizable: {
            ...baseComposition.nonOptimizable,
            banksCLP: nextBanks,
            riskCapital: {
              source: baseComposition.nonOptimizable?.riskCapital?.source ?? 'normalized-usd',
              usdSnapshotCLP: riskUsdSnapshot,
              usdTotal: riskUsdApplied,
              usd: riskUsdApplied,
              totalCLP: riskClpApplied,
            },
          },
        };
        next = {
          ...next,
          simulationComposition: nextComposition,
          capitalInitial: applyCapital ? Math.max(1, targetVisibleCapital) : currentSimParams.capitalInitial,
        };
      } else {
        const riskDelta = riskCapitalEnabled
          ? manualAdjustmentImpact.currentRiskDelta + riskCapitalCLP
          : 0;
        const nextDelta = manualAdjustmentImpact.currentBanksDelta + manualAdjustmentImpact.currentInvestmentsDelta + riskDelta;
        const targetCapital = Math.max(1, baseParamsCurrent.capitalInitial + nextDelta);
        next = {
          ...next,
          capitalInitial: applyCapital ? targetCapital : currentSimParams.capitalInitial,
        };
      }

      return next;
    },
    [manualAdjustmentImpact, riskCapitalCLP, riskCapitalEnabled, riskCapitalUsdSnapshotCLP],
  );

  const beginRecalculationVisual = useCallback((cause: RecalcCause) => {
    setLastRecalcCause(cause);
    setSimWorking(true);
    setSimUiError(null);
    setRecalcWorkerStatus('queued');
    setBootReadyPending(false);
    const hasStableResult = Boolean(lastStableCentralRef.current);
    const shouldStale = hasStableResult && cause !== 'boot-init';
    setSimUiState(shouldStale ? 'stale' : 'boot');
    setHeroPhase(shouldStale ? 'stale' : 'boot');
  }, []);

  const startRecalculation = useCallback((cause: RecalcCause, run: () => ModelParameters) => {
    if (activeRecalcOwnerRef.current === 'apply-aurum' && cause !== 'apply-aurum') {
      appendRuntimeTimeline('start_recalculation_blocked', {
        cause,
        owner: activeRecalcOwnerRef.current,
      });
      return;
    }
    const ownerForRun: RecalcOwner = cause === 'apply-aurum' ? 'apply-aurum' : null;
    if (ownerForRun) {
      activeRecalcOwnerRef.current = ownerForRun;
      setActiveRecalcOwner(ownerForRun);
    }
    clearCalculationTimer();
    clearRecalcWatchdog();
    beginRecalculationVisual(cause);
    const requestId = recalcRequestIdRef.current + 1;
    const simulationSeed = nextSimulationSeed();
    recalcRequestIdRef.current = requestId;
    setActiveRecalcRequestId(requestId);
    setActiveRecalcSeed(simulationSeed);
    appendRuntimeTimeline('start_recalculation', {
      cause,
      requestId,
      simulationSeed,
      heroPhase: heroPhaseRef.current,
      owner: ownerForRun ?? 'none',
    });
    calculationTimerRef.current = window.setTimeout(async () => {
      try {
        setRecalcWorkerStatus('running');
        const paramsBase = run();
        const params: ModelParameters = {
          ...paramsBase,
          simulation: {
            ...paramsBase.simulation,
            seed: simulationSeed,
          },
        };
        appendRuntimeTimeline('start_recalculation_params', {
          cause,
          requestId,
          ...summarizeParams(params),
        });
        const nextResult = await runPrimaryRecalcWorker(params, requestId, cause);
        if (requestId !== recalcRequestIdRef.current) return;
        setSimResult(nextResult);
        lastStableCentralRef.current = nextResult;
        setLastStableCentral(nextResult);
        setAppliedRecalcRequestId(requestId);
        setAppliedRecalcSeed(simulationSeed);
        setRecalcWorkerStatus('done');
        appendRuntimeTimeline('sim_result_applied', {
          requestId,
          simulationSeed,
          ...summarizeResult(nextResult),
        });
        runBootstrapControl(params);
        if (ownerForRun && activeRecalcOwnerRef.current === ownerForRun) {
          activeRecalcOwnerRef.current = null;
          setActiveRecalcOwner(null);
        }
        if (cause === 'boot-init') {
          setSimUiState('boot');
          setHeroPhase('boot');
          setBootReadyPending(true);
        } else {
          setSimUiState('ready');
          setHeroPhase('ready');
        }
      } catch (error: any) {
        if (requestId !== recalcRequestIdRef.current) return;
        if (String(error?.message || '') === 'simulation_cancelled') return;
        console.error('[Midas] Error recalculando simulación', error);
        if (ownerForRun && activeRecalcOwnerRef.current === ownerForRun) {
          activeRecalcOwnerRef.current = null;
          setActiveRecalcOwner(null);
        }
        setSimUiState('error');
        const fallbackPhase = lastStableCentralRef.current ? 'stale' : 'boot';
        setHeroPhase(fallbackPhase);
        if (String(error?.message || '') === 'simulation_timeout') {
          setSimUiError('La simulación tardó demasiado. Reintenta el recálculo.');
        } else {
          setSimUiError(String(error?.message || 'No pude recalcular la simulación.'));
        }
        setRecalcWorkerStatus('error');
        appendRuntimeTimeline('sim_result_error', {
          requestId,
          simulationSeed,
          message: String(error?.message || 'simulation_error'),
        });
      } finally {
        if (requestId === recalcRequestIdRef.current) {
          setSimWorking(false);
          calculationTimerRef.current = null;
        }
      }
    }, 0);
  }, [
    appendRuntimeTimeline,
    beginRecalculationVisual,
    clearCalculationTimer,
    runPrimaryRecalcWorker,
    summarizeParams,
    summarizeResult,
    runBootstrapControl,
  ]);

  useEffect(() => {
    if (!bootReadyPending) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setSimUiState('ready');
        setHeroPhase('ready');
        setBootReadyPending(false);
      });
    });
    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [bootReadyPending]);

  useEffect(() => {
    if (heroPhase !== 'stale') return;
    if (pendingSnapshotApplying) return;
    if (simWorking) return;
    if (recalcWorkerStatus === 'queued' || recalcWorkerStatus === 'running') return;
    if (activeRecalcRequestId !== null && appliedRecalcRequestId === activeRecalcRequestId && simResult) {
      setSimUiState('ready');
      setHeroPhase('ready');
      return;
    }
    setSimUiState('error');
    setSimUiError((prev) => prev ?? 'No se pudo consolidar el recálculo. Reintenta "Aplicar Aurum".');
    setRecalcWorkerStatus('error');
  }, [
    activeRecalcRequestId,
    appliedRecalcRequestId,
    heroPhase,
    pendingSnapshotApplying,
    recalcWorkerStatus,
    simResult,
    simWorking,
  ]);

  useEffect(() => {
    appendRuntimeTimeline('capital_visible_updated', {
      capitalVisible: Number(simParams.capitalInitial ?? 0),
      snapshotApplied,
    });
  }, [appendRuntimeTimeline, simParams.capitalInitial, snapshotApplied]);

  useEffect(() => {
    appendRuntimeTimeline('hero_phase_changed', {
      heroPhase,
      simUiState,
      lastRecalcCause: lastRecalcCause ?? 'none',
    });
  }, [appendRuntimeTimeline, heroPhase, lastRecalcCause, simUiState]);

  useEffect(() => {
    const source =
      heroPhase === 'ready'
        ? 'simResult'
        : heroPhase === 'stale'
          ? 'lastStableCentral'
          : 'none';
    const visibleValue =
      source === 'simResult'
        ? simResult
          ? 1 - simResult.probRuin
          : null
        : source === 'lastStableCentral'
          ? lastStableCentral
            ? 1 - lastStableCentral.probRuin
            : null
          : null;
    appendRuntimeTimeline('hero_render_source_changed', {
      source,
      heroPhase,
      visibleValuePct: visibleValue != null ? Number((visibleValue * 100).toFixed(2)) : null,
    });
  }, [appendRuntimeTimeline, heroPhase, lastStableCentral, simResult]);

  const applySnapshotNow = useCallback((snapshot: AurumOptimizableInvestmentsSnapshot | null, options?: { recalc?: boolean }) => {
    if (!snapshot) return;
    const shouldRecalculate = options?.recalc ?? true;
    try {
      const composition = snapshotToSimulationComposition(snapshot);
      const compositionMode = composition?.mode ?? 'legacy';
      const hasFallbackFlags =
        composition?.mortgageProjectionStatus === 'fallback_incomplete' ||
        (composition?.diagnostics?.notes ?? []).some((note) => String(note).includes('fallback'));
      const isPartialComposition = compositionMode === 'partial' || hasFallbackFlags;
      const aurumNetWorth = Number(snapshot?.totalNetWorthCLP ?? NaN);
      const riskExposure = computeRiskCapital(snapshot);
      const aurumNetWorthWithRisk =
        Number.isFinite(riskExposure.baseWithRiskCLP) && riskExposure.baseWithRiskCLP > 0
          ? riskExposure.baseWithRiskCLP
          : aurumNetWorth + riskExposure.riskTotalCLP;
      const compositionWithToggle = composition
        ? {
            ...composition,
            nonOptimizable: {
              ...composition.nonOptimizable,
              riskCapital: {
                ...(composition.nonOptimizable?.riskCapital ?? {}),
                source: composition.nonOptimizable?.riskCapital?.source ?? 'normalized-usd',
                usdSnapshotCLP: riskExposure.usdSnapshotCLP,
                usdTotal: riskCapitalEnabled ? riskExposure.usdTotal : 0,
                usd: riskCapitalEnabled ? riskExposure.usdTotal : 0,
                totalCLP: riskCapitalEnabled ? riskExposure.riskTotalCLP : 0,
              },
            },
          }
        : composition;

      setAurumSnapshotLabel(snapshot.snapshotLabel || 'ultimo cierre confirmado');
      setAurumSnapshotMonth(snapshot.snapshotMonth || null);
      setRiskCapitalCLP(riskExposure.riskTotalCLP);
      setRiskCapitalUsdTotal(riskExposure.usdTotal);
      setRiskCapitalUsdSnapshotCLP(riskExposure.usdSnapshotCLP);
      if (!Number.isFinite(aurumNetWorth) || aurumNetWorth <= 0) {
        setAurumIntegrationStatus('partial');
        if (composition) {
          setBaseParams((prev) => ({ ...prev, simulationComposition: composition }));
          setSimParams((prev) => ({ ...prev, simulationComposition: composition }));
        }
        setBaseUpdatePending(false);
        return;
      }

      setAurumIntegrationStatus(isPartialComposition ? 'partial' : 'available');

      const currentBase = baseParamsRef.current;
      const nextBaseComposition = compositionWithToggle ?? currentBase.simulationComposition;
      const baseTargetCapital = aurumNetWorth;
      const sameBaseCapital = Math.round(currentBase.capitalInitial) === Math.round(baseTargetCapital);
      const sameBaseComposition = JSON.stringify(currentBase.simulationComposition) === JSON.stringify(nextBaseComposition);
      if (!sameBaseCapital || !sameBaseComposition) {
        setBaseParams({
          ...currentBase,
          capitalInitial: baseTargetCapital,
          label: `Desde Aurum · ${snapshot?.snapshotLabel || 'ultimo cierre confirmado'}`,
          simulationComposition: nextBaseComposition,
        });
      }

      const currentSim = simParamsRef.current;
      const hasCapitalOverride = Boolean(simOverrides?.active && typeof simOverrides?.capital === 'number');
      const shouldApplyCapital = !hasCapitalOverride;
      const nextSimComposition = compositionWithToggle ?? currentSim.simulationComposition;
      const baseSimCapital = riskCapitalEnabled ? aurumNetWorthWithRisk : aurumNetWorth;
      const baseForCanonical: ModelParameters = {
        ...currentBase,
        capitalInitial: baseTargetCapital,
        simulationComposition: nextBaseComposition,
      };
      const simSeed: ModelParameters = {
        ...currentSim,
        capitalInitial: shouldApplyCapital ? baseSimCapital : currentSim.capitalInitial,
        label: shouldApplyCapital
          ? `Desde Aurum · ${snapshot?.snapshotLabel || 'ultimo cierre confirmado'}`
          : currentSim.label,
        simulationComposition: nextSimComposition,
      };
      const nextSimParamsFinal = buildCanonicalSimParams(baseForCanonical, simSeed, {
        applyCapital: shouldApplyCapital,
      });
      const sameSimCapital = Math.round(currentSim.capitalInitial) === Math.round(nextSimParamsFinal.capitalInitial);
      const sameSimComposition = JSON.stringify(currentSim.simulationComposition) === JSON.stringify(nextSimParamsFinal.simulationComposition);

      appendRuntimeTimeline('snapshot_applied', {
        snapshotApplied: true,
        targetCapital: Number(nextSimParamsFinal.capitalInitial ?? 0),
        shouldRecalculate,
        ...summarizeParams(nextSimParamsFinal),
      });

      if (!sameSimCapital || !sameSimComposition) {
        setSimParams(nextSimParamsFinal);
      }
      if (shouldRecalculate) {
        setBaseUpdatePending(false);
        startRecalculation('apply-aurum', () => nextSimParamsFinal);
      } else if (!sameSimCapital || !sameSimComposition) {
        setBaseUpdatePending(true);
      }
    } catch (error: any) {
      console.error('[Midas] Error aplicando snapshot Aurum', error);
      setAurumIntegrationStatus('error');
      setSimUiState('error');
      setSimUiError(String(error?.message || 'Error aplicando base Aurum.'));
      setBaseUpdatePending(true);
    }
  }, [
    appendRuntimeTimeline,
    computeRiskCapital,
    riskCapitalEnabled,
    simOverrides?.active,
    simOverrides?.capital,
    startRecalculation,
    buildCanonicalSimParams,
    summarizeParams,
  ]);

  const resetSimulationSession = useCallback(() => {
    clearSimulationTimer();
    clearCalculationTimer();
    setSimulationActive(false);
    setSimulationPreset('base');
    setRiskCapitalEnabled(false);
    setSimOverrides(null);
    const next = applyScenarioEconomics(
      {
        ...cloneParams(baseParams),
        realEstatePolicy: {
          enabled: true,
          triggerRunwayMonths: baseParams.realEstatePolicy?.triggerRunwayMonths ?? 36,
          saleDelayMonths: baseParams.realEstatePolicy?.saleDelayMonths ?? 12,
          saleCostPct: baseParams.realEstatePolicy?.saleCostPct ?? 0,
          realAppreciationAnnual: baseParams.realEstatePolicy?.realAppreciationAnnual ?? 0,
        },
      },
      'base',
    );
    setSimParams(next);
    startRecalculation('session-reset', () => next);
    setParamSheetOpen(false);
  }, [applyScenarioEconomics, baseParams, clearCalculationTimer, clearSimulationTimer, startRecalculation]);

  const scheduleInactivityReset = useCallback(() => {
    clearSimulationTimer();
    simulationTimerRef.current = window.setTimeout(() => {
      resetSimulationSession();
    }, SIMULATION_TIMEOUT_MS);
  }, [clearSimulationTimer, resetSimulationSession]);

  const markSimulationInteraction = useCallback(
    (nextPreset: SimulationPreset = 'custom') => {
      const inferredPreset = resolveScenarioVariantId(simParamsRef.current.activeScenario);
      const resolvedPreset = nextPreset === 'custom' ? inferredPreset : nextPreset;
      setSimulationActive(true);
      setSimulationPreset(resolvedPreset);
      scheduleInactivityReset();
    },
    [scheduleInactivityReset],
  );

  const applyPendingSnapshot = useCallback(() => {
    if (!pendingSnapshot || !pendingSnapshotSignature) return;
    if (applyingSnapshotRef.current) return;
    appendRuntimeTimeline('apply_aurum_click', {
      pendingSnapshotLabel: pendingSnapshotLabel ?? 'none',
      heroPhase,
      simUiState,
    });
    applyingSnapshotRef.current = true;
    setPendingSnapshotApplying(true);
    markSimulationInteraction();
    window.setTimeout(() => {
      try {
        lastAppliedSnapshotSignatureRef.current = pendingSnapshotSignature;
        setSnapshotApplied(true);
        applySnapshotNow(pendingSnapshot, { recalc: true });
        setPendingSnapshot(null);
        setPendingSnapshotLabel(null);
        setPendingSnapshotSignature(null);
        setBaseUpdatePending(false);
      } catch (error: unknown) {
        setSnapshotApplied(false);
        const entry = formatRuntimeError('applyPendingSnapshot', error);
        setRuntimeErrors((prev) => [entry, ...prev].slice(0, 3));
        setSimUiState('error');
        setSimUiError(error instanceof Error ? error.message : 'Error aplicando snapshot.');
      } finally {
        applyingSnapshotRef.current = false;
        setPendingSnapshotApplying(false);
      }
    }, 0);
  }, [
    appendRuntimeTimeline,
    applySnapshotNow,
    formatRuntimeError,
    heroPhase,
    markSimulationInteraction,
    pendingSnapshot,
    pendingSnapshotLabel,
    pendingSnapshotSignature,
    simUiState,
  ]);

  const runApplyAurumHarness = useCallback(() => {
    if (applyAurumHarness.status === 'running') return;
    if (!pendingSnapshot || !pendingSnapshotSignature) {
      setApplyAurumHarness({
        status: 'fail',
        startedAtMs: Date.now(),
        finishedAtMs: Date.now(),
        failureStep: 'pending_snapshot_missing',
        details: 'No hay snapshot Aurum pendiente. El harness requiere estado pre-Apply con snapshot detectado.',
      });
      return;
    }
    const startedAtMs = Date.now();
    const initialCapital = Number(simParamsRef.current.capitalInitial ?? 0);
    const initialSourceResult = simResultRef.current ?? lastStableCentralRef.current;
    const initialSuccess = initialSourceResult ? Number((1 - initialSourceResult.probRuin).toFixed(6)) : null;

    timelineStartRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    runtimeTimelineRef.current = [];
    setRuntimeTimeline([]);
    setApplyAurumHarness({
      status: 'running',
      startedAtMs,
      finishedAtMs: null,
      failureStep: null,
      details: null,
    });
    appendRuntimeTimeline('harness_start', {
      initialCapital,
      initialSuccess,
      pendingSnapshotLabel: pendingSnapshotLabel ?? 'none',
    });

    const finalize = (status: 'pass' | 'fail', failureStep: string | null, details: string) => {
      setApplyAurumHarness({
        status,
        startedAtMs,
        finishedAtMs: Date.now(),
        failureStep,
        details,
      });
    };

    const findEvent = (
      name: string,
      matcher?: (payload: Record<string, unknown> | null) => boolean,
    ): { event: RuntimeTimelineEntry; payload: Record<string, unknown> | null } | null => {
      for (let i = runtimeTimelineRef.current.length - 1; i >= 0; i -= 1) {
        const event = runtimeTimelineRef.current[i];
        if (event.event !== name) continue;
        const payload = parseTimelinePayload(event.payload);
        if (!matcher || matcher(payload)) {
          return { event, payload };
        }
      }
      return null;
    };

    const maxWaitMs = 20_000;
    const intervalMs = 120;
    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAtMs;
      const terminal = elapsedMs >= maxWaitMs;
      const applyStart = findEvent('start_recalculation', (payload) => payload?.cause === 'apply-aurum');
      const applyRequestId = Number(applyStart?.payload?.requestId ?? NaN);
      const requestKnown = Number.isFinite(applyRequestId);
      const snapshotAppliedEvent = findEvent('snapshot_applied');
      const capitalEvent = findEvent('capital_visible_updated', (payload) => {
        const capital = Number(payload?.capitalVisible ?? NaN);
        return Number.isFinite(capital) && Math.abs(capital - initialCapital) > 0.5;
      });
      const staleEvent = findEvent('hero_phase_changed', (payload) => payload?.heroPhase === 'stale');
      const startParams = requestKnown
        ? findEvent('start_recalculation_params', (payload) => Number(payload?.requestId ?? NaN) === applyRequestId)
        : null;
      const workerRequest = requestKnown
        ? findEvent(
          'worker_request_sent',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const workerDone = requestKnown
        ? findEvent(
          'worker_done',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const workerError = requestKnown
        ? findEvent(
          'worker_error',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const workerMessageReceived = requestKnown
        ? findEvent(
          'worker_message_received',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const workerComputeStarted = requestKnown
        ? findEvent(
          'worker_compute_started',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const workerComputeFinished = requestKnown
        ? findEvent(
          'worker_compute_finished',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const workerPostDone = requestKnown
        ? findEvent(
          'worker_post_done',
          (payload) => Number(payload?.requestId ?? NaN) === applyRequestId && payload?.scope === 'recalc',
        )
        : null;
      const resultApplied = requestKnown
        ? findEvent('sim_result_applied', (payload) => Number(payload?.requestId ?? NaN) === applyRequestId)
        : null;
      const renderFromSimResult = findEvent('hero_render_source_changed', (payload) => payload?.source === 'simResult');

      if (startParams?.payload && workerRequest?.payload) {
        const startCapital = Number(startParams.payload.capitalInitial ?? NaN);
        const workerCapital = Number(workerRequest.payload.capitalInitial ?? NaN);
        const startMode = String(startParams.payload.compositionMode ?? '');
        const workerMode = String(workerRequest.payload.compositionMode ?? '');
        const startBanks = Number(startParams.payload.banksCLP ?? NaN);
        const workerBanks = Number(workerRequest.payload.banksCLP ?? NaN);
        const startOptimizable = Number(startParams.payload.optimizableInvestmentsCLP ?? NaN);
        const workerOptimizable = Number(workerRequest.payload.optimizableInvestmentsCLP ?? NaN);
        const capitalVisible = Number(capitalEvent?.payload?.capitalVisible ?? NaN);
        const mismatch =
          Math.abs(startCapital - workerCapital) > 0.5 ||
          startMode !== workerMode ||
          Math.abs(startBanks - workerBanks) > 0.5 ||
          Math.abs(startOptimizable - workerOptimizable) > 0.5 ||
          (Number.isFinite(capitalVisible) && Math.abs(capitalVisible - workerCapital) > 0.5);
        if (mismatch) {
          window.clearInterval(timer);
          finalize(
            'fail',
            'params_ui_worker_mismatch',
            `Mismatch Apply Aurum params: start(cap=${startCapital}, mode=${startMode}, banks=${startBanks}, opt=${startOptimizable}) vs worker(cap=${workerCapital}, mode=${workerMode}, banks=${workerBanks}, opt=${workerOptimizable}) vs visible(cap=${Number.isFinite(capitalVisible) ? capitalVisible : 'n/a'}).`,
          );
          return;
        }
      }

      if (workerError) {
        window.clearInterval(timer);
        finalize('fail', 'worker_error', `Worker error en request ${applyRequestId}: ${workerError.payload?.message ?? 'sin detalle'}`);
        return;
      }

      const isReady = heroPhaseRef.current === 'ready' && simUiStateRef.current === 'ready';
      const hasResult = Boolean(simResultRef.current);
      if (requestKnown && snapshotAppliedEvent && capitalEvent && staleEvent && workerDone && resultApplied && isReady && hasResult) {
        const finalResult = simResultRef.current!;
        const finalSuccess = Number((1 - finalResult.probRuin).toFixed(6));
        const finalCapital = Number(simParamsRef.current.capitalInitial ?? 0);
        if (Math.abs(finalCapital - initialCapital) <= 0.5) {
          window.clearInterval(timer);
          finalize(
            'fail',
            'capital_not_updated',
            `Apply Aurum no cambió capital visible: initial=${initialCapital}, final=${finalCapital}.`,
          );
          return;
        }
        if (initialSuccess !== null && Math.abs(finalSuccess - initialSuccess) < 0.00001) {
          window.clearInterval(timer);
          finalize(
            'fail',
            'hero_value_unchanged',
            `Resultado aplicado pero hero sin cambio relevante: success inicial=${initialSuccess}, final=${finalSuccess}.`,
          );
          return;
        }
        if (activeRecalcRequestIdRef.current !== null && appliedRecalcRequestIdRef.current !== activeRecalcRequestIdRef.current) {
          window.clearInterval(timer);
          finalize(
            'fail',
            'request_not_converged',
            `Request aplicado (${appliedRecalcRequestIdRef.current ?? '—'}) distinto al activo (${activeRecalcRequestIdRef.current ?? '—'}).`,
          );
          return;
        }
        window.clearInterval(timer);
        finalize(
          'pass',
          null,
          `PASS: request=${applyRequestId}, capital ${initialCapital} -> ${finalCapital}, success ${initialSuccess ?? 'n/a'} -> ${finalSuccess}, source=${renderFromSimResult ? 'simResult' : 'unknown'}.`,
        );
        return;
      }

      if (!terminal) return;

      window.clearInterval(timer);
      const failureStep =
        !findEvent('apply_aurum_click') ? 'apply_click_missing'
          : !snapshotAppliedEvent ? 'snapshot_not_applied'
            : !capitalEvent ? 'capital_not_updated'
              : !applyStart ? 'start_recalc_missing'
                : !staleEvent ? 'hero_not_stale'
                  : !startParams ? 'start_params_missing'
                    : !workerRequest ? 'worker_request_missing'
                      : !workerDone ? 'worker_done_missing'
                        : !resultApplied ? 'sim_result_not_applied'
                          : heroPhaseRef.current !== 'ready' ? 'hero_not_ready'
                            : !renderFromSimResult ? 'hero_not_rendering_sim_result'
                              : 'unknown_timeout';
      const workerProgress = [
        workerMessageReceived ? 'message_received' : null,
        workerComputeStarted ? 'compute_started' : null,
        workerComputeFinished ? 'compute_finished' : null,
        workerPostDone ? 'post_done' : null,
      ].filter(Boolean).join('>');
      const baseDetail = `Timeout ${maxWaitMs}ms. request=${requestKnown ? applyRequestId : '—'} heroPhase=${heroPhaseRef.current} simUiState=${simUiStateRef.current} worker=${recalcWorkerStatus} progress=${workerProgress || 'none'}.`;
      if (failureStep === 'worker_done_missing' && requestKnown) {
        void runDirectSimulationDiagnostic(applyRequestId).then((direct) => {
          const directDetail =
            direct.status === 'ok'
              ? ` direct=ok elapsed=${direct.elapsedMs}ms`
              : direct.status === 'error'
                ? ` direct=error elapsed=${direct.elapsedMs}ms msg=${direct.message}`
                : ` direct=missing msg=${direct.message}`;
          finalize('fail', failureStep, `${baseDetail}${directDetail}`);
        });
        return;
      }
      finalize('fail', failureStep, baseDetail);
    }, intervalMs);
  }, [
    applyAurumHarness.status,
    applyPendingSnapshot,
    appendRuntimeTimeline,
    parseTimelinePayload,
    pendingSnapshot,
    pendingSnapshotLabel,
    pendingSnapshotSignature,
    runDirectSimulationDiagnostic,
    recalcWorkerStatus,
  ]);

  const toggleRiskCapital = useCallback(() => {
    pendingRecalcCauseRef.current = 'risk-toggle';
    setRiskCapitalEnabled((prev) => !prev);
    markSimulationInteraction();
  }, [markSimulationInteraction]);

  const commitManualCapitalAdjustments = useCallback((next: ManualCapitalAdjustment[]) => {
    pendingRecalcCauseRef.current = 'ledger-commit';
    setManualCapitalAdjustments(next);
    markSimulationInteraction();
  }, [markSimulationInteraction]);

  useEffect(() => {
    if (activeRecalcOwnerRef.current === 'apply-aurum') {
      return;
    }
    const baseParamsCurrent = baseParamsRef.current;
    const currentSimParams = simParamsRef.current;
    const next = buildCanonicalSimParams(baseParamsCurrent, currentSimParams, {
      applyCapital: true,
    });
    const currentSignature = JSON.stringify(currentSimParams);
    const nextSignature = JSON.stringify(next);
    const simChanged = currentSignature !== nextSignature;

    const deltaChange = next.capitalInitial - currentSimParams.capitalInitial;
    if (Math.abs(deltaChange) > 0.0001 && simOverrides?.active && typeof simOverrides.capital === 'number') {
      setSimOverrides((prev) => {
        if (!prev || !prev.active || typeof prev.capital !== 'number') return prev;
        return { ...prev, capital: Math.max(1, prev.capital + deltaChange) };
      });
    }

    if (simChanged) {
      setSimParams(next);
    }
    const canRecalculateNow = !pendingSnapshotApplying && !pendingSnapshotLabel;
    if (canRecalculateNow && simChanged) {
      if (baseUpdatePending) {
        setBaseUpdatePending(false);
      }
      const base = applySimulationOverrides(next, simOverrides);
      const cause = pendingRecalcCauseRef.current ?? 'params-change';
      pendingRecalcCauseRef.current = null;
      startRecalculation(cause, () => base);
    }
  }, [baseUpdatePending, buildCanonicalSimParams, pendingSnapshotApplying, pendingSnapshotLabel, simOverrides, startRecalculation]);

  useEffect(() => {
    if (!simResult) {
      setSimulationPreset('base');
      setRiskCapitalEnabled(false);
      const next = applyScenarioEconomics(
        {
          ...cloneParams(baseParams),
          realEstatePolicy: {
            enabled: true,
            triggerRunwayMonths: baseParams.realEstatePolicy?.triggerRunwayMonths ?? 36,
            saleDelayMonths: baseParams.realEstatePolicy?.saleDelayMonths ?? 12,
            saleCostPct: baseParams.realEstatePolicy?.saleCostPct ?? 0,
            realAppreciationAnnual: baseParams.realEstatePolicy?.realAppreciationAnnual ?? 0,
          },
        },
        'base',
      );
      setSimParams(next);
      startRecalculation('boot-init', () => next);
    }
    scheduleInactivityReset();
    const handler = () => scheduleInactivityReset();
    activityHandlerRef.current = handler;
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => window.addEventListener(ev, handler));
    return () => {
      ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => window.removeEventListener(ev, handler));
      clearSimulationTimer();
    };
  }, [
    applyScenarioEconomics,
    baseParams,
    clearSimulationTimer,
    scheduleInactivityReset,
    simResult,
    startRecalculation,
  ]);

  useEffect(() => () => {
    clearCalculationTimer();
    clearRecalcWatchdog();
    cancelActiveRecalcWorker('unmount_cleanup', 'app_unmount');
  }, [cancelActiveRecalcWorker, clearCalculationTimer, clearRecalcWatchdog]);

  useEffect(() => {
    const recalcInFlight =
      simWorking ||
      recalcWorkerStatus === 'queued' ||
      recalcWorkerStatus === 'running';
    if (baseUpdatePending || recalcInFlight) return;
    const requestId = baseSnapshotRequestIdRef.current + 1;
    baseSnapshotRequestIdRef.current = requestId;
    let cancelled = false;
    const baseFromAurum = applyScenarioEconomics(cloneParams(baseParams), 'base');
    void runCentralSimulationInWorker(baseFromAurum, requestId, { traceScope: 'baseline-optimizer' })
      .then((result) => {
        if (cancelled || requestId !== baseSnapshotRequestIdRef.current) return;
        setBaseOptimizerSnapshot(toOptimizerBaselineSnapshot(result));
      })
      .catch((error) => {
        if (cancelled || requestId !== baseSnapshotRequestIdRef.current) return;
        if (String((error as Error)?.message || '') === 'simulation_cancelled') return;
        console.error('[Midas] Error calculando baseline del optimizador', error);
        setBaseOptimizerSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    applyScenarioEconomics,
    baseParams,
    baseUpdatePending,
    recalcWorkerStatus,
    runCentralSimulationInWorker,
    simWorking,
  ]);

  const commitSimParamsAndRecalc = useCallback((
    nextParams: ModelParameters,
    cause: RecalcCause,
  ) => {
    setSimParams(nextParams);
    const base = applySimulationOverrides(nextParams, simOverrides);
    startRecalculation(cause, () => base);
  }, [simOverrides, startRecalculation]);

  const updateSimParam = useCallback((path: string, value: number) => {
    markSimulationInteraction();
    const next = updateByPath(simParamsRef.current, path, value);
    commitSimParamsAndRecalc(next, 'params-change');
  }, [commitSimParamsAndRecalc, markSimulationInteraction]);

  const handleCashflowEventsChange = useCallback((next: CashflowEvent[]) => {
    markSimulationInteraction();
    const updated = { ...simParamsRef.current, cashflowEvents: next };
    commitSimParamsAndRecalc(updated, 'params-change');
  }, [commitSimParamsAndRecalc, markSimulationInteraction]);

  const handleScenarioChange = useCallback((next: ScenarioVariantId) => {
    markSimulationInteraction(next);
    const scenarioBase = applyScenarioEconomics(cloneParams(baseParams), next);
    const nextParams: ModelParameters = {
      ...simParamsRef.current,
      activeScenario: next,
      returns: scenarioBase.returns,
      inflation: scenarioBase.inflation,
      fx: scenarioBase.fx,
    };
    commitSimParamsAndRecalc(nextParams, 'scenario');
  }, [applyScenarioEconomics, baseParams, commitSimParamsAndRecalc, markSimulationInteraction]);

  const handleSimOverridesChange = useCallback((next: SimulationOverrides | null) => {
    setSimOverrides(next);
    markSimulationInteraction();
    const base = applySimulationOverrides(simParamsRef.current, next);
    startRecalculation('params-change', () => base);
  }, [markSimulationInteraction, startRecalculation]);

  const patchSimParams = useCallback((patcher: (prev: ModelParameters) => ModelParameters) => {
    markSimulationInteraction();
    const next = patcher(simParamsRef.current);
    commitSimParamsAndRecalc(next, 'params-change');
  }, [commitSimParamsAndRecalc, markSimulationInteraction]);

  const runSim = useCallback(() => {
    markSimulationInteraction(resolveScenarioVariantId(simParams.activeScenario));
    const base = applySimulationOverrides(simParams, simOverrides);
    startRecalculation('manual-run', () => base);
    setActiveTab('sim');
  }, [markSimulationInteraction, simOverrides, simParams, startRecalculation]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  const statusColor = simulationActive ? T.primary : simResult ? T.positive : T.textMuted;
  const activeScenario = resolveScenarioVariantId(simParams.activeScenario);
  const stateLabel = selectVariant(activeScenario).label;

  const optimizerSimulationParams = useMemo(
    () => applySimulationOverrides(simParams, simOverrides),
    [simOverrides, simParams],
  );
  const simulationOptimizerSnapshot = useMemo(
    () => (simulationActive ? toOptimizerBaselineSnapshot(simResult) : null),
    [simulationActive, simResult],
  );
  const [optimizableBaseReference, setOptimizableBaseReference] = useState<OptimizableBaseReference>({
    amountClp: null,
    asOf: null,
    sourceLabel: 'Aurum · último cierre confirmado',
    status: 'pending',
  });
  const optimizableBaseAdjusted = useMemo<OptimizableBaseReference>(() => {
    if (!optimizableBaseReference.amountClp) return optimizableBaseReference;
    return {
      ...optimizableBaseReference,
      amountClp: Math.max(0, optimizableBaseReference.amountClp + manualOptimizableDelta),
    };
  }, [manualOptimizableDelta, optimizableBaseReference]);
  const [aurumIntegrationStatus, setAurumIntegrationStatus] = useState<AurumIntegrationStatus>(
    aurumIntegrationConfigured ? 'loading' : 'unconfigured',
  );
  const [aurumSnapshotLabel, setAurumSnapshotLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!aurumIntegrationConfigured) {
      setAurumIntegrationStatus('unconfigured');
      setAurumSnapshotLabel(null);
      setSnapshotApplied(false);
      setRiskCapitalCLP(0);
      setRiskCapitalUsdTotal(0);
      setRiskCapitalUsdSnapshotCLP(0);
      setOptimizableBaseReference({
        amountClp: null,
        asOf: null,
        sourceLabel: 'Aurum · último cierre confirmado',
        status: 'pending',
      });
      return;
    }

    let cancelled = false;
    let hasReceivedFirstSnapshot = false;

    setAurumIntegrationStatus((prev) => (
      prev === 'available' || prev === 'partial' ? 'refreshing' : 'loading'
    ));

    const applyLegacyFallback = () => {
      setBaseParams((prev) => ({
        ...prev,
        simulationComposition: {
          ...(prev.simulationComposition ?? DEFAULT_PARAMETERS.simulationComposition!),
          mode: 'legacy',
          diagnostics: {
            sourceVersion: 1,
            mode: 'legacy',
            compositionGapCLP: 0,
            compositionGapPct: 0,
            notes: ['fallback-after-snapshot-error'],
          },
        },
      }));
      setSimParams((prev) => ({
        ...prev,
        simulationComposition: {
          ...(prev.simulationComposition ?? DEFAULT_PARAMETERS.simulationComposition!),
          mode: 'legacy',
          diagnostics: {
            sourceVersion: 1,
            mode: 'legacy',
            compositionGapCLP: 0,
            compositionGapPct: 0,
            notes: ['fallback-after-snapshot-error'],
          },
        },
      }));
    };

    const applySnapshot = (snapshot: AurumOptimizableInvestmentsSnapshot | null) => {
      if (cancelled) return;
      setOptimizableBaseReference(optimizableSnapshotToReference(snapshot));

      if (!snapshot) {
        setAurumIntegrationStatus('missing');
        setAurumSnapshotLabel(null);
        setAurumSnapshotMonth(null);
        setSnapshotApplied(false);
        setRiskCapitalCLP(0);
        setRiskCapitalUsdTotal(0);
        setRiskCapitalUsdSnapshotCLP(0);
        setBaseUpdatePending(false);
        setPendingSnapshot(null);
        setPendingSnapshotLabel(null);
        setPendingSnapshotSignature(null);
        lastSnapshotSignatureRef.current = null;
        return;
      }

      const composition = snapshotToSimulationComposition(snapshot);
      const compositionMode = composition?.mode ?? 'legacy';
      const hasFallbackFlags =
        composition?.mortgageProjectionStatus === 'fallback_incomplete' ||
        (composition?.diagnostics?.notes ?? []).some((note) => String(note).includes('fallback'));
      const isPartialComposition = compositionMode === 'partial' || hasFallbackFlags;
      setAurumIntegrationStatus(isPartialComposition ? 'partial' : 'available');
      setAurumSnapshotLabel(snapshot.snapshotLabel || 'ultimo cierre confirmado');

      const snapshotSignature = getSnapshotSignature(snapshot);
      if (snapshotSignature === lastSnapshotSignatureRef.current) return;
      lastSnapshotSignatureRef.current = snapshotSignature;

      if (snapshotSignature === lastAppliedSnapshotSignatureRef.current) {
        setSnapshotApplied(true);
        setPendingSnapshot(null);
        setPendingSnapshotLabel(null);
        setPendingSnapshotSignature(null);
        return;
      }

      setSnapshotApplied(false);
      setPendingSnapshot(snapshot);
      setPendingSnapshotLabel(snapshot.snapshotLabel || 'ultimo cierre confirmado');
      setPendingSnapshotSignature(snapshotSignature);
      setBaseUpdatePending(false);
    };

    const unsubscribe = subscribeToPublishedOptimizableInvestmentsSnapshot({
      onValue: (snapshot) => {
        if (cancelled) return;
        if (hasReceivedFirstSnapshot) {
          setAurumIntegrationStatus((prev) =>
            prev === 'available' || prev === 'partial' ? 'refreshing' : prev,
          );
        }
        applySnapshot(snapshot);
        hasReceivedFirstSnapshot = true;
      },
      onError: () => {
        if (cancelled) return;
        setOptimizableBaseReference({
          amountClp: null,
          asOf: null,
          sourceLabel: 'Aurum · último cierre confirmado',
          status: 'pending',
        });
        applyLegacyFallback();
        setAurumIntegrationStatus('error');
        setAurumSnapshotLabel(null);
        setAurumSnapshotMonth(null);
        setRiskCapitalCLP(0);
        setRiskCapitalUsdTotal(0);
        setRiskCapitalUsdSnapshotCLP(0);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [computeRiskCapital, getSnapshotSignature]);

  useEffect(() => {
    if (!simulationActive && !simOverrides?.active) {
      setBaseUpdatePending(false);
    }
  }, [simOverrides?.active, simulationActive]);

  useEffect(() => {
    if (activeTab !== 'sim') return;
    if (simulationActive || simOverrides?.active) return;
    if (bootReadyPending) return;
    setBaseUpdatePending(false);
    setSimUiError(null);
    const nextPhase: HeroPhase = simResult ? 'ready' : 'boot';
    setSimUiState(nextPhase);
    setHeroPhase(nextPhase);
  }, [activeTab, bootReadyPending, simOverrides?.active, simulationActive, simResult]);

  const riskCapitalEffective = useMemo(() => {
    const riskInComposition = Number(simParams.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
    return riskCapitalEnabled && riskInComposition > 0;
  }, [riskCapitalEnabled, simParams.simulationComposition]);

  const controlConcordance = useMemo<ControlConcordance>(() => {
    if (!simResult || !bootstrapControlResult) {
      return {
        status: bootstrapControlStatus === 'running' ? 'pending' : 'na',
        message: null,
        diffAbsPp: null,
        centralProbRuin: simResult?.probRuin ?? null,
        controlProbRuin: bootstrapControlResult?.probRuin ?? null,
        centralZone: null,
        controlZone: null,
      };
    }
    const report = evaluateConcordance(simResult.probRuin, bootstrapControlResult.probRuin);
    return {
      status: report.status,
      message: report.status === 'red' ? 'Divergencia relevante entre métodos' : null,
      diffAbsPp: report.diffAbsPp,
      centralProbRuin: simResult.probRuin,
      controlProbRuin: bootstrapControlResult.probRuin,
      centralZone: report.centralZone,
      controlZone: report.controlZone,
    };
  }, [bootstrapControlResult, bootstrapControlStatus, simResult]);

  const content = activeTab === 'sim' ? (
    <SimulationPage
      resultCentral={simResult}
      params={simParams}
      simOverrides={simOverrides}
      simActive={simulationActive}
      simWorking={simWorking}
      simUiState={simUiState}
      heroPhase={heroPhase}
      lastStableCentral={lastStableCentral}
      simUiError={simUiError}
      lastRecalcCause={lastRecalcCause}
      simulationPreset={simulationPreset}
      stateLabel={stateLabel}
      aurumIntegrationStatus={aurumIntegrationStatus}
      aurumSnapshotLabel={aurumSnapshotLabel}
      baseUpdatePending={baseUpdatePending}
      pendingSnapshotLabel={pendingSnapshotLabel}
      pendingSnapshotApplying={pendingSnapshotApplying}
      snapshotApplied={snapshotApplied}
      manualCapitalAdjustments={manualCapitalAdjustments}
      riskCapitalEnabled={riskCapitalEnabled}
      riskCapitalEffective={riskCapitalEffective}
      riskCapitalCLP={riskCapitalCLP}
      recalcWorkerStatus={recalcWorkerStatus}
      activeRecalcRequestId={activeRecalcRequestId}
      appliedRecalcRequestId={appliedRecalcRequestId}
      activeRecalcSeed={activeRecalcSeed}
      appliedRecalcSeed={appliedRecalcSeed}
      activeRecalcOwner={activeRecalcOwner}
      runtimeTimeline={runtimeTimeline}
      bootstrapControlStatus={bootstrapControlStatus}
      bootstrapControlResult={bootstrapControlResult}
      controlConcordance={controlConcordance}
      applyAurumHarness={applyAurumHarness}
      onApplyPendingSnapshot={applyPendingSnapshot}
      onRunApplyAurumHarness={runApplyAurumHarness}
      onToggleRiskCapital={toggleRiskCapital}
      onCommitManualCapitalAdjustments={commitManualCapitalAdjustments}
      onSimulationTouch={markSimulationInteraction}
      onScenarioChange={handleScenarioChange}
      onSimOverridesChange={handleSimOverridesChange}
      onUpdateParams={patchSimParams}
      onResetSim={resetSimulationSession}
    />
  ) : activeTab === 'sens' ? (
    <SensitivityPage params={simParams} stateLabel={stateLabel} />
  ) : activeTab === 'stress' ? (
    <StressPage params={simParams} stateLabel={stateLabel} />
  ) : activeTab === 'settings' ? (
    <SettingsPage
      optimizableBaseReference={optimizableBaseAdjusted}
      aurumIntegrationStatus={aurumIntegrationStatus}
    />
  ) : (
    <OptimizerPage
      baseParams={baseParams}
      simulationParams={optimizerSimulationParams}
      simulationActive={simulationActive}
      simulationLabel={stateLabel}
      preloadedBaseStats={baseOptimizerSnapshot}
      preloadedSimulationStats={simulationOptimizerSnapshot}
      optimizableBaseReference={optimizableBaseAdjusted}
    />
  );

  return (
    <MidasErrorBoundary>
      <div style={{ ...css.app, position: 'relative', overflow: 'hidden' }}>
        {simulationActive && (
          <>
            <style>{`
              @keyframes midasAmbientPulse {
                0%, 100% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.004); }
              }
            `}</style>
            <div
              aria-hidden="true"
              style={{
                position: 'fixed',
                inset: 8,
                borderRadius: 28,
                pointerEvents: 'none',
                border: `1px solid rgba(91, 140, 255, 0.34)`,
                boxShadow: 'inset 0 0 0 1px rgba(91, 140, 255, 0.12), 0 0 28px rgba(91, 140, 255, 0.12)',
                animation: 'midasAmbientPulse 2.8s ease-in-out infinite',
                zIndex: 8,
              }}
            />
          </>
        )}
        <Header statusColor={statusColor} />
        <main
          style={{
            padding: '12px 16px 90px',
            marginTop: 48,
            maxWidth: 960,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          {runtimeErrors.length > 0 && (
            <div
              style={{
                background: 'rgba(255, 92, 92, 0.12)',
                border: `1px solid ${T.negative}`,
                borderRadius: 12,
                padding: '10px 12px',
                color: T.textPrimary,
                fontSize: 12,
                marginBottom: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              <strong>Runtime error</strong>
              {`\n${runtimeErrors[0]}`}
            </div>
          )}
          {content}
        </main>

        <button
          onClick={() => setParamSheetOpen(true)}
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: `1px solid ${T.metalBase}`,
            background: T.surfaceEl,
            color: T.textPrimary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 25,
            boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
          }}
          aria-label="Abrir parámetros"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 4.5 13.2 6h2.3l.3 2 1.7 1-.9 1.9.9 1.9-1.7 1-.3 2h-2.3L12 19.5 10.8 18H8.5l-.3-2-1.7-1 .9-1.9-.9-1.9 1.7-1 .3-2h2.3L12 4.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          </svg>
        </button>

        <BottomNav active={activeTab} onChange={handleTabChange} />

        <ParamSheet
          open={paramSheetOpen}
          onClose={() => setParamSheetOpen(false)}
          params={simParams}
          onUpdate={updateSimParam}
          cashflowEvents={simParams.cashflowEvents}
          onCashflowEventsChange={handleCashflowEventsChange}
          onReset={resetSimulationSession}
          onRun={runSim}
        />
      </div>
    </MidasErrorBoundary>
  );
}

function Header({ statusColor }: { statusColor: string }) {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        zIndex: 30,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textPrimary, fontWeight: 700 }}>
        <span style={{ color: T.primary }}>◆</span>
        <span>Midas V1.2</span>
      </div>
      <div
        title={statusColor === T.primary ? 'Modo simulación' : statusColor === T.positive ? 'Resultados listos' : 'Sin resultados'}
        style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor }}
      />
    </header>
  );
}
