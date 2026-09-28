/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const storageMock = vi.hoisted(() => ({
  load: vi.fn(),
  append: vi.fn(),
}));

vi.mock('../src/services/financialPerformanceStorage', () => ({
  loadFinancialPerformanceConfirmation: storageMock.load,
  appendFinancialPerformanceConfirmation: storageMock.append,
}));

vi.mock('../src/services/wealthLab', () => ({
  selectWealthLabPeriod: () => ({
    currentPeriodLabel: '2026-08',
    headlineMetrics: null,
    points: [],
    realMonths: 0,
    fxComparableMonths: 0,
    label: 'Último mes',
  }),
}));

import { LabTab } from '../src/components/analysis/LabTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('financial performance confirmation read errors', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    storageMock.load.mockRejectedValue(new Error('permission-denied'));
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
    storageMock.load.mockReset();
    storageMock.append.mockReset();
  });

  it('stops loading, reports the read error, and does not publish a return', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(LabTab, {
          model: { points: [] } as never,
          closures: [],
          includeRiskCapitalInTotals: false,
          onToggleRiskMode: vi.fn(),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No pudimos verificar la confirmación guardada');
    expect(container.textContent).toContain('No verificable');
    expect(container.textContent).not.toContain('Cargando confirmación…');
    expect(container.textContent).not.toContain('Rentabilidad financiera');

    const validationSummary = Array.from(container.querySelectorAll('summary'))
      .find((summary) => summary.textContent?.includes('Completar validación del período'));
    expect(validationSummary).toBeDefined();
    await act(async () => validationSummary?.click());
    expect(Array.from(container.querySelectorAll('[role="alert"]'))
      .some((alert) => alert.textContent?.includes('permission-denied'))).toBe(true);
  });
});
