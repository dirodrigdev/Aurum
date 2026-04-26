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
type ProfileId = 'me_current' | 'me_scenario' | 'parents' | 'brother' | 'custom';

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
const DURATION_TECHNICAL_HORIZON = 60;

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
  optimizationObjective: 'max_spending',
  successThreshold: 0.85,
  gridStepPct: 5,
  nSim: 1000,
  seed: 42,
};

const modeCards: Array<{ mode: AssistedQuestionMode; title: string; subtitle: string; icon: string }> = [
  {
    mode: 'max_spending',
    title: 'Cuánto puedo gastar',
    subtitle: 'Encuentra el retiro mensual sostenible.',
    icon: '¤',
  },
  {
    mode: 'duration',
    title: 'Cuántos años dura',
    subtitle: 'Estima duración con 85/90/95% de confianza.',
    icon: '⌛',
  },
  {
    mode: 'success',
    title: 'Probabilidad de éxito',
    subtitle: 'Mide chance de llegar al horizonte.',
    icon: '%',
  },
];

const profileConfigs: Record<ProfileId, {
  title: string;
  subtitle: string;
  capitalMm: number;
  spendingMm: number;
  horizonYears: number;
  editable: boolean;
  disabled?: boolean;
}> = {
  me_current: {
    title: 'Yo actual',
    subtitle: 'Importación desde Simulación pendiente',
    capitalMm: 0,
    spendingMm: 0,
    horizonYears: 20,
    editable: false,
    disabled: true,
  },
  me_scenario: {
    title: 'Yo escenario',
    subtitle: 'Sandbox editable para probar supuestos',
    capitalMm: 80,
    spendingMm: 0.6,
    horizonYears: 25,
    editable: true,
  },
  parents: {
    title: 'Papás',
    subtitle: 'Perfil sugerido familiar',
    capitalMm: 237,
    spendingMm: 1.4,
    horizonYears: 20,
    editable: true,
  },
  brother: {
    title: 'Hermano',
    subtitle: 'Perfil sugerido ahorro activo',
    capitalMm: 120,
    spendingMm: 0.8,
    horizonYears: 15,
    editable: true,
  },
  custom: {
    title: 'Personalizado',
    subtitle: 'Sin precarga, editable total',
    capitalMm: 0,
    spendingMm: 0,
    horizonYears: 20,
    editable: true,
  },
};

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
const clpToMmInput = (valueClp: number, decimals = 1): number => Number(clpToMm(valueClp).toFixed(decimals));
const formatMm = (valueClp: number): string => `${clpToMm(valueClp).toFixed(1)} MM`;
const DECIMAL_INPUT_PATTERN = /^\d*(?:[.,]\d*)?$/;
const INTEGER_INPUT_PATTERN = /^\d*$/;

const parseDecimalInput = (raw: string): number | null => {
  const sanitized = (raw ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!sanitized || sanitized === '.') return null;
  const normalized = sanitized.startsWith('.') ? `0${sanitized}` : sanitized;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseIntegerInput = (raw: string): number | null => {
  const sanitized = (raw ?? '').trim().replace(/\s+/g, '');
  if (!sanitized) return null;
  const parsed = Number.parseInt(sanitized, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDuration = (years: number, censored: boolean): string => {
  if (!Number.isFinite(years)) return '--';
  return censored ? `Más de ${Math.round(years)} años` : `${years.toFixed(1)} años`;
};

const ASSISTED_COCKPIT = {
  accent: '#B87333',
  accentSoft: 'rgba(184,115,51,0.16)',
  accentGlow: 'rgba(184,115,51,0.10)',
  shell: '#121417',
  panel: '#1A1C1E',
  panelSoft: '#15171A',
  border: 'rgba(255,255,255,0.10)',
  borderSoft: 'rgba(255,255,255,0.06)',
};

const solveRequiredAnnualReturn = (
  capitalClp: number,
  monthlySpendClp: number,
  horizonYears: number,
): number | null => {
  const capital = Math.max(0, Number(capitalClp || 0));
  const spend = Math.max(0, Number(monthlySpendClp || 0));
  const months = Math.max(1, Math.round(Number(horizonYears || 0) * 12));
  if (capital <= 0 || spend <= 0 || months <= 0) return null;

  const pvAtMonthlyRate = (r: number): number => {
    if (Math.abs(r) < 1e-9) return spend * months;
    return spend * (1 - (1 + r) ** (-months)) / r;
  };

  const low = -0.99;
  const high = 0.5;
  const fLow = pvAtMonthlyRate(low) - capital;
  const fHigh = pvAtMonthlyRate(high) - capital;
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return null;

  let a = low;
  let b = high;
  let fa = fLow;
  for (let i = 0; i < 80; i += 1) {
    const mid = (a + b) / 2;
    const fMid = pvAtMonthlyRate(mid) - capital;
    if (Math.abs(fMid) < 1e-9) {
      a = mid;
      b = mid;
      break;
    }
    if ((fa < 0 && fMid < 0) || (fa > 0 && fMid > 0)) {
      a = mid;
      fa = fMid;
    } else {
      b = mid;
    }
  }
  const monthly = (a + b) / 2;
  return (1 + monthly) ** 12 - 1;
};

const solveRequiredAnnualReturnForCashflows = (
  capitalClp: number,
  monthlyCashflowsClp: number[],
): number | null => {
  const capital = Math.max(0, Number(capitalClp || 0));
  const flows = monthlyCashflowsClp
    .map((value) => Math.max(0, Number(value || 0)))
    .filter((value) => Number.isFinite(value));
  if (capital <= 0 || flows.length === 0) return null;

  const terminalBalanceAtMonthlyRate = (r: number): number => {
    let balance = capital;
    for (const flow of flows) {
      balance = (balance * (1 + r)) - flow;
      if (!Number.isFinite(balance)) return Number.NaN;
    }
    return balance;
  };

  const low = -0.99;
  const high = 0.5;
  const fLow = terminalBalanceAtMonthlyRate(low);
  const fHigh = terminalBalanceAtMonthlyRate(high);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return null;

  let a = low;
  let b = high;
  let fa = fLow;
  for (let i = 0; i < 90; i += 1) {
    const mid = (a + b) / 2;
    const fMid = terminalBalanceAtMonthlyRate(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-8) {
      a = mid;
      b = mid;
      break;
    }
    if ((fa < 0 && fMid < 0) || (fa > 0 && fMid > 0)) {
      a = mid;
      fa = fMid;
    } else {
      b = mid;
    }
  }
  const monthly = (a + b) / 2;
  return (1 + monthly) ** 12 - 1;
};

const selectedIdsFromEntries = (entries: AssistedPortfolioEntry[]) => entries.map((entry) => entry.instrumentId);

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

const estimateDuration = (row: AssistedOptimizationResult['best'], horizonYears: number): DurationEstimate => {
  const points = [...(row.fanChartData ?? [])].sort((a, b) => a.year - b.year);
  const firstNonPositive = (key: 'p10' | 'p50' | 'p90'): number | null => {
    for (const point of points) {
      if ((point[key] ?? Number.NaN) <= 0) return point.year;
    }
    return null;
  };
  const p10Hit = firstNonPositive('p10');
  const p50Hit = firstNonPositive('p50');
  const p90Hit = firstNonPositive('p90');
  return {
    p10: p10Hit ?? horizonYears,
    p50: p50Hit ?? horizonYears,
    p90: p90Hit ?? horizonYears,
    censoredP10: p10Hit === null,
    censoredP50: p50Hit === null,
    censoredP90: p90Hit === null,
  };
};

const buildProfileInstrumentEntries = (
  instruments: AssistedInstrumentOption[],
  totalCapitalClp: number,
): AssistedPortfolioEntry[] => {
  const usable = instruments
    .filter((item) => !item.instrumentId.startsWith('__assisted_simple_'))
    .slice()
    .sort((a, b) => b.weightPortfolio - a.weightPortfolio)
    .slice(0, 3);
  if (usable.length === 0) return [];
  const sumWeights = usable.reduce((sum, item) => sum + Math.max(0, item.weightPortfolio), 0);
  return usable.map((item, index) => {
    const normalized = sumWeights > 0 ? Math.max(0, item.weightPortfolio) / sumWeights : 1 / usable.length;
    const amount = index === usable.length - 1
      ? Math.max(0, totalCapitalClp - usable.slice(0, -1).reduce((acc, prev) => {
          const prevNorm = sumWeights > 0 ? Math.max(0, prev.weightPortfolio) / sumWeights : 1 / usable.length;
          return acc + Math.round(totalCapitalClp * prevNorm);
        }, 0))
      : Math.round(totalCapitalClp * normalized);
    return {
      instrumentId: item.instrumentId,
      amountClp: amount,
      percentage: 0,
    };
  });
};

const buildParentsConservativeEntries = (
  instruments: AssistedInstrumentOption[],
): AssistedPortfolioEntry[] | null => {
  const byContains = (token: string): AssistedInstrumentOption | undefined =>
    instruments.find((item) => item.name.toLowerCase().includes(token.toLowerCase()));

  const conservadora = byContains('btg pactual gestión conservadora');
  const activa = byContains('btg pactual gestión activa');
  const suraUf = byContains('sura renta local uf');
  if (!conservadora || !activa || !suraUf) return null;

  return [
    { instrumentId: activa.instrumentId, amountClp: mmToClp(72), percentage: 0 },
    { instrumentId: conservadora.instrumentId, amountClp: mmToClp(42), percentage: 0 },
    { instrumentId: suraUf.instrumentId, amountClp: mmToClp(22), percentage: 0 },
  ];
};

const redistributeEntriesToCapital = (
  entries: AssistedPortfolioEntry[],
  totalCapitalClp: number,
): AssistedPortfolioEntry[] => {
  const target = Math.max(0, Math.round(totalCapitalClp));
  if (entries.length === 0) return entries;
  const current = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.amountClp || 0)), 0);
  if (current <= 0) {
    const even = Math.floor(target / entries.length);
    return entries.map((entry, idx) => ({
      ...entry,
      amountClp: idx === entries.length - 1 ? Math.max(0, target - even * (entries.length - 1)) : even,
    }));
  }

  let assigned = 0;
  return entries.map((entry, idx) => {
    if (idx === entries.length - 1) {
      return { ...entry, amountClp: Math.max(0, target - assigned) };
    }
    const weight = Math.max(0, Number(entry.amountClp || 0)) / current;
    const amount = Math.max(0, Math.round(target * weight));
    assigned += amount;
    return { ...entry, amountClp: amount };
  });
};

const redistributeEntriesToPercentage = (
  entries: AssistedPortfolioEntry[],
): AssistedPortfolioEntry[] => {
  if (entries.length === 0) return entries;
  const total = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.percentage || 0)), 0);
  if (total <= 0) {
    const even = Number((100 / entries.length).toFixed(1));
    return entries.map((entry, idx) => ({
      ...entry,
      percentage: idx === entries.length - 1 ? Number((100 - even * (entries.length - 1)).toFixed(1)) : even,
    }));
  }
  let assigned = 0;
  return entries.map((entry, idx) => {
    if (idx === entries.length - 1) {
      return { ...entry, percentage: Number(Math.max(0, 100 - assigned).toFixed(1)) };
    }
    const pct = Number((((Math.max(0, Number(entry.percentage || 0)) / total) * 100)).toFixed(1));
    assigned += pct;
    return { ...entry, percentage: pct };
  });
};

const statusLabelForResult = (
  mode: AssistedQuestionMode,
  result: AssistedOptimizationResult,
): { label: string; color: string } => {
  if (mode === 'max_spending') {
    if (!result.hasFeasibleSolution) return { label: 'Exigente', color: ASSISTED_COCKPIT.accent };
    if (result.best.successAtHorizon >= 0.85) return { label: 'Alto', color: T.positive };
    if (result.best.successAtHorizon >= 0.65) return { label: 'Medio', color: T.warning };
    return { label: 'Bajo', color: T.negative };
  }
  if (mode === 'duration') {
    const years = result.best.durationMetrics?.success85.years ?? result.best.rawResult.ruinTimingMedian ?? 0;
    if (years >= 25) return { label: 'Alto', color: T.positive };
    if (years >= 12) return { label: 'Medio', color: T.warning };
    return { label: 'Bajo', color: T.negative };
  }
  if (result.best.successAtHorizon >= 0.8) return { label: 'Alto', color: T.positive };
  if (result.best.successAtHorizon >= 0.6) return { label: 'Medio', color: T.warning };
  return { label: 'Bajo', color: T.negative };
};

function MiniFanChart({
  data,
  height = 200,
}: {
  data: Array<{ year: number; p10?: number; p50: number; p90?: number }>;
  height?: number;
}) {
  const width = 640;
  if (!data || data.length < 2) {
    return <div style={{ color: T.textMuted, fontSize: 12 }}>Sin trayectoria suficiente para graficar.</div>;
  }
  const xs = data.map((p) => p.year);
  const ys = data.flatMap((p) => [p.p10 ?? p.p50, p.p50, p.p90 ?? p.p50]).filter((v) => Number.isFinite(v));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(1e-9, maxX - minX);
  const rangeY = Math.max(1e-9, maxY - minY);
  const xOf = (x: number) => ((x - minX) / rangeX) * (width - 56) + 40;
  const yOf = (y: number) => height - 22 - ((y - minY) / rangeY) * (height - 44);

  const p50Polyline = data.map((p) => `${xOf(p.year)},${yOf(p.p50)}`).join(' ');
  const p90Points = data.map((p) => `${xOf(p.year)},${yOf(p.p90 ?? p.p50)}`);
  const p10Points = data.slice().reverse().map((p) => `${xOf(p.year)},${yOf(p.p10 ?? p.p50)}`);
  const bandPath = `${p90Points.concat(p10Points).join(' ')} `;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      style={{ display: 'block', background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 14, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}` }}
    >
      <line x1={40} y1={height - 22} x2={width - 12} y2={height - 22} stroke={ASSISTED_COCKPIT.borderSoft} strokeWidth="1" />
      <line x1={40} y1={16} x2={40} y2={height - 22} stroke={ASSISTED_COCKPIT.borderSoft} strokeWidth="1" />
      <polygon points={bandPath} fill="rgba(184,115,51,0.12)" />
      <polyline fill="none" stroke={ASSISTED_COCKPIT.accent} strokeWidth="2.8" points={p50Polyline} />
      <text x={44} y={20} fill={T.textMuted} fontSize="10">P90</text>
      <text x={44} y={height - 28} fill={T.textMuted} fontSize="10">P10</text>
      <text x={width - 56} y={height - 8} fill={T.textMuted} fontSize="10">años</text>
      <text x={width - 148} y={18} fill={ASSISTED_COCKPIT.accent} fontSize="10">P50</text>
    </svg>
  );
}

export function AssistedSimulationPage() {
  type ExcludedInstrumentEntry = {
    instrumentId: string;
    amountClp: number;
    percentage: number;
  };

  type AssistedScenarioSnapshot = {
    profileId: ProfileId;
    portfolioSourceMode: PortfolioSourceMode;
    simpleRvPct: number;
    autoAdjustInstrumentAmounts: boolean;
    optimizeEnabled: boolean;
    bucketEnabled: boolean;
    bucketInstrumentId: string;
    bucketFloorMm: number;
    bucketFloorPct: number;
    inputs: AssistedInputs;
    excludedInstruments: ExcludedInstrumentEntry[];
    numericDrafts: Record<string, string>;
    numericIssues: Record<string, string>;
  };

  const [questionMode, setQuestionMode] = useState<AssistedQuestionMode>('success');
  const [activeProfile, setActiveProfile] = useState<ProfileId>('custom');
  const [portfolioSourceMode, setPortfolioSourceMode] = useState<PortfolioSourceMode>('instruments');
  const [optimizeEnabled, setOptimizeEnabled] = useState(false);
  const [simpleRvPct, setSimpleRvPct] = useState(60);
  const [showOptimization, setShowOptimization] = useState(false);
  const [showAdvancedSpending, setShowAdvancedSpending] = useState(false);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [showUniversePicker, setShowUniversePicker] = useState(false);
  const [newInstrumentId, setNewInstrumentId] = useState<string>('');
  const [autoAdjustInstrumentAmounts, setAutoAdjustInstrumentAmounts] = useState(true);
  const [returnTiltMessage, setReturnTiltMessage] = useState<string | null>(null);
  const [bucketEnabled, setBucketEnabled] = useState(true);
  const [bucketInstrumentId, setBucketInstrumentId] = useState<string>('');
  const [bucketFloorMm, setBucketFloorMm] = useState(22);
  const [bucketFloorPct, setBucketFloorPct] = useState(16);
  const [bucketAutoNote, setBucketAutoNote] = useState<string | null>(null);
  const [excludedInstruments, setExcludedInstruments] = useState<ExcludedInstrumentEntry[]>([]);
  const [optimizationObjective, setOptimizationObjective] = useState<AssistedOptimizationObjective>('max_success');
  const [objectiveOverridden, setObjectiveOverridden] = useState(false);
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [numericIssues, setNumericIssues] = useState<Record<string, string>>({});
  const [baseScenarioSnapshot, setBaseScenarioSnapshot] = useState<AssistedScenarioSnapshot | null>(null);
  const [historySnapshots, setHistorySnapshots] = useState<AssistedScenarioSnapshot[]>([]);

  const [inputs, setInputs] = useState<AssistedInputs>(defaultInputs);
  const [result, setResult] = useState<AssistedOptimizationResult | null>(null);
  const [resultMode, setResultMode] = useState<AssistedQuestionMode>('success');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leversLoading, setLeversLoading] = useState(false);
  const [leversError, setLeversError] = useState<string | null>(null);
  const [leversResult, setLeversResult] = useState<{
    targetSuccess: number;
    compatibleMonthlyClp: number | null;
    requiredCapitalClp: number | null;
    horizon85Years: number | null;
    returnRequiredAnnual: number | null;
  } | null>(null);
  const [leversScenarioSignature, setLeversScenarioSignature] = useState<string | null>(null);
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
    if (objectiveOverridden) return;
    const byMode: Record<AssistedQuestionMode, AssistedOptimizationObjective> = {
      max_spending: 'max_spending',
      duration: 'max_duration',
      success: 'max_success',
    };
    setOptimizationObjective(byMode[questionMode]);
  }, [questionMode, objectiveOverridden]);

  const optionsById = useMemo(
    () => new Map(availableInstruments.map((item) => [item.instrumentId, item])),
    [availableInstruments],
  );

  const setNumericIssue = (key: string, message: string | null) => {
    setNumericIssues((prev) => {
      if (!message) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: message };
    });
  };

  const handleNumericDraftChange = (
    key: string,
    raw: string,
    mode: 'decimal' | 'integer',
  ) => {
    const compact = raw.replace(/\s+/g, '');
    const pattern = mode === 'decimal' ? DECIMAL_INPUT_PATTERN : INTEGER_INPUT_PATTERN;
    if (!pattern.test(compact)) return;
    setNumericDrafts((prev) => ({ ...prev, [key]: compact }));
    setNumericIssue(key, null);
  };

  const commitNumericDraft = ({
    key,
    mode,
    min,
    max,
    apply,
    requiredMessage,
  }: {
    key: string;
    mode: 'decimal' | 'integer';
    min?: number;
    max?: number;
    apply: (value: number) => void;
    requiredMessage: string;
  }): boolean => {
    const raw = numericDrafts[key];
    if (raw === undefined) return true;
    const parsed = mode === 'decimal' ? parseDecimalInput(raw) : parseIntegerInput(raw);
    if (parsed === null) {
      setNumericIssue(key, requiredMessage);
      return false;
    }
    let value = parsed;
    if (min !== undefined) value = Math.max(min, value);
    if (max !== undefined) value = Math.min(max, value);
    if (mode === 'integer') value = Math.round(value);
    apply(value);
    setNumericDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setNumericIssue(key, null);
    return true;
  };

  const numericDisplayValue = (
    key: string,
    committedValue: number,
    formatter?: (value: number) => string,
  ): string => {
    if (key in numericDrafts) return numericDrafts[key];
    return formatter ? formatter(committedValue) : String(committedValue);
  };

  const cloneInputs = (source: AssistedInputs): AssistedInputs => ({
    ...source,
    portfolioEntries: source.portfolioEntries.map((entry) => ({ ...entry })),
  });

  const cloneExcluded = (source: ExcludedInstrumentEntry[]): ExcludedInstrumentEntry[] =>
    source.map((entry) => ({ ...entry }));

  const createScenarioSnapshot = (): AssistedScenarioSnapshot => ({
    profileId: activeProfile,
    portfolioSourceMode,
    simpleRvPct,
    autoAdjustInstrumentAmounts,
    optimizeEnabled,
    bucketEnabled,
    bucketInstrumentId,
    bucketFloorMm,
    bucketFloorPct,
    inputs: cloneInputs(inputs),
    excludedInstruments: cloneExcluded(excludedInstruments),
    numericDrafts: { ...numericDrafts },
    numericIssues: { ...numericIssues },
  });

  const applyScenarioSnapshot = (snapshot: AssistedScenarioSnapshot) => {
    setActiveProfile(snapshot.profileId);
    setPortfolioSourceMode(snapshot.portfolioSourceMode);
    setSimpleRvPct(snapshot.simpleRvPct);
    setAutoAdjustInstrumentAmounts(snapshot.autoAdjustInstrumentAmounts);
    setOptimizeEnabled(snapshot.optimizeEnabled);
    setBucketEnabled(snapshot.bucketEnabled);
    setBucketInstrumentId(snapshot.bucketInstrumentId);
    setBucketFloorMm(snapshot.bucketFloorMm);
    setBucketFloorPct(snapshot.bucketFloorPct);
    setInputs(cloneInputs(snapshot.inputs));
    setExcludedInstruments(cloneExcluded(snapshot.excludedInstruments));
    setNumericDrafts({ ...snapshot.numericDrafts });
    setNumericIssues({ ...snapshot.numericIssues });
    setError(null);
  };

  const pushScenarioHistory = () => {
    const current = createScenarioSnapshot();
    setHistorySnapshots((prev) => [...prev.slice(-14), current]);
  };

  const scenarioComparable = (snapshot: AssistedScenarioSnapshot | null) => {
    if (!snapshot) return null;
    return JSON.stringify({
      profileId: snapshot.profileId,
      portfolioSourceMode: snapshot.portfolioSourceMode,
      simpleRvPct: Number(snapshot.simpleRvPct.toFixed(4)),
      autoAdjustInstrumentAmounts: snapshot.autoAdjustInstrumentAmounts,
      optimizeEnabled: snapshot.optimizeEnabled,
      bucketEnabled: snapshot.bucketEnabled,
      bucketInstrumentId: snapshot.bucketInstrumentId,
      bucketFloorMm: Number(snapshot.bucketFloorMm.toFixed(4)),
      bucketFloorPct: Number(snapshot.bucketFloorPct.toFixed(4)),
      inputs: snapshot.inputs,
      excludedInstruments: snapshot.excludedInstruments,
    });
  };

  const selectedIds = useMemo(() => new Set(selectedIdsFromEntries(inputs.portfolioEntries)), [inputs.portfolioEntries]);

  const selectedInstrumentRows = useMemo(
    () => inputs.portfolioEntries
      .map((entry) => ({ entry, instrument: optionsById.get(entry.instrumentId) }))
      .filter((item): item is { entry: AssistedPortfolioEntry; instrument: AssistedInstrumentOption } => !!item.instrument),
    [inputs.portfolioEntries, optionsById],
  );

  const unselectedInstruments = useMemo(
    () => availableInstruments.filter((instrument) => !selectedIds.has(instrument.instrumentId)),
    [availableInstruments, selectedIds],
  );

  const updateInput = <K extends keyof AssistedInputs>(key: K, value: AssistedInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const setQuestionModeAndResetError = (mode: AssistedQuestionMode) => {
    setQuestionMode(mode);
    setError(null);
  };

  const upsertInstrument = (instrumentId: string) => {
    if (!instrumentId) return;
    if (inputs.portfolioEntries.some((entry) => entry.instrumentId === instrumentId)) return;
    pushScenarioHistory();
    setInputs((prev) => {
      const nextEntries = [...prev.portfolioEntries, { instrumentId, amountClp: 0, percentage: 0 }];
      return {
        ...prev,
        portfolioEntries: autoAdjustInstrumentAmounts && prev.portfolioEntryMode === 'amount'
          ? redistributeEntriesToCapital(nextEntries, prev.initialCapitalClp)
          : nextEntries,
      };
    });
    setExcludedInstruments((prev) => prev.filter((entry) => entry.instrumentId !== instrumentId));
  };

  const removeInstrument = (instrumentId: string) => {
    if (bucketEnabled && instrumentId === bucketInstrumentId) {
      setReturnTiltMessage('Este instrumento sostiene el bucket defensivo. Desactiva o reasigna el bucket antes de eliminarlo.');
      return;
    }
    if (!inputs.portfolioEntries.some((entry) => entry.instrumentId === instrumentId)) return;
    pushScenarioHistory();
    setInputs((prev) => {
      const removed = prev.portfolioEntries.find((entry) => entry.instrumentId === instrumentId);
      if (removed) {
        setExcludedInstruments((list) => {
          const without = list.filter((entry) => entry.instrumentId !== instrumentId);
          return [...without, { ...removed }];
        });
      }
      const remaining = prev.portfolioEntries.filter((entry) => entry.instrumentId !== instrumentId);
      if (remaining.length === 0) {
        return { ...prev, portfolioEntries: remaining };
      }
      if (prev.portfolioEntryMode === 'amount') {
        const base = autoAdjustInstrumentAmounts
          ? redistributeEntriesToCapital(remaining, prev.initialCapitalClp)
          : remaining;
        return {
          ...prev,
          portfolioEntries: enforceBucketFloor(base, 'amount', prev.initialCapitalClp),
        };
      }
      return {
        ...prev,
        portfolioEntries: enforceBucketFloor(redistributeEntriesToPercentage(remaining), 'percentage', prev.initialCapitalClp),
      };
    });
  };

  const restoreExcludedInstrument = (instrumentId: string) => {
    const excluded = excludedInstruments.find((entry) => entry.instrumentId === instrumentId);
    if (!excluded) return;
    pushScenarioHistory();
    setInputs((prev) => {
      if (prev.portfolioEntries.some((entry) => entry.instrumentId === instrumentId)) return prev;
      const nextEntries = [...prev.portfolioEntries, { ...excluded }];
      if (prev.portfolioEntryMode === 'amount') {
        const base = autoAdjustInstrumentAmounts
          ? redistributeEntriesToCapital(nextEntries, prev.initialCapitalClp)
          : nextEntries;
        return {
          ...prev,
          portfolioEntries: enforceBucketFloor(base, 'amount', prev.initialCapitalClp),
        };
      }
      return {
        ...prev,
        portfolioEntries: enforceBucketFloor(redistributeEntriesToPercentage(nextEntries), 'percentage', prev.initialCapitalClp),
      };
    });
    setExcludedInstruments((prev) => prev.filter((entry) => entry.instrumentId !== instrumentId));
    setReturnTiltMessage('Instrumento restaurado y capital redistribuido entre posiciones activas.');
  };

  const updateEntry = (instrumentId: string, patch: Partial<AssistedPortfolioEntry>) => {
    setInputs((prev) => ({
      ...prev,
      portfolioEntries: prev.portfolioEntries.map((entry) => (
        entry.instrumentId === instrumentId ? { ...entry, ...patch } : entry
      )),
    }));
  };

  const applyProfile = (profileId: ProfileId) => {
    const profile = profileConfigs[profileId];
    if (profile.disabled) {
      setReturnTiltMessage('Yo actual todavía no está disponible para importación automática.');
      return;
    }
    setActiveProfile(profileId);
    setError(null);
    setReturnTiltMessage(null);
    setExcludedInstruments([]);
    setBucketAutoNote(null);
    setNumericDrafts({});
    setNumericIssues({});
    if (profileId === 'custom') {
      const customSnapshot: AssistedScenarioSnapshot = {
        profileId,
        portfolioSourceMode,
        simpleRvPct,
        autoAdjustInstrumentAmounts,
        optimizeEnabled: false,
        bucketEnabled,
        bucketInstrumentId,
        bucketFloorMm,
        bucketFloorPct,
        inputs: cloneInputs({
          ...inputs,
          initialCapitalClp: inputs.initialCapitalClp,
        }),
        excludedInstruments: [],
        numericDrafts: {},
        numericIssues: {},
      };
      applyScenarioSnapshot(customSnapshot);
      setBaseScenarioSnapshot(customSnapshot);
      setHistorySnapshots([]);
      return;
    }

    const capitalClp = mmToClp(profile.capitalMm);
    const spendingClp = mmToClp(profile.spendingMm);
    const useInstruments = availableInstruments.length > 0;

    const parentsPresetEntries = profileId === 'parents'
      ? buildParentsConservativeEntries(availableInstruments)
      : null;
    const shouldUseInstruments = useInstruments && (profileId !== 'parents' || !!parentsPresetEntries);

    const nextInputs: AssistedInputs = {
      ...inputs,
      initialCapitalClp: capitalClp,
      horizonYears: profile.horizonYears,
      spendingMode: 'fixed',
      fixedMonthlyClp: spendingClp,
      phase1MonthlyClp: spendingClp,
      phase2MonthlyClp: spendingClp,
      phase1Years: Math.max(4, Math.round(profile.horizonYears * 0.4)),
      portfolioEntryMode: 'amount',
      portfolioEntries: shouldUseInstruments
        ? redistributeEntriesToCapital(
            (parentsPresetEntries ?? buildProfileInstrumentEntries(availableInstruments, capitalClp)),
            capitalClp,
          )
        : [],
      extraContributionEnabled: false,
      extraContributionClp: 0,
      extraContributionYear: 5,
      portfolioMode: 'manual',
    };
    const profileSnapshot: AssistedScenarioSnapshot = {
      profileId,
      portfolioSourceMode: shouldUseInstruments ? 'instruments' : 'simple',
      simpleRvPct: profileId === 'parents' ? 35 : 55,
      autoAdjustInstrumentAmounts: true,
      optimizeEnabled: false,
      bucketEnabled,
      bucketInstrumentId,
      bucketFloorMm,
      bucketFloorPct,
      inputs: cloneInputs(nextInputs),
      excludedInstruments: [],
      numericDrafts: {},
      numericIssues: {},
    };
    applyScenarioSnapshot(profileSnapshot);
    setBaseScenarioSnapshot(profileSnapshot);
    setHistorySnapshots([]);
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
    return { label: 'Suma 100%', color: T.positive };
  }, [portfolioPctTotal]);

  const selectedCount = inputs.portfolioEntries.length;
  const optimizeSelectionInvalid = optimizeEnabled && portfolioSourceMode === 'instruments' && ![0, 2, 3].includes(selectedCount);
  const previewEffectiveCapitalClp = portfolioSourceMode === 'instruments' && inputs.portfolioEntryMode === 'amount'
    ? (
      autoAdjustInstrumentAmounts
        ? inputs.initialCapitalClp
        : (portfolioAmountTotal > 0 ? portfolioAmountTotal : inputs.initialCapitalClp)
    )
    : inputs.initialCapitalClp;
  const capitalGapClp = portfolioAmountTotal - inputs.initialCapitalClp;
  const hasCapitalGap = portfolioSourceMode === 'instruments' && inputs.portfolioEntryMode === 'amount' && inputs.portfolioEntries.length > 0 && Math.abs(capitalGapClp) > 1;
  const hasUnassignedCapital = hasCapitalGap;
  const requiredReturnAnnual = useMemo(() => {
    if (inputs.spendingMode !== 'fixed') return null;
    return solveRequiredAnnualReturn(previewEffectiveCapitalClp, inputs.fixedMonthlyClp, inputs.horizonYears);
  }, [inputs.spendingMode, previewEffectiveCapitalClp, inputs.fixedMonthlyClp, inputs.horizonYears]);

  const selectedInstrumentExpectedRows = useMemo(() => {
    const returns = DEFAULT_PARAMETERS.returns;
    const amountTotal = selectedInstrumentRows.reduce((sum, row) => sum + Math.max(0, Number(row.entry.amountClp || 0)), 0);
    const pctTotal = selectedInstrumentRows.reduce((sum, row) => sum + Math.max(0, Number(row.entry.percentage || 0)), 0);

    return selectedInstrumentRows.map(({ entry, instrument }) => {
      const baseWeight = inputs.portfolioEntryMode === 'amount'
        ? (amountTotal > 0 ? Math.max(0, Number(entry.amountClp || 0)) / amountTotal : 0)
        : (pctTotal > 0 ? Math.max(0, Number(entry.percentage || 0)) / pctTotal : 0);
      const amountClp = inputs.portfolioEntryMode === 'amount'
        ? Math.max(0, Number(entry.amountClp || 0))
        : Math.max(0, previewEffectiveCapitalClp * baseWeight);
      const expectedReturnAnnual =
        instrument.sleeveWeights.rvGlobal * returns.rvGlobalAnnual +
        instrument.sleeveWeights.rvChile * returns.rvChileAnnual +
        instrument.sleeveWeights.rfGlobal * returns.rfGlobalAnnual +
        instrument.sleeveWeights.rfChile * returns.rfChileUFAnnual;
      return {
        instrumentId: entry.instrumentId,
        name: instrument.name,
        amountClp,
        weight: baseWeight,
        expectedReturnAnnual,
      };
    });
  }, [selectedInstrumentRows, inputs.portfolioEntryMode, previewEffectiveCapitalClp]);

  useEffect(() => {
    if (selectedInstrumentExpectedRows.length === 0) return;
    const hasCurrent = selectedInstrumentExpectedRows.some((row) => row.instrumentId === bucketInstrumentId);
    if (hasCurrent) return;

    const ranked = [...selectedInstrumentExpectedRows].sort((a, b) => {
      if (a.expectedReturnAnnual !== b.expectedReturnAnnual) return a.expectedReturnAnnual - b.expectedReturnAnnual;
      const aOpt = optionsById.get(a.instrumentId);
      const bOpt = optionsById.get(b.instrumentId);
      const aRf = aOpt ? (aOpt.sleeveWeights.rfGlobal + aOpt.sleeveWeights.rfChile) : 0;
      const bRf = bOpt ? (bOpt.sleeveWeights.rfGlobal + bOpt.sleeveWeights.rfChile) : 0;
      if (aRf !== bRf) return bRf - aRf;
      const aName = (aOpt?.name ?? '').toLowerCase();
      const bName = (bOpt?.name ?? '').toLowerCase();
      const aHint = aName.includes('renta local uf') ? 1 : 0;
      const bHint = bName.includes('renta local uf') ? 1 : 0;
      return bHint - aHint;
    });
    const chosen = ranked[0];
    if (!chosen) return;
    setBucketInstrumentId(chosen.instrumentId);
    setBucketAutoNote(`Asignado automáticamente a ${chosen.name}.`);
  }, [selectedInstrumentExpectedRows, bucketInstrumentId, optionsById]);

  const portfolioExpectedReturnAnnual = useMemo(
    () => selectedInstrumentExpectedRows.reduce((sum, row) => sum + (row.weight * row.expectedReturnAnnual), 0),
    [selectedInstrumentExpectedRows],
  );
  const expectedRowsById = useMemo(
    () => new Map(selectedInstrumentExpectedRows.map((row) => [row.instrumentId, row])),
    [selectedInstrumentExpectedRows],
  );
  const portfolioRvRfMix = useMemo(() => {
    let rv = 0;
    let rf = 0;
    for (const row of selectedInstrumentExpectedRows) {
      const option = optionsById.get(row.instrumentId);
      if (!option) continue;
      rv += row.weight * (option.sleeveWeights.rvGlobal + option.sleeveWeights.rvChile);
      rf += row.weight * (option.sleeveWeights.rfGlobal + option.sleeveWeights.rfChile);
    }
    const sum = rv + rf;
    if (sum <= 0) return { rv: 0, rf: 0 };
    return { rv: rv / sum, rf: rf / sum };
  }, [selectedInstrumentExpectedRows, optionsById]);
  const canTiltForReturn = selectedInstrumentExpectedRows.length >= 2;
  const bucketRow = selectedInstrumentExpectedRows.find((row) => row.instrumentId === bucketInstrumentId) ?? null;
  const bucketFloorWeight = useMemo(() => {
    if (!bucketEnabled || !bucketRow) return 0;
    if (inputs.portfolioEntryMode === 'amount') {
      const floorAmount = mmToClp(bucketFloorMm);
      if (previewEffectiveCapitalClp <= 0) return 0;
      return clamp(floorAmount / previewEffectiveCapitalClp, 0, 1);
    }
    return clamp(bucketFloorPct / 100, 0, 1);
  }, [bucketEnabled, bucketRow, inputs.portfolioEntryMode, bucketFloorMm, bucketFloorPct, previewEffectiveCapitalClp]);

  const enforceBucketFloor = (
    entries: AssistedPortfolioEntry[],
    mode: AssistedInputs['portfolioEntryMode'],
    capitalClp: number,
  ): AssistedPortfolioEntry[] => {
    if (!bucketEnabled || !bucketInstrumentId) return entries;
    const bucketIdx = entries.findIndex((entry) => entry.instrumentId === bucketInstrumentId);
    if (bucketIdx < 0) return entries;
    const next = entries.map((entry) => ({ ...entry }));
    if (mode === 'amount') {
      const floor = mmToClp(bucketFloorMm);
      const bucketCurrent = Math.max(0, Number(next[bucketIdx].amountClp || 0));
      if (bucketCurrent >= floor) return next;
      let deficit = floor - bucketCurrent;
      const otherIdx = next.map((_, idx) => idx).filter((idx) => idx !== bucketIdx);
      const othersTotal = otherIdx.reduce((sum, idx) => sum + Math.max(0, Number(next[idx].amountClp || 0)), 0);
      if (othersTotal <= 0) return next;
      for (const idx of otherIdx) {
        const available = Math.max(0, Number(next[idx].amountClp || 0));
        const cut = Math.min(available, Math.round((available / othersTotal) * deficit));
        next[idx].amountClp = Math.max(0, available - cut);
        deficit -= cut;
      }
      if (deficit > 0) {
        for (const idx of otherIdx) {
          if (deficit <= 0) break;
          const available = Math.max(0, Number(next[idx].amountClp || 0));
          const cut = Math.min(available, deficit);
          next[idx].amountClp = available - cut;
          deficit -= cut;
        }
      }
      const totalAfter = next.reduce((sum, entry) => sum + Math.max(0, Number(entry.amountClp || 0)), 0);
      next[bucketIdx].amountClp = Math.max(floor, totalAfter - otherIdx.reduce((sum, idx) => sum + Math.max(0, Number(next[idx].amountClp || 0)), 0));
      return redistributeEntriesToCapital(next, Math.max(0, Math.round(capitalClp)));
    }

    const floorPct = clamp(bucketFloorPct, 0, 100);
    const bucketCurrent = Math.max(0, Number(next[bucketIdx].percentage || 0));
    if (bucketCurrent >= floorPct) return redistributeEntriesToPercentage(next);
    let deficit = floorPct - bucketCurrent;
    const otherIdx = next.map((_, idx) => idx).filter((idx) => idx !== bucketIdx);
    const othersTotal = otherIdx.reduce((sum, idx) => sum + Math.max(0, Number(next[idx].percentage || 0)), 0);
    if (othersTotal <= 0) return redistributeEntriesToPercentage(next);
    for (const idx of otherIdx) {
      const available = Math.max(0, Number(next[idx].percentage || 0));
      const cut = Math.min(available, Number(((available / othersTotal) * deficit).toFixed(1)));
      next[idx].percentage = Math.max(0, Number((available - cut).toFixed(1)));
      deficit = Number((deficit - cut).toFixed(1));
    }
    if (deficit > 0) {
      for (const idx of otherIdx) {
        if (deficit <= 0) break;
        const available = Math.max(0, Number(next[idx].percentage || 0));
        const cut = Math.min(available, deficit);
        next[idx].percentage = Number((available - cut).toFixed(1));
        deficit = Number((deficit - cut).toFixed(1));
      }
    }
    next[bucketIdx].percentage = floorPct;
    return redistributeEntriesToPercentage(next);
  };

  const quickSummary = useMemo(() => {
    const profileName = profileConfigs[activeProfile].title;
    const capital = formatMoney(previewEffectiveCapitalClp);
    const portfolioText = portfolioSourceMode === 'simple'
      ? `Mix simple RV ${simpleRvPct.toFixed(0)}% / RF ${(100 - simpleRvPct).toFixed(0)}%`
      : `${selectedCount} instrumentos`;
    if (questionMode === 'max_spending') {
      return `${profileName} · Capital efectivo ${capital} · Horizonte ${inputs.horizonYears} años · ${portfolioText}`;
    }
    return `${profileName} · Capital efectivo ${capital} · Gasto ${formatMoney(inputs.fixedMonthlyClp)} · Horizonte ${questionMode === 'duration' ? `${DURATION_TECHNICAL_HORIZON} años (técnico)` : `${inputs.horizonYears} años`} · ${portfolioText}`;
  }, [activeProfile, previewEffectiveCapitalClp, portfolioSourceMode, simpleRvPct, selectedCount, questionMode, inputs.horizonYears, inputs.fixedMonthlyClp]);

  useEffect(() => {
    if (baseScenarioSnapshot) return;
    const initial = createScenarioSnapshot();
    setBaseScenarioSnapshot(initial);
  }, [baseScenarioSnapshot]);

  const hasScenarioChanges = useMemo(() => {
    if (!baseScenarioSnapshot) return false;
    return scenarioComparable(createScenarioSnapshot()) !== scenarioComparable(baseScenarioSnapshot);
  }, [
    baseScenarioSnapshot,
    activeProfile,
    portfolioSourceMode,
    simpleRvPct,
    autoAdjustInstrumentAmounts,
    optimizeEnabled,
    bucketEnabled,
    bucketInstrumentId,
    bucketFloorMm,
    bucketFloorPct,
    inputs,
    excludedInstruments,
    numericDrafts,
    numericIssues,
  ]);

  const undoLastAdjustment = () => {
    if (historySnapshots.length === 0) return;
    const previous = historySnapshots[historySnapshots.length - 1];
    setHistorySnapshots((prev) => prev.slice(0, -1));
    applyScenarioSnapshot(previous);
    setReturnTiltMessage('Último ajuste deshecho.');
  };

  const restoreBaseScenario = () => {
    if (!baseScenarioSnapshot) return;
    applyScenarioSnapshot(baseScenarioSnapshot);
    setHistorySnapshots([]);
    setReturnTiltMessage('Escenario base restaurado.');
  };

  const applyWeightsToEntries = (
    nextWeights: Map<string, number>,
  ) => {
    setInputs((prev) => {
      if (prev.portfolioEntryMode === 'percentage') {
        let assigned = 0;
        const nextEntries = prev.portfolioEntries.map((entry, idx) => {
          const target = nextWeights.get(entry.instrumentId);
          if (target === undefined) return entry;
          if (idx === prev.portfolioEntries.length - 1) {
            return { ...entry, percentage: Number(Math.max(0, 100 - assigned).toFixed(1)) };
          }
          const pct = Number((target * 100).toFixed(1));
          assigned += pct;
          return { ...entry, percentage: pct };
        });
        return { ...prev, portfolioEntries: nextEntries };
      }

      const targetCapital = Math.max(0, Math.round(previewEffectiveCapitalClp));
      let assigned = 0;
      const nextEntries = prev.portfolioEntries.map((entry, idx) => {
        const target = nextWeights.get(entry.instrumentId);
        if (target === undefined) return entry;
        if (idx === prev.portfolioEntries.length - 1) {
          return { ...entry, amountClp: Math.max(0, targetCapital - assigned) };
        }
        const amount = Math.max(0, Math.round(targetCapital * target));
        assigned += amount;
        return { ...entry, amountClp: amount };
      });
      return { ...prev, portfolioEntries: nextEntries };
    });
  };

  const applyReturnTilt = (direction: 'more' | 'less') => {
    if (!canTiltForReturn) {
      setReturnTiltMessage('Selecciona al menos 2 instrumentos para ajustar retorno.');
      return;
    }
    const rows = [...selectedInstrumentExpectedRows];
    const minRet = Math.min(...rows.map((row) => row.expectedReturnAnnual));
    const maxRet = Math.max(...rows.map((row) => row.expectedReturnAnnual));
    const spread = maxRet - minRet;
    if (spread <= 1e-9) {
      setReturnTiltMessage('Los instrumentos tienen retorno esperado similar; no se aplicó ajuste.');
      return;
    }

    const currentBucketWeight = bucketRow?.weight ?? 0;
    const bucketTarget = bucketEnabled && bucketRow
      ? (direction === 'more'
        ? clamp(bucketFloorWeight, 0, currentBucketWeight)
        : clamp(Math.max(bucketFloorWeight, currentBucketWeight + (0.15 * (1 - currentBucketWeight))), 0, 1))
      : 0;
    const optimizableWeight = clamp(1 - bucketTarget, 0, 1);

    const nonBucketRows = rows.filter((row) => !bucketEnabled || row.instrumentId !== bucketInstrumentId);
    if (nonBucketRows.length === 0 && bucketRow) {
      const next = new Map<string, number>([[bucketRow.instrumentId, 1]]);
      applyWeightsToEntries(next);
      setReturnTiltMessage('Bucket defensivo respetado. No hay instrumentos elegibles adicionales.');
      return;
    }

    const nonBucketTotal = nonBucketRows.reduce((sum, row) => sum + row.weight, 0);
    if (nonBucketTotal <= 0) {
      setReturnTiltMessage('No hay margen para ajustar sin romper el bucket defensivo.');
      return;
    }

    const adjusted = nonBucketRows.map((row) => {
      const rel = (row.expectedReturnAnnual - portfolioExpectedReturnAnnual) / spread;
      const directional = direction === 'more' ? rel : -rel;
      const desirability = clamp(1 + (0.45 * directional), 0.55, 1.75);
      return { ...row, raw: (row.weight / nonBucketTotal) * desirability };
    });
    const rawSum = adjusted.reduce((sum, row) => sum + row.raw, 0);
    if (rawSum <= 0) {
      setReturnTiltMessage('No hay margen para ajustar sin romper el bucket defensivo.');
      return;
    }

    const nextWeights = new Map<string, number>();
    if (bucketEnabled && bucketRow) {
      nextWeights.set(bucketRow.instrumentId, bucketTarget);
    }
    for (const row of adjusted) {
      nextWeights.set(row.instrumentId, optimizableWeight * (row.raw / rawSum));
    }
    const before = portfolioExpectedReturnAnnual;
    const after = rows.reduce((sum, row) => sum + ((nextWeights.get(row.instrumentId) ?? 0) * row.expectedReturnAnnual), 0);
    pushScenarioHistory();
    applyWeightsToEntries(nextWeights);
    if (direction === 'more') {
      setReturnTiltMessage(`Bucket defensivo respetado. Mix ajustado hacia más retorno (${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%). Recalcula para ver impacto.`);
    } else {
      setReturnTiltMessage(`Bucket defensivo respetado. Mix ajustado hacia menor retorno (${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%). Recalcula para ver impacto.`);
    }
  };

  const applyMoreReturnTilt = () => applyReturnTilt('more');
  const applyLessReturnTilt = () => applyReturnTilt('less');

  const applyBucketPair = (keepNonBucketId: string) => {
    if (!bucketEnabled || !bucketRow) return;
    const nonBucket = selectedInstrumentExpectedRows.filter((row) => row.instrumentId !== bucketInstrumentId);
    const chosen = nonBucket.find((row) => row.instrumentId === keepNonBucketId);
    if (!chosen) return;
    const bucketTarget = clamp(Math.max(bucketFloorWeight, bucketRow.weight), 0, 1);
    const nextWeights = new Map<string, number>();
    nextWeights.set(bucketInstrumentId, bucketTarget);
    nextWeights.set(keepNonBucketId, Math.max(0, 1 - bucketTarget));
    for (const row of nonBucket) {
      if (row.instrumentId !== keepNonBucketId) nextWeights.set(row.instrumentId, 0);
    }
    pushScenarioHistory();
    applyWeightsToEntries(nextWeights);
    setReturnTiltMessage(`Bucket defensivo respetado. Probando bucket + ${chosen.name}. Recalcula para ver impacto.`);
  };

  const applyBucketAll = () => {
    if (!bucketEnabled || !bucketRow || selectedInstrumentExpectedRows.length < 2) return;
    const nonBucket = selectedInstrumentExpectedRows.filter((row) => row.instrumentId !== bucketInstrumentId);
    if (nonBucket.length === 0) return;
    const bucketTarget = clamp(Math.max(bucketFloorWeight, bucketRow.weight), 0, 1);
    const remaining = Math.max(0, 1 - bucketTarget);
    const split = remaining / nonBucket.length;
    const nextWeights = new Map<string, number>();
    nextWeights.set(bucketInstrumentId, bucketTarget);
    for (const row of nonBucket) nextWeights.set(row.instrumentId, split);
    pushScenarioHistory();
    applyWeightsToEntries(nextWeights);
    setReturnTiltMessage('Mix ajustado. Manteniendo bucket + todos los instrumentos activos. Recalcula para ver impacto.');
  };

  const buildRuntimeContext = (
    baseInputs: AssistedInputs,
    baseSimpleRvPct: number,
  ): { runtimeInputs: AssistedInputs; runtimeInstruments: AssistedInstrumentOption[] } => {
    const runtimeInputs: AssistedInputs = {
      ...baseInputs,
      horizonYears: clamp(Number(baseInputs.horizonYears) || 30, 4, 60),
      nSim: Math.max(200, Number(baseInputs.nSim) || 1000),
      seed: Math.max(1, Math.round(Number(baseInputs.seed) || 42)),
      successThreshold: clamp(Number(baseInputs.successThreshold) || 0.85, 0.5, 0.99),
      gridStepPct: clamp(Number(baseInputs.gridStepPct) || 5, 5, 25),
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
          { instrumentId: SIMPLE_RV_ID, amountClp: 0, percentage: clamp(baseSimpleRvPct, 0, 100) },
          { instrumentId: SIMPLE_RF_ID, amountClp: 0, percentage: clamp(100 - baseSimpleRvPct, 0, 100) },
        ];
      }
    }

    if (portfolioSourceMode === 'instruments' && runtimeInputs.portfolioEntryMode === 'amount' && autoAdjustInstrumentAmounts && runtimeInputs.portfolioEntries.length > 0) {
      runtimeInputs.portfolioEntries = redistributeEntriesToCapital(runtimeInputs.portfolioEntries, runtimeInputs.initialCapitalClp);
    }

    if (questionMode === 'duration') {
      runtimeInputs.horizonYears = DURATION_TECHNICAL_HORIZON;
    }

    if (questionMode === 'max_spending') {
      const fixed = Math.max(1, Number(runtimeInputs.fixedMonthlyClp) || 1_000_000);
      runtimeInputs.fixedMonthlyClp = fixed;
      runtimeInputs.phase1MonthlyClp = Math.max(1, Number(runtimeInputs.phase1MonthlyClp) || fixed);
      runtimeInputs.phase2MonthlyClp = Math.max(1, Number(runtimeInputs.phase2MonthlyClp) || fixed);
    } else if (runtimeInputs.spendingMode === 'fixed') {
      runtimeInputs.fixedMonthlyClp = Math.max(1, Number(runtimeInputs.fixedMonthlyClp) || 0);
      runtimeInputs.phase1MonthlyClp = runtimeInputs.fixedMonthlyClp;
      runtimeInputs.phase2MonthlyClp = runtimeInputs.fixedMonthlyClp;
    } else {
      runtimeInputs.phase1MonthlyClp = Math.max(1, Number(runtimeInputs.phase1MonthlyClp) || 0);
      runtimeInputs.phase2MonthlyClp = Math.max(1, Number(runtimeInputs.phase2MonthlyClp) || 0);
    }

    return { runtimeInputs, runtimeInstruments };
  };

  const resolveNumericDraftsForRun = (): { nextInputs: AssistedInputs; nextSimpleRvPct: number; error: string | null } => {
    const nextInputs: AssistedInputs = {
      ...inputs,
      portfolioEntries: inputs.portfolioEntries.map((entry) => ({ ...entry })),
    };
    let nextSimpleRv = simpleRvPct;
    let firstError: string | null = null;
    const remainingDrafts = { ...numericDrafts };
    const nextIssues = { ...numericIssues };

    const takeValue = ({
      key,
      mode,
      current,
      min,
      max,
      requiredMessage,
    }: {
      key: string;
      mode: 'decimal' | 'integer';
      current: number;
      min?: number;
      max?: number;
      requiredMessage: string;
    }): number => {
      if (!(key in remainingDrafts)) return current;
      const raw = remainingDrafts[key];
      const parsed = mode === 'decimal' ? parseDecimalInput(raw) : parseIntegerInput(raw);
      if (parsed === null) {
        nextIssues[key] = requiredMessage;
        if (!firstError) firstError = requiredMessage;
        return current;
      }
      let value = parsed;
      if (min !== undefined) value = Math.max(min, value);
      if (max !== undefined) value = Math.min(max, value);
      if (mode === 'integer') value = Math.round(value);
      delete remainingDrafts[key];
      delete nextIssues[key];
      return value;
    };

    nextInputs.initialCapitalClp = mmToClp(takeValue({
      key: 'initialCapitalClpMm',
      mode: 'decimal',
      current: clpToMm(nextInputs.initialCapitalClp),
      min: 0,
      requiredMessage: 'Completa el capital total.',
    }));

    if (questionMode !== 'duration') {
      nextInputs.horizonYears = takeValue({
        key: 'horizonYears',
        mode: 'integer',
        current: nextInputs.horizonYears,
        min: 4,
        max: 60,
        requiredMessage: 'Completa el horizonte en años.',
      });
    }

    if ((questionMode === 'duration' || questionMode === 'success') && nextInputs.spendingMode === 'fixed') {
      const fixedMm = takeValue({
        key: 'fixedMonthlyClpMm',
        mode: 'decimal',
        current: clpToMm(nextInputs.fixedMonthlyClp),
        min: 0,
        requiredMessage: 'Completa el gasto mensual.',
      });
      const fixedClp = mmToClp(fixedMm);
      nextInputs.fixedMonthlyClp = fixedClp;
      nextInputs.phase1MonthlyClp = fixedClp;
      nextInputs.phase2MonthlyClp = fixedClp;
    }

    if (nextInputs.extraContributionEnabled) {
      nextInputs.extraContributionClp = mmToClp(takeValue({
        key: 'extraContributionClpMm',
        mode: 'decimal',
        current: clpToMm(nextInputs.extraContributionClp),
        min: 0,
        requiredMessage: 'Completa el aporte único adicional.',
      }));
      nextInputs.extraContributionYear = takeValue({
        key: 'extraContributionYear',
        mode: 'integer',
        current: nextInputs.extraContributionYear,
        min: 0,
        max: 40,
        requiredMessage: 'Completa el año del aporte adicional.',
      });
    }

    if (portfolioSourceMode === 'simple') {
      nextSimpleRv = clamp(takeValue({
        key: 'simpleRvPct',
        mode: 'integer',
        current: nextSimpleRv,
        min: 0,
        max: 100,
        requiredMessage: 'Completa el porcentaje RV.',
      }), 0, 100);
    }

    if (portfolioSourceMode === 'instruments') {
      nextInputs.portfolioEntries = nextInputs.portfolioEntries.map((entry) => {
        if (nextInputs.portfolioEntryMode === 'amount') {
          return {
            ...entry,
            amountClp: mmToClp(takeValue({
              key: `amount_${entry.instrumentId}`,
              mode: 'decimal',
              current: clpToMm(entry.amountClp),
              min: 0,
              requiredMessage: 'Completa los montos por instrumento.',
            })),
          };
        }
        return {
          ...entry,
          percentage: takeValue({
            key: `pct_${entry.instrumentId}`,
            mode: 'decimal',
            current: entry.percentage,
            min: 0,
            max: 100,
            requiredMessage: 'Completa los porcentajes por instrumento.',
          }),
        };
      });

      if (bucketEnabled) {
        const key = nextInputs.portfolioEntryMode === 'amount' ? 'bucketFloorMm' : 'bucketFloorPct';
        const value = takeValue({
          key,
          mode: 'decimal',
          current: nextInputs.portfolioEntryMode === 'amount' ? bucketFloorMm : bucketFloorPct,
          min: 0,
          max: nextInputs.portfolioEntryMode === 'amount' ? 9999 : 100,
          requiredMessage: 'Completa el bucket defensivo mínimo.',
        });
        if (nextInputs.portfolioEntryMode === 'amount') setBucketFloorMm(value);
        else setBucketFloorPct(value);
      }
    }

    nextInputs.successThreshold = takeValue({
      key: 'successThreshold',
      mode: 'decimal',
      current: nextInputs.successThreshold,
      min: 0.5,
      max: 0.99,
      requiredMessage: 'Completa el umbral mínimo de éxito.',
    });
    nextInputs.nSim = takeValue({
      key: 'nSim',
      mode: 'integer',
      current: nextInputs.nSim,
      min: 200,
      max: 5000,
      requiredMessage: 'Completa nSim.',
    });
    nextInputs.seed = takeValue({
      key: 'seed',
      mode: 'integer',
      current: nextInputs.seed,
      min: 1,
      max: 999999,
      requiredMessage: 'Completa la seed.',
    });
    nextInputs.gridStepPct = takeValue({
      key: 'gridStepPct',
      mode: 'integer',
      current: nextInputs.gridStepPct,
      min: 5,
      max: 25,
      requiredMessage: 'Completa el paso de grilla.',
    });

    if (nextInputs.spendingMode === 'two_phase') {
      nextInputs.phase1MonthlyClp = mmToClp(takeValue({
        key: 'phase1MonthlyClpMm',
        mode: 'decimal',
        current: clpToMm(nextInputs.phase1MonthlyClp),
        min: 0,
        requiredMessage: 'Completa el gasto mensual de fase 1.',
      }));
      nextInputs.phase1Years = takeValue({
        key: 'phase1Years',
        mode: 'integer',
        current: nextInputs.phase1Years,
        min: 1,
        max: 40,
        requiredMessage: 'Completa la duración de fase 1.',
      });
      nextInputs.phase2MonthlyClp = mmToClp(takeValue({
        key: 'phase2MonthlyClpMm',
        mode: 'decimal',
        current: clpToMm(nextInputs.phase2MonthlyClp),
        min: 0,
        requiredMessage: 'Completa el gasto mensual de fase 2.',
      }));
    }

    setNumericDrafts(remainingDrafts);
    setNumericIssues(nextIssues);
    if (!firstError) {
      const lingering = Object.values(nextIssues)[0];
      if (lingering) firstError = lingering;
    }
    return { nextInputs, nextSimpleRvPct: nextSimpleRv, error: firstError };
  };

  const run = () => {
    setError(null);
    setResult(null);
    const { nextInputs, nextSimpleRvPct, error: draftError } = resolveNumericDraftsForRun();
    if (draftError) {
      setError(draftError);
      return;
    }
    setInputs(nextInputs);
    setSimpleRvPct(nextSimpleRvPct);
    setRunning(true);
    try {
      const { runtimeInputs, runtimeInstruments } = buildRuntimeContext(nextInputs, nextSimpleRvPct);
      const output = runAssistedSimulation(runtimeInputs, runtimeInstruments);
      setResult(output);
      setResultMode(questionMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const resultTitle = result?.hasFeasibleSolution ? 'Resultado principal' : 'Resultado de referencia';
  const status = result ? statusLabelForResult(resultMode, result) : null;

  const duration = useMemo(
    () => (result ? (result.best.durationMetrics ? {
      p10: result.best.durationMetrics.success90.years,
      p50: result.best.durationMetrics.p50.years,
      p90: result.best.durationMetrics.success85.years,
      censoredP10: result.best.durationMetrics.success90.censored,
      censoredP50: result.best.durationMetrics.p50.censored,
      censoredP90: result.best.durationMetrics.success85.censored,
    } : estimateDuration(result.best, result.horizonYears)) : null),
    [result],
  );
  const durationTargets = result?.best.durationMetrics ?? null;

  const summaryText = useMemo(() => {
    if (!result) return '';
    if (resultMode === 'max_spending') {
      if (!result.hasFeasibleSolution) {
        return `No encontramos una combinación que cumpla el umbral de éxito ${formatPct(result.successThreshold)}. Te mostramos mejor esfuerzo como referencia técnica.`;
      }
      return `Para mantener ${formatPct(result.successThreshold)} de éxito al horizonte, el retiro mensual estimado es ${formatMoney(result.best.sustainableMonthlyClp)}.`;
    }
    if (resultMode === 'duration' && durationTargets) {
      return `Con 85% de confianza, el capital dura ${formatDuration(durationTargets.success85.years, durationTargets.success85.censored)}. Escenario central P50: ${formatDuration(durationTargets.p50.years, durationTargets.p50.censored)}.`;
    }
    return `Con estos supuestos, la probabilidad de éxito al horizonte de ${result.horizonYears} años es ${formatPct(result.best.successAtHorizon)}.`;
  }, [result, resultMode, durationTargets]);

  const runButtonLabel = useMemo(() => {
    if (questionMode === 'max_spending') return 'Calcular gasto máximo';
    if (questionMode === 'duration') return 'Calcular duración';
    return 'Calcular probabilidad';
  }, [questionMode]);

  const heroValue = useMemo(() => {
    if (!result) return '--';
    if (resultMode === 'max_spending') {
      return result.hasFeasibleSolution ? formatMoney(result.best.sustainableMonthlyClp) : 'Sin solución factible';
    }
    if (resultMode === 'duration' && durationTargets) {
      return formatDuration(durationTargets.success85.years, durationTargets.success85.censored);
    }
    return formatPct(result.best.successAtHorizon);
  }, [result, resultMode, durationTargets]);

  const heroLabel = useMemo(() => {
    if (resultMode === 'max_spending') return 'Gasto mensual máximo estimado';
    if (resultMode === 'duration') return 'Duración con 85% de éxito';
    return 'Probabilidad de éxito';
  }, [resultMode]);
  const resultExpectedReturnAnnual = useMemo(() => {
    if (!result) return null;
    const ret = DEFAULT_PARAMETERS.returns;
    const w = result.best.weights;
    return (
      w.rvGlobal * ret.rvGlobalAnnual +
      w.rvChile * ret.rvChileAnnual +
      w.rfGlobal * ret.rfGlobalAnnual +
      w.rfChile * ret.rfChileUFAnnual
    );
  }, [result]);
  const resultRetiroCapitalPct = useMemo(() => {
    if (!result) return null;
    const baseCapital = Math.max(1, result.effectiveInitialCapitalClp);
    const monthly = resultMode === 'max_spending'
      ? result.best.sustainableMonthlyClp
      : result.best.equivalentMonthlyClp;
    return (monthly * 12) / baseCapital;
  }, [result, resultMode]);

  const retiroCapitalLabel = useMemo(() => {
    if (resultRetiroCapitalPct === null) return null;
    const pct = resultRetiroCapitalPct * 100;
    if (pct < 4) return 'Cómodo';
    if (pct < 7) return 'Moderado';
    if (pct < 10) return 'Exigente';
    return 'Muy exigente';
  }, [resultRetiroCapitalPct]);

  const diagnosticHorizonYears = useMemo(() => {
    if (!result) return inputs.horizonYears;
    if (resultMode === 'duration') return DURATION_TECHNICAL_HORIZON;
    return result.horizonYears;
  }, [result, resultMode, inputs.horizonYears]);

  const deterministicRequiredReturn = useMemo(() => {
    if (!result) return null;
    const baseCapital = Math.max(1, result.effectiveInitialCapitalClp);
    if (inputs.spendingMode === 'two_phase') {
      const totalMonths = Math.max(1, Math.round(diagnosticHorizonYears * 12));
      const phase1Months = clamp(Math.round(inputs.phase1Years * 12), 1, totalMonths);
      const phase2Months = Math.max(0, totalMonths - phase1Months);
      const phase1Monthly = resultMode === 'max_spending'
        ? Math.max(0, result.best.phase1MonthlyClp)
        : Math.max(0, inputs.phase1MonthlyClp);
      const phase2Monthly = resultMode === 'max_spending'
        ? Math.max(0, result.best.phase2MonthlyClp)
        : Math.max(0, inputs.phase2MonthlyClp);
      const flows = [
        ...Array.from({ length: phase1Months }, () => phase1Monthly),
        ...Array.from({ length: phase2Months }, () => phase2Monthly),
      ];
      return solveRequiredAnnualReturnForCashflows(baseCapital, flows);
    }
    const monthly = resultMode === 'max_spending'
      ? result.best.sustainableMonthlyClp
      : result.best.equivalentMonthlyClp;
    return solveRequiredAnnualReturn(baseCapital, monthly, diagnosticHorizonYears);
  }, [
    result,
    resultMode,
    diagnosticHorizonYears,
    inputs.spendingMode,
    inputs.phase1Years,
    inputs.phase1MonthlyClp,
    inputs.phase2MonthlyClp,
  ]);

  const returnGapAnnual = useMemo(() => {
    if (resultExpectedReturnAnnual === null || deterministicRequiredReturn === null) return null;
    return resultExpectedReturnAnnual - deterministicRequiredReturn;
  }, [resultExpectedReturnAnnual, deterministicRequiredReturn]);

  const whyResultText = useMemo(() => {
    if (!result || resultExpectedReturnAnnual === null || deterministicRequiredReturn === null || resultRetiroCapitalPct === null || !retiroCapitalLabel) {
      return null;
    }
    const expectedPct = resultExpectedReturnAnnual * 100;
    const requiredPct = deterministicRequiredReturn * 100;
    const retiroPct = resultRetiroCapitalPct * 100;
    if (expectedPct < requiredPct) {
      return `El retiro anual representa ${retiroPct.toFixed(1)}% del capital (${retiroCapitalLabel}) y el retorno esperado de la cartera está por debajo del retorno requerido.`;
    }
    return `El retiro anual representa ${retiroPct.toFixed(1)}% del capital (${retiroCapitalLabel}) y existe margen determinístico frente al retorno requerido.`;
  }, [result, resultExpectedReturnAnnual, deterministicRequiredReturn, resultRetiroCapitalPct, retiroCapitalLabel]);

  const currentScenarioSignature = useMemo(
    () => scenarioComparable(createScenarioSnapshot()),
    [
      activeProfile,
      portfolioSourceMode,
      simpleRvPct,
      autoAdjustInstrumentAmounts,
      optimizeEnabled,
      bucketEnabled,
      bucketInstrumentId,
      bucketFloorMm,
      bucketFloorPct,
      inputs,
      excludedInstruments,
      numericDrafts,
      numericIssues,
    ],
  );
  const leversAreStale = !!leversResult && !!leversScenarioSignature && leversScenarioSignature !== currentScenarioSignature;

  const calculateLevers85 = () => {
    if (leversLoading) return;
    setLeversError(null);
    const { nextInputs, nextSimpleRvPct, error: draftError } = resolveNumericDraftsForRun();
    if (draftError) {
      setLeversError(draftError);
      return;
    }
    setLeversLoading(true);
    try {
      const target = 0.85;
      const { runtimeInputs, runtimeInstruments } = buildRuntimeContext(nextInputs, nextSimpleRvPct);
      const baseForLevers: AssistedInputs = {
        ...runtimeInputs,
        optimizationObjective: 'max_success',
        successThreshold: target,
      };

      const normalizeForCapital = (candidate: AssistedInputs, capitalClp: number): AssistedInputs => {
        const out: AssistedInputs = { ...candidate, initialCapitalClp: Math.max(1, Math.round(capitalClp)) };
        if (portfolioSourceMode === 'instruments' && out.portfolioEntryMode === 'amount' && out.portfolioEntries.length > 0) {
          out.portfolioEntries = redistributeEntriesToCapital(out.portfolioEntries, out.initialCapitalClp);
        }
        return out;
      };

      const runFor = (candidate: AssistedInputs): AssistedOptimizationResult =>
        runAssistedSimulation(candidate, runtimeInstruments);

      const compatibleMonthly = (() => {
        if (resultMode === 'max_spending' && result) return result.best.sustainableMonthlyClp;
        const spendingInput: AssistedInputs = {
          ...baseForLevers,
          optimizationObjective: 'max_spending',
        };
        const out = runFor(spendingInput);
        return out.best.sustainableMonthlyClp;
      })();

      const requiredCapital = (() => {
        const baseCapital = Math.max(1, baseForLevers.initialCapitalClp);
        const successAt = (capital: number): number => {
          const candidate = normalizeForCapital(baseForLevers, capital);
          return runFor(candidate).best.successAtHorizon;
        };
        if (successAt(baseCapital) >= target) return baseCapital;
        let low = baseCapital;
        let high = baseCapital;
        let guard = 0;
        while (successAt(high) < target && guard < 14) {
          low = high;
          high *= 1.5;
          guard += 1;
        }
        if (guard >= 14 && successAt(high) < target) return null;
        for (let i = 0; i < 18; i += 1) {
          const mid = Math.round((low + high) / 2);
          if (successAt(mid) >= target) high = mid;
          else low = mid;
        }
        return Math.round(high);
      })();

      const horizon85 = (() => {
        if (resultMode === 'duration' && result?.best.durationMetrics?.success85?.years) {
          return result.best.durationMetrics.success85.years;
        }
        const candidateBase: AssistedInputs = {
          ...baseForLevers,
          optimizationObjective: 'max_success',
        };
        const successAtYears = (years: number): number => {
          const candidate: AssistedInputs = { ...candidateBase, horizonYears: clamp(Math.round(years), 4, 60) };
          return runFor(candidate).best.successAtHorizon;
        };
        const minYears = 4;
        const maxYears = 60;
        if (successAtYears(minYears) < target) return minYears;
        if (successAtYears(maxYears) >= target) return maxYears;
        let low = minYears;
        let high = maxYears;
        while (high - low > 1) {
          const mid = Math.floor((low + high) / 2);
          if (successAtYears(mid) >= target) low = mid;
          else high = mid;
        }
        return low;
      })();

      const returnRequired = (() => {
        const horizonYears = resultMode === 'duration' ? DURATION_TECHNICAL_HORIZON : baseForLevers.horizonYears;
        if (baseForLevers.spendingMode === 'two_phase') {
          const totalMonths = Math.max(1, Math.round(horizonYears * 12));
          const phase1Months = clamp(Math.round(baseForLevers.phase1Years * 12), 1, totalMonths);
          const phase2Months = Math.max(0, totalMonths - phase1Months);
          const flows = [
            ...Array.from({ length: phase1Months }, () => Math.max(0, baseForLevers.phase1MonthlyClp)),
            ...Array.from({ length: phase2Months }, () => Math.max(0, baseForLevers.phase2MonthlyClp)),
          ];
          return solveRequiredAnnualReturnForCashflows(
            Math.max(1, baseForLevers.initialCapitalClp),
            flows,
          );
        }
        const monthlyForRequired = resultMode === 'max_spending'
          ? compatibleMonthly
          : Math.max(0, baseForLevers.fixedMonthlyClp);
        return solveRequiredAnnualReturn(
          Math.max(1, baseForLevers.initialCapitalClp),
          monthlyForRequired,
          horizonYears,
        );
      })();

      setLeversResult({
        targetSuccess: target,
        compatibleMonthlyClp: Number.isFinite(compatibleMonthly) ? compatibleMonthly : null,
        requiredCapitalClp: requiredCapital,
        horizon85Years: Number.isFinite(horizon85) ? horizon85 : null,
        returnRequiredAnnual: returnRequired,
      });
      setLeversScenarioSignature(currentScenarioSignature ?? null);
    } catch (e) {
      setLeversError(e instanceof Error ? e.message : 'No se pudieron calcular las palancas de 85%.');
    } finally {
      setLeversLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section style={{
        background: `linear-gradient(135deg, ${ASSISTED_COCKPIT.shell}, ${ASSISTED_COCKPIT.panel})`,
        border: `1px solid ${ASSISTED_COCKPIT.border}`,
        borderRadius: 18,
        padding: '10px 14px',
        display: 'grid',
        gap: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ color: ASSISTED_COCKPIT.accent, fontWeight: 900, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Simulación Asistida</div>
            <div style={{ color: T.textMuted, fontSize: 12 }}>
              Calcula gasto, duración o probabilidad de éxito sin entrar al modelo completo.
            </div>
          </div>
          <div style={{
            alignSelf: 'start',
            color: T.textPrimary,
            border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
            borderRadius: 999,
            padding: '6px 10px',
            background: ASSISTED_COCKPIT.panelSoft,
            fontSize: 11,
            fontWeight: 700,
          }}>
            Motor M8 real · entrada simplificada
          </div>
        </div>
      </section>

      <section style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 14, padding: '8px 12px', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <label style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Perfil</label>
          <select
            value={activeProfile}
            onChange={(e) => applyProfile(e.target.value as ProfileId)}
            style={{
              background: ASSISTED_COCKPIT.panelSoft,
              border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
              borderRadius: 8,
              color: T.textPrimary,
              padding: '6px 10px',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {(Object.keys(profileConfigs) as ProfileId[]).map((profileId) => (
              <option key={profileId} value={profileId} disabled={!!profileConfigs[profileId].disabled}>
                {profileConfigs[profileId].title}
              </option>
            ))}
          </select>
          <span style={{ color: T.textMuted, fontSize: 12 }}>
            {profileConfigs[activeProfile].subtitle}
            {profileConfigs[activeProfile].editable ? ' · editable' : ' · solo lectura'}
          </span>
        </div>
        <div style={{
          background: ASSISTED_COCKPIT.panelSoft,
          border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
          borderRadius: 10,
          padding: '6px 10px',
          color: T.textSecondary,
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {quickSummary}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
        {modeCards.map((card) => {
          const active = questionMode === card.mode;
          return (
            <button
              key={card.mode}
              type="button"
              onClick={() => setQuestionModeAndResetError(card.mode)}
              style={{
                textAlign: 'left',
                borderRadius: 14,
                border: `1px solid ${active ? ASSISTED_COCKPIT.accent : ASSISTED_COCKPIT.border}`,
                background: active ? `linear-gradient(135deg, ${ASSISTED_COCKPIT.accentSoft}, rgba(184,115,51,0.04))` : ASSISTED_COCKPIT.panel,
                color: T.textPrimary,
                padding: '9px 12px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 14, color: active ? ASSISTED_COCKPIT.accent : T.textPrimary, marginBottom: 1 }}>{card.icon}</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{card.title}</div>
              <div style={{ color: T.textMuted, fontSize: 11 }}>{card.subtitle}</div>
            </button>
          );
        })}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14 }}>
      <section style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.border}`, borderRadius: 16, padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Supuestos esenciales</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Capital total (MM CLP)
            <input
              type="text"
              inputMode="decimal"
              value={numericDisplayValue('initialCapitalClpMm', clpToMmInput(inputs.initialCapitalClp), (v) => v.toFixed(1))}
              onChange={(e) => handleNumericDraftChange('initialCapitalClpMm', e.target.value, 'decimal')}
              onBlur={() => {
                commitNumericDraft({
                  key: 'initialCapitalClpMm',
                  mode: 'decimal',
                  min: 0,
                  apply: (value) => {
                    const nextCapital = mmToClp(value);
                    if (
                      portfolioSourceMode === 'instruments' &&
                      inputs.portfolioEntryMode === 'amount' &&
                      autoAdjustInstrumentAmounts &&
                      inputs.portfolioEntries.length > 0
                    ) {
                      setInputs((prev) => ({
                        ...prev,
                        initialCapitalClp: nextCapital,
                        portfolioEntries: redistributeEntriesToCapital(prev.portfolioEntries, nextCapital),
                      }));
                      return;
                    }
                    updateInput('initialCapitalClp', nextCapital);
                  },
                  requiredMessage: 'Completa el capital total.',
                });
              }}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
            />
            <span style={{ color: T.textMuted }}>{`${clpToMm(inputs.initialCapitalClp).toFixed(1)} MM = ${formatMoney(inputs.initialCapitalClp)}`}</span>
          </label>

          {questionMode !== 'duration' && (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Horizonte (años)
              <input
                type="text"
                inputMode="numeric"
                value={numericDisplayValue('horizonYears', inputs.horizonYears)}
                onChange={(e) => handleNumericDraftChange('horizonYears', e.target.value, 'integer')}
                onBlur={() => {
                  commitNumericDraft({
                    key: 'horizonYears',
                    mode: 'integer',
                    min: 4,
                    max: 60,
                    apply: (value) => updateInput('horizonYears', value),
                    requiredMessage: 'Completa el horizonte en años.',
                  });
                }}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
            </label>
          )}

          {(questionMode === 'duration' || questionMode === 'success') && inputs.spendingMode === 'fixed' && (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Gasto mensual (MM CLP)
              <input
                type="text"
                inputMode="decimal"
                value={numericDisplayValue('fixedMonthlyClpMm', clpToMmInput(inputs.fixedMonthlyClp), (v) => v.toFixed(1))}
                onChange={(e) => handleNumericDraftChange('fixedMonthlyClpMm', e.target.value, 'decimal')}
                onBlur={() => {
                  commitNumericDraft({
                    key: 'fixedMonthlyClpMm',
                    mode: 'decimal',
                    min: 0,
                    apply: (value) => {
                      const clp = mmToClp(value);
                      updateInput('fixedMonthlyClp', clp);
                      updateInput('phase1MonthlyClp', clp);
                      updateInput('phase2MonthlyClp', clp);
                    },
                    requiredMessage: 'Completa el gasto mensual.',
                  });
                }}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
              <span style={{ color: T.textMuted }}>{`${clpToMm(inputs.fixedMonthlyClp).toFixed(1)} MM = ${formatMoney(inputs.fixedMonthlyClp)}`}</span>
            </label>
          )}

          {questionMode === 'duration' && (
            <div style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Horizonte técnico
              <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textSecondary, padding: '9px 11px' }}>
                {DURATION_TECHNICAL_HORIZON} años (interno)
              </div>
            </div>
          )}
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: T.textPrimary, fontSize: 12, fontWeight: 600 }}>
          <input type="checkbox" checked={inputs.extraContributionEnabled} onChange={(e) => updateInput('extraContributionEnabled', e.target.checked)} />
          Incluir aporte único adicional
        </label>

        {inputs.extraContributionEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Aporte (MM CLP)
              <input
                type="text"
                inputMode="decimal"
                value={numericDisplayValue('extraContributionClpMm', clpToMmInput(inputs.extraContributionClp), (v) => v.toFixed(1))}
                onChange={(e) => handleNumericDraftChange('extraContributionClpMm', e.target.value, 'decimal')}
                onBlur={() => {
                  commitNumericDraft({
                    key: 'extraContributionClpMm',
                    mode: 'decimal',
                    min: 0,
                    apply: (value) => updateInput('extraContributionClp', mmToClp(value)),
                    requiredMessage: 'Completa el aporte único adicional.',
                  });
                }}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Año aporte
              <input
                type="text"
                inputMode="numeric"
                value={numericDisplayValue('extraContributionYear', inputs.extraContributionYear)}
                onChange={(e) => handleNumericDraftChange('extraContributionYear', e.target.value, 'integer')}
                onBlur={() => {
                  commitNumericDraft({
                    key: 'extraContributionYear',
                    mode: 'integer',
                    min: 0,
                    max: 40,
                    apply: (value) => updateInput('extraContributionYear', value),
                    requiredMessage: 'Completa el año del aporte adicional.',
                  });
                }}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
            </label>
          </div>
        )}
      </section>

      <section style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.border}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Portafolio</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setPortfolioSourceMode('simple')}
            style={{
              borderRadius: 999,
              border: `1px solid ${portfolioSourceMode === 'simple' ? T.primary : T.border}`,
              background: portfolioSourceMode === 'simple' ? ASSISTED_COCKPIT.accentSoft : ASSISTED_COCKPIT.panelSoft,
              color: T.textPrimary,
              padding: '6px 12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Mix simple RF/RV
          </button>
          <button
            type="button"
            onClick={() => setPortfolioSourceMode('instruments')}
            style={{
              borderRadius: 999,
              border: `1px solid ${portfolioSourceMode === 'instruments' ? T.primary : T.border}`,
              background: portfolioSourceMode === 'instruments' ? ASSISTED_COCKPIT.accentSoft : ASSISTED_COCKPIT.panelSoft,
              color: T.textPrimary,
              padding: '6px 12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Instrumentos reales
          </button>
        </div>

        {portfolioSourceMode === 'simple' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6, color: T.textPrimary, fontSize: 12 }}>
              RV (%)
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={simpleRvPct}
                onChange={(e) => setSimpleRvPct(clamp(Number(e.target.value) || 0, 0, 100))}
              />
              <input
                type="text"
                inputMode="numeric"
                value={numericDisplayValue('simpleRvPct', simpleRvPct)}
                onChange={(e) => handleNumericDraftChange('simpleRvPct', e.target.value, 'integer')}
                onBlur={() => {
                  commitNumericDraft({
                    key: 'simpleRvPct',
                    mode: 'integer',
                    min: 0,
                    max: 100,
                    apply: (value) => setSimpleRvPct(clamp(value, 0, 100)),
                    requiredMessage: 'Completa el porcentaje RV.',
                  });
                }}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
              />
            </label>
            <div style={{ display: 'grid', gap: 6, color: T.textPrimary, fontSize: 12 }}>
              <span>RF (%)</span>
              <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '10px 12px', fontWeight: 800 }}>
                {(100 - simpleRvPct).toFixed(0)}%
              </div>
              <span style={{ color: T.textMuted }}>Suma total: {(simpleRvPct + (100 - simpleRvPct)).toFixed(0)}%</span>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  updateInput('portfolioEntryMode', 'amount');
                  setAutoAdjustInstrumentAmounts(true);
                  setInputs((prev) => ({
                    ...prev,
                    portfolioEntries: redistributeEntriesToCapital(prev.portfolioEntries, prev.initialCapitalClp),
                  }));
                }}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${inputs.portfolioEntryMode === 'amount' ? T.primary : T.border}`,
                  background: inputs.portfolioEntryMode === 'amount' ? ASSISTED_COCKPIT.accentSoft : ASSISTED_COCKPIT.panelSoft,
                  color: T.textPrimary,
                  padding: '6px 12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Monto por instrumento
              </button>
              <button
                type="button"
                onClick={() => {
                  updateInput('portfolioEntryMode', 'percentage');
                  setAutoAdjustInstrumentAmounts(false);
                }}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${inputs.portfolioEntryMode === 'percentage' ? T.primary : T.border}`,
                  background: inputs.portfolioEntryMode === 'percentage' ? ASSISTED_COCKPIT.accentSoft : ASSISTED_COCKPIT.panelSoft,
                  color: T.textPrimary,
                  padding: '6px 12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Porcentaje por instrumento
              </button>
            </div>

            {selectedInstrumentRows.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                {inputs.portfolioEntryMode === 'amount' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: T.textPrimary, fontSize: 12, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={autoAdjustInstrumentAmounts}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setAutoAdjustInstrumentAmounts(enabled);
                        if (enabled) {
                          setInputs((prev) => ({
                            ...prev,
                            portfolioEntries: redistributeEntriesToCapital(prev.portfolioEntries, prev.initialCapitalClp),
                          }));
                        }
                      }}
                    />
                    Autoajustar al capital total
                  </label>
                )}
                {selectedInstrumentRows.map(({ entry, instrument }) => (
                  <div key={entry.instrumentId} style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) 156px 34px',
                    gap: 8,
                    alignItems: 'center',
                    background: ASSISTED_COCKPIT.panelSoft,
                    border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                    borderRadius: 12,
                    padding: '7px 9px',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{instrument.name}</div>
                      <div style={{ color: T.textMuted, fontSize: 11 }}>
                        {(() => {
                          const expected = expectedRowsById.get(entry.instrumentId);
                          const bucketTag = bucketEnabled && entry.instrumentId === bucketInstrumentId ? ' · Bucket' : '';
                          if (!expected) return `${instrument.currency} · ref ${formatPct(instrument.weightPortfolio)}${bucketTag}`;
                          return `${formatPct(expected.weight)} · Ret. esp. ${(expected.expectedReturnAnnual * 100).toFixed(1)}%${bucketTag}`;
                        })()}
                      </div>
                    </div>
                    {inputs.portfolioEntryMode === 'amount' ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numericDisplayValue(`amount_${entry.instrumentId}`, clpToMmInput(entry.amountClp), (v) => v.toFixed(1))}
                        onChange={(e) => {
                          if (autoAdjustInstrumentAmounts) {
                            setAutoAdjustInstrumentAmounts(false);
                          }
                          handleNumericDraftChange(`amount_${entry.instrumentId}`, e.target.value, 'decimal');
                        }}
                        onBlur={() => {
                          commitNumericDraft({
                            key: `amount_${entry.instrumentId}`,
                            mode: 'decimal',
                            min: 0,
                            apply: (value) => updateEntry(entry.instrumentId, { amountClp: mmToClp(value) }),
                            requiredMessage: `Completa el monto de ${instrument.name}.`,
                          });
                        }}
                        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, color: T.textPrimary, padding: '8px 10px' }}
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numericDisplayValue(`pct_${entry.instrumentId}`, entry.percentage, (v) => v.toFixed(1))}
                        onChange={(e) => handleNumericDraftChange(`pct_${entry.instrumentId}`, e.target.value, 'decimal')}
                        onBlur={() => {
                          commitNumericDraft({
                            key: `pct_${entry.instrumentId}`,
                            mode: 'decimal',
                            min: 0,
                            max: 100,
                            apply: (value) => updateEntry(entry.instrumentId, { percentage: value }),
                            requiredMessage: `Completa el porcentaje de ${instrument.name}.`,
                          });
                        }}
                        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, color: T.textPrimary, padding: '8px 10px' }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeInstrument(entry.instrumentId)}
                      disabled={bucketEnabled && entry.instrumentId === bucketInstrumentId}
                      style={{
                        border: `1px solid ${T.border}`,
                        background: 'transparent',
                        color: bucketEnabled && entry.instrumentId === bucketInstrumentId ? ASSISTED_COCKPIT.accent : T.textMuted,
                        borderRadius: 8,
                        cursor: bucketEnabled && entry.instrumentId === bucketInstrumentId ? 'not-allowed' : 'pointer',
                        opacity: bucketEnabled && entry.instrumentId === bucketInstrumentId ? 0.8 : 1,
                        height: 34,
                      }}
                      title={bucketEnabled && entry.instrumentId === bucketInstrumentId ? 'Bucket defensivo: no se puede excluir' : 'Quitar'}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {availableInstruments.length === 0 && (
              <div style={{ color: T.textMuted, fontSize: 12 }}>
                No hay instrumentos cargados desde Universe. Puedes usar mix simple RF/RV mientras tanto.
              </div>
            )}

            <div style={{
              background: ASSISTED_COCKPIT.panelSoft,
              border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
              borderRadius: 10,
              padding: '8px 10px',
              display: 'grid',
              gap: 4,
              fontSize: 12,
            }}>
              <div style={{ color: T.textSecondary }}>
                Capital ingresado: <strong style={{ color: T.textPrimary }}>{formatMoney(inputs.initialCapitalClp)}</strong> ·
                Suma instrumentos: <strong style={{ color: T.textPrimary }}>{formatMoney(portfolioAmountTotal)}</strong> ·
                Capital efectivo usado: <strong style={{ color: T.textPrimary }}>{formatMoney(previewEffectiveCapitalClp)}</strong>
              </div>
              {inputs.portfolioEntryMode === 'percentage' && (
                <div style={{ color: portfolioPctStatus.color, fontWeight: 700 }}>
                  {`Suma porcentajes: ${portfolioPctTotal.toFixed(1)}% · ${portfolioPctStatus.label}`}
                </div>
              )}
              {hasCapitalGap && (
                <div style={{ color: T.warning }}>
                  {capitalGapClp < 0
                    ? `Faltan ${formatMoney(Math.abs(capitalGapClp))} por asignar en instrumentos.`
                    : `Los instrumentos exceden el capital ingresado en ${formatMoney(capitalGapClp)}.`}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => {
                        pushScenarioHistory();
                        updateInput('initialCapitalClp', portfolioAmountTotal);
                        setAutoAdjustInstrumentAmounts(false);
                        setReturnTiltMessage('Capital sincronizado con la suma de instrumentos.');
                      }}
                      style={{ border: 'none', background: 'transparent', color: T.primary, cursor: 'pointer', fontWeight: 800, padding: 0 }}
                    >
                      Usar suma como capital
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        pushScenarioHistory();
                        setAutoAdjustInstrumentAmounts(true);
                        setInputs((prev) => ({
                          ...prev,
                          portfolioEntries: redistributeEntriesToCapital(prev.portfolioEntries, prev.initialCapitalClp),
                        }));
                        setReturnTiltMessage('Instrumentos repartidos para cuadrar el capital total.');
                      }}
                      style={{ border: 'none', background: 'transparent', color: T.primary, cursor: 'pointer', fontWeight: 800, padding: 0 }}
                    >
                      Repartir capital en instrumentos
                    </button>
                  </div>
                </div>
              )}
            </div>

            {selectedInstrumentExpectedRows.length > 0 && (
              <div style={{
                background: ASSISTED_COCKPIT.panelSoft,
                border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                borderRadius: 10,
                padding: '8px 10px',
                display: 'grid',
                gap: 6,
                fontSize: 12,
              }}>
                <div style={{ color: T.textSecondary }}>
                  Bucket defensivo mínimo:{' '}
                  <strong style={{ color: T.textPrimary }}>
                    {inputs.portfolioEntryMode === 'amount'
                      ? `${bucketFloorMm.toFixed(1)} MM`
                      : `${bucketFloorPct.toFixed(1)}%`}
                  </strong>
                </div>
                <div style={{ color: T.textSecondary }}>
                  {bucketRow
                    ? <>Protegido automáticamente en: <strong style={{ color: T.textPrimary }}>{bucketRow.name}</strong></>
                    : 'Sin instrumento defensivo asignado'}
                </div>
                {bucketAutoNote && <div style={{ color: T.textMuted, fontSize: 11 }}>{bucketAutoNote}</div>}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ color: T.textSecondary }}>
                    Retorno esperado: <strong style={{ color: T.textPrimary }}>{(portfolioExpectedReturnAnnual * 100).toFixed(1)}% real anual</strong>
                    {' · '}
                    Mix RV/RF <strong style={{ color: T.textPrimary }}>{`${(portfolioRvRfMix.rv * 100).toFixed(0)}/${(portfolioRvRfMix.rf * 100).toFixed(0)}`}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={applyMoreReturnTilt}
                    disabled={!canTiltForReturn}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                      background: canTiltForReturn ? ASSISTED_COCKPIT.accentSoft : ASSISTED_COCKPIT.panel,
                      color: T.textPrimary,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: canTiltForReturn ? 'pointer' : 'not-allowed',
                      opacity: canTiltForReturn ? 1 : 0.6,
                    }}
                  >
                    Probar más retorno
                  </button>
                  <button
                    type="button"
                    onClick={applyLessReturnTilt}
                    disabled={!canTiltForReturn}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                      background: canTiltForReturn ? ASSISTED_COCKPIT.panel : ASSISTED_COCKPIT.panel,
                      color: T.textPrimary,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: canTiltForReturn ? 'pointer' : 'not-allowed',
                      opacity: canTiltForReturn ? 1 : 0.6,
                    }}
                  >
                    Probar menos retorno
                  </button>
                </div>
                <div style={{ color: T.textMuted, fontSize: 11 }}>
                  Estimación real anual para explicar el escenario. El Monte Carlo también considera volatilidad y secuencia.
                </div>
                {returnTiltMessage && (
                  <div style={{ color: ASSISTED_COCKPIT.accent, fontSize: 11, fontWeight: 700 }}>
                    {returnTiltMessage}
                  </div>
                )}
                {baseScenarioSnapshot && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: ASSISTED_COCKPIT.panel,
                    border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                  }}>
                    <span style={{ color: T.textMuted, fontSize: 11 }}>
                      {hasScenarioChanges
                        ? 'Mix modificado · pendiente de recalcular'
                        : `Escenario base ${profileConfigs[activeProfile].title}`}
                    </span>
                    {hasScenarioChanges && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={undoLastAdjustment}
                          disabled={historySnapshots.length === 0}
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                            background: ASSISTED_COCKPIT.panelSoft,
                            color: T.textPrimary,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: historySnapshots.length === 0 ? 'not-allowed' : 'pointer',
                            opacity: historySnapshots.length === 0 ? 0.6 : 1,
                          }}
                        >
                          Deshacer último ajuste
                        </button>
                        <button
                          type="button"
                          onClick={restoreBaseScenario}
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${ASSISTED_COCKPIT.accent}`,
                            background: ASSISTED_COCKPIT.accentSoft,
                            color: T.textPrimary,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {`Restaurar base ${profileConfigs[activeProfile].title}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {requiredReturnAnnual !== null && Number.isFinite(requiredReturnAnnual) && portfolioExpectedReturnAnnual < requiredReturnAnnual && (
                  <div style={{ color: T.warning }}>
                    El retorno esperado del portafolio está por debajo del retorno requerido para sostener este retiro.
                  </div>
                )}
              </div>
            )}

            {excludedInstruments.length > 0 && (
              <div style={{
                background: ASSISTED_COCKPIT.panelSoft,
                border: `1px dashed ${ASSISTED_COCKPIT.borderSoft}`,
                borderRadius: 10,
                padding: '8px 10px',
                display: 'grid',
                gap: 6,
                fontSize: 12,
              }}>
                <div style={{ color: T.textSecondary, fontWeight: 700 }}>Instrumentos excluidos</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {excludedInstruments.map((entry) => {
                    const option = optionsById.get(entry.instrumentId);
                    return (
                      <button
                        key={entry.instrumentId}
                        type="button"
                        onClick={() => restoreExcludedInstrument(entry.instrumentId)}
                        style={{
                          borderRadius: 999,
                          border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                          background: ASSISTED_COCKPIT.panel,
                          color: T.textPrimary,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {`Restaurar ${option?.name ?? entry.instrumentId}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <details style={{ marginTop: 2 }}>
              <summary style={{ color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>Ajustes de mix</summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowUniversePicker((prev) => !prev)}
                    style={{
                      borderRadius: 10,
                      border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                      background: ASSISTED_COCKPIT.panelSoft,
                      color: T.textPrimary,
                      padding: '7px 10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    + Agregar otro instrumento
                  </button>
                  {showUniversePicker && (
                    <>
                      <select
                        value={newInstrumentId}
                        onChange={(e) => setNewInstrumentId(e.target.value)}
                        style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '7px 10px' }}
                      >
                        <option value="">Selecciona instrumento...</option>
                        {unselectedInstruments.map((item) => (
                          <option key={item.instrumentId} value={item.instrumentId}>{item.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          upsertInstrument(newInstrumentId);
                          setNewInstrumentId('');
                        }}
                        style={{
                          borderRadius: 10,
                          border: `1px solid ${T.primary}`,
                          background: ASSISTED_COCKPIT.accentSoft,
                          color: T.textPrimary,
                          padding: '7px 10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Agregar
                      </button>
                    </>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                    Bucket defensivo mínimo {inputs.portfolioEntryMode === 'amount' ? '(MM)' : '(%)'}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numericDisplayValue(
                        inputs.portfolioEntryMode === 'amount' ? 'bucketFloorMm' : 'bucketFloorPct',
                        inputs.portfolioEntryMode === 'amount' ? bucketFloorMm : bucketFloorPct,
                        (v) => v.toFixed(1),
                      )}
                      onChange={(e) => handleNumericDraftChange(
                        inputs.portfolioEntryMode === 'amount' ? 'bucketFloorMm' : 'bucketFloorPct',
                        e.target.value,
                        'decimal',
                      )}
                      onBlur={() => {
                        commitNumericDraft({
                          key: inputs.portfolioEntryMode === 'amount' ? 'bucketFloorMm' : 'bucketFloorPct',
                          mode: 'decimal',
                          min: 0,
                          max: inputs.portfolioEntryMode === 'amount' ? 9999 : 100,
                          apply: (value) => {
                            if (inputs.portfolioEntryMode === 'amount') setBucketFloorMm(value);
                            else setBucketFloorPct(value);
                          },
                          requiredMessage: 'Completa el bucket defensivo mínimo.',
                        });
                      }}
                      style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 8, color: T.textPrimary, padding: '6px 8px' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                    Configurar bucket defensivo
                    <select
                      value={bucketInstrumentId}
                      onChange={(e) => setBucketInstrumentId(e.target.value)}
                      style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 8, color: T.textPrimary, padding: '6px 8px' }}
                    >
                      {selectedInstrumentRows.map(({ instrument, entry }) => (
                        <option key={entry.instrumentId} value={entry.instrumentId}>{instrument.name}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={bucketEnabled}
                      onChange={(e) => setBucketEnabled(e.target.checked)}
                    />
                    Regla defensiva activa
                  </label>
                </div>

                {bucketEnabled && bucketRow && selectedInstrumentExpectedRows.length === 3 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ color: T.textMuted, fontSize: 11, fontWeight: 700 }}>Probar 2 de 3:</span>
                    <button
                      type="button"
                      onClick={applyBucketAll}
                      style={{
                        borderRadius: 999,
                        border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                        background: ASSISTED_COCKPIT.accentSoft,
                        color: T.textPrimary,
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Mantener bucket + todos
                    </button>
                    {selectedInstrumentExpectedRows
                      .filter((row) => row.instrumentId !== bucketInstrumentId)
                      .map((row) => (
                        <button
                          key={row.instrumentId}
                          type="button"
                          onClick={() => applyBucketPair(row.instrumentId)}
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                            background: ASSISTED_COCKPIT.panel,
                            color: T.textPrimary,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {`Bucket + ${row.name}`}
                        </button>
                      ))}
                  </div>
                )}

                <details>
                  <summary style={{ color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>Ver universo completo</summary>
                  <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflow: 'auto', paddingTop: 8 }}>
                    {availableInstruments.map((instrument) => (
                      <label key={instrument.instrumentId} style={{ color: T.textPrimary, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(instrument.instrumentId)}
                          onChange={() => selectedIds.has(instrument.instrumentId) ? removeInstrument(instrument.instrumentId) : upsertInstrument(instrument.instrumentId)}
                          disabled={bucketEnabled && instrument.instrumentId === bucketInstrumentId && selectedIds.has(instrument.instrumentId)}
                        />
                        <span>{instrument.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </details>

          </>
        )}
      </section>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>

      <button
        type="button"
        onClick={run}
        disabled={running || optimizeSelectionInvalid || hasUnassignedCapital}
        style={{
          background: `linear-gradient(135deg, ${ASSISTED_COCKPIT.accent}, #8a5a2a)`,
          color: '#fff',
          border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
          borderRadius: 12,
          padding: '13px 16px',
          fontWeight: 900,
          fontSize: 15,
          cursor: (running || optimizeSelectionInvalid || hasUnassignedCapital) ? 'not-allowed' : 'pointer',
          opacity: (running || optimizeSelectionInvalid || hasUnassignedCapital) ? 0.72 : 1,
          boxShadow: '0 10px 28px rgba(184,115,51,0.24)',
        }}
      >
        {running ? 'Calculando...' : runButtonLabel}
      </button>

      {optimizeSelectionInvalid && (
        <div style={{ color: T.warning, fontSize: 12 }}>
          Para explorar combinación con instrumentos reales, selecciona 0, 2 o 3 instrumentos.
        </div>
      )}
      {hasUnassignedCapital && (
        <div style={{ color: T.warning, fontSize: 12 }}>
          Hay capital sin asignar. Usa “Repartir capital en instrumentos” o “Usar suma como capital” antes de calcular.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(255,80,80,0.15)', border: `1px solid ${T.negative}`, borderRadius: 12, padding: 12, color: T.textPrimary, fontSize: 12 }}>
          {error}
        </div>
      )}

      {result && (
        <section style={{
          background: `linear-gradient(180deg, ${ASSISTED_COCKPIT.panel}, ${ASSISTED_COCKPIT.panelSoft})`,
          border: `1px solid ${ASSISTED_COCKPIT.border}`,
          borderRadius: 18,
          padding: 16,
          display: 'grid',
          gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: T.textMuted, fontSize: 12, fontWeight: 700 }}>{resultTitle}</div>
              <div style={{ color: T.textPrimary, fontWeight: 900, fontSize: 14 }}>{heroLabel}</div>
              <div style={{ color: ASSISTED_COCKPIT.accent, fontWeight: 900, fontSize: 34, lineHeight: 1.05 }}>{heroValue}</div>
            </div>
            {status && (
              <div style={{ border: `1px solid ${status.color}`, color: status.color, borderRadius: 999, padding: '6px 10px', fontWeight: 800, fontSize: 12 }}>
                Estado: {status.label}
              </div>
            )}
          </div>

          {!result.hasFeasibleSolution && resultMode === 'max_spending' && (
            <div style={{ background: 'rgba(245,158,11,0.12)', border: `1px solid ${T.warning}`, borderRadius: 10, padding: 10, color: T.textPrimary, fontSize: 12 }}>
              No hay solución factible al umbral {formatPct(result.successThreshold)}.
              Referencia técnica best effort: {formatMoney(result.best.sustainableMonthlyClp)}.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8 }}>
            {resultMode === 'duration' && durationTargets && (
              <>
                <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Duración 90%</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatDuration(durationTargets.success90.years, durationTargets.success90.censored)}</div>
                </div>
                <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Duración 95%</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatDuration(durationTargets.success95.years, durationTargets.success95.censored)}</div>
                </div>
                <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>P50 central</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatDuration(durationTargets.p50.years, durationTargets.p50.censored)}</div>
                </div>
              </>
            )}

            {resultMode !== 'duration' && (
              <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Éxito al horizonte</div>
                <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatPct(result.best.successAtHorizon)}</div>
              </div>
            )}

            <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P50</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p50)}</div>
            </div>
            <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P10 / P90</div>
              <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700 }}>{formatMoney(result.best.p10)} · {formatMoney(result.best.p90)}</div>
            </div>
            <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Mix</div>
              <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{`RV ${((result.best.weights.rvGlobal + result.best.weights.rvChile) * 100).toFixed(1)}% · RF ${((result.best.weights.rfGlobal + result.best.weights.rfChile) * 100).toFixed(1)}%`}</div>
            </div>
            {resultExpectedReturnAnnual !== null && (
              <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Retorno esperado cartera</div>
                <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{(resultExpectedReturnAnnual * 100).toFixed(1)}% real anual</div>
              </div>
            )}
            {resultRetiroCapitalPct !== null && (
              <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Retiro/capital</div>
                <div style={{ color: ASSISTED_COCKPIT.accent, fontSize: 14, fontWeight: 800 }}>{(resultRetiroCapitalPct * 100).toFixed(1)}%</div>
              </div>
            )}
          </div>

          <div style={{ color: T.textSecondary, fontSize: 13 }}>{summaryText}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 8 }}>
            <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Por qué este resultado</div>
              <div style={{ color: T.textSecondary, fontSize: 12 }}>
                Retorno esperado cartera: <strong style={{ color: T.textPrimary }}>{resultExpectedReturnAnnual !== null ? `${(resultExpectedReturnAnnual * 100).toFixed(1)}% real anual` : '--'}</strong>
              </div>
              <div style={{ color: T.textSecondary, fontSize: 12 }}>
                Retorno requerido aprox.: <strong style={{ color: T.textPrimary }}>
                  {deterministicRequiredReturn !== null ? `${(deterministicRequiredReturn * 100).toFixed(1)}% real anual` : 'No disponible para estos flujos'}
                </strong>
              </div>
              <div style={{ color: T.textSecondary, fontSize: 12 }}>
                Brecha: <strong style={{ color: returnGapAnnual !== null && returnGapAnnual < 0 ? T.warning : T.textPrimary }}>
                  {returnGapAnnual !== null ? `${returnGapAnnual >= 0 ? '+' : ''}${(returnGapAnnual * 100).toFixed(1)} pp` : 'No disponible para estos flujos'}
                </strong>
              </div>
              <div style={{ color: T.textSecondary, fontSize: 12 }}>
                Retiro/capital: <strong style={{ color: T.textPrimary }}>
                  {resultRetiroCapitalPct !== null ? `${(resultRetiroCapitalPct * 100).toFixed(1)}%` : '--'}
                  {retiroCapitalLabel ? ` · ${retiroCapitalLabel}` : ''}
                </strong>
              </div>
              {whyResultText && (
                <div style={{ color: T.textMuted, fontSize: 11 }}>
                  {whyResultText}
                </div>
              )}
            </div>

            <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 800 }}>Para llegar a 85% de éxito</div>
              {!leversResult && (
                <button
                  type="button"
                  onClick={calculateLevers85}
                  disabled={leversLoading}
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${ASSISTED_COCKPIT.accent}`,
                    background: ASSISTED_COCKPIT.accentSoft,
                    color: T.textPrimary,
                    padding: '7px 10px',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: leversLoading ? 'not-allowed' : 'pointer',
                    opacity: leversLoading ? 0.7 : 1,
                    justifySelf: 'start',
                  }}
                >
                  {leversLoading ? 'Calculando palancas...' : 'Ver qué cambiar para llegar a 85%'}
                </button>
              )}
              {leversResult && (
                <>
                  <div style={{ color: T.textSecondary, fontSize: 12 }}>
                    Gasto compatible: <strong style={{ color: T.textPrimary }}>
                      {leversResult.compatibleMonthlyClp !== null ? formatMoney(leversResult.compatibleMonthlyClp) : '--'}
                    </strong>
                  </div>
                  <div style={{ color: T.textSecondary, fontSize: 12 }}>
                    Capital requerido: <strong style={{ color: T.textPrimary }}>
                      {leversResult.requiredCapitalClp !== null ? formatMoney(leversResult.requiredCapitalClp) : '--'}
                    </strong>
                  </div>
                  <div style={{ color: T.textSecondary, fontSize: 12 }}>
                    Horizonte 85%: <strong style={{ color: T.textPrimary }}>
                      {leversResult.horizon85Years !== null ? `${leversResult.horizon85Years.toFixed(1)} años` : '--'}
                    </strong>
                  </div>
                  <div style={{ color: T.textSecondary, fontSize: 12 }}>
                    Retorno requerido: <strong style={{ color: T.textPrimary }}>
                      {leversResult.returnRequiredAnnual !== null ? `${(leversResult.returnRequiredAnnual * 100).toFixed(1)}% real anual` : '--'}
                    </strong>
                  </div>
                  {leversAreStale && (
                    <div style={{ color: T.warning, fontSize: 11 }}>Estos valores quedaron desactualizados por cambios recientes. Vuelve a calcular palancas.</div>
                  )}
                  <button
                    type="button"
                    onClick={calculateLevers85}
                    disabled={leversLoading}
                    style={{
                      borderRadius: 10,
                      border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`,
                      background: ASSISTED_COCKPIT.panel,
                      color: T.textPrimary,
                      padding: '6px 10px',
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: leversLoading ? 'not-allowed' : 'pointer',
                      opacity: leversLoading ? 0.7 : 1,
                      justifySelf: 'start',
                    }}
                  >
                    {leversLoading ? 'Recalculando...' : 'Recalcular palancas 85%'}
                  </button>
                </>
              )}
              {leversError && (
                <div style={{ color: T.warning, fontSize: 11 }}>{leversError}</div>
              )}
            </div>
          </div>

          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Capital ingresado {formatMoney(result.inputCapitalClp)} · Suma instrumentos {formatMoney(result.portfolioAmountTotalClp)} · Capital efectivo {formatMoney(result.effectiveInitialCapitalClp)}
          </div>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Horizonte usado {result.horizonYears} años · Entrada {result.entryMode === 'amount' ? 'Monto' : 'Porcentaje'} · Candidatos {result.evaluatedCandidates}
          </div>

          <MiniFanChart
            data={(result.best.fanChartData ?? []).map((p) => ({
              year: p.year,
              p10: p.p10,
              p50: p.p50,
              p90: p.p90,
            }))}
            height={190}
          />

          {result.bestTwoOfThree && result.bestThreeInstruments && (
            <div style={{ color: T.textPrimary, fontSize: 12, background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 10 }}>
              Mejor 3 instrumentos: {formatMoney(result.bestThreeInstruments.equivalentMonthlyClp)} · Mejor 2-de-3: {formatMoney(result.bestTwoOfThree.equivalentMonthlyClp)}.
              {' '}
              {result.bestTwoOfThree.equivalentMonthlyClp > result.bestThreeInstruments.equivalentMonthlyClp
                ? 'La alternativa 2-de-3 mejora este caso.'
                : 'La combinación de 3 instrumentos mantiene ventaja o empate.'}
            </div>
          )}
        </section>
      )}
      </div>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10, borderTop: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, paddingTop: 10 }}>
      <details
        open={showAdvancedParams}
        onToggle={(e) => setShowAdvancedParams((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 14, padding: 12 }}
      >
        <summary style={{ color: T.textPrimary, fontWeight: 700, cursor: 'pointer' }}>Parámetros avanzados</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 10 }}>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Umbral mínimo de éxito
            <input
              type="text"
              inputMode="decimal"
              value={numericDisplayValue('successThreshold', inputs.successThreshold, (v) => v.toFixed(2))}
              onChange={(e) => handleNumericDraftChange('successThreshold', e.target.value, 'decimal')}
              onBlur={() => {
                commitNumericDraft({
                  key: 'successThreshold',
                  mode: 'decimal',
                  min: 0.5,
                  max: 0.99,
                  apply: (value) => updateInput('successThreshold', value),
                  requiredMessage: 'Completa el umbral mínimo de éxito.',
                });
              }}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            nSim
            <input
              type="text"
              inputMode="numeric"
              value={numericDisplayValue('nSim', inputs.nSim)}
              onChange={(e) => handleNumericDraftChange('nSim', e.target.value, 'integer')}
              onBlur={() => {
                commitNumericDraft({
                  key: 'nSim',
                  mode: 'integer',
                  min: 200,
                  max: 5000,
                  apply: (value) => updateInput('nSim', value),
                  requiredMessage: 'Completa nSim.',
                });
              }}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Seed
            <input
              type="text"
              inputMode="numeric"
              value={numericDisplayValue('seed', inputs.seed)}
              onChange={(e) => handleNumericDraftChange('seed', e.target.value, 'integer')}
              onBlur={() => {
                commitNumericDraft({
                  key: 'seed',
                  mode: 'integer',
                  min: 1,
                  max: 999999,
                  apply: (value) => updateInput('seed', value),
                  requiredMessage: 'Completa la seed.',
                });
              }}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
            />
          </label>
        </div>
      </details>

      <details
        open={showAdvancedSpending}
        onToggle={(e) => setShowAdvancedSpending((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 14, padding: 12 }}
      >
        <summary style={{ color: T.textPrimary, fontWeight: 700, cursor: 'pointer' }}>Gasto en dos fases (avanzado)</summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ color: T.textPrimary, fontSize: 12 }}>
              <input type="radio" checked={inputs.spendingMode === 'fixed'} onChange={() => updateInput('spendingMode', 'fixed')} /> Fijo
            </label>
            <label style={{ color: T.textPrimary, fontSize: 12 }}>
              <input type="radio" checked={inputs.spendingMode === 'two_phase'} onChange={() => updateInput('spendingMode', 'two_phase')} /> Dos fases
            </label>
          </div>
          {inputs.spendingMode === 'two_phase' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>
                {`Fase 1: ${clpToMm(inputs.phase1MonthlyClp).toFixed(1)} MM por ${inputs.phase1Years} años · Fase 2: ${clpToMm(inputs.phase2MonthlyClp).toFixed(1)} MM por ${Math.max(0, inputs.horizonYears - inputs.phase1Years)} años`}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
                <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 8, display: 'grid', gap: 6 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>Fase 1</div>
                  <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                    Gasto mensual (MM)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numericDisplayValue('phase1MonthlyClpMm', clpToMmInput(inputs.phase1MonthlyClp), (v) => v.toFixed(1))}
                      onChange={(e) => handleNumericDraftChange('phase1MonthlyClpMm', e.target.value, 'decimal')}
                      onBlur={() => {
                        commitNumericDraft({
                          key: 'phase1MonthlyClpMm',
                          mode: 'decimal',
                          min: 0,
                          apply: (value) => updateInput('phase1MonthlyClp', mmToClp(value)),
                          requiredMessage: 'Completa el gasto mensual de fase 1.',
                        });
                      }}
                      style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                    Años fase 1
                    <input
                      type="text"
                      inputMode="numeric"
                      value={numericDisplayValue('phase1Years', inputs.phase1Years)}
                      onChange={(e) => handleNumericDraftChange('phase1Years', e.target.value, 'integer')}
                      onBlur={() => {
                        commitNumericDraft({
                          key: 'phase1Years',
                          mode: 'integer',
                          min: 1,
                          max: 40,
                          apply: (value) => updateInput('phase1Years', value),
                          requiredMessage: 'Completa la duración de fase 1.',
                        });
                      }}
                      style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                    />
                  </label>
                </div>

                <div style={{ background: ASSISTED_COCKPIT.panelSoft, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 10, padding: 8, display: 'grid', gap: 6 }}>
                  <div style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>Fase 2</div>
                  <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                    Gasto mensual (MM)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numericDisplayValue('phase2MonthlyClpMm', clpToMmInput(inputs.phase2MonthlyClp), (v) => v.toFixed(1))}
                      onChange={(e) => handleNumericDraftChange('phase2MonthlyClpMm', e.target.value, 'decimal')}
                      onBlur={() => {
                        commitNumericDraft({
                          key: 'phase2MonthlyClpMm',
                          mode: 'decimal',
                          min: 0,
                          apply: (value) => updateInput('phase2MonthlyClp', mmToClp(value)),
                          requiredMessage: 'Completa el gasto mensual de fase 2.',
                        });
                      }}
                      style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                    />
                  </label>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>
                    {`Duración estimada: ${Math.max(0, inputs.horizonYears - inputs.phase1Years)} años (resto del horizonte)`}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </details>

      <details
        open={showOptimization}
        onToggle={(e) => setShowOptimization((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: ASSISTED_COCKPIT.panel, border: `1px solid ${ASSISTED_COCKPIT.borderSoft}`, borderRadius: 14, padding: 12 }}
      >
        <summary style={{ color: T.textPrimary, fontWeight: 700, cursor: 'pointer' }}>Explorar mejor combinación (opcional)</summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <div style={{ color: T.textMuted, fontSize: 12 }}>
            Después de calcular, puedes explorar si otra combinación mejora el resultado.
          </div>
          <label style={{ color: T.textPrimary, fontSize: 12 }}>
            <input type="checkbox" checked={optimizeEnabled} onChange={(e) => setOptimizeEnabled(e.target.checked)} /> Activar exploración de combinación
          </label>
          {optimizeEnabled && (
            <>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Objetivo de optimización
                <select
                  value={optimizationObjective}
                  onChange={(e) => {
                    setOptimizationObjective(e.target.value as AssistedOptimizationObjective);
                    setObjectiveOverridden(true);
                  }}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                >
                  <option value="max_spending">Maximizar gasto mensual</option>
                  <option value="max_duration">Maximizar duración</option>
                  <option value="max_success">Maximizar probabilidad de éxito</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Paso de grilla (%)
                <input
                  type="text"
                  inputMode="numeric"
                  value={numericDisplayValue('gridStepPct', inputs.gridStepPct)}
                  onChange={(e) => handleNumericDraftChange('gridStepPct', e.target.value, 'integer')}
                  onBlur={() => {
                    commitNumericDraft({
                      key: 'gridStepPct',
                      mode: 'integer',
                      min: 5,
                      max: 25,
                      apply: (value) => updateInput('gridStepPct', value),
                      requiredMessage: 'Completa el paso de grilla.',
                    });
                  }}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
              {portfolioSourceMode === 'instruments' && inputs.portfolioEntries.length === 3 && (
                <label style={{ color: T.textPrimary, fontSize: 12 }}>
                  <input type="checkbox" checked={inputs.includeTwoOfThreeCheck} onChange={(e) => updateInput('includeTwoOfThreeCheck', e.target.checked)} /> Evaluar también mejor alternativa 2-de-3
                </label>
              )}
            </>
          )}
        </div>
      </details>
      </section>
    </div>
  );
}
