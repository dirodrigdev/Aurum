import {
  buildBucketExpectedCostAnalysis,
  type BucketExpectedCostAnalysis,
  type BuildBucketExpectedCostAnalysisInput,
} from './bucketExpectedCostAnalysis';

export type BucketSensitivityScenario = {
  id: 'base' | 'penalty_40' | 'penalty_50' | 'long_crisis_x2';
  label: string;
  recommendedBucketMonths: number;
  expectedTotalCostClp: number;
};

export type BucketSensitivitySummary = {
  scenarios: BucketSensitivityScenario[];
  robustness: 'robust' | 'sensitive';
  message: string;
};

const doubleLongCrisis = (input: BuildBucketExpectedCostAnalysisInput['crisisScenarioProbabilities']) =>
  input.map((item) => ({
    ...item,
    probability: item.crisisMonths >= 72 ? Math.min(1, item.probability * 2) : item.probability,
  }));

const toScenario = (
  id: BucketSensitivityScenario['id'],
  label: string,
  analysis: BucketExpectedCostAnalysis,
): BucketSensitivityScenario => ({
  id,
  label,
  recommendedBucketMonths: analysis.bestBucketMonths,
  expectedTotalCostClp: analysis.bestBucketExpectedTotalCostClp,
});

export function buildBucketSensitivitySummary(
  input: BuildBucketExpectedCostAnalysisInput,
): BucketSensitivitySummary {
  const base = buildBucketExpectedCostAnalysis(input);
  const penalty40 = buildBucketExpectedCostAnalysis({
    ...input,
    forcedSalePenaltyPct: 0.4,
  });
  const penalty50 = buildBucketExpectedCostAnalysis({
    ...input,
    forcedSalePenaltyPct: 0.5,
  });
  const longCrisisDouble = buildBucketExpectedCostAnalysis({
    ...input,
    crisisScenarioProbabilities: doubleLongCrisis(input.crisisScenarioProbabilities),
  });
  const scenarios = [
    toScenario('base', 'Base', base),
    toScenario('penalty_40', 'Penalización 40%', penalty40),
    toScenario('penalty_50', 'Penalización 50%', penalty50),
    toScenario('long_crisis_x2', 'Crisis largas x2', longCrisisDouble),
  ];
  const recommendedSet = new Set(scenarios.map((scenario) => scenario.recommendedBucketMonths));
  const robustness = recommendedSet.size === 1 ? 'robust' : 'sensitive';
  return {
    scenarios,
    robustness,
    message:
      robustness === 'robust'
        ? 'Recomendación robusta bajo sensibilidad'
        : 'Recomendación sensible a supuestos',
  };
}
