import type { OperationalBucketProfile } from './operationalBucketProfile';

export type StressSeverity = 'moderate' | 'severe' | 'extreme';

export type OperationalBucketStressScenario = {
  crisisMonths: number;
  equityDrawdown: number;
  fixedIncomeShock: number;
};

export type OperationalBucketStressRow = {
  crisisMonths: number;
  equityDrawdown: number;
  fixedIncomeShock: number;
  cleanDefensiveEnough: boolean;
  cleanDefensiveExhaustedMonth: number | null;
  balancedSoldClp: number;
  embeddedEquitySoldClp: number;
  embeddedEquitySoldPct: number;
  directEquitySoldClp: number;
  forcedSalePenalty: number;
  stressSeverity: StressSeverity;
  warnings: string[];
};

export type RunOperationalBucketStressInput = {
  profile: OperationalBucketProfile;
  scenarios?: OperationalBucketStressScenario[];
};

const DEFAULT_CRISIS_MONTHS = [24, 36, 48, 60, 72, 96, 120];
const DEFAULT_EQUITY_DD = [-0.2, -0.35, -0.5];
const DEFAULT_FI_SHOCK = [0, -0.05, -0.1];

const defaultScenarios = (): OperationalBucketStressScenario[] => {
  const scenarios: OperationalBucketStressScenario[] = [];
  for (const crisisMonths of DEFAULT_CRISIS_MONTHS) {
    for (const equityDrawdown of DEFAULT_EQUITY_DD) {
      for (const fixedIncomeShock of DEFAULT_FI_SHOCK) {
        scenarios.push({ crisisMonths, equityDrawdown, fixedIncomeShock });
      }
    }
  }
  return scenarios;
};

const severityFromPenalty = (penaltyPct: number, cleanEnough: boolean): StressSeverity => {
  if (!cleanEnough || penaltyPct >= 0.25) return 'extreme';
  if (penaltyPct >= 0.1) return 'severe';
  return 'moderate';
};

export function runOperationalBucketStress(
  input: RunOperationalBucketStressInput,
): OperationalBucketStressRow[] {
  const monthlySpendClp = Math.max(1, Number(input.profile.monthlySpendClp || 0));
  const scenarios = input.scenarios && input.scenarios.length > 0 ? input.scenarios : defaultScenarios();
  const rows: OperationalBucketStressRow[] = [];
  for (const scenario of scenarios) {
    const targetNeed = scenario.crisisMonths * monthlySpendClp;
    const cleanAvailable = Math.max(0, input.profile.cleanDefensiveClp);
    const mixedAvailable = Math.max(0, input.profile.mixedFundClp);
    const equityAvailable = Math.max(0, input.profile.equityLikeClp);
    const cleanDefensiveEnough = cleanAvailable >= targetNeed;
    const cleanDefensiveExhaustedMonth = cleanDefensiveEnough
      ? null
      : Math.floor(cleanAvailable / monthlySpendClp);

    let remaining = Math.max(0, targetNeed - cleanAvailable);
    const balancedSoldClp = Math.min(mixedAvailable, remaining);
    remaining -= balancedSoldClp;

    const embeddedEquitySoldClp = balancedSoldClp * Math.max(0, Math.min(1, input.profile.embeddedEquitySoldPct));
    const embeddedEquitySoldPct = balancedSoldClp > 0 ? embeddedEquitySoldClp / balancedSoldClp : 0;
    const directEquitySoldClp = Math.min(equityAvailable, Math.max(0, remaining));

    const equityPenalty = embeddedEquitySoldClp * Math.abs(scenario.equityDrawdown);
    const directEquityPenalty = directEquitySoldClp * Math.abs(scenario.equityDrawdown);
    const fiPenalty = (balancedSoldClp - embeddedEquitySoldClp) * Math.abs(scenario.fixedIncomeShock);
    const forcedSalePenalty = Math.max(0, equityPenalty + fiPenalty + directEquityPenalty);
    const penaltyPct = targetNeed > 0 ? forcedSalePenalty / targetNeed : 0;
    const stressSeverity = severityFromPenalty(penaltyPct, cleanDefensiveEnough);
    const warnings: string[] = [];
    if (!cleanDefensiveEnough) warnings.push('Defensa limpia insuficiente para toda la crisis.');
    if (balancedSoldClp > 0) warnings.push('Se vende fondo balanceado (incluye RV embebida).');
    if (directEquitySoldClp > 0) warnings.push('Se vende RV directa tras agotar balanceados.');

    rows.push({
      crisisMonths: scenario.crisisMonths,
      equityDrawdown: scenario.equityDrawdown,
      fixedIncomeShock: scenario.fixedIncomeShock,
      cleanDefensiveEnough,
      cleanDefensiveExhaustedMonth,
      balancedSoldClp,
      embeddedEquitySoldClp,
      embeddedEquitySoldPct,
      directEquitySoldClp,
      forcedSalePenalty,
      stressSeverity,
      warnings,
    });
  }
  return rows;
}
