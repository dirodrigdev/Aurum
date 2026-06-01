import { describe, expect, it } from 'vitest';

import {
  MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE,
  shouldBlockMonthlyCloseForDebtMismatch,
  shouldKeepMonthlyCloseDebtGuardError,
} from '../src/services/monthlyCloseDebtGuard';

describe('monthly close debt guard', () => {
  it('does not block when live and preview debt match (current correct case)', () => {
    expect(
      shouldBlockMonthlyCloseForDebtMismatch({
        liveDebtClp: -93_200_000,
        previewDebtClp: -93_200_000,
      }),
    ).toBe(false);
  });

  it('blocks when live debt exists but preview debt is zero (bad case)', () => {
    expect(
      shouldBlockMonthlyCloseForDebtMismatch({
        liveDebtClp: -93_200_000,
        previewDebtClp: 0,
      }),
    ).toBe(true);
  });

  it('handles sign differences without false positives', () => {
    expect(
      shouldBlockMonthlyCloseForDebtMismatch({
        liveDebtClp: 93_200_000,
        previewDebtClp: -93_200_000,
      }),
    ).toBe(false);
  });

  it('does not block for tiny rounding differences', () => {
    expect(
      shouldBlockMonthlyCloseForDebtMismatch({
        liveDebtClp: 93_200_000,
        previewDebtClp: 93_198_000,
      }),
    ).toBe(false);
  });

  it('stale guard error should clear when recalculation is correct', () => {
    expect(
      shouldKeepMonthlyCloseDebtGuardError(MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE, true),
    ).toBe(true);
    expect(
      shouldKeepMonthlyCloseDebtGuardError(MONTHLY_CLOSE_DEBT_GUARD_ERROR_MESSAGE, false),
    ).toBe(false);
  });
});
