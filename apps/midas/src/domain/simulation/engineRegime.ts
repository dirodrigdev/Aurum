import type {
  ModelParameters,
  SimulationResults,
  FanChartPoint,
} from '../model/types';
import { BASE_ECONOMIC_ASSUMPTIONS } from '../model/economicAssumptions';

type RegimeId = 'normal' | 'stress' | 'recovery';

type RegimeAuditResults = {
  probRuin: number;
  successRate: number;
  ruinLt20y: number;
  ruinLt40y: number;
  monthsCutPct: number;
  terminalP50: number;
};

type RegimeCoreAudit = {
  results: SimulationResults;
  ruinMonths: number[];
  cutMonths: number;
  totalMonths: number;
};

type RegimeAnnualSpec = {
  returns: {
    rvGlobalAnnual: number;
    rfGlobalAnnual: number;
    rvChileAnnual: number;
    rfChileRealAnnual: number;
  };
  vols: {
    rvGlobalVolAnnual: number;
    rfGlobalVolAnnual: number;
    rvChileVolAnnual: number;
    rfChileVolAnnual: number;
  };
  correlationMatrix: number[][];
};

const SLEEVE_KEYS = ['rvGlobal', 'rfGlobal', 'rvChile', 'rfChile'] as const;
const CASHFLOW_WATERFALL_ORDER = [3, 1, 2, 0] as const;

// Motor 3 busca un termino medio metodologico:
// explicita pocos regimenes y transiciones simples, sin depender del bootstrap reciente.
const REGIME_TRANSITIONS: Record<RegimeId, Array<{ to: RegimeId; p: number }>> = {
  normal: [
    { to: 'normal', p: 0.9975 },
    { to: 'stress', p: 0.0025 },
  ],
  stress: [
    { to: 'stress', p: 0.55 },
    { to: 'recovery', p: 0.45 },
  ],
  recovery: [
    { to: 'recovery', p: 0.80 },
    { to: 'normal', p: 0.20 },
  ],
};

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

function nextRegime(current: RegimeId, rng: () => number): RegimeId {
  const u = rng();
  let acc = 0;
  for (const edge of REGIME_TRANSITIONS[current]) {
    acc += edge.p;
    if (u <= acc) return edge.to;
  }
  return REGIME_TRANSITIONS[current][REGIME_TRANSITIONS[current].length - 1].to;
}

function buildRegimeSpecs(params: ModelParameters): Record<RegimeId, RegimeAnnualSpec> {
  const { returns: ret } = params;

  return {
    normal: {
      returns: {
        rvGlobalAnnual: ret.rvGlobalAnnual,
        rfGlobalAnnual: ret.rfGlobalAnnual,
        rvChileAnnual: ret.rvChileAnnual,
        rfChileRealAnnual: ret.rfChileUFAnnual,
      },
      vols: {
        rvGlobalVolAnnual: ret.rvGlobalVolAnnual,
        rfGlobalVolAnnual: ret.rfGlobalVolAnnual,
        rvChileVolAnnual: ret.rvChileVolAnnual,
        rfChileVolAnnual: ret.rfChileVolAnnual,
      },
      correlationMatrix: ret.correlationMatrix,
    },
    stress: {
      returns: {
        rvGlobalAnnual: 0.000,
        rfGlobalAnnual: 0.019,
        rvChileAnnual: -0.010,
        rfChileRealAnnual: 0.005,
      },
      vols: {
        rvGlobalVolAnnual: ret.rvGlobalVolAnnual * 1.32,
        rfGlobalVolAnnual: ret.rfGlobalVolAnnual * 1.18,
        rvChileVolAnnual: ret.rvChileVolAnnual * 1.38,
        rfChileVolAnnual: ret.rfChileVolAnnual * 1.18,
      },
      correlationMatrix: [
        [1.00, 0.24, 0.78, 0.34],
        [0.24, 1.00, 0.36, 0.42],
        [0.78, 0.36, 1.00, 0.28],
        [0.34, 0.42, 0.28, 1.00],
      ],
    },
    recovery: {
      returns: {
        rvGlobalAnnual: 0.150,
        rfGlobalAnnual: 0.033,
        rvChileAnnual: 0.170,
        rfChileRealAnnual: 0.015,
      },
      vols: {
        rvGlobalVolAnnual: ret.rvGlobalVolAnnual * 1.10,
        rfGlobalVolAnnual: ret.rfGlobalVolAnnual * 1.05,
        rvChileVolAnnual: ret.rvChileVolAnnual * 1.12,
        rfChileVolAnnual: ret.rfChileVolAnnual * 1.05,
      },
      correlationMatrix: [
        [1.00, 0.16, 0.72, 0.28],
        [0.16, 1.00, 0.28, 0.28],
        [0.72, 0.28, 1.00, 0.20],
        [0.28, 0.28, 0.20, 1.00],
      ],
    },
  };
}

function runSimulationRegimeInternal(params: ModelParameters): RegimeCoreAudit {
  const t0 = Date.now();
  const {
    capitalInitial: W0,
    weights,
    feeAnnual,
    spendingPhases,
    spendingRule,
    inflation: inf,
    fx,
    simulation: sim,
    ruinThresholdMonths,
  } = params;

  const T = sim.horizonMonths;
  const N = sim.nSim;
  const phi = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));
  const rng = seededRNG(sim.seed);
  const specs = buildRegimeSpecs(params);

  const regimeSamplers = (Object.keys(specs) as RegimeId[]).reduce((acc, regime) => {
    const spec = specs[regime];
    const monthlyMeans = [
      (1 + spec.returns.rvGlobalAnnual) ** (1 / 12) - 1,
      (1 + spec.returns.rfGlobalAnnual) ** (1 / 12) - 1,
      (1 + spec.returns.rvChileAnnual) ** (1 / 12) - 1,
      (1 + spec.returns.rfChileRealAnnual) ** (1 / 12) - 1,
    ];
    const monthlyVols = [
      spec.vols.rvGlobalVolAnnual,
      spec.vols.rfGlobalVolAnnual,
      spec.vols.rvChileVolAnnual,
      spec.vols.rfChileVolAnnual,
    ].map(x => x / Math.sqrt(12));
    const chol = cholesky(spec.correlationMatrix);
    acc[regime] = { monthlyMeans, monthlyVols, chol };
    return acc;
  }, {} as Record<RegimeId, { monthlyMeans: number[]; monthlyVols: number[]; chol: number[][] }>);

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
  const terminalW: number[] = [];
  const maxDDs: number[] = [];
  const ruinMonths: number[] = [];
  const spRatios: number[] = [];
  let cutMonths = 0;
  let totalMonths = 0;
  const FAN_RES = 3;
  const fanLen = Math.floor(T / FAN_RES);
  const wMatrix = new Float32Array(N * fanLen);

  const generateSleeveReturns = (regime: RegimeId): number[] => {
    const sampler = regimeSamplers[regime];
    const z = Array.from({ length: 4 }, () => randn(rng));
    const c = new Array(4).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j <= i; j++) c[i] += sampler.chol[i][j] * z[j];
    }
    return c.map((ci, i) => sampler.monthlyMeans[i] + sampler.monthlyVols[i] * ci);
  };

  for (let s = 0; s < N; s++) {
    let regime: RegimeId = 'normal';
    let sl = w.map(wi => wi * W0);
    let cumCL = 1;
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
      regime = nextRegime(regime, rng);
      const [rRVg, rRFg, rRVcl, rRFclReal] = generateSleeveReturns(regime);

      const ipcShock = regime === 'stress' ? 0.0006 : regime === 'recovery' ? 0.0002 : 0;
      const hicpShock = regime === 'stress' ? 0.0005 : 0;
      const fxShock = regime === 'stress' ? 0.0018 : regime === 'recovery' ? -0.0013 : 0;

      const ipcM = ipcMean + ipcShock + (ipcStd * randn(rng));
      const hicpM = hicpMean + hicpShock + (hicpStd * randn(rng));
      const dLogFX = dLogClpUsdMean + fxShock + (dLogClpUsdStd * randn(rng));
      const dLogEURUSD = dLogEurUsdMean + (dLogEurUsdStd * randn(rng));
      const rRFcl = ((1 + rRFclReal) * (1 + ipcM)) - 1;

      cumCL *= (1 + ipcM);

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
      applyCashflowEvents(sl, params.cashflowEvents, t + 1, CPU_t, EURUSDt, cumCL);
      const Wp = sl.reduce((a, b) => a + b, 0);

      const Wr = Wp / cumCL;
      if (Wr > hwm) hwm = Wr;
      const dd = (Wr - hwm) / hwm;
      if (dd < maxDD) maxDD = dd;

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

    if (!ruined) terminalW.push(sl.reduce((a, b) => a + b, 0));
    maxDDs.push(maxDD);
    if (gPlan > 0) spRatios.push(gEff / gPlan);
  }

  const pcts = [5, 10, 25, 50, 75, 90, 95];
  const sortTW = [...terminalW].sort((a, b) => a - b);
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

export function runSimulationRegime(params: ModelParameters): SimulationResults {
  return runSimulationRegimeInternal(params).results;
}

export function runSimulationRegimeAudit(params: ModelParameters): RegimeAuditResults {
  const audit = runSimulationRegimeInternal(params);
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
