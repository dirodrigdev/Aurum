import {
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  buildWealthNetBreakdown,
  resolveRiskCapitalRecordsForTotals,
  selectCanonicalWealthExposureRecords,
  type WealthCurrency,
  type WealthFxRates,
  type WealthRecord,
} from './wealthStorage';
import { fromClpUsingFx } from './currencyDisplay';

type FxPair = 'USD/CLP' | 'EUR/CLP' | 'UF/CLP';

export type ConversionAttributionRate = {
  pair: FxPair;
  previous: number;
  current: number;
};

export type ConversionAttributionResult = {
  reportingCurrency: WealthCurrency;
  previousMonthKey: string;
  currentMonthKey: string;
  previousReportedValue: number;
  currentReportedValue: number;
  currentValueAtPreviousRates: number;
  reportedChangeAmount: number;
  reportedChangePct: number;
  constantConversionChangeAmount: number;
  constantConversionChangePct: number;
  conversionEffectAmount: number;
  conversionEffectPctPoints: number;
  ratesUsed: ConversionAttributionRate[];
  status: 'available' | 'unavailable';
  unavailableReason?: string;
};

type AttributionInput = {
  reportingCurrency: WealthCurrency;
  previousMonthKey: string;
  currentMonthKey: string;
  previousRecords: WealthRecord[];
  currentRecords: WealthRecord[];
  previousFx: WealthFxRates | null | undefined;
  currentFx: WealthFxRates | null | undefined;
  includeRiskCapitalInTotals: boolean;
  expectedPreviousReportedValue?: number | null;
  expectedCurrentReportedValue?: number | null;
};

const PAIR_BY_CURRENCY: Partial<Record<WealthCurrency, FxPair>> = {
  USD: 'USD/CLP',
  EUR: 'EUR/CLP',
  UF: 'UF/CLP',
};

const FX_KEY_BY_PAIR: Record<FxPair, keyof WealthFxRates> = {
  'USD/CLP': 'usdClp',
  'EUR/CLP': 'eurClp',
  'UF/CLP': 'ufClp',
};

const unavailable = (input: AttributionInput, reason: string): ConversionAttributionResult => ({
  reportingCurrency: input.reportingCurrency,
  previousMonthKey: input.previousMonthKey,
  currentMonthKey: input.currentMonthKey,
  previousReportedValue: 0,
  currentReportedValue: 0,
  currentValueAtPreviousRates: 0,
  reportedChangeAmount: 0,
  reportedChangePct: 0,
  constantConversionChangeAmount: 0,
  constantConversionChangePct: 0,
  conversionEffectAmount: 0,
  conversionEffectPctPoints: 0,
  ratesUsed: [],
  status: 'unavailable',
  unavailableReason: reason,
});

const canonicalIdentityWithoutCurrency = (record: WealthRecord) =>
  `${record.block}::${String(record.label || '').trim().toLocaleLowerCase('es')}`;

const hasAmbiguousCurrencyChange = (previousRecords: WealthRecord[], currentRecords: WealthRecord[]) => {
  const previous = new Map<string, Set<WealthCurrency>>();
  const current = new Map<string, Set<WealthCurrency>>();
  previousRecords.forEach((record) => {
    const key = canonicalIdentityWithoutCurrency(record);
    previous.set(key, new Set([...(previous.get(key) || []), record.currency]));
  });
  currentRecords.forEach((record) => {
    const key = canonicalIdentityWithoutCurrency(record);
    current.set(key, new Set([...(current.get(key) || []), record.currency]));
  });
  return [...previous.entries()].some(([key, currencies]) => {
    const nextCurrencies = current.get(key);
    if (!nextCurrencies) return false;
    return [...currencies].some((currency) => !nextCurrencies.has(currency)) ||
      [...nextCurrencies].some((currency) => !currencies.has(currency));
  });
};

const recordsThatAffectNet = (records: WealthRecord[], includeRiskCapitalInTotals: boolean) => {
  const selected = selectCanonicalWealthExposureRecords(records, includeRiskCapitalInTotals);
  const hasProperty = selected.some(
    ({ record, group }) =>
      group === 'real_estate' &&
      String(record.label || '').trim().toLocaleLowerCase('es') ===
        REAL_ESTATE_PROPERTY_VALUE_LABEL.toLocaleLowerCase('es'),
  );
  return selected
    .filter(({ group }) => hasProperty || (group !== 'real_estate' && group !== 'mortgage_debt'))
    .map(({ record }) => record);
};

const requiredPairs = (
  previousRecords: WealthRecord[],
  currentRecords: WealthRecord[],
  reportingCurrency: WealthCurrency,
) => {
  const pairs = new Set<FxPair>();
  [...previousRecords, ...currentRecords].forEach((record) => {
    if (record.currency !== reportingCurrency) {
      const nativePair = PAIR_BY_CURRENCY[record.currency];
      const reportingPair = PAIR_BY_CURRENCY[reportingCurrency];
      if (nativePair) pairs.add(nativePair);
      if (reportingPair) pairs.add(reportingPair);
    }
  });
  return [...pairs];
};

const isValidRate = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

const reconciles = (actual: number, expected: number | null | undefined) => {
  if (expected === null || expected === undefined || !Number.isFinite(expected)) return true;
  return Math.abs(actual - expected) <= Math.max(0.01, Math.abs(expected) * 1e-9);
};

export const calculateMonthlyConversionAttribution = (
  input: AttributionInput,
): ConversionAttributionResult => {
  if (!input.previousRecords.length || !input.currentRecords.length) {
    return unavailable(input, 'Faltan records nativos auditables en uno de los períodos.');
  }
  if (!input.previousFx || !input.currentFx) {
    return unavailable(input, 'Falta un snapshot FX auditable.');
  }
  if (hasAmbiguousCurrencyChange(input.previousRecords, input.currentRecords)) {
    return unavailable(input, 'Una posición cambió de moneda sin una identidad reconciliable.');
  }

  const previousCanonical = recordsThatAffectNet(input.previousRecords, input.includeRiskCapitalInTotals);
  const currentCanonical = recordsThatAffectNet(input.currentRecords, input.includeRiskCapitalInTotals);
  const pairs = requiredPairs(previousCanonical, currentCanonical, input.reportingCurrency);
  if (
    pairs.some((pair) => {
      const key = FX_KEY_BY_PAIR[pair];
      return !isValidRate(input.previousFx?.[key]) || !isValidRate(input.currentFx?.[key]);
    })
  ) {
    return unavailable(input, 'Falta una tasa histórica requerida por las posiciones visibles.');
  }

  const previousForTotals = resolveRiskCapitalRecordsForTotals(
    input.previousRecords,
    input.includeRiskCapitalInTotals,
  ).recordsForTotals;
  const currentForTotals = resolveRiskCapitalRecordsForTotals(
    input.currentRecords,
    input.includeRiskCapitalInTotals,
  ).recordsForTotals;
  const previousClp = buildWealthNetBreakdown(previousForTotals, input.previousFx).netClp;
  const currentClp = buildWealthNetBreakdown(currentForTotals, input.currentFx).netClp;
  const currentAtPreviousRatesClp = buildWealthNetBreakdown(currentForTotals, input.previousFx).netClp;

  const previousReportedValue = fromClpUsingFx(previousClp, input.reportingCurrency, input.previousFx);
  const currentReportedValue = fromClpUsingFx(currentClp, input.reportingCurrency, input.currentFx);
  const currentValueAtPreviousRates = fromClpUsingFx(
    currentAtPreviousRatesClp,
    input.reportingCurrency,
    input.previousFx,
  );
  if (
    !reconciles(previousReportedValue, input.expectedPreviousReportedValue) ||
    !reconciles(currentReportedValue, input.expectedCurrentReportedValue)
  ) {
    return unavailable(input, 'El universo reconstruido no reconcilia con el patrimonio visible.');
  }
  if (previousReportedValue === 0) {
    return unavailable(input, 'El patrimonio anterior es cero y no admite una atribución porcentual.');
  }

  const reportedChangeAmount = currentReportedValue - previousReportedValue;
  const constantConversionChangeAmount = currentValueAtPreviousRates - previousReportedValue;
  const conversionEffectAmount = currentReportedValue - currentValueAtPreviousRates;

  return {
    reportingCurrency: input.reportingCurrency,
    previousMonthKey: input.previousMonthKey,
    currentMonthKey: input.currentMonthKey,
    previousReportedValue,
    currentReportedValue,
    currentValueAtPreviousRates,
    reportedChangeAmount,
    reportedChangePct: reportedChangeAmount / previousReportedValue,
    constantConversionChangeAmount,
    constantConversionChangePct: constantConversionChangeAmount / previousReportedValue,
    conversionEffectAmount,
    conversionEffectPctPoints: conversionEffectAmount / previousReportedValue,
    ratesUsed: pairs.map((pair) => ({
      pair,
      previous: Number(input.previousFx?.[FX_KEY_BY_PAIR[pair]]),
      current: Number(input.currentFx?.[FX_KEY_BY_PAIR[pair]]),
    })),
    status: 'available',
  };
};
