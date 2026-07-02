import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import type { WealthMonthlyClosure } from '../src/services/wealthStorage';
const TEST_GASTOS_EUR: Record<string, number> = {
  '2025-12': 4400,
  '2026-01': 6288,
  '2026-02': 7928,
  '2026-03': 6567.24,
};

vi.mock('../src/services/gastosMonthly', () => ({
  resolveGastappMonthlySpend: (monthKey: string) => {
    const value = TEST_GASTOS_EUR[monthKey] ?? (monthKey.startsWith('2025-') ? 4200 : undefined);
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
  buildWealthEvolutionComparisonModel,
  buildPendingOfficialReturnInfo,
  buildPendingReturnEstimate,
  buildReturnsSeriesView,
  buildReturnsMonthlySourceDiagnostics,
  buildTrailingSummary,
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

  it('does not represent period return as a linear monthly average', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2025-12', { netClp: 100, eurClp: 1 }),
        makeClosure('2026-01', { netClp: 105, eurClp: 1 }),
        makeClosure('2026-02', { netClp: 110.25, eurClp: 1 }),
      ],
      false,
      'CLP',
    ).map((row) => ({
      ...row,
      gastosStatus: 'complete' as const,
      gastosSource: 'gastapp_firestore' as const,
      gastosContractStatus: 'complete' as const,
      gastosDataQuality: 'ok' as const,
      gastosIsStale: false,
      gastosClp: 0,
      gastosDisplay: 0,
      retornoRealClp: row.monthKey === '2026-01' ? 5 : row.monthKey === '2026-02' ? 5.25 : row.retornoRealClp,
      retornoRealDisplay: row.monthKey === '2026-01' ? 5 : row.monthKey === '2026-02' ? 5.25 : row.retornoRealDisplay,
      pct: row.monthKey === '2026-01' || row.monthKey === '2026-02' ? 5 : row.pct,
    }));

    const summary = aggregateRows(
      'period-return',
      'Period return',
      rows.filter((row) => row.monthKey >= '2026-01'),
      100,
      { expectedMonthKeys: ['2026-01', '2026-02'] },
    );

    expect(summary.validMonths).toBe(2);
    expect(summary.retornoRealAcumDisplay).toBe(10.25);
    expect(summary.retornoRealAvgDisplay).toBe(5.125);
    expect(summary.pctRetorno).toBeCloseTo(((1.1025 ** 6) - 1) * 100, 10);
    expect(summary.pctRetorno).not.toBeCloseTo(summary.retornoRealAvgDisplay ?? 0, 10);
  });

  it('includes complete official GastApp spend in closed aggregates', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 1_050_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    ).map((row) =>
      row.monthKey === '2026-02'
        ? {
            ...row,
            gastosSource: 'gastapp_firestore' as const,
            gastosContractStatus: 'complete' as const,
            gastosDataQuality: 'ok' as const,
            gastosIsStale: false,
          }
        : row,
    );

    const summary = aggregateRows('official', 'Official', rows.slice(1), rows[1].prevNetDisplay, {
      expectedMonthKeys: ['2026-02'],
    });

    expect(summary.validMonths).toBe(1);
    expect(summary.coverage).toMatchObject({
      validMonths: 1,
      expectedMonths: 1,
      status: 'complete',
    });
    expect(summary.retornoRealAcumClp).not.toBeNull();
  });

  it('keeps legacy spend visible in history but excludes it from official aggregates', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 1_050_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 1_080_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    ).map((row) => {
      if (row.monthKey === '2026-02') {
        return {
          ...row,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'complete' as const,
          gastosDataQuality: 'ok' as const,
          gastosIsStale: false,
        };
      }
      if (row.monthKey === '2026-03') {
        return {
          ...row,
          gastosSource: 'legacy_static' as const,
          gastosContractSource: 'legacy_static',
          gastosDataQuality: 'warning' as const,
          gastosIsStale: false,
        };
      }
      return row;
    });

    const legacyRow = rows.find((row) => row.monthKey === '2026-03');
    const summary = aggregateRows('legacy-excluded', 'Legacy excluded', rows, rows[0].netDisplay);

    expect(legacyRow?.gastosStatus).toBe('complete');
    expect(legacyRow?.retornoRealClp).not.toBeNull();
    expect(summary.validMonths).toBe(1);
    expect(summary.coverage.status).toBe('partial');
    expect(summary.coverage.nonApplicableMonths).toEqual([
      expect.objectContaining({ monthKey: '2026-01', reason: 'base_month' }),
    ]);
    expect(summary.coverage.excludedMonths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ monthKey: '2026-03', reason: 'legacy_static' }),
      ]),
    );
    expect(summary.gastosAcumClp).toBeCloseTo(TEST_GASTOS_EUR['2026-02'] * 1000, 6);
  });

  it('excludes stale, warning, and error spend from from-start, 12M, and YTD aggregates', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 1_050_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 1_080_000_000, eurClp: 1000 }),
        makeClosure('2026-04', { netClp: 1_100_000_000, eurClp: 1000 }),
        makeClosure('2026-05', { netClp: 1_120_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    ).map((row) => {
      if (row.monthKey === '2026-02') {
        return {
          ...row,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'complete' as const,
          gastosDataQuality: 'ok' as const,
          gastosIsStale: false,
        };
      }
      if (row.monthKey === '2026-03') {
        return {
          ...row,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'complete' as const,
          gastosDataQuality: 'warning' as const,
          gastosIsStale: false,
        };
      }
      if (row.monthKey === '2026-04') {
        return {
          ...row,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'stale' as const,
          gastosDataQuality: 'ok' as const,
          gastosIsStale: true,
        };
      }
      if (row.monthKey === '2026-05') {
        return {
          ...row,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'complete' as const,
          gastosDataQuality: 'error' as const,
          gastosIsStale: false,
        };
      }
      return row;
    });
    const baseNetDisplay = rows[0].netDisplay;

    const fromStart = aggregateRows('from-start', 'Desde inicio', rows, baseNetDisplay);
    const trailing12 = buildTrailingSummary(rows, 12, '12m', '12M');
    const ytd = aggregateRows(
      'ytd',
      'YTD',
      rows.filter((row) => row.monthKey.startsWith('2026-')),
      baseNetDisplay,
    );

    expect(fromStart.validMonths).toBe(1);
    expect(trailing12?.validMonths).toBe(1);
    expect(ytd.validMonths).toBe(1);
    expect(trailing12?.coverage.expectedMonths).toBe(1);
    expect(trailing12?.coverage.status).toBe('complete');
    expect(trailing12?.periodStartMonthKey).toBe('2026-02');
    expect(trailing12?.periodEndMonthKey).toBe('2026-02');
    expect(fromStart.coverage.excludedMonths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ monthKey: '2026-03', reason: 'stale_warning_error' }),
        expect.objectContaining({ monthKey: '2026-04', reason: 'stale_warning_error' }),
        expect.objectContaining({ monthKey: '2026-05', reason: 'stale_warning_error' }),
      ]),
    );
    expect(fromStart.gastosAcumClp).toBeCloseTo(TEST_GASTOS_EUR['2026-02'] * 1000, 6);
  });

  it('uses the last 12 valid months when the latest calendar month is still pending', () => {
    const closures: WealthMonthlyClosure[] = [];
    for (let year = 2025; year <= 2026; year += 1) {
      const startMonth = year === 2025 ? 1 : 1;
      const endMonth = year === 2025 ? 12 : 4;
      for (let month = startMonth; month <= endMonth; month += 1) {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        closures.push(makeClosure(monthKey, { netClp: 800_000_000 + closures.length * 10_000_000, eurClp: 1000 }));
      }
    }

    const rows = computeMonthlyRows(closures, false, 'CLP');
    const trailing12 = buildTrailingSummary(rows, 12, '12m', '12M');

    expect(trailing12?.validMonths).toBe(12);
    expect(trailing12?.coverage.expectedMonths).toBe(12);
    expect(trailing12?.coverage.status).toBe('complete');
    expect(trailing12?.periodStartMonthKey).toBe('2025-04');
    expect(trailing12?.periodEndMonthKey).toBe('2026-03');
    expect(trailing12?.coverage.excludedMonths).toEqual([]);
    expect(trailing12?.coverage.nonApplicableMonths).toEqual([]);
  });

  it('uses the last 24 and 36 valid months instead of calendar windows when pending months exist', () => {
    const closures: WealthMonthlyClosure[] = [];
    for (let year = 2023; year <= 2026; year += 1) {
      const endMonth = year === 2026 ? 5 : 12;
      for (let month = 1; month <= endMonth; month += 1) {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        closures.push(makeClosure(monthKey, { netClp: 700_000_000 + closures.length * 8_000_000, eurClp: 1000 }));
      }
    }

    const rows = computeMonthlyRows(closures, false, 'CLP').map((row) => {
      if ((row.monthKey.startsWith('2023-') || row.monthKey.startsWith('2024-')) && row.varPatrimonioClp !== null && row.varPatrimonioDisplay !== null) {
        const gastosClp = 4_200 * row.fx.eurClp;
        return {
          ...row,
          gastosStatus: 'complete' as const,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'complete' as const,
          gastosDataQuality: 'ok' as const,
          gastosIsStale: false,
          gastosClp,
          gastosDisplay: gastosClp,
          retornoRealClp: row.varPatrimonioClp + gastosClp,
          retornoRealDisplay: row.varPatrimonioDisplay + gastosClp,
          pct:
            row.prevNetDisplay === null || row.prevNetDisplay === 0
              ? null
              : ((row.varPatrimonioDisplay + gastosClp) / row.prevNetDisplay) * 100,
        };
      }
      return row;
    });
    const trailing24 = buildTrailingSummary(rows, 24, '24m', '24M');
    const trailing36 = buildTrailingSummary(rows, 36, '36m', '36M');

    expect(trailing24?.validMonths).toBe(24);
    expect(trailing24?.periodStartMonthKey).toBe('2024-04');
    expect(trailing24?.periodEndMonthKey).toBe('2026-03');
    expect(trailing36?.validMonths).toBe(36);
    expect(trailing36?.periodStartMonthKey).toBe('2023-04');
    expect(trailing36?.periodEndMonthKey).toBe('2026-03');
  });

  it('uses available valid months without inventing missing ones when there are fewer than requested', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2025-12', { netClp: 900_000_000, eurClp: 1000 }),
        makeClosure('2026-01', { netClp: 920_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 940_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 960_000_000, eurClp: 1000 }),
        makeClosure('2026-04', { netClp: 980_000_000, eurClp: 1000 }),
        makeClosure('2026-05', { netClp: 1_000_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    );

    const trailing12 = buildTrailingSummary(rows, 12, '12m', '12M');

    expect(trailing12?.validMonths).toBe(3);
    expect(trailing12?.coverage.expectedMonths).toBe(3);
    expect(trailing12?.coverage.status).toBe('complete');
    expect(trailing12?.periodStartMonthKey).toBe('2026-01');
    expect(trailing12?.periodEndMonthKey).toBe('2026-03');
  });

  it('builds monthly source diagnostics with official inclusion and exclusion reasons', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 1_050_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 1_080_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    ).map((row) => {
      if (row.monthKey === '2026-02') {
        return {
          ...row,
          gastosSource: 'gastapp_firestore' as const,
          gastosContractStatus: 'complete' as const,
          gastosDataQuality: 'ok' as const,
          gastosIsStale: false,
        };
      }
      if (row.monthKey === '2026-03') {
        return {
          ...row,
          gastosSource: 'legacy_static' as const,
          gastosContractSource: 'legacy_static',
          gastosDataQuality: 'warning' as const,
        };
      }
      return row;
    });

    const diagnostics = buildReturnsMonthlySourceDiagnostics(rows);
    const official = diagnostics.find((item) => item.monthKey === '2026-02');
    const legacy = diagnostics.find((item) => item.monthKey === '2026-03');

    expect(official).toMatchObject({
      entraAgregadoOficial: true,
      motivoExclusion: null,
      gastosSource: 'gastapp_firestore',
      fxAuditable: true,
      previousClosureAvailable: true,
    });
    expect(legacy).toMatchObject({
      entraAgregadoOficial: false,
      motivoExclusion: 'legacy_static',
      motivoExclusionLabel: 'legacy_static',
      gastosSource: 'legacy_static',
    });
  });

  it('reports missing closure months in aggregate coverage metadata', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 1_080_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    ).map((row) =>
      row.monthKey === '2026-03'
        ? {
            ...row,
            gastosSource: 'gastapp_firestore' as const,
            gastosContractStatus: 'complete' as const,
            gastosDataQuality: 'ok' as const,
            gastosIsStale: false,
          }
        : row,
    );

    const summary = aggregateRows('gap', 'Gap', rows, rows[0].netDisplay, {
      expectedMonthKeys: ['2026-01', '2026-02', '2026-03'],
    });

    expect(summary.validMonths).toBe(1);
    expect(summary.coverage.expectedMonths).toBe(2);
    expect(summary.coverage.status).toBe('partial');
    expect(summary.coverage.nonApplicableMonths).toEqual([
      expect.objectContaining({ monthKey: '2026-01', reason: 'base_month' }),
    ]);
    expect(summary.coverage.excludedMonths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ monthKey: '2026-02', reason: 'missing_closure' }),
      ]),
    );
  });

  it('keeps structural base and pending months out of official coverage denominators', () => {
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

    const fromStart = aggregateRows('from-start', 'Desde inicio', rows, rows[0].netDisplay, {
      expectedMonthKeys: rows.map((row) => row.monthKey),
    });
    const ytd = aggregateRows(
      'ytd',
      'YTD 2026',
      rows.filter((row) => row.monthKey.startsWith('2026-')),
      rows[0].netDisplay,
      { expectedMonthKeys: ['2026-01', '2026-02', '2026-03', '2026-04'] },
    );

    expect(fromStart.validMonths).toBe(3);
    expect(fromStart.coverage.expectedMonths).toBe(3);
    expect(fromStart.coverage.nonApplicableMonths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ monthKey: '2025-12', reason: 'base_month' }),
        expect.objectContaining({ monthKey: '2026-04', reason: 'pending_current' }),
      ]),
    );
    expect(fromStart.coverage.excludedMonths).toEqual([]);
    expect(ytd.validMonths).toBe(3);
    expect(ytd.coverage.expectedMonths).toBe(3);
    expect(ytd.coverage.status).toBe('complete');
    expect(ytd.coverage.nonApplicableMonths).toEqual([
      expect.objectContaining({ monthKey: '2026-04', reason: 'pending_current' }),
    ]);
  });

  it('counts stale closed months as coverage problems inside official ranges', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2025-06', { netClp: 900_000_000, eurClp: 1000 }),
        makeClosure('2025-07', { netClp: 940_000_000, eurClp: 1000 }),
        makeClosure('2025-08', { netClp: 960_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    ).map((row) =>
      row.monthKey === '2025-08'
        ? {
            ...row,
            gastosSource: 'gastapp_firestore' as const,
            gastosContractStatus: 'stale' as const,
            gastosDataQuality: 'ok' as const,
            gastosIsStale: true,
          }
        : row,
    );

    const summary = aggregateRows(
      'stale-range',
      'Stale range',
      rows.filter((row) => row.monthKey >= '2025-07'),
      rows[0].netDisplay,
      { expectedMonthKeys: ['2025-07', '2025-08'] },
    );

    expect(summary.validMonths).toBe(1);
    expect(summary.coverage.expectedMonths).toBe(2);
    expect(summary.coverage.excludedMonths).toEqual([
      expect.objectContaining({ monthKey: '2025-08', reason: 'stale_warning_error' }),
    ]);
    expect(summary.coverage.nonApplicableMonths).toEqual([]);
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
    expect(estimate?.scenarios.map((scenario) => scenario.key)).toEqual(['avg_12m_closed', 'avg_6m_closed', 'previous_closed']);
    expect(estimate?.selectedScenarioKey).toBe('avg_12m_closed');
    const averageScenario = estimate?.scenarios.find((scenario) => scenario.key === 'avg_12m_closed');
    expect(averageScenario?.label).toBe('Promedio últimos 12 meses oficiales (4 meses disponibles)');

    const previousScenario = estimate?.scenarios.find((scenario) => scenario.key === 'previous_closed');
    expect(previousScenario?.spendClp).toBeCloseTo(TEST_GASTOS_EUR['2026-03'] * 1000, 6);
    expect(previousScenario?.retornoRealClp).toBeCloseTo(20_000_000 + TEST_GASTOS_EUR['2026-03'] * 1000, 6);

    const summary = aggregateRows('with-pending', 'With pending', rows, rows[0].netDisplay);
    expect(summary.validMonths).toBe(3);
  });

  it('builds a dual returns series and keeps official rows unchanged', () => {
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
    const view = buildReturnsSeriesView(rows);
    expect(view.hasEstimatedMonth).toBe(true);
    expect(view.pendingEstimate?.monthKey).toBe('2026-04');
    expect(view.pendingEstimate?.estimateMethod).toBe('avg_12m_closed');
    expect(view.pendingEstimate?.estimatedFromMonthsCount).toBe(4);

    const officialApril = view.officialRows.find((row) => row.monthKey === '2026-04');
    const estimatedApril = view.estimatedRows.find((row) => row.monthKey === '2026-04');
    const estimatedYtd = aggregateRows(
      'estimated-ytd',
      'Estimated YTD',
      view.estimatedRows.filter((row) => row.monthKey >= '2026-01'),
      view.estimatedRows.find((row) => row.monthKey === '2025-12')?.netDisplay ?? null,
      { expectedMonthKeys: ['2026-01', '2026-02', '2026-03', '2026-04'] },
    );
    expect(officialApril?.gastosStatus).toBe('pending');
    expect(estimatedApril?.gastosStatus).toBe('complete');
    expect(estimatedApril?.isEstimated).toBe(true);
    expect(estimatedApril?.estimateMethod).toBe('avg_12m_closed');
    expect(estimatedApril?.retornoRealClp).not.toBeNull();
    expect(estimatedYtd.validMonths).toBe(4);
    expect(estimatedYtd.coverage.expectedMonths).toBe(4);
    expect(estimatedYtd.coverage.status).toBe('complete');
    expect(estimatedYtd.coverage.nonApplicableMonths).toEqual([]);
    expect(view.pendingEstimateDetail?.scenarios[0]?.key).toBe('avg_12m_closed');
    expect(view.pendingEstimateDetail?.scenarios[1]?.key).toBe('avg_6m_closed');
    expect(estimatedApril?.estimatedSpendClp).toBeCloseTo(view.pendingEstimate?.estimatedSpendClp ?? 0, 6);
  });

  it('uses the lower spend between 12M and 6M official averages as the estimate', () => {
    const closures: WealthMonthlyClosure[] = [];
    for (let i = 4; i <= 12; i += 1) {
      const month = String(i).padStart(2, '0');
      closures.push(makeClosure(`2025-${month}`, { netClp: 800_000_000 + i * 10_000_000, eurClp: 1000 }));
    }
    closures.push(makeClosure('2026-01', { netClp: 980_000_000, eurClp: 1000 }));
    closures.push(makeClosure('2026-02', { netClp: 990_000_000, eurClp: 1000 }));
    closures.push(makeClosure('2026-03', { netClp: 1_000_000_000, eurClp: 1000 }));
    closures.push(makeClosure('2026-04', { netClp: 1_010_000_000, eurClp: 1000 }));
    const rows = computeMonthlyRows(closures, false, 'CLP');
    const view = buildReturnsSeriesView(rows);
    expect(view.hasEstimatedMonth).toBe(true);
    expect(view.pendingEstimate?.monthKey).toBe('2026-04');
    const avg12 = view.pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'avg_12m_closed');
    const avg6 = view.pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'avg_6m_closed');
    expect(avg12).toBeTruthy();
    expect(avg6).toBeTruthy();
    expect(view.pendingEstimate?.estimatedSpendClp).toBe(Math.min(avg12?.spendClp ?? Infinity, avg6?.spendClp ?? Infinity));
    expect(view.pendingEstimate?.estimateMethod).toBe(
      (avg12?.spendClp ?? Infinity) <= (avg6?.spendClp ?? Infinity) ? 'avg_12m_closed' : 'avg_6m_closed',
    );
  });

  it('uses the 6M average when it is more conservative than 12M', () => {
    const snapshot = { ...TEST_GASTOS_EUR };
    Object.assign(TEST_GASTOS_EUR, {
      '2025-05': 10_000,
      '2025-06': 10_000,
      '2025-07': 10_000,
      '2025-08': 10_000,
      '2025-09': 10_000,
      '2025-10': 10_000,
      '2025-11': 1_000,
      '2025-12': 1_000,
      '2026-01': 1_000,
      '2026-02': 1_000,
      '2026-03': 1_000,
    });
    try {
      const closures = [
        makeClosure('2025-05', { netClp: 800_000_000, eurClp: 1000 }),
        makeClosure('2025-06', { netClp: 820_000_000, eurClp: 1000 }),
        makeClosure('2025-07', { netClp: 840_000_000, eurClp: 1000 }),
        makeClosure('2025-08', { netClp: 860_000_000, eurClp: 1000 }),
        makeClosure('2025-09', { netClp: 880_000_000, eurClp: 1000 }),
        makeClosure('2025-10', { netClp: 900_000_000, eurClp: 1000 }),
        makeClosure('2025-11', { netClp: 920_000_000, eurClp: 1000 }),
        makeClosure('2025-12', { netClp: 940_000_000, eurClp: 1000 }),
        makeClosure('2026-01', { netClp: 960_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 980_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-04', { netClp: 1_020_000_000, eurClp: 1000 }),
      ];
      const rows = computeMonthlyRows(closures, false, 'CLP');
      const view = buildReturnsSeriesView(rows);
      expect(view.pendingEstimate?.estimateMethod).toBe('avg_6m_closed');
      expect(view.pendingEstimate?.estimatedFromMonthsCount).toBe(6);
      expect(view.pendingEstimateDetail?.selectedScenarioKey).toBe('avg_6m_closed');
      const avg12 = view.pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'avg_12m_closed');
      const avg6 = view.pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'avg_6m_closed');
      expect(avg6?.spendClp ?? 0).toBeLessThan(avg12?.spendClp ?? Number.POSITIVE_INFINITY);
    } finally {
      Object.keys(TEST_GASTOS_EUR).forEach((key) => {
        delete TEST_GASTOS_EUR[key];
      });
      Object.assign(TEST_GASTOS_EUR, snapshot);
    }
  });

  it('keeps using the 12M average when it is more conservative than 6M', () => {
    const snapshot = { ...TEST_GASTOS_EUR };
    Object.assign(TEST_GASTOS_EUR, {
      '2025-05': 1_000,
      '2025-06': 1_000,
      '2025-07': 1_000,
      '2025-08': 1_000,
      '2025-09': 1_000,
      '2025-10': 10_000,
      '2025-11': 10_000,
      '2025-12': 10_000,
      '2026-01': 10_000,
      '2026-02': 10_000,
      '2026-03': 10_000,
    });
    try {
      const closures = [
        makeClosure('2025-05', { netClp: 800_000_000, eurClp: 1000 }),
        makeClosure('2025-06', { netClp: 820_000_000, eurClp: 1000 }),
        makeClosure('2025-07', { netClp: 840_000_000, eurClp: 1000 }),
        makeClosure('2025-08', { netClp: 860_000_000, eurClp: 1000 }),
        makeClosure('2025-09', { netClp: 880_000_000, eurClp: 1000 }),
        makeClosure('2025-10', { netClp: 900_000_000, eurClp: 1000 }),
        makeClosure('2025-11', { netClp: 920_000_000, eurClp: 1000 }),
        makeClosure('2025-12', { netClp: 940_000_000, eurClp: 1000 }),
        makeClosure('2026-01', { netClp: 960_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 980_000_000, eurClp: 1000 }),
        makeClosure('2026-03', { netClp: 1_000_000_000, eurClp: 1000 }),
        makeClosure('2026-04', { netClp: 1_020_000_000, eurClp: 1000 }),
      ];
      const rows = computeMonthlyRows(closures, false, 'CLP');
      const view = buildReturnsSeriesView(rows);
      expect(view.pendingEstimate?.estimateMethod).toBe('avg_12m_closed');
      expect(view.pendingEstimate?.estimatedFromMonthsCount).toBe(11);
      expect(view.pendingEstimateDetail?.selectedScenarioKey).toBe('avg_12m_closed');
      const avg12 = view.pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'avg_12m_closed');
      const avg6 = view.pendingEstimateDetail?.scenarios.find((scenario) => scenario.key === 'avg_6m_closed');
      expect(avg12?.spendClp ?? 0).toBeLessThan(avg6?.spendClp ?? Number.POSITIVE_INFINITY);
    } finally {
      Object.keys(TEST_GASTOS_EUR).forEach((key) => {
        delete TEST_GASTOS_EUR[key];
      });
      Object.assign(TEST_GASTOS_EUR, snapshot);
    }
  });

  it('emits official availability notice only for recent clean official months', () => {
    const rows = computeMonthlyRows(
      [
        makeClosure('2026-01', { netClp: 940_000_000, eurClp: 1000 }),
        makeClosure('2026-02', { netClp: 960_000_000, eurClp: 1000 }),
      ],
      false,
      'CLP',
    );
    const enrichedRows = rows.map((row) =>
      row.monthKey === '2026-02'
        ? {
            ...row,
            gastosStatus: 'complete' as const,
            gastosDataQuality: 'ok' as const,
            gastosIsStale: false,
            gastosPublishedAt: new Date().toISOString(),
          }
        : row,
    );
    const view = buildReturnsSeriesView(enrichedRows);
    expect(view.officialAvailabilityNotice?.monthKey).toBe('2026-02');
    expect(view.officialAvailabilityNotice?.officialReturnClp).not.toBeNull();
    expect(view.officialAvailabilityNotice?.officialRatePct).not.toBeNull();
    expect(view.officialAvailabilityNotice?.officialSpendClp).not.toBeNull();

    const staleRows = enrichedRows.map((row) =>
      row.monthKey === '2026-02'
        ? { ...row, gastosIsStale: true }
        : row,
    );
    const staleView = buildReturnsSeriesView(staleRows);
    expect(staleView.officialAvailabilityNotice).toBeNull();
  });

  it('builds a canonical wealth evolution comparison model without mutating closures', () => {
    const closures = [
      makeClosure('2025-12', { netClp: 800_000_000, usdClp: 800, eurClp: 900, ufClp: 35_000 }),
      makeClosure('2026-01', { netClp: 1_000_000_000, usdClp: 1000, eurClp: 1000, ufClp: 40_000 }),
      makeClosure('2026-02', { netClp: 1_050_000_000, usdClp: 1050, eurClp: 1200, ufClp: 42_000 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(closures));

    const model = buildWealthEvolutionComparisonModel(closures, false);

    expect(model.source).toBe('returns_analysis_closures');
    expect(model.baseMonth).toBe('2025-12');
    expect(model.clpSeries.points.map((point) => point.value)).toEqual([800_000_000, 1_000_000_000, 1_050_000_000]);
    expect(model.ufSeries.points.map((point) => point.value)).toEqual([
      800_000_000 / 35_000,
      1_000_000_000 / 40_000,
      1_050_000_000 / 42_000,
    ]);
    expect(model.usdSeries.points.map((point) => point.value)).toEqual([
      800_000_000 / 800,
      1_000_000_000 / 1000,
      1_050_000_000 / 1050,
    ]);
    expect(model.base100Series.CLP.points.map((point) => point.value)).toEqual([100, 125, 131.25]);
    expect(model.ufTrendSeries.points).toHaveLength(3);
    expect(closures).toEqual(snapshot);
  });

  it('flags suspicious UF monthly jumps without hiding UF points from the chart model', () => {
    const months = [
      '2023-01',
      '2023-02',
      '2023-03',
      '2023-04',
      '2023-05',
      '2023-06',
      '2023-07',
      '2023-08',
      '2023-09',
      '2023-10',
      '2023-11',
      '2023-12',
    ];
    const closures = months.map((monthKey, index) => {
      const ufClp = monthKey === '2023-11' ? 39_784 : 36_200 + index * 30;
      return makeClosure(monthKey, {
        netClp: 1_200_000_000 + index * 8_000_000,
        usdClp: 900 + index,
        eurClp: 980 + index,
        ufClp,
      });
    });

    const model = buildWealthEvolutionComparisonModel(closures, false);

    expect(model.points.find((point) => point.monthKey === '2023-10')?.netUf).not.toBeNull();
    expect(model.points.find((point) => point.monthKey === '2023-11')?.netUf).not.toBeNull();
    expect(model.points.find((point) => point.monthKey === '2023-12')?.netUf).not.toBeNull();
    expect(model.suspiciousUfMonths.some((item) => item.monthKey === '2023-11')).toBe(true);
  });

  it('omits missing UF and FX months instead of inventing conversions', () => {
    const closures = [
      makeClosure('2026-01', { netClp: 1_000_000_000, usdClp: 1000, eurClp: 1000, ufClp: 40_000 }),
      makeClosure('2026-02', { netClp: 1_050_000_000, fxMissing: ['ufClp'] }),
      makeClosure('2026-03', { netClp: 1_100_000_000, fxMissing: ['eurClp'] }),
    ];

    const model = buildWealthEvolutionComparisonModel(closures, false);

    expect(model.missingUfMonths).toContain('2026-02');
    expect(model.missingFxMonths).toContain('2026-02');
    expect(model.missingFxMonths).toContain('2026-03');
    expect(model.points.find((point) => point.monthKey === '2026-02')?.netUf).toBeNull();
    expect(model.points.find((point) => point.monthKey === '2026-03')?.netEur).toBeNull();
    expect(model.hasIncompleteConversion).toBe(true);
  });
});
