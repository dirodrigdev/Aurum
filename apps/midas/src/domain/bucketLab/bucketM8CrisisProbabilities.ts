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
  source: 'm8_operational_proxy' | 'm8_wealth_drawdown_heuristic';
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
  runtimesByBucket: Record<number, M8RuntimeResult>;
  seed?: number | null;
  horizonMonths: number;
  nSim: number;
  embeddedEquityClpEstimateByBucket?: Record<number, number>;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const finite = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? Number(value) : fallback;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.round(((p / 100) * (sorted.length - 1)))));
  return sorted[rank] ?? 0;
};

const toExclusiveScenarioProbabilities = (
  probabilityByBin: Record<BucketCrisisBinKey, number>,
): Array<{ crisisMonths: 36 | 48 | 60 | 72 | 96; probability: number }> => {
  const p36 = clamp01(Math.max(0, probabilityByBin.gt24m - probabilityByBin.gt36m));
  const p48 = clamp01(Math.max(0, probabilityByBin.gt36m - probabilityByBin.gt48m));
  const p60 = clamp01(Math.max(0, probabilityByBin.gt48m - probabilityByBin.gt60m));
  const p72 = clamp01(Math.max(0, probabilityByBin.gt60m - probabilityByBin.gt72m));
  const p96 = clamp01(probabilityByBin.gt72m);
  return [
    { crisisMonths: 36, probability: p36 },
    { crisisMonths: 48, probability: p48 },
    { crisisMonths: 60, probability: p60 },
    { crisisMonths: 72, probability: p72 },
    { crisisMonths: 96, probability: p96 },
  ];
};

export function deriveBucketCrisisProbabilitiesFromM8(
  input: DeriveBucketCrisisProbabilitiesFromM8Input,
): BucketM8CrisisProbabilities {
  const warnings: string[] = [];
  const buckets = Object.keys(input.runtimesByBucket)
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (buckets.length === 0 || input.nSim <= 0) {
    warnings.push('M8 no entrego escenarios suficientes para derivar probabilidades operacionales.');
    return {
      nSim: 0,
      source: 'm8_wealth_drawdown_heuristic',
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

  const operationalCrisisProbabilityByBucket: Record<number, number> = {};
  const probabilityCleanDefenseDepletedByBucket: Record<number, number> = {};
  const probabilityBalancedSaleByBucket: Record<number, number> = {};
  const avgEmbeddedEquitySoldByBucket: Record<number, number> = {};
  const p50EmbeddedEquitySoldByBucket: Record<number, number> = {};
  const p90EmbeddedEquitySoldByBucket: Record<number, number> = {};

  const runtimeCurrent = input.runtimesByBucket[buckets[0]];
  const source = Number.isFinite(runtimeCurrent?.RiskEAnyLargeSalePct)
    ? 'm8_operational_proxy'
    : 'm8_wealth_drawdown_heuristic';
  if (source === 'm8_wealth_drawdown_heuristic') {
    warnings.push(
      'La probabilidad M8 esta basada en drawdown patrimonial y puede incluir desacumulacion normal. Revisar antes de cambiar politica de bucket.',
    );
  }

  buckets.forEach((bucket) => {
    const runtime = input.runtimesByBucket[bucket];
    const balancedSaleProb = clamp01(finite(runtime.RiskEAnyLargeSalePct, 0));
    const cutShare = clamp01(finite(runtime.CutTimeShare, 0));
    const stressShare = clamp01(finite(runtime.StressTimeShare, 0));
    const severeMix = clamp01(cutShare * 0.6 + stressShare * 0.4);
    const embeddedEstimate = Math.max(
      0,
      Number(input.embeddedEquityClpEstimateByBucket?.[bucket] ?? 0),
    );
    const soldExpected = embeddedEstimate * balancedSaleProb * (0.25 + 0.75 * severeMix);
    const soldSamples = [
      soldExpected * 0.4,
      soldExpected * 0.8,
      soldExpected,
      soldExpected * 1.2,
      soldExpected * 1.6,
    ];
    operationalCrisisProbabilityByBucket[bucket] = balancedSaleProb;
    probabilityCleanDefenseDepletedByBucket[bucket] = balancedSaleProb;
    probabilityBalancedSaleByBucket[bucket] = balancedSaleProb;
    avgEmbeddedEquitySoldByBucket[bucket] = soldExpected;
    p50EmbeddedEquitySoldByBucket[bucket] = percentile(soldSamples, 50);
    p90EmbeddedEquitySoldByBucket[bucket] = percentile(soldSamples, 90);
  });

  const currentBucket = buckets[Math.floor(buckets.length / 2)] ?? buckets[0];
  const currentRuntime = input.runtimesByBucket[currentBucket];
  const effectiveStressShare = clamp01(
    Math.max(finite(currentRuntime?.CutTimeShare, 0), finite(currentRuntime?.StressTimeShare, 0)),
  );
  const operationalDurationEstimate = Math.round(effectiveStressShare * input.horizonMonths);
  const gt = (threshold: number) =>
    probabilityBalancedSaleByBucket[currentBucket] > 0 && operationalDurationEstimate > threshold
      ? probabilityBalancedSaleByBucket[currentBucket]
      : 0;
  const probabilityByBin = {
    gt24m: gt(24),
    gt36m: gt(36),
    gt48m: gt(48),
    gt60m: gt(60),
    gt72m: gt(72),
    gt96m: gt(96),
  } as const;

  return {
    nSim: input.nSim,
    source,
    generatedAt: new Date().toISOString(),
    seed: input.seed ?? null,
    crisisDurationBins: {
      gt24m: Math.round(probabilityByBin.gt24m * input.nSim),
      gt36m: Math.round(probabilityByBin.gt36m * input.nSim),
      gt48m: Math.round(probabilityByBin.gt48m * input.nSim),
      gt60m: Math.round(probabilityByBin.gt60m * input.nSim),
      gt72m: Math.round(probabilityByBin.gt72m * input.nSim),
      gt96m: Math.round(probabilityByBin.gt96m * input.nSim),
    },
    probabilityByBin,
    exclusiveScenarioProbabilities: toExclusiveScenarioProbabilities(probabilityByBin),
    operationalCrisisProbabilityByBucket,
    probabilityCleanDefenseDepletedByBucket,
    probabilityBalancedSaleByBucket,
    avgEmbeddedEquitySoldByBucket,
    p50EmbeddedEquitySoldByBucket,
    p90EmbeddedEquitySoldByBucket,
    warnings,
  };
}
