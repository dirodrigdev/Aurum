import { doc, getDoc, setDoc } from 'firebase/firestore';
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
  records?: WealthRecord[];
}

export interface WealthInvestmentInstrument {
  id: string;
  label: string;
  currency: WealthCurrency;
  createdAt: string;
  note?: string;
  excludedMonths?: string[];
}

export interface MortgageAutoCalcConfig {
  initialDebtUf: number;
  dividendUf: number;
  interestUf: number;
  fireInsuranceUf: number;
  lifeInsuranceUf: number;
}

const RECORDS_KEY = 'wealth_records_v1';
const CLOSURES_KEY = 'wealth_closures_v1';
const FX_KEY = 'wealth_fx_v1';
const INSTRUMENTS_KEY = 'wealth_investment_instruments_v1';
const DELETED_RECORD_IDS_KEY = 'wealth_deleted_record_ids_v1';
const WEALTH_UPDATED_AT_KEY = 'wealth_updated_at_v1';
export const FX_RATES_UPDATED_EVENT = 'aurum:fx-rates-updated';
export const WEALTH_DATA_UPDATED_EVENT = 'aurum:wealth-data-updated';
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

const touchWealthUpdatedAt = () => {
  try {
    localStorage.setItem(WEALTH_UPDATED_AT_KEY, nowIso());
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
    const base = {
      id: String(item?.id || crypto.randomUUID()),
      block: remapLegacyInvestmentBanks(
        (item?.block || 'investment') as WealthBlock,
        String(item?.source || 'manual'),
        String(item?.label || 'Registro'),
      ),
      source: String(item?.source || 'manual'),
      label: String(item?.label || 'Registro'),
      amount: toNumber(item?.amount),
      currency: (item?.currency || 'CLP') as WealthCurrency,
      snapshotDate: String(item?.snapshotDate || nowIso().slice(0, 10)),
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

export const defaultFxRates: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
};

const sortByCreatedDesc = (a: WealthRecord, b: WealthRecord) => {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
};

export const makeAssetKey = (record: Pick<WealthRecord, 'block' | 'source' | 'label' | 'currency'>) => {
  return `${record.block}::${record.source.trim().toLowerCase()}::${record.label
    .trim()
    .toLowerCase()}::${record.currency}`;
};

const logicalRecordKey = (record: WealthRecord) => `${makeAssetKey(record)}::${record.snapshotDate}`;

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

const mergeDeletedRecordIds = (localIds: string[], remoteIds: string[]): string[] => {
  return normalizeDeletedRecordIds([...localIds, ...remoteIds]);
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

const saveDeletedRecordIds = (ids: string[], options?: PersistOptions) => {
  localStorage.setItem(DELETED_RECORD_IDS_KEY, JSON.stringify(normalizeDeletedRecordIds(ids)));
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

  const nextBase = {
    id,
    // En Aurum usamos createdAt como "última actualización efectiva" para resolver
    // cuál registro manda dentro del mismo activo/mes.
    createdAt: nowIso(),
    block: input.block,
    source: input.source,
    label: input.label,
    amount: toNumber(input.amount),
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
  return next;
};

export const removeWealthRecord = (id: string) => {
  const next = loadWealthRecords().filter((r) => r.id !== id);
  saveWealthRecords(next);
  const deletedIds = loadDeletedRecordIds();
  if (!deletedIds.includes(id)) {
    saveDeletedRecordIds([...deletedIds, id]);
  }
};

export const removeWealthRecordForMonthAsset = (input: {
  block: WealthBlock;
  label: string;
  currency: WealthCurrency;
  monthKey: string;
}) => {
  const monthPrefix = `${input.monthKey}-`;
  const targetLabel = normalizeText(input.label);
  const current = loadWealthRecords();
  const removedIds: string[] = [];

  const next = current.filter((record) => {
    const shouldRemove =
      record.block === input.block &&
      record.currency === input.currency &&
      record.snapshotDate.startsWith(monthPrefix) &&
      normalizeText(record.label) === targetLabel;
    if (shouldRemove) removedIds.push(record.id);
    return !shouldRemove;
  });

  if (removedIds.length === 0) return 0;

  saveWealthRecords(next);
  const deletedIds = loadDeletedRecordIds();
  const mergedDeleted = normalizeDeletedRecordIds([...deletedIds, ...removedIds]);
  saveDeletedRecordIds(mergedDeleted);
  return removedIds.length;
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
    byBlock[item.block][item.currency] += item.amount;

    if (item.block === 'debt') {
      debtsByCurrency[item.currency] += item.amount;
    } else {
      assetsByCurrency[item.currency] += item.amount;
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

export const loadClosures = (): WealthMonthlyClosure[] => {
  try {
    const raw = localStorage.getItem(CLOSURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => {
        const fxRates = item?.fxRates
          ? {
              usdClp: Math.max(1, toNumber(item.fxRates?.usdClp, defaultFxRates.usdClp)),
              eurClp: Math.max(1, toNumber(item.fxRates?.eurClp, defaultFxRates.eurClp)),
              ufClp: Math.max(1, toNumber(item.fxRates?.ufClp, defaultFxRates.ufClp)),
            }
          : undefined;

        const records = Array.isArray(item?.records)
          ? item.records
              .map((r: any) => normalizeRecord(r))
              .filter((r: WealthRecord) => !isDeprecatedSuraTotalRecord(r))
          : undefined;

        const summary =
          records && records.length
            ? summarizeWealth(dedupeLatestByAsset(records), fxRates || defaultFxRates)
            : item?.summary;

        return {
          id: String(item?.id || crypto.randomUUID()),
          monthKey: String(item?.monthKey || ''),
          closedAt: String(item?.closedAt || nowIso()),
          summary,
          fxRates,
          records,
        };
      })
      .filter((item: WealthMonthlyClosure) => !!item.monthKey && !!item.summary)
      .sort((a: WealthMonthlyClosure, b: WealthMonthlyClosure) => {
        return new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime();
      });
  } catch {
    return [];
  }
};

export const saveClosures = (closures: WealthMonthlyClosure[], options?: PersistOptions) => {
  localStorage.setItem(CLOSURES_KEY, JSON.stringify(closures));
  touchWealthUpdatedAt();
  if (!options?.silent) dispatchWealthDataUpdated();
  if (!options?.skipCloudSync) scheduleWealthCloudSync();
};

const getWealthCloudRef = async () => {
  if (!isFirebaseConfigured()) return null;
  await ensureAuthPersistence();
  const uid = getCurrentUid();
  if (!uid) return null;
  return doc(db, WEALTH_CLOUD_DOC_COLLECTION, uid);
};

let wealthCloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let wealthCloudSyncPromise: Promise<boolean> | null = null;

const syncWealthToCloudNow = async (): Promise<boolean> => {
  if (wealthCloudSyncPromise) return wealthCloudSyncPromise;

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
      const localDeletedRecordIds = loadDeletedRecordIds();
      const localUpdatedAt = readWealthUpdatedAt();

      const remoteSnap = await getDoc(ref);
      const remoteData = remoteSnap.exists() ? remoteSnap.data() || {} : {};
      const remoteRecords = normalizeRecordsFromRaw(Array.isArray(remoteData.records) ? remoteData.records : []);
      const remoteClosures = loadClosuresFromRaw(Array.isArray(remoteData.closures) ? remoteData.closures : []);
      const remoteFx = normalizeFxRates(remoteData.fx || defaultFxRates);
      const remoteInstruments = loadInstrumentsFromRaw(Array.isArray(remoteData.instruments) ? remoteData.instruments : []);
      const remoteDeletedRecordIds = normalizeDeletedRecordIds(remoteData.deletedRecordIds);
      const remoteUpdatedAt = String(remoteData.updatedAt || '');

      const mergedDeletedRecordIds = mergeDeletedRecordIds(localDeletedRecordIds, remoteDeletedRecordIds);
      const mergedDeletedSet = new Set(mergedDeletedRecordIds);
      const mergedRecords = mergeRecords(localRecords, remoteRecords).filter((record) => !mergedDeletedSet.has(record.id));
      const mergedClosures = mergeClosures(localClosures, remoteClosures);
      const mergedInstruments = mergeInvestmentInstruments(localInstruments, remoteInstruments);
      const useLocalFx =
        !remoteUpdatedAt || (!!localUpdatedAt && new Date(localUpdatedAt).getTime() >= new Date(remoteUpdatedAt).getTime());
      const mergedFx = useLocalFx ? localFx : remoteFx;
      const mergedUpdatedAt = nowIso();

      await setDoc(
        ref,
        stripUndefinedDeep({
          schemaVersion: 1,
          updatedAt: mergedUpdatedAt,
          fx: mergedFx,
          records: mergedRecords,
          closures: mergedClosures,
          instruments: mergedInstruments,
          deletedRecordIds: mergedDeletedRecordIds,
        }),
        { merge: true },
      );

      if (
        !sameRecords(localRecords, mergedRecords) ||
        !sameClosures(localClosures, mergedClosures) ||
        !sameInvestmentInstruments(localInstruments, mergedInstruments) ||
        !sameStringList(localDeletedRecordIds, mergedDeletedRecordIds) ||
        JSON.stringify(localFx) !== JSON.stringify(mergedFx)
      ) {
        saveWealthRecords(mergedRecords, { skipCloudSync: true, silent: true });
        saveClosures(mergedClosures, { skipCloudSync: true, silent: true });
        saveFxRatesInternal(mergedFx, { skipCloudSync: true, silent: true });
        saveInvestmentInstruments(mergedInstruments, { skipCloudSync: true, silent: true });
        saveDeletedRecordIds(mergedDeletedRecordIds, { skipCloudSync: true, silent: true });
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

export const scheduleWealthCloudSync = (delayMs = 700) => {
  if (typeof window === 'undefined') return;
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
    const localDeletedRecordIds = loadDeletedRecordIds();
    const localUpdatedAt = readWealthUpdatedAt();

    const remoteUpdatedAt = String(data.updatedAt || '');
    const remoteRecords = normalizeRecordsFromRaw(Array.isArray(data.records) ? data.records : []);
    const remoteClosures = loadClosuresFromRaw(Array.isArray(data.closures) ? data.closures : []);
    const remoteFx = normalizeFxRates(data.fx || defaultFxRates);
    const remoteInstruments = loadInstrumentsFromRaw(Array.isArray(data.instruments) ? data.instruments : []);
    const remoteDeletedRecordIds = normalizeDeletedRecordIds(data.deletedRecordIds);

    const mergedDeletedRecordIds = mergeDeletedRecordIds(localDeletedRecordIds, remoteDeletedRecordIds);
    const mergedDeletedSet = new Set(mergedDeletedRecordIds);
    const mergedRecords = mergeRecords(localRecords, remoteRecords).filter((record) => !mergedDeletedSet.has(record.id));
    const mergedClosures = mergeClosures(localClosures, remoteClosures);
    const mergedInstruments = mergeInvestmentInstruments(localInstruments, remoteInstruments);

    const hasLocalData = localRecords.length > 0 || localClosures.length > 0;
    const hasRemoteData = remoteRecords.length > 0 || remoteClosures.length > 0;

    const useRemoteFx =
      !!remoteUpdatedAt && (!localUpdatedAt || new Date(remoteUpdatedAt).getTime() > new Date(localUpdatedAt).getTime());
    const mergedFx = useRemoteFx ? remoteFx : localFx;

    const localNeedsUpdate =
      !sameRecords(localRecords, mergedRecords) ||
      !sameClosures(localClosures, mergedClosures) ||
      !sameInvestmentInstruments(localInstruments, mergedInstruments) ||
      !sameStringList(localDeletedRecordIds, mergedDeletedRecordIds) ||
      JSON.stringify(localFx) !== JSON.stringify(mergedFx);

    if (localNeedsUpdate) {
      saveWealthRecords(mergedRecords, { skipCloudSync: true, silent: true });
      saveClosures(mergedClosures, { skipCloudSync: true, silent: true });
      saveFxRatesInternal(mergedFx, { skipCloudSync: true, silent: true });
      saveInvestmentInstruments(mergedInstruments, { skipCloudSync: true, silent: true });
      saveDeletedRecordIds(mergedDeletedRecordIds, { skipCloudSync: true, silent: true });
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
      !sameStringList(mergedDeletedRecordIds, remoteDeletedRecordIds) ||
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
      const fxRates = item?.fxRates
        ? {
            usdClp: Math.max(1, toNumber(item.fxRates?.usdClp, defaultFxRates.usdClp)),
            eurClp: Math.max(1, toNumber(item.fxRates?.eurClp, defaultFxRates.eurClp)),
            ufClp: Math.max(1, toNumber(item.fxRates?.ufClp, defaultFxRates.ufClp)),
          }
        : undefined;

      const records = Array.isArray(item?.records)
        ? item.records
            .map((r: any) => normalizeRecord(r))
            .filter((r: WealthRecord) => !isDeprecatedSuraTotalRecord(r))
        : undefined;

      const summary =
        records && records.length ? summarizeWealth(dedupeLatestByAsset(records), fxRates || defaultFxRates) : item?.summary;

      return {
        id: String(item?.id || crypto.randomUUID()),
        monthKey: String(item?.monthKey || ''),
        closedAt: String(item?.closedAt || nowIso()),
        summary,
        fxRates,
        records,
      };
    })
    .filter((item: WealthMonthlyClosure) => !!item.monthKey && !!item.summary)
    .sort((a: WealthMonthlyClosure, b: WealthMonthlyClosure) => {
      return new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime();
    });
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
    map.set(key, tCurr >= tPrev ? closure : prev);
  }
  return [...map.values()].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
};

const serializeClosure = (c: WealthMonthlyClosure) =>
  JSON.stringify({
    monthKey: c.monthKey,
    closedAt: c.closedAt,
    fxRates: c.fxRates || null,
    records: (c.records || []).map(serializeRecord),
    summary: c.summary,
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

export const createMonthlyClosure = (
  records: WealthRecord[],
  fxRates: WealthFxRates,
  closeDate = new Date(),
): WealthMonthlyClosure => {
  const year = closeDate.getFullYear();
  const month = String(closeDate.getMonth() + 1).padStart(2, '0');
  const monthKey = `${year}-${month}`;

  const closures = loadClosures();
  const latest = dedupeLatestByAsset(records);
  const summary = summarizeWealth(latest, fxRates);

  const nextClosure: WealthMonthlyClosure = {
    id: crypto.randomUUID(),
    monthKey,
    closedAt: nowIso(),
    summary,
    fxRates: { ...fxRates },
    records: latest,
  };

  const withoutSameMonth = closures.filter((c) => c.monthKey !== monthKey);
  const next = [nextClosure, ...withoutSameMonth].sort((a, b) =>
    new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
  );

  saveClosures(next);
  return nextClosure;
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
  const previous = findPreviousClosureWithRecords(targetMonthKey, closures);

  if (!previous || !previous.records?.length) {
    return { added: 0, sourceMonth: null };
  }

  const currentKeys = new Set(latestRecordsForMonth(records, targetMonthKey).map((r) => makeAssetKey(r)));

  const toAdd: WealthRecord[] = [];
  const normalizedFilters = (onlyLabels || []).map((l) => normalizeText(l)).filter(Boolean);

  for (const oldRecord of previous.records) {
    if (normalizedFilters.length) {
      const oldLabel = normalizeText(oldRecord.label);
      const matchesFilter = normalizedFilters.some(
        (filter) => oldLabel.includes(filter) || filter.includes(oldLabel),
      );
      if (!matchesFilter) continue;
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

  return { janKey, febKey, marKey };
};
