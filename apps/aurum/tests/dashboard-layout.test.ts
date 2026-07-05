/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as wealthStorage from '../src/services/wealthStorage';

const { warmGastappMonthlyContableMock } = vi.hoisted(() => ({
  warmGastappMonthlyContableMock: vi.fn(async () => {}),
}));

vi.mock('../src/services/wealthStorage', () => ({
  FX_RATES_UPDATED_EVENT: 'fx-updated',
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT: 'risk-updated',
  WEALTH_DATA_UPDATED_EVENT: 'wealth-updated',
  loadClosures: vi.fn(() => [
    { id: '2026-06', monthKey: '2026-06', closedAt: '2026-06-30T00:00:00.000Z', summary: { netClp: 1 }, fxRates: { usdClp: 900, eurClp: 1000, ufClp: 40000 } },
  ]),
  loadFxRates: vi.fn(() => ({ usdClp: 900, eurClp: 1000, ufClp: 40000 })),
  loadIncludeRiskCapitalInTotals: vi.fn(() => false),
  loadWealthRecords: vi.fn(() => []),
  saveIncludeRiskCapitalInTotals: vi.fn(),
}));

vi.mock('../src/services/dashboardExecutive', () => ({
  DASHBOARD_EXECUTIVE_ASSUMPTIONS: {
    lifeBaselineClp: 6_000_000,
    horizonYears: 40,
    annualRatePct: 5,
    sensitivityAnnualRates: [3, 7],
  },
  DASHBOARD_LIFE_BASELINE_CLP: 6_000_000,
  buildExecutiveDashboardModel: vi.fn(() => ({
    status: 'ok',
    lifeBaselineClp: 6_000_000,
    monthlySustainableClp: 8_180_000,
    coverageRatio: 1.36,
    coveragePct: 136,
    marginClp: 2_180_000,
    coverageHeadline: '1,36x',
    coverageLabel: 'Cobertura de vida actual',
    coverageMessage: 'Sostiene tu vida actual',
    coverageTone: 'positive',
    sourceMonthKey: '2026-06',
    includeRiskCapitalInTotals: false,
    alternativeCoverageRatio: 1.18,
    alternativeMonthlySustainableClp: 7_080_000,
    freshness: {
      status: 'ok',
      fresh7dPct: 1,
      aging30dPct: 0,
      stalePct: 0,
      laggards: [],
      riskCapitalExcluded: false,
    },
    capRiskDependence: {
      status: 'ok',
      level: 'Baja',
      activeCoverageRatio: 1.36,
      alternateCoverageRatio: 1.18,
      relativeChangePct: 15.2,
      dependenceSummary: 'Sin CapRiesgo igual alcanza',
      impactRatioDelta: 0.18,
      impactSummary: 'Amplía el colchón',
    },
    heroSensitivity: [
      { annualRatePct: 3, coverageRatio: 1.02, coverageHeadline: '1,02x' },
      { annualRatePct: 7, coverageRatio: 1.74, coverageHeadline: '1,74x' },
    ],
    chips: ['40 años', 'Vida actual', '5% anual'],
    insight: 'Sostiene tu vida actual con margen razonable.',
    cards: {
      sustainable: { label: 'Capacidad sostenible mensual', valueClp: 8_180_000, tone: 'positive', subtitle: 'a 40 años' },
      lifestyle: { label: 'Vida actual mensual', valueClp: 6_000_000, tone: 'neutral', subtitle: 'Base actual' },
      margin: { label: 'Margen sostenible', valueClp: 2_180_000, tone: 'positive', subtitle: 'Te sobra' },
    },
  })),
}));

vi.mock('../src/services/returnsAnalysis', () => ({
  computeMonthlyRows: vi.fn((_closures: unknown, _includeRisk: boolean, currency: string) => [{ currency }]),
  buildTrailingSummary: vi.fn((rows: Array<{ currency: string }>, count: number) => {
    const currency = rows[0]?.currency;
    if (count === 36 && currency === 'USD') return { pctRetorno: 10.6, validMonths: 36 };
    if (count === 36 && currency === 'UF') return { pctRetorno: 10.5, validMonths: 36 };
    if (count === 12 && currency === 'USD') return { pctRetorno: 25.4, validMonths: 12 };
    if (count === 12 && currency === 'UF') return { pctRetorno: 15.3, validMonths: 12 };
    return null;
  }),
}));

vi.mock('../src/services/gastosMonthly', () => ({
  GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT: 'gastapp-source-updated',
  warmGastappMonthlyContable: warmGastappMonthlyContableMock,
}));

import { DashboardAurum } from '../src/pages/DashboardAurum';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('DashboardAurum layout', () => {
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
    vi.clearAllMocks();
  });

  it('renders the executive dashboard in the target order with 36M emphasized before 12M', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(DashboardAurum),
        ),
      );
    });

    const hero = container.querySelector('[data-testid="dashboard-hero"]');
    const returns = container.querySelector('[data-testid="dashboard-returns"]');
    const return36 = container.querySelector('[data-testid="dashboard-return-36m"]');
    const return12 = container.querySelector('[data-testid="dashboard-return-12m"]');
    const position = container.querySelector('[data-testid="dashboard-position"]');
    const insight = container.querySelector('[data-testid="dashboard-insight"]');
    const quality = container.querySelector('[data-testid="dashboard-quality"]');

    expect(container.textContent).toContain('¿Tu patrimonio sostiene tu vida actual?');
    expect(container.textContent).toContain('Rendimiento anualizado compuesto');
    expect(container.textContent).toContain('Tu posición financiera');
    expect(container.textContent).toContain('Insight ejecutivo');
    expect(container.textContent).toContain('Calidad del patrimonio');
    expect(container.textContent).toContain('Frescura patrimonial');

    expect(hero?.compareDocumentPosition(returns as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(returns?.compareDocumentPosition(position as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(position?.compareDocumentPosition(insight as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(insight?.compareDocumentPosition(quality as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(return36?.compareDocumentPosition(return12 as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(return36?.getAttribute('data-emphasis')).toBe('primary');
    expect(return12?.getAttribute('data-emphasis')).toBe('secondary');

    expect(return36?.textContent).toContain('+10,6%');
    expect(return36?.textContent).toContain('+10,5%');
    expect(return12?.textContent).toContain('+25,4%');
    expect(return12?.textContent).toContain('+15,3%');
    expect(return36?.textContent).not.toContain('Retorno anualizado compuesto');
    expect(return12?.textContent).not.toContain('Retorno anualizado compuesto');

    expect(container.textContent).toContain('Capacidad sostenible mensual');
    expect(container.textContent).toContain('Vida actual mensual');
    expect(container.textContent).toContain('Margen sostenible');
    expect(container.textContent).toContain('$8,2MM');
    expect(container.textContent).toContain('$6,0MM');
    expect(container.textContent).toContain('$2,2MM');
  });

  it('refreshes dashboard state on mount and when the window regains focus', async () => {
    const loadClosuresMock = vi.mocked(wealthStorage.loadClosures);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(DashboardAurum),
        ),
      );
    });

    const callsAfterMount = loadClosuresMock.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(2);
    expect(warmGastappMonthlyContableMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(loadClosuresMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('recomputes returns when gastapp monthly source finishes warming', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(DashboardAurum),
        ),
      );
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('gastapp-source-updated'));
    });

    expect(container.textContent).toContain('+10,6%');
    expect(container.textContent).toContain('+25,4%');
  });
});
