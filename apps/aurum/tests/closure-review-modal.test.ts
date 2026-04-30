import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  ensureAuthPersistence: vi.fn(async () => undefined),
  getCurrentUid: vi.fn(() => null),
}));

import { computeClosureSummary } from '../src/components/settings/ClosureReviewModal';
import {
  BANK_BCHILE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  buildCanonicalClosureSummary,
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

const baseClosure = (input: {
  summary: WealthMonthlyClosure['summary'];
  records?: WealthRecord[];
}): WealthMonthlyClosure => ({
  id: 'closure-review',
  monthKey: '2026-04',
  closedAt: '2026-04-30T23:59:59Z',
  fxRates: fx,
  ...input,
});

describe('ClosureReviewModal summary source', () => {
  it('usa records canónicos para review cuando existen', () => {
    const records: WealthRecord[] = [
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
        id: 'investment',
        block: 'investment',
        source: 'BTG',
        label: 'BTG total valorizacion',
        amount: 1_000_000,
        currency: 'CLP',
      }),
    ];
    const summary = {
      ...buildCanonicalClosureSummary(records, fx),
      byBlock: {
        bank: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 999_999, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      },
    };

    const resolved = computeClosureSummary(baseClosure({ summary, records }));

    expect(resolved.source).toBe('records_canonical');
    expect(resolved.bankClp).toBe(300_000);
    expect(resolved.nonMortgageDebtClp).toBe(50_000);
  });

  it('prefiere summary extendido antes que byBlock cuando no hay records', () => {
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
      investmentClpWithRisk: 700_000,
      bankClp: 200_000,
      nonMortgageDebtClp: 80_000,
      realEstateAssetsClp: 600_000,
      mortgageDebtClp: 220_000,
      realEstateNetClp: 380_000,
      netClp: 1_200_000,
      netClpWithRisk: 1_200_000,
    } as WealthMonthlyClosure['summary'];

    const resolved = computeClosureSummary(baseClosure({ summary }));

    expect(resolved.source).toBe('summary_extended');
    expect(resolved.bankClp).toBe(200_000);
    expect(resolved.nonMortgageDebtClp).toBe(80_000);
    expect(resolved.realEstateNetClp).toBe(380_000);
  });

  it('usa byBlock solo como fallback legacy y lo advierte', () => {
    const summary = {
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

    const resolved = computeClosureSummary(baseClosure({ summary }));

    expect(resolved.source).toBe('legacy_byBlock_fallback');
    expect(resolved.warnings).toContain('legacy_byBlock_fallback');
    expect(resolved.bankClp).toBe(300_000);
    expect(resolved.nonMortgageDebtClp).toBe(100_000);
  });
});
