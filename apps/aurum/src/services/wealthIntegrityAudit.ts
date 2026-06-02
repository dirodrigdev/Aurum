import {
  buildCanonicalClosureSummary,
  dedupeLatestByAsset,
  makeAssetKey,
  resolveClosureSectionAmounts,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from './wealthStorage';

export type WealthIntegrityStatus = 'ok' | 'warning' | 'blocked';

export interface BankIntegrityAuditInput {
  visibleBankClp: number;
  editableBankClp: number;
  editableBankUsd?: number;
  operativeBankClp?: number;
  operativeBankUsd?: number;
  fx: Pick<WealthFxRates, 'usdClp'>;
  toleranceClp?: number;
}

export interface BankIntegrityAuditResult {
  status: WealthIntegrityStatus;
  visibleBankClp: number;
  editableTotalClp: number;
  operativeTotalClp: number | null;
  deltaEditableVsVisibleClp: number;
  deltaOperativeVsVisibleClp: number | null;
  reasons: string[];
}

const roundMoney = (value: number) => Math.round(Number(value) || 0);

export const buildBankIntegrityAudit = (input: BankIntegrityAuditInput): BankIntegrityAuditResult => {
  const toleranceClp = Math.max(0, Math.round(input.toleranceClp ?? 50_000));
  const visibleBankClp = roundMoney(input.visibleBankClp);
  const editableTotalClp = roundMoney(input.editableBankClp + (Number(input.editableBankUsd || 0) * input.fx.usdClp));
  const operativeTotalClp =
    input.operativeBankClp == null && input.operativeBankUsd == null
      ? null
      : roundMoney(Number(input.operativeBankClp || 0) + Number(input.operativeBankUsd || 0) * input.fx.usdClp);

  const deltaEditableVsVisibleClp = editableTotalClp - visibleBankClp;
  const deltaOperativeVsVisibleClp = operativeTotalClp == null ? null : operativeTotalClp - visibleBankClp;
  const reasons: string[] = [];

  if (Math.abs(deltaEditableVsVisibleClp) > toleranceClp) {
    reasons.push('editable_detail_diverges_from_visible_bank_total');
  }
  if (deltaOperativeVsVisibleClp != null && Math.abs(deltaOperativeVsVisibleClp) > toleranceClp) {
    reasons.push('operative_detail_diverges_from_visible_bank_total');
  }
  if (
    deltaOperativeVsVisibleClp != null &&
    Math.abs(deltaEditableVsVisibleClp) > toleranceClp &&
    Math.abs(deltaOperativeVsVisibleClp) > toleranceClp
  ) {
    reasons.push('multiple_active_bank_sources_disagree');
  }

  return {
    status: reasons.length ? 'blocked' : 'ok',
    visibleBankClp,
    editableTotalClp,
    operativeTotalClp,
    deltaEditableVsVisibleClp,
    deltaOperativeVsVisibleClp,
    reasons,
  };
};

export interface MonthInitializationIntegrityAuditInput {
  previousClosure: Pick<WealthMonthlyClosure, 'records' | 'summary' | 'monthKey'>;
  initializedRecords: WealthRecord[];
  rerunRecords?: WealthRecord[];
  fxRates: WealthFxRates;
}

export interface MonthInitializationIntegrityAuditResult {
  status: WealthIntegrityStatus;
  previousSummary: ReturnType<typeof buildCanonicalClosureSummary> | null;
  initializedSummary: ReturnType<typeof buildCanonicalClosureSummary>;
  rerunSummary: ReturnType<typeof buildCanonicalClosureSummary> | null;
  missingAssetKeys: string[];
  extraAssetKeys: string[];
  changedAssetKeys: string[];
  rerunChangedAssetKeys: string[];
  reasons: string[];
}

const mapByAssetKey = (records: WealthRecord[]) => {
  const map = new Map<string, WealthRecord>();
  dedupeLatestByAsset(records).forEach((record) => map.set(makeAssetKey(record), record));
  return map;
};

export const buildMonthInitializationIntegrityAudit = (
  input: MonthInitializationIntegrityAuditInput,
): MonthInitializationIntegrityAuditResult => {
  const previousRecords = dedupeLatestByAsset(input.previousClosure.records || []);
  const initializedRecords = dedupeLatestByAsset(input.initializedRecords);
  const rerunRecords = input.rerunRecords ? dedupeLatestByAsset(input.rerunRecords) : null;

  const previousMap = mapByAssetKey(previousRecords);
  const initializedMap = mapByAssetKey(initializedRecords);
  const rerunMap = rerunRecords ? mapByAssetKey(rerunRecords) : null;

  const missingAssetKeys = [...previousMap.keys()].filter((key) => !initializedMap.has(key));
  const extraAssetKeys = [...initializedMap.keys()].filter((key) => !previousMap.has(key));
  const changedAssetKeys = [...previousMap.keys()].filter((key) => {
    const prev = previousMap.get(key);
    const next = initializedMap.get(key);
    return !!prev && !!next && roundMoney(prev.amount) !== roundMoney(next.amount);
  });

  const rerunChangedAssetKeys = rerunMap
    ? [...initializedMap.keys()].filter((key) => {
        const first = initializedMap.get(key);
        const second = rerunMap.get(key);
        return !first || !second || roundMoney(first.amount) !== roundMoney(second.amount);
      })
    : [];

  const reasons: string[] = [];
  if (missingAssetKeys.length) reasons.push('initialized_month_missing_previous_assets');
  if (extraAssetKeys.length) reasons.push('initialized_month_added_unexpected_assets');
  if (changedAssetKeys.length) reasons.push('initialized_month_changed_previous_asset_amounts');
  if (rerunChangedAssetKeys.length) reasons.push('initialized_month_is_not_idempotent');

  const previousSummary = previousRecords.length ? buildCanonicalClosureSummary(previousRecords, input.fxRates) : null;
  const initializedSummary = buildCanonicalClosureSummary(initializedRecords, input.fxRates);
  const rerunSummary = rerunRecords ? buildCanonicalClosureSummary(rerunRecords, input.fxRates) : null;

  return {
    status: reasons.length ? 'blocked' : 'ok',
    previousSummary,
    initializedSummary,
    rerunSummary,
    missingAssetKeys,
    extraAssetKeys,
    changedAssetKeys,
    rerunChangedAssetKeys,
    reasons,
  };
};

export interface BankRefreshSafetyAuditInput {
  previousRecords: WealthRecord[];
  refreshedRecords: WealthRecord[];
  fxRates: WealthFxRates;
  providerStatus: 'complete' | 'partial' | 'failed';
}

export interface BankRefreshSafetyAuditResult {
  status: WealthIntegrityStatus;
  previousBankClp: number;
  refreshedBankClp: number;
  previousDebtClp: number;
  refreshedDebtClp: number;
  deltaBankClp: number;
  deltaDebtClp: number;
  reasons: string[];
}

export interface ClosureBlockIntegrityAuditInput {
  closure: WealthMonthlyClosure;
  editableRecords: WealthRecord[];
  fxRates: WealthFxRates;
}

export interface ClosureBlockIntegrityAuditResult {
  status: WealthIntegrityStatus;
  visibleBankClp: number;
  editableBankClp: number;
  visibleDebtClp: number;
  editableDebtClp: number;
  reasons: string[];
}

export const buildBankRefreshSafetyAudit = (
  input: BankRefreshSafetyAuditInput,
): BankRefreshSafetyAuditResult => {
  const previousSummary = buildCanonicalClosureSummary(dedupeLatestByAsset(input.previousRecords), input.fxRates);
  const refreshedSummary = buildCanonicalClosureSummary(dedupeLatestByAsset(input.refreshedRecords), input.fxRates);
  const reasons: string[] = [];

  if (input.providerStatus !== 'complete') {
    if (refreshedSummary.bankClp < previousSummary.bankClp) {
      reasons.push('partial_refresh_reduced_bank_balance');
    }
    if (refreshedSummary.nonMortgageDebtClp < previousSummary.nonMortgageDebtClp) {
      reasons.push('partial_refresh_reduced_non_mortgage_debt_snapshot');
    }
  }

  return {
    status: reasons.length ? 'blocked' : input.providerStatus === 'complete' ? 'ok' : 'warning',
    previousBankClp: previousSummary.bankClp || 0,
    refreshedBankClp: refreshedSummary.bankClp || 0,
    previousDebtClp: previousSummary.nonMortgageDebtClp || 0,
    refreshedDebtClp: refreshedSummary.nonMortgageDebtClp || 0,
    deltaBankClp: (refreshedSummary.bankClp || 0) - (previousSummary.bankClp || 0),
    deltaDebtClp: (refreshedSummary.nonMortgageDebtClp || 0) - (previousSummary.nonMortgageDebtClp || 0),
    reasons,
  };
};

export const buildClosureBlockIntegrityAudit = (
  input: ClosureBlockIntegrityAuditInput,
): ClosureBlockIntegrityAuditResult => {
  const visible = resolveClosureSectionAmounts({ closure: input.closure, fxRates: input.fxRates, includeRiskCapitalInTotals: false });
  const editableSummary = buildCanonicalClosureSummary(dedupeLatestByAsset(input.editableRecords), input.fxRates);
  const bankAudit = buildBankIntegrityAudit({
    visibleBankClp: visible.bankClp,
    editableBankClp: editableSummary.bankClp || 0,
    fx: { usdClp: input.fxRates.usdClp },
    toleranceClp: 50_000,
  });
  const reasons = [...bankAudit.reasons];

  if (Math.abs((visible.nonMortgageDebtClp || 0) - (editableSummary.nonMortgageDebtClp || 0)) > 50_000) {
    reasons.push('editable_detail_diverges_from_visible_non_mortgage_debt');
  }

  return {
    status: reasons.length ? 'blocked' : 'ok',
    visibleBankClp: visible.bankClp,
    editableBankClp: editableSummary.bankClp || 0,
    visibleDebtClp: visible.nonMortgageDebtClp,
    editableDebtClp: editableSummary.nonMortgageDebtClp || 0,
    reasons,
  };
};
