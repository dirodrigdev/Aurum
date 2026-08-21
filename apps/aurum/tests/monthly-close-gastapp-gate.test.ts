import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { buildMonthlyClosePreflightDiagnostic } from '../src/services/monthlyClosePreflight';
import { type WealthFxRates } from '../src/services/wealthStorage';

const fx: WealthFxRates = { usdClp: 950, eurClp: 1030, ufClp: 39000 };
const targetMonthKey = '2026-08';

const gastappState = (overrides: Record<string, unknown> = {}) => ({
  monthKey: targetMonthKey,
  status: 'complete' as const,
  partialGastosEur: 2400,
  snapshotAvailable: true,
  message: 'Cierre GastApp disponible.',
  sourceChangedAfterClosure: false,
  currentContractHash: 'sha256:current',
  storedContractHash: null,
  ...overrides,
});

const preflight = (gastappExpenseClose: Record<string, unknown>) =>
  buildMonthlyClosePreflightDiagnostic({
    records: [],
    closures: [],
    fxForClose: fx,
    includeRiskCapitalInTotals: false,
    uiMonthKey: targetMonthKey,
    targetMonthKey,
    calendarMonthKey: targetMonthKey,
    investmentInstruments: [],
    // The economic month is closed; this isolates the GastApp gate.
    todayYmd: '2026-09-01',
    gastappExpenseClose: gastappExpenseClose as any,
  });

describe('Aurum ↔ GastApp monthly close gate', () => {
  it('A — blocks an open GastApp month', () => {
    const diagnostic = preflight(gastappState({
      status: 'pending',
      snapshotAvailable: false,
      message: 'GastApp publicó un avance parcial; falta el cierre oficial del mes.',
    }));

    expect(diagnostic.checks.find((check) => check.key === 'gastapp_monthly_close')).toMatchObject({ status: 'fail' });
    expect(diagnostic.decision).toBe('NO_GO_GASTAPP_EXPENSES_PENDING');
  });

  it('B — allows a certified/revised exact calendar month', () => {
    const diagnostic = preflight(gastappState());

    expect(diagnostic.checks.find((check) => check.key === 'gastapp_monthly_close')).toMatchObject({ status: 'ok' });
    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
  });

  it('C — blocks a stale certification even when the row is otherwise complete', () => {
    const diagnostic = preflight(gastappState({
      status: 'stale',
      snapshotAvailable: false,
      message: 'GastApp marcó este mes como stale; no se puede cerrar.',
    }));

    expect(diagnostic.checks.find((check) => check.key === 'gastapp_monthly_close')).toMatchObject({ status: 'fail' });
    expect(diagnostic.decision).toBe('NO_GO_GASTAPP_EXPENSES_PENDING');
  });

  it('D — does not confuse a period or another month with the requested calendar month', () => {
    const diagnostic = preflight(gastappState({
      monthKey: '2026-07',
      message: 'GastApp no publicó un cierre mensual válido para agosto.',
    }));

    expect(diagnostic.checks.find((check) => check.key === 'gastapp_monthly_close')).toMatchObject({ status: 'fail' });
    expect(diagnostic.decision).toBe('NO_GO_GASTAPP_EXPENSES_PENDING');
  });

  it('E — a refreshed certified snapshot is accepted after a previously open cache', () => {
    const cached = preflight(gastappState({
      status: 'pending',
      snapshotAvailable: false,
    }));
    const refreshed = preflight(gastappState({
      currentContractHash: 'sha256:refreshed',
    }));

    expect(cached.decision).toBe('NO_GO_GASTAPP_EXPENSES_PENDING');
    expect(refreshed.decision).toBe('GO_PARA_CERRAR');
    expect(refreshed.gastappExpenseClose?.currentContractHash).toBe('sha256:refreshed');
  });

  it('F — a material change in another month does not invalidate this month-local gate', () => {
    const diagnostic = preflight(gastappState({
      sourceChangedAfterClosure: false,
      storedContractHash: 'sha256:current',
    }));

    expect(diagnostic.checks.find((check) => check.key === 'gastapp_monthly_close')).toMatchObject({ status: 'ok' });
    expect(diagnostic.checks.find((check) => check.key === 'gastapp_monthly_source_changed')).toBeUndefined();
    expect(diagnostic.decision).toBe('GO_PARA_CERRAR');
  });

  it('reports are not inputs to the gate: stale Full/Express metadata cannot unlock an open month', () => {
    const openWithReports = preflight({
      ...gastappState({ status: 'pending', snapshotAvailable: false }),
      full: { stale: false },
      express: { hash: 'sha256:express' },
      periods: [{ periodKey: 'P40', totalEur: 2400 }],
    });
    const certifiedWithStaleFull = preflight({
      ...gastappState(),
      full: { stale: true },
      express: { hash: 'sha256:express' },
      periods: [{ periodKey: 'P40', totalEur: 2400 }],
    });

    expect(openWithReports.decision).toBe('NO_GO_GASTAPP_EXPENSES_PENDING');
    expect(certifiedWithStaleFull.decision).toBe('GO_PARA_CERRAR');
  });
});
