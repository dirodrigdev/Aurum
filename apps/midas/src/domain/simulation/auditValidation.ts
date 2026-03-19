import { DEFAULT_PARAMETERS, WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import { loadHistoricalData } from './historicalData';
import {
  DEFAULT_FORWARD_TARGETS,
  preprocessHistoricalData,
} from './preprocessData';

type VariantName = 'A_baseline_viejo' | 'B_preprocess_only' | 'C_weighted_only' | 'D_preprocess_weighted';

type VariantFlags = {
  usePreprocess: boolean;
  useWeightedBootstrap: boolean;
};

type VariantResult = {
  probRuin: number;
  successRate: number;
  ruinLt20y: number;
  ruinLt40y: number;
  monthsCutPct: number;
  terminalP50: number;
};

type PeriodWeight = {
  period: string;
  totalWeight: number;
  pctTotal: number;
};

const SERIES_KEYS = [
  'rvGlobal',
  'rfGlobal',
  'rvChile',
  'rfChile',
  'ipcChile',
  'clpUsdDrift',
] as const;

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

function annualizedReturn(col: number[]): number {
  const logReturns = col.map(r => Math.log1p(r));
  const monthlyMean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  return Math.expm1(monthlyMean * 12);
}

function annualizedVol(col: number[]): number {
  const mean = col.reduce((a, b) => a + b, 0) / col.length;
  const variance = col.reduce((acc, value) => acc + ((value - mean) ** 2), 0) / Math.max(1, col.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

function buildSeriesMap(data: number[][]) {
  return {
    rvGlobal: data.map(row => row[0]),
    rfGlobal: data.map(row => row[1]),
    rvChile: data.map(row => (0.55 * row[2]) + (0.45 * row[3])),
    rfChile: data.map(row => row[4]),
    ipcChile: data.map(row => row[5]),
    clpUsdDrift: data.map(row => row[7]),
  };
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
  const H = data.length;
  const { cdf } = buildWeightedBootstrapWeights(H, blen);

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

function runVariant(
  baseParams: ModelParameters,
  flags: VariantFlags,
): VariantResult {
  const params = cloneParams(baseParams);
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
  const m = [
    (1 + ret.rvGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rfGlobalAnnual) ** (1 / 12) - 1,
    (1 + ret.rvChileAnnual) ** (1 / 12) - 1,
    (1 + ret.rfChileUFAnnual + inf.ipcChileAnnual) ** (1 / 12) - 1,
    (1 + inf.ipcChileAnnual) ** (1 / 12) - 1,
    0.020 / 12,
  ];
  const v = [
    ret.rvGlobalVolAnnual,
    ret.rfGlobalVolAnnual,
    ret.rvChileVolAnnual,
    ret.rfChileVolAnnual,
    inf.ipcChileVolAnnual,
    0.094,
  ].map(x => x / Math.sqrt(12));
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

  let histData: number[][] | null = null;
  if (sim.useHistoricalData) {
    histData = loadHistoricalData();
    if (flags.usePreprocess) histData = preprocessHistoricalData(histData);
  }

  const w = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile];
  const HICP_MEAN = (1 + inf.hipcEurAnnual) ** (1 / 12) - 1;
  const HICP_STD = inf.hipcEurVolAnnual / Math.sqrt(12);

  let nRuin = 0;
  const ruinMonths: number[] = [];
  const terminalW: number[] = [];
  let cutMonths = 0;
  let totalMonths = 0;

  const generateRow = (localRng: () => number): number[] => {
    const z = Array.from({ length: 6 }, () => randn(localRng));
    const c = new Array(6).fill(0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j <= i; j++) c[i] += L[i][j] * z[j];
    }
    return c.map((ci, i) => m[i] + v[i] * ci);
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
    let ruined = false;

    const path = histData
      ? (flags.useWeightedBootstrap
        ? bootstrapPathWeighted(histData, T, sim.blockLength, rng)
        : bootstrapPathUniform(histData, T, sim.blockLength, rng))
      : null;

    for (let t = 0; t < T; t++) {
      let r: number[];
      let dLogEURUSD: number;
      let hicpM: number;
      if (path) {
        const row = path[t];
        const rvg = row[0];
        const rfg = row[1];
        const rvCL = 0.55 * row[2] + 0.45 * row[3];
        const rfCLReal = row[4];
        const ipc = row[5];
        const rfCLNominal = ((1 + rfCLReal) * (1 + ipc)) - 1;
        hicpM = row[6];
        const dfx = row[7];
        dLogEURUSD = row[8];
        r = [rvg, rfg, rvCL, rfCLNominal, ipc, dfx];
        cumCL *= (1 + ipc);
        cumEUR *= (1 + hicpM);
      } else {
        r = generateRow(rng);
        dLogEURUSD = 0.0076 / 12 + (0.093 / Math.sqrt(12)) * randn(rng);
        hicpM = HICP_MEAN + randn(rng) * HICP_STD;
        cumCL *= (1 + r[4]);
        cumEUR *= (1 + hicpM);
      }

      const [rRVg, rRFg, rRVcl, rRFcl, _ipcM, dLogFX] = r;

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

function computePreprocessTable() {
  const original = loadHistoricalData();
  const adjusted = preprocessHistoricalData(original);
  const originalSeries = buildSeriesMap(original);
  const adjustedSeries = buildSeriesMap(adjusted);

  return SERIES_KEYS.map((key) => {
    const originalMean = annualizedReturn(originalSeries[key]);
    const adjustedMean = annualizedReturn(adjustedSeries[key]);
    const originalVol = annualizedVol(originalSeries[key]);
    const adjustedVol = annualizedVol(adjustedSeries[key]);
    return {
      serie: key,
      mediaAnualOriginal: originalMean,
      mediaAnualAjustada: adjustedMean,
      volAnualOriginal: originalVol,
      volAnualAjustada: adjustedVol,
      deltaMedia: adjustedMean - originalMean,
      deltaVol: adjustedVol - originalVol,
    };
  });
}

function computeWeightedPeriodTable() {
  const data = loadHistoricalData();
  const blen = DEFAULT_PARAMETERS.simulation.blockLength;
  const { normWeights } = buildWeightedBootstrapWeights(data.length, blen);
  const monthlyWeights = new Array(data.length).fill(0);

  for (let blockStart = 0; blockStart < normWeights.length; blockStart++) {
    const share = normWeights[blockStart] / blen;
    for (let offset = 0; offset < blen; offset++) {
      monthlyWeights[blockStart + offset] += share;
    }
  }

  const periods = [
    { period: '2000-2009', from: 2000, to: 2009 },
    { period: '2010-2019', from: 2010, to: 2019 },
    { period: '2020-2026', from: 2020, to: 2026 },
  ];

  const periodWeights: PeriodWeight[] = periods.map(({ period, from, to }) => {
    const totalWeight = data.reduce((acc, row, idx) => {
      const year = 2000 + Math.floor(idx / 12);
      return year >= from && year <= to ? acc + monthlyWeights[idx] : acc;
    }, 0);
    return {
      period,
      totalWeight,
      pctTotal: totalWeight * 100,
    };
  });

  return {
    periodWeights,
    totalPct: periodWeights.reduce((acc, item) => acc + item.pctTotal, 0),
    recentVsOldestRatio: periodWeights[2].totalWeight / periodWeights[0].totalWeight,
    weight2008Pct: data.reduce((acc, _row, idx) => {
      const year = 2000 + Math.floor(idx / 12);
      return year === 2008 ? acc + monthlyWeights[idx] : acc;
    }, 0) * 100,
  };
}

function computeVariantTable() {
  const variants: Array<[VariantName, VariantFlags]> = [
    ['A_baseline_viejo', { usePreprocess: false, useWeightedBootstrap: false }],
    ['B_preprocess_only', { usePreprocess: true, useWeightedBootstrap: false }],
    ['C_weighted_only', { usePreprocess: false, useWeightedBootstrap: true }],
    ['D_preprocess_weighted', { usePreprocess: true, useWeightedBootstrap: true }],
  ];

  const params = cloneParams(DEFAULT_PARAMETERS);
  return variants.map(([name, flags]) => ({
    variant: name,
    ...runVariant(params, flags),
  }));
}

function fmtPct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtAnnual(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMM(value: number) {
  return `${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}MM`;
}

function printValidation1() {
  console.log('\nVALIDACION 1 - PREPROCESS ANTES / DESPUES');
  const rows = computePreprocessTable().map((row) => ({
    serie: row.serie,
    media_anual_original: fmtAnnual(row.mediaAnualOriginal),
    media_anual_ajustada: fmtAnnual(row.mediaAnualAjustada),
    vol_anual_original: fmtAnnual(row.volAnualOriginal),
    vol_anual_ajustada: fmtAnnual(row.volAnualAjustada),
    delta_media: fmtAnnual(row.deltaMedia),
    delta_vol: fmtAnnual(row.deltaVol),
  }));
  console.table(rows);
  console.log('Forward targets usados:', DEFAULT_FORWARD_TARGETS);
}

function printValidation2() {
  console.log('\nVALIDACION 2 - PESO EFECTIVO WEIGHTED BOOTSTRAP');
  const result = computeWeightedPeriodTable();
  console.table(result.periodWeights.map((row) => ({
    periodo: row.period,
    peso_total: row.totalWeight.toFixed(6),
    pct_total: `${row.pctTotal.toFixed(2)}%`,
  })));
  console.log(`Suma total de pesos: ${result.totalPct.toFixed(4)}%`);
  console.log(`Ratio 2020-2026 vs 2000-2009: ${result.recentVsOldestRatio.toFixed(2)}x`);
  console.log(`Peso agregado 2008: ${result.weight2008Pct.toFixed(2)}%`);
}

function printValidation3() {
  console.log('\nVALIDACION 3 - ATRIBUCION DE CAMBIOS');
  const rows = computeVariantTable().map((row) => ({
    variante: row.variant,
    probRuin: fmtPct(row.probRuin),
    successRate: fmtPct(row.successRate),
    ruin_lt_20y: fmtPct(row.ruinLt20y),
    ruin_lt_40y: fmtPct(row.ruinLt40y),
    months_cut_pct: fmtPct(row.monthsCutPct),
    terminalP50: fmtMM(row.terminalP50),
  }));
  console.table(rows);
  console.log('Nota: months_cut_pct = porcentaje de meses simulados con spending multiplier < 1.0.');
}

function printValidation4() {
  console.log('\nVALIDACION 4 - SMOKE TEST rfChile');
  console.log('1) Serie historica usada por el preprocess para rfChile: row[4] = r_RFcl_UF, tratada como retorno real / UF.');
  console.log(`2) El preprocess le aplica target anual real de ${(DEFAULT_FORWARD_TARGETS.rfChileReal * 100).toFixed(2)}%.`);
  console.log('3) En la rama bootstrap del motor, row[4] se convierte a retorno nominal mensual via (1 + r_real) * (1 + IPC) - 1 antes de aplicarlo al sleeve.');
  console.log('4) Eso queda consistente con la rama parametrica, donde rfChileUFAnnual tambien representa retorno real y luego se lleva a nominal sumando inflacion.');
}

printValidation1();
printValidation2();
printValidation3();
printValidation4();
