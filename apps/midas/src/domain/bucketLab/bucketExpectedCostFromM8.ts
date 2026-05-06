import {
  buildBucketExpectedCostAnalysis,
  type BucketExpectedCostAnalysis,
} from './bucketExpectedCostAnalysis';
import type { BucketTradeoffRow } from './bucketTradeoff';
import type { OperationalBucketProfile } from './operationalBucketProfile';
import type { BucketM8CrisisProbabilities } from './bucketM8CrisisProbabilities';

export type BucketExpectedCostFromM8 = {
  source: 'm8_monte_carlo';
  analysis: BucketExpectedCostAnalysis;
  warnings: string[];
};

export type BuildBucketExpectedCostFromM8Input = {
  profile: OperationalBucketProfile;
  tradeoffRows: BucketTradeoffRow[];
  currentBucketMonths: number;
  forcedSalePenaltyPct: number;
  crisis: BucketM8CrisisProbabilities;
};

export function buildBucketExpectedCostFromM8(
  input: BuildBucketExpectedCostFromM8Input,
): BucketExpectedCostFromM8 {
  const warnings = [...input.crisis.warnings];
  const analysis = buildBucketExpectedCostAnalysis({
    profile: input.profile,
    tradeoffRows: input.tradeoffRows,
    currentBucketMonths: input.currentBucketMonths,
    forcedSalePenaltyPct: input.forcedSalePenaltyPct,
    crisisScenarioProbabilities: input.crisis.exclusiveScenarioProbabilities,
  });
  if (input.crisis.nSim <= 0) {
    warnings.push('No hay escenarios M8 suficientes; el analisis de costo esperado se degrada a probabilidades cero.');
  }
  return {
    source: 'm8_monte_carlo',
    analysis,
    warnings,
  };
}

