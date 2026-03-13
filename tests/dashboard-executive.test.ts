import { describe, expect, it } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';
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

describe('dashboard executive model', () => {
  it('calcula cobertura y margen desde la capacidad sostenible a 40 años', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 1_200_000_000 })],
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
      includeRiskCapitalInTotals: false,
    });
    const withRisk = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 900_000_000, netClpWithRisk: 1_400_000_000 })],
      includeRiskCapitalInTotals: true,
    });

    expect((withRisk.monthlySustainableClp ?? 0)).toBeGreaterThan(withoutRisk.monthlySustainableClp ?? 0);
    expect(withRisk.chips.some((chip) => chip.includes('CapRiesgo'))).toBe(true);
  });

  it('marca falta de base cuando no hay patrimonio confirmado', () => {
    const model = buildExecutiveDashboardModel({
      closures: [makeClosure('2026-02', { netClp: 0 })],
      includeRiskCapitalInTotals: false,
    });

    expect(model.status).toBe('missing_patrimony');
    expect(model.coverageHeadline).toBe('—');
    expect(model.monthlySustainableClp).toBeNull();
  });
});
