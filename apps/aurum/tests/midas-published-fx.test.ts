import { describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

vi.mock('../src/services/firebase', () => ({
  auth: { currentUser: null },
}));

const { prepareAurumOptimizableInvestmentsSnapshot } = await import('../src/services/midasPublished');

const makeClosure = (usdClp: number): WealthMonthlyClosure => ({
  id: 'c1',
  monthKey: '2026-03',
  closedAt: '2026-03-31T23:59:59.000Z',
  summary: {
    netByCurrency: { CLP: 1_000_000_000, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: 1_050_000_000, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 50_000_000, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: 1_000_000_000,
    byBlock: {
      bank: { CLP: 120_000_000, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: 650_000_000, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 280_000_000, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: -50_000_000, USD: 0, EUR: 0, UF: 0 },
    },
    investmentClp: 650_000_000,
    netClp: 1_000_000_000,
  },
  fxRates: {
    usdClp,
    eurClp: 1_050,
    ufClp: 38_500,
  },
  records: [],
});

describe('midasPublished fxReference source-of-truth', () => {
  it('uses active FX rates when provided (UI-visible value)', () => {
    const closure = makeClosure(985);
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure], {
      activeFxRates: { usdClp: 886, eurClp: 1_020, ufClp: 38_300 },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.fxReference?.clpUsd).toBe(886);
    expect(prepared.snapshot.fxReference?.source).toBe('active_fx_rates');
  });

  it('falls back to closure FX when active FX is absent', () => {
    const closure = makeClosure(985);
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.fxReference?.clpUsd).toBe(985);
    expect(prepared.snapshot.fxReference?.source).toBe('closure_fxRates');
  });
});
