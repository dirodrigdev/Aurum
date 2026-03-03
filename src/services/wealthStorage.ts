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

export const mortgageAutoCalcDefaults: MortgageAutoCalcConfig = {
  initialDebtUf: 8831.535,
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
      ufClp: Math.max(1, toNumber(parsed?.ufClp, defaultFxRates.ufClp)),
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
      .map((item: any) => ({
        id: String(item?.id || crypto.randomUUID()),
        monthKey: String(item?.monthKey || ''),
        closedAt: String(item?.closedAt || nowIso()),
        summary: item?.summary,
        fxRates: item?.fxRates
          ? {
              usdClp: Math.max(1, toNumber(item.fxRates?.usdClp, defaultFxRates.usdClp)),
              eurClp: Math.max(1, toNumber(item.fxRates?.eurClp, defaultFxRates.eurClp)),
              ufClp: Math.max(1, toNumber(item.fxRates?.ufClp, defaultFxRates.ufClp)),
            }
          : undefined,
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
    makeDemoRecord('investment', 'SURA', 'SURA saldo total', 895_023_859, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'BTG Pactual', 'BTG total valorización', 259_489_302, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('investment', 'PlanVital', 'PlanVital saldo total', 249_335_715, 'CLP', ymdFromDate(janDate, 30)),
    makeDemoRecord('bank', 'Global66', 'Global66 Cuenta Vista USD', 67_098.43, 'USD', ymdFromDate(janDate, 30)),
    makeDemoRecord('bank', 'Wise', 'Wise Cuenta principal USD', 3_812.81, 'USD', ymdFromDate(janDate, 30)),
    makeDemoRecord('real_estate', 'Tasación', 'Valor propiedad', 12_350, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Saldo deuda hipotecaria', 8_859.30, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Dividendo hipotecario mensual', 53.24, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Interés hipotecario mensual', 21.34, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Seguros hipotecarios mensuales', 4.14, 'UF', ymdFromDate(janDate, 30)),
    makeDemoRecord('debt', 'Scotiabank', 'Amortización hipotecaria mensual', 27.77, 'UF', ymdFromDate(janDate, 30)),
  ];

  const febRecords = [
    makeDemoRecord('investment', 'SURA', 'SURA saldo total', 907_392_657, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'BTG Pactual', 'BTG total valorización', 264_741_547, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('investment', 'PlanVital', 'PlanVital saldo total', 251_125_440, 'CLP', ymdFromDate(febDate, 28)),
    makeDemoRecord('bank', 'Global66', 'Global66 Cuenta Vista USD', 68_210.12, 'USD', ymdFromDate(febDate, 28)),
    makeDemoRecord('bank', 'Wise', 'Wise Cuenta principal USD', 3_470.60, 'USD', ymdFromDate(febDate, 28)),
    makeDemoRecord('real_estate', 'Tasación', 'Valor propiedad', 12_420, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Saldo deuda hipotecaria', 8_831.54, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Dividendo hipotecario mensual', 53.24, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Interés hipotecario mensual', 21.34, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Seguros hipotecarios mensuales', 4.14, 'UF', ymdFromDate(febDate, 28)),
    makeDemoRecord('debt', 'Scotiabank', 'Amortización hipotecaria mensual', 27.77, 'UF', ymdFromDate(febDate, 28)),
  ];

  const marRecords = [
    makeDemoRecord('investment', 'SURA', 'SURA saldo total', 912_740_210, 'CLP', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('investment', 'BTG Pactual', 'BTG total valorización', 269_102_980, 'CLP', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('investment', 'PlanVital', 'PlanVital saldo total', 252_480_900, 'CLP', ymdFromDate(marDate, 2), 'Arrastrado desde cierre anterior'),
    makeDemoRecord('bank', 'Global66', 'Global66 Cuenta Vista USD', 67_902.54, 'USD', ymdFromDate(marDate, 2), 'Actualizado parcial'),
    makeDemoRecord('bank', 'Wise', 'Wise Cuenta principal USD', 3_398.20, 'USD', ymdFromDate(marDate, 2), 'Actualizado parcial'),
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
