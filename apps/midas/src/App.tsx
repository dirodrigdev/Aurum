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

type OptimizerBaselineSnapshot = {
  probRuin: number;
  terminalP50: number;
};

type CentralWorkerStartMessage = {
  type: 'central-start';
  runId: number;
  channel: 'primary';
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
  const [simWorking, setSimWorking] = useState(false);
  const [simUiState, setSimUiState] = useState<SimulationUiState>('boot');
  const [heroPhase, setHeroPhase] = useState<HeroPhase>('boot');
  const [bootReadyPending, setBootReadyPending] = useState(false);
  const [simUiError, setSimUiError] = useState<string | null>(null);
  const [lastRecalcCause, setLastRecalcCause] = useState<RecalcCause | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const [pendingSnapshot, setPendingSnapshot] = useState<AurumOptimizableInvestmentsSnapshot | null>(null);
  const [pendingSnapshotLabel, setPendingSnapshotLabel] = useState<string | null>(null);
  const [pendingSnapshotSignature, setPendingSnapshotSignature] = useState<string | null>(null);
  const [pendingSnapshotApplying, setPendingSnapshotApplying] = useState(false);
  const [baseUpdatePending, setBaseUpdatePending] = useState(false);
  const [aurumSnapshotMonth, setAurumSnapshotMonth] = useState<string | null>(null);
  const [riskCapitalCLP, setRiskCapitalCLP] = useState(0);
  const [riskCapitalUsdTotal, setRiskCapitalUsdTotal] = useState(0);
  const [riskCapitalUsdSnapshotCLP, setRiskCapitalUsdSnapshotCLP] = useState(0);
  const [riskCapitalEnabled, setRiskCapitalEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem('midas:riskCapitalEnabled');
    return raw === 'true';
  });
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
  const lastStableCentralRef = useRef<SimulationResults | null>(null);
  const lastSnapshotSignatureRef = useRef<string | null>(null);
  const lastAppliedSnapshotSignatureRef = useRef<string | null>(null);
  const applyingSnapshotRef = useRef(false);
  const pendingRecalcCauseRef = useRef<RecalcCause | null>(null);
  const skipNextAutoRecalcRef = useRef(false);
  const recalcRequestIdRef = useRef(0);
  const baseSnapshotRequestIdRef = useRef(0);
  const activeRecalcWorkerRef = useRef<{
    worker: Worker;
    reject: (error: Error) => void;
  } | null>(null);

  const formatRuntimeError = useCallback((label: string, payload: unknown) => {
    if (payload instanceof Error) {
      const stack = payload.stack ? `\n${payload.stack}` : '';
      return `${label}: ${payload.name}: ${payload.message}${stack}`;
    }
    return `${label}: ${String(payload)}`;
  }, []);

  useEffect(() => {
    baseParamsRef.current = baseParams;
  }, [baseParams]);

  useEffect(() => {
    simParamsRef.current = simParams;
  }, [simParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('midas:riskCapitalEnabled', String(riskCapitalEnabled));
  }, [riskCapitalEnabled]);

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

  const cancelActiveRecalcWorker = useCallback(() => {
    const active = activeRecalcWorkerRef.current;
    if (!active) return;
    activeRecalcWorkerRef.current = null;
    active.worker.terminate();
    active.reject(new Error('simulation_cancelled'));
  }, []);

  const runCentralSimulationInWorker = useCallback(
    (
      params: ModelParameters,
      runId: number,
      options?: { cancelPreviousRecalc?: boolean },
    ): Promise<SimulationResults> =>
      new Promise<SimulationResults>((resolve, reject) => {
        if (options?.cancelPreviousRecalc) {
          cancelActiveRecalcWorker();
        }
        const worker = new Worker(new URL('./domain/simulation/central.worker.ts', import.meta.url), {
          type: 'module',
        });
        if (options?.cancelPreviousRecalc) {
          activeRecalcWorkerRef.current = { worker, reject };
        }
        let settled = false;
        const clearActiveIfNeeded = () => {
          if (activeRecalcWorkerRef.current?.worker === worker) {
            activeRecalcWorkerRef.current = null;
          }
        };
        const finalize = () => {
          clearActiveIfNeeded();
          worker.terminate();
        };

        worker.onmessage = (event: MessageEvent<CentralWorkerMessage>) => {
          const payload = event.data;
          if (!payload || payload.runId !== runId) return;
          settled = true;
          finalize();
          if (payload.type === 'done') {
            resolve(payload.result);
            return;
          }
          reject(new Error(payload.message || 'simulation_worker_error'));
        };
        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          finalize();
          reject(new Error(event.message || 'simulation_worker_error'));
        };
        worker.onmessageerror = () => {
          if (settled) return;
          settled = true;
          finalize();
          reject(new Error('simulation_worker_message_error'));
        };

        const message: CentralWorkerStartMessage = {
          type: 'central-start',
          runId,
          channel: 'primary',
          params,
        };
        worker.postMessage(message);
      }),
    [cancelActiveRecalcWorker],
  );

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

  const manualAdjustmentImpact = useMemo(() => {
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

  const beginRecalculationVisual = useCallback((cause: RecalcCause) => {
    setLastRecalcCause(cause);
    setSimWorking(true);
    setSimUiError(null);
    setBootReadyPending(false);
    const hasStableResult = Boolean(lastStableCentralRef.current);
    const shouldStale = hasStableResult && cause !== 'boot-init';
    setSimUiState(shouldStale ? 'stale' : 'boot');
    setHeroPhase(shouldStale ? 'stale' : 'boot');
  }, []);

  const startRecalculation = useCallback((cause: RecalcCause, run: () => ModelParameters) => {
    clearCalculationTimer();
    beginRecalculationVisual(cause);
    const requestId = recalcRequestIdRef.current + 1;
    recalcRequestIdRef.current = requestId;
    calculationTimerRef.current = window.setTimeout(async () => {
      try {
        const params = run();
        const nextResult = await runCentralSimulationInWorker(params, requestId, { cancelPreviousRecalc: true });
        if (requestId !== recalcRequestIdRef.current) return;
        setSimResult(nextResult);
        lastStableCentralRef.current = nextResult;
        setLastStableCentral(nextResult);
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
        setSimUiState('error');
        const fallbackPhase = lastStableCentralRef.current ? 'stale' : 'boot';
        setHeroPhase(fallbackPhase);
        setSimUiError(String(error?.message || 'No pude recalcular la simulación.'));
      } finally {
        if (requestId === recalcRequestIdRef.current) {
          setSimWorking(false);
          calculationTimerRef.current = null;
        }
      }
    }, 0);
  }, [beginRecalculationVisual, clearCalculationTimer, runCentralSimulationInWorker]);

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
      const targetCapital = shouldApplyCapital ? baseSimCapital : currentSim.capitalInitial;
      const sameSimCapital = Math.round(currentSim.capitalInitial) === Math.round(targetCapital);
      const sameSimComposition = JSON.stringify(currentSim.simulationComposition) === JSON.stringify(nextSimComposition);

      if (!sameSimCapital || !sameSimComposition) {
        const nextSimParams: ModelParameters = {
          ...currentSim,
          capitalInitial: targetCapital,
          label: shouldApplyCapital
            ? `Desde Aurum · ${snapshot?.snapshotLabel || 'ultimo cierre confirmado'}`
            : currentSim.label,
          simulationComposition: nextSimComposition,
        };
        setSimParams(nextSimParams);
        if (shouldRecalculate) {
          setBaseUpdatePending(false);
          skipNextAutoRecalcRef.current = true;
          startRecalculation('apply-aurum', () => nextSimParams);
        } else {
          setBaseUpdatePending(true);
        }
      }
    } catch (error: any) {
      console.error('[Midas] Error aplicando snapshot Aurum', error);
      setAurumIntegrationStatus('error');
      setSimUiState('error');
      setSimUiError(String(error?.message || 'Error aplicando base Aurum.'));
      setBaseUpdatePending(true);
    }
  }, [computeRiskCapital, riskCapitalEnabled, simOverrides?.active, simOverrides?.capital, startRecalculation]);

  const resetSimulationSession = useCallback(() => {
    clearSimulationTimer();
    clearCalculationTimer();
    setSimulationActive(false);
    setSimulationPreset('base');
    setSimOverrides(null);
    const next = applyScenarioEconomics(cloneParams(baseParams), 'base');
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
      setSimulationActive(true);
      setSimulationPreset(nextPreset);
      scheduleInactivityReset();
    },
    [scheduleInactivityReset],
  );

  const applyPendingSnapshot = useCallback(() => {
    if (!pendingSnapshot || !pendingSnapshotSignature) return;
    if (applyingSnapshotRef.current) return;
    applyingSnapshotRef.current = true;
    setPendingSnapshotApplying(true);
    markSimulationInteraction('custom');
    beginRecalculationVisual('apply-aurum');
    window.setTimeout(() => {
      try {
        lastAppliedSnapshotSignatureRef.current = pendingSnapshotSignature;
        applySnapshotNow(pendingSnapshot, { recalc: true });
        setPendingSnapshot(null);
        setPendingSnapshotLabel(null);
        setPendingSnapshotSignature(null);
        setBaseUpdatePending(false);
      } catch (error: unknown) {
        const entry = formatRuntimeError('applyPendingSnapshot', error);
        setRuntimeErrors((prev) => [entry, ...prev].slice(0, 3));
        setSimUiState('error');
        setSimUiError(error instanceof Error ? error.message : 'Error aplicando snapshot.');
      } finally {
        applyingSnapshotRef.current = false;
        setPendingSnapshotApplying(false);
      }
    }, 0);
  }, [applySnapshotNow, beginRecalculationVisual, formatRuntimeError, markSimulationInteraction, pendingSnapshot, pendingSnapshotSignature]);

  const toggleRiskCapital = useCallback(() => {
    pendingRecalcCauseRef.current = 'risk-toggle';
    setRiskCapitalEnabled((prev) => !prev);
    markSimulationInteraction('custom');
  }, [markSimulationInteraction]);

  const commitManualCapitalAdjustments = useCallback((next: ManualCapitalAdjustment[]) => {
    pendingRecalcCauseRef.current = 'ledger-commit';
    setManualCapitalAdjustments(next);
    markSimulationInteraction('custom');
  }, [markSimulationInteraction]);

  useEffect(() => {
    const baseParamsCurrent = baseParamsRef.current;
    const currentSimParams = simParamsRef.current;
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
        capitalInitial: Math.max(1, targetVisibleCapital),
      };
    } else {
      const riskDelta = riskCapitalEnabled
        ? manualAdjustmentImpact.currentRiskDelta + riskCapitalCLP
        : 0;
      const nextDelta = manualAdjustmentImpact.currentBanksDelta + manualAdjustmentImpact.currentInvestmentsDelta + riskDelta;
      const targetCapital = Math.max(1, baseParamsCurrent.capitalInitial + nextDelta);
      next = {
        ...next,
        capitalInitial: targetCapital,
      };
    }

    const deltaChange = next.capitalInitial - currentSimParams.capitalInitial;
    if (Math.abs(deltaChange) > 0.0001 && simOverrides?.active && typeof simOverrides.capital === 'number') {
      setSimOverrides((prev) => {
        if (!prev || !prev.active || typeof prev.capital !== 'number') return prev;
        return { ...prev, capital: Math.max(1, prev.capital + deltaChange) };
      });
    }

    setSimParams(next);
    const canRecalculateNow = !pendingSnapshotApplying && !pendingSnapshotLabel;
    if (canRecalculateNow) {
      if (skipNextAutoRecalcRef.current) {
        skipNextAutoRecalcRef.current = false;
        return;
      }
      if (baseUpdatePending) {
        setBaseUpdatePending(false);
      }
      const base = applySimulationOverrides(next, simOverrides);
      const cause = pendingRecalcCauseRef.current ?? 'params-change';
      pendingRecalcCauseRef.current = null;
      startRecalculation(cause, () => base);
    }
  }, [baseUpdatePending, manualAdjustmentImpact, pendingSnapshotApplying, pendingSnapshotLabel, riskCapitalCLP, riskCapitalEnabled, riskCapitalUsdSnapshotCLP, riskCapitalUsdTotal, simOverrides, startRecalculation]);

  useEffect(() => {
    if (!simResult) {
      const next = applyScenarioEconomics(cloneParams(baseParams), 'base');
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
      clearCalculationTimer();
      cancelActiveRecalcWorker();
    };
  }, [
    applyScenarioEconomics,
    baseParams,
    cancelActiveRecalcWorker,
    clearCalculationTimer,
    clearSimulationTimer,
    scheduleInactivityReset,
    simResult,
    startRecalculation,
  ]);

  useEffect(() => {
    if (baseUpdatePending) return;
    const requestId = baseSnapshotRequestIdRef.current + 1;
    baseSnapshotRequestIdRef.current = requestId;
    let cancelled = false;
    const baseFromAurum = applyScenarioEconomics(cloneParams(baseParams), 'base');
    void runCentralSimulationInWorker(baseFromAurum, requestId)
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
  }, [applyScenarioEconomics, baseParams, baseUpdatePending, runCentralSimulationInWorker]);

  const updateSimParam = useCallback((path: string, value: number) => {
    markSimulationInteraction('custom');
    setSimParams((prev) => {
      const next = updateByPath(prev, path, value);
      const base = applySimulationOverrides(next, simOverrides);
      startRecalculation('params-change', () => base);
      return next;
    });
  }, [markSimulationInteraction, simOverrides, startRecalculation]);

  const handleCashflowEventsChange = useCallback((next: CashflowEvent[]) => {
    markSimulationInteraction('custom');
    setSimParams((prev) => {
      const updated = { ...prev, cashflowEvents: next };
      const base = applySimulationOverrides(updated, simOverrides);
      startRecalculation('params-change', () => base);
      return updated;
    });
  }, [markSimulationInteraction, simOverrides, startRecalculation]);

  const handleScenarioChange = useCallback((next: ScenarioVariantId) => {
    markSimulationInteraction(next);
    setSimParams((prev) => {
      const scenarioBase = applyScenarioEconomics(cloneParams(baseParams), next);
      const nextParams: ModelParameters = {
        ...prev,
        activeScenario: next,
        returns: scenarioBase.returns,
        inflation: scenarioBase.inflation,
        fx: scenarioBase.fx,
      };
      const base = applySimulationOverrides(nextParams, simOverrides);
      startRecalculation('scenario', () => base);
      return nextParams;
    });
  }, [applyScenarioEconomics, baseParams, markSimulationInteraction, simOverrides, startRecalculation]);

  const handleSimOverridesChange = useCallback((next: SimulationOverrides | null) => {
    setSimOverrides(next);
    if (next) {
      markSimulationInteraction('custom');
      const base = applySimulationOverrides(simParams, next);
      startRecalculation('params-change', () => base);
    }
  }, [markSimulationInteraction, simParams, startRecalculation]);

  const patchSimParams = useCallback((patcher: (prev: ModelParameters) => ModelParameters) => {
    markSimulationInteraction('custom');
    setSimParams((prev) => {
      const next = patcher(prev);
      const base = applySimulationOverrides(next, simOverrides);
      startRecalculation('params-change', () => base);
      return next;
    });
  }, [markSimulationInteraction, simOverrides, startRecalculation]);

  const runSim = useCallback(() => {
    markSimulationInteraction(simulationPreset);
    const base = applySimulationOverrides(simParams, simOverrides);
    startRecalculation('manual-run', () => base);
    setActiveTab('sim');
  }, [markSimulationInteraction, simOverrides, simParams, simulationPreset, startRecalculation]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  const statusColor = simulationActive ? T.primary : simResult ? T.positive : T.textMuted;
  const stateLabel =
    simulationActive && simulationPreset !== 'base'
      ? simulationPreset === 'optimistic'
        ? 'SIMULACIÓN · O'
        : simulationPreset === 'pessimistic'
          ? 'SIMULACIÓN · P'
          : 'SIMULACIÓN · C'
      : 'BASE';

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
        setPendingSnapshot(null);
        setPendingSnapshotLabel(null);
        setPendingSnapshotSignature(null);
        return;
      }

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
      manualCapitalAdjustments={manualCapitalAdjustments}
      riskCapitalEnabled={riskCapitalEnabled}
      riskCapitalCLP={riskCapitalCLP}
      onApplyPendingSnapshot={applyPendingSnapshot}
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
