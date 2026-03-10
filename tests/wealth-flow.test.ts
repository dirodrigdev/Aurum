/** @vitest-environment jsdom */
import React, { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import { useWealthDelta } from '../src/hooks/useWealthDelta';
import {
  RISK_CAPITAL_LABEL_CLP,
  applyMortgageAutoCalculation,
  clearWealthDataForFreshStart,
  computeWealthHomeSectionAmounts,
  createMonthlyClosure,
  currentMonthKey,
  fillMissingWithPreviousClosure,
  latestRecordsForMonth,
  loadClosures,
  loadFxRates,
  loadIncludeRiskCapitalInTotals,
  loadWealthRecords,
  localYmd,
  refreshFxRatesFromLive,
  resolveRiskCapitalRecordsForTotals,
  saveFxRates,
  saveIncludeRiskCapitalInTotals,
  saveWealthRecords,
  summarizeWealth,
  upsertInvestmentInstrument,
  upsertWealthRecord,
} from '../src/services/wealthStorage';

const CLOSE_CONFIG_KEY = 'aurum.closing.config.v1';

type ToastState = {
  visible: boolean;
  delta: number;
  reason: string;
};

const HookProbe: React.FC<{ onValue: (state: ToastState) => void }> = ({ onValue }) => {
  const state = useWealthDelta();
  useEffect(() => {
    onValue(state);
  }, [state.visible, state.delta, state.reason, onValue, state]);
  return null;
};

const snapshotNetForMonth = (
  monthKey: string,
  options?: { includeRiskCapital?: boolean; fx?: { usdClp: number; eurClp: number; ufClp: number } },
) => {
  const records = latestRecordsForMonth(loadWealthRecords(), monthKey);
  const includeRiskCapital =
    typeof options?.includeRiskCapital === 'boolean' ? options.includeRiskCapital : loadIncludeRiskCapitalInTotals();
  const recordsForTotals = resolveRiskCapitalRecordsForTotals(records, includeRiskCapital).recordsForTotals;
  const fx = options?.fx || loadFxRates();
  const amounts = computeWealthHomeSectionAmounts(recordsForTotals, fx);
  return {
    totalNetClp: amounts.totalNetClp,
    bank: amounts.bank,
    investment: amounts.investment,
    realEstateNet: amounts.realEstateNet,
    nonMortgageDebt: amounts.nonMortgageDebt,
    records,
  };
};

const seedCurrentMonthBaseData = () => {
  const monthKey = currentMonthKey();
  const snapshotDate = `${monthKey}-15`;

  saveFxRates({ usdClp: 900, eurClp: 1000, ufClp: 40000 });
  saveIncludeRiskCapitalInTotals(true);

  upsertInvestmentInstrument({ label: 'SURA inversión financiera', currency: 'CLP' });
  upsertInvestmentInstrument({ label: 'BTG total valorización', currency: 'CLP' });
  upsertInvestmentInstrument({ label: RISK_CAPITAL_LABEL_CLP, currency: 'CLP' });

  upsertWealthRecord({
    block: 'bank',
    source: 'Fintoc',
    label: 'Banco de Chile CLP',
    amount: 1_000_000,
    currency: 'CLP',
    snapshotDate,
  });
  upsertWealthRecord({
    block: 'bank',
    source: 'Fintoc',
    label: 'Banco de Chile USD',
    amount: 3000,
    currency: 'USD',
    snapshotDate,
  });

  upsertWealthRecord({
    block: 'investment',
    source: 'SURA',
    label: 'SURA inversión financiera',
    amount: 2_000_000,
    currency: 'CLP',
    snapshotDate,
  });
  upsertWealthRecord({
    block: 'investment',
    source: 'BTG',
    label: 'BTG total valorización',
    amount: 1000,
    currency: 'USD',
    snapshotDate,
  });
  upsertWealthRecord({
    block: 'investment',
    source: 'Manual',
    label: RISK_CAPITAL_LABEL_CLP,
    amount: 500_000,
    currency: 'CLP',
    snapshotDate,
  });

  upsertWealthRecord({
    block: 'real_estate',
    source: 'Manual',
    label: 'Valor propiedad',
    amount: 10_000,
    currency: 'UF',
    snapshotDate,
  });
  upsertWealthRecord({
    block: 'debt',
    source: 'Manual',
    label: 'Saldo deuda hipotecaria',
    amount: 5_000,
    currency: 'UF',
    snapshotDate,
  });
  upsertWealthRecord({
    block: 'debt',
    source: 'Manual',
    label: 'Amortización hipotecaria mensual',
    amount: 0,
    currency: 'UF',
    snapshotDate,
  });
  upsertWealthRecord({
    block: 'debt',
    source: 'Tarjetas (cupo usado manual)',
    label: 'Visa Scotia',
    amount: 200_000,
    currency: 'CLP',
    snapshotDate,
  });

  return { monthKey, snapshotDate };
};

describe('Aurum full flow (service-level e2e)', () => {
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    localStorage.clear();
    localStorage.removeItem(CLOSE_CONFIG_KEY);
    await clearWealthDataForFreshStart({ preserveFx: false });
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        rates: { usdClp: 910, eurClp: 1010, ufClp: 40100 },
        source: 'test-backend',
        sources: { usdClp: 'test-usd', eurClp: 'test-eur', ufClp: 'test-uf' },
        fetchedAt: new Date().toISOString(),
      }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('ESCENARIO 1: app vacía -> carga mensual completa -> cierre con records/fx/summary correctos', () => {
    expect(loadWealthRecords()).toHaveLength(0);
    expect(loadClosures()).toHaveLength(0);

    const { monthKey } = seedCurrentMonthBaseData();
    const fx = loadFxRates();
    const monthSnapshot = snapshotNetForMonth(monthKey);

    const expectedBank = 1_000_000 + 3_000 * fx.usdClp;
    const expectedInvestments = 2_000_000 + 1_000 * fx.usdClp + 500_000;
    const expectedRealEstateNet = (10_000 - 5_000) * fx.ufClp;
    const expectedNonMortgageDebt = 200_000;
    const expectedTotal = expectedBank + expectedInvestments + expectedRealEstateNet - expectedNonMortgageDebt;

    expect(monthSnapshot.bank).toBe(expectedBank);
    expect(monthSnapshot.investment).toBe(expectedInvestments);
    expect(monthSnapshot.realEstateNet).toBe(expectedRealEstateNet);
    expect(monthSnapshot.nonMortgageDebt).toBe(expectedNonMortgageDebt);
    expect(monthSnapshot.totalNetClp).toBe(expectedTotal);

    const closure = createMonthlyClosure(monthSnapshot.records, fx, new Date('2026-03-31T18:00:00.000Z'));
    const closures = loadClosures();
    expect(closures).toHaveLength(1);
    expect(closures[0].id).toBe(closure.id);
    expect(closures[0].records?.length || 0).toBeGreaterThan(0);
    expect(closures[0].fxRates).toEqual(fx);

    const expectedSummary = summarizeWealth(monthSnapshot.records, fx);
    expect(closures[0].summary.netConsolidatedClp).toBe(expectedSummary.netConsolidatedClp);
  });

  it('ESCENARIO 2: mes siguiente -> arranque por pasos -> flag persistido y patrimonio base consistente', async () => {
    const seeded = seedCurrentMonthBaseData();
    const baseMonth = seeded.monthKey;
    const baseSnapshot = snapshotNetForMonth(baseMonth);
    createMonthlyClosure(baseSnapshot.records, loadFxRates(), new Date('2026-03-31T18:00:00.000Z'));

    vi.setSystemTime(new Date('2026-04-02T12:00:00.000Z'));
    const nextMonth = currentMonthKey();
    const startedFlagKey = `aurum.month.started.${nextMonth}`;
    expect(localStorage.getItem(startedFlagKey)).toBeNull();

    const previousClosure = loadClosures()[0];
    const previousClosureNet = previousClosure.summary.netConsolidatedClp;

    const beforeCarry = snapshotNetForMonth(nextMonth).totalNetClp;
    const carryResult = fillMissingWithPreviousClosure(nextMonth, localYmd());
    const afterCarry = snapshotNetForMonth(nextMonth).totalNetClp;
    expect(carryResult.added).toBeGreaterThan(0);
    expect(afterCarry - beforeCarry).not.toBeNaN();
    expect(
      latestRecordsForMonth(loadWealthRecords(), nextMonth).some((record) => String(record.note || '').includes('Mes anterior')),
    ).toBe(true);

    const mortgageResult = applyMortgageAutoCalculation(nextMonth, localYmd());
    const afterMortgage = snapshotNetForMonth(nextMonth).totalNetClp;
    expect(mortgageResult.changed).toBeGreaterThanOrEqual(0);
    expect(afterMortgage).not.toBeNaN();

    const fxBefore = loadFxRates();
    const fxResult = await refreshFxRatesFromLive({ force: true });
    const fxAfter = loadFxRates();
    expect(fxResult.rates.usdClp).toBe(910);
    expect(fxAfter.usdClp).toBe(910);
    expect(fxAfter.ufClp).toBe(40100);

    localStorage.setItem(startedFlagKey, '1');
    expect(localStorage.getItem(startedFlagKey)).toBe('1');

    const monthBeforeFxApplied = snapshotNetForMonth(nextMonth, { fx: fxBefore }).totalNetClp;
    expect(monthBeforeFxApplied).toBe(previousClosureNet);

    const monthAfterFxApplied = snapshotNetForMonth(nextMonth, { fx: fxAfter }).totalNetClp;
    expect(monthAfterFxApplied).not.toBeNaN();
  });

  it.skip(
    'ESCENARIO 3: cierre bloqueado por datos vencidos (requiere harness UI de Patrimonio + modal para validar bloqueo visual)',
    () => {
      // No testeable hoy con el stack actual de tests:
      // - runner en Node/jsdom sin @testing-library/react ni harness de navegación UI
      // - evaluateCloseValidation está encapsulado en Patrimonio.tsx (no exportado)
      // Para habilitarlo: agregar una capa de test UI (testing-library) o exponer
      // un helper de validación de cierre testeable desde módulo puro.
    },
  );

  it('ESCENARIO 4: toggle capital de riesgo cambia patrimonio sin llevarlo a 0 y genera delta detectado por useWealthDelta', async () => {
    const { monthKey } = seedCurrentMonthBaseData();
    saveIncludeRiskCapitalInTotals(true);

    const onTotal = snapshotNetForMonth(monthKey, { includeRiskCapital: true }).totalNetClp;
    const offTotalExpected = snapshotNetForMonth(monthKey, { includeRiskCapital: false }).totalNetClp;

    let latestToast: ToastState = { visible: false, delta: 0, reason: '' };
    let root: Root | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(HookProbe, { onValue: (state: ToastState) => (latestToast = state) }));
    });

    await act(async () => {
      saveIncludeRiskCapitalInTotals(false);
      await Promise.resolve();
    });

    const offTotal = snapshotNetForMonth(monthKey, { includeRiskCapital: false }).totalNetClp;
    expect(offTotal).toBe(offTotalExpected);
    expect(offTotal).not.toBe(onTotal);
    expect(offTotal).not.toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(latestToast.visible).toBe(true);
    expect(Math.abs(latestToast.delta)).toBeGreaterThan(0);
    expect(latestToast.reason.length).toBeGreaterThan(0);

    await act(async () => {
      root?.unmount();
    });
  });
});
