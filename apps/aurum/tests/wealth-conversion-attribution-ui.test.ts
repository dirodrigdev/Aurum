/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import {
  MonthlyConversionAttributionLine,
  MonthlyConversionAttributionModal,
} from '../src/components/patrimonio/MonthlyConversionAttribution';
import type { ConversionAttributionResult } from '../src/services/monthlyConversionAttribution';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const result: ConversionAttributionResult = {
  reportingCurrency: 'USD',
  previousMonthKey: '2026-05',
  currentMonthKey: '2026-06',
  previousReportedValue: 1_000_000,
  currentReportedValue: 980_000,
  currentValueAtPreviousRates: 1_030_000,
  reportedChangeAmount: -20_000,
  reportedChangePct: -0.02,
  constantConversionChangeAmount: 30_000,
  constantConversionChangePct: 0.03,
  conversionEffectAmount: -50_000,
  conversionEffectPctPoints: -0.05,
  ratesUsed: [
    { pair: 'USD/CLP', previous: 900, current: 990 },
    { pair: 'UF/CLP', previous: 40_000, current: 41_000 },
  ],
  status: 'available',
};

describe('wealth conversion attribution UI', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const renderIntoDom = async (element: React.ReactNode) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(element));
  };

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it('shows the compact line in all reporting currencies', async () => {
    for (const reportingCurrency of ['CLP', 'USD', 'EUR', 'UF'] as const) {
      await renderIntoDom(
        React.createElement(MonthlyConversionAttributionLine, {
          result: { ...result, reportingCurrency },
          onOpen: () => undefined,
        }),
      );
      expect(container?.textContent).toContain('-2,0% reportado · +3,0% a conversiones constantes');
      await act(async () => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('opens one dialog containing results and rates with no second interaction', async () => {
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(MonthlyConversionAttributionLine, {
          result,
          onOpen: () => setOpen(true),
        }),
        open
          ? React.createElement(MonthlyConversionAttributionModal, {
              result,
              onClose: () => setOpen(false),
            })
          : null,
      );
    };
    await renderIntoDom(React.createElement(Harness));
    const trigger = container?.querySelector('[data-testid="monthly-conversion-attribution-line"]');
    await act(async () => trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container?.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container?.textContent).toContain('Explicación de la variación mensual');
    expect(container?.textContent).toContain('Variación reportada');
    expect(container?.textContent).toContain('Variación a conversiones constantes');
    expect(container?.textContent).toContain('Efecto de conversión');
    expect(container?.textContent).toContain('Tasas consideradas');
    expect(container?.textContent).toContain('USD/CLP');
    expect(container?.textContent).not.toMatch(/inversiones|bancos|bienes raíces|deuda/i);
  });

  it('renders nothing when attribution is unavailable', async () => {
    await renderIntoDom(
      React.createElement(MonthlyConversionAttributionLine, {
        result: { ...result, status: 'unavailable', unavailableReason: 'missing fx' },
        onOpen: () => undefined,
      }),
    );
    expect(container?.innerHTML).toBe('');
  });
});
