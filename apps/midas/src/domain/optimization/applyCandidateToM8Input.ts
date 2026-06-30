import type { MidasCandidate } from './candidateSet';
import type { M8CutsInput, M8HouseInput, M8Input, M8PortfolioMix } from '../simulation/m8.types';

export type AppliedCandidateChange = {
  field: string;
  nextValue: unknown;
};

export type ApplyCandidateToM8InputResult =
  | { ok: true; input: M8Input; appliedChanges: AppliedCandidateChange[] }
  | { ok: false; errors: string[] };

const PORTFOLIO_KEYS = ['eq_global', 'eq_chile', 'fi_global', 'fi_chile', 'usd_liquidity', 'clp_cash'] as const;
const DIRECT_CUT_KEYS = new Set([
  'cut1_floor',
  'cut2_floor',
  'recovery_cut2_to_cut1_months',
  'recovery_cut1_to_normal_months',
  'adjustment_alpha',
  'dd15_threshold',
  'dd25_threshold',
  'consecutive_months',
]);

const CUT_KEY_ALIASES: Record<string, keyof M8CutsInput> = {
  cut1: 'cut1_floor',
  cut2: 'cut2_floor',
  recoveryCut2ToCut1Months: 'recovery_cut2_to_cut1_months',
  recoveryCut1ToNormalMonths: 'recovery_cut1_to_normal_months',
  adjustmentAlpha: 'adjustment_alpha',
  dd15Threshold: 'dd15_threshold',
  dd25Threshold: 'dd25_threshold',
  consecutiveMonths: 'consecutive_months',
};

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0;

const pushApplied = (
  appliedChanges: AppliedCandidateChange[],
  field: string,
  nextValue: unknown,
) => {
  appliedChanges.push({ field, nextValue });
};

const readSpendingPhaseValue = (
  value: Record<string, unknown>,
  index: 1 | 2 | 3 | 4,
): number | null => {
  const direct = value[`phase${index}MonthlyClp`];
  if (isFiniteNumber(direct) && direct > 0) return direct;
  const alias = value[`F${index}`];
  if (isFiniteNumber(alias) && alias > 0) return alias;
  return null;
};

function applySpendingPhases(
  input: M8Input,
  rawValue: unknown,
  appliedChanges: AppliedCandidateChange[],
  errors: string[],
) {
  if (Array.isArray(rawValue)) {
    if (rawValue.length !== 4 || rawValue.some((entry) => !isFiniteNumber(entry) || entry <= 0)) {
      errors.push('changes.spendingPhases debe tener exactamente 4 montos positivos.');
      return;
    }
    input.phase1MonthlyClp = rawValue[0];
    input.phase2MonthlyClp = rawValue[1];
    input.phase3MonthlyClp = rawValue[2];
    input.phase4MonthlyClp = rawValue[3];
  } else if (isRecord(rawValue)) {
    const values = [
      readSpendingPhaseValue(rawValue, 1),
      readSpendingPhaseValue(rawValue, 2),
      readSpendingPhaseValue(rawValue, 3),
      readSpendingPhaseValue(rawValue, 4),
    ];
    if (values.some((entry) => entry === null)) {
      errors.push('changes.spendingPhases debe incluir 4 montos positivos (phase1MonthlyClp..phase4MonthlyClp o F1..F4).');
      return;
    }
    [input.phase1MonthlyClp, input.phase2MonthlyClp, input.phase3MonthlyClp, input.phase4MonthlyClp] = values as number[];
  } else {
    errors.push('changes.spendingPhases debe ser un objeto o arreglo compatible.');
    return;
  }

  pushApplied(appliedChanges, 'phase1MonthlyClp', input.phase1MonthlyClp);
  pushApplied(appliedChanges, 'phase2MonthlyClp', input.phase2MonthlyClp);
  pushApplied(appliedChanges, 'phase3MonthlyClp', input.phase3MonthlyClp);
  pushApplied(appliedChanges, 'phase4MonthlyClp', input.phase4MonthlyClp);
}

function applyPhaseDurations(
  input: M8Input,
  rawValue: unknown,
  appliedChanges: AppliedCandidateChange[],
  errors: string[],
) {
  if (!isRecord(rawValue)) {
    errors.push('changes.phaseDurations debe ser un objeto.');
    return;
  }

  const hasDurationShape = ['phase1Years', 'phase2Years', 'phase3Years', 'phase4Years'].every((key) => key in rawValue);
  const hasEndShape = ['phase1EndYear', 'phase2EndYear', 'phase3EndYear'].every((key) => key in rawValue);

  if (hasDurationShape) {
    const phase1Years = rawValue.phase1Years;
    const phase2Years = rawValue.phase2Years;
    const phase3Years = rawValue.phase3Years;
    const phase4Years = rawValue.phase4Years;
    if (![phase1Years, phase2Years, phase3Years, phase4Years].every(isPositiveInteger)) {
      errors.push('changes.phaseDurations con shape phaseXYears requiere enteros positivos.');
      return;
    }
    const totalYears = Number(phase1Years) + Number(phase2Years) + Number(phase3Years) + Number(phase4Years);
    if (totalYears !== input.years) {
      errors.push(`changes.phaseDurations debe sumar exactamente ${input.years} años para este baseline.`);
      return;
    }
    input.phase1EndYear = Number(phase1Years);
    input.phase2EndYear = Number(phase1Years) + Number(phase2Years);
    input.phase3EndYear = Number(phase1Years) + Number(phase2Years) + Number(phase3Years);
  } else if (hasEndShape) {
    const phase1EndYear = rawValue.phase1EndYear;
    const phase2EndYear = rawValue.phase2EndYear;
    const phase3EndYear = rawValue.phase3EndYear;
    if (![phase1EndYear, phase2EndYear, phase3EndYear].every(isPositiveInteger)) {
      errors.push('changes.phaseDurations con shape phaseXEndYear requiere enteros positivos.');
      return;
    }
    if (!(Number(phase1EndYear) < Number(phase2EndYear) && Number(phase2EndYear) < Number(phase3EndYear) && Number(phase3EndYear) < input.years)) {
      errors.push('changes.phaseDurations requiere phase1EndYear < phase2EndYear < phase3EndYear < years.');
      return;
    }
    input.phase1EndYear = Number(phase1EndYear);
    input.phase2EndYear = Number(phase2EndYear);
    input.phase3EndYear = Number(phase3EndYear);
  } else {
    errors.push('changes.phaseDurations usa un shape no soportado. Usa phase1Years..phase4Years o phase1EndYear..phase3EndYear.');
    return;
  }

  pushApplied(appliedChanges, 'phase1EndYear', input.phase1EndYear);
  pushApplied(appliedChanges, 'phase2EndYear', input.phase2EndYear);
  pushApplied(appliedChanges, 'phase3EndYear', input.phase3EndYear);
}

function applyHouseSaleTrigger(
  input: M8Input,
  rawValue: unknown,
  appliedChanges: AppliedCandidateChange[],
  errors: string[],
) {
  if (!input.house?.include_house) {
    errors.push('changes.houseSaleTrigger requiere un baseline con house activa.');
    return;
  }
  if (!isRecord(rawValue)) {
    errors.push('changes.houseSaleTrigger debe ser un objeto.');
    return;
  }

  const yearsOfSpend = rawValue.yearsOfSpend ?? rawValue.house_sale_trigger_years_of_spend;
  const lagMonths = rawValue.lagMonths ?? rawValue.house_sale_lag_months;
  if (!isFiniteNumber(yearsOfSpend) || yearsOfSpend <= 0) {
    errors.push('changes.houseSaleTrigger.yearsOfSpend debe ser positivo.');
    return;
  }
  if (typeof lagMonths !== 'undefined' && !isNonNegativeInteger(lagMonths)) {
    errors.push('changes.houseSaleTrigger.lagMonths debe ser entero >= 0.');
    return;
  }

  input.house = {
    ...(input.house as M8HouseInput),
    house_sale_trigger_years_of_spend: yearsOfSpend,
    ...(typeof lagMonths !== 'undefined' ? { house_sale_lag_months: Number(lagMonths) } : {}),
  };

  pushApplied(appliedChanges, 'house.house_sale_trigger_years_of_spend', input.house.house_sale_trigger_years_of_spend);
  if (typeof lagMonths !== 'undefined') {
    pushApplied(appliedChanges, 'house.house_sale_lag_months', input.house.house_sale_lag_months);
  }
}

function applyCutRules(
  input: M8Input,
  rawValue: unknown,
  appliedChanges: AppliedCandidateChange[],
  errors: string[],
) {
  if (!isRecord(rawValue)) {
    errors.push('changes.cutRules debe ser un objeto.');
    return;
  }

  const nextCuts = cloneJson(input.cuts);
  for (const [rawKey, rawEntry] of Object.entries(rawValue)) {
    const normalizedKey = DIRECT_CUT_KEYS.has(rawKey)
      ? rawKey as keyof M8CutsInput
      : CUT_KEY_ALIASES[rawKey];
    if (!normalizedKey) {
      errors.push(`changes.cutRules.${rawKey} no es un campo soportado.`);
      continue;
    }
    if (!isFiniteNumber(rawEntry)) {
      errors.push(`changes.cutRules.${rawKey} debe ser numérico.`);
      continue;
    }
    (nextCuts as unknown as Record<string, number>)[normalizedKey] = rawEntry;
  }

  if (!(nextCuts.cut1_floor > 0 && nextCuts.cut1_floor <= 1)) {
    errors.push('changes.cutRules.cut1 debe quedar entre 0 y 1.');
  }
  if (!(nextCuts.cut2_floor > 0 && nextCuts.cut2_floor <= 1)) {
    errors.push('changes.cutRules.cut2 debe quedar entre 0 y 1.');
  }
  if (nextCuts.cut2_floor > nextCuts.cut1_floor) {
    errors.push('changes.cutRules requiere cut2 <= cut1.');
  }
  if (!(nextCuts.adjustment_alpha > 0 && nextCuts.adjustment_alpha <= 1)) {
    errors.push('changes.cutRules.adjustmentAlpha debe quedar entre 0 y 1.');
  }
  if (!(nextCuts.dd15_threshold > 0 && nextCuts.dd25_threshold > 0 && nextCuts.dd25_threshold > nextCuts.dd15_threshold)) {
    errors.push('changes.cutRules requiere dd25_threshold > dd15_threshold > 0.');
  }
  if (!isPositiveInteger(nextCuts.consecutive_months)) {
    errors.push('changes.cutRules.consecutiveMonths debe ser entero positivo.');
  }
  if (!isNonNegativeInteger(nextCuts.recovery_cut2_to_cut1_months) || !isNonNegativeInteger(nextCuts.recovery_cut1_to_normal_months)) {
    errors.push('changes.cutRules recovery months deben ser enteros >= 0.');
  }
  if (errors.length > 0) return;

  input.cuts = nextCuts;
  for (const [key, value] of Object.entries(nextCuts)) {
    pushApplied(appliedChanges, `cuts.${key}`, value);
  }
}

function applyPortfolioMix(
  input: M8Input,
  rawValue: unknown,
  appliedChanges: AppliedCandidateChange[],
  errors: string[],
) {
  if (!isRecord(rawValue)) {
    errors.push('changes.portfolioMix debe ser un objeto.');
    return;
  }

  const nextMix: Partial<M8PortfolioMix> = {};
  for (const key of PORTFOLIO_KEYS) {
    const value = rawValue[key];
    if (!isFiniteNumber(value) || value < 0) {
      errors.push(`changes.portfolioMix.${key} debe ser numérico y >= 0.`);
      continue;
    }
    nextMix[key] = value;
  }
  if (errors.length > 0) return;

  const total = PORTFOLIO_KEYS.reduce((sum, key) => sum + Number(nextMix[key] ?? 0), 0);
  if (Math.abs(total - 1) > 1e-6) {
    errors.push(`changes.portfolioMix debe sumar 1.0 exactamente (suma actual ${total.toFixed(6)}).`);
    return;
  }

  input.portfolio_mix = nextMix as M8PortfolioMix;
  for (const key of PORTFOLIO_KEYS) {
    pushApplied(appliedChanges, `portfolio_mix.${key}`, input.portfolio_mix[key]);
  }
}

export function applyCandidateToM8Input(
  baseInput: M8Input,
  candidate: MidasCandidate,
): ApplyCandidateToM8InputResult {
  const input = cloneJson(baseInput);
  const appliedChanges: AppliedCandidateChange[] = [];
  const errors: string[] = [];

  for (const [key, rawValue] of Object.entries(candidate.changes)) {
    switch (key) {
      case 'bucketMonths':
        if (!isPositiveInteger(rawValue)) {
          errors.push('changes.bucketMonths debe ser entero positivo.');
          break;
        }
        input.bucket.bucket_months = Number(rawValue);
        pushApplied(appliedChanges, 'bucket.bucket_months', input.bucket.bucket_months);
        break;
      case 'spendingPhases':
        applySpendingPhases(input, rawValue, appliedChanges, errors);
        break;
      case 'phaseDurations':
        applyPhaseDurations(input, rawValue, appliedChanges, errors);
        break;
      case 'houseSaleTrigger':
        applyHouseSaleTrigger(input, rawValue, appliedChanges, errors);
        break;
      case 'cutRules':
        applyCutRules(input, rawValue, appliedChanges, errors);
        break;
      case 'portfolioMix':
        applyPortfolioMix(input, rawValue, appliedChanges, errors);
        break;
      case 'nSim':
        if (!isPositiveInteger(rawValue)) {
          errors.push('changes.nSim debe ser entero positivo.');
          break;
        }
        input.n_paths = Number(rawValue);
        pushApplied(appliedChanges, 'n_paths', input.n_paths);
        break;
      case 'seed':
        if (!isNonNegativeInteger(rawValue)) {
          errors.push('changes.seed debe ser entero >= 0.');
          break;
        }
        input.seed = Number(rawValue);
        pushApplied(appliedChanges, 'seed', input.seed);
        break;
      case 'returnScenario':
        errors.push('changes.returnScenario todavía no tiene un mapping canónico suficientemente claro en Scenario Lab.');
        break;
      case 'horizonYears':
        errors.push('changes.horizonYears no se soporta en este slice porque exige remap completo de horizonte y eventos futuros.');
        break;
      default:
        errors.push(`changes.${key} no es un campo soportado por el evaluador M8.`);
        break;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, input, appliedChanges };
}
