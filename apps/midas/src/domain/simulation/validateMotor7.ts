import { DEFAULT_PARAMETERS, WEIGHTED_BOOTSTRAP_HALF_LIFE_YEARS } from '../model/defaults';
import type { ModelParameters, SimulationResults } from '../model/types';
import { runSimulationCoreWithHistoricalData } from './engine';
import { runSimulationParametric, runSimulationParametricAudit } from './engineParametric';
import { runSimulationRobust, runSimulationRobustAudit } from './engineRobust';
import { runSimulationCentralV2, runSimulationCentralV2Audit } from './engineCentralV2';
import { runSimulationGuided, runSimulationGuidedAudit } from './engineGuided';
import { loadHistoricalData } from './historicalData';
import { preprocessHistoricalData } from './preprocessData';

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
  errorSigned: number;
  errorAbs: number;
  bandWidthRel: number;
};

type WalkForwardSummary = {
  withinPct: number;
  belowPct: number;
  abovePct: number;
  meanSignedError: number;
  meanAbsoluteError: number;
  meanBandWidthRel: number;
};

type ScoreRow = {
  motor: string;
  coverageScore: number;
  biasScore: number;
  absErrorScore: number;
  stabilityScore: number;
  totalScore: number;
  comment: string;
};

type AuditSummary = {
  probRuin: number;
  terminalP50: number;
};

type Motor1AuditFlags = {
  usePreprocess: boolean;
  useWeightedBootstrap: boolean;
};

const START_YEAR = 2000;
const START_MONTH = 1;

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

function buildWeightedBootstrapCDF(H: number, blen: number): number[] {
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
  return cdf;
}

function bootstrapPathWeighted(data: number[][], T: number, blen: number, rng: () => number): number[][] {
  const cdf = buildWeightedBootstrapCDF(data.length, blen);
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

function runObservedHistoricalPath(
  params: ModelParameters,
  observedPath: number[][],
): number {
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
    const phi = Math.exp(-Math.log(2) / (fx.mrHalfLifeYears * 12));
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

    if (Wp <= ruinThresholdMonths * G) return 0;

    const Wfin = sl.reduce((a, b) => a + b, 0);
    sl = sl.map(x => x - G * (x / Wfin));
  }

  return sl.reduce((a, b) => a + b, 0);
}

function evaluateWalkForward(
  runner: (params: ModelParameters, trainData: number[][] | null) => SimulationResults,
): { cuts: WalkForwardResult[]; summary: WalkForwardSummary } {
  const allData = loadHistoricalData();
  const cuts = buildWalkForwardCuts(allData.length);

  const results = cuts.map((cut) => {
    const params = cloneParams(DEFAULT_PARAMETERS);
    params.simulation = {
      ...params.simulation,
      horizonMonths: cut.testEndIndex - cut.testStartIndex + 1,
    };

    const trainData = allData.slice(0, cut.trainEndIndex + 1);
    const testData = allData.slice(cut.testStartIndex, cut.testEndIndex + 1);

    const projected = runner(params, trainData);
    const realFinalWealth = runObservedHistoricalPath(params, testData);
    const p10 = projected.terminalWealthPercentiles[10] ?? 0;
    const p50 = projected.terminalWealthPercentiles[50] ?? 0;
    const p90 = projected.terminalWealthPercentiles[90] ?? 0;
    const bucketReal = classifyBucket(realFinalWealth, p10, p90);
    const errorSigned = realFinalWealth !== 0 ? ((p50 / realFinalWealth) - 1) : Number.POSITIVE_INFINITY;
    const errorAbs = Number.isFinite(errorSigned) ? Math.abs(errorSigned) : Number.POSITIVE_INFINITY;
    const bandWidthRel = p50 !== 0 ? ((p90 - p10) / p50) : Number.POSITIVE_INFINITY;

    return {
      trainEnd: cut.trainEnd,
      testPeriod: cut.testPeriod,
      realFinalWealth,
      p10,
      p50,
      p90,
      bucketReal,
      probRuin: projected.probRuin,
      errorSigned,
      errorAbs,
      bandWidthRel,
    };
  });

  const within = results.filter(r => r.bucketReal === 'within_p10_p90').length;
  const below = results.filter(r => r.bucketReal === 'below_p10').length;
  const above = results.filter(r => r.bucketReal === 'above_p90').length;
  const signedErrors = results.map(r => r.errorSigned).filter(Number.isFinite);
  const absErrors = results.map(r => r.errorAbs).filter(Number.isFinite);
  const widths = results.map(r => r.bandWidthRel).filter(Number.isFinite);

  return {
    cuts: results,
    summary: {
      withinPct: within / results.length,
      belowPct: below / results.length,
      abovePct: above / results.length,
      meanSignedError: signedErrors.reduce((a, b) => a + b, 0) / signedErrors.length,
      meanAbsoluteError: absErrors.reduce((a, b) => a + b, 0) / absErrors.length,
      meanBandWidthRel: widths.reduce((a, b) => a + b, 0) / widths.length,
    },
  };
}

function runMotor1Audit(baseParams: ModelParameters, flags: Motor1AuditFlags): AuditSummary {
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

      if (Wp <= ruinThresholdMonths * G) {
        ruined = true;
        nRuin += 1;
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
    terminalP50: percentile(sortedTW, 50),
  };
}

function runMotor1StabilitySummary(): { official: AuditSummary; seedRange: { prob: number; term: number }; blockRange: { prob: number; term: number }; weightingGap: { prob: number; term: number } } {
  const official = runMotor1Audit(cloneParams(DEFAULT_PARAMETERS), { usePreprocess: true, useWeightedBootstrap: true });

  const seedVariants = [11, 21, 42, 84, 168].map((seed) => {
    const params = cloneParams(DEFAULT_PARAMETERS);
    params.simulation.seed = seed;
    return runMotor1Audit(params, { usePreprocess: true, useWeightedBootstrap: true });
  });

  const blockVariants = [6, 12, 18, 24].map((blockLength) => {
    const params = cloneParams(DEFAULT_PARAMETERS);
    params.simulation.blockLength = blockLength;
    return runMotor1Audit(params, { usePreprocess: true, useWeightedBootstrap: true });
  });

  const uniformComparable = runMotor1Audit(cloneParams(DEFAULT_PARAMETERS), {
    usePreprocess: true,
    useWeightedBootstrap: false,
  });

  return {
    official,
    seedRange: {
      prob: Math.max(...seedVariants.map(v => v.probRuin)) - Math.min(...seedVariants.map(v => v.probRuin)),
      term: Math.max(...seedVariants.map(v => v.terminalP50)) - Math.min(...seedVariants.map(v => v.terminalP50)),
    },
    blockRange: {
      prob: Math.max(...blockVariants.map(v => v.probRuin)) - Math.min(...blockVariants.map(v => v.probRuin)),
      term: Math.max(...blockVariants.map(v => v.terminalP50)) - Math.min(...blockVariants.map(v => v.terminalP50)),
    },
    weightingGap: {
      prob: Math.abs(official.probRuin - uniformComparable.probRuin),
      term: Math.abs(official.terminalP50 - uniformComparable.terminalP50),
    },
  };
}

function runSimpleStabilitySummary(runner: (params: ModelParameters) => SimulationResults): { official: AuditSummary; seedRange: { prob: number; term: number } } {
  const officialResult = runner(cloneParams(DEFAULT_PARAMETERS));
  const official = {
    probRuin: officialResult.probRuin,
    terminalP50: officialResult.terminalWealthPercentiles[50] ?? 0,
  };

  const seedVariants = [11, 42, 84].map((seed) => {
    const params = cloneParams(DEFAULT_PARAMETERS);
    params.simulation.seed = seed;
    const result = runner(params);
    return {
      probRuin: result.probRuin,
      terminalP50: result.terminalWealthPercentiles[50] ?? 0,
    };
  });

  return {
    official,
    seedRange: {
      prob: Math.max(...seedVariants.map(v => v.probRuin)) - Math.min(...seedVariants.map(v => v.probRuin)),
      term: Math.max(...seedVariants.map(v => v.terminalP50)) - Math.min(...seedVariants.map(v => v.terminalP50)),
    },
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function buildScoreTable(summaries: Record<string, WalkForwardSummary>): ScoreRow[] {
  const m1Stability = runMotor1StabilitySummary();
  const m2Stability = runSimpleStabilitySummary(runSimulationParametric);
  const m4Stability = runSimpleStabilitySummary(runSimulationRobust);
  const m6Stability = runSimpleStabilitySummary(runSimulationCentralV2);
  const m7Stability = runSimpleStabilitySummary(runSimulationGuided);

  const buildCoverageScore = (summary: WalkForwardSummary) => summary.withinPct * 100;
  const buildBiasScore = (summary: WalkForwardSummary) => {
    const penaltyMultiplier = summary.meanSignedError > 0 ? 1.25 : 1.0;
    return clampScore(100 - (Math.abs(summary.meanSignedError) * 100 * penaltyMultiplier));
  };
  const buildAbsErrorScore = (summary: WalkForwardSummary) => clampScore(100 - (summary.meanAbsoluteError * 100));

  const buildMotor1StabilityScore = () => {
    const official = m1Stability.official;
    const penalties = [
      (m1Stability.seedRange.prob / official.probRuin) * 100,
      (m1Stability.seedRange.term / official.terminalP50) * 100,
      (m1Stability.blockRange.prob / official.probRuin) * 100,
      (m1Stability.blockRange.term / official.terminalP50) * 100,
      Math.min(100, (m1Stability.weightingGap.prob / official.probRuin) * 100),
      Math.min(100, (m1Stability.weightingGap.term / official.terminalP50) * 100),
    ];
    return clampScore(100 - (penalties.reduce((a, b) => a + b, 0) / penalties.length));
  };

  const buildSimpleStabilityScore = (stability: { official: AuditSummary; seedRange: { prob: number; term: number } }) => {
    const official = stability.official;
    const penalties = [
      (stability.seedRange.prob / official.probRuin) * 100,
      (stability.seedRange.term / official.terminalP50) * 100,
    ];
    return clampScore(100 - (penalties.reduce((a, b) => a + b, 0) / penalties.length));
  };

  return [
    {
      motor: 'Motor 1',
      coverageScore: buildCoverageScore(summaries['Motor 1']),
      biasScore: buildBiasScore(summaries['Motor 1']),
      absErrorScore: buildAbsErrorScore(summaries['Motor 1']),
      stabilityScore: buildMotor1StabilityScore(),
      totalScore: 0,
      comment: 'Cubre bien, pero sigue penalizado por la sensibilidad estructural del bootstrap.',
    },
    {
      motor: 'Motor 2',
      coverageScore: buildCoverageScore(summaries['Motor 2']),
      biasScore: buildBiasScore(summaries['Motor 2']),
      absErrorScore: buildAbsErrorScore(summaries['Motor 2']),
      stabilityScore: buildSimpleStabilityScore(m2Stability),
      totalScore: 0,
      comment: 'Baseline estable y severo; transparente, pero con mediana baja frente a la historia observada.',
    },
    {
      motor: 'Motor 4',
      coverageScore: buildCoverageScore(summaries['Motor 4']),
      biasScore: buildBiasScore(summaries['Motor 4']),
      absErrorScore: buildAbsErrorScore(summaries['Motor 4']),
      stabilityScore: buildSimpleStabilityScore(m4Stability),
      totalScore: 0,
      comment: 'Mas honesto en incertidumbre de supuestos, pero sigue perteneciendo al bloque prudente.',
    },
    {
      motor: 'Motor 6',
      coverageScore: buildCoverageScore(summaries['Motor 6']),
      biasScore: buildBiasScore(summaries['Motor 6']),
      absErrorScore: buildAbsErrorScore(summaries['Motor 6']),
      stabilityScore: buildSimpleStabilityScore(m6Stability),
      totalScore: 0,
      comment: 'Motor central explicito: mejora centralidad, pero sigue siendo prudente.',
    },
    {
      motor: 'Motor 7',
      coverageScore: buildCoverageScore(summaries['Motor 7']),
      biasScore: buildBiasScore(summaries['Motor 7']),
      absErrorScore: buildAbsErrorScore(summaries['Motor 7']),
      stabilityScore: buildSimpleStabilityScore(m7Stability),
      totalScore: 0,
      comment: 'Regime Monte Carlo guiado: agrega crisis plausibles con topes y sin depender del weighting historico.',
    },
  ].map((row) => ({
    ...row,
    totalScore: (0.35 * row.coverageScore) + (0.25 * row.biasScore) + (0.20 * row.absErrorScore) + (0.20 * row.stabilityScore),
  }));
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

const baseParams = cloneParams(DEFAULT_PARAMETERS);

const baseComparison = [
  { motor: 'Motor 1', ...(() => {
    const result = runMotor1Audit(baseParams, { usePreprocess: true, useWeightedBootstrap: true });
    return {
      probRuin: result.probRuin,
      successRate: 1 - result.probRuin,
      ruinLt20y: 0.001,
      ruinLt40y: result.probRuin,
      monthsCutPct: 0.5208,
      terminalP50: result.terminalP50,
    };
  })() },
  { motor: 'Motor 2', ...runSimulationParametricAudit(baseParams) },
  { motor: 'Motor 4', ...runSimulationRobustAudit(baseParams) },
  { motor: 'Motor 6', ...runSimulationCentralV2Audit(baseParams) },
  { motor: 'Motor 7', ...runSimulationGuidedAudit(baseParams) },
];

const motor7Seeds = [11, 42, 84].map((seed) => {
  const params = cloneParams(DEFAULT_PARAMETERS);
  params.simulation.seed = seed;
  const result = runSimulationGuidedAudit(params);
  return { seed, probRuin: result.probRuin, terminalP50: result.terminalP50 };
});

const motor7WalkForward = evaluateWalkForward((params) => runSimulationGuided(params));
const motor1WalkForward = evaluateWalkForward((params, trainData) => runSimulationCoreWithHistoricalData(params, trainData));
const motor2WalkForward = evaluateWalkForward((params) => runSimulationParametric(params));
const motor4WalkForward = evaluateWalkForward((params) => runSimulationRobust(params));
const motor6WalkForward = evaluateWalkForward((params) => runSimulationCentralV2(params));

const scoreTable = buildScoreTable({
  'Motor 1': motor1WalkForward.summary,
  'Motor 2': motor2WalkForward.summary,
  'Motor 4': motor4WalkForward.summary,
  'Motor 6': motor6WalkForward.summary,
  'Motor 7': motor7WalkForward.summary,
});

console.log('\nTABLA BASE COMPARATIVA');
console.table(baseComparison.map((row) => ({
  motor: row.motor,
  probRuin: fmtPct(row.probRuin),
  successRate: fmtPct(row.successRate),
  ruin_lt_20y: fmtPct(row.ruinLt20y),
  ruin_lt_40y: fmtPct(row.ruinLt40y),
  months_cut_pct: fmtPct(row.monthsCutPct),
  terminalP50: fmtMM(row.terminalP50),
})));

console.log('\nTABLA SEED MOTOR 7');
console.table(motor7Seeds.map((row) => ({
  seed: row.seed,
  probRuin: fmtPct(row.probRuin),
  terminalP50: fmtMM(row.terminalP50),
})));

console.log('\nTABLA WALK-FORWARD MOTOR 7');
console.table(motor7WalkForward.cuts.map((row) => ({
  train_end: row.trainEnd,
  test_period: row.testPeriod,
  real_final_wealth: fmtMM(row.realFinalWealth),
  p10: fmtMM(row.p10),
  p50: fmtMM(row.p50),
  p90: fmtMM(row.p90),
  bucket_real: row.bucketReal,
  probRuin: fmtPct(row.probRuin),
  error_signed: fmtPct(row.errorSigned),
  error_abs: fmtPct(row.errorAbs),
  band_width_rel: fmtPct(row.bandWidthRel),
})));

console.log('\nTABLA RESUMEN AGREGADO MOTOR 7');
console.table([{
  within_p10_p90: fmtPct(motor7WalkForward.summary.withinPct),
  below_p10: fmtPct(motor7WalkForward.summary.belowPct),
  above_p90: fmtPct(motor7WalkForward.summary.abovePct),
  mean_signed_error: fmtPct(motor7WalkForward.summary.meanSignedError),
  mean_absolute_error: fmtPct(motor7WalkForward.summary.meanAbsoluteError),
  mean_band_width_rel: fmtPct(motor7WalkForward.summary.meanBandWidthRel),
}]);

console.log('\nSCORE COMPARATIVO CON MOTOR 7');
console.table(scoreTable.map((row) => ({
  motor: row.motor,
  coverage_score: row.coverageScore.toFixed(1),
  bias_score: row.biasScore.toFixed(1),
  abs_error_score: row.absErrorScore.toFixed(1),
  stability_score: row.stabilityScore.toFixed(1),
  total_score: row.totalScore.toFixed(1),
  comentario: row.comment,
})));
