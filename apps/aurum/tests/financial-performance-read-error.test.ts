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

import { LabTab } from '../src/components/analysis/LabTab';
import { buildWealthLabModel } from '../src/services/wealthLab';
import { summarizeWealth, type WealthMonthlyClosure, type WealthRecord } from '../src/services/wealthStorage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const makeClosure = (monthKey: string, amount: number): WealthMonthlyClosure => {
  const records: WealthRecord[] = [{
    id: `${monthKey}-fund`,
    block: 'investment',
    source: 'test',
    label: 'Fondo de prueba',
    amount,
    currency: 'CLP',
    snapshotDate: `${monthKey}-28`,
    createdAt: `${monthKey}-28T12:00:00.000Z`,
  }];
  const fxRates = { usdClp: 1000, eurClp: 1100, ufClp: 40000 };
  return {
    id: monthKey,
    monthKey,
    closedAt: `${monthKey}-28T23:59:00.000Z`,
    records,
    fxRates,
    summary: summarizeWealth(records, fxRates),
  };
};

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
    const closures = [makeClosure('2024-07', 1000000), makeClosure('2024-08', 1100000)];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(LabTab, {
          model: buildWealthLabModel(closures),
          closures,
          includeRiskCapitalInTotals: false,
          onToggleRiskMode: vi.fn(),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(storageMock.load).toHaveBeenCalledWith({ startMonth: '2024-07', endMonth: '2024-08' });
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
    expect(storageMock.append).not.toHaveBeenCalled();
  });

  it('does not read or write confirmations when there is no comparable monthly interval', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(LabTab, {
        model: buildWealthLabModel([]),
        closures: [],
        includeRiskCapitalInTotals: false,
        onToggleRiskMode: vi.fn(),
      }));
    });

    expect(container.textContent).toContain('No hay dos cierres detallados consecutivos');
    expect(container.textContent).not.toContain('No verificable');
    expect(storageMock.load).not.toHaveBeenCalled();
    expect(storageMock.append).not.toHaveBeenCalled();
  });
});
