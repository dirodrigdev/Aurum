import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: async () => {},
  getCurrentUid: () => null,
}));

import type { WealthCheckpointStateSnapshot, WealthRecord } from '../src/services/wealthStorage';
import {
  BANK_BALANCE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
} from '../src/services/wealthStorage';
import {
  buildMonthlyCloseSnapshotDetails,
  hasMaterialDifferenceBetweenMonthlyCloseSnapshots,
} from '../src/services/monthlyCloseCanonicalSource';

const makeRecord = (overrides: Partial<WealthRecord>): WealthRecord => ({
  id: overrides.id || crypto.randomUUID(),
  block: overrides.block || 'investment',
  source: overrides.source || 'test',
  label: overrides.label || 'Registro test',
  amount: Number(overrides.amount || 0),
  currency: overrides.currency || 'CLP',
  snapshotDate: overrides.snapshotDate || '2026-05-31',
  createdAt: overrides.createdAt || '2026-06-01T10:00:00.000Z',
  note: overrides.note,
});

const makeState = (records: WealthRecord[], updatedAt: string): WealthCheckpointStateSnapshot => ({
  updatedAt,
  records,
  closures: [],
  instruments: [],
  bankTokens: {},
  deletedRecordIds: [],
  deletedRecordAssetMonthKeys: [],
  fx: {
    usdClp: 893,
    eurClp: 970,
    ufClp: 39_000,
  },
  closureDeletionTombstones: [],
});

describe('monthly close canonical source', () => {
  it('detects material differences between local and cloud snapshots and computes cloud amounts', () => {
    const localState = makeState(
      [
        makeRecord({ id: 'bank-local', block: 'bank', label: BANK_BALANCE_CLP_LABEL, amount: 21_007_516 }),
        makeRecord({ id: 'inv-local', block: 'investment', label: 'Cartera local', amount: 1_525_849_377 }),
        makeRecord({ id: 're-local', block: 'real_estate', label: REAL_ESTATE_PROPERTY_VALUE_LABEL, amount: 252_754_619 }),
        makeRecord({ id: 'debt-local', block: 'debt', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000 }),
      ],
      '2026-06-01T09:00:00.000Z',
    );
    const cloudState = makeState(
      [
        makeRecord({ id: 'bank-cloud', block: 'bank', label: BANK_BALANCE_CLP_LABEL, amount: 34_507_763 }),
        makeRecord({ id: 'inv-cloud', block: 'investment', label: 'Cartera cloud', amount: 1_520_773_862 }),
        makeRecord({ id: 're-cloud', block: 'real_estate', label: REAL_ESTATE_PROPERTY_VALUE_LABEL, amount: 252_860_424 }),
        makeRecord({ id: 'debt-cloud', block: 'debt', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000 }),
      ],
      '2026-06-01T10:00:00.000Z',
    );

    const localSnapshot = buildMonthlyCloseSnapshotDetails({
      state: localState,
      targetMonthKey: '2026-05',
      includeRiskCapitalInTotals: false,
    });
    const cloudSnapshot = buildMonthlyCloseSnapshotDetails({
      state: cloudState,
      targetMonthKey: '2026-05',
      includeRiskCapitalInTotals: false,
    });

    expect(hasMaterialDifferenceBetweenMonthlyCloseSnapshots(localSnapshot, cloudSnapshot)).toBe(true);
    expect(cloudSnapshot.amounts.bank).toBe(34_507_763);
    expect(cloudSnapshot.amounts.investment).toBe(1_520_773_862);
    expect(cloudSnapshot.amounts.nonMortgageDebt).toBe(93_200_000);
    expect(cloudSnapshot.amounts.totalNetClp).toBe(1_714_942_049);
  });

  it('changes the fingerprint when the canonical close snapshot changes', () => {
    const baseState = makeState(
      [
        makeRecord({ id: 'bank-a', block: 'bank', label: BANK_BALANCE_CLP_LABEL, amount: 21_007_516 }),
        makeRecord({ id: 'inv-a', block: 'investment', label: 'Cartera', amount: 1_525_849_377 }),
        makeRecord({ id: 're-a', block: 'real_estate', label: REAL_ESTATE_PROPERTY_VALUE_LABEL, amount: 252_754_619 }),
        makeRecord({ id: 'debt-a', block: 'debt', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000 }),
      ],
      '2026-06-01T09:00:00.000Z',
    );
    const changedState = makeState(
      [
        makeRecord({ id: 'bank-a', block: 'bank', label: BANK_BALANCE_CLP_LABEL, amount: 34_507_763 }),
        makeRecord({ id: 'inv-a', block: 'investment', label: 'Cartera', amount: 1_520_773_862 }),
        makeRecord({ id: 're-a', block: 'real_estate', label: REAL_ESTATE_PROPERTY_VALUE_LABEL, amount: 252_860_424 }),
        makeRecord({ id: 'debt-a', block: 'debt', label: DEBT_CARD_CLP_LABEL, amount: 93_200_000 }),
      ],
      '2026-06-01T10:00:00.000Z',
    );

    const before = buildMonthlyCloseSnapshotDetails({
      state: baseState,
      targetMonthKey: '2026-05',
      includeRiskCapitalInTotals: false,
    });
    const after = buildMonthlyCloseSnapshotDetails({
      state: changedState,
      targetMonthKey: '2026-05',
      includeRiskCapitalInTotals: false,
    });

    expect(before.fingerprint).not.toBe(after.fingerprint);
  });
});
