export const GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION = 'gastapp-calendar-shadow-v1' as const;

export const GASTAPP_CALENDAR_SHADOW_SUMMABLE_SOURCE_TYPES = [
  'monthly_expenses',
  'project_expenses',
  'legacy_csv',
] as const;

export type GastappCalendarShadowSummableSourceType =
  (typeof GASTAPP_CALENDAR_SHADOW_SUMMABLE_SOURCE_TYPES)[number];

export type GastappCanonicalExpense = {
  calendarMonthKey: string;
  periodKeyOriginal: string | null;
  periodNumberOriginal: number | null;
  sourceType: string;
  sourceDocumentId: string;
  transactionDate: string | null;
  accountingDate: string | null;
  category: string | null;
  description: string | null;
  projectId: string | null;
  amountOriginal: number;
  currencyOriginal: string;
  exchangeRateUsed: number | null;
  amountNormalized: number;
  normalizationStatus: string;
  originalState: string | null;
  parentState: string | null;
  periodAssignmentReason: string | null;
  includedInCanonicalTotals: boolean;
  warnings: readonly string[];
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

const isSummableSourceType = (sourceType: string): sourceType is GastappCalendarShadowSummableSourceType =>
  (GASTAPP_CALENDAR_SHADOW_SUMMABLE_SOURCE_TYPES as readonly string[]).includes(sourceType);

const expenseIdentity = (row: GastappCanonicalExpense) => `${row.sourceType}:${row.sourceDocumentId}`;

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
    const identity = expenseIdentity(row);

    const isDuplicateIdentity = identities.has(identity);
    if (isDuplicateIdentity) {
      duplicateIdentities.add(identity);
      errors.push(`${position}: duplicate canonical identity ${identity}`);
    } else {
      identities.add(identity);
    }

    if (!MONTH_KEY_PATTERN.test(row.calendarMonthKey)) {
      errors.push(`${position}: invalid calendarMonthKey ${row.calendarMonthKey}`);
    }
    if (!row.sourceType.trim()) {
      errors.push(`${position}: sourceType is required`);
    }
    if (!row.sourceDocumentId.trim()) {
      errors.push(`${position}: sourceDocumentId is required`);
    }
    if (!Number.isFinite(row.amountOriginal)) {
      errors.push(`${position}: amountOriginal must be finite`);
    }
    if (!Number.isFinite(row.amountNormalized)) {
      errors.push(`${position}: amountNormalized must be finite`);
    }
    if (!row.currencyOriginal.trim()) {
      warnings.push(`${position}: currencyOriginal is empty`);
    }

    if (row.includedInCanonicalTotals && !isSummableSourceType(row.sourceType)) {
      errors.push(`${position}: non-summable source ${row.sourceType} cannot enter canonical totals`);
    }
    if (row.includedInCanonicalTotals && row.normalizationStatus === 'excluded') {
      errors.push(`${position}: excluded normalizationStatus cannot enter canonical totals`);
    }

    if (
      row.includedInCanonicalTotals &&
      !isDuplicateIdentity &&
      MONTH_KEY_PATTERN.test(row.calendarMonthKey) &&
      Number.isFinite(row.amountNormalized) &&
      isSummableSourceType(row.sourceType)
    ) {
      totals.set(
        row.calendarMonthKey,
        (totals.get(row.calendarMonthKey) || 0) + row.amountNormalized,
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
    },
    rows,
  };
};
