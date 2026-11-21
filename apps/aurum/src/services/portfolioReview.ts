import type { MonthlyReturnRow } from '../components/analysis/types';
import { addMonthsToMonthKey } from './financialFreedom';
import { calculateCompoundedReturnFromMonthlyPct, convertFromClp, enumerateMonthKeys, hasOfficialClosedSpend } from './returnsAnalysis';
import {
  INVESTMENT_BTG_LABEL,
  INVESTMENT_GLOBAL66_USD_LABEL,
  INVESTMENT_PLANVITAL_LABEL,
  INVESTMENT_SURA_FIN_LABEL,
  INVESTMENT_SURA_PREV_LABEL,
  INVESTMENT_WISE_USD_LABEL,
  buildWealthNetBreakdown,
  dedupeLatestByAsset,
  filterRecordsByRiskCapitalPreference,
  isSyntheticAggregateRecord,
  maybeNormalizeMinorUnitAmount,
  resolveClosureNetClp,
  type WealthCurrency,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from './wealthStorage';

const isFiniteAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const reviewMonthOffset = (monthKey: string, offset: number) => addMonthsToMonthKey(monthKey, offset) ?? monthKey;

export const buildAnnualComparisonPeriod = (rows: MonthlyReturnRow[], endMonth: string) => {
  const startMonth = reviewMonthOffset(endMonth, -11);
  const initialMonth = reviewMonthOffset(endMonth, -12);
  const byMonth = new Map(rows.filter((row) => !row.isEstimated && !row.isPartial && !row.gastappOfficialForProvisional)
    .map((row) => [row.monthKey, row]));
  const months = enumerateMonthKeys(startMonth, endMonth).map((key) => byMonth.get(key));
  const spendRows = months.filter((row): row is MonthlyReturnRow => row !== undefined).filter(hasOfficialClosedSpend);
  const allSpend = spendRows.length === 12;
  const spend = allSpend ? spendRows.reduce((sum, row) => sum + row.gastosDisplay, 0) : null;
  const balance = (row: MonthlyReturnRow | undefined) => row?.fxAuditable && isFiniteAmount(row.netDisplay) ? row.netDisplay : null;
  const netStart = balance(byMonth.get(initialMonth));
  const netEnd = balance(byMonth.get(endMonth));
  const wealthChange = netStart !== null && netEnd !== null ? netEnd - netStart : null;
  const validReturn = netStart !== null && allSpend && months.every((row) => balance(row) !== null)
    && spendRows.every((row) => isFiniteAmount(row.pct));

  return {
    startMonth,
    endMonth,
    spendMonths: spendRows.length,
    wealthChange,
    wealthChangePct: wealthChange !== null && netStart !== null && netStart > 0 ? wealthChange / netStart * 100 : null,
    spend,
    monthlySpendEur: allSpend ? spendRows.reduce((sum, row) => sum + row.gastosClp / row.fx.eurClp, 0) / 12 : null,
    economicReturn: validReturn && wealthChange !== null && spend !== null ? wealthChange + spend : null,
    economicReturnPct: validReturn ? calculateCompoundedReturnFromMonthlyPct(spendRows) : null,
  };
};

const historicalFx = (closure: WealthMonthlyClosure): WealthFxRates | null => {
  const fx = closure.fxRates;
  return fx && !closure.fxMissing?.length && [fx.usdClp, fx.eurClp, fx.ufClp].every((rate) => isFiniteAmount(rate) && rate > 0)
    ? fx : null;
};

const closureRecords = (closure: WealthMonthlyClosure, includeRisk: boolean) =>
  filterRecordsByRiskCapitalPreference(dedupeLatestByAsset(closure.records ?? []), includeRisk)
    .filter((record) => !isSyntheticAggregateRecord(record));

const blockLabels = ['Bancos', 'Inversiones', 'Inmueble neto', 'Otras deudas'] as const;

const blocksFromRecords = (records: WealthRecord[], fx: WealthFxRates) => {
  const { bankClp, investmentClp, realEstateNetClp, nonMortgageDebtClp } = buildWealthNetBreakdown(records, fx);
  return [bankClp, investmentClp, realEstateNetClp, -nonMortgageDebtClp];
};

const blockBalances = (closure: WealthMonthlyClosure, records: WealthRecord[], fx: WealthFxRates, includeRisk: boolean) => {
  if (closure.summary.analysisByCurrency?.source === 'net_clp_only') return null;
  const summary = closure.summary;
  const investment = includeRisk ? summary.investmentClpWithRisk : summary.investmentClp;
  const debt = summary.nonMortgageDebtClp;
  const values = records.length
    ? blocksFromRecords(records, fx)
    : [summary.bankClp, investment, summary.realEstateNetClp, debt === undefined ? undefined : -debt];
  const net = resolveClosureNetClp(closure, includeRisk);
  if (net === null || !values.every(isFiniteAmount)) return null;
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - net) <= 1 ? values : null;
};

export const buildWealthChangeBridge = (
  initial: WealthMonthlyClosure,
  final: WealthMonthlyClosure,
  currency: WealthCurrency,
  includeRisk: boolean,
) => {
  const startFx = historicalFx(initial);
  const endFx = historicalFx(final);
  if (!startFx || !endFx) return null;
  const startRecords = closureRecords(initial, includeRisk);
  const endRecords = closureRecords(final, includeRisk);
  const start = blockBalances(initial, startRecords, startFx, includeRisk);
  const end = blockBalances(final, endRecords, endFx, includeRisk);
  if (!start || !end) return null;

  const hasFxBreakdown = [startRecords, endRecords].every((records) =>
    records.length > 0 && records.every((record) => record.source !== 'cierre_resumen'));
  const endAtStartFx = hasFxBreakdown ? blocksFromRecords(endRecords, startFx) : end;
  const initialWealth = start.reduce((sum, value) => sum + convertFromClp(value, currency, startFx), 0);
  const finalWealth = end.reduce((sum, value) => sum + convertFromClp(value, currency, endFx), 0);
  const steps: Array<{ label: string; value: number }> = blockLabels.map((label, index) => ({
    label,
    value: convertFromClp(endAtStartFx[index], currency, hasFxBreakdown ? startFx : endFx)
      - convertFromClp(start[index], currency, startFx),
  }));
  const total = finalWealth - initialWealth;
  if (hasFxBreakdown) {
    const effect = total - steps.reduce((sum, step) => sum + step.value, 0);
    steps.push({ label: 'Efecto cambiario', value: effect });
  }
  return { steps, total, initialWealth, finalWealth, hasFxBreakdown };
};

const normalizedLabel = (label: string) => label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const liquidLabels = new Set([INVESTMENT_GLOBAL66_USD_LABEL, INVESTMENT_WISE_USD_LABEL].map(normalizedLabel));
const financialLabels = new Set([INVESTMENT_SURA_FIN_LABEL, INVESTMENT_BTG_LABEL].map(normalizedLabel));
const retirementLabels = new Set([INVESTMENT_SURA_PREV_LABEL, INVESTMENT_PLANVITAL_LABEL].map(normalizedLabel));

const investmentValue = (records: WealthRecord[], labels: Set<string>, fx: WealthFxRates) =>
  records.filter((record) => record.block === 'investment' && labels.has(normalizedLabel(record.label)))
    .reduce((sum, record) => {
      const amount = maybeNormalizeMinorUnitAmount(record, record.amount);
      if (record.currency === 'USD') return sum + amount * fx.usdClp;
      if (record.currency === 'EUR') return sum + amount * fx.eurClp;
      if (record.currency === 'UF') return sum + amount * fx.ufClp;
      return sum + amount;
    }, 0);

export const buildWealthAvailability = (
  closure: WealthMonthlyClosure,
  currency: WealthCurrency,
  includeRisk: boolean,
  monthlySpendEur: number | null,
) => {
  const fx = historicalFx(closure);
  const records = closureRecords(closure, includeRisk);
  if (!fx || !records.length || !blockBalances(closure, records, fx, includeRisk)) return null;
  const { bankClp, investmentClp, realEstateNetClp, nonMortgageDebtClp, netClp } = buildWealthNetBreakdown(records, fx);
  const liquidInvestments = investmentValue(records, liquidLabels, fx);
  const financial = investmentValue(records, financialLabels, fx);
  const retirement = investmentValue(records, retirementLabels, fx);
  const immediate = bankClp + liquidInvestments - nonMortgageDebtClp;
  const convert = (value: number) => convertFromClp(value, currency, fx);
  const monthsOfSpend = (value: number) => monthlySpendEur !== null && monthlySpendEur > 0
    ? Math.max(0, convertFromClp(value, 'EUR', fx)) / monthlySpendEur
    : null;

  return {
    immediate: convert(immediate),
    net: convert(netClp),
    monthsFromCash: monthsOfSpend(immediate),
    monthsWithRescues: financial > 0 ? monthsOfSpend(immediate + financial) : null,
    breakdown: [
      { label: 'Bancos y cuentas a la vista', value: convert(bankClp + liquidInvestments) },
      { label: 'Inversiones sujetas a rescate', value: convert(financial) },
      { label: 'Previsión', value: convert(retirement) },
      { label: 'Inmueble neto de hipoteca', value: convert(realEstateNetClp) },
      { label: 'Otras inversiones y activos', value: convert(investmentClp - liquidInvestments - financial - retirement) },
      { label: 'Deuda no hipotecaria', value: convert(-nonMortgageDebtClp) },
    ],
  };
};
