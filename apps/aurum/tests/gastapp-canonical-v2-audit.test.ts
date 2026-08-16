import { describe, expect, it } from 'vitest';

import { buildGastappCanonicalV2Concordance } from '../src/services/gastappCanonicalV2Audit';

const aggregate = (totalEur: number, rowCount = 1) => ({
  key: 'day_to_day',
  label: 'Día a día',
  rowCount,
  totalEur,
});

const contracts = {
  metadata: {
    pointerVersion: 'gastapp-canonical-pointer-v2',
    packageVersion: 'gastapp-canonical-calendar-offline-v2',
    canonicalDataHash: `sha256:${'a'.repeat(64)}`,
    qualityStatus: 'validated',
    generatedAt: '2026-08-15T00:00:00.000Z',
    coverage: { completeFromMonthKey: '2023-06', completeThroughMonthKey: '2026-07', partialBoundaryMonths: ['2023-05', '2026-08'] },
    counts: { canonicalRows: 3, periods: 2, acceptedPeriods: 2, months: 3 },
    totalsEur: { exact: 100, dayToDay: 80, trips: 10, others: 10, calendarMinusCanonicalEur: 0 },
    raw: {},
  },
  periods: {
    contractId: 'gastapp_to_aurum_periods',
    version: 'gastapp-aurum-periods-v2',
    axis: 'periodKeyOriginal',
    canonicalDataHash: `sha256:${'a'.repeat(64)}`,
    generatedAt: '2026-08-15T00:00:00.000Z',
    rowCount: 3,
    totalEur: 100,
    periods: [
      { periodKeyOriginal: 'P1', periodNumber: 1, periodStartYmd: '2026-01-12', periodEndYmd: '2026-02-11', rowCount: 1, totalEur: 40, byFamily: { day_to_day: 40 }, byCategory: {}, byProject: {}, raw: {} },
      { periodKeyOriginal: 'P2', periodNumber: 2, periodStartYmd: '2026-02-12', periodEndYmd: '2026-03-11', rowCount: 2, totalEur: 60, byFamily: { day_to_day: 40, trips: 10, others: 10 }, byCategory: {}, byProject: {}, raw: {} },
    ],
    contractHash: `sha256:${'b'.repeat(64)}`,
    raw: {},
  },
  months: {
    contractId: 'gastapp_to_aurum_calendar_months',
    version: 'gastapp-aurum-calendar-months-v2',
    axis: 'calendarMonthKey',
    canonicalDataHash: `sha256:${'a'.repeat(64)}`,
    generatedAt: '2026-08-15T00:00:00.000Z',
    rowCount: 3,
    totalEur: 100,
    coverage: { completeFromMonthKey: '2023-06', completeThroughMonthKey: '2026-07', partialBoundaryMonths: ['2023-05', '2026-08'] },
    months: [
      { calendarMonthKey: '2026-01', status: 'complete', calendarStatus: 'complete', eligibleForAurumReturns: true, fromYmd: '2026-01-01', toYmd: '2026-01-31', rowCount: 1, totalEur: 50, byFamily: { day_to_day: 40, trips: 10 }, byCategory: {}, byProject: {}, raw: {} },
      { calendarMonthKey: '2026-02', status: 'complete', calendarStatus: 'complete', eligibleForAurumReturns: true, fromYmd: '2026-02-01', toYmd: '2026-02-28', rowCount: 1, totalEur: 40, byFamily: { day_to_day: 40 }, byCategory: {}, byProject: {}, raw: {} },
      { calendarMonthKey: '2026-03', status: 'pending', calendarStatus: 'partial_boundary_end', eligibleForAurumReturns: false, fromYmd: '2026-03-01', toYmd: '2026-03-11', rowCount: 1, totalEur: 10, byFamily: { others: 10 }, byCategory: {}, byProject: {}, raw: {} },
    ],
    contractHash: `sha256:${'c'.repeat(64)}`,
    raw: {},
  },
  readPaths: [],
} as any;

describe('GastApp Canónico V2 audit', () => {
  it('keeps periods as audit-only and reports explicit evidence limits', () => {
    const result = buildGastappCanonicalV2Concordance(contracts);

    expect(result.global.identities).toBe('pass');
    expect(result.global.rowCount).toBe('pass');
    expect(result.global.total).toBe('pass');
    expect(result.global.families).toBe('pass');
    expect(result.exactDateRange.status).toBe('not_proven');
    expect(result.rowControls.status).toBe('not_proven');
    expect(result.businessComparison.status).toBe('unavailable');
    expect(result.canonicalDataHash).toBe(contracts.metadata.canonicalDataHash);
  });

  it('does not treat the 12-period versus 12-month comparison as an integrity error', () => {
    const twelvePeriods = Array.from({ length: 12 }, (_, index) => ({
      ...contracts.periods.periods[0],
      periodKeyOriginal: `P${index + 1}`,
      totalEur: 10,
      rowCount: 1,
      byFamily: { day_to_day: 10 },
    }));
    const twelveMonths = Array.from({ length: 12 }, (_, index) => ({
      ...contracts.months.months[0],
      calendarMonthKey: `2025-${String(index + 1).padStart(2, '0')}`,
      totalEur: 8,
      rowCount: 1,
      byFamily: { day_to_day: 8 },
    }));
    const result = buildGastappCanonicalV2Concordance({
      ...contracts,
      metadata: { ...contracts.metadata, counts: { ...contracts.metadata.counts, canonicalRows: 12, periods: 12, months: 12 }, totalsEur: { ...contracts.metadata.totalsEur, exact: 120 } },
      periods: { ...contracts.periods, rowCount: 12, totalEur: 120, periods: twelvePeriods },
      months: { ...contracts.months, rowCount: 12, totalEur: 96, months: twelveMonths },
    } as any);

    expect(result.businessComparison.status).toBe('informative');
    expect(result.businessComparison.differenceEur).toBe(-24);
    expect(result.status).toBe('warning');
  });
});
