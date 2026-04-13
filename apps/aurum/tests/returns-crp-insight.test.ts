import { describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

vi.mock('../src/services/gastosMonthly', () => ({
  resolveGastappMonthlySpend: (monthKey: string) => ({
    monthKey,
    status: 'complete' as const,
    gastosEur: 1000,
    source: 'gastapp_firestore' as const,
  }),
}));

import { computeMonthlyRows } from '../src/services/returnsAnalysis';
import { buildCrpContributionInsight } from '../src/services/returnsCrpInsight';

const makeClosure = (
  monthKey: string,
  {
    netClp,
    netClpWithRisk,
    usdClp = 900,
    eurClp = 1000,
    ufClp = 38000,
  }: { netClp: number; netClpWithRisk: number; usdClp?: number; eurClp?: number; ufClp?: number },
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
    netClpWithRisk,
  },
  fxRates: {
    usdClp,
    eurClp,
    ufClp,
  },
});

describe('buildCrpContributionInsight', () => {
  it('builds the CRP insight in the selected currency', () => {
    const closures = [
      makeClosure('2026-01', { netClp: 1_000_000_000, netClpWithRisk: 1_020_000_000, usdClp: 1000, eurClp: 1000 }),
      makeClosure('2026-02', { netClp: 1_050_000_000, netClpWithRisk: 1_080_000_000, usdClp: 1050, eurClp: 1200 }),
    ];

    const rowsWithUsd = computeMonthlyRows(closures, true, 'USD');
    const rowsWithoutUsd = computeMonthlyRows(closures, false, 'USD');
    const insightUsd = buildCrpContributionInsight(rowsWithUsd, rowsWithoutUsd, 'USD');
    expect(insightUsd).not.toBeNull();
    expect(insightUsd?.tone).toBe('positive');
    expect(insightUsd?.totalText).toContain('USD');

    const rowsWithEur = computeMonthlyRows(closures, true, 'EUR');
    const rowsWithoutEur = computeMonthlyRows(closures, false, 'EUR');
    const insightEur = buildCrpContributionInsight(rowsWithEur, rowsWithoutEur, 'EUR');
    expect(insightEur).not.toBeNull();
    expect(insightEur?.tone).toBe('positive');
    expect(insightEur?.totalText).toContain('EUR');
    expect(insightEur?.totalText).not.toBe(insightUsd?.totalText);
  });
});
