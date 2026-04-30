import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BCHILE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  buildCanonicalClosureSummary,
  resolveClosureSectionAmounts,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../src/services/wealthStorage';

const fx: WealthFxRates = { usdClp: 950, eurClp: 1030, ufClp: 39000 };

const record = (input: Omit<WealthRecord, 'id' | 'snapshotDate' | 'createdAt'> & { id: string }): WealthRecord => ({
  snapshotDate: '2026-04-30',
  createdAt: '2026-04-30T12:00:00Z',
  ...input,
});

const closureFrom = (summary: WealthMonthlyClosure['summary'], records?: WealthRecord[]): WealthMonthlyClosure => ({
  id: 'closure-1',
  monthKey: '2026-04',
  closedAt: '2026-04-30T23:59:59Z',
  summary,
  fxRates: fx,
  ...(records ? { records } : {}),
});

describe('resolveClosureSectionAmounts', () => {
  it('prioriza records canónicos cuando existen', () => {
    const records: WealthRecord[] = [
      record({
        id: 'inv',
        block: 'investment',
        source: 'BTG',
        label: 'BTG total valorizacion',
        amount: 1_000_000,
        currency: 'CLP',
      }),
      record({
        id: 'risk',
        block: 'investment',
        source: 'Manual',
        label: RISK_CAPITAL_LABEL_CLP,
        amount: 200_000,
        currency: 'CLP',
      }),
      record({
        id: 'bank',
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 300_000,
        currency: 'CLP',
      }),
      record({
        id: 'debt-bank',
        block: 'bank',
        source: 'Fintoc',
        label: DEBT_CARD_CLP_LABEL,
        amount: 50_000,
        currency: 'CLP',
      }),
      record({
        id: 're',
        block: 'real_estate',
        source: 'Manual',
        label: 'Valor propiedad',
        amount: 500_000,
        currency: 'CLP',
      }),
      record({
        id: 'mortgage',
        block: 'debt',
        source: 'Banco',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        amount: 120_000,
        currency: 'CLP',
      }),
    ];
    const summary = buildCanonicalClosureSummary(records, fx);
    const closure = closureFrom(summary, records);

    const resolved = resolveClosureSectionAmounts({ closure, includeRiskCapitalInTotals: false });

    expect(resolved.source).toBe('records_canonical');
    expect(resolved.bankClp).toBe(300_000);
    expect(resolved.nonMortgageDebtClp).toBe(50_000);
    expect(resolved.realEstateAssetsClp).toBe(500_000);
    expect(resolved.mortgageDebtClp).toBe(120_000);
    expect(resolved.realEstateNetClp).toBe(380_000);
    expect(resolved.investmentClpWithRisk).toBeGreaterThan(resolved.investmentClp);
    expect(resolved.riskCapitalClp).toBe(200_000);
  });

  it('usa summary extendido cuando no hay records', () => {
    const summary = {
      netByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      assetsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      netConsolidatedClp: 1_200_000,
      byBlock: {
        bank: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
      },
      investmentClp: 700_000,
      investmentClpWithRisk: 800_000,
      bankClp: 200_000,
      nonMortgageDebtClp: 80_000,
      realEstateAssetsClp: 600_000,
      mortgageDebtClp: 220_000,
      realEstateNetClp: 380_000,
      netClp: 1_200_000,
      netClpWithRisk: 1_300_000,
      riskCapitalClp: 100_000,
      analysisByCurrency: {
        clpWithoutRisk: 1_200_000,
        usdWithoutRisk: 0,
        clpWithRisk: 1_300_000,
        usdWithRisk: 10,
        source: 'records' as const,
      },
    } satisfies WealthMonthlyClosure['summary'];
    const resolved = resolveClosureSectionAmounts({
      summary,
      includeRiskCapitalInTotals: true,
    });

    expect(resolved.source).toBe('summary_extended');
    expect(resolved.bankClp).toBe(200_000);
    expect(resolved.nonMortgageDebtClp).toBe(80_000);
    expect(resolved.realEstateNetClp).toBe(380_000);
    expect(resolved.totalNetClp).toBe(1_300_000);
  });

  it('cae a byBlock legacy solo como fallback y reporta warning', () => {
    const legacySummary = {
      netByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      assetsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      netConsolidatedClp: 900_000,
      byBlock: {
        bank: { CLP: 300_000, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 500_000, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 200_000, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: -100_000, USD: 0, EUR: 0, UF: 0 },
      },
    } as WealthMonthlyClosure['summary'];

    const resolved = resolveClosureSectionAmounts({ summary: legacySummary });
    expect(resolved.source).toBe('legacy_byBlock_fallback');
    expect(resolved.warnings).toContain('legacy_byBlock_fallback');
    expect(resolved.bankClp).toBe(300_000);
    expect(resolved.nonMortgageDebtClp).toBe(100_000);
  });
});

