import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CashflowEvent, ModelParameters, ScenarioVariant, ScenarioVariantId, SimulationResults } from './domain/model/types';
import { DEFAULT_PARAMETERS, SCENARIO_VARIANTS } from './domain/model/defaults';
import { applyScenarioVariant, runSimulation } from './domain/simulation/engine';
import { BottomNav, TabId } from './components/BottomNav';
import { ParamSheet } from './components/ParamSheet';
import { SimulationPage, SimulationOverrides, SimulationPreset } from './components/SimulationPage';
import { SensitivityPage } from './components/SensitivityPage';
import { StressPage } from './components/StressPage';
import { OptimizerPage } from './components/OptimizerPage';
import { T, css } from './components/theme';

const SIMULATION_TIMEOUT_MS = 10 * 60 * 1000;

type ScenarioEconomicsApplier = (p: ModelParameters, scenarioId: ScenarioVariantId) => ModelParameters;

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
  const [baseParams] = useState<ModelParameters>(() => cloneParams(DEFAULT_PARAMETERS));
  const [simParams, setSimParams] = useState<ModelParameters>(() => cloneParams(DEFAULT_PARAMETERS));
  const [activeTab, setActiveTab] = useState<TabId>('sim');
  const [paramSheetOpen, setParamSheetOpen] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResults | null>(null);
  const [simOverrides, setSimOverrides] = useState<SimulationOverrides | null>(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationPreset, setSimulationPreset] = useState<SimulationPreset>('base');
  const simulationTimerRef = useRef<number | null>(null);
  const activityHandlerRef = useRef<() => void>();

  const clearSimulationTimer = useCallback(() => {
    if (simulationTimerRef.current !== null) {
      window.clearTimeout(simulationTimerRef.current);
      simulationTimerRef.current = null;
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

  const resetSimulationSession = useCallback(() => {
    clearSimulationTimer();
    setSimulationActive(false);
    setSimulationPreset('base');
    setSimOverrides(null);
    const next = applyScenarioEconomics(cloneParams(baseParams), 'base');
    setSimParams(next);
    setSimResult(runSimulation(next));
    setParamSheetOpen(false);
  }, [applyScenarioEconomics, baseParams, clearSimulationTimer]);

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
    if (!simResult) {
      const next = applyScenarioEconomics(cloneParams(baseParams), 'base');
      setSimParams(next);
      setSimResult(runSimulation(next));
    }
    scheduleInactivityReset();
    const handler = () => scheduleInactivityReset();
    activityHandlerRef.current = handler;
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => window.addEventListener(ev, handler));
    return () => {
      ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => window.removeEventListener(ev, handler));
      clearSimulationTimer();
    };
  }, [applyScenarioEconomics, baseParams, clearSimulationTimer, scheduleInactivityReset, simResult]);

  const updateSimParam = useCallback((path: string, value: number) => {
    setSimParams((prev) => {
      const next = updateByPath(prev, path, value);
      setSimResult(runSimulation(applySimulationOverrides(next, simOverrides)));
      return next;
    });
    touchSimulation('custom');
  }, [simOverrides, touchSimulation]);

  const handleCashflowEventsChange = useCallback((next: CashflowEvent[]) => {
    setSimParams((prev) => {
      const updated = { ...prev, cashflowEvents: next };
      setSimResult(runSimulation(applySimulationOverrides(updated, simOverrides)));
      return updated;
    });
    touchSimulation('custom');
  }, [simOverrides, touchSimulation]);

  const handleScenarioChange = useCallback((next: ScenarioVariantId) => {
    setSimOverrides(null);
    setSimParams((prev) => {
      const nextParams = applyScenarioEconomics(prev, next);
      setSimResult(runSimulation(applySimulationOverrides(nextParams, null)));
      return nextParams;
    });
    touchSimulation(next);
  }, [applyScenarioEconomics, touchSimulation]);

  const handleSimOverridesChange = useCallback((next: SimulationOverrides | null) => {
    setSimOverrides(next);
    if (next) {
      setSimResult(runSimulation(applySimulationOverrides(simParams, next)));
      touchSimulation('custom');
    }
  }, [simParams, touchSimulation]);

  const runSim = useCallback(() => {
    touchSimulation(simulationPreset);
    setSimResult(runSimulation(applySimulationOverrides(simParams, simOverrides)));
    setActiveTab('sim');
  }, [simOverrides, simParams, simulationPreset, touchSimulation]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  const statusColor = simulationActive ? T.primary : simResult ? T.positive : T.textMuted;
  const simulationBadge =
    simulationActive && simulationPreset !== 'base'
      ? simulationPreset === 'optimistic'
        ? 'Simulación · O'
        : simulationPreset === 'pessimistic'
          ? 'Simulación · P'
          : 'Simulación · C'
      : '';

  const content = activeTab === 'sim' ? (
    <SimulationPage
      result={simResult}
      params={simParams}
      simOverrides={simOverrides}
      simActive={simulationActive}
      simulationPreset={simulationPreset}
      onSimulationTouch={touchSimulation}
      onScenarioChange={handleScenarioChange}
      onSimOverridesChange={handleSimOverridesChange}
      onResetSim={resetSimulationSession}
    />
  ) : activeTab === 'sens' ? (
    <SensitivityPage params={simParams} />
  ) : activeTab === 'stress' ? (
    <StressPage params={simParams} />
  ) : (
    <OptimizerPage params={simParams} />
  );

  return (
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
      <Header statusColor={statusColor} badge={simulationBadge} />
      <main
        style={{
          padding: '12px 16px 90px',
          marginTop: 48,
          maxWidth: 960,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
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
  );
}

function Header({ statusColor, badge }: { statusColor: string; badge: string }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {badge && <span style={{ color: T.textSecondary, fontSize: 11 }}>{badge}</span>}
        <div
          title={statusColor === T.primary ? 'Modo simulación' : statusColor === T.positive ? 'Resultados listos' : 'Sin resultados'}
          style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor }}
        />
      </div>
    </header>
  );
}
