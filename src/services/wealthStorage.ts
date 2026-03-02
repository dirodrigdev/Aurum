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
}

const RECORDS_KEY = 'wealth_records_v1';
const CLOSURES_KEY = 'wealth_closures_v1';
const FX_KEY = 'wealth_fx_v1';

const nowIso = () => new Date().toISOString();

const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const defaultFxRates: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
};

const sortByCreatedDesc = (a: WealthRecord, b: WealthRecord) => {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
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

  const merged = existing
    ? current.map((r) => (r.id === id ? next : r))
    : [next, ...current];

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

export const summarizeWealth = (
  records: WealthRecord[],
  fxRates: WealthFxRates,
): WealthSnapshotSummary => {
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
  const summary = summarizeWealth(records, fxRates);

  const nextClosure: WealthMonthlyClosure = {
    id: crypto.randomUUID(),
    monthKey,
    closedAt: nowIso(),
    summary,
  };

  const withoutSameMonth = closures.filter((c) => c.monthKey !== monthKey);
  const next = [nextClosure, ...withoutSameMonth].sort((a, b) =>
    new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
  );

  saveClosures(next);
  return nextClosure;
};
