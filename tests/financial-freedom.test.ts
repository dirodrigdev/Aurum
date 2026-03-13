import { describe, expect, it } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';
import {
  addMonthsToMonthKey,
  annualRateToMonthlyRate,
  buildCoveragePlan,
  buildDrawdownCurve,
  buildMonthlyWithdrawalPlan,
  calculateCoverageDuration,
  calculateMonthlyWithdrawal,
  resolveFinancialFreedomBase,
} from '../src/services/financialFreedom';

const makeClosure = (
  monthKey: string,
  netClp: number,
  netClpWithRisk?: number,
): WealthMonthlyClosure => ({
  id: monthKey,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59-03:00`,
  summary: {
    netByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: netClp,
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

describe('financialFreedom engine', () => {
  it('convierte tasa anual a tasa mensual compuesta', () => {
    const monthly = annualRateToMonthlyRate(5);
    expect(monthly).toBeGreaterThan(0.004);
    expect(monthly).toBeLessThan(0.0041);
  });

  it('resuelve patrimonio base desde el ultimo cierre confirmado', () => {
    const closures = [
      makeClosure('2026-01', 100_000_000),
      makeClosure('2026-03', 0),
      makeClosure('2026-02', 120_000_000),
    ];
    const base = resolveFinancialFreedomBase(closures, false);
    expect(base.status).toBe('ok');
    expect(base.sourceMonthKey).toBe('2026-02');
    expect(base.patrimonioBaseClp).toBe(120_000_000);
  });

  it('usa netClpWithRisk cuando se solicita modo con CapRiesgo', () => {
    const closures = [makeClosure('2026-02', 120_000_000, 135_000_000)];
    const base = resolveFinancialFreedomBase(closures, true);
    expect(base.status).toBe('ok');
    expect(base.patrimonioBaseClp).toBe(135_000_000);
  });

  it('calcula retiro mensual con tasa 0', () => {
    const result = calculateMonthlyWithdrawal(120_000_000, 0, 10);
    expect(result.status).toBe('ok');
    expect(result.totalMonths).toBe(120);
    expect(result.monthlyWithdrawalClp).toBeCloseTo(1_000_000, 6);
  });

  it('calcula cobertura con tasa 0', () => {
    const result = calculateCoverageDuration(120_000_000, 0, 6_000_000);
    expect(result.status).toBe('ok');
    expect(result.monthsCoverage).toBeCloseTo(20, 6);
    expect(result.yearsCoverage).toBeCloseTo(20 / 12, 6);
  });

  it('detecta el caso no se agota bajo supuesto determinista', () => {
    const result = calculateCoverageDuration(1_000_000_000, 10, 2_000_000);
    expect(result.status).toBe('never_depletes');
    expect(result.message).toContain('No se agota');
  });

  it('genera curva sin dejar patrimonio negativo visualmente', () => {
    const curve = buildDrawdownCurve({
      initialPatrimonyClp: 10_000_000,
      monthlyRate: 0,
      monthlyWithdrawalClp: 3_500_000,
      startMonthKey: '2026-02',
      maxMonths: 12,
    });
    expect(curve.status).toBe('ok');
    expect(curve.curve[curve.curve.length - 1].balanceEndClp).toBe(0);
    expect(curve.curve.every((point) => point.balanceEndClp >= 0)).toBe(true);
  });

  it('calcula monthKey aproximado futuro desde el ultimo cierre confirmado', () => {
    expect(addMonthsToMonthKey('2026-02', 1)).toBe('2026-03');
    expect(addMonthsToMonthKey('2026-02', 14)).toBe('2027-04');
  });

  it('construye plan completo de retiro mensual con curva y mes final', () => {
    const plan = buildMonthlyWithdrawalPlan([makeClosure('2026-02', 240_000_000)], 5, 20, false);
    expect(plan.status).toBe('ok');
    expect(plan.monthlyWithdrawalClp).toBeGreaterThan(0);
    expect(plan.totalMonths).toBe(240);
    expect(plan.approximateEndMonthKey).toBe('2046-02');
    expect(plan.curve.length).toBeGreaterThan(10);
  });

  it('construye plan de cobertura y devuelve mes aproximado final', () => {
    const plan = buildCoveragePlan([makeClosure('2026-02', 240_000_000)], 5, 6_000_000, false);
    expect(plan.status).toBe('ok');
    expect(plan.monthsCoverage).not.toBeNull();
    expect(plan.yearsCoverage).not.toBeNull();
    expect(plan.approximateEndMonthKey).not.toBeNull();
    expect(plan.curve.length).toBeGreaterThan(1);
  });
});
