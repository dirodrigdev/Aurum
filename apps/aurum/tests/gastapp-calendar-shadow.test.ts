import { describe, expect, it, vi } from 'vitest';

import { createGastappCalendarShadowFixture } from '../src/data/gastappCalendarShadowFixture';
import {
  buildGastappCalendarShadowSnapshot,
  type GastappCanonicalExpense,
  validateGastappCalendarShadowRows,
} from '../src/services/gastappCalendarShadowContract';
import {
  aggregateGastappCalendarShadowRows,
  computeGastappCalendarShadowRows,
  getGastappCalendarShadowActivationStatus,
  isGastappCalendarShadowEnabled,
} from '../src/services/gastappCalendarShadow';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';
import {
  authenticateGastappCalendarSourceV1,
  calculateGastappCalendarSourceHash,
  GastappCalendarSourceError,
  loadGastappCalendarSourceV1,
  validateGastappCalendarSourceV1,
  type GastappCalendarSourceDependencies,
} from '../src/services/gastappCalendarSourceV1';

const makeClosure = (monthKey: string, netClp: number): WealthMonthlyClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59-03:00`,
  summary: {
    netByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: netClp,
    byBlock: {
      bank: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    },
    netClp,
    netClpWithRisk: netClp,
  },
  fxRates: { usdClp: 900, eurClp: 1000, ufClp: 40000 },
});

const productRow = ({
  sourceType,
  sourceDocumentId,
  calendarMonthKey,
  transactionDate,
  periodKeyOriginal,
  periodNumberOriginal,
  amountNormalized,
  periodAssignmentReason = 'expense_date',
}: {
  sourceType: 'monthly_expense' | 'project_expense' | 'legacy_csv';
  sourceDocumentId: string;
  calendarMonthKey: string;
  transactionDate: string;
  periodKeyOriginal: string;
  periodNumberOriginal: number;
  amountNormalized: number;
  periodAssignmentReason?: 'expense_date' | 'project_date' | 'legacy_date';
}): GastappCanonicalExpense => ({
  canonicalRowId: `${sourceType}:${sourceDocumentId}`,
  calendarMonthKey,
  periodKeyOriginal,
  periodNumberOriginal,
  sourceType,
  sourceDocumentId,
  transactionDate,
  accountingDate: transactionDate,
  category: 'fixture',
  description: 'Contrato productivo',
  projectId: sourceType === 'project_expense' ? 'project-1' : null,
  amountOriginal: amountNormalized,
  currencyOriginal: 'EUR',
  exchangeRateUsed: sourceType === 'legacy_csv' ? 1 : null,
  amountNormalized,
  normalizationStatus: 'ready',
  originalState: 'activo',
  parentState: sourceType === 'project_expense' ? 'activo' : null,
  periodAssignmentReason,
  includedInCanonicalTotals: true,
  warnings: [],
  sourceUpdatedAt: '2026-08-13T14:00:00.000Z',
});

const buildPublishedSource = () => {
  const rows: GastappCanonicalExpense[] = [
    productRow({
      sourceType: 'monthly_expense', sourceDocumentId: 'nov', calendarMonthKey: '2025-11',
      transactionDate: '2025-11-12', periodKeyOriginal: '2025-11-12__2025-12-11',
      periodNumberOriginal: 31, amountNormalized: 10,
    }),
    productRow({
      sourceType: 'monthly_expense', sourceDocumentId: 'dec', calendarMonthKey: '2025-12',
      transactionDate: '2025-12-15', periodKeyOriginal: '2025-12-12__2026-01-11',
      periodNumberOriginal: 32, amountNormalized: 20,
    }),
    productRow({
      sourceType: 'project_expense', sourceDocumentId: 'jul', calendarMonthKey: '2026-07',
      transactionDate: '2026-07-15', periodKeyOriginal: '2026-07-12__2026-08-11',
      periodNumberOriginal: 39, amountNormalized: 30, periodAssignmentReason: 'project_date',
    }),
    productRow({
      sourceType: 'legacy_csv', sourceDocumentId: 'aug', calendarMonthKey: '2026-08',
      transactionDate: '2026-08-11', periodKeyOriginal: '2026-07-12__2026-08-11',
      periodNumberOriginal: 39, amountNormalized: 40, periodAssignmentReason: 'legacy_date',
    }),
  ];
  const coverageByMonth = {
    '2025-11': { rowCount: 1, includedRowCount: 1, amountNormalized: 10 },
    '2025-12': { rowCount: 1, includedRowCount: 1, amountNormalized: 20 },
    '2026-07': { rowCount: 1, includedRowCount: 1, amountNormalized: 30 },
    '2026-08': { rowCount: 1, includedRowCount: 1, amountNormalized: 40 },
  };
  const coverageByOriginalPeriod = {
    '2025-11-12__2025-12-11': { rowCount: 1, includedRowCount: 1, amountNormalized: 10 },
    '2025-12-12__2026-01-11': { rowCount: 1, includedRowCount: 1, amountNormalized: 20 },
    '2026-07-12__2026-08-11': { rowCount: 2, includedRowCount: 2, amountNormalized: 70 },
  };
  const manifest: Record<string, any> = {
    contract: 'gastapp_aurum_calendar_source_v1',
    schemaVersion: 'gastapp-aurum-calendar-source-v1',
    methodologyVersion: 'gastapp-calendar-expense-normalization-v1',
    sourceCommit: '48b655d2274028b72d430ce95b2e30b440f5ab01',
    generatedAt: '2026-08-13T14:15:36.402Z',
    publicationState: 'complete',
    snapshotId: 'pending',
    snapshotPath: 'pending',
    currentPath: 'gastapp_calendar_source_v1_private/source_v1_current',
    closingConfig: { type: 'fixed_day', closingDay: 11, source: 'meta/closing_config' },
    coveredRange: {
      fromCalendarMonthKey: '2025-11', toCalendarMonthKey: '2026-08',
      fromTransactionDate: '2025-11-12', toTransactionDate: '2026-08-11',
      fromPeriodKey: '2025-11-12__2025-12-11', toPeriodKey: '2026-07-12__2026-08-11',
    },
    latestClosedMonthKey: '2026-07',
    counts: {
      totalRows: 4, includedRows: 4, canonicalIdentities: 4, duplicateIdentities: 0,
      warnings: 1, rowsWithMissingFx: 0, byNormalizationStatus: { ready: 4 },
    },
    duplicates: [],
    warnings: ['accepted_control_residual:0.01'],
    coverageByMonth,
    coverageByOriginalPeriod,
    reconciliation: {
      status: 'accepted_control_residual', reconciliationStatus: 'accepted_control_residual',
      controlSource: 'aurum_monthly_from_periods_v1', expectedTotalAmountNormalized: 99.99,
      actualTotalAmountNormalized: 100, difference: 0.01, controlTotalEur: 99.99,
      canonicalTotalEur: 100, residualEur: 0.01,
      residualByPeriod: {
        '2025-11-12__2025-12-11': 0,
        '2025-12-12__2026-01-11': 0.01,
        '2026-07-12__2026-08-11': 0,
      },
      warnings: ['accepted_control_residual:0.01', 'period_residual:32:0.01'],
      rows: [
        { periodKey: '2025-11-12__2025-12-11', periodNumber: 31, monthKey: '2025-11', expectedAmountNormalized: 10, actualAmountNormalized: 10, difference: 0, status: 'matched' },
        { periodKey: '2025-12-12__2026-01-11', periodNumber: 32, monthKey: '2025-12', expectedAmountNormalized: 19.99, actualAmountNormalized: 20, difference: 0.01, status: 'mismatch' },
        { periodKey: '2026-07-12__2026-08-11', periodNumber: 39, monthKey: '2026-07', expectedAmountNormalized: 70, actualAmountNormalized: 70, difference: 0, status: 'matched' },
      ],
    },
  };
  const snapshot = { ...manifest, rows };
  const hash = calculateGastappCalendarSourceHash(snapshot);
  const snapshotId = `source_v1_snapshot_${hash.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  Object.assign(snapshot, {
    hash,
    snapshotId,
    snapshotPath: `gastapp_calendar_source_v1_private/${snapshotId}`,
  });
  const { rows: _rows, ...current } = snapshot;
  return { current, snapshot };
};

const rehashPublishedSource = (snapshot: Record<string, any>) => {
  const hash = calculateGastappCalendarSourceHash(snapshot);
  const snapshotId = `source_v1_snapshot_${hash.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  Object.assign(snapshot, { hash, snapshotId, snapshotPath: `gastapp_calendar_source_v1_private/${snapshotId}` });
  const { rows: _rows, ...current } = snapshot;
  return { current, snapshot };
};

const makeDependencies = (overrides: Partial<GastappCalendarSourceDependencies> = {}) => {
  const source = buildPublishedSource();
  const readDocument = vi.fn(async (path: string) => {
    if (path.startsWith('authorized_users/')) return { active: true, role: 'user' };
    if (path === 'gastapp_calendar_source_v1_private/source_v1_current') return source.current;
    if (path === source.current.snapshotPath) return source.snapshot;
    return null;
  });
  const dependencies: GastappCalendarSourceDependencies = {
    configuredProjectId: () => 'duofin-c1894',
    primaryUser: () => ({ email: 'owner@example.com' }),
    secondaryUser: vi.fn(async () => ({ email: 'owner@example.com' })),
    signInSecondary: vi.fn(async () => ({ email: 'owner@example.com' })),
    ensureSecondaryPersistence: vi.fn(async () => undefined),
    readDocument,
    ...overrides,
  };
  return { dependencies, source, readDocument };
};

const expectSourceError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GastappCalendarSourceError);
    expect((error as GastappCalendarSourceError).code).toBe(code);
  }
};

describe('GastApp calendar shadow contract', () => {
  it('builds deterministic monthly totals without using periodKeyOriginal as a second grouping key', () => {
    const snapshot = createGastappCalendarShadowFixture();

    expect(snapshot.manifest.readinessStatus).toBe('ready');
    expect(snapshot.manifest.uniqueIdentityCount).toBe(3);
    expect(snapshot.manifest.totalsByCalendarMonth).toEqual({
      '2026-01': 125,
      '2026-02': 70,
    });
  });

  it('blocks duplicate identities and non-summable sources entering canonical totals', () => {
    const row = createGastappCalendarShadowFixture().rows[0];
    const invalidRows: GastappCanonicalExpense[] = [
      row,
      row,
      { ...row, sourceType: 'monthly_reports', sourceDocumentId: 'monthly-report-1' },
    ];

    const result = validateGastappCalendarShadowRows(invalidRows);

    expect(result.status).toBe('blocked');
    expect(result.duplicateIdentityCount).toBe(1);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate canonical identity'),
      expect.stringContaining('non-summable source monthly_reports'),
    ]));
    expect(result.totalsByCalendarMonth).toEqual({ '2026-01': 100 });
  });

  it('calculates shadow return from calendar spend while keeping the patrimonial chain separate', () => {
    const snapshot = buildGastappCalendarShadowSnapshot([
      { ...createGastappCalendarShadowFixture().rows[0], calendarMonthKey: '2026-01', amountNormalized: 100 },
      { ...createGastappCalendarShadowFixture().rows[2], calendarMonthKey: '2026-02', amountNormalized: 70 },
    ], {
      sourceKind: 'fixture',
      sourceCommit: 'test',
      generatedAt: '2026-08-12T00:00:00.000Z',
    });
    const rows = computeGastappCalendarShadowRows({
      closures: [
        makeClosure('2026-01', 1_000_000),
        makeClosure('2026-02', 1_050_000),
      ],
      snapshot,
      currency: 'CLP',
      includeRiskCapitalInTotals: false,
    });

    expect(rows[0]).toMatchObject({
      universe: 'shadow-calendar',
      gastosEur: 100,
      varPatrimonioClp: null,
      retornoRealClp: null,
    });
    expect(rows[1]).toMatchObject({
      monthKey: '2026-02',
      prevNetClp: 1_000_000,
      varPatrimonioClp: 50_000,
      gastosClp: 70_000,
      retornoRealClp: 120_000,
      pct: 12,
    });

    const summary = aggregateGastappCalendarShadowRows(rows, ['2026-02']);
    expect(summary).toMatchObject({
      universe: 'shadow-calendar',
      validMonths: 1,
      expectedMonths: 1,
      spendEur: 70,
      retornoRealClp: 120_000,
      coverage: 'complete',
    });
  });

  it('keeps shadow activation disabled by default', () => {
    const snapshot = createGastappCalendarShadowFixture();

    expect(isGastappCalendarShadowEnabled()).toBe(false);
    expect(getGastappCalendarShadowActivationStatus(snapshot)).toBe('disabled');
  });

  it('blocks fixture activation even when the feature flag is enabled', () => {
    vi.stubEnv('VITE_AURUM_GASTAPP_CALENDAR_SHADOW', 'true');

    expect(isGastappCalendarShadowEnabled()).toBe(true);
    expect(getGastappCalendarShadowActivationStatus(createGastappCalendarShadowFixture())).toBe('blocked');

    vi.unstubAllEnvs();
  });

  it('uses the exact productive source types and ready status', () => {
    const rows = createGastappCalendarShadowFixture().rows;
    expect(rows.map((row) => row.sourceType)).toEqual(['monthly_expense', 'project_expense', 'legacy_csv']);
    expect(rows.every((row) => row.normalizationStatus === 'ready')).toBe(true);
  });
});

describe('GastApp calendar source v1 authentication and loader', () => {
  it('performs explicit secondary authentication, persists it and verifies the authorized user', async () => {
    const secondaryUser = vi.fn(async () => null);
    const signInSecondary = vi.fn(async () => ({ email: 'owner@example.com' }));
    const ensureSecondaryPersistence = vi.fn(async () => undefined);
    const { dependencies, readDocument } = makeDependencies({ secondaryUser, signInSecondary, ensureSecondaryPersistence });

    await expect(authenticateGastappCalendarSourceV1(dependencies)).resolves.toEqual({ email: 'owner@example.com' });
    expect(ensureSecondaryPersistence).toHaveBeenCalledOnce();
    expect(signInSecondary).toHaveBeenCalledOnce();
    expect(readDocument).toHaveBeenCalledWith('authorized_users/owner@example.com');
  });

  it('rejects inactive users and different primary/secondary emails', async () => {
    const inactive = makeDependencies({
      readDocument: vi.fn(async () => ({ active: false, role: 'user' })),
    });
    await expectSourceError(authenticateGastappCalendarSourceV1(inactive.dependencies), 'inactive_user');

    const mismatch = makeDependencies({
      secondaryUser: vi.fn(async () => ({ email: 'other@example.com' })),
    });
    await expectSourceError(authenticateGastappCalendarSourceV1(mismatch.dependencies), 'email_mismatch');
  });

  it('reports permission-denied concretely', async () => {
    const denied = makeDependencies({
      readDocument: vi.fn(async () => { throw { code: 'permission-denied' }; }),
    });
    await expectSourceError(authenticateGastappCalendarSourceV1(denied.dependencies), 'permission_denied');
  });

  it('reads current, follows snapshotPath and validates the accepted €0.01 residual', async () => {
    const { dependencies, readDocument, source } = makeDependencies();
    const result = await loadGastappCalendarSourceV1(dependencies);

    expect(readDocument.mock.calls.map(([path]) => path)).toEqual([
      'authorized_users/owner@example.com',
      'gastapp_calendar_source_v1_private/source_v1_current',
      source.current.snapshotPath,
    ]);
    expect(result.sourceManifest.reconciliation.reconciliationStatus).toBe('accepted_control_residual');
    expect(result.sourceManifest.reconciliation.residualEur).toBe(0.01);
    expect(result.snapshot.manifest.sourceKind).toBe('stable');
  });

  it('recalculates the hash and rejects modified content', () => {
    const source = buildPublishedSource();
    expect(calculateGastappCalendarSourceHash(source.snapshot)).toBe(source.snapshot.hash);
    source.snapshot.rows[0].amountNormalized = 999;
    expect(() => validateGastappCalendarSourceV1(source.current, source.snapshot)).toThrowError(
      expect.objectContaining({ code: 'snapshot_hash_invalid' }),
    );
  });

  it('rejects incompatible source names, duplicate identities and invalid included rows', () => {
    const incompatible = buildPublishedSource();
    incompatible.snapshot.rows[0].sourceType = 'monthly_expenses';
    const incompatibleRehashed = rehashPublishedSource(incompatible.snapshot);
    expect(() => validateGastappCalendarSourceV1(incompatibleRehashed.current, incompatibleRehashed.snapshot)).toThrowError(
      expect.objectContaining({ code: 'snapshot_rows_invalid' }),
    );

    const duplicate = buildPublishedSource();
    duplicate.snapshot.rows[1] = { ...duplicate.snapshot.rows[0] };
    const duplicateRehashed = rehashPublishedSource(duplicate.snapshot);
    expect(() => validateGastappCalendarSourceV1(duplicateRehashed.current, duplicateRehashed.snapshot)).toThrowError(
      expect.objectContaining({ code: 'snapshot_rows_invalid' }),
    );

    const invalid = buildPublishedSource();
    invalid.snapshot.rows[0].calendarMonthKey = '2025-13';
    const invalidRehashed = rehashPublishedSource(invalid.snapshot);
    expect(() => validateGastappCalendarSourceV1(invalidRehashed.current, invalidRehashed.snapshot)).toThrowError(
      expect.objectContaining({ code: 'snapshot_rows_invalid' }),
    );
  });

  it('marks initial and final calendar edges partial and excludes them from comparable months', () => {
    const source = buildPublishedSource();
    const result = validateGastappCalendarSourceV1(source.current, source.snapshot);

    expect(result.partialEdgeMonthKeys).toEqual(['2025-11', '2026-08']);
    expect(result.coverageByMonth['2025-11'].status).toBe('partial_edge_month');
    expect(result.coverageByMonth['2026-08'].status).toBe('partial_edge_month');
    expect(result.comparableMonthKeys).toEqual(['2025-12', '2026-07']);
  });

  it('does not authenticate or fall back silently when the secondary session is absent', async () => {
    const signInSecondary = vi.fn(async () => ({ email: 'owner@example.com' }));
    const readDocument = vi.fn(async () => null);
    const { dependencies } = makeDependencies({
      secondaryUser: vi.fn(async () => null),
      signInSecondary,
      readDocument,
    });

    await expectSourceError(loadGastappCalendarSourceV1(dependencies), 'secondary_auth_required');
    expect(signInSecondary).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
  });
});
