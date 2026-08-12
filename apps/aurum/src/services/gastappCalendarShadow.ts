import type { WealthCurrency, WealthFxRates, WealthMonthlyClosure } from './wealthStorage';
import type { GastappCalendarShadowSnapshot } from './gastappCalendarShadowContract';

export const GASTAPP_CALENDAR_SHADOW_FEATURE_FLAG = 'VITE_AURUM_GASTAPP_CALENDAR_SHADOW';

export type GastappCalendarShadowMonthlyRow = {
  universe: 'shadow-calendar';
  monthKey: string;
  fx: WealthFxRates;
  fxAuditable: boolean;
  fxMissing: Array<'usdClp' | 'eurClp' | 'ufClp'>;
  netClp: number | null;
  prevNetClp: number | null;
  varPatrimonioClp: number | null;
  gastosStatus: 'complete' | 'missing';
  gastosEur: number | null;
  gastosClp: number | null;
  retornoRealClp: number | null;
  netDisplay: number | null;
  prevNetDisplay: number | null;
  varPatrimonioDisplay: number | null;
  gastosDisplay: number | null;
  retornoRealDisplay: number | null;
  pct: number | null;
  inflationMonthlyRate: number | null;
  pctReal: number | null;
  warnings: readonly string[];
};

export type GastappCalendarShadowSummary = {
  universe: 'shadow-calendar';
  validMonths: number;
  expectedMonths: number;
  spendEur: number | null;
  retornoRealClp: number | null;
  pctRetorno: number | null;
  coverage: 'complete' | 'partial' | 'insufficient';
};

export type GastappCalendarShadowActivationStatus = 'disabled' | 'ready' | 'blocked';

const DEFAULT_FX_RATES: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
};

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthAfter = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return null;
  const nextMonth = monthRaw === 12 ? 1 : monthRaw + 1;
  const nextYear = monthRaw === 12 ? yearRaw + 1 : yearRaw;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const currentOperationalMonthKey = (closures: WealthMonthlyClosure[]) => {
  const fallbackDate = new Date();
  const fallback = `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}`;
  const latestClosedMonth = [...closures]
    .map((closure) => closure.monthKey)
    .sort((left, right) => right.localeCompare(left))[0];
  return latestClosedMonth ? monthAfter(latestClosedMonth) || fallback : fallback;
};

const summaryNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const resolveFx = (closure: WealthMonthlyClosure) => {
  const fx: WealthFxRates = {
    usdClp: Number(closure.fxRates?.usdClp) > 0 ? Number(closure.fxRates?.usdClp) : DEFAULT_FX_RATES.usdClp,
    eurClp: Number(closure.fxRates?.eurClp) > 0 ? Number(closure.fxRates?.eurClp) : DEFAULT_FX_RATES.eurClp,
    ufClp: Number(closure.fxRates?.ufClp) > 0 ? Number(closure.fxRates?.ufClp) : DEFAULT_FX_RATES.ufClp,
  };
  const missingFromValues: Array<'usdClp' | 'eurClp' | 'ufClp'> = [];
  if (!(Number(closure.fxRates?.usdClp) > 0)) missingFromValues.push('usdClp');
  if (!(Number(closure.fxRates?.eurClp) > 0)) missingFromValues.push('eurClp');
  if (!(Number(closure.fxRates?.ufClp) > 0)) missingFromValues.push('ufClp');
  const missingFromClosure = Array.isArray(closure.fxMissing)
    ? closure.fxMissing.filter((key): key is 'usdClp' | 'eurClp' | 'ufClp' =>
      key === 'usdClp' || key === 'eurClp' || key === 'ufClp')
    : [];
  const fxMissing = Array.from(new Set([...missingFromValues, ...missingFromClosure]));
  return { fx, fxAuditable: fxMissing.length === 0, fxMissing };
};

const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

const annualizedCompoundedReturn = (rows: Array<Pick<GastappCalendarShadowMonthlyRow, 'pct'>>): number | null => {
  const returns = rows
    .map((row) => (row.pct === null || !Number.isFinite(row.pct) ? null : row.pct / 100))
    .filter((value): value is number => value !== null);
  if (!returns.length) return null;
  const growth = returns.reduce((product, value) => product * (1 + value), 1);
  if (!Number.isFinite(growth) || growth <= 0) return null;
  return (Math.pow(growth, 12 / returns.length) - 1) * 100;
};

export const isGastappCalendarShadowEnabled = () =>
  String(import.meta.env.VITE_AURUM_GASTAPP_CALENDAR_SHADOW || '').toLowerCase() === 'true';

export const getGastappCalendarShadowActivationStatus = (
  snapshot: GastappCalendarShadowSnapshot,
): GastappCalendarShadowActivationStatus => {
  if (!isGastappCalendarShadowEnabled()) return 'disabled';
  if (snapshot.manifest.sourceKind !== 'stable') return 'blocked';
  return snapshot.manifest.readinessStatus === 'blocked' ? 'blocked' : 'ready';
};

export const computeGastappCalendarShadowRows = ({
  closures,
  snapshot,
  currency,
  includeRiskCapitalInTotals,
}: {
  closures: WealthMonthlyClosure[];
  snapshot: GastappCalendarShadowSnapshot;
  currency: WealthCurrency;
  includeRiskCapitalInTotals: boolean;
}): GastappCalendarShadowMonthlyRow[] => {
  if (snapshot.manifest.readinessStatus === 'blocked') return [];

  const spendByMonth = snapshot.manifest.totalsByCalendarMonth;
  const operationalMonthKey = currentOperationalMonthKey(closures);
  const sortedClosures = [...closures]
    .filter((closure) => closure.monthKey !== operationalMonthKey)
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  const rows: GastappCalendarShadowMonthlyRow[] = [];
  let previousValidNet: number | null = null;
  let previousValidNetDisplay: number | null = null;
  let previousAuditableUfClp: number | null = null;

  for (const closure of sortedClosures) {
    const { fx, fxAuditable, fxMissing } = resolveFx(closure);
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const netDisplay =
      invalidNet || netClp === null || (!fxAuditable && currency !== 'CLP')
        ? null
        : convertFromClp(netClp, currency, fx);
    const prevNetClp = invalidNet ? null : previousValidNet;
    const prevNetDisplay = invalidNet || (!fxAuditable && currency !== 'CLP') ? null : previousValidNetDisplay;
    const varPatrimonioClp =
      invalidNet || prevNetClp === null || netClp === null ? null : netClp - prevNetClp;
    const varPatrimonioDisplay =
      invalidNet || prevNetDisplay === null || netDisplay === null ? null : netDisplay - prevNetDisplay;
    const hasCanonicalSpend = Object.prototype.hasOwnProperty.call(spendByMonth, closure.monthKey);
    const gastosEur = hasCanonicalSpend ? Number(spendByMonth[closure.monthKey]) : null;
    const gastosStatus = gastosEur !== null && Number.isFinite(gastosEur) ? 'complete' : 'missing';
    const gastosClp = invalidNet || !fxAuditable || gastosEur === null ? null : gastosEur * fx.eurClp;
    const gastosDisplay = gastosClp === null ? null : convertFromClp(gastosClp, currency, fx);
    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const retornoRealDisplay =
      varPatrimonioDisplay === null || gastosDisplay === null ? null : varPatrimonioDisplay + gastosDisplay;
    const pct =
      retornoRealDisplay === null || prevNetDisplay === null || prevNetDisplay === 0
        ? null
        : (retornoRealDisplay / prevNetDisplay) * 100;
    const currentUfClp = Number(fx.ufClp);
    const inflationMonthlyRate =
      currency === 'CLP' &&
      fxAuditable &&
      previousAuditableUfClp !== null &&
      currentUfClp > 0 &&
      previousAuditableUfClp > 0
        ? currentUfClp / previousAuditableUfClp - 1
        : null;
    const pctReal =
      pct === null || inflationMonthlyRate === null || 1 + inflationMonthlyRate <= 0
        ? null
        : (((1 + pct / 100) / (1 + inflationMonthlyRate)) - 1) * 100;

    if (!invalidNet) {
      previousValidNet = netClp;
      if (netDisplay !== null && Number.isFinite(netDisplay)) previousValidNetDisplay = netDisplay;
    }
    if (fxAuditable && currentUfClp > 0) previousAuditableUfClp = currentUfClp;

    rows.push({
      universe: 'shadow-calendar',
      monthKey: closure.monthKey,
      fx,
      fxAuditable,
      fxMissing,
      netClp,
      prevNetClp,
      varPatrimonioClp,
      gastosStatus,
      gastosEur,
      gastosClp,
      retornoRealClp,
      netDisplay,
      prevNetDisplay,
      varPatrimonioDisplay,
      gastosDisplay,
      retornoRealDisplay,
      pct,
      inflationMonthlyRate,
      pctReal,
      warnings: [
        gastosStatus === 'missing' ? 'calendar_month_without_canonical_spend' : null,
        !fxAuditable ? 'fx_not_auditable' : null,
      ].filter((warning): warning is string => Boolean(warning)),
    });
  }

  return rows;
};

export const aggregateGastappCalendarShadowRows = (
  rows: readonly GastappCalendarShadowMonthlyRow[],
  expectedMonthKeys?: readonly string[],
): GastappCalendarShadowSummary => {
  const expected = expectedMonthKeys ? [...expectedMonthKeys] : rows.map((row) => row.monthKey);
  const validRows = rows.filter(
    (row) =>
      row.varPatrimonioClp !== null &&
      row.gastosClp !== null &&
      row.retornoRealClp !== null &&
      row.pct !== null,
  );
  const validExpectedRows = validRows.filter((row) => expected.includes(row.monthKey));
  const validMonths = validExpectedRows.length;
  const expectedMonths = expected.length;
  const coverage =
    expectedMonths === 0 || validMonths === 0
      ? 'insufficient'
      : validMonths === expectedMonths
        ? 'complete'
        : 'partial';

  return {
    universe: 'shadow-calendar',
    validMonths,
    expectedMonths,
    spendEur: validMonths ? validExpectedRows.reduce((sum, row) => sum + Number(row.gastosEur || 0), 0) : null,
    retornoRealClp: validMonths
      ? validExpectedRows.reduce((sum, row) => sum + Number(row.retornoRealClp || 0), 0)
      : null,
    pctRetorno: annualizedCompoundedReturn(validExpectedRows),
    coverage,
  };
};
