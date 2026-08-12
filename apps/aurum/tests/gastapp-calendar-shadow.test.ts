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
});
