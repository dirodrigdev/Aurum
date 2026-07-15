import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  getGastappFirestore: () => null,
  isGastappFirestoreConfigured: () => false,
}));

import {
  buildGastappMonthlyValidation,
  calculateAnnualizedReturn,
  replaceMonthlySpendWithCalendarContract,
} from '../src/services/gastappMonthlyCalendarValidation';

const closure = (monthKey: string, netClp: number) => ({
  monthKey,
  summary: { netClp },
  fxRates: { eurClp: 1000, usdClp: 900, ufClp: 40000 },
});

describe('GastApp calendar-month validation', () => {
  it('compares the two spend contracts without changing the wealth closure', () => {
    const rows = buildGastappMonthlyValidation({
      closures: [closure('2026-01', 1000000), closure('2026-02', 1050000)] as any,
      oldContracts: new Map([['2026-02', { monthKey: '2026-02', status: 'complete', totalEur: 100, publishedAt: null }]]),
      calendarContracts: new Map([['2026-02', { monthKey: '2026-02', status: 'complete', totalEur: 70, publishedAt: null }]]),
      currency: 'CLP',
      includeRiskCapital: false,
    });

    expect(rows).toEqual([expect.objectContaining({ monthKey: '2026-02', oldPct: 15, calendarPct: 12 })]);
    expect(calculateAnnualizedReturn(rows, 'old')).toBeCloseTo((Math.pow(1.15, 12) - 1) * 100, 8);
    expect(calculateAnnualizedReturn(rows, 'calendar')).toBeCloseTo((Math.pow(1.12, 12) - 1) * 100, 8);
  });

  it('reuses the official monthly row and changes only calendar spend-derived values', () => {
    const officialRow = {
      monthKey: '2026-02',
      fx: { eurClp: 1000, usdClp: 900, ufClp: 40000 },
      rawEurClp: 1000,
      fxMethod: 'real_closure',
      fxAuditable: true,
      fxMissing: [],
      invalidNet: false,
      netClp: 1050000,
      prevNetClp: 1000000,
      varPatrimonioClp: 50000,
      netDisplay: 1050000,
      prevNetDisplay: 1000000,
      varPatrimonioDisplay: 50000,
      inflationMonthlyRate: null,
    } as any;

    const [calendarRow] = replaceMonthlySpendWithCalendarContract(
      [officialRow],
      new Map([['2026-02', { monthKey: '2026-02', status: 'complete', totalEur: 70, publishedAt: null }]]),
      'CLP',
    );

    expect(calendarRow).toMatchObject({
      netClp: 1050000,
      prevNetClp: 1000000,
      varPatrimonioClp: 50000,
      gastosClp: 70000,
      retornoRealClp: 120000,
      pct: 12,
      gastosContractSource: 'aurum_monthly_calendar_v2',
    });
  });
});
