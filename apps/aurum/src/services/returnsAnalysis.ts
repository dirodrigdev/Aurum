import type {
  AggregateCoverage,
  AggregateCoverageExclusionReason,
  AggregateCoverageNonApplicableReason,
  AggregatedSummary,
  MonthlyReturnRow,
  ReturnCurveMarker,
  ReturnCurveMarkerKind,
  ReturnCurveModel,
  ReturnCurvePoint,
} from '../components/analysis/types';
import { resolveGastappMonthlySpend } from './gastosMonthly';
import {
  listSuspiciousHistoricalUfClosures,
} from './wealthStorage';
import type { WealthCurrency, WealthFxRates, WealthMonthlyClosure } from './wealthStorage';

const sumNumbers = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

export const monthYear = (monthKey: string) => Number(monthKey.slice(0, 4));

const DEFAULT_FX_RATES: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
};

const toMonthlyReturnDecimal = (pct: number | null | undefined) => {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return pct / 100;
};

const getValidMonthlyReturnDecimals = (rows: Array<Pick<MonthlyReturnRow, 'pct'>>) =>
  rows
    .map((row) => toMonthlyReturnDecimal(row.pct))
    .filter((value): value is number => value !== null);

export const calculateCompoundedReturnFromMonthlyPct = (
  rows: Array<Pick<MonthlyReturnRow, 'pct'>>,
): number | null => {
  const monthlyReturns = getValidMonthlyReturnDecimals(rows);
  if (!monthlyReturns.length) return null;
  const compoundedGrowth = monthlyReturns.reduce((product, value) => product * (1 + value), 1);
  if (!Number.isFinite(compoundedGrowth) || compoundedGrowth <= 0) return null;
  return (compoundedGrowth - 1) * 100;
};

export const calculateAnnualizedCompoundedReturnFromMonthlyPct = (
  rows: Array<Pick<MonthlyReturnRow, 'pct'>>,
): number | null => {
  const monthlyReturns = getValidMonthlyReturnDecimals(rows);
  if (!monthlyReturns.length) return null;
  const compoundedGrowth = monthlyReturns.reduce((product, value) => product * (1 + value), 1);
  if (!Number.isFinite(compoundedGrowth) || compoundedGrowth <= 0) return null;
  return (Math.pow(compoundedGrowth, 12 / monthlyReturns.length) - 1) * 100;
};

const previousMonthKey = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return monthKey;
  const previousMonth = monthRaw === 1 ? 12 : monthRaw - 1;
  const previousYear = monthRaw === 1 ? yearRaw - 1 : yearRaw;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
};

const MONTH_SHORT_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] as const;

const parseYmd = (value: string): Date | null => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date : null;
};

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0, 0);

const formatCompactDate = (date: Date | null) => {
  if (!date) return null;
  return `${date.getDate()} ${MONTH_SHORT_ES[date.getMonth()]}`;
};

const fallbackAvailabilityDate = (monthKey: string): Date | null => {
  const parsed = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!parsed) return null;
  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return new Date(year, month, 12, 12, 0, 0, 0);
};

export const buildPendingOfficialReturnInfo = (
  row: Pick<MonthlyReturnRow, 'monthKey' | 'gastosPeriodKey'>,
) => {
  const parts = String(row.gastosPeriodKey || '').split('__');
  const start = parts.length === 2 ? parseYmd(parts[0]) : null;
  const end = parts.length === 2 ? parseYmd(parts[1]) : null;
  const availabilityDate = end ? addDays(end, 1) : fallbackAvailabilityDate(row.monthKey);
  const startLabel = formatCompactDate(start);
  const endLabel = formatCompactDate(end);
  const availabilityLabel = formatCompactDate(availabilityDate);
  return {
    availabilityDate,
    availabilityLabel,
    periodRangeLabel: startLabel && endLabel ? `${startLabel} - ${endLabel}` : null,
  };
};

export type ProvisionalReturnScenario = {
  key: 'avg_12m_closed' | 'avg_6m_closed' | 'previous_closed';
  label: string;
  spendDisplay: number;
  spendClp: number;
  retornoRealDisplay: number;
  retornoRealClp: number;
  pct: number | null;
  monthsUsed: number;
};

type AverageEstimateMethod = 'avg_12m_closed' | 'avg_6m_closed';

export type PendingReturnEstimate = {
  monthKey: string;
  availabilityLabel: string | null;
  periodRangeLabel: string | null;
  varPatrimonioDisplay: number;
  scenarios: ProvisionalReturnScenario[];
  selectedScenarioKey: AverageEstimateMethod | null;
};

export type EstimatedMonthMeta = {
  monthKey: string;
  estimateMethod: AverageEstimateMethod;
  estimatedSpendClp: number;
  estimatedSpendDisplay: number;
  estimatedFromMonthsCount: number;
  officialAvailableDate: string | null;
  gastosPeriodKey: string | null;
  referencePreviousMonthSpendClp: number | null;
};

export type ReturnsSeriesView = {
  officialRows: MonthlyReturnRow[];
  estimatedRows: MonthlyReturnRow[];
  hasEstimatedMonth: boolean;
  pendingEstimate: EstimatedMonthMeta | null;
  pendingEstimateDetail: PendingReturnEstimate | null;
  officialAvailabilityNotice: {
    monthKey: string;
    monthLabel: string;
    officialReturnDisplay: number;
    officialReturnClp: number;
    officialRatePct: number;
    officialSpendDisplay: number;
    officialSpendClp: number;
    officialAvailableDate: string | null;
    status: 'official';
    wasEstimatedOrPending: boolean;
    source: 'returns_series_official';
  } | null;
};

export type ReturnsMonthlySourceDiagnostic = {
  monthKey: string;
  retornoVisibleClp: number | null;
  currentClosureAvailable: boolean;
  previousClosureAvailable: boolean;
  varPatrimonioClp: number | null;
  fx: WealthFxRates;
  fxAuditable: boolean;
  fxMethod: 'real_closure' | 'default_fallback';
  fxMissing: MonthlyReturnRow['fxMissing'];
  gastosClp: number | null;
  gastosSource: MonthlyReturnRow['gastosSource'];
  gastosStatus: MonthlyReturnRow['gastosStatus'];
  contractStatus: MonthlyReturnRow['gastosContractStatus'];
  dataQuality: MonthlyReturnRow['gastosDataQuality'];
  isStale: boolean;
  staleReason: string | null;
  day_to_day_source: string | null;
  contractSource: string | null;
  schemaVersion: string | null;
  methodologyVersion: string | null;
  periodKey: string | null;
  revision: number | null;
  updatedAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  reportUpdatedAt: string | null;
  summaryUpdatedAt: string | null;
  lastExpenseUpdatedAt: string | null;
  reportTotalEur: number | null;
  summaryTotalEur: number | null;
  directExpenseTotalEur: number | null;
  reportVsDirectDiffEur: number | null;
  summaryVsDirectDiffEur: number | null;
  reportVsSummaryDiffEur: number | null;
  categoryGapEur: number | null;
  entraAgregadoOficial: boolean;
  motivoExclusion: AggregateCoverageExclusionReason | null;
  motivoExclusionLabel: string | null;
};

export type WealthEvolutionCurrency = 'CLP' | 'UF' | 'USD' | 'EUR';

export type WealthEvolutionPoint = {
  id: string;
  monthKey: string;
  netClp: number | null;
  netUf: number | null;
  netUsd: number | null;
  netEur: number | null;
  ufClp: number | null;
  fxAuditable: boolean;
};

export type WealthEvolutionComparisonModel = {
  source: 'returns_analysis_closures';
  baseMonth: string | null;
  missingFxMonths: string[];
  missingUfMonths: string[];
  suspiciousUfMonths: Array<{
    monthKey: string;
    ufClp: number;
    prevUfClp: number;
    changePct: number;
  }>;
  hasIncompleteConversion: boolean;
  points: WealthEvolutionPoint[];
  clpSeries: ReturnCurveModel;
  ufSeries: ReturnCurveModel;
  usdSeries: ReturnCurveModel;
  eurSeries: ReturnCurveModel;
  ufTrendSeries: ReturnCurveModel;
  base100Series: Record<WealthEvolutionCurrency, ReturnCurveModel>;
};

const monthAfter = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return null;
  const nextMonth = monthRaw === 12 ? 1 : monthRaw + 1;
  const nextYear = monthRaw === 12 ? yearRaw + 1 : yearRaw;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const currentOperationalMonthKey = (closures: WealthMonthlyClosure[]) => {
  const fallback = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  if (!closures.length) return fallback;
  const latestClosedMonth = [...closures]
    .map((closure) => closure.monthKey)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!latestClosedMonth) return fallback;
  return monthAfter(latestClosedMonth) || fallback;
};

const summaryNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const safeUsdClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : DEFAULT_FX_RATES.usdClp;

const safeUfClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : DEFAULT_FX_RATES.ufClp;

const safeFxRaw = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: safeUsdClp(Number(fx?.usdClp)),
  eurClp:
    Number.isFinite(Number(fx?.eurClp)) && Number(fx?.eurClp) > 0
      ? Number(fx?.eurClp)
      : DEFAULT_FX_RATES.eurClp,
  ufClp: safeUfClp(Number(fx?.ufClp)),
});

const resolveFxForAnalysis = (
  closure: WealthMonthlyClosure,
): {
  fx: WealthFxRates;
  method: 'real_closure' | 'default_fallback';
  auditable: boolean;
  missingKeys: Array<'usdClp' | 'eurClp' | 'ufClp'>;
} => {
  const fx = safeFxRaw(closure.fxRates);
  const missingFromClosure = Array.isArray(closure.fxMissing)
    ? closure.fxMissing.filter(
        (key): key is 'usdClp' | 'eurClp' | 'ufClp' =>
          key === 'usdClp' || key === 'eurClp' || key === 'ufClp',
      )
    : [];
  const missingFromValues: Array<'usdClp' | 'eurClp' | 'ufClp'> = [];
  if (!Number.isFinite(Number(closure.fxRates?.usdClp)) || Number(closure.fxRates?.usdClp) <= 0) {
    missingFromValues.push('usdClp');
  }
  if (!Number.isFinite(Number(closure.fxRates?.eurClp)) || Number(closure.fxRates?.eurClp) <= 0) {
    missingFromValues.push('eurClp');
  }
  if (!Number.isFinite(Number(closure.fxRates?.ufClp)) || Number(closure.fxRates?.ufClp) <= 0) {
    missingFromValues.push('ufClp');
  }
  const missingKeys = Array.from(new Set([...missingFromClosure, ...missingFromValues]));
  const auditable = missingKeys.length === 0;
  return {
    fx,
    method: auditable ? 'real_closure' : 'default_fallback',
    auditable,
    missingKeys,
  };
};

const parseIsoDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const isOfficialClosedSpend = (row: MonthlyReturnRow) =>
  row.fxAuditable &&
  row.gastosStatus === 'complete' &&
  row.gastosSource === 'gastapp_firestore' &&
  row.gastosClp !== null &&
  row.gastosDisplay !== null &&
  !row.gastosIsStale &&
  (row.gastosDataQuality === null || row.gastosDataQuality === 'ok') &&
  (row.gastosContractStatus === null || row.gastosContractStatus === 'complete') &&
  row.gastosContractSource !== 'legacy_static' &&
  row.gastosDayToDaySource !== 'legacy';

const hasOfficialClosedSpend = (
  row: MonthlyReturnRow,
): row is MonthlyReturnRow & {
  gastosClp: number;
  gastosDisplay: number;
} => isOfficialClosedSpend(row);

const isOfficialAggregateInput = (row: MonthlyReturnRow) =>
  isOfficialClosedSpend(row) &&
  row.varPatrimonioClp !== null &&
  row.retornoRealClp !== null &&
  row.varPatrimonioDisplay !== null &&
  row.retornoRealDisplay !== null;

const isEstimatedAggregateInput = (row: MonthlyReturnRow) =>
  Boolean(row.isEstimated) &&
  row.fxAuditable &&
  row.varPatrimonioClp !== null &&
  row.gastosClp !== null &&
  row.retornoRealClp !== null &&
  row.varPatrimonioDisplay !== null &&
  row.gastosDisplay !== null &&
  row.retornoRealDisplay !== null;

const isAggregateInput = (row: MonthlyReturnRow) =>
  isOfficialAggregateInput(row) || isEstimatedAggregateInput(row);

const hasOfficialAggregateInputs = (
  row: MonthlyReturnRow,
): row is MonthlyReturnRow & {
  varPatrimonioClp: number;
  gastosClp: number;
  retornoRealClp: number;
  varPatrimonioDisplay: number;
  gastosDisplay: number;
  retornoRealDisplay: number;
} => isAggregateInput(row);

const coverageReasonLabel = (reason: AggregateCoverageExclusionReason) => {
  if (reason === 'missing_closure') return 'cierre faltante';
  if (reason === 'non_official_spend') return 'gasto no oficial';
  if (reason === 'stale_warning_error') return 'stale/warning/error';
  if (reason === 'legacy_static') return 'legacy_static';
  if (reason === 'fx_not_auditable') return 'FX no auditable';
  return 'variación no calculable';
};

const coverageNonApplicableLabel = (reason: AggregateCoverageNonApplicableReason) => {
  if (reason === 'base_month') return 'mes base';
  return 'pendiente';
};

const classifyCoverageNonApplicable = (row: MonthlyReturnRow): AggregateCoverageNonApplicableReason | null => {
  if (row.prevNetClp === null && row.varPatrimonioClp === null && row.netClp !== null && !row.invalidNet) {
    return 'base_month';
  }
  if (
    !row.isEstimated &&
    row.gastosStatus === 'pending' &&
    !row.gastosIsStale &&
    row.gastosDataQuality !== 'warning' &&
    row.gastosDataQuality !== 'error' &&
    row.gastosContractStatus !== 'stale' &&
    row.gastosSource !== 'legacy_static' &&
    row.gastosContractSource !== 'legacy_static' &&
    row.gastosDayToDaySource !== 'legacy'
  ) {
    return 'pending_current';
  }
  return null;
};

const classifyAggregateExclusion = (row: MonthlyReturnRow): AggregateCoverageExclusionReason | null => {
  if (isOfficialAggregateInput(row)) return null;
  if (!row.fxAuditable) return 'fx_not_auditable';
  if (
    row.gastosSource === 'legacy_static' ||
    row.gastosContractSource === 'legacy_static' ||
    row.gastosDayToDaySource === 'legacy'
  ) {
    return 'legacy_static';
  }
  if (
    row.gastosIsStale ||
    row.gastosDataQuality === 'warning' ||
    row.gastosDataQuality === 'error' ||
    row.gastosContractStatus === 'stale'
  ) {
    return 'stale_warning_error';
  }
  if (
    row.gastosStatus !== 'complete' ||
    row.gastosSource !== 'gastapp_firestore' ||
    row.gastosContractStatus === 'pending' ||
    row.gastosContractStatus === 'missing'
  ) {
    return 'non_official_spend';
  }
  return 'not_calculable';
};

const parseMonthKeyParts = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || monthRaw < 1 || monthRaw > 12) return null;
  return { year: yearRaw, month: monthRaw };
};

const addMonthsToKey = (monthKey: string, delta: number) => {
  const parsed = parseMonthKeyParts(monthKey);
  if (!parsed) return monthKey;
  const date = new Date(parsed.year, parsed.month - 1 + delta, 1, 12, 0, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const enumerateMonthKeys = (startMonthKey: string, endMonthKey: string): string[] => {
  if (!parseMonthKeyParts(startMonthKey) || !parseMonthKeyParts(endMonthKey) || startMonthKey > endMonthKey) return [];
  const months: string[] = [];
  let current = startMonthKey;
  while (current <= endMonthKey && months.length < 600) {
    months.push(current);
    current = addMonthsToKey(current, 1);
  }
  return months;
};

const trailingExpectedMonthKeys = (endMonthKey: string, count: number) => {
  if (count <= 0) return [];
  const startMonthKey = addMonthsToKey(endMonthKey, -(count - 1));
  return enumerateMonthKeys(startMonthKey, endMonthKey);
};

type AggregateRowsOptions = {
  expectedMonthKeys?: string[];
  expectedMonths?: number;
  periodStartMonthKey?: string | null;
  periodEndMonthKey?: string | null;
};

const buildAggregateCoverage = (
  rows: MonthlyReturnRow[],
  validRows: MonthlyReturnRow[],
  options: AggregateRowsOptions | undefined,
): AggregateCoverage => {
  const expectedMonthKeys =
    options?.expectedMonthKeys ??
    rows.map((row) => row.monthKey);
  const rowByMonth = new Map(rows.map((row) => [row.monthKey, row]));
  const nonApplicableMonths = expectedMonthKeys
    .map((monthKey) => {
      const row = rowByMonth.get(monthKey) ?? null;
      const reason = row ? classifyCoverageNonApplicable(row) : null;
      return reason
        ? {
            monthKey,
            reason,
            label: coverageNonApplicableLabel(reason),
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const nonApplicableMonthKeys = new Set(nonApplicableMonths.map((month) => month.monthKey));
  const comparableExpectedMonthKeys = expectedMonthKeys.filter((monthKey) => !nonApplicableMonthKeys.has(monthKey));
  const expectedMonths = Math.max(
    options?.expectedMonths ?? comparableExpectedMonthKeys.length,
    comparableExpectedMonthKeys.length,
  );
  const comparableValidRows = validRows.filter((row) => !nonApplicableMonthKeys.has(row.monthKey));
  const validMonthKeys = new Set(comparableValidRows.map((row) => row.monthKey));
  const excludedMonths = comparableExpectedMonthKeys
    .filter((monthKey) => !validMonthKeys.has(monthKey))
    .map((monthKey) => {
      const row = rowByMonth.get(monthKey) ?? null;
      const reason = row ? classifyAggregateExclusion(row) ?? 'not_calculable' : 'missing_closure';
      return {
        monthKey,
        reason,
        label: coverageReasonLabel(reason),
      };
    });
  const validMonths = comparableValidRows.length;
  const status: AggregateCoverage['status'] =
    expectedMonths > 0 && validMonths >= expectedMonths
      ? 'complete'
      : validMonths === 0 || (expectedMonths > 0 && validMonths / expectedMonths < 0.5)
        ? 'insufficient'
        : 'partial';

  return {
    validMonths,
    expectedMonths,
    excludedMonths,
    nonApplicableMonths,
    status,
  };
};

const buildOfficialAvailabilityNotice = (officialRows: MonthlyReturnRow[]) => {
  const sortedDesc = [...officialRows].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const candidate = sortedDesc.find(
    (row) =>
      hasOfficialClosedSpend(row) &&
      row.retornoRealDisplay !== null &&
      row.retornoRealClp !== null &&
      row.pct !== null,
  );
  if (!candidate) return null;

  const sourceDate =
    parseIsoDate(candidate.gastosPublishedAt) ||
    parseIsoDate(candidate.gastosUpdatedAt) ||
    parseIsoDate(candidate.gastosClosedAt);
  if (!sourceDate) return null;

  const ageMs = Date.now() - sourceDate.getTime();
  const maxAgeMs = 10 * 24 * 60 * 60 * 1000;
  if (ageMs < 0 || ageMs > maxAgeMs) return null;

  const info = buildPendingOfficialReturnInfo(candidate);
  const [yearRaw, monthRaw] = candidate.monthKey.split('-').map(Number);
  const monthName = MONTH_SHORT_ES[(monthRaw || 1) - 1] ?? candidate.monthKey;
  return {
    monthKey: candidate.monthKey,
    monthLabel: `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${yearRaw}`,
    officialReturnDisplay: Number(candidate.retornoRealDisplay),
    officialReturnClp: Number(candidate.retornoRealClp),
    officialRatePct: Number(candidate.pct),
    officialSpendDisplay: Number(candidate.gastosDisplay),
    officialSpendClp: Number(candidate.gastosClp),
    officialAvailableDate: info.availabilityLabel,
    status: 'official' as const,
    wasEstimatedOrPending: true,
    source: 'returns_series_official' as const,
  };
};

export const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

export const computeMonthlyRows = (
  closures: WealthMonthlyClosure[],
  includeRiskCapitalInTotals: boolean,
  currency: WealthCurrency,
): MonthlyReturnRow[] => {
  const sorted = [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const calendarCurrent = currentOperationalMonthKey(closures);
  const filtered = sorted.filter((closure) => closure.monthKey !== calendarCurrent);
  const rows: MonthlyReturnRow[] = [];
  let previousValidNet: number | null = null;
  let previousValidNetDisplay: number | null = null;
  let previousAuditableUfClp: number | null = null;

  for (const closure of filtered) {
    const fxResolution = resolveFxForAnalysis(closure);
    const fxRaw = fxResolution.fx;
    const fx = fxRaw;
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const fxAuditable = fxResolution.auditable;
    const netDisplay =
      invalidNet || netClp === null || (!fxAuditable && currency !== 'CLP')
        ? null
        : convertFromClp(netClp, currency, fx);
    const prevNetClp = invalidNet ? null : previousValidNet;
    const prevNetDisplay =
      invalidNet || (!fxAuditable && currency !== 'CLP') ? null : previousValidNetDisplay;
    const varPatrimonioClp =
      invalidNet || prevNetClp === null || netClp === null ? null : netClp - prevNetClp;
    const varPatrimonioDisplay =
      invalidNet || prevNetDisplay === null || netDisplay === null ? null : netDisplay - prevNetDisplay;
    const spend = resolveGastappMonthlySpend(closure.monthKey, new Date());
    const gastosEur = spend.gastosEur;
    const gastosClp = invalidNet || !fxAuditable || gastosEur === null ? null : gastosEur * fx.eurClp;
    const gastosDisplay = gastosClp === null ? null : convertFromClp(gastosClp, currency, fx);
    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const retornoRealDisplay =
      varPatrimonioDisplay === null || gastosDisplay === null ? null : varPatrimonioDisplay + gastosDisplay;
    const pct =
      retornoRealDisplay === null || prevNetDisplay === null || prevNetDisplay === 0
        ? null
        : (retornoRealDisplay / prevNetDisplay) * 100;
    const currentUfClp = Number(fx.ufClp);
    const inflationMonthlyRate =
      currency === 'CLP' &&
      fxAuditable &&
      previousAuditableUfClp !== null &&
      Number.isFinite(currentUfClp) &&
      currentUfClp > 0 &&
      previousAuditableUfClp > 0
        ? currentUfClp / previousAuditableUfClp - 1
        : null;
    const pctReal =
      pct === null || inflationMonthlyRate === null || 1 + inflationMonthlyRate <= 0
        ? null
        : (((1 + pct / 100) / (1 + inflationMonthlyRate)) - 1) * 100;

    if (invalidNet) {
      console.warn('[Analysis][invalid-net]', {
        monthKey: closure.monthKey,
        netClp: closure.summary?.netClp ?? null,
        netConsolidatedClp: closure.summary?.netConsolidatedClp ?? null,
      });
    } else {
      // Keep the patrimony chain anchored to the immediately prior valid net,
      // even when the spend month is missing and that row itself stays non-comparable.
      previousValidNet = Number(netClp);
      if (netDisplay !== null && Number.isFinite(netDisplay)) {
        previousValidNetDisplay = Number(netDisplay);
      }
    }

    if (!invalidNet && spend.status === 'missing') {
      console.warn('[Analysis][missing-spend-month]', { monthKey: closure.monthKey });
    }
    if (!invalidNet && !fxAuditable) {
      console.warn('[Analysis][fx-not-auditable-month]', {
        monthKey: closure.monthKey,
        fxMethod: fxResolution.method,
        fxMissing: fxResolution.missingKeys,
      });
    }
    if (fxAuditable && Number.isFinite(currentUfClp) && currentUfClp > 0) {
      previousAuditableUfClp = currentUfClp;
    }

    rows.push({
      monthKey: closure.monthKey,
      fx,
      rawEurClp: fxRaw.eurClp,
      fxMethod: fxResolution.method,
      fxAuditable,
      fxMissing: fxResolution.missingKeys,
      gastosStatus: spend.status,
      gastosSource: spend.source,
      gastosContractStatus: spend.contractStatus ?? null,
      gastosDataQuality: spend.dataQuality ?? null,
      gastosIsStale: Boolean(spend.isStale),
      gastosStaleReason: spend.staleReason ?? null,
      gastosDayToDaySource: spend.dayToDaySource ?? null,
      gastosContractSource: spend.contractSource ?? null,
      gastosSchemaVersion: spend.schemaVersion ?? null,
      gastosMethodologyVersion: spend.methodologyVersion ?? null,
      gastosPeriodKey: spend.periodKey ?? null,
      gastosPublishedAt: spend.publishedAt ?? null,
      gastosUpdatedAt: spend.updatedAt ?? null,
      gastosClosedAt: spend.closedAt ?? null,
      gastosReportUpdatedAt: spend.reportUpdatedAt ?? null,
      gastosSummaryUpdatedAt: spend.summaryUpdatedAt ?? null,
      gastosLastExpenseUpdatedAt: spend.lastExpenseUpdatedAt ?? null,
      gastosRevision: spend.revision ?? null,
      gastosReportTotalEur: spend.reportTotalEur ?? null,
      gastosSummaryTotalEur: spend.summaryTotalEur ?? null,
      gastosDirectExpenseTotalEur: spend.directExpenseTotalEur ?? null,
      gastosReportVsDirectDiffEur: spend.reportVsDirectDiffEur ?? null,
      gastosSummaryVsDirectDiffEur: spend.summaryVsDirectDiffEur ?? null,
      gastosReportVsSummaryDiffEur: spend.reportVsSummaryDiffEur ?? null,
      gastosCategoryGapEur: spend.categoryGapEur ?? null,
      netClp,
      prevNetClp,
      invalidNet,
      varPatrimonioClp,
      gastosClp,
      retornoRealClp,
      netDisplay,
      prevNetDisplay,
      varPatrimonioDisplay,
      gastosDisplay,
      retornoRealDisplay,
      pct,
      inflationMonthlyRate,
      pctReal,
    });
  }

  return rows;
};

export const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  _baseNetDisplay: number | null,
  options?: AggregateRowsOptions,
): AggregatedSummary => {
  const expectedSet = options?.expectedMonthKeys ? new Set(options.expectedMonthKeys) : null;
  const coverageRows = expectedSet ? rows.filter((row) => expectedSet.has(row.monthKey)) : rows;
  const validRows = coverageRows.filter(hasOfficialAggregateInputs);
  const coverage = buildAggregateCoverage(coverageRows, validRows, options);

  const validMonths = validRows.length;
  const varPatrimonioAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.varPatrimonioClp)) : null;
  const gastosAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.gastosClp)) : null;
  const retornoRealAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.retornoRealClp)) : null;
  const varPatrimonioAcumDisplay = validMonths
    ? sumNumbers(validRows.map((row) => row.varPatrimonioDisplay))
    : null;
  const gastosAcumDisplay = validMonths ? sumNumbers(validRows.map((row) => row.gastosDisplay)) : null;
  const retornoRealAcumDisplay = validMonths
    ? sumNumbers(validRows.map((row) => row.retornoRealDisplay))
    : null;

  let pctRetorno: number | null = null;
  let pctRetornoReal: number | null = null;
  let pctRetornoNote: string | null = null;

  pctRetorno = calculateAnnualizedCompoundedReturnFromMonthlyPct(validRows);
  if (validMonths > 0 && pctRetorno === null) {
    pctRetornoNote = 'no anualizable';
  }
  if (validMonths > 0 && validRows.length) {
    const realGrowthFactors = validRows.map((row) => {
      if (row.prevNetDisplay === null || row.prevNetDisplay <= 0 || row.retornoRealDisplay === null) return null;
      const nominalGrowth = 1 + row.retornoRealDisplay / row.prevNetDisplay;
      if (!Number.isFinite(nominalGrowth) || nominalGrowth <= 0) return null;
      if (row.inflationMonthlyRate === null || !Number.isFinite(row.inflationMonthlyRate) || row.inflationMonthlyRate <= -1) return null;
      return nominalGrowth / (1 + row.inflationMonthlyRate);
    });
    if (realGrowthFactors.every((factor) => factor !== null)) {
      const compoundedReal = realGrowthFactors.reduce((acc, factor) => acc * (factor as number), 1);
      if (compoundedReal > 0) {
        pctRetornoReal = (Math.pow(compoundedReal, 12 / validMonths) - 1) * 100;
      }
    }
  }

  const spendPct =
    retornoRealAcumDisplay === null || retornoRealAcumDisplay === 0 || gastosAcumDisplay === null
      ? null
      : (gastosAcumDisplay / retornoRealAcumDisplay) * 100;

  const varPatrimonioAvgDisplay =
    validMonths && varPatrimonioAcumDisplay !== null ? varPatrimonioAcumDisplay / validMonths : null;
  const gastosAvgDisplay =
    validMonths && gastosAcumDisplay !== null ? gastosAcumDisplay / validMonths : null;
  const retornoRealAvgDisplay =
    validMonths && retornoRealAcumDisplay !== null ? retornoRealAcumDisplay / validMonths : null;

  return {
    key,
    label,
    periodStartMonthKey: options?.periodStartMonthKey ?? null,
    periodEndMonthKey: options?.periodEndMonthKey ?? null,
    validMonths,
    coverage,
    varPatrimonioAcumClp,
    gastosAcumClp,
    retornoRealAcumClp,
    varPatrimonioAcumDisplay,
    gastosAcumDisplay,
    retornoRealAcumDisplay,
    pctRetorno,
    pctRetornoReal,
    pctRetornoNote,
    spendPct,
    varPatrimonioAvgDisplay,
    gastosAvgDisplay,
    retornoRealAvgDisplay,
  };
};

export const buildReturnsMonthlySourceDiagnostics = (
  rows: MonthlyReturnRow[],
): ReturnsMonthlySourceDiagnostic[] =>
  rows.map((row) => {
    const motivoExclusion = classifyAggregateExclusion(row);
    return {
      monthKey: row.monthKey,
      retornoVisibleClp: row.retornoRealClp,
      currentClosureAvailable: row.netClp !== null && !row.invalidNet,
      previousClosureAvailable: row.prevNetClp !== null,
      varPatrimonioClp: row.varPatrimonioClp,
      fx: row.fx,
      fxAuditable: row.fxAuditable,
      fxMethod: row.fxMethod,
      fxMissing: row.fxMissing,
      gastosClp: row.gastosClp,
      gastosSource: row.gastosSource,
      gastosStatus: row.gastosStatus,
      contractStatus: row.gastosContractStatus,
      dataQuality: row.gastosDataQuality,
      isStale: row.gastosIsStale,
      staleReason: row.gastosStaleReason,
      day_to_day_source: row.gastosDayToDaySource,
      contractSource: row.gastosContractSource,
      schemaVersion: row.gastosSchemaVersion,
      methodologyVersion: row.gastosMethodologyVersion,
      periodKey: row.gastosPeriodKey,
      revision: row.gastosRevision,
      updatedAt: row.gastosUpdatedAt,
      publishedAt: row.gastosPublishedAt,
      closedAt: row.gastosClosedAt,
      reportUpdatedAt: row.gastosReportUpdatedAt,
      summaryUpdatedAt: row.gastosSummaryUpdatedAt,
      lastExpenseUpdatedAt: row.gastosLastExpenseUpdatedAt,
      reportTotalEur: row.gastosReportTotalEur,
      summaryTotalEur: row.gastosSummaryTotalEur,
      directExpenseTotalEur: row.gastosDirectExpenseTotalEur,
      reportVsDirectDiffEur: row.gastosReportVsDirectDiffEur,
      summaryVsDirectDiffEur: row.gastosSummaryVsDirectDiffEur,
      reportVsSummaryDiffEur: row.gastosReportVsSummaryDiffEur,
      categoryGapEur: row.gastosCategoryGapEur,
      entraAgregadoOficial: motivoExclusion === null,
      motivoExclusion,
      motivoExclusionLabel: motivoExclusion ? coverageReasonLabel(motivoExclusion) : null,
    };
  });

const validClosedSpendRow = (
  row: MonthlyReturnRow,
): row is MonthlyReturnRow & {
  gastosClp: number;
  gastosDisplay: number;
} => hasOfficialClosedSpend(row);

const buildProvisionalScenario = ({
  key,
  label,
  row,
  spendDisplay,
  spendClp,
  monthsUsed,
}: {
  key: ProvisionalReturnScenario['key'];
  label: string;
  row: MonthlyReturnRow;
  spendDisplay: number;
  spendClp: number;
  monthsUsed: number;
}): ProvisionalReturnScenario | null => {
  if (row.varPatrimonioDisplay === null || row.varPatrimonioClp === null) return null;
  const retornoRealDisplay = row.varPatrimonioDisplay + spendDisplay;
  const retornoRealClp = row.varPatrimonioClp + spendClp;
  const pct =
    row.prevNetDisplay !== null && row.prevNetDisplay > 0
      ? (retornoRealDisplay / row.prevNetDisplay) * 100
      : null;
  return {
    key,
    label,
    spendDisplay,
    spendClp,
    retornoRealDisplay,
    retornoRealClp,
    pct,
    monthsUsed,
  };
};

export const buildPendingReturnEstimate = (
  monthlyRowsAsc: MonthlyReturnRow[],
): PendingReturnEstimate | null => {
  const pendingRow = [...monthlyRowsAsc]
    .reverse()
    .find(
      (row) =>
        row.gastosStatus === 'pending' &&
        row.varPatrimonioDisplay !== null &&
        row.varPatrimonioClp !== null &&
        row.prevNetDisplay !== null,
    );
  if (!pendingRow || pendingRow.varPatrimonioDisplay === null) return null;

  const closedRows = monthlyRowsAsc
    .filter((row) => row.monthKey < pendingRow.monthKey)
    .filter(validClosedSpendRow);
  const previousClosed = closedRows[closedRows.length - 1] || null;
  const info = buildPendingOfficialReturnInfo(pendingRow);
  const scenarios: ProvisionalReturnScenario[] = [];

  const buildAverageScenario = (
    key: Extract<ProvisionalReturnScenario['key'], 'avg_12m_closed' | 'avg_6m_closed'>,
    maxMonths: number,
    completeLabel: string,
  ) => {
    const sample = closedRows.slice(-maxMonths);
    if (sample.length < 2) return null;
    const avgDisplay = sumNumbers(sample.map((row) => row.gastosDisplay)) / sample.length;
    const avgClp = sumNumbers(sample.map((row) => row.gastosClp)) / sample.length;
    const scenario = buildProvisionalScenario({
      key,
      label: sample.length >= maxMonths ? completeLabel : `${completeLabel} (${sample.length} meses disponibles)`,
      row: pendingRow,
      spendDisplay: avgDisplay,
      spendClp: avgClp,
      monthsUsed: sample.length,
    });
    if (scenario) scenarios.push(scenario);
    return scenario;
  };

  const avg12Scenario = buildAverageScenario('avg_12m_closed', 12, 'Promedio últimos 12 meses oficiales');
  const avg6Scenario = buildAverageScenario('avg_6m_closed', 6, 'Promedio últimos 6 meses oficiales');

  if (previousClosed) {
    const scenario = buildProvisionalScenario({
      key: 'previous_closed',
      label: `Gasto del mes anterior cerrado (${previousClosed.monthKey})`,
      row: pendingRow,
      spendDisplay: previousClosed.gastosDisplay,
      spendClp: previousClosed.gastosClp,
      monthsUsed: 1,
    });
    if (scenario) scenarios.push(scenario);
  }

  if (!scenarios.length) return null;
  const selectedAverageScenario = [avg12Scenario, avg6Scenario]
    .filter((scenario): scenario is NonNullable<typeof scenario> => Boolean(scenario))
    .sort((left, right) => left.spendClp - right.spendClp)[0] ?? null;
  return {
    monthKey: pendingRow.monthKey,
    availabilityLabel: info.availabilityLabel,
    periodRangeLabel: info.periodRangeLabel,
    varPatrimonioDisplay: pendingRow.varPatrimonioDisplay,
    scenarios,
    selectedScenarioKey: (selectedAverageScenario?.key as AverageEstimateMethod | undefined) ?? null,
  };
};

export const buildReturnsSeriesView = (
  officialRows: MonthlyReturnRow[],
): ReturnsSeriesView => {
  const pendingEstimateDetail = buildPendingReturnEstimate(officialRows);
  const pendingRow = pendingEstimateDetail
    ? officialRows.find((row) => row.monthKey === pendingEstimateDetail.monthKey) ?? null
    : null;

  if (!pendingRow) {
    return {
      officialRows,
      estimatedRows: officialRows,
      hasEstimatedMonth: false,
      pendingEstimate: null,
      pendingEstimateDetail: null,
      officialAvailabilityNotice: buildOfficialAvailabilityNotice(officialRows),
    };
  }

  const primaryScenario = pendingEstimateDetail?.selectedScenarioKey
    ? pendingEstimateDetail.scenarios.find((scenario) => scenario.key === pendingEstimateDetail.selectedScenarioKey) ?? null
    : null;
  if (!primaryScenario) {
    return {
      officialRows,
      estimatedRows: officialRows,
      hasEstimatedMonth: false,
      pendingEstimate: null,
      pendingEstimateDetail: pendingEstimateDetail ?? null,
      officialAvailabilityNotice: buildOfficialAvailabilityNotice(officialRows),
    };
  }

  const estimateMethod = primaryScenario.key as EstimatedMonthMeta['estimateMethod'];
  const previousClosedScenario = pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'previous_closed') ?? null;

  const estimatedRow: MonthlyReturnRow = {
    ...pendingRow,
    gastosStatus: 'complete',
    gastosSource: 'gastapp_firestore',
    gastosDataQuality: null,
    gastosContractStatus: 'pending',
    gastosClp: primaryScenario.spendClp,
    gastosDisplay: primaryScenario.spendDisplay,
    retornoRealClp: primaryScenario.retornoRealClp,
    retornoRealDisplay: primaryScenario.retornoRealDisplay,
    pct: primaryScenario.pct,
    isEstimated: true,
    estimateMethod,
    estimatedSpendClp: primaryScenario.spendClp,
    estimatedFromMonthsCount: primaryScenario.monthsUsed,
    officialAvailableDate: pendingEstimateDetail?.availabilityLabel ?? null,
    referencePreviousMonthSpendClp: previousClosedScenario?.spendClp ?? null,
  };

  const estimatedRows = officialRows.map((row) => (row.monthKey === pendingRow.monthKey ? estimatedRow : row));
  return {
    officialRows,
    estimatedRows,
    hasEstimatedMonth: true,
    pendingEstimate: {
      monthKey: pendingRow.monthKey,
      estimateMethod,
      estimatedSpendClp: primaryScenario.spendClp,
      estimatedSpendDisplay: primaryScenario.spendDisplay,
      estimatedFromMonthsCount: primaryScenario.monthsUsed,
      officialAvailableDate: pendingEstimateDetail?.availabilityLabel ?? null,
      gastosPeriodKey: pendingRow.gastosPeriodKey,
      referencePreviousMonthSpendClp: previousClosedScenario?.spendClp ?? null,
    },
    pendingEstimateDetail,
    officialAvailabilityNotice: buildOfficialAvailabilityNotice(officialRows),
  };
};

export const buildTrailingSummary = (
  monthlyRowsAsc: MonthlyReturnRow[],
  count: number,
  key: string,
  label: string,
): AggregatedSummary | null => {
  const validRowsAsc = monthlyRowsAsc.filter(hasOfficialAggregateInputs);
  const rows = validRowsAsc.slice(Math.max(0, validRowsAsc.length - count));
  if (!rows.length) return null;

  const expectedMonthKeys = rows.map((row) => row.monthKey);
  const firstMonthKey = rows[0]?.monthKey ?? null;
  const endMonthKey = rows[rows.length - 1]?.monthKey ?? null;
  let baseNetDisplay: number | null = null;

  if (firstMonthKey) {
    const firstIndex = monthlyRowsAsc.findIndex((row) => row.monthKey === firstMonthKey);
    for (let index = firstIndex - 1; index >= 0; index -= 1) {
      const candidate = monthlyRowsAsc[index]?.netDisplay ?? null;
      if (candidate !== null) {
        baseNetDisplay = candidate;
        break;
      }
    }
  }

  if (baseNetDisplay === null) {
    baseNetDisplay = rows.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
  }

  return aggregateRows(key, label, rows, baseNetDisplay, {
    expectedMonthKeys,
    periodStartMonthKey: firstMonthKey,
    periodEndMonthKey: endMonthKey,
  });
};

const buildCurveDomain = (values: number[]) => {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const padding = range === 0 ? Math.max(Math.abs(maxValue) * 0.08, 1) : range * 0.14;
  return {
    minValue,
    maxValue,
    domainMin: minValue - padding,
    domainMax: maxValue + padding,
  };
};

const buildCurveFromNumericPoints = (points: ReturnCurvePoint[]): ReturnCurveModel => {
  if (points.length < 2) {
    return {
      status: 'insufficient_data',
      points,
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  const values = points.map((point) => point.value);
  const { minValue, maxValue, domainMin, domainMax } = buildCurveDomain(values);
  return {
    status: 'ok',
    points,
    markers: buildMarkerList(points),
    domainMin,
    domainMax,
    minValue,
    maxValue,
  };
};

const buildCurveFromWealthPoints = (
  points: WealthEvolutionPoint[],
  selector: (point: WealthEvolutionPoint) => number | null,
): ReturnCurveModel =>
  buildCurveFromNumericPoints(
    points
      .map((point) => {
        const value = selector(point);
        if (value === null || !Number.isFinite(value)) return null;
        return {
          id: point.id,
          monthKey: point.monthKey,
          value: Number(value),
        } satisfies ReturnCurvePoint;
      })
      .filter((point): point is ReturnCurvePoint => !!point),
  );

const buildBase100CurveFromWealthPoints = (
  points: WealthEvolutionPoint[],
  selector: (point: WealthEvolutionPoint) => number | null,
): ReturnCurveModel => {
  const basePoint = points.find((point) => {
    const value = selector(point);
    return value !== null && Number.isFinite(value) && value > 0;
  });
  const baseValue = basePoint ? selector(basePoint) : null;
  if (baseValue === null || !Number.isFinite(baseValue) || baseValue <= 0) {
    return buildCurveFromNumericPoints([]);
  }
  return buildCurveFromNumericPoints(
    points
      .map((point) => {
        const value = selector(point);
        if (value === null || !Number.isFinite(value) || value <= 0) return null;
        return {
          id: point.id,
          monthKey: point.monthKey,
          value: (Number(value) / Number(baseValue)) * 100,
        } satisfies ReturnCurvePoint;
      })
      .filter((point): point is ReturnCurvePoint => !!point),
  );
};

const buildLinearTrendCurve = (
  points: WealthEvolutionPoint[],
  selector: (point: WealthEvolutionPoint) => number | null,
): ReturnCurveModel => {
  const validPoints = points
    .map((point) => {
      const value = selector(point);
      if (value === null || !Number.isFinite(value)) return null;
      return {
        id: point.id,
        monthKey: point.monthKey,
        value: Number(value),
      };
    })
    .filter((point): point is ReturnCurvePoint => !!point);

  if (validPoints.length < 2) {
    return buildCurveFromNumericPoints([]);
  }

  const n = validPoints.length;
  const xValues = validPoints.map((_, index) => index);
  const yValues = validPoints.map((point) => point.value);
  const sumX = sumNumbers(xValues);
  const sumY = sumNumbers(yValues);
  const sumXY = sumNumbers(xValues.map((x, index) => x * yValues[index]));
  const sumXX = sumNumbers(xValues.map((x) => x * x));
  const denominator = n * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 1e-9) {
    return buildCurveFromNumericPoints([]);
  }
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const trendPoints: ReturnCurvePoint[] = validPoints.map((point, index) => ({
    id: `${point.id}-trend`,
    monthKey: point.monthKey,
    value: intercept + slope * index,
  }));
  return buildCurveFromNumericPoints(trendPoints);
};

const buildMarkerList = (points: ReturnCurvePoint[]) => {
  const markerByPointId = new Map<string, ReturnCurveMarker>();

  const upsertMarker = (point: ReturnCurvePoint, pointIndex: number, kind: ReturnCurveMarkerKind) => {
    const existing = markerByPointId.get(point.id);
    if (existing) {
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      return;
    }
    markerByPointId.set(point.id, {
      pointId: point.id,
      pointIndex,
      monthKey: point.monthKey,
      value: point.value,
      kinds: [kind],
    });
  };

  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  upsertMarker(startPoint, 0, 'start');
  upsertMarker(endPoint, points.length - 1, 'end');

  let maxIndex = 0;
  let minIndex = 0;
  points.forEach((point, index) => {
    if (point.value > points[maxIndex].value) maxIndex = index;
    if (point.value < points[minIndex].value) minIndex = index;
  });
  upsertMarker(points[maxIndex], maxIndex, 'max');
  upsertMarker(points[minIndex], minIndex, 'min');

  return [...markerByPointId.values()].sort((a, b) => a.pointIndex - b.pointIndex);
};

export const buildTrajectoryCurve = (rows: MonthlyReturnRow[]): ReturnCurveModel => {
  const comparableRows = rows.filter((row) => row.pct !== null) as Array<
    MonthlyReturnRow & { pct: number }
  >;
  if (!comparableRows.length) {
    return {
      status: 'insufficient_data',
      points: [],
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  let currentIndex = 100;
  const points: ReturnCurvePoint[] = [
    {
      id: `${previousMonthKey(comparableRows[0].monthKey)}-base`,
      monthKey: previousMonthKey(comparableRows[0].monthKey),
      value: 100,
      synthetic: true,
    },
  ];

  for (const row of comparableRows) {
    currentIndex = currentIndex * (1 + row.pct / 100);
    points.push({
      id: row.monthKey,
      monthKey: row.monthKey,
      value: currentIndex,
    });
  }

  if (points.length < 2) {
    return {
      status: 'insufficient_data',
      points,
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  const values = points.map((point) => point.value);
  const { minValue, maxValue, domainMin, domainMax } = buildCurveDomain(values);
  return {
    status: 'ok',
    points,
    markers: buildMarkerList(points),
    domainMin,
    domainMax,
    minValue,
    maxValue,
  };
};

export const buildPatrimonyCurve = (rows: MonthlyReturnRow[]): ReturnCurveModel => {
  const points: ReturnCurvePoint[] = rows
    .filter((row) => row.netDisplay !== null)
    .map((row) => ({
      id: row.monthKey,
      monthKey: row.monthKey,
      value: Number(row.netDisplay),
    }));

  if (points.length < 2) {
    return {
      status: 'insufficient_data',
      points,
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  const values = points.map((point) => point.value);
  const { minValue, maxValue, domainMin, domainMax } = buildCurveDomain(values);
  return {
    status: 'ok',
    points,
    markers: buildMarkerList(points),
    domainMin,
    domainMax,
    minValue,
    maxValue,
  };
};

export const buildWealthEvolutionComparisonModel = (
  closures: WealthMonthlyClosure[],
  includeRiskCapitalInTotals: boolean,
): WealthEvolutionComparisonModel => {
  const sorted = [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const calendarCurrent = currentOperationalMonthKey(closures);
  const filtered = sorted.filter((closure) => closure.monthKey !== calendarCurrent);

  const points: WealthEvolutionPoint[] = filtered.map((closure) => {
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const fxResolution = resolveFxForAnalysis(closure);
    const fx = fxResolution.fx;
    const hasAuditableFx = fxResolution.auditable;
    const validNetClp = invalidNet ? null : Number(netClp);
    return {
      id: closure.id || closure.monthKey,
      monthKey: closure.monthKey,
      netClp: validNetClp,
      netUf:
        validNetClp !== null && hasAuditableFx && fx.ufClp > 0
          ? validNetClp / fx.ufClp
          : null,
      netUsd:
        validNetClp !== null && hasAuditableFx && fx.usdClp > 0
          ? validNetClp / fx.usdClp
          : null,
      netEur:
        validNetClp !== null && hasAuditableFx && fx.eurClp > 0
          ? validNetClp / fx.eurClp
          : null,
      ufClp: hasAuditableFx && fx.ufClp > 0 ? fx.ufClp : null,
      fxAuditable: hasAuditableFx,
    };
  });

  const missingFxMonths = points
    .filter((point) => point.netClp !== null && (!point.fxAuditable || point.netUsd === null || point.netEur === null))
    .map((point) => point.monthKey);
  const missingUfMonths = points
    .filter((point) => point.netClp !== null && point.netUf === null)
    .map((point) => point.monthKey);
  const suspiciousUfMonths = listSuspiciousHistoricalUfClosures(filtered).map((item) => ({
    monthKey: item.monthKey,
    ufClp: item.storedUfClp,
    prevUfClp: item.previousUfClp ?? item.storedUfClp,
    changePct: item.changePct ?? 0,
  }));

  return {
    source: 'returns_analysis_closures',
    baseMonth: points.find((point) => point.netClp !== null)?.monthKey || null,
    missingFxMonths,
    missingUfMonths,
    suspiciousUfMonths,
    hasIncompleteConversion: missingFxMonths.length > 0 || missingUfMonths.length > 0,
    points,
    clpSeries: buildCurveFromWealthPoints(points, (point) => point.netClp),
    ufSeries: buildCurveFromWealthPoints(points, (point) => point.netUf),
    usdSeries: buildCurveFromWealthPoints(points, (point) => point.netUsd),
    eurSeries: buildCurveFromWealthPoints(points, (point) => point.netEur),
    ufTrendSeries: buildLinearTrendCurve(points, (point) => point.netUf),
    base100Series: {
      CLP: buildBase100CurveFromWealthPoints(points, (point) => point.netClp),
      UF: buildBase100CurveFromWealthPoints(points, (point) => point.netUf),
      USD: buildBase100CurveFromWealthPoints(points, (point) => point.netUsd),
      EUR: buildBase100CurveFromWealthPoints(points, (point) => point.netEur),
    },
  };
};
