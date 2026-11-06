/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const storageMock = vi.hoisted(() => ({
  load: vi.fn(),
  append: vi.fn(),
}));
const liveMock = vi.hoisted(() => ({ resolve: vi.fn() }));
// These storage/UI cases require an official GastApp amount. Zero is an
// explicit certified fixture, not a fallback for missing real expense data.
vi.mock('../src/services/gastosMonthly', () => ({
  resolveGastappMonthlySpend: liveMock.resolve,
}));
const authMock = vi.hoisted(() => ({ uid: 'performance-test-user' }));
vi.mock('../src/services/firebase', () => ({
  db: {},
  getCurrentUid: () => authMock.uid,
  ensureAuthPersistence: async () => undefined,
  isE2EFirebaseEmulatorEnabled: () => false,
}));

vi.mock('../src/services/financialPerformanceStorage', () => ({
  loadFinancialPerformanceConfirmation: storageMock.load,
  appendFinancialPerformanceConfirmation: storageMock.append,
}));

import { LabTab } from '../src/components/analysis/LabTab';
import { FinancialPerformanceSlice } from '../src/components/analysis/FinancialPerformanceSlice';
import { buildWealthLabModel } from '../src/services/wealthLab';
import { buildGastappMonthlyExpenseCloseSnapshot, summarizeWealth, type WealthMonthlyClosure, type WealthRecord } from '../src/services/wealthStorage';

import { setHistoricalGastappSidecarForAnalysis } from '../src/services/historicalGastappSidecar';
import { computeMonthlyRows } from '../src/services/returnsAnalysis';

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
    gastappExpenseClose: buildGastappMonthlyExpenseCloseSnapshot({
      monthKey, calendarMonthKey: monthKey, totalEur: 0, byFamilyEur: { dayToDay: 0, trips: 0, others: 0 },
      canonicalDataHash: `sha256:${'a'.repeat(64)}`, operationalDataHash: `sha256:${'a'.repeat(64)}`,
      operationalRevision: 1, sourceGeneration: 1, monthContractRevision: 1,
      monthContractHash: `sha256:${'b'.repeat(64)}`, contractHash: `sha256:${'b'.repeat(64)}`,
      certificationStatus: 'certified', certificationRevision: 1, certificationHash: `sha256:${'c'.repeat(64)}`,
      contractVersion: 'gastapp-aurum-calendar-months-v2', generatedAt: `${monthKey}-28T12:00:00.000Z`,
    }, fxRates),
  };
};

describe('financial performance confirmation read errors', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    setHistoricalGastappSidecarForAnalysis(null, null);
    storageMock.load.mockRejectedValue(new Error('permission-denied'));
    liveMock.resolve.mockReset().mockImplementation((monthKey: string) => ({ monthKey, status: 'complete', gastosEur: 0, source: 'gastapp_firestore' }));
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
    vi.restoreAllMocks();
  });

  it('uses the accepted sidecar in Returns, Lab and performance without reading a newer live contract', async () => {
    storageMock.load.mockResolvedValue(null);
    liveMock.resolve.mockReturnValue({ monthKey: '2024-08', status: 'complete', gastosEur: 9999, source: 'gastapp_firestore' });
    const closures = [makeClosure('2024-07', 1000000), makeClosure('2024-08', 1100000)];
    for (const closure of closures) closure.fxRates!.eurClp = 1000;
    const snapshot = { ...closures[1].gastappExpenseClose!, totalEur: 104,
      byFamilyEur: { dayToDay: 104, trips: 0, others: 0 },
      amountsByCurrency: { ...closures[1].gastappExpenseClose!.amountsByCurrency, CLP: { total: 104000, dayToDay: 104000, trips: 0, others: 0 } } };
    delete closures[1].gastappExpenseClose;
    setHistoricalGastappSidecarForAnalysis(authMock.uid, {
      schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: {
        '2024-08': { closureId: closures[1].id, snapshot, repairAudit: {
          reason: 'historical_schema_compatibility_reconstruction', reconstructedAt: '2026-11-06T00:00:00Z',
          originalClosureAt: closures[1].closedAt, preFingerprint: 'same', postFingerprint: 'same', sourceContractHash: snapshot.contractHash,
        } },
      },
    });
    const original = structuredClone(closures);
    const lab = buildWealthLabModel(closures).points.find(point => point.monthKey === '2024-08')!;
    expect(lab).toMatchObject({ varPatrimonioClp: 100000, gastosClp: 104000, retornoEconomicoClp: 204000 });
    const row = computeMonthlyRows(closures, false, 'CLP').find(value => value.monthKey === '2024-08')!;
    expect(row.gastosClp).toBe(104000);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(React.createElement(FinancialPerformanceSlice, {
      closures, includeRiskCapital: false, period: { startMonth: '2024-07', endMonth: '2024-08' },
    })));
    expect(container.textContent).toContain('RECONSTRUIDO');
    expect(container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent).not.toBe('—');
    expect(container.textContent).toContain('GastApp automático');
    expect(closures).toEqual(original);
    expect(liveMock.resolve).not.toHaveBeenCalled();
    setHistoricalGastappSidecarForAnalysis(null, null);
    await act(async () => root?.render(React.createElement(FinancialPerformanceSlice, {
      closures: [...closures], includeRiskCapital: false, period: { startMonth: '2024-07', endMonth: '2024-08' },
    })));
    expect(container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent).toBe('—');
    expect(liveMock.resolve).not.toHaveBeenCalled();
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

    expect(storageMock.load).toHaveBeenCalledWith({ startMonth: '2024-07', endMonth: '2024-08' }, { expectedUid: 'performance-test-user', perimeter: 'investment' });
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

  it('reads and saves risk-inclusive confirmations through their own perimeter context', async () => {
    storageMock.load.mockResolvedValue(null);
    storageMock.append.mockImplementation(async (value) => ({ ...value, revision: 1 }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const period = { startMonth: '2024-07', endMonth: '2024-08' };
    await act(async () => root?.render(React.createElement(FinancialPerformanceSlice, {
      closures: [makeClosure('2024-07', 100), makeClosure('2024-08', 110)],
      includeRiskCapital: true, period,
    })));
    expect(storageMock.load).toHaveBeenCalledWith(period, { expectedUid: 'performance-test-user', perimeter: 'investment_with_risk' });
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Lista completa')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('RECONSTRUIDO');
    expect(container.textContent).toContain('GastApp se incorpora automáticamente como retiro del portafolio del mes');
    expect(storageMock.append).not.toHaveBeenCalled();
    const noFlows = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'No hubo otros flujos este mes');
    await act(async () => noFlows?.click());
    expect(storageMock.append).toHaveBeenCalledWith(expect.objectContaining({ perimeter: 'investment_with_risk' }), period,
      { expectedUid: 'performance-test-user', perimeter: 'investment_with_risk' });
    expect(storageMock.append.mock.calls[0][0].positionMovementCompleteness).toBe('no_unrecorded_movements');
    expect(container.textContent).toContain('RECONSTRUIDO');
    expect(container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent).not.toBe('—');
  });

  it('keeps the valid percentage clearly indicative when position movements are unconfirmed', async () => {
    storageMock.load.mockResolvedValue(null);
    storageMock.append.mockImplementation(async (value) => ({ ...value, revision: 1 }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(FinancialPerformanceSlice, {
      closures: [makeClosure('2024-07', 100), makeClosure('2024-08', 110)],
      includeRiskCapital: false, period: { startMonth: '2024-07', endMonth: '2024-08' },
    })));

    const movements = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(movements.checked).toBe(true);
    const completeFlows = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Lista completa');
    expect(completeFlows?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => movements.click());
    const save = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Guardar confirmación');
    await act(async () => save?.click());

    expect(storageMock.append).toHaveBeenCalledWith(
      expect.objectContaining({ flowCompleteness: 'complete', positionMovementCompleteness: 'unconfirmed', flows: [] }),
      { startMonth: '2024-07', endMonth: '2024-08' },
      { expectedUid: 'performance-test-user', perimeter: 'investment' },
    );
    expect(container.textContent).toContain('INDICATIVO');
    expect(container.textContent).toContain('Rentabilidad financiera · INDICATIVA');
    expect(container.textContent).toContain('falta validar movimientos internos de posiciones y atribuciones');
    expect(container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent).toBe('10%');
    expect(container.textContent).not.toContain('RECONSTRUIDO');
  });

  it('withholds the percentage when external flows are incomplete even with an official expense fixture', async () => {
    storageMock.load.mockResolvedValue(null);
    container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
    await act(async()=>root?.render(React.createElement(FinancialPerformanceSlice,{
      closures:[makeClosure('2024-07',100),makeClosure('2024-08',110)],includeRiskCapital:false,period:{startMonth:'2024-07',endMonth:'2024-08'},
    })));
    const incomplete=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Incompleta / no sé');
    await act(async()=>incomplete?.click());
    // A draft is not a new confirmed source. Save the incomplete declaration.
    storageMock.append.mockImplementation(async(value)=>({...value,revision:1}));
    await act(async()=>Array.from(container!.querySelectorAll('button')).find(b=>b.textContent==='Guardar confirmación')?.click());
    expect(container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent).toBe('—');
    expect(container.textContent).toContain('Rentabilidad pendiente de validación');
  });

  it('requires confirmation before replacing entered flows with zero and can discard a draft without writing', async () => {
    const saved = {
      schemaVersion: 1, monthKey: '2024-08', revision: 3,
      flowCompleteness: 'complete', positionMovementCompleteness: 'no_unrecorded_movements',
      flows: [{ id: 'existing', direction: 'aporte', effectiveDate: '2024-08-15', amountClp: 100 }],
    };
    storageMock.load.mockResolvedValue(saved);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(FinancialPerformanceSlice, {
      closures: [makeClosure('2024-07', 1000), makeClosure('2024-08', 1200)],
      includeRiskCapital: false, period: { startMonth: '2024-07', endMonth: '2024-08' },
    })));
    const button = (name: string) => Array.from(container!.querySelectorAll('button')).find(b => b.textContent === name);
    await act(async () => button('No hubo otros flujos este mes')?.click());
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(storageMock.append).not.toHaveBeenCalled();
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
    await act(async () => button('Incompleta / no sé')?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Cambios sin guardar');
    await act(async () => button('Descartar borrador')?.click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Confirmación guardada');
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
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

  it('recovers a failed read and shows the reconstructed initial assumption without writing it', async () => {
    const closures = [makeClosure('2024-07', 1000000), makeClosure('2024-08', 1100000)];
    storageMock.load.mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValueOnce(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(LabTab, {
      model: buildWealthLabModel(closures), closures, includeRiskCapitalInTotals: false, onToggleRiskMode: vi.fn(),
    })));
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Reintentar lectura');
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(storageMock.load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('RECONSTRUIDO');
    expect(container.textContent).not.toContain('No verificable');
    expect(storageMock.append).not.toHaveBeenCalled();
  });

  it('ignores an old period response that finishes after the selected period has changed', async () => {
    let finishFirst!: (value: unknown) => void;
    const firstRead = new Promise(resolve => { finishFirst = resolve; });
    storageMock.load.mockImplementationOnce(() => firstRead).mockResolvedValueOnce({
      schemaVersion: 1, monthKey: '2024-07', revision: 2,
      flowCompleteness: 'complete', positionMovementCompleteness: 'no_unrecorded_movements', flows: [],
    });
    const closures = [makeClosure('2024-06', 900000), makeClosure('2024-07', 1000000), makeClosure('2024-08', 1100000)];
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const renderPeriod = (startMonth: string, endMonth: string) => React.createElement(FinancialPerformanceSlice, {
      key: endMonth, closures, includeRiskCapital: false, period: { startMonth, endMonth },
    });
    await act(async () => root?.render(renderPeriod('2024-07', '2024-08')));
    await act(async () => root?.render(renderPeriod('2024-06', '2024-07')));
    const published = container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent;
    await act(async () => finishFirst({schemaVersion: 1, monthKey: '2024-08', revision: 99, flows: []}));
    expect(container.textContent).toContain('RECONSTRUIDO');
    expect(container.textContent).toContain('revisión 2');
    expect(container.textContent).not.toContain('revisión 99');
    expect(container.querySelector('[data-testid="financial-performance-published-value"]')?.textContent).toBe(published);
  });

  it('preserves the draft while recovering from a failed save', async () => {
    storageMock.load.mockResolvedValue(null);
    storageMock.append.mockRejectedValueOnce(new Error('unavailable'));
    const closures = [makeClosure('2024-07', 1000000), makeClosure('2024-08', 1100000)];
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(React.createElement(LabTab, {
      model: buildWealthLabModel(closures), closures, includeRiskCapitalInTotals: false, onToggleRiskMode: vi.fn(),
    })));
    const movements = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => movements.click());
    const save = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Guardar confirmación');
    await act(async () => save?.click());
    expect(storageMock.append).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('cambios sin guardar');
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Reintentar lectura');
    await act(async () => retry?.click());
    expect(container.textContent).toContain('cambios sin guardar');
    const retrySave = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Guardar confirmación');
    expect(retrySave?.disabled).toBe(false);
    expect(storageMock.append).toHaveBeenCalledTimes(1);
  });

  it('lets the user keep or explicitly discard a draft before changing month', async () => {
    storageMock.load.mockResolvedValue(null);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const closures = [makeClosure('2024-06', 900000), makeClosure('2024-07', 1000000), makeClosure('2024-08', 1100000)];
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(React.createElement(LabTab, {
      model: buildWealthLabModel(closures), closures, includeRiskCapitalInTotals: false, onToggleRiskMode: vi.fn(),
    })));
    const add = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Agregar aporte'));
    await act(async () => add?.click());
    const select = container.querySelector('[aria-label="Mes de cierre"]') as HTMLSelectElement;
    await act(async () => { select.value = '2024-07'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(select.value).toBe('2024-08');
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    confirm.mockReturnValue(true);
    await act(async () => { select.value = '2024-07'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(select.value).toBe('2024-07');
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(storageMock.append).not.toHaveBeenCalled();
  });
});
