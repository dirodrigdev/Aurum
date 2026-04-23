import React, { useEffect, useMemo, useState } from 'react';
import {
  loadAssistedInstrumentOptions,
  runAssistedSimulation,
  type AssistedInputs,
  type AssistedInstrumentOption,
  type AssistedOptimizationObjective,
  type AssistedOptimizationResult,
  type AssistedPortfolioEntry,
} from '../domain/simulation/assistedSimulation';
import { DEFAULT_PARAMETERS } from '../domain/model/defaults';
import { T } from './theme';

type AssistedQuestionMode = 'max_spending' | 'duration' | 'success';
type PortfolioSourceMode = 'simple' | 'instruments';

type DurationEstimate = {
  p10: number;
  p50: number;
  p90: number;
  censoredP10: boolean;
  censoredP50: boolean;
  censoredP90: boolean;
};

const SIMPLE_RV_ID = '__assisted_simple_rv__';
const SIMPLE_RF_ID = '__assisted_simple_rf__';

const formatMoney = (value: number): string => {
  if (!Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}MM`;
  return `$${Math.round(value).toLocaleString('es-CL')}`;
};

const formatPct = (value: number): string => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const mmToClp = (valueMm: number): number => Math.round(Math.max(0, valueMm) * 1_000_000);
const clpToMm = (valueClp: number): number => Math.max(0, valueClp) / 1_000_000;

const defaultInputs: AssistedInputs = {
  initialCapitalClp: 1_500_000_000,
  extraContributionEnabled: false,
  extraContributionClp: 100_000_000,
  extraContributionYear: 5,
  horizonYears: 30,
  spendingMode: 'fixed',
  fixedMonthlyClp: 1_000_000,
  phase1MonthlyClp: 1_000_000,
  phase1Years: 8,
  phase2MonthlyClp: 800_000,
  portfolioMode: 'manual',
  portfolioEntryMode: 'amount',
  portfolioEntries: [],
  includeTwoOfThreeCheck: true,
  successThreshold: 0.85,
  gridStepPct: 5,
  nSim: 1000,
  seed: 42,
};

const modeCards: Array<{ mode: AssistedQuestionMode; title: string; subtitle: string }> = [
  {
    mode: 'max_spending',
    title: 'Cuanto puedo gastar por mes',
    subtitle: 'Calcula el retiro mensual maximo sostenible para tu horizonte.',
  },
  {
    mode: 'duration',
    title: 'Cuantos anos dura mi plata',
    subtitle: 'Estima la duracion esperada de tu capital con el gasto actual.',
  },
  {
    mode: 'success',
    title: 'Que probabilidad de exito tengo',
    subtitle: 'Mide la probabilidad de llegar al horizonte configurado.',
  },
];

const selectedIdsFromEntries = (entries: AssistedPortfolioEntry[]) => entries.map((entry) => entry.instrumentId);

const mixLabel = (weights: AssistedOptimizationResult['best']['weights']): string => {
  const rv = (weights.rvGlobal + weights.rvChile) * 100;
  const rf = (weights.rfGlobal + weights.rfChile) * 100;
  return `RV ${rv.toFixed(1)}% · RF ${rf.toFixed(1)}%`;
};

const resolveSimpleSleeveShares = (): { rvGlobalShare: number; rvChileShare: number; rfGlobalShare: number; rfChileShare: number } => {
  const base = DEFAULT_PARAMETERS.weights;
  const rvTotal = base.rvGlobal + base.rvChile;
  const rfTotal = base.rfGlobal + base.rfChile;
  return {
    rvGlobalShare: rvTotal > 0 ? base.rvGlobal / rvTotal : 0.5,
    rvChileShare: rvTotal > 0 ? base.rvChile / rvTotal : 0.5,
    rfGlobalShare: rfTotal > 0 ? base.rfGlobal / rfTotal : 0.5,
    rfChileShare: rfTotal > 0 ? base.rfChile / rfTotal : 0.5,
  };
};

const buildSimpleInstruments = (): AssistedInstrumentOption[] => {
  const shares = resolveSimpleSleeveShares();
  return [
    {
      instrumentId: SIMPLE_RV_ID,
      label: 'Mix simple RV',
      name: 'Mix simple RV',
      currency: 'CLP',
      amountClp: 0,
      weightPortfolio: 0.5,
      sleeveWeights: {
        rvGlobal: shares.rvGlobalShare,
        rvChile: shares.rvChileShare,
        rfGlobal: 0,
        rfChile: 0,
      },
    },
    {
      instrumentId: SIMPLE_RF_ID,
      label: 'Mix simple RF',
      name: 'Mix simple RF',
      currency: 'CLP',
      amountClp: 0,
      weightPortfolio: 0.5,
      sleeveWeights: {
        rvGlobal: 0,
        rvChile: 0,
        rfGlobal: shares.rfGlobalShare,
        rfChile: shares.rfChileShare,
      },
    },
  ];
};

const firstNonPositiveYear = (points: AssistedOptimizationResult['best']['fanChartData'], key: 'p10' | 'p50' | 'p90'): number | null => {
  for (const point of points) {
    if ((point[key] ?? Number.NaN) <= 0) return point.year;
  }
  return null;
};

const estimateDuration = (row: AssistedOptimizationResult['best'], horizonYears: number): DurationEstimate => {
  const points = [...(row.fanChartData ?? [])].sort((a, b) => a.year - b.year);
  const p10Hit = firstNonPositiveYear(points, 'p10');
  const p50Hit = firstNonPositiveYear(points, 'p50');
  const p90Hit = firstNonPositiveYear(points, 'p90');
  return {
    p10: p10Hit ?? horizonYears,
    p50: p50Hit ?? horizonYears,
    p90: p90Hit ?? horizonYears,
    censoredP10: p10Hit === null,
    censoredP50: p50Hit === null,
    censoredP90: p90Hit === null,
  };
};

const formatDuration = (years: number, censored: boolean): string => {
  const rounded = Number.isFinite(years) ? years.toFixed(1) : '--';
  return censored ? `>= ${rounded} anos` : `${rounded} anos`;
};

function MiniFanChart({ data }: { data: Array<{ year: number; p50: number }> }) {
  const width = 540;
  const height = 170;
  if (!data || data.length < 2) {
    return <div style={{ color: T.textMuted, fontSize: 12 }}>Sin trayectoria suficiente para graficar.</div>;
  }
  const xs = data.map((p) => p.year);
  const ys = data.map((p) => p.p50);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(1e-9, maxX - minX);
  const rangeY = Math.max(1e-9, maxY - minY);
  const points = data
    .map((p) => {
      const x = ((p.year - minX) / rangeX) * (width - 24) + 12;
      const y = height - 12 - ((p.p50 - minY) / rangeY) * (height - 24);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: 'block', background: T.surfaceEl, borderRadius: 10, border: `1px solid ${T.border}` }}>
      <line x1={12} y1={height - 12} x2={width - 12} y2={height - 12} stroke={T.border} strokeWidth="1" />
      <line x1={12} y1={12} x2={12} y2={height - 12} stroke={T.border} strokeWidth="1" />
      <polyline fill="none" stroke={T.primary} strokeWidth="2.5" points={points} />
    </svg>
  );
}

export function AssistedSimulationPage() {
  const [questionMode, setQuestionMode] = useState<AssistedQuestionMode>('max_spending');
  const [portfolioSourceMode, setPortfolioSourceMode] = useState<PortfolioSourceMode>('instruments');
  const [optimizeEnabled, setOptimizeEnabled] = useState(false);
  const [simpleRvPct, setSimpleRvPct] = useState(60);
  const [showOptimization, setShowOptimization] = useState(false);
  const [showAdvancedSpending, setShowAdvancedSpending] = useState(false);
  const [optimizationObjective, setOptimizationObjective] = useState<AssistedOptimizationObjective>('max_spending');

  const [inputs, setInputs] = useState<AssistedInputs>(defaultInputs);
  const [result, setResult] = useState<AssistedOptimizationResult | null>(null);
  const [resultMode, setResultMode] = useState<AssistedQuestionMode>('max_spending');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableInstruments, setAvailableInstruments] = useState<AssistedInstrumentOption[]>(() => loadAssistedInstrumentOptions());

  useEffect(() => {
    const refresh = () => setAvailableInstruments(loadAssistedInstrumentOptions());
    window.addEventListener('midas:instrument-universe-updated', refresh as EventListener);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('midas:instrument-universe-updated', refresh as EventListener);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    const byMode: Record<AssistedQuestionMode, AssistedOptimizationObjective> = {
      max_spending: 'max_spending',
      duration: 'max_duration',
      success: 'max_success',
    };
    setOptimizationObjective(byMode[questionMode]);
  }, [questionMode]);

  const optionsById = useMemo(
    () => new Map(availableInstruments.map((item) => [item.instrumentId, item])),
    [availableInstruments],
  );

  const selectedIds = useMemo(() => new Set(selectedIdsFromEntries(inputs.portfolioEntries)), [inputs.portfolioEntries]);

  const updateInput = <K extends keyof AssistedInputs>(key: K, value: AssistedInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const toggleInstrument = (instrumentId: string) => {
    setInputs((prev) => {
      const exists = prev.portfolioEntries.some((entry) => entry.instrumentId === instrumentId);
      if (exists) {
        return {
          ...prev,
          portfolioEntries: prev.portfolioEntries.filter((entry) => entry.instrumentId !== instrumentId),
        };
      }
      return {
        ...prev,
        portfolioEntries: [
          ...prev.portfolioEntries,
          {
            instrumentId,
            amountClp: 0,
            percentage: 0,
          },
        ],
      };
    });
  };

  const updateEntry = (instrumentId: string, patch: Partial<AssistedPortfolioEntry>) => {
    setInputs((prev) => ({
      ...prev,
      portfolioEntries: prev.portfolioEntries.map((entry) =>
        entry.instrumentId === instrumentId
          ? {
              ...entry,
              ...patch,
            }
          : entry,
      ),
    }));
  };

  const portfolioAmountTotal = useMemo(
    () => inputs.portfolioEntries.reduce((sum, entry) => sum + Math.max(0, Number(entry.amountClp || 0)), 0),
    [inputs.portfolioEntries],
  );

  const portfolioPctTotal = useMemo(
    () => inputs.portfolioEntries.reduce((sum, entry) => sum + Math.max(0, Number(entry.percentage || 0)), 0),
    [inputs.portfolioEntries],
  );

  const portfolioPctStatus = useMemo(() => {
    if (portfolioPctTotal > 100.5) return { label: 'Excede 100%', color: T.negative };
    if (portfolioPctTotal < 99.5) return { label: 'Falta para 100%', color: T.warning };
    return { label: 'Suma correcta', color: T.positive };
  }, [portfolioPctTotal]);

  const selectedCount = inputs.portfolioEntries.length;
  const optimizeSelectionInvalid =
    optimizeEnabled &&
    portfolioSourceMode === 'instruments' &&
    ![0, 2, 3].includes(selectedCount);
  const previewEffectiveCapitalClp = portfolioSourceMode === 'instruments' && inputs.portfolioEntryMode === 'amount' && portfolioAmountTotal > 0
    ? portfolioAmountTotal
    : inputs.initialCapitalClp;
  const capitalGapClp = portfolioAmountTotal - inputs.initialCapitalClp;
  const hasCapitalGap = portfolioSourceMode === 'instruments' && inputs.portfolioEntryMode === 'amount' && inputs.portfolioEntries.length > 0 && Math.abs(capitalGapClp) > 1;
  const durationTechnicalHorizonYears = Math.max(40, Number(inputs.horizonYears) || 40);

  const buildRuntimeContext = (): { runtimeInputs: AssistedInputs; runtimeInstruments: AssistedInstrumentOption[] } => {
    const runtimeInputs: AssistedInputs = {
      ...inputs,
      horizonYears: clamp(Number(inputs.horizonYears) || 30, 4, 60),
      nSim: Math.max(200, Number(inputs.nSim) || 1000),
      seed: Math.max(1, Math.round(Number(inputs.seed) || 42)),
      successThreshold: clamp(Number(inputs.successThreshold) || 0.85, 0.5, 0.99),
      gridStepPct: clamp(Number(inputs.gridStepPct) || 5, 5, 25),
      portfolioMode: optimizeEnabled ? 'optimize' : 'manual',
      optimizationObjective,
    };

    let runtimeInstruments = [...availableInstruments];

    if (portfolioSourceMode === 'simple') {
      const simple = buildSimpleInstruments();
      runtimeInstruments = [...runtimeInstruments, ...simple];
      if (runtimeInputs.portfolioMode === 'optimize') {
        runtimeInputs.portfolioEntries = [];
      } else {
        runtimeInputs.portfolioEntryMode = 'percentage';
        runtimeInputs.portfolioEntries = [
          { instrumentId: SIMPLE_RV_ID, amountClp: 0, percentage: clamp(simpleRvPct, 0, 100) },
          { instrumentId: SIMPLE_RF_ID, amountClp: 0, percentage: clamp(100 - simpleRvPct, 0, 100) },
        ];
      }
    }

    if (questionMode === 'max_spending') {
      const fixed = Math.max(1, Number(runtimeInputs.fixedMonthlyClp) || 1_000_000);
      runtimeInputs.fixedMonthlyClp = fixed;
      runtimeInputs.phase1MonthlyClp = Math.max(1, Number(runtimeInputs.phase1MonthlyClp) || fixed);
      runtimeInputs.phase2MonthlyClp = Math.max(1, Number(runtimeInputs.phase2MonthlyClp) || fixed);
      return { runtimeInputs, runtimeInstruments };
    }

    if (questionMode === 'duration') {
      runtimeInputs.horizonYears = clamp(durationTechnicalHorizonYears, 12, 60);
    }

    if (!optimizeEnabled) runtimeInputs.portfolioMode = 'manual';
    if (runtimeInputs.spendingMode === 'fixed') {
      runtimeInputs.fixedMonthlyClp = Math.max(1, Number(runtimeInputs.fixedMonthlyClp) || 0);
      runtimeInputs.phase1MonthlyClp = runtimeInputs.fixedMonthlyClp;
      runtimeInputs.phase2MonthlyClp = runtimeInputs.fixedMonthlyClp;
    } else {
      runtimeInputs.phase1MonthlyClp = Math.max(1, Number(runtimeInputs.phase1MonthlyClp) || 0);
      runtimeInputs.phase2MonthlyClp = Math.max(1, Number(runtimeInputs.phase2MonthlyClp) || 0);
    }

    return { runtimeInputs, runtimeInstruments };
  };

  const run = () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { runtimeInputs, runtimeInstruments } = buildRuntimeContext();
      const output = runAssistedSimulation(runtimeInputs, runtimeInstruments);
      setResult(output);
      setResultMode(questionMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const resultTitle = result?.hasFeasibleSolution
    ? 'Resultado principal'
    : 'Mejor esfuerzo fuera de umbral';

  const duration = useMemo(
    () => (result ? estimateDuration(result.best, result.horizonYears) : null),
    [result],
  );

  const summaryText = useMemo(() => {
    if (!result) return '';
    if (resultMode === 'max_spending') {
      if (!result.hasFeasibleSolution) {
        return `No hay solucion factible al umbral ${formatPct(result.successThreshold)} para el horizonte de ${result.horizonYears} anos.`;
      }
      return `Con ${formatMoney(result.effectiveInitialCapitalClp)} y horizonte ${result.horizonYears} anos, el retiro mensual sostenible estimado es ${formatMoney(result.best.sustainableMonthlyClp)}.`;
    }
    if (resultMode === 'duration' && duration) {
      if (duration.censoredP50) {
        return `Con el gasto configurado, el capital no se agota dentro del horizonte maximo analizado (${result.horizonYears} anos).`;
      }
      return `Con el gasto configurado, la duracion central estimada es ${formatDuration(duration.p50, duration.censoredP50)}.`;
    }
    return `Con los supuestos actuales, la probabilidad de exito al horizonte de ${result.horizonYears} anos es ${formatPct(result.best.successAtHorizon)}.`;
  }, [result, resultMode, duration]);

  const runButtonLabel = useMemo(() => {
    if (questionMode === 'max_spending') {
      return optimizeEnabled ? 'Calcular gasto mensual maximo' : 'Calcular gasto mensual maximo';
    }
    if (questionMode === 'duration') return 'Calcular duracion del capital';
    return 'Calcular probabilidad de exito';
  }, [questionMode, optimizeEnabled]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
        <div style={{ color: T.textPrimary, fontWeight: 800, fontSize: 18 }}>Simulacion Asistida</div>
        <div style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>
          Hoja independiente de Simulacion. Entrada con mix simple o instrumentos reales del Universe y proyeccion con motor M8 agregado.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {modeCards.map((card) => {
          const active = questionMode === card.mode;
          return (
            <button
              key={card.mode}
              type="button"
              onClick={() => setQuestionMode(card.mode)}
              style={{
                textAlign: 'left',
                borderRadius: 12,
                border: `1px solid ${active ? T.primary : T.border}`,
                background: active ? 'rgba(59,130,246,0.16)' : T.surface,
                padding: '12px 14px',
                cursor: 'pointer',
              }}
            >
              <div style={{ color: T.textPrimary, fontWeight: 800, fontSize: 14 }}>{card.title}</div>
              <div style={{ color: T.textMuted, fontSize: 12 }}>{card.subtitle}</div>
            </button>
          );
        })}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Supuestos base</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Capital inicial (MM CLP)
            <input
              type="number"
              min={0}
              step={1}
              value={clpToMm(inputs.initialCapitalClp)}
              onChange={(e) => updateInput('initialCapitalClp', mmToClp(Number(e.target.value) || 0))}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
            />
            <span style={{ color: T.textMuted }}>{formatMoney(inputs.initialCapitalClp)}</span>
          </label>

          {questionMode !== 'duration' ? (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Horizonte (anos)
              <input
                type="number"
                min={4}
                max={60}
                value={inputs.horizonYears}
                onChange={(e) => updateInput('horizonYears', Number(e.target.value) || 30)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
          ) : (
            <div style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Duracion del capital
              <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSecondary, padding: '8px 10px' }}>
                Se estima sobre un horizonte tecnico interno para evitar truncar la duracion real.
              </div>
            </div>
          )}
        </div>

        {questionMode === 'max_spending' && (
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Umbral minimo de exito
            <input
              type="number"
              min={0.5}
              max={0.99}
              step={0.01}
              value={inputs.successThreshold}
              onChange={(e) => updateInput('successThreshold', Number(e.target.value) || 0.85)}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
            />
          </label>
        )}

        {(questionMode === 'success' || questionMode === 'duration') && inputs.spendingMode === 'fixed' && (
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Retiro mensual (MM CLP)
            <input
              type="number"
              min={0}
              step={0.1}
              value={clpToMm(inputs.fixedMonthlyClp)}
              onChange={(e) => {
                const value = mmToClp(Number(e.target.value) || 0);
                updateInput('fixedMonthlyClp', value);
                updateInput('phase1MonthlyClp', value);
                updateInput('phase2MonthlyClp', value);
              }}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
            />
            <span style={{ color: T.textMuted }}>{formatMoney(inputs.fixedMonthlyClp)}</span>
          </label>
        )}

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: T.textPrimary, fontSize: 12 }}>
          <input type="checkbox" checked={inputs.extraContributionEnabled} onChange={(e) => updateInput('extraContributionEnabled', e.target.checked)} />
          Incluir aporte unico adicional
        </label>

        {inputs.extraContributionEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Aporte (MM CLP)
              <input
                type="number"
                min={0}
                step={1}
                value={clpToMm(inputs.extraContributionClp)}
                onChange={(e) => updateInput('extraContributionClp', mmToClp(Number(e.target.value) || 0))}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Ano aporte
              <input
                type="number"
                min={0}
                max={40}
                value={inputs.extraContributionYear}
                onChange={(e) => updateInput('extraContributionYear', Number(e.target.value) || 0)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Portafolio</div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ color: T.textPrimary, fontSize: 12 }}>
            <input type="radio" checked={portfolioSourceMode === 'simple'} onChange={() => setPortfolioSourceMode('simple')} /> Mix simple RF/RV
          </label>
          <label style={{ color: T.textPrimary, fontSize: 12 }}>
            <input type="radio" checked={portfolioSourceMode === 'instruments'} onChange={() => setPortfolioSourceMode('instruments')} /> Instrumentos reales
          </label>
        </div>

        {portfolioSourceMode === 'simple' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              RV objetivo (%)
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={simpleRvPct}
                onChange={(e) => setSimpleRvPct(clamp(Number(e.target.value) || 0, 0, 100))}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
            <div style={{ color: T.textMuted, fontSize: 12 }}>Asignacion simple: RV {simpleRvPct.toFixed(0)}% · RF {(100 - simpleRvPct).toFixed(0)}%</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ color: T.textPrimary, fontSize: 12 }}>
                <input
                  type="radio"
                  checked={inputs.portfolioEntryMode === 'amount'}
                  onChange={() => updateInput('portfolioEntryMode', 'amount')}
                />
                Monto por instrumento
              </label>
              <label style={{ color: T.textPrimary, fontSize: 12 }}>
                <input
                  type="radio"
                  checked={inputs.portfolioEntryMode === 'percentage'}
                  onChange={() => updateInput('portfolioEntryMode', 'percentage')}
                />
                Porcentaje por instrumento
              </label>
            </div>

            {availableInstruments.length === 0 ? (
              <div style={{ color: T.textMuted, fontSize: 12 }}>
                No hay instrumentos disponibles en `instrument-universe`. Carga el JSON en Ajustes para construir portafolio en Asistida.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflow: 'auto', paddingRight: 4 }}>
                {availableInstruments.map((instrument) => (
                  <label key={instrument.instrumentId} style={{ color: T.textPrimary, fontSize: 12, display: 'grid', gap: 3 }}>
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(instrument.instrumentId)}
                        onChange={() => toggleInstrument(instrument.instrumentId)}
                      />{' '}
                      {instrument.label}
                    </span>
                    <span style={{ color: T.textMuted, fontSize: 11 }}>
                      Peso ref: {(instrument.weightPortfolio * 100).toFixed(1)}% · Monto ref: {formatMoney(instrument.amountClp)}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {inputs.portfolioEntries.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                {inputs.portfolioEntries.map((entry) => {
                  const instrument = optionsById.get(entry.instrumentId);
                  if (!instrument) return null;
                  return (
                    <div key={entry.instrumentId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 8, alignItems: 'center' }}>
                      <div style={{ color: T.textPrimary, fontSize: 12 }}>{instrument.name}</div>
                      {inputs.portfolioEntryMode === 'amount' ? (
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={clpToMm(entry.amountClp)}
                          onChange={(e) => updateEntry(entry.instrumentId, { amountClp: mmToClp(Number(e.target.value) || 0) })}
                          placeholder="Monto MM CLP"
                          style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                        />
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={entry.percentage}
                          onChange={(e) => updateEntry(entry.instrumentId, { percentage: Number(e.target.value) || 0 })}
                          placeholder="%"
                          style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                        />
                      )}
                    </div>
                  );
                })}
                <div style={{ color: T.textMuted, fontSize: 12 }}>
                  {inputs.portfolioEntryMode === 'amount'
                    ? `Total portafolio ingresado: ${formatMoney(portfolioAmountTotal)}`
                    : `Suma porcentajes: ${portfolioPctTotal.toFixed(1)}%`}
                </div>
                {inputs.portfolioEntryMode === 'amount' && (
                  <div style={{ color: T.textMuted, fontSize: 12 }}>
                    Capital ingresado: {formatMoney(inputs.initialCapitalClp)} · Capital efectivo simulado: {formatMoney(previewEffectiveCapitalClp)}
                  </div>
                )}
                {hasCapitalGap && (
                  <div style={{ color: T.warning, fontSize: 12 }}>
                    Aviso: la suma de instrumentos difiere del capital ingresado por {formatMoney(capitalGapClp)}. En modo monto, se usa la suma de instrumentos como capital efectivo.
                  </div>
                )}
                {hasCapitalGap && (
                  <button
                    type="button"
                    onClick={() => updateInput('initialCapitalClp', portfolioAmountTotal)}
                    style={{ justifySelf: 'start', background: T.surfaceEl, border: `1px solid ${T.border}`, color: T.textPrimary, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                  >
                    Sincronizar capital ingresado con instrumentos
                  </button>
                )}
                {inputs.portfolioEntryMode === 'percentage' && (
                  <div style={{ color: portfolioPctStatus.color, fontSize: 12, fontWeight: 700 }}>
                    Estado suma %: {portfolioPctStatus.label}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <details
        open={showOptimization}
        onToggle={(e) => setShowOptimization((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}
      >
        <summary style={{ color: T.textPrimary, fontWeight: 700, cursor: 'pointer' }}>Explorar mejor combinacion (opcional)</summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <label style={{ color: T.textPrimary, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={optimizeEnabled}
              onChange={(e) => setOptimizeEnabled(e.target.checked)}
            />{' '}
            Explorar combinaciones automaticamente
          </label>

          {optimizeEnabled && (
            <>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Objetivo de optimizacion
                <select
                  value={optimizationObjective}
                  onChange={(e) => setOptimizationObjective(e.target.value as AssistedOptimizationObjective)}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                >
                  <option value="max_spending">Maximizar gasto mensual</option>
                  <option value="max_duration">Maximizar duracion del capital</option>
                  <option value="max_success">Maximizar probabilidad de exito</option>
                </select>
              </label>
              {portfolioSourceMode === 'instruments' && inputs.portfolioEntries.length === 3 && (
                <label style={{ color: T.textPrimary, fontSize: 12 }}>
                  <input type="checkbox" checked={inputs.includeTwoOfThreeCheck} onChange={(e) => updateInput('includeTwoOfThreeCheck', e.target.checked)} /> Evaluar tambien mejor combinacion 2-de-3
                </label>
              )}
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Paso de grilla (%)
                <input
                  type="number"
                  min={5}
                  max={25}
                  step={5}
                  value={inputs.gridStepPct}
                  onChange={(e) => updateInput('gridStepPct', Number(e.target.value) || 5)}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              nSim
              <input
                type="number"
                min={200}
                max={5000}
                step={100}
                value={inputs.nSim}
                onChange={(e) => updateInput('nSim', Number(e.target.value) || 1000)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Seed
              <input
                type="number"
                min={1}
                max={999999}
                step={1}
                value={inputs.seed}
                onChange={(e) => updateInput('seed', Number(e.target.value) || 42)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
          </div>
        </div>
      </details>

      <details
        open={showAdvancedSpending}
        onToggle={(e) => setShowAdvancedSpending((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}
      >
        <summary style={{ color: T.textPrimary, fontWeight: 700, cursor: 'pointer' }}>Gasto en dos fases (avanzado)</summary>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {questionMode === 'duration' && (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Horizonte tecnico maximo para estimar duracion (anos)
              <input
                type="number"
                min={12}
                max={60}
                value={inputs.horizonYears}
                onChange={(e) => updateInput('horizonYears', Number(e.target.value) || 40)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ color: T.textPrimary, fontSize: 12 }}>
              <input type="radio" checked={inputs.spendingMode === 'fixed'} onChange={() => updateInput('spendingMode', 'fixed')} /> Gasto fijo
            </label>
            <label style={{ color: T.textPrimary, fontSize: 12 }}>
              <input type="radio" checked={inputs.spendingMode === 'two_phase'} onChange={() => updateInput('spendingMode', 'two_phase')} /> Dos fases
            </label>
          </div>

          {inputs.spendingMode === 'fixed' ? (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Gasto mensual fijo (MM CLP)
              <input
                type="number"
                min={0}
                step={0.1}
                value={clpToMm(inputs.fixedMonthlyClp)}
                onChange={(e) => {
                  const amount = mmToClp(Number(e.target.value) || 0);
                  updateInput('fixedMonthlyClp', amount);
                  updateInput('phase1MonthlyClp', amount);
                  updateInput('phase2MonthlyClp', amount);
                }}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Fase 1 mensual (MM CLP)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clpToMm(inputs.phase1MonthlyClp)}
                  onChange={(e) => updateInput('phase1MonthlyClp', mmToClp(Number(e.target.value) || 0))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Fase 1 anos
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={inputs.phase1Years}
                  onChange={(e) => updateInput('phase1Years', Number(e.target.value) || 1)}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Fase 2 mensual (MM CLP)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clpToMm(inputs.phase2MonthlyClp)}
                  onChange={(e) => updateInput('phase2MonthlyClp', mmToClp(Number(e.target.value) || 0))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 8, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
            </div>
          )}
        </div>
      </details>

      <button
        type="button"
        onClick={run}
        disabled={running || optimizeSelectionInvalid}
        style={{
          background: T.primary,
          color: '#fff',
          border: 'none',
          borderRadius: 9,
          padding: '11px 14px',
          fontWeight: 800,
          cursor: running ? 'not-allowed' : 'pointer',
          opacity: running ? 0.7 : 1,
        }}
      >
        {running ? 'Calculando...' : runButtonLabel}
      </button>

      {optimizeSelectionInvalid && (
        <div style={{ color: T.negative, fontSize: 12 }}>
          En exploracion automatica con instrumentos reales debes seleccionar 0, 2 o 3 instrumentos.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(255,80,80,0.15)', border: `1px solid ${T.negative}`, borderRadius: 12, padding: 12, color: T.textPrimary, fontSize: 12 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ color: T.textMuted, fontSize: 11 }}>{resultTitle}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {resultMode === 'max_spending' && (
              <>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>
                    {result.hasFeasibleSolution ? 'Gasto mensual maximo estimado' : 'Estado de factibilidad'}
                  </div>
                  <div style={{ color: T.primary, fontSize: 18, fontWeight: 900 }}>
                    {result.hasFeasibleSolution ? formatMoney(result.best.sustainableMonthlyClp) : 'Sin solucion factible'}
                  </div>
                </div>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Exito al horizonte</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatPct(result.best.successAtHorizon)}</div>
                </div>
              </>
            )}

            {resultMode === 'duration' && duration && (
              <>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Duracion estimada P50</div>
                  <div style={{ color: T.primary, fontSize: 18, fontWeight: 900 }}>{formatDuration(duration.p50, duration.censoredP50)}</div>
                </div>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Duracion P10 / P90</div>
                  <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>
                    {formatDuration(duration.p10, duration.censoredP10)} · {formatDuration(duration.p90, duration.censoredP90)}
                  </div>
                </div>
              </>
            )}

            {resultMode === 'success' && (
              <>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Probabilidad de exito</div>
                  <div style={{ color: T.primary, fontSize: 18, fontWeight: 900 }}>{formatPct(result.best.successAtHorizon)}</div>
                </div>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Retiro mensual usado</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.equivalentMonthlyClp)}</div>
                </div>
              </>
            )}

            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P10</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p10)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P50</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p50)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P90</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p90)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Mix recomendado</div>
              <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{mixLabel(result.best.weights)}</div>
            </div>
          </div>

          {!result.hasFeasibleSolution && resultMode === 'max_spending' && (
            <div style={{ background: 'rgba(245,158,11,0.12)', border: `1px solid ${T.warning}`, borderRadius: 10, padding: 10, color: T.textPrimary, fontSize: 12 }}>
              Ninguna combinacion cumplio el umbral de exito {formatPct(result.successThreshold)} al horizonte de {result.horizonYears} anos.
              Referencia tecnica (best effort): {formatMoney(result.best.sustainableMonthlyClp)}.
            </div>
          )}

          <div style={{ color: T.textSecondary, fontSize: 12 }}>{summaryText}</div>

          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Capital ingresado: {formatMoney(result.inputCapitalClp)} · Suma instrumentos: {formatMoney(result.portfolioAmountTotalClp)} · Capital efectivo usado: {formatMoney(result.effectiveInitialCapitalClp)}
          </div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Entrada: {result.entryMode === 'amount' ? 'Monto' : 'Porcentaje'} · Horizonte usado: {result.horizonYears} anos · Candidatos evaluados: {result.evaluatedCandidates}
          </div>

          <MiniFanChart data={(result.best.fanChartData ?? []).map((p) => ({ year: p.year, p50: p.p50 }))} />

          {result.bestTwoOfThree && result.bestThreeInstruments && (
            <div style={{ color: T.textPrimary, fontSize: 12, background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              Mejor 3 instrumentos: {formatMoney(result.bestThreeInstruments.equivalentMonthlyClp)} · Mejor 2-de-3: {formatMoney(result.bestTwoOfThree.equivalentMonthlyClp)}.
              {' '}
              {result.bestTwoOfThree.equivalentMonthlyClp > result.bestThreeInstruments.equivalentMonthlyClp
                ? 'La alternativa 2-de-3 es superior en este escenario.'
                : 'La combinacion de 3 instrumentos mantiene ventaja o empate.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
