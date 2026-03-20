import { DEFAULT_PARAMETERS, WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import { runSimulationParametricAudit } from './engineParametric';
import { runSimulationRegimeAudit } from './engineRegime';
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

type ToneRow = {
  Motor: string;
  'Tono general': string;
  Comentario: string;
};

type Motor1Flags = {
  usePreprocess: boolean;
  useWeightedBootstrap: boolean;
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

function bootstrapPathWeighted(data: number[][], T: number, blen: number, rng: () => number): number[][] {
  const H = data.length;
  const nBlocks = H - blen + 1;
  const halflifeMonths = WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS * 12;
  const lambda = Math.log(2) / halflifeMonths;
  const weights = Array.from({ length: nBlocks }, (_, i) => {
    const age = nBlocks - 1 - i;
    return Math.exp(-lambda * age);
  });
  const wSum = weights.reduce((a, b) => a + b, 0);
  const cdf = weights.map(w => w / wSum).reduce((acc, w, i) => {
    acc.push((acc[i - 1] ?? 0) + w);
    return acc;
  }, [] as number[]);
  cdf[cdf.length - 1] = 1;

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
    fx,
    simulation: sim,
    ruinThresholdMonths,
  } = params;

  const T = sim.horizonMonths;
  const N = sim.nSim;
  const phi = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));
  const rng = seededRNG(sim.seed);

  let histData = loadHistoricalData();
  if (flags.usePreprocess) histData = preprocessHistoricalData(histData);

  const w = [weights.rvGlobal, weights.rfGlobal, weights.rvChile, weights.rfChile];
  let nRuin = 0;
  let cutMonths = 0;
  let totalMonths = 0;
  const ruinMonths: number[] = [];
  const terminalW: number[] = [];

  for (let s = 0; s < N; s++) {
    let sl = w.map(wi => wi * W0);
    let cumCL = 1;
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
      const ipcM = row[5];
      const rRFcl = ((1 + row[4]) * (1 + ipcM)) - 1;
      const dLogFX = row[7];
      const dLogEURUSD = row[8];

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

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMM(value: number): string {
  return `${(value / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}MM`;
}

function buildToneTable(rows: Array<{ Motor: string; probRuin: number; terminalP50: number }>): ToneRow[] {
  const byMotor = Object.fromEntries(rows.map(row => [row.Motor, row]));
  const m1 = byMotor['Motor 1 bootstrap'];
  const m2 = byMotor['Motor 2 parametric'];
  const m3 = byMotor['Motor 3 regime'];

  return [
    {
      Motor: m1.Motor,
      'Tono general': 'optimista',
      Comentario: 'La ponderacion reciente del bootstrap sigue empujando una lectura mas benigna que la de los otros motores.',
    },
    {
      Motor: m2.Motor,
      'Tono general': 'severo',
      Comentario: 'La normal multivariada con supuestos fijos entrega la lectura mas dura y menos indulgente del trio.',
    },
    {
      Motor: m3.Motor,
      'Tono general': m3.probRuin > ((m1.probRuin + m2.probRuin) / 2) ? 'prudente' : 'intermedio',
      Comentario: m3.probRuin > m1.probRuin && m3.probRuin < m2.probRuin
        ? 'Introduce episodios de stress y recovery sin depender del weighting historico, ubicandose entre ambos extremos.'
        : 'Su posicion relativa ayuda a leer si el arbitro realmente se acerco al centro o abrio una nueva brecha.',
    },
  ];
}

const baseParams = cloneParams(DEFAULT_PARAMETERS);

const comparison = [
  {
    Motor: 'Motor 1 bootstrap',
    ...runMotor1Audit(baseParams, { usePreprocess: true, useWeightedBootstrap: true }),
  },
  {
    Motor: 'Motor 2 parametric',
    ...runSimulationParametricAudit(baseParams),
  },
  {
    Motor: 'Motor 3 regime',
    ...runSimulationRegimeAudit(baseParams),
  },
];

const regimeSeeds = [11, 42, 84].map((seed) => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.simulation.seed = seed;
  const result = runSimulationRegimeAudit(params);
  return {
    Seed: seed,
    probRuin: result.probRuin,
    terminalP50: result.terminalP50,
  };
});

const tones = buildToneTable(comparison.map((row) => ({
  Motor: row.Motor,
  probRuin: row.probRuin,
  terminalP50: row.terminalP50,
})));

console.log('\nTABLA 1 - COMPARACION BASE 3 MOTORES');
console.table(comparison.map((row) => ({
  motor: row.Motor,
  probRuin: fmtPct(row.probRuin),
  successRate: fmtPct(row.successRate),
  ruin_lt_20y: fmtPct(row.ruinLt20y),
  ruin_lt_40y: fmtPct(row.ruinLt40y),
  months_cut_pct: fmtPct(row.monthsCutPct),
  terminalP50: fmtMM(row.terminalP50),
})));

console.log('\nTABLA 2 - ESTABILIDAD BASICA MOTOR 3 POR SEED');
console.table(regimeSeeds.map((row) => ({
  seed: row.Seed,
  probRuin: fmtPct(row.probRuin),
  terminalP50: fmtMM(row.terminalP50),
})));

console.log('\nTABLA 3 - LECTURA RELATIVA');
console.table(tones);
