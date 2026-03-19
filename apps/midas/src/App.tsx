import React, { useCallback, useMemo, useState } from 'react';
import type { ModelParameters, SimulationResults } from './domain/model/types';
import { DEFAULT_PARAMETERS } from './domain/model/defaults';
import { runSimulation } from './domain/simulation/engine';
import { BottomNav, TabId } from './components/BottomNav';
import { ParamSheet } from './components/ParamSheet';
import { SimulationPage } from './components/SimulationPage';
import { SensitivityPage } from './components/SensitivityPage';
import { StressPage } from './components/StressPage';
import { OptimizerPage } from './components/OptimizerPage';
import { T, css } from './components/theme';

function cloneParams(p: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(p));
}

function useParams() {
  const [params, setParams] = useState<ModelParameters>(cloneParams(DEFAULT_PARAMETERS));
  const update = useCallback((path: string, value: number) => {
    setParams((prev) => {
      const next = cloneParams(prev);
      const parts = path.split('.');
      let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  }, []);
  const reset = useCallback(() => setParams(cloneParams(DEFAULT_PARAMETERS)), []);
  return { params, update, reset };
}

export default function App() {
  const { params, update, reset } = useParams();
  const [activeTab, setActiveTab] = useState<TabId>('sim');
  const [paramSheetOpen, setParamSheetOpen] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResults | null>(null);

  const runSim = () => {
    const res = runSimulation(params);
    setSimResult(res);
    setActiveTab('sim');
  };

  const statusColor = simResult ? T.positive : T.textMuted;

  const content = useMemo(() => {
    if (activeTab === 'sim') return <SimulationPage result={simResult} params={params} />;
    if (activeTab === 'sens') return <SensitivityPage params={params} />;
    if (activeTab === 'stress') return <StressPage params={params} />;
    return <OptimizerPage params={params} />;
  }, [activeTab, params, simResult]);

  return (
    <div style={css.app}>
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

      <BottomNav active={activeTab} onChange={setActiveTab} />

      <ParamSheet
        open={paramSheetOpen}
        onClose={() => setParamSheetOpen(false)}
        params={params}
        onUpdate={update}
        onReset={reset}
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
        title={statusColor === T.positive ? 'Resultados listos' : 'Sin resultados'}
        style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor }}
      />
    </header>
  );
}
