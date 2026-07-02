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
  calculatePortfolioAnalytics: vi.fn((series: Array<{ monthKey: string; returnPct: number; isEstimated?: boolean }>) => {
    const count = series.length;
    const last = series[series.length - 1];
    return {
      monthsTotal: count,
      monthsUsed: count,
      estimatedMonthsUsed: series.filter((point) => point.isEstimated).length,
      firstMonthKey: series[0]?.monthKey,
      lastMonthKey: last?.monthKey,
      lastMonthIsEstimated: Boolean(last?.isEstimated),
      cumulativeReturnPct: count ? count / 100 : null,
      annualizedReturnPct: count ? count / 200 : null,
      averageMonthlyReturnPct: count ? 0.01 : null,
      medianMonthlyReturnPct: count ? 0.009 : null,
      geometricMonthlyReturnPct: count ? 0.0095 : null,
      volatilityMonthlyPct: count > 1 ? 0.02 : null,
      volatilityAnnualizedPct: count > 1 ? 0.0692820323 : null,
      downsideDeviationMonthlyPct: count > 1 ? 0.01 : null,
      downsideDeviationAnnualizedPct: count > 1 ? 0.0346410161 : null,
      bestMonth: last ? { monthKey: last.monthKey, returnPct: 0.03, isEstimated: Boolean(last.isEstimated) } : null,
      worstMonth: last ? { monthKey: series[0].monthKey, returnPct: -0.02, isEstimated: false } : null,
      positiveMonthsPct: count ? 0.75 : null,
      negativeMonthsPct: count ? 0.25 : null,
      zeroMonthsPct: 0,
      percentiles: count ? { p10: -0.01, p25: 0.002, p50: 0.009, p75: 0.015, p90: 0.025 } : { p10: null, p25: null, p50: null, p75: null, p90: null },
      trimmedMeanMonthlyReturnPct: count ? 0.011 : null,
      winsorizedMeanMonthlyReturnPct: count ? 0.01 : null,
      maxDrawdownPct: count ? -0.15 : null,
      maxDrawdownStartMonthKey: count ? series[0].monthKey : undefined,
      maxDrawdownTroughMonthKey: count ? series[Math.min(1, count - 1)].monthKey : undefined,
      maxDrawdownRecoveryMonthKey: null,
      currentDrawdownPct: count > 1 ? -0.04 : null,
      monthsToRecovery: count > 2 ? 4 : null,
      isRecovered: count > 2 ? true : null,
      ulcerIndex: count > 1 ? 0.123 : null,
      sharpeSimple: count > 1 ? 1.11 : null,
      sortinoSimple: count > 1 ? 1.33 : null,
      calmarSimple: count > 1 ? 0.9 : null,
      warnings: count ? ['monthly_drawdown_only', ...(series.some((point) => point.isEstimated) ? ['estimated_months_included'] : [])] : [],
    };
  }),
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

const buildRows = (count: number, estimatedMonthKey?: string) =>
  Array.from({ length: count }, (_, index) => {
    const year = 2025 + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    return makeRow(monthKey, {
      pct: 1 + index / 10,
      isEstimated: monthKey === estimatedMonthKey,
    });
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

  const renderPanel = async (rows: MonthlyReturnRow[], currency: 'CLP' | 'USD' | 'EUR' | 'UF' = 'CLP') => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(PortfolioAnalyticsPanel, { monthlyRows: rows, currency }));
    });
  };

  it('renderiza moneda actual y contexto compacto sin pills superiores de horizonte', async () => {
    await renderPanel(buildRows(14, '2026-02'), 'USD');

    expect(container?.textContent).toContain('Vista: USD');
    expect(container?.textContent).toContain('3M');
    expect(container?.textContent).toContain('12M');
    expect(container?.textContent).toContain('Inicio');
    expect(container?.textContent).not.toContain('Inicio · 14 meses');
    expect(container?.textContent).not.toContain('Indicador');
  });

  it('renderiza las vistas de moneda CLP, USD, EUR y UF sin valores inválidos', async () => {
    for (const currency of ['CLP', 'USD', 'EUR', 'UF'] as const) {
      await renderPanel(buildRows(6), currency);

      expect(container?.textContent).toContain(`Vista: ${currency}`);
      expect(container?.textContent).not.toMatch(/NaN|Infinity|undefined/);

      if (root) {
        await act(async () => {
          root?.unmount();
        });
      }
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('usa 3M, 12M e Inicio sobre la serie visible actual', async () => {
    await renderPanel(buildRows(14, '2026-02'));

    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls).toHaveLength(3);
    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[0]?.[0]).toHaveLength(3);
    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[1]?.[0]).toHaveLength(12);
    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[2]?.[0]).toHaveLength(14);
    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[0]?.[0].map((point) => point.monthKey)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('respeta el mes estimado visible y no rompe con menos meses que el horizonte', async () => {
    await renderPanel([
      makeRow('2026-04', { pct: 1.2 }),
      makeRow('2026-05', { pct: 1.5 }),
      makeRow('2026-06', { pct: 2.1, isEstimated: true }),
    ]);

    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[0]?.[0]).toEqual([
      { monthKey: '2026-04', returnPct: 0.012, isEstimated: false },
      { monthKey: '2026-05', returnPct: 0.015, isEstimated: false },
      { monthKey: '2026-06', returnPct: 0.021, isEstimated: true },
    ]);
    expect(vi.mocked(calculatePortfolioAnalytics).mock.calls[1]?.[0]).toHaveLength(3);
    expect(container?.textContent).toContain('Estimados: 1');
    expect(container?.textContent).toContain('Último mes: Junio de 2026 · estimado');
  });

  it('muestra guion cuando una métrica es inválida y nunca muestra NaN', async () => {
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
      maxDrawdownStartMonthKey: undefined,
      maxDrawdownTroughMonthKey: undefined,
      maxDrawdownRecoveryMonthKey: undefined,
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

  it('usa headers compactos por bloque y cards separadas por métrica', async () => {
    await renderPanel(buildRows(12));

    expect(container?.querySelector('table')).toBeNull();
    const sectionHeaders = Array.from(container?.querySelectorAll('[data-testid="portfolio-section-header"]') ?? []);
    expect(sectionHeaders.length).toBe(5);
    expect(sectionHeaders[0]?.textContent).toContain('Retorno');
    expect(sectionHeaders[0]?.textContent).toContain('3M');
    expect(sectionHeaders[0]?.textContent).toContain('12M');
    expect(sectionHeaders[0]?.textContent).toContain('Inicio');
    expect(container?.textContent).not.toContain('Indicador');
    expect(container?.querySelectorAll('[data-portfolio-metric-card="true"]').length).toBeGreaterThanOrEqual(16);
    const firstCard = container?.querySelector('[data-portfolio-metric-card="true"]');
    expect(firstCard?.textContent).toContain('Retorno compuesto');
    expect(firstCard?.textContent).toContain('3M');
    expect(firstCard?.textContent).toContain('12M');
    expect(firstCard?.textContent).toContain('Inicio');
  });

  it('prioriza el valor de mejor/peor mes y deja el mes como detalle secundario', async () => {
    await renderPanel(buildRows(12));

    const cards = Array.from(container?.querySelectorAll('[data-portfolio-metric-card="true"]') ?? []);
    const worstMonthCard = cards.find((card) => card.textContent?.includes('Peor mes')) as HTMLElement | undefined;
    const bestMonthCard = cards.find((card) => card.textContent?.includes('Mejor mes')) as HTMLElement | undefined;

    expect(worstMonthCard?.querySelector('[data-testid="portfolio-metric-value"]')?.textContent).toBe('-2,00%');
    expect(worstMonthCard?.querySelector('[data-testid="portfolio-metric-detail"]')?.textContent).toBe('Oct 2025');
    expect(bestMonthCard?.querySelector('[data-testid="portfolio-metric-value"]')?.textContent).toBe('+3,00%');
    expect(bestMonthCard?.querySelector('[data-testid="portfolio-metric-detail"]')?.textContent).toBe('Dic 2025');
  });

  it('simplifica recuperación y muestra hints visuales solo en métricas interpretables', async () => {
    await renderPanel(buildRows(12));

    const cards = Array.from(container?.querySelectorAll('[data-portfolio-metric-card="true"]') ?? []);
    const recoveryCard = cards.find((card) => card.textContent?.includes('Recuperación')) as HTMLElement | undefined;

    expect(recoveryCard?.textContent).toContain('4 meses');
    expect(recoveryCard?.textContent).not.toContain('Recuperado ·');
    expect(container?.querySelectorAll('[data-testid="portfolio-interpretation-hint"]').length).toBeGreaterThan(0);
  });

  it('muestra botón de ayuda por indicador y abre un diálogo accesible', async () => {
    await renderPanel(buildRows(12));

    const user = userEvent.setup();
    const infoButton = container?.querySelector('button[aria-label="Información sobre Retorno compuesto"]') as HTMLButtonElement | null;
    expect(infoButton).not.toBeNull();

    await act(async () => {
      await user.click(infoButton!);
    });

    const dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Mide el retorno acumulado del período componiendo los retornos mensuales.');

    await act(async () => {
      await user.keyboard('[Escape]');
    });

    expect(container?.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('cierra el diálogo con click fuera y con botón cerrar', async () => {
    await renderPanel(buildRows(12));

    const user = userEvent.setup();
    const infoButton = container?.querySelector('button[aria-label="Información sobre Sharpe"]') as HTMLButtonElement | null;
    expect(infoButton).not.toBeNull();

    await act(async () => {
      await user.click(infoButton!);
    });

    let dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const backdrop = dialog?.parentElement as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    await act(async () => {
      await user.click(backdrop!);
    });
    expect(container?.ownerDocument.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      await user.click(infoButton!);
    });
    dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    const closeButton = dialog?.querySelector('button[aria-label="Cerrar ayuda"]') as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    await act(async () => {
      await user.click(closeButton!);
    });
    expect(container?.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('muestra escalas referenciales cuando aplican y no las muestra cuando no aplican', async () => {
    await renderPanel(buildRows(12));

    const user = userEvent.setup();

    const sharpeButton = container?.querySelector('button[aria-label="Información sobre Sharpe"]') as HTMLButtonElement | null;
    await act(async () => {
      await user.click(sharpeButton!);
    });
    let dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Escala referencial');
    expect(dialog?.textContent).toContain('<0 débil');
    expect(dialog?.textContent).toContain('>2 muy bueno');
    expect(dialog?.textContent).toContain('Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.');

    const closeButton = dialog?.querySelector('button[aria-label="Cerrar ayuda"]') as HTMLButtonElement | null;
    await act(async () => {
      await user.click(closeButton!);
    });

    const calmarButton = container?.querySelector('button[aria-label="Información sobre Calmar"]') as HTMLButtonElement | null;
    await act(async () => {
      await user.click(calmarButton!);
    });
    dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('>3 muy bueno');

    await act(async () => {
      await user.click(dialog?.querySelector('button[aria-label="Cerrar ayuda"]') as HTMLButtonElement);
    });

    const ulcerButton = container?.querySelector('button[aria-label="Información sobre Ulcer Index"]') as HTMLButtonElement | null;
    await act(async () => {
      await user.click(ulcerButton!);
    });
    dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Menor = mejor');
    expect(dialog?.textContent).toContain('0–2 muy bajo');

    await act(async () => {
      await user.click(dialog?.querySelector('button[aria-label="Cerrar ayuda"]') as HTMLButtonElement);
    });

    const drawdownButton = container?.querySelector('button[aria-label="Información sobre Máx. drawdown"]') as HTMLButtonElement | null;
    await act(async () => {
      await user.click(drawdownButton!);
    });
    dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('-5% a -10% moderado');
    expect(dialog?.textContent).toContain('< -20% severo');

    await act(async () => {
      await user.click(dialog?.querySelector('button[aria-label="Cerrar ayuda"]') as HTMLButtonElement);
    });

    const compoundButton = container?.querySelector('button[aria-label="Información sobre Retorno compuesto"]') as HTMLButtonElement | null;
    await act(async () => {
      await user.click(compoundButton!);
    });
    dialog = container?.ownerDocument.querySelector('[role="dialog"]');
    expect(dialog?.textContent).not.toContain('Escala referencial');
  });

  it('muestra metodología compacta con nota de composición y warnings del servicio', async () => {
    await renderPanel(buildRows(12, '2025-06'));

    const user = userEvent.setup();
    const summary = Array.from(container?.querySelectorAll('summary') ?? []).find((node) =>
      node.textContent?.includes('Ver metodología'),
    ) as HTMLElement | undefined;

    await act(async () => {
      await user.click(summary!);
    });

    expect(container?.textContent).toContain('Los retornos acumulados y anualizados se calculan de forma compuesta.');
    expect(container?.textContent).toContain('No se usa promedio mensual lineal para calcular retornos de período.');
    expect(container?.textContent).toContain('Las escalas de interpretación son referenciales.');
    expect(container?.textContent).toContain('monthly_drawdown_only');
    expect(container?.textContent).toContain('estimated_months_included');
  });
});
