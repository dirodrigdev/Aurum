import type { OperationalBucketProfile } from './operationalBucketProfile';
import { runOperationalBucketStress, type OperationalBucketStressRow } from './operationalBucketStress';

export type BucketTradeoffRow = {
  bucketMonths: number;
  requiredDefensiveCapitalClp: number;
  extraDefensiveCapitalClp: number;
  opportunityCostAnnual: number;
  opportunityCost5Y: number;
  opportunityCost10Y: number;
  opportunityCost20Y: number;
  expectedForcedSaleCost: number;
  avoidedEmbeddedEquitySaleClp: number;
  netTradeoffScore: number;
  comment: string;
};

export type RunBucketTradeoffAnalysisInput = {
  profile: OperationalBucketProfile;
  candidateMonths: number[];
  currentBucketMonths: number;
  expectedGrowthReturnAnnual: number;
  expectedDefensiveReturnAnnual: number;
  stressScenarios?: Array<{ crisisMonths: number; equityDrawdown: number; fixedIncomeShock: number }>;
};

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

const averagePenalty = (rows: OperationalBucketStressRow[]) =>
  rows.length > 0 ? rows.reduce((sum, row) => sum + row.forcedSalePenalty, 0) / rows.length : 0;

const averageEmbeddedEquitySale = (rows: OperationalBucketStressRow[]) =>
  rows.length > 0 ? rows.reduce((sum, row) => sum + row.embeddedEquitySoldClp, 0) / rows.length : 0;

const futureValueDelta = (capital: number, growth: number, defensive: number, years: number) => {
  const g = Math.max(-0.99, growth);
  const d = Math.max(-0.99, defensive);
  return capital * (Math.pow(1 + g, years) - Math.pow(1 + d, years));
};

export function runBucketTradeoffAnalysis(input: RunBucketTradeoffAnalysisInput): BucketTradeoffRow[] {
  const monthlySpendClp = Math.max(1, Number(input.profile.monthlySpendClp || 0));
  const growth = Number.isFinite(input.expectedGrowthReturnAnnual) ? input.expectedGrowthReturnAnnual : 0;
  const defensive = Number.isFinite(input.expectedDefensiveReturnAnnual) ? input.expectedDefensiveReturnAnnual : 0;
  const annualDiff = growth - defensive;
  const baselineStress = runOperationalBucketStress({
    profile: input.profile,
    scenarios: input.stressScenarios,
  });
  const baselinePenalty = averagePenalty(baselineStress);
  const baselineEmbeddedSale = averageEmbeddedEquitySale(baselineStress);
  const currentBucketCapital = Math.max(0, input.currentBucketMonths * monthlySpendClp);

  return input.candidateMonths
    .filter((month) => Number.isFinite(month) && month > 0)
    .sort((a, b) => a - b)
    .map((bucketMonths) => {
      const requiredDefensiveCapitalClp = bucketMonths * monthlySpendClp;
      const extraDefensiveCapitalClp = clampNonNegative(requiredDefensiveCapitalClp - currentBucketCapital);
      const syntheticProfile: OperationalBucketProfile = {
        ...input.profile,
        cleanDefensiveClp: Math.max(input.profile.cleanDefensiveClp, requiredDefensiveCapitalClp),
        cleanDefensiveRunwayMonths: Math.max(input.profile.cleanDefensiveRunwayMonths, bucketMonths),
      };
      const stress = runOperationalBucketStress({
        profile: syntheticProfile,
        scenarios: input.stressScenarios,
      });
      const expectedForcedSaleCost = averagePenalty(stress);
      const embeddedSale = averageEmbeddedEquitySale(stress);
      const avoidedEmbeddedEquitySaleClp = clampNonNegative(baselineEmbeddedSale - embeddedSale);

      const opportunityCostAnnual = extraDefensiveCapitalClp * annualDiff;
      const opportunityCost5Y = futureValueDelta(extraDefensiveCapitalClp, growth, defensive, 5);
      const opportunityCost10Y = futureValueDelta(extraDefensiveCapitalClp, growth, defensive, 10);
      const opportunityCost20Y = futureValueDelta(extraDefensiveCapitalClp, growth, defensive, 20);
      const avoidedForcedCost = clampNonNegative(baselinePenalty - expectedForcedSaleCost);
      const netTradeoffScore = avoidedForcedCost - opportunityCostAnnual;
      const comment =
        netTradeoffScore >= 0
          ? 'Mejora defensiva razonable frente al costo de crecimiento.'
          : 'Costo de oportunidad relevante versus beneficio defensivo esperado.';

      return {
        bucketMonths,
        requiredDefensiveCapitalClp,
        extraDefensiveCapitalClp,
        opportunityCostAnnual,
        opportunityCost5Y,
        opportunityCost10Y,
        opportunityCost20Y,
        expectedForcedSaleCost,
        avoidedEmbeddedEquitySaleClp,
        netTradeoffScore,
        comment,
      };
    });
}
