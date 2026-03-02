export type WealthCurrency = 'CLP' | 'USD' | 'EUR';

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
  records?: WealthRecord[];
}

export interface MortgageAutoCalcConfig {
  dividendUf: number;
  interestUf: number;
  fireInsuranceUf: number;
  lifeInsuranceUf: number;
}

const RECORDS_KEY = 'wealth_records_v1';
const CLOSURES_KEY = 'wealth_closures_v1';
const FX_KEY = 'wealth_fx_v1';

export const mortgageAutoCalcDefaults: MortgageAutoCalcConfig = {
  dividendUf: 53.2439,
  interestUf: 21.3361,
  fireInsuranceUf: 3.67,
  lifeInsuranceUf: 0.4716,
};

const nowIso = () => new Date().toISOString();

const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const defaultFxRates: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
};

const sortByCreatedDesc = (a: WealthRecord, b: WealthRecord) => {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
};

export const makeAssetKey = (record: Pick<WealthRecord, 'block' | 'source' | 'label' | 'currency'>) => {
  return `${record.block}::${record.source.trim().toLowerCase()}::${record.label
    .trim()
    .toLowerCase()}::${record.currency}`;
};

export const loadWealthRecords = (): WealthRecord[] => {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => ({
        id: String(item?.id || crypto.randomUUID()),
        block: (item?.block || 'investment') as WealthBlock,
        source: String(item?.source || 'manual'),
        label: String(item?.label || 'Registro'),
        amount: toNumber(item?.amount),
        currency: (item?.currency || 'CLP') as WealthCurrency,
        snapshotDate: String(item?.snapshotDate || nowIso().slice(0, 10)),
        createdAt: String(item?.createdAt || nowIso()),
        note: item?.note ? String(item.note) : undefined,
      }))
      .filter((item: WealthRecord) => Number.isFinite(item.amount))
      .sort(sortByCreatedDesc);
  } catch {
    return [];
  }
};

export const saveWealthRecords = (records: WealthRecord[]) => {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
};

export const upsertWealthRecord = (input: Omit<WealthRecord, 'id' | 'createdAt'> & { id?: string }) => {
  const current = loadWealthRecords();
  const id = input.id || crypto.randomUUID();
  const existing = current.find((r) => r.id === id);

  const next: WealthRecord = {
    id,
    createdAt: existing?.createdAt || nowIso(),
    block: input.block,
    source: input.source,
    label: input.label,
    amount: toNumber(input.amount),
    currency: input.currency,
    snapshotDate: input.snapshotDate,
    note: input.note,
  };

  const merged = existing ? current.map((r) => (r.id === id ? next : r)) : [next, ...current];

  saveWealthRecords(merged.sort(sortByCreatedDesc));
  return next;
};

export const removeWealthRecord = (id: string) => {
  const next = loadWealthRecords().filter((r) => r.id !== id);
  saveWealthRecords(next);
};

export const loadFxRates = (): WealthFxRates => {
  try {
    const raw = localStorage.getItem(FX_KEY);
    if (!raw) return { ...defaultFxRates };
    const parsed = JSON.parse(raw);
    return {
      usdClp: Math.max(1, toNumber(parsed?.usdClp, defaultFxRates.usdClp)),
      eurClp: Math.max(1, toNumber(parsed?.eurClp, defaultFxRates.eurClp)),
    };
  } catch {
    return { ...defaultFxRates };
  }
};

export const saveFxRates = (rates: WealthFxRates) => {
  localStorage.setItem(FX_KEY, JSON.stringify(rates));
};

const emptyCurrencyMap = (): Record<WealthCurrency, number> => ({
  CLP: 0,
  USD: 0,
  EUR: 0,
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
    const ds = dateToComparable(b.snapshotDate).localeCompare(dateToComparable(a.snapshotDate));
    if (ds !== 0) return ds;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
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
  };

  const netConsolidatedClp =
    netByCurrency.CLP + netByCurrency.USD * fxRates.usdClp + netByCurrency.EUR * fxRates.eurClp;

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
      .map((item: any) => ({
        id: String(item?.id || crypto.randomUUID()),
        monthKey: String(item?.monthKey || ''),
        closedAt: String(item?.closedAt || nowIso()),
        summary: item?.summary,
        records: Array.isArray(item?.records)
          ? item.records.map((r: any) => ({
              id: String(r?.id || crypto.randomUUID()),
              block: (r?.block || 'investment') as WealthBlock,
              source: String(r?.source || 'manual'),
              label: String(r?.label || 'Registro'),
              amount: toNumber(r?.amount),
              currency: (r?.currency || 'CLP') as WealthCurrency,
              snapshotDate: String(r?.snapshotDate || nowIso().slice(0, 10)),
              createdAt: String(r?.createdAt || nowIso()),
              note: r?.note ? String(r.note) : undefined,
            }))
          : undefined,
      }))
      .filter((item: WealthMonthlyClosure) => !!item.monthKey && !!item.summary)
      .sort((a: WealthMonthlyClosure, b: WealthMonthlyClosure) => {
        return new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime();
      });
  } catch {
    return [];
  }
};

export const saveClosures = (closures: WealthMonthlyClosure[]) => {
  localStorage.setItem(CLOSURES_KEY, JSON.stringify(closures));
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
): { added: number; sourceMonth: string | null } => {
  const records = loadWealthRecords();
  const closures = loadClosures();
  const previous = findPreviousClosureWithRecords(targetMonthKey, closures);

  if (!previous || !previous.records?.length) {
    return { added: 0, sourceMonth: null };
  }

  const currentKeys = new Set(latestRecordsForMonth(records, targetMonthKey).map((r) => makeAssetKey(r)));

  const toAdd: WealthRecord[] = [];

  for (const oldRecord of previous.records) {
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
      note: `Arrastrado desde cierre ${previous.monthKey}`,
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
  return n.includes('arrastrado') || n.includes('estimado');
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

  const insuranceUf = config.fireInsuranceUf + config.lifeInsuranceUf;
  const amortizationUf = config.dividendUf - config.interestUf - insuranceUf;
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
      currency: existing?.currency || prevDebt.currency,
      snapshotDate: existing?.snapshotDate || snapshotDate,
      note: hasPreviousClosure
        ? `Estimado automático desde cierre ${previous?.monthKey}`
        : `Estimado automático con base inicial. Saldo mes anterior inferido: ${inferredPreviousDebtUf?.toFixed(4)} UF`,
    });
    return true;
  };

  let changed = 0;
  if (upsertIfMissingOrAutofill('Dividendo hipotecario mensual', config.dividendUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Interés hipotecario mensual', config.interestUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Seguros hipotecarios mensuales', insuranceUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Amortización hipotecaria mensual', amortizationUf)) changed += 1;
  if (upsertIfMissingOrAutofill('Saldo deuda hipotecaria', newDebtUf)) changed += 1;

  if (changed === 0) {
    return { changed: 0, sourceMonth, skipped: false, reason: 'no_change' };
  }
  return { changed, sourceMonth, skipped: false };
};
