/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readHistoricalClosureCloud: vi.fn(),
  previewHistoricalClosureCorrection: vi.fn(),
  prepareHistoricalClosureCorrection: vi.fn(),
  exportHistoricalClosureBackup: vi.fn(),
  downloadHistoricalBackup: vi.fn(),
}));

vi.mock('../src/services/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

vi.mock('../src/services/historicalClosureCorrectionClient', () => ({
  readHistoricalClosureCloud: mocks.readHistoricalClosureCloud,
  previewHistoricalClosureCorrection: mocks.previewHistoricalClosureCorrection,
  prepareHistoricalClosureCorrection: mocks.prepareHistoricalClosureCorrection,
  exportHistoricalClosureBackup: mocks.exportHistoricalClosureBackup,
  downloadHistoricalBackup: mocks.downloadHistoricalBackup,
  applyHistoricalClosureCorrection: vi.fn(),
  previewHistoricalClosureRollback: vi.fn(),
  rollbackHistoricalClosureCorrection: vi.fn(),
}));

vi.mock('../src/services/closureFxRates', () => ({
  loadSuggestedClosureRates: vi.fn(async () => ({
    status: 'available',
    suggestedFxRates: { usdClp: 892.89, eurClp: 1040.06, ufClp: 40610.69 },
    references: {
      usd: { value: 892.89, availability: 'final', effectiveDate: '2026-05-29', source: 'SII' },
      eur: { value: 1040.06, availability: 'final', effectiveDate: '2026-05-29', source: 'BCCh' },
      uf: { value: 40610.69, availability: 'final', effectiveDate: '2026-05-31', source: 'SII' },
    },
    warnings: [],
  })),
}));

import { HistoricalFxCorrectionConsole } from '../src/components/settings/HistoricalFxCorrectionConsole';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cloudRead = {
  monthKey: '2026-05',
  closure: { closedAt: '2026-05-31T23:59:59.000Z', fxRates: { usdClp: 891, eurClp: 1038, ufClp: 40628 } },
  recordCount: 12,
  currencies: ['CLP', 'USD', 'UF'],
  assetCount: 8,
  liabilityCount: 2,
  riskCapitalCount: 1,
  fingerprint: 'fingerprint-may',
  rootFingerprint: 'root',
  rootUpdateTime: '2026-07-12T00:00:00.000Z',
  checkpointCount: 0,
  readAt: '2026-07-12T00:00:00.000Z',
};

describe('historical FX correction console', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const renderConsole = async (email: string) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(React.createElement(HistoricalFxCorrectionConsole, { authEmail: email, onApplied: vi.fn() }));
    });
  };

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('is hidden for non-authorized emails', () => {
    return renderConsole('other@example.com').then(() => expect(container?.innerHTML).toBe(''));
  });

  it('reads May cloud-first, shows references and uses compact right-aligned inputs', async () => {
    mocks.readHistoricalClosureCloud.mockResolvedValue(cloudRead);
    await renderConsole('diegorp.1978@gmail.com');
    await act(async () => (container?.querySelector('button') as HTMLButtonElement).click());

    expect(mocks.readHistoricalClosureCloud).toHaveBeenCalledWith('2026-05');
    expect(container?.textContent).toContain('Referencia de cierre · 2026-05-29');
    const usd = container?.querySelector('[aria-label="USD/CLP propuesta"]') as HTMLInputElement;
    expect(usd.className).toContain('w-24');
    expect(usd.className).toContain('text-right');
    expect(usd.value).toBe('892.89');
  });

  it('invalidates a prior preview when an FX rate is edited', async () => {
    mocks.readHistoricalClosureCloud.mockResolvedValue(cloudRead);
    mocks.previewHistoricalClosureCorrection.mockResolvedValue({
      monthKey: '2026-05', economicDate: '2026-05-31', recordCount: 12,
      currentFxRates: cloudRead.closure.fxRates, proposedFxRates: cloudRead.closure.fxRates,
      exposureNetByCurrency: { CLP: 1, USD: 2, EUR: 0, UF: 0 },
      withoutRisk: { before: 100, after: 101, difference: 1, differencePct: 0.01 },
      withRisk: { before: 110, after: 111, difference: 1, differencePct: 0.009 },
      presentation: {}, reconciliation: { beforeWithoutRisk: true, beforeWithRisk: true, after: true },
      fingerprint: 'fingerprint-may', consumers: { derivedAutomatically: ['Cierres / Evolución'], notModified: ['Patrimonio vivo'] },
    });
    await renderConsole('diegorp.1978@gmail.com');
    await act(async () => (container?.querySelector('button') as HTMLButtonElement).click());
    const calculate = [...(container?.querySelectorAll('button') || [])].find((button) => button.textContent === 'Calcular impacto') as HTMLButtonElement;
    await act(async () => calculate.click());
    expect(container?.textContent).toContain('Preview de impacto');
    const usd = container?.querySelector('[aria-label="USD/CLP propuesta"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(usd, { target: { value: '900' } });
    });
    expect(container?.textContent).not.toContain('Preview de impacto');
    expect(container?.textContent).toContain('Origen de propuesta: Manual');
  });
});
