import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure, WealthRecord } from '../src/services/wealthStorage';
import {
  DASHBOARD_LIFE_BASELINE_CLP,
  buildExecutiveDashboardModel,
} from '../src/services/dashboardExecutive';

type ClosureOpts = {
  netClp: number;
  netClpWithRisk?: number;
};

const makeClosure = (monthKey: string, { netClp, netClpWithRisk }: ClosureOpts): WealthMonthlyClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59-03:00`,
  summary: {
    netByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: netClpWithRisk ?? netClp, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: netClpWithRisk ?? netClp,
    byBlock: {
      bank: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    },
    netClp,
    netClpWithRisk: netClpWithRisk ?? netClp,
  },
});

const DEFAULT_FX = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
};

const makeRecord = ({
  id,
  label,
  amount,
  currency = 'CLP',
  createdAt,
}: {
  id: string;
  label: string;
  amount: number;
  currency?: 'CLP' | 'USD' | 'EUR' | 'UF';
  createdAt: string;
}): WealthRecord => ({
  id,
  block: 'investment',
  source: 'manual',
  label,
  amount,
  currency,
  snapshotDate: '2026-02-28',
  createdAt,
});

describe('dashboard executive model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calcula cobertura y margen desde la capacidad sostenible a 40 años', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 1_200_000_000 })],
      records: [],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: false,
    });

    expect(model.status).toBe('ok');
    expect(model.monthlySustainableClp).toBeGreaterThan(0);
    expect(model.coverageRatio).toBeCloseTo((model.monthlySustainableClp ?? 0) / DASHBOARD_LIFE_BASELINE_CLP, 8);
    expect(model.marginClp).toBeCloseTo((model.monthlySustainableClp ?? 0) - DASHBOARD_LIFE_BASELINE_CLP, 8);
  });

  it('usa el patrimonio con CapRiesgo cuando el modo global está activo', () => {
    const withoutRisk = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 900_000_000, netClpWithRisk: 1_400_000_000 })],
      records: [],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: false,
    });
    const withRisk = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 900_000_000, netClpWithRisk: 1_400_000_000 })],
      records: [],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: true,
    });

    expect((withRisk.monthlySustainableClp ?? 0)).toBeGreaterThan(withoutRisk.monthlySustainableClp ?? 0);
    expect(withRisk.chips.some((chip) => chip.includes('CapRiesgo'))).toBe(true);
  });

  it('marca falta de base cuando no hay patrimonio confirmado', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 0 })],
      records: [],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: false,
    });

    expect(model.status).toBe('missing_patrimony');
    expect(model.coverageHeadline).toBe('—');
    expect(model.monthlySustainableClp).toBeNull();
  });

  it('pondera la frescura por valor patrimonial y no por cantidad de registros', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 1_200_000_000 })],
      records: [
        makeRecord({
          id: 'fresh-big',
          label: 'BTG total valorización',
          amount: 900_000_000,
          createdAt: '2026-03-10T09:00:00Z',
        }),
        makeRecord({
          id: 'stale-small',
          label: 'SURA ahorro previsional',
          amount: 100_000_000,
          createdAt: '2026-01-15T09:00:00Z',
        }),
      ],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: false,
    });

    expect(model.freshness.status).toBe('ok');
    expect(model.freshness.fresh7dPct).toBeCloseTo(0.9, 8);
    expect(model.freshness.stalePct).toBeCloseTo(0.1, 8);
  });

  it('clasifica dependencia de CapRiesgo como alta cuando cambia la conclusión principal', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 850_000_000, netClpWithRisk: 1_400_000_000 })],
      records: [],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: true,
    });

    expect(model.capRiskDependence.status).toBe('ok');
    expect(model.capRiskDependence.level).toBe('Alta');
    expect(model.coverageMessage).toBe('Depende demasiado de CapRiesgo');
  });

  it('usa la frescura como insight cuando alcanza pero la foto está desactualizada', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 1_400_000_000, netClpWithRisk: 1_400_000_000 })],
      records: [
        makeRecord({
          id: 'stale-heavy',
          label: 'BTG total valorización',
          amount: 900_000_000,
          createdAt: '2026-01-01T09:00:00Z',
        }),
        makeRecord({
          id: 'fresh-light',
          label: 'SURA ahorro previsional',
          amount: 100_000_000,
          createdAt: '2026-03-11T09:00:00Z',
        }),
      ],
      fx: DEFAULT_FX,
      includeRiskCapitalInTotals: false,
    });

    expect(model.coverageRatio).not.toBeNull();
    expect(model.coverageRatio!).toBeGreaterThan(1);
    expect(model.capRiskDependence.level).not.toBe('Alta');
    expect(model.insight).toBe('La foto patrimonial todavía es dispareja.');
  });
});
