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
type ProfileId = 'parents' | 'brother' | 'me' | 'custom';

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

const modeCards: Array<{ mode: AssistedQuestionMode; title: string; subtitle: string }> = [
  {
    mode: 'max_spending',
    title: 'Cuánto puedo gastar',
    subtitle: 'Encuentra el retiro mensual sostenible.',
  },
  {
    mode: 'duration',
    title: 'Cuántos años dura',
    subtitle: 'Estima duración con 85/90/95% de confianza.',
  },
  {
    mode: 'success',
    title: 'Probabilidad de éxito',
    subtitle: 'Mide chance de llegar al horizonte.',
  },
];

const profileConfigs: Record<ProfileId, {
  title: string;
  subtitle: string;
  capitalMm: number;
  spendingMm: number;
  horizonYears: number;
}> = {
  parents: {
    title: 'Papás',
    subtitle: 'Perfil sugerido familiar',
    capitalMm: 237,
    spendingMm: 1.4,
    horizonYears: 20,
  },
  brother: {
    title: 'Hermano',
    subtitle: 'Perfil sugerido ahorro activo',
    capitalMm: 120,
    spendingMm: 0.8,
    horizonYears: 15,
  },
  me: {
    title: 'Yo',
    subtitle: 'Base conservadora editable',
    capitalMm: 80,
    spendingMm: 0.6,
    horizonYears: 25,
  },
  custom: {
    title: 'Personalizado',
    subtitle: 'Sin precarga, editable total',
    capitalMm: 0,
    spendingMm: 0,
    horizonYears: 20,
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

const formatDuration = (years: number, censored: boolean): string => {
  if (!Number.isFinite(years)) return '--';
  return censored ? `Más de ${Math.round(years)} años` : `${years.toFixed(1)} años`;
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

const statusLabelForResult = (
  mode: AssistedQuestionMode,
  result: AssistedOptimizationResult,
): { label: string; color: string } => {
  if (mode === 'max_spending') {
    if (!result.hasFeasibleSolution) return { label: 'Bajo', color: T.warning };
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
      style={{ display: 'block', background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', borderRadius: 14, border: `1px solid ${T.border}` }}
    >
      <line x1={40} y1={height - 22} x2={width - 12} y2={height - 22} stroke={T.border} strokeWidth="1" />
      <line x1={40} y1={16} x2={40} y2={height - 22} stroke={T.border} strokeWidth="1" />
      <polygon points={bandPath} fill="rgba(96,165,250,0.16)" />
      <polyline fill="none" stroke={T.primary} strokeWidth="2.8" points={p50Polyline} />
      <text x={44} y={20} fill={T.textMuted} fontSize="10">P90</text>
      <text x={44} y={height - 28} fill={T.textMuted} fontSize="10">P10</text>
      <text x={width - 56} y={height - 8} fill={T.textMuted} fontSize="10">años</text>
    </svg>
  );
}

export function AssistedSimulationPage() {
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
  const [optimizationObjective, setOptimizationObjective] = useState<AssistedOptimizationObjective>('max_success');
  const [objectiveOverridden, setObjectiveOverridden] = useState(false);

  const [inputs, setInputs] = useState<AssistedInputs>(defaultInputs);
  const [result, setResult] = useState<AssistedOptimizationResult | null>(null);
  const [resultMode, setResultMode] = useState<AssistedQuestionMode>('success');
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
    setInputs((prev) => {
      if (prev.portfolioEntries.some((entry) => entry.instrumentId === instrumentId)) return prev;
      const nextEntries = [...prev.portfolioEntries, { instrumentId, amountClp: 0, percentage: 0 }];
      return {
        ...prev,
        portfolioEntries: autoAdjustInstrumentAmounts && prev.portfolioEntryMode === 'amount'
          ? redistributeEntriesToCapital(nextEntries, prev.initialCapitalClp)
          : nextEntries,
      };
    });
  };

  const removeInstrument = (instrumentId: string) => {
    setInputs((prev) => ({
      ...prev,
      portfolioEntries: prev.portfolioEntries.filter((entry) => entry.instrumentId !== instrumentId),
    }));
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
    setActiveProfile(profileId);
    setError(null);
    const profile = profileConfigs[profileId];
    if (profileId === 'custom') {
      setInputs((prev) => ({
        ...prev,
        initialCapitalClp: prev.initialCapitalClp,
      }));
      return;
    }

    const capitalClp = mmToClp(profile.capitalMm);
    const spendingClp = mmToClp(profile.spendingMm);
    const useInstruments = availableInstruments.length > 0;

    const parentsPresetEntries = profileId === 'parents'
      ? buildParentsConservativeEntries(availableInstruments)
      : null;
    const shouldUseInstruments = useInstruments && (profileId !== 'parents' || !!parentsPresetEntries);

    setPortfolioSourceMode(shouldUseInstruments ? 'instruments' : 'simple');
    setSimpleRvPct(profileId === 'parents' ? 35 : 55);
    setOptimizeEnabled(false);
    setAutoAdjustInstrumentAmounts(true);

    setInputs((prev) => ({
      ...prev,
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

  const portfolioExpectedReturnAnnual = useMemo(
    () => selectedInstrumentExpectedRows.reduce((sum, row) => sum + (row.weight * row.expectedReturnAnnual), 0),
    [selectedInstrumentExpectedRows],
  );

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

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section style={{
        background: 'linear-gradient(135deg, rgba(59,130,246,0.14), rgba(16,185,129,0.06))',
        border: `1px solid ${T.border}`,
        borderRadius: 18,
        padding: 16,
        display: 'grid',
        gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ color: T.textPrimary, fontWeight: 900, fontSize: 21 }}>Simulación Asistida</div>
            <div style={{ color: T.textMuted, fontSize: 13 }}>
              Calcula gasto, duración o probabilidad de éxito sin entrar al modelo completo.
            </div>
          </div>
          <div style={{
            alignSelf: 'start',
            color: T.textPrimary,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.04)',
            fontSize: 12,
            fontWeight: 700,
          }}>
            Motor M8 real · entrada simplificada
          </div>
        </div>
      </section>

      <section style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Perfil rápido</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8 }}>
          {(Object.keys(profileConfigs) as ProfileId[]).map((profileId) => {
            const profile = profileConfigs[profileId];
            const active = activeProfile === profileId;
            return (
              <button
                key={profileId}
                type="button"
                onClick={() => applyProfile(profileId)}
                style={{
                  textAlign: 'left',
                  borderRadius: 12,
                  border: `1px solid ${active ? T.primary : T.border}`,
                  background: active ? 'rgba(59,130,246,0.18)' : T.surfaceEl,
                  color: T.textPrimary,
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800 }}>{profile.title}</div>
                <div style={{ color: T.textMuted, fontSize: 11 }}>{profile.subtitle}</div>
              </button>
            );
          })}
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
                border: `1px solid ${active ? T.primary : T.border}`,
                background: active ? 'linear-gradient(135deg, rgba(59,130,246,0.22), rgba(59,130,246,0.08))' : T.surface,
                color: T.textPrimary,
                padding: '12px 14px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 15 }}>{card.title}</div>
              <div style={{ color: T.textMuted, fontSize: 12 }}>{card.subtitle}</div>
            </button>
          );
        })}
      </section>

      <section style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        padding: '10px 12px',
        color: T.textSecondary,
        fontSize: 13,
        fontWeight: 600,
      }}>
        {quickSummary}
      </section>

      <section style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Supuestos esenciales</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Capital total (MM CLP)
            <input
              type="number"
              min={0}
              step={0.1}
              value={clpToMmInput(inputs.initialCapitalClp)}
              onChange={(e) => {
                const nextCapital = mmToClp(Number(e.target.value) || 0);
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
              }}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
            />
            <span style={{ color: T.textMuted }}>{`${clpToMm(inputs.initialCapitalClp).toFixed(1)} MM = ${formatMoney(inputs.initialCapitalClp)}`}</span>
          </label>

          {questionMode !== 'duration' && (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Horizonte (años)
              <input
                type="number"
                min={4}
                max={60}
                value={inputs.horizonYears}
                onChange={(e) => updateInput('horizonYears', Number(e.target.value) || 20)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
            </label>
          )}

          {(questionMode === 'duration' || questionMode === 'success') && inputs.spendingMode === 'fixed' && (
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Gasto mensual (MM CLP)
              <input
                type="number"
                min={0}
                step={0.1}
                value={clpToMmInput(inputs.fixedMonthlyClp)}
                onChange={(e) => {
                  const value = mmToClp(Number(e.target.value) || 0);
                  updateInput('fixedMonthlyClp', value);
                  updateInput('phase1MonthlyClp', value);
                  updateInput('phase2MonthlyClp', value);
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
                type="number"
                min={0}
                step={1}
                value={clpToMmInput(inputs.extraContributionClp)}
                onChange={(e) => updateInput('extraContributionClp', mmToClp(Number(e.target.value) || 0))}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
              Año aporte
              <input
                type="number"
                min={0}
                max={40}
                value={inputs.extraContributionYear}
                onChange={(e) => updateInput('extraContributionYear', Number(e.target.value) || 0)}
                style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '9px 11px' }}
              />
            </label>
          </div>
        )}
      </section>

      <section style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700 }}>Portafolio</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setPortfolioSourceMode('simple')}
            style={{
              borderRadius: 999,
              border: `1px solid ${portfolioSourceMode === 'simple' ? T.primary : T.border}`,
              background: portfolioSourceMode === 'simple' ? 'rgba(59,130,246,0.16)' : T.surfaceEl,
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
              background: portfolioSourceMode === 'instruments' ? 'rgba(59,130,246,0.16)' : T.surfaceEl,
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
                type="number"
                min={0}
                max={100}
                step={1}
                value={simpleRvPct}
                onChange={(e) => setSimpleRvPct(clamp(Number(e.target.value) || 0, 0, 100))}
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
                  background: inputs.portfolioEntryMode === 'amount' ? 'rgba(59,130,246,0.16)' : T.surfaceEl,
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
                  background: inputs.portfolioEntryMode === 'percentage' ? 'rgba(59,130,246,0.16)' : T.surfaceEl,
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
                    gridTemplateColumns: 'minmax(0,1fr) 170px 34px',
                    gap: 8,
                    alignItems: 'center',
                    background: T.surfaceEl,
                    border: `1px solid ${T.border}`,
                    borderRadius: 12,
                    padding: '8px 10px',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: T.textPrimary, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{instrument.name}</div>
                      <div style={{ color: T.textMuted, fontSize: 11 }}>{instrument.currency} · ref {formatPct(instrument.weightPortfolio)}</div>
                    </div>
                    {inputs.portfolioEntryMode === 'amount' ? (
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={clpToMmInput(entry.amountClp)}
                        onChange={(e) => {
                          if (autoAdjustInstrumentAmounts) {
                            setAutoAdjustInstrumentAmounts(false);
                          }
                          updateEntry(entry.instrumentId, { amountClp: mmToClp(Number(e.target.value) || 0) });
                        }}
                        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, color: T.textPrimary, padding: '8px 10px' }}
                      />
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={entry.percentage}
                        onChange={(e) => updateEntry(entry.instrumentId, { percentage: Number(e.target.value) || 0 })}
                        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, color: T.textPrimary, padding: '8px 10px' }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeInstrument(entry.instrumentId)}
                      style={{
                        border: `1px solid ${T.border}`,
                        background: 'transparent',
                        color: T.textMuted,
                        borderRadius: 8,
                        cursor: 'pointer',
                        height: 34,
                      }}
                      title="Quitar"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setShowUniversePicker((prev) => !prev)}
                style={{
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                  background: T.surfaceEl,
                  color: T.textPrimary,
                  padding: '7px 10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Agregar instrumento
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
                      background: 'rgba(59,130,246,0.16)',
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

            {availableInstruments.length === 0 && (
              <div style={{ color: T.textMuted, fontSize: 12 }}>
                No hay instrumentos cargados desde Universe. Puedes usar mix simple RF/RV mientras tanto.
              </div>
            )}

            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${T.border}`,
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
                        updateInput('initialCapitalClp', portfolioAmountTotal);
                        setAutoAdjustInstrumentAmounts(false);
                      }}
                      style={{ border: 'none', background: 'transparent', color: T.primary, cursor: 'pointer', fontWeight: 800, padding: 0 }}
                    >
                      Usar suma como capital
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAutoAdjustInstrumentAmounts(true);
                        setInputs((prev) => ({
                          ...prev,
                          portfolioEntries: redistributeEntriesToCapital(prev.portfolioEntries, prev.initialCapitalClp),
                        }));
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
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                padding: '8px 10px',
                display: 'grid',
                gap: 6,
                fontSize: 12,
              }}>
                {selectedInstrumentExpectedRows.map((row) => (
                  <div key={row.instrumentId} style={{ color: T.textSecondary }}>
                    <strong style={{ color: T.textPrimary }}>{row.name}</strong>
                    {' · '}
                    {formatMm(row.amountClp)}
                    {' · '}
                    {formatPct(row.weight)}
                    {' · '}
                    <strong style={{ color: T.textPrimary }}>Ret. esp. {(row.expectedReturnAnnual * 100).toFixed(1)}%</strong>
                  </div>
                ))}
                <div style={{ color: T.textSecondary }}>
                  Retorno esperado ponderado:
                  {' '}
                  <strong style={{ color: T.textPrimary }}>{(portfolioExpectedReturnAnnual * 100).toFixed(1)}% real anual</strong>
                </div>
                <div style={{ color: T.textMuted, fontSize: 11 }}>
                  Estimación real anual para explicar el escenario. El Monte Carlo también considera volatilidad y secuencia.
                </div>
                {requiredReturnAnnual !== null && Number.isFinite(requiredReturnAnnual) && portfolioExpectedReturnAnnual < requiredReturnAnnual && (
                  <div style={{ color: T.warning }}>
                    El retorno esperado del portafolio está por debajo del retorno requerido para sostener este retiro.
                  </div>
                )}
              </div>
            )}

            <details style={{ marginTop: 2 }}>
              <summary style={{ color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>Ver universo completo</summary>
              <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflow: 'auto', paddingTop: 8 }}>
                {availableInstruments.map((instrument) => (
                  <label key={instrument.instrumentId} style={{ color: T.textPrimary, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(instrument.instrumentId)}
                      onChange={() => selectedIds.has(instrument.instrumentId) ? removeInstrument(instrument.instrumentId) : upsertInstrument(instrument.instrumentId)}
                    />
                    <span>{instrument.label}</span>
                  </label>
                ))}
              </div>
            </details>
          </>
        )}
      </section>

      <button
        type="button"
        onClick={run}
        disabled={running || optimizeSelectionInvalid}
        style={{
          background: 'linear-gradient(135deg, #4f7cff, #3b82f6)',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          padding: '13px 16px',
          fontWeight: 900,
          fontSize: 15,
          cursor: running ? 'not-allowed' : 'pointer',
          opacity: running ? 0.72 : 1,
          boxShadow: '0 10px 28px rgba(59,130,246,0.28)',
        }}
      >
        {running ? 'Calculando...' : runButtonLabel}
      </button>

      {optimizeSelectionInvalid && (
        <div style={{ color: T.warning, fontSize: 12 }}>
          Para explorar combinación con instrumentos reales, selecciona 0, 2 o 3 instrumentos.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(255,80,80,0.15)', border: `1px solid ${T.negative}`, borderRadius: 12, padding: 12, color: T.textPrimary, fontSize: 12 }}>
          {error}
        </div>
      )}

      {result && (
        <section style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
          border: `1px solid ${T.border}`,
          borderRadius: 18,
          padding: 16,
          display: 'grid',
          gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: T.textMuted, fontSize: 12, fontWeight: 700 }}>{resultTitle}</div>
              <div style={{ color: T.textPrimary, fontWeight: 900, fontSize: 14 }}>{heroLabel}</div>
              <div style={{ color: T.primary, fontWeight: 900, fontSize: 30, lineHeight: 1.1 }}>{heroValue}</div>
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
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Duración 90%</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatDuration(durationTargets.success90.years, durationTargets.success90.censored)}</div>
                </div>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>Duración 95%</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatDuration(durationTargets.success95.years, durationTargets.success95.censored)}</div>
                </div>
                <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ color: T.textMuted, fontSize: 11 }}>P50 central</div>
                  <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatDuration(durationTargets.p50.years, durationTargets.p50.censored)}</div>
                </div>
              </>
            )}

            {resultMode !== 'duration' && (
              <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
                <div style={{ color: T.textMuted, fontSize: 11 }}>Éxito al horizonte</div>
                <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatPct(result.best.successAtHorizon)}</div>
              </div>
            )}

            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P50</div>
              <div style={{ color: T.textPrimary, fontSize: 16, fontWeight: 800 }}>{formatMoney(result.best.p50)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Terminal P10 / P90</div>
              <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700 }}>{formatMoney(result.best.p10)} · {formatMoney(result.best.p90)}</div>
            </div>
            <div style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ color: T.textMuted, fontSize: 11 }}>Mix</div>
              <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>{`RV ${((result.best.weights.rvGlobal + result.best.weights.rvChile) * 100).toFixed(1)}% · RF ${((result.best.weights.rfGlobal + result.best.weights.rfChile) * 100).toFixed(1)}%`}</div>
            </div>
          </div>

          <div style={{ color: T.textSecondary, fontSize: 13 }}>{summaryText}</div>

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
            <div style={{ color: T.textPrimary, fontSize: 12, background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10 }}>
              Mejor 3 instrumentos: {formatMoney(result.bestThreeInstruments.equivalentMonthlyClp)} · Mejor 2-de-3: {formatMoney(result.bestTwoOfThree.equivalentMonthlyClp)}.
              {' '}
              {result.bestTwoOfThree.equivalentMonthlyClp > result.bestThreeInstruments.equivalentMonthlyClp
                ? 'La alternativa 2-de-3 mejora este caso.'
                : 'La combinación de 3 instrumentos mantiene ventaja o empate.'}
            </div>
          )}
        </section>
      )}

      <details
        open={showAdvancedParams}
        onToggle={(e) => setShowAdvancedParams((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}
      >
        <summary style={{ color: T.textPrimary, fontWeight: 700, cursor: 'pointer' }}>Parámetros avanzados</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 10 }}>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            Umbral mínimo de éxito
            <input
              type="number"
              min={0.5}
              max={0.99}
              step={0.01}
              value={inputs.successThreshold}
              onChange={(e) => updateInput('successThreshold', Number(e.target.value) || 0.85)}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
            nSim
            <input
              type="number"
              min={200}
              max={5000}
              step={100}
              value={inputs.nSim}
              onChange={(e) => updateInput('nSim', Number(e.target.value) || 1000)}
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
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
              style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
            />
          </label>
        </div>
      </details>

      <details
        open={showAdvancedSpending}
        onToggle={(e) => setShowAdvancedSpending((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Fase 1 mensual (MM)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clpToMmInput(inputs.phase1MonthlyClp)}
                  onChange={(e) => updateInput('phase1MonthlyClp', mmToClp(Number(e.target.value) || 0))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Años fase 1
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={inputs.phase1Years}
                  onChange={(e) => updateInput('phase1Years', Number(e.target.value) || 1)}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, color: T.textPrimary, fontSize: 12 }}>
                Fase 2 mensual (MM)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clpToMmInput(inputs.phase2MonthlyClp)}
                  onChange={(e) => updateInput('phase2MonthlyClp', mmToClp(Number(e.target.value) || 0))}
                  style={{ background: T.surfaceEl, border: `1px solid ${T.border}`, borderRadius: 10, color: T.textPrimary, padding: '8px 10px' }}
                />
              </label>
            </div>
          )}
        </div>
      </details>

      <details
        open={showOptimization}
        onToggle={(e) => setShowOptimization((e.currentTarget as HTMLDetailsElement).open)}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}
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
                  type="number"
                  min={5}
                  max={25}
                  step={5}
                  value={inputs.gridStepPct}
                  onChange={(e) => updateInput('gridStepPct', Number(e.target.value) || 5)}
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
    </div>
  );
}
