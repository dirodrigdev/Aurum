/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

vi.mock('../src/services/portfolioAnalytics', () => ({
  calculatePortfolioAnalytics: vi.fn((series: Array<{ monthKey: string; returnPct: number; isEstimated?: boolean }>) => ({
    monthsTotal: series.length,
    monthsUsed: series.length,
    estimatedMonthsUsed: series.filter((point) => point.isEstimated).length,
    firstMonthKey: series[0]?.monthKey,
    lastMonthKey: series[series.length - 1]?.monthKey,
    lastMonthIsEstimated: Boolean(series[series.length - 1]?.isEstimated),
    cumulativeReturnPct: 0.24,
    annualizedReturnPct: 0.12,
    averageMonthlyReturnPct: 0.01,
    medianMonthlyReturnPct: 0.009,
    geometricMonthlyReturnPct: 0.0095,
    volatilityMonthlyPct: 0.02,
    volatilityAnnualizedPct: 0.0692820323,
    downsideDeviationMonthlyPct: 0.01,
    downsideDeviationAnnualizedPct: 0.0346410161,
    bestMonth: { monthKey: '2026-06', returnPct: 0.03, isEstimated: true },
    worstMonth: { monthKey: '2026-03', returnPct: -0.02, isEstimated: false },
    positiveMonthsPct: 0.75,
    negativeMonthsPct: 0.25,
    zeroMonthsPct: 0,
    percentiles: { p10: -0.01, p25: 0.002, p50: 0.009, p75: 0.015, p90: 0.025 },
    trimmedMeanMonthlyReturnPct: 0.011,
    winsorizedMeanMonthlyReturnPct: 0.01,
    maxDrawdownPct: -0.15,
    maxDrawdownStartMonthKey: '2026-02',
    maxDrawdownTroughMonthKey: '2026-03',
    maxDrawdownRecoveryMonthKey: null,
    currentDrawdownPct: null,
    monthsToRecovery: null,
    isRecovered: false,
    ulcerIndex: 0.123,
    sharpeSimple: 1.11,
    sortinoSimple: null,
    calmarSimple: null,
    warnings: ['monthly_drawdown_only', 'estimated_months_included'],
  })),
}));

import { calculatePortfolioAnalytics } from '../src/services/portfolioAnalytics';
import { PortfolioAnalyticsPanel } from '../src/components/analysis/PortfolioAnalyticsPanel';
import type { MonthlyReturnRow } from '../src/components/analysis/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const makeRow = (monthKey: string, overrides: Partial<MonthlyReturnRow> = {}): MonthlyReturnRow => ({
  monthKey,
  fx: { usdClp: 950, eurClp: 1030, ufClp: 39000 },
  rawEurClp: 1030,
  fxMethod: 'real_closure',
  fxAuditable: true,
  fxMissing: [],
  gastosStatus: 'complete',
  gastosSource: 'gastapp_firestore',
  gastosContractStatus: 'ok',
  gastosDataQuality: 'ok',
  gastosIsStale: false,
  gastosStaleReason: null,
  gastosDayToDaySource: 'period_summaries',
  gastosContractSource: null,
  gastosSchemaVersion: null,
  gastosMethodologyVersion: null,
  gastosPeriodKey: null,
  gastosPublishedAt: null,
  gastosUpdatedAt: null,
  gastosClosedAt: null,
  gastosReportUpdatedAt: null,
  gastosSummaryUpdatedAt: null,
  gastosLastExpenseUpdatedAt: null,
  gastosRevision: null,
  gastosReportTotalEur: null,
  gastosSummaryTotalEur: null,
  gastosDirectExpenseTotalEur: null,
  gastosReportVsDirectDiffEur: null,
  gastosSummaryVsDirectDiffEur: null,
  gastosReportVsSummaryDiffEur: null,
  gastosCategoryGapEur: null,
  netClp: 1,
  prevNetClp: 1,
  invalidNet: false,
  varPatrimonioClp: 1,
  gastosClp: 1,
  retornoRealClp: 1,
  netDisplay: 1,
  prevNetDisplay: 1,
  varPatrimonioDisplay: 1,
  gastosDisplay: 1,
  retornoRealDisplay: 1,
  pct: 1.5,
  inflationMonthlyRate: 0,
  pctReal: 1.2,
  ...overrides,
});

describe('PortfolioAnalyticsPanel', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    vi.clearAllMocks();
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  const renderPanel = async (rows: MonthlyReturnRow[]) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(PortfolioAnalyticsPanel, { monthlyRows: rows }));
    });
  };

  it('renderiza el panel con métricas principales y badges', async () => {
    await renderPanel([
      makeRow('2026-05', { pct: 1.5 }),
      makeRow('2026-06', { pct: 3, isEstimated: true }),
    ]);

    expect(container?.textContent).toContain('Portfolio Analytics');
    expect(container?.textContent).toContain('Oficiales: 1 meses');
    expect(container?.textContent).toContain('Estimados: 1');
    expect(container?.textContent).toContain('Último mes: Junio de 2026 · estimado');
    expect(container?.textContent).toContain('Retorno acumulado');
    expect(container?.textContent).toContain('Volatilidad anualizada');
    expect(container?.textContent).toContain('% meses positivos');
    expect(container?.textContent).toContain('Ulcer Index');
    expect(container?.textContent).toContain('E');
  });

  it('muestra guion cuando una métrica es null y formatea sin NaN', async () => {
    vi.mocked(calculatePortfolioAnalytics).mockReturnValueOnce({
      monthsTotal: 1,
      monthsUsed: 1,
      estimatedMonthsUsed: 0,
      firstMonthKey: '2026-05',
      lastMonthKey: '2026-05',
      lastMonthIsEstimated: false,
      cumulativeReturnPct: null,
      annualizedReturnPct: null,
      averageMonthlyReturnPct: null,
      medianMonthlyReturnPct: null,
      geometricMonthlyReturnPct: null,
      volatilityMonthlyPct: null,
      volatilityAnnualizedPct: null,
      downsideDeviationMonthlyPct: null,
      downsideDeviationAnnualizedPct: null,
      bestMonth: null,
      worstMonth: null,
      positiveMonthsPct: null,
      negativeMonthsPct: null,
      zeroMonthsPct: null,
      percentiles: { p10: null, p25: null, p50: null, p75: null, p90: null },
      trimmedMeanMonthlyReturnPct: null,
      winsorizedMeanMonthlyReturnPct: null,
      maxDrawdownPct: null,
      currentDrawdownPct: null,
      monthsToRecovery: null,
      isRecovered: null,
      ulcerIndex: null,
      sharpeSimple: null,
      sortinoSimple: null,
      calmarSimple: null,
      warnings: [],
    });

    await renderPanel([makeRow('2026-05', { pct: 1.5 })]);

    expect(container?.textContent).not.toContain('NaN');
    expect(container?.textContent).toContain('—');
  });

  it('convierte pct visible a decimal y excluye filas sin retorno visible', async () => {
    await renderPanel([
      makeRow('2026-07', { pct: null, gastosStatus: 'pending' }),
      makeRow('2026-05', { pct: 1.5 }),
      makeRow('2026-06', { pct: 3, isEstimated: true }),
    ]);

    expect(calculatePortfolioAnalytics).toHaveBeenCalledTimes(1);
    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[0]?.[0]).toEqual([
      { monthKey: '2026-05', returnPct: 0.015, isEstimated: false },
      { monthKey: '2026-06', returnPct: 0.03, isEstimated: true },
    ]);
    expect(container?.textContent).not.toContain('Julio de 2026');
  });

  it('muestra metodología y warnings al expandir', async () => {
    await renderPanel([
      makeRow('2026-05', { pct: 1.5 }),
      makeRow('2026-06', { pct: 3, isEstimated: true }),
    ]);

    const user = userEvent.setup();
    const summary = Array.from(container?.querySelectorAll('summary') ?? []).find((node) =>
      node.textContent?.includes('Ver metodología'),
    ) as HTMLElement | undefined;
    expect(summary).toBeTruthy();

    await act(async () => {
      await user.click(summary!);
    });

    expect(container?.textContent).toContain('Drawdown mensual; no captura caídas intra-mes.');
    expect(container?.textContent).toContain('monthly_drawdown_only');
    expect(container?.textContent).toContain('estimated_months_included');
    expect(container?.textContent).toContain('Sharpe simple');
  });
});
