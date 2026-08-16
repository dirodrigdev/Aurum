/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import type { MonthlyReturnRow } from '../src/components/analysis/types';

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

const makeMonthlyRow = (monthKey: string, overrides: Partial<MonthlyReturnRow> = {}): MonthlyReturnRow => ({
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
  netClp: 1_000_000_000,
  prevNetClp: 980_000_000,
  invalidNet: false,
  varPatrimonioClp: 20_000_000,
  gastosClp: 1_400_000,
  retornoRealClp: 21_400_000,
  netDisplay: 1_000_000_000,
  prevNetDisplay: 980_000_000,
  varPatrimonioDisplay: 20_000_000,
  gastosDisplay: 1_400_000,
  retornoRealDisplay: 21_400_000,
  pct: 2.18,
  inflationMonthlyRate: 0.2,
  pctReal: 1.9,
  ...overrides,
});

const makeSummary = (label: string) => ({
  key: label.toLowerCase().replace(/\s+/g, '-'),
  label,
  periodStartMonthKey: '2026-01',
  periodEndMonthKey: '2026-06',
  validMonths: 6,
  coverage: {
    validMonths: 6,
    expectedMonths: 6,
    excludedMonths: [],
    nonApplicableMonths: [],
    status: 'complete' as const,
  },
  varPatrimonioAcumClp: 120_000_000,
  gastosAcumClp: 8_400_000,
  retornoRealAcumClp: 128_400_000,
  varPatrimonioAcumDisplay: 120_000_000,
  gastosAcumDisplay: 8_400_000,
  retornoRealAcumDisplay: 128_400_000,
  pctRetorno: 19.5,
  pctRetornoReal: 15.3,
  pctRetornoNote: null,
  spendPct: 6.5,
  varPatrimonioAvgDisplay: 20_000_000,
  gastosAvgDisplay: 1_400_000,
  retornoRealAvgDisplay: 21_400_000,
});

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

describe('ReturnsTab partial month toggle', () => {
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

  it('renders the Retornos smoke surface with Portfolio Analytics on mobile and desktop widths', async () => {
    for (const width of [390, 1280]) {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          React.createElement(ReturnsTab, {
            ...baseProps,
            monthlyRowsDesc: [makeMonthlyRow('2026-06'), makeMonthlyRow('2026-05')],
            officialMonthlyRowsAsc: [makeMonthlyRow('2026-05'), makeMonthlyRow('2026-06')],
            hasEstimatedMonth: false,
            includeEstimatedMonth: false,
            estimatedMonthMeta: null,
            pendingEstimateDetail: null,
          }),
        );
      });

      expect(container.textContent).toContain('Retorno económico');
      expect(container.textContent).toContain('Historial completo');
      expect(container.textContent).toContain('Portfolio Analytics');
      expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);

      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
      container = null;
      document.body.innerHTML = '';
    }
  });

  it('toggles on desktop by checkbox, label text, full card row, and keyboard', async () => {
    const Harness = () => {
      const [includeEstimatedMonth, setIncludeEstimatedMonth] = React.useState(false);
      return React.createElement(ReturnsTab, {
        ...baseProps,
        includeEstimatedMonth,
        hasEstimatedMonth: true,
        estimatedMonthMeta: {
          monthKey: '2026-06',
          estimateMethod: 'gastapp_partial' as const,
          estimatedSpendClp: 1_500_000,
          estimatedSpendDisplay: 1_500_000,
          estimatedFromMonthsCount: 1,
          officialAvailableDate: null,
          gastosPeriodKey: '2026-06-12__2026-07-11',
          referencePreviousMonthSpendClp: null,
        },
        pendingEstimateDetail: {
          monthKey: '2026-06',
          availabilityLabel: null,
          periodRangeLabel: 'P12',
          varPatrimonioDisplay: 5_000_000,
          selectedScenarioKey: 'gastapp_partial' as const,
          scenarios: [
            {
              key: 'gastapp_partial' as const,
              label: 'Avance real parcial publicado por GastApp',
              spendDisplay: 1_500_000,
              spendClp: 1_500_000,
              retornoRealDisplay: 6_500_000,
              retornoRealClp: 6_500_000,
              pct: 0.8,
              monthsUsed: 1,
            },
          ],
        },
        officialMonthlyRowsAsc: [makeMonthlyRow('2026-05')],
        monthlyRowsDesc: [
          includeEstimatedMonth
            ? makeMonthlyRow('2026-06', {
                isEstimated: true,
                isPartial: true,
                estimateMethod: 'gastapp_partial',
                estimatedSpendClp: 1_500_000,
                estimatedFromMonthsCount: 1,
                officialAvailableDate: null,
                gastosClp: 1_500_000,
                gastosDisplay: 1_500_000,
                retornoRealClp: 6_500_000,
                retornoRealDisplay: 6_500_000,
                pct: 0.8,
              })
            : makeMonthlyRow('2026-05'),
        ],
        onToggleIncludeEstimatedMonth: () => setIncludeEstimatedMonth((prev) => !prev),
      });
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Harness));
    });

    const user = userEvent.setup();
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);
    expect(container.textContent).toContain('Ver detalle');
    expect(container.textContent).toContain('Resumen del tramo');
    expect(container.textContent).toContain('Retorno anualizado');
    expect(container.textContent).not.toContain('% anual equiv.');
    const detail = container.querySelector('details');
    expect(detail).not.toBeNull();
    expect(detail?.hasAttribute('open')).toBe(false);
    const historyTitle = Array.from(container.querySelectorAll('div')).find((node) =>
      node.textContent?.trim() === 'Historial completo',
    );
    const historyCard = historyTitle?.closest('.border-slate-200') as HTMLDivElement | null;
    expect(historyCard).not.toBeNull();
    expect(historyCard?.textContent).not.toContain('Último mes considerado: Mayo de 2026 · oficial');

    await act(async () => {
      await user.click(checkbox!);
    });
    expect(checkbox?.checked).toBe(true);
    expect(container.textContent).toContain('Jun 2026');
    expect((container.querySelectorAll('[aria-label="Parcial incluido"]') ?? []).length).toBeGreaterThanOrEqual(4);
    expect(historyCard?.textContent).not.toContain('Último mes considerado: Junio de 2026 · parcial (P)');

    const titleLabel = Array.from(container.querySelectorAll('label')).find((node) =>
      node.textContent?.includes('Incluir parcial actual (P)'),
    ) as HTMLLabelElement | undefined;
    expect(titleLabel).toBeTruthy();

    await act(async () => {
      await user.click(titleLabel!);
    });
    expect(checkbox?.checked).toBe(false);

    const toggleTitle = Array.from(container.querySelectorAll('label')).find((node) =>
      node.textContent?.includes('Incluir parcial actual (P)'),
    );
    const card = toggleTitle?.closest('.rounded-2xl') as HTMLDivElement | null;
    expect(card).not.toBeNull();

    await act(async () => {
      await user.click(card!);
    });
    expect(checkbox?.checked).toBe(true);
    expect(detail?.hasAttribute('open')).toBe(false);
    const summary = Array.from(container.querySelectorAll('summary')).find((node) =>
      node.textContent?.includes('Ver detalle'),
    ) as HTMLElement | undefined;
    expect(summary).toBeTruthy();

    await act(async () => {
      await user.click(summary!);
    });
    expect(checkbox?.checked).toBe(true);
    expect(container.textContent).toContain('Mes elegible: Junio de 2026 · cierre oficial pendiente de GastApp');
    expect(container.textContent).toContain('Junio de 2026 se incluye como parcial (P) · gasto publicado $1.500.000');
    expect(container.textContent).toContain('Usado: avance parcial real de GastApp.');
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);

    await act(async () => {
      await user.tab();
      await user.tab();
    });
    expect(document.activeElement).toBe(checkbox);
    await act(async () => {
      await user.keyboard('[Space]');
    });
    expect(checkbox?.checked).toBe(false);
  });

  it('shows a visible reason and stays disabled when GastApp has not published a usable partial', async () => {
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
            selectedScenarioKey: null,
            scenarios: [],
          },
          onToggleIncludeEstimatedMonth,
        }),
      );
    });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(true);
    expect(container.textContent).toContain('No disponible: GastApp todavía no publicó un avance parcial utilizable para este mes.');

    const user = userEvent.setup();
    await act(async () => {
      await user.click(checkbox!);
    });
    expect(onToggleIncludeEstimatedMonth).not.toHaveBeenCalled();
  });

  it('shows the last confirmed GastApp close without projecting the retired day-12 availability', async () => {
    const confirmedJuly = makeMonthlyRow('2026-07', {
      gastosContractStatus: 'complete',
      gastosPublishedAt: '2026-08-03T14:30:00.000Z',
    });
    const pendingAugust = makeMonthlyRow('2026-08', {
      gastosStatus: 'pending',
      gastosContractStatus: 'pending',
      gastosDataQuality: 'warning',
      gastosStaleReason: 'partial_boundary_end',
      gastosPeriodKey: '2026-08-12__2026-09-11',
      gastosClp: null,
      gastosDisplay: null,
      retornoRealClp: null,
      retornoRealDisplay: null,
      pct: null,
    });

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
          pendingEstimateDetail: null,
          officialMonthlyRowsAsc: [confirmedJuly, pendingAugust],
          monthlyRowsDesc: [pendingAugust, confirmedJuly],
        }),
      );
    });

    expect(container.textContent).toContain('Agosto de 2026 pendiente de cierre mensual de GastApp');
    expect(container.textContent).not.toContain('Oficial disponible 12');

    const noticesToggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Avisos'),
    );
    expect(noticesToggle).toBeTruthy();
    await act(async () => {
      await userEvent.setup().click(noticesToggle!);
    });

    expect(container.textContent).toContain('El gasto de este mes todavía no tiene un cierre mensual confirmado por GastApp.');
    expect(container.textContent).toContain('Último cierre confirmado por GastApp: Julio de 2026 · registrado');
    expect(container.textContent).toContain('el mes calendario aún está en curso');
    expect(container.textContent).not.toContain('cierre desfasado respecto a movimientos recientes');
    expect(container.textContent).not.toContain('2026-08-12__2026-09-11');
  });

  it('shows (R) only in CLP and explains that it discounts Chilean inflation', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(ReturnsTab, {
          ...baseProps,
          currency: 'CLP',
          heroSinceStart: makeSummary('Desde inicio'),
          heroLast12: makeSummary('Últ. 12M'),
          heroYtd2026: makeSummary('YTD 2026'),
          heroLastMonth: makeSummary('Últ. mes válido'),
          heroLastMonthPctMonthly: 2.2,
          heroLastMonthPctMonthlyReal: 1.7,
          periodSummaries: [makeSummary('12M')],
          yearlySummaries: [makeSummary('2026')],
          monthlyRowsDesc: [makeMonthlyRow('2026-06')],
          officialMonthlyRowsAsc: [makeMonthlyRow('2026-06')],
          hasEstimatedMonth: false,
          includeEstimatedMonth: false,
          estimatedMonthMeta: null,
          pendingEstimateDetail: null,
        }),
      );
    });

    expect(container.textContent).toContain('(R) descuenta inflación chilena');
    expect(container.textContent).toContain('(R) +15,3%');
    expect(container.textContent).toContain('(R)');
  });

  it('hides (R) in USD, EUR, and UF views', async () => {
    for (const currency of ['USD', 'EUR', 'UF'] as const) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          React.createElement(ReturnsTab, {
            ...baseProps,
            currency,
            heroSinceStart: makeSummary('Desde inicio'),
            heroLast12: makeSummary('Últ. 12M'),
            heroYtd2026: makeSummary('YTD 2026'),
            heroLastMonth: makeSummary('Últ. mes válido'),
            heroLastMonthPctMonthly: 2.2,
            heroLastMonthPctMonthlyReal: null,
            periodSummaries: [makeSummary('12M')],
            yearlySummaries: [makeSummary('2026')],
            monthlyRowsDesc: [makeMonthlyRow('2026-06', { pctReal: null })],
            officialMonthlyRowsAsc: [makeMonthlyRow('2026-06', { pctReal: null })],
            hasEstimatedMonth: false,
            includeEstimatedMonth: false,
            estimatedMonthMeta: null,
            pendingEstimateDetail: null,
          }),
        );
      });

      expect(container.textContent).not.toContain('(R)');
      expect(container.textContent).not.toContain('descuenta inflación chilena');

      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
      container = null;
      document.body.innerHTML = '';
    }
  });
});
