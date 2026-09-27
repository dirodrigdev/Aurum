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

export const PERFORMANCE_INITIAL_MONTH = '2026-07';
export const PERFORMANCE_FINAL_MONTH = '2026-08';
export const MAX_FINANCIAL_PERFORMANCE_FLOWS = 100;

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
  monthKey: typeof PERFORMANCE_FINAL_MONTH;
  flowCompleteness: FlowCompleteness;
  positionMovementCompleteness: PositionMovementCompleteness;
  flows: FinancialPerformanceFlow[];
  revision?: number;
  updatedAt?: string;
}

export type PerformanceReturnMethod = 'simple' | 'simple_adjusted' | 'modified_dietz' | null;
export type AttributionCoverageStatus = 'no_exposure' | 'not_evaluated' | 'evaluated';

export interface FinancialPerformanceResult {
  monthKey: typeof PERFORMANCE_FINAL_MONTH;
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
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`;
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

export const isFinancialPerformanceFlowValid = (
  flow: unknown,
  startDate = monthEndDate(PERFORMANCE_INITIAL_MONTH) || '',
  endDate = monthEndDate(PERFORMANCE_FINAL_MONTH) || '',
): flow is FinancialPerformanceFlow => {
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
      parsedDay >= utcDayNumber(startDate) &&
      parsedDay <= utcDayNumber(endDate) &&
      typeof candidate.amountClp === 'number' &&
      Number.isFinite(candidate.amountClp) &&
      candidate.amountClp > 0 &&
      (!candidate.note || (typeof candidate.note === 'string' && candidate.note.length <= 160)) &&
      (!candidate.reference || (typeof candidate.reference === 'string' && candidate.reference.length <= 120)),
  );
};

export const isFinancialPerformanceConfirmationValid = (
  confirmation: FinancialPerformanceConfirmation,
): boolean => {
  if (
    confirmation?.schemaVersion !== 1 ||
    confirmation.monthKey !== PERFORMANCE_FINAL_MONTH ||
    (confirmation.flowCompleteness !== 'complete' && confirmation.flowCompleteness !== 'incomplete') ||
    (confirmation.positionMovementCompleteness !== 'no_unrecorded_movements' &&
    confirmation.positionMovementCompleteness !== 'unconfirmed') ||
    !Array.isArray(confirmation.flows) ||
    confirmation.flows.length > MAX_FINANCIAL_PERFORMANCE_FLOWS
  ) return false;
  const ids = new Set<string>();
  for (const flow of confirmation.flows) {
    if (!isFinancialPerformanceFlowValid(flow)) return false;
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

const emptyResult = (reason: string): FinancialPerformanceResult => ({
  monthKey: PERFORMANCE_FINAL_MONTH,
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

export const reconcileFinancialPerformance = (input: {
  closures: WealthMonthlyClosure[];
  confirmation: FinancialPerformanceConfirmation | null;
  includeRiskCapital: boolean;
}): FinancialPerformanceResult => {
  const startClosure = selectClosure(input.closures, PERFORMANCE_INITIAL_MONTH);
  const endClosure = selectClosure(input.closures, PERFORMANCE_FINAL_MONTH);
  const start = readClosurePositions(startClosure, input.includeRiskCapital);
  const end = readClosurePositions(endClosure, input.includeRiskCapital);
  if (!start || !end) return emptyResult('Faltan cierres detallados comparables para julio y agosto de 2026.');

  const startDate = monthEndDate(PERFORMANCE_INITIAL_MONTH);
  const endDate = monthEndDate(PERFORMANCE_FINAL_MONTH);
  if (!startDate || !endDate) return emptyResult('No pude determinar los límites económicos del período.');

  const flows = Array.isArray(input.confirmation?.flows) ? input.confirmation.flows : [];
  const invalidFlow = Boolean(input.confirmation && !isFinancialPerformanceConfirmationValid(input.confirmation));
  const flowListComplete =
    Boolean(input.confirmation) &&
    input.confirmation?.flowCompleteness === 'complete' &&
    !invalidFlow;
  const confirmedFlowsNetClp = flows.reduce((sum, flow) => sum + (isFinancialPerformanceFlowValid(flow, startDate, endDate) ? amountSign(flow) : 0), 0);
  const observedChange = end.totalClp - start.totalClp;
  const portfolioResult = flowListComplete ? observedChange - confirmedFlowsNetClp : null;
  const returnData = flowListComplete
    ? calculateReturn(start.totalClp, end.totalClp, flows, startDate, endDate)
    : { returnPct: null, method: null };

  let investmentAttributable: number | null = null;
  let fxAttributable: number | null = null;
  let ufAttributable: number | null = null;
  let fxCoveredClp = 0;
  let fxTotalClp = 0;
  let ufCoveredClp = 0;
  let ufTotalClp = 0;
  const allKeys = new Set([...start.positions.keys(), ...end.positions.keys()]);
  for (const key of allKeys) {
    const initial = start.positions.get(key);
    const final = end.positions.get(key);
    const currency = initial?.currency || final?.currency;
    if (!currency) continue;
    const averageExposure = (Math.abs(initial?.clpValue || 0) + Math.abs(final?.clpValue || 0)) / 2;
    if (currency === 'USD' || currency === 'EUR') fxTotalClp += averageExposure;
    if (currency === 'UF') ufTotalClp += averageExposure;
  }

  const canAttributePositions =
    flowListComplete &&
    flows.length === 0 &&
    input.confirmation?.positionMovementCompleteness === 'no_unrecorded_movements';

  if (canAttributePositions) {
    let investmentTotal = 0;
    let fxTotal = 0;
    let ufTotal = 0;
    let hasInvestmentCoverage = false;
    let hasFxCoverage = false;
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
        fxTotal += final.nativeValue * (endRate - startRate);
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
    ufAttributable = hasUfCoverage ? ufTotal : (ufTotalClp === 0 ? 0 : null);
  }

  if (fxTotalClp === 0) fxAttributable = 0;
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
      ? 'Cierres detallados comparables y lista de flujos externos confirmada como completa.'
      : 'Los cierres son comparables, pero la lista de flujos externos no está confirmada como completa.';

  return {
    monthKey: PERFORMANCE_FINAL_MONTH,
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

export const financialPerformanceFlowSign = amountSign;
