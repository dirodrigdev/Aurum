import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, LineChart } from 'lucide-react';
import { Button, Card, cn } from '../components/Components';
import {
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  WEALTH_DATA_UPDATED_EVENT,
  currentMonthKey,
  defaultFxRates,
  loadClosures,
} from '../services/wealthStorage';
import { formatCurrency, formatMonthLabel as monthLabel } from '../utils/wealthFormat';

const GASTAPP_TOTALS: Record<string, number> = {
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

type AnalysisTab = 'returns' | 'freedom';

type MonthlyReturnRow = {
  monthKey: string;
  fx: WealthFxRates;
  rawEurClp: number;
  netClp: number | null;
  prevNetClp: number | null;
  invalidNet: boolean;
  varPatrimonioClp: number | null;
  gastosClp: number | null;
  retornoRealClp: number | null;
  pct: number | null;
};

type AggregatedSummary = {
  key: string;
  label: string;
  validMonths: number;
  varPatrimonioAcumClp: number | null;
  gastosAcumClp: number | null;
  retornoRealAcumClp: number | null;
  pctRetorno: number | null;
  pctRetornoNote: string | null;
  spendPct: number | null;
  varPatrimonioAvgDisplay: number | null;
  gastosAvgDisplay: number | null;
  retornoRealAvgDisplay: number | null;
};

const loadWealthClosures = () => loadClosures();

const summaryNetClp = (closure: WealthMonthlyClosure): number | null => {
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const safeUsdClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : defaultFxRates.usdClp;

const safeUfClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : defaultFxRates.ufClp;

const safeFxRaw = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: safeUsdClp(Number(fx?.usdClp)),
  eurClp: Number.isFinite(Number(fx?.eurClp)) && Number(fx?.eurClp) > 0 ? Number(fx?.eurClp) : defaultFxRates.eurClp,
  ufClp: safeUfClp(Number(fx?.ufClp)),
});

const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

const formatPct = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals).replace('.', ',')}%`;
};

const formatCompactCurrency = (value: number, currency: WealthCurrency) => {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    const scaled = (abs / 1_000_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'CLP' ? `${sign}$${scaled}B` : `${sign}${scaled}B ${currency}`;
  }

  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'CLP' ? `${sign}$${scaled}MM` : `${sign}${scaled}MM ${currency}`;
  }

  if (abs >= 1_000) {
    const scaled = (abs / 1_000).toLocaleString('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return currency === 'CLP' ? `${sign}$${scaled}K` : `${sign}${scaled}K ${currency}`;
  }

  return formatCurrency(value, currency);
};

const sumNumbers = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

const monthYear = (monthKey: string) => Number(monthKey.slice(0, 4));

const xLabelFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-');
  return `${month}/${year.slice(2)}`;
};

const computeMonthlyRows = (closures: WealthMonthlyClosure[]): MonthlyReturnRow[] => {
  const sorted = [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const calendarCurrent = currentMonthKey();
  const filtered = sorted.filter((closure) => closure.monthKey !== calendarCurrent);
  const rows: MonthlyReturnRow[] = [];
  let previousValidNet: number | null = null;

  for (const closure of filtered) {
    const fxRaw = safeFxRaw(closure.fxRates);
    const fx = fxRaw;
    const netClp = summaryNetClp(closure);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const prevNetClp = invalidNet ? null : previousValidNet;
    const varPatrimonioClp =
      invalidNet || prevNetClp === null || netClp === null ? null : netClp - prevNetClp;
    // [PRODUCT RULE] Cruce directo por month_key; no hay desfase entre Aurum y Gastapp.
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey]) ? Number(GASTAPP_TOTALS[closure.monthKey]) : null;
    const gastosClp = invalidNet || gastosEur === null ? null : gastosEur * fx.eurClp;

    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const pct =
      retornoRealClp === null || prevNetClp === null || prevNetClp === 0
        ? null
        : (retornoRealClp / prevNetClp) * 100;

    if (invalidNet) {
      console.warn('[Analysis][invalid-net]', {
        monthKey: closure.monthKey,
        netClp: closure.summary?.netClp ?? null,
        netConsolidatedClp: closure.summary?.netConsolidatedClp ?? null,
      });
    } else {
      previousValidNet = Number(netClp);
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
      pct,
    });
  }
  return rows;
};

const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  currency: WealthCurrency,
  baseNetClp: number | null,
): AggregatedSummary => {
  // [PRODUCT RULE] N para promedio mensual = meses con retornoReal válido.
  const validRows = rows.filter(
    (row) =>
      row.varPatrimonioClp !== null &&
      row.gastosClp !== null &&
      row.retornoRealClp !== null,
  ) as Array<
    MonthlyReturnRow & {
      varPatrimonioClp: number;
      gastosClp: number;
      retornoRealClp: number;
    }
  >;

  const validMonths = validRows.length;
  const varPatrimonioAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.varPatrimonioClp)) : null;
  const gastosAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.gastosClp)) : null;
  const retornoRealAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.retornoRealClp)) : null;
  let pctRetorno: number | null = null;
  let pctRetornoNote: string | null = null;
  if (validMonths > 0 && retornoRealAcumClp !== null && baseNetClp !== null && baseNetClp > 0) {
    const periodReturn = retornoRealAcumClp / baseNetClp;
    const growthBase = 1 + periodReturn;
    if (growthBase <= 0) {
      pctRetorno = null;
      pctRetornoNote = 'período negativo';
      console.warn('[Analysis][pct-anual-equiv-negativo]', { key, label, validMonths, periodReturn, baseNetClp });
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
          baseNetClp,
          retornoRealAcumClp,
        });
      } else {
        pctRetorno = annualized;
      }
    }
  }
  const spendPct =
    retornoRealAcumClp === null || retornoRealAcumClp === 0 || gastosAcumClp === null
      ? null
      : (gastosAcumClp / retornoRealAcumClp) * 100;

  const varPatrimonioAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.varPatrimonioClp, currency, row.fx)),
      ) / validMonths
    : null;
  const gastosAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.gastosClp, currency, row.fx)),
      ) / validMonths
    : null;
  const retornoRealAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.retornoRealClp, currency, row.fx)),
      ) / validMonths
    : null;

  return {
    key,
    label,
    validMonths,
    varPatrimonioAcumClp,
    gastosAcumClp,
    retornoRealAcumClp,
    pctRetorno,
    pctRetornoNote,
    spendPct,
    varPatrimonioAvgDisplay,
    gastosAvgDisplay,
    retornoRealAvgDisplay,
  };
};

const SummaryTable: React.FC<{
  title: string;
  items: AggregatedSummary[];
  currency: WealthCurrency;
}> = ({ title, items, currency }) => (
  <Card className="p-3 border-slate-200">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
    <div className="mt-0.5 text-[11px] text-slate-500">Promedio mensual</div>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[600px] text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-2">Tramo</th>
            <th className="py-1 pr-2 text-right">% anual equiv.</th>
            <th className="py-1 pr-2 text-right">Ret.Real</th>
            <th className="py-1 pr-2 text-right">Var.Pat</th>
            <th className="py-1 text-right">Gastos</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const positive = (item.retornoRealAvgDisplay || 0) >= 0;
            return (
              <tr key={item.key} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 font-medium text-slate-700">
                  <div>{item.label}</div>
                  <div className="text-[10px] text-slate-500">N={item.validMonths}</div>
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatPct(item.pctRetorno)}
                  {item.pctRetorno === null && item.pctRetornoNote ? (
                    <div className="text-[10px] font-normal text-amber-700">{item.pctRetornoNote}</div>
                  ) : null}
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  {item.retornoRealAvgDisplay === null ? '—' : formatCurrency(item.retornoRealAvgDisplay, currency)}
                </td>
                <td className="py-1.5 pr-2 text-right text-slate-700">
                  {item.varPatrimonioAvgDisplay === null ? '—' : formatCurrency(item.varPatrimonioAvgDisplay, currency)}
                </td>
                <td className="py-1.5 text-right text-slate-700">
                  {item.gastosAvgDisplay === null ? '—' : formatCurrency(item.gastosAvgDisplay, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </Card>
);

const ReturnRealHero: React.FC<{
  sinceStart: AggregatedSummary | null;
  last12: AggregatedSummary | null;
  lastMonth: AggregatedSummary | null;
  lastMonthPctMonthly: number | null;
  currency: WealthCurrency;
}> = ({ sinceStart, last12, lastMonth, lastMonthPctMonthly, currency }) => {
  const rows = [
    { key: 'inicio', label: 'DESDE INICIO', value: sinceStart, pct: sinceStart?.pctRetorno ?? null },
    { key: '12m', label: 'ÚLT. 12M', value: last12, pct: last12?.pctRetorno ?? null },
    { key: 'mes', label: 'ÚLT. MES', value: lastMonth, pct: lastMonthPctMonthly },
  ] as const;
  const spentClass = (value: AggregatedSummary | null | undefined) => {
    if (value?.spendPct === null || value?.spendPct === undefined) return 'text-slate-200';
    return value.spendPct > 100 ? 'text-rose-300' : 'text-emerald-300';
  };
  const pctClass = (pctValue: number | null) => (pctValue === null || pctValue >= 0 ? 'text-emerald-300' : 'text-rose-300');
  const retornoClass = (value: AggregatedSummary | null | undefined) =>
    (value?.retornoRealAvgDisplay || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300';

  return (
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#08152f] via-[#0d2146] to-[#0a1730] p-4 text-slate-100 shadow-[0_16px_40px_rgba(4,16,40,0.28)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(110,231,183,0.14),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(96,165,250,0.12),_transparent_38%)]" />
      <div className="relative">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Retorno real</div>
        <div className="mt-1 text-[11px] text-slate-400">Lo que generó tu patrimonio, incluyendo lo que gastaste</div>
      </div>
      <div className="relative mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[2px]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {row.label}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {row.key === 'mes' ? 'Comparación mensual' : 'Tasa anual equivalente'}
                </div>
              </div>
              <div className="min-w-0 text-right">
                <div className={cn('text-[22px] font-semibold leading-none tracking-tight', pctClass(row.pct))}>
                  {formatPct(row.pct, 1)}
                </div>
                {row.pct === null && row.value?.pctRetornoNote ? (
                  <div className="mt-0.5 text-[10px] font-medium text-amber-300">{row.value.pctRetornoNote}</div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Prom. mensual</div>
                <div
                  className={cn('mt-0.5 truncate text-[15px] font-semibold leading-tight', retornoClass(row.value))}
                  title={
                    row.value?.retornoRealAvgDisplay === null || row.value?.retornoRealAvgDisplay === undefined
                      ? '—'
                      : formatCurrency(row.value.retornoRealAvgDisplay, currency)
                  }
                >
                  {row.value?.retornoRealAvgDisplay === null || row.value?.retornoRealAvgDisplay === undefined
                    ? '—'
                    : formatCompactCurrency(row.value.retornoRealAvgDisplay, currency)}
                </div>
              </div>
              <div
                className="rounded-xl bg-white/[0.04] px-2.5 py-1.5 text-right"
                title={
                  row.value?.spendPct === null || row.value?.spendPct === undefined
                    ? '—'
                    : `${row.value.spendPct.toFixed(1).replace('.', ',')}% del retorno se gasta`
                }
              >
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Gastado</div>
                <div className={cn('mt-0.5 text-[15px] font-semibold leading-tight', spentClass(row.value))}>
                  {row.value?.spendPct === null || row.value?.spendPct === undefined
                    ? '—'
                    : `${row.value.spendPct.toFixed(1).replace('.', ',')}%`}
                </div>
                <div className="text-[9px] text-slate-400">del retorno</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const ReturnsChart: React.FC<{ rows: MonthlyReturnRow[] }> = ({ rows }) => {
  const data = useMemo(
    () =>
      rows
        .filter((row) => row.pct !== null)
        .map((row) => ({ monthKey: row.monthKey, pct: Number(row.pct) })),
    [rows],
  );

  if (data.length < 2) {
    return (
      <Card className="p-3 border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Curva de retorno mensual (%)</div>
        <div className="mt-3 text-xs text-slate-500">Aún no hay suficientes cierres para dibujar la curva.</div>
      </Card>
    );
  }

  const width = 640;
  const height = 160;
  const padding = { top: 12, right: 14, bottom: 22, left: 14 };
  const minRaw = Math.min(...data.map((point) => point.pct));
  const maxRaw = Math.max(...data.map((point) => point.pct));
  const range = Math.max(0.5, maxRaw - minRaw);
  const min = minRaw - range * 0.12;
  const max = maxRaw + range * 0.12;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const average = sumNumbers(data.map((point) => point.pct)) / data.length;

  const pointX = (index: number) =>
    padding.left + (data.length === 1 ? innerWidth / 2 : (innerWidth * index) / (data.length - 1));
  const pointY = (value: number) => padding.top + ((max - value) / Math.max(1e-6, max - min)) * innerHeight;
  const path = data
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index).toFixed(2)} ${pointY(point.pct).toFixed(2)}`)
    .join(' ');
  const avgY = pointY(average);

  return (
    <Card className="p-3 border-slate-200">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <LineChart size={14} />
        Curva de retorno mensual (%)
      </div>
      <div className="mt-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
          <line
            x1={padding.left}
            y1={avgY}
            x2={width - padding.right}
            y2={avgY}
            stroke="#64748b"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <path d={path} fill="none" stroke="#0f766e" strokeWidth="2" />
          {data.map((point, index) => {
            const x = pointX(index);
            const y = pointY(point.pct);
            const showLabel = index % 6 === 0 || index === data.length - 1;
            return (
              <g key={point.monthKey}>
                <circle cx={x} cy={y} r="3" fill={point.pct >= 0 ? '#059669' : '#dc2626'} />
                {showLabel && (
                  <text x={x} y={height - 6} textAnchor="middle" fontSize="9" fill="#64748b">
                    {xLabelFromMonthKey(point.monthKey)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Línea punteada: promedio {average.toFixed(2).replace('.', ',')}%
      </div>
    </Card>
  );
};

export const AnalysisAurum: React.FC = () => {
  const [tab, setTab] = useState<AnalysisTab>('returns');
  const [currency, setCurrency] = useState<WealthCurrency>('CLP');
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() =>
    loadWealthClosures().sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
  );
  const [errorMessage, setErrorMessage] = useState('');
  const closuresCountRef = useRef(closures.length);

  const refreshClosures = useCallback((reason: string) => {
    const beforeCount = closuresCountRef.current;
    console.info('[Analysis][closures-before]', { reason, beforeCount });
    const loaded = loadWealthClosures().sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    console.info('[Analysis][closures-after]', {
      reason,
      afterCount: loaded.length,
      newestMonth: loaded.length ? loaded[loaded.length - 1].monthKey : null,
      oldestMonth: loaded.length ? loaded[0].monthKey : null,
    });
    closuresCountRef.current = loaded.length;
    setClosures(loaded);
    setErrorMessage('');
  }, []);

  useEffect(() => {
    refreshClosures('mount');
  }, [refreshClosures]);

  useEffect(() => {
    const onWealthUpdated = () => refreshClosures('wealth-updated');
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      refreshClosures('focus');
    };
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshClosures]);

  const monthlyRowsAsc = useMemo(() => computeMonthlyRows(closures), [closures]);
  const monthlyRowsDesc = useMemo(
    () => [...monthlyRowsAsc].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [monthlyRowsAsc],
  );

  const analysisDiagnostics = useMemo(() => {
    const eurScaleOutliers = monthlyRowsAsc.filter((row) => row.rawEurClp > 10000);
    const invalidNetMonths = monthlyRowsAsc.filter((row) => row.invalidNet).map((row) => row.monthKey);
    const anomalyRaw = [...monthlyRowsAsc]
      .filter((row) => row.pct !== null)
      .sort((a, b) => Math.abs(Number(b.pct)) - Math.abs(Number(a.pct)))[0] || null;
    const march2025 = monthlyRowsAsc.find((row) => row.monthKey === '2025-03') || null;
    return { eurScaleOutliers, invalidNetMonths, anomalyRaw, march2025 };
  }, [monthlyRowsAsc]);

  useEffect(() => {
    const anomaly = analysisDiagnostics.anomalyRaw;
    const march2025 = analysisDiagnostics.march2025;
    console.info('[Analysis][eur-scale-before]', {
      march2025: march2025
        ? {
            rawEurClp: march2025.rawEurClp,
            gastosEur: GASTAPP_TOTALS['2025-03'] ?? null,
            gastosClp: march2025.gastosClp,
            expectedGastosClp:
              Number.isFinite(GASTAPP_TOTALS['2025-03']) && Number.isFinite(march2025.rawEurClp)
                ? Number(GASTAPP_TOTALS['2025-03']) * Number(march2025.rawEurClp)
                : null,
          }
        : null,
      monthsWithRawEurOutlier: analysisDiagnostics.eurScaleOutliers.map((row) => ({
        monthKey: row.monthKey,
        rawEurClp: row.rawEurClp,
      })),
      anomalyMonth: anomaly?.monthKey || null,
      anomalyValues: anomaly
        ? {
            varPatrimonioClp: anomaly.varPatrimonioClp,
            gastosClp: anomaly.gastosClp,
            retornoRealClp: anomaly.retornoRealClp,
            pct: anomaly.pct,
          }
        : null,
    });
    console.info('[Analysis][eur-scale-after]', { normalizationApplied: false });

    if (analysisDiagnostics.invalidNetMonths.length > 0) {
      setErrorMessage(
        `Hay cierres con netClp inválido en: ${analysisDiagnostics.invalidNetMonths.join(', ')}. Se muestran con "—" y no entran en resúmenes.`,
      );
      return;
    }

    if (analysisDiagnostics.eurScaleOutliers.length > 0) {
      setErrorMessage(
        `Detecté EUR/CLP fuera de escala en: ${analysisDiagnostics.eurScaleOutliers
          .map((row) => row.monthKey)
          .join(', ')}. Corrige esos cierres en origen.`,
      );
      return;
    }

    const suspectPost = monthlyRowsAsc.find(
      (row) => row.gastosClp !== null && Math.abs(row.gastosClp) > 100_000_000,
    );
    if (suspectPost) {
      setErrorMessage(
        `Detecté gastos fuera de rango en ${suspectPost.monthKey}. Revisa el EUR/CLP guardado en ese cierre.`,
      );
      return;
    }

    setErrorMessage('');
  }, [analysisDiagnostics, monthlyRowsAsc]);

  const periodSummaries = useMemo(() => {
    const monthKeysAsc = monthlyRowsAsc.map((row) => row.monthKey);
    const toSummary = (count: number, label: string) => {
      const keys = monthKeysAsc.slice(Math.max(0, monthKeysAsc.length - count));
      if (!keys.length) return null;
      const rows = monthlyRowsAsc.filter((row) => keys.includes(row.monthKey));
      const baseNetClp = rows.find((row) => row.netClp !== null)?.netClp ?? null;
      return aggregateRows(`period-${label}`, label, rows, currency, baseNetClp);
    };

    const summaries: AggregatedSummary[] = [];
    const p12 = toSummary(12, '12M');
    if (p12) summaries.push(p12);
    const p24 = toSummary(24, '24M');
    if (p24) summaries.push(p24);
    if (monthKeysAsc.length >= 36) {
      const p36 = toSummary(36, '36M');
      if (p36) summaries.push(p36);
    }
    if (monthKeysAsc.length) {
      const baseNetClp = monthlyRowsAsc.find((row) => row.netClp !== null)?.netClp ?? null;
      summaries.push(aggregateRows('period-inicio', 'Desde inicio', monthlyRowsAsc, currency, baseNetClp));
    }
    return summaries;
  }, [monthlyRowsAsc, currency]);

  const yearlySummaries = useMemo(() => {
    const years = Array.from(new Set(monthlyRowsAsc.map((row) => monthYear(row.monthKey)))).sort((a, b) => a - b);
    return years.map((year) => {
      const rows = monthlyRowsAsc.filter((row) => monthYear(row.monthKey) === year);
      const previousYearBase = monthlyRowsAsc
        .filter((row) => row.monthKey < `${year}-01`)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      const previousYearBaseValid = previousYearBase.filter((row) => row.netClp !== null);
      const baseNetClp = previousYearBaseValid.length
        ? previousYearBaseValid[previousYearBaseValid.length - 1].netClp
        : null;
      return aggregateRows(`year-${year}`, String(year), rows, currency, baseNetClp);
    });
  }, [monthlyRowsAsc, currency]);

  const heroSinceStart = useMemo(() => {
    if (!monthlyRowsAsc.length) return null;
    const baseNetClp = monthlyRowsAsc.find((row) => row.netClp !== null)?.netClp ?? null;
    return aggregateRows('hero-inicio', 'Desde inicio', monthlyRowsAsc, currency, baseNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLast12 = useMemo(() => {
    const rows = monthlyRowsAsc.slice(Math.max(0, monthlyRowsAsc.length - 12));
    if (!rows.length) return null;
    const baseNetClp = rows.find((row) => row.netClp !== null)?.netClp ?? null;
    return aggregateRows('hero-12m', 'Últ. 12M', rows, currency, baseNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLastMonth = useMemo(() => {
    const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealClp !== null) || null;
    if (!row) return null;
    return aggregateRows('hero-ultimo', 'Últ. mes', [row], currency, row.prevNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLastMonthPctMonthly = useMemo(() => {
    const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealClp !== null) || null;
    return row?.pct ?? null;
  }, [monthlyRowsAsc]);

  return (
    <div className="space-y-3 p-3">
      <Card className="sticky top-[68px] z-20 border-slate-200 bg-white/95 p-2 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant={tab === 'returns' ? 'primary' : 'secondary'} onClick={() => setTab('returns')}>
            Retornos
          </Button>
          <Button size="sm" variant={tab === 'freedom' ? 'primary' : 'secondary'} onClick={() => setTab('freedom')}>
            Libertad Financiera
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-1">
          {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCurrency(item)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
                currency === item
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-600',
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </Card>

      {tab === 'freedom' ? (
        <Card className="p-5 text-center border-slate-200">
          <div className="text-sm font-semibold text-slate-800">Libertad Financiera</div>
          <div className="mt-2 text-xs text-slate-500">Próximamente.</div>
        </Card>
      ) : (
        <>
          <ReturnRealHero
            sinceStart={heroSinceStart}
            last12={heroLast12}
            lastMonth={heroLastMonth}
            lastMonthPctMonthly={heroLastMonthPctMonthly}
            currency={currency}
          />

          {analysisDiagnostics.anomalyRaw && Math.abs(Number(analysisDiagnostics.anomalyRaw.pct || 0)) >= 200 && (
            <Card className="border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Diagnóstico previo: mes anómalo detectado en {analysisDiagnostics.anomalyRaw.monthKey} 
              {` · Var.Pat ${analysisDiagnostics.anomalyRaw.varPatrimonioClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.varPatrimonioClp, 'CLP')}`}
              {` · Gastos ${analysisDiagnostics.anomalyRaw.gastosClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.gastosClp, 'CLP')}`}
              {` · Ret.Real ${analysisDiagnostics.anomalyRaw.retornoRealClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.retornoRealClp, 'CLP')}`}
              {` · % ${formatPct(analysisDiagnostics.anomalyRaw.pct)}`}
            </Card>
          )}

          <Card className="border-slate-200 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays size={14} />
              Historial completo
            </div>
            <div className="mt-2 max-h-[55vh] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-2">Mes</th>
                    <th className="py-1 pr-2 text-right">%</th>
                    <th className="py-1 pr-2 text-right">Ret.Real</th>
                    <th className="py-1 pr-2 text-right">Var.Pat</th>
                    <th className="py-1 text-right">Gastos</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRowsDesc.map((row) => {
                    const varDisplay =
                      row.varPatrimonioClp === null ? null : convertFromClp(row.varPatrimonioClp, currency, row.fx);
                    const gastosDisplay =
                      row.gastosClp === null ? null : convertFromClp(row.gastosClp, currency, row.fx);
                    const retornoDisplay =
                      row.retornoRealClp === null ? null : convertFromClp(row.retornoRealClp, currency, row.fx);
                    const positive = (retornoDisplay || 0) >= 0;
                    return (
                      <tr key={row.monthKey} className="border-t border-slate-100">
                        <td className="py-1.5 pr-2 font-medium text-slate-700">{monthLabel(row.monthKey)}</td>
                        <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                          {formatPct(row.pct)}
                        </td>
                        <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                          {retornoDisplay === null ? '—' : formatCurrency(retornoDisplay, currency)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-700">
                          {varDisplay === null ? '—' : formatCurrency(varDisplay, currency)}
                        </td>
                        <td className="py-1.5 text-right text-slate-700">
                          {gastosDisplay === null ? '—' : formatCurrency(gastosDisplay, currency)}
                        </td>
                      </tr>
                    );
                  })}
                  {!monthlyRowsDesc.length && (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-xs text-slate-500">
                        Aún no hay cierres suficientes para calcular retornos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <SummaryTable title="Resúmenes por período" items={periodSummaries} currency={currency} />
          <SummaryTable title="Resúmenes por año" items={yearlySummaries} currency={currency} />
          <ReturnsChart rows={monthlyRowsAsc} />
        </>
      )}

      {!!errorMessage && (
        <Card className="border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{errorMessage}</Card>
      )}

      <Card className="border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <BarChart3 size={14} />
          Datos en solo lectura: los cálculos de Análisis no modifican cierres ni registros persistidos.
        </div>
      </Card>
    </div>
  );
};
