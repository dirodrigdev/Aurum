import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureAuthPersistence, getCurrentUid } from './firebase';
import { setFirestoreChecking, setFirestoreOk, setFirestoreStatusFromError } from './firestoreStatus';

export type WealthCurrency = 'CLP' | 'USD' | 'EUR' | 'UF';

export type WealthBlock = 'bank' | 'investment' | 'real_estate' | 'debt';

export interface WealthRecord {
  id: string;
  block: WealthBlock;
  source: string;
  label: string;
  amount: number;
  currency: WealthCurrency;
  snapshotDate: string;
  createdAt: string;
  note?: string;
}

export interface WealthFxRates {
  usdClp: number;
  eurClp: number;
  ufClp: number;
}

export interface WealthSnapshotSummary {
  netByCurrency: Record<WealthCurrency, number>;
  assetsByCurrency: Record<WealthCurrency, number>;
  debtsByCurrency: Record<WealthCurrency, number>;
  netConsolidatedClp: number;
  byBlock: Record<WealthBlock, Record<WealthCurrency, number>>;
}

export interface WealthMonthlyClosure {
  id: string;
  monthKey: string;
  closedAt: string;
  summary: WealthSnapshotSummary;
  fxRates?: WealthFxRates;
  fxMissing?: Array<'usdClp' | 'eurClp' | 'ufClp'>;
  records?: WealthRecord[];
  previousVersions?: WealthMonthlyClosureVersion[];
}

export interface WealthMonthlyClosureVersion {
  id: string;
  monthKey: string;
  closedAt: string;
  replacedAt?: string;
  summary: WealthSnapshotSummary;
  fxRates?: WealthFxRates;
  fxMissing?: Array<'usdClp' | 'eurClp' | 'ufClp'>;
  records?: WealthRecord[];
}

export interface WealthClosureCompleteness {
  monthKey: string;
  missingFieldLabels: string[];
  missingFx: boolean;
}

export interface WealthInvestmentInstrument {
  id: string;
  label: string;
  currency: WealthCurrency;
  createdAt: string;
  note?: string;
  excludedMonths?: string[];
}

export const FINTOC_BANK_PROVIDER_IDS = ['bchile', 'scotia', 'santander'] as const;
export type WealthBankProviderId = (typeof FINTOC_BANK_PROVIDER_IDS)[number];
export type WealthBankTokenMap = Partial<Record<WealthBankProviderId, string>>;

export interface MortgageAutoCalcConfig {
  initialDebtUf: number;
  dividendUf: number;
  interestUf: number;
  fireInsuranceUf: number;
  lifeInsuranceUf: number;
}

export type FxLiveSyncMeta = {
  source: string;
  fetchedAt: string;
  status: 'ok' | 'error';
  message?: string;
};

export type HistoricalCsvImportResult = {
  importedMonths: string[];
  replacedMonths: string[];
  skippedMonths: string[];
  warnings: string[];
};

export type HistoricalCsvPreviewResult = {
  monthKeys: string[];
  totalRows: number;
  invalidMonthRows: number[];
  warnings: string[];
};

type WealthDemoSeedMeta = {
  seededAt: string;
  janKey: string;
  febKey: string;
  marKey: string;
  historyMonthKeys: string[];
};

const RECORDS_KEY = 'wealth_records_v1';
const CLOSURES_KEY = 'wealth_closures_v1';
const FX_KEY = 'wealth_fx_v1';
const BANK_TOKENS_KEY = 'wealth_bank_tokens_v1';
const INSTRUMENTS_KEY = 'wealth_investment_instruments_v1';
const DELETED_RECORD_IDS_KEY = 'wealth_deleted_record_ids_v1';
const DELETED_RECORD_ASSET_MONTH_KEYS_KEY = 'wealth_deleted_record_asset_month_keys_v1';
const WEALTH_UPDATED_AT_KEY = 'wealth_updated_at_v1';
const WEALTH_LAST_REMOTE_UPDATED_AT_KEY = 'wealth_last_remote_updated_at_v1';
const WEALTH_DEMO_SEED_META_KEY = 'wealth_demo_seed_meta_v1';
const WEALTH_FX_LIVE_META_KEY = 'wealth_fx_live_meta_v1';
const WEALTH_FX_LAST_AUTO_DAY_KEY = 'wealth_fx_last_auto_day_v1';
const WEALTH_FX_LAST_AUTO_ATTEMPT_DAY_KEY = 'wealth_fx_last_auto_attempt_day_v1';
const WEALTH_INCLUDE_RISK_CAPITAL_KEY = 'wealth_include_risk_capital_totals_v1';
const LEGACY_FINTOC_LINK_TOKEN_KEY = 'aurum.fintoc.link_token';
const LEGACY_FINTOC_BANK_TOKENS_KEY = 'aurum.fintoc.bank_tokens.v1';
export const FX_RATES_UPDATED_EVENT = 'aurum:fx-rates-updated';
export const FX_LIVE_META_UPDATED_EVENT = 'aurum:fx-live-meta-updated';
export const WEALTH_DATA_UPDATED_EVENT = 'aurum:wealth-data-updated';
export const RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT = 'aurum:risk-capital-totals-updated';
const WEALTH_CLOUD_DOC_COLLECTION = 'aurum_wealth';
const WEALTH_SYNC_ISSUE_KEY = 'aurum:wealth-sync-issue';

type PersistOptions = {
  skipCloudSync?: boolean;
  silent?: boolean;
};

export const mortgageAutoCalcDefaults: MortgageAutoCalcConfig = {
  initialDebtUf: 8831.535,
  dividendUf: 53.2439,
  interestUf: 21.3361,
  fireInsuranceUf: 3.67,
  lifeInsuranceUf: 0.4716,
};

const nowIso = () => new Date().toISOString();

const isFirebaseConfigured = () =>
  Boolean(
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
      import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_APP_ID,
  );

const isoToMs = (value: string) => {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
};

const readLastRemoteUpdatedAtMs = () => {
  try {
    const raw = String(localStorage.getItem(WEALTH_LAST_REMOTE_UPDATED_AT_KEY) || '');
    const ms = isoToMs(raw);
    return Number.isFinite(ms) ? ms : NaN;
  } catch {
    return NaN;
  }
};

const markLastRemoteUpdatedAt = (iso: string) => {
  const ms = isoToMs(iso);
  if (!Number.isFinite(ms)) return;
  try {
    const currentMs = readLastRemoteUpdatedAtMs();
    const nextMs = !Number.isFinite(currentMs) ? ms : Math.max(currentMs, ms);
    localStorage.setItem(WEALTH_LAST_REMOTE_UPDATED_AT_KEY, new Date(nextMs).toISOString());
  } catch {
    // ignore
  }
};

const nextMonotonicIsoAgainstRemote = () => {
  const localUpdatedMs = isoToMs(readWealthUpdatedAt());
  const remoteMs = readLastRemoteUpdatedAtMs();
  const nowMs = Date.now();
  const safeLocalMs = Number.isFinite(localUpdatedMs) ? localUpdatedMs : 0;
  const safeRemoteMs = Number.isFinite(remoteMs) ? remoteMs : 0;
  const nextMs = Math.max(nowMs, safeLocalMs, safeRemoteMs) + 1;
  return new Date(nextMs).toISOString();
};

const touchWealthUpdatedAt = () => {
  const stamp = nextMonotonicIsoAgainstRemote();
  try {
    localStorage.setItem(WEALTH_UPDATED_AT_KEY, stamp);
  } catch {
    // ignore
  }
  return stamp;
};

const writeWealthUpdatedAt = (iso: string) => {
  try {
    localStorage.setItem(WEALTH_UPDATED_AT_KEY, iso || nowIso());
  } catch {
    // ignore
  }
};

const readWealthUpdatedAt = () => {
  try {
    return String(localStorage.getItem(WEALTH_UPDATED_AT_KEY) || '');
  } catch {
    return '';
  }
};

const dispatchWealthDataUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WEALTH_DATA_UPDATED_EVENT));
  }
};

const setLastWealthSyncIssue = (message: string) => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(WEALTH_SYNC_ISSUE_KEY, message || '');
  } catch {
    // ignore
  }
};

export const getLastWealthSyncIssue = () => {
  try {
    if (typeof window === 'undefined') return '';
    return String(window.localStorage.getItem(WEALTH_SYNC_ISSUE_KEY) || '');
  } catch {
    return '';
  }
};

const loadDemoSeedMeta = (): WealthDemoSeedMeta | null => {
  try {
    const raw = localStorage.getItem(WEALTH_DEMO_SEED_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const janKey = normalizeMonthKey(parsed?.janKey);
    const febKey = normalizeMonthKey(parsed?.febKey);
    const marKey = normalizeMonthKey(parsed?.marKey);
    const historyMonthKeys: string[] = Array.isArray(parsed?.historyMonthKeys)
      ? parsed.historyMonthKeys
          .map((m: unknown) => normalizeMonthKey(m))
          .filter((m: string | null): m is string => !!m)
      : [];
    if (!janKey || !febKey || !marKey || historyMonthKeys.length === 0) return null;
    return {
      seededAt: String(parsed?.seededAt || ''),
      janKey,
      febKey,
      marKey,
      historyMonthKeys: Array.from(new Set<string>(historyMonthKeys)),
    };
  } catch {
    return null;
  }
};

const saveDemoSeedMeta = (meta: WealthDemoSeedMeta | null) => {
  try {
    if (!meta) {
      localStorage.removeItem(WEALTH_DEMO_SEED_META_KEY);
      return;
    }
    localStorage.setItem(WEALTH_DEMO_SEED_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
};

export const loadFxLiveSyncMeta = (): FxLiveSyncMeta | null => {
  try {
    const raw = localStorage.getItem(WEALTH_FX_LIVE_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const status = parsed?.status === 'error' ? 'error' : parsed?.status === 'ok' ? 'ok' : null;
    if (!status) return null;
    return {
      source: String(parsed?.source || ''),
      fetchedAt: String(parsed?.fetchedAt || ''),
      status,
      message: parsed?.message ? String(parsed.message) : undefined,
    };
  } catch {
    return null;
  }
};

const saveFxLiveSyncMeta = (meta: FxLiveSyncMeta) => {
  try {
    localStorage.setItem(WEALTH_FX_LIVE_META_KEY, JSON.stringify(meta));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FX_LIVE_META_UPDATED_EVENT, { detail: meta }));
    }
  } catch {
    // ignore
  }
};

const readFxLastAutoSyncDay = () => {
  try {
    return String(localStorage.getItem(WEALTH_FX_LAST_AUTO_DAY_KEY) || '');
  } catch {
    return '';
  }
};

const writeFxLastAutoSyncDay = (ymd: string) => {
  try {
    localStorage.setItem(WEALTH_FX_LAST_AUTO_DAY_KEY, ymd);
  } catch {
    // ignore
  }
};

const readFxLastAutoAttemptDay = () => {
  try {
    return String(localStorage.getItem(WEALTH_FX_LAST_AUTO_ATTEMPT_DAY_KEY) || '');
  } catch {
    return '';
  }
};

const writeFxLastAutoAttemptDay = (ymd: string) => {
  try {
    localStorage.setItem(WEALTH_FX_LAST_AUTO_ATTEMPT_DAY_KEY, ymd);
  } catch {
    // ignore
  }
};

const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeLabelKey = (value: string) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CLOSURE_REQUIRED_FIELDS: Array<{ label: string; canonicalLabel: string }> = [
  { label: 'SURA inversión financiera', canonicalLabel: 'sura inversion financiera' },
  { label: 'SURA ahorro previsional', canonicalLabel: 'sura ahorro previsional' },
  { label: 'BTG total valorización', canonicalLabel: 'btg total valorizacion' },
  { label: 'PlanVital saldo total', canonicalLabel: 'planvital saldo total' },
  { label: 'Global66 Cuenta Vista USD', canonicalLabel: 'global66 cuenta vista usd' },
  { label: 'Wise Cuenta principal USD', canonicalLabel: 'wise cuenta principal usd' },
  { label: 'Valor propiedad', canonicalLabel: 'valor propiedad' },
  { label: 'Saldo deuda hipotecaria', canonicalLabel: 'saldo deuda hipotecaria' },
  { label: 'Saldo bancos CLP', canonicalLabel: 'saldo bancos clp' },
  { label: 'Saldo bancos USD', canonicalLabel: 'saldo bancos usd' },
  { label: 'Deuda tarjetas CLP', canonicalLabel: 'deuda tarjetas clp' },
  { label: 'Deuda tarjetas USD', canonicalLabel: 'deuda tarjetas usd' },
];
const CLOSURE_CANONICAL_ALIASES: Record<string, string[]> = {
  'saldo bancos clp': ['bancos clp historico'],
  'saldo bancos usd': ['bancos usd historico'],
  'deuda tarjetas clp': ['tarjetas clp historico'],
  'deuda tarjetas usd': ['tarjetas usd historico'],
};

export const RISK_CAPITAL_LABEL_CLP = 'Capital de riesgo CLP';
export const RISK_CAPITAL_LABEL_USD = 'Capital de riesgo USD';
export const RISK_CAPITAL_LABELS = [RISK_CAPITAL_LABEL_CLP, RISK_CAPITAL_LABEL_USD] as const;
const RISK_CAPITAL_LABEL_KEYS = new Set(RISK_CAPITAL_LABELS.map((label) => normalizeLabelKey(label)));

export const isRiskCapitalInvestmentLabel = (label: string) =>
  RISK_CAPITAL_LABEL_KEYS.has(normalizeLabelKey(label));

export const filterRecordsByRiskCapitalPreference = (
  records: WealthRecord[],
  includeRiskCapital: boolean,
) => {
  if (includeRiskCapital) return records;
  return records.filter(
    (record) =>
      !(
        record.block === 'investment' &&
        isRiskCapitalInvestmentLabel(record.label)
      ),
  );
};

export const loadIncludeRiskCapitalInTotals = () => {
  try {
    const raw = String(localStorage.getItem(WEALTH_INCLUDE_RISK_CAPITAL_KEY) || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'on';
  } catch {
    return false;
  }
};

export const saveIncludeRiskCapitalInTotals = (includeRiskCapital: boolean) => {
  try {
    localStorage.setItem(WEALTH_INCLUDE_RISK_CAPITAL_KEY, includeRiskCapital ? '1' : '0');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT, {
          detail: { includeRiskCapital },
        }),
      );
    }
  } catch {
    // ignore
  }
};

export const isSyntheticAggregateRecord = (record: Pick<WealthRecord, 'label' | 'block'>) => {
  const label = normalizeText(record.label);
  if (record.block === 'bank') {
    return label === normalizeText('Saldo bancos CLP') || label === normalizeText('Saldo bancos USD');
  }
  return false;
};

const AGGREGATE_DEBT_LABELS_CLP = new Set([
  normalizeText('Deuda tarjetas CLP'),
  normalizeText('Tarjetas CLP histórico'),
]);

const AGGREGATE_DEBT_LABELS_USD = new Set([
  normalizeText('Deuda tarjetas USD'),
  normalizeText('Tarjetas USD histórico'),
]);

const MANUAL_CARD_LABEL_KEYS = new Set(
  [
    'Visa Banco de Chile',
    'Visa Scotia',
    'Mastercard Scotia',
    'Mastercard Falabella',
    'Mastercard Santander',
    'American Express Santander',
  ].map(normalizeText),
);

const NON_MORTGAGE_DEBT_LABEL_HINTS = [
  'tarjeta',
  'mastercard',
  'visa',
  'american express',
  'amex',
  'deuda no hipotecaria',
];

const isNonMortgageDebtRecord = (record: Pick<WealthRecord, 'block' | 'label' | 'source'>) => {
  if (isMortgagePrincipalDebtLabel(record.label) || isMortgageMetaDebtLabel(record.label)) return false;

  const label = normalizeText(record.label);
  const source = normalizeText(record.source);

  if (record.block === 'debt') return true;
  if (record.block !== 'bank') return false;

  if (AGGREGATE_DEBT_LABELS_CLP.has(label) || AGGREGATE_DEBT_LABELS_USD.has(label)) return true;
  if (MANUAL_CARD_LABEL_KEYS.has(label)) return true;
  if (label.startsWith(normalizeText('Tarjeta crédito:'))) return true;
  if (NON_MORTGAGE_DEBT_LABEL_HINTS.some((hint) => label.includes(hint))) return true;
  if (source.includes('tarjetas')) return true;

  return false;
};

export const isMortgageMetaDebtLabel = (labelValue: string) => {
  const label = normalizeText(labelValue);
  return (
    label.includes(normalizeText('dividendo hipotecario')) ||
    label.includes(normalizeText('amortizacion hipotecaria')) ||
    label.includes(normalizeText('interes hipotecario')) ||
    label.includes(normalizeText('seguros hipotecarios'))
  );
};

const isMortgageDebtLabel = (labelValue: string) => {
  const label = normalizeText(labelValue);
  return isMortgageMetaDebtLabel(labelValue) || label.includes(normalizeText('saldo deuda hipotecaria'));
};

export const isMortgagePrincipalDebtLabel = (labelValue: string) =>
  normalizeText(labelValue).includes(normalizeText('saldo deuda hipotecaria'));

const isDeprecatedSuraTotalRecord = (
  record: Pick<WealthRecord, 'label' | 'source' | 'block'>,
) => {
  const normalizedLabel = normalizeText(record.label);
  if (!normalizedLabel.includes('sura saldo total')) return false;
  const normalizedSource = normalizeText(record.source);
  return normalizedSource.includes('sura') || record.block === 'investment';
};

const remapLegacyInvestmentBanks = (
  block: WealthBlock,
  source: string,
  label: string,
): WealthBlock => {
  if (block !== 'bank') return block;
  const token = `${normalizeText(source)} ${normalizeText(label)}`;
  if (token.includes('wise') || token.includes('global66')) return 'investment';
  return block;
};

const normalizeRecord = (item: any): WealthRecord => ({
  ...(() => {
    const block = remapLegacyInvestmentBanks(
      (item?.block || 'investment') as WealthBlock,
      String(item?.source || 'manual'),
      String(item?.label || 'Registro'),
    );
    const rawAmount = toNumber(item?.amount);
    const normalizedAmount = block === 'debt' ? Math.abs(rawAmount) : rawAmount;
    const base = {
      id: String(item?.id || crypto.randomUUID()),
      block,
      source: String(item?.source || 'manual'),
      label: String(item?.label || 'Registro'),
      amount: normalizedAmount,
      currency: (item?.currency || 'CLP') as WealthCurrency,
      snapshotDate: String(item?.snapshotDate || localYmd()),
      createdAt: String(item?.createdAt || nowIso()),
    } satisfies Omit<WealthRecord, 'note'>;

    const note = item?.note ? String(item.note) : '';
    return note ? { ...base, note } : base;
  })(),
});

const normalizeMonthKey = (value: unknown): string | null => {
  const month = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
};

const normalizeBankTokensFromRaw = (raw: unknown): WealthBankTokenMap => {
  if (!raw || typeof raw !== 'object') return {};
  const parsed = raw as Record<string, unknown>;
  const normalized: WealthBankTokenMap = {};
  for (const providerId of FINTOC_BANK_PROVIDER_IDS) {
    const token = String(parsed[providerId] || '').trim();
    if (token) normalized[providerId] = token;
  }
  return normalized;
};

const loadBankTokensFromLocalStorageOnly = (): WealthBankTokenMap => {
  try {
    const raw = localStorage.getItem(BANK_TOKENS_KEY);
    if (!raw) return {};
    return normalizeBankTokensFromRaw(JSON.parse(raw));
  } catch {
    return {};
  }
};

const loadLegacyBankTokens = (): WealthBankTokenMap => {
  try {
    const raw = localStorage.getItem(LEGACY_FINTOC_BANK_TOKENS_KEY);
    const parsed = raw ? normalizeBankTokensFromRaw(JSON.parse(raw)) : {};
    const legacyLinkToken = String(localStorage.getItem(LEGACY_FINTOC_LINK_TOKEN_KEY) || '').trim();
    if (legacyLinkToken && !parsed.bchile) parsed.bchile = legacyLinkToken;
    return parsed;
  } catch {
    return {};
  }
};

const normalizeInvestmentInstrument = (item: any): WealthInvestmentInstrument => {
  const excludedMonths = Array.isArray(item?.excludedMonths)
    ? item.excludedMonths
        .map((m: unknown) => normalizeMonthKey(m))
        .filter((m: string | null): m is string => !!m)
    : [];

  const base = {
    id: String(item?.id || crypto.randomUUID()),
    label: String(item?.label || '').trim(),
    currency: ((item?.currency || 'CLP') as WealthCurrency),
    createdAt: String(item?.createdAt || nowIso()),
  } satisfies Omit<WealthInvestmentInstrument, 'note' | 'excludedMonths'>;

  const note = item?.note ? String(item.note).trim() : '';
  const withNote = note ? { ...base, note } : base;
  return excludedMonths.length ? { ...withNote, excludedMonths } : withNote;
};

const stripUndefinedDeep = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = stripUndefinedDeep(val);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
};

export const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function localYmd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const defaultFxRates: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
};

const sortByCreatedDesc = (a: WealthRecord, b: WealthRecord) => {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
};

const compareClosuresByMonthDesc = (a: WealthMonthlyClosure, b: WealthMonthlyClosure) => {
  const byMonth = b.monthKey.localeCompare(a.monthKey);
  if (byMonth !== 0) return byMonth;
  return new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime();
};

const compareClosureVersionsByClosedAtDesc = (
  a: WealthMonthlyClosureVersion,
  b: WealthMonthlyClosureVersion,
) => {
  const byMonth = b.monthKey.localeCompare(a.monthKey);
  if (byMonth !== 0) return byMonth;
  return new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime();
};

const normalizeClosureFxRates = (raw: any): WealthFxRates | undefined => {
  if (!raw) return undefined;
  return {
    usdClp: Math.max(1, toNumber(raw?.usdClp, defaultFxRates.usdClp)),
    eurClp: Math.max(1, toNumber(raw?.eurClp, defaultFxRates.eurClp)),
    ufClp: Math.max(1, toNumber(raw?.ufClp, defaultFxRates.ufClp)),
  };
};

const normalizeClosureRecords = (raw: any): WealthRecord[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((r: any) => normalizeRecord(r))
    .filter((r: WealthRecord) => !isDeprecatedSuraTotalRecord(r));
};

const toClosureVersion = (
  closure: WealthMonthlyClosure,
  replacedAt?: string,
): WealthMonthlyClosureVersion => ({
  id: String(closure.id || crypto.randomUUID()),
  monthKey: String(closure.monthKey || ''),
  closedAt: String(closure.closedAt || nowIso()),
  replacedAt: replacedAt ? String(replacedAt) : undefined,
  summary: closure.summary,
  fxRates: closure.fxRates ? { ...closure.fxRates } : undefined,
  fxMissing: closure.fxMissing ? [...closure.fxMissing] : undefined,
  records: closure.records ? closure.records.map((record) => ({ ...record })) : undefined,
});

const normalizeClosureVersion = (
  raw: any,
  fallbackMonthKey: string,
): WealthMonthlyClosureVersion | null => {
  const monthKey = String(raw?.monthKey || fallbackMonthKey || '');
  if (!monthKey) return null;

  const fxRates = normalizeClosureFxRates(raw?.fxRates);
  const fxMissingRaw = Array.isArray(raw?.fxMissing) ? raw.fxMissing : [];
  const fxMissing = fxMissingRaw
    .map((key: unknown) => String(key || '').trim())
    .filter((key: string): key is 'usdClp' | 'eurClp' | 'ufClp' =>
      key === 'usdClp' || key === 'eurClp' || key === 'ufClp',
    );
  const records = normalizeClosureRecords(raw?.records);
  const summary =
    records && records.length
      ? summarizeWealth(dedupeLatestByAsset(records), fxRates || defaultFxRates)
      : raw?.summary;
  if (!summary) return null;

  return {
    id: String(raw?.id || crypto.randomUUID()),
    monthKey,
    closedAt: String(raw?.closedAt || nowIso()),
    replacedAt: raw?.replacedAt ? String(raw.replacedAt) : undefined,
    summary,
    fxRates,
    fxMissing: fxMissing.length ? fxMissing : undefined,
    records,
  };
};

const mergeClosureVersions = (
  ...lists: Array<Array<WealthMonthlyClosureVersion> | undefined>
): WealthMonthlyClosureVersion[] => {
  const map = new Map<string, WealthMonthlyClosureVersion>();
  lists.forEach((list) => {
    (list || []).forEach((item) => {
      if (!item?.monthKey || !item?.summary) return;
      const key = `${item.monthKey}::${item.id || ''}::${item.closedAt || ''}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, item);
        return;
      }
      const tPrev = new Date(prev.closedAt).getTime();
      const tCurr = new Date(item.closedAt).getTime();
      map.set(key, tCurr >= tPrev ? item : prev);
    });
  });
  return [...map.values()].sort(compareClosureVersionsByClosedAtDesc).slice(0, 36);
};

export const makeAssetKey = (record: Pick<WealthRecord, 'block' | 'label' | 'currency'>) => {
  return `${record.block}::${normalizeText(record.label)}::${record.currency}`;
};

const logicalRecordKey = (record: WealthRecord) => `${makeAssetKey(record)}::${record.snapshotDate}`;
const monthKeyFromSnapshotDate = (snapshotDate: string) => normalizeMonthKey(String(snapshotDate || '').slice(0, 7));
const makeAssetMonthKey = (
  record: Pick<WealthRecord, 'block' | 'source' | 'label' | 'currency' | 'snapshotDate'>,
) => {
  const monthKey = monthKeyFromSnapshotDate(record.snapshotDate);
  return monthKey ? `${makeAssetKey(record)}::${monthKey}` : '';
};

const recordTimestamp = (record: WealthRecord) => {
  const t = new Date(record.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
};

const pickLatestRecord = (a: WealthRecord, b: WealthRecord): WealthRecord => {
  const ta = recordTimestamp(a);
  const tb = recordTimestamp(b);
  if (tb > ta) return b;
  if (ta > tb) return a;
  return b;
};

const normalizeRecordsFromRaw = (raw: any[]): WealthRecord[] =>
  raw
    .map((item: any) => normalizeRecord(item))
    .filter((item: WealthRecord) => Number.isFinite(item.amount))
    .filter((item: WealthRecord) => !isDeprecatedSuraTotalRecord(item));

const normalizeDeletedRecordIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const unique = new Set(
    raw
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  return [...unique].sort((a, b) => a.localeCompare(b));
};

const normalizeDeletedRecordAssetMonthKeys = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const unique = new Set(
    raw
      .map((value) => String(value || '').trim())
      .filter((value) => value.includes('::')),
  );
  return [...unique].sort((a, b) => a.localeCompare(b));
};

const mergeDeletedRecordIds = (localIds: string[], remoteIds: string[]): string[] => {
  return normalizeDeletedRecordIds([...localIds, ...remoteIds]);
};

const mergeDeletedRecordAssetMonthKeys = (localKeys: string[], remoteKeys: string[]): string[] => {
  return normalizeDeletedRecordAssetMonthKeys([...localKeys, ...remoteKeys]);
};

const mergeRecords = (localRecords: WealthRecord[], remoteRecords: WealthRecord[]): WealthRecord[] => {
  const merged = new Map<string, WealthRecord>();
  for (const item of [...localRecords, ...remoteRecords]) {
    const key = logicalRecordKey(item);
    const prev = merged.get(key);
    merged.set(key, prev ? pickLatestRecord(prev, item) : item);
  }
  return [...merged.values()].sort(sortByCreatedDesc);
};

const normalizeFxRates = (raw: any): WealthFxRates => ({
  usdClp: Math.max(1, toNumber(raw?.usdClp, defaultFxRates.usdClp)),
  eurClp: Math.max(1, toNumber(raw?.eurClp, defaultFxRates.eurClp)),
  ufClp: Math.max(1, toNumber(raw?.ufClp, defaultFxRates.ufClp)),
});

const serializeRecord = (r: WealthRecord) =>
  `${r.id}|${r.block}|${r.source}|${r.label}|${r.amount}|${r.currency}|${r.snapshotDate}|${r.createdAt}|${r.note || ''}`;

const sameRecords = (a: WealthRecord[], b: WealthRecord[]) => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(sortByCreatedDesc).map(serializeRecord);
  const sb = [...b].sort(sortByCreatedDesc).map(serializeRecord);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
};

const serializeInstrument = (item: WealthInvestmentInstrument) => {
  const excluded = [...(item.excludedMonths || [])].sort().join(',');
  return `${normalizeText(item.label)}|${item.currency}|${item.note || ''}|${excluded}|${item.createdAt}`;
};

const sameInvestmentInstruments = (a: WealthInvestmentInstrument[], b: WealthInvestmentInstrument[]) => {
  if (a.length !== b.length) return false;
  const sa = [...a]
    .sort((x, y) => normalizeText(x.label).localeCompare(normalizeText(y.label)))
    .map(serializeInstrument);
  const sb = [...b]
    .sort((x, y) => normalizeText(x.label).localeCompare(normalizeText(y.label)))
    .map(serializeInstrument);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
};

const sameStringList = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const sameBankTokens = (a: WealthBankTokenMap, b: WealthBankTokenMap) =>
  FINTOC_BANK_PROVIDER_IDS.every((providerId) => (a[providerId] || '') === (b[providerId] || ''));

const isLocalStateNewerOrEqual = (localUpdatedAt: string, remoteUpdatedAt: string) => {
  if (!remoteUpdatedAt) return true;
  if (!localUpdatedAt) return false;
  const localMs = isoToMs(localUpdatedAt);
  const remoteMs = isoToMs(remoteUpdatedAt);
  if (!Number.isFinite(localMs) || !Number.isFinite(remoteMs)) {
    return String(localUpdatedAt) >= String(remoteUpdatedAt);
  }
  return localMs >= remoteMs;
};

type MergeWealthStateInput = {
  localRecords: WealthRecord[];
  remoteRecords: WealthRecord[];
  localClosures: WealthMonthlyClosure[];
  remoteClosures: WealthMonthlyClosure[];
  localInstruments: WealthInvestmentInstrument[];
  remoteInstruments: WealthInvestmentInstrument[];
  localBankTokens: WealthBankTokenMap;
  remoteBankTokens: WealthBankTokenMap;
  localDeletedRecordIds: string[];
  remoteDeletedRecordIds: string[];
  localDeletedRecordAssetMonthKeys: string[];
  remoteDeletedRecordAssetMonthKeys: string[];
  localFx: WealthFxRates;
  remoteFx: WealthFxRates;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
};

type MergedWealthState = {
  records: WealthRecord[];
  closures: WealthMonthlyClosure[];
  instruments: WealthInvestmentInstrument[];
  bankTokens: WealthBankTokenMap;
  deletedRecordIds: string[];
  deletedRecordAssetMonthKeys: string[];
  fx: WealthFxRates;
  preferLocal: boolean;
};

const mergeWealthState = (input: MergeWealthStateInput): MergedWealthState => {
  const preferLocal = isLocalStateNewerOrEqual(input.localUpdatedAt, input.remoteUpdatedAt);

  let deletedRecordIds = mergeDeletedRecordIds(input.localDeletedRecordIds, input.remoteDeletedRecordIds);
  let deletedRecordAssetMonthKeys = mergeDeletedRecordAssetMonthKeys(
    input.localDeletedRecordAssetMonthKeys,
    input.remoteDeletedRecordAssetMonthKeys,
  );

  // Si el lado preferido ya contiene un registro activo para ese asset/mes,
  // limpiamos tombstones contrapuestos para permitir reingresos tras borrado.
  const preferredRecords = preferLocal ? input.localRecords : input.remoteRecords;
  const preferredIdSet = new Set(preferredRecords.map((record) => record.id));
  const preferredAssetMonthSet = new Set(
    preferredRecords
      .map((record) => makeAssetMonthKey(record))
      .filter((key) => !!key),
  );
  deletedRecordIds = normalizeDeletedRecordIds(deletedRecordIds.filter((id) => !preferredIdSet.has(id)));
  deletedRecordAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys(
    deletedRecordAssetMonthKeys.filter((key) => !preferredAssetMonthSet.has(key)),
  );

  const deletedSet = new Set(deletedRecordIds);
  const deletedAssetMonthSet = new Set(deletedRecordAssetMonthKeys);
  const records = mergeRecords(input.localRecords, input.remoteRecords).filter(
    (record) => !deletedSet.has(record.id) && !deletedAssetMonthSet.has(makeAssetMonthKey(record)),
  );
  const bankTokens = normalizeBankTokensFromRaw({
    ...(preferLocal ? input.remoteBankTokens : input.localBankTokens),
    ...(preferLocal ? input.localBankTokens : input.remoteBankTokens),
  });

  return {
    records,
    closures: mergeClosures(input.localClosures, input.remoteClosures),
    instruments: mergeInvestmentInstruments(input.localInstruments, input.remoteInstruments),
    bankTokens,
    deletedRecordIds,
    deletedRecordAssetMonthKeys,
    fx: preferLocal ? input.localFx : input.remoteFx,
    preferLocal,
  };
};

export const loadWealthRecords = (): WealthRecord[] => {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => normalizeRecord(item))
      .filter((item: WealthRecord) => Number.isFinite(item.amount))
      .filter((item: WealthRecord) => !isDeprecatedSuraTotalRecord(item))
      .sort(sortByCreatedDesc);
  } catch {
    return [];
  }
};

export const loadBankTokens = (): WealthBankTokenMap => {
  const current = loadBankTokensFromLocalStorageOnly();
  const legacy = loadLegacyBankTokens();
  const merged = normalizeBankTokensFromRaw({ ...legacy, ...current });

  const same =
    Object.keys(current).length === Object.keys(merged).length &&
    FINTOC_BANK_PROVIDER_IDS.every((providerId) => (current[providerId] || '') === (merged[providerId] || ''));

  if (!same) {
    try {
      localStorage.setItem(BANK_TOKENS_KEY, JSON.stringify(merged));
      localStorage.removeItem(LEGACY_FINTOC_BANK_TOKENS_KEY);
      localStorage.removeItem(LEGACY_FINTOC_LINK_TOKEN_KEY);
    } catch {
      // ignore
    }
  }

  return merged;
};

export const saveBankTokens = (tokens: WealthBankTokenMap, options?: PersistOptions) => {
  localStorage.setItem(BANK_TOKENS_KEY, JSON.stringify(normalizeBankTokensFromRaw(tokens)));
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

export const loadInvestmentInstruments = (): WealthInvestmentInstrument[] => {
  try {
    const raw = localStorage.getItem(INSTRUMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => normalizeInvestmentInstrument(item))
      .filter((item: WealthInvestmentInstrument) => !!item.label)
      .sort((a: WealthInvestmentInstrument, b: WealthInvestmentInstrument) =>
        normalizeText(a.label).localeCompare(normalizeText(b.label)),
      );
  } catch {
    return [];
  }
};

const loadDeletedRecordIds = (): string[] => {
  try {
    const raw = localStorage.getItem(DELETED_RECORD_IDS_KEY);
    if (!raw) return [];
    return normalizeDeletedRecordIds(JSON.parse(raw));
  } catch {
    return [];
  }
};

const loadDeletedRecordAssetMonthKeys = (): string[] => {
  try {
    const raw = localStorage.getItem(DELETED_RECORD_ASSET_MONTH_KEYS_KEY);
    if (!raw) return [];
    return normalizeDeletedRecordAssetMonthKeys(JSON.parse(raw));
  } catch {
    return [];
  }
};

const saveDeletedRecordIds = (ids: string[], options?: PersistOptions) => {
  localStorage.setItem(DELETED_RECORD_IDS_KEY, JSON.stringify(normalizeDeletedRecordIds(ids)));
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

const saveDeletedRecordAssetMonthKeys = (keys: string[], options?: PersistOptions) => {
  localStorage.setItem(
    DELETED_RECORD_ASSET_MONTH_KEYS_KEY,
    JSON.stringify(normalizeDeletedRecordAssetMonthKeys(keys)),
  );
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

export const saveInvestmentInstruments = (items: WealthInvestmentInstrument[], options?: PersistOptions) => {
  localStorage.setItem(INSTRUMENTS_KEY, JSON.stringify(items));
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

export const upsertInvestmentInstrument = (input: {
  id?: string;
  label: string;
  currency: WealthCurrency;
  note?: string;
}) => {
  const normalizedLabel = String(input.label || '').trim();
  if (!normalizedLabel) return null;

  const current = loadInvestmentInstruments();
  const byId = input.id ? current.find((item) => item.id === input.id) : null;
  const byLabel = current.find((item) => normalizeText(item.label) === normalizeText(normalizedLabel));
  const existing = byId || byLabel || null;

  const nextBase = {
    id: existing?.id || input.id || crypto.randomUUID(),
    label: normalizedLabel,
    currency: input.currency,
    createdAt: existing?.createdAt || nowIso(),
  } satisfies Omit<WealthInvestmentInstrument, 'note' | 'excludedMonths'>;

  const note = String(input.note || existing?.note || '').trim();
  const next: WealthInvestmentInstrument = note ? { ...nextBase, note } : nextBase;
  if (existing?.excludedMonths?.length) next.excludedMonths = [...existing.excludedMonths];

  const merged = existing
    ? current.map((item) => (item.id === existing.id ? next : item))
    : [...current, next];

  saveInvestmentInstruments(
    merged.sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label))),
  );
  return next;
};

export const setInvestmentInstrumentMonthExcluded = (
  instrumentId: string,
  monthKey: string,
  excluded: boolean,
) => {
  const normalizedMonth = normalizeMonthKey(monthKey);
  if (!normalizedMonth) return null;

  const current = loadInvestmentInstruments();
  const idx = current.findIndex((item) => item.id === instrumentId);
  if (idx < 0) return null;

  const item = current[idx];
  const months = new Set(item.excludedMonths || []);
  if (excluded) months.add(normalizedMonth);
  else months.delete(normalizedMonth);

  const nextItem: WealthInvestmentInstrument =
    months.size > 0 ? { ...item, excludedMonths: [...months].sort() } : { ...item };
  if (months.size === 0 && 'excludedMonths' in nextItem) {
    delete nextItem.excludedMonths;
  }

  const next = [...current];
  next[idx] = nextItem;
  saveInvestmentInstruments(next);
  return nextItem;
};

export const saveWealthRecords = (records: WealthRecord[], options?: PersistOptions) => {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

export const upsertWealthRecord = (input: Omit<WealthRecord, 'id' | 'createdAt'> & { id?: string }) => {
  const current = loadWealthRecords();
  const id = input.id || crypto.randomUUID();
  const existing = current.find((r) => r.id === id);
  const numericAmount = toNumber(input.amount);
  const normalizedAmount = input.block === 'debt' ? Math.abs(numericAmount) : numericAmount;

  const nextBase = {
    id,
    // En Aurum usamos createdAt como "última actualización efectiva" para resolver
    // cuál registro manda dentro del mismo activo/mes.
    createdAt: nextMonotonicIsoAgainstRemote(),
    block: input.block,
    source: input.source,
    label: input.label,
    amount: normalizedAmount,
    currency: input.currency,
    snapshotDate: input.snapshotDate,
  } satisfies Omit<WealthRecord, 'note'>;

  const next: WealthRecord = input.note ? { ...nextBase, note: input.note } : nextBase;

  const merged = existing ? current.map((r) => (r.id === id ? next : r)) : [next, ...current];

  saveWealthRecords(merged.sort(sortByCreatedDesc));
  const deletedIds = loadDeletedRecordIds();
  if (deletedIds.includes(id)) {
    saveDeletedRecordIds(deletedIds.filter((item) => item !== id));
  }
  const assetMonthKey = makeAssetMonthKey(next);
  if (assetMonthKey) {
    const deletedAssetMonthKeys = loadDeletedRecordAssetMonthKeys();
    if (deletedAssetMonthKeys.includes(assetMonthKey)) {
      saveDeletedRecordAssetMonthKeys(
        deletedAssetMonthKeys.filter((item) => item !== assetMonthKey),
      );
    }
  }
  return next;
};

export const removeWealthRecord = (id: string) => {
  const current = loadWealthRecords();
  const removed = current.find((r) => r.id === id);
  const next = current.filter((r) => r.id !== id);
  saveWealthRecords(next);
  const deletedIds = loadDeletedRecordIds();
  if (!deletedIds.includes(id)) {
    saveDeletedRecordIds([...deletedIds, id]);
  }
  if (removed) {
    const assetMonthKey = makeAssetMonthKey(removed);
    if (assetMonthKey) {
      const deletedAssetMonthKeys = loadDeletedRecordAssetMonthKeys();
      if (!deletedAssetMonthKeys.includes(assetMonthKey)) {
        saveDeletedRecordAssetMonthKeys([...deletedAssetMonthKeys, assetMonthKey]);
      }
    }
  }
};

export const removeWealthRecordForMonthAsset = (input: {
  block: WealthBlock;
  label: string;
  currency: WealthCurrency;
  monthKey: string;
}) => {
  const monthPrefix = `${input.monthKey}-`;
  const targetLabel = normalizeLabelKey(input.label);
  const current = loadWealthRecords();
  const removedRecords: WealthRecord[] = [];

  const next = current.filter((record) => {
    const recordLabel = normalizeLabelKey(record.label);
    const sameLabel = recordLabel === targetLabel;
    const shouldRemove =
      record.block === input.block &&
      record.currency === input.currency &&
      record.snapshotDate.startsWith(monthPrefix) &&
      sameLabel;
    if (shouldRemove) removedRecords.push(record);
    return !shouldRemove;
  });

  if (removedRecords.length === 0) return 0;

  saveWealthRecords(next);
  const deletedIds = loadDeletedRecordIds();
  const mergedDeleted = normalizeDeletedRecordIds([
    ...deletedIds,
    ...removedRecords.map((record) => record.id),
  ]);
  saveDeletedRecordIds(mergedDeleted);
  const deletedAssetMonthKeys = loadDeletedRecordAssetMonthKeys();
  const mergedDeletedAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys([
    ...deletedAssetMonthKeys,
    ...removedRecords.map((record) => makeAssetMonthKey(record)),
  ]);
  saveDeletedRecordAssetMonthKeys(mergedDeletedAssetMonthKeys);
  return removedRecords.length;
};

export const loadFxRates = (): WealthFxRates => {
  try {
    const raw = localStorage.getItem(FX_KEY);
    if (!raw) return { ...defaultFxRates };
    const parsed = JSON.parse(raw);
    return {
      usdClp: Math.max(1, toNumber(parsed?.usdClp, defaultFxRates.usdClp)),
      eurClp: Math.max(1, toNumber(parsed?.eurClp, defaultFxRates.eurClp)),
      ufClp: Math.max(1, toNumber(parsed?.ufClp, defaultFxRates.ufClp)),
    };
  } catch {
    return { ...defaultFxRates };
  }
};

export const saveFxRates = (rates: WealthFxRates) => {
  saveFxRatesInternal(rates);
};

const normalizeNumericText = (value: string) =>
  value
    .replace(/[^\d,.-]/g, '')
    .replace(/\s+/g, '')
    .trim();

const parseFlexibleNumeric = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const normalized = normalizeNumericText(String(value || ''));
  if (!normalized) return NaN;

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  let prepared = normalized;

  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma > lastDot) {
      prepared = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      prepared = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaAsThousands = /^\d{1,3}(,\d{3})+$/.test(normalized);
    prepared = commaAsThousands ? normalized.replace(/,/g, '') : normalized.replace(',', '.');
  } else if (hasDot) {
    const dotAsThousands = /^\d{1,3}(\.\d{3})+$/.test(normalized);
    prepared = dotAsThousands ? normalized.replace(/\./g, '') : normalized;
  }

  const parsed = Number(prepared);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const fetchLiveFxComposite = async (): Promise<{ rates: WealthFxRates; source: string; fetchedAt: string }> => {
  const response = await fetch(`/api/fx/live?_ts=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok || !payload?.rates) {
    throw new Error(String(payload?.error || `No pude obtener TC/UF en backend (HTTP ${response.status}).`));
  }

  const usd = parseFlexibleNumeric(payload.rates.usdClp);
  const eur = parseFlexibleNumeric(payload.rates.eurClp);
  const uf = parseFlexibleNumeric(payload.rates.ufClp);
  if (![usd, eur, uf].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('Respuesta inválida de TC/UF desde backend.');
  }

  const perIndicatorSources =
    payload?.sources && typeof payload.sources === 'object'
      ? {
          usd: String(payload.sources.usdClp || '').trim(),
          eur: String(payload.sources.eurClp || '').trim(),
          uf: String(payload.sources.ufClp || '').trim(),
        }
      : null;

  const sourceText = perIndicatorSources
    ? `USD:${perIndicatorSources.usd || 'n/d'} · UF:${perIndicatorSources.uf || 'n/d'}`
    : String(payload.source || 'backend-fx');

  return {
    rates: {
      usdClp: Math.round(usd),
      eurClp: Math.round(eur),
      ufClp: Math.round(uf),
    },
    source: sourceText,
    fetchedAt: String(payload.fetchedAt || nowIso()),
  };
};

export const refreshFxRatesFromLive = async (
  options?: { force?: boolean; recordErrorMeta?: boolean },
): Promise<{ updated: boolean; rates: WealthFxRates; source: string; fetchedAt: string; skipped?: boolean }> => {
  const today = localYmd();
  const force = !!options?.force;
  const recordErrorMeta = options?.recordErrorMeta ?? true;
  const current = loadFxRates();
  const previousMeta = loadFxLiveSyncMeta();

  if (!force && readFxLastAutoSyncDay() === today) {
    return {
      updated: false,
      skipped: true,
      rates: current,
      source: previousMeta?.source || 'cached',
      fetchedAt: previousMeta?.fetchedAt || nowIso(),
    };
  }

  try {
    const live = await fetchLiveFxComposite();
    const changed =
      current.usdClp !== live.rates.usdClp ||
      current.eurClp !== live.rates.eurClp ||
      current.ufClp !== live.rates.ufClp;

    saveFxRates(live.rates);
    writeFxLastAutoSyncDay(today);
    saveFxLiveSyncMeta({
      source: live.source,
      fetchedAt: live.fetchedAt,
      status: 'ok',
    });

    return { updated: changed, rates: live.rates, source: live.source, fetchedAt: live.fetchedAt };
  } catch (err: any) {
    const message = String(err?.message || 'No pude actualizar TC/UF en línea');
    if (recordErrorMeta) {
      saveFxLiveSyncMeta({
        source: 'fuentes-automaticas',
        fetchedAt: nowIso(),
        status: 'error',
        message,
      });
    }
    throw new Error(message);
  }
};

export const refreshFxRatesDailyIfNeeded = async (): Promise<{
  ok: boolean;
  updated: boolean;
  skipped?: boolean;
  message?: string;
}> => {
  const today = localYmd();

  // Ya hubo actualización exitosa hoy.
  if (readFxLastAutoSyncDay() === today) {
    writeFxLastAutoAttemptDay(today);
    return { ok: true, updated: false, skipped: true };
  }

  // Ya se intentó actualización automática hoy (aunque haya fallado).
  if (readFxLastAutoAttemptDay() === today) {
    return { ok: true, updated: false, skipped: true };
  }

  writeFxLastAutoAttemptDay(today);

  try {
    const result = await refreshFxRatesFromLive({ recordErrorMeta: false });
    return { ok: true, updated: result.updated, skipped: result.skipped };
  } catch (err: any) {
    return { ok: false, updated: false, message: String(err?.message || 'Error actualizando TC/UF') };
  }
};

const emptyCurrencyMap = (): Record<WealthCurrency, number> => ({
  CLP: 0,
  USD: 0,
  EUR: 0,
  UF: 0,
});

const emptyBlockMap = (): Record<WealthBlock, Record<WealthCurrency, number>> => ({
  bank: emptyCurrencyMap(),
  investment: emptyCurrencyMap(),
  real_estate: emptyCurrencyMap(),
  debt: emptyCurrencyMap(),
});

const dateToComparable = (date: string) => String(date || '').replace(/-/g, '');

const dedupeLatestByAsset = (records: WealthRecord[]): WealthRecord[] => {
  const map = new Map<string, WealthRecord>();

  const ordered = [...records].sort((a, b) => {
    // Prioridad principal: la última edición/guardado hecha por el usuario.
    const byCreated = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (byCreated !== 0) return byCreated;
    // Si empatan por timestamp, usa snapshotDate como desempate.
    return dateToComparable(b.snapshotDate).localeCompare(dateToComparable(a.snapshotDate));
  });

  for (const item of ordered) {
    const key = makeAssetKey(item);
    if (!map.has(key)) map.set(key, item);
  }

  return [...map.values()];
};

export const getRecordsForMonth = (records: WealthRecord[], monthKey: string) => {
  return records.filter((item) => item.snapshotDate.startsWith(`${monthKey}-`));
};

export const latestRecordsForMonth = (records: WealthRecord[], monthKey: string) => {
  return dedupeLatestByAsset(getRecordsForMonth(records, monthKey));
};

export const summarizeWealth = (records: WealthRecord[], fxRates: WealthFxRates): WealthSnapshotSummary => {
  const assetsByCurrency = emptyCurrencyMap();
  const debtsByCurrency = emptyCurrencyMap();
  const byBlock = emptyBlockMap();

  for (const item of records) {
    if (isSyntheticAggregateRecord(item)) continue;
    const normalizedAmount = maybeNormalizeMinorUnitAmount(item, item.amount);
    byBlock[item.block][item.currency] += normalizedAmount;

    if (item.block === 'debt') {
      if (isMortgageMetaDebtLabel(item.label)) continue;
      debtsByCurrency[item.currency] += normalizedAmount;
    } else {
      assetsByCurrency[item.currency] += normalizedAmount;
    }
  }

  const netByCurrency: Record<WealthCurrency, number> = {
    CLP: assetsByCurrency.CLP - debtsByCurrency.CLP,
    USD: assetsByCurrency.USD - debtsByCurrency.USD,
    EUR: assetsByCurrency.EUR - debtsByCurrency.EUR,
    UF: assetsByCurrency.UF - debtsByCurrency.UF,
  };

  const netConsolidatedClp =
    netByCurrency.CLP +
    netByCurrency.USD * fxRates.usdClp +
    netByCurrency.EUR * fxRates.eurClp +
    netByCurrency.UF * fxRates.ufClp;

  return {
    netByCurrency,
    assetsByCurrency,
    debtsByCurrency,
    netConsolidatedClp,
    byBlock,
  };
};

const buildSummaryFromNetClp = (netClp: number): WealthSnapshotSummary => {
  const roundedNet = Math.round(Number(netClp) || 0);
  const assetsByCurrency = emptyCurrencyMap();
  const debtsByCurrency = emptyCurrencyMap();
  const byBlock = emptyBlockMap();

  if (roundedNet >= 0) {
    assetsByCurrency.CLP = roundedNet;
    byBlock.investment.CLP = roundedNet;
  } else {
    const debtAbs = Math.abs(roundedNet);
    debtsByCurrency.CLP = debtAbs;
    byBlock.debt.CLP = debtAbs;
  }

  return {
    netByCurrency: {
      CLP: roundedNet,
      USD: 0,
      EUR: 0,
      UF: 0,
    },
    assetsByCurrency,
    debtsByCurrency,
    netConsolidatedClp: roundedNet,
    byBlock,
  };
};

export interface WealthNetBreakdownClp {
  netClp: number;
  investmentClp: number;
  realEstateAssetsClp: number;
  mortgageDebtClp: number;
  realEstateNetClp: number;
  bankClp: number;
  nonMortgageDebtClp: number;
}

export interface WealthBankLiquiditySnapshot {
  bankClp: number;
  bankUsd: number;
  cardClp: number;
  cardUsd: number;
  hasCardClpData: boolean;
  hasCardUsdData: boolean;
}

const AGGREGATE_BANK_LABELS_CLP = new Set(
  [normalizeText('Bancos CLP histórico'), normalizeText('Saldo bancos CLP')],
);
const AGGREGATE_BANK_LABELS_USD = new Set(
  [normalizeText('Bancos USD histórico'), normalizeText('Saldo bancos USD')],
);
const PROVIDER_BANK_LABELS_CLP = new Set(
  [normalizeText('Banco de Chile CLP'), normalizeText('Scotiabank CLP'), normalizeText('Santander CLP')],
);
const PROVIDER_BANK_LABELS_USD = new Set(
  [normalizeText('Banco de Chile USD'), normalizeText('Scotiabank USD'), normalizeText('Santander USD')],
);

const maybeNormalizeMinorUnitAmount = (record: WealthRecord, amount: number): number => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  if ((record.currency !== 'USD' && record.currency !== 'EUR') || !Number.isInteger(value) || Math.abs(value) < 100000) {
    return value;
  }

  if (record.block === 'bank') return value / 100;

  if (record.block === 'debt') {
    const normalizedSource = normalizeText(record.source || '');
    const normalizedLabel = normalizeText(record.label || '');
    if (
      normalizedSource.includes('fintoc') ||
      normalizedSource.includes('api') ||
      normalizedLabel.startsWith(normalizeText('Tarjeta crédito'))
    ) {
      return value / 100;
    }
  }

  return value;
};

const AGGREGATE_BANK_LABELS_CLP_LOCAL = new Set(
  [normalizeText('Bancos CLP histórico'), normalizeText('Saldo bancos CLP')],
);
const AGGREGATE_BANK_LABELS_USD_LOCAL = new Set(
  [normalizeText('Bancos USD histórico'), normalizeText('Saldo bancos USD')],
);
const PROVIDER_BANK_LABELS_CLP_LOCAL = new Set(
  [normalizeText('Banco de Chile CLP'), normalizeText('Scotiabank CLP'), normalizeText('Santander CLP')],
);
const PROVIDER_BANK_LABELS_USD_LOCAL = new Set(
  [normalizeText('Banco de Chile USD'), normalizeText('Scotiabank USD'), normalizeText('Santander USD')],
);

export const computeWealthBankLiquiditySnapshot = (
  records: WealthRecord[],
): WealthBankLiquiditySnapshot => {
  const nonSynthetic = records.filter((r) => !isSyntheticAggregateRecord(r));

  const bankCandidates = nonSynthetic.filter(
    (r) => r.block === 'bank' && !isNonMortgageDebtRecord(r),
  );

  const hasProviderBankClp = bankCandidates.some(
    (r) => r.currency === 'CLP' && PROVIDER_BANK_LABELS_CLP_LOCAL.has(normalizeText(r.label)),
  );
  const hasProviderBankUsd = bankCandidates.some(
    (r) => r.currency === 'USD' && PROVIDER_BANK_LABELS_USD_LOCAL.has(normalizeText(r.label)),
  );
  const hasDetailedBankClp = bankCandidates.some((r) => {
    if (r.currency !== 'CLP') return false;
    const label = normalizeText(r.label);
    return !AGGREGATE_BANK_LABELS_CLP_LOCAL.has(label) && !PROVIDER_BANK_LABELS_CLP_LOCAL.has(label);
  });
  const hasDetailedBankUsd = bankCandidates.some((r) => {
    if (r.currency !== 'USD') return false;
    const label = normalizeText(r.label);
    return !AGGREGATE_BANK_LABELS_USD_LOCAL.has(label) && !PROVIDER_BANK_LABELS_USD_LOCAL.has(label);
  });

  const bankDetails = bankCandidates.filter((record) => {
    const label = normalizeText(record.label);
    if (record.currency === 'CLP' && hasDetailedBankClp) {
      if (hasProviderBankClp) return PROVIDER_BANK_LABELS_CLP_LOCAL.has(label);
      return !AGGREGATE_BANK_LABELS_CLP_LOCAL.has(label);
    }
    if (record.currency === 'USD' && hasDetailedBankUsd) {
      if (hasProviderBankUsd) return PROVIDER_BANK_LABELS_USD_LOCAL.has(label);
      return !AGGREGATE_BANK_LABELS_USD_LOCAL.has(label);
    }
    if (record.currency === 'CLP' && hasProviderBankClp) return PROVIDER_BANK_LABELS_CLP_LOCAL.has(label);
    if (record.currency === 'USD' && hasProviderBankUsd) return PROVIDER_BANK_LABELS_USD_LOCAL.has(label);
    return true;
  });

  const debtCandidates = nonSynthetic.filter(
    (r) => isNonMortgageDebtRecord(r) && !isMortgagePrincipalDebtLabel(r.label),
  );
  const hasDetailedDebtClp = debtCandidates.some(
    (r) => r.currency === 'CLP' && !AGGREGATE_DEBT_LABELS_CLP.has(normalizeText(r.label)),
  );
  const hasDetailedDebtUsd = debtCandidates.some(
    (r) => r.currency === 'USD' && !AGGREGATE_DEBT_LABELS_USD.has(normalizeText(r.label)),
  );
  const hasAggregateDebtClp = debtCandidates.some(
    (r) => r.currency === 'CLP' && AGGREGATE_DEBT_LABELS_CLP.has(normalizeText(r.label)),
  );
  const hasAggregateDebtUsd = debtCandidates.some(
    (r) => r.currency === 'USD' && AGGREGATE_DEBT_LABELS_USD.has(normalizeText(r.label)),
  );

  const cardDetails = debtCandidates.filter((record) => {
    const label = normalizeText(record.label);
    if (record.currency === 'CLP') {
      if (hasDetailedDebtClp) return !AGGREGATE_DEBT_LABELS_CLP.has(label);
      if (hasAggregateDebtClp) return AGGREGATE_DEBT_LABELS_CLP.has(label);
    }
    if (record.currency === 'USD') {
      if (hasDetailedDebtUsd) return !AGGREGATE_DEBT_LABELS_USD.has(label);
      if (hasAggregateDebtUsd) return AGGREGATE_DEBT_LABELS_USD.has(label);
    }
    return true;
  });

  const bankClp = bankDetails
    .filter((r) => r.currency === 'CLP')
    .reduce((sum, r) => sum + maybeNormalizeMinorUnitAmount(r, r.amount), 0);
  const bankUsd = bankDetails
    .filter((r) => r.currency === 'USD')
    .reduce((sum, r) => sum + maybeNormalizeMinorUnitAmount(r, r.amount), 0);
  const cardClp = cardDetails
    .filter((r) => r.currency === 'CLP')
    .reduce((sum, r) => sum + maybeNormalizeMinorUnitAmount(r, r.amount), 0);
  const cardUsd = cardDetails
    .filter((r) => r.currency === 'USD')
    .reduce((sum, r) => sum + maybeNormalizeMinorUnitAmount(r, r.amount), 0);

  return {
    bankClp,
    bankUsd,
    cardClp,
    cardUsd,
    hasCardClpData: cardDetails.some((r) => r.currency === 'CLP'),
    hasCardUsdData: cardDetails.some((r) => r.currency === 'USD'),
  };
};

export const buildWealthNetBreakdown = (
  records: WealthRecord[],
  fxRates: WealthFxRates,
): WealthNetBreakdownClp => {
  let investmentClp = 0;
  let realEstateAssetsClp = 0;
  let mortgageDebtClp = 0;
  let bankClp = 0;
  let nonMortgageDebtClp = 0;

  const hasDetailedBankClp = records.some((record) => {
    if (record.block !== 'bank') return false;
    if (record.currency !== 'CLP') return false;
    if (isSyntheticAggregateRecord(record)) return false;
    const normalizedLabel = normalizeText(record.label);
    return !AGGREGATE_BANK_LABELS_CLP.has(normalizedLabel) && !PROVIDER_BANK_LABELS_CLP.has(normalizedLabel);
  });
  const hasDetailedBankUsd = records.some((record) => {
    if (record.block !== 'bank') return false;
    if (record.currency !== 'USD') return false;
    if (isSyntheticAggregateRecord(record)) return false;
    const normalizedLabel = normalizeText(record.label);
    return !AGGREGATE_BANK_LABELS_USD.has(normalizedLabel) && !PROVIDER_BANK_LABELS_USD.has(normalizedLabel);
  });
  const hasProviderBankClp = records.some((record) => {
    if (record.block !== 'bank') return false;
    if (isNonMortgageDebtRecord(record)) return false;
    if (record.currency !== 'CLP') return false;
    if (isSyntheticAggregateRecord(record)) return false;
    return PROVIDER_BANK_LABELS_CLP.has(normalizeText(record.label));
  });
  const hasProviderBankUsd = records.some((record) => {
    if (record.block !== 'bank') return false;
    if (isNonMortgageDebtRecord(record)) return false;
    if (record.currency !== 'USD') return false;
    if (isSyntheticAggregateRecord(record)) return false;
    return PROVIDER_BANK_LABELS_USD.has(normalizeText(record.label));
  });
  const nonMortgageDebtCandidates = records.filter(
    (record) => !isSyntheticAggregateRecord(record) && isNonMortgageDebtRecord(record),
  );
  const hasDetailedDebtClp = nonMortgageDebtCandidates.some((record) => {
    if (record.currency !== 'CLP') return false;
    const normalizedLabel = normalizeText(record.label);
    if (AGGREGATE_DEBT_LABELS_CLP.has(normalizedLabel) || AGGREGATE_DEBT_LABELS_USD.has(normalizedLabel)) {
      return false;
    }
    return true;
  });
  const hasDetailedDebtUsd = nonMortgageDebtCandidates.some((record) => {
    if (record.currency !== 'USD') return false;
    const normalizedLabel = normalizeText(record.label);
    if (AGGREGATE_DEBT_LABELS_CLP.has(normalizedLabel) || AGGREGATE_DEBT_LABELS_USD.has(normalizedLabel)) {
      return false;
    }
    return true;
  });
  const hasAggregateDebtClp = nonMortgageDebtCandidates.some((record) => {
    if (record.currency !== 'CLP') return false;
    return AGGREGATE_DEBT_LABELS_CLP.has(normalizeText(record.label));
  });
  const hasAggregateDebtUsd = nonMortgageDebtCandidates.some((record) => {
    if (record.currency !== 'USD') return false;
    return AGGREGATE_DEBT_LABELS_USD.has(normalizeText(record.label));
  });
  let aggregateDebtClpCounted = false;
  let aggregateDebtUsdCounted = false;

  const safeFx = {
    usdClp: Number(fxRates?.usdClp) > 0 ? Number(fxRates.usdClp) : defaultFxRates.usdClp,
    eurClp: Number(fxRates?.eurClp) > 0 ? Number(fxRates.eurClp) : defaultFxRates.eurClp,
    ufClp: Number(fxRates?.ufClp) > 0 ? Number(fxRates.ufClp) : defaultFxRates.ufClp,
  };

  const toClpWithFx = (amount: number, currency: WealthCurrency) => {
    if (currency === 'CLP') return amount;
    if (currency === 'USD') return amount * safeFx.usdClp;
    if (currency === 'EUR') return amount * safeFx.eurClp;
    return amount * safeFx.ufClp;
  };

  records.forEach((record) => {
    if (isSyntheticAggregateRecord(record)) return;
    const normalizedLabel = normalizeText(record.label);
    if (isMortgageMetaDebtLabel(record.label) && !isMortgagePrincipalDebtLabel(record.label)) return;
    const treatsAsNonMortgageDebt = isNonMortgageDebtRecord(record);
    if (record.block === 'bank' && !treatsAsNonMortgageDebt) {
      if (record.currency === 'CLP') {
        if (hasProviderBankClp) {
          if (!PROVIDER_BANK_LABELS_CLP.has(normalizedLabel)) return;
        } else if (hasDetailedBankClp) {
          if (AGGREGATE_BANK_LABELS_CLP.has(normalizedLabel)) return;
        }
      }
      if (record.currency === 'USD') {
        if (hasProviderBankUsd) {
          if (!PROVIDER_BANK_LABELS_USD.has(normalizedLabel)) return;
        } else if (hasDetailedBankUsd) {
          if (AGGREGATE_BANK_LABELS_USD.has(normalizedLabel)) return;
        }
      }
    }
    if (treatsAsNonMortgageDebt) {
      if (record.currency === 'CLP') {
        if (hasDetailedDebtClp && AGGREGATE_DEBT_LABELS_CLP.has(normalizedLabel)) {
          return;
        } else if (hasAggregateDebtClp) {
          if (!AGGREGATE_DEBT_LABELS_CLP.has(normalizedLabel)) return;
          if (aggregateDebtClpCounted) return;
          aggregateDebtClpCounted = true;
        }
      }
      if (record.currency === 'USD') {
        if (hasDetailedDebtUsd && AGGREGATE_DEBT_LABELS_USD.has(normalizedLabel)) {
          return;
        } else if (hasAggregateDebtUsd) {
          if (!AGGREGATE_DEBT_LABELS_USD.has(normalizedLabel)) return;
          if (aggregateDebtUsdCounted) return;
          aggregateDebtUsdCounted = true;
        }
      }
    }
    const treatsAsDebt = treatsAsNonMortgageDebt || isMortgagePrincipalDebtLabel(record.label);
    const normalizedSourceAmount = maybeNormalizeMinorUnitAmount(record, record.amount);
    const normalizedAmount = treatsAsDebt ? Math.abs(normalizedSourceAmount) : normalizedSourceAmount;
    const clp = toClpWithFx(normalizedAmount, record.currency);

    if (isMortgagePrincipalDebtLabel(record.label)) {
      mortgageDebtClp += clp;
      return;
    }

    if (record.block === 'investment') investmentClp += clp;
    if (record.block === 'real_estate') realEstateAssetsClp += clp;
    if (record.block === 'bank' && !treatsAsNonMortgageDebt) bankClp += clp;
    if (treatsAsNonMortgageDebt) {
      nonMortgageDebtClp += clp;
    }
  });

  const realEstateNetClp = realEstateAssetsClp - mortgageDebtClp;
  const netClp = investmentClp + realEstateNetClp + bankClp - nonMortgageDebtClp;
  return {
    netClp,
    investmentClp,
    realEstateAssetsClp,
    mortgageDebtClp,
    realEstateNetClp,
    bankClp,
    nonMortgageDebtClp,
  };
};

export const loadClosures = (): WealthMonthlyClosure[] => {
  try {
    const raw = localStorage.getItem(CLOSURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => {
        const monthKey = String(item?.monthKey || '');
        const fxRates = normalizeClosureFxRates(item?.fxRates);
        const fxMissingRaw = Array.isArray(item?.fxMissing) ? item.fxMissing : [];
        const fxMissing = fxMissingRaw
          .map((key: unknown) => String(key || '').trim())
          .filter((key: string): key is 'usdClp' | 'eurClp' | 'ufClp' =>
            key === 'usdClp' || key === 'eurClp' || key === 'ufClp',
          );
        const records = normalizeClosureRecords(item?.records);

        const summary =
          records && records.length
            ? summarizeWealth(dedupeLatestByAsset(records), fxRates || defaultFxRates)
            : item?.summary;

        const previousVersionsRaw = Array.isArray(item?.previousVersions)
          ? item.previousVersions
          : [];
        const previousVersions = mergeClosureVersions(
          previousVersionsRaw
            .map((v: any) => normalizeClosureVersion(v, monthKey))
            .filter((v: WealthMonthlyClosureVersion | null): v is WealthMonthlyClosureVersion => !!v),
        );

        return {
          id: String(item?.id || crypto.randomUUID()),
          monthKey,
          closedAt: String(item?.closedAt || nowIso()),
          summary,
          fxRates,
          fxMissing: fxMissing.length ? fxMissing : undefined,
          records,
          previousVersions: previousVersions.length ? previousVersions : undefined,
        };
      })
      .filter((item: WealthMonthlyClosure) => !!item.monthKey && !!item.summary)
      .sort(compareClosuresByMonthDesc);
  } catch {
    return [];
  }
};

export const saveClosures = (closures: WealthMonthlyClosure[], options?: PersistOptions) => {
  const sorted = [...closures].sort(compareClosuresByMonthDesc);
  localStorage.setItem(CLOSURES_KEY, JSON.stringify(sorted));
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

export const getClosureCompleteness = (closure: WealthMonthlyClosure): WealthClosureCompleteness => {
  const records = Array.isArray(closure.records) ? closure.records : [];
  const latestByCanonical = new Map<string, WealthRecord>();
  records.forEach((record) => {
    const key = normalizeLabelKey(record.label);
    const prev = latestByCanonical.get(key);
    if (!prev) {
      latestByCanonical.set(key, record);
      return;
    }
    latestByCanonical.set(key, pickLatestRecord(prev, record));
  });

  const missingFieldLabels = CLOSURE_REQUIRED_FIELDS.filter(({ canonicalLabel }) => {
    const aliases = CLOSURE_CANONICAL_ALIASES[canonicalLabel] || [];
    const keys = [canonicalLabel, ...aliases].map((label) => normalizeLabelKey(label));
    const record = keys
      .map((key) => latestByCanonical.get(key) || null)
      .find((item): item is WealthRecord => !!item);
    if (!record) return true;
    return !Number.isFinite(Number(record.amount));
  }).map(({ label }) => label);

  const fx = closure.fxRates;
  const hasExplicitMissingFx = Array.isArray(closure.fxMissing) && closure.fxMissing.length > 0;
  const missingFx =
    hasExplicitMissingFx ||
    !fx ||
    !Number.isFinite(Number(fx.usdClp)) ||
    !Number.isFinite(Number(fx.eurClp)) ||
    !Number.isFinite(Number(fx.ufClp)) ||
    Number(fx.usdClp) <= 0 ||
    Number(fx.eurClp) <= 0 ||
    Number(fx.ufClp) <= 0;

  return {
    monthKey: closure.monthKey,
    missingFieldLabels,
    missingFx,
  };
};

export const getIncompleteClosures = (
  closures: WealthMonthlyClosure[] = loadClosures(),
): WealthClosureCompleteness[] =>
  [...closures]
    .sort(compareClosuresByMonthDesc)
    .map((closure) => getClosureCompleteness(closure))
    .filter((summary) => summary.missingFx || summary.missingFieldLabels.length > 0);

const getWealthCloudRef = async () => {
  if (!isFirebaseConfigured()) return null;
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) return null;
  return doc(db, WEALTH_CLOUD_DOC_COLLECTION, uid);
};

let wealthCloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let wealthCloudSyncPromise: Promise<boolean> | null = null;
let wealthCloudSyncRequestedWhileRunning = false;

const syncWealthToCloudNow = async (): Promise<boolean> => {
  if (wealthCloudSyncPromise) {
    wealthCloudSyncRequestedWhileRunning = true;
    return wealthCloudSyncPromise;
  }

  wealthCloudSyncPromise = (async () => {
    try {
      const ref = await getWealthCloudRef();
      if (!ref) {
        setLastWealthSyncIssue('no_uid_or_firebase_config');
        return false;
      }
      setFirestoreChecking();
      const localRecords = loadWealthRecords();
      const localClosures = loadClosures();
      const localFx = loadFxRates();
      const localInstruments = loadInvestmentInstruments();
      const localBankTokens = loadBankTokens();
      const localDeletedRecordIds = loadDeletedRecordIds();
      const localDeletedRecordAssetMonthKeys = loadDeletedRecordAssetMonthKeys();
      const localUpdatedAt = readWealthUpdatedAt();

      const remoteSnap = await getDoc(ref);
      const remoteData = remoteSnap.exists() ? remoteSnap.data() || {} : {};
      const remoteRecords = normalizeRecordsFromRaw(Array.isArray(remoteData.records) ? remoteData.records : []);
      const remoteClosures = loadClosuresFromRaw(Array.isArray(remoteData.closures) ? remoteData.closures : []);
      const remoteFx = normalizeFxRates(remoteData.fx || defaultFxRates);
      const remoteInstruments = loadInstrumentsFromRaw(Array.isArray(remoteData.instruments) ? remoteData.instruments : []);
      const remoteBankTokens = normalizeBankTokensFromRaw(remoteData.bankTokens);
      const remoteDeletedRecordIds = normalizeDeletedRecordIds(remoteData.deletedRecordIds);
      const remoteDeletedRecordAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys(
        remoteData.deletedRecordAssetMonthKeys,
      );
      const remoteUpdatedAt = String(remoteData.updatedAt || '');
      markLastRemoteUpdatedAt(remoteUpdatedAt);

      const merged = mergeWealthState({
        localRecords,
        remoteRecords,
        localClosures,
        remoteClosures,
        localInstruments,
        remoteInstruments,
        localBankTokens,
        remoteBankTokens,
        localDeletedRecordIds,
        remoteDeletedRecordIds,
        localDeletedRecordAssetMonthKeys,
        remoteDeletedRecordAssetMonthKeys,
        localFx,
        remoteFx,
        localUpdatedAt,
        remoteUpdatedAt,
      });
      const mergedDeletedRecordIds = merged.deletedRecordIds;
      const mergedDeletedRecordAssetMonthKeys = merged.deletedRecordAssetMonthKeys;
      const mergedRecords = merged.records;
      const mergedClosures = merged.closures;
      const mergedInstruments = merged.instruments;
      const mergedBankTokens = merged.bankTokens;
      const mergedFx = merged.fx;
      const mergedUpdatedAt = nextMonotonicIsoAgainstRemote();

      await setDoc(
        ref,
        stripUndefinedDeep({
          schemaVersion: 1,
          updatedAt: mergedUpdatedAt,
          fx: mergedFx,
          bankTokens: mergedBankTokens,
          records: mergedRecords,
          closures: mergedClosures,
          instruments: mergedInstruments,
          deletedRecordIds: mergedDeletedRecordIds,
          deletedRecordAssetMonthKeys: mergedDeletedRecordAssetMonthKeys,
        }),
        { merge: true },
      );
      markLastRemoteUpdatedAt(mergedUpdatedAt);

      if (
        !sameRecords(localRecords, mergedRecords) ||
        !sameClosures(localClosures, mergedClosures) ||
        !sameInvestmentInstruments(localInstruments, mergedInstruments) ||
        !sameBankTokens(localBankTokens, mergedBankTokens) ||
        !sameStringList(localDeletedRecordIds, mergedDeletedRecordIds) ||
        !sameStringList(localDeletedRecordAssetMonthKeys, mergedDeletedRecordAssetMonthKeys) ||
        JSON.stringify(localFx) !== JSON.stringify(mergedFx)
      ) {
        saveWealthRecords(mergedRecords, { skipCloudSync: true, silent: true });
        saveClosures(mergedClosures, { skipCloudSync: true, silent: true });
        saveFxRatesInternal(mergedFx, { skipCloudSync: true, silent: true });
        saveInvestmentInstruments(mergedInstruments, { skipCloudSync: true, silent: true });
        saveBankTokens(mergedBankTokens, { skipCloudSync: true, silent: true });
        saveDeletedRecordIds(mergedDeletedRecordIds, { skipCloudSync: true, silent: true });
        saveDeletedRecordAssetMonthKeys(mergedDeletedRecordAssetMonthKeys, {
          skipCloudSync: true,
          silent: true,
        });
        touchWealthUpdatedAt();
        dispatchWealthDataUpdated();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(FX_RATES_UPDATED_EVENT, { detail: loadFxRates() }));
        }
      }

      setLastWealthSyncIssue('');
      setFirestoreOk();
      return true;
    } catch (err: any) {
      setLastWealthSyncIssue(`${err?.code || 'sync_error'} ${err?.message || ''}`.trim());
      setFirestoreStatusFromError(err);
      return false;
    } finally {
      wealthCloudSyncPromise = null;
      if (wealthCloudSyncRequestedWhileRunning) {
        wealthCloudSyncRequestedWhileRunning = false;
        scheduleWealthCloudSync(40);
      }
    }
  })();

  return wealthCloudSyncPromise;
};

export const syncWealthNow = async (): Promise<boolean> => {
  // Reintento corto para tolerar ventanas donde auth.currentUser aún se rehidrata.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ok = await syncWealthToCloudNow();
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
};

export const scheduleWealthCloudSync = (delayMs = 250) => {
  if (typeof window === 'undefined') return;
  if (wealthCloudSyncPromise) {
    wealthCloudSyncRequestedWhileRunning = true;
    return;
  }
  if (wealthCloudSyncTimer) clearTimeout(wealthCloudSyncTimer);
  wealthCloudSyncTimer = setTimeout(() => {
    wealthCloudSyncTimer = null;
    void syncWealthToCloudNow();
  }, delayMs);
};

export const hydrateWealthFromCloud = async (): Promise<'cloud' | 'local' | 'unavailable'> => {
  try {
    const ref = await getWealthCloudRef();
    if (!ref) return 'unavailable';

    setFirestoreChecking();
    const snap = await getDoc(ref);
    setFirestoreOk();

    if (!snap.exists()) {
      await syncWealthToCloudNow();
      return 'local';
    }

    const data = snap.data() || {};
    const localRecords = loadWealthRecords();
    const localClosures = loadClosures();
    const localFx = loadFxRates();
    const localInstruments = loadInvestmentInstruments();
    const localBankTokens = loadBankTokens();
    const localDeletedRecordIds = loadDeletedRecordIds();
    const localDeletedRecordAssetMonthKeys = loadDeletedRecordAssetMonthKeys();
    const localUpdatedAt = readWealthUpdatedAt();

    const remoteUpdatedAt = String(data.updatedAt || '');
    const remoteRecords = normalizeRecordsFromRaw(Array.isArray(data.records) ? data.records : []);
    const remoteClosures = loadClosuresFromRaw(Array.isArray(data.closures) ? data.closures : []);
    const remoteFx = normalizeFxRates(data.fx || defaultFxRates);
    const remoteInstruments = loadInstrumentsFromRaw(Array.isArray(data.instruments) ? data.instruments : []);
    const remoteBankTokens = normalizeBankTokensFromRaw(data.bankTokens);
    const remoteDeletedRecordIds = normalizeDeletedRecordIds(data.deletedRecordIds);
    const remoteDeletedRecordAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys(
      data.deletedRecordAssetMonthKeys,
    );
    markLastRemoteUpdatedAt(remoteUpdatedAt);

    const merged = mergeWealthState({
      localRecords,
      remoteRecords,
      localClosures,
      remoteClosures,
      localInstruments,
      remoteInstruments,
      localBankTokens,
      remoteBankTokens,
      localDeletedRecordIds,
      remoteDeletedRecordIds,
      localDeletedRecordAssetMonthKeys,
      remoteDeletedRecordAssetMonthKeys,
      localFx,
      remoteFx,
      localUpdatedAt,
      remoteUpdatedAt,
    });
    const mergedDeletedRecordIds = merged.deletedRecordIds;
    const mergedDeletedRecordAssetMonthKeys = merged.deletedRecordAssetMonthKeys;
    const mergedRecords = merged.records;
    const mergedClosures = merged.closures;
    const mergedInstruments = merged.instruments;
    const mergedBankTokens = merged.bankTokens;

    const hasLocalData =
      localRecords.length > 0 || localClosures.length > 0 || Object.keys(localBankTokens).length > 0;
    const hasRemoteData =
      remoteRecords.length > 0 || remoteClosures.length > 0 || Object.keys(remoteBankTokens).length > 0;
    const mergedFx = merged.fx;

    const localNeedsUpdate =
      !sameRecords(localRecords, mergedRecords) ||
      !sameClosures(localClosures, mergedClosures) ||
      !sameInvestmentInstruments(localInstruments, mergedInstruments) ||
      !sameBankTokens(localBankTokens, mergedBankTokens) ||
      !sameStringList(localDeletedRecordIds, mergedDeletedRecordIds) ||
      !sameStringList(localDeletedRecordAssetMonthKeys, mergedDeletedRecordAssetMonthKeys) ||
      JSON.stringify(localFx) !== JSON.stringify(mergedFx);

    if (localNeedsUpdate) {
      saveWealthRecords(mergedRecords, { skipCloudSync: true, silent: true });
      saveClosures(mergedClosures, { skipCloudSync: true, silent: true });
      saveFxRatesInternal(mergedFx, { skipCloudSync: true, silent: true });
      saveInvestmentInstruments(mergedInstruments, { skipCloudSync: true, silent: true });
      saveBankTokens(mergedBankTokens, { skipCloudSync: true, silent: true });
      saveDeletedRecordIds(mergedDeletedRecordIds, { skipCloudSync: true, silent: true });
      saveDeletedRecordAssetMonthKeys(mergedDeletedRecordAssetMonthKeys, {
        skipCloudSync: true,
        silent: true,
      });
      touchWealthUpdatedAt();
      dispatchWealthDataUpdated();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(FX_RATES_UPDATED_EVENT, { detail: loadFxRates() }));
      }
    }

    const cloudNeedsUpdate =
      (hasLocalData && !hasRemoteData) ||
      !sameRecords(mergedRecords, remoteRecords) ||
      !sameClosures(mergedClosures, remoteClosures) ||
      !sameInvestmentInstruments(mergedInstruments, remoteInstruments) ||
      !sameBankTokens(mergedBankTokens, remoteBankTokens) ||
      !sameStringList(mergedDeletedRecordIds, remoteDeletedRecordIds) ||
      !sameStringList(mergedDeletedRecordAssetMonthKeys, remoteDeletedRecordAssetMonthKeys) ||
      JSON.stringify(remoteFx) !== JSON.stringify(mergedFx);

    if (cloudNeedsUpdate) scheduleWealthCloudSync(10);

    if (!hasLocalData && hasRemoteData) return 'cloud';
    if (localNeedsUpdate && hasRemoteData) return 'cloud';
    return 'local';
  } catch (err) {
    setFirestoreStatusFromError(err);
    return 'unavailable';
  }
};

const loadClosuresFromRaw = (parsed: any[]): WealthMonthlyClosure[] => {
  return parsed
    .map((item: any) => {
      const monthKey = String(item?.monthKey || '');
      const fxRates = normalizeClosureFxRates(item?.fxRates);
      const records = normalizeClosureRecords(item?.records);

      const summary =
        records && records.length ? summarizeWealth(dedupeLatestByAsset(records), fxRates || defaultFxRates) : item?.summary;

      const previousVersionsRaw = Array.isArray(item?.previousVersions)
        ? item.previousVersions
        : [];
      const previousVersions = mergeClosureVersions(
        previousVersionsRaw
          .map((v: any) => normalizeClosureVersion(v, monthKey))
          .filter((v: WealthMonthlyClosureVersion | null): v is WealthMonthlyClosureVersion => !!v),
      );

      return {
        id: String(item?.id || crypto.randomUUID()),
        monthKey,
        closedAt: String(item?.closedAt || nowIso()),
        summary,
        fxRates,
        records,
        previousVersions: previousVersions.length ? previousVersions : undefined,
      };
    })
    .filter((item: WealthMonthlyClosure) => !!item.monthKey && !!item.summary)
    .sort(compareClosuresByMonthDesc);
};

const loadInstrumentsFromRaw = (parsed: any[]): WealthInvestmentInstrument[] => {
  return parsed
    .map((item: any) => normalizeInvestmentInstrument(item))
    .filter((item: WealthInvestmentInstrument) => !!item.label)
    .sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)));
};

const mergeInvestmentInstruments = (
  localItems: WealthInvestmentInstrument[],
  remoteItems: WealthInvestmentInstrument[],
) => {
  const merged = new Map<string, WealthInvestmentInstrument>();
  for (const item of [...localItems, ...remoteItems]) {
    const key = normalizeText(item.label);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, item);
      continue;
    }

    const tPrev = new Date(prev.createdAt).getTime();
    const tCurr = new Date(item.createdAt).getTime();
    const newer = tCurr >= tPrev ? item : prev;
    const excludedMonths = [...new Set([...(prev.excludedMonths || []), ...(item.excludedMonths || [])])].sort();
    merged.set(key, excludedMonths.length ? { ...newer, excludedMonths } : { ...newer });
  }

  return [...merged.values()].sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)));
};

const mergeClosures = (localClosures: WealthMonthlyClosure[], remoteClosures: WealthMonthlyClosure[]) => {
  const map = new Map<string, WealthMonthlyClosure>();
  for (const closure of [...localClosures, ...remoteClosures]) {
    const key = closure.monthKey;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, closure);
      continue;
    }
    const tPrev = new Date(prev.closedAt).getTime();
    const tCurr = new Date(closure.closedAt).getTime();
    const newer = tCurr >= tPrev ? closure : prev;
    const older = tCurr >= tPrev ? prev : closure;
    const mergedVersions = mergeClosureVersions(
      newer.previousVersions,
      older.previousVersions,
      [toClosureVersion(older, newer.closedAt)],
    );
    map.set(
      key,
      mergedVersions.length ? { ...newer, previousVersions: mergedVersions } : { ...newer },
    );
  }
  return [...map.values()].sort(compareClosuresByMonthDesc);
};

const serializeClosure = (c: WealthMonthlyClosure) =>
  JSON.stringify({
    monthKey: c.monthKey,
    closedAt: c.closedAt,
    fxRates: c.fxRates || null,
    fxMissing: c.fxMissing || null,
    records: (c.records || []).map(serializeRecord),
    summary: c.summary,
    previousVersions: (c.previousVersions || []).map((version) => ({
      id: version.id,
      monthKey: version.monthKey,
      closedAt: version.closedAt,
      replacedAt: version.replacedAt,
      fxRates: version.fxRates || null,
      fxMissing: version.fxMissing || null,
      records: (version.records || []).map(serializeRecord),
      summary: version.summary,
    })),
  });

const sameClosures = (a: WealthMonthlyClosure[], b: WealthMonthlyClosure[]) => {
  if (a.length !== b.length) return false;
  const sa = [...a]
    .sort((x, y) => x.monthKey.localeCompare(y.monthKey))
    .map(serializeClosure);
  const sb = [...b]
    .sort((x, y) => x.monthKey.localeCompare(y.monthKey))
    .map(serializeClosure);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
};

const saveFxRatesInternal = (rates: WealthFxRates, options?: PersistOptions) => {
  localStorage.setItem(FX_KEY, JSON.stringify(rates));
  touchWealthUpdatedAt();
  if (!options?.silent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FX_RATES_UPDATED_EVENT, { detail: rates }));
  }
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

export const upsertMonthlyClosure = (input: {
  monthKey: string;
  records: WealthRecord[];
  fxRates: WealthFxRates;
  closedAt?: string;
}): WealthMonthlyClosure => {
  const normalizedMonthKey = normalizeMonthKey(input.monthKey) || currentMonthKey();
  const closures = loadClosures();
  const latest = dedupeLatestByAsset(input.records);
  const summary = summarizeWealth(latest, input.fxRates);
  const closedAt = String(input.closedAt || nowIso());
  const existingSameMonth =
    closures.find((closure) => closure.monthKey === normalizedMonthKey) || null;

  const nextClosure: WealthMonthlyClosure = {
    id: crypto.randomUUID(),
    monthKey: normalizedMonthKey,
    closedAt,
    summary,
    fxRates: { ...input.fxRates },
    records: latest,
  };

  if (existingSameMonth) {
    const mergedVersions = mergeClosureVersions(
      existingSameMonth.previousVersions,
      [toClosureVersion(existingSameMonth, closedAt)],
    );
    if (mergedVersions.length) {
      nextClosure.previousVersions = mergedVersions;
    }
  }

  const withoutSameMonth = closures.filter((c) => c.monthKey !== normalizedMonthKey);
  const next = [nextClosure, ...withoutSameMonth].sort(compareClosuresByMonthDesc);

  saveClosures(next);
  return nextClosure;
};

export const createMonthlyClosure = (
  records: WealthRecord[],
  fxRates: WealthFxRates,
  closeDate = new Date(),
): WealthMonthlyClosure => {
  const year = closeDate.getFullYear();
  const month = String(closeDate.getMonth() + 1).padStart(2, '0');
  const monthKey = `${year}-${month}`;

  return upsertMonthlyClosure({
    monthKey,
    records,
    fxRates,
    closedAt: nowIso(),
  });
};

const findPreviousClosureWithRecords = (monthKey: string, closures: WealthMonthlyClosure[]) => {
  const ordered = [...closures].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  return ordered.find((closure) => closure.monthKey < monthKey && Array.isArray(closure.records) && closure.records.length > 0) || null;
};

export const fillMissingWithPreviousClosure = (
  targetMonthKey: string,
  snapshotDate: string,
  onlyLabels?: string[],
): { added: number; sourceMonth: string | null } => {
  const records = loadWealthRecords();
  const closures = loadClosures();
  const instruments = loadInvestmentInstruments();
  const previous = findPreviousClosureWithRecords(targetMonthKey, closures);

  if (!previous || !previous.records?.length) {
    return { added: 0, sourceMonth: null };
  }

  const currentKeys = new Set(latestRecordsForMonth(records, targetMonthKey).map((r) => makeAssetKey(r)));

  const toAdd: WealthRecord[] = [];
  const normalizedFilters = (onlyLabels || []).map((l) => normalizeLabelKey(l)).filter(Boolean);
  const excludedInvestmentKeys = new Set(
    instruments
      .filter((instrument) => (instrument.excludedMonths || []).includes(targetMonthKey))
      .map((instrument) => `${normalizeLabelKey(instrument.label)}::${instrument.currency}`),
  );

  for (const oldRecord of previous.records) {
    if (normalizedFilters.length) {
      const oldLabel = normalizeLabelKey(oldRecord.label);
      const matchesFilter = normalizedFilters.some((filter) => oldLabel === filter);
      if (!matchesFilter) continue;
    }
    if (oldRecord.block === 'investment') {
      const excludedKey = `${normalizeLabelKey(oldRecord.label)}::${oldRecord.currency}`;
      if (excludedInvestmentKeys.has(excludedKey)) continue;
    }

    const key = makeAssetKey(oldRecord);
    if (currentKeys.has(key)) continue;

    toAdd.push({
      id: crypto.randomUUID(),
      block: oldRecord.block,
      source: oldRecord.source,
      label: oldRecord.label,
      amount: oldRecord.amount,
      currency: oldRecord.currency,
      snapshotDate,
      createdAt: nowIso(),
      note: `Mes anterior: cierre ${previous.monthKey}`,
    });
  }

  if (!toAdd.length) {
    return { added: 0, sourceMonth: previous.monthKey };
  }

  saveWealthRecords([...toAdd, ...records].sort(sortByCreatedDesc));
  return { added: toAdd.length, sourceMonth: previous.monthKey };
};

const isAutoFillNote = (note?: string) => {
  const n = String(note || '').toLowerCase();
  return n.includes('arrastrado') || n.includes('mes anterior') || n.includes('estimado');
};

export const applyMortgageAutoCalculation = (
  targetMonthKey: string,
  snapshotDate: string,
  config: MortgageAutoCalcConfig = mortgageAutoCalcDefaults,
): {
  changed: number;
  sourceMonth: string | null;
  skipped: boolean;
  reason?: 'missing_base_debt' | 'no_change';
} => {
  const records = loadWealthRecords();
  const closures = loadClosures();
  const previous = findPreviousClosureWithRecords(targetMonthKey, closures);
  const monthRecords = latestRecordsForMonth(records, targetMonthKey);
  const sourceRecords = previous?.records?.length ? dedupeLatestByAsset(previous.records) : monthRecords;
  const sourceMonth = previous?.monthKey || `${targetMonthKey} (base inicial inferida)`;

  const prevDebtCandidates = sourceRecords
    .filter((r) => r.block === 'debt')
    .sort((a, b) => b.amount - a.amount);
  const prevDebt =
    prevDebtCandidates.find((r) => r.label.toLowerCase().includes('saldo deuda hipotecaria')) ||
    prevDebtCandidates[0];
  if (!prevDebt) return { changed: 0, sourceMonth, skipped: true, reason: 'missing_base_debt' };

  const findByLabel = (label: string) =>
    monthRecords.find((r) => r.block === 'debt' && r.label.toLowerCase() === label.toLowerCase());

  const readPrevDebtValue = (labelPart: string) =>
    sourceRecords.find((r) => r.block === 'debt' && r.label.toLowerCase().includes(labelPart.toLowerCase()))?.amount;

  const dividendUf = readPrevDebtValue('Dividendo hipotecario mensual') ?? config.dividendUf;
  const interestUf = readPrevDebtValue('Interés hipotecario mensual') ?? config.interestUf;
  const insuranceUf =
    readPrevDebtValue('Seguros hipotecarios mensuales') ?? config.fireInsuranceUf + config.lifeInsuranceUf;
  const amortizationUf =
    readPrevDebtValue('Amortización hipotecaria mensual') ?? (dividendUf - interestUf - insuranceUf);
  const hasPreviousClosure = !!previous?.records?.length;
  const newDebtUf = hasPreviousClosure ? Math.max(0, prevDebt.amount - amortizationUf) : prevDebt.amount;
  const inferredPreviousDebtUf = hasPreviousClosure ? null : prevDebt.amount + amortizationUf;

  const upsertIfMissingOrAutofill = (
    label: string,
    amount: number,
    source = 'Autocálculo hipotecario',
  ): boolean => {
    const existing = findByLabel(label);
    if (existing && !isAutoFillNote(existing.note)) return false;

    upsertWealthRecord({
      id: existing?.id,
      block: 'debt',
      source: existing?.source || source,
      label,
      amount: Math.max(0, amount),
      currency: existing?.currency || 'UF',
      snapshotDate: existing?.snapshotDate || snapshotDate,
      note: hasPreviousClosure
        ? `Estimado automático desde cierre ${previous?.monthKey}`
        : `Estimado automático con base inicial. Saldo mes anterior inferido: ${inferredPreviousDebtUf?.toFixed(4)} UF`,
    });
    return true;
  };

  let changed = 0;
  if (upsertIfMissingOrAutofill('Dividendo hipotecario mensual', dividendUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Interés hipotecario mensual', interestUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Seguros hipotecarios mensuales', insuranceUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Amortización hipotecaria mensual', amortizationUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Saldo deuda hipotecaria', newDebtUf)) changed += 1;

  if (changed === 0) {
    return { changed: 0, sourceMonth, skipped: false, reason: 'no_change' };
  }
  return { changed, sourceMonth, skipped: false };
};

export const ensureInitialMortgageDefaults = (
  targetMonthKey: string,
  snapshotDate: string,
  config: MortgageAutoCalcConfig = mortgageAutoCalcDefaults,
): { added: number } => {
  const records = loadWealthRecords();
  const hasAnyDebtHistory = records.some((r) => r.block === 'debt');
  if (hasAnyDebtHistory) return { added: 0 };

  const monthRecords = latestRecordsForMonth(records, targetMonthKey);
  const existingByLabel = new Set(monthRecords.filter((r) => r.block === 'debt').map((r) => r.label.toLowerCase()));
  const insuranceUf = config.fireInsuranceUf + config.lifeInsuranceUf;
  const amortizationUf = config.dividendUf - config.interestUf - insuranceUf;

  const defaults: Array<{ label: string; amount: number }> = [
    { label: 'Saldo deuda hipotecaria', amount: config.initialDebtUf },
    { label: 'Dividendo hipotecario mensual', amount: config.dividendUf },
    { label: 'Interés hipotecario mensual', amount: config.interestUf },
    { label: 'Seguros hipotecarios mensuales', amount: insuranceUf },
    { label: 'Amortización hipotecaria mensual', amount: amortizationUf },
  ];

  let added = 0;
  for (const item of defaults) {
    if (existingByLabel.has(item.label.toLowerCase())) continue;
    upsertWealthRecord({
      block: 'debt',
      source: 'Base inicial Aurum',
      label: item.label,
      amount: item.amount,
      currency: 'UF',
      snapshotDate,
      note: 'Base inicial por defecto (editable)',
    });
    added += 1;
  }

  return { added };
};

const applyWealthStateLocal = (payload: {
  records: WealthRecord[];
  closures: WealthMonthlyClosure[];
  instruments: WealthInvestmentInstrument[];
  bankTokens: WealthBankTokenMap;
  deletedRecordIds: string[];
  deletedRecordAssetMonthKeys: string[];
  fx: WealthFxRates;
  updatedAt?: string;
}) => {
  saveWealthRecords(payload.records, { skipCloudSync: true, silent: true });
  saveClosures(payload.closures, { skipCloudSync: true, silent: true });
  saveInvestmentInstruments(payload.instruments, { skipCloudSync: true, silent: true });
  saveBankTokens(payload.bankTokens, { skipCloudSync: true, silent: true });
  saveDeletedRecordIds(payload.deletedRecordIds, { skipCloudSync: true, silent: true });
  saveDeletedRecordAssetMonthKeys(payload.deletedRecordAssetMonthKeys, {
    skipCloudSync: true,
    silent: true,
  });
  saveFxRatesInternal(payload.fx, { skipCloudSync: true, silent: true });
  writeWealthUpdatedAt(payload.updatedAt || nowIso());
  setLastWealthSyncIssue('');
  dispatchWealthDataUpdated();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FX_RATES_UPDATED_EVENT, { detail: payload.fx }));
  }
};

type NormalizedCloudWealthState = {
  updatedAt: string;
  records: WealthRecord[];
  closures: WealthMonthlyClosure[];
  instruments: WealthInvestmentInstrument[];
  bankTokens: WealthBankTokenMap;
  deletedRecordIds: string[];
  deletedRecordAssetMonthKeys: string[];
  fx: WealthFxRates;
};

const normalizeCloudWealthState = (raw: any): NormalizedCloudWealthState => ({
  ...(() => {
    const deletedRecordIds = normalizeDeletedRecordIds(raw?.deletedRecordIds);
    const deletedRecordAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys(raw?.deletedRecordAssetMonthKeys);
    const deletedSet = new Set(deletedRecordIds);
    const deletedAssetMonthSet = new Set(deletedRecordAssetMonthKeys);
    const records = normalizeRecordsFromRaw(Array.isArray(raw?.records) ? raw.records : []).filter(
      (record) => !deletedSet.has(record.id) && !deletedAssetMonthSet.has(makeAssetMonthKey(record)),
    );

    return {
      updatedAt: String(raw?.updatedAt || ''),
      records,
      closures: loadClosuresFromRaw(Array.isArray(raw?.closures) ? raw.closures : []),
      instruments: loadInstrumentsFromRaw(Array.isArray(raw?.instruments) ? raw.instruments : []),
      bankTokens: normalizeBankTokensFromRaw(raw?.bankTokens),
      deletedRecordIds,
      deletedRecordAssetMonthKeys,
      fx: normalizeFxRates(raw?.fx || defaultFxRates),
    };
  })(),
});

let wealthCloudSubscriptionUnsub: (() => void) | null = null;
let wealthCloudSubscriptionUid = '';
let wealthCloudSubscriptionStartPromise: Promise<(() => void)> | null = null;

const stopWealthCloudSubscriptionInternal = () => {
  if (wealthCloudSubscriptionUnsub) {
    try {
      wealthCloudSubscriptionUnsub();
    } catch {
      // ignore
    }
  }
  wealthCloudSubscriptionUnsub = null;
  wealthCloudSubscriptionUid = '';
  wealthCloudSubscriptionStartPromise = null;
};

export const unsubscribeWealthCloud = () => {
  stopWealthCloudSubscriptionInternal();
};

export const subscribeWealthCloud = async (): Promise<() => void> => {
  if (!isFirebaseConfigured()) return () => {};
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) return () => {};

  if (wealthCloudSubscriptionUnsub && wealthCloudSubscriptionUid === uid) {
    return wealthCloudSubscriptionUnsub;
  }
  if (wealthCloudSubscriptionStartPromise) {
    return wealthCloudSubscriptionStartPromise;
  }

  stopWealthCloudSubscriptionInternal();

  wealthCloudSubscriptionStartPromise = Promise.resolve().then(() => {
    const ref = doc(db, WEALTH_CLOUD_DOC_COLLECTION, uid);
    setFirestoreChecking();

    const unsub = onSnapshot(
      ref,
      (snap) => {
        setFirestoreOk();
        if (!snap.exists()) {
          const hasLocalData =
            loadWealthRecords().length > 0 ||
            loadClosures().length > 0 ||
            loadInvestmentInstruments().length > 0 ||
            Object.keys(loadBankTokens()).length > 0;
          if (hasLocalData) scheduleWealthCloudSync(20);
          return;
        }

        const remote = normalizeCloudWealthState(snap.data() || {});
        markLastRemoteUpdatedAt(remote.updatedAt);
        const localRecords = loadWealthRecords();
        const localClosures = loadClosures();
        const localInstruments = loadInvestmentInstruments();
        const localBankTokens = loadBankTokens();
        const localDeletedRecordIds = loadDeletedRecordIds();
        const localDeletedRecordAssetMonthKeys = loadDeletedRecordAssetMonthKeys();
        const localFx = loadFxRates();
        const localUpdatedAt = readWealthUpdatedAt();

        const merged = mergeWealthState({
          localRecords,
          remoteRecords: remote.records,
          localClosures,
          remoteClosures: remote.closures,
          localInstruments,
          remoteInstruments: remote.instruments,
          localBankTokens,
          remoteBankTokens: remote.bankTokens,
          localDeletedRecordIds,
          remoteDeletedRecordIds: remote.deletedRecordIds,
          localDeletedRecordAssetMonthKeys,
          remoteDeletedRecordAssetMonthKeys: remote.deletedRecordAssetMonthKeys,
          localFx,
          remoteFx: remote.fx,
          localUpdatedAt,
          remoteUpdatedAt: remote.updatedAt,
        });

        const sameAsLocal =
          sameRecords(localRecords, merged.records) &&
          sameClosures(localClosures, merged.closures) &&
          sameInvestmentInstruments(localInstruments, merged.instruments) &&
          sameBankTokens(localBankTokens, merged.bankTokens) &&
          sameStringList(localDeletedRecordIds, merged.deletedRecordIds) &&
          sameStringList(localDeletedRecordAssetMonthKeys, merged.deletedRecordAssetMonthKeys) &&
          JSON.stringify(localFx) === JSON.stringify(merged.fx);
        if (sameAsLocal) return;

        applyWealthStateLocal({
          records: merged.records,
          closures: merged.closures,
          instruments: merged.instruments,
          bankTokens: merged.bankTokens,
          deletedRecordIds: merged.deletedRecordIds,
          deletedRecordAssetMonthKeys: merged.deletedRecordAssetMonthKeys,
          fx: merged.fx,
          updatedAt: merged.preferLocal ? localUpdatedAt || nowIso() : remote.updatedAt || nowIso(),
        });

        const cloudNeedsUpdate =
          !sameRecords(merged.records, remote.records) ||
          !sameClosures(merged.closures, remote.closures) ||
          !sameInvestmentInstruments(merged.instruments, remote.instruments) ||
          !sameBankTokens(merged.bankTokens, remote.bankTokens) ||
          !sameStringList(merged.deletedRecordIds, remote.deletedRecordIds) ||
          !sameStringList(merged.deletedRecordAssetMonthKeys, remote.deletedRecordAssetMonthKeys) ||
          JSON.stringify(merged.fx) !== JSON.stringify(remote.fx);
        if (cloudNeedsUpdate) scheduleWealthCloudSync(20);
      },
      (err) => {
        setLastWealthSyncIssue(`${(err as any)?.code || 'snapshot_error'} ${(err as any)?.message || ''}`.trim());
        setFirestoreStatusFromError(err);
      },
    );

    wealthCloudSubscriptionUid = uid;
    wealthCloudSubscriptionUnsub = () => {
      try {
        unsub();
      } finally {
        if (wealthCloudSubscriptionUid === uid) {
          wealthCloudSubscriptionUid = '';
          wealthCloudSubscriptionUnsub = null;
          wealthCloudSubscriptionStartPromise = null;
        }
      }
    };
    return wealthCloudSubscriptionUnsub;
  });

  return wealthCloudSubscriptionStartPromise;
};

const persistWealthStateToCloud = async (payload: {
  records: WealthRecord[];
  closures: WealthMonthlyClosure[];
  instruments: WealthInvestmentInstrument[];
  bankTokens: WealthBankTokenMap;
  deletedRecordIds: string[];
  deletedRecordAssetMonthKeys: string[];
  fx: WealthFxRates;
}): Promise<{ cloudCleared: boolean; mode: 'cloud' | 'local' }> => {
  try {
    const ref = await getWealthCloudRef();
    if (!ref) return { cloudCleared: false, mode: 'local' };

    const nextUpdatedAt = nextMonotonicIsoAgainstRemote();
    await setDoc(
      ref,
      stripUndefinedDeep({
        schemaVersion: 1,
        updatedAt: nextUpdatedAt,
        fx: payload.fx,
        bankTokens: payload.bankTokens,
        records: payload.records,
        closures: payload.closures,
        instruments: payload.instruments,
        deletedRecordIds: payload.deletedRecordIds,
        deletedRecordAssetMonthKeys: payload.deletedRecordAssetMonthKeys,
      }),
      { merge: true },
    );
    markLastRemoteUpdatedAt(nextUpdatedAt);

    setFirestoreOk();
    setLastWealthSyncIssue('');
    return { cloudCleared: true, mode: 'cloud' };
  } catch (err: any) {
    setLastWealthSyncIssue(`${err?.code || 'sync_error'} ${err?.message || ''}`.trim());
    setFirestoreStatusFromError(err);
    return { cloudCleared: false, mode: 'local' };
  }
};

const fallbackDemoHistoryMonthKeys = () => {
  const expected = [monthKeyFromDate(dateFromMonthOffset(-2)), monthKeyFromDate(dateFromMonthOffset(-1))];
  const closureMonthSet = new Set(loadClosures().map((c) => c.monthKey));
  return expected.filter((m) => closureMonthSet.has(m));
};

export const getSimulationHistoryMonthKeys = (): string[] => {
  const currentMonth = currentMonthKey();
  const fromMeta = loadDemoSeedMeta()?.historyMonthKeys || [];
  const picked = fromMeta.length ? fromMeta : fallbackDemoHistoryMonthKeys();
  return [...new Set(picked)].filter((m) => m !== currentMonth);
};

export const clearSimulationHistoryData = async (): Promise<{
  removedRecords: number;
  removedClosures: number;
  monthKeys: string[];
  cloudCleared: boolean;
  mode: 'cloud' | 'local';
}> => {
  const monthKeys = getSimulationHistoryMonthKeys();
  if (!monthKeys.length) {
    return { removedRecords: 0, removedClosures: 0, monthKeys: [], cloudCleared: false, mode: 'local' };
  }

  const records = loadWealthRecords();
  const instruments = loadInvestmentInstruments();
  const closures = loadClosures();
  const fx = loadFxRates();
  const bankTokens = loadBankTokens();

  const isTargetMonthRecord = (record: WealthRecord) =>
    monthKeys.some((monthKey) => record.snapshotDate.startsWith(`${monthKey}-`));
  const removedRecordIds = records.filter(isTargetMonthRecord).map((record) => record.id);
  const nextRecords = records.filter((record) => !isTargetMonthRecord(record));
  const nextClosures = closures.filter((closure) => !monthKeys.includes(closure.monthKey));
  const nextDeletedRecordIds = normalizeDeletedRecordIds([...loadDeletedRecordIds(), ...removedRecordIds]);
  const nextDeletedRecordAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys([
    ...loadDeletedRecordAssetMonthKeys(),
    ...records
      .filter(isTargetMonthRecord)
      .map((record) => makeAssetMonthKey(record)),
  ]);

  applyWealthStateLocal({
    records: nextRecords,
    closures: nextClosures,
    instruments,
    bankTokens,
    deletedRecordIds: nextDeletedRecordIds,
    deletedRecordAssetMonthKeys: nextDeletedRecordAssetMonthKeys,
    fx,
  });

  const meta = loadDemoSeedMeta();
  if (meta) {
    const remainingHistory = meta.historyMonthKeys.filter((month) => !monthKeys.includes(month));
    if (remainingHistory.length) {
      saveDemoSeedMeta({ ...meta, historyMonthKeys: remainingHistory });
    } else {
      saveDemoSeedMeta(null);
    }
  }

  const cloud = await persistWealthStateToCloud({
    records: nextRecords,
    closures: nextClosures,
    instruments,
    bankTokens,
    deletedRecordIds: nextDeletedRecordIds,
    deletedRecordAssetMonthKeys: nextDeletedRecordAssetMonthKeys,
    fx,
  });

  return {
    removedRecords: removedRecordIds.length,
    removedClosures: Math.max(0, closures.length - nextClosures.length),
    monthKeys,
    cloudCleared: cloud.cloudCleared,
    mode: cloud.mode,
  };
};

export const clearCurrentMonthData = async (options: {
  clearInvestments?: boolean;
  clearRealEstate?: boolean;
}): Promise<{
  removedRecords: number;
  removedInvestment: number;
  removedRealEstate: number;
  cloudCleared: boolean;
  mode: 'cloud' | 'local';
}> => {
  const clearInvestments = !!options.clearInvestments;
  const clearRealEstate = !!options.clearRealEstate;
  if (!clearInvestments && !clearRealEstate) {
    return {
      removedRecords: 0,
      removedInvestment: 0,
      removedRealEstate: 0,
      cloudCleared: false,
      mode: 'local',
    };
  }

  const targetMonth = currentMonthKey();
  const monthPrefix = `${targetMonth}-`;
  const records = loadWealthRecords();
  const closures = loadClosures();
  const instruments = loadInvestmentInstruments();
  const fx = loadFxRates();
  const bankTokens = loadBankTokens();

  const shouldRemove = (record: WealthRecord) => {
    if (!record.snapshotDate.startsWith(monthPrefix)) return false;
    if (clearInvestments && record.block === 'investment') return true;
    if (clearRealEstate) {
      if (record.block === 'real_estate') return true;
      if (record.block === 'debt' && isMortgageDebtLabel(record.label)) return true;
    }
    return false;
  };

  const removedRecords = records.filter(shouldRemove);
  if (!removedRecords.length) {
    return {
      removedRecords: 0,
      removedInvestment: 0,
      removedRealEstate: 0,
      cloudCleared: false,
      mode: 'local',
    };
  }

  const nextRecords = records.filter((record) => !shouldRemove(record));
  const nextDeletedRecordIds = normalizeDeletedRecordIds([
    ...loadDeletedRecordIds(),
    ...removedRecords.map((record) => record.id),
  ]);
  const nextDeletedRecordAssetMonthKeys = normalizeDeletedRecordAssetMonthKeys([
    ...loadDeletedRecordAssetMonthKeys(),
    ...removedRecords.map((record) => makeAssetMonthKey(record)),
  ]);
  const removedInvestment = removedRecords.filter((record) => record.block === 'investment').length;
  const removedRealEstate = removedRecords.length - removedInvestment;

  applyWealthStateLocal({
    records: nextRecords,
    closures,
    instruments,
    bankTokens,
    deletedRecordIds: nextDeletedRecordIds,
    deletedRecordAssetMonthKeys: nextDeletedRecordAssetMonthKeys,
    fx,
  });

  const cloud = await persistWealthStateToCloud({
    records: nextRecords,
    closures,
    instruments,
    bankTokens,
    deletedRecordIds: nextDeletedRecordIds,
    deletedRecordAssetMonthKeys: nextDeletedRecordAssetMonthKeys,
    fx,
  });

  return {
    removedRecords: removedRecords.length,
    removedInvestment,
    removedRealEstate,
    cloudCleared: cloud.cloudCleared,
    mode: cloud.mode,
  };
};

const dateFromMonthOffset = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  d.setHours(12, 0, 0, 0);
  return d;
};

const monthKeyFromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const ymdFromDate = (d: Date, day = 15) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const endOfMonthYmd = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const end = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
};

const stripMarkdownCodeFence = (input: string) => {
  const trimmed = String(input || '').trim();
  const fence = trimmed.match(/^```(?:csv|text)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
};

const parseCsvMatrix = (csvRaw: string): string[][] => {
  const csv = stripMarkdownCodeFence(csvRaw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = csv.split('\n').filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const first = lines[0] || '';
  const commaCount = (first.match(/,/g) || []).length;
  const semicolonCount = (first.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  for (const line of lines) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        const nextChar = line[i + 1];
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && char === delimiter) {
        row.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
};

const findValueByAliases = (row: Record<string, string>, aliases: string[]) => {
  for (const alias of aliases) {
    const key = normalizeLabelKey(alias);
    if (row[key] !== undefined) return row[key];
  }
  return '';
};

const parseCsvNumber = (row: Record<string, string>, aliases: string[]) => {
  const value = findValueByAliases(row, aliases);
  if (!String(value || '').trim()) return null;
  const parsed = parseFlexibleNumeric(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseCsvMonthKey = (row: Record<string, string>) => {
  const value = findValueByAliases(row, ['month_key', 'month', 'mes', 'monthkey']);
  return normalizeMonthKey(value);
};

const parseCsvClosedAt = (row: Record<string, string>, monthKey: string) => {
  const raw = findValueByAliases(row, ['closed_at', 'fecha_cierre', 'closedat']);
  const value = String(raw || '').trim();
  if (value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const fallback = `${endOfMonthYmd(monthKey)}T23:59:59-03:00`;
  const parsedFallback = new Date(fallback);
  return Number.isFinite(parsedFallback.getTime()) ? parsedFallback.toISOString() : nowIso();
};

const buildHistoricalMonthRecords = (
  monthKey: string,
  row: Record<string, string>,
): WealthRecord[] => {
  const snapshotDate = endOfMonthYmd(monthKey);
  const entries: Array<{
    aliases: string[];
    block: WealthBlock;
    source: string;
    label: string;
    currency: WealthCurrency;
    decimals?: number;
  }> = [
    { aliases: ['sura_fin_clp', 'sura_financiero_clp'], block: 'investment', source: 'SURA', label: 'SURA inversión financiera', currency: 'CLP' },
    { aliases: ['sura_prev_clp', 'sura_previsional_clp'], block: 'investment', source: 'SURA', label: 'SURA ahorro previsional', currency: 'CLP' },
    { aliases: ['btg_clp', 'btg_total_clp'], block: 'investment', source: 'BTG Pactual', label: 'BTG total valorización', currency: 'CLP' },
    { aliases: ['planvital_clp', 'planvital_total_clp'], block: 'investment', source: 'PlanVital', label: 'PlanVital saldo total', currency: 'CLP' },
    { aliases: ['global66_usd', 'global66_total_usd'], block: 'investment', source: 'Global66', label: 'Global66 Cuenta Vista USD', currency: 'USD', decimals: 2 },
    { aliases: ['wise_usd', 'wise_total_usd'], block: 'investment', source: 'Wise', label: 'Wise Cuenta principal USD', currency: 'USD', decimals: 2 },
    { aliases: ['valor_prop_uf', 'valor_propiedad_uf'], block: 'real_estate', source: 'Tasación', label: 'Valor propiedad', currency: 'UF', decimals: 2 },
    { aliases: ['saldo_deuda_uf', 'saldo_deuda_hipotecaria_uf'], block: 'debt', source: 'Scotiabank', label: 'Saldo deuda hipotecaria', currency: 'UF', decimals: 4 },
    { aliases: ['dividendo_uf', 'dividendo_mensual_uf'], block: 'debt', source: 'Scotiabank', label: 'Dividendo hipotecario mensual', currency: 'UF', decimals: 4 },
    { aliases: ['interes_uf', 'interes_mensual_uf'], block: 'debt', source: 'Scotiabank', label: 'Interés hipotecario mensual', currency: 'UF', decimals: 4 },
    { aliases: ['seguros_uf', 'seguros_mensuales_uf'], block: 'debt', source: 'Scotiabank', label: 'Seguros hipotecarios mensuales', currency: 'UF', decimals: 4 },
    { aliases: ['amortizacion_uf', 'amortizacion_mensual_uf'], block: 'debt', source: 'Scotiabank', label: 'Amortización hipotecaria mensual', currency: 'UF', decimals: 4 },
    { aliases: ['bancos_clp'], block: 'bank', source: 'Histórico manual', label: 'Saldo bancos CLP', currency: 'CLP' },
    { aliases: ['bancos_usd'], block: 'bank', source: 'Histórico manual', label: 'Saldo bancos USD', currency: 'USD', decimals: 2 },
    { aliases: ['tarjetas_clp'], block: 'debt', source: 'Histórico manual', label: 'Deuda tarjetas CLP', currency: 'CLP' },
    { aliases: ['tarjetas_usd'], block: 'debt', source: 'Histórico manual', label: 'Deuda tarjetas USD', currency: 'USD', decimals: 2 },
  ];

  return entries
    .map((entry) => {
      const amount = parseCsvNumber(row, entry.aliases);
      if (amount === null) return null;
      const rounded =
        typeof entry.decimals === 'number'
          ? Number(amount.toFixed(entry.decimals))
          : Math.round(amount);
      const normalizedAmount = entry.block === 'debt' ? Math.abs(rounded) : rounded;
      return {
        id: crypto.randomUUID(),
        block: entry.block,
        source: entry.source,
        label: entry.label,
        amount: normalizedAmount,
        currency: entry.currency,
        snapshotDate,
        createdAt: nowIso(),
        note: 'Importado desde historial CSV',
      } satisfies WealthRecord;
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
};

export const importHistoricalClosuresFromCsv = async (
  csvText: string,
): Promise<HistoricalCsvImportResult> => {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    return {
      importedMonths: [],
      replacedMonths: [],
      skippedMonths: [],
      warnings: ['No encontré filas de datos (revisa el CSV).'],
    };
  }

  const headers = matrix[0].map((cell) => normalizeLabelKey(cell));
  const rows = matrix.slice(1);

  const importedMonths: string[] = [];
  const replacedMonths: string[] = [];
  const skippedMonths: string[] = [];
  const warnings: string[] = [];

  const existingClosures = loadClosures();
  const closureByMonth = new Map(existingClosures.map((closure) => [closure.monthKey, closure]));
  const fallbackFx = loadFxRates();
  const fallbackEurUsd =
    Number.isFinite(Number(fallbackFx.eurClp)) &&
    Number.isFinite(Number(fallbackFx.usdClp)) &&
    Number(fallbackFx.usdClp) > 0
      ? Number(fallbackFx.eurClp) / Number(fallbackFx.usdClp)
      : null;

  rows.forEach((cells, idx) => {
    const rowObj: Record<string, string> = {};
    headers.forEach((header, i) => {
      rowObj[header] = String(cells[i] || '').trim();
    });

    const monthKey = parseCsvMonthKey(rowObj);
    if (!monthKey) {
      skippedMonths.push(`fila_${idx + 2}`);
      warnings.push(`Fila ${idx + 2}: month_key inválido.`);
      return;
    }

    const usdClp = parseCsvNumber(rowObj, ['usd_clp', 'usdclp', 'tc_usd', 'dolar_clp']);
    const eurClpDirect = parseCsvNumber(rowObj, ['eur_clp', 'eurclp', 'tc_eur', 'euro_clp']);
    const eurUsd = parseCsvNumber(rowObj, ['eur_usd', 'eurusd', 'eur_usd_rate']);
    const eurUsdResolved =
      eurUsd !== null && eurUsd > 0
        ? eurUsd
        : fallbackEurUsd !== null && fallbackEurUsd > 0
          ? fallbackEurUsd
          : null;
    const eurClp =
      eurClpDirect !== null
        ? eurClpDirect
        : usdClp !== null && eurUsdResolved !== null && usdClp > 0 && eurUsdResolved > 0
          ? usdClp * eurUsdResolved
          : null;
    const ufClp = parseCsvNumber(rowObj, ['uf_clp', 'ufclp', 'valor_uf']);
    const fxMissing: Array<'usdClp' | 'eurClp' | 'ufClp'> = [];
    const usdClpResolved =
      usdClp !== null && usdClp > 0
        ? usdClp
        : Number.isFinite(Number(fallbackFx.usdClp)) && Number(fallbackFx.usdClp) > 0
          ? Number(fallbackFx.usdClp)
          : null;
    const ufClpResolved =
      ufClp !== null && ufClp > 0
        ? ufClp
        : Number.isFinite(Number(fallbackFx.ufClp)) && Number(fallbackFx.ufClp) > 0
          ? Number(fallbackFx.ufClp)
          : null;
    const eurClpResolved =
      eurClp !== null && eurClp > 0
        ? eurClp
        : Number.isFinite(Number(fallbackFx.eurClp)) && Number(fallbackFx.eurClp) > 0
          ? Number(fallbackFx.eurClp)
          : null;

    if (usdClp === null || usdClp <= 0) fxMissing.push('usdClp');
    if (ufClp === null || ufClp <= 0) fxMissing.push('ufClp');
    if (eurClpDirect === null && (eurUsd === null || eurUsd <= 0)) fxMissing.push('eurClp');

    if (![usdClpResolved, ufClpResolved, eurClpResolved].every((v) => v !== null && v > 0)) {
      skippedMonths.push(monthKey);
      warnings.push(
        `${monthKey}: faltan TC/UF y no hay respaldo válido en ajustes para completar importación.`,
      );
      return;
    }
    if (eurClpDirect === null) {
      if (eurUsd !== null && eurUsd > 0) {
        warnings.push(
          `${monthKey}: EUR/CLP no venía directo, se calculó con EUR/USD del CSV.`,
        );
      } else if (eurUsdResolved !== null && eurUsdResolved > 0) {
        warnings.push(
          `${monthKey}: EUR/CLP no venía en CSV, se estimó con EUR/USD de respaldo (${eurUsdResolved.toFixed(4)}).`,
        );
      }
    }

    const records = buildHistoricalMonthRecords(monthKey, rowObj);
    const netClpSimple = parseCsvNumber(rowObj, [
      'net_clp',
      'patrimonio_neto_clp',
      'patrimonio_neto',
      'neto_clp',
      'patrimonio_total_clp',
      'patrimonio_clp',
    ]);
    if (!records.length && netClpSimple === null) {
      skippedMonths.push(monthKey);
      warnings.push(`${monthKey}: no trae montos utilizables (ni detalle ni net_clp).`);
      return;
    }

    const fx: WealthFxRates = {
      usdClp: Math.round(Number(usdClpResolved)),
      eurClp: Math.round(Number(eurClpResolved)),
      ufClp: Math.round(Number(ufClpResolved)),
    };

    const dedupedRecords = dedupeLatestByAsset(records);
    const summary =
      dedupedRecords.length > 0
        ? summarizeWealth(dedupedRecords, fx)
        : buildSummaryFromNetClp(Number(netClpSimple || 0));
    const nextClosure: WealthMonthlyClosure = {
      id: closureByMonth.get(monthKey)?.id || crypto.randomUUID(),
      monthKey,
      closedAt: parseCsvClosedAt(rowObj, monthKey),
      summary,
      fxRates: fx,
      fxMissing: fxMissing.length ? fxMissing : undefined,
      records: dedupedRecords.length ? dedupedRecords : undefined,
    };

    if (closureByMonth.has(monthKey)) replacedMonths.push(monthKey);
    else importedMonths.push(monthKey);
    closureByMonth.set(monthKey, nextClosure);
  });

  const mergedClosures = [...closureByMonth.values()].sort(
    (a, b) => b.monthKey.localeCompare(a.monthKey),
  );
  saveClosures(mergedClosures);
  saveDemoSeedMeta(null);

  return {
    importedMonths: [...new Set(importedMonths)].sort(),
    replacedMonths: [...new Set(replacedMonths)].sort(),
    skippedMonths: [...new Set(skippedMonths)].sort(),
    warnings,
  };
};

export const previewHistoricalClosuresCsv = (csvText: string): HistoricalCsvPreviewResult => {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    return {
      monthKeys: [],
      totalRows: Math.max(0, matrix.length - 1),
      invalidMonthRows: [],
      warnings: csvText.trim() ? ['No encontré filas de datos (revisa el CSV).'] : [],
    };
  }

  const headers = matrix[0].map((cell) => normalizeLabelKey(cell));
  const rows = matrix.slice(1);
  const monthSet = new Set<string>();
  const invalidMonthRows: number[] = [];

  rows.forEach((cells, idx) => {
    const rowObj: Record<string, string> = {};
    headers.forEach((header, i) => {
      rowObj[header] = String(cells[i] || '').trim();
    });
    const monthKey = parseCsvMonthKey(rowObj);
    if (!monthKey) {
      invalidMonthRows.push(idx + 2);
      return;
    }
    monthSet.add(monthKey);
  });

  const monthKeys = [...monthSet].sort();
  const warnings: string[] = [];
  if (!monthKeys.length) warnings.push('No detecté month_key válidos en el CSV.');
  if (invalidMonthRows.length) {
    warnings.push(`Filas con month_key inválido: ${invalidMonthRows.join(', ')}.`);
  }

  return {
    monthKeys,
    totalRows: rows.length,
    invalidMonthRows,
    warnings,
  };
};

const makeDemoRecord = (
  block: WealthBlock,
  source: string,
  label: string,
  amount: number,
  currency: WealthCurrency,
  snapshotDate: string,
  note?: string,
): WealthRecord => ({
  id: crypto.randomUUID(),
  block,
  source,
  label,
  amount,
  currency,
  snapshotDate,
  createdAt: nowIso(),
  note,
});

export const seedDemoWealthTimeline = (): { janKey: string; febKey: string; marKey: string } => {
  const fx = loadFxRates();
  const janDate = dateFromMonthOffset(-2);
  const febDate = dateFromMonthOffset(-1);
  const marDate = dateFromMonthOffset(0);

  const janKey = monthKeyFromDate(janDate);
  const febKey = monthKeyFromDate(febDate);
  const marKey = monthKeyFromDate(marDate);

  const janRecords = [
    makeDemoRecord('investment', 'SURA', 'SURA inversión financiera', 607_392_657, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'SURA', 'SURA ahorro previsional', 287_631_202, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'BTG Pactual', 'BTG total valorización', 259_489_302, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'PlanVital', 'PlanVital saldo total', 249_335_715, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'Global66', 'Global66 Cuenta Vista USD', 67_098.43, 'USD', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'Wise', 'Wise Cuenta principal USD', 3_812.81, 'USD', ymdFromDate(janDate, 30)),
    makeDemoRecord('real_estate', 'Tasación', 'Valor propiedad', 12_350, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Saldo deuda hipotecaria', 8_859.30, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Dividendo hipotecario mensual', 53.24, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Interés hipotecario mensual', 21.34, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Seguros hipotecarios mensuales', 4.14, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Amortización hipotecaria mensual', 27.77, 'UF', ymdFromDate(janDate, 30)),
  ];

  const febRecords = [
    makeDemoRecord('investment', 'SURA', 'SURA inversión financiera', 618_690_210, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'SURA', 'SURA ahorro previsional', 288_702_447, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'BTG Pactual', 'BTG total valorización', 264_741_547, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'PlanVital', 'PlanVital saldo total', 251_125_440, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'Global66', 'Global66 Cuenta Vista USD', 68_210.12, 'USD', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'Wise', 'Wise Cuenta principal USD', 3_470.60, 'USD', ymdFromDate(febDate, 28)),
    makeDemoRecord('real_estate', 'Tasación', 'Valor propiedad', 12_420, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Saldo deuda hipotecaria', 8_831.54, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Dividendo hipotecario mensual', 53.24, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Interés hipotecario mensual', 21.34, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Seguros hipotecarios mensuales', 4.14, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Amortización hipotecaria mensual', 27.77, 'UF', ymdFromDate(febDate, 28)),
  ];

  const marRecords = [
    makeDemoRecord('investment', 'SURA', 'SURA inversión financiera', 623_940_180, 'CLP', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('investment', 'SURA', 'SURA ahorro previsional', 288_800_030, 'CLP', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('investment', 'BTG Pactual', 'BTG total valorización', 269_102_980, 'CLP', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('investment', 'PlanVital', 'PlanVital saldo total', 252_480_900, 'CLP', ymdFromDate(marDate, 2), 'Arrastrado desde cierre anterior'),
    makeDemoRecord('investment', 'Global66', 'Global66 Cuenta Vista USD', 67_902.54, 'USD', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('investment', 'Wise', 'Wise Cuenta principal USD', 3_398.20, 'USD', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('real_estate', 'Tasación', 'Valor propiedad', 12_430, 'UF', ymdFromDate(marDate, 2), 'Arrastrado desde cierre anterior'),
    makeDemoRecord('debt', 'Scotiabank', 'Saldo deuda hipotecaria', 8_803.77, 'UF', ymdFromDate(marDate, 2), 'Estimado automático'),
    makeDemoRecord('debt', 'Scotiabank', 'Dividendo hipotecario mensual', 53.24, 'UF', ymdFromDate(marDate, 2), 'Estimado automático'),
    makeDemoRecord('debt', 'Scotiabank', 'Interés hipotecario mensual', 21.34, 'UF', ymdFromDate(marDate, 2), 'Estimado automático'),
    makeDemoRecord('debt', 'Scotiabank', 'Seguros hipotecarios mensuales', 4.14, 'UF', ymdFromDate(marDate, 2), 'Estimado automático'),
    makeDemoRecord('debt', 'Scotiabank', 'Amortización hipotecaria mensual', 27.77, 'UF', ymdFromDate(marDate, 2), 'Estimado automático'),
  ];

  const janSummary = summarizeWealth(dedupeLatestByAsset(janRecords), fx);
  const febSummary = summarizeWealth(dedupeLatestByAsset(febRecords), fx);

  const closures: WealthMonthlyClosure[] = [
    {
      id: crypto.randomUUID(),
      monthKey: febKey,
      closedAt: new Date(febDate.getFullYear(), febDate.getMonth(), 28, 18, 0, 0, 0).toISOString(),
      summary: febSummary,
      fxRates: { ...fx },
      records: dedupeLatestByAsset(febRecords),
    },
    {
      id: crypto.randomUUID(),
      monthKey: janKey,
      closedAt: new Date(janDate.getFullYear(), janDate.getMonth(), 31, 18, 0, 0, 0).toISOString(),
      summary: janSummary,
      fxRates: { ...fx },
      records: dedupeLatestByAsset(janRecords),
    },
  ];

  saveWealthRecords([...marRecords, ...febRecords, ...janRecords].sort(sortByCreatedDesc));
  saveClosures(closures);
  saveDemoSeedMeta({
    seededAt: nowIso(),
    janKey,
    febKey,
    marKey,
    historyMonthKeys: [janKey, febKey],
  });

  return { janKey, febKey, marKey };
};

export const clearWealthDataForFreshStart = async (
  options?: { preserveFx?: boolean },
): Promise<{ cloudCleared: boolean; mode: 'cloud' | 'local' }> => {
  const preserveFx = options?.preserveFx !== false;
  const nextFx = preserveFx ? loadFxRates() : { ...defaultFxRates };
  const bankTokens = loadBankTokens();

  applyWealthStateLocal({
    records: [],
    closures: [],
    instruments: [],
    bankTokens,
    deletedRecordIds: [],
    deletedRecordAssetMonthKeys: [],
    fx: nextFx,
  });
  saveDemoSeedMeta(null);
  const cloud = await persistWealthStateToCloud({
    records: [],
    closures: [],
    instruments: [],
    bankTokens,
    deletedRecordIds: [],
    deletedRecordAssetMonthKeys: [],
    fx: nextFx,
  });
  return cloud;
};
