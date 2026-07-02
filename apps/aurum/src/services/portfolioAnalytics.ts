export type PortfolioAnalyticsMonthlyPoint = {
  monthKey: string;
  returnPct: number;
  isEstimated?: boolean;
  startingWealth?: number;
  endingWealth?: number;
  economicReturnAmount?: number;
};

export type PortfolioAnalyticsOptions = {
  includeEstimated?: boolean;
  riskFreeRateAnnualPct?: number;
  trimPct?: number;
  winsorizePct?: number;
};

export type PortfolioAnalyticsMonthExtremum = {
  monthKey: string;
  returnPct: number;
  isEstimated: boolean;
};

export type PortfolioAnalyticsPercentiles = {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
};

export type PortfolioAnalyticsResult = {
  monthsTotal: number;
  monthsUsed: number;
  estimatedMonthsUsed: number;
  firstMonthKey?: string;
  lastMonthKey?: string;
  lastMonthIsEstimated: boolean;
  cumulativeReturnPct: number | null;
  annualizedReturnPct: number | null;
  averageMonthlyReturnPct: number | null;
  medianMonthlyReturnPct: number | null;
  geometricMonthlyReturnPct: number | null;
  volatilityMonthlyPct: number | null;
  volatilityAnnualizedPct: number | null;
  downsideDeviationMonthlyPct: number | null;
  downsideDeviationAnnualizedPct: number | null;
  bestMonth: PortfolioAnalyticsMonthExtremum | null;
  worstMonth: PortfolioAnalyticsMonthExtremum | null;
  positiveMonthsPct: number | null;
  negativeMonthsPct: number | null;
  zeroMonthsPct: number | null;
  percentiles: PortfolioAnalyticsPercentiles;
  trimmedMeanMonthlyReturnPct: number | null;
  winsorizedMeanMonthlyReturnPct: number | null;
  maxDrawdownPct: number | null;
  maxDrawdownStartMonthKey?: string;
  maxDrawdownTroughMonthKey?: string;
  maxDrawdownRecoveryMonthKey?: string;
  currentDrawdownPct: number | null;
  monthsToRecovery: number | null;
  isRecovered: boolean | null;
  ulcerIndex: number | null;
  sharpeSimple: number | null;
  sortinoSimple: number | null;
  calmarSimple: number | null;
  warnings: string[];
};

const DEFAULT_TRIM_PCT = 0.1;
const DEFAULT_WINSORIZE_PCT = 0.1;

type NormalizedPoint = PortfolioAnalyticsMonthlyPoint & {
  isEstimated: boolean;
};

const EMPTY_PERCENTILES: PortfolioAnalyticsPercentiles = {
  p10: null,
  p25: null,
  p50: null,
  p75: null,
  p90: null,
};

const buildEmptyResult = (monthsTotal: number, warnings: string[]): PortfolioAnalyticsResult => ({
  monthsTotal,
  monthsUsed: 0,
  estimatedMonthsUsed: 0,
  lastMonthIsEstimated: false,
  cumulativeReturnPct: null,
  annualizedReturnPct: null,
  averageMonthlyReturnPct: null,
  medianMonthlyReturnPct: null,
  geometricMonthlyReturnPct: null,
  volatilityMonthlyPct: null,
  volatilityAnnualizedPct: null,
  downsideDeviationMonthlyPct: null,
  downsideDeviationAnnualizedPct: null,
  bestMonth: null,
  worstMonth: null,
  positiveMonthsPct: null,
  negativeMonthsPct: null,
  zeroMonthsPct: null,
  percentiles: EMPTY_PERCENTILES,
  trimmedMeanMonthlyReturnPct: null,
  winsorizedMeanMonthlyReturnPct: null,
  maxDrawdownPct: null,
  currentDrawdownPct: null,
  monthsToRecovery: null,
  isRecovered: null,
  ulcerIndex: null,
  sharpeSimple: null,
  sortinoSimple: null,
  calmarSimple: null,
  warnings,
});

const pushWarning = (warnings: string[], warning: string) => {
  if (!warnings.includes(warning)) warnings.push(warning);
};

const mean = (values: number[]) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const sampleStdDev = (values: number[]) => {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg === null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

// Linear interpolation between nearest ranks keeps percentiles deterministic for small samples.
const percentile = (sortedValues: number[], ratio: number) => {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * ratio;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];
  if (lowerValue === undefined || upperValue === undefined) return null;
  if (lowerIndex === upperIndex) return lowerValue;
  const weight = index - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * weight;
};

const normalizePctOption = (
  value: number | undefined,
  fallback: number,
  warnings: string[],
  invalidWarning: string,
) => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > 0.5) {
    pushWarning(warnings, invalidWarning);
    return fallback;
  }
  return value;
};

const annualToMonthlyRate = (annualRate: number) => (1 + annualRate) ** (1 / 12) - 1;

const buildTrimmedMean = (sortedValues: number[], trimPct: number) => {
  if (!sortedValues.length) return null;
  const trimCount = Math.floor(sortedValues.length * trimPct);
  if (trimCount <= 0 || trimCount * 2 >= sortedValues.length) return mean(sortedValues);
  return mean(sortedValues.slice(trimCount, sortedValues.length - trimCount));
};

const buildWinsorizedMean = (sortedValues: number[], winsorizePct: number) => {
  if (!sortedValues.length) return null;
  const winsorCount = Math.floor(sortedValues.length * winsorizePct);
  if (winsorCount <= 0 || winsorCount * 2 >= sortedValues.length) return mean(sortedValues);
  const lowerValue = sortedValues[winsorCount];
  const upperValue = sortedValues[sortedValues.length - winsorCount - 1];
  if (lowerValue === undefined || upperValue === undefined) return mean(sortedValues);
  const adjusted = sortedValues.map((value, index) => {
    if (index < winsorCount) return lowerValue;
    if (index >= sortedValues.length - winsorCount) return upperValue;
    return value;
  });
  return mean(adjusted);
};

type DrawdownState = {
  maxDrawdownPct: number;
  maxDrawdownStartMonthKey?: string;
  maxDrawdownTroughMonthKey?: string;
  maxDrawdownRecoveryMonthKey?: string;
  currentDrawdownPct: number;
  monthsToRecovery: number | null;
  isRecovered: boolean;
  ulcerIndex: number | null;
};

const buildDrawdownState = (points: NormalizedPoint[]): DrawdownState | null => {
  if (!points.length) return null;
  let equity = 1;
  let runningPeak = 1;
  let runningPeakMonthKey = points[0]?.monthKey;
  let maxDrawdown = 0;
  let drawdownStartMonthKey: string | undefined;
  let drawdownTroughMonthKey: string | undefined;
  let recoveryMonthKey: string | undefined;
  let troughIndex: number | null = null;
  let activePeakMonthKey: string | undefined;
  const drawdowns: number[] = [];

  points.forEach((point, index) => {
    equity *= 1 + point.returnPct;
    if (equity >= runningPeak) {
      runningPeak = equity;
      runningPeakMonthKey = point.monthKey;
      if (
        troughIndex !== null &&
        recoveryMonthKey === undefined &&
        drawdownTroughMonthKey &&
        point.monthKey > drawdownTroughMonthKey
      ) {
        recoveryMonthKey = point.monthKey;
      }
    }
    const drawdown = runningPeak === 0 ? 0 : equity / runningPeak - 1;
    drawdowns.push(drawdown);
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      drawdownStartMonthKey = runningPeakMonthKey;
      drawdownTroughMonthKey = point.monthKey;
      troughIndex = index;
      activePeakMonthKey = runningPeakMonthKey;
      recoveryMonthKey = undefined;
    }
    if (
      troughIndex !== null &&
      recoveryMonthKey === undefined &&
      activePeakMonthKey &&
      drawdownTroughMonthKey &&
      point.monthKey > drawdownTroughMonthKey &&
      equity >= runningPeak
    ) {
      recoveryMonthKey = point.monthKey;
    }
  });

  const negativeSquares = drawdowns.filter((value) => value < 0).map((value) => value ** 2);
  const ulcerIndex =
    negativeSquares.length > 0
      ? Math.sqrt(negativeSquares.reduce((sum, value) => sum + value, 0) / negativeSquares.length)
      : 0;

  return {
    maxDrawdownPct: maxDrawdown,
    maxDrawdownStartMonthKey: drawdownStartMonthKey,
    maxDrawdownTroughMonthKey: drawdownTroughMonthKey,
    maxDrawdownRecoveryMonthKey: recoveryMonthKey,
    currentDrawdownPct: drawdowns[drawdowns.length - 1] ?? 0,
    monthsToRecovery:
      troughIndex !== null && recoveryMonthKey
        ? points.findIndex((point) => point.monthKey === recoveryMonthKey) - troughIndex
        : maxDrawdown === 0
          ? 0
          : null,
    isRecovered: maxDrawdown === 0 ? true : recoveryMonthKey !== undefined,
    ulcerIndex,
  };
};

export const calculatePortfolioAnalytics = (
  input: PortfolioAnalyticsMonthlyPoint[],
  options: PortfolioAnalyticsOptions = {},
): PortfolioAnalyticsResult => {
  const warnings: string[] = [];
  const includeEstimated = options.includeEstimated ?? true;
  const riskFreeRateAnnualPct = options.riskFreeRateAnnualPct ?? 0;
  const trimPct = normalizePctOption(
    options.trimPct,
    DEFAULT_TRIM_PCT,
    warnings,
    'invalid_trim_pct_defaulted',
  );
  const winsorizePct = normalizePctOption(
    options.winsorizePct,
    DEFAULT_WINSORIZE_PCT,
    warnings,
    'invalid_winsorize_pct_defaulted',
  );

  if (options.riskFreeRateAnnualPct === undefined) {
    pushWarning(warnings, 'risk_free_rate_default_zero');
  }

  const normalized = input
    .map((point) => ({
      ...point,
      isEstimated: Boolean(point.isEstimated),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const validPoints: NormalizedPoint[] = [];
  let invalidCount = 0;

  normalized.forEach((point) => {
    if (!includeEstimated && point.isEstimated) return;
    if (
      point.monthKey === null ||
      point.monthKey === undefined ||
      !Number.isFinite(point.returnPct) ||
      point.returnPct < -1
    ) {
      invalidCount += 1;
      return;
    }
    validPoints.push(point);
  });

  if (invalidCount > 0) pushWarning(warnings, 'invalid_returns_excluded');
  if (includeEstimated && validPoints.some((point) => point.isEstimated)) {
    pushWarning(warnings, 'estimated_months_included');
  }
  if (validPoints.length > 0) pushWarning(warnings, 'monthly_drawdown_only');

  if (!validPoints.length) {
    pushWarning(warnings, input.length ? 'insufficient_months' : 'empty_series');
    return buildEmptyResult(input.length, warnings);
  }

  const returns = validPoints.map((point) => point.returnPct);
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const cumulativeGrowth = returns.reduce((product, value) => product * (1 + value), 1);
  const cumulativeReturnPct = cumulativeGrowth - 1;
  const annualizedReturnPct =
    returns.length > 0 ? (cumulativeGrowth <= 0 ? -1 : cumulativeGrowth ** (12 / returns.length) - 1) : null;
  const averageMonthlyReturnPct = mean(returns);
  const geometricMonthlyReturnPct =
    returns.length > 0 ? (cumulativeGrowth <= 0 ? -1 : cumulativeGrowth ** (1 / returns.length) - 1) : null;
  const medianMonthlyReturnPct = percentile(sortedReturns, 0.5);
  const volatilityMonthlyPct = sampleStdDev(returns);
  const volatilityAnnualizedPct =
    volatilityMonthlyPct === null ? null : volatilityMonthlyPct * Math.sqrt(12);

  if (returns.length < 2) pushWarning(warnings, 'insufficient_months');
  if (volatilityAnnualizedPct === 0) pushWarning(warnings, 'zero_volatility');

  const monthlyRiskFreeRate = annualToMonthlyRate(riskFreeRateAnnualPct);
  const downsideReturns = returns
    .filter((value) => value < monthlyRiskFreeRate)
    .map((value) => value - monthlyRiskFreeRate);
  const downsideDeviationMonthlyPct =
    downsideReturns.length >= 2
      ? sampleStdDev(downsideReturns)
      : downsideReturns.length === 1
        ? 0
        : 0;
  const downsideDeviationAnnualizedPct =
    downsideDeviationMonthlyPct === null ? null : downsideDeviationMonthlyPct * Math.sqrt(12);
  if (downsideDeviationAnnualizedPct === 0) pushWarning(warnings, 'zero_downside_deviation');

  const bestPoint = validPoints.reduce((best, point) => (best.returnPct >= point.returnPct ? best : point));
  const worstPoint = validPoints.reduce((worst, point) => (worst.returnPct <= point.returnPct ? worst : point));
  const positiveMonths = returns.filter((value) => value > 0).length;
  const negativeMonths = returns.filter((value) => value < 0).length;
  const zeroMonths = returns.length - positiveMonths - negativeMonths;

  const drawdownState = buildDrawdownState(validPoints);
  if (!drawdownState) {
    pushWarning(warnings, 'insufficient_months');
    return buildEmptyResult(input.length, warnings);
  }

  if (drawdownState.maxDrawdownPct === 0) pushWarning(warnings, 'zero_max_drawdown');

  const sharpeSimple =
    annualizedReturnPct === null || volatilityAnnualizedPct === null || volatilityAnnualizedPct === 0
      ? null
      : (annualizedReturnPct - riskFreeRateAnnualPct) / volatilityAnnualizedPct;
  const sortinoSimple =
    annualizedReturnPct === null ||
    downsideDeviationAnnualizedPct === null ||
    downsideDeviationAnnualizedPct === 0
      ? null
      : (annualizedReturnPct - riskFreeRateAnnualPct) / downsideDeviationAnnualizedPct;
  const calmarSimple =
    annualizedReturnPct === null || drawdownState.maxDrawdownPct === 0
      ? null
      : annualizedReturnPct / Math.abs(drawdownState.maxDrawdownPct);

  return {
    monthsTotal: input.length,
    monthsUsed: validPoints.length,
    estimatedMonthsUsed: validPoints.filter((point) => point.isEstimated).length,
    firstMonthKey: validPoints[0]?.monthKey,
    lastMonthKey: validPoints[validPoints.length - 1]?.monthKey,
    lastMonthIsEstimated: validPoints[validPoints.length - 1]?.isEstimated ?? false,
    cumulativeReturnPct,
    annualizedReturnPct,
    averageMonthlyReturnPct,
    medianMonthlyReturnPct,
    geometricMonthlyReturnPct,
    volatilityMonthlyPct,
    volatilityAnnualizedPct,
    downsideDeviationMonthlyPct,
    downsideDeviationAnnualizedPct,
    bestMonth: bestPoint
      ? {
          monthKey: bestPoint.monthKey,
          returnPct: bestPoint.returnPct,
          isEstimated: bestPoint.isEstimated,
        }
      : null,
    worstMonth: worstPoint
      ? {
          monthKey: worstPoint.monthKey,
          returnPct: worstPoint.returnPct,
          isEstimated: worstPoint.isEstimated,
        }
      : null,
    positiveMonthsPct: positiveMonths / returns.length,
    negativeMonthsPct: negativeMonths / returns.length,
    zeroMonthsPct: zeroMonths / returns.length,
    percentiles: {
      p10: percentile(sortedReturns, 0.1),
      p25: percentile(sortedReturns, 0.25),
      p50: percentile(sortedReturns, 0.5),
      p75: percentile(sortedReturns, 0.75),
      p90: percentile(sortedReturns, 0.9),
    },
    trimmedMeanMonthlyReturnPct: buildTrimmedMean(sortedReturns, trimPct),
    winsorizedMeanMonthlyReturnPct: buildWinsorizedMean(sortedReturns, winsorizePct),
    maxDrawdownPct: drawdownState.maxDrawdownPct,
    maxDrawdownStartMonthKey: drawdownState.maxDrawdownStartMonthKey,
    maxDrawdownTroughMonthKey: drawdownState.maxDrawdownTroughMonthKey,
    maxDrawdownRecoveryMonthKey: drawdownState.maxDrawdownRecoveryMonthKey,
    currentDrawdownPct: drawdownState.currentDrawdownPct,
    monthsToRecovery: drawdownState.monthsToRecovery,
    isRecovered: drawdownState.isRecovered,
    ulcerIndex: drawdownState.ulcerIndex,
    sharpeSimple,
    sortinoSimple,
    calmarSimple,
    warnings,
  };
};
