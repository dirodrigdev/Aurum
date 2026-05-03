import type { BucketTradeoffRow } from './bucketTradeoff';
import type { OperationalBucketProfile } from './operationalBucketProfile';

export type CrisisScenarioProbability = {
  crisisMonths: 36 | 48 | 60 | 72 | 96;
  probability: number;
};

export type BucketExpectedCostRow = {
  bucketMonths: number;
  defensiveCapitalRequiredClp: number;
  capitalExtraClp: number;
  capitalReleasedClp: number;
  opportunityCostAnnualClp: number;
  expectedGrowthBenefitAnnualClp: number;
  expectedForcedSaleCostClp: number;
  incrementalExpectedForcedSaleCostClp: number;
  expectedTotalCostClp: number;
  expectedNetBenefitClp: number;
  embeddedEquitySoldByScenario: Array<{
    crisisMonths: number;
    probability: number;
    embeddedEquitySoldClp: number;
    expectedScenarioCostClp: number;
  }>;
  breakEvenProbability: number | null;
  recommendationRank: number;
  comment: string;
};

export type BucketExpectedCostAnalysis = {
  rows: BucketExpectedCostRow[];
  currentBucketMonths: number;
  currentBucketExpectedTotalCostClp: number;
  bestBucketMonths: number;
  bestBucketExpectedTotalCostClp: number;
  differenceVsCurrentClp: number;
  keyProbabilityMonths: number | null;
  forcedSalePenaltyPct: number;
  probabilitiesMode: 'exclusive_bins';
};

export type BuildBucketExpectedCostAnalysisInput = {
  profile: OperationalBucketProfile;
  tradeoffRows: BucketTradeoffRow[];
  currentBucketMonths: number;
  forcedSalePenaltyPct: number;
  crisisScenarioProbabilities: CrisisScenarioProbability[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const longScenarioMonths = [60, 72, 96];

export function buildBucketExpectedCostAnalysis(
  input: BuildBucketExpectedCostAnalysisInput,
): BucketExpectedCostAnalysis {
  const penaltyPct = clamp01(input.forcedSalePenaltyPct);
  const probabilityByMonths = new Map(
    input.crisisScenarioProbabilities.map((item) => [item.crisisMonths, clamp01(item.probability)]),
  );

  const rows = input.tradeoffRows.map((row) => {
    const embeddedEquitySoldByScenario = row.scenarioRows
      .filter((scenario) => probabilityByMonths.has(scenario.crisisMonths as 36 | 48 | 60 | 72 | 96))
      .map((scenario) => {
        const probability = probabilityByMonths.get(scenario.crisisMonths as 36 | 48 | 60 | 72 | 96) ?? 0;
        const expectedScenarioCostClp = probability * scenario.embeddedEquitySoldClp * penaltyPct;
        return {
          crisisMonths: scenario.crisisMonths,
          probability,
          embeddedEquitySoldClp: scenario.embeddedEquitySoldClp,
          expectedScenarioCostClp,
        };
      });
    const expectedForcedSaleCostClp = embeddedEquitySoldByScenario.reduce(
      (sum, scenario) => sum + scenario.expectedScenarioCostClp,
      0,
    );
    const expectedTotalCostClp = row.opportunityCostAnnual + expectedForcedSaleCostClp;
    return {
      bucketMonths: row.bucketMonths,
      defensiveCapitalRequiredClp: row.requiredDefensiveCapitalClp,
      capitalExtraClp: row.extraDefensiveCapitalClp,
      capitalReleasedClp: row.capitalReleasedClp,
      opportunityCostAnnualClp: row.opportunityCostAnnual,
      expectedGrowthBenefitAnnualClp: row.expectedGrowthBenefitAnnual,
      expectedForcedSaleCostClp,
      incrementalExpectedForcedSaleCostClp: 0,
      expectedTotalCostClp,
      expectedNetBenefitClp: 0,
      embeddedEquitySoldByScenario,
      breakEvenProbability: null,
      recommendationRank: 0,
      comment: row.comment,
    };
  });

  const currentRow =
    rows.find((row) => row.bucketMonths === input.currentBucketMonths) ??
    rows.reduce((closest, row) =>
      Math.abs(row.bucketMonths - input.currentBucketMonths) < Math.abs(closest.bucketMonths - input.currentBucketMonths)
        ? row
        : closest,
    );

  const currentLongScenarioSale = currentRow.embeddedEquitySoldByScenario
    .filter((item) => longScenarioMonths.includes(item.crisisMonths))
    .reduce((sum, item) => sum + item.embeddedEquitySoldClp, 0);

  const finalized = rows
    .map((row) => {
      const longScenarioSale = row.embeddedEquitySoldByScenario
        .filter((item) => longScenarioMonths.includes(item.crisisMonths))
        .reduce((sum, item) => sum + item.embeddedEquitySoldClp, 0);
      const avoidedLongScenarioSale = Math.max(0, currentLongScenarioSale - longScenarioSale);
      const breakEvenProbability =
        row.capitalExtraClp > 0 && avoidedLongScenarioSale > 0
          ? row.opportunityCostAnnualClp / Math.max(avoidedLongScenarioSale * penaltyPct, 1)
          : null;
      return {
        ...row,
        incrementalExpectedForcedSaleCostClp: row.expectedForcedSaleCostClp - currentRow.expectedForcedSaleCostClp,
        expectedNetBenefitClp: currentRow.expectedTotalCostClp - row.expectedTotalCostClp,
        breakEvenProbability: breakEvenProbability === null ? null : clamp01(breakEvenProbability),
      };
    })
    .sort((a, b) => a.expectedTotalCostClp - b.expectedTotalCostClp)
    .map((row, index) => ({
      ...row,
      recommendationRank: index + 1,
    }));

  const best = finalized[0];

  return {
    rows: finalized,
    currentBucketMonths: currentRow.bucketMonths,
    currentBucketExpectedTotalCostClp: currentRow.expectedTotalCostClp,
    bestBucketMonths: best.bucketMonths,
    bestBucketExpectedTotalCostClp: best.expectedTotalCostClp,
    differenceVsCurrentClp: best.expectedTotalCostClp - currentRow.expectedTotalCostClp,
    keyProbabilityMonths: longScenarioMonths[0],
    forcedSalePenaltyPct: penaltyPct,
    probabilitiesMode: 'exclusive_bins',
  };
}
