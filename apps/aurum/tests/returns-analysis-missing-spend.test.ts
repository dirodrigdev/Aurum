import { describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

vi.mock('../src/services/gastosMonthly', () => ({
  resolveGastappMonthlySpend: (monthKey: string) => {
    if (monthKey === '2026-02') {
      return {
        monthKey,
        status: 'missing' as const,
        gastosEur: null,
        source: 'gastapp_firestore' as const,
      };
    }
    return {
      monthKey,
      status: 'complete' as const,
      gastosEur: 1000,
      source: 'gastapp_firestore' as const,
    };
  },
}));

import { computeMonthlyRows } from '../src/services/returnsAnalysis';

const makeClosure = (
  monthKey: string,
  netClp: number,
): WealthMonthlyClosure => ({
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
  fxRates: {
    usdClp: 900,
    eurClp: 1000,
    ufClp: 38000,
  },
});

describe('computeMonthlyRows with missing spend months', () => {
  it('keeps the next valid month anchored to the immediately prior net', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));

    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', 1_000_000_000),
        makeClosure('2026-02', 1_100_000_000),
        makeClosure('2026-03', 1_150_000_000),
      ],
      false,
      'CLP',
    );

    const missingRow = rows.find((row) => row.monthKey === '2026-02');
    const nextRow = rows.find((row) => row.monthKey === '2026-03');

    expect(missingRow?.gastosStatus).toBe('missing');
    expect(missingRow?.retornoRealClp).toBeNull();
    expect(nextRow?.prevNetClp).toBe(1_100_000_000);
    expect(nextRow?.varPatrimonioClp).toBe(50_000_000);
    expect(nextRow?.retornoRealClp).toBe(51_000_000);

    vi.useRealTimers();
  });
});
