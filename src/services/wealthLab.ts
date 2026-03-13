import {
  currentMonthKey,
  defaultFxRates,
  isRiskCapitalInvestmentLabel,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthSnapshotSummary,
} from './wealthStorage';
import { WEALTH_LAB_EXTERNAL_AGGREGATE } from '../data/wealthLabHistoricalAggregate';

export const GASTAPP_TOTALS: Record<string, number> = {
  '2023-05': 4536,
  '2023-06': 4724,
  '2023-07': 4130,
  '2023-08': 4044,
  '2023-09': 3878,
  '2023-10': 3504,
  '2023-11': 3864,
  '2023-12': 3922,
  '2024-01': 3714,
  '2024-02': 3881,
  '2024-03': 3590,
  '2024-04': 3572,
  '2024-05': 3370,
  '2024-06': 3471,
  '2024-07': 5255,
  '2024-08': 4922,
  '2024-09': 4302,
  '2024-10': 5173,
  '2024-11': 5120,
  '2024-12': 5460,
  '2025-01': 3943,
  '2025-02': 4507,
  '2025-03': 4664,
  '2025-04': 3682,
  '2025-05': 4965,
  '2025-06': 5169,
  '2025-07': 5123,
  '2025-08': 4830,
  '2025-09': 4968,
  '2025-10': 5197,
  '2025-11': 4464,
  '2025-12': 4400,
  '2026-01': 4012,
  '2026-02': 4567,
};

export type WealthLabPoint = {
  monthKey: string;
  fx: WealthFxRates;
  netClp: number | null;
  prevNetClp: number | null;
  varPatrimonioClp: number | null;
  gastosClp: number | null;
  retornoEconomicoClp: number | null;
  aggregateClp: number | null;
  usdBlocks: number | null;
  usdExposureKnown: boolean;
  usdExposureSource: 'summary_aggregate' | 'external_series' | 'records' | 'summary_fallback' | 'unknown';
  deltaUsdRealClp: number | null;
  deltaUsdConstClp: number | null;
  aportesFxClp: number | null;
  varSinFxClp: number | null;
  performanceSinFxClp: number | null;
  rawIndiceReal: number | null;
  rawIndiceSinFx: number | null;
  indiceReal: number | null;
  indiceSinFx: number | null;
};

export type WealthLabMetric = {
  label: string;
  valueClp: number | null;
  months: number;
};

export type WealthLabHeadlineMetric = {
  label: string;
  monthlyEquivalentClp: number | null;
  totalClp: number | null;
  months: number;
};

export type WealthLabWindow = 'since_start' | 'last_12m' | 'last_month';

export type WealthLabPeriodView = {
  key: WealthLabWindow;
  label: string;
  points: WealthLabPoint[];
  chartPoints: WealthLabPoint[];
  realMonths: number;
  fxComparableMonths: number;
  monthlyMetrics: {
    resultadoSinFx: WealthLabMetric;
    real: WealthLabMetric;
    aporteFx: WealthLabMetric;
  } | null;
  cumulativeMetrics: {
    resultadoSinFx: WealthLabMetric;
    real: WealthLabMetric;
    aporteFx: WealthLabMetric;
  } | null;
  headlineMetrics: {
    resultadoSinFx: WealthLabHeadlineMetric;
    real: WealthLabHeadlineMetric;
    aporteFx: WealthLabHeadlineMetric;
  } | null;
  currentPeriodLabel: string | null;
};

export type WealthLabModel = {
  status: 'ok' | 'no_data' | 'insufficient_fx_detail';
  points: WealthLabPoint[];
  chartPoints: WealthLabPoint[];
  latestComparablePoint: WealthLabPoint | null;
  cumulativeMetrics: {
    resultadoSinFx: WealthLabMetric;
    real: WealthLabMetric;
    aporteFx: WealthLabMetric;
  } | null;
  monthlyMetrics: {
    resultadoSinFx: WealthLabMetric;
    real: WealthLabMetric;
    aporteFx: WealthLabMetric;
  } | null;
  currentPeriodLabel: string | null;
  notes: string[];
  firstComparableMonthKey: string | null;
  lastComparableMonthKey: string | null;
};

const buildMetricBundle = (points: WealthLabPoint[]): {
  monthlyMetrics: {
    resultadoSinFx: WealthLabMetric;
    real: WealthLabMetric;
    aporteFx: WealthLabMetric;
  } | null;
  cumulativeMetrics: {
    resultadoSinFx: WealthLabMetric;
    real: WealthLabMetric;
    aporteFx: WealthLabMetric;
  } | null;
  currentPeriodLabel: string | null;
} => {
  const realPoints = points.filter((point) => point.varPatrimonioClp !== null);
  const fxComparablePoints = points.filter(
    (point) => point.varSinFxClp !== null && point.aportesFxClp !== null,
  );
  const latestRealPoint = [...realPoints].reverse()[0] || null;
  const latestComparablePoint = [...fxComparablePoints].reverse()[0] || null;

  const cumulativeMetrics =
    realPoints.length || fxComparablePoints.length
      ? {
          resultadoSinFx: {
            label: 'Resultado sin FX acumulado',
            valueClp: fxComparablePoints.length
              ? fxComparablePoints.reduce((sum, point) => sum + Number(point.varSinFxClp || 0), 0)
              : null,
            months: fxComparablePoints.length,
          },
          real: {
            label: 'Resultado del período acumulado',
            valueClp: realPoints.length
              ? realPoints.reduce((sum, point) => sum + Number(point.varPatrimonioClp || 0), 0)
              : null,
            months: realPoints.length,
          },
          aporteFx: {
            label: 'Efecto FX acumulado',
            valueClp: fxComparablePoints.length
              ? fxComparablePoints.reduce((sum, point) => sum + Number(point.aportesFxClp || 0), 0)
              : null,
            months: fxComparablePoints.length,
          },
        }
      : null;

  const monthlyMetrics = latestRealPoint || latestComparablePoint
    ? {
        resultadoSinFx: {
          label: 'Resultado sin FX mensual',
          valueClp: latestComparablePoint?.varSinFxClp ?? null,
          months: latestComparablePoint ? 1 : 0,
        },
        real: {
          label: 'Resultado del período mensual',
          valueClp: latestRealPoint?.varPatrimonioClp ?? null,
          months: latestRealPoint ? 1 : 0,
        },
        aporteFx: {
          label: 'Efecto FX mensual',
          valueClp: latestComparablePoint?.aportesFxClp ?? null,
          months: latestComparablePoint ? 1 : 0,
        },
      }
    : null;

  return {
    monthlyMetrics,
    cumulativeMetrics,
    currentPeriodLabel: latestRealPoint?.monthKey || latestComparablePoint?.monthKey || null,
  };
};

const buildHeadlineMetrics = (
  points: WealthLabPoint[],
): {
  resultadoSinFx: WealthLabHeadlineMetric;
  real: WealthLabHeadlineMetric;
  aporteFx: WealthLabHeadlineMetric;
} | null => {
  const comparablePoints = points.filter(
    (point) =>
      point.varPatrimonioClp !== null &&
      point.varSinFxClp !== null &&
      point.aportesFxClp !== null,
  );

  if (!comparablePoints.length) return null;

  const months = comparablePoints.length;
  const sinFxTotal = comparablePoints.reduce((sum, point) => sum + Number(point.varSinFxClp || 0), 0);
  const fxTotal = comparablePoints.reduce((sum, point) => sum + Number(point.aportesFxClp || 0), 0);
  const realTotal = sinFxTotal + fxTotal;

  const toMonthlyEquivalent = (value: number) => value / months;

  return {
    resultadoSinFx: {
      label: 'Resultado sin FX promedio mensual',
      monthlyEquivalentClp: toMonthlyEquivalent(sinFxTotal),
      totalClp: sinFxTotal,
      months,
    },
    real: {
      label: 'Resultado del período promedio mensual',
      monthlyEquivalentClp: toMonthlyEquivalent(realTotal),
      totalClp: realTotal,
      months,
    },
    aporteFx: {
      label: 'Efecto FX promedio mensual',
      monthlyEquivalentClp: toMonthlyEquivalent(fxTotal),
      totalClp: fxTotal,
      months,
    },
  };
};

const rebaseChartPoints = (points: WealthLabPoint[]): WealthLabPoint[] => {
  const comparable = points.filter((point) => point.rawIndiceReal !== null && point.rawIndiceSinFx !== null);
  const firstComparable = comparable[0] || null;
  if (!firstComparable) return [];
  return comparable.map((point) => ({
    ...point,
    indiceReal: (Number(point.rawIndiceReal) / Number(firstComparable.rawIndiceReal)) * 100,
    indiceSinFx: (Number(point.rawIndiceSinFx) / Number(firstComparable.rawIndiceSinFx)) * 100,
  }));
};

export const selectWealthLabPeriod = (
  model: WealthLabModel,
  window: WealthLabWindow,
): WealthLabPeriodView => {
  const basePoints = model.points;
  let points: WealthLabPoint[] = basePoints;
  let chartSource: WealthLabPoint[] = basePoints;
  let label = 'Desde inicio';

  if (window === 'last_12m') {
    points = basePoints.slice(-12);
    chartSource = points;
    label = 'Últ. 12M';
  } else if (window === 'last_month') {
    points = basePoints.slice(-1);
    chartSource = basePoints.slice(-2);
    label = 'Últ. mes';
  }

  const metrics = buildMetricBundle(points);
  const headlineMetrics = buildHeadlineMetrics(points);
  const realMonths = points.filter((point) => point.varPatrimonioClp !== null).length;
  const fxComparableMonths = points.filter((point) => point.varSinFxClp !== null && point.aportesFxClp !== null).length;

  return {
    key: window,
    label,
    points,
    chartPoints: rebaseChartPoints(chartSource),
    realMonths,
    fxComparableMonths,
    monthlyMetrics: metrics.monthlyMetrics,
    cumulativeMetrics: metrics.cumulativeMetrics,
    headlineMetrics,
    currentPeriodLabel: metrics.currentPeriodLabel,
  };
};

const safeFx = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: Number.isFinite(Number(fx?.usdClp)) && Number(fx?.usdClp) > 0 ? Number(fx?.usdClp) : defaultFxRates.usdClp,
  eurClp: Number.isFinite(Number(fx?.eurClp)) && Number(fx?.eurClp) > 0 ? Number(fx?.eurClp) : defaultFxRates.eurClp,
  ufClp: Number.isFinite(Number(fx?.ufClp)) && Number(fx?.ufClp) > 0 ? Number(fx?.ufClp) : defaultFxRates.ufClp,
});

const summaryNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const summarizeAnalysisByCurrencyFromRecords = (
  closure: WealthMonthlyClosure,
): WealthSnapshotSummary['analysisByCurrency'] | null => {
  if (!Array.isArray(closure.records) || !closure.records.length || !closure.fxRates) return null;
  let clpWithRisk = 0;
  let usdWithRisk = 0;
  let clpWithoutRisk = 0;
  let usdWithoutRisk = 0;
  for (const record of closure.records) {
    const amount = Number(record.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const signedAmount = record.block === 'debt' ? -amount : amount;
    const includeWithoutRisk =
      record.block !== 'investment' || !isRiskCapitalInvestmentLabel(record.label);
    if (record.currency === 'USD') {
      usdWithRisk += signedAmount;
      if (includeWithoutRisk) usdWithoutRisk += signedAmount;
      continue;
    }
    const clpEquivalent =
      record.currency === 'CLP'
        ? signedAmount
        : record.currency === 'EUR'
          ? signedAmount * closure.fxRates.eurClp
          : signedAmount * closure.fxRates.ufClp;
    clpWithRisk += clpEquivalent;
    if (includeWithoutRisk) clpWithoutRisk += clpEquivalent;
  }
  return {
    clpWithoutRisk: Math.round(clpWithoutRisk),
    usdWithoutRisk: Math.round(usdWithoutRisk * 100) / 100,
    clpWithRisk: Math.round(clpWithRisk),
    usdWithRisk: Math.round(usdWithRisk * 100) / 100,
    source: 'records',
  };
};

const resolveAggregateCurrencySeries = (
  closure: WealthMonthlyClosure,
  includeRiskCapitalInTotals: boolean,
): {
  aggregateClp: number | null;
  usdBlocks: number | null;
  usdExposureKnown: boolean;
  usdExposureSource: WealthLabPoint['usdExposureSource'];
} => {
  const summarySeries = closure.summary?.analysisByCurrency;
  if (summarySeries) {
    return {
      aggregateClp: includeRiskCapitalInTotals ? summarySeries.clpWithRisk : summarySeries.clpWithoutRisk,
      usdBlocks: includeRiskCapitalInTotals ? summarySeries.usdWithRisk : summarySeries.usdWithoutRisk,
      usdExposureKnown: true,
      usdExposureSource: 'summary_aggregate',
    };
  }

  const externalSeries = WEALTH_LAB_EXTERNAL_AGGREGATE[closure.monthKey];
  if (externalSeries) {
    return {
      aggregateClp: includeRiskCapitalInTotals ? externalSeries.clpWithRisk : externalSeries.clpWithoutRisk,
      usdBlocks: includeRiskCapitalInTotals ? externalSeries.usdWithRisk : externalSeries.usdWithoutRisk,
      usdExposureKnown: true,
      usdExposureSource: 'external_series',
    };
  }

  const recordsSeries = summarizeAnalysisByCurrencyFromRecords(closure);
  if (recordsSeries) {
    return {
      aggregateClp: includeRiskCapitalInTotals ? recordsSeries.clpWithRisk : recordsSeries.clpWithoutRisk,
      usdBlocks: includeRiskCapitalInTotals ? recordsSeries.usdWithRisk : recordsSeries.usdWithoutRisk,
      usdExposureKnown: true,
      usdExposureSource: 'records',
    };
  }

  const summary = closure.summary;
  const summaryUsd = Number(summary?.netByCurrency?.USD || 0);
  const summaryNet = summaryNetClp(closure, includeRiskCapitalInTotals);
  const canUseSummaryFallback =
    Number.isFinite(summaryUsd) &&
    summaryNet !== null &&
    (summaryUsd !== 0 || summary?.analysisByCurrency?.source === 'net_clp_only');
  if (canUseSummaryFallback) {
    return {
      aggregateClp: summaryNet - summaryUsd * safeFx(closure.fxRates).usdClp,
      usdBlocks: summaryUsd,
      usdExposureKnown: true,
      usdExposureSource: 'summary_fallback',
    };
  }

  return {
    aggregateClp: null,
    usdBlocks: null,
    usdExposureKnown: false,
    usdExposureSource: 'unknown',
  };
};

export const buildWealthLabModel = (
  closures: WealthMonthlyClosure[],
  includeRiskCapitalInTotals = false,
): WealthLabModel => {
  const sorted = [...closures]
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .filter((closure) => closure.monthKey !== currentMonthKey());

  if (!sorted.length) {
    return {
      status: 'no_data',
      points: [],
      chartPoints: [],
      latestComparablePoint: null,
      cumulativeMetrics: null,
      monthlyMetrics: null,
      currentPeriodLabel: null,
      notes: ['Aún no hay cierres confirmados para construir Lab.'],
      firstComparableMonthKey: null,
      lastComparableMonthKey: null,
    };
  }

  const points: WealthLabPoint[] = [];
  let previousValidNet: number | null = null;
  let previousComparableSeries: { realClp: number; usdBlocks: number; usdClp: number } | null = null;
  let lastRawIndiceReal: number | null = null;
  let lastRawIndiceSinFx: number | null = null;

  for (const closure of sorted) {
    const externalSeries = WEALTH_LAB_EXTERNAL_AGGREGATE[closure.monthKey];
    const fx = {
      ...safeFx(closure.fxRates),
      usdClp: externalSeries?.usdClp ?? safeFx(closure.fxRates).usdClp,
    };
    const aggregateSeries = resolveAggregateCurrencySeries(closure, includeRiskCapitalInTotals);
    const seriesRealClp =
      aggregateSeries.aggregateClp !== null && aggregateSeries.usdBlocks !== null
        ? aggregateSeries.aggregateClp + aggregateSeries.usdBlocks * fx.usdClp
        : null;
    const netClp = seriesRealClp ?? summaryNetClp(closure, includeRiskCapitalInTotals);
    const prevNetClp = netClp !== null && Number.isFinite(netClp) && netClp > 0 ? previousValidNet : null;
    const varPatrimonioClp =
      netClp !== null && prevNetClp !== null && prevNetClp > 0 ? netClp - prevNetClp : null;
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey]) ? Number(GASTAPP_TOTALS[closure.monthKey]) : null;
    const gastosClp = gastosEur !== null ? gastosEur * fx.eurClp : null;
    const retornoEconomicoClp =
      varPatrimonioClp !== null && gastosClp !== null ? varPatrimonioClp + gastosClp : null;
    const deltaUsdRealClp =
      aggregateSeries.usdExposureKnown &&
      aggregateSeries.usdBlocks !== null &&
      previousComparableSeries !== null
        ? aggregateSeries.usdBlocks * fx.usdClp -
          previousComparableSeries.usdBlocks * previousComparableSeries.usdClp
        : null;
    const deltaUsdConstClp =
      aggregateSeries.usdExposureKnown &&
      aggregateSeries.aggregateClp !== null &&
      aggregateSeries.usdBlocks !== null &&
      previousComparableSeries !== null
        ? aggregateSeries.aggregateClp + aggregateSeries.usdBlocks * previousComparableSeries.usdClp - previousComparableSeries.realClp
        : null;
    const aportesFxClp =
      deltaUsdRealClp !== null && deltaUsdConstClp !== null ? deltaUsdRealClp - deltaUsdConstClp : null;
    const varSinFxClp =
      deltaUsdConstClp;
    const performanceSinFxClp =
      retornoEconomicoClp !== null && aportesFxClp !== null ? retornoEconomicoClp - aportesFxClp : null;

    let rawIndiceReal: number | null = null;
    if (netClp !== null && Number.isFinite(netClp) && netClp > 0) {
      if (lastRawIndiceReal === null) rawIndiceReal = 100;
      else if (varPatrimonioClp !== null && prevNetClp !== null && prevNetClp > 0) {
        rawIndiceReal = lastRawIndiceReal * (1 + varPatrimonioClp / prevNetClp);
      }
    }

    let rawIndiceSinFx: number | null = null;
    if (varSinFxClp !== null && prevNetClp !== null && prevNetClp > 0) {
      if (lastRawIndiceSinFx === null) rawIndiceSinFx = 100;
      else rawIndiceSinFx = lastRawIndiceSinFx * (1 + varSinFxClp / prevNetClp);
    }

    points.push({
      monthKey: closure.monthKey,
      fx,
      netClp,
      prevNetClp,
      varPatrimonioClp,
      gastosClp,
      retornoEconomicoClp,
      aggregateClp: aggregateSeries.aggregateClp,
      usdBlocks: aggregateSeries.usdBlocks,
      usdExposureKnown: aggregateSeries.usdExposureKnown,
      usdExposureSource: aggregateSeries.usdExposureSource,
      deltaUsdRealClp,
      deltaUsdConstClp,
      aportesFxClp,
      varSinFxClp,
      performanceSinFxClp,
      rawIndiceReal,
      rawIndiceSinFx,
      indiceReal: null,
      indiceSinFx: null,
    });

    if (netClp !== null && Number.isFinite(netClp) && netClp > 0) {
      previousValidNet = netClp;
      if (rawIndiceReal !== null) lastRawIndiceReal = rawIndiceReal;
    }
    if (
      aggregateSeries.usdExposureKnown &&
      aggregateSeries.aggregateClp !== null &&
      aggregateSeries.usdBlocks !== null &&
      seriesRealClp !== null
    ) {
      previousComparableSeries = {
        realClp: seriesRealClp,
        usdBlocks: aggregateSeries.usdBlocks,
        usdClp: fx.usdClp,
      };
      if (rawIndiceSinFx !== null) lastRawIndiceSinFx = rawIndiceSinFx;
    }
  }

  const chartPoints = rebaseChartPoints(points);
  const latestComparablePoint = [...chartPoints].reverse()[0] || null;
  const { cumulativeMetrics, monthlyMetrics, currentPeriodLabel } = buildMetricBundle(chartPoints);

  const notes: string[] = [
    'Usa la serie agregada mensual CLP/USD cuando está disponible.',
    'Neutraliza USD/CLP mensual sobre bloques expuestos a USD.',
    'Bienes raíces y previsional permanecen en CLP observado.',
    'Esta métrica representa variación patrimonial ajustada por USD/CLP, no performance pura perfecta.',
  ];

  if (points.some((point) => point.usdExposureSource === 'external_series')) {
    notes.push('Para el histórico ya cargado, Lab usa la serie mensual externa CLP/USD como fallback local explícito.');
  }
  if (points.some((point) => !point.usdExposureKnown)) {
    notes.push('Algunos tramos aún no conservan base CLP/USD suficiente; Lab omite solo esos meses en el cálculo sin FX.');
  }

  return {
    status: chartPoints.length ? 'ok' : points.some((point) => !point.usdExposureKnown) ? 'insufficient_fx_detail' : 'no_data',
    points,
    chartPoints,
    latestComparablePoint,
    cumulativeMetrics,
    monthlyMetrics,
    currentPeriodLabel,
    notes,
    firstComparableMonthKey: chartPoints[0]?.monthKey || null,
    lastComparableMonthKey: latestComparablePoint?.monthKey || null,
  };
};
