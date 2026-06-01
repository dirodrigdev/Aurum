export const MONTHLY_CLOSE_DEBT_GUARD_MIN_CLP = 1_000_000;
export const MONTHLY_CLOSE_DEBT_GUARD_TOLERANCE_CLP = 5_000;

export const shouldBlockMonthlyCloseForDebtMismatch = (input: {
  liveDebtClp: number;
  previewDebtClp: number;
  minRelevantClp?: number;
  toleranceClp?: number;
}) => {
  const minRelevant = Math.max(0, Number(input.minRelevantClp ?? MONTHLY_CLOSE_DEBT_GUARD_MIN_CLP));
  const tolerance = Math.max(0, Number(input.toleranceClp ?? MONTHLY_CLOSE_DEBT_GUARD_TOLERANCE_CLP));
  const liveDebt = Math.abs(Number(input.liveDebtClp || 0));
  const previewDebt = Math.abs(Number(input.previewDebtClp || 0));

  if (liveDebt < minRelevant) return false;
  if (previewDebt <= tolerance) return true;
  if (previewDebt + tolerance < liveDebt) return true;
  return false;
};
