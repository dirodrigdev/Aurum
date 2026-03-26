import type { MortgageProjectionStatus, RealEstateInput } from '../model/types';

export type MortgageProjectionPoint = {
  month: number;
  propertyValueCLP: number;
  mortgageDebtCLP: number;
  realEstateEquityCLP: number;
};

export type MortgageProjection = {
  status: MortgageProjectionStatus;
  points: MortgageProjectionPoint[];
  notes: string[];
};

const asFiniteOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

function projectWithSchedule(
  input: RealEstateInput,
  horizonMonths: number,
  monthlyInflationRate: number,
): MortgageProjection {
  const notes: string[] = [];
  const schedule = input.mortgageScheduleCLP ?? [];
  const debtByMonth = new Map(schedule.map((point) => [Math.max(1, Math.round(point.month)), clampNonNegative(point.debtCLP)]));
  const points: MortgageProjectionPoint[] = [];

  let property = clampNonNegative(input.propertyValueCLP);
  let debt = clampNonNegative(input.mortgageDebtOutstandingCLP ?? 0);
  for (let month = 1; month <= horizonMonths; month += 1) {
    property *= 1 + monthlyInflationRate;
    const scheduledDebt = debtByMonth.get(month);
    if (scheduledDebt !== undefined) debt = scheduledDebt;
    points.push({
      month,
      propertyValueCLP: property,
      mortgageDebtCLP: debt,
      realEstateEquityCLP: Math.max(0, property - debt),
    });
  }

  notes.push('mortgage-schedule');
  return { status: 'schedule', points, notes };
}

function projectReconstructed(
  input: RealEstateInput,
  horizonMonths: number,
  monthlyInflationRate: number,
): MortgageProjection {
  const notes: string[] = [];
  const points: MortgageProjectionPoint[] = [];
  let property = clampNonNegative(input.propertyValueCLP);
  let debt = clampNonNegative(input.mortgageDebtOutstandingCLP ?? 0);
  const monthlyPayment = clampNonNegative(input.monthlyMortgagePaymentCLP ?? 0);
  const annualRate = clampNonNegative(input.mortgageRate ?? 0);
  const monthlyRate = annualRate / 12;
  const amortizationSystem = String(input.amortizationSystem || '').toLowerCase();
  const horizon = Math.max(1, horizonMonths);
  const constantAmortization = amortizationSystem === 'constant' ? debt / horizon : null;

  for (let month = 1; month <= horizonMonths; month += 1) {
    property *= 1 + monthlyInflationRate;
    if (debt > 0) {
      const interest = debt * monthlyRate;
      let amortization = 0;
      if (amortizationSystem === 'constant' && constantAmortization !== null) {
        amortization = Math.max(0, constantAmortization);
      } else {
        amortization = Math.max(0, monthlyPayment - interest);
      }
      debt = Math.max(0, debt - amortization);
    }
    points.push({
      month,
      propertyValueCLP: property,
      mortgageDebtCLP: debt,
      realEstateEquityCLP: Math.max(0, property - debt),
    });
  }

  notes.push('mortgage-reconstructed');
  return { status: 'reconstructed', points, notes };
}

function projectFallback(
  input: RealEstateInput,
  horizonMonths: number,
  monthlyInflationRate: number,
): MortgageProjection {
  const points: MortgageProjectionPoint[] = [];
  let property = clampNonNegative(input.propertyValueCLP);
  const debt = clampNonNegative(input.mortgageDebtOutstandingCLP ?? 0);
  for (let month = 1; month <= horizonMonths; month += 1) {
    property *= 1 + monthlyInflationRate;
    points.push({
      month,
      propertyValueCLP: property,
      mortgageDebtCLP: debt,
      realEstateEquityCLP: Math.max(0, property - debt),
    });
  }
  return {
    status: 'fallback_incomplete',
    points,
    notes: ['mortgage-fallback-incomplete'],
  };
}

export function buildMortgageProjection(
  input: RealEstateInput | undefined,
  horizonMonths: number,
  monthlyInflationRate: number,
): MortgageProjection {
  if (!input || clampNonNegative(input.propertyValueCLP) <= 0) {
    return {
      status: 'fallback_incomplete',
      points: Array.from({ length: horizonMonths }, (_, idx) => ({
        month: idx + 1,
        propertyValueCLP: 0,
        mortgageDebtCLP: 0,
        realEstateEquityCLP: 0,
      })),
      notes: ['no-real-estate-input'],
    };
  }

  const hasSchedule = Array.isArray(input.mortgageScheduleCLP) && input.mortgageScheduleCLP.length > 0;
  if (hasSchedule) {
    return projectWithSchedule(input, horizonMonths, monthlyInflationRate);
  }

  const hasDebt = asFiniteOrNull(input.mortgageDebtOutstandingCLP) !== null;
  const hasPayment = asFiniteOrNull(input.monthlyMortgagePaymentCLP) !== null;
  const hasRate = asFiniteOrNull(input.mortgageRate) !== null;
  const hasSystem = Boolean(input.amortizationSystem);
  if (hasDebt && hasPayment && hasRate && hasSystem) {
    return projectReconstructed(input, horizonMonths, monthlyInflationRate);
  }

  return projectFallback(input, horizonMonths, monthlyInflationRate);
}
