import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CashflowEvent, ModelParameters, ScenarioVariant, ScenarioVariantId, SimulationResults } from './domain/model/types';
import { DEFAULT_PARAMETERS, SCENARIO_VARIANTS } from './domain/model/defaults';
import { applyScenarioVariant } from './domain/simulation/engine';
import { runMidasTriSimulation } from './domain/simulation/policy';
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
type TriMotorResult = {
  central: SimulationResults | null;
  favorable: SimulationResults | null;
  prudent: SimulationResults | null;
};
type SimulationUiState = 'idle' | 'recalculating' | 'ready' | 'error';
type AurumIntegrationStatus = 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';

type OptimizerBaselineSnapshot = {
  probRuin: number;
  terminalP50: number;
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
      nSim: Math.min(1200, p.simulation.nSim),
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

export default function App() {
  const [baseParams, setBaseParams] = useState<ModelParameters>(() => cloneParams(DEFAULT_PARAMETERS));
  const [simParams, setSimParams] = useState<ModelParameters>(() => cloneParams(DEFAULT_PARAMETERS));
  const [activeTab, setActiveTab] = useState<TabId>('sim');
  const [paramSheetOpen, setParamSheetOpen] = useState(false);
  const [simResult, setSimResult] = useState<TriMotorResult>({ central: null, favorable: null, prudent: null });
  const [simOverrides, setSimOverrides] = useState<SimulationOverrides | null>(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationPreset, setSimulationPreset] = useState<SimulationPreset>('base');
  const [baseOptimizerSnapshot, setBaseOptimizerSnapshot] = useState<OptimizerBaselineSnapshot | null>(null);
  const [simWorking, setSimWorking] = useState(false);
  const [simUiState, setSimUiState] = useState<SimulationUiState>('idle');
  const [simUiError, setSimUiError] = useState<string | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const [pendingSnapshot, setPendingSnapshot] = useState<AurumOptimizableInvestmentsSnapshot | null>(null);
  const [pendingSnapshotLabel, setPendingSnapshotLabel] = useState<string | null>(null);
  const [pendingSnapshotSignature, setPendingSnapshotSignature] = useState<string | null>(null);
  const simulationTimerRef = useRef<number | null>(null);
  const calculationTimerRef = useRef<number | null>(null);
  const activityHandlerRef = useRef<() => void>();
  const baseParamsRef = useRef<ModelParameters>(baseParams);
  const simParamsRef = useRef<ModelParameters>(simParams);
  const lastSnapshotSignatureRef = useRef<string | null>(null);
  const lastAppliedSnapshotSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    baseParamsRef.current = baseParams;
  }, [baseParams]);

  useEffect(() => {
    simParamsRef.current = simParams;
  }, [simParams]);

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
      const message = payload instanceof Error ? payload.stack || payload.message : String(payload);
      const entry = `${label}: ${message}`;
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
  }, []);

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

  const computeTriMotor = useCallback((params: ModelParameters): TriMotorResult => runMidasTriSimulation(params), []);

  const getSnapshotSignature = useCallback((snapshot: AurumOptimizableInvestmentsSnapshot) => {
    const ufSnapshotClp =
      snapshot.version === 2
        ? snapshot.nonOptimizable?.realEstate?.ufSnapshotCLP ?? ''
        : '';
    return [
      snapshot.version,
      snapshot.publishedAt,
      snapshot.snapshotMonth,
      snapshot.snapshotLabel,
      snapshot.totalNetWorthCLP,
      snapshot.optimizableInvestmentsCLP,
      ufSnapshotClp,
    ].join('|');
  }, []);

  const applySnapshotNow = useCallback((snapshot: AurumOptimizableInvestmentsSnapshot | null) => {
    if (!snapshot) return;
    try {
      const composition = snapshotToSimulationComposition(snapshot);
      const compositionMode = composition?.mode ?? 'legacy';
      const hasFallbackFlags =
        composition?.mortgageProjectionStatus === 'fallback_incomplete' ||
        (composition?.diagnostics?.notes ?? []).some((note) => String(note).includes('fallback'));
      const isPartialComposition = compositionMode === 'partial' || hasFallbackFlags;
      const aurumNetWorth = Number(snapshot?.totalNetWorthCLP ?? NaN);

      setAurumSnapshotLabel(snapshot.snapshotLabel || 'ultimo cierre confirmado');
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
      const sameBaseCapital = Math.round(currentBase.capitalInitial) === Math.round(aurumNetWorth);
      const nextBaseComposition = composition ?? currentBase.simulationComposition;
      const sameBaseComposition = JSON.stringify(currentBase.simulationComposition) === JSON.stringify(nextBaseComposition);
      if (!sameBaseCapital || !sameBaseComposition) {
        setBaseParams({
          ...currentBase,
          capitalInitial: aurumNetWorth,
          label: `Desde Aurum · ${snapshot?.snapshotLabel || 'ultimo cierre confirmado'}`,
          simulationComposition: nextBaseComposition,
        });
      }

      const currentSim = simParamsRef.current;
      const shouldApplyCapital = !simulationActive && !simOverrides?.active;
      const targetCapital = shouldApplyCapital ? aurumNetWorth : currentSim.capitalInitial;
      const nextSimComposition = composition ?? currentSim.simulationComposition;
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
        if (shouldApplyCapital) {
          try {
            setSimUiError(null);
            setSimUiState('recalculating');
            setSimResult(computeTriMotor(nextSimParams));
            setSimUiState('ready');
            setBaseUpdatePending(false);
          } catch (error: any) {
            console.error('[Midas] Error recalculando simulacion', error);
            setSimUiState('error');
            setSimUiError(String(error?.message || 'No pude recalcular la simulacion.'));
            setBaseUpdatePending(true);
          }
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
  }, [computeTriMotor, simOverrides?.active, simulationActive]);

  const queueTriMotorCalculation = useCallback((params: ModelParameters) => {
    clearCalculationTimer();
    setSimWorking(true);
    setSimUiState('recalculating');
    setSimUiError(null);
    calculationTimerRef.current = window.setTimeout(() => {
      try {
        setSimResult(computeTriMotor(params));
        setSimUiState('ready');
      } catch (error: any) {
        console.error('[Midas] Error recalculando simulación', error);
        setSimUiState('error');
        setSimUiError(String(error?.message || 'No pude recalcular la simulación.'));
      } finally {
        setSimWorking(false);
        calculationTimerRef.current = null;
      }
    }, 0);
  }, [clearCalculationTimer, computeTriMotor]);

  const resetSimulationSession = useCallback(() => {
    clearSimulationTimer();
    clearCalculationTimer();
    setSimulationActive(false);
    setSimulationPreset('base');
    setSimOverrides(null);
    const next = applyScenarioEconomics(cloneParams(baseParams), 'base');
    setSimParams(next);
    try {
      setSimUiError(null);
      setSimResult(computeTriMotor(next));
      setSimUiState('ready');
    } catch (error: any) {
      console.error('[Midas] Error recalculando simulación', error);
      setSimUiState('error');
      setSimUiError(String(error?.message || 'No pude recalcular la simulación.'));
    }
    setSimWorking(false);
    setParamSheetOpen(false);
  }, [applyScenarioEconomics, baseParams, clearCalculationTimer, clearSimulationTimer, computeTriMotor]);

  const applyPendingSnapshot = useCallback(() => {
    if (!pendingSnapshot || !pendingSnapshotSignature) return;
    lastAppliedSnapshotSignatureRef.current = pendingSnapshotSignature;
    applySnapshotNow(pendingSnapshot);
    setPendingSnapshot(null);
    setPendingSnapshotLabel(null);
    setPendingSnapshotSignature(null);
  }, [applySnapshotNow, pendingSnapshot, pendingSnapshotSignature]);

  const scheduleInactivityReset = useCallback(() => {
    clearSimulationTimer();
    simulationTimerRef.current = window.setTimeout(() => {
      resetSimulationSession();
    }, SIMULATION_TIMEOUT_MS);
  }, [clearSimulationTimer, resetSimulationSession]);

  const touchSimulation = useCallback(
    (nextPreset: SimulationPreset = 'custom') => {
      setSimulationActive(true);
      setSimulationPreset(nextPreset);
      scheduleInactivityReset();
    },
    [scheduleInactivityReset],
  );

  useEffect(() => {
    if (!simResult.central) {
      const next = applyScenarioEconomics(cloneParams(baseParams), 'base');
      setSimParams(next);
      try {
        setSimUiError(null);
        setSimResult(computeTriMotor(next));
        setSimUiState('ready');
      } catch (error: any) {
        console.error('[Midas] Error recalculando simulación', error);
        setSimUiState('error');
        setSimUiError(String(error?.message || 'No pude recalcular la simulación.'));
      }
    }
    scheduleInactivityReset();
    const handler = () => scheduleInactivityReset();
    activityHandlerRef.current = handler;
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => window.addEventListener(ev, handler));
    return () => {
      ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => window.removeEventListener(ev, handler));
      clearSimulationTimer();
      clearCalculationTimer();
    };
  }, [applyScenarioEconomics, baseParams, clearCalculationTimer, clearSimulationTimer, computeTriMotor, scheduleInactivityReset, simResult]);

  useEffect(() => {
    const baseFromAurum = applyScenarioEconomics(cloneParams(baseParams), 'base');
    const tri = computeTriMotor(baseFromAurum);
    setBaseOptimizerSnapshot(toOptimizerBaselineSnapshot(tri.central));
  }, [applyScenarioEconomics, baseParams, computeTriMotor]);

  const updateSimParam = useCallback((path: string, value: number) => {
    setSimParams((prev) => {
      const next = updateByPath(prev, path, value);
      const base = applySimulationOverrides(next, simOverrides);
      queueTriMotorCalculation(base);
      return next;
    });
    touchSimulation('custom');
  }, [queueTriMotorCalculation, simOverrides, touchSimulation]);

  const handleCashflowEventsChange = useCallback((next: CashflowEvent[]) => {
    setSimParams((prev) => {
      const updated = { ...prev, cashflowEvents: next };
      const base = applySimulationOverrides(updated, simOverrides);
      queueTriMotorCalculation(base);
      return updated;
    });
    touchSimulation('custom');
  }, [queueTriMotorCalculation, simOverrides, touchSimulation]);

  const handleScenarioChange = useCallback((next: ScenarioVariantId) => {
    setSimulationActive(true);
    setSimulationPreset(next);
    scheduleInactivityReset();
    setSimParams((prev) => {
      const nextParams = applyScenarioEconomics(prev, next);
      const base = applySimulationOverrides(nextParams, simOverrides);
      queueTriMotorCalculation(base);
      return nextParams;
    });
  }, [applyScenarioEconomics, queueTriMotorCalculation, scheduleInactivityReset, simOverrides]);

  const handleSimOverridesChange = useCallback((next: SimulationOverrides | null) => {
    setSimOverrides(next);
    if (next) {
      const base = applySimulationOverrides(simParams, next);
      queueTriMotorCalculation(base);
      touchSimulation('custom');
    }
  }, [queueTriMotorCalculation, simParams, touchSimulation]);

  const patchSimParams = useCallback((patcher: (prev: ModelParameters) => ModelParameters) => {
    setSimParams((prev) => {
      const next = patcher(prev);
      const base = applySimulationOverrides(next, simOverrides);
      queueTriMotorCalculation(base);
      return next;
    });
    touchSimulation('custom');
  }, [queueTriMotorCalculation, simOverrides, touchSimulation]);

  const runSim = useCallback(() => {
    touchSimulation(simulationPreset);
    const base = applySimulationOverrides(simParams, simOverrides);
    queueTriMotorCalculation(base);
    setActiveTab('sim');
  }, [queueTriMotorCalculation, simOverrides, simParams, simulationPreset, touchSimulation]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  const statusColor = simulationActive ? T.primary : simResult.central ? T.positive : T.textMuted;
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
    () => (simulationActive ? toOptimizerBaselineSnapshot(simResult.central) : null),
    [simulationActive, simResult.central],
  );
  const [optimizableBaseReference, setOptimizableBaseReference] = useState<OptimizableBaseReference>({
    amountClp: null,
    asOf: null,
    sourceLabel: 'Aurum · último cierre confirmado',
    status: 'pending',
  });
  const [aurumIntegrationStatus, setAurumIntegrationStatus] = useState<AurumIntegrationStatus>(
    aurumIntegrationConfigured ? 'loading' : 'unconfigured',
  );
  const [aurumSnapshotLabel, setAurumSnapshotLabel] = useState<string | null>(null);
  const [baseUpdatePending, setBaseUpdatePending] = useState(false);

  useEffect(() => {
    if (!aurumIntegrationConfigured) {
      setAurumIntegrationStatus('unconfigured');
      setAurumSnapshotLabel(null);
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
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [computeTriMotor, simOverrides?.active, simulationActive]);

  useEffect(() => {
    if (!simulationActive && !simOverrides?.active) {
      setBaseUpdatePending(false);
    }
  }, [simOverrides?.active, simulationActive]);

  useEffect(() => {
    if (activeTab !== 'sim') return;
    if (simulationActive || simOverrides?.active) return;
    setBaseUpdatePending(false);
    setSimUiError(null);
    setSimUiState(simResult.central ? 'ready' : 'idle');
  }, [activeTab, simOverrides?.active, simulationActive, simResult.central]);

  const content = activeTab === 'sim' ? (
    <SimulationPage
      resultCentral={simResult.central}
      resultFavorable={simResult.favorable}
      resultPrudent={simResult.prudent}
      params={simParams}
      simOverrides={simOverrides}
      simActive={simulationActive}
      simWorking={simWorking}
      simUiState={simUiState}
      simUiError={simUiError}
      simulationPreset={simulationPreset}
      stateLabel={stateLabel}
      aurumIntegrationStatus={aurumIntegrationStatus}
      aurumSnapshotLabel={aurumSnapshotLabel}
      baseUpdatePending={baseUpdatePending}
      pendingSnapshotLabel={pendingSnapshotLabel}
      onApplyPendingSnapshot={applyPendingSnapshot}
      onSimulationTouch={touchSimulation}
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
      optimizableBaseReference={optimizableBaseReference}
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
      optimizableBaseReference={optimizableBaseReference}
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
