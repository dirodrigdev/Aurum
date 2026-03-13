import {
  currentMonthKey,
  defaultFxRates,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthSnapshotSummary,
} from './wealthStorage';

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
  usdBlocks: number | null;
  usdExposureKnown: boolean;
  usdExposureSource: 'summary' | 'unknown';
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

export type WealthLabWindow = 'since_start' | 'last_12m' | 'last_month';

export type WealthLabPeriodView = {
  key: WealthLabWindow;
  label: string;
  points: WealthLabPoint[];
  chartPoints: WealthLabPoint[];
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
  const comparableForMetrics = points.filter(
    (point) => point.varPatrimonioClp !== null && point.varSinFxClp !== null && point.aportesFxClp !== null,
  );
  const latestComparablePoint = [...points].reverse().find(
    (point) => point.varPatrimonioClp !== null && point.varSinFxClp !== null && point.aportesFxClp !== null,
  ) || null;

  const cumulativeMetrics = comparableForMetrics.length
    ? {
        resultadoSinFx: {
          label: 'Resultado sin FX acumulado',
          valueClp: comparableForMetrics.reduce((sum, point) => sum + Number(point.varSinFxClp || 0), 0),
          months: comparableForMetrics.length,
        },
        real: {
          label: 'Real acumulado',
          valueClp: comparableForMetrics.reduce((sum, point) => sum + Number(point.varPatrimonioClp || 0), 0),
          months: comparableForMetrics.length,
        },
        aporteFx: {
          label: 'Aporte FX acumulado',
          valueClp: comparableForMetrics.reduce((sum, point) => sum + Number(point.aportesFxClp || 0), 0),
          months: comparableForMetrics.length,
        },
      }
    : null;

  const monthlyMetrics = latestComparablePoint
    ? {
        resultadoSinFx: {
          label: 'Resultado sin FX mensual',
          valueClp: latestComparablePoint.varSinFxClp,
          months: 1,
        },
        real: {
          label: 'Real mensual',
          valueClp: latestComparablePoint.varPatrimonioClp,
          months: 1,
        },
        aporteFx: {
          label: 'Aporte FX mensual',
          valueClp: latestComparablePoint.aportesFxClp,
          months: 1,
        },
      }
    : null;

  return {
    monthlyMetrics,
    cumulativeMetrics,
    currentPeriodLabel: latestComparablePoint?.monthKey || null,
  };
};

export const selectWealthLabPeriod = (
  model: WealthLabModel,
  window: WealthLabWindow,
): WealthLabPeriodView => {
  const basePoints = model.chartPoints;
  let points: WealthLabPoint[] = basePoints;
  let chartPoints: WealthLabPoint[] = basePoints;
  let label = 'Desde inicio';

  if (window === 'last_12m') {
    points = basePoints.slice(-12);
    chartPoints = points;
    label = 'Últ. 12M';
  } else if (window === 'last_month') {
    points = basePoints.slice(-1);
    chartPoints = basePoints.slice(-2);
    label = 'Últ. mes';
  }

  const metrics = buildMetricBundle(points);

  return {
    key: window,
    label,
    points,
    chartPoints,
    monthlyMetrics: metrics.monthlyMetrics,
    cumulativeMetrics: metrics.cumulativeMetrics,
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

const hasDetailedUsdBreakdown = (summary?: WealthSnapshotSummary, closure?: WealthMonthlyClosure) => {
  const investmentUsd = Number(summary?.byBlock?.investment?.USD || 0);
  const bankUsd = Number(summary?.byBlock?.bank?.USD || 0);
  const netUsd = Number(summary?.netByCurrency?.USD || 0);
  return (
    (Array.isArray(closure?.records) && closure!.records!.length > 0) ||
    investmentUsd !== 0 ||
    bankUsd !== 0 ||
    netUsd !== 0
  );
};

const resolveUsdBlocks = (closure: WealthMonthlyClosure): {
  usdBlocks: number | null;
  usdExposureKnown: boolean;
  usdExposureSource: 'summary' | 'unknown';
} => {
  const summary = closure.summary;
  const investmentUsd = Number(summary?.byBlock?.investment?.USD || 0);
  const bankUsd = Number(summary?.byBlock?.bank?.USD || 0);
  const known = hasDetailedUsdBreakdown(summary, closure);
  if (!known) {
    return {
      usdBlocks: null,
      usdExposureKnown: false,
      usdExposureSource: 'unknown',
    };
  }
  return {
    usdBlocks: investmentUsd + bankUsd,
    usdExposureKnown: true,
    usdExposureSource: 'summary',
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
  let previousComparableUsd: { usdBlocks: number; usdClp: number } | null = null;
  let lastRawIndiceReal: number | null = null;
  let lastRawIndiceSinFx: number | null = null;

  for (const closure of sorted) {
    const fx = safeFx(closure.fxRates);
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const prevNetClp = netClp !== null && Number.isFinite(netClp) && netClp > 0 ? previousValidNet : null;
    const varPatrimonioClp =
      netClp !== null && prevNetClp !== null && prevNetClp > 0 ? netClp - prevNetClp : null;
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey]) ? Number(GASTAPP_TOTALS[closure.monthKey]) : null;
    const gastosClp = gastosEur !== null ? gastosEur * fx.eurClp : null;
    const retornoEconomicoClp =
      varPatrimonioClp !== null && gastosClp !== null ? varPatrimonioClp + gastosClp : null;
    const usdExposure = resolveUsdBlocks(closure);
    const deltaUsdRealClp =
      usdExposure.usdExposureKnown &&
      usdExposure.usdBlocks !== null &&
      previousComparableUsd !== null
        ? usdExposure.usdBlocks * fx.usdClp -
          previousComparableUsd.usdBlocks * previousComparableUsd.usdClp
        : null;
    const deltaUsdConstClp =
      usdExposure.usdExposureKnown &&
      usdExposure.usdBlocks !== null &&
      previousComparableUsd !== null
        ? (usdExposure.usdBlocks - previousComparableUsd.usdBlocks) * previousComparableUsd.usdClp
        : null;
    const aportesFxClp =
      deltaUsdRealClp !== null && deltaUsdConstClp !== null ? deltaUsdRealClp - deltaUsdConstClp : null;
    const varSinFxClp =
      varPatrimonioClp !== null && aportesFxClp !== null ? varPatrimonioClp - aportesFxClp : null;
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
      usdBlocks: usdExposure.usdBlocks,
      usdExposureKnown: usdExposure.usdExposureKnown,
      usdExposureSource: usdExposure.usdExposureSource,
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
    if (usdExposure.usdExposureKnown && usdExposure.usdBlocks !== null) {
      previousComparableUsd = { usdBlocks: usdExposure.usdBlocks, usdClp: fx.usdClp };
      if (rawIndiceSinFx !== null) lastRawIndiceSinFx = rawIndiceSinFx;
    }
  }

  const firstComparable = points.find((point) => point.rawIndiceReal !== null && point.rawIndiceSinFx !== null) || null;
  const chartPoints = firstComparable
    ? points
        .filter((point) => point.rawIndiceReal !== null && point.rawIndiceSinFx !== null)
        .map((point) => ({
          ...point,
          indiceReal: (Number(point.rawIndiceReal) / Number(firstComparable.rawIndiceReal)) * 100,
          indiceSinFx: (Number(point.rawIndiceSinFx) / Number(firstComparable.rawIndiceSinFx)) * 100,
        }))
    : [];

  const latestComparablePoint = [...chartPoints].reverse()[0] || null;
  const { cumulativeMetrics, monthlyMetrics, currentPeriodLabel } = buildMetricBundle(chartPoints);

  const notes: string[] = [
    'Neutraliza USD/CLP mensual sobre bloques expuestos a USD.',
    'Bienes raíces y previsional permanecen en CLP observado.',
    'Esta métrica representa variación patrimonial ajustada por USD/CLP, no performance pura perfecta.',
  ];

  if (points.some((point) => !point.usdExposureKnown)) {
    notes.push('Algunos cierres históricos no conservan desglose USD suficiente; Lab usa solo los meses con exposición USD identificable.');
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
