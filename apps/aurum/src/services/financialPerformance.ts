import {
  dedupeLatestByAsset,
  isRiskCapitalInvestmentLabel,
  isSyntheticAggregateRecord,
  makeAssetKey,
  maybeNormalizeMinorUnitAmount,
  type WealthCurrency,
  type WealthMonthlyClosure,
  type WealthRecord,
} from './wealthStorage';

/**
 * Legacy defaults used only by callers that have not yet moved to the explicit
 * period API. Keep these exports until the UI and storage are generalized.
 */
export const PERFORMANCE_INITIAL_MONTH = '2026-07';
export const PERFORMANCE_FINAL_MONTH = '2026-08';
export const MAX_FINANCIAL_PERFORMANCE_FLOWS = 100;

export interface FinancialPerformancePeriod {
  startMonth: string;
  endMonth: string;
}

interface ParsedMonth {
  year: number;
  month: number;
  ordinal: number;
}

const parseMonthKey = (monthKey: string): ParsedMonth | null => {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  return { year, month, ordinal: year * 12 + month - 1 };
};

const monthKeyFromOrdinal = (ordinal: number): string | null => {
  const year = Math.floor(ordinal / 12);
  const month = ordinal % 12 + 1;
  if (year < 1 || year > 9999) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};

const periodEndingAt = (endMonth: string): FinancialPerformancePeriod | null => {
  const parsedEnd = parseMonthKey(endMonth);
  if (!parsedEnd) return null;
  const startMonth = monthKeyFromOrdinal(parsedEnd.ordinal - 1);
  return startMonth ? { startMonth, endMonth } : null;
};

export const isFinancialPerformancePeriodValid = (period: unknown): period is FinancialPerformancePeriod => {
  if (!period || typeof period !== 'object') return false;
  const candidate = period as Partial<FinancialPerformancePeriod>;
  if (typeof candidate.startMonth !== 'string' || typeof candidate.endMonth !== 'string') return false;
  const start = parseMonthKey(candidate.startMonth);
  const end = parseMonthKey(candidate.endMonth);
  return Boolean(start && end && end.ordinal === start.ordinal + 1);
};

/** The end month is a unique key for a valid consecutive monthly interval. */
export const financialPerformancePeriodKey = (period: FinancialPerformancePeriod): string | null =>
  isFinancialPerformancePeriodValid(period) ? period.endMonth : null;

export type PerformanceQuality = 'EXACTO' | 'RECONSTRUIDO' | 'INDICATIVO' | 'INSUFICIENTE';
export type FlowCompleteness = 'complete' | 'incomplete';
export type PositionMovementCompleteness = 'no_unrecorded_movements' | 'unconfirmed';
export type PerformanceFlowDirection = 'aporte' | 'retiro';

export interface FinancialPerformanceFlow {
  id: string;
  direction: PerformanceFlowDirection;
  effectiveDate: string;
  amountClp: number;
  note?: string;
  reference?: string;
}

export interface FinancialPerformanceConfirmation {
  schemaVersion: 1;
  monthKey: string;
  flowCompleteness: FlowCompleteness;
  positionMovementCompleteness: PositionMovementCompleteness;
  flows: FinancialPerformanceFlow[];
  revision?: number;
  updatedAt?: string;
}

export type PerformanceReturnMethod = 'simple' | 'simple_adjusted' | 'modified_dietz' | null;
export type AttributionCoverageStatus = 'no_exposure' | 'not_evaluated' | 'evaluated';

export interface FinancialPerformanceResult {
  period: FinancialPerformancePeriod;
  monthKey: string;
  initialValue: number | null;
  finalValue: number | null;
  observedChange: number | null;
  observedChangePct: number | null;
  confirmedFlowsNetClp: number;
  flowListComplete: boolean;
  portfolioResult: number | null;
  returnPct: number | null;
  returnMethod: PerformanceReturnMethod;
  investmentAttributable: number | null;
  usdFxAttributable: number | null;
  eurFxAttributable: number | null;
  fxAttributable: number | null;
  ufAttributable: number | null;
  unexplainedResidual: number | null;
  fxCoveragePct: number | null;
  ufCoveragePct: number | null;
  fxCoverageStatus: AttributionCoverageStatus;
  ufCoverageStatus: AttributionCoverageStatus;
  quality: PerformanceQuality;
  qualityReason: string;
  flowValidationError: string | null;
}

interface PositionValue {
  key: string;
  currency: WealthCurrency;
  nativeValue: number;
  clpValue: number;
}

interface ClosurePositionSet {
  closure: WealthMonthlyClosure;
  positions: Map<string, PositionValue>;
  totalClp: number;
}

const currencyRateField: Record<Exclude<WealthCurrency, 'CLP'>, 'usdClp' | 'eurClp' | 'ufClp'> = {
  USD: 'usdClp',
  EUR: 'eurClp',
  UF: 'ufClp',
};

const rateOriginKey: Record<Exclude<WealthCurrency, 'CLP'>, 'usd' | 'eur' | 'uf'> = {
  USD: 'usd',
  EUR: 'eur',
  UF: 'uf',
};

const amountSign = (flow: FinancialPerformanceFlow) =>
  flow.direction === 'aporte' ? Number(flow.amountClp) : -Number(flow.amountClp);

const monthEndDate = (monthKey: string): string | null => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  const { year, month } = parsed;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${monthKey}-${String(daysByMonth[month - 1]).padStart(2, '0')}`;
};

const utcDayNumber = (date: string): number => {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : Number.NaN;
};

const selectClosure = (closures: WealthMonthlyClosure[], monthKey: string): WealthMonthlyClosure | null =>
  [...closures]
    .filter((closure) => closure.monthKey === monthKey && !closure.analysisProvisionalReason)
    .sort((left, right) => String(right.closedAt || '').localeCompare(String(left.closedAt || '')))[0] || null;

const hasReliableRateProvenance = (
  closure: WealthMonthlyClosure,
  currency: Exclude<WealthCurrency, 'CLP'>,
): boolean => {
  const key = rateOriginKey[currency];
  const field = currencyRateField[currency];
  const metadata = closure.fxMetadata;
  const origin = metadata?.rateOrigin?.[key];
  const source = String(metadata?.source?.[key] || '').trim();
  if (!metadata || metadata.economicMonthKey !== closure.monthKey || !source) return false;

  // Keep the existing acceptance rule for automatic rates unchanged.
  if (origin === 'automatic' || origin === 'automatic-final') return true;
  if (origin !== 'manual') return false;

  const rate = closure.fxRates?.[field];
  const recordedRate = metadata.usedFxRates?.[field];
  const reconciliation = metadata.reconciliation;
  const manualReason = String(metadata.manualOverrideReason || '').trim();
  return Boolean(
    source === 'manual_user_input' &&
      typeof closure.id === 'string' &&
      closure.id.trim() &&
      typeof closure.closedAt === 'string' &&
      closure.closedAt.trim() &&
      typeof metadata.economicDate === 'string' &&
      metadata.economicDate.startsWith(`${closure.monthKey}-`) &&
      typeof rate === 'number' &&
      Number.isFinite(rate) &&
      rate > 0 &&
      !closure.fxMissing?.includes(field) &&
      typeof recordedRate === 'number' &&
      Number.isFinite(recordedRate) &&
      recordedRate > 0 &&
      Math.abs(rate - recordedRate) <= 1e-9 &&
      manualReason &&
      reconciliation?.status === 'reconciled' &&
      typeof reconciliation.checkedAt === 'string' &&
      reconciliation.checkedAt.trim(),
  );
};

const readClosurePositions = (
  closure: WealthMonthlyClosure | null,
  includeRiskCapital: boolean,
): ClosurePositionSet | null => {
  if (!closure || !Array.isArray(closure.records) || closure.records.length === 0) return null;
  const selectedRecords = dedupeLatestByAsset(closure.records).filter((record) => {
    if (record.block !== 'investment' || isSyntheticAggregateRecord(record)) return false;
    if (!includeRiskCapital && isRiskCapitalInvestmentLabel(record.label)) return false;
    return true;
  });
  if (selectedRecords.length === 0) return null;

  const positions = new Map<string, PositionValue>();
  let totalClp = 0;
  for (const record of selectedRecords) {
    const nativeValue = maybeNormalizeMinorUnitAmount(record, record.amount);
    if (!Number.isFinite(nativeValue)) return null;
    const rate = record.currency === 'CLP' ? 1 : Number(closure.fxRates?.[currencyRateField[record.currency]]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const clpValue = nativeValue * rate;
    const key = makeAssetKey(record);
    positions.set(key, { key, currency: record.currency, nativeValue, clpValue });
    totalClp += clpValue;
  }
  return { closure, positions, totalClp };
};

/**
 * With a period, validates both the flow shape and its economic date range.
 * Without one, validates only the shape/date so existing storage normalization
 * can run before the owning confirmation supplies its period.
 */
export const isFinancialPerformanceFlowValid = (
  flow: unknown,
  period?: FinancialPerformancePeriod,
): flow is FinancialPerformanceFlow => {
  if (period && !isFinancialPerformancePeriodValid(period)) return false;
  const startDate = period ? monthEndDate(period.startMonth) : null;
  const endDate = period ? monthEndDate(period.endMonth) : null;
  if (period && (!startDate || !endDate)) return false;
  if (!flow || typeof flow !== 'object') return false;
  const candidate = flow as Partial<FinancialPerformanceFlow>;
  if (typeof candidate.effectiveDate !== 'string') return false;
  const effectiveDate = candidate.effectiveDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return false;
  const parsedDay = utcDayNumber(effectiveDate);
  if (!Number.isFinite(parsedDay) || new Date(parsedDay * 86_400_000).toISOString().slice(0, 10) !== effectiveDate) return false;
  return Boolean(
    typeof candidate.id === 'string' &&
      candidate.id.trim() &&
      (candidate.direction === 'aporte' || candidate.direction === 'retiro') &&
      (!startDate || parsedDay >= utcDayNumber(startDate)) &&
      (!endDate || parsedDay <= utcDayNumber(endDate)) &&
      typeof candidate.amountClp === 'number' &&
      Number.isFinite(candidate.amountClp) &&
      candidate.amountClp > 0 &&
      (!candidate.note || (typeof candidate.note === 'string' && candidate.note.length <= 160)) &&
      (!candidate.reference || (typeof candidate.reference === 'string' && candidate.reference.length <= 120)),
  );
};

export const isFinancialPerformanceConfirmationValid = (
  confirmation: FinancialPerformanceConfirmation,
  expectedPeriod?: FinancialPerformancePeriod,
): boolean => {
  const period = expectedPeriod || periodEndingAt(String(confirmation?.monthKey || ''));
  if (
    confirmation?.schemaVersion !== 1 ||
    !period ||
    !isFinancialPerformancePeriodValid(period) ||
    confirmation.monthKey !== period.endMonth ||
    (confirmation.flowCompleteness !== 'complete' && confirmation.flowCompleteness !== 'incomplete') ||
    (confirmation.positionMovementCompleteness !== 'no_unrecorded_movements' &&
    confirmation.positionMovementCompleteness !== 'unconfirmed') ||
    !Array.isArray(confirmation.flows) ||
    confirmation.flows.length > MAX_FINANCIAL_PERFORMANCE_FLOWS
  ) return false;
  const ids = new Set<string>();
  for (const flow of confirmation.flows) {
    if (!isFinancialPerformanceFlowValid(flow, period)) return false;
    if (ids.has(flow.id)) return false;
    ids.add(flow.id);
  }
  return true;
};

const calculateReturn = (
  initialValue: number,
  finalValue: number,
  flows: FinancialPerformanceFlow[],
  startDate: string,
  endDate: string,
): { returnPct: number | null; method: PerformanceReturnMethod } => {
  const durationDays = utcDayNumber(endDate) - utcDayNumber(startDate);
  if (initialValue <= 0 || durationDays <= 0) return { returnPct: null, method: null };

  const numerator = finalValue - initialValue - flows.reduce((sum, flow) => sum + amountSign(flow), 0);
  if (flows.length === 0) return { returnPct: numerator / initialValue, method: 'simple' };

  const atBoundaries = flows.every(
    (flow) => flow.effectiveDate === startDate || flow.effectiveDate === endDate,
  );
  if (atBoundaries) {
    const startFlows = flows
      .filter((flow) => flow.effectiveDate === startDate)
      .reduce((sum, flow) => sum + amountSign(flow), 0);
    const denominator = initialValue + startFlows;
    return denominator > 0
      ? { returnPct: numerator / denominator, method: 'simple_adjusted' }
      : { returnPct: null, method: null };
  }

  const weightedFlows = flows.reduce((sum, flow) => {
    const elapsedDays = utcDayNumber(flow.effectiveDate) - utcDayNumber(startDate);
    const weight = (durationDays - elapsedDays) / durationDays;
    return sum + amountSign(flow) * weight;
  }, 0);
  const denominator = initialValue + weightedFlows;
  return denominator > 0
    ? { returnPct: numerator / denominator, method: 'modified_dietz' }
    : { returnPct: null, method: null };
};

const emptyResult = (period: FinancialPerformancePeriod, reason: string): FinancialPerformanceResult => ({
  period,
  monthKey: period.endMonth,
  initialValue: null,
  finalValue: null,
  observedChange: null,
  observedChangePct: null,
  confirmedFlowsNetClp: 0,
  flowListComplete: false,
  portfolioResult: null,
  returnPct: null,
  returnMethod: null,
  investmentAttributable: null,
  usdFxAttributable: null,
  eurFxAttributable: null,
  fxAttributable: null,
  ufAttributable: null,
  unexplainedResidual: null,
  fxCoveragePct: null,
  ufCoveragePct: null,
  fxCoverageStatus: 'not_evaluated',
  ufCoverageStatus: 'not_evaluated',
  quality: 'INSUFICIENTE',
  qualityReason: reason,
  flowValidationError: null,
});

export interface FinancialPerformancePeriodInput {
  period: FinancialPerformancePeriod;
  initialClosure: WealthMonthlyClosure | null;
  finalClosure: WealthMonthlyClosure | null;
  confirmation: FinancialPerformanceConfirmation | null;
  includeRiskCapital: boolean;
}

interface LegacyFinancialPerformanceInput {
  closures: WealthMonthlyClosure[];
  confirmation: FinancialPerformanceConfirmation | null;
  includeRiskCapital: boolean;
}

export const reconcileFinancialPerformanceForPeriod = (
  input: FinancialPerformancePeriodInput,
): FinancialPerformanceResult => {
  const period = input.period;
  if (!isFinancialPerformancePeriodValid(period)) {
    return emptyResult(period, 'El intervalo debe contener dos meses consecutivos válidos.');
  }
  const startClosure = input.initialClosure;
  const endClosure = input.finalClosure;
  if (
    !startClosure ||
    !endClosure ||
    startClosure.monthKey !== period.startMonth ||
    endClosure.monthKey !== period.endMonth ||
    startClosure.analysisProvisionalReason ||
    endClosure.analysisProvisionalReason
  ) {
    return emptyResult(period, `Faltan cierres detallados comparables para ${period.startMonth} y ${period.endMonth}.`);
  }
  const start = readClosurePositions(startClosure, input.includeRiskCapital);
  const end = readClosurePositions(endClosure, input.includeRiskCapital);
  if (!start || !end) {
    return emptyResult(period, `Faltan cierres detallados comparables para ${period.startMonth} y ${period.endMonth}.`);
  }

  const startDate = monthEndDate(period.startMonth);
  const endDate = monthEndDate(period.endMonth);
  if (!startDate || !endDate) return emptyResult(period, 'No pude determinar los límites económicos del período.');

  const flows = Array.isArray(input.confirmation?.flows) ? input.confirmation.flows : [];
  const invalidFlow = Boolean(
    input.confirmation && !isFinancialPerformanceConfirmationValid(input.confirmation, period),
  );
  const flowListComplete =
    Boolean(input.confirmation) &&
    input.confirmation?.flowCompleteness === 'complete' &&
    !invalidFlow;
  const confirmedFlowsNetClp = flows.reduce(
    (sum, flow) => sum + (isFinancialPerformanceFlowValid(flow, period) ? amountSign(flow) : 0),
    0,
  );
  const observedChange = end.totalClp - start.totalClp;
  const portfolioResult = flowListComplete ? observedChange - confirmedFlowsNetClp : null;
  const returnData = flowListComplete
    ? calculateReturn(start.totalClp, end.totalClp, flows, startDate, endDate)
    : { returnPct: null, method: null };

  let investmentAttributable: number | null = null;
  let usdFxAttributable: number | null = null;
  let eurFxAttributable: number | null = null;
  let fxAttributable: number | null = null;
  let ufAttributable: number | null = null;
  let fxCoveredClp = 0;
  let fxTotalClp = 0;
  let usdTotalClp = 0;
  let eurTotalClp = 0;
  let ufCoveredClp = 0;
  let ufTotalClp = 0;
  const allKeys = new Set([...start.positions.keys(), ...end.positions.keys()]);
  for (const key of allKeys) {
    const initial = start.positions.get(key);
    const final = end.positions.get(key);
    const currency = initial?.currency || final?.currency;
    if (!currency) continue;
    const averageExposure = (Math.abs(initial?.clpValue || 0) + Math.abs(final?.clpValue || 0)) / 2;
    if (currency === 'USD') {
      fxTotalClp += averageExposure;
      usdTotalClp += averageExposure;
    }
    if (currency === 'EUR') {
      fxTotalClp += averageExposure;
      eurTotalClp += averageExposure;
    }
    if (currency === 'UF') ufTotalClp += averageExposure;
  }

  const canAttributePositions =
    flowListComplete &&
    flows.length === 0 &&
    input.confirmation?.positionMovementCompleteness === 'no_unrecorded_movements';

  if (canAttributePositions) {
    let investmentTotal = 0;
    let fxTotal = 0;
    let usdFxTotal = 0;
    let eurFxTotal = 0;
    let ufTotal = 0;
    let hasInvestmentCoverage = false;
    let hasFxCoverage = false;
    let hasUsdFxCoverage = false;
    let hasEurFxCoverage = false;
    let hasUfCoverage = false;
    for (const key of allKeys) {
      const initial = start.positions.get(key);
      const final = end.positions.get(key);
      const currency = initial?.currency || final?.currency;
      if (!currency) continue;

      if (currency === 'USD' || currency === 'EUR') {
        const averageExposure = (Math.abs(initial?.clpValue || 0) + Math.abs(final?.clpValue || 0)) / 2;
        if (!initial || !final || initial.currency !== currency || final.currency !== currency) continue;
        const startRate = Number(start.closure.fxRates?.[currencyRateField[currency]]);
        const endRate = Number(end.closure.fxRates?.[currencyRateField[currency]]);
        if (
          !hasReliableRateProvenance(start.closure, currency) ||
          !hasReliableRateProvenance(end.closure, currency) ||
          !Number.isFinite(startRate) ||
          !Number.isFinite(endRate)
        ) continue;
        investmentTotal += (final.nativeValue - initial.nativeValue) * startRate;
        const fxContribution = final.nativeValue * (endRate - startRate);
        fxTotal += fxContribution;
        if (currency === 'USD') {
          usdFxTotal += fxContribution;
          hasUsdFxCoverage = true;
        } else {
          eurFxTotal += fxContribution;
          hasEurFxCoverage = true;
        }
        fxCoveredClp += averageExposure;
        hasInvestmentCoverage = true;
        hasFxCoverage = true;
      } else if (currency === 'UF') {
        const averageExposure = (Math.abs(initial?.clpValue || 0) + Math.abs(final?.clpValue || 0)) / 2;
        if (!initial || !final || initial.currency !== 'UF' || final.currency !== 'UF') continue;
        const startRate = Number(start.closure.fxRates?.ufClp);
        const endRate = Number(end.closure.fxRates?.ufClp);
        if (
          !hasReliableRateProvenance(start.closure, 'UF') ||
          !hasReliableRateProvenance(end.closure, 'UF') ||
          !Number.isFinite(startRate) ||
          !Number.isFinite(endRate)
        ) continue;
        investmentTotal += (final.nativeValue - initial.nativeValue) * startRate;
        ufTotal += final.nativeValue * (endRate - startRate);
        ufCoveredClp += averageExposure;
        hasInvestmentCoverage = true;
        hasUfCoverage = true;
      } else if (initial && final && initial.currency === 'CLP' && final.currency === 'CLP') {
        investmentTotal += final.nativeValue - initial.nativeValue;
        hasInvestmentCoverage = true;
      }
    }

    investmentAttributable = hasInvestmentCoverage ? investmentTotal : null;
    fxAttributable = hasFxCoverage ? fxTotal : (fxTotalClp === 0 ? 0 : null);
    usdFxAttributable = hasUsdFxCoverage ? usdFxTotal : (usdTotalClp === 0 ? 0 : null);
    eurFxAttributable = hasEurFxCoverage ? eurFxTotal : (eurTotalClp === 0 ? 0 : null);
    ufAttributable = hasUfCoverage ? ufTotal : (ufTotalClp === 0 ? 0 : null);
  }

  if (fxTotalClp === 0) fxAttributable = 0;
  if (usdTotalClp === 0) usdFxAttributable = 0;
  if (eurTotalClp === 0) eurFxAttributable = 0;
  if (ufTotalClp === 0) ufAttributable = 0;
  const fxCoverageStatus: AttributionCoverageStatus = fxTotalClp === 0
    ? 'no_exposure'
    : canAttributePositions
      ? 'evaluated'
      : 'not_evaluated';
  const ufCoverageStatus: AttributionCoverageStatus = ufTotalClp === 0
    ? 'no_exposure'
    : canAttributePositions
      ? 'evaluated'
      : 'not_evaluated';
  const fxCoveragePct = fxCoverageStatus === 'evaluated' && fxTotalClp > 0
    ? Math.min(100, (fxCoveredClp / fxTotalClp) * 100)
    : null;
  const ufCoveragePct = ufCoverageStatus === 'evaluated' && ufTotalClp > 0
    ? Math.min(100, (ufCoveredClp / ufTotalClp) * 100)
    : null;
  const unexplainedResidual =
    observedChange -
    confirmedFlowsNetClp -
    (investmentAttributable ?? 0) -
    (fxAttributable ?? 0) -
    (ufAttributable ?? 0);

  const quality: PerformanceQuality = flowListComplete ? 'RECONSTRUIDO' : 'INDICATIVO';
  const qualityReason = invalidFlow
    ? 'La confirmación contiene datos inválidos o fuera del intervalo; no se publica retorno.'
    : flowListComplete
      ? `Cierres detallados comparables (${period.startMonth} → ${period.endMonth}) y lista de flujos externos confirmada como completa.`
      : `Los cierres ${period.startMonth} → ${period.endMonth} son comparables, pero la lista de flujos externos no está confirmada como completa.`;

  return {
    period: { ...period },
    monthKey: period.endMonth,
    initialValue: start.totalClp,
    finalValue: end.totalClp,
    observedChange,
    observedChangePct: start.totalClp > 0 ? observedChange / start.totalClp : null,
    confirmedFlowsNetClp,
    flowListComplete,
    portfolioResult,
    returnPct: returnData.returnPct,
    returnMethod: returnData.method,
    investmentAttributable,
    usdFxAttributable,
    eurFxAttributable,
    fxAttributable,
    ufAttributable,
    unexplainedResidual,
    fxCoveragePct,
    ufCoveragePct,
    fxCoverageStatus,
    ufCoverageStatus,
    quality,
    qualityReason,
    flowValidationError: invalidFlow ? 'Revisa la fecha, el monto y los datos de cada flujo.' : null,
  };
};

/**
 * Compatibility adapter for existing LabTab callers. New calculations should
 * pass their interval and both closures to reconcileFinancialPerformanceForPeriod.
 */
export function reconcileFinancialPerformance(input: FinancialPerformancePeriodInput): FinancialPerformanceResult;
/** @deprecated Use reconcileFinancialPerformanceForPeriod with an explicit period. */
export function reconcileFinancialPerformance(input: LegacyFinancialPerformanceInput): FinancialPerformanceResult;
export function reconcileFinancialPerformance(
  input: FinancialPerformancePeriodInput | LegacyFinancialPerformanceInput,
): FinancialPerformanceResult {
  if ('period' in input) return reconcileFinancialPerformanceForPeriod(input);

  const period: FinancialPerformancePeriod = {
    startMonth: PERFORMANCE_INITIAL_MONTH,
    endMonth: PERFORMANCE_FINAL_MONTH,
  };
  return reconcileFinancialPerformanceForPeriod({
    period,
    initialClosure: selectClosure(input.closures, period.startMonth),
    finalClosure: selectClosure(input.closures, period.endMonth),
    confirmation: input.confirmation,
    includeRiskCapital: input.includeRiskCapital,
  });
}

export const financialPerformanceFlowSign = amountSign;
