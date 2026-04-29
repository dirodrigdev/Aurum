import { describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';
const TEST_GASTOS_EUR: Record<string, number> = {
  '2025-12': 4400,
  '2026-01': 6288,
  '2026-02': 7928,
  '2026-03': 6567.24,
};

vi.mock('../src/services/gastosMonthly', () => ({
  resolveGastappMonthlySpend: (monthKey: string) => {
    const value = TEST_GASTOS_EUR[monthKey];
    if (Number.isFinite(value)) {
      return {
        monthKey,
        status: 'complete' as const,
        gastosEur: value,
        source: 'gastapp_firestore' as const,
      };
    }
    return {
      monthKey,
      status: 'pending' as const,
      gastosEur: null,
      source: 'gastapp_firestore' as const,
      contractStatus: 'pending' as const,
      periodKey: `${monthKey}-12__${monthKey.slice(0, 5)}${String(Number(monthKey.slice(5, 7)) + 1).padStart(2, '0')}-11`,
    };
  },
}));

import {
  aggregateRows,
  buildPendingOfficialReturnInfo,
  buildPendingReturnEstimate,
  buildPatrimonyCurve,
  buildTrajectoryCurve,
  computeMonthlyRows,
} from '../src/services/returnsAnalysis';
import { buildReturnSpendInsight } from '../src/components/analysis/shared';

const makeClosure = (
  monthKey: string,
  {
    netClp,
    netClpWithRisk,
    usdClp = 900,
    eurClp = 1000,
    ufClp = 38000,
    fxMissing,
  }: {
    netClp: number;
    netClpWithRisk?: number;
    usdClp?: number;
    eurClp?: number;
    ufClp?: number;
    fxMissing?: Array<'usdClp' | 'eurClp' | 'ufClp'>;
  },
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
    netClpWithRisk: netClpWithRisk ?? netClp,
  },
  fxRates: {
    usdClp,
    eurClp,
    ufClp,
  },
  fxMissing,
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
      'CLP',
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
      'CLP',
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
      'CLP',
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
      'CLP',
    );
    const summary = aggregateRows('test', 'Test', rows, rows.find((row) => row.netDisplay !== null)?.netDisplay ?? null);

    expect(summary.validMonths).toBeGreaterThan(0);
    expect(summary.retornoRealAcumClp).not.toBeNull();
    expect(summary.retornoRealAvgDisplay).not.toBeNull();
  });

  it('marks non-auditable FX months and excludes them from closed aggregates', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 1_000_000_000 }),
        makeClosure('2026-02', { netClp: 1_050_000_000, fxMissing: ['eurClp'] }),
        makeClosure('2026-03', { netClp: 1_100_000_000 }),
      ],
      false,
      'CLP',
    );

    const feb = rows.find((row) => row.monthKey === '2026-02');
    const mar = rows.find((row) => row.monthKey === '2026-03');
    expect(feb?.fxAuditable).toBe(false);
    expect(feb?.fxMethod).toBe('default_fallback');
    expect(feb?.gastosClp).toBeNull();
    expect(feb?.retornoRealClp).toBeNull();
    // The patrimony chain still advances from the missing-FX month net.
    expect(mar?.prevNetClp).toBe(1_050_000_000);

    const summary = aggregateRows('test-fx', 'Test FX', rows, rows.find((row) => row.netDisplay !== null)?.netDisplay ?? null);
    expect(summary.validMonths).toBe(1);
  });

  it('calculates monthly pct using per-month FX for USD and EUR', () => {
    const closures = [
      makeClosure('2026-01', { netClp: 1_000_000_000, usdClp: 1000, eurClp: 1000 }),
      makeClosure('2026-02', { netClp: 1_050_000_000, usdClp: 1050, eurClp: 1200 }),
    ];
    const gastosEurFeb = TEST_GASTOS_EUR['2026-02'];
    const gastosClpFeb = gastosEurFeb * 1200;

    const netUsdJan = 1_000_000_000 / 1000;
    const netUsdFeb = 1_050_000_000 / 1050;
    const retornoUsd = netUsdFeb - netUsdJan + gastosClpFeb / 1050;
    const pctUsd = (retornoUsd / netUsdJan) * 100;

    const netEurJan = 1_000_000_000 / 1000;
    const netEurFeb = 1_050_000_000 / 1200;
    const retornoEur = netEurFeb - netEurJan + gastosClpFeb / 1200;
    const pctEur = (retornoEur / netEurJan) * 100;

    const rowsUsd = computeMonthlyRows(closures, false, 'USD');
    const rowsEur = computeMonthlyRows(closures, false, 'EUR');
    const rowUsd = rowsUsd.find((row) => row.monthKey === '2026-02');
    const rowEur = rowsEur.find((row) => row.monthKey === '2026-02');

    expect(rowUsd?.pct).toBeCloseTo(pctUsd, 6);
    expect(rowEur?.pct).toBeCloseTo(pctEur, 6);
    expect(rowUsd?.pct).not.toBeCloseTo(rowEur?.pct ?? 0, 6);
  });

  it('aggregates, curves, and spend insight in display currency', () => {
    const closures = [
      makeClosure('2026-01', { netClp: 1_000_000_000, usdClp: 1000, eurClp: 1000 }),
      makeClosure('2026-02', { netClp: 1_050_000_000, usdClp: 1050, eurClp: 1200 }),
    ];
    const gastosEurFeb = TEST_GASTOS_EUR['2026-02'];
    const gastosClpFeb = gastosEurFeb * 1200;

    const netUsdJan = 1_000_000_000 / 1000;
    const netUsdFeb = 1_050_000_000 / 1050;
    const retornoUsd = netUsdFeb - netUsdJan + gastosClpFeb / 1050;
    const pctUsd = (retornoUsd / netUsdJan) * 100;
    const annualizedUsd = (Math.pow(1 + retornoUsd / netUsdJan, 12) - 1) * 100;
    const spendPctUsd = (gastosClpFeb / 1050 / retornoUsd) * 100;

    const rowsUsd = computeMonthlyRows(closures, false, 'USD');
    const baseNetUsd = rowsUsd.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
    const summaryUsd = aggregateRows('usd', 'USD', rowsUsd, baseNetUsd);
    const curveUsd = buildTrajectoryCurve(rowsUsd);
    const patrUsd = buildPatrimonyCurve(rowsUsd);
    const spendUsd = buildReturnSpendInsight(summaryUsd);

    expect(summaryUsd.pctRetorno).toBeCloseTo(annualizedUsd, 6);
    expect(summaryUsd.spendPct).toBeCloseTo(spendPctUsd, 6);
    expect(curveUsd.status).toBe('ok');
    expect(curveUsd.points[1].value).toBeCloseTo(100 * (1 + pctUsd / 100), 6);
    expect(patrUsd.points.map((point) => point.value)).toEqual([netUsdJan, netUsdFeb]);
    expect(spendUsd.kind).toBe('pct');

    const netEurJan = 1_000_000_000 / 1000;
    const netEurFeb = 1_050_000_000 / 1200;
    const retornoEur = netEurFeb - netEurJan + gastosClpFeb / 1200;
    const pctEur = (retornoEur / netEurJan) * 100;
    const annualizedEur = (Math.pow(1 + retornoEur / netEurJan, 12) - 1) * 100;

    const rowsEur = computeMonthlyRows(closures, false, 'EUR');
    const baseNetEur = rowsEur.find((row) => row.netDisplay !== null)?.netDisplay ?? null;
    const summaryEur = aggregateRows('eur', 'EUR', rowsEur, baseNetEur);
    const curveEur = buildTrajectoryCurve(rowsEur);
    const patrEur = buildPatrimonyCurve(rowsEur);
    const spendEur = buildReturnSpendInsight(summaryEur);

    expect(summaryEur.pctRetorno).toBeCloseTo(annualizedEur, 6);
    expect(curveEur.status).toBe('ok');
    expect(curveEur.points[1].value).toBeCloseTo(100 * (1 + pctEur / 100), 6);
    expect(patrEur.points.map((point) => point.value)).toEqual([netEurJan, netEurFeb]);
    expect(spendEur.kind).toBe('negative-return');
  });

  it('explains pending official returns and builds provisional estimates without closed aggregates', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2025-12', { netClp: 900_000_000, eurClp: 1000 }),
        makeClosure('2026-01', { netClp: 940_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 960_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 980_000_000, eurClp: 1000 }),
        makeClosure('2026-04', { netClp: 1_000_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    );
    const april = rows.find((row) => row.monthKey === '2026-04');
    expect(april?.gastosStatus).toBe('pending');

    const info = buildPendingOfficialReturnInfo(april!);
    expect(info.availabilityLabel).toBe('12 may');
    expect(info.periodRangeLabel).toBe('12 abr - 11 may');

    const estimate = buildPendingReturnEstimate(rows);
    expect(estimate?.monthKey).toBe('2026-04');
    expect(estimate?.availabilityLabel).toBe('12 may');
    expect(estimate?.scenarios.map((scenario) => scenario.key)).toEqual(['previous_closed', 'closed_average']);

    const previousScenario = estimate?.scenarios.find((scenario) => scenario.key === 'previous_closed');
    expect(previousScenario?.spendClp).toBeCloseTo(TEST_GASTOS_EUR['2026-03'] * 1000, 6);
    expect(previousScenario?.retornoRealClp).toBeCloseTo(20_000_000 + TEST_GASTOS_EUR['2026-03'] * 1000, 6);

    const summary = aggregateRows('with-pending', 'With pending', rows, rows[0].netDisplay);
    expect(summary.validMonths).toBe(3);
  });
});
