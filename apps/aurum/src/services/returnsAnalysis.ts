import type {
  AggregatedSummary,
  MonthlyReturnRow,
  ReturnCurveMarker,
  ReturnCurveMarkerKind,
  ReturnCurveModel,
  ReturnCurvePoint,
} from '../components/analysis/types';
import { GASTAPP_TOTALS } from '../data/gastappTotals';
import type { WealthCurrency, WealthFxRates, WealthMonthlyClosure } from './wealthStorage';

const sumNumbers = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

export const monthYear = (monthKey: string) => Number(monthKey.slice(0, 4));

const DEFAULT_FX_RATES: WealthFxRates = {
  usdClp: 950,
  eurClp: 1030,
  ufClp: 39000,
};

const previousMonthKey = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return monthKey;
  const previousMonth = monthRaw === 1 ? 12 : monthRaw - 1;
  const previousYear = monthRaw === 1 ? yearRaw - 1 : yearRaw;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
};

const monthAfter = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw)) return null;
  const nextMonth = monthRaw === 12 ? 1 : monthRaw + 1;
  const nextYear = monthRaw === 12 ? yearRaw + 1 : yearRaw;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
};

const currentOperationalMonthKey = (closures: WealthMonthlyClosure[]) => {
  const fallback = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  if (!closures.length) return fallback;
  const latestClosedMonth = [...closures]
    .map((closure) => closure.monthKey)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!latestClosedMonth) return fallback;
  return monthAfter(latestClosedMonth) || fallback;
};

const summaryNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const safeUsdClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : DEFAULT_FX_RATES.usdClp;

const safeUfClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : DEFAULT_FX_RATES.ufClp;

const safeFxRaw = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: safeUsdClp(Number(fx?.usdClp)),
  eurClp:
    Number.isFinite(Number(fx?.eurClp)) && Number(fx?.eurClp) > 0
      ? Number(fx?.eurClp)
      : DEFAULT_FX_RATES.eurClp,
  ufClp: safeUfClp(Number(fx?.ufClp)),
});

export const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

export const computeMonthlyRows = (
  closures: WealthMonthlyClosure[],
  includeRiskCapitalInTotals: boolean,
  currency: WealthCurrency,
): MonthlyReturnRow[] => {
  const sorted = [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const calendarCurrent = currentOperationalMonthKey(closures);
  const filtered = sorted.filter((closure) => closure.monthKey !== calendarCurrent);
  const rows: MonthlyReturnRow[] = [];
  let previousValidNet: number | null = null;
  let previousValidNetDisplay: number | null = null;

  for (const closure of filtered) {
    const fxRaw = safeFxRaw(closure.fxRates);
    const fx = fxRaw;
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const netDisplay = invalidNet || netClp === null ? null : convertFromClp(netClp, currency, fx);
    const prevNetClp = invalidNet ? null : previousValidNet;
    const prevNetDisplay = invalidNet ? null : previousValidNetDisplay;
    const varPatrimonioClp =
      invalidNet || prevNetClp === null || netClp === null ? null : netClp - prevNetClp;
    const varPatrimonioDisplay =
      invalidNet || prevNetDisplay === null || netDisplay === null ? null : netDisplay - prevNetDisplay;
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey])
      ? Number(GASTAPP_TOTALS[closure.monthKey])
      : null;
    const gastosClp = invalidNet || gastosEur === null ? null : gastosEur * fx.eurClp;
    const gastosDisplay = gastosClp === null ? null : convertFromClp(gastosClp, currency, fx);
    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const retornoRealDisplay =
      varPatrimonioDisplay === null || gastosDisplay === null ? null : varPatrimonioDisplay + gastosDisplay;
    const pct =
      retornoRealDisplay === null || prevNetDisplay === null || prevNetDisplay === 0
        ? null
        : (retornoRealDisplay / prevNetDisplay) * 100;

    if (invalidNet) {
      console.warn('[Analysis][invalid-net]', {
        monthKey: closure.monthKey,
        netClp: closure.summary?.netClp ?? null,
        netConsolidatedClp: closure.summary?.netConsolidatedClp ?? null,
      });
    } else {
      previousValidNet = Number(netClp);
      previousValidNetDisplay = Number(netDisplay);
    }

    rows.push({
      monthKey: closure.monthKey,
      fx,
      rawEurClp: fxRaw.eurClp,
      netClp,
      prevNetClp,
      invalidNet,
      varPatrimonioClp,
      gastosClp,
      retornoRealClp,
      netDisplay,
      prevNetDisplay,
      varPatrimonioDisplay,
      gastosDisplay,
      retornoRealDisplay,
      pct,
    });
  }

  return rows;
};

export const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  baseNetDisplay: number | null,
): AggregatedSummary => {
  const validRows = rows.filter(
    (row) =>
      row.varPatrimonioDisplay !== null &&
      row.gastosDisplay !== null &&
      row.retornoRealDisplay !== null,
  ) as Array<
    MonthlyReturnRow & {
      varPatrimonioClp: number;
      gastosClp: number;
      retornoRealClp: number;
      varPatrimonioDisplay: number;
      gastosDisplay: number;
      retornoRealDisplay: number;
    }
  >;

  const validMonths = validRows.length;
  const varPatrimonioAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.varPatrimonioClp)) : null;
  const gastosAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.gastosClp)) : null;
  const retornoRealAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.retornoRealClp)) : null;
  const varPatrimonioAcumDisplay = validMonths
    ? sumNumbers(validRows.map((row) => row.varPatrimonioDisplay))
    : null;
  const gastosAcumDisplay = validMonths ? sumNumbers(validRows.map((row) => row.gastosDisplay)) : null;
  const retornoRealAcumDisplay = validMonths
    ? sumNumbers(validRows.map((row) => row.retornoRealDisplay))
    : null;

  let pctRetorno: number | null = null;
  let pctRetornoNote: string | null = null;

  if (validMonths > 0 && retornoRealAcumDisplay !== null && baseNetDisplay !== null && baseNetDisplay > 0) {
    const periodReturn = retornoRealAcumDisplay / baseNetDisplay;
    const growthBase = 1 + periodReturn;
    if (growthBase <= 0) {
      pctRetorno = null;
      pctRetornoNote = 'período negativo';
      console.warn('[Analysis][pct-anual-equiv-negativo]', { key, label, validMonths, periodReturn, baseNetDisplay });
    } else {
      const annualized = (Math.pow(growthBase, 12 / validMonths) - 1) * 100;
      if (annualized > 200 || annualized < -100) {
        pctRetorno = null;
        pctRetornoNote = 'fuera de rango';
        console.warn('[Analysis][pct-anual-equiv-fuera-rango]', {
          key,
          label,
          validMonths,
          annualized,
          periodReturn,
          baseNetDisplay,
          retornoRealAcumDisplay,
        });
      } else {
        pctRetorno = annualized;
      }
    }
  }

  const spendPct =
    retornoRealAcumDisplay === null || retornoRealAcumDisplay === 0 || gastosAcumDisplay === null
      ? null
      : (gastosAcumDisplay / retornoRealAcumDisplay) * 100;

  const varPatrimonioAvgDisplay =
    validMonths && varPatrimonioAcumDisplay !== null ? varPatrimonioAcumDisplay / validMonths : null;
  const gastosAvgDisplay =
    validMonths && gastosAcumDisplay !== null ? gastosAcumDisplay / validMonths : null;
  const retornoRealAvgDisplay =
    validMonths && retornoRealAcumDisplay !== null ? retornoRealAcumDisplay / validMonths : null;

  return {
    key,
    label,
    validMonths,
    varPatrimonioAcumClp,
    gastosAcumClp,
    retornoRealAcumClp,
    varPatrimonioAcumDisplay,
    gastosAcumDisplay,
    retornoRealAcumDisplay,
    pctRetorno,
    pctRetornoNote,
    spendPct,
    varPatrimonioAvgDisplay,
    gastosAvgDisplay,
    retornoRealAvgDisplay,
  };
};

const buildCurveDomain = (values: number[]) => {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const padding = range === 0 ? Math.max(Math.abs(maxValue) * 0.08, 1) : range * 0.14;
  return {
    minValue,
    maxValue,
    domainMin: minValue - padding,
    domainMax: maxValue + padding,
  };
};

const buildMarkerList = (points: ReturnCurvePoint[]) => {
  const markerByPointId = new Map<string, ReturnCurveMarker>();

  const upsertMarker = (point: ReturnCurvePoint, pointIndex: number, kind: ReturnCurveMarkerKind) => {
    const existing = markerByPointId.get(point.id);
    if (existing) {
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      return;
    }
    markerByPointId.set(point.id, {
      pointId: point.id,
      pointIndex,
      monthKey: point.monthKey,
      value: point.value,
      kinds: [kind],
    });
  };

  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  upsertMarker(startPoint, 0, 'start');
  upsertMarker(endPoint, points.length - 1, 'end');

  let maxIndex = 0;
  let minIndex = 0;
  points.forEach((point, index) => {
    if (point.value > points[maxIndex].value) maxIndex = index;
    if (point.value < points[minIndex].value) minIndex = index;
  });
  upsertMarker(points[maxIndex], maxIndex, 'max');
  upsertMarker(points[minIndex], minIndex, 'min');

  return [...markerByPointId.values()].sort((a, b) => a.pointIndex - b.pointIndex);
};

export const buildTrajectoryCurve = (rows: MonthlyReturnRow[]): ReturnCurveModel => {
  const comparableRows = rows.filter((row) => row.pct !== null) as Array<
    MonthlyReturnRow & { pct: number }
  >;
  if (!comparableRows.length) {
    return {
      status: 'insufficient_data',
      points: [],
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  let currentIndex = 100;
  const points: ReturnCurvePoint[] = [
    {
      id: `${previousMonthKey(comparableRows[0].monthKey)}-base`,
      monthKey: previousMonthKey(comparableRows[0].monthKey),
      value: 100,
      synthetic: true,
    },
  ];

  for (const row of comparableRows) {
    currentIndex = currentIndex * (1 + row.pct / 100);
    points.push({
      id: row.monthKey,
      monthKey: row.monthKey,
      value: currentIndex,
    });
  }

  if (points.length < 2) {
    return {
      status: 'insufficient_data',
      points,
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  const values = points.map((point) => point.value);
  const { minValue, maxValue, domainMin, domainMax } = buildCurveDomain(values);
  return {
    status: 'ok',
    points,
    markers: buildMarkerList(points),
    domainMin,
    domainMax,
    minValue,
    maxValue,
  };
};

export const buildPatrimonyCurve = (rows: MonthlyReturnRow[]): ReturnCurveModel => {
  const points: ReturnCurvePoint[] = rows
    .filter((row) => row.netDisplay !== null)
    .map((row) => ({
      id: row.monthKey,
      monthKey: row.monthKey,
      value: Number(row.netDisplay),
    }));

  if (points.length < 2) {
    return {
      status: 'insufficient_data',
      points,
      markers: [],
      domainMin: null,
      domainMax: null,
      minValue: null,
      maxValue: null,
    };
  }

  const values = points.map((point) => point.value);
  const { minValue, maxValue, domainMin, domainMax } = buildCurveDomain(values);
  return {
    status: 'ok',
    points,
    markers: buildMarkerList(points),
    domainMin,
    domainMax,
    minValue,
    maxValue,
  };
};
