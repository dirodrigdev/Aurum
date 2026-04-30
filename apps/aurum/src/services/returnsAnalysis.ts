import type {
  AggregatedSummary,
  MonthlyReturnRow,
  ReturnCurveMarker,
  ReturnCurveMarkerKind,
  ReturnCurveModel,
  ReturnCurvePoint,
} from '../components/analysis/types';
import { resolveGastappMonthlySpend } from './gastosMonthly';
import type { WealthCurrency, WealthFxRates, WealthMonthlyClosure } from './wealthStorage';

const sumNumbers = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

export const monthYear = (monthKey: string) => Number(monthKey.slice(0, 4));

const DEFAULT_FX_RATES: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
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
  key: 'closed_average' | 'previous_closed';
  label: string;
  spendDisplay: number;
  spendClp: number;
  retornoRealDisplay: number;
  retornoRealClp: number;
  pct: number | null;
  monthsUsed: number;
};

export type PendingReturnEstimate = {
  monthKey: string;
  availabilityLabel: string | null;
  periodRangeLabel: string | null;
  varPatrimonioDisplay: number;
  scenarios: ProvisionalReturnScenario[];
};

export type EstimatedMonthMeta = {
  monthKey: string;
  estimateMethod: 'avg_12m_closed' | 'avg_available_closed';
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

const buildOfficialAvailabilityNotice = (officialRows: MonthlyReturnRow[]) => {
  const sortedDesc = [...officialRows].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const candidate = sortedDesc.find(
    (row) =>
      row.gastosStatus === 'complete' &&
      row.gastosDataQuality === 'ok' &&
      !row.gastosIsStale &&
      row.fxAuditable &&
      row.retornoRealDisplay !== null &&
      row.retornoRealClp !== null &&
      row.gastosDisplay !== null &&
      row.gastosClp !== null &&
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
    });
  }

  return rows;
};

export const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  baseNetDisplay: number | null,
): AggregatedSummary => {
  const validRows = rows.filter(
    (row) =>
      row.fxAuditable &&
      row.gastosStatus === 'complete' &&
      row.varPatrimonioDisplay !== null &&
      row.gastosDisplay !== null &&
      row.retornoRealDisplay !== null,
  ) as Array<
    MonthlyReturnRow & {
      varPatrimonioClp: number;
      gastosClp: number;
      retornoRealClp: number;
      varPatrimonioDisplay: number;
      gastosDisplay: number;
      retornoRealDisplay: number;
    }
  >;

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
  let pctRetornoNote: string | null = null;

  if (validMonths > 0 && retornoRealAcumDisplay !== null && baseNetDisplay !== null && baseNetDisplay > 0) {
    const periodReturn = retornoRealAcumDisplay / baseNetDisplay;
    const growthBase = 1 + periodReturn;
    if (growthBase <= 0) {
      pctRetorno = null;
      pctRetornoNote = 'período negativo';
      console.warn('[Analysis][pct-anual-equiv-negativo]', { key, label, validMonths, periodReturn, baseNetDisplay });
    } else {
      const annualized = (Math.pow(growthBase, 12 / validMonths) - 1) * 100;
      if (annualized > 200 || annualized < -100) {
        pctRetorno = null;
        pctRetornoNote = 'fuera de rango';
        console.warn('[Analysis][pct-anual-equiv-fuera-rango]', {
          key,
          label,
          validMonths,
          annualized,
          periodReturn,
          baseNetDisplay,
          retornoRealAcumDisplay,
        });
      } else {
        pctRetorno = annualized;
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
    validMonths,
    varPatrimonioAcumClp,
    gastosAcumClp,
    retornoRealAcumClp,
    varPatrimonioAcumDisplay,
    gastosAcumDisplay,
    retornoRealAcumDisplay,
    pctRetorno,
    pctRetornoNote,
    spendPct,
    varPatrimonioAvgDisplay,
    gastosAvgDisplay,
    retornoRealAvgDisplay,
  };
};

const validClosedSpendRow = (
  row: MonthlyReturnRow,
): row is MonthlyReturnRow & {
  gastosClp: number;
  gastosDisplay: number;
} =>
  row.fxAuditable &&
  row.gastosStatus === 'complete' &&
  row.gastosClp !== null &&
  row.gastosDisplay !== null &&
  !row.gastosIsStale &&
  row.gastosDataQuality !== 'warning' &&
  row.gastosDataQuality !== 'error' &&
  row.gastosContractStatus !== 'stale' &&
  row.gastosContractStatus !== 'pending' &&
  row.gastosContractStatus !== 'missing';

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
  const averageSample = closedRows.slice(-12);
  const info = buildPendingOfficialReturnInfo(pendingRow);
  const scenarios: ProvisionalReturnScenario[] = [];

  if (averageSample.length >= 2) {
    const avgDisplay = sumNumbers(averageSample.map((row) => row.gastosDisplay)) / averageSample.length;
    const avgClp = sumNumbers(averageSample.map((row) => row.gastosClp)) / averageSample.length;
    const scenario = buildProvisionalScenario({
      key: 'closed_average',
      label:
        averageSample.length >= 12
          ? 'Promedio últimos 12 meses cerrados'
          : `Promedio disponible cerrado (${averageSample.length} meses)`,
      row: pendingRow,
      spendDisplay: avgDisplay,
      spendClp: avgClp,
      monthsUsed: averageSample.length,
    });
    if (scenario) scenarios.push(scenario);
  }

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
  return {
    monthKey: pendingRow.monthKey,
    availabilityLabel: info.availabilityLabel,
    periodRangeLabel: info.periodRangeLabel,
    varPatrimonioDisplay: pendingRow.varPatrimonioDisplay,
    scenarios,
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

  const primaryScenario = pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'closed_average') ?? null;
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

  const estimateMethod: EstimatedMonthMeta['estimateMethod'] =
    primaryScenario.monthsUsed >= 12 ? 'avg_12m_closed' : 'avg_available_closed';
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
  const rows = monthlyRowsAsc.slice(Math.max(0, monthlyRowsAsc.length - count));
  if (!rows.length) return null;

  const firstMonthKey = rows[0]?.monthKey ?? null;
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

  return aggregateRows(key, label, rows, baseNetDisplay);
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
