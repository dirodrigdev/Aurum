import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Building2,
  Camera,
  FileScan,
  Home,
  Landmark,
  Pencil,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Button, Card, cn, Input, Select } from '../components/Components';
import { CloseConfirmModal } from '../components/patrimonio/CloseConfirmModal';
import { ConfirmActionModal } from '../components/settings/ConfirmActionModal';
import { runOcrFromFile } from '../services/ocr';
import { parseWealthFromOcrText, ParsedWealthSuggestion } from '../services/wealthParsers';
import { FintocAccountNormalized, discoverFintocData, FintocDiscoverResponse } from '../services/bankApi';
import {
  WealthBlock,
  WealthCurrency,
  WealthInvestmentInstrument,
  WealthMonthlyClosure,
  WealthRecord,
  createMonthlyClosure,
  currentMonthKey,
  defaultFxRates,
  applyMortgageAutoCalculation,
  buildWealthNetBreakdown,
  computeWealthBankLiquiditySnapshot,
  computeWealthHomeSectionAmounts,
  FX_RATES_UPDATED_EVENT,
  isSyntheticAggregateRecord,
  WEALTH_DATA_UPDATED_EVENT,
  fillMissingWithPreviousClosure,
  resolveRiskCapitalRecordsForTotals,
  hydrateWealthFromCloud,
  ensureInitialMortgageDefaults,
  isMortgageMetaDebtLabel,
  isMortgagePrincipalDebtLabel,
  isNonMortgageDebtRecord,
  isRiskCapitalInvestmentLabel,
  latestRecordsForMonth,
  localYmd,
  loadClosures,
  loadIncludeRiskCapitalInTotals,
  loadFxRates,
  loadBankTokens,
  loadInvestmentInstruments,
  loadWealthRecords,
  refreshFxRatesFromLive,
  RISK_CAPITAL_LABEL_CLP,
  RISK_CAPITAL_LABEL_USD,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  removeWealthRecordForMonthAsset,
  saveBankTokens,
  saveFxRates,
  saveIncludeRiskCapitalInTotals,
  saveWealthRecords,
  setInvestmentInstrumentMonthExcluded,
  upsertInvestmentInstrument,
  upsertWealthRecord,
  BANK_BALANCE_CLP_LABEL,
  BANK_BALANCE_USD_LABEL,
  BANK_BCHILE_CLP_LABEL,
  BANK_BCHILE_USD_LABEL,
  BANK_SANTANDER_CLP_LABEL,
  BANK_SANTANDER_USD_LABEL,
  BANK_SCOTIA_CLP_LABEL,
  BANK_SCOTIA_USD_LABEL,
  CARD_AMEX_SANTANDER_LABEL,
  CARD_MASTERCARD_FALABELLA_LABEL,
  CARD_MASTERCARD_SANTANDER_LABEL,
  CARD_MASTERCARD_SCOTIA_LABEL,
  CARD_VISA_BCHILE_LABEL,
  CARD_VISA_SCOTIA_LABEL,
  DEBT_CARD_CLP_LABEL,
  DEBT_CARD_USD_LABEL,
  INVESTMENT_BTG_LABEL,
  INVESTMENT_GLOBAL66_USD_LABEL,
  INVESTMENT_PLANVITAL_LABEL,
  INVESTMENT_SURA_FIN_LABEL,
  INVESTMENT_SURA_PREV_LABEL,
  INVESTMENT_WISE_USD_LABEL,
  MANUAL_CARD_LABELS,
  MORTGAGE_AMORTIZATION_LABEL,
  MORTGAGE_DEBT_BALANCE_LABEL,
  MORTGAGE_DIVIDEND_LABEL,
  MORTGAGE_INSURANCE_LABEL,
  MORTGAGE_INTEREST_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  TENENCIA_CXC_PREFIX_LABEL,
} from '../services/wealthStorage';
import { parseStrictNumber } from '../utils/numberUtils';
import { labelMatchKey, normalizeForMatch, sameCanonicalLabel } from '../utils/wealthLabels';
import {
  formatCurrency,
  formatCurrencyNoDecimals,
  formatMonthLabel as monthLabel,
} from '../utils/wealthFormat';

type MainSection = 'investment' | 'real_estate' | 'bank';
const PREFERRED_DISPLAY_CURRENCY_KEY = 'aurum.preferred.display.currency';
const HIDE_SENSITIVE_AMOUNTS_PREF_KEY = 'aurum.hide-sensitive-amounts.v1';
const HIDE_SENSITIVE_AMOUNTS_UPDATED_EVENT = 'aurum:hide-sensitive-amounts-updated';
const NAVIGATE_PATRIMONIO_HOME_EVENT = 'aurum:navigate-patrimonio-home';
const BANKS_LAST_AUTO_SYNC_DAY_KEY = 'aurum:banks:last-auto-sync-day:v1';
const BANKS_LAST_AUTO_ATTEMPT_DAY_KEY = 'aurum:banks:last-auto-attempt-day:v1';
const CLOSING_CONFIG_STORAGE_KEY = 'aurum.closing.config.v1';
const MONTH_STARTED_FLAG_PREFIX = 'aurum.month.started.';
const DEFAULT_BASE_INVESTMENT_INSTRUMENTS: Array<{ label: string; currency: WealthCurrency }> = [
  { label: RISK_CAPITAL_LABEL_CLP, currency: 'CLP' },
  { label: RISK_CAPITAL_LABEL_USD, currency: 'USD' },
  { label: TENENCIA_CXC_PREFIX_LABEL, currency: 'CLP' },
  { label: `${TENENCIA_CXC_PREFIX_LABEL} USD`, currency: 'USD' },
  { label: `${TENENCIA_CXC_PREFIX_LABEL} EUR`, currency: 'EUR' },
];

type StartMonthActionKey = 'carry' | 'fx' | 'banks' | 'realEstate';
type StartMonthActionStatus = Record<StartMonthActionKey, 'pending' | 'applied'>;
const START_MONTH_ACTION_STATUS_INITIAL: StartMonthActionStatus = {
  carry: 'pending',
  fx: 'pending',
  banks: 'pending',
  realEstate: 'pending',
};

const sectionLabel: Record<MainSection, string> = {
  investment: 'Inversiones',
  real_estate: 'Bienes raíces',
  bank: 'Bancos',
};

const readBanksLastAutoSyncDay = () => {
  try {
    return String(window.localStorage.getItem(BANKS_LAST_AUTO_SYNC_DAY_KEY) || '');
  } catch {
    return '';
  }
};

const readHideSensitiveAmountsEnabled = () => {
  try {
    return window.localStorage.getItem(HIDE_SENSITIVE_AMOUNTS_PREF_KEY) === '1';
  } catch {
    return false;
  }
};

const writeBanksLastAutoSyncDay = (ymd: string) => {
  try {
    window.localStorage.setItem(BANKS_LAST_AUTO_SYNC_DAY_KEY, ymd);
  } catch {
    // ignore
  }
};

const readBanksLastAutoAttemptDay = () => {
  try {
    return String(window.localStorage.getItem(BANKS_LAST_AUTO_ATTEMPT_DAY_KEY) || '');
  } catch {
    return '';
  }
};

const writeBanksLastAutoAttemptDay = (ymd: string) => {
  try {
    window.localStorage.setItem(BANKS_LAST_AUTO_ATTEMPT_DAY_KEY, ymd);
  } catch {
    // ignore
  }
};

const monthStartedFlagKey = (targetMonthKey: string) => `${MONTH_STARTED_FLAG_PREFIX}${targetMonthKey}`;

const readMonthStartedFlag = (targetMonthKey: string) => {
  try {
    return window.localStorage.getItem(monthStartedFlagKey(targetMonthKey)) === '1';
  } catch {
    return false;
  }
};

const writeMonthStartedFlag = (targetMonthKey: string, started: boolean) => {
  try {
    if (started) {
      window.localStorage.setItem(monthStartedFlagKey(targetMonthKey), '1');
      return;
    }
    window.localStorage.removeItem(monthStartedFlagKey(targetMonthKey));
  } catch {
    // ignore
  }
};

const sourceOptionsBySection: Record<MainSection, Array<{ value: string; label: string }>> = {
  investment: [
    { value: 'auto', label: 'Auto detectar' },
    { value: 'planvital', label: 'PlanVital (AFP)' },
    { value: 'sura_resumen', label: 'SURA resumen' },
    { value: 'sura_detalle', label: 'SURA detalle' },
    { value: 'btg', label: 'BTG' },
    { value: 'wise', label: 'Wise' },
    { value: 'global66', label: 'Global66' },
  ],
  real_estate: [
    { value: 'auto', label: 'Auto detectar' },
    { value: 'dividendo', label: 'Dividendo hipotecario' },
  ],
  bank: [
    { value: 'auto', label: 'Auto detectar' },
    { value: 'banco_clp', label: 'Banco Chile/Scotia/Santander (CLP)' },
    { value: 'banco_usd', label: 'Banco Chile/Scotia/Santander (USD)' },
  ],
};

type ClosingConfigRule = {
  enabled: boolean;
  maxAgeDays: number | null;
};

type ClosingConfigState = {
  rules: Record<string, ClosingConfigRule>;
};

const readClosingConfig = (): ClosingConfigState => {
  try {
    const raw = localStorage.getItem(CLOSING_CONFIG_STORAGE_KEY);
    if (!raw) return { rules: {} };
    const parsed = JSON.parse(raw) as ClosingConfigState;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.rules !== 'object') return { rules: {} };
    return { rules: parsed.rules || {} };
  } catch {
    return { rules: {} };
  }
};

const resolveClosingConfigRule = (
  config: ClosingConfigState,
  key: string,
  fallbackEnabled: boolean,
  fallbackMaxAgeDays: number | null,
): ClosingConfigRule => {
  const fromConfig = config.rules[key];
  if (fromConfig) return fromConfig;
  return { enabled: fallbackEnabled, maxAgeDays: fallbackMaxAgeDays };
};

const daysSinceIso = (iso?: string) => {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)));
};

const currencyOptions = [
  { value: 'CLP', label: 'CLP' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'UF', label: 'UF' },
];

const realEstateBlockOptions = [
  { value: 'real_estate', label: 'Activo inmobiliario' },
  { value: 'debt', label: 'Deuda hipotecaria' },
];

const sectionTheme: Record<MainSection, string> = {
  investment: 'from-orange-200 to-amber-100',
  real_estate: 'from-emerald-200 to-lime-100',
  bank: 'from-sky-200 to-cyan-100',
};

const sectionChecklist: Record<MainSection, string[]> = {
  investment: [
    INVESTMENT_SURA_FIN_LABEL,
    INVESTMENT_SURA_PREV_LABEL,
    INVESTMENT_PLANVITAL_LABEL,
    INVESTMENT_BTG_LABEL,
    INVESTMENT_GLOBAL66_USD_LABEL,
    INVESTMENT_WISE_USD_LABEL,
  ],
  real_estate: [
    REAL_ESTATE_PROPERTY_VALUE_LABEL,
    MORTGAGE_DEBT_BALANCE_LABEL,
    MORTGAGE_DIVIDEND_LABEL,
    MORTGAGE_INTEREST_LABEL,
    MORTGAGE_INSURANCE_LABEL,
    MORTGAGE_AMORTIZATION_LABEL,
  ],
  bank: [BANK_BALANCE_CLP_LABEL, BANK_BALANCE_USD_LABEL],
};
const REAL_ESTATE_DEBT_LABELS = [
  MORTGAGE_DEBT_BALANCE_LABEL,
  MORTGAGE_DIVIDEND_LABEL,
  MORTGAGE_INTEREST_LABEL,
  MORTGAGE_INSURANCE_LABEL,
  MORTGAGE_AMORTIZATION_LABEL,
];
const REAL_ESTATE_CORE_NET_LABELS = [REAL_ESTATE_PROPERTY_VALUE_LABEL, MORTGAGE_DEBT_BALANCE_LABEL];
type BankProviderId = 'bchile' | 'scotia' | 'santander';

const BANK_PROVIDERS: Array<{ id: BankProviderId; label: string }> = [
  { id: 'bchile', label: 'Banco de Chile' },
  { id: 'scotia', label: 'Scotiabank' },
  { id: 'santander', label: 'Santander' },
];

const FINTOC_SYNC_PREFIX_CARD = 'Tarjeta crédito:';
const MANUAL_BANK_ITEMS: Array<{ label: string; currency: WealthCurrency }> = [
  { label: BANK_BCHILE_CLP_LABEL, currency: 'CLP' },
  { label: BANK_BCHILE_USD_LABEL, currency: 'USD' },
  { label: BANK_SCOTIA_CLP_LABEL, currency: 'CLP' },
  { label: BANK_SCOTIA_USD_LABEL, currency: 'USD' },
  { label: BANK_SANTANDER_CLP_LABEL, currency: 'CLP' },
  { label: BANK_SANTANDER_USD_LABEL, currency: 'USD' },
];
const MANUAL_CARD_ITEMS: Array<{ label: string; currency: WealthCurrency }> = [
  { label: CARD_VISA_BCHILE_LABEL, currency: 'CLP' },
  { label: CARD_VISA_SCOTIA_LABEL, currency: 'CLP' },
  { label: CARD_MASTERCARD_SCOTIA_LABEL, currency: 'CLP' },
  { label: CARD_MASTERCARD_FALABELLA_LABEL, currency: 'CLP' },
  { label: CARD_MASTERCARD_SANTANDER_LABEL, currency: 'CLP' },
  { label: CARD_AMEX_SANTANDER_LABEL, currency: 'CLP' },
];
const MANUAL_BANK_GROUPS: Array<{ bank: string; items: Array<{ label: string; currency: WealthCurrency }> }> = [
  {
    bank: 'Banco de Chile',
    items: [
      { label: BANK_BCHILE_CLP_LABEL, currency: 'CLP' },
      { label: BANK_BCHILE_USD_LABEL, currency: 'USD' },
    ],
  },
  {
    bank: 'Scotiabank',
    items: [
      { label: BANK_SCOTIA_CLP_LABEL, currency: 'CLP' },
      { label: BANK_SCOTIA_USD_LABEL, currency: 'USD' },
    ],
  },
  {
    bank: 'Santander',
    items: [
      { label: BANK_SANTANDER_CLP_LABEL, currency: 'CLP' },
      { label: BANK_SANTANDER_USD_LABEL, currency: 'USD' },
    ],
  },
];
const MANUAL_CARD_GROUPS: Array<{
  bank: string;
  className: string;
  items: Array<{ label: string; currency: WealthCurrency }>;
}> = [
  {
    bank: 'Banco de Chile',
    className: 'border-blue-200 bg-blue-50/40',
    items: [{ label: CARD_VISA_BCHILE_LABEL, currency: 'CLP' }],
  },
  {
    bank: 'Scotiabank',
    className: 'border-slate-300 bg-slate-100/70',
    items: [
      { label: CARD_VISA_SCOTIA_LABEL, currency: 'CLP' },
      { label: CARD_MASTERCARD_SCOTIA_LABEL, currency: 'CLP' },
    ],
  },
  {
    bank: 'Santander',
    className: 'border-red-200 bg-red-50/40',
    items: [
      { label: CARD_MASTERCARD_SANTANDER_LABEL, currency: 'CLP' },
      { label: CARD_AMEX_SANTANDER_LABEL, currency: 'CLP' },
    ],
  },
  {
    bank: 'Falabella',
    className: 'border-emerald-200 bg-emerald-50/40',
    items: [{ label: CARD_MASTERCARD_FALABELLA_LABEL, currency: 'CLP' }],
  },
];

const isCarriedRecord = (record: WealthRecord) => {
  const note = String(record.note || '').toLowerCase();
  return note.includes('arrastrado') || note.includes('mes anterior');
};

const isEstimatedRecord = (record: WealthRecord) => {
  return String(record.note || '').toLowerCase().includes('estimado');
};
const isApiSource = (source: string) => {
  const normalized = String(source || '').toLowerCase();
  return normalized.includes('fintoc') || normalized.includes('api');
};
const isMortgagePrincipalLabel = (label: string) => {
  return isMortgagePrincipalDebtLabel(label);
};

const isManualLikeSource = (source: string) => {
  const normalized = normalizeForMatch(source);
  return (
    normalized.includes('manual') ||
    normalized.includes('base inicial') ||
    normalized.includes('instrumento')
  );
};

const formatRecordUpdatedStamp = (record: WealthRecord) => {
  const created = new Date(record.createdAt);
  if (!Number.isFinite(created.getTime())) return record.snapshotDate;

  const now = new Date();
  const isToday =
    created.getFullYear() === now.getFullYear() &&
    created.getMonth() === now.getMonth() &&
    created.getDate() === now.getDate();
  const time = created.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `hoy ${time}`;

  const dayMonth = created.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }).replace('.', '');
  return `${dayMonth} ${time}`;
};

const displayRecordOrigin = (record: WealthRecord) => {
  if (isCarriedRecord(record)) return 'Mes anterior';
  if (isEstimatedRecord(record)) {
    return isMortgagePrincipalLabel(record.label) ? 'Sistema' : 'Mes anterior';
  }
  if (isApiSource(record.source)) return 'API';
  if (isManualLikeSource(record.source)) return 'Manual';
  return 'Imagen';
};

const TENENCIA_BASE_LABEL = TENENCIA_CXC_PREFIX_LABEL;
const TENENCIA_BASE_KEY = labelMatchKey(TENENCIA_BASE_LABEL);
const isTenenciaInstrumentLabel = (label: string) => {
  const key = labelMatchKey(label);
  return key === TENENCIA_BASE_KEY || key.startsWith(`${TENENCIA_BASE_KEY} `);
};
const NON_EXCLUDABLE_INVESTMENT_LABELS = new Set([
  labelMatchKey(RISK_CAPITAL_LABEL_CLP),
  labelMatchKey(RISK_CAPITAL_LABEL_USD),
]);
const isNonExcludableInvestmentLabel = (label: string) =>
  NON_EXCLUDABLE_INVESTMENT_LABELS.has(labelMatchKey(label)) || isTenenciaInstrumentLabel(label);

const todayYmd = () => localYmd();
const readPreferredDisplayCurrency = (): WealthCurrency => {
  if (typeof window === 'undefined') return 'CLP';
  const stored = window.localStorage.getItem(PREFERRED_DISPLAY_CURRENCY_KEY);
  if (stored === 'CLP' || stored === 'USD' || stored === 'EUR') return stored;
  return 'CLP';
};

const toWealthCurrency = (currency: string): WealthCurrency | null => {
  const normalized = String(currency || '').trim().toUpperCase();
  if (normalized === 'CLP' || normalized === 'USD' || normalized === 'EUR' || normalized === 'UF') {
    return normalized as WealthCurrency;
  }
  return null;
};

const isCreditCardAccount = (account: Pick<FintocAccountNormalized, 'type' | 'name'>) => {
  const token = `${String(account.type || '').toLowerCase()} ${String(account.name || '').toLowerCase()}`;
  return token.includes('credit') || token.includes('card') || token.includes('tarjeta') || token.includes('tc');
};

const toClp = (amount: number, currency: WealthCurrency, usdClp: number, eurClp: number, ufClp: number) => {
  const safeUsd = Number.isFinite(usdClp) && usdClp > 0 ? usdClp : defaultFxRates.usdClp;
  const safeEur = Number.isFinite(eurClp) && eurClp > 0 ? eurClp : defaultFxRates.eurClp;
  const safeUf = Number.isFinite(ufClp) && ufClp > 0 ? ufClp : defaultFxRates.ufClp;
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * safeUsd;
  if (currency === 'UF') return amount * safeUf;
  return amount * safeEur;
};

const fromClp = (amountClp: number, currency: WealthCurrency, usdClp: number, eurClp: number, ufClp: number) => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, usdClp);
  if (currency === 'UF') return amountClp / Math.max(1, ufClp);
  return amountClp / Math.max(1, eurClp);
};

const average = (arr: number[]) => {
  if (!arr.length) return null;
  return arr.reduce((sum, n) => sum + n, 0) / arr.length;
};

const closureNetForTotals = (
  closure: WealthMonthlyClosure,
  includeRiskCapital: boolean,
  fallbackFx: { usdClp: number; eurClp: number; ufClp: number },
) => {
  if (closure.records?.length) {
    const resolved = resolveRiskCapitalRecordsForTotals(closure.records, includeRiskCapital);
    return buildWealthNetBreakdown(resolved.recordsForTotals, closure.fxRates || fallbackFx).netClp;
  }
  if (includeRiskCapital) {
    if (Number.isFinite(closure.summary.netClpWithRisk)) return Number(closure.summary.netClpWithRisk);
  } else if (Number.isFinite(closure.summary.netClp)) {
    return Number(closure.summary.netClp);
  }
  return closure.summary.netConsolidatedClp;
};

const emptyBankLiquiditySnapshot = () => ({
  bankClp: 0,
  bankUsd: 0,
  cardClp: 0,
  cardUsd: 0,
  hasCardClpData: false,
  hasCardUsdData: false,
});

const toCloseDateFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, 1, 12, 0, 0, 0);
};

const monthAfterKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const deriveOperationalMonthKeyFromClosures = (
  closures: WealthMonthlyClosure[],
  calendarMonthKey: string,
) => {
  const ordered = [...closures].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const latest = ordered[0] || null;
  if (!latest?.monthKey) return calendarMonthKey;
  const monthSet = new Set(ordered.map((closure) => closure.monthKey));
  let candidate = monthAfterKey(latest.monthKey) || calendarMonthKey;
  let guard = 0;
  while (monthSet.has(candidate) && guard < 24) {
    candidate = monthAfterKey(candidate) || candidate;
    guard += 1;
  }
  return candidate;
};

const visualMonthSnapshotDate = (monthKey: string, mode: 'start' | 'end' = 'end') => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return todayYmd();
  }
  if (mode === 'start') return `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

const getSectionBlock = (section: MainSection): WealthBlock => {
  if (section === 'investment') return 'investment';
  if (section === 'bank') return 'bank';
  return 'real_estate';
};

interface DraftRecord {
  block: WealthBlock;
  source: string;
  label: string;
  amount: string;
  currency: WealthCurrency;
  note: string;
  snapshotDate: string;
}

const buildDraft = (section: MainSection, monthKey: string): DraftRecord => ({
  block: section === 'investment' ? 'investment' : section === 'real_estate' ? 'real_estate' : 'bank',
  source: 'manual',
  label: '',
  amount: '',
  currency: section === 'real_estate' ? 'UF' : 'CLP',
  note: '',
  snapshotDate: visualMonthSnapshotDate(monthKey),
});

const buildCloseFxDraft = (rates: { usdClp: number; eurClp: number; ufClp: number }) => ({
  usdClp: String(Math.round(Number(rates.usdClp) || 0)),
  eurClp: String(Math.round(Number(rates.eurClp) || 0)),
  ufClp: String(Math.round(Number(rates.ufClp) || 0)),
});

interface EditableSuggestion extends ParsedWealthSuggestion {
  snapshotDate: string;
}

interface SectionScreenProps {
  section: MainSection;
  monthKey: string;
  closures: WealthMonthlyClosure[];
  recordsForSection: WealthRecord[];
  includeRiskCapitalInTotals: boolean;
  onToggleRiskCapitalView: () => void;
  investmentInstruments: WealthInvestmentInstrument[];
  usdClp: number;
  eurClp: number;
  ufClp: number;
  carryMessage: string;
  onBack: () => void;
  onDataChanged: () => void;
  onCreateInvestmentInstrument: (input: {
    label: string;
    currency: WealthCurrency;
    amount?: number;
    note?: string;
  }) => void;
  onSetInvestmentExcluded: (instrumentId: string, excluded: boolean) => void;
  onUseMissing: (section: MainSection, itemName?: string) => void;
  onApplyMortgageAuto: () => void;
}

interface QuickFillDraft {
  id?: string;
  block: WealthBlock;
  source: string;
  label: string;
  amount: string;
  currency: WealthCurrency;
  note?: string;
  snapshotDate: string;
}

interface MultiQuickFillDraft {
  source: string;
  snapshotDate: string;
  entries: Array<{
    id?: string;
    label: string;
    currency: WealthCurrency;
    amount: string;
    note?: string;
  }>;
}

interface InvestmentSourceContext {
  title: string;
  sourceHint: string;
  source: string;
  labels: Array<{ label: string; currency: WealthCurrency }>;
  instrumentId?: string;
  isCustom?: boolean;
  primaryLabel?: string;
}

interface ChecklistRow {
  name: string;
  status: 'actualizado' | 'mes_anterior' | 'estimado' | 'pendiente' | 'excluido';
  detail: string;
  isOptional?: boolean;
  isCustomInstrument?: boolean;
  instrumentId?: string;
  context?: InvestmentSourceContext;
}

type InvestmentAnalyticsGroup = 'financieras' | 'previsionales' | 'otros';

interface InvestmentAnalyticsRow {
  key: string;
  label: string;
  group: InvestmentAnalyticsGroup;
  isRiskCapital: boolean;
  currentClp: number;
  compareClp: number | null;
}

interface InvestmentOperationalRow {
  key: string;
  name: string;
  status: ChecklistRow['status'];
  detail: string;
  amountText: string;
  hasValue: boolean;
  updatedThisMonth: boolean;
  sourceContext: InvestmentSourceContext;
}

interface PendingInvestmentDelete {
  title: string;
  targets: Array<{ label: string; currency: WealthCurrency }>;
}

interface PendingSuraOcrDecision {
  parsed: EditableSuggestion[];
  primaryLabel: string;
}

interface BankMovementsModalState {
  bank: string;
  currency: WealthCurrency;
}

interface BankMovementMeta {
  known: boolean;
  count: number;
}

type CloseValidationIssueType =
  | 'future_month'
  | 'missing_required_value'
  | 'incomplete_new_source'
  | 'carried_value_unconfirmed'
  | 'config_update_required'
  | 'config_update_warning';

interface CloseValidationIssue {
  type: CloseValidationIssueType;
  level: 'error' | 'warning';
  label: string;
  section: MainSection;
  instrumentId?: string;
  canResolveWithPrevious?: boolean;
  canExcludeThisMonth?: boolean;
}

const SectionScreen: React.FC<SectionScreenProps> = ({
  section,
  monthKey,
  closures,
  recordsForSection,
  includeRiskCapitalInTotals,
  onToggleRiskCapitalView,
  investmentInstruments,
  usdClp,
  eurClp,
  ufClp,
  carryMessage,
  onBack,
  onDataChanged,
  onCreateInvestmentInstrument,
  onSetInvestmentExcluded,
  onUseMissing,
  onApplyMortgageAuto,
}) => {
  const [sourceHint, setSourceHint] = useState(section === 'real_estate' ? 'dividendo' : 'auto');
  const [ocrProgress, setOcrProgress] = useState<{ pct: number; status: string } | null>(null);
  const [ocrError, setOcrError] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[]>([]);
  const [draft, setDraft] = useState<DraftRecord>(() => buildDraft(section, monthKey));
  const [quickFill, setQuickFill] = useState<QuickFillDraft | null>(null);
  const [multiQuickFill, setMultiQuickFill] = useState<MultiQuickFillDraft | null>(null);
  const [openLoadPanel, setOpenLoadPanel] = useState(false);
  const [openSourceMenu, setOpenSourceMenu] = useState(false);
  const [activeSourceContext, setActiveSourceContext] = useState<InvestmentSourceContext | null>(null);
  const [pendingSuraOcrDecision, setPendingSuraOcrDecision] = useState<PendingSuraOcrDecision | null>(null);
  const [openCreateInvestmentModal, setOpenCreateInvestmentModal] = useState(false);
  const [newInvestmentDraft, setNewInvestmentDraft] = useState<{
    label: string;
    currency: WealthCurrency;
    amount: string;
    note: string;
  }>({ label: '', currency: 'CLP', amount: '', note: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fintocStatus, setFintocStatus] = useState('');
  const [fintocDiscovering, setFintocDiscovering] = useState(false);
  const [fintocDiscovery, setFintocDiscovery] = useState<FintocDiscoverResponse | null>(null);
  const [fintocLastSync, setFintocLastSync] = useState<{
    assets: FintocAccountNormalized[];
    cards: FintocAccountNormalized[];
  } | null>(null);
  const [bankTokens, setBankTokens] = useState<Partial<Record<BankProviderId, string>>>(() => loadBankTokens());
  const [movementsModal, setMovementsModal] = useState<BankMovementsModalState | null>(null);
  const [bankMovementMeta, setBankMovementMeta] = useState<Partial<Record<BankProviderId, BankMovementMeta>>>({});
  const [updatingAllBanks, setUpdatingAllBanks] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [pendingInvestmentDelete, setPendingInvestmentDelete] = useState<PendingInvestmentDelete | null>(null);
  const hiddenUploadInputRef = useRef<HTMLInputElement | null>(null);
  const sectionTitle = section === 'real_estate' ? 'Bienes raíces (neto)' : sectionLabel[section];
  const expectedMonthPrefix = `${monthKey}-`;
  const visualSnapshotDate = useMemo(() => visualMonthSnapshotDate(monthKey), [monthKey]);

  const investmentGroupOrder: Record<InvestmentAnalyticsGroup, number> = {
    financieras: 0,
    previsionales: 1,
    otros: 2,
  };

  useEffect(() => {
    setDraft((prev) =>
      prev.snapshotDate.startsWith(expectedMonthPrefix)
        ? prev
        : { ...prev, snapshotDate: visualSnapshotDate },
    );
  }, [expectedMonthPrefix, visualSnapshotDate]);

  useEffect(() => {
    if (section !== 'bank') return;
    const refreshTokens = () => setBankTokens(loadBankTokens());
    refreshTokens();
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshTokens as EventListener);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshTokens as EventListener);
    };
  }, [section]);

  const dedupedSectionRecords = useMemo(
    () => latestRecordsForMonth(recordsForSection, monthKey),
    [recordsForSection, monthKey],
  );

  const sectionTotalClp = useMemo(() => {
    const recordsForTotals =
      section === 'investment'
        ? resolveRiskCapitalRecordsForTotals(dedupedSectionRecords, includeRiskCapitalInTotals).recordsForTotals
        : dedupedSectionRecords;
    const breakdown = buildWealthNetBreakdown(recordsForTotals, { usdClp, eurClp, ufClp });

    if (section === 'investment') return breakdown.investmentClp;
    if (section === 'bank') {
      const bankLiquidity = breakdown.bankClp;
      const nonMortgageDebt = breakdown.nonMortgageDebtClp;
      return bankLiquidity - nonMortgageDebt;
    }

    const hasProperty = recordsForTotals.some(
      (item) =>
        !isSyntheticAggregateRecord(item) &&
        item.block === 'real_estate' &&
        sameCanonicalLabel(item.label, REAL_ESTATE_PROPERTY_VALUE_LABEL),
    );
    return hasProperty ? breakdown.realEstateNetClp : 0;
  }, [section, dedupedSectionRecords, includeRiskCapitalInTotals, usdClp, eurClp, ufClp]);

  const sectionHasRiskCapital = useMemo(
    () =>
      section === 'investment' &&
      dedupedSectionRecords.some(
        (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
      ),
    [section, dedupedSectionRecords],
  );

  const bankDashboard = useMemo(() => {
    if (section !== 'bank') {
      return {
        ...emptyBankLiquiditySnapshot(),
        movements: [] as Array<{
          bank: string;
          account: string;
          description: string;
          date: string;
          amount: number;
          currency: WealthCurrency;
        }>,
      };
    }

    const snapshot = computeWealthBankLiquiditySnapshot(dedupedSectionRecords);

    const syncAccounts = fintocLastSync?.assets?.length
      ? fintocLastSync.assets
      : (fintocDiscovery?.accounts || []).filter((acc) => !isCreditCardAccount(acc));

    const allMovements = syncAccounts.flatMap((acc) =>
      (acc.movementsSample || []).map((m) => ({
        bank: acc.bank || 'Banco',
        account: `${acc.name}${acc.number ? ` · ${acc.number}` : ''}`,
        description: m.description || 'Movimiento',
        date: m.date || '',
        amount: m.amount,
        currency: (toWealthCurrency(m.currency) || toWealthCurrency(acc.currency) || 'CLP') as WealthCurrency,
      })),
    );
    return { ...snapshot, movements: allMovements };
  }, [section, dedupedSectionRecords, fintocLastSync, fintocDiscovery]);

  const bankApiPresenceByProvider = useMemo(() => {
    const result: Record<BankProviderId, boolean> = { bchile: false, scotia: false, santander: false };
    for (const record of dedupedSectionRecords) {
      if (record.block !== 'bank' || !isApiSource(record.source)) continue;
      const label = normalizeForMatch(record.label);
      if (label.includes(normalizeForMatch('Banco de Chile'))) result.bchile = true;
      if (label.includes(normalizeForMatch('Scotiabank'))) result.scotia = true;
      if (label.includes(normalizeForMatch('Santander'))) result.santander = true;
    }
    return result;
  }, [dedupedSectionRecords]);

  const modalMovements = useMemo(() => {
    if (!movementsModal) return [];
    const targetBank = normalizeForMatch(movementsModal.bank);
    return bankDashboard.movements.filter((movement) => {
      if (movement.currency !== movementsModal.currency) return false;
      const movementBank = normalizeForMatch(movement.bank);
      return movementBank.includes(targetBank) || targetBank.includes(movementBank);
    });
  }, [bankDashboard.movements, movementsModal]);

  const renderCardDebtTotal = (hasData: boolean, value: number, currency: WealthCurrency) => {
    if (!hasData) return '';
    if (Math.round(value) === 0) return '';
    return `-${formatCurrencyNoDecimals(value, currency)}`;
  };

  const buildInvestmentContext = (name: string, instrument?: WealthInvestmentInstrument): InvestmentSourceContext => {
    if (instrument) {
      return {
        title: instrument.label,
        sourceHint: 'auto',
        source: 'Instrumento manual',
        labels: [{ label: instrument.label, currency: instrument.currency }],
        instrumentId: instrument.id,
        isCustom: true,
      };
    }

    const n = normalizeForMatch(name);
    if (n.includes('sura')) {
      return {
        title: 'SURA',
        sourceHint: 'sura_resumen',
        source: 'SURA',
        labels: [
          { label: INVESTMENT_SURA_FIN_LABEL, currency: 'CLP' },
          { label: INVESTMENT_SURA_PREV_LABEL, currency: 'CLP' },
        ],
      };
    }
    if (n.includes('planvital')) {
      return {
        title: 'PlanVital',
        sourceHint: 'planvital',
        source: 'PlanVital',
        labels: [{ label: INVESTMENT_PLANVITAL_LABEL, currency: 'CLP' }],
      };
    }
    if (n.includes('btg')) {
      return {
        title: 'BTG',
        sourceHint: 'btg',
        source: 'BTG Pactual',
        labels: [{ label: INVESTMENT_BTG_LABEL, currency: 'CLP' }],
      };
    }
    if (n.includes('global66')) {
      return {
        title: 'Global66',
        sourceHint: 'global66',
        source: 'Global66',
        labels: [{ label: INVESTMENT_GLOBAL66_USD_LABEL, currency: 'USD' }],
      };
    }
    if (n.includes('wise')) {
      return {
        title: 'Wise',
        sourceHint: 'wise',
        source: 'Wise',
        labels: [{ label: INVESTMENT_WISE_USD_LABEL, currency: 'USD' }],
      };
    }
    return {
      title: name,
      sourceHint: 'auto',
      source: 'Manual',
      labels: [{ label: name, currency: 'CLP' }],
    };
  };

  const findRecordForLabel = (label: string, currency?: WealthCurrency) => {
    return dedupedSectionRecords.find((r) => {
      if (r.block !== 'investment') return false;
      if (currency && r.currency !== currency) return false;
      return sameCanonicalLabel(r.label, label);
    });
  };

  const checklistRows = useMemo<ChecklistRow[]>(() => {
    const baseRows = sectionChecklist[section].map((name): ChecklistRow => {
      const match = dedupedSectionRecords.find((r) => sameCanonicalLabel(r.label, name));
      if (!match) {
        return {
          name,
          status: 'pendiente',
          detail: 'Sin dato este mes',
          context: section === 'investment' ? buildInvestmentContext(name) : undefined,
        };
      }
      if (isCarriedRecord(match)) {
        return {
          name,
          status: 'mes_anterior',
          detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
          context: section === 'investment' ? buildInvestmentContext(name) : undefined,
        };
      }
      if (isEstimatedRecord(match)) {
        if (section === 'real_estate' && !isMortgagePrincipalLabel(match.label)) {
          return {
            name,
            status: 'mes_anterior',
            detail: `Mes anterior · ${formatRecordUpdatedStamp(match)}`,
            context: undefined,
          };
        }
        return {
          name,
          status: 'estimado',
          detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
          context: section === 'investment' ? buildInvestmentContext(name) : undefined,
        };
      }
      return {
        name,
        status: 'actualizado',
        detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
        context: section === 'investment' ? buildInvestmentContext(name) : undefined,
      };
    });

    if (section !== 'investment') return baseRows;

    const tenenciaInstruments = investmentInstruments.filter((instrument) =>
      isTenenciaInstrumentLabel(instrument.label),
    );
    const tenenciaMatchesInMonth = dedupedSectionRecords.filter(
      (record) => record.block === 'investment' && isTenenciaInstrumentLabel(record.label),
    );
    const otherInstruments = investmentInstruments.filter(
      (instrument) => !isTenenciaInstrumentLabel(instrument.label),
    );

    const customRows: ChecklistRow[] = otherInstruments.map((instrument) => {
      const isOptional = isRiskCapitalInvestmentLabel(instrument.label);
      const isExcluded = (instrument.excludedMonths || []).includes(monthKey);
      if (isExcluded) {
        return {
          name: instrument.label,
          status: 'excluido',
          detail: `No considerado en ${monthLabel(monthKey).toLowerCase()}`,
          isOptional,
          isCustomInstrument: true,
          instrumentId: instrument.id,
          context: buildInvestmentContext(instrument.label, instrument),
        };
      }

      const match = findRecordForLabel(instrument.label, instrument.currency);
      if (!match) {
        return {
          name: instrument.label,
          status: 'pendiente',
          detail: 'Sin valor este mes',
          isOptional,
          isCustomInstrument: true,
          instrumentId: instrument.id,
          context: buildInvestmentContext(instrument.label, instrument),
        };
      }
      if (isCarriedRecord(match)) {
        return {
          name: instrument.label,
          status: 'mes_anterior',
          detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
          isOptional,
          isCustomInstrument: true,
          instrumentId: instrument.id,
          context: buildInvestmentContext(instrument.label, instrument),
        };
      }
      return {
        name: instrument.label,
        status: 'actualizado',
        detail: `${displayRecordOrigin(match)} · ${formatRecordUpdatedStamp(match)}`,
        isOptional,
        isCustomInstrument: true,
        instrumentId: instrument.id,
        context: buildInvestmentContext(instrument.label, instrument),
      };
    });

    if (tenenciaInstruments.length > 0 || tenenciaMatchesInMonth.length > 0) {
      const tenenciaRecent = [...tenenciaMatchesInMonth].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      const tenenciaAllCarried =
        tenenciaMatchesInMonth.length > 0 &&
        tenenciaMatchesInMonth.every((record) => isCarriedRecord(record) || isEstimatedRecord(record));
      const tenenciaContext: InvestmentSourceContext = {
        title: TENENCIA_BASE_LABEL,
        sourceHint: 'auto',
        source: TENENCIA_BASE_LABEL,
        labels:
          tenenciaInstruments.length > 0
            ? tenenciaInstruments.map((instrument) => ({
                label: instrument.label,
                currency: instrument.currency,
              }))
            : [
                {
                  label: TENENCIA_BASE_LABEL,
                  currency: (tenenciaRecent?.currency || 'CLP') as WealthCurrency,
                },
              ],
        isCustom: true,
      };
      customRows.push({
        name: TENENCIA_BASE_LABEL,
        status:
          tenenciaMatchesInMonth.length === 0
            ? 'pendiente'
            : tenenciaAllCarried
              ? 'mes_anterior'
              : 'actualizado',
        detail:
          tenenciaMatchesInMonth.length === 0
            ? 'Sin valor este mes'
            : `${displayRecordOrigin(tenenciaRecent)} · ${formatRecordUpdatedStamp(tenenciaRecent)}`,
        isOptional: false,
        isCustomInstrument: true,
        context: tenenciaContext,
      });
    }

    const uniqueCustomRows = customRows.filter(
      (customRow) => !baseRows.some((baseRow) => sameCanonicalLabel(baseRow.name, customRow.name)),
    );
    const consolidated = [...baseRows, ...uniqueCustomRows];
    const tenenciaRows = consolidated.filter((row) => isTenenciaInstrumentLabel(row.name));
    if (tenenciaRows.length <= 1) return consolidated;
    const canonicalTenencia = tenenciaRows[0];
    return consolidated.filter(
      (row) => !isTenenciaInstrumentLabel(row.name) || sameCanonicalLabel(row.name, canonicalTenencia.name),
    );
  }, [section, dedupedSectionRecords, investmentInstruments, monthKey]);

  const normalizeSuggestionBlock = (block: WealthBlock): WealthBlock => {
    if (section === 'real_estate') return block === 'debt' ? 'debt' : 'real_estate';
    return getSectionBlock(section);
  };
  const suggestionKey = (item: Pick<EditableSuggestion, 'block' | 'source' | 'label' | 'currency'>) =>
    `${item.block}::${normalizeForMatch(item.source)}::${normalizeForMatch(item.label)}::${item.currency}`;

  const normalizeSnapshotDateForVisualMonth = (snapshotDate?: string) => {
    const candidate = String(snapshotDate || '').trim();
    if (candidate.startsWith(expectedMonthPrefix)) return candidate;
    return visualSnapshotDate;
  };

  const upsertRecordForVisualMonth = (
    payload: Omit<WealthRecord, 'id' | 'createdAt'> & { id?: string },
    operation: string,
  ) => {
    const snapshotDate = normalizeSnapshotDateForVisualMonth(payload.snapshotDate);
    const before = {
      operation,
      monthKey,
      id: payload.id || null,
      requestedSnapshotDate: payload.snapshotDate,
      normalizedSnapshotDate: snapshotDate,
    };
    console.info('[Patrimonio][save-before]', before);
    const saved = upsertWealthRecord({ ...payload, snapshotDate });
    const persisted = loadWealthRecords().find((record) => record.id === saved.id) || saved;
    const inExpectedMonth = String(persisted.snapshotDate || '').startsWith(expectedMonthPrefix);
    const after = {
      operation,
      monthKey,
      id: persisted.id,
      persistedSnapshotDate: persisted.snapshotDate,
      inExpectedMonth,
    };
    console.info('[Patrimonio][save-after]', after);
    if (!inExpectedMonth) {
      const visibleError = `No pude guardar "${payload.label}" en ${monthLabel(monthKey).toLowerCase()}. Reintenta.`;
      if (section === 'bank') setFintocStatus(visibleError);
      else setOcrError(visibleError);
      return null;
    }
    return persisted;
  };

  const openImagePicker = () => {
    if (!hiddenUploadInputRef.current) return;
    hiddenUploadInputRef.current.click();
  };

  const isSuraInvestmentLabel = (label: string) =>
    sameCanonicalLabel(label, INVESTMENT_SURA_FIN_LABEL) || sameCanonicalLabel(label, INVESTMENT_SURA_PREV_LABEL);

  const sanitizeManualUpdateNote = (note?: string) => {
    const trimmed = String(note || '').trim();
    if (!trimmed) return undefined;
    const normalized = normalizeForMatch(trimmed);
    if (normalized.includes('arrastrado') || normalized.includes('mes anterior') || normalized.includes('estimado')) {
      return undefined;
    }
    return trimmed;
  };

  const applyInvestmentContextToParsed = (parsed: EditableSuggestion[]): EditableSuggestion[] => {
    if (section !== 'investment' || !activeSourceContext) return parsed;

    if (activeSourceContext.labels.length === 1) {
      const target = activeSourceContext.labels[0];
      const exact = parsed.find((item) => normalizeForMatch(item.label) === normalizeForMatch(target.label));
      const fallback = exact || parsed[0] || null;
      if (!fallback) return [];
      return [
        {
          ...fallback,
          block: 'investment',
          source: activeSourceContext.source,
          label: target.label,
          currency: target.currency,
        },
      ];
    }

    return activeSourceContext.labels
      .map((target) => {
        const exact = parsed.find((item) => normalizeForMatch(item.label) === normalizeForMatch(target.label));
        if (!exact) return null;
        return {
          ...exact,
          block: 'investment' as WealthBlock,
          source: activeSourceContext.source,
          label: target.label,
          currency: target.currency,
        };
      })
      .filter((item): item is EditableSuggestion => !!item);
  };

  const appendSuggestions = (incoming: EditableSuggestion[]) => {
    setSuggestions((prev) => {
      const next = [...prev];
      const indexByKey = new Map(next.map((item, idx) => [suggestionKey(item), idx]));
      incoming.forEach((item) => {
        const key = suggestionKey(item);
        const existingIdx = indexByKey.get(key);
        if (existingIdx === undefined) {
          indexByKey.set(key, next.length);
          next.push(item);
        } else {
          next[existingIdx] = item;
        }
      });
      return next;
    });
  };

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setOpenLoadPanel(true);
    setOcrError('');
    setOcrProgress({ pct: 0, status: 'iniciando' });

    try {
      const text = await runOcrFromFile(file, sourceHint, (pct, status) => setOcrProgress({ pct, status }));
      setOcrText(text);

      const rawParsed = parseWealthFromOcrText(text, sourceHint);
      let parsed = rawParsed.map((item) => ({
        ...item,
        block: normalizeSuggestionBlock(item.block),
        snapshotDate: visualSnapshotDate,
      }));
      parsed = applyInvestmentContextToParsed(parsed);

      // En Bienes raíces el documento de dividendo debe traer ambos valores.
      if (section === 'real_estate' && sourceHint === 'dividendo') {
        const strictDividendParsed = parseWealthFromOcrText(text, 'dividendo').map((item) => ({
          ...item,
          block: normalizeSuggestionBlock(item.block),
          snapshotDate: visualSnapshotDate,
        }));
        const hasDividend = strictDividendParsed.some((i) => i.label === MORTGAGE_DIVIDEND_LABEL);
        const hasDebt = strictDividendParsed.some((i) => i.label === MORTGAGE_DEBT_BALANCE_LABEL);
        if (!hasDividend || !hasDebt) {
          setOcrError('Para este documento deben detectarse ambos valores: dividendo y saldo deuda después del pago.');
          return;
        }
        parsed = strictDividendParsed;
      }

      const isSuraDualContext =
        section === 'investment' &&
        !!activeSourceContext &&
        activeSourceContext.labels.length > 1 &&
        activeSourceContext.labels.every((item) => isSuraInvestmentLabel(item.label));

      if (
        section === 'investment' &&
        activeSourceContext?.labels.length &&
        parsed.length < activeSourceContext.labels.length &&
        !isSuraDualContext
      ) {
        setOcrError(
          `No pude detectar todos los valores de ${activeSourceContext.title}. Intenta una captura más clara o usa "Ingresar monto".`,
        );
        return;
      }

      if (!parsed.length) {
        setOcrError('No pude detectar montos claros. Intenta con otra captura.');
        return;
      }

      const isLikelyWrongSection =
        (section === 'investment' && rawParsed.some((r) => r.block === 'debt' || r.block === 'real_estate')) ||
        (section === 'real_estate' && rawParsed.some((r) => r.block === 'investment' || r.block === 'bank')) ||
        (section === 'bank' && rawParsed.some((r) => r.block !== 'bank'));

      if (isLikelyWrongSection) {
        setOcrError('La imagen parece pertenecer a otro bloque. Revisa antes de guardar.');
      }

      if (isSuraDualContext) {
        const hasFin = parsed.some((item) => sameCanonicalLabel(item.label, INVESTMENT_SURA_FIN_LABEL));
        const hasPrev = parsed.some((item) => sameCanonicalLabel(item.label, INVESTMENT_SURA_PREV_LABEL));
        if (hasFin && hasPrev) {
          setPendingSuraOcrDecision({
            parsed,
            primaryLabel:
              activeSourceContext?.primaryLabel ||
              activeSourceContext?.labels[0]?.label ||
              INVESTMENT_SURA_FIN_LABEL,
          });
          return;
        }
      }

      appendSuggestions(parsed);
    } catch (err: any) {
      setOcrError(err?.message || 'Error leyendo imagen');
    } finally {
      setOcrProgress(null);
      event.target.value = '';
    }
  };

  const saveSuggestion = (item: EditableSuggestion, idx?: number) => {
    const itemLabel = normalizeForMatch(item.label);
    const existing = dedupedSectionRecords.find(
      (r) =>
        r.block === item.block &&
        r.currency === item.currency &&
        normalizeForMatch(r.label) === itemLabel,
    );

    const saved = upsertRecordForVisualMonth({
      id: existing?.id,
      block: item.block,
      source: item.source,
      label: item.label,
      amount: item.amount,
      currency: item.currency,
      note: item.note,
      snapshotDate: item.snapshotDate,
    }, 'saveSuggestion');
    if (!saved) return;

    if (typeof idx === 'number') {
      setSuggestions((prev) => prev.filter((_, i) => i !== idx));
    }

    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    setPendingSuraOcrDecision(null);
    onDataChanged();
  };

  const saveAllSuggestions = () => {
    let failed = false;
    for (const item of suggestions) {
      const itemLabel = normalizeForMatch(item.label);
      const existing = dedupedSectionRecords.find(
        (r) =>
          r.block === item.block &&
          r.currency === item.currency &&
          normalizeForMatch(r.label) === itemLabel,
      );

      const saved = upsertRecordForVisualMonth({
        id: existing?.id,
        block: item.block,
        source: item.source,
        label: item.label,
        amount: item.amount,
        currency: item.currency,
        note: item.note,
        snapshotDate: item.snapshotDate,
      }, 'saveAllSuggestions');
      if (!saved) {
        failed = true;
        break;
      }
    }
    if (failed) return;
    setSuggestions([]);
    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    setPendingSuraOcrDecision(null);
    onDataChanged();
  };

  const saveDraft = () => {
    const amount = parseStrictNumber(draft.amount);
    const normalizedAmount = draft.block === 'debt' ? Math.abs(amount) : amount;
    if (!draft.label.trim() || !Number.isFinite(normalizedAmount) || normalizedAmount < 0) return;

    const saved = upsertRecordForVisualMonth({
      id: editingId || undefined,
      block: draft.block,
      source: draft.source || 'manual',
      label: draft.label.trim(),
      amount: normalizedAmount,
      currency: draft.currency,
      note: draft.note.trim() || undefined,
      snapshotDate: draft.snapshotDate,
    }, 'saveDraft');
    if (!saved) return;

    setDraft(buildDraft(section, monthKey));
    setEditingId(null);
    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    onDataChanged();
  };

  const isSectionComplete = useMemo(() => {
    return checklistRows.every((row) => row.status !== 'pendiente' || row.isOptional);
  }, [checklistRows]);

  const sortedChecklistRows = useMemo(() => {
    const weight = (row: ChecklistRow) => {
      if (row.status === 'pendiente') return 0;
      if (row.status === 'mes_anterior') return 1;
      if (row.status === 'estimado') return 2;
      if (row.status === 'actualizado') return 3;
      return 4;
    };
    return [...checklistRows].sort((a, b) => weight(a) - weight(b));
  }, [checklistRows]);

  const missingRowsForCompose = useMemo(
    () => sortedChecklistRows.filter((row) => row.status === 'pendiente' && !row.isOptional).map((row) => row.name),
    [sortedChecklistRows],
  );

  const checklistSummary = useMemo(() => {
    const requiredRows = checklistRows.filter((row) => !row.isOptional);
    const total = requiredRows.length;
    const pending = requiredRows.filter((row) => row.status === 'pendiente').length;
    const excluded = requiredRows.filter((row) => row.status === 'excluido').length;
    const notUpdated = requiredRows.filter((row) => row.status === 'mes_anterior' || row.status === 'estimado').length;
    const updated = requiredRows.filter((row) => row.status === 'actualizado').length;
    const completed = total - pending - excluded;
    const optionalPending = checklistRows.filter((row) => row.isOptional && row.status === 'pendiente').length;
    return { total, pending, excluded, notUpdated, updated, completed, optionalPending };
  }, [checklistRows]);

  const inferInvestmentCurrency = (label: string): WealthCurrency => {
    if (sameCanonicalLabel(label, INVESTMENT_GLOBAL66_USD_LABEL)) return 'USD';
    if (sameCanonicalLabel(label, INVESTMENT_WISE_USD_LABEL)) return 'USD';
    if (sameCanonicalLabel(label, RISK_CAPITAL_LABEL_USD)) return 'USD';
    const normalized = normalizeForMatch(label);
    if (normalized.endsWith(' usd') || normalized.includes(' usd ')) return 'USD';
    if (normalized.endsWith(' eur') || normalized.includes(' eur ')) return 'EUR';
    return 'CLP';
  };

  const investmentMetaFromLabel = (
    label: string,
    currency: WealthCurrency,
  ): { key: string; label: string; group: InvestmentAnalyticsGroup; isRiskCapital: boolean } => {
    if (sameCanonicalLabel(label, INVESTMENT_SURA_FIN_LABEL)) {
      return { key: 'sura_fin', label: 'SURA financiero', group: 'financieras', isRiskCapital: false };
    }
    if (sameCanonicalLabel(label, INVESTMENT_BTG_LABEL)) {
      return { key: 'btg', label: 'BTG', group: 'financieras', isRiskCapital: false };
    }
    if (sameCanonicalLabel(label, INVESTMENT_GLOBAL66_USD_LABEL)) {
      return { key: 'global66', label: 'Global66', group: 'financieras', isRiskCapital: false };
    }
    if (sameCanonicalLabel(label, INVESTMENT_WISE_USD_LABEL)) {
      return { key: 'wise', label: 'Wise', group: 'financieras', isRiskCapital: false };
    }
    if (sameCanonicalLabel(label, INVESTMENT_SURA_PREV_LABEL)) {
      return { key: 'sura_prev', label: 'SURA previsional', group: 'previsionales', isRiskCapital: false };
    }
    if (sameCanonicalLabel(label, INVESTMENT_PLANVITAL_LABEL)) {
      return { key: 'planvital', label: 'PlanVital', group: 'previsionales', isRiskCapital: false };
    }
    if (isTenenciaInstrumentLabel(label)) {
      return { key: 'tenencia_cxc', label: TENENCIA_CXC_PREFIX_LABEL, group: 'otros', isRiskCapital: false };
    }
    if (isRiskCapitalInvestmentLabel(label)) {
      return {
        key: `risk_${currency.toLowerCase()}`,
        label: currency === 'USD' ? RISK_CAPITAL_LABEL_USD : RISK_CAPITAL_LABEL_CLP,
        group: 'otros',
        isRiskCapital: true,
      };
    }
    return {
      key: `other_${labelMatchKey(label)}_${currency.toLowerCase()}`,
      label,
      group: 'otros',
      isRiskCapital: false,
    };
  };

  const buildInvestmentAnalyticsMap = (
    records: WealthRecord[],
    fxRates: { usdClp: number; eurClp: number; ufClp: number },
  ) => {
    const map = new Map<string, InvestmentAnalyticsRow>();
    records.forEach((record) => {
      if (record.block !== 'investment') return;
      const meta = investmentMetaFromLabel(record.label, record.currency);
      const amountClp = toClp(record.amount, record.currency, fxRates.usdClp, fxRates.eurClp, fxRates.ufClp);
      const existing = map.get(meta.key);
      if (existing) {
        map.set(meta.key, { ...existing, currentClp: existing.currentClp + amountClp });
        return;
      }
      map.set(meta.key, {
        key: meta.key,
        label: meta.label,
        group: meta.group,
        isRiskCapital: meta.isRiskCapital,
        currentClp: amountClp,
        compareClp: null,
      });
    });
    return map;
  };

  const previousConfirmedClosureForInvestment = useMemo(() => {
    if (section !== 'investment') return null;
    return (
      [...closures]
        .filter((closure) => closure.monthKey < monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null
    );
  }, [section, closures, monthKey]);

  const previousInvestmentRecords = useMemo(() => {
    if (!previousConfirmedClosureForInvestment?.records?.length) return [];
    return latestRecordsForMonth(
      previousConfirmedClosureForInvestment.records,
      previousConfirmedClosureForInvestment.monthKey,
    ).filter((record) => record.block === 'investment');
  }, [previousConfirmedClosureForInvestment]);

  const investmentAnalyticsRows = useMemo<InvestmentAnalyticsRow[]>(() => {
    if (section !== 'investment') return [];
    const currentMap = buildInvestmentAnalyticsMap(dedupedSectionRecords, { usdClp, eurClp, ufClp });
    const compareFx = previousConfirmedClosureForInvestment?.fxRates || { usdClp, eurClp, ufClp };
    const compareMap = buildInvestmentAnalyticsMap(previousInvestmentRecords, compareFx);
    const keys = new Set([...currentMap.keys(), ...compareMap.keys()]);
    const rows = [...keys].map((key) => {
      const current = currentMap.get(key);
      const compare = compareMap.get(key);
      return {
        key,
        label: current?.label || compare?.label || key,
        group: current?.group || compare?.group || 'otros',
        isRiskCapital: Boolean(current?.isRiskCapital || compare?.isRiskCapital),
        currentClp: current?.currentClp || 0,
        compareClp: compare ? compare.currentClp : null,
      };
    });
    return rows.sort((a, b) => {
      const groupDiff = investmentGroupOrder[a.group] - investmentGroupOrder[b.group];
      if (groupDiff !== 0) return groupDiff;
      if (a.isRiskCapital !== b.isRiskCapital) return a.isRiskCapital ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  }, [
    section,
    dedupedSectionRecords,
    previousInvestmentRecords,
    previousConfirmedClosureForInvestment,
    usdClp,
    eurClp,
    ufClp,
    investmentGroupOrder,
  ]);

  const includeInvestmentAmountForMode = (amount: number, isRiskCapital: boolean) => {
    if (!isRiskCapital) return amount;
    return includeRiskCapitalInTotals ? amount : 0;
  };

  const investmentAnalyticsTotals = useMemo(() => {
    const totals = {
      financieras: { current: 0, compare: 0, hasCompare: false },
      previsionales: { current: 0, compare: 0, hasCompare: false },
      otros: { current: 0, compare: 0, hasCompare: false },
    };
    investmentAnalyticsRows.forEach((row) => {
      totals[row.group].current += includeInvestmentAmountForMode(row.currentClp, row.isRiskCapital);
      if (row.compareClp !== null) {
        totals[row.group].compare += includeInvestmentAmountForMode(row.compareClp, row.isRiskCapital);
        totals[row.group].hasCompare = true;
      }
    });
    return totals;
  }, [investmentAnalyticsRows, includeRiskCapitalInTotals]);

  const investmentTotalCompareClp = useMemo(() => {
    if (section !== 'investment') return null;
    if (!previousConfirmedClosureForInvestment) return null;
    if (previousInvestmentRecords.length > 0) {
      return (
        investmentAnalyticsTotals.financieras.compare +
        investmentAnalyticsTotals.previsionales.compare +
        investmentAnalyticsTotals.otros.compare
      );
    }
    if (includeRiskCapitalInTotals && Number.isFinite(previousConfirmedClosureForInvestment.summary?.investmentClpWithRisk)) {
      return Number(previousConfirmedClosureForInvestment.summary.investmentClpWithRisk);
    }
    if (Number.isFinite(previousConfirmedClosureForInvestment.summary?.investmentClp)) {
      return Number(previousConfirmedClosureForInvestment.summary.investmentClp);
    }
    return null;
  }, [
    section,
    previousConfirmedClosureForInvestment,
    previousInvestmentRecords,
    investmentAnalyticsTotals,
    includeRiskCapitalInTotals,
  ]);

  const investmentTotalDelta = useMemo(() => {
    if (section !== 'investment' || investmentTotalCompareClp === null) return null;
    return sectionTotalClp - investmentTotalCompareClp;
  }, [section, sectionTotalClp, investmentTotalCompareClp]);

  const investmentTotalDeltaPct = useMemo(() => {
    if (investmentTotalCompareClp === null || investmentTotalCompareClp === 0) return null;
    return ((sectionTotalClp - investmentTotalCompareClp) / investmentTotalCompareClp) * 100;
  }, [sectionTotalClp, investmentTotalCompareClp]);

  const buildInvestmentSourceContextForRow = (row: ChecklistRow): InvestmentSourceContext => {
    if (isSuraInvestmentLabel(row.name)) {
      return {
        title: 'SURA',
        sourceHint: 'sura_resumen',
        source: 'SURA',
        labels: [
          { label: INVESTMENT_SURA_FIN_LABEL, currency: 'CLP' },
          { label: INVESTMENT_SURA_PREV_LABEL, currency: 'CLP' },
        ],
        primaryLabel: row.name,
      };
    }
    if (isTenenciaInstrumentLabel(row.name)) {
      const labelsFromInstruments = investmentInstruments
        .filter((instrument) => isTenenciaInstrumentLabel(instrument.label))
        .map((instrument) => ({ label: instrument.label, currency: instrument.currency }));
      const labelsFromRecords = dedupedSectionRecords
        .filter((record) => record.block === 'investment' && isTenenciaInstrumentLabel(record.label))
        .map((record) => ({ label: record.label, currency: record.currency }));
      const labels = [...labelsFromInstruments, ...labelsFromRecords].reduce<
        Array<{ label: string; currency: WealthCurrency }>
      >((acc, item) => {
        const key = `${labelMatchKey(item.label)}::${item.currency}`;
        if (acc.some((existing) => `${labelMatchKey(existing.label)}::${existing.currency}` === key)) return acc;
        acc.push(item);
        return acc;
      }, []);
      return {
        title: TENENCIA_CXC_PREFIX_LABEL,
        sourceHint: 'auto',
        source: TENENCIA_CXC_PREFIX_LABEL,
        labels: labels.length ? labels : [{ label: TENENCIA_CXC_PREFIX_LABEL, currency: 'CLP' }],
        isCustom: true,
      };
    }
    const context = row.context;
    const exactMatch = context?.labels.find((item) => sameCanonicalLabel(item.label, row.name));
    return {
      title: row.name,
      sourceHint: context?.sourceHint || 'auto',
      source: context?.source || 'Manual',
      labels: [
        {
          label: row.name,
          currency: exactMatch?.currency || inferInvestmentCurrency(row.name),
        },
      ],
      instrumentId: row.instrumentId,
      isCustom: row.isCustomInstrument || context?.isCustom,
    };
  };

  const investmentOperationalRows = useMemo<InvestmentOperationalRow[]>(() => {
    if (section !== 'investment') return [];
    const seen = new Set<string>();
    const baseRows = checklistRows
      .filter((row) => {
        const rowKey = isTenenciaInstrumentLabel(row.name) ? TENENCIA_BASE_KEY : labelMatchKey(row.name);
        if (seen.has(rowKey)) return false;
        seen.add(rowKey);
        return true;
      })
      .map((row) => {
        const sourceContext = buildInvestmentSourceContextForRow(row);
        const relatedRecords = dedupedSectionRecords.filter(
          (record) =>
            record.block === 'investment' &&
            sourceContext.labels.some(
              (item) => item.currency === record.currency && sameCanonicalLabel(item.label, record.label),
            ),
        );
        const hasValue = relatedRecords.length > 0;
        const amountText = hasValue
          ? relatedRecords.length === 1
            ? formatCurrency(relatedRecords[0].amount, relatedRecords[0].currency)
            : formatCurrency(
                relatedRecords.reduce(
                  (sum, record) => sum + toClp(record.amount, record.currency, usdClp, eurClp, ufClp),
                  0,
                ),
                'CLP',
              )
          : 'Sin valor este mes';
        return {
          key: row.instrumentId ? `instrument-${row.instrumentId}` : `label-${labelMatchKey(row.name)}`,
          name: row.name,
          status: row.status,
          detail: row.detail,
          amountText,
          hasValue,
          updatedThisMonth: row.status === 'actualizado',
          sourceContext,
        };
      });
    const pendingFirst = baseRows.filter((row) => !row.updatedThisMonth);
    const updatedAfter = baseRows.filter((row) => row.updatedThisMonth);
    return [...pendingFirst, ...updatedAfter];
  }, [section, checklistRows, dedupedSectionRecords, investmentInstruments, usdClp, eurClp, ufClp]);

  const triggerInvestmentPhotoLoad = (context: InvestmentSourceContext) => {
    setActiveSourceContext(context);
    setSourceHint(context.sourceHint);
    setQuickFill(null);
    setMultiQuickFill(null);
    setSuggestions([]);
    setOcrError('');
    setOcrText('');
    setPendingSuraOcrDecision(null);
    setOpenLoadPanel(true);
    requestAnimationFrame(() => openImagePicker());
  };

  const confirmDeleteInvestmentTargets = () => {
    if (!pendingInvestmentDelete) return;
    const before = latestRecordsForMonth(loadWealthRecords(), monthKey);
    console.info('[Patrimonio][investment-delete-before]', {
      monthKey,
      targets: pendingInvestmentDelete.targets,
      recordsBefore: before.length,
    });
    pendingInvestmentDelete.targets.forEach((target) => {
      removeWealthRecordForMonthAsset({
        block: 'investment',
        label: target.label,
        currency: target.currency,
        monthKey,
      });
    });
    const after = latestRecordsForMonth(loadWealthRecords(), monthKey);
    const removed = Math.max(0, before.length - after.length);
    console.info('[Patrimonio][investment-delete-after]', {
      monthKey,
      targets: pendingInvestmentDelete.targets,
      recordsAfter: after.length,
      removed,
    });
    if (removed === 0 && pendingInvestmentDelete.targets.length > 0) {
      setOcrError('No pude confirmar el borrado del instrumento. Reintenta.');
      setPendingInvestmentDelete(null);
      return;
    }
    setPendingInvestmentDelete(null);
    onDataChanged();
  };

  const investmentSubtotalCards = useMemo(
    () => [
      {
        key: 'financieras',
        label: 'Inversiones financieras',
        current: investmentAnalyticsTotals.financieras.current,
        compare: investmentAnalyticsTotals.financieras.hasCompare
          ? investmentAnalyticsTotals.financieras.compare
          : null,
        className: 'border-[#d8c39d] bg-[#f6ead7]',
        titleClassName: 'text-[#7f5528]',
      },
      {
        key: 'previsionales',
        label: 'Inversiones previsionales',
        current: investmentAnalyticsTotals.previsionales.current,
        compare: investmentAnalyticsTotals.previsionales.hasCompare
          ? investmentAnalyticsTotals.previsionales.compare
          : null,
        className: 'border-emerald-200 bg-emerald-50',
        titleClassName: 'text-emerald-800',
      },
      {
        key: 'otros',
        label: 'Otras inversiones',
        current: investmentAnalyticsTotals.otros.current,
        compare: investmentAnalyticsTotals.otros.hasCompare ? investmentAnalyticsTotals.otros.compare : null,
        className:
          'border-[#e8dfcf] bg-[#fcfaf5] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(15,63,58,0.08)]',
        titleClassName: 'text-slate-700',
      },
    ],
    [investmentAnalyticsTotals],
  );

  const closeLoadPanel = () => {
    setOpenLoadPanel(false);
    setQuickFill(null);
    setMultiQuickFill(null);
    setEditingId(null);
    setSuggestions([]);
    setOcrError('');
    setOcrText('');
    setActiveSourceContext(null);
    setPendingSuraOcrDecision(null);
  };

  const openQuickFillForContext = (context: InvestmentSourceContext) => {
    if (context.labels.length > 1) {
      const entries = context.labels.map((entry) => {
        const existing = findRecordForLabel(entry.label, entry.currency);
        return {
          id: existing?.id,
          label: entry.label,
          currency: entry.currency,
          amount: existing ? String(existing.amount) : '',
          note: sanitizeManualUpdateNote(existing?.note),
        };
      });
      setMultiQuickFill({
        source: context.source,
        snapshotDate: visualSnapshotDate,
        entries,
      });
      setQuickFill(null);
      setPendingSuraOcrDecision(null);
      setOpenLoadPanel(true);
      return;
    }

    const entry = context.labels[0];
    const existing = findRecordForLabel(entry.label, entry.currency);
    setQuickFill({
      id: existing?.id,
      block: 'investment',
      source: context.source,
      label: entry.label,
      amount: existing ? String(existing.amount) : '',
      currency: entry.currency,
      note: sanitizeManualUpdateNote(existing?.note) || '',
      snapshotDate: existing?.snapshotDate || visualSnapshotDate,
    });
    setMultiQuickFill(null);
    setPendingSuraOcrDecision(null);
    setOpenLoadPanel(true);
  };

  const openChecklistItem = (row: ChecklistRow) => {
    if (section === 'investment' && row.context) {
      setActiveSourceContext(row.context);
      setOpenSourceMenu(true);
      return;
    }

    const existing = dedupedSectionRecords.find((r) => sameCanonicalLabel(r.label, row.name));
    const preferredBlock: WealthBlock =
      section === 'real_estate' &&
      REAL_ESTATE_DEBT_LABELS.some((item) => sameCanonicalLabel(row.name, item))
        ? 'debt'
        : section === 'real_estate'
          ? 'real_estate'
          : getSectionBlock(section);

    if (section === 'real_estate') {
      setActiveSourceContext(null);
      setQuickFill({
        id: existing?.id,
        block: preferredBlock,
        source: existing?.source || 'manual',
        label: existing?.label || row.name,
        amount: existing ? String(existing.amount) : '',
        currency: existing?.currency || 'UF',
        snapshotDate: existing?.snapshotDate || visualSnapshotDate,
      });
      setOpenLoadPanel(true);
      return;
    }

    if (existing) {
      setEditingId(existing.id);
      setDraft({
        block: existing.block,
        source: existing.source,
        label: existing.label,
        amount: String(existing.amount),
        currency: existing.currency,
        note: isCarriedRecord(existing) || isEstimatedRecord(existing) ? '' : existing.note || '',
        snapshotDate: existing.snapshotDate,
      });
    } else {
      setEditingId(null);
      setDraft({
        ...buildDraft(section, monthKey),
        block: preferredBlock,
        label: row.name,
        currency: buildDraft(section, monthKey).currency,
      });
    }
    setOpenLoadPanel(true);
  };

  const saveQuickFill = () => {
    if (!quickFill) return;
    const amount = parseStrictNumber(quickFill.amount);
    const normalizedAmount = quickFill.block === 'debt' ? Math.abs(amount) : amount;
    if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) return;
    const saved = upsertRecordForVisualMonth({
      id: quickFill.id,
      block: quickFill.block,
      source: quickFill.source,
      label: quickFill.label,
      amount: normalizedAmount,
      currency: quickFill.currency,
      note: sanitizeManualUpdateNote(quickFill.note),
      snapshotDate: quickFill.snapshotDate,
    }, 'saveQuickFill');
    if (!saved) return;
    setQuickFill(null);
    setActiveSourceContext(null);
    setPendingSuraOcrDecision(null);
    setOpenLoadPanel(false);
    onDataChanged();
  };

  const saveMultiQuickFill = () => {
    if (!multiQuickFill) return;
    const parsedEntries = multiQuickFill.entries
      .map((entry) => ({
        ...entry,
        amountParsed: parseStrictNumber(String(entry.amount || '')),
      }))
      .filter((entry) => Number.isFinite(entry.amountParsed) && entry.amountParsed >= 0);
    if (!parsedEntries.length) return;

    for (const entry of parsedEntries) {
      const saved = upsertRecordForVisualMonth({
        id: entry.id,
        block: 'investment',
        source: multiQuickFill.source,
        label: entry.label,
        amount: entry.amountParsed,
        currency: entry.currency,
        note: sanitizeManualUpdateNote(entry.note),
        snapshotDate: multiQuickFill.snapshotDate,
      }, 'saveMultiQuickFill');
      if (!saved) return;
    }
    setMultiQuickFill(null);
    setActiveSourceContext(null);
    setPendingSuraOcrDecision(null);
    setOpenLoadPanel(false);
    onDataChanged();
  };

  const mergeAccounts = (prev: FintocAccountNormalized[], next: FintocAccountNormalized[]) => {
    const map = new Map<string, FintocAccountNormalized>();
    [...prev, ...next].forEach((account) => {
      const key = `${account.bank || 'Banco'}::${account.id}`;
      map.set(key, account);
    });
    return [...map.values()];
  };

  const ensureBankToken = (bankId: BankProviderId, forcePrompt = false) => {
    const existing = String(bankTokens[bankId] || '').trim();
    if (existing && !forcePrompt) return existing;

    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const entered = window.prompt(`Pega link_token de Fintoc para ${bankName}`, existing)?.trim() || '';
    if (!entered) return '';

    const nextTokens = { ...loadBankTokens(), ...bankTokens, [bankId]: entered };
    setBankTokens(nextTokens);
    saveBankTokens(nextTokens);
    return entered;
  };

  const runFintocDiscovery = async (bankId: BankProviderId, options?: { silent?: boolean }) => {
    if (section !== 'bank') return;
    const silent = !!options?.silent;
    const bankName = BANK_PROVIDERS.find((bank) => bank.id === bankId)?.label || 'Banco';
    const linkToken = ensureBankToken(bankId);
    if (!linkToken) return;

    setFintocDiscovering(true);
    if (!silent) {
      setFintocStatus('');
      setFintocDiscovery(null);
    }

    try {
      const result = await discoverFintocData(linkToken);
      if (!result.ok) {
        if (!silent) setFintocStatus(`Error API: ${result.error || 'No se pudo explorar.'}`);
        setBankMovementMeta((prev) => ({ ...prev, [bankId]: { known: false, count: 0 } }));
        return;
      }
      const snapshotDate = visualSnapshotDate;
      if (!silent) setFintocDiscovery(result);
      const discoveryBank = String(result.summary.institution || bankName).trim() || bankName;
      setFintocLastSync((prev) => ({
        assets: mergeAccounts(
          prev?.assets || [],
          result.accounts.filter((acc) => !isCreditCardAccount(acc)).map((acc) => ({ ...acc, bank: discoveryBank })),
        ),
        cards: mergeAccounts(
          prev?.cards || [],
          result.accounts.filter((acc) => isCreditCardAccount(acc)).map((acc) => ({ ...acc, bank: discoveryBank })),
        ),
      }));

      // También actualiza los cuadros principales del banco para evitar que queden "Pendiente" tras explorar.
      const discoveryAssets = result.accounts.filter((acc) => !isCreditCardAccount(acc));
      const providerTotals = discoveryAssets.reduce(
        (acc, account) => {
          const currency = toWealthCurrency(account.currency);
          if (!currency) return acc;
          if (currency === 'CLP') acc.clp += account.balance;
          if (currency === 'USD') acc.usd += account.balance;
          return acc;
        },
        { clp: 0, usd: 0 },
      );
      const manualProviderPrefix = BANK_PROVIDERS.find((provider) => provider.id === bankId)?.label || bankName;
      const upsertByLabel = (
        block: WealthBlock,
        label: string,
        currency: WealthCurrency,
        amount: number,
        note?: string,
      ) => {
        const existing = dedupedSectionRecords.find(
          (r) =>
            normalizeForMatch(r.label) === normalizeForMatch(label) &&
            r.currency === currency &&
            r.block === block,
        );
        const saved = upsertRecordForVisualMonth({
          id: existing?.id,
          block,
          source: 'Fintoc API',
          label,
          amount: Math.max(0, amount),
          currency,
          snapshotDate,
          note,
        }, `runFintocDiscovery:${label}`);
        if (!saved) throw new Error(`No pude guardar ${label} en ${monthLabel(monthKey).toLowerCase()}.`);
      };
      upsertByLabel(
        'bank',
        `${manualProviderPrefix} CLP`,
        'CLP',
        providerTotals.clp,
        `API ${discoveryBank} (${discoveryAssets.length} cuentas)`,
      );
      upsertByLabel(
        'bank',
        `${manualProviderPrefix} USD`,
        'USD',
        providerTotals.usd,
        `API ${discoveryBank} (${discoveryAssets.length} cuentas)`,
      );
      const refreshedMonthRecords = latestRecordsForMonth(loadWealthRecords(), monthKey);
      const refreshedBankDetails = refreshedMonthRecords.filter(
        (record) => record.block === 'bank' && MANUAL_BANK_ITEMS.some((item) => item.label === record.label),
      );
      const totalClp = refreshedBankDetails
        .filter((record) => record.currency === 'CLP')
        .reduce((sum, record) => sum + record.amount, 0);
      const totalUsd = refreshedBankDetails
        .filter((record) => record.currency === 'USD')
        .reduce((sum, record) => sum + record.amount, 0);
      upsertByLabel('bank', BANK_BALANCE_CLP_LABEL, 'CLP', totalClp, 'Calculado desde detalle de cuentas');
      upsertByLabel('bank', BANK_BALANCE_USD_LABEL, 'USD', totalUsd, 'Calculado desde detalle de cuentas');
      const movementProbes = (result.probes || []).filter((probe) => probe.endpoint.includes('/movements'));
      const movementKnown = movementProbes.some((probe) => probe.ok);
      const movementCount = movementKnown
        ? movementProbes.reduce((sum, probe) => sum + (probe.ok ? probe.items : 0), 0)
        : 0;
      setBankMovementMeta((prev) => ({ ...prev, [bankId]: { known: movementKnown, count: movementCount } }));
      onDataChanged();
      if (!silent) {
        setFintocStatus(
          `Exploración ${discoveryBank}: ${result.summary.accounts} cuentas, ${result.summary.movements} movimientos.`,
        );
      }
    } catch (error: any) {
      if (!silent) setFintocStatus(`Error API: ${error?.message || 'No se pudo explorar.'}`);
      setBankMovementMeta((prev) => ({ ...prev, [bankId]: { known: false, count: 0 } }));
    } finally {
      setFintocDiscovering(false);
    }
  };

  const runUpdateAllBanks = async (silent = false) => {
    if (section !== 'bank') return;
    const banksWithToken = BANK_PROVIDERS.filter((bank) => {
      const token = (bankTokens[bank.id] || '').trim();
      return !!token;
    });
    if (!banksWithToken.length) {
      if (!silent) setFintocStatus('No hay tokens guardados. Carga al menos un token de banco.');
      return;
    }

    setUpdatingAllBanks(true);
    if (!silent) setFintocStatus('');
    for (const bank of banksWithToken) {
      // eslint-disable-next-line no-await-in-loop
      await runFintocDiscovery(bank.id, { silent: true });
    }
    setUpdatingAllBanks(false);
    if (!silent) {
      setFintocStatus(`Bancos actualizados: ${banksWithToken.map((b) => b.label).join(', ')}.`);
    }
  };

  const openRecordEditor = (item: WealthRecord) => {
    if (section === 'investment') {
      setActiveSourceContext({
        title: item.label,
        sourceHint: 'auto',
        source: item.source,
        labels: [{ label: item.label, currency: item.currency }],
      });
      setQuickFill({
        id: item.id,
        block: item.block,
        source: item.source,
        label: item.label,
        amount: String(item.amount),
        currency: item.currency,
        note: isCarriedRecord(item) || isEstimatedRecord(item) ? '' : item.note || '',
        snapshotDate: item.snapshotDate,
      });
      setMultiQuickFill(null);
      setOpenLoadPanel(true);
      return;
    }

    if (section === 'real_estate') {
      setActiveSourceContext(null);
      setQuickFill({
        id: item.id,
        block: item.block,
        source: item.source,
        label: item.label,
        amount: String(item.amount),
        currency: item.currency,
        note: isCarriedRecord(item) || isEstimatedRecord(item) ? '' : item.note || '',
        snapshotDate: item.snapshotDate,
      });
      setMultiQuickFill(null);
      setOpenLoadPanel(true);
      return;
    }

    setEditingId(item.id);
    setDraft({
      block: item.block,
      source: item.source,
      label: item.label,
      amount: String(item.amount),
      currency: item.currency,
      note: isCarriedRecord(item) || isEstimatedRecord(item) ? '' : item.note || '',
      snapshotDate: item.snapshotDate,
    });
    setOpenLoadPanel(true);
  };

  useEffect(() => {
    if (section !== 'bank') return;

    let running = false;
    const runDailyIfNeeded = async () => {
      if (running) return;
      const today = localYmd();
      if (readBanksLastAutoSyncDay() === today) return;
      if (readBanksLastAutoAttemptDay() === today) return;
      const hasAnyToken = BANK_PROVIDERS.some((bank) => String((bankTokens[bank.id] || '').trim()));
      if (!hasAnyToken) return;

      running = true;
      writeBanksLastAutoAttemptDay(today);
      try {
        const before = loadWealthRecords();
        await runUpdateAllBanks(true);
        const after = loadWealthRecords();
        if (after.length >= before.length) writeBanksLastAutoSyncDay(today);
      } finally {
        running = false;
      }
    };

    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void runDailyIfNeeded();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void runDailyIfNeeded();
    };
    const onInteraction = () => {
      void runDailyIfNeeded();
    };

    void runDailyIfNeeded();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onInteraction);
    window.addEventListener('keydown', onInteraction);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown', onInteraction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, bankTokens]);

  return (
    <div className="space-y-4 pb-24">
      <input ref={hiddenUploadInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onUpload} />

      <Card className={`relative p-4 border-0 bg-gradient-to-br ${sectionTheme[section]} shadow-[0_12px_24px_rgba(15,23,42,0.18)]`}>
        <button className="inline-flex items-center gap-1 text-xs text-slate-600" onClick={onBack}>
          <ArrowLeft size={14} /> Volver
        </button>
        <div className="mt-2 text-lg font-bold text-slate-900">{sectionTitle}</div>
        <div className="text-xs text-slate-600">{monthLabel(monthKey)}</div>
        {section === 'bank' ? (
          <div className="mt-3 text-sm font-medium text-slate-700">Vista operativa (impacta patrimonio neto)</div>
        ) : section === 'real_estate' && !isSectionComplete ? (
          <>
            <div className="mt-3 text-3xl font-semibold text-slate-900">--</div>
            <div className="text-xs text-slate-700">Completa Valor propiedad, Saldo deuda y Dividendo para ver total</div>
          </>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <div className="text-3xl font-semibold text-slate-900">{formatCurrency(sectionTotalClp, 'CLP')}</div>
            {section === 'investment' && includeRiskCapitalInTotals && sectionHasRiskCapital && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                +CapRiesgo
              </span>
            )}
          </div>
        )}
        {section === 'investment' && previousConfirmedClosureForInvestment && investmentTotalDelta !== null && (
          <div className={`mt-1 text-xs font-medium ${investmentTotalDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {investmentTotalDelta >= 0 ? '+' : ''}
            {formatCurrency(investmentTotalDelta, 'CLP')}
            {investmentTotalDeltaPct !== null
              ? ` (${investmentTotalDeltaPct >= 0 ? '+' : ''}${investmentTotalDeltaPct.toFixed(2)}%)`
              : ''}
            {` vs ${monthLabel(previousConfirmedClosureForInvestment.monthKey)}`}
          </div>
        )}
        {section === 'investment' && (
          <button
            type="button"
            onClick={onToggleRiskCapitalView}
            className={cn(
              'absolute top-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full border transition',
              includeRiskCapitalInTotals
                ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-slate-300 bg-white/70 text-slate-400',
            )}
            title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
            aria-label="Alternar capital de riesgo"
          >
            <Zap size={18} />
          </button>
        )}
      </Card>

      {section === 'bank' && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">Dashboard bancario</div>
          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-xl p-3 text-white bg-gradient-to-r from-cyan-600 to-blue-500 text-left">
              <div className="text-xs opacity-90">Total CLP disponible</div>
              <div className="text-2xl font-bold">{formatCurrencyNoDecimals(bankDashboard.bankClp, 'CLP')}</div>
            </div>
            <div className="rounded-xl p-3 text-white bg-gradient-to-r from-teal-600 to-sky-500 text-left">
              <div className="text-xs opacity-90">Total USD disponible</div>
              <div className="text-2xl font-bold">{formatCurrencyNoDecimals(bankDashboard.bankUsd, 'USD')}</div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-xl p-2 border border-rose-200 bg-rose-50 text-left">
              <div className="text-[11px] text-rose-700">Deuda tarjetas CLP</div>
              <div className="text-lg font-semibold text-rose-700">
                {renderCardDebtTotal(bankDashboard.hasCardClpData, bankDashboard.cardClp, 'CLP')}
              </div>
            </div>
            <div className="rounded-xl p-2 border border-rose-200 bg-rose-50 text-left">
              <div className="text-[11px] text-rose-700">Deuda tarjetas USD</div>
              <div className="text-lg font-semibold text-rose-700">
                {renderCardDebtTotal(bankDashboard.hasCardUsdData, bankDashboard.cardUsd, 'USD')}
              </div>
            </div>
          </div>

          <details open className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <summary className="cursor-pointer text-sm font-medium">Bancos manuales (Chile / Scotia / Santander)</summary>
            <div className="mt-2 space-y-2">
              {MANUAL_BANK_GROUPS.map((group) => (
                <div key={group.bank} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="text-xs font-semibold text-slate-600 mb-2">{group.bank}</div>
                  <div className="grid md:grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const existing = dedupedSectionRecords.find((r) => r.label === item.label);
                      const providerId = BANK_PROVIDERS.find((bank) => bank.label === group.bank)?.id;
                      const movementMeta = providerId ? bankMovementMeta[providerId] : undefined;
                      const movementLabel = !movementMeta
                        ? 'S/I movimientos'
                        : !movementMeta.known
                          ? 'S/I movimientos'
                          : movementMeta.count === 0
                            ? '0 movimientos'
                            : `${movementMeta.count} movimientos`;
                      return (
                        <button
                          key={item.label}
                          className={`rounded-lg px-2 py-2 text-left relative ${
                            existing
                              ? 'border border-slate-700 bg-slate-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
                              : 'border border-slate-200 bg-slate-50 hover:bg-slate-100'
                          }`}
                          onClick={() => {
                            setMovementsModal({ bank: group.bank, currency: item.currency });
                          }}
                        >
                          <span
                            className="absolute right-2 top-2 text-slate-400 hover:text-blue-600"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setQuickFill({
                                id: existing?.id,
                                block: 'bank',
                                source: 'Manual bancos',
                                label: item.label,
                                amount: existing ? String(existing.amount) : '',
                                currency: existing?.currency || item.currency,
                                snapshotDate: existing?.snapshotDate || visualSnapshotDate,
                              });
                              setOpenLoadPanel(true);
                            }}
                          >
                            <Pencil size={14} />
                          </span>
                          {existing && (
                            <span
                              className={`absolute right-8 top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                                isApiSource(existing.source)
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                              title={isApiSource(existing.source) ? 'Valor API/automático' : 'Valor manual'}
                            >
                              {isApiSource(existing.source) ? 'A' : 'M'}
                            </span>
                          )}
                          <div className="text-xs font-medium text-slate-700">{item.currency}</div>
                          <div className="text-sm font-semibold text-slate-900 mt-1">
                            {existing ? formatCurrency(existing.amount, existing.currency) : 'Pendiente'}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">{movementLabel}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details open className="rounded-lg border border-rose-200 bg-rose-50/40 p-2">
            <summary className="cursor-pointer text-sm font-medium text-rose-700">Tarjetas (cupo utilizado manualmente)</summary>
            <div className="mt-2 space-y-2">
              {MANUAL_CARD_GROUPS.map((group) => (
                <div key={group.bank} className={`rounded-lg border p-2 ${group.className}`}>
                  <div className="text-xs font-semibold text-slate-700 mb-2">{group.bank}</div>
                  <div className="grid md:grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const existing = dedupedSectionRecords.find((r) => r.label === item.label);
                      return (
                        <button
                          key={item.label}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-left hover:bg-slate-50"
                          onClick={() => {
                            setQuickFill({
                              id: existing?.id,
                              block: 'debt',
                              source: existing?.source || 'Manual tarjetas',
                              label: item.label,
                              amount: existing ? String(existing.amount) : '',
                              currency: existing?.currency || item.currency,
                              snapshotDate: existing?.snapshotDate || visualSnapshotDate,
                            });
                            setOpenLoadPanel(true);
                          }}
                        >
                          <div className="text-xs font-medium text-slate-700">{item.label}</div>
                          <div className="text-sm font-semibold text-rose-700 mt-1">
                            {existing ? `-${formatCurrency(existing.amount, existing.currency)}` : 'Pendiente'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>

          <div className="text-[11px] text-slate-500">
            Los movimientos se consultan por banco al tocar cada saldo (CLP o USD).
          </div>
        </Card>
      )}

      {section === 'bank' && movementsModal && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40" onClick={() => setMovementsModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
              <Card className="p-4 max-h-[82vh] overflow-y-auto shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Movimientos {movementsModal.currency}</div>
                    <div className="text-xs text-slate-500">{movementsModal.bank}</div>
                  </div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => setMovementsModal(null)}
                    aria-label="Cerrar movimientos"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-3 space-y-1 max-h-[62vh] overflow-y-auto pr-1">
                  {!modalMovements.length && (
                    <div className="text-xs text-slate-500">
                      Sin movimientos detectados para este banco en {movementsModal.currency}.
                    </div>
                  )}
                  {modalMovements.map((mv, idx) => (
                    <div
                      key={`${mv.bank}-${mv.account}-${idx}`}
                      className="grid grid-cols-[90px_1fr_130px] gap-2 text-xs border-b border-slate-100 py-1"
                    >
                      <div className="text-slate-500">{mv.date || '-'}</div>
                      <div>
                        <div className="font-medium text-slate-700">{mv.account}</div>
                        <div className="text-slate-500">{mv.description}</div>
                      </div>
                      <div className={`text-right font-semibold ${mv.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {mv.amount >= 0 ? '+' : ''}
                        {formatCurrency(mv.amount, mv.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      <ConfirmActionModal
        open={!!pendingInvestmentDelete}
        title="Eliminar instrumento del mes"
        message={
          pendingInvestmentDelete
            ? `Vas a borrar "${pendingInvestmentDelete.title}" de ${monthLabel(monthKey).toLowerCase()}. Esta acción no afecta cierres anteriores.`
            : ''
        }
        tone="danger"
        confirmText="Borrar"
        cancelText="Cancelar"
        onConfirm={confirmDeleteInvestmentTargets}
        onCancel={() => setPendingInvestmentDelete(null)}
      />

      {section === 'investment' && (
        <Card className="p-2.5 space-y-2 border-[#d9d8d1]">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {investmentSubtotalCards.map((card) => {
              const delta = card.compare === null ? null : card.current - card.compare;
              const pct = card.compare && card.compare !== 0 ? (delta! / card.compare) * 100 : null;
              return (
                <div key={card.key} className={`rounded-lg border px-2.5 py-2 ${card.className}`}>
                  <div className={`text-[11px] font-semibold ${card.titleClassName}`}>
                    {card.label}
                    {card.key === 'otros' && includeRiskCapitalInTotals && sectionHasRiskCapital && (
                      <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        +CapRiesgo
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">Subtotal</div>
                  <div className="mt-0.5 text-base font-bold text-slate-900">{formatCurrency(card.current, 'CLP')}</div>
                  {delta !== null && (
                    <div className={`mt-1 text-[10px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {delta >= 0 ? '+' : ''}
                      {formatCurrency(delta, 'CLP')}
                      {pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            {investmentAnalyticsRows.map((row) => {
              const current = row.currentClp;
              const compare = row.compareClp;
              const delta = compare === null ? null : current - compare;
              const pct = compare && compare !== 0 ? (delta! / compare) * 100 : null;
              const riskExcluded = row.isRiskCapital && !includeRiskCapitalInTotals;
              const rowStyle =
                row.isRiskCapital && riskExcluded
                  ? 'border-slate-300 bg-slate-100/80'
                  : row.isRiskCapital
                    ? 'border-[#e8dfcf] bg-[#fcfaf5] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(15,63,58,0.08)]'
                  : row.group === 'previsionales'
                    ? 'border-emerald-200 bg-emerald-50/30'
                    : row.group === 'financieras'
                      ? 'border-[#d8c39d] bg-[#f8efe2]'
                      : 'border-[#e8dfcf] bg-[#fcfaf5] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(15,63,58,0.08)]';
              const rowLeft =
                row.isRiskCapital && riskExcluded
                  ? 'border-l-4 border-l-slate-400'
                  : row.isRiskCapital
                    ? 'border-l-4 border-l-[#e5dccb]'
                  : row.group === 'previsionales'
                    ? 'border-l-4 border-l-emerald-300'
                    : row.group === 'financieras'
                      ? 'border-l-4 border-l-[#caa16d]'
                      : 'border-l-4 border-l-[#e5dccb]';
              return (
                <div
                  key={row.key}
                  className={`rounded-lg border px-2.5 py-1.5 ${rowStyle} ${rowLeft} ${
                    riskExcluded ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[12px] text-slate-700">{row.label}</span>
                      {riskExcluded && (
                        <div className="text-[10px] text-slate-500">Excluido del total</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-900">{formatCurrency(current, 'CLP')}</div>
                      {delta !== null && (
                        <div className={`text-[10px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {delta >= 0 ? '+' : ''}
                          {formatCurrency(delta, 'CLP')}
                          {pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!investmentAnalyticsRows.length && (
              <div className="text-[11px] text-slate-500">Sin detalle de inversiones aún para este mes.</div>
            )}
          </div>
        </Card>
      )}

      {section !== 'bank' && section !== 'investment' && (
        <Card className="p-4 space-y-2 border border-slate-200 shadow-sm bg-white">
          <div className="text-sm font-semibold text-slate-900">Cómo se compone</div>
          {dedupedSectionRecords.length === 0 && <div className="text-xs text-slate-500">Sin datos para este mes.</div>}
          {dedupedSectionRecords.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-2 py-1">
              <div>
                <div className="font-medium text-slate-800">{item.label}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`font-semibold ${item.block === 'debt' ? 'text-red-700' : ''}`}
                  onClick={() => openRecordEditor(item)}
                >
                  {item.block === 'debt' ? '-' : ''}
                  {formatCurrency(item.amount, item.currency)}
                </button>
                <button className="text-slate-400 hover:text-blue-600" onClick={() => openRecordEditor(item)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    removeWealthRecordForMonthAsset({
                      block: item.block,
                      label: item.label,
                      currency: item.currency,
                      monthKey,
                    });
                    onDataChanged();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {!!missingRowsForCompose.length && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-2 py-2 text-xs text-amber-800">
              <div className="font-medium">Falta cargar</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {missingRowsForCompose.map((name) => (
                  <span key={name} className="rounded-full border border-amber-200 bg-white/70 px-2 py-0.5 text-[11px]">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {section === 'investment' ? (
        <Card className="border border-slate-200 bg-slate-50/80 p-0">
          <button
            type="button"
            onClick={() => setOperationsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-slate-800">Gestionar instrumentos</div>
              <div className="text-[11px] text-slate-600">
                Completadas {checklistSummary.completed} de {checklistSummary.total}
                {checklistSummary.pending ? ` · Pendientes ${checklistSummary.pending}` : ''}
              </div>
            </div>
            <ChevronDown
              size={16}
              className={cn('text-slate-500 transition-transform', operationsOpen && 'rotate-180')}
            />
          </button>
          {operationsOpen && (
            <div className="space-y-2 border-t border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
                  Completar pendientes con mes anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewInvestmentDraft({ label: '', currency: 'CLP', amount: '', note: '' });
                    setOpenCreateInvestmentModal(true);
                  }}
                >
                  + Agregar instrumento
                </Button>
              </div>
              {!!carryMessage && <div className="text-xs text-blue-700">{carryMessage}</div>}
              {investmentOperationalRows.map((row) => {
                const deleteTargets = row.sourceContext.labels.reduce<Array<{ label: string; currency: WealthCurrency }>>(
                  (acc, item) => {
                    const key = `${labelMatchKey(item.label)}::${item.currency}`;
                    if (acc.some((existing) => `${labelMatchKey(existing.label)}::${existing.currency}` === key)) {
                      return acc;
                    }
                    acc.push({ label: item.label, currency: item.currency });
                    return acc;
                  },
                  [],
                );
                return (
                  <div
                    key={row.key}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      row.updatedThisMonth ? 'border-emerald-300 bg-emerald-50/70' : 'border-slate-200 bg-white',
                    )}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-500">{row.amountText}</div>
                        <div className="text-[11px] text-slate-500">
                          {row.status === 'actualizado' && `✅ Actualizado · ${row.detail}`}
                          {row.status === 'mes_anterior' && `🔄 Arrastre · ${row.detail}`}
                          {row.status === 'estimado' && `🔄 Estimado · ${row.detail}`}
                          {row.status === 'pendiente' && 'Pendiente de carga'}
                          {row.status === 'excluido' && 'No considerado este mes'}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => triggerInvestmentPhotoLoad(row.sourceContext)}
                        >
                          📷 Subir imagen
                        </Button>
                        <div className="grid grid-cols-3 gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="col-span-2"
                            onClick={() => openQuickFillForContext(row.sourceContext)}
                          >
                            ✏️ Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="col-span-1 border-slate-300 text-slate-500 hover:border-slate-400 hover:bg-slate-100"
                            disabled={!row.hasValue}
                            onClick={() =>
                              setPendingInvestmentDelete({
                                title: row.name,
                                targets: deleteTargets,
                              })
                            }
                          >
                            🗑 Borrar
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {row.updatedThisMonth ? 'Actualizado este mes' : 'Pendiente de confirmar este mes'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-4 space-y-2 border border-slate-200 bg-slate-50/80">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">Checklist del bloque</div>
            {checklistSummary.pending === 0 && checklistSummary.notUpdated === 0 && (
              <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
                <CheckCircle2 size={12} />
                Todo cargado
              </div>
            )}
            {checklistSummary.pending === 0 && checklistSummary.notUpdated > 0 && (
              <div className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                <CheckCircle2 size={12} />
                Completo con arrastres
              </div>
            )}
          </div>
          <div className="text-[11px] text-slate-600">
            Completadas {checklistSummary.completed} de {checklistSummary.total}
            {checklistSummary.pending ? ` · Pendientes ${checklistSummary.pending}` : ''}
            {checklistSummary.optionalPending ? ` · Opcionales ${checklistSummary.optionalPending}` : ''}
            {checklistSummary.notUpdated ? ` · No actualizadas ${checklistSummary.notUpdated}` : ''}
            {checklistSummary.updated ? ` · Actualizadas ${checklistSummary.updated}` : ''}
            {checklistSummary.excluded ? ` · No consideradas ${checklistSummary.excluded}` : ''}
          </div>
          {section === 'bank' ? (
            <div className="space-y-2">
              <div className="grid md:grid-cols-3 gap-2">
                {BANK_PROVIDERS.map((bank) => (
                  <div key={bank.id} className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                    <div className="text-xs font-semibold text-slate-700">{bank.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {bankTokens[bank.id]
                        ? 'Token: guardado'
                        : bankApiPresenceByProvider[bank.id]
                          ? 'Token: no guardado en este dispositivo (hay datos API)'
                          : 'Token: pendiente'}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => ensureBankToken(bank.id, true)}>
                        Cambiar token
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => runUpdateAllBanks()} disabled={updatingAllBanks || fintocDiscovering}>
                  {updatingAllBanks || fintocDiscovering ? 'Actualizando...' : 'Actualizar bancos'}
                </Button>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
                Completar pendientes con mes anterior
              </Button>
            </div>
          ) : (
            <div className="flex items-center flex-wrap gap-2">
              {section === 'real_estate' && (
                <Button variant="outline" size="sm" onClick={onApplyMortgageAuto}>
                  Autocálculo hipotecario
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => onUseMissing(section)}>
                Completar pendientes con mes anterior
              </Button>
            </div>
          )}
          {!!carryMessage && <div className="text-xs text-blue-700">{carryMessage}</div>}
          {!!fintocStatus && (
            <div className={`text-xs ${fintocStatus.startsWith('Error') ? 'text-red-700' : 'text-emerald-700'}`}>
              {fintocStatus}
            </div>
          )}
          {section === 'bank' && !!fintocDiscovery && (
            <div className="text-[11px] text-slate-500">
              Diagnóstico API disponible (modo técnico oculto en esta vista).
            </div>
          )}
          {sortedChecklistRows.map((row) => (
            <div
              key={row.instrumentId ? `custom-${row.instrumentId}` : row.name}
              className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-100/60"
              onClick={() => openChecklistItem(row)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-left flex-1">
                  <div>{row.name}</div>
                  <div className="text-[11px] text-slate-500">{row.detail}</div>
                </div>
                {row.status === 'pendiente' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUseMissing(section, row.name);
                    }}
                  >
                    Usar mes anterior
                  </Button>
                )}
                {row.status === 'pendiente' && <span className="text-red-700">Pendiente</span>}
                {row.status === 'mes_anterior' && <span className="text-amber-700">Arrastre de mes anterior</span>}
                {row.status === 'estimado' && <span className="text-amber-700">Estimado del sistema</span>}
                {row.status === 'actualizado' && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 size={12} />
                    Actualizado
                  </span>
                )}
                {row.status === 'excluido' && <span className="text-slate-500">No considerado</span>}
              </div>
            </div>
          ))}
        </Card>
      )}

      {openSourceMenu && activeSourceContext && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={() => {
              setOpenSourceMenu(false);
              setActiveSourceContext(null);
            }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
              <Card className="p-4 space-y-3 shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{activeSourceContext.title}</div>
                    <div className="text-xs text-slate-500">Selecciona cómo quieres actualizar esta fuente.</div>
                  </div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => {
                      setOpenSourceMenu(false);
                      setActiveSourceContext(null);
                    }}
                    aria-label="Cerrar"
                  >
                    <X size={14} />
                  </button>
                </div>
                <Button
                  onClick={() => {
                    setSourceHint(activeSourceContext.sourceHint);
                    setQuickFill(null);
                    setMultiQuickFill(null);
                    setSuggestions([]);
                    setOcrError('');
                    setOcrText('');
                    setPendingSuraOcrDecision(null);
                    setOpenSourceMenu(false);
                    requestAnimationFrame(() => openImagePicker());
                  }}
                >
                  Subir imagen
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenSourceMenu(false);
                    openQuickFillForContext(activeSourceContext);
                  }}
                >
                  Ingresar monto
                </Button>
                {activeSourceContext.isCustom &&
                  activeSourceContext.instrumentId &&
                  !activeSourceContext.labels.some((item) => isNonExcludableInvestmentLabel(item.label)) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const row = checklistRows.find((item) => item.instrumentId === activeSourceContext.instrumentId);
                      onSetInvestmentExcluded(activeSourceContext.instrumentId as string, row?.status !== 'excluido');
                      setOpenSourceMenu(false);
                      setActiveSourceContext(null);
                    }}
                  >
                    {(() => {
                      const row = checklistRows.find((item) => item.instrumentId === activeSourceContext.instrumentId);
                      return row?.status === 'excluido' ? 'Incluir este mes' : 'Excluir este mes';
                    })()}
                  </Button>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {openCreateInvestmentModal && section === 'investment' && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={() => setOpenCreateInvestmentModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
              <Card className="p-4 space-y-3 shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Agregar inversión</div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={() => setOpenCreateInvestmentModal(false)}
                    aria-label="Cerrar"
                  >
                    <X size={14} />
                  </button>
                </div>
                <Input
                  placeholder="Nombre del instrumento"
                  value={newInvestmentDraft.label}
                  onChange={(event) => setNewInvestmentDraft((prev) => ({ ...prev, label: event.target.value }))}
                />
                <Select
                  options={currencyOptions.filter((item) => item.value !== 'UF')}
                  value={newInvestmentDraft.currency}
                  onChange={(event) =>
                    setNewInvestmentDraft((prev) => ({ ...prev, currency: event.target.value as WealthCurrency }))
                  }
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Monto inicial (opcional)"
                  value={newInvestmentDraft.amount}
                  onChange={(event) => setNewInvestmentDraft((prev) => ({ ...prev, amount: event.target.value }))}
                />
                <Input
                  placeholder="Nota (opcional)"
                  value={newInvestmentDraft.note}
                  onChange={(event) => setNewInvestmentDraft((prev) => ({ ...prev, note: event.target.value }))}
                />
                <Button
                  disabled={!newInvestmentDraft.label.trim()}
                  onClick={() => {
                    const amountNum = Number(String(newInvestmentDraft.amount || '').replace(/,/g, '.'));
                    onCreateInvestmentInstrument({
                      label: newInvestmentDraft.label,
                      currency: newInvestmentDraft.currency,
                      amount:
                        Number.isFinite(amountNum) && amountNum > 0
                          ? amountNum
                          : undefined,
                      note: newInvestmentDraft.note.trim() || undefined,
                    });
                    setOpenCreateInvestmentModal(false);
                  }}
                >
                  Crear instrumento
                </Button>
              </Card>
            </div>
          </div>
        </>
      )}

      {openLoadPanel && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40"
            onClick={closeLoadPanel}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
            <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
              <Card className="p-4 space-y-3 max-h-[84vh] overflow-y-auto shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {activeSourceContext ? `Cargar ${activeSourceContext.title}` : 'Cargar información'}
                  </div>
                  <button
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center"
                    onClick={closeLoadPanel}
                  >
                    <X size={14} />
                  </button>
                </div>

                {quickFill ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Ingresar valor</div>
                    <div className="text-xs text-slate-600">{quickFill.label}</div>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Monto"
                      value={quickFill.amount}
                      onChange={(e) => setQuickFill({ ...quickFill, amount: e.target.value })}
                    />
                    <div className="text-[11px] text-slate-500">Moneda: {quickFill.currency}</div>
                    <Input
                      placeholder="Nota (opcional)"
                      value={quickFill.note || ''}
                      onChange={(e) => setQuickFill({ ...quickFill, note: e.target.value })}
                    />
                    <Button onClick={saveQuickFill}>Guardar</Button>
                  </div>
                ) : multiQuickFill ? (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Ingresar valores</div>
                    <div className="text-xs text-slate-600">{multiQuickFill.source}</div>
                    <div className="space-y-2">
                      {multiQuickFill.entries.map((entry, idx) => (
                        <div key={`${entry.label}-${idx}`} className="rounded-lg border border-slate-200 p-2 space-y-2">
                          <div className="text-xs font-medium text-slate-700">{entry.label}</div>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Monto"
                            value={entry.amount}
                            onChange={(e) => {
                              const next = [...multiQuickFill.entries];
                              next[idx] = { ...next[idx], amount: e.target.value };
                              setMultiQuickFill({ ...multiQuickFill, entries: next });
                            }}
                          />
                          <div className="text-[11px] text-slate-500">Moneda: {entry.currency}</div>
                        </div>
                      ))}
                    </div>
                    <Button onClick={saveMultiQuickFill}>Guardar</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <FileScan size={16} /> Carga OCR
                    </div>

                    <button
                      className="h-10 rounded-xl border border-slate-200 px-3 flex items-center justify-center gap-2 text-sm cursor-pointer hover:bg-slate-50"
                      onClick={() => openImagePicker()}
                    >
                      <Camera size={16} /> Seleccionar imagen
                    </button>

                    {activeSourceContext ? (
                      <div className="text-[11px] text-slate-500">Fuente fija: {activeSourceContext.title}</div>
                    ) : (
                      <details>
                        <summary className="text-xs text-slate-500 cursor-pointer">Opciones avanzadas</summary>
                        <div className="mt-2 space-y-2">
                          <Select
                            options={sourceOptionsBySection[section]}
                            value={sourceHint}
                            onChange={(e) => setSourceHint(e.target.value)}
                          />
                        </div>
                      </details>
                    )}

                    {ocrProgress && <div className="text-xs text-slate-500">Leyendo: {ocrProgress.pct}%</div>}
                    {ocrError && <div className="text-xs text-red-600">{ocrError}</div>}
                    {!!suggestions.length && (
                      <div className="space-y-2">
                    {suggestions.map((item, idx) => (
                      <div key={`${item.label}-${idx}`} className="rounded-xl border border-slate-200 p-2 space-y-2">
                        <Input
                          value={item.label}
                          onChange={(e) => {
                            const next = [...suggestions];
                            next[idx].label = e.target.value;
                            setSuggestions(next);
                          }}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          {section === 'real_estate' ? (
                            <Select
                              options={realEstateBlockOptions}
                              value={item.block}
                              onChange={(e) => {
                                const next = [...suggestions];
                                next[idx].block = e.target.value as WealthBlock;
                                setSuggestions(next);
                              }}
                            />
                          ) : (
                            <Input disabled value={sectionLabel[section]} />
                          )}
                          <Select
                            options={currencyOptions}
                            value={item.currency}
                            onChange={(e) => {
                              const next = [...suggestions];
                              next[idx].currency = e.target.value as WealthCurrency;
                              setSuggestions(next);
                            }}
                          />
                        </div>
                        <Input
                          type="number"
                          value={item.amount}
                          onChange={(e) => {
                            const next = [...suggestions];
                            next[idx].amount = Number(e.target.value) || 0;
                            setSuggestions(next);
                          }}
                        />
                        <div className="text-[11px] text-slate-500">
                          {formatCurrency(item.amount, item.currency)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => saveSuggestion(item, idx)}>
                            Guardar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSuggestions((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={saveAllSuggestions}>
                        Guardar todo
                      </Button>
                      <Button variant="outline" onClick={() => setSuggestions([])}>
                        Limpiar lista
                      </Button>
                    </div>
                      </div>
                    )}

                    {section !== 'investment' && (
                      <details>
                        <summary className="text-sm font-medium cursor-pointer">Carga manual (secundario)</summary>
                        <div className="mt-2 space-y-2">
                          {editingId && <div className="text-xs text-blue-700">Editando registro</div>}
                          <Input
                            placeholder="Nombre del activo"
                            value={draft.label}
                            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            {section === 'real_estate' ? (
                              <Select
                                options={realEstateBlockOptions}
                                value={draft.block}
                                onChange={(e) => setDraft({ ...draft, block: e.target.value as WealthBlock })}
                              />
                            ) : (
                              <Input disabled value={sectionLabel[section]} />
                            )}
                            <Select
                              options={currencyOptions}
                              value={draft.currency}
                              onChange={(e) => setDraft({ ...draft, currency: e.target.value as WealthCurrency })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              placeholder="Monto"
                              value={draft.amount}
                              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                            />
                            <Input
                              type="date"
                              value={draft.snapshotDate}
                              onChange={(e) => setDraft({ ...draft, snapshotDate: e.target.value })}
                            />
                          </div>
                          <Input
                            placeholder="Fuente"
                            value={draft.source}
                            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                          />
                          <Button onClick={saveDraft}>Guardar registro</Button>
                        </div>
                      </details>
                    )}

                    {!!ocrText && (
                      <details className="text-xs text-slate-500">
                        <summary className="cursor-pointer">Texto OCR (opcional)</summary>
                        <pre className="whitespace-pre-wrap break-words mt-2 max-h-56 overflow-auto bg-slate-50 p-2 rounded-lg">
                          {ocrText}
                        </pre>
                      </details>
                    )}
                  </>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {pendingSuraOcrDecision && (() => {
        const fin = pendingSuraOcrDecision.parsed.find((item) =>
          sameCanonicalLabel(item.label, INVESTMENT_SURA_FIN_LABEL),
        );
        const prev = pendingSuraOcrDecision.parsed.find((item) =>
          sameCanonicalLabel(item.label, INVESTMENT_SURA_PREV_LABEL),
        );
        const onlyPrimary =
          pendingSuraOcrDecision.parsed.find((item) =>
            sameCanonicalLabel(item.label, pendingSuraOcrDecision.primaryLabel),
          ) || pendingSuraOcrDecision.parsed[0];
        return (
          <>
            <div
              className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px] z-[60]"
              onClick={() => setPendingSuraOcrDecision(null)}
            />
            <div className="fixed inset-0 z-[61] flex items-center justify-center p-3">
              <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
                <Card className="space-y-3 p-4 shadow-[0_20px_40px_rgba(15,23,42,0.35)]">
                  <div className="text-sm font-semibold text-slate-900">Detecté datos para SURA</div>
                  <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                    <div>
                      Financiero:{' '}
                      <span className="font-semibold">
                        {fin ? formatCurrency(fin.amount, fin.currency) : 'No detectado'}
                      </span>
                    </div>
                    <div>
                      Previsional:{' '}
                      <span className="font-semibold">
                        {prev ? formatCurrency(prev.amount, prev.currency) : 'No detectado'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => {
                        appendSuggestions(pendingSuraOcrDecision.parsed);
                        setPendingSuraOcrDecision(null);
                      }}
                    >
                      Guardar ambos
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        if (onlyPrimary) appendSuggestions([onlyPrimary]);
                        setPendingSuraOcrDecision(null);
                      }}
                    >
                      Solo este
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          </>
        );
      })()}

    </div>
  );
};

export const Patrimonio: React.FC = () => {
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => loadClosures());
  const [investmentInstruments, setInvestmentInstruments] = useState<WealthInvestmentInstrument[]>(() =>
    loadInvestmentInstruments(),
  );
  const [fx, setFx] = useState(() => loadFxRates());
  const [hydrationReady, setHydrationReady] = useState(false);

  const [monthKey, setMonthKey] = useState(() =>
    deriveOperationalMonthKeyFromClosures(loadClosures(), currentMonthKey()),
  );
  const [activeSection, setActiveSection] = useState<MainSection | null>(null);
  const [carryMessage, setCarryMessage] = useState('');
  const [closeError, setCloseError] = useState('');
  const [closeInfo, setCloseInfo] = useState('');
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeMonthDraft, setCloseMonthDraft] = useState(() =>
    deriveOperationalMonthKeyFromClosures(loadClosures(), currentMonthKey()),
  );
  const [closeFxDraft, setCloseFxDraft] = useState(() => buildCloseFxDraft(loadFxRates()));
  const [closeConfigSnapshot, setCloseConfigSnapshot] = useState<ClosingConfigState>(() => readClosingConfig());
  const [startMonthRunning, setStartMonthRunning] = useState(false);
  const [startMonthFlowError, setStartMonthFlowError] = useState('');
  const [carryConfirmOpen, setCarryConfirmOpen] = useState(false);
  const [startMonthActionStatus, setStartMonthActionStatus] = useState<StartMonthActionStatus>(
    START_MONTH_ACTION_STATUS_INITIAL,
  );

  const [hideSensitiveAmountsEnabled, setHideSensitiveAmountsEnabled] = useState(() =>
    readHideSensitiveAmountsEnabled(),
  );
  const [showNetWorth, setShowNetWorth] = useState(() => !readHideSensitiveAmountsEnabled());
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [displayCurrency, setDisplayCurrency] = useState<WealthCurrency>(() => readPreferredDisplayCurrency());

  useEffect(() => {
    if (!closeConfirmOpen) setCloseMonthDraft(monthKey);
  }, [monthKey, closeConfirmOpen]);

  useEffect(() => {
    if (!closeConfirmOpen) return;
    setCloseConfigSnapshot(readClosingConfig());
  }, [closeConfirmOpen]);

  useEffect(() => {
    if (!closeConfirmOpen) return;
    const closureForDraft = closures.find((closure) => closure.monthKey === closeMonthDraft) || null;
    const sourceFx = closureForDraft?.fxRates || fx;
    setCloseFxDraft(buildCloseFxDraft(sourceFx));
  }, [closeConfirmOpen, closeMonthDraft, closures, fx]);

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_DISPLAY_CURRENCY_KEY, displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    saveIncludeRiskCapitalInTotals(includeRiskCapitalInTotals);
  }, [includeRiskCapitalInTotals]);

  useEffect(() => {
    const refreshPreference = () => {
      setHideSensitiveAmountsEnabled(readHideSensitiveAmountsEnabled());
    };
    window.addEventListener('storage', refreshPreference);
    window.addEventListener(HIDE_SENSITIVE_AMOUNTS_UPDATED_EVENT, refreshPreference as EventListener);
    return () => {
      window.removeEventListener('storage', refreshPreference);
      window.removeEventListener(HIDE_SENSITIVE_AMOUNTS_UPDATED_EVENT, refreshPreference as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!hideSensitiveAmountsEnabled) {
      setShowNetWorth(true);
    }
  }, [hideSensitiveAmountsEnabled]);

  useEffect(() => {
    setCarryMessage('');
  }, [activeSection]);

  useEffect(() => {
    let runningRefresh = false;
    const refreshFromCloudNow = async () => {
      if (runningRefresh) return;
      runningRefresh = true;
      try {
        await hydrateWealthFromCloud();
        setRecords(loadWealthRecords());
        setClosures(loadClosures());
        setInvestmentInstruments(loadInvestmentInstruments());
        setFx(loadFxRates());
      } finally {
        runningRefresh = false;
      }
    };

    const goPatrimonioHome = () => {
      setActiveSection(null);
      setCarryMessage('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      void refreshFromCloudNow();
    };

    window.addEventListener(NAVIGATE_PATRIMONIO_HOME_EVENT, goPatrimonioHome as EventListener);
    return () => {
      window.removeEventListener(NAVIGATE_PATRIMONIO_HOME_EVENT, goPatrimonioHome as EventListener);
    };
  }, []);

  useEffect(() => {
    const refreshFromLocal = () => {
      setRecords(loadWealthRecords());
      setClosures(loadClosures());
      setInvestmentInstruments(loadInvestmentInstruments());
      setFx(loadFxRates());
    };
    const onStorage = () => refreshFromLocal();
    const onWealthUpdated = () => {
      refreshFromLocal();
    };
    const refreshFx = () => setFx(loadFxRates());
    const refreshRiskToggle = () => setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());

    window.addEventListener('storage', onStorage);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener(RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT, refreshRiskToggle as EventListener);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshFx as EventListener);
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        refreshRiskToggle as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await hydrateWealthFromCloud();
      if (!alive) return;
      setRecords(loadWealthRecords());
      setClosures(loadClosures());
      setInvestmentInstruments(loadInvestmentInstruments());
      setFx(loadFxRates());
      setHydrationReady(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrationReady) return;
    const existing = new Set(investmentInstruments.map((item) => normalizeForMatch(item.label)));
    const missingDefaults = DEFAULT_BASE_INVESTMENT_INSTRUMENTS.filter(
      (item) => !existing.has(normalizeForMatch(item.label)),
    );
    if (!missingDefaults.length) return;
    missingDefaults.forEach((item) => {
      upsertInvestmentInstrument({
        label: item.label,
        currency: item.currency,
        note: isRiskCapitalInvestmentLabel(item.label) ? 'Opcional: capital de riesgo' : undefined,
      });
    });
    setInvestmentInstruments(loadInvestmentInstruments());
  }, [hydrationReady, investmentInstruments]);

  const monthRecords = useMemo(() => latestRecordsForMonth(records, monthKey), [records, monthKey]);
  const monthRiskResolution = useMemo(
    () => resolveRiskCapitalRecordsForTotals(monthRecords, includeRiskCapitalInTotals),
    [monthRecords, includeRiskCapitalInTotals],
  );
  // [PRODUCT RULE] Si el filtro de riesgo deja vacío, usamos base sin filtrar para evitar total 0 artificial.
  const monthRecordsForTotals = monthRiskResolution.recordsForTotals;
  const closureNetByMonth = useMemo(() => {
    const map = new Map<string, number>();
    closures.forEach((closure) => {
      map.set(closure.monthKey, closureNetForTotals(closure, includeRiskCapitalInTotals, fx));
    });
    return map;
  }, [closures, includeRiskCapitalInTotals, fx]);

  const sectionAmounts = useMemo(
    () => computeWealthHomeSectionAmounts(monthRecordsForTotals, fx),
    [monthRecordsForTotals, fx],
  );
  const calendarMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const realCurrentMonthKey = useMemo(
    () => deriveOperationalMonthKeyFromClosures(closures, calendarMonthKey),
    [closures, calendarMonthKey],
  );
  const selectableLoadMonthKeys = useMemo(() => {
    const nextCalendarMonth = monthAfterKey(calendarMonthKey);
    const unique = new Set<string>([realCurrentMonthKey, calendarMonthKey]);
    if (nextCalendarMonth) unique.add(nextCalendarMonth);
    return Array.from(unique).sort();
  }, [calendarMonthKey, realCurrentMonthKey]);
  const isFirstUseOnboarding = records.length === 0 && closures.length === 0;

  useEffect(() => {
    setStartMonthActionStatus(START_MONTH_ACTION_STATUS_INITIAL);
  }, [realCurrentMonthKey]);

  useEffect(() => {
    if (monthKey !== realCurrentMonthKey) return;
    if (monthRecords.length > 0) return;
    setStartMonthActionStatus(START_MONTH_ACTION_STATUS_INITIAL);
  }, [monthKey, realCurrentMonthKey, monthRecords.length]);

  const closureSummaryNetForMode = (closure: WealthMonthlyClosure) => {
    const hasRiskRecord = Array.isArray(closure.records)
      ? closure.records.some(
          (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
        )
      : false;
    const hasRecords = Array.isArray(closure.records) && closure.records.length > 0;
    const summaryNet = Number(closure.summary.netClp);
    const summaryNetWithRisk = Number(closure.summary.netClpWithRisk);

    if (includeRiskCapitalInTotals) {
      if (Number.isFinite(summaryNetWithRisk) && (!hasRiskRecord || summaryNetWithRisk !== summaryNet)) {
        return summaryNetWithRisk;
      }
      if (hasRecords) return closureNetForTotals(closure, true, fx);
      if (Number.isFinite(summaryNetWithRisk)) return summaryNetWithRisk;
    } else {
      if (Number.isFinite(summaryNet)) return summaryNet;
      if (hasRecords) return closureNetForTotals(closure, false, fx);
    }
    return closure.summary.netConsolidatedClp;
  };

  const metrics = useMemo(() => {
    const closedPoints = closures
      .filter((closure) => closure.monthKey !== realCurrentMonthKey)
      .map((closure) => ({
        key: closure.monthKey,
        net: closureSummaryNetForMode(closure),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const monthClosedPoint = closedPoints.find((point) => point.key === monthKey) || null;
    const previousClosedPoint = closedPoints.filter((point) => point.key < monthKey).slice(-1)[0] || null;
    const monthNetForComparison = monthClosedPoint
      ? monthClosedPoint.net
      : monthRecordsForTotals.length > 0
        ? sectionAmounts.totalNetClp
        : null;
    const monthIncrease =
      monthNetForComparison !== null && previousClosedPoint
        ? monthNetForComparison - previousClosedPoint.net
        : null;
    const monthIncreasePct =
      monthIncrease !== null && previousClosedPoint && previousClosedPoint.net !== 0
        ? (monthIncrease / previousClosedPoint.net) * 100
        : null;
    const closedDeltas: number[] = [];
    for (let i = 1; i < closedPoints.length; i += 1) {
      closedDeltas.push(closedPoints[i].net - closedPoints[i - 1].net);
    }
    const hasEnoughClosedPointsForAverage = closedPoints.length >= 2;

    return {
      monthIncrease,
      monthIncreasePct,
      avg12: hasEnoughClosedPointsForAverage ? average(closedDeltas.slice(-12)) : null,
      avgSinceStart: hasEnoughClosedPointsForAverage ? average(closedDeltas) : null,
    };
  }, [
    closures,
    includeRiskCapitalInTotals,
    realCurrentMonthKey,
    monthKey,
    monthRecordsForTotals.length,
    sectionAmounts.totalNetClp,
  ]);

  const latestClosure = closures[0] || null;

  const growthVsPrevClosure = useMemo(() => {
    if (closures.length < 2) return null;
    const currentClosure = closures[0];
    const previousClosure = closures[1];
    const current = closureSummaryNetForMode(currentClosure);
    const prev = closureSummaryNetForMode(previousClosure);
    const abs = current - prev;
    const pct = prev !== 0 ? (abs / prev) * 100 : null;
    return { abs, pct };
  }, [closures, includeRiskCapitalInTotals, closureNetByMonth]);

  useEffect(() => {
    const closedPoints = closures
      .filter((closure) => closure.monthKey !== realCurrentMonthKey)
      .map((closure) => ({
        key: closure.monthKey,
        net: closureSummaryNetForMode(closure),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const previousClosedPoint = closedPoints.filter((point) => point.key < monthKey).slice(-1)[0] || null;
    const currentNet = monthRecordsForTotals.length > 0 ? sectionAmounts.totalNetClp : null;
    console.debug('[Patrimonio] Variación mensual', {
      includeRiskCapitalInTotals,
      monthKey,
      previousClosedMonth: previousClosedPoint?.key || null,
      currentNet,
      previousNet: previousClosedPoint?.net ?? null,
      monthIncrease:
        currentNet !== null && previousClosedPoint
          ? currentNet - previousClosedPoint.net
          : null,
    });
  }, [
    closures,
    includeRiskCapitalInTotals,
    realCurrentMonthKey,
    monthKey,
    monthRecordsForTotals.length,
    sectionAmounts.totalNetClp,
  ]);
  const selectedClosureForDraft = useMemo(
    () => closures.find((closure) => closure.monthKey === closeMonthDraft) || null,
    [closures, closeMonthDraft],
  );
  const recentCloseWarning = useMemo(() => {
    if (!latestClosure) return null;
    const latestTs = new Date(latestClosure.closedAt).getTime();
    if (!Number.isFinite(latestTs)) return null;
    const days = (Date.now() - latestTs) / (1000 * 60 * 60 * 24);
    if (days >= 30) return null;
    if (latestClosure.monthKey === closeMonthDraft) return null;
    return `El último cierre fue hace ${Math.max(0, Math.floor(days))} día(s). Confirma que quieres cerrar ${monthLabel(closeMonthDraft).toLowerCase()}.`;
  }, [latestClosure, closeMonthDraft]);

  const sectionAmountsDisplay = useMemo(() => {
    const convert = (valueClp: number) => fromClp(valueClp, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
    return {
      investment: convert(sectionAmounts.investment),
      bank: convert(sectionAmounts.bank),
      realEstateNet: convert(sectionAmounts.realEstateNet),
      nonMortgageDebt: convert(sectionAmounts.nonMortgageDebt),
      financialNet: convert(sectionAmounts.financialNet),
      totalNet: convert(sectionAmounts.totalNetClp),
    };
  }, [displayCurrency, fx.eurClp, fx.ufClp, fx.usdClp, sectionAmounts]);

  const previousClosureForComparisons = useMemo(
    () =>
      closures
        .filter((closure) => closure.monthKey < monthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null,
    [closures, monthKey],
  );

  const previousClosureSectionAmounts = useMemo(() => {
    if (!previousClosureForComparisons?.records?.length) return null;
    const recordsForTotals = resolveRiskCapitalRecordsForTotals(
      previousClosureForComparisons.records,
      includeRiskCapitalInTotals,
    ).recordsForTotals;
    const closureFx = previousClosureForComparisons.fxRates || fx;
    return computeWealthHomeSectionAmounts(recordsForTotals, closureFx);
  }, [previousClosureForComparisons, includeRiskCapitalInTotals, fx]);

  const blockVariationsDisplay = useMemo(() => {
    if (!previousClosureSectionAmounts) return null;
    const formatVariation = (deltaClp: number, baseClp: number, debtMode = false) => {
      const deltaDisplay = fromClp(deltaClp, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
      const pct = baseClp !== 0 ? (deltaClp / baseClp) * 100 : null;
      const pctText =
        pct === null
          ? ''
          : ` (${pct >= 0 ? '+' : ''}${new Intl.NumberFormat('es-CL', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(pct)}%)`;
      const trend =
        Math.abs(deltaClp) < 0.5
          ? 'neutral'
          : debtMode
            ? deltaClp < 0
              ? 'good'
              : 'bad'
            : deltaClp > 0
              ? 'good'
              : 'bad';
      return {
        text: `${deltaDisplay >= 0 ? '+' : ''}${formatCurrency(deltaDisplay, displayCurrency)}${pctText}`,
        trend,
      } as const;
    };

    return {
      investment: formatVariation(
        sectionAmounts.investment - previousClosureSectionAmounts.investment,
        previousClosureSectionAmounts.investment,
      ),
      realEstateNet: formatVariation(
        sectionAmounts.realEstateNet - previousClosureSectionAmounts.realEstateNet,
        previousClosureSectionAmounts.realEstateNet,
      ),
      bank: formatVariation(
        sectionAmounts.bank - previousClosureSectionAmounts.bank,
        previousClosureSectionAmounts.bank,
      ),
      nonMortgageDebt: formatVariation(
        sectionAmounts.nonMortgageDebt - previousClosureSectionAmounts.nonMortgageDebt,
        previousClosureSectionAmounts.nonMortgageDebt,
        true,
      ),
    };
  }, [previousClosureSectionAmounts, sectionAmounts, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp]);

  const metricsDisplay = useMemo(() => {
    const convert = (value: number | null) => {
      if (value === null) return null;
      return fromClp(value, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
    };

    const formatted = (value: number | null, emptyText = '--') => {
      if (value === null) return emptyText;
      const prefix = value >= 0 ? '+' : '';
      return `${prefix}${formatCurrency(value, displayCurrency)}`;
    };

    const monthIncreaseValue = convert(metrics.monthIncrease);
    const monthIncreasePctText =
      metrics.monthIncreasePct === null
        ? ''
        : ` (${metrics.monthIncreasePct >= 0 ? '+' : ''}${new Intl.NumberFormat('es-CL', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(metrics.monthIncreasePct)}%)`;

    return {
      netWorth: formatCurrency(
        sectionAmountsDisplay.totalNet,
        displayCurrency,
      ),
      monthIncrease:
        monthIncreaseValue === null
          ? '--'
          : `${formatted(monthIncreaseValue, '--')}${monthIncreasePctText}`,
      avg12: formatted(convert(metrics.avg12), '--'),
      avgSinceStart: formatted(convert(metrics.avgSinceStart), '--'),
    };
  }, [displayCurrency, fx, metrics, sectionAmountsDisplay.totalNet]);

  const missingCriticalCount = useMemo(() => {
    const requiredNames = [...sectionChecklist.investment, ...REAL_ESTATE_CORE_NET_LABELS];
    return requiredNames.filter((required) => {
      return !monthRecords.some((record) => {
        if (record.block === 'bank' || isSyntheticAggregateRecord(record)) return false;
        return sameCanonicalLabel(record.label, required);
      });
    }).length;
  }, [monthRecords]);

  const latestClosureDisplay = useMemo(() => {
    if (!latestClosure) return null;
    const net = closureNetByMonth.get(latestClosure.monthKey) ?? latestClosure.summary.netConsolidatedClp;
    return fromClp(net, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp);
  }, [displayCurrency, fx.eurClp, fx.ufClp, fx.usdClp, latestClosure, closureNetByMonth]);

  const growthVsPrevClosureDisplay = useMemo(() => {
    if (!growthVsPrevClosure) return null;
    return {
      abs: fromClp(growthVsPrevClosure.abs, displayCurrency, fx.usdClp, fx.eurClp, fx.ufClp),
      pct: growthVsPrevClosure.pct,
    };
  }, [displayCurrency, fx.eurClp, fx.ufClp, fx.usdClp, growthVsPrevClosure]);
  const hasRealEstateCoreInputs = useMemo(() => {
    let hasProperty = false;
    let hasMortgageDebt = false;

    monthRecords.forEach((record) => {
      if (isSyntheticAggregateRecord(record)) return;
      if (record.block === 'real_estate' && sameCanonicalLabel(record.label, REAL_ESTATE_PROPERTY_VALUE_LABEL)) {
        hasProperty = true;
      }
      if (record.block === 'debt' && sameCanonicalLabel(record.label, MORTGAGE_DEBT_BALANCE_LABEL)) {
        hasMortgageDebt = true;
      }
    });

    return hasProperty && hasMortgageDebt;
  }, [monthRecords]);

  const hiddenHint = () => {
    const color = 'text-[#f3eadb]/80';
    return <span className={`text-sm font-medium ${color}`}>Pulsa para ver</span>;
  };

  const variationToneClass = (trend: 'good' | 'bad' | 'neutral' | undefined) => {
    if (trend === 'good') return 'text-emerald-700';
    if (trend === 'bad') return 'text-rose-700';
    return 'text-slate-500';
  };

  const toggleNetWorthVisibility = () => {
    if (!hideSensitiveAmountsEnabled) return;
    setShowNetWorth((value) => !value);
  };

  const refreshRecords = () => setRecords(loadWealthRecords());
  const refreshClosures = () => setClosures(loadClosures());
  const refreshInstruments = () => setInvestmentInstruments(loadInvestmentInstruments());
  const refreshAllWealthState = () => {
    refreshRecords();
    refreshClosures();
    refreshInstruments();
    setFx(loadFxRates());
  };

  const monthConsistencyCheckedRef = useRef(false);
  useEffect(() => {
    if (!hydrationReady) return;
    if (monthConsistencyCheckedRef.current) return;
    monthConsistencyCheckedRef.current = true;
    const monthKeyIsClosed = closures.some((closure) => closure.monthKey === monthKey);
    const closeDraftIsClosed = closures.some((closure) => closure.monthKey === closeMonthDraft);
    if (!monthKeyIsClosed && !closeDraftIsClosed) return;
    const correctedMonth = realCurrentMonthKey;
    setMonthKey(correctedMonth);
    setCloseMonthDraft(correctedMonth);
  }, [hydrationReady, closures, monthKey, closeMonthDraft, realCurrentMonthKey]);

  useEffect(() => {
    if (selectableLoadMonthKeys.includes(monthKey)) return;
    const fallbackMonth = selectableLoadMonthKeys.includes(realCurrentMonthKey)
      ? realCurrentMonthKey
      : selectableLoadMonthKeys[0] || realCurrentMonthKey;
    setMonthKey(fallbackMonth);
    setCarryMessage(`Mes de carga ajustado a ${monthLabel(fallbackMonth).toLowerCase()} (mes permitido).`);
  }, [monthKey, selectableLoadMonthKeys, realCurrentMonthKey]);

  const previousClosureForMonthStart = useMemo(
    () =>
      closures
        .filter((closure) => closure.monthKey < realCurrentMonthKey)
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null,
    [closures, realCurrentMonthKey],
  );

  const pendingCloseAlert = useMemo(() => {
    if (!latestClosure) return null;
    if (monthKey !== realCurrentMonthKey) return null;
    if (calendarMonthKey <= realCurrentMonthKey) return null;
    return `Tienes el cierre de ${monthLabel(realCurrentMonthKey).toLowerCase()} pendiente`;
  }, [latestClosure, monthKey, realCurrentMonthKey, calendarMonthKey]);

  const computeMonthNetSnapshot = (targetMonthKey: string, fxOverride?: { usdClp: number; eurClp: number; ufClp: number }) => {
    const sourceRecords = latestRecordsForMonth(loadWealthRecords(), targetMonthKey);
    const recordsForTotals = resolveRiskCapitalRecordsForTotals(sourceRecords, includeRiskCapitalInTotals).recordsForTotals;
    const amounts = computeWealthHomeSectionAmounts(recordsForTotals, fxOverride || loadFxRates());
    return amounts.totalNetClp;
  };

  const computeClosureNetForStart = (closure: WealthMonthlyClosure | null): number | null => {
    if (!closure) return null;
    if (closure.records?.length) {
      const recordsForTotals = resolveRiskCapitalRecordsForTotals(
        closure.records,
        includeRiskCapitalInTotals,
      ).recordsForTotals;
      const closureFx = closure.fxRates || loadFxRates();
      return computeWealthHomeSectionAmounts(recordsForTotals, closureFx).totalNetClp;
    }
    return closure.summary.netConsolidatedClp;
  };

  const startMonthBanksOptionEnabled = useMemo(() => {
    const tokens = loadBankTokens();
    return BANK_PROVIDERS.some((provider) => String(tokens[provider.id] || '').trim().length > 0);
  }, [records, closures, monthKey]);

  const refreshBanksFromFintocForMonth = async (targetMonthKey: string) => {
    const tokens = loadBankTokens();
    const providersWithToken = BANK_PROVIDERS.filter((provider) =>
      String(tokens[provider.id] || '').trim().length > 0,
    );
    if (!providersWithToken.length) {
      return { updated: false, message: 'Tokens no configurados.' };
    }
    const snapshotDate = visualMonthSnapshotDate(targetMonthKey);
    const before = latestRecordsForMonth(loadWealthRecords(), targetMonthKey);
    console.info('[Patrimonio][start-month-banks-before]', {
      targetMonthKey,
      providers: providersWithToken.map((provider) => provider.id),
      beforeCount: before.length,
    });

    const upsertBankRecord = (
      label: string,
      currency: WealthCurrency,
      amount: number,
      note?: string,
    ) => {
      const existing = latestRecordsForMonth(loadWealthRecords(), targetMonthKey).find(
        (record) => record.block === 'bank' && record.label === label && record.currency === currency,
      );
      upsertWealthRecord({
        id: existing?.id,
        block: 'bank',
        source: 'Fintoc API',
        label,
        amount: Math.max(0, Number(amount) || 0),
        currency,
        snapshotDate: existing?.snapshotDate || snapshotDate,
        note,
      });
    };

    for (const provider of providersWithToken) {
      // eslint-disable-next-line no-await-in-loop
      const result = await discoverFintocData(String(tokens[provider.id] || '').trim());
      if (!result.ok) {
        throw new Error(result.error || `No pude actualizar ${provider.label} vía Fintoc.`);
      }
      const assetAccounts = result.accounts.filter((account) => !isCreditCardAccount(account));
      const totals = assetAccounts.reduce(
        (acc, account) => {
          const currency = toWealthCurrency(account.currency);
          if (!currency) return acc;
          if (currency === 'CLP') acc.clp += Number(account.balance || 0);
          if (currency === 'USD') acc.usd += Number(account.balance || 0);
          return acc;
        },
        { clp: 0, usd: 0 },
      );
      upsertBankRecord(`${provider.label} CLP`, 'CLP', totals.clp, `API ${provider.label}`);
      upsertBankRecord(`${provider.label} USD`, 'USD', totals.usd, `API ${provider.label}`);
    }

    const refreshed = latestRecordsForMonth(loadWealthRecords(), targetMonthKey);
    const detailedBanks = refreshed.filter(
      (record) =>
        record.block === 'bank' &&
        MANUAL_BANK_ITEMS.some((item) => item.label === record.label && item.currency === record.currency),
    );
    const totalClp = detailedBanks
      .filter((record) => record.currency === 'CLP')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const totalUsd = detailedBanks
      .filter((record) => record.currency === 'USD')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    upsertBankRecord(BANK_BALANCE_CLP_LABEL, 'CLP', totalClp, 'Calculado desde detalle de cuentas');
    upsertBankRecord(BANK_BALANCE_USD_LABEL, 'USD', totalUsd, 'Calculado desde detalle de cuentas');

    const after = latestRecordsForMonth(loadWealthRecords(), targetMonthKey);
    console.info('[Patrimonio][start-month-banks-after]', {
      targetMonthKey,
      afterCount: after.length,
      totalClp,
      totalUsd,
    });
    return {
      updated: true,
      message: `${providersWithToken.length} banco(s) actualizado(s) vía Fintoc.`,
    };
  };

  const runStartMonthFlow = async () => {
    if (startMonthRunning) return;
    const monthToStart = realCurrentMonthKey;
    console.info('[Patrimonio][start-month-flow-before]', {
      monthToStart,
      monthKey,
      calendarMonthKey,
      latestClosureMonthKey: latestClosure?.monthKey || null,
    });
    setStartMonthFlowError('');
    setStartMonthRunning(true);
    const previousClosureNet = computeClosureNetForStart(previousClosureForMonthStart);
    try {
      const beforeNet = computeMonthNetSnapshot(monthToStart);
      const expectedMortgageLabels = Array.from(
        new Set(
          (previousClosureForMonthStart?.records || [])
            .filter(
              (record) =>
                record.block === 'debt' &&
                (isMortgagePrincipalDebtLabel(record.label) || isMortgageMetaDebtLabel(record.label)),
            )
            .map((record) => labelMatchKey(record.label)),
        ),
      );
      let fxSeeded = false;
      const previousFx = previousClosureForMonthStart?.fxRates || null;
      if (previousFx && previousFx.usdClp > 0 && previousFx.eurClp > 0 && previousFx.ufClp > 0) {
        saveFxRates(previousFx);
        setFx(loadFxRates());
        fxSeeded = true;
      }
      const result = fillMissingWithPreviousClosure(monthToStart, visualMonthSnapshotDate(monthToStart));
      const expectedSourceMonth = previousClosureForMonthStart?.monthKey || null;
      const sourceMatches = !expectedSourceMonth || result.sourceMonth === expectedSourceMonth;
      if (!sourceMatches) {
        throw new Error(
          `Arrastre inconsistente: esperaba ${expectedSourceMonth} y recibí ${result.sourceMonth || 'sin base'}.`,
        );
      }
      refreshAllWealthState();
      const currentMonthRecordsAfterCarry = latestRecordsForMonth(loadWealthRecords(), monthToStart);
      const missingMortgageLabels = expectedMortgageLabels.filter((labelKey) =>
        !currentMonthRecordsAfterCarry.some(
          (record) =>
            record.block === 'debt' &&
            (isMortgagePrincipalDebtLabel(record.label) || isMortgageMetaDebtLabel(record.label)) &&
            labelMatchKey(record.label) === labelKey,
        ),
      );
      if (missingMortgageLabels.length > 0) {
        throw new Error(`Arrastre incompleto en deuda hipotecaria: faltan ${missingMortgageLabels.join(', ')}.`);
      }
      const finalNet = computeMonthNetSnapshot(monthToStart);
      const variation = previousClosureNet === null ? null : finalNet - previousClosureNet;
      writeMonthStartedFlag(monthToStart, true);
      console.info('[Patrimonio][start-month-flow-after]', {
        monthToStart,
        beforeNet,
        finalNet,
        previousClosureNet,
        variation,
        carriedRecords: result.added,
        sourceMonth: result.sourceMonth,
        fxSeeded,
        expectedMortgageLabels,
        missingMortgageLabels: [],
      });
      if (variation !== null && Math.abs(variation) > 1) {
        setCarryMessage(
          `Arrastre aplicado en ${monthLabel(monthToStart).toLowerCase()}. Variación inicial distinta de cero (${formatCurrency(variation, 'CLP')}). Revisa datos faltantes del cierre previo.`,
        );
      } else {
        setCarryMessage(`Arrastre aplicado en ${monthLabel(monthToStart).toLowerCase()} con variación inicial cero.`);
      }
      setStartMonthActionStatus((prev) => ({ ...prev, carry: 'applied' }));
    } catch (error: any) {
      const message = String(error?.message || 'No pude completar el arranque de mes.');
      setStartMonthFlowError((prev) => (prev ? `${prev} · ${message}` : message));
      setCarryMessage(`No pude aplicar el arrastre: ${message}`);
    } finally {
      setStartMonthRunning(false);
      setCarryConfirmOpen(false);
    }
  };

  const runStartMonthFxUpdate = async () => {
    if (startMonthRunning) return;
    const monthToStart = realCurrentMonthKey;
    setStartMonthFlowError('');
    setStartMonthRunning(true);
    try {
      const beforeFx = loadFxRates();
      const result = await refreshFxRatesFromLive({ force: true });
      refreshAllWealthState();
      const afterFx = loadFxRates();
      console.info('[Patrimonio][start-month-fx-after]', {
        monthToStart,
        beforeFx,
        afterFx,
        updated: result.updated,
      });
      setCarryMessage(result.updated ? 'TC/UF actualizados ✓' : 'TC/UF sin cambios.');
      setStartMonthActionStatus((prev) => ({ ...prev, fx: 'applied' }));
    } catch (error: any) {
      const message = String(error?.message || 'No pude actualizar TC/UF.');
      setStartMonthFlowError((prev) => (prev ? `${prev} · ${message}` : message));
      setCarryMessage(`Error al actualizar TC/UF: ${message}`);
    } finally {
      setStartMonthRunning(false);
    }
  };

  const runStartMonthBanksUpdate = async () => {
    if (startMonthRunning) return;
    const monthToStart = realCurrentMonthKey;
    if (!startMonthBanksOptionEnabled) {
      setCarryMessage('Configura tokens en Ajustes para actualizar bancos vía Fintoc.');
      return;
    }
    setStartMonthFlowError('');
    setStartMonthRunning(true);
    try {
      const result = await refreshBanksFromFintocForMonth(monthToStart);
      refreshAllWealthState();
      console.info('[Patrimonio][start-month-banks-sync-after]', {
        monthToStart,
        updated: result.updated,
      });
      setCarryMessage(result.updated ? 'Bancos actualizados ✓' : result.message);
      setStartMonthActionStatus((prev) => ({ ...prev, banks: 'applied' }));
    } catch (error: any) {
      const message = String(error?.message || 'No pude actualizar bancos vía Fintoc.');
      setStartMonthFlowError((prev) => (prev ? `${prev} · ${message}` : message));
      setCarryMessage(`Error al actualizar bancos: ${message}`);
    } finally {
      setStartMonthRunning(false);
    }
  };

  const runStartMonthRealEstateUpdate = () => {
    if (startMonthRunning) return;
    const monthToStart = realCurrentMonthKey;
    const beforeNet = computeMonthNetSnapshot(monthToStart);
    console.info('[Patrimonio][start-month-real-estate-before]', {
      monthToStart,
      beforeNet,
    });
    const auto = applyMortgageAutoCalculation(monthToStart, visualMonthSnapshotDate(monthToStart));
    refreshAllWealthState();
    const afterNet = computeMonthNetSnapshot(monthToStart);
    console.info('[Patrimonio][start-month-real-estate-after]', {
      monthToStart,
      afterNet,
      delta: afterNet - beforeNet,
      changed: auto.changed,
      sourceMonth: auto.sourceMonth,
      reason: auto.reason || null,
    });
    if (auto.changed > 0) {
      setCarryMessage(`Bienes raíces recalculados ✓ (${auto.changed} ajuste(s)).`);
      setStartMonthActionStatus((prev) => ({ ...prev, realEstate: 'applied' }));
      return;
    }
    if (auto.reason === 'missing_base_debt') {
      const message = 'No pude recalcular bienes raíces: falta saldo de deuda hipotecaria base.';
      setStartMonthFlowError((prev) => (prev ? `${prev} · ${message}` : message));
      setCarryMessage(message);
      return;
    }
    setCarryMessage('Bienes raíces sin cambios.');
    setStartMonthActionStatus((prev) => ({ ...prev, realEstate: 'applied' }));
  };

  const completeMonthlyClose = (
    targetMonthKey: string,
    fxForClose: { usdClp: number; eurClp: number; ufClp: number },
  ) => {
    const before = {
      visualMonthBefore: monthKey,
      targetMonthKey,
      realCurrentMonthBefore: realCurrentMonthKey,
      fxForClose,
    };
    console.info('[Patrimonio][close-before]', before);
    const targetRecords = latestRecordsForMonth(records, targetMonthKey);
    setCloseError('');
    setCloseInfo('');
    setCloseConfirmOpen(false);
    createMonthlyClosure(targetRecords, fxForClose, toCloseDateFromMonthKey(targetMonthKey));
    refreshClosures();
    const persistedClosure = loadClosures().find((closure) => closure.monthKey === targetMonthKey) || null;
    const persistedFx = persistedClosure?.fxRates || null;
    const fxMatches =
      !!persistedFx &&
      Math.abs((persistedFx.usdClp || 0) - fxForClose.usdClp) < 1e-6 &&
      Math.abs((persistedFx.eurClp || 0) - fxForClose.eurClp) < 1e-6 &&
      Math.abs((persistedFx.ufClp || 0) - fxForClose.ufClp) < 1e-6;
    console.info('[Patrimonio][close-after-fx-check]', {
      targetMonthKey,
      expectedFx: fxForClose,
      persistedFx,
      fxMatches,
    });
    if (!fxMatches) {
      setCloseError('El cierre se guardó, pero no pude confirmar TC/UF persistidos.');
    }
    const nextVisualMonth = monthAfterKey(targetMonthKey) || currentMonthKey();
    const realCurrentMonthAfter = currentMonthKey();
    setMonthKey(nextVisualMonth);
    setCloseMonthDraft(nextVisualMonth);
    const advanced = nextVisualMonth !== targetMonthKey;
    console.info('[Patrimonio][close-after]', {
      visualMonthAfter: nextVisualMonth,
      targetMonthKey,
      realCurrentMonthAfter,
      advanced,
    });
    if (!advanced) {
      setCloseError('El cierre se guardó, pero no pude avanzar al siguiente mes en pantalla.');
    }
  };

  const recordsForSection = useMemo(() => {
    if (!activeSection) return [];
    if (activeSection === 'real_estate') {
      return monthRecords.filter((record) => {
        if (record.block === 'real_estate') return true;
        if (record.block !== 'debt') return false;
        return isMortgagePrincipalDebtLabel(record.label) || isMortgageMetaDebtLabel(record.label);
      });
    }
    if (activeSection === 'bank') {
      return monthRecords.filter((r) => {
        if (r.block === 'bank') return true;
        if (r.block !== 'debt') return false;
        return isNonMortgageDebtRecord(r);
      });
    }
    if (activeSection === 'investment') {
      return monthRecords.filter((r) => r.block === 'investment');
    }
    return monthRecords.filter((r) => r.block === activeSection);
  }, [activeSection, includeRiskCapitalInTotals, monthRecords]);

  const createInvestmentInstrument = (input: {
    label: string;
    currency: WealthCurrency;
    amount?: number;
    note?: string;
  }) => {
    const instrument = upsertInvestmentInstrument({
      label: input.label,
      currency: input.currency,
      note: input.note,
    });
    if (!instrument) return;

    if (typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0) {
      const expectedSnapshotDate = visualMonthSnapshotDate(monthKey);
      console.info('[Patrimonio][save-before]', {
        operation: 'createInvestmentInstrument',
        monthKey,
        label: instrument.label,
        requestedSnapshotDate: expectedSnapshotDate,
      });
      const saved = upsertWealthRecord({
        block: 'investment',
        source: 'Instrumento manual',
        label: instrument.label,
        amount: input.amount,
        currency: instrument.currency,
        note: input.note || undefined,
        snapshotDate: expectedSnapshotDate,
      });
      const persisted = loadWealthRecords().find((record) => record.id === saved.id) || saved;
      const inExpectedMonth = String(persisted.snapshotDate || '').startsWith(`${monthKey}-`);
      console.info('[Patrimonio][save-after]', {
        operation: 'createInvestmentInstrument',
        monthKey,
        label: instrument.label,
        persistedSnapshotDate: persisted.snapshotDate,
        inExpectedMonth,
      });
      if (!inExpectedMonth) {
        setCloseError(`No pude guardar "${instrument.label}" en ${monthLabel(monthKey).toLowerCase()}.`);
      }
    }
    refreshRecords();
    refreshInstruments();
    setCarryMessage('');
  };

  const setInvestmentExcludedForMonth = (instrumentId: string, targetMonthKey: string, excluded: boolean) => {
    const updated = setInvestmentInstrumentMonthExcluded(instrumentId, targetMonthKey, excluded);
    if (!updated) return;

    if (excluded) {
      const next = loadWealthRecords().filter(
        (record) =>
          !(
            record.block === 'investment' &&
            record.snapshotDate.startsWith(`${targetMonthKey}-`) &&
            record.currency === updated.currency &&
            normalizeForMatch(record.label) === normalizeForMatch(updated.label)
          ),
      );
      saveWealthRecords(next);
    }

    refreshRecords();
    refreshInstruments();
    return updated;
  };

  const setInvestmentExcluded = (instrumentId: string, excluded: boolean) => {
    const updated = setInvestmentExcludedForMonth(instrumentId, monthKey, excluded);
    if (!updated) return;
    setCarryMessage(
      excluded
        ? `"${updated.label}" quedó excluido de ${monthLabel(monthKey).toLowerCase()}.`
        : `"${updated.label}" volvió a considerarse en ${monthLabel(monthKey).toLowerCase()}.`,
    );
  };

  const evaluateCloseValidation = (targetMonthKey: string): { issues: CloseValidationIssue[]; targetRecords: WealthRecord[] } => {
    const issues: CloseValidationIssue[] = [];
    const targetRecords = latestRecordsForMonth(records, targetMonthKey);
    const realCurrentMonth = calendarMonthKey;

    if (targetMonthKey > realCurrentMonth) {
      issues.push({
        type: 'future_month',
        level: 'error',
        label: `No se puede cerrar un mes futuro (${monthLabel(targetMonthKey).toLowerCase()}). Mes actual: ${monthLabel(realCurrentMonth).toLowerCase()}.`,
        section: 'investment',
      });
      return { issues, targetRecords };
    }

    const requiredInvestment = new Set(sectionChecklist.investment.map((label) => normalizeForMatch(label)));
    const investmentsValueRule = resolveClosingConfigRule(closeConfigSnapshot, 'investments_value', true, 3);
    const propertyValueRule = resolveClosingConfigRule(closeConfigSnapshot, 'property_value', false, null);
    const mortgageBalanceRule = resolveClosingConfigRule(closeConfigSnapshot, 'mortgage_balance', false, null);
    const requiredNames: Array<{ label: string; section: MainSection }> = [];
    if (investmentsValueRule.enabled) {
      sectionChecklist.investment.forEach((label) => requiredNames.push({ label, section: 'investment' }));
    }
    if (propertyValueRule.enabled) {
      requiredNames.push({ label: REAL_ESTATE_PROPERTY_VALUE_LABEL, section: 'real_estate' });
    }
    if (mortgageBalanceRule.enabled) {
      requiredNames.push({ label: MORTGAGE_DEBT_BALANCE_LABEL, section: 'real_estate' });
    }
    const isTenencia = (label: string) =>
      normalizeForMatch(label).includes(normalizeForMatch(TENENCIA_CXC_PREFIX_LABEL));
    requiredNames.forEach((required) => {
      const exists = targetRecords.some((record) => {
        if (record.block === 'bank' || isSyntheticAggregateRecord(record)) return false;
        return sameCanonicalLabel(record.label, required.label);
      });
      if (exists) return;
      issues.push({
        type: 'missing_required_value',
        level: 'error',
        label: required.label,
        section: required.section,
        canResolveWithPrevious: true,
      });
    });

    investmentInstruments.forEach((instrument) => {
      if ((instrument.excludedMonths || []).includes(targetMonthKey)) return;
      if (isTenencia(instrument.label)) return;
      const isNonExcludable = isNonExcludableInvestmentLabel(instrument.label);
      const instrumentRule = resolveClosingConfigRule(
        closeConfigSnapshot,
        `investment:${instrument.id}`,
        true,
        3,
      );
      const exists = targetRecords.some(
        (record) =>
          record.block === 'investment' &&
          record.currency === instrument.currency &&
          normalizeForMatch(record.label) === normalizeForMatch(instrument.label),
      );
      if (exists) return;
      if (!instrumentRule.enabled) {
        issues.push({
          type: 'config_update_warning',
          level: 'warning',
          label: `Configuración de cierre · ${instrument.label}: sin dato este mes (toggle OFF, no bloquea).`,
          section: 'investment',
          instrumentId: instrument.id,
        });
        return;
      }
      issues.push({
        type: 'incomplete_new_source',
        level: 'error',
        label: instrument.label,
        section: 'investment',
        instrumentId: instrument.id,
        canResolveWithPrevious: true,
        canExcludeThisMonth: !isNonExcludable,
      });
    });

    type ConfigFieldCheck = {
      key: string;
      label: string;
      section: MainSection;
      rule: ClosingConfigRule;
      records: WealthRecord[];
    };

    const isMortgageDebtLabel = (label: string) =>
      isMortgagePrincipalDebtLabel(label) || isMortgageMetaDebtLabel(label);

    const configChecks: ConfigFieldCheck[] = [
      {
        key: 'investments_value',
        label: 'Inversiones (valor)',
        section: 'investment',
        rule: investmentsValueRule,
        records: targetRecords.filter(
          (record) =>
            record.block === 'investment' &&
            !isRiskCapitalInvestmentLabel(record.label) &&
            !isTenencia(record.label),
        ),
      },
      {
        key: 'banks_fintoc',
        label: 'Bancos (Fintoc)',
        section: 'bank',
        rule: resolveClosingConfigRule(closeConfigSnapshot, 'banks_fintoc', true, 3),
        records: targetRecords.filter((record) => record.block === 'bank'),
      },
      {
        key: 'tenencia',
        label: 'Tenencia',
        section: 'investment',
        rule: resolveClosingConfigRule(closeConfigSnapshot, 'tenencia', false, null),
        records: targetRecords.filter((record) => record.block === 'investment' && isTenencia(record.label)),
      },
      {
        key: 'cards_used',
        label: 'Cupos tarjetas',
        section: 'bank',
        rule: resolveClosingConfigRule(closeConfigSnapshot, 'cards_used', false, null),
        records: targetRecords.filter((record) => record.block === 'debt' && !isMortgageDebtLabel(record.label)),
      },
      {
        key: 'property_value',
        label: REAL_ESTATE_PROPERTY_VALUE_LABEL,
        section: 'real_estate',
        rule: propertyValueRule,
        records: targetRecords.filter(
          (record) =>
            record.block === 'real_estate' &&
            sameCanonicalLabel(record.label, REAL_ESTATE_PROPERTY_VALUE_LABEL),
        ),
      },
      {
        key: 'mortgage_balance',
        label: MORTGAGE_DEBT_BALANCE_LABEL,
        section: 'real_estate',
        rule: mortgageBalanceRule,
        records: targetRecords.filter(
          (record) => record.block === 'debt' && sameCanonicalLabel(record.label, MORTGAGE_DEBT_BALANCE_LABEL),
        ),
      },
      {
        key: 'mortgage_amortization',
        label: 'Amortización mensual',
        section: 'real_estate',
        rule: resolveClosingConfigRule(closeConfigSnapshot, 'mortgage_amortization', false, null),
        records: targetRecords.filter(
          (record) =>
            record.block === 'debt' && sameCanonicalLabel(record.label, MORTGAGE_AMORTIZATION_LABEL),
        ),
      },
    ];

    investmentInstruments.forEach((instrument) => {
      if ((instrument.excludedMonths || []).includes(targetMonthKey)) return;
      if (isTenencia(instrument.label)) return;
      configChecks.push({
        key: `investment:${instrument.id}`,
        label: instrument.label,
        section: 'investment',
        rule: resolveClosingConfigRule(closeConfigSnapshot, `investment:${instrument.id}`, true, 3),
        records: targetRecords.filter(
          (record) =>
            record.block === 'investment' &&
            record.currency === instrument.currency &&
            sameCanonicalLabel(record.label, instrument.label),
        ),
      });
    });

    configChecks.forEach((check) => {
      const isInstrumentSpecificRule = check.key.startsWith('investment:');
      const latestStamp = check.records
        .map((record) => record.createdAt || `${record.snapshotDate}T00:00:00`)
        .filter(Boolean)
        .sort((a, b) => String(b).localeCompare(String(a)))[0];
      const ageDays = daysSinceIso(latestStamp);
      const allCarried = check.records.length > 0 && check.records.every((record) => isCarriedRecord(record));
      const staleByAge =
        check.rule.maxAgeDays !== null &&
        ageDays !== null &&
        Number.isFinite(check.rule.maxAgeDays) &&
        ageDays > check.rule.maxAgeDays;

      if (check.rule.enabled) {
        if (!check.records.length) {
          if (isInstrumentSpecificRule) return;
          issues.push({
            type: 'config_update_required',
            level: 'error',
            label: `Configuración de cierre · ${check.label}: sin dato cargado para ${monthLabel(targetMonthKey).toLowerCase()}.`,
            section: check.section,
          });
          return;
        }
        if (allCarried) {
          issues.push({
            type: 'config_update_required',
            level: 'error',
            label: `Configuración de cierre · ${check.label}: valor arrastrado (requiere actualización real).`,
            section: check.section,
          });
        }
        if (staleByAge) {
          issues.push({
            type: 'config_update_required',
            level: 'error',
            label: `Configuración de cierre · ${check.label}: última actualización ${ageDays} días atrás (máximo ${check.rule.maxAgeDays}).`,
            section: check.section,
          });
        }
        return;
      }

      if (!check.records.length) return;
      const notices: string[] = [];
      if (allCarried) notices.push('valor arrastrado');
      if (staleByAge) notices.push(`última actualización ${ageDays} días atrás (máximo ${check.rule.maxAgeDays})`);
      if (!notices.length) return;
      issues.push({
        type: 'config_update_warning',
        level: 'warning',
        label: `Configuración de cierre · ${check.label}: ${notices.join(' · ')} (toggle OFF, no bloquea).`,
        section: check.section,
      });
    });

    const carriedLabels = Array.from(
      new Set(
        targetRecords
          .filter(
            (record) =>
              isCarriedRecord(record) &&
              (record.block === 'investment' ||
                record.block === 'real_estate' ||
                (record.block === 'debt' && isMortgagePrincipalLabel(record.label))),
          )
          .map((record) => record.label),
      ),
    );

    carriedLabels.forEach((label) => {
      const isInvestment = requiredInvestment.has(normalizeForMatch(label)) || !!investmentInstruments.find(
        (instrument) => normalizeForMatch(instrument.label) === normalizeForMatch(label),
      );
      issues.push({
        type: 'carried_value_unconfirmed',
        level: 'warning',
        label,
        section: isInvestment ? 'investment' : 'real_estate',
      });
    });

    return { issues, targetRecords };
  };

  const closeValidationDraft = useMemo(
    () => evaluateCloseValidation(closeMonthDraft),
    [closeMonthDraft, records, investmentInstruments, closeConfigSnapshot],
  );
  const closeFxValues = useMemo(() => {
    const parsedUsd = parseStrictNumber(closeFxDraft.usdClp);
    const parsedEur = parseStrictNumber(closeFxDraft.eurClp);
    const parsedUf = parseStrictNumber(closeFxDraft.ufClp);
    return {
      usdClp: Number.isFinite(parsedUsd) && parsedUsd > 0 ? parsedUsd : 0,
      eurClp: Number.isFinite(parsedEur) && parsedEur > 0 ? parsedEur : 0,
      ufClp: Number.isFinite(parsedUf) && parsedUf > 0 ? parsedUf : 0,
    };
  }, [closeFxDraft]);
  const closeFxReady = closeFxValues.usdClp > 0 && closeFxValues.eurClp > 0 && closeFxValues.ufClp > 0;
  const closePreview = useMemo(() => {
    const targetRecords = closeValidationDraft.targetRecords;
    const resolved = resolveRiskCapitalRecordsForTotals(targetRecords, includeRiskCapitalInTotals);
    const amounts = computeWealthHomeSectionAmounts(resolved.recordsForTotals, closeFxValues);
    const riskRecords = targetRecords.filter(
      (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
    );
    const riskClp = riskRecords.reduce(
      (sum, record) => sum + toClp(record.amount, record.currency, closeFxValues.usdClp, closeFxValues.eurClp, closeFxValues.ufClp),
      0,
    );
    const hasProperty = targetRecords.some(
      (record) =>
        record.block === 'real_estate' &&
        sameCanonicalLabel(record.label, REAL_ESTATE_PROPERTY_VALUE_LABEL),
    );

    return {
      banks: amounts.bank,
      investments: amounts.investment,
      riskClp,
      hasRisk: riskRecords.length > 0,
      propertyNet: amounts.realEstateNet,
      hasProperty,
      nonMortgageDebt: amounts.nonMortgageDebt,
      usdClp: closeFxValues.usdClp,
      eurClp: closeFxValues.eurClp,
      ufClp: closeFxValues.ufClp,
      totalNetClp: amounts.totalNetClp,
    };
  }, [closeValidationDraft.targetRecords, includeRiskCapitalInTotals, closeFxValues]);

  const resolveCloseIssueWithPrevious = (issue: CloseValidationIssue) => {
    if (!issue.canResolveWithPrevious) return;
    const result = fillMissingWithPreviousClosure(
      closeMonthDraft,
      visualMonthSnapshotDate(closeMonthDraft),
      [issue.label],
    );
    refreshRecords();
    if (result.added > 0) {
      setCloseError('');
      setCloseInfo(`Completado con mes anterior: "${issue.label}" (base ${result.sourceMonth || 'sin mes'}).`);
      return;
    }
    setCloseInfo('');
    setCloseError(`No pude completar "${issue.label}" con mes anterior (sin base o ya estaba cargado).`);
  };

  const resolveCloseIssueExclude = (issue: CloseValidationIssue) => {
    if (!issue.canExcludeThisMonth || !issue.instrumentId) return;
    const updated = setInvestmentExcludedForMonth(issue.instrumentId, closeMonthDraft, true);
    if (!updated) {
      setCloseInfo('');
      setCloseError(`No pude excluir "${issue.label}" para ${monthLabel(closeMonthDraft).toLowerCase()}.`);
      return;
    }
    setCloseError('');
    setCloseInfo(`"${issue.label}" quedó excluido en ${monthLabel(closeMonthDraft).toLowerCase()}.`);
  };

  const reviewCloseIssue = (issue: CloseValidationIssue) => {
    setCloseConfirmOpen(false);
    setMonthKey(closeMonthDraft);
    setActiveSection(issue.section);
    setCloseInfo('');
    setCloseError(`Revisa "${issue.label}" en ${sectionLabel[issue.section].toLowerCase()}.`);
  };

  const attemptMonthlyClose = (targetMonthKey: string) => {
    const evaluation = evaluateCloseValidation(targetMonthKey);
    const blocking = evaluation.issues.filter((issue) => issue.level === 'error');
    const carried = evaluation.issues.filter((issue) => issue.type === 'carried_value_unconfirmed');

    if (blocking.length) {
      if (blocking[0].type === 'future_month') {
        setCloseInfo('');
        setCloseError(blocking[0].label);
        return;
      }
      const preview = blocking.slice(0, 3).map((issue) => issue.label).join(', ');
      const suffix = blocking.length > 3 ? ` (+${blocking.length - 3})` : '';
      setCloseInfo('');
      setCloseError(`No se puede cerrar: faltan ${blocking.length} ítem(s) (${preview}${suffix}).`);
      return;
    }

    const fxForClose = {
      usdClp: closeFxValues.usdClp,
      eurClp: closeFxValues.eurClp,
      ufClp: closeFxValues.ufClp,
    };
    console.info('[Patrimonio][close-before-fx-input]', {
      targetMonthKey,
      fxForClose,
      isHistoricalClose: targetMonthKey !== realCurrentMonthKey,
    });
    if (!(fxForClose.usdClp > 0 && fxForClose.eurClp > 0 && fxForClose.ufClp > 0)) {
      setCloseInfo('');
      setCloseError('Completá USD/CLP, EUR/CLP y UF/CLP válidos para confirmar este cierre.');
      return;
    }
    completeMonthlyClose(targetMonthKey, fxForClose);
    if (carried.length) {
      setCarryMessage(
        `Cierre realizado con ${carried.length} valor(es) arrastrados de mes anterior. Puedes actualizarlos luego para el mes en curso.`,
      );
    }
  };

  const runMonthlyClose = () => {
    setCloseError('');
    setCloseInfo('');
    setCloseMonthDraft(monthKey);
    setCloseConfirmOpen(true);
  };

  const closeBlockingIssues = useMemo(
    () => closeValidationDraft.issues.filter((issue) => issue.level === 'error'),
    [closeValidationDraft],
  );
  const closeWarningIssues = useMemo(
    () => closeValidationDraft.issues.filter((issue) => issue.level === 'warning'),
    [closeValidationDraft],
  );

  const useMissingFromPrevious = (section: MainSection, itemName?: string) => {
    const isSingleItem = !!itemName;
    const isRealEstate = section === 'real_estate';
    const targetSnapshotDate = visualMonthSnapshotDate(monthKey);
    const init = isRealEstate && !isSingleItem ? ensureInitialMortgageDefaults(monthKey, targetSnapshotDate) : { added: 0 };
    const result = fillMissingWithPreviousClosure(monthKey, targetSnapshotDate, itemName ? [itemName] : undefined);
    const auto = isRealEstate && !isSingleItem
      ? applyMortgageAutoCalculation(monthKey, targetSnapshotDate)
      : { changed: 0, sourceMonth: null, reason: null };
    refreshRecords();

    if (isSingleItem) {
      if (!result.sourceMonth) {
        setCarryMessage(`No hay cierre anterior disponible para completar "${itemName}".`);
        return;
      }
      if (result.added > 0) {
        setCarryMessage(`Completado con mes anterior: "${itemName}" (base ${result.sourceMonth}).`);
        return;
      }
      setCarryMessage(`"${itemName}" ya estaba actualizado o no existe en el cierre ${result.sourceMonth}.`);
      return;
    }

    if (!result.sourceMonth) {
      if (init.added > 0 || auto.changed > 0) {
        setCarryMessage('Base hipotecaria inicial cargada automáticamente.');
        return;
      }
      setCarryMessage('No hay un cierre anterior con detalle para completar pendientes.');
      return;
    }

    if (isRealEstate && !result.added && !auto.changed && auto.reason === 'missing_base_debt') {
      setCarryMessage('Sin cierre previo y sin base de deuda: ingresa manualmente "Saldo deuda hipotecaria" para iniciar el autocálculo.');
      return;
    }

    if (!result.added && !auto.changed) {
      setCarryMessage(`No había pendientes para completar desde ${result.sourceMonth}.`);
      return;
    }

    const parts: string[] = [];
    if (result.added) parts.push(`Se completaron ${result.added} pendientes con mes anterior (${result.sourceMonth})`);
    if (isRealEstate && auto.changed) parts.push(`Autocálculo hipotecario aplicado en ${auto.changed} registros`);
    setCarryMessage(`${parts.join('. ')}. Variación simulada hasta actualizar valores reales.`);
  };

  const applyMortgageAutoNow = () => {
    const auto = applyMortgageAutoCalculation(monthKey, visualMonthSnapshotDate(monthKey));
    refreshRecords();
    if (auto.changed > 0) {
      setCarryMessage(`Autocálculo hipotecario aplicado en ${auto.changed} registros (base ${auto.sourceMonth}).`);
      return;
    }
    if (auto.reason === 'missing_base_debt') {
      setCarryMessage('No pude aplicar autocálculo: primero ingresa manualmente "Saldo deuda hipotecaria" de este mes como base inicial.');
      return;
    }
    if (!auto.sourceMonth) {
      setCarryMessage('No pude aplicar autocálculo: falta un cierre anterior con registros.');
      return;
    }
    setCarryMessage(`No hubo cambios por autocálculo (ya había datos actualizados en este mes).`);
  };

  const allStartMonthActionsApplied = useMemo(
    () => Object.values(startMonthActionStatus).every((status) => status === 'applied'),
    [startMonthActionStatus],
  );
  const showCurrentMonthActionBar = monthKey === realCurrentMonthKey && !allStartMonthActionsApplied;
  const carrySourceMonthLabel = previousClosureForMonthStart
    ? monthLabel(previousClosureForMonthStart.monthKey).toLowerCase()
    : null;
  const startMonthActionButtonClass = (action: StartMonthActionKey) =>
    startMonthActionStatus[action] === 'applied'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : 'border-slate-300 bg-slate-100 text-slate-700';

  if (activeSection) {
    return (
      <div className="p-4">
        <SectionScreen
          section={activeSection}
          monthKey={monthKey}
          closures={closures}
          recordsForSection={recordsForSection}
          includeRiskCapitalInTotals={includeRiskCapitalInTotals}
          onToggleRiskCapitalView={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
          investmentInstruments={investmentInstruments}
          usdClp={fx.usdClp}
          eurClp={fx.eurClp}
          ufClp={fx.ufClp}
          carryMessage={carryMessage}
          onBack={() => {
            setActiveSection(null);
            setCarryMessage('');
          }}
          onDataChanged={() => {
            refreshRecords();
            refreshInstruments();
            setCarryMessage('');
          }}
          onCreateInvestmentInstrument={createInvestmentInstrument}
          onSetInvestmentExcluded={setInvestmentExcluded}
          onUseMissing={useMissingFromPrevious}
          onApplyMortgageAuto={applyMortgageAutoNow}
        />
      </div>
    );
  }

  return (
    <div className={cn('p-3 space-y-3', showCurrentMonthActionBar && 'pb-36')}>
      <Card className="relative overflow-hidden border-0 p-4 bg-gradient-to-br from-[#103c35] via-[#165347] to-[#1f4a3a] text-white shadow-[0_16px_36px_rgba(11,38,34,0.55)]">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_#c59a6c_0%,_transparent_46%)]" />
        <div className="relative">
          <div className="text-xs uppercase tracking-[0.22em] text-[#f3eadb]">Aurum Wealth</div>
          <div className="mt-1 text-sm text-[#e0d6c5]">Resumen estratégico {monthLabel(monthKey).toLowerCase()}</div>
          {isFirstUseOnboarding && (
            <div className="mt-3 rounded-xl border border-[#c59a6c]/35 bg-[#f6efe3]/12 p-3 text-xs text-[#f3eadb]">
              <div className="font-semibold">Primer uso: cómo empezar</div>
              <div className="mt-1">1. Primero ingresa tus cierres históricos desde Settings → Importar CSV.</div>
              <div className="mt-1">2. O ingresa manualmente desde aquí cambiando el mes.</div>
              <div className="mt-1">3. Luego ingresa los datos del mes actual.</div>
            </div>
          )}

          <div className="absolute top-0 right-0 z-20 flex items-center gap-2">
            <button
              className={cn(
                'text-xs text-[#efe4d1]',
                !hideSensitiveAmountsEnabled && 'cursor-not-allowed opacity-60',
              )}
              onClick={toggleNetWorthVisibility}
              type="button"
              disabled={!hideSensitiveAmountsEnabled}
            >
              {showNetWorth ? 'Ocultar' : 'Ver'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 text-xs">
            <div className="space-y-1.5">
              <button
                className={cn(
                  'w-full rounded-xl bg-[#f6efe3]/10 p-2.5 text-left min-h-[56px] border border-[#c59a6c]/25',
                  !hideSensitiveAmountsEnabled && 'cursor-default',
                )}
                onClick={toggleNetWorthVisibility}
                type="button"
              >
                <div className="text-[#e7dcc9] text-[11px] uppercase tracking-wide">Patrimonio total neto</div>
                <div className="mt-1 min-h-[34px] flex items-center">
                  {showNetWorth && sectionAmounts.hasAllCoreSubtotalsData ? (
                    <span className="inline-flex items-center gap-2 text-3xl font-bold leading-none tracking-tight transition-all duration-200 ease-out opacity-100 translate-y-0">
                      <span className="text-emerald-200">{metricsDisplay.netWorth}</span>
                      {includeRiskCapitalInTotals && (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          +CapRiesgo {monthRiskResolution.hasRiskCapital ? '' : 'Sin datos'}
                        </span>
                      )}
                      {missingCriticalCount > 0 && (
                        <span className="rounded-full border border-[#c59a6c]/70 bg-[#a97747]/20 px-2 py-0.5 text-[10px] font-semibold text-[#f3eadb]">
                          Parcial
                        </span>
                      )}
                    </span>
                  ) : showNetWorth ? (
                    <span className="text-sm font-medium text-[#f3eadb]/85">
                      Completa Inversiones + Bancos + Bienes raíces para mostrar total
                    </span>
                  ) : (
                    <span className="transition-all duration-200 ease-out opacity-100 translate-y-0">
                      {hiddenHint()}
                    </span>
                  )}
                </div>
              </button>

              {showNetWorth ? (
                sectionAmounts.hasAllCoreSubtotalsData ? (
                  <>
                    <div className="rounded-xl border border-[#c59a6c]/30 bg-[#f6efe3]/12 p-2.5">
                      <div className="text-[#e7dcc9] text-[11px] uppercase tracking-wide">Incremento mensual</div>
                      <div className="mt-1 text-xl font-semibold">{metricsDisplay.monthIncrease}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-[#f6efe3]/10 p-2.5">
                        <div className="text-[#e7dcc9] text-[11px]">Promedio 12M</div>
                        <div className="mt-1 text-sm font-semibold">{metricsDisplay.avg12}</div>
                      </div>
                      <div className="rounded-xl bg-[#f6efe3]/10 p-2.5">
                        <div className="text-[#e7dcc9] text-[11px]">Promedio desde inicio</div>
                        <div className="mt-1 text-sm font-semibold">{metricsDisplay.avgSinceStart}</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-[#c59a6c]/30 bg-[#f6efe3]/12 p-2.5 text-sm text-[#f3eadb]/90">
                    Completa los datos del mes para ver la evolución
                  </div>
                )
              ) : null}
            </div>

            <div className="flex flex-col items-end gap-4 self-end">
              <div className="flex flex-col gap-2">
                {(['CLP', 'USD', 'EUR'] as WealthCurrency[]).map((curr) => (
                  <button
                    key={curr}
                    className={`px-3 py-2 rounded-lg border text-xs ${
                      displayCurrency === curr
                        ? 'bg-[#f3eadb] text-[#1d3c33] border-[#f3eadb]/70'
                        : 'bg-[#f3eadb]/10 text-[#f3eadb] border-[#c59a6c]/45'
                    }`}
                    onClick={() => setDisplayCurrency(curr)}
                    type="button"
                  >
                    {curr}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
                className={cn(
                  'inline-flex h-11 w-11 items-center justify-center rounded-full border transition',
                  includeRiskCapitalInTotals
                    ? 'border-amber-300 bg-amber-50 text-amber-600'
                    : 'border-slate-300 bg-white/70 text-slate-400',
                )}
                title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
                aria-label="Alternar capital de riesgo"
              >
                <Zap size={18} />
              </button>
            </div>
          </div>

        </div>
      </Card>

      {!!pendingCloseAlert && (
        <Card className="border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {pendingCloseAlert}
        </Card>
      )}
      {!!startMonthFlowError && (
        <Card className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {startMonthFlowError}
        </Card>
      )}

      <div className="space-y-2">
        <div
          role="button"
          tabIndex={0}
          className="relative rounded-2xl border-0 bg-gradient-to-br from-[#f3b179] to-[#d87d3f] px-3 py-2 text-left shadow-[0_8px_18px_rgba(165,96,42,0.2)] transition min-h-[72px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a2f16]/45"
          onClick={() => setActiveSection('investment')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setActiveSection('investment');
            }
          }}
          aria-label="Entrar a Inversiones"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5a2f16]">
              <Landmark size={15} /> Inversiones
            </div>
            <div className="pr-6 text-right break-words">
              <div className="text-base font-bold leading-tight text-[#5a2f16]">
                {showNetWorth ? formatCurrency(sectionAmountsDisplay.investment, displayCurrency) : '••••'}
              </div>
              {showNetWorth && blockVariationsDisplay?.investment ? (
                <div className={cn('mt-0.5 text-[11px] font-medium', variationToneClass(blockVariationsDisplay.investment.trend))}>
                  · {blockVariationsDisplay.investment.text}
                </div>
              ) : null}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#7f4927]/30 bg-white/35 text-[#7f4927]/75">
            <ArrowRight size={11} />
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          className="relative rounded-2xl border-0 bg-gradient-to-br from-[#b6cf9f] to-[#6f8f5d] px-3 py-2 text-left shadow-[0_8px_18px_rgba(74,102,64,0.2)] transition min-h-[72px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3e2d]/40"
          onClick={() => setActiveSection('real_estate')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setActiveSection('real_estate');
            }
          }}
          aria-label="Entrar a Bienes raíces"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f3e2d]">
              <Home size={15} /> Bienes raíces
            </div>
            <div className="pr-6 text-right break-words">
              <div className="text-base font-bold leading-tight text-[#1f3e2d]">
                {showNetWorth
                  ? hasRealEstateCoreInputs
                    ? formatCurrency(sectionAmountsDisplay.realEstateNet, displayCurrency)
                    : 'Sin datos'
                  : '••••'}
              </div>
              {showNetWorth && blockVariationsDisplay?.realEstateNet && hasRealEstateCoreInputs ? (
                <div className={cn('mt-0.5 text-[11px] font-medium', variationToneClass(blockVariationsDisplay.realEstateNet.trend))}>
                  · {blockVariationsDisplay.realEstateNet.text}
                </div>
              ) : null}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#2d5a3b]/30 bg-white/35 text-[#2d5a3b]/80">
            <ArrowRight size={11} />
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          className="relative rounded-2xl border border-sky-200 bg-gradient-to-br from-[#e7f3ff] to-[#cfe5f8] px-3 py-2 text-left shadow-[0_8px_18px_rgba(70,120,170,0.16)] transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45 min-h-[72px]"
          onClick={() => setActiveSection('bank')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setActiveSection('bank');
            }
          }}
          aria-label="Entrar a Bancos"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-900">
              <Building2 size={15} /> Bancos
            </div>
            <div className="pr-6 text-right break-words">
              <div className="text-base font-bold leading-tight text-sky-900">
                {showNetWorth ? formatCurrency(sectionAmountsDisplay.bank, displayCurrency) : '••••'}
              </div>
              {showNetWorth && blockVariationsDisplay?.bank ? (
                <div className={cn('mt-0.5 text-[11px] font-medium', variationToneClass(blockVariationsDisplay.bank.trend))}>
                  · {blockVariationsDisplay.bank.text}
                </div>
              ) : null}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-300 bg-white/35 text-sky-700/80">
            <ArrowRight size={11} />
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          className="relative rounded-2xl border border-rose-200 bg-gradient-to-br from-[#ffe9e8] to-[#ffd7d7] px-3 py-2 text-left shadow-[0_8px_18px_rgba(165,68,68,0.16)] transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/45 min-h-[72px]"
          onClick={() => setActiveSection('bank')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setActiveSection('bank');
            }
          }}
          aria-label="Entrar a deudas no hipotecarias"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-900">
              <Trash2 size={15} /> Deudas no hipotecarias
            </div>
            <div className="pr-6 text-right break-words">
              <div className="text-base font-bold leading-tight text-rose-900">
                {showNetWorth ? `-${formatCurrency(sectionAmountsDisplay.nonMortgageDebt, displayCurrency)}` : '••••'}
              </div>
              {showNetWorth && blockVariationsDisplay?.nonMortgageDebt ? (
                <div className={cn('mt-0.5 text-[11px] font-medium', variationToneClass(blockVariationsDisplay.nonMortgageDebt.trend))}>
                  · {blockVariationsDisplay.nonMortgageDebt.text}
                </div>
              ) : null}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-300 bg-white/35 text-rose-700/80">
            <ArrowRight size={11} />
          </div>
        </div>
      </div>

      <Card
        className={cn(
          'p-3',
          monthKey !== realCurrentMonthKey
            ? 'border border-amber-300 bg-amber-50'
            : 'border border-slate-200 bg-slate-50',
        )}
      >
        <div className="text-sm font-semibold text-slate-900">Mes de carga</div>
        <div className="mt-1 text-xs text-slate-600">
          {monthKey !== realCurrentMonthKey
            ? `Modo histórico activo: estás cargando ${monthLabel(monthKey).toLowerCase()}.`
            : `Mes en curso activo: ${monthLabel(monthKey).toLowerCase()}.`}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Meses permitidos: operativo, calendario actual y siguiente calendario.
        </div>
        <div className="mt-2">
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            value={monthKey}
            onChange={(e) => {
              const nextMonth = String(e.target.value || '');
              if (!selectableLoadMonthKeys.includes(nextMonth)) {
                setCarryMessage('Ese mes no está habilitado para carga.');
                return;
              }
              setMonthKey(nextMonth);
            }}
          >
            {selectableLoadMonthKeys.map((key) => (
              <option key={key} value={key}>
                {monthLabel(key)}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cierre mensual manual</div>
          <Button size="sm" onClick={runMonthlyClose}>
            Cerrar mes
          </Button>
        </div>
        {!!closeInfo && <div className="text-xs text-emerald-700">{closeInfo}</div>}
        {!!closeError && <div className="text-xs text-red-700">{closeError}</div>}

        {latestClosure && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">Último cierre: {latestClosure.monthKey}</div>
            <div>
              Neto consolidado:{' '}
              {formatCurrency(latestClosureDisplay ?? latestClosure.summary.netConsolidatedClp, displayCurrency)}
            </div>
            {growthVsPrevClosureDisplay && (
              <div className={growthVsPrevClosureDisplay.abs >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                vs cierre anterior: {growthVsPrevClosureDisplay.abs >= 0 ? '+' : ''}
                {formatCurrency(growthVsPrevClosureDisplay.abs, displayCurrency)}
                {growthVsPrevClosureDisplay.pct !== null ? ` (${growthVsPrevClosureDisplay.pct.toFixed(2)}%)` : ''}
              </div>
            )}
          </div>
        )}

      </Card>

      <CloseConfirmModal
        open={closeConfirmOpen}
        closeMonthDraft={closeMonthDraft}
        monthKey={monthKey}
        realCurrentMonthKey={realCurrentMonthKey}
        selectedClosureMonthKey={selectedClosureForDraft?.monthKey}
        recentCloseWarning={recentCloseWarning}
        closeBlockingIssues={closeBlockingIssues}
        closeWarningIssues={closeWarningIssues}
        closeInfo={closeInfo}
        closeError={closeError}
        closeFxReady={closeFxReady}
        closePreview={closePreview}
        closeFxDraft={closeFxDraft}
        monthLabel={monthLabel}
        onCloseMonthDraftChange={setCloseMonthDraft}
        onCloseFxDraftChange={(next) =>
          setCloseFxDraft((prev) => ({
            usdClp: next.usdClp ?? prev.usdClp,
            eurClp: next.eurClp ?? prev.eurClp,
            ufClp: next.ufClp ?? prev.ufClp,
          }))
        }
        onResolveWithPrevious={resolveCloseIssueWithPrevious}
        onResolveExclude={resolveCloseIssueExclude}
        onReview={reviewCloseIssue}
        onCancel={() => {
          setCloseConfirmOpen(false);
          setCloseError('');
          setCloseInfo('');
        }}
        onAttemptClose={attemptMonthlyClose}
      />

      {showCurrentMonthActionBar && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40">
          <div className="mx-auto w-full max-w-xl px-3">
            <Card className="pointer-events-auto border border-slate-200 bg-white/95 p-2 shadow-[0_10px_26px_rgba(15,23,42,0.18)] backdrop-blur">
              <div className="grid grid-cols-4 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-9 px-1 text-[11px]', startMonthActionButtonClass('carry'))}
                  onClick={() => setCarryConfirmOpen(true)}
                  disabled={!previousClosureForMonthStart || startMonthRunning}
                  title={
                    previousClosureForMonthStart
                      ? `Arrastrar valores desde ${monthLabel(previousClosureForMonthStart.monthKey)}`
                      : 'No hay cierre anterior para arrastrar'
                  }
                >
                  Arrastrar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-9 px-1 text-[11px]', startMonthActionButtonClass('fx'))}
                  onClick={() => {
                    void runStartMonthFxUpdate();
                  }}
                  disabled={startMonthRunning}
                >
                  TC/UF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-9 px-1 text-[11px]', startMonthActionButtonClass('banks'))}
                  onClick={() => {
                    void runStartMonthBanksUpdate();
                  }}
                  disabled={!startMonthBanksOptionEnabled || startMonthRunning}
                  title={
                    startMonthBanksOptionEnabled
                      ? 'Actualizar saldos vía Fintoc'
                      : 'Configura tokens en Ajustes'
                  }
                >
                  Bancos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-9 px-1 text-[11px]', startMonthActionButtonClass('realEstate'))}
                  onClick={runStartMonthRealEstateUpdate}
                  disabled={startMonthRunning}
                >
                  Bienes raíces
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={carryConfirmOpen}
        busy={startMonthRunning}
        title="Arrastrar valores del último cierre"
        message={
          carrySourceMonthLabel
            ? `¿Arrastrar todos los valores de ${carrySourceMonthLabel}?`
            : 'No hay cierre anterior disponible para arrastrar.'
        }
        confirmText="Arrastrar valores"
        cancelText="Cancelar"
        onConfirm={() => {
          void runStartMonthFlow();
        }}
        onCancel={() => setCarryConfirmOpen(false)}
      />
    </div>
  );
};
