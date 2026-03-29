import type {
  ModelParameters,
  SimulationResults,
  FanChartPoint,
  MortgageProjectionStatus,
} from '../model/types';
import { BASE_ECONOMIC_ASSUMPTIONS } from '../model/economicAssumptions';
import { applyExpenseWaterfall, applySleeveReturns, buildInitialLiquidState, captureBlockSnapshot, getBaseExpenseForMonth, runAnnualRebalance } from './blockState';
import { buildMortgageProjection } from './mortgageProjection';
import { getSpendingTarget, updateSpendingMultiplier } from './spendingMultiplier';
import { computeRiskCapitalMonthlyReturn, resolveRiskCapitalProfile } from './riskCapital';

type ParametricAuditResults = {
  probRuin: number;
  successRate: number;
  ruinLt20y: number;
  ruinLt40y: number;
  monthsCutPct: number;
  terminalP50: number;
};

type ParametricCoreAudit = {
  results: SimulationResults;
  ruinMonths: number[];
  cutMonths: number;
  totalMonths: number;
};

const SLEEVE_KEYS = ['rvGlobal', 'rfGlobal', 'rvChile', 'rfChile'] as const;
const CASHFLOW_WATERFALL_ORDER = [3, 1, 2, 0] as const;

function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function seededRNG(seed: number): () => number {
  let s = seed || Date.now();
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
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

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function validateCorrelationMatrix(correlationMatrix: number[][]): string[] {
  const issues: string[] = [];
  if (!Array.isArray(correlationMatrix) || correlationMatrix.length !== 4) {
    issues.push('correlationMatrix must be 4x4');
    return issues;
  }
  for (let i = 0; i < 4; i += 1) {
    const row = correlationMatrix[i];
    if (!Array.isArray(row) || row.length !== 4) {
      issues.push(`correlationMatrix row ${i} must have length 4`);
      continue;
    }
    for (let j = 0; j < 4; j += 1) {
      const value = row[j];
      if (!Number.isFinite(value)) {
        issues.push(`correlationMatrix[${i}][${j}] is not finite`);
        continue;
      }
      if (Math.abs(value) > 1.000001) {
        issues.push(`correlationMatrix[${i}][${j}] must be between -1 and 1`);
      }
      if (i === j && Math.abs(value - 1) > 1e-6) {
        issues.push(`correlationMatrix diagonal at [${i}][${j}] must be 1`);
      }
      if (j > i) {
        const symmetric = correlationMatrix[j]?.[i];
        if (!Number.isFinite(symmetric) || Math.abs(value - symmetric) > 1e-6) {
          issues.push(`correlationMatrix must be symmetric at [${i}][${j}]`);
        }
      }
    }
  }
  return issues;
}

function validateSimulationInputs(params: ModelParameters): void {
  const issues: string[] = [];
  const pushIfNotFinite = (value: number, label: string) => {
    if (!Number.isFinite(value)) issues.push(`${label} must be finite`);
  };
  const pushIfNegative = (value: number, label: string) => {
    if (Number.isFinite(value) && value < 0) issues.push(`${label} must be >= 0`);
  };
  const pushIfOutOfRange = (value: number, min: number, max: number, label: string) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      issues.push(`${label} must be between ${min} and ${max}`);
    }
  };
  if (!Number.isFinite(params.simulation.nSim) || params.simulation.nSim <= 0 || !Number.isInteger(params.simulation.nSim)) {
    issues.push('simulation.nSim must be a positive integer');
  }
  if (
    !Number.isFinite(params.simulation.horizonMonths) ||
    params.simulation.horizonMonths <= 0 ||
    !Number.isInteger(params.simulation.horizonMonths)
  ) {
    issues.push('simulation.horizonMonths must be a positive integer');
  }
  if (!Number.isFinite(params.simulation.blockLength) || params.simulation.blockLength <= 0 || !Number.isInteger(params.simulation.blockLength)) {
    issues.push('simulation.blockLength must be a positive integer');
  }
  if (!Number.isFinite(params.simulation.seed) || params.simulation.seed <= 0 || !Number.isInteger(params.simulation.seed)) {
    issues.push('simulation.seed must be a positive integer');
  }
  pushIfOutOfRange(params.feeAnnual, 0, 0.05, 'feeAnnual');

  const weights = params.weights;
  pushIfNotFinite(weights.rvGlobal, 'weights.rvGlobal');
  pushIfNotFinite(weights.rfGlobal, 'weights.rfGlobal');
  pushIfNotFinite(weights.rvChile, 'weights.rvChile');
  pushIfNotFinite(weights.rfChile, 'weights.rfChile');
  pushIfOutOfRange(weights.rvGlobal, 0, 1, 'weights.rvGlobal');
  pushIfOutOfRange(weights.rfGlobal, 0, 1, 'weights.rfGlobal');
  pushIfOutOfRange(weights.rvChile, 0, 1, 'weights.rvChile');
  pushIfOutOfRange(weights.rfChile, 0, 1, 'weights.rfChile');
  const weightsSum = weights.rvGlobal + weights.rfGlobal + weights.rvChile + weights.rfChile;
  if (!Number.isFinite(weightsSum) || weightsSum <= 0.0001) {
    issues.push('weights must sum to a positive value');
  }

  const returns = params.returns;
  pushIfNotFinite(returns.rvGlobalAnnual, 'returns.rvGlobalAnnual');
  pushIfNotFinite(returns.rfGlobalAnnual, 'returns.rfGlobalAnnual');
  pushIfNotFinite(returns.rvChileAnnual, 'returns.rvChileAnnual');
  pushIfNotFinite(returns.rfChileUFAnnual, 'returns.rfChileUFAnnual');
  pushIfNotFinite(returns.rvGlobalVolAnnual, 'returns.rvGlobalVolAnnual');
  pushIfNotFinite(returns.rfGlobalVolAnnual, 'returns.rfGlobalVolAnnual');
  pushIfNotFinite(returns.rvChileVolAnnual, 'returns.rvChileVolAnnual');
  pushIfNotFinite(returns.rfChileVolAnnual, 'returns.rfChileVolAnnual');
  pushIfNegative(returns.rvGlobalVolAnnual, 'returns.rvGlobalVolAnnual');
  pushIfNegative(returns.rfGlobalVolAnnual, 'returns.rfGlobalVolAnnual');
  pushIfNegative(returns.rvChileVolAnnual, 'returns.rvChileVolAnnual');
  pushIfNegative(returns.rfChileVolAnnual, 'returns.rfChileVolAnnual');

  const inflation = params.inflation;
  pushIfNotFinite(inflation.ipcChileAnnual, 'inflation.ipcChileAnnual');
  pushIfNotFinite(inflation.ipcChileVolAnnual, 'inflation.ipcChileVolAnnual');
  pushIfNotFinite(inflation.hipcEurAnnual, 'inflation.hipcEurAnnual');
  pushIfNotFinite(inflation.hipcEurVolAnnual, 'inflation.hipcEurVolAnnual');
  pushIfNegative(inflation.ipcChileVolAnnual, 'inflation.ipcChileVolAnnual');
  pushIfNegative(inflation.hipcEurVolAnnual, 'inflation.hipcEurVolAnnual');

  const fx = params.fx;
  pushIfOutOfRange(fx.clpUsdInitial, 1, 20000, 'fx.clpUsdInitial');
  pushIfOutOfRange(fx.usdEurFixed, 0.3, 3, 'fx.usdEurFixed');
  pushIfOutOfRange(fx.tcrealLT, 1, 20000, 'fx.tcrealLT');
  pushIfOutOfRange(fx.mrHalfLifeYears, 0.1, 50, 'fx.mrHalfLifeYears');

  if (!Array.isArray(params.spendingPhases) || params.spendingPhases.length === 0) {
    issues.push('spendingPhases must be a non-empty array');
  } else {
    params.spendingPhases.forEach((phase, idx) => {
      pushIfOutOfRange(phase.durationMonths, 1, 1000, `spendingPhases[${idx}].durationMonths`);
      pushIfNegative(phase.amountReal, `spendingPhases[${idx}].amountReal`);
    });
  }
  issues.push(...validateCorrelationMatrix(params.returns.correlationMatrix));
  if (issues.length > 0) {
    throw new Error(`invalid_simulation_input: ${Array.from(new Set(issues)).join(' | ')}`);
  }
}

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
const maxOf = (values: number[]) =>
  values.length ? values.reduce((acc, value) => (value > acc ? value : acc), values[0]) : -Infinity;


function normalizeDiagnosticWarnings(notes: string[], status: MortgageProjectionStatus): string[] {
  const warnings: string[] = [];
  for (const note of notes) {
    if (note.startsWith('warn-and-run:')) {
      warnings.push(`mortgage:${note.slice('warn-and-run:'.length)}`);
      continue;
    }
    if (note.startsWith('mortgage-uf-')) {
      warnings.push(`mortgage:${note.slice('mortgage-uf-'.length)}`);
    }
  }
  if (status === 'fallback_incomplete') {
    warnings.push('mortgage:fallback-incomplete');
  }
  return Array.from(new Set(warnings));
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

function runSimulationParametricLegacyInternal(params: ModelParameters): ParametricCoreAudit {
  const t0 = Date.now();
  const {
    capitalInitial: W0,
    weights,
    feeAnnual,
    spendingPhases,
    spendingRule,
    returns: ret,
    inflation: inf,
    fx,
    simulation: sim,
    ruinThresholdMonths,
  } = params;

  const T = sim.horizonMonths;
  const N = sim.nSim;
  const phi = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));

  // Motor 2 usa una parametrizacion multivariada normal simple.
  // La matriz explicita de correlacion gobierna los 4 sleeves.
  const m4 = [
    (1 + ret.rvGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rfGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rvChileAnnual) ** (1 / 12) - 1,
    (1 + ret.rfChileUFAnnual) ** (1 / 12) - 1,
  ];
  const v4 = [
    ret.rvGlobalVolAnnual,
    ret.rfGlobalVolAnnual,
    ret.rvChileVolAnnual,
    ret.rfChileVolAnnual,
  ].map(x => x / Math.sqrt(12));
  const L4 = cholesky(ret.correlationMatrix);
  const rng = seededRNG(sim.seed);

  const ipcMean = (1 + inf.ipcChileAnnual) ** (1 / 12) - 1;
  const ipcStd = inf.ipcChileVolAnnual / Math.sqrt(12);
  const hicpMean = (1 + inf.hipcEurAnnual) ** (1 / 12) - 1;
  const hicpStd = inf.hipcEurVolAnnual / Math.sqrt(12);
  const dLogClpUsdMean = BASE_ECONOMIC_ASSUMPTIONS.clpUsdDriftAnnual / 12;
  const dLogClpUsdStd = 0.094 / Math.sqrt(12);
  const dLogEurUsdMean = BASE_ECONOMIC_ASSUMPTIONS.eurUsdDriftAnnual / 12;
  const dLogEurUsdStd = 0.093 / Math.sqrt(12);

  const w = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile];

  let nRuin = 0;
  const terminalWSurvivors: number[] = [];
  const terminalWAllPaths: number[] = [];
  const maxDDs: number[] = [];
  const ruinMonths: number[] = [];
  const spRatios: number[] = [];
  let cutMonths = 0;
  let totalMonths = 0;
  const FAN_RES = 3;
  const fanLen = Math.floor(T / FAN_RES);
  const wMatrix = new Float32Array(N * fanLen);

  const generateSleeveReturns = (): number[] => {
    const z = Array.from({ length: 4 }, () => randn(rng));
    const c = new Array(4).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j <= i; j++) c[i] += L4[i][j] * z[j];
    }
    return c.map((ci, i) => m4[i] + v4[i] * ci);
  };

  for (let s = 0; s < N; s++) {
    let sl = w.map(wi => wi * W0);
    let cumCL = 1;
    let cumEUR = 1;
    let logCPU = Math.log(fx.clpUsdInitial);
    let logCPUr = 0;
    let logEURUSD = Math.log(fx.usdEurFixed);
    let hwm = W0;
    let smult = 1;
    let cnt15 = 0;
    let cnt25 = 0;
    let maxDD = 0;
    let gEff = 0;
    let gPlan = 0;
    let ruined = false;

    for (let t = 0; t < T; t++) {
      const [rRVg, rRFg, rRVcl, rRFclReal] = generateSleeveReturns();
      const ipcM = ipcMean + (ipcStd * randn(rng));
      const hicpM = hicpMean + (hicpStd * randn(rng));
      const dLogFX = dLogClpUsdMean + (dLogClpUsdStd * randn(rng));
      const dLogEURUSD = dLogEurUsdMean + (dLogEurUsdStd * randn(rng));
      const rRFcl = ((1 + rRFclReal) * (1 + ipcM)) - 1;

      cumCL *= (1 + ipcM);
      cumEUR *= (1 + hicpM);

      const logLT = Math.log(fx.tcrealLT / fx.clpUsdInitial);
      const uPrev = logCPUr - logLT;
      logCPU += dLogFX + (phi * uPrev - uPrev);
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
      if (dd < maxDD) maxDD = dd;

      cnt15 = dd <= -0.15 ? cnt15 + 1 : 0;
      cnt25 = dd <= -0.25 ? cnt25 + 1 : 0;
      const tgt = getSpendingTarget(cnt15, cnt25, spendingRule);
      smult = updateSpendingMultiplier(smult, tgt, spendingRule);

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
      gPlan += GB;
      gEff += G;
      totalMonths += 1;
      if (smult < 0.999) cutMonths += 1;

      if (Wp <= ruinThresholdMonths * G) {
        ruined = true;
        nRuin += 1;
        ruinMonths.push(mes);
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

    const finalTerminalWealth = ruined ? 0 : sl.reduce((a, b) => a + b, 0);
    if (!ruined) terminalWSurvivors.push(finalTerminalWealth);
    terminalWAllPaths.push(finalTerminalWealth);
    maxDDs.push(maxDD);
    if (gPlan > 0) spRatios.push(gEff / gPlan);
  }

  const pcts = [5, 10, 25, 50, 75, 90, 95];
  const sortTW = [...terminalWSurvivors].sort((a, b) => a - b);
  const sortTWAll = [...terminalWAllPaths].sort((a, b) => a - b);
  const twPct: Record<number, number> = {};
  pcts.forEach(p => { twPct[p] = percentile(sortTW, p); });

  const sortDD = [...maxDDs].sort((a, b) => a - b);
  const ddPct: Record<number, number> = {};
  pcts.forEach(p => { ddPct[p] = percentile(sortDD, p); });

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
    results: {
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
      params,
    },
    ruinMonths,
    cutMonths,
    totalMonths,
  };
}

function runSimulationParametricBlocksInternal(params: ModelParameters): ParametricCoreAudit {
  const t0 = Date.now();
  const {
    spendingPhases,
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

  const m4 = [
    (1 + ret.rvGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rfGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rvChileAnnual) ** (1 / 12) - 1,
    (1 + ret.rfChileUFAnnual) ** (1 / 12) - 1,
  ];
  const v4 = [
    ret.rvGlobalVolAnnual,
    ret.rfGlobalVolAnnual,
    ret.rvChileVolAnnual,
    ret.rfChileVolAnnual,
  ].map((x) => x / Math.sqrt(12));
  const L4 = cholesky(ret.correlationMatrix);
  const rng = seededRNG(sim.seed);

  const ipcMean = (1 + inf.ipcChileAnnual) ** (1 / 12) - 1;
  const ipcStd = inf.ipcChileVolAnnual / Math.sqrt(12);
  const hicpMean = (1 + inf.hipcEurAnnual) ** (1 / 12) - 1;
  const hicpStd = inf.hipcEurVolAnnual / Math.sqrt(12);
  const dLogClpUsdMean = BASE_ECONOMIC_ASSUMPTIONS.clpUsdDriftAnnual / 12;
  const dLogClpUsdStd = 0.094 / Math.sqrt(12);
  const dLogEurUsdMean = BASE_ECONOMIC_ASSUMPTIONS.eurUsdDriftAnnual / 12;
  const dLogEurUsdStd = 0.093 / Math.sqrt(12);
  const bankAnnual = Math.max(0, Math.min(ret.rfGlobalAnnual, ret.rfChileUFAnnual));
  const bankMonthly = (1 + bankAnnual) ** (1 / 12) - 1;

  const realEstateInput = composition?.nonOptimizable?.realEstate;
  const mortgageProjection = buildMortgageProjection(realEstateInput, T);
  const amortizationScheduleUF = mortgageProjection.amortizationUF;
  const preserveFallbackEquity = mortgageProjection.status === 'fallback_incomplete' && (realEstateInput?.realEstateEquityCLP ?? 0) > 0;
  const diagnosticWarnings = normalizeDiagnosticWarnings(mortgageProjection.notes, mortgageProjection.status);
  if (preserveFallbackEquity) {
    diagnosticWarnings.push('mortgage:fallback-preserve-equity-clp');
  }
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
  const terminalAdjustmentApplied = terminalAdjustment > 0;
  const postSaleExpenseFloorClp = 6_000_000;

  let nRuin = 0;
  const terminalWSurvivors: number[] = [];
  const terminalWAllPaths: number[] = [];
  const maxDDs: number[] = [];
  const ruinMonths: number[] = [];
  const saleTriggeredMonths: number[] = [];
  const saleExecutedMonths: number[] = [];
  const rebalanceMonths: number[] = [];
  const bucketTargets: number[] = [];
  const bucketBeforeRebalances: number[] = [];
  const bucketAfterRebalances: number[] = [];
  const spRatios: number[] = [];
  let cutMonths = 0;
  let totalMonths = 0;
  const FAN_RES = 3;
  const fanLen = Math.floor(T / FAN_RES);
  const wMatrix = new Float32Array(N * fanLen);

  const generateSleeveReturns = (): number[] => {
    const z = Array.from({ length: 4 }, () => randn(rng));
    const c = new Array(4).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j <= i; j++) c[i] += L4[i][j] * z[j];
    }
    return c.map((ci, i) => m4[i] + v4[i] * ci);
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

    for (let t = 0; t < T; t++) {
      const month = t + 1;
      const [rRVg, rRFg, rRVcl, rRFclReal] = generateSleeveReturns();
      const ipcM = ipcMean + (ipcStd * randn(rng));
      const hicpM = hicpMean + (hicpStd * randn(rng));
      const dLogFX = dLogClpUsdMean + (dLogClpUsdStd * randn(rng));
      const dLogEURUSD = dLogEurUsdMean + (dLogEurUsdStd * randn(rng));
      const rRFcl = ((1 + rRFclReal) * (1 + ipcM)) - 1;

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
      applyCashflowEvents(sleevesArray, params.cashflowEvents, t + 1, CPU_t, EURUSDt);
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
      totalMonths += 1;
      if (smult < 0.999) cutMonths += 1;

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
        const rebalanceResult = runAnnualRebalance(liquidState, params, G * 36);
        rebalanceMonths.push(month);
        bucketTargets.push(rebalanceResult.bucketTarget);
        bucketBeforeRebalances.push(rebalanceResult.bucketBeforeRebalance);
        bucketAfterRebalances.push(rebalanceResult.bucketAfterRebalance);
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

    if (saleTriggeredMonth !== null) saleTriggeredMonths.push(saleTriggeredMonth);
    if (saleExecutedMonth !== null) saleExecutedMonths.push(saleExecutedMonth);

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

  const pcts = [5, 10, 25, 50, 75, 90, 95];
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
    results: {
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
        simulationComposition: params.simulationComposition
          ? {
              ...params.simulationComposition,
              mortgageProjectionStatus: mortgageProjection.status,
              diagnostics: {
                ...(params.simulationComposition.diagnostics ?? {
                  sourceVersion: 2,
                  mode: compositionMode,
                  compositionGapCLP: 0,
                  compositionGapPct: 0,
                  notes: [],
                }),
                mode: compositionMode,
                diagnosticWarnings: [
                  ...(params.simulationComposition.diagnostics?.diagnosticWarnings ?? []),
                  ...diagnosticWarnings,
                ],
                saleTriggeredMonth:
                  saleTriggeredMonths.length > 0
                    ? Math.round(percentile([...saleTriggeredMonths].sort((a, b) => a - b), 50))
                    : undefined,
                saleExecutedMonth:
                  saleExecutedMonths.length > 0
                    ? Math.round(percentile([...saleExecutedMonths].sort((a, b) => a - b), 50))
                    : undefined,
                terminalAdjustmentApplied,
                terminalAdjustmentCLP: terminalAdjustmentApplied ? terminalAdjustment : 0,
                bucketTarget:
                  bucketTargets.length > 0
                    ? percentile([...bucketTargets].sort((a, b) => a - b), 50)
                    : undefined,
                bucketBeforeRebalance:
                  bucketBeforeRebalances.length > 0
                    ? percentile([...bucketBeforeRebalances].sort((a, b) => a - b), 50)
                    : undefined,
                bucketAfterRebalance:
                  bucketAfterRebalances.length > 0
                    ? percentile([...bucketAfterRebalances].sort((a, b) => a - b), 50)
                    : undefined,
                rebalanceMonth:
                  rebalanceMonths.length > 0
                    ? Math.round(percentile([...rebalanceMonths].sort((a, b) => a - b), 50))
                    : undefined,
                lastRebalanceMonth:
                  rebalanceMonths.length > 0
                    ? maxOf(rebalanceMonths)
                    : undefined,
                notes: [
                  ...(params.simulationComposition.diagnostics?.notes ?? []),
                  ...mortgageProjection.notes,
                  ...(preserveFallbackEquity ? ['mortgage-fallback-preserve-equity-clp'] : []),
                  `blocks-mode:${compositionMode}`,
                  `real-estate-sale:${saleEnabled ? 'enabled' : 'disabled'}`,
                  ...(rebalanceMonths.length > 0 ? ['annual-rebalance:enabled'] : []),
                  ...(terminalAdjustmentApplied ? ['terminal-adjustment:non-mortgage-debt'] : []),
                  `risk-capital-profile:${riskCapitalProfile}`,
                ],
              },
            }
          : undefined,
      },
    },
    ruinMonths,
    cutMonths,
    totalMonths,
  };
}

function runSimulationParametricInternal(params: ModelParameters): ParametricCoreAudit {
  validateSimulationInputs(params);
  if (params.simulationComposition?.mode && params.simulationComposition.mode !== 'legacy') {
    return runSimulationParametricBlocksInternal(params);
  }
  return runSimulationParametricLegacyInternal(params);
}

export function runSimulationParametric(params: ModelParameters): SimulationResults {
  return runSimulationParametricInternal(params).results;
}

export function runSimulationParametricAudit(params: ModelParameters): ParametricAuditResults {
  const audit = runSimulationParametricInternal(params);
  const N = audit.results.nTotal;
  return {
    probRuin: audit.results.probRuin,
    successRate: 1 - audit.results.probRuin,
    ruinLt20y: audit.ruinMonths.filter(month => month <= 240).length / N,
    ruinLt40y: audit.ruinMonths.filter(month => month <= 480).length / N,
    monthsCutPct: audit.totalMonths > 0 ? audit.cutMonths / audit.totalMonths : 0,
    terminalP50: audit.results.terminalWealthPercentiles[50] ?? 0,
  };
}
