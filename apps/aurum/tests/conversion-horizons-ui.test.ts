/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { ConversionHorizonsSection } from '../src/components/closing/ConversionHorizonsSection';
import type { AvailableConversionHorizon } from '../src/services/conversionHorizons';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('conversion horizons UI', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it('renders only available cards with compact periods and opens one complete modal', async () => {
    const result = {
      reportingCurrency: 'CLP' as const,
      previousMonthKey: '2026-01',
      currentMonthKey: '2026-06',
      previousReportedValue: 1_000_000,
      currentReportedValue: 1_100_000,
      currentValueAtPreviousRates: 1_080_000,
      reportedChangeAmount: 100_000,
      reportedChangePct: 0.1,
      constantConversionChangeAmount: 80_000,
      constantConversionChangePct: 0.08,
      conversionEffectAmount: 20_000,
      conversionEffectPctPoints: 0.02,
      ratesUsed: [{ pair: 'USD/CLP' as const, previous: 890, current: 900 }],
      status: 'available' as const,
    };
    const horizons: AvailableConversionHorizon[] = [
      {
        key: '1M',
        label: 'ÚLTIMO MES',
        initialMonthKey: '2026-05',
        finalMonthKey: '2026-06',
        elapsedMonths: 1,
        result: { ...result, previousMonthKey: '2026-05' },
      },
      {
        key: 'SINCE_COMPLETE',
        label: 'DESDE REGISTROS COMPLETOS',
        initialMonthKey: '2026-01',
        finalMonthKey: '2026-06',
        elapsedMonths: 5,
        result,
      },
    ];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(ConversionHorizonsSection, { horizons })));

    expect(container.textContent).toContain('ÚLTIMO MES');
    expect(container.textContent).toContain('DESDE REGISTROS COMPLETOS');
    expect(container.textContent).toContain('Ene 2026 → Jun 2026 · 5 meses');
    expect(container.textContent).not.toMatch(/6 MESES|12 MESES|24 MESES|36 MESES|No disponible/);
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/NaN|null|undefined/);

    const card = container.querySelector('[data-testid="conversion-horizon-SINCE_COMPLETE"]');
    await act(async () => card?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.textContent).toContain('Patrimonio inicial');
    expect(container.textContent).toContain('Final reportado');
    expect(container.textContent).toContain('Final con tasas iniciales');
    expect(container.textContent).toContain('Variación a conversiones constantes');
    expect(container.textContent).toContain('Efecto de conversión');
    expect(container.textContent).toContain('Tasas consideradas');
  });
});
