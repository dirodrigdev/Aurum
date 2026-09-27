import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));
vi.mock('../src/services/returnsAnalysis', () => ({
  computeMonthlyRows: vi.fn(() => []),
  buildTrailingSummary: vi.fn(() => null),
}));

import { buildTrailingSummary } from '../src/services/returnsAnalysis';
import { buildAurumPresentationModel } from '../src/services/presentationAurumModel';
import type { WealthFxRates, WealthMonthlyClosure, WealthRecord } from '../src/services/wealthStorage';

const fx: WealthFxRates = { usdClp: 900, eurClp: 1000, ufClp: 38000 };
const closure = (monthKey: string, amounts = { investment: 400, bank: 300, house: 300, debt: 100 }): WealthMonthlyClosure => ({
  id: `private-${monthKey}`,
  monthKey,
  closedAt: `${monthKey}-28T12:00:00Z`,
  summary: {
    investmentClp: amounts.investment,
    investmentClpWithRisk: amounts.investment + 100,
    bankClp: amounts.bank,
    realEstateAssetsClp: amounts.house,
    mortgageDebtClp: amounts.debt,
    realEstateNetClp: amounts.house - amounts.debt,
    nonMortgageDebtClp: 0,
    netClp: amounts.investment + amounts.bank + amounts.house - amounts.debt,
    netClpWithRisk: amounts.investment + amounts.bank + amounts.house - amounts.debt + 100,
    riskCapitalClp: 100,
  } as WealthMonthlyClosure['summary'],
});
const build = (closures: WealthMonthlyClosure[], records: WealthRecord[] = [], includeRiskCapitalInTotals = false) =>
  buildAurumPresentationModel({ closures, records, fx, includeRiskCapitalInTotals, now: new Date('2026-09-26T12:00:00Z') });

beforeEach(() => vi.mocked(buildTrailingSummary).mockReturnValue(null));

describe('Aurum privacy-safe presentation model', () => {
  it('uses one confirmed closure and assets alone as the composition denominator', () => {
    const model = build([closure('2026-07', { investment: 200, bank: 300, house: 500, debt: 400 }), closure('2026-08')]);
    expect(model.assetShares).toEqual([
      { block: 'inversiones', pct: 40 },
      { block: 'bancos', pct: 30 },
      { block: 'vivienda', pct: 30 },
    ]);
    expect(model.assetShares.reduce((sum, item) => sum + item.pct, 0)).toBeCloseTo(100);
    expect(model.closurePeriodLabel).toMatch(/agosto.*2026/i);
    expect(model.riskCapitalScope).toBe('excluido');
    expect(JSON.stringify(model)).not.toMatch(/private|investmentClp|netClp|debt|usdClp|\$|900/);
  });

  it('does not invent a composition from an unreliable legacy closure', () => {
    const old = closure('2026-08');
    old.summary = { byBlock: { investment: { CLP: 123 }, bank: { CLP: 456 } } } as WealthMonthlyClosure['summary'];
    const model = build([old]);
    expect(model.assetShares).toEqual([]);
    expect(model.closurePeriodLabel).toBeNull();
    expect(model.conclusions.structure).toContain('Aún no hay');
  });

  it('shows the 36-month annualized UF return only with complete coverage', () => {
    vi.mocked(buildTrailingSummary).mockReturnValue({ validMonths: 24, coverage: { status: 'partial' }, pctRetorno: 12.3 } as ReturnType<typeof buildTrailingSummary>);
    expect(build([closure('2026-08')]).return36mUfPct).toBeNull();
    vi.mocked(buildTrailingSummary).mockReturnValue({ validMonths: 36, coverage: { status: 'complete' }, pctRetorno: 4.26 } as ReturnType<typeof buildTrailingSummary>);
    const model = build([closure('2026-08')]);
    expect(model.return36mUfPct).toBe(4.3);
    expect(model.returnValidMonths).toBe(36);
  });

  it('keeps absent inputs absent and derives freshness from existing records', () => {
    expect(build([]).status).toBe('empty');
    expect(build([]).fresh7dPct).toBeNull();
    const record: WealthRecord = {
      id: 'secret-position', block: 'investment', source: 'manual', label: 'BTG total valorización',
      amount: 100, currency: 'CLP', snapshotDate: '2026-09-26', createdAt: '2026-09-26T09:00:00Z',
    };
    const model = build([], [record]);
    expect(model.fresh7dPct).toBe(100);
    expect(JSON.stringify(model)).not.toContain('secret-position');
  });
});
