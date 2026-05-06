import type { M8RuntimeResult } from '../simulation/engineM8';

export type BucketCrisisBinKey =
  | 'gt24m'
  | 'gt36m'
  | 'gt48m'
  | 'gt60m'
  | 'gt72m'
  | 'gt96m';

export type BucketM8CrisisProbabilities = {
  nSim: number;
  source: 'm8_monte_carlo';
  generatedAt: string;
  seed: number | null;
  crisisDurationBins: Record<BucketCrisisBinKey, number>;
  probabilityByBin: Record<BucketCrisisBinKey, number>;
  exclusiveScenarioProbabilities: Array<{ crisisMonths: 36 | 48 | 60 | 72 | 96; probability: number }>;
  operationalCrisisProbabilityByBucket: Record<number, number>;
  probabilityCleanDefenseDepletedByBucket: Record<number, number>;
  probabilityBalancedSaleByBucket: Record<number, number>;
  avgEmbeddedEquitySoldByBucket: Record<number, number>;
  p50EmbeddedEquitySoldByBucket: Record<number, number>;
  p90EmbeddedEquitySoldByBucket: Record<number, number>;
  warnings: string[];
};

export type DeriveBucketCrisisProbabilitiesFromM8Input = {
  runtime: Pick<M8RuntimeResult, 'wealthPaths'>;
  seed?: number | null;
  candidateBucketsMonths: number[];
  drawdownThreshold?: number;
  severeDrawdownThreshold?: number;
  embeddedEquityClpEstimate?: number;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.round(((p / 100) * (sorted.length - 1)))));
  return sorted[rank] ?? 0;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const toExclusiveScenarioProbabilities = (
  maxStressRuns: number[],
): Array<{ crisisMonths: 36 | 48 | 60 | 72 | 96; probability: number }> => {
  const total = Math.max(1, maxStressRuns.length);
  const inRange = (minInclusive: number, maxInclusive: number) =>
    maxStressRuns.filter((run) => run >= minInclusive && run <= maxInclusive).length / total;
  const gt = (threshold: number) => maxStressRuns.filter((run) => run > threshold).length / total;
  const p36 = inRange(25, 36);
  const p48 = inRange(37, 48);
  const p60 = inRange(49, 60);
  const p72 = inRange(61, 72);
  const p96 = gt(72);
  return [
    { crisisMonths: 36, probability: clamp01(p36) },
    { crisisMonths: 48, probability: clamp01(p48) },
    { crisisMonths: 60, probability: clamp01(p60) },
    { crisisMonths: 72, probability: clamp01(p72) },
    { crisisMonths: 96, probability: clamp01(p96) },
  ];
};

export function deriveBucketCrisisProbabilitiesFromM8(
  input: DeriveBucketCrisisProbabilitiesFromM8Input,
): BucketM8CrisisProbabilities {
  const drawdownThreshold = Number.isFinite(input.drawdownThreshold) ? Number(input.drawdownThreshold) : -0.2;
  const severeDrawdownThreshold = Number.isFinite(input.severeDrawdownThreshold)
    ? Number(input.severeDrawdownThreshold)
    : -0.35;
  const warnings: string[] = [];

  const wealthPaths = input.runtime.wealthPaths ?? [];
  const nMonths = wealthPaths.length;
  const nSim = nMonths > 0 ? wealthPaths[0]?.length ?? 0 : 0;
  if (nMonths <= 1 || nSim <= 0) {
    warnings.push('M8 no entrego wealthPaths suficientes para derivar probabilidades de crisis.');
    return {
      nSim: 0,
      source: 'm8_monte_carlo',
      generatedAt: new Date().toISOString(),
      seed: input.seed ?? null,
      crisisDurationBins: { gt24m: 0, gt36m: 0, gt48m: 0, gt60m: 0, gt72m: 0, gt96m: 0 },
      probabilityByBin: { gt24m: 0, gt36m: 0, gt48m: 0, gt60m: 0, gt72m: 0, gt96m: 0 },
      exclusiveScenarioProbabilities: [
        { crisisMonths: 36, probability: 0 },
        { crisisMonths: 48, probability: 0 },
        { crisisMonths: 60, probability: 0 },
        { crisisMonths: 72, probability: 0 },
        { crisisMonths: 96, probability: 0 },
      ],
      operationalCrisisProbabilityByBucket: {},
      probabilityCleanDefenseDepletedByBucket: {},
      probabilityBalancedSaleByBucket: {},
      avgEmbeddedEquitySoldByBucket: {},
      p50EmbeddedEquitySoldByBucket: {},
      p90EmbeddedEquitySoldByBucket: {},
      warnings,
    };
  }

  const maxStressRunsByPath: number[] = [];
  const maxSevereStressRunsByPath: number[] = [];
  for (let p = 0; p < nSim; p += 1) {
    let peak = Math.max(1, Number(wealthPaths[0]?.[p] ?? 0));
    let currentStressRun = 0;
    let currentSevereRun = 0;
    let maxStressRun = 0;
    let maxSevereRun = 0;
    for (let m = 1; m < nMonths; m += 1) {
      const wealth = Math.max(0, Number(wealthPaths[m]?.[p] ?? 0));
      peak = Math.max(peak, wealth);
      const drawdown = peak > 0 ? (wealth - peak) / peak : 0;
      if (drawdown <= drawdownThreshold) {
        currentStressRun += 1;
        maxStressRun = Math.max(maxStressRun, currentStressRun);
      } else {
        currentStressRun = 0;
      }
      if (drawdown <= severeDrawdownThreshold) {
        currentSevereRun += 1;
        maxSevereRun = Math.max(maxSevereRun, currentSevereRun);
      } else {
        currentSevereRun = 0;
      }
    }
    maxStressRunsByPath.push(maxStressRun);
    maxSevereStressRunsByPath.push(maxSevereRun);
  }

  const gt = (threshold: number) => maxStressRunsByPath.filter((run) => run > threshold).length;
  const bins = {
    gt24m: gt(24),
    gt36m: gt(36),
    gt48m: gt(48),
    gt60m: gt(60),
    gt72m: gt(72),
    gt96m: gt(96),
  } as const;
  const probabilityByBin = {
    gt24m: bins.gt24m / nSim,
    gt36m: bins.gt36m / nSim,
    gt48m: bins.gt48m / nSim,
    gt60m: bins.gt60m / nSim,
    gt72m: bins.gt72m / nSim,
    gt96m: bins.gt96m / nSim,
  } as const;

  const embeddedEquityEstimate = Math.max(0, Number(input.embeddedEquityClpEstimate ?? 0));
  const operationalCrisisProbabilityByBucket: Record<number, number> = {};
  const probabilityCleanDefenseDepletedByBucket: Record<number, number> = {};
  const probabilityBalancedSaleByBucket: Record<number, number> = {};
  const avgEmbeddedEquitySoldByBucket: Record<number, number> = {};
  const p50EmbeddedEquitySoldByBucket: Record<number, number> = {};
  const p90EmbeddedEquitySoldByBucket: Record<number, number> = {};

  input.candidateBucketsMonths
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
    .forEach((bucket) => {
      const depletedFlags: number[] = maxStressRunsByPath.map((run) => (run > bucket ? 1 : 0));
      const severeIntensity = maxSevereStressRunsByPath.map((run) => Math.min(1, run / Math.max(bucket, 1)));
      const soldAmounts = depletedFlags.map((flag, idx) =>
        flag > 0 ? embeddedEquityEstimate * (0.15 + 0.35 * severeIntensity[idx]) : 0,
      );
      const depletedProb = depletedFlags.reduce((sum, value) => sum + value, 0) / nSim;
      operationalCrisisProbabilityByBucket[bucket] = depletedProb;
      probabilityCleanDefenseDepletedByBucket[bucket] = depletedProb;
      probabilityBalancedSaleByBucket[bucket] = depletedProb;
      avgEmbeddedEquitySoldByBucket[bucket] =
        soldAmounts.reduce((sum, value) => sum + value, 0) / Math.max(1, soldAmounts.length);
      p50EmbeddedEquitySoldByBucket[bucket] = percentile(soldAmounts, 50);
      p90EmbeddedEquitySoldByBucket[bucket] = percentile(soldAmounts, 90);
    });

  return {
    nSim,
    source: 'm8_monte_carlo',
    generatedAt: new Date().toISOString(),
    seed: input.seed ?? null,
    crisisDurationBins: bins,
    probabilityByBin,
    exclusiveScenarioProbabilities: toExclusiveScenarioProbabilities(maxStressRunsByPath),
    operationalCrisisProbabilityByBucket,
    probabilityCleanDefenseDepletedByBucket,
    probabilityBalancedSaleByBucket,
    avgEmbeddedEquitySoldByBucket,
    p50EmbeddedEquitySoldByBucket,
    p90EmbeddedEquitySoldByBucket,
    warnings,
  };
}
