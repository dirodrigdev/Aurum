import { fromClpUsingFx } from './currencyDisplay';
import {
  calculateConversionAttribution,
  type ConversionAttributionResult,
} from './monthlyConversionAttribution';
import type {
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  WealthRecord,
} from './wealthStorage';

export type ConversionHorizonKey = '1M' | '6M' | '12M' | '24M' | '36M' | 'SINCE_COMPLETE';

export type AvailableConversionHorizon = {
  key: ConversionHorizonKey;
  label: string;
  initialMonthKey: string;
  finalMonthKey: string;
  elapsedMonths: number;
  result: ConversionAttributionResult;
};

type BuildAvailableConversionHorizonsInput = {
  closures: WealthMonthlyClosure[];
  reportingCurrency: WealthCurrency;
  includeRiskCapitalInTotals: boolean;
};

const FIXED_HORIZONS: Array<{ key: Exclude<ConversionHorizonKey, 'SINCE_COMPLETE'>; label: string; months: number }> = [
  { key: '1M', label: 'ÚLTIMO MES', months: 1 },
  { key: '6M', label: '6 MESES', months: 6 },
  { key: '12M', label: '12 MESES', months: 12 },
  { key: '24M', label: '24 MESES', months: 24 },
  { key: '36M', label: '36 MESES', months: 36 },
];

const VALID_CURRENCIES = new Set<WealthCurrency>(['CLP', 'USD', 'EUR', 'UF']);

const monthIndex = (monthKey: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return year * 12 + month - 1;
};

export const elapsedMonthsBetween = (initialMonthKey: string, finalMonthKey: string) => {
  const initial = monthIndex(initialMonthKey);
  const final = monthIndex(finalMonthKey);
  if (initial === null || final === null || final <= initial) return null;
  return final - initial;
};

const monthKeyBefore = (monthKey: string, months: number) => {
  const index = monthIndex(monthKey);
  if (index === null) return null;
  const target = index - months;
  const year = Math.floor(target / 12);
  const month = (target % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const validFx = (fx: WealthFxRates | undefined, fxMissing: WealthMonthlyClosure['fxMissing']) =>
  Boolean(
    fx &&
      !fxMissing?.length &&
      Number.isFinite(fx.usdClp) &&
      fx.usdClp > 0 &&
      Number.isFinite(fx.eurClp) &&
      fx.eurClp > 0 &&
      Number.isFinite(fx.ufClp) &&
      fx.ufClp > 0,
  );

const validRecords = (records: WealthRecord[] | undefined): records is WealthRecord[] =>
  Boolean(
    records?.length &&
      records.every(
        (record) =>
          VALID_CURRENCIES.has(record.currency) &&
          Number.isFinite(Number(record.amount)) &&
          Boolean(record.block),
      ),
  );

const storedNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean) => {
  const value = includeRiskCapitalInTotals ? closure.summary?.netClpWithRisk : closure.summary?.netClp;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

const isConfirmedClosure = (closure: WealthMonthlyClosure) =>
  monthIndex(closure.monthKey) !== null &&
  Boolean(closure.closedAt) &&
  Number.isFinite(new Date(closure.closedAt).getTime());

const calculateForEndpoints = (
  initial: WealthMonthlyClosure,
  final: WealthMonthlyClosure,
  reportingCurrency: WealthCurrency,
  includeRiskCapitalInTotals: boolean,
) => {
  if (
    !validRecords(initial.records) ||
    !validRecords(final.records) ||
    !validFx(initial.fxRates, initial.fxMissing) ||
    !validFx(final.fxRates, final.fxMissing)
  ) {
    return null;
  }
  const initialStoredClp = storedNetClp(initial, includeRiskCapitalInTotals);
  const finalStoredClp = storedNetClp(final, includeRiskCapitalInTotals);
  if (initialStoredClp === null || finalStoredClp === null) return null;

  const result = calculateConversionAttribution({
    reportingCurrency,
    initialMonthKey: initial.monthKey,
    finalMonthKey: final.monthKey,
    initialRecords: initial.records,
    finalRecords: final.records,
    initialFx: initial.fxRates,
    finalFx: final.fxRates,
    includeRiskCapitalInTotals,
    expectedInitialReportedValue: fromClpUsingFx(initialStoredClp, reportingCurrency, initial.fxRates),
    expectedFinalReportedValue: fromClpUsingFx(finalStoredClp, reportingCurrency, final.fxRates),
  });
  return result.status === 'available' ? result : null;
};

export const buildAvailableConversionHorizons = ({
  closures,
  reportingCurrency,
  includeRiskCapitalInTotals,
}: BuildAvailableConversionHorizonsInput): AvailableConversionHorizon[] => {
  const confirmed = closures
    .filter(isConfirmedClosure)
    .sort((left, right) => right.monthKey.localeCompare(left.monthKey));
  const final = confirmed[0];
  if (!final) return [];
  const byMonth = new Map(confirmed.map((closure) => [closure.monthKey, closure]));
  const available: AvailableConversionHorizon[] = [];

  FIXED_HORIZONS.forEach((definition) => {
    const initialMonthKey = monthKeyBefore(final.monthKey, definition.months);
    const initial = initialMonthKey ? byMonth.get(initialMonthKey) : undefined;
    if (!initial || !initialMonthKey) return;
    const result = calculateForEndpoints(initial, final, reportingCurrency, includeRiskCapitalInTotals);
    if (!result) return;
    available.push({
      key: definition.key,
      label: definition.label,
      initialMonthKey,
      finalMonthKey: final.monthKey,
      elapsedMonths: definition.months,
      result,
    });
  });

  const earliestComplete = [...confirmed]
    .reverse()
    .find((candidate) => {
      if (candidate.monthKey === final.monthKey) return false;
      return Boolean(calculateForEndpoints(candidate, final, reportingCurrency, includeRiskCapitalInTotals));
    });
  if (earliestComplete) {
    const elapsedMonths = elapsedMonthsBetween(earliestComplete.monthKey, final.monthKey);
    const result = calculateForEndpoints(earliestComplete, final, reportingCurrency, includeRiskCapitalInTotals);
    if (elapsedMonths && result) {
      available.push({
        key: 'SINCE_COMPLETE',
        label: 'DESDE REGISTROS COMPLETOS',
        initialMonthKey: earliestComplete.monthKey,
        finalMonthKey: final.monthKey,
        elapsedMonths,
        result,
      });
    }
  }

  return available;
};
