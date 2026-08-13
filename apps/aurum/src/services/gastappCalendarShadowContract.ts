export const GASTAPP_CALENDAR_SOURCE_CONTRACT = 'gastapp_aurum_calendar_source_v1' as const;
export const GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION = 'gastapp-aurum-calendar-source-v1' as const;
export const GASTAPP_CALENDAR_SOURCE_METHODOLOGY_VERSION = 'gastapp-calendar-expense-normalization-v1' as const;

export const GASTAPP_CALENDAR_SHADOW_SUMMABLE_SOURCE_TYPES = [
  'monthly_expense',
  'project_expense',
  'legacy_csv',
] as const;

export type GastappCalendarShadowSummableSourceType =
  (typeof GASTAPP_CALENDAR_SHADOW_SUMMABLE_SOURCE_TYPES)[number];

export type GastappCanonicalExpense = {
  canonicalRowId: string;
  calendarMonthKey: string | null;
  periodKeyOriginal: string | null;
  periodNumberOriginal: number | null;
  sourceType: string;
  sourceDocumentId: string;
  transactionDate: string | null;
  accountingDate: string | null;
  category: string | null;
  description: string | null;
  projectId: string | null;
  amountOriginal: number | null;
  currencyOriginal: string | null;
  exchangeRateUsed: number | null;
  amountNormalized: number | null;
  normalizationStatus: string;
  originalState: string;
  parentState: string | null;
  periodAssignmentReason: string | null;
  includedInCanonicalTotals: boolean;
  warnings: readonly string[];
  sourceUpdatedAt?: string | null;
};

export type GastappCalendarMonthCoverageStatus = 'complete' | 'partial_edge_month';

export type GastappCalendarMonthCoverage = {
  rowCount: number;
  includedRowCount: number;
  amountNormalized: number;
  status: GastappCalendarMonthCoverageStatus;
};

export type GastappCalendarShadowReadiness = 'ready' | 'warning' | 'blocked';
export type GastappCalendarShadowSourceKind = 'fixture' | 'stable';

export type GastappCalendarShadowManifest = {
  schemaVersion: typeof GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION;
  sourceKind: GastappCalendarShadowSourceKind;
  sourceCommit: string;
  generatedAt: string;
  readinessStatus: GastappCalendarShadowReadiness;
  firstMonthKey: string | null;
  lastMonthKey: string | null;
  totalRowCount: number;
  uniqueIdentityCount: number;
  duplicateIdentityCount: number;
  totalsByCalendarMonth: Readonly<Record<string, number>>;
  comparableMonthKeys: readonly string[];
  partialEdgeMonthKeys: readonly string[];
  sourceHash?: string | null;
  methodologyVersion?: string | null;
  closingDay?: number | null;
  latestClosedMonthKey?: string | null;
  coverageByMonth?: Readonly<Record<string, GastappCalendarMonthCoverage>>;
};

export type GastappCalendarShadowSnapshot = {
  manifest: GastappCalendarShadowManifest;
  rows: readonly GastappCanonicalExpense[];
};

export type GastappCalendarShadowValidationResult = {
  status: GastappCalendarShadowReadiness;
  errors: readonly string[];
  warnings: readonly string[];
  totalsByCalendarMonth: Readonly<Record<string, number>>;
  uniqueIdentityCount: number;
  duplicateIdentityCount: number;
};

export type GastappCalendarShadowBuildMetadata = {
  sourceKind: GastappCalendarShadowSourceKind;
  sourceCommit: string;
  generatedAt: string;
};

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIOD_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}__\d{4}-\d{2}-\d{2}$/;

const isSummableSourceType = (sourceType: string): sourceType is GastappCalendarShadowSummableSourceType =>
  (GASTAPP_CALENDAR_SHADOW_SUMMABLE_SOURCE_TYPES as readonly string[]).includes(sourceType);

const expenseIdentity = (row: GastappCanonicalExpense) => row.canonicalRowId;

const sortMonthKeys = (monthKeys: Iterable<string>) => [...monthKeys].sort((left, right) => left.localeCompare(right));

export const validateGastappCalendarShadowRows = (
  rows: readonly GastappCanonicalExpense[],
): GastappCalendarShadowValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const identities = new Set<string>();
  const duplicateIdentities = new Set<string>();
  const totals = new Map<string, number>();

  rows.forEach((row, index) => {
    const position = `row[${index}]`;
    const identity = String(expenseIdentity(row) || '');
    const expectedIdentity = `${String(row.sourceType || '')}:${String(row.sourceDocumentId || '')}`;

    const isDuplicateIdentity = identities.has(identity);
    if (isDuplicateIdentity) {
      duplicateIdentities.add(identity);
      errors.push(`${position}: duplicate canonical identity ${identity}`);
    } else {
      identities.add(identity);
    }

    if (!identity.trim()) errors.push(`${position}: canonicalRowId is required`);
    if (identity !== expectedIdentity) errors.push(`${position}: canonicalRowId must equal ${expectedIdentity}`);
    if (!String(row.sourceType || '').trim()) {
      errors.push(`${position}: sourceType is required`);
    }
    if (!String(row.sourceDocumentId || '').trim()) {
      errors.push(`${position}: sourceDocumentId is required`);
    }
    if (!Array.isArray(row.warnings)) errors.push(`${position}: warnings must be an array`);

    if (row.includedInCanonicalTotals && !isSummableSourceType(row.sourceType)) {
      errors.push(`${position}: non-summable source ${row.sourceType} cannot enter canonical totals`);
    }
    if (row.includedInCanonicalTotals) {
      if (!row.calendarMonthKey || !MONTH_KEY_PATTERN.test(row.calendarMonthKey)) {
        errors.push(`${position}: invalid calendarMonthKey ${row.calendarMonthKey}`);
      }
      if (!row.periodKeyOriginal || !PERIOD_KEY_PATTERN.test(row.periodKeyOriginal)) {
        errors.push(`${position}: invalid periodKeyOriginal ${row.periodKeyOriginal}`);
      }
      if (!Number.isInteger(row.periodNumberOriginal) || Number(row.periodNumberOriginal) <= 0) {
        errors.push(`${position}: periodNumberOriginal must be a positive integer`);
      }
      if (!Number.isFinite(row.amountOriginal)) errors.push(`${position}: amountOriginal must be finite`);
      if (!Number.isFinite(row.amountNormalized)) errors.push(`${position}: amountNormalized must be finite`);
      if (!row.currencyOriginal?.trim()) errors.push(`${position}: currencyOriginal is required`);
      if (row.normalizationStatus !== 'ready') errors.push(`${position}: included normalizationStatus must be ready`);
      if (!['expense_date', 'project_date', 'legacy_date'].includes(String(row.periodAssignmentReason))) {
        errors.push(`${position}: invalid periodAssignmentReason ${row.periodAssignmentReason}`);
      }
      if (row.currencyOriginal !== 'EUR' && !(Number(row.exchangeRateUsed) > 0)) {
        errors.push(`${position}: non-EUR included row requires exchangeRateUsed`);
      }
    } else if (!String(row.normalizationStatus || '').startsWith('excluded_')) {
      errors.push(`${position}: excluded row must use an excluded_* normalizationStatus`);
    }

    if (
      row.includedInCanonicalTotals &&
      !isDuplicateIdentity &&
      row.calendarMonthKey !== null &&
      MONTH_KEY_PATTERN.test(row.calendarMonthKey) &&
      Number.isFinite(row.amountNormalized) &&
      isSummableSourceType(row.sourceType)
    ) {
      totals.set(
        row.calendarMonthKey,
        (totals.get(row.calendarMonthKey) || 0) + Number(row.amountNormalized),
      );
    }
  });

  const status: GastappCalendarShadowReadiness = errors.length
    ? 'blocked'
    : warnings.length
      ? 'warning'
      : 'ready';

  return {
    status,
    errors,
    warnings,
    totalsByCalendarMonth: Object.fromEntries(
      sortMonthKeys(totals.keys()).map((monthKey) => [monthKey, totals.get(monthKey) || 0]),
    ),
    uniqueIdentityCount: identities.size,
    duplicateIdentityCount: duplicateIdentities.size,
  };
};

export const buildGastappCalendarShadowSnapshot = (
  rows: readonly GastappCanonicalExpense[],
  metadata: GastappCalendarShadowBuildMetadata,
): GastappCalendarShadowSnapshot => {
  const validation = validateGastappCalendarShadowRows(rows);
  const monthKeys = sortMonthKeys(Object.keys(validation.totalsByCalendarMonth));

  return {
    manifest: {
      schemaVersion: GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION,
      sourceKind: metadata.sourceKind,
      sourceCommit: metadata.sourceCommit,
      generatedAt: metadata.generatedAt,
      readinessStatus: validation.status,
      firstMonthKey: monthKeys[0] || null,
      lastMonthKey: monthKeys.at(-1) || null,
      totalRowCount: rows.length,
      uniqueIdentityCount: validation.uniqueIdentityCount,
      duplicateIdentityCount: validation.duplicateIdentityCount,
      totalsByCalendarMonth: validation.totalsByCalendarMonth,
      comparableMonthKeys: monthKeys,
      partialEdgeMonthKeys: [],
    },
    rows,
  };
};
