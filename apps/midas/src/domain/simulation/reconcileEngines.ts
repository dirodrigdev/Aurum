import { DEFAULT_PARAMETERS, WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS } from '../model/defaults';
import { BASE_ECONOMIC_ASSUMPTIONS } from '../model/economicAssumptions';
import type { ModelParameters } from '../model/types';
import { runSimulationParametricAudit } from './engineParametric';
import { loadHistoricalData } from './historicalData';
import { preprocessHistoricalData } from './preprocessData';

type AuditResult = {
  probRuin: number;
  successRate: number;
  ruinLt20y: number;
  ruinLt40y: number;
  monthsCutPct: number;
  terminalP50: number;
};

type Motor1Flags = {
  usePreprocess: boolean;
  useWeightedBootstrap: boolean;
};

type AlignmentRow = {
  Supuesto: string;
  'Valor base comun': string;
  'Motor 1 usado': string;
  'Motor 2 usado': string;
  Alineado: string;
};

function cloneParams(params: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(params)) as ModelParameters;
}

function seededRNG(seed: number): () => number {
  let s = seed || Date.now();
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
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
      L[i][j] = i === j
        ? Math.sqrt(Math.max(0, m[i][i] - s))
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

function bootstrapPathUniform(data: number[][], T: number, blen: number, rng: () => number): number[][] {
  const H = data.length;
  const path: number[][] = [];
  while (path.length < T) {
    const s = Math.floor(rng() * (H - blen));
    for (let i = 0; i < blen && path.length < T; i++) path.push(data[s + i]);
  }
  return path;
}

function buildWeightedBootstrapWeights(H: number, blen: number) {
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
  return { normWeights, cdf };
}

function bootstrapPathWeighted(data: number[][], T: number, blen: number, rng: () => number): number[][] {
  const { cdf } = buildWeightedBootstrapWeights(data.length, blen);

  const sampleBlock = (): number => {
    const u = rng();
    let lo = 0;
    let hi = cdf.length - 1;
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
    for (let i = 0; i < blen && path.length < T; i++) path.push(data[s + i]);
  }
  return path;
}

function runMotor1Audit(baseParams: ModelParameters, flags: Motor1Flags): AuditResult {
  const params = cloneParams(baseParams);
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

  let histData: number[][] | null = loadHistoricalData();
  if (flags.usePreprocess) histData = preprocessHistoricalData(histData);

  const w = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile];

  let nRuin = 0;
  const ruinMonths: number[] = [];
  const terminalW: number[] = [];
  let cutMonths = 0;
  let totalMonths = 0;

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
    let ruined = false;

    const path = flags.useWeightedBootstrap
      ? bootstrapPathWeighted(histData, T, sim.blockLength, rng)
      : bootstrapPathUniform(histData, T, sim.blockLength, rng);

    for (let t = 0; t < T; t++) {
      const row = path[t];
      const rRVg = row[0];
      const rRFg = row[1];
      const rRVcl = (0.55 * row[2]) + (0.45 * row[3]);
      const ipc = row[5];
      const rRFcl = ((1 + row[4]) * (1 + ipc)) - 1;
      const hicpM = row[6];
      const dLogFX = row[7];
      const dLogEURUSD = row[8];

      cumCL *= (1 + ipc);
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
      totalMonths += 1;
      if (smult < 0.999) cutMonths += 1;

      if (Wp <= ruinThresholdMonths * G) {
        ruined = true;
        nRuin += 1;
        ruinMonths.push(mes);
        break;
      }

      const Wfin = sl.reduce((a, b) => a + b, 0);
      sl = sl.map(x => x - G * (x / Wfin));
    }

    if (!ruined) terminalW.push(sl.reduce((a, b) => a + b, 0));
  }

  const sortedTW = [...terminalW].sort((a, b) => a - b);
  return {
    probRuin: nRuin / N,
    successRate: 1 - (nRuin / N),
    ruinLt20y: ruinMonths.filter(month => month <= 240).length / N,
    ruinLt40y: ruinMonths.filter(month => month <= 480).length / N,
    monthsCutPct: totalMonths > 0 ? cutMonths / totalMonths : 0,
    terminalP50: percentile(sortedTW, 50),
  };
}

function buildMonthlyWeights(H: number, blen: number): number[] {
  const { normWeights } = buildWeightedBootstrapWeights(H, blen);
  const monthlyWeights = new Array(H).fill(0);
  for (let blockStart = 0; blockStart < normWeights.length; blockStart++) {
    const share = normWeights[blockStart] / blen;
    for (let offset = 0; offset < blen; offset++) {
      monthlyWeights[blockStart + offset] += share;
    }
  }
  return monthlyWeights;
}

function weightedMean(values: number[], weights: number[]): number {
  return values.reduce((acc, value, idx) => acc + (value * weights[idx]), 0);
}

function weightedAnnualizedLogReturn(values: number[], weights: number[]): number {
  const logMean = weightedMean(values.map(v => Math.log1p(v)), weights);
  return Math.expm1(logMean * 12);
}

function weightedAnnualizedVol(values: number[], weights: number[]): number {
  const mean = weightedMean(values, weights);
  const variance = values.reduce((acc, value, idx) => acc + (weights[idx] * ((value - mean) ** 2)), 0);
  return Math.sqrt(variance) * Math.sqrt(12);
}

function weightedCorrelation(a: number[], b: number[], weights: number[]): number {
  const meanA = weightedMean(a, weights);
  const meanB = weightedMean(b, weights);
  const cov = a.reduce((acc, value, idx) => acc + (weights[idx] * (value - meanA) * (b[idx] - meanB)), 0);
  const varA = a.reduce((acc, value, idx) => acc + (weights[idx] * ((value - meanA) ** 2)), 0);
  const varB = b.reduce((acc, value, idx) => acc + (weights[idx] * ((value - meanB) ** 2)), 0);
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMM(value: number): string {
  return `${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}MM`;
}

function getMotor1ImplicitStats() {
  const processed = preprocessHistoricalData(loadHistoricalData());
  const weights = buildMonthlyWeights(processed.length, DEFAULT_PARAMETERS.simulation.blockLength);
  const series = {
    rvGlobal: processed.map(row => row[0]),
    rfGlobal: processed.map(row => row[1]),
    rvChile: processed.map(row => (0.55 * row[2]) + (0.45 * row[3])),
    rfChileReal: processed.map(row => row[4]),
    rfChileNominal: processed.map(row => ((1 + row[4]) * (1 + row[5])) - 1),
    ipcChile: processed.map(row => row[5]),
    dLogClpUsd: processed.map(row => row[7]),
  };

  return {
    expectedReturns: {
      rvGlobal: weightedAnnualizedLogReturn(series.rvGlobal, weights),
      rfGlobal: weightedAnnualizedLogReturn(series.rfGlobal, weights),
      rvChile: weightedAnnualizedLogReturn(series.rvChile, weights),
      rfChileReal: weightedAnnualizedLogReturn(series.rfChileReal, weights),
      ipcChile: weightedAnnualizedLogReturn(series.ipcChile, weights),
      clpUsdDrift: weightedMean(series.dLogClpUsd, weights) * 12,
    },
    annualVols: {
      rvGlobal: weightedAnnualizedVol(series.rvGlobal, weights),
      rfGlobal: weightedAnnualizedVol(series.rfGlobal, weights),
      rvChile: weightedAnnualizedVol(series.rvChile, weights),
      rfChileNominal: weightedAnnualizedVol(series.rfChileNominal, weights),
    },
    correlations: {
      rvgRfg: weightedCorrelation(series.rvGlobal, series.rfGlobal, weights),
      rvgRvcl: weightedCorrelation(series.rvGlobal, series.rvChile, weights),
      rfgRfcl: weightedCorrelation(series.rfGlobal, series.rfChileNominal, weights),
    },
  };
}

function buildAlignmentTable(): AlignmentRow[] {
  const implicit = getMotor1ImplicitStats();
  return [
    {
      Supuesto: 'rvGlobalAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rvGlobalAnnual),
      'Motor 1 usado': `${fmtPct(DEFAULT_PARAMETERS.returns.rvGlobalAnnual)} target / ${fmtPct(implicit.expectedReturns.rvGlobal)} efectivo`,
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rvGlobalAnnual),
      Alineado: 'Base si / efectivo no',
    },
    {
      Supuesto: 'rfGlobalAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rfGlobalAnnual),
      'Motor 1 usado': `${fmtPct(DEFAULT_PARAMETERS.returns.rfGlobalAnnual)} target / ${fmtPct(implicit.expectedReturns.rfGlobal)} efectivo`,
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rfGlobalAnnual),
      Alineado: 'Base si / efectivo no',
    },
    {
      Supuesto: 'rvChileAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rvChileAnnual),
      'Motor 1 usado': `${fmtPct(DEFAULT_PARAMETERS.returns.rvChileAnnual)} target / ${fmtPct(implicit.expectedReturns.rvChile)} efectivo`,
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rvChileAnnual),
      Alineado: 'Base si / efectivo no',
    },
    {
      Supuesto: 'rfChileRealAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rfChileRealAnnual),
      'Motor 1 usado': `${fmtPct(DEFAULT_PARAMETERS.returns.rfChileUFAnnual)} target / ${fmtPct(implicit.expectedReturns.rfChileReal)} efectivo`,
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rfChileUFAnnual),
      Alineado: 'Base si / efectivo no',
    },
    {
      Supuesto: 'rvGlobalVolAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rvGlobalVolAnnual),
      'Motor 1 usado': fmtPct(implicit.annualVols.rvGlobal),
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rvGlobalVolAnnual),
      Alineado: 'Casi',
    },
    {
      Supuesto: 'rfGlobalVolAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rfGlobalVolAnnual),
      'Motor 1 usado': fmtPct(implicit.annualVols.rfGlobal),
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rfGlobalVolAnnual),
      Alineado: 'Casi',
    },
    {
      Supuesto: 'rvChileVolAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rvChileVolAnnual),
      'Motor 1 usado': fmtPct(implicit.annualVols.rvChile),
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rvChileVolAnnual),
      Alineado: 'Casi',
    },
    {
      Supuesto: 'rfChileVolAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.rfChileVolAnnual),
      'Motor 1 usado': fmtPct(implicit.annualVols.rfChileNominal),
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.returns.rfChileVolAnnual),
      Alineado: 'No exacto',
    },
    {
      Supuesto: 'ipcChileAnnual',
      'Valor base comun': fmtPct(BASE_ECONOMIC_ASSUMPTIONS.ipcChileAnnual),
      'Motor 1 usado': `${fmtPct(DEFAULT_PARAMETERS.inflation.ipcChileAnnual)} target / ${fmtPct(implicit.expectedReturns.ipcChile)} efectivo`,
      'Motor 2 usado': fmtPct(DEFAULT_PARAMETERS.inflation.ipcChileAnnual),
      Alineado: 'Base si / efectivo casi',
    },
    {
      Supuesto: 'tcrealLT',
      'Valor base comun': String(BASE_ECONOMIC_ASSUMPTIONS.tcrealLT),
      'Motor 1 usado': String(DEFAULT_PARAMETERS.fx.tcrealLT),
      'Motor 2 usado': String(DEFAULT_PARAMETERS.fx.tcrealLT),
      Alineado: 'Si',
    },
    {
      Supuesto: 'mrHalfLifeYears',
      'Valor base comun': String(BASE_ECONOMIC_ASSUMPTIONS.mrHalfLifeYears),
      'Motor 1 usado': String(DEFAULT_PARAMETERS.fx.mrHalfLifeYears),
      'Motor 2 usado': String(DEFAULT_PARAMETERS.fx.mrHalfLifeYears),
      Alineado: 'Si',
    },
    {
      Supuesto: 'correlacion RVg-RFg',
      'Valor base comun': BASE_ECONOMIC_ASSUMPTIONS.correlationMatrix[0][1].toFixed(2),
      'Motor 1 usado': implicit.correlations.rvgRfg.toFixed(2),
      'Motor 2 usado': DEFAULT_PARAMETERS.returns.correlationMatrix[0][1].toFixed(2),
      Alineado: 'Base si / efectivo no',
    },
    {
      Supuesto: 'correlacion RVg-RVcl',
      'Valor base comun': BASE_ECONOMIC_ASSUMPTIONS.correlationMatrix[0][2].toFixed(2),
      'Motor 1 usado': implicit.correlations.rvgRvcl.toFixed(2),
      'Motor 2 usado': DEFAULT_PARAMETERS.returns.correlationMatrix[0][2].toFixed(2),
      Alineado: 'Base si / efectivo no',
    },
    {
      Supuesto: 'correlacion RFg-RFcl',
      'Valor base comun': BASE_ECONOMIC_ASSUMPTIONS.correlationMatrix[1][3].toFixed(2),
      'Motor 1 usado': implicit.correlations.rfgRfcl.toFixed(2),
      'Motor 2 usado': DEFAULT_PARAMETERS.returns.correlationMatrix[1][3].toFixed(2),
      Alineado: 'Base si / efectivo no',
    },
  ];
}

function buildCleanComparisonTable() {
  const params = cloneParams(DEFAULT_PARAMETERS);
  return [
    {
      Motor: 'Motor 1 bootstrap',
      ...runMotor1Audit(params, { usePreprocess: true, useWeightedBootstrap: true }),
    },
    {
      Motor: 'Motor 2 parametric',
      ...runSimulationParametricAudit(params),
    },
  ];
}

const alignment = buildAlignmentTable();
const comparison = buildCleanComparisonTable();

console.log('\nTABLA COMPARATIVA LIMPIA MOTOR 1 VS MOTOR 2');
console.table(comparison.map((row) => ({
  motor: row.Motor,
  probRuin: fmtPct(row.probRuin),
  successRate: fmtPct(row.successRate),
  ruin_lt_20y: fmtPct(row.ruinLt20y),
  ruin_lt_40y: fmtPct(row.ruinLt40y),
  months_cut_pct: fmtPct(row.monthsCutPct),
  terminalP50: fmtMM(row.terminalP50),
})));

console.log('\nTABLA DE VERIFICACION DE ALINEACION');
console.table(alignment);
