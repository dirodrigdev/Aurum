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
  netClp: number;
  prevNetClp: number | null;
  varPatrimonioClp: number | null;
  gastosClp: number | null;
  retornoRealClp: number | null;
  pct: number | null;
};

type AggregatedSummary = {
  key: string;
  label: string;
  varPatrimonioClp: number | null;
  gastosClp: number | null;
  retornoRealClp: number | null;
  pct: number | null;
  varPatrimonioDisplay: number | null;
  gastosDisplay: number | null;
  retornoRealDisplay: number | null;
};

const loadWealthClosures = () => loadClosures();

const safeFx = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: Number.isFinite(fx?.usdClp) && Number(fx?.usdClp) > 0 ? Number(fx?.usdClp) : defaultFxRates.usdClp,
  eurClp: Number.isFinite(fx?.eurClp) && Number(fx?.eurClp) > 0 ? Number(fx?.eurClp) : defaultFxRates.eurClp,
  ufClp: Number.isFinite(fx?.ufClp) && Number(fx?.ufClp) > 0 ? Number(fx?.ufClp) : defaultFxRates.ufClp,
});

const summaryNetClp = (closure: WealthMonthlyClosure) => {
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return 0;
};

const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

const formatPct = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2).replace('.', ',')}%`;
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

  return filtered.map((closure, index) => {
    const prev = index > 0 ? filtered[index - 1] : null;
    const fx = safeFx(closure.fxRates);
    const netClp = summaryNetClp(closure);
    const prevNetClp = prev ? summaryNetClp(prev) : null;
    const varPatrimonioClp = prevNetClp === null ? null : netClp - prevNetClp;
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey]) ? Number(GASTAPP_TOTALS[closure.monthKey]) : null;
    const gastosClp = gastosEur === null ? null : gastosEur * fx.eurClp;
    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const pct =
      retornoRealClp === null || prevNetClp === null || prevNetClp === 0
        ? null
        : (retornoRealClp / prevNetClp) * 100;
    return {
      monthKey: closure.monthKey,
      fx,
      netClp,
      prevNetClp,
      varPatrimonioClp,
      gastosClp,
      retornoRealClp,
      pct,
    };
  });
};

const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  currency: WealthCurrency,
  baseNetClp: number | null,
): AggregatedSummary => {
  const varRows = rows.filter((row) => row.varPatrimonioClp !== null) as Array<MonthlyReturnRow & { varPatrimonioClp: number }>;
  const gastoRows = rows.filter((row) => row.gastosClp !== null) as Array<MonthlyReturnRow & { gastosClp: number }>;
  const retornoRows = rows.filter((row) => row.retornoRealClp !== null) as Array<MonthlyReturnRow & { retornoRealClp: number }>;

  const varPatrimonioClp = varRows.length ? sumNumbers(varRows.map((row) => row.varPatrimonioClp)) : null;
  const gastosClp = gastoRows.length ? sumNumbers(gastoRows.map((row) => row.gastosClp)) : null;
  const retornoRealClp =
    varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
  const pct =
    retornoRealClp === null || baseNetClp === null || baseNetClp <= 0
      ? null
      : (retornoRealClp / baseNetClp) * 100;

  const varPatrimonioDisplay = varRows.length
    ? sumNumbers(varRows.map((row) => convertFromClp(row.varPatrimonioClp, currency, row.fx)))
    : null;
  const gastosDisplay = gastoRows.length
    ? sumNumbers(gastoRows.map((row) => convertFromClp(row.gastosClp, currency, row.fx)))
    : null;
  const retornoRealDisplay = retornoRows.length
    ? sumNumbers(retornoRows.map((row) => convertFromClp(row.retornoRealClp, currency, row.fx)))
    : null;

  return {
    key,
    label,
    varPatrimonioClp,
    gastosClp,
    retornoRealClp,
    pct,
    varPatrimonioDisplay,
    gastosDisplay,
    retornoRealDisplay,
  };
};

const SummaryTable: React.FC<{
  title: string;
  items: AggregatedSummary[];
  currency: WealthCurrency;
}> = ({ title, items, currency }) => (
  <Card className="p-3 border-slate-200">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-2">Tramo</th>
            <th className="py-1 pr-2 text-right">Var.Pat</th>
            <th className="py-1 pr-2 text-right">Gastos</th>
            <th className="py-1 pr-2 text-right">Ret.Real</th>
            <th className="py-1 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const positive = (item.retornoRealDisplay || 0) >= 0;
            return (
              <tr key={item.key} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 font-medium text-slate-700">{item.label}</td>
                <td className="py-1.5 pr-2 text-right text-slate-700">
                  {item.varPatrimonioDisplay === null ? '—' : formatCurrency(item.varPatrimonioDisplay, currency)}
                </td>
                <td className="py-1.5 pr-2 text-right text-slate-700">
                  {item.gastosDisplay === null ? '—' : formatCurrency(item.gastosDisplay, currency)}
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  {item.retornoRealDisplay === null ? '—' : formatCurrency(item.retornoRealDisplay, currency)}
                </td>
                <td className={cn('py-1.5 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatPct(item.pct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </Card>
);

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
  const monthlyRowsDesc = useMemo(() => [...monthlyRowsAsc].sort((a, b) => b.monthKey.localeCompare(a.monthKey)), [monthlyRowsAsc]);

  const periodSummaries = useMemo(() => {
    const monthKeysAsc = monthlyRowsAsc.map((row) => row.monthKey);
    const toSummary = (count: number, label: string) => {
      const keys = monthKeysAsc.slice(Math.max(0, monthKeysAsc.length - count));
      if (!keys.length) return null;
      const rows = monthlyRowsAsc.filter((row) => keys.includes(row.monthKey));
      const baseNetClp = rows.length ? rows[0].netClp : null;
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
      const baseNetClp = monthlyRowsAsc[0].netClp;
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
      const baseNetClp = previousYearBase.length
        ? previousYearBase[previousYearBase.length - 1].netClp
        : null;
      return aggregateRows(`year-${year}`, String(year), rows, currency, baseNetClp);
    });
  }, [monthlyRowsAsc, currency]);

  return (
    <div className="space-y-3 p-3">
      <Card className="sticky top-[68px] z-20 border-slate-200 bg-white/95 p-2 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={tab === 'returns' ? 'primary' : 'secondary'}
            onClick={() => setTab('returns')}
          >
            Retornos
          </Button>
          <Button
            size="sm"
            variant={tab === 'freedom' ? 'primary' : 'secondary'}
            onClick={() => setTab('freedom')}
          >
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
                    <th className="py-1 pr-2 text-right">Var.Pat</th>
                    <th className="py-1 pr-2 text-right">Gastos</th>
                    <th className="py-1 pr-2 text-right">Ret.Real</th>
                    <th className="py-1 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRowsDesc.map((row) => {
                    const varDisplay =
                      row.varPatrimonioClp === null
                        ? null
                        : convertFromClp(row.varPatrimonioClp, currency, row.fx);
                    const gastosDisplay =
                      row.gastosClp === null ? null : convertFromClp(row.gastosClp, currency, row.fx);
                    const retornoDisplay =
                      row.retornoRealClp === null
                        ? null
                        : convertFromClp(row.retornoRealClp, currency, row.fx);
                    const positive = (retornoDisplay || 0) >= 0;
                    return (
                      <tr key={row.monthKey} className="border-t border-slate-100">
                        <td className="py-1.5 pr-2 font-medium text-slate-700">{monthLabel(row.monthKey)}</td>
                        <td className="py-1.5 pr-2 text-right text-slate-700">
                          {varDisplay === null ? '—' : formatCurrency(varDisplay, currency)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-700">
                          {gastosDisplay === null ? '—' : formatCurrency(gastosDisplay, currency)}
                        </td>
                        <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                          {retornoDisplay === null ? '—' : formatCurrency(retornoDisplay, currency)}
                        </td>
                        <td className={cn('py-1.5 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                          {formatPct(row.pct)}
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
          Datos en solo lectura: los cálculos de Análisis no modifican cierres ni registros.
        </div>
      </Card>
    </div>
  );
};

