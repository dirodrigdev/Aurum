import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
}));

import {
  BANK_BCHILE_CLP_LABEL,
  BANK_BALANCE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  buildCanonicalClosureSummary,
  computeWealthHomeSectionAmounts,
} from '../src/services/wealthStorage';
import type { WealthRecord } from '../src/services/wealthStorage';

const fxRates = {
  usdClp: 900,
  eurClp: 1000,
  ufClp: 40000,
};

const makeRecord = (
  input: Pick<WealthRecord, 'block' | 'source' | 'label' | 'amount' | 'currency'>,
): WealthRecord => ({
  id: `${input.block}-${input.label}`,
  snapshotDate: '2026-04-30',
  createdAt: '2026-04-30T12:00:00.000Z',
  ...input,
});

describe('canonical closure summary', () => {
  it('persists canonical bank and non-mortgage debt subtotals for new closures', () => {
    const records: WealthRecord[] = [
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: BANK_BCHILE_CLP_LABEL,
        amount: 5_315_725,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Calculado',
        label: BANK_BALANCE_CLP_LABEL,
        amount: 31_486_718,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'bank',
        source: 'Fintoc',
        label: DEBT_CARD_CLP_LABEL,
        amount: 93_256_478,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'investment',
        source: 'BTG',
        label: 'BTG total valorizacion',
        amount: 1_499_488_194,
        currency: 'CLP',
      }),
      makeRecord({
        block: 'real_estate',
        source: 'Manual',
        label: 'Valor propiedad',
        amount: 248_506_886,
        currency: 'CLP',
      }),
    ];

    const summary = buildCanonicalClosureSummary(records, fxRates);

    expect(summary.bankClp).toBe(5_315_725);
    expect(summary.nonMortgageDebtClp).toBe(93_256_478);
    expect(summary.realEstateNetClp).toBe(248_506_886);
    expect(summary.realEstateAssetsClp).toBe(248_506_886);
    expect(summary.mortgageDebtClp).toBe(0);
    expect(summary.netClp).toBe(1_660_054_327);

    const closureLikeAmounts = computeWealthHomeSectionAmounts(records, fxRates);
    expect(summary.bankClp).toBe(closureLikeAmounts.bank);
    expect(summary.nonMortgageDebtClp).toBe(closureLikeAmounts.nonMortgageDebt);
    expect(summary.realEstateNetClp).toBe(closureLikeAmounts.realEstateNet);
    expect(summary.netClp).toBe(closureLikeAmounts.totalNetClp);
  });
});
