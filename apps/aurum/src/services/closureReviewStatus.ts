import type { WealthMonthlyClosure } from './wealthStorage';

export type ClosureReviewPendingStatus = 'complete' | 'pending' | null | undefined;

export type ClosureReviewPendingReason =
  | 'missing_summary'
  | 'missing_closed_at'
  | 'missing_usable_patrimony'
  | 'missing_fx'
  | 'missing_records'
  | 'review_pending_metadata';

export type ClosureReviewClassification =
  | 'ready'
  | 'critical_pending'
  | 'historical_summary_only'
  | 'administrative_pending'
  | 'mixed';

export interface HistoricalClosureReviewStatus {
  monthKey: string;
  hasClosure: boolean;
  hasSummary: boolean;
  hasClosedAt: boolean;
  hasNetClpOrUsablePatrimony: boolean;
  hasRecords: boolean;
  recordsCount: number;
  hasMissingFx: boolean;
  hasReviewPendingMetadata: boolean;
  reviewPendingStatus: ClosureReviewPendingStatus;
  pendingReasons: ClosureReviewPendingReason[];
  classification: ClosureReviewClassification;
  isCriticalPending: boolean;
  isHistoricalSummaryOnly: boolean;
  isAdministrativePending: boolean;
}

export interface HistoricalClosureReviewBuckets {
  statuses: HistoricalClosureReviewStatus[];
  critical: HistoricalClosureReviewStatus[];
  historicalSummaryOnly: HistoricalClosureReviewStatus[];
  administrative: HistoricalClosureReviewStatus[];
  mixed: HistoricalClosureReviewStatus[];
  actionable: HistoricalClosureReviewStatus[];
}

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const hasMissingCriticalFx = (closure: WealthMonthlyClosure) => {
  if (Array.isArray(closure.fxMissing) && closure.fxMissing.length > 0) return true;
  const fx = closure.fxRates;
  if (!fx) return true;
  return !(Number(fx.usdClp) > 0 && Number(fx.eurClp) > 0 && Number(fx.ufClp) > 0);
};

const hasUsablePatrimony = (closure: WealthMonthlyClosure) => {
  const summary = closure.summary;
  if (!summary || typeof summary !== 'object') return false;
  const candidates = [
    summary.netClp,
    summary.netClpWithRisk,
    summary.netConsolidatedClp,
  ];
  return candidates.some((value) => Number.isFinite(Number(value)));
};

export const classifyHistoricalClosureReviewStatus = (
  closure: WealthMonthlyClosure,
  reviewPendingStatus?: ClosureReviewPendingStatus,
): HistoricalClosureReviewStatus => {
  const hasClosure = Boolean(closure);
  const hasSummary = Boolean(closure?.summary && typeof closure.summary === 'object');
  const hasClosedAt = Boolean(String(closure?.closedAt || '').trim());
  const hasNetClpOrUsablePatrimony = hasUsablePatrimony(closure);
  const recordsCount = Array.isArray(closure?.records) ? closure.records.length : 0;
  const hasRecords = recordsCount > 0;
  const hasMissingFx = hasMissingCriticalFx(closure);
  const hasReviewPendingMetadata = reviewPendingStatus === 'pending';

  const pendingReasons: ClosureReviewPendingReason[] = [];
  if (!hasSummary) pendingReasons.push('missing_summary');
  if (!hasClosedAt) pendingReasons.push('missing_closed_at');
  if (!hasNetClpOrUsablePatrimony) pendingReasons.push('missing_usable_patrimony');
  if (hasMissingFx) pendingReasons.push('missing_fx');
  if (!hasRecords) pendingReasons.push('missing_records');
  if (hasReviewPendingMetadata) pendingReasons.push('review_pending_metadata');

  const isCriticalPending =
    !hasSummary ||
    !hasClosedAt ||
    !hasNetClpOrUsablePatrimony ||
    hasMissingFx;
  const isHistoricalSummaryOnly =
    hasSummary &&
    hasClosedAt &&
    hasNetClpOrUsablePatrimony &&
    !hasRecords &&
    !hasMissingFx;
  const isAdministrativePending =
    hasReviewPendingMetadata &&
    !isCriticalPending &&
    !isHistoricalSummaryOnly;

  const activeFlags = [
    isCriticalPending,
    isHistoricalSummaryOnly,
    isAdministrativePending,
  ].filter(Boolean).length;

  const classification: ClosureReviewClassification =
    activeFlags > 1
      ? 'mixed'
      : isCriticalPending
        ? 'critical_pending'
        : isHistoricalSummaryOnly
          ? 'historical_summary_only'
          : isAdministrativePending
            ? 'administrative_pending'
            : 'ready';

  return {
    monthKey: closure.monthKey,
    hasClosure,
    hasSummary,
    hasClosedAt,
    hasNetClpOrUsablePatrimony,
    hasRecords,
    recordsCount,
    hasMissingFx,
    hasReviewPendingMetadata,
    reviewPendingStatus,
    pendingReasons,
    classification,
    isCriticalPending,
    isHistoricalSummaryOnly,
    isAdministrativePending,
  };
};

export const buildHistoricalClosureReviewBuckets = (
  closures: WealthMonthlyClosure[],
  reviewPendingStatusesByMonthKey: Record<string, ClosureReviewPendingStatus> = {},
): HistoricalClosureReviewBuckets => {
  const statuses = [...closures]
    .map((closure) =>
      classifyHistoricalClosureReviewStatus(
        closure,
        reviewPendingStatusesByMonthKey[closure.monthKey] ?? null,
      ),
    )
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  return {
    statuses,
    critical: statuses.filter((status) => status.isCriticalPending),
    historicalSummaryOnly: statuses.filter(
      (status) => status.isHistoricalSummaryOnly && !status.isCriticalPending,
    ),
    administrative: statuses.filter(
      (status) =>
        status.isAdministrativePending &&
        !status.isCriticalPending &&
        !status.isHistoricalSummaryOnly,
    ),
    mixed: statuses.filter((status) => status.classification === 'mixed'),
    actionable: statuses.filter((status) => status.classification !== 'ready'),
  };
};

export const describeHistoricalClosureReviewStatus = (
  closureCount: number,
  buckets: HistoricalClosureReviewBuckets,
) => {
  if (!closureCount) return { icon: '❌', tone: 'error' as const, text: 'Sin cierres guardados' };
  if (buckets.critical.length > 0) {
    return {
      icon: '⚠️',
      tone: 'warn' as const,
      text: `Hay ${buckets.critical.length} cierre(s) con pendiente(s) crítica(s)`,
    };
  }
  return {
    icon: '✅',
    tone: 'ok' as const,
    text: 'Sin pendientes críticos',
  };
};

export const isClosureReviewCompletionCandidate = (
  status: HistoricalClosureReviewStatus,
) => !status.isCriticalPending;

export const groupClosureMonthKeysByYear = (monthKeys: string[]) => {
  const byYear = new Map<string, number[]>();
  monthKeys
    .filter((monthKey) => /^\d{4}-\d{2}$/.test(monthKey))
    .sort()
    .forEach((monthKey) => {
      const [year, monthRaw] = monthKey.split('-');
      const month = Number(monthRaw);
      if (!Number.isFinite(month) || month < 1 || month > 12) return;
      const current = byYear.get(year) || [];
      current.push(month);
      byYear.set(year, current);
    });

  return Array.from(byYear.entries()).map(([year, months]) => {
    const uniqueMonths = Array.from(new Set(months)).sort((a, b) => a - b);
    const first = uniqueMonths[0];
    const last = uniqueMonths[uniqueMonths.length - 1];
    const label =
      first === last
        ? `${MONTH_NAMES_ES[first - 1]}`
        : `${MONTH_NAMES_ES[first - 1]}–${MONTH_NAMES_ES[last - 1]}`;
    return `${year}: ${label}`;
  });
};
