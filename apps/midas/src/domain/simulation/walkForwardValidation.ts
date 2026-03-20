import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import { runSimulationCoreWithHistoricalData } from './engine';
import { loadHistoricalData } from './historicalData';

type WalkForwardCut = {
  trainEnd: string;
  testPeriod: string;
  trainEndIndex: number;
  testStartIndex: number;
  testEndIndex: number;
};

type WalkForwardResult = {
  trainEnd: string;
  testPeriod: string;
  realFinalWealth: number;
  p10: number;
  p50: number;
  p90: number;
  bucketReal: 'below_p10' | 'within_p10_p90' | 'above_p90';
  probRuin: number;
  observedRuin: boolean;
  ruinConsistency: string;
  errorP50VsReal: number;
};

const START_YEAR = 2000;
const START_MONTH = 1;
const SLEEVE_KEYS = ['rvGlobal', 'rfGlobal', 'rvChile', 'rfChile'] as const;
const CASHFLOW_WATERFALL_ORDER = [3, 1, 2, 0] as const;

function cloneParams(params: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(params)) as ModelParameters;
}

function monthIndex(year: number, month: number): number {
  return ((year - START_YEAR) * 12) + (month - START_MONTH);
}

function formatPeriod(startIndex: number, endIndex: number): string {
  const startYear = START_YEAR + Math.floor((START_MONTH - 1 + startIndex) / 12);
  const startMonth = ((START_MONTH - 1 + startIndex) % 12) + 1;
  const endYear = START_YEAR + Math.floor((START_MONTH - 1 + endIndex) / 12);
  const endMonth = ((START_MONTH - 1 + endIndex) % 12) + 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')} a ${endYear}-${String(endMonth).padStart(2, '0')}`;
}

function applyCashflowEvents(
  sl: number[],
  cashflowEvents: ModelParameters['cashflowEvents'],
  month: number,
  CPU_t: number,
  EURUSDt: number,
): void {
  for (const ev of cashflowEvents.filter(e => e.month === month)) {
    let amountCLP = ev.amount;
    if (ev.currency === 'USD') amountCLP *= CPU_t;
    if (ev.currency === 'EUR') amountCLP *= EURUSDt * CPU_t;

    if (ev.type === 'inflow') {
      const idx = ev.sleeve ? SLEEVE_KEYS.indexOf(ev.sleeve) : 3;
      if (idx >= 0) sl[idx] += amountCLP;
      continue;
    }

    let remaining = amountCLP;
    const preferredIdx = ev.sleeve ? SLEEVE_KEYS.indexOf(ev.sleeve) : -1;
    const order = preferredIdx >= 0
      ? [preferredIdx, ...CASHFLOW_WATERFALL_ORDER.filter(i => i !== preferredIdx)]
      : [...CASHFLOW_WATERFALL_ORDER];

    for (const idx of order) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(0, sl[idx]));
      sl[idx] -= take;
      remaining -= take;
    }
  }
}

function runObservedHistoricalPath(
  params: ModelParameters,
  observedPath: number[][],
): { finalWealth: number; observedRuin: boolean } {
  const {
    capitalInitial: W0,
    weights,
    feeAnnual,
    spendingPhases,
    spendingRule,
    fx,
    ruinThresholdMonths,
  } = params;

  let sl = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile].map(w => w * W0);
  let cumCL = 1;
  let logCPU = Math.log(fx.clpUsdInitial);
  let logCPUr = 0;
  let logEURUSD = Math.log(fx.usdEurFixed);
  let hwm = W0;
  let smult = 1;
  let cnt15 = 0;
  let cnt25 = 0;

  for (let t = 0; t < observedPath.length; t++) {
    const row = observedPath[t];
    const rRVg = row[0];
    const rRFg = row[1];
    const rRVcl = (0.55 * row[2]) + (0.45 * row[3]);
    const ipcM = row[5];
    const rRFcl = ((1 + row[4]) * (1 + ipcM)) - 1;
    const dLogFX = row[7];
    const dLogEURUSD = row[8];

    cumCL *= (1 + ipcM);

    const logLT = Math.log(fx.tcrealLT / fx.clpUsdInitial);
    const uPrev = logCPUr - logLT;
    logCPU += dLogFX + (Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12)) * uPrev - uPrev);
    logCPUr = logCPU - Math.log(cumCL);
    const CPU_t = Math.exp(logCPU);
    logEURUSD += dLogEURUSD;
    const EURUSDt = Math.exp(logEURUSD);
    const dFX = Math.exp(dLogFX) - 1;

    sl[0] *= (1 + rRVg + dFX + rRVg * dFX);
    sl[1] *= (1 + rRFg + dFX);
    sl[2] *= (1 + rRVcl);
    sl[3] *= (1 + rRFcl);

    const W = sl.reduce((a, b) => a + b, 0);
    const ff = (W - W * feeAnnual / 12) / W;
    sl = sl.map(x => x * ff);
    applyCashflowEvents(sl, params.cashflowEvents, t + 1, CPU_t, EURUSDt);
    const Wp = sl.reduce((a, b) => a + b, 0);

    const Wr = Wp / cumCL;
    if (Wr > hwm) hwm = Wr;
    const dd = (Wr - hwm) / hwm;

    cnt15 = dd <= -0.15 ? cnt15 + 1 : 0;
    cnt25 = dd <= -0.25 ? cnt25 + 1 : 0;
    let tgt = 1;
    if (cnt25 >= spendingRule.consecutiveMonths) tgt = spendingRule.hardCut;
    else if (cnt15 >= spendingRule.consecutiveMonths) tgt = spendingRule.softCut;
    smult += spendingRule.adjustmentAlpha * (tgt - smult);

    const mes = t + 1;
    let GB = 0;
    let phaseStart = 0;
    for (const ph of spendingPhases) {
      if (mes <= phaseStart + ph.durationMonths) {
        GB = ph.currency === 'EUR' ? ph.amountReal * EURUSDt * CPU_t : ph.amountReal * cumCL;
        break;
      }
      phaseStart += ph.durationMonths;
    }
    const G = GB * smult;

    if (Wp <= ruinThresholdMonths * G) {
      return { finalWealth: 0, observedRuin: true };
    }

    const Wfin = sl.reduce((a, b) => a + b, 0);
    sl = sl.map(x => x - G * (x / Wfin));
  }

  return {
    finalWealth: sl.reduce((a, b) => a + b, 0),
    observedRuin: false,
  };
}

function buildWalkForwardCuts(totalMonths: number): WalkForwardCut[] {
  const requested = [
    { trainYear: 2008, trainMonth: 12, testEndYear: 2018, testEndMonth: 12 },
    { trainYear: 2010, trainMonth: 12, testEndYear: 2020, testEndMonth: 12 },
    { trainYear: 2012, trainMonth: 12, testEndYear: 2022, testEndMonth: 12 },
    { trainYear: 2014, trainMonth: 12, testEndYear: 2024, testEndMonth: 12 },
    { trainYear: 2016, trainMonth: 12, testEndYear: 2026, testEndMonth: 2 },
  ];

  return requested.map((cut) => {
    const trainEndIndex = monthIndex(cut.trainYear, cut.trainMonth);
    const testStartIndex = trainEndIndex + 1;
    const requestedEndIndex = monthIndex(cut.testEndYear, cut.testEndMonth);
    const testEndIndex = Math.min(requestedEndIndex, totalMonths - 1);
    return {
      trainEnd: `${cut.trainYear}-${String(cut.trainMonth).padStart(2, '0')}`,
      testPeriod: formatPeriod(testStartIndex, testEndIndex),
      trainEndIndex,
      testStartIndex,
      testEndIndex,
    };
  });
}

function classifyBucket(realFinalWealth: number, p10: number, p90: number): WalkForwardResult['bucketReal'] {
  if (realFinalWealth < p10) return 'below_p10';
  if (realFinalWealth > p90) return 'above_p90';
  return 'within_p10_p90';
}

function evaluateWalkForward(): { cuts: WalkForwardResult[]; summary: {
  withinPct: number;
  belowPct: number;
  abovePct: number;
  meanRelativeError: number;
  meanSignedError: number;
  biasLabel: string;
}} {
  const allData = loadHistoricalData();
  const cuts = buildWalkForwardCuts(allData.length);

  const results = cuts.map((cut) => {
    const params = cloneParams(DEFAULT_PARAMETERS);
    const horizonMonths = cut.testEndIndex - cut.testStartIndex + 1;
    params.simulation = {
      ...params.simulation,
      horizonMonths,
    };

    const trainData = allData.slice(0, cut.trainEndIndex + 1);
    const testData = allData.slice(cut.testStartIndex, cut.testEndIndex + 1);

    const projected = runSimulationCoreWithHistoricalData(params, trainData);
    const observed = runObservedHistoricalPath(params, testData);

    const p10 = projected.terminalWealthPercentiles[10] ?? 0;
    const p50 = projected.terminalWealthPercentiles[50] ?? 0;
    const p90 = projected.terminalWealthPercentiles[90] ?? 0;
    const realFinalWealth = observed.finalWealth;
    const bucketReal = classifyBucket(realFinalWealth, p10, p90);
    const errorP50VsReal = realFinalWealth !== 0 ? ((p50 / realFinalWealth) - 1) : Number.POSITIVE_INFINITY;
    const modelExpectsRuin = projected.probRuin >= 0.5;
    const ruinConsistency = observed.observedRuin === modelExpectsRuin
      ? (observed.observedRuin ? 'Consistente con ruina' : 'Consistente con no-ruina')
      : 'Tension modelo vs realidad';

    return {
      trainEnd: cut.trainEnd,
      testPeriod: cut.testPeriod,
      realFinalWealth,
      p10,
      p50,
      p90,
      bucketReal,
      probRuin: projected.probRuin,
      observedRuin: observed.observedRuin,
      ruinConsistency,
      errorP50VsReal,
    };
  });

  const within = results.filter(r => r.bucketReal === 'within_p10_p90').length;
  const below = results.filter(r => r.bucketReal === 'below_p10').length;
  const above = results.filter(r => r.bucketReal === 'above_p90').length;
  const signedErrors = results.map(r => r.errorP50VsReal).filter(Number.isFinite);
  const meanSignedError = signedErrors.reduce((a, b) => a + b, 0) / signedErrors.length;
  const meanRelativeError = signedErrors.reduce((a, b) => a + Math.abs(b), 0) / signedErrors.length;

  return {
    cuts: results,
    summary: {
      withinPct: within / results.length,
      belowPct: below / results.length,
      abovePct: above / results.length,
      meanRelativeError,
      meanSignedError,
      biasLabel: meanSignedError > 0 ? 'optimista' : meanSignedError < 0 ? 'pesimista' : 'neutral',
    },
  };
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMM(value: number): string {
  return `${(value / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}MM`;
}

const result = evaluateWalkForward();

console.log('\nWALK-FORWARD - TABLA POR CORTE');
console.table(result.cuts.map(cut => ({
  train_end: cut.trainEnd,
  test_period: cut.testPeriod,
  real_final_wealth: fmtMM(cut.realFinalWealth),
  p10: fmtMM(cut.p10),
  p50: fmtMM(cut.p50),
  p90: fmtMM(cut.p90),
  bucket_real: cut.bucketReal,
  probRuin: fmtPct(cut.probRuin),
  observed_ruin: cut.observedRuin ? 'si' : 'no',
  ruin_consistency: cut.ruinConsistency,
  error_p50_vs_real: Number.isFinite(cut.errorP50VsReal) ? fmtPct(cut.errorP50VsReal) : 'inf',
})));

console.log('\nWALK-FORWARD - RESUMEN AGREGADO');
console.table([{
  within_p10_p90: fmtPct(result.summary.withinPct),
  below_p10: fmtPct(result.summary.belowPct),
  above_p90: fmtPct(result.summary.abovePct),
  mean_relative_error: fmtPct(result.summary.meanRelativeError),
  mean_signed_error: fmtPct(result.summary.meanSignedError),
  bias: result.summary.biasLabel,
}]);
