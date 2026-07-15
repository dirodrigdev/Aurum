import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  getGastappFirestore: () => null,
  isGastappFirestoreConfigured: () => false,
}));

import { buildGastappMonthlyValidation, calculateAnnualizedReturn } from '../src/services/gastappMonthlyCalendarValidation';

const closure = (monthKey: string, netClp: number) => ({
  monthKey,
  summary: { netClp },
  fxRates: { eurClp: 1000, usdClp: 900, ufClp: 40000 },
});

describe('GastApp calendar-month validation', () => {
  it('compares the two spend contracts without changing the wealth closure', () => {
    const rows = buildGastappMonthlyValidation({
      closures: [closure('2026-01', 1000000), closure('2026-02', 1050000)] as any,
      oldContracts: new Map([['2026-02', { monthKey: '2026-02', status: 'complete', totalEur: 100 }]]),
      calendarContracts: new Map([['2026-02', { monthKey: '2026-02', status: 'complete', totalEur: 70 }]]),
      currency: 'CLP',
      includeRiskCapital: false,
    });

    expect(rows).toEqual([expect.objectContaining({ monthKey: '2026-02', oldPct: 15, calendarPct: 12 })]);
    expect(calculateAnnualizedReturn(rows, 'old')).toBeCloseTo((Math.pow(1.15, 12) - 1) * 100, 8);
    expect(calculateAnnualizedReturn(rows, 'calendar')).toBeCloseTo((Math.pow(1.12, 12) - 1) * 100, 8);
  });
});
