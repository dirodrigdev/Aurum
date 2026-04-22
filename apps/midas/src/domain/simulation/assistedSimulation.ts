import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { FutureCapitalEvent, ModelParameters, PortfolioWeights, SimulationResults, SpendingPhase } from '../model/types';
import { runSimulationCentral } from './engineCentral';

export type AssistedSpendingMode = 'fixed' | 'two_phase';
export type AssistedPortfolioMode = 'manual' | 'optimize';
export type AssistedFundId = 'eq_global' | 'eq_chile' | 'fi_global' | 'fi_chile';

export type AssistedFundOption = {
  id: AssistedFundId;
  label: string;
};

export const ASSISTED_FUND_OPTIONS: AssistedFundOption[] = [
  { id: 'eq_global', label: 'RV Global' },
  { id: 'eq_chile', label: 'RV Chile' },
  { id: 'fi_global', label: 'RF Global' },
  { id: 'fi_chile', label: 'RF Chile' },
];

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
  manualRvPct: number;
  selectedFunds: AssistedFundId[];
  includeTwoOfThreeCheck: boolean;
  successThreshold: number;
  gridStepPct: number;
  nSim: number;
  seed: number;
};

export type AssistedCandidateResult = {
  name: string;
  weights: PortfolioWeights;
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
  mode: 'manual' | 'rf_rv' | 'two_funds' | 'three_funds';
  best: AssistedCandidateResult;
  bestThreeFunds?: AssistedCandidateResult;
  bestTwoOfThree?: AssistedCandidateResult;
  evaluatedCandidates: number;
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

const asSleeveWeights = (allocation: Partial<Record<AssistedFundId, number>>): PortfolioWeights => {
  const eqGlobal = Math.max(0, Number(allocation.eq_global ?? 0));
  const eqChile = Math.max(0, Number(allocation.eq_chile ?? 0));
  const fiGlobal = Math.max(0, Number(allocation.fi_global ?? 0));
  const fiChile = Math.max(0, Number(allocation.fi_chile ?? 0));
  const sum = eqGlobal + eqChile + fiGlobal + fiChile;
  if (sum <= 0) {
    return deepClone(DEFAULT_PARAMETERS.weights);
  }
  return {
    rvGlobal: eqGlobal / sum,
    rvChile: eqChile / sum,
    rfGlobal: fiGlobal / sum,
    rfChile: fiChile / sum,
  };
};

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

const toStep = (pct: number, step: number): number => Math.round(pct / step) * step;

const generateRvRfCandidates = (step: number): PortfolioWeights[] => {
  const normalizedStep = clamp(toStep(step, 5), 5, 25);
  const out: PortfolioWeights[] = [];
  for (let rv = 0; rv <= 100; rv += normalizedStep) {
    out.push(manualWeightsFromRv(rv));
  }
  return out;
};

const generateTwoFundCandidates = (a: AssistedFundId, b: AssistedFundId, step: number): PortfolioWeights[] => {
  const normalizedStep = clamp(toStep(step, 5), 5, 25);
  const out: PortfolioWeights[] = [];
  for (let wa = 0; wa <= 100; wa += normalizedStep) {
    const wb = 100 - wa;
    out.push(asSleeveWeights({
      [a]: wa / 100,
      [b]: wb / 100,
    }));
  }
  return out;
};

const generateThreeFundCandidates = (a: AssistedFundId, b: AssistedFundId, c: AssistedFundId, step: number): PortfolioWeights[] => {
  const normalizedStep = clamp(toStep(step, 5), 5, 25);
  const out: PortfolioWeights[] = [];
  for (let wa = 0; wa <= 100; wa += normalizedStep) {
    for (let wb = 0; wb <= 100 - wa; wb += normalizedStep) {
      const wc = 100 - wa - wb;
      if (wc < 0 || wc % normalizedStep !== 0) continue;
      out.push(asSleeveWeights({
        [a]: wa / 100,
        [b]: wb / 100,
        [c]: wc / 100,
      }));
    }
  }
  return out;
};

const baseParamsFromInput = (input: AssistedInputs): ModelParameters => {
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
    capitalInitial: Math.max(1, input.initialCapitalClp),
    manualCapitalInput: { financialCapitalCLP: Math.max(1, input.initialCapitalClp) },
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
    weights: manualWeightsFromRv(input.manualRvPct),
    futureCapitalEvents: futureEvents,
    simulationComposition: {
      mode: 'legacy',
      totalNetWorthCLP: Math.max(1, input.initialCapitalClp),
      optimizableInvestmentsCLP: Math.max(1, input.initialCapitalClp),
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

const evaluateScenario = (base: ModelParameters, input: AssistedInputs, weights: PortfolioWeights, scale: number): SimulationResults => {
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
): AssistedCandidateResult => {
  const { p10, p50, p90 } = resolveTerminalPercentiles(result);
  return {
    name,
    weights,
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

export function runAssistedSimulation(input: AssistedInputs): AssistedOptimizationResult {
  const base = baseParamsFromInput(input);
  if (input.portfolioMode === 'manual') {
    const manualWeights = manualWeightsFromRv(input.manualRvPct);
    const result = evaluateScenario(base, input, manualWeights, 1);
    const row = toCandidateResult(`Manual · ${labelWeights(manualWeights)}`, input, manualWeights, 1, result);
    return {
      mode: 'manual',
      best: row,
      evaluatedCandidates: 1,
    };
  }

  const selected = [...new Set(input.selectedFunds)];
  let candidates: { name: string; weights: PortfolioWeights }[] = [];
  let mode: AssistedOptimizationResult['mode'] = 'rf_rv';
  if (selected.length === 2) {
    mode = 'two_funds';
    candidates = generateTwoFundCandidates(selected[0], selected[1], input.gridStepPct)
      .map((weights, idx) => ({
        name: `${selected[0]} / ${selected[1]} · caso ${idx + 1}`,
        weights,
      }));
  } else if (selected.length === 3) {
    mode = 'three_funds';
    candidates = generateThreeFundCandidates(selected[0], selected[1], selected[2], input.gridStepPct)
      .map((weights, idx) => ({
        name: `${selected.join(' + ')} · caso ${idx + 1}`,
        weights,
      }));
  } else {
    mode = 'rf_rv';
    candidates = generateRvRfCandidates(input.gridStepPct)
      .map((weights, idx) => ({
        name: `RV/RF · caso ${idx + 1}`,
        weights,
      }));
  }

  const evaluated: AssistedCandidateResult[] = [];
  for (const candidate of candidates) {
    const optimal = maximizeSpendingScale(base, input, candidate.weights);
    evaluated.push(toCandidateResult(candidate.name, input, candidate.weights, optimal.scale, optimal.result));
  }
  const best = pickBest(evaluated);

  if (mode !== 'three_funds' || !input.includeTwoOfThreeCheck || selected.length !== 3) {
    return {
      mode,
      best,
      evaluatedCandidates: evaluated.length,
    };
  }

  const subsets: Array<[AssistedFundId, AssistedFundId]> = [
    [selected[0], selected[1]],
    [selected[0], selected[2]],
    [selected[1], selected[2]],
  ];
  const subsetRows: AssistedCandidateResult[] = [];
  for (const [a, b] of subsets) {
    const subsetCandidates = generateTwoFundCandidates(a, b, input.gridStepPct);
    const subsetEvaluated: AssistedCandidateResult[] = [];
    for (const weights of subsetCandidates) {
      const optimal = maximizeSpendingScale(base, input, weights);
      subsetEvaluated.push(toCandidateResult(`Subset ${a}+${b}`, input, weights, optimal.scale, optimal.result));
    }
    subsetRows.push(pickBest(subsetEvaluated));
  }
  const bestTwoOfThree = pickBest(subsetRows);

  return {
    mode,
    best,
    bestThreeFunds: best,
    bestTwoOfThree,
    evaluatedCandidates: evaluated.length + subsets.length * (Math.round(100 / clamp(toStep(input.gridStepPct, 5), 5, 25)) + 1),
  };
}
