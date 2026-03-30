// domain/simulation/engine.ts
// Motor Monte Carlo — núcleo validado, no modificar sin análisis

import type {
  ModelParameters, SimulationResults, FanChartPoint,
  StressScenario, StressResult, ScenarioComparison, ScenarioPoint, ScenarioVariant
} from '../model/types';
import { SCENARIO_VARIANTS, WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS } from '../model/defaults';
import { BASE_ECONOMIC_ASSUMPTIONS } from '../model/economicAssumptions';
import { loadHistoricalData } from './historicalData';
import { preprocessHistoricalData } from './preprocessData';
import { getSpendingTarget, updateSpendingMultiplier } from './spendingMultiplier';
import { applyExpenseWaterfall, applySleeveReturns, buildInitialLiquidState, captureBlockSnapshot, getBaseExpenseForMonth, runAnnualRebalance } from './blockState';
import { buildMortgageProjection } from './mortgageProjection';
import { computeRiskCapitalMonthlyReturn, resolveRiskCapitalProfile } from './riskCapital';

// ── Utilidades ────────────────────────────────────────────────

function randn(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(0, m[i][i] - s))
                        : (L[j][j] > 1e-10 ? (m[i][j] - s) / L[j][j] : 0);
    }
  }
  return L;
}

function seededRNG(seed: number): () => number {
  let s = seed || Date.now();
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

// Se mantiene solo para referencia/testing.
function bootstrapPathUniform(data: number[][], T: number, blen: number, rng: () => number): number[][] {
  const H = data.length;
  const path: number[][] = [];
  while (path.length < T) {
    const s = Math.floor(rng() * (H - blen));
    for (let i = 0; i < blen && path.length < T; i++) path.push(data[s + i]);
  }
  return path;
}

/**
 * Bootstrap con weighted sampling - bloques recientes tienen mas peso.
 * Half-life decay configurable desde defaults.ts.
 * Se usa un valor mas prudente para no volver 2008 marginal.
 *
 * Razon: corrige el sesgo de correlacion del regimen 2000-2019
 * sin eliminar el tail risk historico relevante.
 */
function bootstrapPathWeighted(
  data: number[][],
  T: number,
  blen: number,
  rng: () => number,
): number[][] {
  const H = data.length;
  const nBlocks = H - blen + 1;
  const halflifeMonths = WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS * 12;
  const lambda = Math.log(2) / halflifeMonths;

  const weights = Array.from({ length: nBlocks }, (_, i) => {
    const age = nBlocks - 1 - i;
    return Math.exp(-lambda * age);
  });

  const wSum = weights.reduce((a, b) => a + b, 0);
  const normWeights = weights.map(w => w / wSum);
  const cdf = normWeights.reduce((acc, w, i) => {
    acc.push((acc[i - 1] ?? 0) + w);
    return acc;
  }, [] as number[]);
  cdf[cdf.length - 1] = 1;

  const sampleBlock = (): number => {
    const u = rng();
    let lo = 0;
    let hi = nBlocks - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const path: number[][] = [];
  while (path.length < T) {
    const s = sampleBlock();
    for (let i = 0; i < blen && path.length < T; i++) {
      path.push(data[s + i]);
    }
  }
  return path;
}

const SLEEVE_KEYS = ['rvGlobal', 'rfGlobal', 'rvChile', 'rfChile'] as const;
const CASHFLOW_WATERFALL_ORDER = [3, 1, 2, 0] as const;

export function applyScenarioVariant(
  params: ModelParameters,
  variant: ScenarioVariant,
): ModelParameters {
  return {
    ...params,
    returns: {
      ...params.returns,
      rvGlobalAnnual:    variant.rvGlobalAnnual    ?? params.returns.rvGlobalAnnual,
      rfGlobalAnnual:    variant.rfGlobalAnnual    ?? params.returns.rfGlobalAnnual,
      rvChileAnnual:     variant.rvChileAnnual     ?? params.returns.rvChileAnnual,
      rfChileUFAnnual:   variant.rfChileUFAnnual    ?? params.returns.rfChileUFAnnual,
      rvGlobalVolAnnual: variant.rvGlobalVolAnnual ?? params.returns.rvGlobalVolAnnual,
      rfGlobalVolAnnual: variant.rfGlobalVolAnnual ?? params.returns.rfGlobalVolAnnual,
      rvChileVolAnnual:  variant.rvChileVolAnnual   ?? params.returns.rvChileVolAnnual,
      rfChileVolAnnual:  variant.rfChileVolAnnual   ?? params.returns.rfChileVolAnnual,
    },
    inflation: {
      ...params.inflation,
      ipcChileAnnual: variant.ipcChileAnnual ?? params.inflation.ipcChileAnnual,
    },
    fx: {
      ...params.fx,
      tcrealLT: variant.tcrealLT ?? params.fx.tcrealLT,
    },
  };
}

export function runScenarioComparison(
  params: ModelParameters,
  variants: ScenarioVariant[],
): ScenarioComparison {
  const lightParams = {
    ...params,
    simulation: { ...params.simulation, nSim: 800, seed: 42 },
  };
  const run = (v: ScenarioVariant): ScenarioPoint => {
    const r = runSimulationCore(applyScenarioVariant(lightParams, v));
    return {
      probRuin:    r.probRuin,
      terminalP50: r.terminalWealthPercentiles[50] ?? 0,
      terminalP10: r.terminalWealthPercentiles[10] ?? 0,
    };
  };
  return {
    base:        run(variants.find(v => v.id === 'base')        ?? variants[0]),
    pessimistic: run(variants.find(v => v.id === 'pessimistic') ?? variants[1]),
    optimistic:  run(variants.find(v => v.id === 'optimistic')  ?? variants[2]),
  };
}

function applyCashflowEvents(
  sl: number[],
  cashflowEvents: ModelParameters['cashflowEvents'],
  month: number,
  CPU_t: number,
  EURUSDt: number,
  cumCL: number,
): void {
  for (const ev of cashflowEvents.filter(e => e.month === month)) {
    let amountCLP = ev.amount;
    const amountType = ev.amountType ?? (ev.currency === 'CLP' ? 'real' : 'nominal');
    if (ev.currency === 'CLP') {
      amountCLP *= amountType === 'real' ? cumCL : 1;
    } else if (ev.currency === 'USD') {
      amountCLP *= CPU_t;
    } else if (ev.currency === 'EUR') {
      amountCLP *= EURUSDt * CPU_t;
    }

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

function resolveHistoricalData(
  sim: ModelParameters['simulation'],
  historicalDataOverride?: number[][] | null,
): number[][] | null {
  let histData: number[][] | null = null;
  if (typeof historicalDataOverride !== 'undefined') {
    histData = historicalDataOverride;
  } else if (sim.useHistoricalData) {
    try { histData = loadHistoricalData(); } catch { histData = null; }
  }
  if (histData && sim.useHistoricalData) {
    histData = preprocessHistoricalData(histData);
  }
  return histData;
}

function runSimulationBootstrapBlocksInternal(
  params: ModelParameters,
  historicalDataOverride?: number[][] | null,
): SimulationResults {
  const t0 = Date.now();
  const {
    spendingRule,
    returns: ret,
    inflation: inf,
    fx,
    simulation: sim,
    ruinThresholdMonths,
  } = params;
  const composition = params.simulationComposition;
  const compositionMode = composition?.mode ?? 'legacy';
  const riskCapitalProfile = resolveRiskCapitalProfile(composition?.nonOptimizable?.riskCapital?.profile);

  const T = sim.horizonMonths;
  const N = sim.nSim;
  const phi = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));

  const m = [
    (1 + ret.rvGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rfGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rvChileAnnual) ** (1 / 12) - 1,
    (1 + ret.rfChileUFAnnual + inf.ipcChileAnnual) ** (1 / 12) - 1,
    (1 + inf.ipcChileAnnual) ** (1 / 12) - 1,
    BASE_ECONOMIC_ASSUMPTIONS.clpUsdDriftAnnual / 12,
  ];
  const v = [
    ret.rvGlobalVolAnnual,
    ret.rfGlobalVolAnnual,
    ret.rvChileVolAnnual,
    ret.rfChileVolAnnual,
    inf.ipcChileVolAnnual,
    0.094,
  ].map((x) => x / Math.sqrt(12));
  const corr6: number[][] = [
    [1.00, -0.20, 0.45, 0.08, 0.05, -0.20],
    [-0.20, 1.00, 0.05, 0.38, -0.03, 0.05],
    [0.45, 0.05, 1.00, 0.18, 0.18, -0.35],
    [0.08, 0.38, 0.18, 1.00, 0.08, 0.00],
    [0.05, -0.03, 0.18, 0.08, 1.00, 0.38],
    [-0.20, 0.05, -0.35, 0.00, 0.38, 1.00],
  ];
  const L = cholesky(corr6);
  const rng = seededRNG(sim.seed);

  const histData = resolveHistoricalData(sim, historicalDataOverride);
  const HICP_MEAN = (1 + inf.hipcEurAnnual) ** (1 / 12) - 1;
  const HICP_STD = inf.hipcEurVolAnnual / Math.sqrt(12);
  const bankAnnual = Math.max(0, Math.min(ret.rfGlobalAnnual, ret.rfChileUFAnnual));
  const bankMonthly = (1 + bankAnnual) ** (1 / 12) - 1;

  const realEstateInput = composition?.nonOptimizable?.realEstate;
  const mortgageProjection = buildMortgageProjection(realEstateInput, T);
  const amortizationScheduleUF = mortgageProjection.amortizationUF;
  const preserveFallbackEquity =
    mortgageProjection.status === 'fallback_incomplete' && (realEstateInput?.realEstateEquityCLP ?? 0) > 0;
  const ufSnapshotCLP = clampNonNegative(realEstateInput?.ufSnapshotCLP ?? 0);
  const equityCLP0 = clampNonNegative(realEstateInput?.realEstateEquityCLP ?? 0);
  const hasUfSchedule = mortgageProjection.status === 'uf_schedule';
  const equityUF0 = ufSnapshotCLP > 0 ? equityCLP0 / ufSnapshotCLP : 0;
  const salePolicy = params.realEstatePolicy;
  const saleEnabled = salePolicy?.enabled ?? true;
  const triggerRunwayMonths = Math.max(1, Math.round(salePolicy?.triggerRunwayMonths ?? 36));
  const saleDelayMonths = Math.max(0, Math.round(salePolicy?.saleDelayMonths ?? 12));
  const saleCostPct = Math.max(0, Math.min(1, salePolicy?.saleCostPct ?? 0));
  const realAppreciationMonthly = Math.max(-0.99, salePolicy?.realAppreciationAnnual ?? 0) / 12;
  const terminalAdjustment = 0.7 * Math.abs(composition?.nonOptimizable?.nonMortgageDebtCLP ?? 0);
  const postSaleExpenseFloorClp = 6_000_000;

  const pcts = [5, 10, 25, 50, 75, 90, 95];
  let nRuin = 0;
  const terminalWSurvivors: number[] = [];
  const terminalWAllPaths: number[] = [];
  const maxDDs: number[] = [];
  const ruinMonths: number[] = [];
  const spRatios: number[] = [];
  const FAN_RES = 3;
  const fanLen = Math.floor(T / FAN_RES);
  const wMatrix = new Float32Array(N * fanLen);

  const generateRow = (rngInner: () => number): number[] => {
    const z = Array.from({ length: 6 }, () => randn(rngInner));
    const c = new Array(6).fill(0);
    for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) c[i] += L[i][j] * z[j];
    return c.map((ci, i) => m[i] + v[i] * ci);
  };

  for (let s = 0; s < N; s++) {
    const liquidState = buildInitialLiquidState(params);
    let cumCL = 1;
    let cumEUR = 1;
    let logCPU = Math.log(fx.clpUsdInitial);
    let logCPUr = 0;
    let logEURUSD = Math.log(fx.usdEurFixed);
    let hwm = Math.max(
      1,
      liquidState.banks +
        liquidState.riskUsdCLP +
        liquidState.sleeves.rvGlobal +
        liquidState.sleeves.rfGlobal +
        liquidState.sleeves.rvChile +
        liquidState.sleeves.rfChile,
    );
    let smult = 1;
    let cnt15 = 0;
    let cnt25 = 0;
    let maxDD = 0;
    let gEff = 0;
    let gPlan = 0;
    let ruined = false;
    let saleTriggeredMonth: number | null = null;
    let saleScheduledMonth: number | null = null;
    let saleExecutedMonth: number | null = null;
    let equityUF = equityUF0;
    let ufCLP = ufSnapshotCLP;
    let equityCLP = equityCLP0;

    const path = histData ? bootstrapPathWeighted(histData, T, sim.blockLength, rng) : null;

    for (let t = 0; t < T; t++) {
      const month = t + 1;
      let rRVg: number;
      let rRFg: number;
      let rRVcl: number;
      let rRFcl: number;
      let ipcM: number;
      let hicpM: number;
      let dLogFX: number;
      let dLogEURUSD: number;

      if (path) {
        const row = path[t];
        const rvg = row[0];
        const rfg = row[1];
        const rvCL = 0.55 * row[2] + 0.45 * row[3];
        const rfCLReal = row[4];
        const ipc = row[5];
        const hicp = row[6];
        const dfx = row[7];
        const rfCLNominal = ((1 + rfCLReal) * (1 + ipc)) - 1;
        rRVg = rvg;
        rRFg = rfg;
        rRVcl = rvCL;
        rRFcl = rfCLNominal;
        ipcM = ipc;
        hicpM = hicp;
        dLogFX = dfx;
        dLogEURUSD = row[8];
      } else {
        const row = generateRow(rng);
        rRVg = row[0];
        rRFg = row[1];
        rRVcl = row[2];
        rRFcl = row[3];
        ipcM = row[4];
        dLogFX = row[5];
        hicpM = HICP_MEAN + randn(rng) * HICP_STD;
        dLogEURUSD = (BASE_ECONOMIC_ASSUMPTIONS.eurUsdDriftAnnual / 12) + (0.093 / Math.sqrt(12)) * randn(rng);
      }

      cumCL *= 1 + ipcM;
      cumEUR *= 1 + hicpM;

      const soldAlready = saleExecutedMonth !== null && month >= saleExecutedMonth;
      if (!soldAlready) {
        if (hasUfSchedule && ufCLP > 0) {
          ufCLP = ufCLP * (1 + ipcM) * (1 + realAppreciationMonthly);
          const amortizationUF = amortizationScheduleUF[t] ?? 0;
          equityUF += amortizationUF;
          equityCLP = ufCLP > 0 ? equityUF * ufCLP : 0;
        } else if (preserveFallbackEquity) {
          equityCLP = equityCLP0;
        } else {
          equityUF = 0;
          equityCLP = 0;
        }
      } else {
        equityUF = 0;
        equityCLP = 0;
      }

      const logLT = Math.log(fx.tcrealLT / fx.clpUsdInitial);
      const uPrev = logCPUr - logLT;
      logCPU += dLogFX + (phi * uPrev - uPrev);
      logCPUr = logCPU - Math.log(cumCL);
      const CPU_t = Math.exp(logCPU);
      logEURUSD += dLogEURUSD;
      const EURUSDt = Math.exp(logEURUSD);
      const dFX = Math.exp(dLogFX) - 1;
      const rvGlobalFxReturn = rRVg + dFX + rRVg * dFX;
      const riskUsdReturn = computeRiskCapitalMonthlyReturn(rvGlobalFxReturn, riskCapitalProfile, rng);

      applySleeveReturns(liquidState, {
        rvGlobal: rvGlobalFxReturn,
        rfGlobal: rRFg + dFX,
        rvChile: rRVcl,
        rfChile: rRFcl,
        banks: bankMonthly,
        riskUsd: riskUsdReturn,
      });

      const investBeforeFee =
        liquidState.sleeves.rvGlobal +
        liquidState.sleeves.rfGlobal +
        liquidState.sleeves.rvChile +
        liquidState.sleeves.rfChile;
      if (investBeforeFee > 0) {
        const ff = (investBeforeFee - investBeforeFee * (params.feeAnnual / 12)) / investBeforeFee;
        liquidState.sleeves.rvGlobal *= ff;
        liquidState.sleeves.rfGlobal *= ff;
        liquidState.sleeves.rvChile *= ff;
        liquidState.sleeves.rfChile *= ff;
      }

      const sleevesArray = [
        liquidState.sleeves.rvGlobal,
        liquidState.sleeves.rfGlobal,
        liquidState.sleeves.rvChile,
        liquidState.sleeves.rfChile,
      ];
      applyCashflowEvents(sleevesArray, params.cashflowEvents, t + 1, CPU_t, EURUSDt, cumCL);
      liquidState.sleeves.rvGlobal = Math.max(0, sleevesArray[0]);
      liquidState.sleeves.rfGlobal = Math.max(0, sleevesArray[1]);
      liquidState.sleeves.rvChile = Math.max(0, sleevesArray[2]);
      liquidState.sleeves.rfChile = Math.max(0, sleevesArray[3]);

      const projectedEquityCLP = clampNonNegative(equityCLP);
      const projectedMortgagePoint = {
        month,
        propertyValueCLP: projectedEquityCLP,
        mortgageDebtCLP: 0,
        realEstateEquityCLP: projectedEquityCLP,
      };
      if (saleScheduledMonth !== null && saleExecutedMonth === null && month >= saleScheduledMonth) {
        const netSellableEquity = Math.max(0, projectedMortgagePoint.realEstateEquityCLP) * (1 - saleCostPct);
        liquidState.banks += Math.max(0, netSellableEquity);
        saleExecutedMonth = month;
        equityUF = 0;
        equityCLP = 0;
      }

      const sold = saleExecutedMonth !== null && month >= saleExecutedMonth;
      const mortgagePoint = sold
        ? {
            month,
            propertyValueCLP: 0,
            mortgageDebtCLP: 0,
            realEstateEquityCLP: 0,
          }
        : projectedMortgagePoint;
      const baseExpense = getBaseExpenseForMonth(params, month, CPU_t, EURUSDt, cumCL);
      const expense = sold ? Math.max(baseExpense, postSaleExpenseFloorClp * cumCL) : baseExpense;
      const monthSnapshot = captureBlockSnapshot(month, liquidState, expense, mortgagePoint);
      const totalGross = monthSnapshot.liquidCapital + monthSnapshot.realEstateEquityCLP;
      const Wr = totalGross / cumCL;
      if (Wr > hwm) hwm = Wr;
      const dd = (Wr - hwm) / hwm;
      if (dd < maxDD) maxDD = dd;

      cnt15 = dd <= -0.15 ? cnt15 + 1 : 0;
      cnt25 = dd <= -0.25 ? cnt25 + 1 : 0;
      const tgt = getSpendingTarget(cnt15, cnt25, spendingRule);
      smult = updateSpendingMultiplier(smult, tgt, spendingRule);

      const GB = monthSnapshot.expense;
      const G = GB * smult;
      if (saleEnabled && saleTriggeredMonth === null && saleExecutedMonth === null && monthSnapshot.realEstateEquityCLP > 0) {
        const runwayMonths = monthSnapshot.liquidCapital / Math.max(1, G);
        if (runwayMonths <= triggerRunwayMonths) {
          saleTriggeredMonth = month;
          saleScheduledMonth = month + saleDelayMonths;
        }
      }
      gPlan += GB;
      gEff += G;

      if (monthSnapshot.liquidCapital <= ruinThresholdMonths * G) {
        ruined = true;
        nRuin += 1;
        ruinMonths.push(month);
        const fi = Math.floor(t / FAN_RES);
        for (let f = fi; f < fanLen; f++) wMatrix[s * fanLen + f] = 0;
        break;
      }

      const flow = applyExpenseWaterfall(liquidState, G, monthSnapshot.expense * 36);
      if (flow.shortfall > 0) {
        ruined = true;
        nRuin += 1;
        ruinMonths.push(month);
        const fi = Math.floor(t / FAN_RES);
        for (let f = fi; f < fanLen; f++) wMatrix[s * fanLen + f] = 0;
        break;
      }

      if (month % 12 === 0) {
        runAnnualRebalance(liquidState, params, G * 36);
      }

      if (t % FAN_RES === 0) {
        const fi = Math.floor(t / FAN_RES);
        if (fi < fanLen) {
          const postSnapshot = captureBlockSnapshot(month, liquidState, expense, mortgagePoint);
          const postTotal = postSnapshot.liquidCapital + postSnapshot.realEstateEquityCLP;
          wMatrix[s * fanLen + fi] = postTotal / cumCL;
        }
      }
    }

    const finalRealEstateEquity =
      saleExecutedMonth !== null && saleExecutedMonth <= T
        ? 0
        : clampNonNegative(equityCLP);
    const finalLiquid =
      liquidState.banks +
      liquidState.riskUsdCLP +
      liquidState.sleeves.rvGlobal +
      liquidState.sleeves.rfGlobal +
      liquidState.sleeves.rvChile +
      liquidState.sleeves.rfChile;
    const terminalGrossWorth = finalLiquid + finalRealEstateEquity;
    const terminalNetWorth = Math.max(0, terminalGrossWorth - terminalAdjustment);
    const finalTerminalWealth = ruined ? 0 : terminalNetWorth;
    if (!ruined) terminalWSurvivors.push(finalTerminalWealth);
    terminalWAllPaths.push(finalTerminalWealth);
    maxDDs.push(maxDD);
    if (gPlan > 0) spRatios.push(gEff / gPlan);
  }

  const sortTW = [...terminalWSurvivors].sort((a, b) => a - b);
  const sortTWAll = [...terminalWAllPaths].sort((a, b) => a - b);
  const twPct: Record<number, number> = {};
  pcts.forEach((p) => { twPct[p] = percentile(sortTW, p); });

  const sortDD = [...maxDDs].sort((a, b) => a - b);
  const ddPct: Record<number, number> = {};
  pcts.forEach((p) => { ddPct[p] = percentile(sortDD, p); });

  const sortRM = [...ruinMonths].sort((a, b) => a - b);
  const fanData: FanChartPoint[] = [];
  const colBuf = new Float32Array(N);
  for (let fi = 0; fi < fanLen; fi++) {
    for (let s = 0; s < N; s++) colBuf[s] = wMatrix[s * fanLen + fi];
    const sorted = Array.from(colBuf).sort((a, b) => a - b);
    const yr = Math.round((((fi * FAN_RES) + 1) / 12) * 10) / 10;
    fanData.push({
      year: yr,
      p5: percentile(sorted, 5) / 1e6,
      p10: percentile(sorted, 10) / 1e6,
      p25: percentile(sorted, 25) / 1e6,
      p50: percentile(sorted, 50) / 1e6,
      p75: percentile(sorted, 75) / 1e6,
      p90: percentile(sorted, 90) / 1e6,
      p95: percentile(sorted, 95) / 1e6,
    });
  }

  return {
    probRuin: nRuin / N,
    nRuin,
    nTotal: N,
    uncertaintyBand: {
      low: Math.max(0, (nRuin / N) - 0.06),
      high: Math.min(1, (nRuin / N) + 0.06),
    },
    scenarioComparison: undefined,
    terminalWealthPercentiles: twPct,
    terminalWealthAll: sortTW,
    terminalWealthAllPaths: sortTWAll,
    p50TerminalAllPaths: percentile(sortTWAll, 50),
    p50TerminalSurvivors: percentile(sortTW, 50),
    maxDrawdownPercentiles: ddPct,
    ruinTimingMedian: percentile(sortRM, 50),
    ruinTimingP25: percentile(sortRM, 25),
    ruinTimingP75: percentile(sortRM, 75),
    fanChartData: fanData,
    spendingRatioMedian: percentile([...spRatios].sort((a, b) => a - b), 50),
    computedAt: new Date(),
    durationMs: Date.now() - t0,
    params: {
      ...params,
      simulationComposition: composition
        ? {
            ...composition,
            diagnostics: {
              ...(composition.diagnostics ?? {
                sourceVersion: 2,
                mode: compositionMode,
                compositionGapCLP: 0,
                compositionGapPct: 0,
                notes: [],
              }),
              mode: compositionMode,
              notes: [
                ...(composition.diagnostics?.notes ?? []),
                `blocks-mode:${compositionMode}`,
              ],
            },
          }
        : undefined,
    },
  };
}

// ── Motor principal ───────────────────────────────────────────

function runSimulationCoreInternal(
  params: ModelParameters,
  historicalDataOverride?: number[][] | null,
): SimulationResults {
  const compositionMode = params.simulationComposition?.mode ?? 'legacy';
  if (compositionMode !== 'legacy') {
    return runSimulationBootstrapBlocksInternal(params, historicalDataOverride);
  }
  const t0 = Date.now();
  const {
    capitalInitial: W0, weights, feeAnnual,
    spendingPhases, spendingRule, returns: ret,
    inflation: inf, fx, simulation: sim, ruinThresholdMonths,
  } = params;

  const T = sim.horizonMonths;
  const N = sim.nSim;
  const phi = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));

  const m = [
    (1 + ret.rvGlobalAnnual)  ** (1/12) - 1,
    (1 + ret.rfGlobalAnnual)  ** (1/12) - 1,
    (1 + ret.rvChileAnnual)   ** (1/12) - 1,
    (1 + ret.rfChileUFAnnual + inf.ipcChileAnnual) ** (1/12) - 1,
    (1 + inf.ipcChileAnnual)  ** (1/12) - 1,
    BASE_ECONOMIC_ASSUMPTIONS.clpUsdDriftAnnual / 12,  // d_logCLPUSD drift
  ];
  const v = [
    ret.rvGlobalVolAnnual, ret.rfGlobalVolAnnual,
    ret.rvChileVolAnnual, ret.rfChileVolAnnual,
    inf.ipcChileVolAnnual, 0.094,
  ].map(x => x / Math.sqrt(12));

  const corr6: number[][] = [
    [ 1.00, -0.20,  0.45,  0.08,  0.05, -0.20],
    [-0.20,  1.00,  0.05,  0.38, -0.03,  0.05],
    [ 0.45,  0.05,  1.00,  0.18,  0.18, -0.35],
    [ 0.08,  0.38,  0.18,  1.00,  0.08,  0.00],
    [ 0.05, -0.03,  0.18,  0.08,  1.00,  0.38],
    [-0.20,  0.05, -0.35,  0.00,  0.38,  1.00],
  ];
  const L = cholesky(corr6);
  const rng = seededRNG(sim.seed);

  const histData = resolveHistoricalData(sim, historicalDataOverride);

  const w = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile];
  const HICP_MEAN = (1 + inf.hipcEurAnnual) ** (1/12) - 1;
  const HICP_STD  = inf.hipcEurVolAnnual / Math.sqrt(12);

  let nRuin = 0;
  const terminalW:  number[] = [];
  const maxDDs:     number[] = [];
  const ruinMonths: number[] = [];
  const spRatios:   number[] = [];
  const FAN_RES = 3;
  const fanLen  = Math.floor(T / FAN_RES);
  const wMatrix = new Float32Array(N * fanLen);

  const generateRow = (rng: () => number): number[] => {
    const z = Array.from({ length: 6 }, () => randn(rng));
    const c = new Array(6).fill(0);
    for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) c[i] += L[i][j] * z[j];
    return c.map((ci, i) => m[i] + v[i] * ci);
  };

  for (let s = 0; s < N; s++) {
    let sl = w.map(wi => wi * W0);
    let cumCL = 1, cumEUR = 1;
    let logCPU = Math.log(fx.clpUsdInitial), logCPUr = 0;
    let logEURUSD = Math.log(fx.usdEurFixed);
    let hwm = W0, smult = 1, cnt15 = 0, cnt25 = 0;
    let maxDD = 0, gEff = 0, gPlan = 0, ruined = false;

    const path = histData ? bootstrapPathWeighted(histData, T, sim.blockLength, rng) : null;

    for (let t = 0; t < T; t++) {
      let r: number[];
      let dLogEURUSD: number;
      if (path) {
        const row = path[t];
        r = [row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]];
        // map: [rvg, rfg, sura, afp, rfcl, ipc, hicp, dfx, dEURUSD]
        const rvg = r[0], rfg = r[1];
        const rvCL = 0.55 * r[2] + 0.45 * r[3];
        // row[4] = r_RFcl_UF: retorno real / UF.
        // En la rama bootstrap debemos convertirlo a nominal con IPC mensual
        // para mantener consistencia con rfChileUFAnnual en la rama parametrica.
        const rfCLReal = r[4], ipc = r[5], hicp = r[6], dfx = r[7];
        const rfCLNominal = ((1 + rfCLReal) * (1 + ipc)) - 1;
        dLogEURUSD = r[8];
        r = [rvg, rfg, rvCL, rfCLNominal, ipc, dfx];
      } else {
        r = generateRow(rng);
        // vol EUR/USD: 9.3% anual, media 0.76% anual
        dLogEURUSD = (BASE_ECONOMIC_ASSUMPTIONS.eurUsdDriftAnnual / 12) + (0.093 / Math.sqrt(12)) * randn(rng);
      }

      const [rRVg, rRFg, rRVcl, rRFcl, ipcM, dLogFX] = r;
      const hicpM = HICP_MEAN + randn(rng) * HICP_STD;

      cumCL  *= (1 + ipcM);
      cumEUR *= (1 + hicpM);

      const logLT = Math.log(fx.tcrealLT / fx.clpUsdInitial);
      const uPrev = logCPUr - logLT;
      logCPU  += dLogFX + (phi * uPrev - uPrev);
      logCPUr  = logCPU - Math.log(cumCL);
      const CPU_t = Math.exp(logCPU);
      logEURUSD += dLogEURUSD;
      const EURUSDt = Math.exp(logEURUSD);
      const dFX   = Math.exp(dLogFX) - 1;

      sl[0] *= (1 + rRVg + dFX + rRVg * dFX);
      sl[1] *= (1 + rRFg + dFX);
      sl[2] *= (1 + rRVcl);
      sl[3] *= (1 + rRFcl);

      const W  = sl.reduce((a, b) => a + b, 0);
      const ff = (W - W * feeAnnual / 12) / W;
      sl = sl.map(x => x * ff);
      applyCashflowEvents(sl, params.cashflowEvents, t + 1, CPU_t, EURUSDt, cumCL);
      const Wp = sl.reduce((a, b) => a + b, 0);

      const Wr = Wp / cumCL;
      if (Wr > hwm) hwm = Wr;
      const dd = (Wr - hwm) / hwm;
      if (dd < maxDD) maxDD = dd;

      cnt15 = dd <= -0.15 ? cnt15 + 1 : 0;
      cnt25 = dd <= -0.25 ? cnt25 + 1 : 0;
      const tgt = getSpendingTarget(cnt15, cnt25, spendingRule);
      smult = updateSpendingMultiplier(smult, tgt, spendingRule);

      const mes = t + 1;
      let GB = 0, phaseStart = 0;
      for (const ph of spendingPhases) {
        if (mes <= phaseStart + ph.durationMonths) {
          GB = ph.currency === 'EUR' ? ph.amountReal * EURUSDt * CPU_t : ph.amountReal * cumCL;
          break;
        }
        phaseStart += ph.durationMonths;
      }
      const G = GB * smult;
      gPlan += GB; gEff += G;

      if (Wp <= ruinThresholdMonths * G) {
        ruined = true; nRuin++; ruinMonths.push(mes);
        const fi = Math.floor(t / FAN_RES);
        for (let f = fi; f < fanLen; f++) wMatrix[s * fanLen + f] = 0;
        break;
      }

      const Wfin = sl.reduce((a, b) => a + b, 0);
      sl = sl.map(x => x - G * (x / Wfin));

      if (t % FAN_RES === 0) {
        const fi = Math.floor(t / FAN_RES);
        if (fi < fanLen) wMatrix[s * fanLen + fi] = sl.reduce((a, b) => a + b, 0) / cumCL;
      }
    }

    if (!ruined) terminalW.push(sl.reduce((a, b) => a + b, 0));
    maxDDs.push(maxDD);
    if (gPlan > 0) spRatios.push(gEff / gPlan);
  }

  // Percentiles
  const pcts = [5, 10, 25, 50, 75, 90, 95];
  const sortTW = [...terminalW].sort((a, b) => a - b);
  const twPct: Record<number, number> = {};
  pcts.forEach(p => twPct[p] = percentile(sortTW, p));

  const sortDD = [...maxDDs].sort((a, b) => a - b);
  const ddPct: Record<number, number> = {};
  pcts.forEach(p => ddPct[p] = percentile(sortDD, p));

  const sortRM = [...ruinMonths].sort((a, b) => a - b);

  const fanData: FanChartPoint[] = [];
  const colBuf = new Float32Array(N);
  for (let fi = 0; fi < fanLen; fi++) {
    for (let s = 0; s < N; s++) colBuf[s] = wMatrix[s * fanLen + fi];
    const sorted = Array.from(colBuf).sort((a, b) => a - b);
    const yr = Math.round(((fi * FAN_RES) + 1) / 12 * 10) / 10;
    fanData.push({
      year: yr,
      p5: percentile(sorted, 5)  / 1e6, p10: percentile(sorted, 10) / 1e6,
      p25: percentile(sorted, 25) / 1e6, p50: percentile(sorted, 50) / 1e6,
      p75: percentile(sorted, 75) / 1e6, p90: percentile(sorted, 90) / 1e6,
      p95: percentile(sorted, 95) / 1e6,
    });
  }

  return {
    probRuin: nRuin / N, nRuin, nTotal: N,
    uncertaintyBand: {
      low: Math.max(0, (nRuin / N) - 0.06),
      high: Math.min(1, (nRuin / N) + 0.06),
    },
    scenarioComparison: undefined,
    terminalWealthPercentiles: twPct,
    terminalWealthAll: sortTW,
    maxDrawdownPercentiles: ddPct,
    ruinTimingMedian: percentile(sortRM, 50),
    ruinTimingP25:    percentile(sortRM, 25),
    ruinTimingP75:    percentile(sortRM, 75),
    fanChartData: fanData,
    spendingRatioMedian: percentile([...spRatios].sort((a, b) => a - b), 50),
    computedAt: new Date(),
    durationMs: Date.now() - t0,
    params,
  };
}

export function runSimulationCoreWithHistoricalData(
  params: ModelParameters,
  historicalData: number[][] | null,
): SimulationResults {
  return runSimulationCoreInternal(params, historicalData);
}

export function runSimulationCore(params: ModelParameters): SimulationResults {
  return runSimulationCoreInternal(params);
}

// ── Motor principal (wrapper con escenarios) ─────────────────

export function runSimulation(
  params: ModelParameters,
  variants: ScenarioVariant[] = SCENARIO_VARIANTS,
): SimulationResults {
  const activeVariant = variants.find(v => v.id === params.activeScenario) ?? variants[0];
  const results = runSimulationCore(applyScenarioVariant(params, activeVariant));
  const scenarioComparison = runScenarioComparison(params, variants);
  return { ...results, scenarioComparison };
}

// ── Stress test ───────────────────────────────────────────────

export function runStressTest(params: ModelParameters, scenario: StressScenario): StressResult {
  const { capitalInitial: W0, weights, feeAnnual, spendingPhases,
          spendingRule, returns: ret, inflation: inf, fx, ruinThresholdMonths } = params;

  const T    = params.simulation.horizonMonths;
  const phi  = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));
  const base = {
    r_RVg:  (1 + ret.rvGlobalAnnual)  ** (1/12) - 1,
    r_RFg:  (1 + ret.rfGlobalAnnual)  ** (1/12) - 1,
    r_RVcl: (1 + ret.rvChileAnnual)   ** (1/12) - 1,
    r_RFcl: (1 + ret.rfChileUFAnnual + inf.ipcChileAnnual) ** (1/12) - 1,
    ipc_cl_m: (1 + inf.ipcChileAnnual) ** (1/12) - 1,
    hicp_eur_m: (1 + inf.hipcEurAnnual) ** (1/12) - 1,
    d_logCLPUSD: BASE_ECONOMIC_ASSUMPTIONS.clpUsdDriftAnnual / 12,
    d_logEURUSD: BASE_ECONOMIC_ASSUMPTIONS.eurUsdDriftAnnual / 12,
  };

  let sl = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile].map(w => w * W0);
  let cumCL = 1, cumEUR = 1;
  let logCPU = Math.log(fx.clpUsdInitial), logCPUr = 0;
  let logEURUSD = Math.log(fx.usdEurFixed);
  let hwm = W0, smult = 1, cnt15 = 0, cnt25 = 0, maxDD = 0;
  let ruinMonth: number | null = null, minSmult = 1;
  const traj: Array<{ year: number; wealth: number }> = [];

  for (let t = 0; t < T; t++) {
    const mes = t + 1;
    let r = { ...base };
    for (const ov of scenario.monthlyOverrides) {
      if (mes >= ov.fromMonth && mes <= ov.toMonth) { r = { ...r, ...ov.overrides }; break; }
    }

    cumCL *= (1 + r.ipc_cl_m); cumEUR *= (1 + r.hicp_eur_m);
    const logLT = Math.log(fx.tcrealLT / fx.clpUsdInitial);
    const uPrev = logCPUr - logLT;
    logCPU += r.d_logCLPUSD + (phi * uPrev - uPrev);
    logCPUr = logCPU - Math.log(cumCL);
    const CPU_t = Math.exp(logCPU);
    const dFX   = Math.exp(r.d_logCLPUSD) - 1;
    logEURUSD += r.d_logEURUSD;
    const EURUSDt = Math.exp(logEURUSD);

    sl[0] *= (1 + r.r_RVg + dFX + r.r_RVg * dFX);
    sl[1] *= (1 + r.r_RFg + dFX);
    sl[2] *= (1 + r.r_RVcl);
    sl[3] *= (1 + r.r_RFcl);

    const W  = sl.reduce((a, b) => a + b, 0);
    sl = sl.map(x => x * (W - W * feeAnnual / 12) / W);
    const Wp = sl.reduce((a, b) => a + b, 0);
    const Wr = Wp / cumCL;

    if (Wr > hwm) hwm = Wr;
    const dd = (Wr - hwm) / hwm;
    if (dd < maxDD) maxDD = dd;
    cnt15 = dd <= -0.15 ? cnt15 + 1 : 0;
    cnt25 = dd <= -0.25 ? cnt25 + 1 : 0;

    const tgt = getSpendingTarget(cnt15, cnt25, spendingRule);
    smult = updateSpendingMultiplier(smult, tgt, spendingRule);
    if (smult < minSmult) minSmult = smult;

    let GB = 0, phaseStart = 0;
    for (const ph of spendingPhases) {
      if (mes <= phaseStart + ph.durationMonths) {
        GB = ph.currency === 'EUR' ? ph.amountReal * EURUSDt * CPU_t : ph.amountReal * cumCL;
        break;
      }
      phaseStart += ph.durationMonths;
    }
    const G = GB * smult;

    if (Wp <= ruinThresholdMonths * G) { ruinMonth = mes; break; }
    sl = sl.map(x => x - G * (x / Wp));
    if (t % 12 === 0) traj.push({ year: mes / 12, wealth: sl.reduce((a, b) => a + b, 0) / cumCL / 1e6 });
  }

  return {
    scenario, ruinMonth, maxDrawdownReal: maxDD, minSpendingMult: minSmult,
    terminalWealthReal: ruinMonth ? 0 : sl.reduce((a, b) => a + b, 0),
    wealthTrajectory: traj,
  };
}
