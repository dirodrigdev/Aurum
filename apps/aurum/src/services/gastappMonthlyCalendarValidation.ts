import { collection, getDocs } from 'firebase/firestore';

import type { WealthCurrency, WealthMonthlyClosure } from './wealthStorage';
import type { AggregatedSummary, MonthlyReturnRow } from '../components/analysis/types';
import {
  aggregateRows,
  buildTrailingSummary,
  convertFromClp,
  enumerateMonthKeys,
  monthYear,
} from './returnsAnalysis';
import { getGastappFirestore, isGastappFirestoreConfigured } from './firebase';

const OLD_COLLECTION = 'aurum_monthly_from_periods_v1';
const CALENDAR_COLLECTION = 'aurum_monthly_calendar_v2';

export type MonthlyContract = {
  monthKey: string;
  status: string | null;
  totalEur: number | null;
  publishedAt: string | null;
};

export type GastappMonthlyValidationRow = {
  monthKey: string;
  oldSpendEur: number;
  calendarSpendEur: number;
  oldReturnDisplay: number;
  calendarReturnDisplay: number;
  oldPct: number;
  calendarPct: number;
};

export type GastappMonthlyValidationResult = {
  status: 'ok' | 'missing_config' | 'unavailable' | 'error';
  error: string | null;
  rows: GastappMonthlyValidationRow[];
};

const readNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const readMonthKey = (value: unknown, fallback: string) => /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : fallback;
const round2 = (value: number) => Number(value.toFixed(2));

type FxLike = { eurClp?: number; usdClp?: number; ufClp?: number };

const toDisplay = (valueClp: number, currency: WealthCurrency, fx: FxLike) => {
  if (currency === 'CLP') return valueClp;
  const rate = currency === 'EUR' ? Number(fx.eurClp) : currency === 'USD' ? Number(fx.usdClp) : Number(fx.ufClp);
  return rate > 0 ? valueClp / rate : null;
};

const netClp = (closure: WealthMonthlyClosure, includeRisk: boolean) => {
  const value = includeRisk ? closure.summary?.netClpWithRisk : closure.summary?.netClp ?? closure.summary?.netConsolidatedClp;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

const normalizeContracts = (snapshot: Awaited<ReturnType<typeof getDocs>>) => {
  const contracts = new Map<string, MonthlyContract>();
  snapshot.forEach((entry) => {
    const data = entry.data() as Record<string, unknown>;
    const monthKey = readMonthKey(data.monthKey, entry.id);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    contracts.set(monthKey, {
      monthKey,
      status: typeof data.status === 'string' ? data.status : null,
      totalEur: readNumber(data.total_contable_eur),
      publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
    });
  });
  return contracts;
};

export const replaceMonthlySpendWithCalendarContract = (
  rows: MonthlyReturnRow[],
  contracts: Map<string, MonthlyContract>,
  currency: WealthCurrency,
) => rows.map((row): MonthlyReturnRow => {
  const contract = contracts.get(row.monthKey) || null;
  const complete = contract?.status === 'complete' && contract.totalEur !== null;
  const gastosClp = complete && !row.invalidNet && row.fxAuditable
    ? Number(contract.totalEur) * Number(row.fx.eurClp)
    : null;
  const gastosDisplay = gastosClp === null ? null : convertFromClp(gastosClp, currency, row.fx);
  const retornoRealClp = row.varPatrimonioClp === null || gastosClp === null
    ? null
    : row.varPatrimonioClp + gastosClp;
  const retornoRealDisplay = row.varPatrimonioDisplay === null || gastosDisplay === null
    ? null
    : row.varPatrimonioDisplay + gastosDisplay;
  const pct = retornoRealDisplay === null || row.prevNetDisplay === null || row.prevNetDisplay === 0
    ? null
    : (retornoRealDisplay / row.prevNetDisplay) * 100;
  const pctReal = pct === null || row.inflationMonthlyRate === null || 1 + row.inflationMonthlyRate <= 0
    ? null
    : (((1 + pct / 100) / (1 + row.inflationMonthlyRate)) - 1) * 100;

  return {
    ...row,
    gastosStatus: complete ? 'complete' : contract?.status === 'pending' ? 'pending' : 'missing',
    gastosSource: 'gastapp_firestore',
    gastosContractStatus: complete ? 'complete' : contract?.status === 'pending' ? 'pending' : 'missing',
    gastosDataQuality: complete ? 'ok' : null,
    gastosIsStale: false,
    gastosStaleReason: null,
    gastosDayToDaySource: 'calendar_month',
    gastosContractSource: 'aurum_monthly_calendar_v2',
    gastosSchemaVersion: '1',
    gastosMethodologyVersion: 'calendar-month-v2',
    gastosPeriodKey: row.monthKey,
    gastosPublishedAt: contract?.publishedAt || null,
    gastosUpdatedAt: contract?.publishedAt || null,
    gastosClosedAt: null,
    gastosReportUpdatedAt: null,
    gastosSummaryUpdatedAt: null,
    gastosLastExpenseUpdatedAt: null,
    gastosRevision: null,
    gastosReportTotalEur: complete ? contract.totalEur : null,
    gastosSummaryTotalEur: complete ? contract.totalEur : null,
    gastosDirectExpenseTotalEur: complete ? contract.totalEur : null,
    gastosReportVsDirectDiffEur: complete ? 0 : null,
    gastosSummaryVsDirectDiffEur: complete ? 0 : null,
    gastosReportVsSummaryDiffEur: complete ? 0 : null,
    gastosCategoryGapEur: complete ? 0 : null,
    gastosClp,
    gastosDisplay,
    retornoRealClp,
    retornoRealDisplay,
    pct,
    pctReal,
    isEstimated: false,
    estimateMethod: null,
    estimatedSpendClp: null,
    estimatedFromMonthsCount: null,
    officialAvailableDate: null,
    referencePreviousMonthSpendClp: null,
  };
});

export type CalendarReturnsPresentation = {
  monthlyRowsAsc: MonthlyReturnRow[];
  monthlyRowsDesc: MonthlyReturnRow[];
  periodSummaries: AggregatedSummary[];
  yearlySummaries: AggregatedSummary[];
  heroSinceStart: AggregatedSummary | null;
  heroLast12: AggregatedSummary | null;
  heroYtd2026: AggregatedSummary | null;
  heroLastMonth: AggregatedSummary | null;
  heroLastMonthPctMonthly: number | null;
  heroLastMonthPctMonthlyReal: number | null;
};

export const buildCalendarReturnsPresentation = (inputRows: MonthlyReturnRow[]): CalendarReturnsPresentation => {
  const monthlyRowsAsc = [...inputRows].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const monthlyRowsDesc = [...monthlyRowsAsc].reverse();
  const monthKeysAsc = monthlyRowsAsc.map((row) => row.monthKey);
  const periodSummaries: AggregatedSummary[] = [];
  for (const months of [12, 24, 36]) {
    if (months === 36 && monthKeysAsc.length < 36) continue;
    const summary = buildTrailingSummary(monthlyRowsAsc, months, `period-${months}M`, `${months}M`);
    if (summary) periodSummaries.push(summary);
  }
  if (monthKeysAsc.length) {
    const baseNetDisplay = monthlyRowsAsc.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
    periodSummaries.push(aggregateRows('period-inicio', 'Desde inicio', monthlyRowsAsc, baseNetDisplay, {
      expectedMonthKeys: enumerateMonthKeys(monthKeysAsc[0], monthKeysAsc[monthKeysAsc.length - 1]),
    }));
  }

  const years = Array.from(new Set(monthlyRowsAsc.map((row) => monthYear(row.monthKey)))).sort((a, b) => a - b);
  const latestYear = years.at(-1) ?? null;
  const yearlySummaries = years.map((year) => {
    const rows = monthlyRowsAsc.filter((row) => monthYear(row.monthKey) === year);
    const lastYearMonthKey = year < (latestYear ?? year) ? `${year}-12` : rows.at(-1)?.monthKey ?? `${year}-12`;
    const previousYearBase = monthlyRowsAsc.filter((row) => row.monthKey < `${year}-01` && row.netDisplay !== null);
    return aggregateRows(`year-${year}`, String(year), rows, previousYearBase.at(-1)?.netDisplay ?? null, {
      expectedMonthKeys: enumerateMonthKeys(`${year}-01`, lastYearMonthKey),
    });
  });

  const heroSinceStart = monthlyRowsAsc.length
    ? aggregateRows(
      'hero-inicio',
      'Desde inicio',
      monthlyRowsAsc,
      monthlyRowsAsc.find((row) => row.netDisplay !== null)?.netDisplay ?? null,
      { expectedMonthKeys: enumerateMonthKeys(monthlyRowsAsc[0].monthKey, monthlyRowsAsc.at(-1)!.monthKey) },
    )
    : null;
  const heroLast12 = buildTrailingSummary(monthlyRowsAsc, 12, 'hero-12m', 'Últ. 12M');
  const ytdRows = monthlyRowsAsc.filter((row) => row.monthKey >= '2026-01' && row.monthKey <= '2026-12');
  const ytdBase = monthlyRowsAsc.filter((row) => row.monthKey < '2026-01' && row.netDisplay !== null).at(-1);
  const heroYtd2026 = ytdRows.length
    ? aggregateRows('hero-ytd-2026', 'YTD 2026', ytdRows, ytdBase?.netDisplay ?? null, {
      expectedMonthKeys: enumerateMonthKeys('2026-01', ytdRows.at(-1)!.monthKey),
    })
    : null;
  const lastValidRow = [...monthlyRowsAsc].reverse().find((row) => row.retornoRealDisplay !== null) || null;
  const heroLastMonth = lastValidRow
    ? aggregateRows('hero-ultimo', 'Últ. mes válido', [lastValidRow], lastValidRow.prevNetDisplay, {
      expectedMonthKeys: [lastValidRow.monthKey],
    })
    : null;

  return {
    monthlyRowsAsc,
    monthlyRowsDesc,
    periodSummaries,
    yearlySummaries,
    heroSinceStart,
    heroLast12,
    heroYtd2026,
    heroLastMonth,
    heroLastMonthPctMonthly: lastValidRow?.pct ?? null,
    heroLastMonthPctMonthlyReal: lastValidRow?.pctReal ?? null,
  };
};

export const buildGastappMonthlyValidation = ({
  closures,
  oldContracts,
  calendarContracts,
  currency,
  includeRiskCapital,
}: {
  closures: WealthMonthlyClosure[];
  oldContracts: Map<string, MonthlyContract>;
  calendarContracts: Map<string, MonthlyContract>;
  currency: WealthCurrency;
  includeRiskCapital: boolean;
}) => {
  const rows: GastappMonthlyValidationRow[] = [];
  let previous: WealthMonthlyClosure | null = null;
  for (const closure of [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey))) {
    const currentNet = netClp(closure, includeRiskCapital);
    const previousNet = previous ? netClp(previous, includeRiskCapital) : null;
    const old = oldContracts.get(closure.monthKey);
    const calendar = calendarContracts.get(closure.monthKey);
    const eurClp = Number(closure.fxRates?.eurClp);
    if (
      previousNet !== null && currentNet !== null && eurClp > 0 &&
      old?.status === 'complete' && calendar?.status === 'complete' &&
      old.totalEur !== null && calendar.totalEur !== null
    ) {
      const previousDisplay = toDisplay(previousNet, currency, previous.fxRates || {});
      const currentDisplay = toDisplay(currentNet, currency, closure.fxRates || {});
      if (previousDisplay !== null && currentDisplay !== null && previousDisplay > 0) {
        const oldSpend = toDisplay(old.totalEur * eurClp, currency, closure.fxRates || {});
        const calendarSpend = toDisplay(calendar.totalEur * eurClp, currency, closure.fxRates || {});
        if (oldSpend !== null && calendarSpend !== null) {
          const wealthDelta = currentDisplay - previousDisplay;
          const oldReturnDisplay = wealthDelta + oldSpend;
          const calendarReturnDisplay = wealthDelta + calendarSpend;
          rows.push({
            monthKey: closure.monthKey,
            oldSpendEur: old.totalEur,
            calendarSpendEur: calendar.totalEur,
            oldReturnDisplay: round2(oldReturnDisplay),
            calendarReturnDisplay: round2(calendarReturnDisplay),
            oldPct: (oldReturnDisplay / previousDisplay) * 100,
            calendarPct: (calendarReturnDisplay / previousDisplay) * 100,
          });
        }
      }
    }
    previous = closure;
  }
  return rows;
};

export const loadGastappMonthlyCalendarValidation = async (): Promise<GastappMonthlyValidationResult & { oldContracts?: Map<string, MonthlyContract>; calendarContracts?: Map<string, MonthlyContract> }> => {
  if (!isGastappFirestoreConfigured()) return { status: 'missing_config', error: 'gastapp_firestore_not_configured', rows: [] };
  const db = getGastappFirestore();
  if (!db) return { status: 'unavailable', error: 'gastapp_firestore_unavailable', rows: [] };
  try {
    const [oldSnapshot, calendarSnapshot] = await Promise.all([
      getDocs(collection(db, OLD_COLLECTION)),
      getDocs(collection(db, CALENDAR_COLLECTION)),
    ]);
    return {
      status: 'ok', error: null, rows: [],
      oldContracts: normalizeContracts(oldSnapshot),
      calendarContracts: normalizeContracts(calendarSnapshot),
    };
  } catch (error: any) {
    return { status: 'error', error: String(error?.message || error), rows: [] };
  }
};

export const calculateAnnualizedReturn = (rows: GastappMonthlyValidationRow[], kind: 'old' | 'calendar') => {
  if (!rows.length) return null;
  const factors = rows.map((row) => 1 + (kind === 'old' ? row.oldPct : row.calendarPct) / 100);
  if (factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) return null;
  return (Math.pow(factors.reduce((total, factor) => total * factor, 1), 12 / rows.length) - 1) * 100;
};
