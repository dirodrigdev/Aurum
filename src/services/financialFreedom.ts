import { WealthMonthlyClosure } from './wealthStorage';

export type FinancialFreedomStatus =
  | 'ok'
  | 'missing_patrimony'
  | 'invalid_input'
  | 'never_depletes'
  | 'numeric_error';

export type FinancialFreedomBase = {
  status: 'ok' | 'missing_patrimony';
  patrimonioBaseClp: number | null;
  sourceMonthKey: string | null;
  sourceClosureId: string | null;
  message: string | null;
};

export type FinancialFreedomPoint = {
  monthIndex: number;
  monthKey: string;
  balanceStartClp: number;
  interestClp: number;
  withdrawalClp: number;
  balanceEndClp: number;
};

export type FinancialFreedomPlanBase = {
  status: FinancialFreedomStatus;
  patrimonioBaseClp: number | null;
  sourceMonthKey: string | null;
  sourceClosureId: string | null;
  annualRatePct: number;
  monthlyRate: number;
  message: string | null;
  issues: string[];
};

export type FinancialFreedomWithdrawalPlan = FinancialFreedomPlanBase & {
  horizonYears: number;
  totalMonths: number;
  monthlyWithdrawalClp: number | null;
  totalWithdrawnClp: number | null;
  approximateEndMonthKey: string | null;
  curve: FinancialFreedomPoint[];
};

export type FinancialFreedomCoveragePlan = FinancialFreedomPlanBase & {
  monthlySpendClp: number;
  monthsCoverage: number | null;
  yearsCoverage: number | null;
  approximateEndMonthKey: string | null;
  curve: FinancialFreedomPoint[];
};

export type DrawdownCurveParams = {
  initialPatrimonyClp: number;
  monthlyRate: number;
  monthlyWithdrawalClp: number;
  startMonthKey: string;
  maxMonths: number;
};

const DEFAULT_COVERAGE_CURVE_CAP_MONTHS = 60 * 12;

const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;

const summaryNetClp = (
  closure: WealthMonthlyClosure,
  includeRiskCapitalInTotals: boolean,
): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

export const addMonthsToMonthKey = (monthKey: string, monthsToAdd: number): string | null => {
  const [yearRaw, monthRaw] = String(monthKey || '').split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || monthRaw < 1 || monthRaw > 12) return null;
  if (!Number.isFinite(monthsToAdd)) return null;
  const d = new Date(yearRaw, monthRaw - 1 + Math.trunc(monthsToAdd), 1, 12, 0, 0, 0);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const annualRateToMonthlyRate = (annualRatePct: number): number => {
  if (!Number.isFinite(annualRatePct)) return NaN;
  const annualRate = annualRatePct / 100;
  if (annualRate === 0) return 0;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  return Number.isFinite(monthlyRate) ? monthlyRate : NaN;
};

export const resolveFinancialFreedomBase = (
  closures: WealthMonthlyClosure[],
  includeRiskCapitalInTotals = false,
): FinancialFreedomBase => {
  const latest = [...closures]
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .find((closure) => {
      const net = summaryNetClp(closure, includeRiskCapitalInTotals);
      return net !== null && Number.isFinite(net) && net > 0;
    }) || null;

  if (!latest) {
    return {
      status: 'missing_patrimony',
      patrimonioBaseClp: null,
      sourceMonthKey: null,
      sourceClosureId: null,
      message: 'Sin datos de patrimonio disponibles',
    };
  }

  return {
    status: 'ok',
    patrimonioBaseClp: Number(summaryNetClp(latest, includeRiskCapitalInTotals)),
    sourceMonthKey: latest.monthKey,
    sourceClosureId: latest.id,
    message: null,
  };
};

export const buildDrawdownCurve = ({
  initialPatrimonyClp,
  monthlyRate,
  monthlyWithdrawalClp,
  startMonthKey,
  maxMonths,
}: DrawdownCurveParams): { status: 'ok' | 'numeric_error' | 'invalid_input'; curve: FinancialFreedomPoint[]; message: string | null } => {
  if (!isFinitePositive(initialPatrimonyClp) || !Number.isFinite(monthlyRate) || !Number.isFinite(monthlyWithdrawalClp)) {
    return { status: 'invalid_input', curve: [], message: 'Parámetros inválidos para construir la curva.' };
  }
  if (!Number.isFinite(maxMonths) || maxMonths < 0) {
    return { status: 'invalid_input', curve: [], message: 'Horizonte inválido para construir la curva.' };
  }

  const curve: FinancialFreedomPoint[] = [
    {
      monthIndex: 0,
      monthKey: startMonthKey,
      balanceStartClp: initialPatrimonyClp,
      interestClp: 0,
      withdrawalClp: 0,
      balanceEndClp: initialPatrimonyClp,
    },
  ];

  let balance = initialPatrimonyClp;
  for (let monthIndex = 1; monthIndex <= Math.trunc(maxMonths); monthIndex += 1) {
    const interestClp = balance * monthlyRate;
    const rawEnd = balance + interestClp - monthlyWithdrawalClp;
    if (!Number.isFinite(rawEnd) || !Number.isFinite(interestClp)) {
      return {
        status: 'numeric_error',
        curve: [],
        message: 'La curva produjo un valor no numérico inesperado.',
      };
    }
    const clampedEnd = Math.max(0, rawEnd);
    const monthKey = addMonthsToMonthKey(startMonthKey, monthIndex) || startMonthKey;
    curve.push({
      monthIndex,
      monthKey,
      balanceStartClp: balance,
      interestClp,
      withdrawalClp: monthlyWithdrawalClp,
      balanceEndClp: clampedEnd,
    });
    balance = clampedEnd;
    if (balance <= 0) break;
  }

  return { status: 'ok', curve, message: null };
};

export const calculateMonthlyWithdrawal = (
  patrimonioBaseClp: number,
  annualRatePct: number,
  horizonYears: number,
): { status: 'ok' | 'invalid_input' | 'numeric_error'; monthlyRate: number; totalMonths: number; monthlyWithdrawalClp: number | null; message: string | null } => {
  const monthlyRate = annualRateToMonthlyRate(annualRatePct);
  const totalMonths = Math.round(horizonYears * 12);
  if (!isFinitePositive(patrimonioBaseClp) || !Number.isFinite(horizonYears) || horizonYears <= 0 || totalMonths <= 0) {
    return {
      status: 'invalid_input',
      monthlyRate,
      totalMonths,
      monthlyWithdrawalClp: null,
      message: 'Parámetros inválidos para calcular retiro mensual.',
    };
  }
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0) {
    return {
      status: 'invalid_input',
      monthlyRate,
      totalMonths,
      monthlyWithdrawalClp: null,
      message: 'Tasa inválida para calcular retiro mensual.',
    };
  }

  if (monthlyRate === 0) {
    return {
      status: 'ok',
      monthlyRate,
      totalMonths,
      monthlyWithdrawalClp: patrimonioBaseClp / totalMonths,
      message: null,
    };
  }

  const denominator = 1 - Math.pow(1 + monthlyRate, -totalMonths);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return {
      status: 'numeric_error',
      monthlyRate,
      totalMonths,
      monthlyWithdrawalClp: null,
      message: 'No pude resolver la fórmula de retiro mensual.',
    };
  }

  const monthlyWithdrawalClp = (patrimonioBaseClp * monthlyRate) / denominator;
  if (!Number.isFinite(monthlyWithdrawalClp) || monthlyWithdrawalClp < 0) {
    return {
      status: 'numeric_error',
      monthlyRate,
      totalMonths,
      monthlyWithdrawalClp: null,
      message: 'La fórmula de retiro mensual produjo un valor inválido.',
    };
  }

  return {
    status: 'ok',
    monthlyRate,
    totalMonths,
    monthlyWithdrawalClp,
    message: null,
  };
};

export const buildMonthlyWithdrawalPlan = (
  closures: WealthMonthlyClosure[],
  annualRatePct: number,
  horizonYears: number,
  includeRiskCapitalInTotals = false,
): FinancialFreedomWithdrawalPlan => {
  const base = resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals);
  if (base.status !== 'ok' || !base.patrimonioBaseClp || !base.sourceMonthKey) {
    return {
      status: 'missing_patrimony',
      patrimonioBaseClp: null,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: annualRateToMonthlyRate(annualRatePct),
      message: base.message,
      issues: base.message ? [base.message] : [],
      horizonYears,
      totalMonths: Math.round(horizonYears * 12),
      monthlyWithdrawalClp: null,
      totalWithdrawnClp: null,
      approximateEndMonthKey: null,
      curve: [],
    };
  }

  const withdrawal = calculateMonthlyWithdrawal(base.patrimonioBaseClp, annualRatePct, horizonYears);
  if (withdrawal.status !== 'ok' || withdrawal.monthlyWithdrawalClp === null) {
    return {
      status: withdrawal.status,
      patrimonioBaseClp: base.patrimonioBaseClp,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: withdrawal.monthlyRate,
      message: withdrawal.message,
      issues: withdrawal.message ? [withdrawal.message] : [],
      horizonYears,
      totalMonths: withdrawal.totalMonths,
      monthlyWithdrawalClp: null,
      totalWithdrawnClp: null,
      approximateEndMonthKey: null,
      curve: [],
    };
  }

  const curveResult = buildDrawdownCurve({
    initialPatrimonyClp: base.patrimonioBaseClp,
    monthlyRate: withdrawal.monthlyRate,
    monthlyWithdrawalClp: withdrawal.monthlyWithdrawalClp,
    startMonthKey: base.sourceMonthKey,
    maxMonths: withdrawal.totalMonths,
  });
  if (curveResult.status !== 'ok') {
    return {
      status: curveResult.status,
      patrimonioBaseClp: base.patrimonioBaseClp,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: withdrawal.monthlyRate,
      message: curveResult.message,
      issues: curveResult.message ? [curveResult.message] : [],
      horizonYears,
      totalMonths: withdrawal.totalMonths,
      monthlyWithdrawalClp: null,
      totalWithdrawnClp: null,
      approximateEndMonthKey: null,
      curve: [],
    };
  }

  return {
    status: 'ok',
    patrimonioBaseClp: base.patrimonioBaseClp,
    sourceMonthKey: base.sourceMonthKey,
    sourceClosureId: base.sourceClosureId,
    annualRatePct,
    monthlyRate: withdrawal.monthlyRate,
    message: null,
    issues: [],
    horizonYears,
    totalMonths: withdrawal.totalMonths,
    monthlyWithdrawalClp: withdrawal.monthlyWithdrawalClp,
    totalWithdrawnClp: withdrawal.monthlyWithdrawalClp * withdrawal.totalMonths,
    approximateEndMonthKey: addMonthsToMonthKey(base.sourceMonthKey, withdrawal.totalMonths),
    curve: curveResult.curve,
  };
};

export const calculateCoverageDuration = (
  patrimonioBaseClp: number,
  annualRatePct: number,
  monthlySpendClp: number,
): {
  status: 'ok' | 'invalid_input' | 'never_depletes' | 'numeric_error';
  monthlyRate: number;
  monthsCoverage: number | null;
  yearsCoverage: number | null;
  message: string | null;
} => {
  const monthlyRate = annualRateToMonthlyRate(annualRatePct);
  if (!isFinitePositive(patrimonioBaseClp) || !isFinitePositive(monthlySpendClp)) {
    return {
      status: 'invalid_input',
      monthlyRate,
      monthsCoverage: null,
      yearsCoverage: null,
      message: 'Parámetros inválidos para calcular cobertura.',
    };
  }
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0) {
    return {
      status: 'invalid_input',
      monthlyRate,
      monthsCoverage: null,
      yearsCoverage: null,
      message: 'Tasa inválida para calcular cobertura.',
    };
  }

  if (monthlyRate === 0) {
    const monthsCoverage = patrimonioBaseClp / monthlySpendClp;
    return {
      status: Number.isFinite(monthsCoverage) ? 'ok' : 'numeric_error',
      monthlyRate,
      monthsCoverage: Number.isFinite(monthsCoverage) ? monthsCoverage : null,
      yearsCoverage: Number.isFinite(monthsCoverage) ? monthsCoverage / 12 : null,
      message: Number.isFinite(monthsCoverage) ? null : 'La cobertura produjo un valor no numérico.',
    };
  }

  if (patrimonioBaseClp * monthlyRate >= monthlySpendClp) {
    return {
      status: 'never_depletes',
      monthlyRate,
      monthsCoverage: null,
      yearsCoverage: null,
      message: 'No se agota bajo este supuesto determinista',
    };
  }

  const numerator = 1 - (patrimonioBaseClp * monthlyRate) / monthlySpendClp;
  const denominator = Math.log(1 + monthlyRate);
  if (!Number.isFinite(numerator) || numerator <= 0 || !Number.isFinite(denominator) || denominator <= 0) {
    return {
      status: 'numeric_error',
      monthlyRate,
      monthsCoverage: null,
      yearsCoverage: null,
      message: 'No pude resolver la fórmula de cobertura.',
    };
  }

  const monthsCoverage = -Math.log(numerator) / denominator;
  if (!Number.isFinite(monthsCoverage) || monthsCoverage < 0) {
    return {
      status: 'numeric_error',
      monthlyRate,
      monthsCoverage: null,
      yearsCoverage: null,
      message: 'La cobertura produjo un valor inválido.',
    };
  }

  return {
    status: 'ok',
    monthlyRate,
    monthsCoverage,
    yearsCoverage: monthsCoverage / 12,
    message: null,
  };
};

export const buildCoveragePlan = (
  closures: WealthMonthlyClosure[],
  annualRatePct: number,
  monthlySpendClp: number,
  includeRiskCapitalInTotals = false,
  curveCapMonths = DEFAULT_COVERAGE_CURVE_CAP_MONTHS,
): FinancialFreedomCoveragePlan => {
  const base = resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals);
  if (base.status !== 'ok' || !base.patrimonioBaseClp || !base.sourceMonthKey) {
    return {
      status: 'missing_patrimony',
      patrimonioBaseClp: null,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: annualRateToMonthlyRate(annualRatePct),
      message: base.message,
      issues: base.message ? [base.message] : [],
      monthlySpendClp,
      monthsCoverage: null,
      yearsCoverage: null,
      approximateEndMonthKey: null,
      curve: [],
    };
  }

  const coverage = calculateCoverageDuration(base.patrimonioBaseClp, annualRatePct, monthlySpendClp);
  if (coverage.status === 'never_depletes') {
    const curveResult = buildDrawdownCurve({
      initialPatrimonyClp: base.patrimonioBaseClp,
      monthlyRate: coverage.monthlyRate,
      monthlyWithdrawalClp: monthlySpendClp,
      startMonthKey: base.sourceMonthKey,
      maxMonths: curveCapMonths,
    });
    return {
      status: 'never_depletes',
      patrimonioBaseClp: base.patrimonioBaseClp,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: coverage.monthlyRate,
      message: coverage.message,
      issues: coverage.message ? [coverage.message] : [],
      monthlySpendClp,
      monthsCoverage: null,
      yearsCoverage: null,
      approximateEndMonthKey: null,
      curve: curveResult.status === 'ok' ? curveResult.curve : [],
    };
  }

  if (coverage.status !== 'ok' || coverage.monthsCoverage === null) {
    return {
      status: coverage.status,
      patrimonioBaseClp: base.patrimonioBaseClp,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: coverage.monthlyRate,
      message: coverage.message,
      issues: coverage.message ? [coverage.message] : [],
      monthlySpendClp,
      monthsCoverage: null,
      yearsCoverage: null,
      approximateEndMonthKey: null,
      curve: [],
    };
  }

  const maxMonths = Math.max(1, Math.ceil(coverage.monthsCoverage));
  const curveResult = buildDrawdownCurve({
    initialPatrimonyClp: base.patrimonioBaseClp,
    monthlyRate: coverage.monthlyRate,
    monthlyWithdrawalClp: monthlySpendClp,
    startMonthKey: base.sourceMonthKey,
    maxMonths,
  });
  if (curveResult.status !== 'ok') {
    return {
      status: curveResult.status,
      patrimonioBaseClp: base.patrimonioBaseClp,
      sourceMonthKey: base.sourceMonthKey,
      sourceClosureId: base.sourceClosureId,
      annualRatePct,
      monthlyRate: coverage.monthlyRate,
      message: curveResult.message,
      issues: curveResult.message ? [curveResult.message] : [],
      monthlySpendClp,
      monthsCoverage: null,
      yearsCoverage: null,
      approximateEndMonthKey: null,
      curve: [],
    };
  }

  return {
    status: 'ok',
    patrimonioBaseClp: base.patrimonioBaseClp,
    sourceMonthKey: base.sourceMonthKey,
    sourceClosureId: base.sourceClosureId,
    annualRatePct,
    monthlyRate: coverage.monthlyRate,
    message: null,
    issues: [],
    monthlySpendClp,
    monthsCoverage: coverage.monthsCoverage,
    yearsCoverage: coverage.yearsCoverage,
    approximateEndMonthKey: addMonthsToMonthKey(base.sourceMonthKey, Math.ceil(coverage.monthsCoverage)),
    curve: curveResult.curve,
  };
};
