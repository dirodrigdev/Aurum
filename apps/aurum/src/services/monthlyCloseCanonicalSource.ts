import {
  computeWealthHomeSectionAmounts,
  isStartMonthCheckpointRecord,
  latestRecordsForMonth,
  resolveRiskCapitalRecordsForTotals,
  type WealthCheckpointStateSnapshot,
  type WealthRecord,
} from './wealthStorage';

export const MONTHLY_CLOSE_CANONICAL_DIFF_MIN_CLP = 1_000;

type MonthlyCloseSectionAmounts = ReturnType<typeof computeWealthHomeSectionAmounts>;

export type MonthlyCloseSnapshotDetails = {
  targetMonthKey: string;
  targetRecords: WealthRecord[];
  amounts: MonthlyCloseSectionAmounts;
  fingerprint: string;
};

const buildCanonicalCloseTargetRecords = (
  sourceRecords: WealthRecord[],
  targetMonthKey: string,
) =>
  latestRecordsForMonth(sourceRecords, targetMonthKey).filter(
    (record) => !isStartMonthCheckpointRecord(record),
  );

const projectRecordForFingerprint = (record: WealthRecord) => ({
  id: record.id,
  block: record.block,
  label: record.label,
  source: record.source,
  amount: Number(record.amount || 0),
  currency: record.currency,
  snapshotDate: record.snapshotDate,
  createdAt: record.createdAt || '',
  note: record.note || '',
});

export const buildMonthlyCloseSnapshotDetails = (input: {
  state: WealthCheckpointStateSnapshot;
  targetMonthKey: string;
  includeRiskCapitalInTotals: boolean;
}): MonthlyCloseSnapshotDetails => {
  const targetRecords = buildCanonicalCloseTargetRecords(
    input.state.records,
    input.targetMonthKey,
  );
  const recordsForTotals = resolveRiskCapitalRecordsForTotals(
    targetRecords,
    input.includeRiskCapitalInTotals,
  ).recordsForTotals;
  const amounts = computeWealthHomeSectionAmounts(recordsForTotals, input.state.fx);
  const fingerprint = JSON.stringify({
    monthKey: input.targetMonthKey,
    updatedAt: input.state.updatedAt || '',
    fx: input.state.fx,
    records: targetRecords.map(projectRecordForFingerprint),
  });
  return {
    targetMonthKey: input.targetMonthKey,
    targetRecords,
    amounts,
    fingerprint,
  };
};

export const hasMaterialDifferenceBetweenMonthlyCloseSnapshots = (
  left: MonthlyCloseSnapshotDetails,
  right: MonthlyCloseSnapshotDetails,
  toleranceClp = MONTHLY_CLOSE_CANONICAL_DIFF_MIN_CLP,
) => {
  const fields: Array<keyof MonthlyCloseSectionAmounts> = [
    'bank',
    'investment',
    'realEstateNet',
    'nonMortgageDebt',
    'totalNetClp',
  ];
  return fields.some(
    (field) =>
      Math.abs(Number(left.amounts[field] || 0) - Number(right.amounts[field] || 0)) >
      toleranceClp,
  );
};
