import {
  buildCanonicalClosureSummary,
  dedupeLatestByAsset,
  latestRecordsForMonth,
  makeAssetKey,
} from './wealthStorage';
import type {
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  WealthRecord,
  WealthSnapshotSummary,
} from './wealthStorage';

export type EvolutionKey =
  | 'sura' | 'sura-fin' | 'sura-prev' | 'btg' | 'planvital'
  | 'global66' | 'wise' | 'tenencia' | 'property' | 'banks'
  | 'investments' | 'risk' | 'net';

export interface EvolutionMonth {
  monthKey: string;
  provisional: boolean;
  fx: WealthFxRates | null;
  amountsClp: Record<EvolutionKey, number | null>;
}

export const EVOLUTION_SERIES: Array<{ key: EvolutionKey; label: string; color: string }> = [
  { key: 'sura', label: 'SURA total', color: '#2563eb' },
  { key: 'btg', label: 'BTG Pactual', color: '#0891b2' },
  { key: 'planvital', label: 'PlanVital', color: '#7c3aed' },
  { key: 'property', label: 'Inmueble neto', color: '#d97706' },
  { key: 'global66', label: 'Global66', color: '#059669' },
  { key: 'sura-fin', label: 'SURA financiera', color: '#3b82f6' },
  { key: 'sura-prev', label: 'SURA previsional', color: '#818cf8' },
  { key: 'wise', label: 'Wise', color: '#be185d' },
  { key: 'tenencia', label: 'Tenencia / CxC', color: '#c2410c' },
  { key: 'banks', label: 'Bancos (total)', color: '#64748b' },
  { key: 'investments', label: 'Inversiones (sin riesgo)', color: '#0f766e' },
  { key: 'risk', label: 'Capital de riesgo', color: '#a16207' },
  { key: 'net', label: 'Patrimonio neto (sin riesgo)', color: '#0f172a' },
];

export const DEFAULT_EVOLUTION_KEYS: EvolutionKey[] = [
  'sura', 'btg', 'planvital', 'property', 'global66',
];

const keys = EVOLUTION_SERIES.map((item) => item.key);

const normalize = (value: string) =>
  value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const hasValidFx = (fx: WealthFxRates | null | undefined): fx is WealthFxRates =>
  Boolean(fx && [fx.usdClp, fx.eurClp, fx.ufClp].every((v) => Number.isFinite(v) && v > 0));

const toClp = (amount: number, currency: WealthCurrency, fx: WealthFxRates): number => {
  if (currency === 'USD') return amount * fx.usdClp;
  if (currency === 'EUR') return amount * fx.eurClp;
  if (currency === 'UF') return amount * fx.ufClp;
  return amount;
};

const numericOrNull = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const sumMatching = (
  records: WealthRecord[],
  fx: WealthFxRates | null,
  predicate: (record: WealthRecord, label: string) => boolean,
): number | null => {
  if (!fx) return null;
  const matching = records.filter((record) => predicate(record, normalize(record.label)));
  return matching.length
    ? matching.reduce((total, record) => total + toClp(record.amount, record.currency, fx), 0)
    : null;
};

const buildMonth = (
  monthKey: string,
  provisional: boolean,
  records: WealthRecord[],
  summary: WealthSnapshotSummary,
  fx: WealthFxRates | null,
): EvolutionMonth => {
  const cleanRecords = dedupeLatestByAsset(records);
  const amounts = Object.fromEntries(keys.map((key) => [key, null])) as Record<EvolutionKey, number | null>;
  const inv = (label: string) => (record: WealthRecord, name: string) =>
    record.block === 'investment' && name === label;
  amounts['sura-fin'] = sumMatching(cleanRecords, fx, inv('sura inversion financiera'));
  amounts['sura-prev'] = sumMatching(cleanRecords, fx, inv('sura ahorro previsional'));
  if (amounts['sura-fin'] !== null && amounts['sura-prev'] !== null) {
    amounts.sura = amounts['sura-fin'] + amounts['sura-prev'];
  }
  amounts.btg = sumMatching(cleanRecords, fx, inv('btg total valorizacion'));
  amounts.planvital = sumMatching(cleanRecords, fx, inv('planvital saldo total'));
  amounts.global66 = sumMatching(cleanRecords, fx, inv('global66 cuenta vista usd'));
  amounts.wise = sumMatching(cleanRecords, fx, inv('wise cuenta principal usd'));
  amounts.tenencia = sumMatching(cleanRecords, fx, (record, label) =>
    record.block === 'investment' && label.startsWith('tenencia / cxc'));
  amounts.property = numericOrNull(summary.realEstateNetClp);
  amounts.banks = numericOrNull(summary.bankClp);
  amounts.investments = numericOrNull(summary.investmentClp);
  amounts.risk = numericOrNull(summary.riskCapitalClp);
  amounts.net = numericOrNull(summary.netClp);

  // Show individual balances only when source records exist. Aggregate historical
  // snapshots can supply totals, but cannot reconstruct institution balances.
  if (!cleanRecords.length) {
    ['sura', 'sura-fin', 'sura-prev', 'btg', 'planvital', 'global66', 'wise', 'tenencia']
      .forEach((key) => { amounts[key as EvolutionKey] = null; });
  }
  return { monthKey, provisional, fx, amountsClp: amounts };
};

/** Pure read-only transformation: closures remain the source of truth for closed months. */
export const buildInvestmentEvolutionHistory = (
  closures: WealthMonthlyClosure[],
  records: WealthRecord[],
  liveFx: WealthFxRates,
  today = new Date(),
): EvolutionMonth[] => {
  const official = [...closures]
    .filter((closure) => closure.summary && !closure.analysisProvisionalReason)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const months = official.map((closure) => buildMonth(
    closure.monthKey,
    false,
    closure.records || [],
    closure.summary,
    hasValidFx(closure.fxRates) ? closure.fxRates : null,
  ));
  const todayKey = String(today.getFullYear()) + '-' + String(today.getMonth() + 1).padStart(2, '0');
  const latestClosed = official.at(-1);
  if (latestClosed && todayKey <= latestClosed.monthKey) return months;
  const live = latestRecordsForMonth(records, todayKey);
  if (!live.length || !hasValidFx(liveFx)) return months;

  // The provisional *total* is not trustworthy when only some assets have
  // been entered. Individual instruments still display their real values.
  const baseline = latestClosed?.records || [];
  const liveKeys = new Set(live.map(makeAssetKey));
  const isComplete = baseline.length > 0 && baseline
    .filter((record) => normalize(record.label) !== 'checkpoint inicio mes')
    .every((record) => liveKeys.has(makeAssetKey(record)));
  const provisionalSummary = buildCanonicalClosureSummary(live, liveFx);
  if (!isComplete) {
    provisionalSummary.netClp = undefined;
    provisionalSummary.investmentClp = undefined;
    provisionalSummary.bankClp = undefined;
    provisionalSummary.realEstateNetClp = undefined;
    provisionalSummary.riskCapitalClp = undefined;
  }
  months.push(buildMonth(todayKey, true, live, provisionalSummary, liveFx));
  return months;
};

export const convertEvolutionAmount = (
  valueClp: number | null,
  currency: WealthCurrency,
  fx: WealthFxRates | null,
): number | null => {
  if (valueClp === null || !Number.isFinite(valueClp)) return null;
  if (currency === 'CLP') return valueClp;
  if (!fx || !hasValidFx(fx)) return null;
  const rate = currency === 'USD' ? fx.usdClp : currency === 'EUR' ? fx.eurClp : fx.ufClp;
  return valueClp / rate;
};
