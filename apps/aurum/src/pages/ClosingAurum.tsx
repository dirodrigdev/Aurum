import React, { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { Button, Card, Input } from '../components/Components';
import { BreakdownCard, type BreakdownSummaryInvestmentRow } from '../components/closing/BreakdownCard';
import { ConfirmActionModal } from '../components/settings/ConfirmActionModal';
import { BOTTOM_NAV_RETAP_EVENT } from '../components/Layout';
import { parseStrictNumber } from '../utils/numberUtils';
import { labelMatchKey, sameCanonicalLabel } from '../utils/wealthLabels';
import {
  formatCurrency,
  formatIsoDateTime,
  formatMonthLabel as monthLabel,
  formatRateDecimal,
  formatRateInt,
  formatTodayContext,
} from '../utils/wealthFormat';
import {
  BANK_BALANCE_CLP_LABEL,
  BANK_BALANCE_CLP_LEGACY_LABEL,
  BANK_BALANCE_USD_LABEL,
  BANK_BALANCE_USD_LEGACY_LABEL,
  buildCanonicalClosureSummary,
  buildWealthNetBreakdown,
  DEBT_CARD_CLP_LABEL,
  DEBT_CARD_CLP_LEGACY_LABEL,
  DEBT_CARD_USD_LABEL,
  DEBT_CARD_USD_LEGACY_LABEL,
  INVESTMENT_BTG_LABEL,
  INVESTMENT_GLOBAL66_USD_LABEL,
  INVESTMENT_PLANVITAL_LABEL,
  INVESTMENT_SURA_FIN_LABEL,
  INVESTMENT_SURA_PREV_LABEL,
  INVESTMENT_WISE_USD_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  RISK_CAPITAL_LABEL_USD,
  TENENCIA_CXC_PREFIX_LABEL,
  resolveRiskCapitalRecordsForTotals,
  WealthCurrency,
  WealthFxRates,
  WealthNetBreakdownClp,
  WealthRecord,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  loadIncludeRiskCapitalInTotals,
  validateFxRange,
  WEALTH_DATA_UPDATED_EVENT,
  isMortgageMetaDebtLabel,
  isMortgagePrincipalDebtLabel,
  isNonMortgageDebtRecord,
  isSyntheticAggregateRecord,
  isRiskCapitalInvestmentLabel,
  latestRecordsForMonth,
  loadClosures,
  createWealthBackupSnapshot,
  loadFxRates,
  loadWealthRecords,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  saveClosures,
  saveIncludeRiskCapitalInTotals,
  summarizeWealth,
  WEALTH_LABEL_CATALOG,
  WealthMonthlyClosure,
  WealthSnapshotSummary,
  upsertMonthlyClosure,
} from '../services/wealthStorage';
import { hydrateWealthFromCloudShared } from '../services/wealthHydration';

type ClosingTab = 'hoy' | 'cierre' | 'evolucion';
type EvolutionKind = 'cierre' | 'hoy';
const PREFERRED_CLOSING_CURRENCY_KEY = 'aurum.preferred.closing.currency';
const RAW_CLOSURES_STORAGE_KEY = 'wealth_closures_v1';
const ANKRE_DEEP_GREEN = '#0f3f3a';
const ANKRE_BRONZE = '#9c6b36';
const ANKRE_BRONZE_DARK = '#7f5528';

interface EvolutionRow {
  key: string;
  label: string;
  kind: EvolutionKind;
  net: number | null;
  hasRiskCapital: boolean;
}

type NetBreakdown = WealthNetBreakdownClp;

interface ClosureAuditRecordRow {
  label: string;
  currency: WealthCurrency;
  amount: number;
  amountClp: number;
  source: string;
  note: string;
  block: WealthRecord['block'];
  isNonMortgageDebt: boolean;
  countsForBank: boolean;
  countsForDebt: boolean;
}

interface ClosureAuditSnapshot {
  id: string;
  monthKey: string;
  closedAt: string;
  replacedAt?: string;
  persisted: ComparableVersionFields | null;
  canonical: ComparableVersionFields | null;
  delta: ComparableVersionFields | null;
  recordCount: number;
  hasRecords: boolean;
  hasSummary: boolean;
  hasSummaryExtended: boolean;
  bankRows: ClosureAuditRecordRow[];
}

interface ClosureAuditCandidate extends ClosureAuditSnapshot {
  bankDeltaVsCurrent: number | null;
  debtDeltaVsCurrent: number | null;
  totalDeltaVsCurrent: number | null;
  candidateScore: number | null;
  candidateReason: string | null;
}

interface ClosureAuditDiagnosis {
  messages: string[];
  recommendedCandidateId: string | null;
}

const formatCloseTimestamp = (iso?: string) => {
  return formatIsoDateTime(iso, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const readPreferredClosingCurrency = (): WealthCurrency => {
  if (typeof window === 'undefined') return 'CLP';
  const stored = window.localStorage.getItem(PREFERRED_CLOSING_CURRENCY_KEY);
  if (stored === 'CLP' || stored === 'USD' || stored === 'EUR' || stored === 'UF') return stored;
  return 'CLP';
};

const fromClp = (amountClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return amountClp / Math.max(1, fx.eurClp);
  return amountClp / Math.max(1, fx.ufClp);
};

const toClp = (amount: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * Math.max(1, fx.usdClp);
  if (currency === 'EUR') return amount * Math.max(1, fx.eurClp);
  return amount * Math.max(1, fx.ufClp);
};

const nextMonthKey = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return monthKey;
  const month = monthRaw === 12 ? 1 : monthRaw + 1;
  const year = monthRaw === 12 ? yearRaw + 1 : yearRaw;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const formatDelta = (value: number | null, currency: WealthCurrency) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${formatCurrency(value, currency)}`;
};

const formatAuditSummary = (fields: ComparableVersionFields | null, currency: WealthCurrency, fx: WealthFxRates) => {
  if (!fields) return 'Sin summary';
  return [
    `Total ${formatCurrency(fromClp(fields.netClp, currency, fx), currency)}`,
    `Inv. ${formatCurrency(fromClp(fields.investmentClp ?? 0, currency, fx), currency)}`,
    `Bancos ${formatCurrency(fromClp(fields.bankClp ?? 0, currency, fx), currency)}`,
    `BR ${formatCurrency(fromClp(fields.realEstateNetClp ?? 0, currency, fx), currency)}`,
    `Deuda ${formatCurrency(fromClp(fields.nonMortgageDebtClp ?? 0, currency, fx), currency)}`,
  ].join(' · ');
};

const CLOSURE_CANONICAL_ALIASES: Record<string, string[]> = {
  'saldo bancos clp': [BANK_BALANCE_CLP_LEGACY_LABEL],
  'saldo bancos usd': [BANK_BALANCE_USD_LEGACY_LABEL],
  'deuda tarjetas clp': [DEBT_CARD_CLP_LEGACY_LABEL],
  'deuda tarjetas usd': [DEBT_CARD_USD_LEGACY_LABEL],
};

const matchCanonicalWithAliases = (label: string, canonicalLabel: string) => {
  const key = labelMatchKey(label);
  if (canonicalLabel === labelMatchKey(TENENCIA_CXC_PREFIX_LABEL)) {
    return key.startsWith(canonicalLabel);
  }
  if (key === canonicalLabel) return true;
  const aliases = CLOSURE_CANONICAL_ALIASES[canonicalLabel] || [];
  return aliases.some((alias) => key === labelMatchKey(alias));
};

const REQUIRED_INVESTMENT_LABELS = [
  INVESTMENT_SURA_FIN_LABEL,
  INVESTMENT_SURA_PREV_LABEL,
  INVESTMENT_PLANVITAL_LABEL,
  INVESTMENT_BTG_LABEL,
  INVESTMENT_GLOBAL66_USD_LABEL,
  INVESTMENT_WISE_USD_LABEL,
];

const REQUIRED_REAL_ESTATE_CORE_FOR_NET = [REAL_ESTATE_PROPERTY_VALUE_LABEL, MORTGAGE_DEBT_BALANCE_LABEL];
const CLOSING_FOCUS_MONTH_KEY = 'aurum.closing.focus.month.v1';
const MAY_2023_HOTFIX_MONTH_KEY = '2023-05';
const MAY_2023_HOTFIX_NET_CLP_OLD = 1_275_704_133;
const MAY_2023_HOTFIX_NET_WITH_RISK_OLD = 1_385_286_133;
const MAY_2023_HOTFIX_INVESTMENT_CLP = 1_159_114_275;
const MAY_2023_HOTFIX_RISK_CLP = 109_582_000;
const MAY_2023_HOTFIX_INVESTMENT_WITH_RISK_CLP = 1_268_696_275;
const MAY_2023_HOTFIX_REAL_ESTATE_NET_CLP = 154_239_360;
const MAY_2023_HOTFIX_BANK_CLP = 0;
const MAY_2023_HOTFIX_NON_MORTGAGE_DEBT_CLP = 0;
const MAY_2023_HOTFIX_NET_CLP = 1_313_353_635;
const MAY_2023_HOTFIX_NET_WITH_RISK = 1_422_935_635;
const MAY_2023_HOTFIX_TENENCIA_CLP = 37_697_220;
const MAY_2023_HOTFIX_INVESTMENT_FINANCIAL_CLP = 545_417_055;
const MAY_2023_HOTFIX_INVESTMENT_PREVISIONAL_CLP = 576_000_000;

type EditableFieldKey =
  | 'suraFin'
  | 'suraPrev'
  | 'btg'
  | 'planvital'
  | 'global66'
  | 'wise'
  | 'riskCapitalClp'
  | 'riskCapitalUsd'
  | 'tenencia'
  | 'valorProp'
  | 'saldoHipoteca'
  | 'bancosClp'
  | 'bancosUsd'
  | 'tarjetasClp'
  | 'tarjetasUsd';

interface ClosureEditableField {
  key: EditableFieldKey;
  label: string;
  block: WealthRecord['block'];
  canonicalLabel: string;
  currency: WealthCurrency;
  section: 'inversiones' | 'bienes_raices' | 'bancos' | 'deudas';
  normalizeAmount?: (value: number) => number;
}

const CLOSURE_EDITABLE_FIELDS: ClosureEditableField[] = [
  {
    key: 'suraFin',
    label: INVESTMENT_SURA_FIN_LABEL,
    block: 'investment',
    canonicalLabel: 'sura inversion financiera',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'suraPrev',
    label: INVESTMENT_SURA_PREV_LABEL,
    block: 'investment',
    canonicalLabel: 'sura ahorro previsional',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'btg',
    label: INVESTMENT_BTG_LABEL,
    block: 'investment',
    canonicalLabel: 'btg total valorizacion',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'planvital',
    label: INVESTMENT_PLANVITAL_LABEL,
    block: 'investment',
    canonicalLabel: 'planvital saldo total',
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'global66',
    label: INVESTMENT_GLOBAL66_USD_LABEL,
    block: 'investment',
    canonicalLabel: 'global66 cuenta vista usd',
    currency: 'USD',
    section: 'inversiones',
  },
  {
    key: 'wise',
    label: INVESTMENT_WISE_USD_LABEL,
    block: 'investment',
    canonicalLabel: 'wise cuenta principal usd',
    currency: 'USD',
    section: 'inversiones',
  },
  {
    key: 'riskCapitalClp',
    label: RISK_CAPITAL_LABEL_CLP,
    block: 'investment',
    canonicalLabel: labelMatchKey(RISK_CAPITAL_LABEL_CLP),
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'riskCapitalUsd',
    label: RISK_CAPITAL_LABEL_USD,
    block: 'investment',
    canonicalLabel: labelMatchKey(RISK_CAPITAL_LABEL_USD),
    currency: 'USD',
    section: 'inversiones',
  },
  {
    key: 'tenencia',
    label: TENENCIA_CXC_PREFIX_LABEL,
    block: 'investment',
    canonicalLabel: labelMatchKey(TENENCIA_CXC_PREFIX_LABEL),
    currency: 'CLP',
    section: 'inversiones',
  },
  {
    key: 'valorProp',
    label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
    block: 'real_estate',
    canonicalLabel: 'valor propiedad',
    currency: 'UF',
    section: 'bienes_raices',
  },
  {
    key: 'saldoHipoteca',
    label: MORTGAGE_DEBT_BALANCE_LABEL,
    block: 'debt',
    canonicalLabel: 'saldo deuda hipotecaria',
    currency: 'UF',
    section: 'bienes_raices',
  },
  {
    key: 'bancosClp',
    label: BANK_BALANCE_CLP_LABEL,
    block: 'bank',
    canonicalLabel: 'saldo bancos clp',
    currency: 'CLP',
    section: 'bancos',
  },
  {
    key: 'bancosUsd',
    label: BANK_BALANCE_USD_LABEL,
    block: 'bank',
    canonicalLabel: 'saldo bancos usd',
    currency: 'USD',
    section: 'bancos',
  },
  {
    key: 'tarjetasClp',
    label: DEBT_CARD_CLP_LABEL,
    block: 'debt',
    canonicalLabel: 'deuda tarjetas clp',
    currency: 'CLP',
    section: 'deudas',
    normalizeAmount: (value) => Math.abs(value),
  },
  {
    key: 'tarjetasUsd',
    label: DEBT_CARD_USD_LABEL,
    block: 'debt',
    canonicalLabel: 'deuda tarjetas usd',
    currency: 'USD',
    section: 'deudas',
    normalizeAmount: (value) => Math.abs(value),
  },
];

const buildNetBreakdown = (records: WealthRecord[], fx: WealthFxRates): NetBreakdown =>
  buildWealthNetBreakdown(records, fx);

const dedupeClosureRecords = (records: WealthRecord[]) => {
  const map = new Map<string, WealthRecord>();
  const ordered = [...records].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  ordered.forEach((record) => {
    const key = `${record.block}::${labelMatchKey(record.label)}::${record.currency}`;
    if (!map.has(key)) map.set(key, record);
  });
  return [...map.values()];
};

const findRecordByCanonicalLabel = (records: WealthRecord[], canonicalLabel: string) =>
  records.find((record) => matchCanonicalWithAliases(record.label, canonicalLabel)) || null;

const resolveSummaryNetForRiskMode = (
  summary: WealthSnapshotSummary,
  includeRiskCapitalInTotals: boolean,
) => {
  if (includeRiskCapitalInTotals) {
    const withRisk = Number(summary?.netClpWithRisk);
    if (Number.isFinite(withRisk)) return withRisk;
  } else {
    const withoutRisk = Number(summary?.netClp);
    if (Number.isFinite(withoutRisk)) return withoutRisk;
  }
  const legacy = Number(summary?.netConsolidatedClp);
  return Number.isFinite(legacy) ? legacy : 0;
};

const readFinite = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const buildSummaryInvestmentRows = (
  summary: WealthSnapshotSummary,
  includeRiskCapitalInTotals: boolean,
): BreakdownSummaryInvestmentRow[] => {
  const extended = summary as {
    investmentFinancialClp?: number;
    investmentPrevisionalClp?: number;
    investmentOthersClp?: number;
    tenenciaClp?: number;
  };
  const baseInvestment = readFinite(summary?.investmentClp);
  const riskCapital = readFinite(summary?.riskCapitalClp) ?? 0;
  const investmentWithRisk = readFinite(summary?.investmentClpWithRisk);
  const totalInvestment = includeRiskCapitalInTotals
    ? (investmentWithRisk ?? (baseInvestment ?? 0) + riskCapital)
    : (baseInvestment ?? ((investmentWithRisk ?? 0) - riskCapital));
  if (!Number.isFinite(totalInvestment)) return [];

  const rows: BreakdownSummaryInvestmentRow[] = [];
  const financial = readFinite(extended.investmentFinancialClp);
  const previsional = readFinite(extended.investmentPrevisionalClp);
  const investmentOthers = readFinite(extended.investmentOthersClp);
  const tenencia = readFinite(extended.tenenciaClp);

  if (financial !== null) rows.push({ label: 'Inversiones financieras', valueClp: financial, group: 'financieras' });
  if (previsional !== null) rows.push({ label: 'Inversiones previsionales', valueClp: previsional, group: 'previsionales' });
  if (tenencia !== null) rows.push({ label: TENENCIA_CXC_PREFIX_LABEL, valueClp: tenencia, group: 'otros' });
  if (includeRiskCapitalInTotals && Math.abs(riskCapital) > 0) {
    rows.push({ label: 'Capital de riesgo', valueClp: riskCapital, group: 'otros' });
  }
  if (investmentOthers !== null) rows.push({ label: 'Otras inversiones', valueClp: investmentOthers, group: 'otros' });

  const sumKnown = rows.reduce((sum, row) => sum + row.valueClp, 0);
  const residual = totalInvestment - sumKnown;
  if (Math.abs(residual) > 1) {
    rows.push({ label: 'Otros', valueClp: residual, group: 'otros' });
  }
  if (!rows.length && Math.abs(totalInvestment) > 0) {
    rows.push({ label: 'Otras inversiones', valueClp: totalInvestment, group: 'otros' });
  }
  return rows.filter((row) => Math.abs(row.valueClp) > 0.5);
};

const buildSummaryBreakdown = (
  summary: WealthSnapshotSummary,
  includeRiskCapitalInTotals: boolean,
): NetBreakdown => {
  const extended = summary as {
    bankClp?: number;
    nonMortgageDebtClp?: number;
    realEstateNetClp?: number;
    realEstateAssetsClp?: number;
    mortgageDebtClp?: number;
  };
  const netClp = resolveSummaryNetForRiskMode(summary, includeRiskCapitalInTotals);
  const investmentFromRows = buildSummaryInvestmentRows(summary, includeRiskCapitalInTotals).reduce(
    (sum, row) => sum + row.valueClp,
    0,
  );
  const bankClp = readFinite(extended.bankClp) ?? 0;
  const nonMortgageDebtClp = readFinite(extended.nonMortgageDebtClp) ?? 0;
  const realEstateNetClp =
    readFinite(extended.realEstateNetClp) ?? (netClp - investmentFromRows - bankClp + nonMortgageDebtClp);
  const mortgageDebtClp = Math.abs(readFinite(extended.mortgageDebtClp) ?? 0);
  const realEstateAssetsClp =
    readFinite(extended.realEstateAssetsClp) ?? Math.max(0, realEstateNetClp + mortgageDebtClp);

  return {
    netClp,
    investmentClp: investmentFromRows,
    realEstateAssetsClp,
    mortgageDebtClp,
    realEstateNetClp,
    bankClp,
    nonMortgageDebtClp,
  };
};

const toComparableFields = (
  summary: WealthSnapshotSummary,
  includeRiskCapitalInTotals: boolean,
): ComparableVersionFields => {
  const breakdown = buildSummaryBreakdown(summary, includeRiskCapitalInTotals);
  return {
    bankClp: breakdown.bankClp,
    investmentClp: breakdown.investmentClp,
    realEstateNetClp: breakdown.realEstateNetClp,
    nonMortgageDebtClp: breakdown.nonMortgageDebtClp,
    netClp: breakdown.netClp,
  };
};

const hasExtendedSummaryFields = (summary: WealthSnapshotSummary | undefined | null) => {
  const extended = summary as {
    bankClp?: number;
    nonMortgageDebtClp?: number;
    realEstateNetClp?: number;
    realEstateAssetsClp?: number;
    mortgageDebtClp?: number;
  } | null;
  if (!extended) return false;
  return [
    extended.bankClp,
    extended.nonMortgageDebtClp,
    extended.realEstateNetClp,
    extended.realEstateAssetsClp,
    extended.mortgageDebtClp,
  ].some((value) => Number.isFinite(Number(value)));
};

const buildComparableDelta = (
  left: ComparableVersionFields | null,
  right: ComparableVersionFields | null,
): ComparableVersionFields | null => {
  if (!left || !right) return null;
  return {
    bankClp: (left.bankClp ?? 0) - (right.bankClp ?? 0),
    investmentClp: (left.investmentClp ?? 0) - (right.investmentClp ?? 0),
    realEstateNetClp: (left.realEstateNetClp ?? 0) - (right.realEstateNetClp ?? 0),
    nonMortgageDebtClp: (left.nonMortgageDebtClp ?? 0) - (right.nonMortgageDebtClp ?? 0),
    netClp: left.netClp - right.netClp,
  };
};

const normalizeAuditRecords = (records: unknown): WealthRecord[] => {
  if (!Array.isArray(records)) return [];
  return records
    .filter((record): record is WealthRecord => !!record && typeof record === 'object')
    .map((record) => ({
      ...record,
      id: String((record as WealthRecord).id || crypto.randomUUID()),
      block: (record as WealthRecord).block,
      source: String((record as WealthRecord).source || ''),
      label: String((record as WealthRecord).label || ''),
      amount: Number((record as WealthRecord).amount || 0),
      currency: (record as WealthRecord).currency,
      snapshotDate: String((record as WealthRecord).snapshotDate || ''),
      createdAt: String((record as WealthRecord).createdAt || ''),
      note: String((record as WealthRecord).note || ''),
    }))
    .filter((record) => !!record.label && !!record.block && !!record.currency);
};

const buildBankAuditRows = (records: WealthRecord[], fx: WealthFxRates): ClosureAuditRecordRow[] => {
  const providerClp = new Set(WEALTH_LABEL_CATALOG.bank.providersClp.map((label) => labelMatchKey(label)));
  const providerUsd = new Set(WEALTH_LABEL_CATALOG.bank.providersUsd.map((label) => labelMatchKey(label)));
  const aggregateClp = new Set(
    [...WEALTH_LABEL_CATALOG.bank.aggregate, ...WEALTH_LABEL_CATALOG.bank.aggregateLegacyAliases]
      .filter((label) => label.includes('CLP'))
      .map((label) => labelMatchKey(label)),
  );
  const aggregateUsd = new Set(
    [...WEALTH_LABEL_CATALOG.bank.aggregate, ...WEALTH_LABEL_CATALOG.bank.aggregateLegacyAliases]
      .filter((label) => label.includes('USD'))
      .map((label) => labelMatchKey(label)),
  );
  const nonDebtBankRows = records.filter(
    (record) => record.block === 'bank' && !isSyntheticAggregateRecord(record) && !isNonMortgageDebtRecord(record),
  );
  const hasProviderClp = nonDebtBankRows.some(
    (record) => record.currency === 'CLP' && providerClp.has(labelMatchKey(record.label)),
  );
  const hasProviderUsd = nonDebtBankRows.some(
    (record) => record.currency === 'USD' && providerUsd.has(labelMatchKey(record.label)),
  );

  return records
    .filter((record) => record.block === 'bank' || isNonMortgageDebtRecord(record))
    .map((record) => {
      const labelKey = labelMatchKey(record.label);
      const isDebt = isNonMortgageDebtRecord(record);
      const synthetic = isSyntheticAggregateRecord(record);
      let countsForBank = false;
      if (record.block === 'bank' && !isDebt && !synthetic) {
        if (record.currency === 'CLP') {
          countsForBank = hasProviderClp ? providerClp.has(labelKey) : !aggregateClp.has(labelKey);
        } else if (record.currency === 'USD') {
          countsForBank = hasProviderUsd ? providerUsd.has(labelKey) : !aggregateUsd.has(labelKey);
        } else {
          countsForBank = true;
        }
      }

      return {
        label: record.label,
        currency: record.currency,
        amount: Number(record.amount || 0),
        amountClp: toClp(Number(record.amount || 0), record.currency, fx),
        source: String(record.source || ''),
        note: String(record.note || ''),
        block: record.block,
        isNonMortgageDebt: isDebt,
        countsForBank,
        countsForDebt: isDebt,
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.label.localeCompare(b.label));
};

type ClosureAuditLike = Pick<WealthMonthlyClosure, 'id' | 'monthKey' | 'closedAt' | 'summary' | 'fxRates'> & {
  replacedAt?: string;
  records?: WealthRecord[];
  previousVersions?: ClosureAuditLike[];
};

export const buildClosureAuditSnapshot = ({
  closure,
  includeRiskCapitalInTotals,
  fallbackFx,
}: {
  closure: ClosureAuditLike;
  includeRiskCapitalInTotals: boolean;
  fallbackFx: WealthFxRates;
}): ClosureAuditSnapshot => {
  const records = normalizeAuditRecords(closure.records);
  const fx = closure.fxRates || fallbackFx;
  const persisted = closure.summary ? toComparableFields(closure.summary, includeRiskCapitalInTotals) : null;
  const canonicalSummary = records.length ? buildCanonicalClosureSummary(dedupeClosureRecords(records), fx) : null;
  const canonical = canonicalSummary ? toComparableFields(canonicalSummary, includeRiskCapitalInTotals) : null;
  return {
    id: String(closure.id || crypto.randomUUID()),
    monthKey: String(closure.monthKey || ''),
    closedAt: String(closure.closedAt || ''),
    replacedAt: closure.replacedAt ? String(closure.replacedAt) : undefined,
    persisted,
    canonical,
    delta: buildComparableDelta(canonical, persisted),
    recordCount: records.length,
    hasRecords: records.length > 0,
    hasSummary: !!closure.summary,
    hasSummaryExtended: hasExtendedSummaryFields(closure.summary),
    bankRows: buildBankAuditRows(records, fx),
  };
};

export const buildClosureAuditDiagnosis = ({
  current,
  previousVersions,
  comparisonBankClp,
}: {
  current: ClosureAuditSnapshot | null;
  previousVersions: ClosureAuditCandidate[];
  comparisonBankClp: number | null;
}): ClosureAuditDiagnosis => {
  if (!current) {
    return { messages: ['No hay cierre seleccionado para auditar.'], recommendedCandidateId: null };
  }

  const messages: string[] = [];
  if ((current.persisted?.bankClp ?? 0) <= 0 && current.bankRows.some((row) => row.countsForBank)) {
    messages.push('El cierre actual no muestra bancos válidos pese a tener records bancarios en detalle.');
  }
  if (comparisonBankClp !== null && (current.persisted?.bankClp ?? 0) + 1 < comparisonBankClp) {
    messages.push('Actual parece incompleto en bancos frente al mes siguiente.');
  }
  if (current.canonical && current.persisted && Math.abs((current.delta?.bankClp ?? 0)) > 1) {
    messages.push('El summary persistido diverge del canónico recalculado en bancos.');
  }
  if (!previousVersions.length) {
    messages.push('No hay versión previa utilizable para comparar.');
    return { messages, recommendedCandidateId: null };
  }

  const sortedCandidates = [...previousVersions]
    .filter((candidate) => candidate.candidateScore !== null)
    .sort((a, b) => Number(a.candidateScore) - Number(b.candidateScore));
  const best = sortedCandidates[0] || null;
  if (best?.candidateReason) {
    messages.push(best.candidateReason);
  }
  if (!best) {
    messages.push('No reparar sin inspección manual: ninguna previousVersion aparece claramente superior.');
  }
  return {
    messages,
    recommendedCandidateId: best?.id || null,
  };
};

const loadRawClosuresReadOnly = (): ClosureAuditLike[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RAW_CLOSURES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: ClosureAuditLike) => !!item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || crypto.randomUUID()),
        monthKey: String(item.monthKey || ''),
        closedAt: String(item.closedAt || ''),
        replacedAt: item.replacedAt ? String(item.replacedAt) : undefined,
        summary: item.summary,
        fxRates: item.fxRates,
        records: normalizeAuditRecords(item.records),
        previousVersions: Array.isArray(item.previousVersions)
          ? item.previousVersions.map((version) => ({
              id: String(version?.id || crypto.randomUUID()),
              monthKey: String(version?.monthKey || item.monthKey || ''),
              closedAt: String(version?.closedAt || ''),
              replacedAt: version?.replacedAt ? String(version.replacedAt) : undefined,
              summary: version?.summary,
              fxRates: version?.fxRates,
              records: normalizeAuditRecords(version?.records),
            }))
          : undefined,
      }))
      .filter((item) => !!item.monthKey);
  } catch {
    return [];
  }
};

interface ComparableVersionFields {
  bankClp: number | null;
  investmentClp: number | null;
  realEstateNetClp: number | null;
  nonMortgageDebtClp: number | null;
  netClp: number;
}

interface ClosureSummaryEditDraft {
  investmentClp: string;
  riskCapitalClp: string;
  realEstateNetClp: string;
  bankClp: string;
  nonMortgageDebtClp: string;
}

type ClosureEditDirtyFields = Partial<Record<EditableFieldKey, boolean>>;

const buildComparableVersionFields = (
  records: WealthRecord[] | undefined,
  summaryNetClp: number,
  fx: WealthFxRates,
  includeRiskCapitalInTotals: boolean,
): ComparableVersionFields => {
  if (Array.isArray(records) && records.length > 0) {
    const resolved = resolveRiskCapitalRecordsForTotals(records, includeRiskCapitalInTotals);
    const breakdown = buildNetBreakdown(resolved.recordsForTotals, fx);
    return {
      bankClp: breakdown.bankClp,
      investmentClp: breakdown.investmentClp,
      realEstateNetClp: breakdown.realEstateNetClp,
      nonMortgageDebtClp: breakdown.nonMortgageDebtClp,
      netClp: breakdown.netClp,
    };
  }

  return {
    bankClp: null,
    investmentClp: null,
    realEstateNetClp: null,
    nonMortgageDebtClp: null,
    netClp: Number(summaryNetClp || 0),
  };
};

const getChangedFieldLabels = (
  older: ComparableVersionFields,
  newer: ComparableVersionFields,
) => {
  const changed: string[] = [];
  if (
    older.bankClp !== null &&
    newer.bankClp !== null &&
    Math.round(older.bankClp) !== Math.round(newer.bankClp)
  ) {
    changed.push('Bancos');
  }
  if (
    older.investmentClp !== null &&
    newer.investmentClp !== null &&
    Math.round(older.investmentClp) !== Math.round(newer.investmentClp)
  ) {
    changed.push('Inversiones');
  }
  if (
    older.realEstateNetClp !== null &&
    newer.realEstateNetClp !== null &&
    Math.round(older.realEstateNetClp) !== Math.round(newer.realEstateNetClp)
  ) {
    changed.push('Bienes raíces');
  }
  if (
    older.nonMortgageDebtClp !== null &&
    newer.nonMortgageDebtClp !== null &&
    Math.round(older.nonMortgageDebtClp) !== Math.round(newer.nonMortgageDebtClp)
  ) {
    changed.push('Deuda');
  }
  if (Math.round(older.netClp) !== Math.round(newer.netClp)) {
    changed.push('Patrimonio total');
  }
  return changed;
};

export const buildEditedClosureRecordsFromDraft = ({
  records,
  draft,
  dirtyFields,
  monthKey,
  createdAt,
}: {
  records: WealthRecord[];
  draft: Record<EditableFieldKey, string>;
  dirtyFields: ClosureEditDirtyFields;
  monthKey: string;
  createdAt: string;
}): {
  records: WealthRecord[];
  expectedEditedFields: Array<{
    label: string;
    canonicalLabel: string;
    amount: number;
    currency: WealthCurrency;
  }>;
} => {
  let nextRecords = dedupeClosureRecords(records.map((record) => ({ ...record })));
  const snapshotDate = `${monthKey}-01`;
  const expectedEditedFields: Array<{
    label: string;
    canonicalLabel: string;
    amount: number;
    currency: WealthCurrency;
  }> = [];

  CLOSURE_EDITABLE_FIELDS.forEach((field) => {
    if (!dirtyFields[field.key]) return;
    const raw = draft[field.key];
    const existing = findRecordByCanonicalLabel(nextRecords, field.canonicalLabel);
    if (String(raw || '').trim() === '') return;

    if (field.key === 'bancosClp' || field.key === 'bancosUsd') {
      nextRecords = nextRecords.filter(
        (record) =>
          !(
            record.block === 'bank' &&
            record.currency === field.currency &&
            !isNonMortgageDebtRecord(record)
          ),
      );
    } else if (field.key === 'tarjetasClp' || field.key === 'tarjetasUsd') {
      nextRecords = nextRecords.filter(
        (record) =>
          !(
            record.block === 'debt' &&
            record.currency === field.currency &&
            !isMortgagePrincipalDebtLabel(record.label) &&
            !isMortgageMetaDebtLabel(record.label)
          ),
      );
    } else {
      nextRecords = nextRecords.filter(
        (record) => !matchCanonicalWithAliases(record.label, field.canonicalLabel),
      );
    }

    const parsed = parseStrictNumber(raw);
    if (!Number.isFinite(parsed)) return;
    const normalized = field.normalizeAmount ? field.normalizeAmount(parsed) : parsed;
    const targetCurrency =
      field.key === 'tenencia' && existing?.currency ? existing.currency : field.currency;
    expectedEditedFields.push({
      label: field.label,
      canonicalLabel: field.canonicalLabel,
      amount: normalized,
      currency: targetCurrency,
    });
    nextRecords.push({
      id: existing?.id || crypto.randomUUID(),
      block: field.block,
      source: 'Edición cierre',
      label: field.label,
      amount: normalized,
      currency: targetCurrency,
      createdAt,
      snapshotDate,
      note: `Edición manual cierre ${monthKey}`,
    });
  });

  return {
    records: dedupeClosureRecords(nextRecords),
    expectedEditedFields,
  };
};


export const ClosingAurum: React.FC = () => {
  const [tab, setTab] = useState<ClosingTab>('cierre');
  const [currency, setCurrency] = useState<WealthCurrency>(() => readPreferredClosingCurrency());
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [currentFx, setCurrentFx] = useState<WealthFxRates>(() => loadFxRates());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [revision, setRevision] = useState(0);
  const [selectedClosureMonthKey, setSelectedClosureMonthKey] = useState('');
  const [closureEditOpen, setClosureEditOpen] = useState(false);
  const [closureEditConfirmOpen, setClosureEditConfirmOpen] = useState(false);
  const [closureEditError, setClosureEditError] = useState('');
  const [closureSummaryEditDraft, setClosureSummaryEditDraft] = useState<ClosureSummaryEditDraft>({
    investmentClp: '',
    riskCapitalClp: '',
    realEstateNetClp: '',
    bankClp: '',
    nonMortgageDebtClp: '',
  });
  const [closureEditDraft, setClosureEditDraft] = useState<Record<EditableFieldKey, string>>(
    () =>
      CLOSURE_EDITABLE_FIELDS.reduce((acc, field) => {
        acc[field.key] = '';
        return acc;
      }, {} as Record<EditableFieldKey, string>),
  );
  const [closureEditDirtyFields, setClosureEditDirtyFields] = useState<ClosureEditDirtyFields>({});
  const [closureEditRates, setClosureEditRates] = useState({
    usdClp: '',
    eurUsd: '',
    ufClp: '',
  });
  const [auditCopied, setAuditCopied] = useState(false);
  const [may2023HotfixConfirmOpen, setMay2023HotfixConfirmOpen] = useState(false);
  const [may2023HotfixBusy, setMay2023HotfixBusy] = useState(false);
  const [may2023HotfixMessage, setMay2023HotfixMessage] = useState('');
  useEffect(() => {
    window.localStorage.setItem(PREFERRED_CLOSING_CURRENCY_KEY, currency);
  }, [currency]);

  const toggleRiskCapitalView = () => {
    setIncludeRiskCapitalInTotals((prev) => {
      const next = !prev;
      saveIncludeRiskCapitalInTotals(next);
      return next;
    });
  };

  useEffect(() => {
    const refreshLocal = () => {
      setCurrentFx(loadFxRates());
      setMonthKey(currentMonthKey());
      setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
      setRevision((v) => v + 1);
    };
    const refreshFromCloudIfNeeded = async (force = false) => {
      await hydrateWealthFromCloudShared({ force, minIntervalMs: 15_000 });
      refreshLocal();
    };

    const onBottomNavRetap = (event: Event) => {
      const custom = event as CustomEvent<{ to?: string }>;
      if (custom.detail?.to !== '/closing') return;
      void refreshFromCloudIfNeeded();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshFromCloudIfNeeded();
    };

    const onFocus = () => {
      void refreshFromCloudIfNeeded();
    };
    const onStorage = () => {
      refreshLocal();
    };
    const onWealthUpdated = () => {
      refreshLocal();
    };
    const onRiskCapitalPreference = () => {
      setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
      setRevision((v) => v + 1);
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshLocal as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      onRiskCapitalPreference as EventListener,
    );
    document.addEventListener('visibilitychange', onVisibility);
    void refreshFromCloudIfNeeded(true);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(BOTTOM_NAV_RETAP_EVENT, onBottomNavRetap as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshLocal as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        onRiskCapitalPreference as EventListener,
      );
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const closures = useMemo(() => loadClosures().sort((a, b) => b.monthKey.localeCompare(a.monthKey)), [revision]);

  useEffect(() => {
    if (!closures.length) {
      setSelectedClosureMonthKey('');
      return;
    }
    setSelectedClosureMonthKey((prev) => {
      if (prev && closures.some((closure) => closure.monthKey === prev)) return prev;
      return closures[0].monthKey;
    });
  }, [closures]);

  useEffect(() => {
    if (!closures.length) return;
    const target = String(window.localStorage.getItem(CLOSING_FOCUS_MONTH_KEY) || '').trim();
    if (!target) return;
    if (!closures.some((closure) => closure.monthKey === target)) return;
    setTab('cierre');
    setSelectedClosureMonthKey(target);
    window.localStorage.removeItem(CLOSING_FOCUS_MONTH_KEY);
  }, [closures]);

  const may2023HotfixTarget = useMemo(() => {
    const target = closures.find((closure) => closure.monthKey === MAY_2023_HOTFIX_MONTH_KEY);
    if (!target || (Array.isArray(target.records) && target.records.length > 0)) return null;
    const currentNet = Number(target.summary?.netClp || 0);
    const currentNetWithRisk = Number(target.summary?.netClpWithRisk || target.summary?.netConsolidatedClp || 0);
    if (
      Math.round(currentNet) !== MAY_2023_HOTFIX_NET_CLP_OLD ||
      Math.round(currentNetWithRisk) !== MAY_2023_HOTFIX_NET_WITH_RISK_OLD
    ) {
      return null;
    }
    return target;
  }, [closures]);

  const applyMay2023Hotfix = async () => {
    if (!may2023HotfixTarget) return;
    setMay2023HotfixBusy(true);
    setMay2023HotfixMessage('');
    try {
      const currentNet = Number(may2023HotfixTarget.summary?.netClp || 0);
      const currentNetWithRisk = Number(
        may2023HotfixTarget.summary?.netClpWithRisk || may2023HotfixTarget.summary?.netConsolidatedClp || 0,
      );
      console.info('[Closing][hotfix-2023-05-before]', {
        monthKey: may2023HotfixTarget.monthKey,
        oldNetClp: currentNet,
        oldNetClpWithRisk: currentNetWithRisk,
      });
      const backup = await createWealthBackupSnapshot('Hotfix manual cierre 2023-05');
      if (!backup.ok) {
        throw new Error(`No pude generar backup previo: ${backup.message}`);
      }
      const nextSummary: WealthSnapshotSummary = {
        ...may2023HotfixTarget.summary,
        netByCurrency: {
          CLP: MAY_2023_HOTFIX_NET_WITH_RISK,
          USD: 0,
          EUR: 0,
          UF: 0,
        },
        assetsByCurrency: {
          CLP:
            MAY_2023_HOTFIX_INVESTMENT_WITH_RISK_CLP +
            MAY_2023_HOTFIX_REAL_ESTATE_NET_CLP +
            MAY_2023_HOTFIX_BANK_CLP,
          USD: 0,
          EUR: 0,
          UF: 0,
        },
        debtsByCurrency: {
          CLP: MAY_2023_HOTFIX_NON_MORTGAGE_DEBT_CLP,
          USD: 0,
          EUR: 0,
          UF: 0,
        },
        byBlock: {
          bank: { CLP: MAY_2023_HOTFIX_BANK_CLP, USD: 0, EUR: 0, UF: 0 },
          investment: { CLP: MAY_2023_HOTFIX_INVESTMENT_WITH_RISK_CLP, USD: 0, EUR: 0, UF: 0 },
          real_estate: { CLP: MAY_2023_HOTFIX_REAL_ESTATE_NET_CLP, USD: 0, EUR: 0, UF: 0 },
          debt: { CLP: MAY_2023_HOTFIX_NON_MORTGAGE_DEBT_CLP, USD: 0, EUR: 0, UF: 0 },
        },
        investmentClp: MAY_2023_HOTFIX_INVESTMENT_CLP,
        riskCapitalClp: MAY_2023_HOTFIX_RISK_CLP,
        investmentClpWithRisk: MAY_2023_HOTFIX_INVESTMENT_WITH_RISK_CLP,
        netClp: MAY_2023_HOTFIX_NET_CLP,
        netClpWithRisk: MAY_2023_HOTFIX_NET_WITH_RISK,
        netConsolidatedClp: MAY_2023_HOTFIX_NET_WITH_RISK,
      };
      const nextSummaryExtended = nextSummary as WealthSnapshotSummary & {
        tenenciaClp?: number;
        investmentFinancialClp?: number;
        investmentPrevisionalClp?: number;
        bankClp?: number;
        nonMortgageDebtClp?: number;
        realEstateNetClp?: number;
      };
      nextSummaryExtended.tenenciaClp = MAY_2023_HOTFIX_TENENCIA_CLP;
      nextSummaryExtended.investmentFinancialClp = MAY_2023_HOTFIX_INVESTMENT_FINANCIAL_CLP;
      nextSummaryExtended.investmentPrevisionalClp = MAY_2023_HOTFIX_INVESTMENT_PREVISIONAL_CLP;
      nextSummaryExtended.bankClp = MAY_2023_HOTFIX_BANK_CLP;
      nextSummaryExtended.nonMortgageDebtClp = MAY_2023_HOTFIX_NON_MORTGAGE_DEBT_CLP;
      nextSummaryExtended.realEstateNetClp = MAY_2023_HOTFIX_REAL_ESTATE_NET_CLP;

      const replacedAt = new Date().toISOString();
      const previousVersion = {
        id: may2023HotfixTarget.id,
        monthKey: may2023HotfixTarget.monthKey,
        closedAt: may2023HotfixTarget.closedAt,
        replacedAt,
        summary: may2023HotfixTarget.summary,
        fxRates: may2023HotfixTarget.fxRates,
        fxMissing: may2023HotfixTarget.fxMissing,
        records: may2023HotfixTarget.records,
      };
      const nextClosure = {
        ...may2023HotfixTarget,
        id: crypto.randomUUID(),
        closedAt: replacedAt,
        summary: nextSummary,
        previousVersions: [previousVersion, ...(may2023HotfixTarget.previousVersions || [])],
      };
      const nextClosures = [
        nextClosure,
        ...closures.filter((closure) => closure.monthKey !== MAY_2023_HOTFIX_MONTH_KEY),
      ].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      saveClosures(nextClosures);
      const verify = loadClosures().find((closure) => closure.monthKey === MAY_2023_HOTFIX_MONTH_KEY);
      const verifiedNet = Number(verify?.summary?.netClp || 0);
      const verifiedNetWithRisk = Number(verify?.summary?.netClpWithRisk || verify?.summary?.netConsolidatedClp || 0);
      console.info('[Closing][hotfix-2023-05-after]', {
        monthKey: MAY_2023_HOTFIX_MONTH_KEY,
        newNetClp: verifiedNet,
        newNetClpWithRisk: verifiedNetWithRisk,
      });
      if (
        Math.round(verifiedNet) !== MAY_2023_HOTFIX_NET_CLP ||
        Math.round(verifiedNetWithRisk) !== MAY_2023_HOTFIX_NET_WITH_RISK
      ) {
        throw new Error('No pude confirmar la corrección del cierre 2023-05.');
      }
      setMay2023HotfixMessage('Corrección aplicada correctamente en mayo 2023.');
      setRevision((v) => v + 1);
    } catch (err: any) {
      setMay2023HotfixMessage(`Error al aplicar corrección: ${String(err?.message || err || 'error')}`);
    } finally {
      setMay2023HotfixBusy(false);
      setMay2023HotfixConfirmOpen(false);
    }
  };

  const currentRecordsRaw = useMemo(() => latestRecordsForMonth(loadWealthRecords(), monthKey), [monthKey, revision]);
  const currentRecords = useMemo(
    // [PRODUCT RULE] Si excluir capital de riesgo vacía el set, se usa base sin filtrar.
    () => resolveRiskCapitalRecordsForTotals(currentRecordsRaw, includeRiskCapitalInTotals).recordsForTotals,
    [currentRecordsRaw, includeRiskCapitalInTotals],
  );
  const currentHasRiskCapital = useMemo(
    () =>
      currentRecordsRaw.some(
        (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
      ),
    [currentRecordsRaw],
  );
  const currentBreakdown = useMemo<NetBreakdown>(
    () => buildNetBreakdown(currentRecords, currentFx),
    [currentRecords, currentFx],
  );
  const missingCriticalCount = useMemo(() => {
    const required = [...REQUIRED_INVESTMENT_LABELS, ...REQUIRED_REAL_ESTATE_CORE_FOR_NET];
    return required.filter((requiredLabel) => {
      return !currentRecords.some((record) => {
        if (record.block === 'bank' || isSyntheticAggregateRecord(record)) return false;
        return sameCanonicalLabel(record.label, requiredLabel);
      });
    }).length;
  }, [currentRecords]);

  const selectedClosure = useMemo(
    () => closures.find((closure) => closure.monthKey === selectedClosureMonthKey) || null,
    [closures, selectedClosureMonthKey],
  );
  const compareClosureForSelected = useMemo(() => {
    if (!selectedClosure) return null;
    return (
      closures
        .filter((closure) => closure.monthKey < selectedClosure.monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null
      );
  }, [closures, selectedClosure]);

  const rawAuditClosures = useMemo(() => loadRawClosuresReadOnly(), [revision]);
  const rawSelectedClosure = useMemo(
    () => rawAuditClosures.find((closure) => closure.monthKey === selectedClosureMonthKey) || null,
    [rawAuditClosures, selectedClosureMonthKey],
  );
  const selectedAuditSnapshot = useMemo(
    () =>
      rawSelectedClosure
        ? buildClosureAuditSnapshot({
            closure: rawSelectedClosure,
            includeRiskCapitalInTotals,
            fallbackFx: currentFx,
          })
        : null,
    [rawSelectedClosure, includeRiskCapitalInTotals, currentFx],
  );
  const previousAuditCandidates = useMemo(() => {
    if (!rawSelectedClosure?.previousVersions?.length || !selectedAuditSnapshot) return [] as ClosureAuditCandidate[];
    return rawSelectedClosure.previousVersions.map((version, index) => {
      const snapshot = buildClosureAuditSnapshot({
        closure: version,
        includeRiskCapitalInTotals,
        fallbackFx: version.fxRates || rawSelectedClosure.fxRates || currentFx,
      });
      const bankDeltaVsCurrent =
        snapshot.canonical && selectedAuditSnapshot.persisted
          ? (snapshot.canonical.bankClp ?? 0) - (selectedAuditSnapshot.persisted.bankClp ?? 0)
          : snapshot.persisted && selectedAuditSnapshot.persisted
            ? (snapshot.persisted.bankClp ?? 0) - (selectedAuditSnapshot.persisted.bankClp ?? 0)
            : null;
      const debtDeltaVsCurrent =
        snapshot.canonical && selectedAuditSnapshot.persisted
          ? (snapshot.canonical.nonMortgageDebtClp ?? 0) - (selectedAuditSnapshot.persisted.nonMortgageDebtClp ?? 0)
          : snapshot.persisted && selectedAuditSnapshot.persisted
            ? (snapshot.persisted.nonMortgageDebtClp ?? 0) - (selectedAuditSnapshot.persisted.nonMortgageDebtClp ?? 0)
            : null;
      const totalDeltaVsCurrent =
        snapshot.canonical
          ? snapshot.canonical.netClp - (selectedAuditSnapshot.persisted?.netClp ?? 0)
          : snapshot.persisted
            ? snapshot.persisted.netClp - (selectedAuditSnapshot.persisted?.netClp ?? 0)
            : null;
      const comparable = snapshot.canonical || snapshot.persisted;
      const currentComparable = selectedAuditSnapshot.persisted;
      let candidateScore: number | null = null;
      let candidateReason: string | null = null;
      if (comparable && currentComparable) {
        candidateScore =
          Math.abs((comparable.nonMortgageDebtClp ?? 0) - (currentComparable.nonMortgageDebtClp ?? 0)) +
          Math.abs((comparable.realEstateNetClp ?? 0) - (currentComparable.realEstateNetClp ?? 0)) +
          Math.abs((comparable.investmentClp ?? 0) - (currentComparable.investmentClp ?? 0)) * 0.1 -
          Math.abs((comparable.bankClp ?? 0) - (currentComparable.bankClp ?? 0)) * 0.05;
        if ((comparable.bankClp ?? 0) > (currentComparable.bankClp ?? 0) + 1) {
          candidateReason = `PreviousVersion ${index + 1} contiene más bancos que la versión actual.`;
        }
      }
      return {
        ...snapshot,
        bankDeltaVsCurrent,
        debtDeltaVsCurrent,
        totalDeltaVsCurrent,
        candidateScore,
        candidateReason,
      };
    });
  }, [rawSelectedClosure, selectedAuditSnapshot, includeRiskCapitalInTotals, currentFx]);
  const comparisonMonthKey = useMemo(
    () => (selectedClosure ? nextMonthKey(selectedClosure.monthKey) : ''),
    [selectedClosure],
  );
  const comparisonMonthRecords = useMemo(
    () => (comparisonMonthKey ? latestRecordsForMonth(loadWealthRecords(), comparisonMonthKey) : []),
    [comparisonMonthKey, revision],
  );
  const comparisonMonthBankRows = useMemo(
    () => buildBankAuditRows(comparisonMonthRecords, currentFx),
    [comparisonMonthRecords, currentFx],
  );
  const comparisonMonthBankClp = useMemo(
    () =>
      comparisonMonthBankRows
        .filter((row) => row.countsForBank)
        .reduce((sum, row) => sum + row.amountClp, 0),
    [comparisonMonthBankRows],
  );
  const closureAuditDiagnosis = useMemo(
    () =>
      buildClosureAuditDiagnosis({
        current: selectedAuditSnapshot,
        previousVersions: previousAuditCandidates,
        comparisonBankClp: comparisonMonthBankRows.length ? comparisonMonthBankClp : null,
      }),
    [selectedAuditSnapshot, previousAuditCandidates, comparisonMonthBankRows.length, comparisonMonthBankClp],
  );


  const closureDisplayNetByMonth = useMemo(() => {
    const map = new Map<string, number>();
    closures.forEach((closure) => {
      const fx = closure.fxRates || currentFx;
      const hasClosureRecords = Array.isArray(closure.records) && closure.records.length > 0;
      const records = hasClosureRecords
        ? resolveRiskCapitalRecordsForTotals(closure.records, includeRiskCapitalInTotals).recordsForTotals
        : null;
      const netClp = hasClosureRecords
        ? buildNetBreakdown(records || [], fx).netClp
        : resolveSummaryNetForRiskMode(closure.summary, includeRiskCapitalInTotals);
      // [PRODUCT RULE] Cada período histórico usa su propio FX del momento del cierre.
      map.set(closure.monthKey, fromClp(netClp, currency, fx));
    });
    return map;
  }, [closures, currentFx, includeRiskCapitalInTotals, currency]);

  const selectedClosureRecordsRaw = selectedClosure?.records || null;
  const selectedClosureHasRiskCapital = useMemo(() => {
    if (!selectedClosure) return false;
    if (Array.isArray(selectedClosure.records) && selectedClosure.records.length > 0) {
      return selectedClosure.records.some(
        (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
      );
    }
    return Number(selectedClosure.summary?.riskCapitalClp || 0) > 0;
  }, [selectedClosure]);
  const compareClosureForSelectedRecordsRaw = compareClosureForSelected?.records || null;
  const selectedClosureRecords = useMemo(
    () =>
      selectedClosureRecordsRaw
        ? resolveRiskCapitalRecordsForTotals(selectedClosureRecordsRaw, includeRiskCapitalInTotals).recordsForTotals
        : null,
    [selectedClosureRecordsRaw, includeRiskCapitalInTotals],
  );
  const compareClosureForSelectedRecords = useMemo(
    () =>
      compareClosureForSelectedRecordsRaw
        ? resolveRiskCapitalRecordsForTotals(compareClosureForSelectedRecordsRaw, includeRiskCapitalInTotals).recordsForTotals
        : null,
    [compareClosureForSelectedRecordsRaw, includeRiskCapitalInTotals],
  );
  const selectedClosureFx = selectedClosure?.fxRates || currentFx;
  const compareClosureForSelectedFx = compareClosureForSelected?.fxRates || currentFx;

  const selectedClosureBreakdown = useMemo<NetBreakdown | null>(() => {
    if (!selectedClosure) return null;
    if (selectedClosureRecords?.length) return buildNetBreakdown(selectedClosureRecords, selectedClosureFx);
    return buildSummaryBreakdown(selectedClosure.summary, includeRiskCapitalInTotals);
  }, [selectedClosure, selectedClosureRecords, selectedClosureFx, includeRiskCapitalInTotals]);

  const compareClosureForSelectedBreakdown = useMemo<NetBreakdown | null>(() => {
    if (!compareClosureForSelected) return null;
    if (compareClosureForSelectedRecords?.length) {
      return buildNetBreakdown(compareClosureForSelectedRecords, compareClosureForSelectedFx);
    }
    return buildSummaryBreakdown(compareClosureForSelected.summary, includeRiskCapitalInTotals);
  }, [
    compareClosureForSelected,
    compareClosureForSelectedRecords,
    compareClosureForSelectedFx,
    includeRiskCapitalInTotals,
  ]);
  const selectedClosureSummaryInvestmentRows = useMemo(
    () =>
      selectedClosure && (!selectedClosureRecordsRaw || !selectedClosureRecordsRaw.length)
        ? buildSummaryInvestmentRows(selectedClosure.summary, includeRiskCapitalInTotals)
        : null,
    [selectedClosure, selectedClosureRecordsRaw, includeRiskCapitalInTotals],
  );
  const compareClosureForSelectedSummaryInvestmentRows = useMemo(
    () =>
      compareClosureForSelected && (!compareClosureForSelectedRecordsRaw || !compareClosureForSelectedRecordsRaw.length)
        ? buildSummaryInvestmentRows(compareClosureForSelected.summary, includeRiskCapitalInTotals)
        : null,
    [compareClosureForSelected, compareClosureForSelectedRecordsRaw, includeRiskCapitalInTotals],
  );

  const compareClosureForHoy = useMemo(
    () =>
      closures
        .filter((closure) => closure.monthKey < monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null,
    [closures, monthKey],
  );
  const compareClosureForHoyRecordsRaw = compareClosureForHoy?.records || null;
  const compareClosureForHoyHasRiskCapital = useMemo(() => {
    if (!compareClosureForHoy) return false;
    if (Array.isArray(compareClosureForHoy.records) && compareClosureForHoy.records.length > 0) {
      return compareClosureForHoy.records.some(
        (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
      );
    }
    return Number(compareClosureForHoy.summary?.riskCapitalClp || 0) > 0;
  }, [compareClosureForHoy]);
  const compareClosureForHoyRecords = useMemo(
    () =>
      compareClosureForHoyRecordsRaw
        ? resolveRiskCapitalRecordsForTotals(compareClosureForHoyRecordsRaw, includeRiskCapitalInTotals).recordsForTotals
        : null,
    [compareClosureForHoyRecordsRaw, includeRiskCapitalInTotals],
  );
  const compareClosureForHoyFx = compareClosureForHoy?.fxRates || currentFx;
  const compareClosureForHoyBreakdown = useMemo<NetBreakdown | null>(() => {
    if (!compareClosureForHoy) return null;
    if (compareClosureForHoyRecords?.length) return buildNetBreakdown(compareClosureForHoyRecords, compareClosureForHoyFx);
    return buildSummaryBreakdown(compareClosureForHoy.summary, includeRiskCapitalInTotals);
  }, [compareClosureForHoy, compareClosureForHoyRecords, compareClosureForHoyFx, includeRiskCapitalInTotals]);

  const evolutionRows = useMemo(() => {
    return closures
      .slice()
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
      .map((c) => {
        const fx = c.fxRates || currentFx;
        const hasClosureRecords = Array.isArray(c.records) && c.records.length > 0;
        const records = hasClosureRecords
          ? resolveRiskCapitalRecordsForTotals(c.records, includeRiskCapitalInTotals).recordsForTotals
          : null;
        const netClp = hasClosureRecords
          ? buildNetBreakdown(records || [], fx).netClp
          : resolveSummaryNetForRiskMode(c.summary, includeRiskCapitalInTotals);
        const hasRiskCapital = hasClosureRecords
          ? (c.records || []).some(
              (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
            )
          : Number(c.summary?.riskCapitalClp || 0) > 0;
        return {
          key: c.monthKey,
          label: monthLabel(c.monthKey),
          kind: 'cierre',
          net: fromClp(netClp, currency, fx),
          hasRiskCapital,
        };
      });
  }, [
    closures,
    currency,
    currentFx,
    includeRiskCapitalInTotals,
  ]);

  const evolutionWithReturns = useMemo(
    () =>
      evolutionRows.map((row, idx) => {
        const older = evolutionRows[idx + 1];
        if (!older || row.net === null || older.net === null) {
          return { ...row, delta: null as number | null, pct: null as number | null };
        }
        const delta = row.net - older.net;
        return { ...row, delta, pct: older.net !== 0 ? (delta / older.net) * 100 : null };
      }),
    [evolutionRows],
  );

  const closureHistoryVersions = selectedClosure?.previousVersions || [];
  const closureVersionChangesById = useMemo(() => {
    const map = new Map<string, string>();
    if (!selectedClosure || closureHistoryVersions.length <= 1) return map;

    const chain = [selectedClosure, ...closureHistoryVersions];
    const comparable = chain.map((item) => {
      const fx = item.fxRates || currentFx;
      return buildComparableVersionFields(
        item.records,
        resolveSummaryNetForRiskMode(item.summary, includeRiskCapitalInTotals),
        fx,
        includeRiskCapitalInTotals,
      );
    });

    for (let i = 1; i < chain.length; i += 1) {
      const older = chain[i];
      const olderFields = comparable[i];
      const newerFields = comparable[i - 1];
      const changed = getChangedFieldLabels(olderFields, newerFields);
      map.set(
        `${older.id}-${older.closedAt}`,
        changed.length ? `Cambió: ${changed.join(', ')}` : 'Sin cambios numéricos',
      );
    }

    return map;
  }, [selectedClosure, closureHistoryVersions, currentFx, includeRiskCapitalInTotals]);
  const closureVersionNetDisplayById = useMemo(() => {
    const map = new Map<string, number>();
    closureHistoryVersions.forEach((version) => {
      const fx = version.fxRates || currentFx;
      const hasVersionRecords = Array.isArray(version.records) && version.records.length > 0;
      const records = hasVersionRecords
        ? resolveRiskCapitalRecordsForTotals(version.records, includeRiskCapitalInTotals).recordsForTotals
        : null;
      const netClp = hasVersionRecords
        ? buildNetBreakdown(records || [], fx).netClp
        : resolveSummaryNetForRiskMode(version.summary, includeRiskCapitalInTotals);
      // [PRODUCT RULE] Cada versión histórica se muestra con su FX guardado en ese momento.
      map.set(`${version.id}-${version.closedAt}`, fromClp(netClp, currency, fx));
    });
    return map;
  }, [closureHistoryVersions, currentFx, includeRiskCapitalInTotals, currency]);
  const hoyMonthHeadlineKey = monthKey;

  const openClosureEditModal = () => {
    if (!selectedClosure) return;
    if (!selectedClosureRecordsRaw?.length) {
      const summary = selectedClosure.summary as WealthSnapshotSummary & {
        realEstateNetClp?: number;
        bankClp?: number;
        nonMortgageDebtClp?: number;
      };
      const investmentClp = Number(summary?.investmentClp || 0);
      const riskCapitalClp = Number(summary?.riskCapitalClp || 0);
      const fallbackBreakdown = buildSummaryBreakdown(summary, includeRiskCapitalInTotals);
      const realEstateNetClp = Number(summary?.realEstateNetClp ?? fallbackBreakdown.realEstateNetClp);
      const bankClp = Number(summary?.bankClp ?? fallbackBreakdown.bankClp);
      const nonMortgageDebtClp = Number(
        summary?.nonMortgageDebtClp ?? fallbackBreakdown.nonMortgageDebtClp,
      );
      setClosureSummaryEditDraft({
        investmentClp: String(Math.round(investmentClp)),
        riskCapitalClp: String(Math.round(riskCapitalClp)),
        realEstateNetClp: String(Math.round(realEstateNetClp)),
        bankClp: String(Math.round(bankClp)),
        nonMortgageDebtClp: String(Math.round(nonMortgageDebtClp)),
      });
      setClosureEditRates({
        usdClp: String(Math.round(selectedClosureFx.usdClp)),
        eurUsd: String(selectedClosureFx.eurClp / Math.max(1, selectedClosureFx.usdClp)),
        ufClp: String(Math.round(selectedClosureFx.ufClp)),
      });
      setClosureEditError('');
      setClosureEditDirtyFields({});
      setClosureEditOpen(true);
      return;
    }
    const nextDraft = CLOSURE_EDITABLE_FIELDS.reduce((acc, field) => {
      const existing = findRecordByCanonicalLabel(selectedClosureRecordsRaw, field.canonicalLabel);
      if (existing) {
        acc[field.key] = String(existing.amount);
        return acc;
      }
      if (field.key === 'bancosClp' || field.key === 'bancosUsd') {
        const aggregate = selectedClosureRecordsRaw
          .filter((record) => record.block === 'bank' && record.currency === field.currency)
          .reduce((sum, record) => sum + Number(record.amount || 0), 0);
        acc[field.key] = aggregate ? String(aggregate) : '';
        return acc;
      }
      if (field.key === 'tarjetasClp' || field.key === 'tarjetasUsd') {
        const aggregate = selectedClosureRecordsRaw
          .filter(
            (record) =>
              record.block === 'debt' &&
              record.currency === field.currency &&
              !isMortgagePrincipalDebtLabel(record.label) &&
              !isMortgageMetaDebtLabel(record.label),
          )
          .reduce((sum, record) => sum + Math.abs(Number(record.amount || 0)), 0);
        acc[field.key] = aggregate ? String(aggregate) : '';
        return acc;
      }
      acc[field.key] = '';
      return acc;
    }, {} as Record<EditableFieldKey, string>);
    setClosureEditDraft(nextDraft);
    setClosureEditDirtyFields({});
    setClosureEditRates({
      usdClp: String(Math.round(selectedClosureFx.usdClp)),
      eurUsd: String(selectedClosureFx.eurClp / Math.max(1, selectedClosureFx.usdClp)),
      ufClp: String(Math.round(selectedClosureFx.ufClp)),
    });
    setClosureEditError('');
    setClosureEditOpen(true);
  };

  const applyClosureEdit = () => {
    if (!selectedClosure) return;

    const usdClp = parseStrictNumber(closureEditRates.usdClp);
    const eurUsd = parseStrictNumber(closureEditRates.eurUsd);
    const ufClp = parseStrictNumber(closureEditRates.ufClp);
    if (![usdClp, eurUsd, ufClp].every((n) => Number.isFinite(n) && n > 0)) {
      setClosureEditError('Revisa TC/UF: USD/CLP, EUR/USD y UF/CLP deben ser mayores que 0.');
      return;
    }
    const eurClpCandidate = usdClp * eurUsd;
    const eurClp =
      Number.isFinite(selectedClosureFx.eurClp) &&
      selectedClosureFx.eurClp > 0 &&
      Math.abs(eurClpCandidate - selectedClosureFx.eurClp) <
        1e-9 * Math.max(1, Math.abs(selectedClosureFx.eurClp))
        ? selectedClosureFx.eurClp
        : eurClpCandidate;
    const invalidFx = [
      validateFxRange('usd_clp', usdClp),
      validateFxRange('eur_usd', eurUsd),
      validateFxRange('uf_clp', ufClp),
      validateFxRange('eur_clp', eurClp),
    ].find((result) => !!result);
    if (invalidFx) {
      console.error('[Closing][fx-range-error]', {
        monthKey: selectedClosure.monthKey,
        field: invalidFx.field,
        value: invalidFx.value,
        min: invalidFx.min,
        max: invalidFx.max,
      });
      setClosureEditError(
        `Valor fuera de rango esperado. Campo: ${invalidFx.field}, valor: ${invalidFx.value}, mes: ${selectedClosure.monthKey}.`,
      );
      return;
    }
    const nextFx: WealthFxRates = { usdClp, eurClp, ufClp };

    if (!selectedClosureRecordsRaw?.length) {
      const investmentClp = parseStrictNumber(closureSummaryEditDraft.investmentClp);
      const riskCapitalClp = parseStrictNumber(closureSummaryEditDraft.riskCapitalClp);
      const realEstateNetClp = parseStrictNumber(closureSummaryEditDraft.realEstateNetClp);
      const bankClp = parseStrictNumber(closureSummaryEditDraft.bankClp);
      const nonMortgageDebtClp = parseStrictNumber(closureSummaryEditDraft.nonMortgageDebtClp);
      if (
        ![investmentClp, riskCapitalClp, realEstateNetClp, bankClp, nonMortgageDebtClp].every((n) =>
          Number.isFinite(n),
        )
      ) {
        setClosureEditError('Revisa los totales del resumen: deben ser números válidos.');
        return;
      }
      const roundedInvestment = Math.round(investmentClp);
      const roundedRisk = Math.round(riskCapitalClp);
      const roundedInvestmentWithRisk = Math.round(investmentClp + riskCapitalClp);
      const roundedRealEstate = Math.round(realEstateNetClp);
      const roundedBank = Math.round(bankClp);
      const roundedDebt = Math.round(Math.abs(nonMortgageDebtClp));
      const roundedNet = Math.round(investmentClp + realEstateNetClp + bankClp - Math.abs(nonMortgageDebtClp));
      const roundedNetWithRisk = Math.round(
        investmentClp + riskCapitalClp + realEstateNetClp + bankClp - Math.abs(nonMortgageDebtClp),
      );
      const nextSummary: WealthSnapshotSummary = {
        ...selectedClosure.summary,
        netByCurrency: { CLP: roundedNetWithRisk, USD: 0, EUR: 0, UF: 0 },
        assetsByCurrency: {
          CLP: roundedInvestmentWithRisk + roundedRealEstate + roundedBank,
          USD: 0,
          EUR: 0,
          UF: 0,
        },
        debtsByCurrency: { CLP: roundedDebt, USD: 0, EUR: 0, UF: 0 },
        byBlock: {
          bank: { CLP: roundedBank, USD: 0, EUR: 0, UF: 0 },
          investment: { CLP: roundedInvestmentWithRisk, USD: 0, EUR: 0, UF: 0 },
          real_estate: { CLP: roundedRealEstate, USD: 0, EUR: 0, UF: 0 },
          debt: { CLP: roundedDebt, USD: 0, EUR: 0, UF: 0 },
        },
        investmentClp: roundedInvestment,
        riskCapitalClp: roundedRisk,
        investmentClpWithRisk: roundedInvestmentWithRisk,
        netClp: roundedNet,
        netClpWithRisk: roundedNetWithRisk,
        netConsolidatedClp: roundedNetWithRisk,
      };
      const nextSummaryExtended = nextSummary as WealthSnapshotSummary & {
        realEstateNetClp?: number;
        bankClp?: number;
        nonMortgageDebtClp?: number;
      };
      nextSummaryExtended.realEstateNetClp = roundedRealEstate;
      nextSummaryExtended.bankClp = roundedBank;
      nextSummaryExtended.nonMortgageDebtClp = roundedDebt;

      const replacedAt = new Date().toISOString();
      const previousVersion = {
        id: selectedClosure.id,
        monthKey: selectedClosure.monthKey,
        closedAt: selectedClosure.closedAt,
        replacedAt,
        summary: selectedClosure.summary,
        fxRates: selectedClosure.fxRates,
        fxMissing: selectedClosure.fxMissing,
        records: selectedClosure.records,
      };
      const nextClosure = {
        ...selectedClosure,
        id: crypto.randomUUID(),
        closedAt: replacedAt,
        fxRates: nextFx,
        summary: nextSummary,
        records: selectedClosure.records,
        previousVersions: [previousVersion, ...(selectedClosure.previousVersions || [])],
      };
      console.info('[Closing][summary-edit-before]', {
        monthKey: selectedClosure.monthKey,
        previousNetClp: selectedClosure.summary?.netClp,
        previousNetClpWithRisk: selectedClosure.summary?.netClpWithRisk,
      });
      const nextClosures = [
        nextClosure,
        ...loadClosures().filter((closure) => closure.monthKey !== selectedClosure.monthKey),
      ].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      saveClosures(nextClosures);
      const persisted = loadClosures().find((closure) => closure.monthKey === selectedClosure.monthKey) || null;
      const persistedNet = Number(persisted?.summary?.netClp || 0);
      const persistedNetRisk = Number(persisted?.summary?.netClpWithRisk || 0);
      console.info('[Closing][summary-edit-after]', {
        monthKey: selectedClosure.monthKey,
        persistedNetClp: persistedNet,
        persistedNetClpWithRisk: persistedNetRisk,
        expectedNetClp: roundedNet,
        expectedNetClpWithRisk: roundedNetWithRisk,
      });
      if (
        !persisted ||
        Math.abs(persistedNet - roundedNet) > 1e-6 ||
        Math.abs(persistedNetRisk - roundedNetWithRisk) > 1e-6
      ) {
        setClosureEditError('Guardado incompleto: no pude confirmar el resumen editado.');
        return;
      }
      setClosureEditOpen(false);
      setClosureEditError('');
      setRevision((v) => v + 1);
      return;
    }

    const createdAt = new Date().toISOString();

    console.info('[Closing][edit-before]', {
      monthKey: selectedClosure.monthKey,
      closureId: selectedClosure.id,
      recordsCount: selectedClosureRecordsRaw.length,
      draftFx: nextFx,
      draftValues: closureEditDraft,
    });

    for (const field of CLOSURE_EDITABLE_FIELDS) {
      if (!closureEditDirtyFields[field.key]) continue;
      const raw = closureEditDraft[field.key];
      if (String(raw || '').trim() === '') continue;
      const parsed = parseStrictNumber(raw);
      if (!Number.isFinite(parsed)) {
        setClosureEditError(`Monto inválido en "${field.label}".`);
        return;
      }
    }

    const {
      records: normalizedNextRecords,
      expectedEditedFields,
    } = buildEditedClosureRecordsFromDraft({
      records: selectedClosureRecordsRaw,
      draft: closureEditDraft,
      dirtyFields: closureEditDirtyFields,
      monthKey: selectedClosure.monthKey,
      createdAt,
    });

    const expectedSummary = summarizeWealth(normalizedNextRecords, nextFx);
    const expectedRiskOffNet = buildWealthNetBreakdown(
      resolveRiskCapitalRecordsForTotals(normalizedNextRecords, false).recordsForTotals,
      nextFx,
    ).netClp;
    const expectedRiskOnNet = buildWealthNetBreakdown(
      resolveRiskCapitalRecordsForTotals(normalizedNextRecords, true).recordsForTotals,
      nextFx,
    ).netClp;
    console.info('[Closing][edit-recalc-before]', {
      monthKey: selectedClosure.monthKey,
      expectedSummaryNetConsolidatedClp: expectedSummary.netConsolidatedClp,
      expectedSummaryNetClp: expectedSummary.netClp,
      expectedSummaryNetClpWithRisk: expectedSummary.netClpWithRisk,
      expectedRiskOffNet,
      expectedRiskOnNet,
      normalizedRecordsCount: normalizedNextRecords.length,
    });

    upsertMonthlyClosure({
      monthKey: selectedClosure.monthKey,
      records: normalizedNextRecords,
      fxRates: nextFx,
      closedAt: new Date().toISOString(),
    });
    const persistedClosure = loadClosures().find((closure) => closure.monthKey === selectedClosure.monthKey) || null;
    const persistedFx = persistedClosure?.fxRates || null;
    const fxMatches =
      !!persistedFx &&
      Math.abs((persistedFx.usdClp || 0) - nextFx.usdClp) < 1e-6 &&
      Math.abs((persistedFx.eurClp || 0) - nextFx.eurClp) < 1e-6 &&
      Math.abs((persistedFx.ufClp || 0) - nextFx.ufClp) < 1e-6;
    const missingEditedField = expectedEditedFields.find((field) => {
      const persistedRecord = persistedClosure?.records?.find((record) =>
        matchCanonicalWithAliases(record.label, field.canonicalLabel),
      );
      if (!persistedRecord) return true;
      if (persistedRecord.currency !== field.currency) return true;
      return Math.abs(Number(persistedRecord.amount) - field.amount) > 1e-6;
    });
    const persistedSummary = persistedClosure?.summary || null;
    const summaryMatches = !!persistedSummary &&
      Math.abs(Number(persistedSummary.netConsolidatedClp || 0) - Number(expectedSummary.netConsolidatedClp || 0)) < 1e-6 &&
      Math.abs(Number(persistedSummary.netClp || 0) - Number(expectedSummary.netClp || 0)) < 1e-6 &&
      Math.abs(Number(persistedSummary.netClpWithRisk || 0) - Number(expectedSummary.netClpWithRisk || 0)) < 1e-6;
    console.info('[Closing][edit-after]', {
      monthKey: selectedClosure.monthKey,
      closureId: persistedClosure?.id || null,
      expectedEditedFields,
      persistedFx,
      fxMatches,
      missingEditedField: missingEditedField?.label || null,
      summaryMatches,
      persistedSummaryNetConsolidatedClp: persistedSummary?.netConsolidatedClp ?? null,
      persistedSummaryNetClp: persistedSummary?.netClp ?? null,
      persistedSummaryNetClpWithRisk: persistedSummary?.netClpWithRisk ?? null,
      expectedSummaryNetConsolidatedClp: expectedSummary.netConsolidatedClp,
      expectedSummaryNetClp: expectedSummary.netClp,
      expectedSummaryNetClpWithRisk: expectedSummary.netClpWithRisk,
      expectedRiskOffNet,
      expectedRiskOnNet,
    });
    if (!persistedClosure || !fxMatches || missingEditedField || !summaryMatches) {
      setClosureEditError(
        `Guardado incompleto: no pude confirmar edición de cierre${
          missingEditedField
            ? ` (${missingEditedField.label})`
            : !summaryMatches
              ? ' (resumen no recalculado correctamente)'
              : ''
        }.`,
      );
      return;
    }
    setClosureEditOpen(false);
    setClosureEditError('');
    setRevision((v) => v + 1);
  };

  const copyAuditPreview = async () => {
    if (!selectedAuditSnapshot) return;
    const lines = [
      `Cierre auditado: ${monthLabel(selectedAuditSnapshot.monthKey)}`,
      `Cierre actual persistido: ${formatAuditSummary(selectedAuditSnapshot.persisted, 'CLP', currentFx)}`,
      `Cierre actual canónico: ${formatAuditSummary(selectedAuditSnapshot.canonical, 'CLP', currentFx)}`,
      selectedAuditSnapshot.delta
        ? `Delta canónico-persistido: bancos ${formatDelta(selectedAuditSnapshot.delta.bankClp, 'CLP')} · deuda ${formatDelta(selectedAuditSnapshot.delta.nonMortgageDebtClp, 'CLP')} · total ${formatDelta(selectedAuditSnapshot.delta.netClp, 'CLP')}`
        : 'Delta canónico-persistido: sin records para recalcular',
      comparisonMonthBankRows.length
        ? `Bancos ${monthLabel(comparisonMonthKey)}: ${formatCurrency(comparisonMonthBankClp, 'CLP')}`
        : `Bancos ${monthLabel(comparisonMonthKey)}: sin records para comparar`,
      ...previousAuditCandidates.map((candidate, index) => {
        const comparable = candidate.canonical || candidate.persisted;
        return [
          `PreviousVersion ${index + 1}: ${formatCloseTimestamp(candidate.closedAt)}`,
          formatAuditSummary(comparable, 'CLP', currentFx),
          `Delta bancos vs actual: ${formatDelta(candidate.bankDeltaVsCurrent, 'CLP')}`,
          `Delta deuda vs actual: ${formatDelta(candidate.debtDeltaVsCurrent, 'CLP')}`,
          candidate.candidateReason || 'Sin diagnóstico automático',
        ].join(' · ');
      }),
      ...closureAuditDiagnosis.messages.map((message) => `Diagnóstico: ${message}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setAuditCopied(true);
      window.setTimeout(() => setAuditCopied(false), 1800);
    } catch {
      setAuditCopied(false);
    }
  };

  return (
    <div className="p-4 space-y-2.5">
      <Card className="p-2 border-[#d5d7ce] bg-gradient-to-r from-[#f5f2e8] to-[#edf3ec]">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-2 gap-1">
            <Button
              variant={tab === 'cierre' ? 'primary' : 'secondary'}
              size="sm"
              className={
                tab === 'cierre'
                  ? 'text-[#f4efe3]'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }
              style={tab === 'cierre' ? { backgroundColor: ANKRE_DEEP_GREEN } : undefined}
              onClick={() => setTab('cierre')}
            >
              Cierre
            </Button>
            <Button
              variant={tab === 'evolucion' ? 'primary' : 'secondary'}
              size="sm"
              className={
                tab === 'evolucion'
                  ? 'text-[#f4efe3]'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }
              style={tab === 'evolucion' ? { backgroundColor: ANKRE_DEEP_GREEN } : undefined}
              onClick={() => setTab('evolucion')}
            >
              Evolución
            </Button>
          </div>
          <div className="flex items-center gap-1 self-end md:self-auto">
            {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => setCurrency(curr)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                  currency === curr
                    ? 'text-[#f4efe3]'
                    : 'border-slate-300 bg-white text-slate-600'
                }`}
                style={
                  currency === curr
                    ? { backgroundColor: ANKRE_BRONZE, borderColor: ANKRE_BRONZE_DARK }
                    : undefined
                }
              >
                {curr}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {tab === 'hoy' && (
        <div className="relative space-y-2.5 pb-12">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Mes en curso</div>
              <div className="text-[11px] text-slate-500">al {formatTodayContext()}</div>
            </div>
            <div className="text-xl font-bold text-slate-900">{monthLabel(hoyMonthHeadlineKey)}</div>
          </div>
          <BreakdownCard
            title="Patrimonio hoy"
            subtitle={`${monthLabel(monthKey)} vs ${
              compareClosureForHoy ? monthLabel(compareClosureForHoy.monthKey) : 'sin cierre previo'
            }`}
            breakdown={currentBreakdown}
            currency={currency}
            fx={currentFx}
            compareAgainst={compareClosureForHoyBreakdown}
            compareFx={compareClosureForHoyFx}
            currentRecords={currentRecordsRaw}
            compareRecords={compareClosureForHoyRecordsRaw}
            showPartialBadge={missingCriticalCount > 0}
            showRiskCapitalBadge={includeRiskCapitalInTotals && (currentHasRiskCapital || compareClosureForHoyHasRiskCapital)}
            riskModeOn={includeRiskCapitalInTotals}
          />
          <button
            type="button"
            onClick={toggleRiskCapitalView}
            className={`absolute bottom-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
              includeRiskCapitalInTotals
                ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-slate-300 bg-white/90 text-slate-400'
            }`}
            title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
            aria-label="Alternar capital de riesgo"
          >
            <Zap size={18} />
          </button>
        </div>
      )}

      {tab === 'cierre' && (
        <div className="relative space-y-2.5 pb-12">
          {(may2023HotfixTarget || may2023HotfixMessage) && (
            <Card className="p-3 border border-amber-200 bg-amber-50/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] text-amber-900">
                  Corrección manual disponible para cierre mayo 2023 (sin escritura automática).
                </div>
                {!!may2023HotfixTarget && (
                  <Button
                    onClick={() => setMay2023HotfixConfirmOpen(true)}
                    disabled={may2023HotfixBusy}
                    className="bg-amber-700 hover:bg-amber-800"
                  >
                    {may2023HotfixBusy ? 'Aplicando...' : 'Aplicar corrección'}
                  </Button>
                )}
              </div>
              {!!may2023HotfixMessage && <div className="mt-2 text-[11px] text-amber-900">{may2023HotfixMessage}</div>}
            </Card>
          )}
          {!selectedClosure ? (
            <Card className="p-4 text-xs text-slate-500">Todavía no hay cierres mensuales guardados.</Card>
          ) : (
            <>
              <Card className="p-3 border border-slate-200 bg-white">
                <div className="grid gap-3 lg:grid-cols-[1fr,1.1fr]">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Cierre seleccionado</div>
                    <div className="mt-0.5 text-xl font-bold text-slate-900">{monthLabel(selectedClosure.monthKey)}</div>
                    <div className="text-[11px] text-slate-500">
                      Cerrado el {formatCloseTimestamp(selectedClosure.closedAt)}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      USD/CLP {formatRateInt(selectedClosureFx.usdClp)} · EUR/USD{' '}
                      {formatRateDecimal(selectedClosureFx.eurClp / Math.max(1, selectedClosureFx.usdClp), 4)} · UF/CLP{' '}
                      {formatRateInt(selectedClosureFx.ufClp)}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Historial de cierres</div>
                      <div className="text-[11px] text-slate-500">Desplaza para ver meses</div>
                    </div>
                    <div
                      className="mt-2 grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto pr-1"
                    >
                      {closures.map((closure) => {
                        const selected = closure.monthKey === selectedClosureMonthKey;
                        return (
                          <button
                            key={closure.id}
                            onClick={() => setSelectedClosureMonthKey(closure.monthKey)}
                            className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                              selected
                                ? 'border-[#5c4b2d] bg-[#f5efe2] text-[#4d3f26]'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-wide">{monthLabel(closure.monthKey)}</div>
                            <div className="mt-0.5 text-[11px] font-semibold">
                              {formatCurrency(
                                closureDisplayNetByMonth.get(closure.monthKey) ??
                                  fromClp(
                                    resolveSummaryNetForRiskMode(closure.summary, includeRiskCapitalInTotals),
                                    currency,
                                    closure.fxRates || currentFx,
                                  ),
                                currency,
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {!selectedClosureRecordsRaw?.length && (
                  <div className="mt-3 text-[11px] text-amber-700">
                    Este cierre no tiene detalle por instrumento. Puedes editar sus subtotales desde "Editar".
                  </div>
                )}
              </Card>

              {!selectedClosureBreakdown ? (
                <Card className="p-4 text-xs text-slate-500">No hay datos suficientes para este cierre.</Card>
              ) : (
                <BreakdownCard
                  title={monthLabel(selectedClosure.monthKey)}
                  subtitle={
                    compareClosureForSelected
                      ? `vs ${monthLabel(compareClosureForSelected.monthKey)}`
                      : 'Sin cierre previo para comparar'
                  }
                  breakdown={selectedClosureBreakdown}
                  currency={currency}
                  fx={selectedClosureFx}
                  compareAgainst={compareClosureForSelectedBreakdown}
                  compareFx={compareClosureForSelectedFx}
                  currentRecords={selectedClosureRecordsRaw || []}
                  compareRecords={compareClosureForSelectedRecordsRaw}
                  summaryInvestmentRows={selectedClosureSummaryInvestmentRows}
                  compareSummaryInvestmentRows={compareClosureForSelectedSummaryInvestmentRows}
                  showClosureRates
                  showRiskCapitalBadge={includeRiskCapitalInTotals && selectedClosureHasRiskCapital}
                  riskModeOn={includeRiskCapitalInTotals}
                  headerAction={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openClosureEditModal}
                    >
                      Editar
                    </Button>
                  }
                />
              )}

              {!!closureHistoryVersions.length && (
                <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">
                    Versiones anteriores de este cierre ({closureHistoryVersions.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {closureHistoryVersions.map((version) => (
                      <div key={`${version.id}-${version.closedAt}`} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                        <div className="font-medium text-slate-700">
                          {monthLabel(version.monthKey)} · {formatCloseTimestamp(version.closedAt)}
                        </div>
                        {!!version.replacedAt && (
                          <div className="text-[11px] text-slate-500">
                            Reemplazado el {formatCloseTimestamp(version.replacedAt)}
                          </div>
                        )}
                        <div className="text-[11px]">
                          Neto:{' '}
                          {formatCurrency(
                            closureVersionNetDisplayById.get(`${version.id}-${version.closedAt}`) ??
                              fromClp(
                                resolveSummaryNetForRiskMode(version.summary, includeRiskCapitalInTotals),
                                currency,
                                version.fxRates || currentFx,
                              ),
                            currency,
                          )}
                        </div>
                        {closureHistoryVersions.length > 1 && (
                          <div className="text-[11px] text-slate-500">
                            {closureVersionChangesById.get(`${version.id}-${version.closedAt}`) ||
                              'Sin cambios numéricos'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <details className="rounded-xl border border-[#d8cfbd] bg-[#fcfaf4] p-3 text-xs text-slate-700" open={selectedClosure.monthKey === '2026-04'}>
                <summary className="cursor-pointer font-semibold text-slate-800">
                  Auditoría read-only del cierre
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Preview forense
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Lee el cierre crudo desde storage, recalcula el summary canónico en memoria y compara previousVersions sin escribir datos.
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={selectedClosureMonthKey}
                        onChange={(event) => setSelectedClosureMonthKey(event.target.value)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {closures.map((closure) => (
                          <option key={`audit-${closure.id}`} value={closure.monthKey}>
                            {monthLabel(closure.monthKey)}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" onClick={copyAuditPreview} disabled={!selectedAuditSnapshot}>
                        {auditCopied ? 'Preview copiado' : 'Copiar preview'}
                      </Button>
                    </div>
                  </div>

                  {!rawSelectedClosure || !selectedAuditSnapshot ? (
                    <Card className="border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                      No encontré el cierre crudo en `wealth_closures_v1`. La auditoría read-only necesita el snapshot persistido local para comparar summary actual vs canónico.
                    </Card>
                  ) : (
                    <>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <Card className="border border-slate-200 bg-white p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Cierre actual persistido
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                            <div>Mes</div>
                            <div className="font-medium text-slate-800">{selectedAuditSnapshot.monthKey}</div>
                            <div>Cerrado</div>
                            <div className="font-medium text-slate-800">{formatCloseTimestamp(selectedAuditSnapshot.closedAt)}</div>
                            <div>Actualizado</div>
                            <div className="font-medium text-slate-800">
                              {formatCloseTimestamp(rawSelectedClosure.replacedAt || rawSelectedClosure.closedAt)}
                            </div>
                            <div>Total</div>
                            <div className="font-medium text-slate-800">
                              {selectedAuditSnapshot.persisted
                                ? formatCurrency(selectedAuditSnapshot.persisted.netClp, 'CLP')
                                : 'Sin summary'}
                            </div>
                            <div>Inversiones</div>
                            <div className="font-medium text-slate-800">
                              {selectedAuditSnapshot.persisted
                                ? formatCurrency(selectedAuditSnapshot.persisted.investmentClp ?? 0, 'CLP')
                                : '—'}
                            </div>
                            <div>Bancos</div>
                            <div className="font-medium text-slate-800">
                              {selectedAuditSnapshot.persisted
                                ? formatCurrency(selectedAuditSnapshot.persisted.bankClp ?? 0, 'CLP')
                                : '—'}
                            </div>
                            <div>Bienes raíces</div>
                            <div className="font-medium text-slate-800">
                              {selectedAuditSnapshot.persisted
                                ? formatCurrency(selectedAuditSnapshot.persisted.realEstateNetClp ?? 0, 'CLP')
                                : '—'}
                            </div>
                            <div>Deudas no hipotecarias</div>
                            <div className="font-medium text-slate-800">
                              {selectedAuditSnapshot.persisted
                                ? formatCurrency(-(selectedAuditSnapshot.persisted.nonMortgageDebtClp ?? 0), 'CLP')
                                : '—'}
                            </div>
                            <div>Records</div>
                            <div className="font-medium text-slate-800">{selectedAuditSnapshot.recordCount}</div>
                            <div>Summary extendido</div>
                            <div className="font-medium text-slate-800">
                              {selectedAuditSnapshot.hasSummaryExtended ? 'Sí' : 'No'}
                            </div>
                            <div>PreviousVersions</div>
                            <div className="font-medium text-slate-800">
                              {rawSelectedClosure.previousVersions?.length || 0}
                            </div>
                          </div>
                        </Card>

                        <Card className="border border-slate-200 bg-white p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Recalculado en memoria
                          </div>
                          <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
                            <div className="font-semibold text-slate-500">Campo</div>
                            <div className="font-semibold text-slate-500">Persistido</div>
                            <div className="font-semibold text-slate-500">Canónico</div>
                            <div className="font-semibold text-slate-500">Delta</div>
                            {[
                              ['Total', 'netClp'],
                              ['Inversiones', 'investmentClp'],
                              ['Bancos', 'bankClp'],
                              ['Bienes raíces', 'realEstateNetClp'],
                              ['Deuda no hip.', 'nonMortgageDebtClp'],
                            ].map(([label, key]) => (
                              <React.Fragment key={key}>
                                <div>{label}</div>
                                <div>
                                  {selectedAuditSnapshot.persisted
                                    ? formatCurrency(
                                        Number(selectedAuditSnapshot.persisted[key as keyof ComparableVersionFields] || 0),
                                        'CLP',
                                      )
                                    : '—'}
                                </div>
                                <div>
                                  {selectedAuditSnapshot.canonical
                                    ? formatCurrency(
                                        Number(selectedAuditSnapshot.canonical[key as keyof ComparableVersionFields] || 0),
                                        'CLP',
                                      )
                                    : 'Sin records'}
                                </div>
                                <div className="font-medium text-slate-800">
                                  {selectedAuditSnapshot.delta
                                    ? formatDelta(
                                        Number(selectedAuditSnapshot.delta[key as keyof ComparableVersionFields] || 0),
                                        'CLP',
                                      )
                                    : '—'}
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                        </Card>
                      </div>

                      <Card className="border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Diagnóstico automático
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Señales para decidir si vale la pena preparar una reparación posterior.
                            </div>
                          </div>
                          {closureAuditDiagnosis.recommendedCandidateId && (
                            <span className="rounded-full border border-[#c8b38a] bg-[#f5efe2] px-2 py-1 text-[10px] font-semibold text-[#6d5432]">
                              Candidato sugerido detectado
                            </span>
                          )}
                        </div>
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                          {closureAuditDiagnosis.messages.map((message, index) => (
                            <li key={`audit-msg-${index}`} className="rounded-lg bg-slate-50 px-2 py-1">
                              {message}
                            </li>
                          ))}
                        </ul>
                      </Card>

                      <Card className="border border-slate-200 bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          PreviousVersions
                        </div>
                        {!previousAuditCandidates.length ? (
                          <div className="mt-2 text-[11px] text-slate-500">
                            Este cierre no tiene previousVersions útiles para comparar.
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {previousAuditCandidates.map((candidate, index) => {
                              const isRecommended = closureAuditDiagnosis.recommendedCandidateId === candidate.id;
                              const comparable = candidate.canonical || candidate.persisted;
                              return (
                                <div
                                  key={`audit-prev-${candidate.id}-${candidate.closedAt}`}
                                  className={`rounded-xl border p-3 ${
                                    isRecommended ? 'border-[#c8b38a] bg-[#f9f3e8]' : 'border-slate-200 bg-slate-50'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold text-slate-800">
                                      PreviousVersion {index + 1} · {formatCloseTimestamp(candidate.closedAt)}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {candidate.replacedAt && (
                                        <span className="text-[10px] text-slate-500">
                                          Reemplazada {formatCloseTimestamp(candidate.replacedAt)}
                                        </span>
                                      )}
                                      {isRecommended && (
                                        <span className="rounded-full border border-[#c8b38a] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#6d5432]">
                                          Mejor candidata
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                                    <div>Total persistido</div>
                                    <div>{candidate.persisted ? formatCurrency(candidate.persisted.netClp, 'CLP') : 'Sin summary'}</div>
                                    <div>Total canónico</div>
                                    <div>{candidate.canonical ? formatCurrency(candidate.canonical.netClp, 'CLP') : 'Sin records'}</div>
                                    <div>Bancos canónicos</div>
                                    <div>{comparable ? formatCurrency(comparable.bankClp ?? 0, 'CLP') : '—'}</div>
                                    <div>Deuda canónica</div>
                                    <div>{comparable ? formatCurrency(-(comparable.nonMortgageDebtClp ?? 0), 'CLP') : '—'}</div>
                                    <div>Inversiones canónicas</div>
                                    <div>{comparable ? formatCurrency(comparable.investmentClp ?? 0, 'CLP') : '—'}</div>
                                    <div>Bienes raíces canónicos</div>
                                    <div>{comparable ? formatCurrency(comparable.realEstateNetClp ?? 0, 'CLP') : '—'}</div>
                                    <div>Records</div>
                                    <div>{candidate.recordCount}</div>
                                    <div>Delta bancos vs actual</div>
                                    <div>{formatDelta(candidate.bankDeltaVsCurrent, 'CLP')}</div>
                                    <div>Delta deuda vs actual</div>
                                    <div>{formatDelta(candidate.debtDeltaVsCurrent, 'CLP')}</div>
                                    <div>Delta total vs actual</div>
                                    <div>{formatDelta(candidate.totalDeltaVsCurrent, 'CLP')}</div>
                                  </div>
                                  <div className="mt-2 text-[11px] text-slate-600">
                                    {candidate.candidateReason || 'Sin lectura automática concluyente.'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </Card>

                      <div className="grid gap-3 xl:grid-cols-2">
                        <Card className="border border-slate-200 bg-white p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Records bancarios del cierre actual
                          </div>
                          <div className="mt-2 overflow-x-auto">
                            <table className="min-w-full text-[11px]">
                              <thead className="text-slate-500">
                                <tr className="border-b border-slate-200">
                                  <th className="px-2 py-1 text-left font-semibold">Label</th>
                                  <th className="px-2 py-1 text-left font-semibold">Mon.</th>
                                  <th className="px-2 py-1 text-right font-semibold">Monto</th>
                                  <th className="px-2 py-1 text-right font-semibold">CLP</th>
                                  <th className="px-2 py-1 text-left font-semibold">Lectura</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedAuditSnapshot.bankRows.map((row, index) => (
                                  <tr key={`current-bank-${row.label}-${row.currency}-${index}`} className="border-b border-slate-100 align-top">
                                    <td className="px-2 py-1">
                                      <div className="font-medium text-slate-800">{row.label}</div>
                                      <div className="text-[10px] text-slate-500">{row.source || row.note || 'Sin metadata'}</div>
                                    </td>
                                    <td className="px-2 py-1">{row.currency}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(row.amount, row.currency)}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(row.amountClp, 'CLP')}</td>
                                    <td className="px-2 py-1">
                                      {row.countsForBank ? 'Cuenta para bancos' : row.countsForDebt ? 'Cuenta para deuda' : 'No suma'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Card>

                        <Card className="border border-slate-200 bg-white p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Bancos del mes siguiente ({monthLabel(comparisonMonthKey)})
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Referencia para explicar diferencias de bancos entre abril y mayo. No se mezcla con el cierre auditado.
                          </div>
                          <div className="mt-2 text-[11px] font-semibold text-slate-800">
                            Total bancos que cuentan: {comparisonMonthBankRows.length ? formatCurrency(comparisonMonthBankClp, 'CLP') : 'Sin records'}
                          </div>
                          <div className="mt-2 overflow-x-auto">
                            <table className="min-w-full text-[11px]">
                              <thead className="text-slate-500">
                                <tr className="border-b border-slate-200">
                                  <th className="px-2 py-1 text-left font-semibold">Label</th>
                                  <th className="px-2 py-1 text-left font-semibold">Mon.</th>
                                  <th className="px-2 py-1 text-right font-semibold">Monto</th>
                                  <th className="px-2 py-1 text-right font-semibold">CLP</th>
                                  <th className="px-2 py-1 text-left font-semibold">Lectura</th>
                                </tr>
                              </thead>
                              <tbody>
                                {comparisonMonthBankRows.map((row, index) => (
                                  <tr key={`compare-bank-${row.label}-${row.currency}-${index}`} className="border-b border-slate-100 align-top">
                                    <td className="px-2 py-1">
                                      <div className="font-medium text-slate-800">{row.label}</div>
                                      <div className="text-[10px] text-slate-500">{row.source || row.note || 'Sin metadata'}</div>
                                    </td>
                                    <td className="px-2 py-1">{row.currency}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(row.amount, row.currency)}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(row.amountClp, 'CLP')}</td>
                                    <td className="px-2 py-1">
                                      {row.countsForBank ? 'Cuenta para bancos' : row.countsForDebt ? 'Cuenta para deuda' : 'No suma'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Card>
                      </div>
                    </>
                  )}
                </div>
              </details>
            </>
          )}
          <button
            type="button"
            onClick={toggleRiskCapitalView}
            className={`absolute bottom-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
              includeRiskCapitalInTotals
                ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-slate-300 bg-white/90 text-slate-400'
            }`}
            title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
            aria-label="Alternar capital de riesgo"
          >
            <Zap size={18} />
          </button>
        </div>
      )}

      {tab === 'evolucion' && (
        <div className="relative space-y-2.5 pb-12">
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold">Evolución del patrimonio</div>
            {evolutionWithReturns.map((row) => (
              <div key={`${row.key}-${row.kind}`} className="flex items-center justify-between text-xs border-b border-slate-100 py-1">
                <span>
                  {row.label} {row.kind === 'hoy' ? '(hoy)' : '(cierre)'}
                </span>
                <span className="inline-flex items-center gap-2 font-semibold">
                  {row.net === null ? '—' : formatCurrency(row.net, currency)}
                  {includeRiskCapitalInTotals && row.hasRiskCapital && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      +CapRiesgo
                    </span>
                  )}
                </span>
              </div>
            ))}
          </Card>
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold">Evolución de rentabilidad mensual</div>
            {evolutionWithReturns.map((row) => (
              <div key={`ret-${row.key}-${row.kind}`} className="flex items-center justify-between text-xs border-b border-slate-100 py-1">
                <span>
                  {row.label} {row.kind === 'hoy' ? '(hoy)' : '(cierre)'}
                </span>
                <span className={row.delta === null ? 'text-slate-500' : row.delta >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  <span>
                    {row.delta === null
                      ? 'Base'
                      : `${row.delta >= 0 ? '+' : ''}${formatCurrency(row.delta, currency)}${row.pct !== null ? ` (${row.pct >= 0 ? '+' : ''}${row.pct.toFixed(2)}%)` : ''}`}
                  </span>
                  {includeRiskCapitalInTotals && row.hasRiskCapital && (
                    <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      +CapRiesgo
                    </span>
                  )}
                </span>
              </div>
            ))}
          </Card>
          <button
            type="button"
            onClick={toggleRiskCapitalView}
            className={`absolute bottom-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
              includeRiskCapitalInTotals
                ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-slate-300 bg-white/90 text-slate-400'
            }`}
            title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
            aria-label="Alternar capital de riesgo"
          >
            <Zap size={18} />
          </button>
        </div>
      )}

      {closureEditOpen && selectedClosure && (
        <div className="fixed inset-0 z-[90] bg-black/40 p-4 flex items-end sm:items-center justify-center">
          <div className="w-full max-w-2xl max-h-[88vh] overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="text-base font-semibold text-slate-900">
              Editar cierre {monthLabel(selectedClosure.monthKey)}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Edita fuentes directas del cierre (no campos calculados). Al guardar, se sobrescribe este cierre y se conserva la versión anterior.
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">Tipos de cambio usados en el cierre</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-slate-600">USD/CLP</label>
                  <Input
                    value={closureEditRates.usdClp}
                    onChange={(e) => setClosureEditRates((prev) => ({ ...prev, usdClp: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-600">EUR/USD</label>
                  <Input
                    value={closureEditRates.eurUsd}
                    onChange={(e) => setClosureEditRates((prev) => ({ ...prev, eurUsd: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-600">UF/CLP</label>
                  <Input
                    value={closureEditRates.ufClp}
                    onChange={(e) => setClosureEditRates((prev) => ({ ...prev, ufClp: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            {!selectedClosureRecordsRaw?.length ? (
              <div className="mt-3 rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-700">Resumen del cierre (sin detalle por instrumento)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-600">Inversiones (sin riesgo) CLP</label>
                    <Input
                      value={closureSummaryEditDraft.investmentClp}
                      onChange={(e) =>
                        setClosureSummaryEditDraft((prev) => ({ ...prev, investmentClp: e.target.value }))
                      }
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600">Capital de riesgo CLP</label>
                    <Input
                      value={closureSummaryEditDraft.riskCapitalClp}
                      onChange={(e) =>
                        setClosureSummaryEditDraft((prev) => ({ ...prev, riskCapitalClp: e.target.value }))
                      }
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600">Bienes raíces neto CLP</label>
                    <Input
                      value={closureSummaryEditDraft.realEstateNetClp}
                      onChange={(e) =>
                        setClosureSummaryEditDraft((prev) => ({ ...prev, realEstateNetClp: e.target.value }))
                      }
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600">Bancos CLP</label>
                    <Input
                      value={closureSummaryEditDraft.bankClp}
                      onChange={(e) =>
                        setClosureSummaryEditDraft((prev) => ({ ...prev, bankClp: e.target.value }))
                      }
                      inputMode="decimal"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-slate-600">Deudas no hipotecarias CLP</label>
                    <Input
                      value={closureSummaryEditDraft.nonMortgageDebtClp}
                      onChange={(e) =>
                        setClosureSummaryEditDraft((prev) => ({ ...prev, nonMortgageDebtClp: e.target.value }))
                      }
                      inputMode="decimal"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['inversiones', 'bienes_raices', 'bancos', 'deudas'] as const).map((section) => {
                const titleMap: Record<'inversiones' | 'bienes_raices' | 'bancos' | 'deudas', string> = {
                  inversiones: 'Inversiones',
                  bienes_raices: 'Bienes raíces',
                  bancos: 'Bancos',
                  deudas: 'Deudas no hipotecarias',
                };
                const fields = CLOSURE_EDITABLE_FIELDS.filter((f) => f.section === section);
                return (
                  <div key={section} className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-700">{titleMap[section]}</div>
                    {fields.map((field) => (
                      <div key={field.key}>
                        <label className="text-[11px] text-slate-600">
                          {field.label} ({field.currency})
                        </label>
                        <Input
                          value={closureEditDraft[field.key]}
                          onChange={(e) => {
                            setClosureEditDraft((prev) => ({ ...prev, [field.key]: e.target.value }));
                            setClosureEditDirtyFields((prev) => ({ ...prev, [field.key]: true }));
                          }}
                          inputMode="decimal"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
              </div>
            )}

            {!!closureEditError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {closureEditError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setClosureEditConfirmOpen(false);
                  setClosureEditOpen(false);
                  setClosureEditError('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  setClosureEditConfirmOpen(true);
                }}
              >
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={closureEditConfirmOpen}
        title="Confirmar guardado de edición"
        message={
          selectedClosure
            ? `Vas a sobrescribir el cierre de ${monthLabel(selectedClosure.monthKey)}. Se guardará una versión anterior.`
            : 'Vas a sobrescribir este cierre y se guardará una versión anterior.'
        }
        confirmText="Confirmar guardado"
        cancelText="Cancelar"
        onCancel={() => setClosureEditConfirmOpen(false)}
        onConfirm={() => {
          setClosureEditConfirmOpen(false);
          applyClosureEdit();
        }}
      />

      <ConfirmActionModal
        open={may2023HotfixConfirmOpen}
        title="Aplicar corrección mayo 2023"
        message="Se generará backup automático en la nube y luego se corregirá el summary de mayo 2023. ¿Deseas continuar?"
        confirmText="Aplicar corrección"
        cancelText="Cancelar"
        onCancel={() => {
          if (may2023HotfixBusy) return;
          setMay2023HotfixConfirmOpen(false);
        }}
        onConfirm={applyMay2023Hotfix}
      />

      <Card className="p-3 text-[11px] text-slate-500">
        Cada cierre usa su propio TC/UF guardado del mes. Los valores de demo usan TC/UF aproximados.
      </Card>
    </div>
  );
};
