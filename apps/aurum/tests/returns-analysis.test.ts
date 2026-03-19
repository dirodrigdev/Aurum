import { describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';
import {
  aggregateRows,
  buildPatrimonyCurve,
  buildTrajectoryCurve,
  computeMonthlyRows,
} from '../src/services/returnsAnalysis';

const makeClosure = (
  monthKey: string,
  {
    netClp,
    usdClp = 900,
    eurClp = 1000,
    ufClp = 38000,
  }: { netClp: number; usdClp?: number; eurClp?: number; ufClp?: number },
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
    usdClp,
    eurClp,
    ufClp,
  },
});

describe('returns analysis helpers', () => {
  it('builds monthly rows excluding the current operational month inferred from the latest closure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));

    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 900_000_000 }),
        makeClosure('2026-02', { netClp: 950_000_000 }),
        makeClosure('2026-03', { netClp: 970_000_000 }),
      ],
      false,
    );

    expect(rows.map((row) => row.monthKey)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(rows[1].varPatrimonioClp).toBe(50_000_000);

    vi.useRealTimers();
  });

  it('builds a cumulative trajectory with synthetic base 100 start and markers', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 900_000_000 }),
        makeClosure('2026-02', { netClp: 1_000_000_000 }),
        makeClosure('2026-03', { netClp: 1_050_000_000, eurClp: 1 }),
      ],
      false,
    );
    const curve = buildTrajectoryCurve(rows);

    expect(curve.status).toBe('ok');
    expect(curve.points[0].value).toBe(100);
    expect(curve.points[0].monthKey).toBe('2026-01');
    expect(curve.points.length).toBeGreaterThanOrEqual(2);
    expect(curve.markers.some((marker) => marker.kinds.includes('start'))).toBe(true);
    expect(curve.markers.some((marker) => marker.kinds.includes('end'))).toBe(true);
    expect(curve.domainMax).toBeGreaterThan(curve.domainMin ?? 0);
  });

  it('builds a patrimonio curve from netClp and keeps extrema markers', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2025-12', { netClp: 800_000_000 }),
        makeClosure('2026-01', { netClp: 1_000_000_000 }),
        makeClosure('2026-02', { netClp: 950_000_000 }),
      ],
      false,
    );
    const curve = buildPatrimonyCurve(rows);

    expect(curve.status).toBe('ok');
    expect(curve.points.map((point) => point.value)).toEqual([800_000_000, 1_000_000_000, 950_000_000]);
    expect(curve.markers.some((marker) => marker.kinds.includes('max'))).toBe(true);
    expect(curve.markers.some((marker) => marker.kinds.includes('min'))).toBe(true);
  });

  it('aggregates rows using the same return definition used by Retornos', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2025-12', { netClp: 900_000_000 }),
        makeClosure('2026-01', { netClp: 950_000_000, eurClp: 1 }),
        makeClosure('2026-02', { netClp: 960_000_000, eurClp: 1 }),
      ],
      false,
    );
    const summary = aggregateRows('test', 'Test', rows, 'CLP', rows.find((row) => row.netClp !== null)?.netClp ?? null);

    expect(summary.validMonths).toBeGreaterThan(0);
    expect(summary.retornoRealAcumClp).not.toBeNull();
    expect(summary.retornoRealAvgDisplay).not.toBeNull();
  });
});
