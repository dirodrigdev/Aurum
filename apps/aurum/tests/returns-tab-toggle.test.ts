/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

vi.mock('../src/services/gastosMonthly', () => ({
  getGastappMonthlyRuntimeDiagnostic: vi.fn(() => ({
    status: 'idle',
    mode: 'unconfigured',
    error: null,
    errorCode: null,
    docsLoaded: 0,
    lastUpdatedAt: null,
  })),
}));

import { ReturnsTab } from '../src/components/analysis/ReturnsTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const emptyCurveModel = {
  status: 'empty' as const,
  points: [],
  markers: [],
  domainMin: null,
  domainMax: null,
};

const baseProps = {
  heroSinceStart: null,
  heroLast12: null,
  heroYtd2026: null,
  heroLastMonth: null,
  heroLastMonthPctMonthly: null,
  heroLastMonthPctMonthlyReal: null,
  currency: 'CLP' as const,
  includeRiskCapitalInTotals: false,
  onToggleRiskMode: () => undefined,
  crpContributionInsight: null,
  analysisDiagnostics: {
    anomalyRaw: null,
  },
  fxExcludedMonths: [],
  officialMonthlyRowsAsc: [],
  monthlyRowsDesc: [],
  periodSummaries: [],
  yearlySummaries: [],
  wealthEvolutionModel: {
    source: 'returns_analysis_closures' as const,
    baseMonth: null,
    missingFxMonths: [],
    missingUfMonths: [],
    suspiciousUfMonths: [],
    hasIncompleteConversion: false,
    points: [],
    clpSeries: emptyCurveModel,
    ufSeries: emptyCurveModel,
    usdSeries: emptyCurveModel,
    eurSeries: emptyCurveModel,
    ufTrendSeries: emptyCurveModel,
    base100Series: {
      CLP: emptyCurveModel,
      USD: emptyCurveModel,
      EUR: emptyCurveModel,
      UF: emptyCurveModel,
    },
  },
  onExportConsolidatedDataRoom: () => undefined,
  onExportTransactionalDataRoom: () => undefined,
  exportMessage: '',
  exportingConsolidatedDataRoom: false,
  exportingTransactionalDataRoom: false,
  officialAvailabilityNotice: null,
};

describe('ReturnsTab estimated month toggle', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
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

  it('toggles when clicking the checkbox and its label row', async () => {
    const Harness = () => {
      const [includeEstimatedMonth, setIncludeEstimatedMonth] = React.useState(false);
      return React.createElement(ReturnsTab, {
        ...baseProps,
        includeEstimatedMonth,
        hasEstimatedMonth: true,
        estimatedMonthMeta: {
          monthKey: '2026-06',
          estimateMethod: 'avg_available_closed' as const,
          estimatedSpendClp: 1_500_000,
          estimatedSpendDisplay: 1_500_000,
          estimatedFromMonthsCount: 6,
          officialAvailableDate: null,
          gastosPeriodKey: '2026-06-12__2026-07-11',
          referencePreviousMonthSpendClp: 1_400_000,
        },
        pendingEstimateDetail: {
          monthKey: '2026-06',
          availabilityLabel: null,
          periodRangeLabel: 'P12',
          varPatrimonioDisplay: 5_000_000,
          scenarios: [
            {
              key: 'closed_average' as const,
              label: 'Promedio disponible cerrado (6 meses)',
              spendDisplay: 1_500_000,
              spendClp: 1_500_000,
              retornoRealDisplay: 6_500_000,
              retornoRealClp: 6_500_000,
              pct: 0.8,
              monthsUsed: 6,
            },
          ],
        },
        onToggleIncludeEstimatedMonth: () => setIncludeEstimatedMonth((prev) => !prev),
      });
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);

    await act(async () => {
      checkbox?.click();
    });
    expect(checkbox?.checked).toBe(true);

    const label = Array.from(container.querySelectorAll('label')).find((node) =>
      node.textContent?.includes('Incluir último mes estimado (E)'),
    ) as HTMLLabelElement | undefined;
    expect(label).toBeTruthy();

    await act(async () => {
      label?.click();
    });
    expect(checkbox?.checked).toBe(false);
  });

  it('shows a visible reason and stays disabled when the month is not estimable yet', async () => {
    const onToggleIncludeEstimatedMonth = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(ReturnsTab, {
          ...baseProps,
          includeEstimatedMonth: false,
          hasEstimatedMonth: false,
          estimatedMonthMeta: null,
          pendingEstimateDetail: {
            monthKey: '2026-06',
            availabilityLabel: null,
            periodRangeLabel: 'P12',
            varPatrimonioDisplay: 5_000_000,
            scenarios: [
              {
                key: 'previous_closed' as const,
                label: 'Gasto del mes anterior cerrado (2026-05)',
                spendDisplay: 1_400_000,
                spendClp: 1_400_000,
                retornoRealDisplay: 6_400_000,
                retornoRealClp: 6_400_000,
                pct: 0.78,
                monthsUsed: 1,
              },
            ],
          },
          onToggleIncludeEstimatedMonth,
        }),
      );
    });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(true);
    expect(container.textContent).toContain('No disponible todavía');

    await act(async () => {
      checkbox?.click();
    });
    expect(onToggleIncludeEstimatedMonth).not.toHaveBeenCalled();
  });
});
