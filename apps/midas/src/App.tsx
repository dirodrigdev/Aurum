import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CashflowEvent, ModelParameters, ScenarioVariantId, SimulationResults } from './domain/model/types';
import { DEFAULT_PARAMETERS } from './domain/model/defaults';
import { runSimulation } from './domain/simulation/engine';
import { BottomNav, TabId } from './components/BottomNav';
import { ParamSheet } from './components/ParamSheet';
import { SimulationPage, SimulationOverrides, SimulationPreset } from './components/SimulationPage';
import { SensitivityPage } from './components/SensitivityPage';
import { StressPage } from './components/StressPage';
import { OptimizerPage } from './components/OptimizerPage';
import { T, css } from './components/theme';

const SIMULATION_TIMEOUT_MS = 10 * 60 * 1000;

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

  const clearSimulationTimer = useCallback(() => {
    if (simulationTimerRef.current !== null) {
      window.clearTimeout(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
  }, []);

  const resetSimulationSession = useCallback(() => {
    clearSimulationTimer();
    setSimulationActive(false);
    setSimulationPreset('base');
    setSimOverrides(null);
    setSimParams(cloneParams(baseParams));
    setSimResult(null);
    setParamSheetOpen(false);
  }, [baseParams, clearSimulationTimer]);

  const touchSimulation = useCallback(
    (nextPreset: SimulationPreset = 'custom') => {
      setSimulationActive(true);
      setSimulationPreset(nextPreset);
      clearSimulationTimer();
      simulationTimerRef.current = window.setTimeout(() => {
        resetSimulationSession();
      }, SIMULATION_TIMEOUT_MS);
    },
    [clearSimulationTimer, resetSimulationSession],
  );

  useEffect(() => {
    return () => clearSimulationTimer();
  }, [clearSimulationTimer]);

  const updateSimParam = useCallback((path: string, value: number) => {
    setSimParams((prev) => updateByPath(prev, path, value));
    touchSimulation('custom');
  }, [touchSimulation]);

  const handleCashflowEventsChange = useCallback((next: CashflowEvent[]) => {
    setSimParams((prev) => ({ ...prev, cashflowEvents: next }));
    touchSimulation('custom');
  }, [touchSimulation]);

  const handleScenarioChange = useCallback((next: ScenarioVariantId) => {
    if (next === 'base') {
      resetSimulationSession();
      return;
    }
    const nextParams = cloneParams(baseParams);
    nextParams.activeScenario = next;
    setSimParams(nextParams);
    setSimOverrides(null);
    touchSimulation(next);
  }, [baseParams, resetSimulationSession, touchSimulation]);

  const handleSimOverridesChange = useCallback((next: SimulationOverrides | null) => {
    setSimOverrides(next);
    if (next) touchSimulation('custom');
  }, [touchSimulation]);

  const runSim = useCallback(() => {
    touchSimulation(simulationPreset);
    setSimResult(runSimulation(applySimulationOverrides(simParams, simOverrides)));
    setActiveTab('sim');
  }, [simOverrides, simParams, simulationPreset, touchSimulation]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  const statusColor = simulationActive ? T.primary : simResult ? T.positive : T.textMuted;

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
    <SensitivityPage params={baseParams} />
  ) : activeTab === 'stress' ? (
    <StressPage params={baseParams} />
  ) : (
    <OptimizerPage params={baseParams} />
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
