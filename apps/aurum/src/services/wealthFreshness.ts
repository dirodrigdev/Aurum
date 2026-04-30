import { labelMatchKey } from '../utils/wealthLabels';
import {
  BANK_BALANCE_CLP_LABEL,
  BANK_BALANCE_CLP_LEGACY_LABEL,
  BANK_BALANCE_USD_LABEL,
  BANK_BALANCE_USD_LEGACY_LABEL,
  BANK_PROVIDER_CLP_LABELS,
  BANK_PROVIDER_USD_LABELS,
  DEBT_CARD_CLP_LABEL,
  DEBT_CARD_CLP_LEGACY_LABEL,
  DEBT_CARD_USD_LABEL,
  DEBT_CARD_USD_LEGACY_LABEL,
  MANUAL_CARD_LABELS,
  dedupeLatestByAsset,
  filterRecordsByRiskCapitalPreference,
  isMortgageMetaDebtLabel,
  isMortgagePrincipalDebtLabel,
  isNonMortgageDebtRecord,
  isRiskCapitalInvestmentLabel,
  isSyntheticAggregateRecord,
  makeAssetKey,
  maybeNormalizeMinorUnitAmount,
  TENENCIA_CXC_PREFIX_LABEL,
  type WealthFxRates,
  type WealthRecord,
} from './wealthStorage';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type WealthFreshnessBucket = 'fresh' | 'aging' | 'stale' | 'unknown';
export type WealthFreshnessGroup = 'investment' | 'bank' | 'real_estate' | 'mortgage_debt' | 'non_mortgage_debt';

export interface WealthFreshnessComponent {
  id: string;
  label: string;
  group: WealthFreshnessGroup;
  amountClp: number;
  weightPct: number;
  daysOld: number | null;
  bucket: WealthFreshnessBucket;
  isDebt: boolean;
  isRiskCapital: boolean;
  source: string;
  recordIds: string[];
}

export interface WealthFreshnessModel {
  status: 'ok' | 'unavailable';
  totalExposureClp: number;
  totalWeightedClp: number;
  fresh7dPct: number | null;
  aging30dPct: number | null;
  stalePct: number | null;
  components: WealthFreshnessComponent[];
  laggards: WealthFreshnessComponent[];
  freshComponents: WealthFreshnessComponent[];
  riskCapitalIncluded: boolean;
  riskCapitalExcluded: boolean;
}

export interface WealthFreshnessOptions {
  includeRiskCapitalInTotals: boolean;
  now?: Date | number;
}

type CanonicalRecord = {
  record: WealthRecord;
  group: WealthFreshnessGroup;
  isDebt: boolean;
};

const keySet = (labels: readonly string[]) => new Set(labels.map(labelMatchKey));

const AGGREGATE_BANK_LABELS_CLP = keySet([BANK_BALANCE_CLP_LABEL, BANK_BALANCE_CLP_LEGACY_LABEL]);
const AGGREGATE_BANK_LABELS_USD = keySet([BANK_BALANCE_USD_LABEL, BANK_BALANCE_USD_LEGACY_LABEL]);
const PROVIDER_BANK_LABELS_CLP = keySet(BANK_PROVIDER_CLP_LABELS);
const PROVIDER_BANK_LABELS_USD = keySet(BANK_PROVIDER_USD_LABELS);
const AGGREGATE_DEBT_LABELS_CLP = keySet([DEBT_CARD_CLP_LABEL, DEBT_CARD_CLP_LEGACY_LABEL]);
const AGGREGATE_DEBT_LABELS_USD = keySet([DEBT_CARD_USD_LABEL, DEBT_CARD_USD_LEGACY_LABEL]);
const MANUAL_CARD_LABEL_KEYS = keySet(MANUAL_CARD_LABELS);

const hasKey = (set: Set<string>, label: string) => set.has(labelMatchKey(label));
const TENENCIA_BASE_KEY = labelMatchKey(TENENCIA_CXC_PREFIX_LABEL);
const isTenenciaLabel = (label: string) => {
  const key = labelMatchKey(label);
  return key === TENENCIA_BASE_KEY || key.startsWith(`${TENENCIA_BASE_KEY} `);
};

const isAggregateBankLabel = (record: Pick<WealthRecord, 'label' | 'currency'>) => {
  if (record.currency === 'CLP') return hasKey(AGGREGATE_BANK_LABELS_CLP, record.label);
  if (record.currency === 'USD') return hasKey(AGGREGATE_BANK_LABELS_USD, record.label);
  return false;
};

const isProviderBankLabel = (record: Pick<WealthRecord, 'label' | 'currency'>) => {
  if (record.currency === 'CLP') return hasKey(PROVIDER_BANK_LABELS_CLP, record.label);
  if (record.currency === 'USD') return hasKey(PROVIDER_BANK_LABELS_USD, record.label);
  return false;
};

const isAggregateDebtLabel = (record: Pick<WealthRecord, 'label' | 'currency'>) => {
  if (record.currency === 'CLP') return hasKey(AGGREGATE_DEBT_LABELS_CLP, record.label);
  if (record.currency === 'USD') return hasKey(AGGREGATE_DEBT_LABELS_USD, record.label);
  return false;
};

const isDetailedBankRecord = (record: WealthRecord) =>
  record.block === 'bank' &&
  !isNonMortgageDebtRecord(record) &&
  !isSyntheticAggregateRecord(record) &&
  !isAggregateBankLabel(record) &&
  !isProviderBankLabel(record);

const toClp = (record: WealthRecord, fx: WealthFxRates) => {
  const normalizedAmount = maybeNormalizeMinorUnitAmount(record, record.amount);
  if (!Number.isFinite(normalizedAmount)) return 0;
  const absoluteAmount = Math.abs(normalizedAmount);
  if (record.currency === 'CLP') return absoluteAmount;
  if (record.currency === 'USD') return absoluteAmount * fx.usdClp;
  if (record.currency === 'EUR') return absoluteAmount * fx.eurClp;
  return absoluteAmount * fx.ufClp;
};

const isCarriedNote = (note?: string) => {
  const normalized = String(note || '').toLowerCase();
  return normalized.includes('arrastrado') || normalized.includes('mes anterior');
};

const monthKeyToEndDateMs = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return NaN;
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(`${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T12:00:00`).getTime();
};

const carriedSourceMonthFromNote = (note?: string) => {
  const match = String(note || '').match(/cierre\s+(\d{4}-\d{2})/i);
  return match?.[1] || null;
};

const parseDateMs = (value?: string | null): number => {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
};

const recordDateMs = (record: WealthRecord): number => {
  // Explicit touch metadata wins over carried notes. This covers OCR/image,
  // manual edits, and future confirmation/refresh flows without making pure
  // carry-forward records look fresh just because they were copied this month.
  for (const value of [record.refreshedAt, record.confirmedAt, record.updatedAt]) {
    const touched = parseDateMs(value);
    if (Number.isFinite(touched)) return touched;
  }

  if (isCarriedNote(record.note)) {
    const sourceMonth = carriedSourceMonthFromNote(record.note);
    const sourceDate = sourceMonth ? monthKeyToEndDateMs(sourceMonth) : NaN;
    if (Number.isFinite(sourceDate)) return sourceDate;
  }

  const created = parseDateMs(record.createdAt);
  if (Number.isFinite(created)) return created;
  const snapshot = new Date(`${record.snapshotDate}T12:00:00`).getTime();
  return Number.isFinite(snapshot) ? snapshot : NaN;
};

const bucketFromDays = (daysOld: number | null): WealthFreshnessBucket => {
  if (daysOld === null) return 'unknown';
  if (daysOld <= 7) return 'fresh';
  if (daysOld <= 30) return 'aging';
  return 'stale';
};

const selectCanonicalRecords = (records: WealthRecord[], includeRiskCapitalInTotals: boolean): CanonicalRecord[] => {
  const riskFiltered = filterRecordsByRiskCapitalPreference(records, includeRiskCapitalInTotals);
  const latest = dedupeLatestByAsset(riskFiltered).filter((record) => !isSyntheticAggregateRecord(record));

  const bankCandidates = latest.filter((record) => record.block === 'bank' && !isNonMortgageDebtRecord(record));
  const hasProviderBankClp = bankCandidates.some((record) => record.currency === 'CLP' && isProviderBankLabel(record));
  const hasProviderBankUsd = bankCandidates.some((record) => record.currency === 'USD' && isProviderBankLabel(record));
  const hasDetailedBankClp = bankCandidates.some((record) => record.currency === 'CLP' && isDetailedBankRecord(record));
  const hasDetailedBankUsd = bankCandidates.some((record) => record.currency === 'USD' && isDetailedBankRecord(record));

  const debtCandidates = latest.filter(
    (record) => isNonMortgageDebtRecord(record) && !isMortgagePrincipalDebtLabel(record.label),
  );
  const hasDetailedDebtClp = debtCandidates.some((record) => record.currency === 'CLP' && !isAggregateDebtLabel(record));
  const hasDetailedDebtUsd = debtCandidates.some((record) => record.currency === 'USD' && !isAggregateDebtLabel(record));
  const hasAggregateDebtClp = debtCandidates.some((record) => record.currency === 'CLP' && isAggregateDebtLabel(record));
  const hasAggregateDebtUsd = debtCandidates.some((record) => record.currency === 'USD' && isAggregateDebtLabel(record));
  let aggregateDebtClpCounted = false;
  let aggregateDebtUsdCounted = false;

  const selected: CanonicalRecord[] = [];

  for (const record of latest) {
    if (isMortgageMetaDebtLabel(record.label) && !isMortgagePrincipalDebtLabel(record.label)) continue;
    const label = labelMatchKey(record.label);
    const nonMortgageDebt = isNonMortgageDebtRecord(record);

    if (record.block === 'investment') {
      selected.push({ record, group: 'investment', isDebt: false });
      continue;
    }
    if (record.block === 'real_estate') {
      selected.push({ record, group: 'real_estate', isDebt: false });
      continue;
    }
    if (isMortgagePrincipalDebtLabel(record.label)) {
      selected.push({ record, group: 'mortgage_debt', isDebt: true });
      continue;
    }
    if (record.block === 'bank' && !nonMortgageDebt) {
      if (record.currency === 'CLP') {
        if (hasProviderBankClp && !PROVIDER_BANK_LABELS_CLP.has(label)) continue;
        if (!hasProviderBankClp && hasDetailedBankClp && AGGREGATE_BANK_LABELS_CLP.has(label)) continue;
      }
      if (record.currency === 'USD') {
        if (hasProviderBankUsd && !PROVIDER_BANK_LABELS_USD.has(label)) continue;
        if (!hasProviderBankUsd && hasDetailedBankUsd && AGGREGATE_BANK_LABELS_USD.has(label)) continue;
      }
      selected.push({ record, group: 'bank', isDebt: false });
      continue;
    }
    if (nonMortgageDebt) {
      if (record.currency === 'CLP') {
        if (hasDetailedDebtClp && AGGREGATE_DEBT_LABELS_CLP.has(label)) continue;
        if (!hasDetailedDebtClp && hasAggregateDebtClp) {
          if (!AGGREGATE_DEBT_LABELS_CLP.has(label)) continue;
          if (aggregateDebtClpCounted) continue;
          aggregateDebtClpCounted = true;
        }
      }
      if (record.currency === 'USD') {
        if (hasDetailedDebtUsd && AGGREGATE_DEBT_LABELS_USD.has(label)) continue;
        if (!hasDetailedDebtUsd && hasAggregateDebtUsd) {
          if (!AGGREGATE_DEBT_LABELS_USD.has(label)) continue;
          if (aggregateDebtUsdCounted) continue;
          aggregateDebtUsdCounted = true;
        }
      }
      if (MANUAL_CARD_LABEL_KEYS.has(label) || isAggregateDebtLabel(record) || record.block === 'debt' || record.block === 'bank') {
        selected.push({ record, group: 'non_mortgage_debt', isDebt: true });
      }
    }
  }

  return selected;
};

export const buildWealthFreshnessModel = (
  records: WealthRecord[],
  fxRates: WealthFxRates,
  options: WealthFreshnessOptions,
): WealthFreshnessModel => {
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now());
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const hasRiskCapital = records.some((record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label));
  const selected = selectCanonicalRecords(records, options.includeRiskCapitalInTotals);

  const rawComponents = selected
    .map(({ record, group, isDebt }) => {
      const amountClp = toClp(record, fxRates);
      const dateMs = recordDateMs(record);
      const ageMs = safeNowMs - dateMs;
      const daysOld = Number.isFinite(ageMs) && ageMs >= 0 ? Math.floor(ageMs / MS_PER_DAY) : null;
      return {
        id: makeAssetKey(record),
        label: record.label,
        group,
        amountClp,
        weightPct: 0,
        daysOld,
        bucket: bucketFromDays(daysOld),
        isDebt,
        isRiskCapital: record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
        source: record.source,
        recordIds: [record.id],
      } satisfies WealthFreshnessComponent;
    })
    .filter((component) => Number.isFinite(component.amountClp) && component.amountClp > 0);

  const mergedTenencia = (() => {
    const tenencia = rawComponents.filter(
      (component) => component.group === 'investment' && isTenenciaLabel(component.label),
    );
    if (tenencia.length <= 1) return rawComponents;

    const newest = tenencia.reduce((latest, current) => {
      const latestDays = latest.daysOld ?? Number.POSITIVE_INFINITY;
      const currentDays = current.daysOld ?? Number.POSITIVE_INFINITY;
      return currentDays < latestDays ? current : latest;
    }, tenencia[0]);

    const merged: WealthFreshnessComponent = {
      id: `investment::${TENENCIA_BASE_KEY}::ALL`,
      label: TENENCIA_CXC_PREFIX_LABEL,
      group: 'investment',
      amountClp: tenencia.reduce((sum, component) => sum + component.amountClp, 0),
      weightPct: 0,
      daysOld: newest.daysOld,
      bucket: newest.bucket,
      isDebt: false,
      isRiskCapital: false,
      source: newest.source,
      recordIds: Array.from(new Set(tenencia.flatMap((component) => component.recordIds))),
    };

    return [...rawComponents.filter((component) => !tenencia.includes(component)), merged];
  })();

  const totalExposureClp = mergedTenencia.reduce((sum, component) => sum + component.amountClp, 0);
  const riskCapitalIncluded = options.includeRiskCapitalInTotals && hasRiskCapital;
  const riskCapitalExcluded = !options.includeRiskCapitalInTotals && hasRiskCapital;
  if (totalExposureClp <= 0) {
    return {
      status: 'unavailable',
      totalExposureClp: 0,
      totalWeightedClp: 0,
      fresh7dPct: null,
      aging30dPct: null,
      stalePct: null,
      components: [],
      laggards: [],
      freshComponents: [],
      riskCapitalIncluded,
      riskCapitalExcluded,
    };
  }

  const components = mergedTenencia
    .map((component) => ({ ...component, weightPct: component.amountClp / totalExposureClp }))
    .sort((a, b) => b.weightPct - a.weightPct);
  const pctFor = (buckets: WealthFreshnessBucket[]) =>
    components.filter((component) => buckets.includes(component.bucket)).reduce((sum, component) => sum + component.weightPct, 0);

  return {
    status: 'ok',
    totalExposureClp,
    totalWeightedClp: totalExposureClp,
    fresh7dPct: pctFor(['fresh']),
    aging30dPct: pctFor(['aging']),
    stalePct: pctFor(['stale', 'unknown']),
    components,
    laggards: components.filter((component) => component.bucket !== 'fresh'),
    freshComponents: components.filter((component) => component.bucket === 'fresh'),
    riskCapitalIncluded,
    riskCapitalExcluded,
  };
};
