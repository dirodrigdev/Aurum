import type { SimulationCompositionInput } from '../model/types';

type RiskInReference = 'yes' | 'no' | 'unknown';

export type RunCapitalBreakdownInput = {
  composition: SimulationCompositionInput | null | undefined;
  realEstateEnabled: boolean;
  riskCapitalEnabled: boolean;
  manualLocalAdjustmentsImpactCLP?: number;
  riskCapitalOverrideCLP?: number | null;
  includeNonExigibleDebtInRunCapital?: boolean;
};

export const DEFAULT_INCLUDE_NON_EXIGIBLE_DEBT_IN_RUN_CAPITAL = true;

export type RunCapitalBreakdown = {
  referenceCapitalCLP: number | null;
  referenceNetWorthCLP: number | null;
  riskInReference: RiskInReference;
  referenceRiskAdjustmentCLP: number;
  riskCapitalCLP: number;
  realEstateSupportCLP: number;
  nonMortgageDebtCLP: number;
  nonExigibleDebtPolicyImpactCLP: number;
  excludedRealEstateCLP: number;
  excludedRiskCapitalCLP: number;
  enabledResourcesImpactCLP: number;
  manualLocalAdjustmentsImpactCLP: number;
  runCapitalFromComponentsCLP: number | null;
};

const finiteOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveRiskCapitalClp = (
  composition: SimulationCompositionInput | null | undefined,
  override: number | null | undefined,
): number => {
  const overrideValue = Number(override);
  if (Number.isFinite(overrideValue) && overrideValue > 0) return overrideValue;
  const risk = composition?.nonOptimizable?.riskCapital;
  const total = finiteOrZero(risk?.totalCLP);
  if (total > 0) return total;
  const clp = finiteOrZero(risk?.clp);
  const usdSnapshot = finiteOrZero(risk?.usdSnapshotCLP);
  const usdTotal = finiteOrZero(risk?.usdTotal ?? risk?.usd);
  return Math.max(0, clp + (usdSnapshot > 0 ? usdTotal * usdSnapshot : 0));
};

const resolveRealEstateSupportClp = (composition: SimulationCompositionInput | null | undefined): number => {
  const realEstate = composition?.nonOptimizable?.realEstate;
  const equity = finiteOrZero(realEstate?.realEstateEquityCLP);
  if (equity > 0) return equity;
  const property = finiteOrZero(realEstate?.propertyValueCLP);
  const mortgage = finiteOrZero(realEstate?.mortgageDebtOutstandingCLP);
  const derived = property - mortgage;
  return derived > 0 ? derived : 0;
};

export function buildRunCapitalBreakdown(input: RunCapitalBreakdownInput): RunCapitalBreakdown {
  const composition = input.composition;
  const referenceNetWorthCLP = finiteOrZero(composition?.totalNetWorthCLP);
  const hasReference = referenceNetWorthCLP > 0;
  const riskCapitalCLP = resolveRiskCapitalClp(composition, input.riskCapitalOverrideCLP);
  const riskInReference: RiskInReference = hasReference ? 'yes' : 'unknown';
  const referenceRiskAdjustmentCLP = 0;
  const referenceCapitalCLP = hasReference ? referenceNetWorthCLP : null;
  const realEstateSupportCLP = resolveRealEstateSupportClp(composition);
  const nonMortgageDebtCLP = finiteOrZero(composition?.nonOptimizable?.nonMortgageDebtCLP);
  const nonExigibleDebtPolicyImpactCLP = input.includeNonExigibleDebtInRunCapital === false
    ? 0
    : Math.max(0, Math.abs(nonMortgageDebtCLP));
  const excludedRealEstateCLP = input.realEstateEnabled ? 0 : realEstateSupportCLP;
  const excludedRiskCapitalCLP = input.riskCapitalEnabled ? 0 : riskCapitalCLP;
  const enabledResourcesImpactCLP = -(excludedRealEstateCLP + excludedRiskCapitalCLP);
  const manualLocalAdjustmentsImpactCLP = finiteOrZero(input.manualLocalAdjustmentsImpactCLP);
  const runCapitalFromComponentsCLP = referenceCapitalCLP === null
    ? null
    : Math.max(
      0,
      referenceCapitalCLP
      + nonExigibleDebtPolicyImpactCLP
      + enabledResourcesImpactCLP
      + manualLocalAdjustmentsImpactCLP,
    );
  return {
    referenceCapitalCLP,
    referenceNetWorthCLP: hasReference ? referenceNetWorthCLP : null,
    riskInReference,
    referenceRiskAdjustmentCLP,
    riskCapitalCLP,
    realEstateSupportCLP,
    nonMortgageDebtCLP,
    nonExigibleDebtPolicyImpactCLP,
    excludedRealEstateCLP,
    excludedRiskCapitalCLP,
    enabledResourcesImpactCLP,
    manualLocalAdjustmentsImpactCLP,
    runCapitalFromComponentsCLP,
  };
}
