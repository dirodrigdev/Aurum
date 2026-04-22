import {
  loadInstrumentUniverseSnapshot,
  type InstrumentUniverseInstrument,
} from '../instrumentUniverse';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type {
  FutureCapitalEvent,
  ModelParameters,
  PortfolioWeights,
  SimulationResults,
  SpendingPhase,
} from '../model/types';
import { runSimulationCentral } from './engineCentral';

export type AssistedSpendingMode = 'fixed' | 'two_phase';
export type AssistedPortfolioMode = 'manual' | 'optimize';
export type AssistedPortfolioEntryMode = 'amount' | 'percentage';

export type AssistedInstrumentOption = {
  instrumentId: string;
  label: string;
  name: string;
  currency: string;
  amountClp: number;
  weightPortfolio: number;
  sleeveWeights: PortfolioWeights;
};

export type AssistedPortfolioEntry = {
  instrumentId: string;
  amountClp: number;
  percentage: number;
};

export type AssistedInputs = {
  initialCapitalClp: number;
  extraContributionEnabled: boolean;
  extraContributionClp: number;
  extraContributionYear: number;
  horizonYears: number;
  spendingMode: AssistedSpendingMode;
  fixedMonthlyClp: number;
  phase1MonthlyClp: number;
  phase1Years: number;
  phase2MonthlyClp: number;
  portfolioMode: AssistedPortfolioMode;
  portfolioEntryMode: AssistedPortfolioEntryMode;
  portfolioEntries: AssistedPortfolioEntry[];
  includeTwoOfThreeCheck: boolean;
  successThreshold: number;
  gridStepPct: number;
  nSim: number;
  seed: number;
};

export type AssistedCandidateResult = {
  name: string;
  weights: PortfolioWeights;
  instrumentAllocationPct: Record<string, number>;
  sustainableMonthlyClp: number;
  phase1MonthlyClp: number;
  phase2MonthlyClp: number;
  equivalentMonthlyClp: number;
  success40: number;
  p10: number;
  p50: number;
  p90: number;
  fanChartData: SimulationResults['fanChartData'];
  rawResult: SimulationResults;
};

export type AssistedOptimizationResult = {
  mode: 'manual' | 'rf_rv' | 'instrument_two' | 'instrument_three';
  best: AssistedCandidateResult;
  bestThreeInstruments?: AssistedCandidateResult;
  bestTwoOfThree?: AssistedCandidateResult;
  evaluatedCandidates: number;
  effectiveInitialCapitalClp: number;
  selectedInstrumentCount: number;
  entryMode: AssistedPortfolioEntryMode;
};

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ym = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const addMonths = (yearMonth: string, deltaMonths: number): string => {
  const [yearRaw, monthRaw] = yearMonth.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return yearMonth;
  const idx = year * 12 + (month - 1) + Math.max(0, Math.round(deltaMonths));
  const nextYear = Math.floor(idx / 12);
  const nextMonth = (idx % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const normalizeWeights = (weights: PortfolioWeights): PortfolioWeights => {
  const rvGlobal = Math.max(0, weights.rvGlobal);
  const rvChile = Math.max(0, weights.rvChile);
  const rfGlobal = Math.max(0, weights.rfGlobal);
  const rfChile = Math.max(0, weights.rfChile);
  const sum = rvGlobal + rvChile + rfGlobal + rfChile;
  if (sum <= 0) return deepClone(DEFAULT_PARAMETERS.weights);
  return {
    rvGlobal: rvGlobal / sum,
    rvChile: rvChile / sum,
    rfGlobal: rfGlobal / sum,
    rfChile: rfChile / sum,
  };
};

const normalizeShare = (value: number | null | undefined): number | null => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  if (Math.abs(raw) > 1) return clamp(raw / 100, 0, 1);
  return clamp(raw, 0, 1);
};

const resolveExposure = (instrument: InstrumentUniverseInstrument): { global: number; local: number } => {
  const globalShare = normalizeShare(instrument.exposureUsed?.global ?? null);
  const localShare = normalizeShare(instrument.exposureUsed?.local ?? null);
  if (globalShare !== null && localShare !== null) {
    const sum = globalShare + localShare;
    if (sum > 0) return { global: globalShare / sum, local: localShare / sum };
  }
  if (globalShare !== null) return { global: globalShare, local: 1 - globalShare };
  if (localShare !== null) return { global: 1 - localShare, local: localShare };

  const currency = String(instrument.currency ?? '').toUpperCase();
  if (currency === 'CLP' || currency === 'UF') return { global: 0, local: 1 };
  if (currency === 'USD' || currency === 'EUR') return { global: 1, local: 0 };
  return { global: 0.5, local: 0.5 };
};

const resolveCashReceiver = (): 'rfGlobal' | 'rfChile' =>
  DEFAULT_PARAMETERS.returns.rfGlobalAnnual <= DEFAULT_PARAMETERS.returns.rfChileUFAnnual ? 'rfGlobal' : 'rfChile';

const instrumentToSleeves = (instrument: InstrumentUniverseInstrument): PortfolioWeights => {
  const mix = instrument.currentMixUsed;
  if (!mix) return deepClone(DEFAULT_PARAMETERS.weights);
  const exposure = resolveExposure(instrument);
  const rv = clamp(mix.rv, 0, 1);
  const rf = clamp(mix.rf, 0, 1);
  const cashOther = clamp(mix.cash, 0, 1) + clamp(mix.other, 0, 1);

  const base: PortfolioWeights = {
    rvGlobal: rv * exposure.global,
    rvChile: rv * exposure.local,
    rfGlobal: rf * exposure.global,
    rfChile: rf * exposure.local,
  };
  const cashReceiver = resolveCashReceiver();
  base[cashReceiver] += cashOther;
  return normalizeWeights(base);
};

const instrumentLabel = (instrument: InstrumentUniverseInstrument): string => {
  const name = String(instrument.name ?? '').trim() || instrument.instrumentId;
  const currency = String(instrument.currency ?? '').trim();
  return currency ? `${name} · ${currency}` : name;
};

export function loadAssistedInstrumentOptions(): AssistedInstrumentOption[] {
  const snapshot = loadInstrumentUniverseSnapshot();
  if (!snapshot) return [];
  return snapshot.instruments
    .filter((instrument) => instrument.usable && !!instrument.currentMixUsed && !!instrument.instrumentId)
    .map((instrument) => ({
      instrumentId: instrument.instrumentId,
      label: instrumentLabel(instrument),
      name: String(instrument.name ?? instrument.instrumentId),
      currency: String(instrument.currency ?? 'N/A'),
      amountClp: Math.max(0, Number(instrument.amountClp ?? 0)),
      weightPortfolio: Math.max(0, Number(instrument.weightPortfolio ?? 0)),
      sleeveWeights: instrumentToSleeves(instrument),
    }))
    .sort((a, b) => {
      if (b.weightPortfolio !== a.weightPortfolio) return b.weightPortfolio - a.weightPortfolio;
      return a.label.localeCompare(b.label, 'es');
    });
}

const labelWeights = (weights: PortfolioWeights): string =>
  `RV ${(weights.rvGlobal * 100 + weights.rvChile * 100).toFixed(0)} / RF ${(weights.rfGlobal * 100 + weights.rfChile * 100).toFixed(0)}`;

const percentile = (values: number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
};

const resolveTerminalPercentiles = (result: SimulationResults): { p10: number; p50: number; p90: number } => {
  const allPaths = result.terminalWealthAllPaths?.filter((v) => Number.isFinite(v)) ?? [];
  if (allPaths.length > 0) {
    return {
      p10: percentile(allPaths, 0.1),
      p50: percentile(allPaths, 0.5),
      p90: percentile(allPaths, 0.9),
    };
  }
  return {
    p10: result.terminalWealthPercentiles[25] ?? Number.NaN,
    p50: result.p50TerminalAllPaths ?? result.terminalWealthPercentiles[50] ?? Number.NaN,
    p90: result.terminalWealthPercentiles[75] ?? Number.NaN,
  };
};

const buildSpendingPhases = (input: AssistedInputs, scale: number): SpendingPhase[] => {
  const horizonMonths = Math.max(48, Math.round(input.horizonYears * 12));
  if (input.spendingMode === 'fixed') {
    return [{
      durationMonths: horizonMonths,
      amountReal: Math.max(0, input.fixedMonthlyClp * scale),
      currency: 'CLP',
    }];
  }
  const phase1MonthsRaw = Math.round(input.phase1Years * 12);
  const phase1Months = clamp(phase1MonthsRaw, 1, Math.max(1, horizonMonths - 1));
  const phase2Months = Math.max(1, horizonMonths - phase1Months);
  return [
    {
      durationMonths: phase1Months,
      amountReal: Math.max(0, input.phase1MonthlyClp * scale),
      currency: 'CLP',
    },
    {
      durationMonths: phase2Months,
      amountReal: Math.max(0, input.phase2MonthlyClp * scale),
      currency: 'CLP',
    },
  ];
};

const equivalentMonthly = (input: AssistedInputs, scale: number): number => {
  if (input.spendingMode === 'fixed') return Math.max(0, input.fixedMonthlyClp * scale);
  const horizonMonths = Math.max(48, Math.round(input.horizonYears * 12));
  const phase1MonthsRaw = Math.round(input.phase1Years * 12);
  const phase1Months = clamp(phase1MonthsRaw, 1, Math.max(1, horizonMonths - 1));
  const phase2Months = Math.max(1, horizonMonths - phase1Months);
  const total = (input.phase1MonthlyClp * scale * phase1Months) + (input.phase2MonthlyClp * scale * phase2Months);
  return total / horizonMonths;
};

const toStep = (pct: number, step: number): number => Math.round(pct / step) * step;

const manualWeightsFromRv = (rvPct: number): PortfolioWeights => {
  const base = DEFAULT_PARAMETERS.weights;
  const rvShareGlobal = (base.rvGlobal + base.rvChile) > 0 ? base.rvGlobal / (base.rvGlobal + base.rvChile) : 0.5;
  const rfShareGlobal = (base.rfGlobal + base.rfChile) > 0 ? base.rfGlobal / (base.rfGlobal + base.rfChile) : 0.5;
  const rv = clamp(rvPct, 0, 100) / 100;
  const rf = 1 - rv;
  return {
    rvGlobal: rv * rvShareGlobal,
    rvChile: rv * (1 - rvShareGlobal),
    rfGlobal: rf * rfShareGlobal,
    rfChile: rf * (1 - rfShareGlobal),
  };
};

const generateRvRfCandidates = (step: number): Array<{ name: string; weights: PortfolioWeights; allocation: Record<string, number> }> => {
  const normalizedStep = clamp(toStep(step, 5), 5, 25);
  const out: Array<{ name: string; weights: PortfolioWeights; allocation: Record<string, number> }> = [];
  for (let rv = 0; rv <= 100; rv += normalizedStep) {
    const weights = manualWeightsFromRv(rv);
    out.push({ name: `RV/RF · ${rv}% RV`, weights, allocation: {} });
  }
  return out;
};

const normalizeAllocation = (allocation: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(allocation).map(([k, v]) => [k, Math.max(0, Number(v))] as const);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  if (total <= 0) return Object.fromEntries(entries.map(([k]) => [k, 0]));
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
};

const weightsFromInstrumentAllocation = (
  allocation: Record<string, number>,
  optionsById: Map<string, AssistedInstrumentOption>,
): PortfolioWeights => {
  const normalized = normalizeAllocation(allocation);
  const sum = Object.entries(normalized).reduce((acc, [instrumentId, ratio]) => {
    const option = optionsById.get(instrumentId);
    if (!option || ratio <= 0) return acc;
    acc.rvGlobal += option.sleeveWeights.rvGlobal * ratio;
    acc.rvChile += option.sleeveWeights.rvChile * ratio;
    acc.rfGlobal += option.sleeveWeights.rfGlobal * ratio;
    acc.rfChile += option.sleeveWeights.rfChile * ratio;
    return acc;
  }, {
    rvGlobal: 0,
    rvChile: 0,
    rfGlobal: 0,
    rfChile: 0,
  } as PortfolioWeights);
  return normalizeWeights(sum);
};

const generateTwoInstrumentCandidates = (ids: [string, string], step: number) => {
  const normalizedStep = clamp(toStep(step, 5), 5, 25);
  const out: Array<{ allocation: Record<string, number> }> = [];
  for (let a = 0; a <= 100; a += normalizedStep) {
    out.push({ allocation: normalizeAllocation({ [ids[0]]: a / 100, [ids[1]]: (100 - a) / 100 }) });
  }
  return out;
};

const generateThreeInstrumentCandidates = (ids: [string, string, string], step: number) => {
  const normalizedStep = clamp(toStep(step, 5), 5, 25);
  const out: Array<{ allocation: Record<string, number> }> = [];
  for (let a = 0; a <= 100; a += normalizedStep) {
    for (let b = 0; b <= 100 - a; b += normalizedStep) {
      const c = 100 - a - b;
      if (c < 0 || c % normalizedStep !== 0) continue;
      out.push({ allocation: normalizeAllocation({ [ids[0]]: a / 100, [ids[1]]: b / 100, [ids[2]]: c / 100 }) });
    }
  }
  return out;
};

const resolveInstrumentEntries = (
  input: AssistedInputs,
  optionsById: Map<string, AssistedInstrumentOption>,
): Array<{ instrumentId: string; amountClp: number; percentage: number }> => {
  const rows = input.portfolioEntries
    .map((entry) => ({
      instrumentId: entry.instrumentId,
      amountClp: Math.max(0, Number(entry.amountClp ?? 0)),
      percentage: Math.max(0, Number(entry.percentage ?? 0)),
    }))
    .filter((entry) => optionsById.has(entry.instrumentId));
  return rows;
};

const resolveEffectiveInitialCapital = (
  input: AssistedInputs,
  entries: Array<{ instrumentId: string; amountClp: number; percentage: number }>,
): number => {
  const baseInitial = Math.max(1, Number(input.initialCapitalClp || 0));
  if (input.portfolioEntryMode !== 'amount') return baseInitial;
  const invested = entries.reduce((sum, row) => sum + row.amountClp, 0);
  return Math.max(1, invested || baseInitial);
};

const manualAllocationFromEntries = (
  input: AssistedInputs,
  entries: Array<{ instrumentId: string; amountClp: number; percentage: number }>,
): Record<string, number> => {
  if (input.portfolioEntryMode === 'percentage') {
    const totalPct = entries.reduce((sum, row) => sum + row.percentage, 0);
    if (totalPct <= 0) throw new Error('En modo porcentaje debes ingresar porcentajes por instrumento.');
    if (Math.abs(totalPct - 100) > 0.5) {
      throw new Error(`En modo porcentaje la suma debe ser 100% (actual ${(totalPct).toFixed(1)}%).`);
    }
    return normalizeAllocation(Object.fromEntries(entries.map((row) => [row.instrumentId, row.percentage / 100])));
  }
  const invested = entries.reduce((sum, row) => sum + row.amountClp, 0);
  if (invested <= 0) throw new Error('En modo monto debes ingresar montos CLP por instrumento.');
  return normalizeAllocation(Object.fromEntries(entries.map((row) => [row.instrumentId, row.amountClp])));
};

const baseParamsFromInput = (input: AssistedInputs, effectiveInitialCapital: number): ModelParameters => {
  const base = deepClone(DEFAULT_PARAMETERS);
  const horizonMonths = Math.max(48, Math.round(input.horizonYears * 12));
  const nowYm = ym(new Date());
  const futureEvents: FutureCapitalEvent[] = [];
  if (input.extraContributionEnabled && input.extraContributionClp > 0) {
    futureEvents.push({
      id: 'assisted-extra-contribution',
      type: 'inflow',
      amount: Math.max(0, input.extraContributionClp),
      currency: 'CLP',
      effectiveDate: addMonths(nowYm, Math.round(clamp(input.extraContributionYear, 0, 40) * 12)),
      description: 'Aporte único asistido',
    });
  }
  return {
    ...base,
    label: 'Simulación Asistida',
    capitalSource: 'manual',
    capitalInitial: effectiveInitialCapital,
    manualCapitalInput: { financialCapitalCLP: effectiveInitialCapital },
    simulationBaseMonth: nowYm,
    simulation: {
      ...base.simulation,
      nSim: Math.max(200, Math.round(input.nSim)),
      seed: Math.max(1, Math.round(input.seed)),
      horizonMonths,
      useHistoricalData: false,
      blockLength: 12,
    },
    spendingPhases: buildSpendingPhases(input, 1),
    weights: deepClone(DEFAULT_PARAMETERS.weights),
    futureCapitalEvents: futureEvents,
    simulationComposition: {
      mode: 'legacy',
      totalNetWorthCLP: effectiveInitialCapital,
      optimizableInvestmentsCLP: effectiveInitialCapital,
      nonOptimizable: {
        banksCLP: 0,
        nonMortgageDebtCLP: 0,
      },
      diagnostics: {
        sourceVersion: 1,
        mode: 'legacy',
        compositionGapCLP: 0,
        compositionGapPct: 0,
        notes: ['assisted-simulation'],
      },
    },
    realEstatePolicy: {
      enabled: false,
      triggerRunwayMonths: 36,
      saleDelayMonths: 12,
      saleCostPct: 0,
      realAppreciationAnnual: 0,
    },
    cashflowEvents: [],
  };
};

const evaluateScenario = (
  base: ModelParameters,
  input: AssistedInputs,
  weights: PortfolioWeights,
  scale: number,
): SimulationResults => {
  const candidate: ModelParameters = {
    ...base,
    weights,
    spendingPhases: buildSpendingPhases(input, scale),
  };
  return runSimulationCentral(candidate);
};

const success40 = (result: SimulationResults): number =>
  result.success40 ?? (1 - (result.probRuin40 ?? result.probRuin));

const maximizeSpendingScale = (
  base: ModelParameters,
  input: AssistedInputs,
  weights: PortfolioWeights,
): { scale: number; result: SimulationResults } => {
  const threshold = clamp(input.successThreshold, 0.5, 0.99);
  let low = 0;
  let high = 1;
  let highResult = evaluateScenario(base, input, weights, high);
  let guard = 0;
  while (success40(highResult) >= threshold && guard < 10) {
    low = high;
    high *= 1.6;
    highResult = evaluateScenario(base, input, weights, high);
    guard += 1;
  }
  let bestScale = low;
  let bestResult = evaluateScenario(base, input, weights, Math.max(0.0001, low));
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    const midResult = evaluateScenario(base, input, weights, mid);
    if (success40(midResult) >= threshold) {
      bestScale = mid;
      bestResult = midResult;
      low = mid;
    } else {
      high = mid;
    }
  }
  return { scale: bestScale, result: bestResult };
};

const toCandidateResult = (
  name: string,
  input: AssistedInputs,
  weights: PortfolioWeights,
  scale: number,
  result: SimulationResults,
  instrumentAllocationPct: Record<string, number>,
): AssistedCandidateResult => {
  const { p10, p50, p90 } = resolveTerminalPercentiles(result);
  return {
    name,
    weights,
    instrumentAllocationPct,
    sustainableMonthlyClp: equivalentMonthly(input, scale),
    phase1MonthlyClp: input.spendingMode === 'fixed' ? input.fixedMonthlyClp * scale : input.phase1MonthlyClp * scale,
    phase2MonthlyClp: input.spendingMode === 'fixed' ? input.fixedMonthlyClp * scale : input.phase2MonthlyClp * scale,
    equivalentMonthlyClp: equivalentMonthly(input, scale),
    success40: success40(result),
    p10,
    p50,
    p90,
    fanChartData: result.fanChartData,
    rawResult: result,
  };
};

const pickBest = (rows: AssistedCandidateResult[]): AssistedCandidateResult =>
  [...rows].sort((a, b) => {
    if (b.equivalentMonthlyClp !== a.equivalentMonthlyClp) return b.equivalentMonthlyClp - a.equivalentMonthlyClp;
    if (b.success40 !== a.success40) return b.success40 - a.success40;
    return b.p50 - a.p50;
  })[0];

export function runAssistedSimulation(
  input: AssistedInputs,
  availableInstruments: AssistedInstrumentOption[],
): AssistedOptimizationResult {
  const optionsById = new Map(availableInstruments.map((item) => [item.instrumentId, item]));
  const entries = resolveInstrumentEntries(input, optionsById);
  const effectiveInitialCapital = resolveEffectiveInitialCapital(input, entries);
  const base = baseParamsFromInput(input, effectiveInitialCapital);

  if (input.portfolioMode === 'manual') {
    if (entries.length === 0) {
      throw new Error('Selecciona al menos un instrumento real para ejecutar modo manual.');
    }
    const allocation = manualAllocationFromEntries(input, entries);
    const manualWeights = weightsFromInstrumentAllocation(allocation, optionsById);
    const result = evaluateScenario(base, input, manualWeights, 1);
    const row = toCandidateResult(
      `Manual instrumentos · ${labelWeights(manualWeights)}`,
      input,
      manualWeights,
      1,
      result,
      allocation,
    );
    return {
      mode: 'manual',
      best: row,
      evaluatedCandidates: 1,
      effectiveInitialCapitalClp: effectiveInitialCapital,
      selectedInstrumentCount: entries.length,
      entryMode: input.portfolioEntryMode,
    };
  }

  const selectedIds = entries.map((entry) => entry.instrumentId);
  if (selectedIds.length === 1 || selectedIds.length > 3) {
    throw new Error('Modo optimizar requiere 0, 2 o 3 instrumentos seleccionados.');
  }

  let mode: AssistedOptimizationResult['mode'] = 'rf_rv';
  const candidates: Array<{ name: string; weights: PortfolioWeights; allocation: Record<string, number> }> = [];

  if (selectedIds.length === 0) {
    mode = 'rf_rv';
    candidates.push(...generateRvRfCandidates(input.gridStepPct));
  } else if (selectedIds.length === 2) {
    mode = 'instrument_two';
    const pair = [selectedIds[0], selectedIds[1]] as [string, string];
    generateTwoInstrumentCandidates(pair, input.gridStepPct).forEach((item, idx) => {
      const weights = weightsFromInstrumentAllocation(item.allocation, optionsById);
      candidates.push({
        name: `${optionsById.get(pair[0])?.name ?? pair[0]} / ${optionsById.get(pair[1])?.name ?? pair[1]} · caso ${idx + 1}`,
        weights,
        allocation: item.allocation,
      });
    });
  } else {
    mode = 'instrument_three';
    const trio = [selectedIds[0], selectedIds[1], selectedIds[2]] as [string, string, string];
    generateThreeInstrumentCandidates(trio, input.gridStepPct).forEach((item, idx) => {
      const weights = weightsFromInstrumentAllocation(item.allocation, optionsById);
      candidates.push({
        name: `${trio.map((id) => optionsById.get(id)?.name ?? id).join(' + ')} · caso ${idx + 1}`,
        weights,
        allocation: item.allocation,
      });
    });
  }

  const evaluated: AssistedCandidateResult[] = [];
  for (const candidate of candidates) {
    const optimal = maximizeSpendingScale(base, input, candidate.weights);
    evaluated.push(toCandidateResult(candidate.name, input, candidate.weights, optimal.scale, optimal.result, candidate.allocation));
  }
  const best = pickBest(evaluated);

  if (mode !== 'instrument_three' || !input.includeTwoOfThreeCheck || selectedIds.length !== 3) {
    return {
      mode,
      best,
      evaluatedCandidates: evaluated.length,
      effectiveInitialCapitalClp: effectiveInitialCapital,
      selectedInstrumentCount: selectedIds.length,
      entryMode: input.portfolioEntryMode,
    };
  }

  const subsets: Array<[string, string]> = [
    [selectedIds[0], selectedIds[1]],
    [selectedIds[0], selectedIds[2]],
    [selectedIds[1], selectedIds[2]],
  ];

  const subsetRows: AssistedCandidateResult[] = [];
  for (const [a, b] of subsets) {
    const subsetCandidates = generateTwoInstrumentCandidates([a, b], input.gridStepPct);
    const subsetEvaluated: AssistedCandidateResult[] = [];
    for (const candidate of subsetCandidates) {
      const weights = weightsFromInstrumentAllocation(candidate.allocation, optionsById);
      const optimal = maximizeSpendingScale(base, input, weights);
      subsetEvaluated.push(
        toCandidateResult(
          `Subset ${(optionsById.get(a)?.name ?? a)} + ${(optionsById.get(b)?.name ?? b)}`,
          input,
          weights,
          optimal.scale,
          optimal.result,
          candidate.allocation,
        ),
      );
    }
    subsetRows.push(pickBest(subsetEvaluated));
  }
  const bestTwoOfThree = pickBest(subsetRows);

  return {
    mode,
    best,
    bestThreeInstruments: best,
    bestTwoOfThree,
    evaluatedCandidates: evaluated.length + subsets.length * (Math.round(100 / clamp(toStep(input.gridStepPct, 5), 5, 25)) + 1),
    effectiveInitialCapitalClp: effectiveInitialCapital,
    selectedInstrumentCount: selectedIds.length,
    entryMode: input.portfolioEntryMode,
  };
}
