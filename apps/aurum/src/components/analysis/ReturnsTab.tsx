import React from 'react';
import { CalendarDays, LineChart, Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import type { WealthCurrency } from '../../services/wealthStorage';
import { formatCurrency, formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import type {
  AggregatedSummary,
  CrpContributionInsight,
  MonthlyReturnRow,
  ReturnCurveMarker,
  ReturnCurveModel,
} from './types';
import { buildReturnSpendInsight, formatCompactCurrency, formatPct, xLabelFromMonthKey } from './shared';

const MONTH_SHORT_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;

const monthLabelShort = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return monthKey;
  return `${MONTH_SHORT_ES[month - 1]} ${year}`;
};

type ReturnsTabProps = {
  heroSinceStart: AggregatedSummary | null;
  heroLast12: AggregatedSummary | null;
  heroYtd2026: AggregatedSummary | null;
  heroLastMonth: AggregatedSummary | null;
  heroLastMonthPctMonthly: number | null;
  currency: WealthCurrency;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  crpContributionInsight: CrpContributionInsight | null;
  analysisDiagnostics: {
    anomalyRaw: MonthlyReturnRow | null;
  };
  fxExcludedMonths: string[];
  monthlyRowsAsc: MonthlyReturnRow[];
  monthlyRowsDesc: MonthlyReturnRow[];
  periodSummaries: AggregatedSummary[];
  yearlySummaries: AggregatedSummary[];
  trajectoryCurve: ReturnCurveModel;
  patrimonyCurve: ReturnCurveModel;
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
      <table className="w-full min-w-[600px] table-fixed text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-2">Tramo</th>
            <th className="py-1 pr-2 text-right">% anual equiv.</th>
            <th className="py-1 pr-2 text-right">Ret.Econ.</th>
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
                  <div className="truncate">{item.label}</div>
                  <div className="text-[10px] text-slate-500">N={item.validMonths}</div>
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  <div className="truncate max-w-[90px]">{formatPct(item.pctRetorno)}</div>
                  {item.pctRetorno === null && item.pctRetornoNote ? (
                    <div className="text-[10px] font-normal text-amber-700">{item.pctRetornoNote}</div>
                  ) : null}
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  <div className="truncate max-w-[130px]">
                    {item.retornoRealAvgDisplay === null ? '—' : formatCurrency(item.retornoRealAvgDisplay, currency)}
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-right text-slate-700">
                  <div className="truncate max-w-[110px]">
                    {item.varPatrimonioAvgDisplay === null ? '—' : formatCurrency(item.varPatrimonioAvgDisplay, currency)}
                  </div>
                </td>
                <td className="py-1.5 text-right text-slate-700">
                  <div className="truncate max-w-[110px]">
                    {item.gastosAvgDisplay === null ? '—' : formatCurrency(item.gastosAvgDisplay, currency)}
                  </div>
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
  ytd2026: AggregatedSummary | null;
  lastMonth: AggregatedSummary | null;
  lastMonthPctMonthly: number | null;
  currency: WealthCurrency;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  crpContributionInsight: CrpContributionInsight | null;
}> = ({
  sinceStart,
  last12,
  ytd2026,
  lastMonth,
  lastMonthPctMonthly,
  currency,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  crpContributionInsight,
}) => {
  const rows = [
    { key: 'inicio', label: 'DESDE INICIO', value: sinceStart, pct: sinceStart?.pctRetorno ?? null },
    { key: '12m', label: 'ÚLT. 12M', value: last12, pct: last12?.pctRetorno ?? null },
    { key: 'ytd', label: 'YTD 2026', value: ytd2026, pct: ytd2026?.pctRetorno ?? null },
    { key: 'mes', label: 'ÚLT. MES VÁLIDO', value: lastMonth, pct: lastMonthPctMonthly },
  ] as const;
  const spendClass = (value: AggregatedSummary | null | undefined) => {
    const insight = buildReturnSpendInsight(value);
    if (insight.tone === 'positive') return 'text-emerald-300';
    if (insight.tone === 'warning') return 'text-amber-200';
    if (insight.tone === 'negative') return 'text-rose-300';
    return 'text-slate-200';
  };
  const pctClass = (pctValue: number | null) => (pctValue === null || pctValue >= 0 ? 'text-emerald-300' : 'text-rose-300');
  const retornoClass = (value: AggregatedSummary | null | undefined) =>
    (value?.retornoRealAvgDisplay || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300';

  return (
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#08152f] via-[#0d2146] to-[#0a1730] p-3.5 text-slate-100 shadow-[0_16px_40px_rgba(4,16,40,0.28)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(110,231,183,0.14),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(96,165,250,0.12),_transparent_38%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Retorno económico</div>
            <div className="mt-1 text-[11px] text-slate-400">Lectura oficial del período, incluyendo lo que gastaste</div>
            <div className="mt-1 text-[9px] text-slate-500/70">Gastos desde GastApp (P → mes equivalente)</div>
            {includeRiskCapitalInTotals && crpContributionInsight && (
              <div
                className={cn(
                  'mt-2 inline-flex flex-col rounded-xl border px-2.5 py-2 text-left',
                  crpContributionInsight.tone === 'positive'
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                    : crpContributionInsight.tone === 'negative'
                      ? 'border-rose-400/25 bg-rose-400/10 text-rose-200'
                      : 'border-slate-400/25 bg-white/5 text-slate-200',
                )}
              >
                <span className="text-[11px] font-medium">{crpContributionInsight.summaryText}</span>
                {crpContributionInsight.detailText ? (
                  <span className="mt-0.5 text-[10px] text-slate-300">{crpContributionInsight.detailText}</span>
                ) : null}
                {crpContributionInsight.totalText ? (
                  <span className="mt-0.5 text-[10px] text-slate-400">{crpContributionInsight.totalText}</span>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleRiskMode}
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition',
              includeRiskCapitalInTotals
                ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-slate-500/50 bg-white/5 text-slate-300',
            )}
            title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
            aria-label="Alternar capital de riesgo"
          >
            <Zap size={16} />
          </button>
        </div>
      </div>
      <div className="relative mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {rows.map((row) => {
          const spendInsight = buildReturnSpendInsight(row.value);

          return (
            <div
              key={row.key}
              className="rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[2px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {row.label}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {row.key === 'mes'
                      ? 'Comparación mensual válida'
                      : row.key === 'ytd'
                        ? 'Desde enero · Tasa anual equivalente'
                        : 'Tasa anual equivalente'}
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
              <div className="mt-1.5 grid grid-cols-2 gap-2">
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
                  title={spendInsight.titleText}
                >
                  <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Gastado</div>
                  <div className={cn('mt-0.5 text-[15px] font-semibold leading-tight', spendClass(row.value))}>
                    {spendInsight.primaryText}
                  </div>
                  {spendInsight.secondaryText ? (
                    <div className="text-[9px] text-slate-400">{spendInsight.secondaryText}</div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

const ReturnsChart: React.FC<{ rows: MonthlyReturnRow[] }> = ({ rows }) => {
  const data = React.useMemo(
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
  const average = data.reduce((sum, point) => sum + point.pct, 0) / data.length;

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

const markerToneClass = (marker: ReturnCurveMarker) => {
  if (marker.kinds.includes('max')) return 'border-emerald-300/40 bg-emerald-300/12 text-emerald-800';
  if (marker.kinds.includes('min')) return 'border-rose-300/40 bg-rose-300/12 text-rose-800';
  return 'border-slate-300/60 bg-white/80 text-slate-700';
};

const markerLabel = (marker: ReturnCurveMarker) =>
  marker.kinds
    .map((kind) => {
      if (kind === 'start') return 'Inicio';
      if (kind === 'end') return 'Final';
      if (kind === 'max') return 'Máx';
      return 'Mín';
    })
    .join(' · ');

const TrendLineCard: React.FC<{
  title: string;
  subtitle: string;
  curve: ReturnCurveModel;
  stroke: string;
  currency?: WealthCurrency;
  formatter: (value: number) => string;
}> = ({ title, subtitle, curve, stroke, currency, formatter }) => {
  if (curve.status !== 'ok' || curve.points.length < 2 || curve.domainMin === null || curve.domainMax === null) {
    return (
      <Card className="border-slate-200 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <LineChart size={14} />
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
        <div className="mt-3 text-xs text-slate-500">Aún no hay suficientes cierres para dibujar esta curva.</div>
      </Card>
    );
  }

  const width = 640;
  const height = 170;
  const padding = { top: 16, right: 16, bottom: 28, left: 16 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const pointX = (index: number) =>
    padding.left + (curve.points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (curve.points.length - 1));
  const pointY = (value: number) =>
    padding.top +
    ((curve.domainMax - value) / Math.max(1e-6, curve.domainMax - curve.domainMin)) * innerHeight;
  const path = curve.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index).toFixed(2)} ${pointY(point.value).toFixed(2)}`)
    .join(' ');

  return (
    <Card className="border-slate-200 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <LineChart size={14} />
        {title}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
      <div className="mt-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
          <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
          {curve.points.map((point, index) => {
            const x = pointX(index);
            const y = pointY(point.value);
            const showLabel = index % 6 === 0 || index === curve.points.length - 1;
            return (
              <g key={point.id}>
                <circle cx={x} cy={y} r="3" fill={stroke} />
                {showLabel && (
                  <text x={x} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                    {xLabelFromMonthKey(point.monthKey)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {curve.markers.map((marker) => (
          <div
            key={marker.pointId}
            className={cn(
              'rounded-xl border px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]',
              markerToneClass(marker),
            )}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">{markerLabel(marker)}</div>
            <div className="mt-1 text-base font-semibold tracking-tight">
              {currency ? formatCompactCurrency(marker.value, currency) : formatter(marker.value)}
            </div>
            <div className="mt-0.5 text-[11px] opacity-80">{monthLabel(marker.monthKey)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export const ReturnsTab: React.FC<ReturnsTabProps> = ({
  heroSinceStart,
  heroLast12,
  heroYtd2026,
  heroLastMonth,
  heroLastMonthPctMonthly,
  currency,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  crpContributionInsight,
  analysisDiagnostics,
  fxExcludedMonths,
  monthlyRowsAsc,
  monthlyRowsDesc,
  periodSummaries,
  yearlySummaries,
  trajectoryCurve,
  patrimonyCurve,
}) => {
  const pendingSpendMonths = monthlyRowsAsc.filter((row) => row.gastosStatus === 'pending').map((row) => row.monthKey);
  const missingSpendMonths = monthlyRowsAsc.filter((row) => row.gastosStatus === 'missing').map((row) => row.monthKey);
  const legacySpendMonths = monthlyRowsAsc.filter((row) => row.gastosSource === 'legacy_static').map((row) => row.monthKey);
  const firestoreSpendMonths = monthlyRowsAsc.filter((row) => row.gastosSource === 'gastapp_firestore').map((row) => row.monthKey);
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'done' | 'error'>('idle');

  const historyRows = React.useMemo(
    () =>
      monthlyRowsDesc.map((row) => {
        const retornoDisplay = row.retornoRealDisplay;
        const varDisplay = row.varPatrimonioDisplay;
        const gastosDisplay = row.gastosDisplay;
        return {
          monthKey: row.monthKey,
          month: monthLabelShort(row.monthKey),
          pct: formatPct(row.pct),
          retorno: retornoDisplay === null ? '—' : formatCurrency(retornoDisplay, currency),
          varPat: varDisplay === null ? '—' : formatCurrency(varDisplay, currency),
          gastos:
            row.gastosStatus === 'missing'
              ? 'Faltante'
              : row.gastosStatus === 'pending'
                ? 'Pendiente'
                : gastosDisplay === null
                  ? '—'
                  : formatCurrency(gastosDisplay, currency),
        };
      }),
    [monthlyRowsDesc, currency],
  );

  const copyTable = React.useCallback(async () => {
    const header = ['monthKey', 'Mes', '%', 'Ret.Econ.', 'Var.Pat', 'Gastos'];
    const lines = [
      header.join('\t'),
      ...historyRows.map((row) => [row.monthKey, row.month, row.pct, row.retorno, row.varPat, row.gastos].join('\t')),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyStatus('done');
    } catch {
      setCopyStatus('error');
    }
    window.setTimeout(() => setCopyStatus('idle'), 1600);
  }, [historyRows]);

  const exportCsv = React.useCallback(() => {
    const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const header = ['monthKey', 'Mes', '%', 'Ret.Econ.', 'Var.Pat', 'Gastos'];
    const lines = [
      header.map(escape).join(','),
      ...historyRows.map((row) => [row.monthKey, row.month, row.pct, row.retorno, row.varPat, row.gastos].map(escape).join(',')),
    ];
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retorno-economico-historial-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [historyRows]);

  return (
  <>
    {(legacySpendMonths.length > 0 || firestoreSpendMonths.length > 0) && (
      <Card className={cn(
        'p-3 text-xs',
        legacySpendMonths.length > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      )}>
        <div className="font-semibold">
          {legacySpendMonths.length > 0
            ? 'Gasto observado desde respaldo legacy'
            : 'Gasto observado desde GastApp / Firestore'}
        </div>
        <div className="mt-1">
          {legacySpendMonths.length > 0
            ? 'Este retorno económico usa gasto mensual desde GASTAPP_TOTALS como fallback legacy, no desde periodos actuales sincronizados.'
            : 'Este retorno económico usa gasto mensual observado desde aurum_monthly_from_periods_v1.'}
        </div>
      </Card>
    )}

    {fxExcludedMonths.length > 0 && (
      <Card className="border-amber-200 bg-amber-50/80 p-2.5 text-[11px] text-amber-700">
        {fxExcludedMonths.length === 1
          ? `1 mes excluido de agregados cerrados por FX no auditable: ${fxExcludedMonths[0]}.`
          : `${fxExcludedMonths.length} meses excluidos de agregados cerrados por FX no auditable: ${fxExcludedMonths.join(', ')}.`}
      </Card>
    )}

    <ReturnRealHero
      sinceStart={heroSinceStart}
      last12={heroLast12}
      ytd2026={heroYtd2026}
      lastMonth={heroLastMonth}
      lastMonthPctMonthly={heroLastMonthPctMonthly}
      currency={currency}
      includeRiskCapitalInTotals={includeRiskCapitalInTotals}
      onToggleRiskMode={onToggleRiskMode}
      crpContributionInsight={crpContributionInsight}
    />

    {analysisDiagnostics.anomalyRaw && Math.abs(Number(analysisDiagnostics.anomalyRaw.pct || 0)) >= 200 && (
      <Card className="border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Diagnóstico previo: mes anómalo detectado en {analysisDiagnostics.anomalyRaw.monthKey}
        {` · Var.Pat ${analysisDiagnostics.anomalyRaw.varPatrimonioClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.varPatrimonioClp, 'CLP')}`}
        {` · Gastos ${analysisDiagnostics.anomalyRaw.gastosClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.gastosClp, 'CLP')}`}
        {` · Ret.Econ. ${analysisDiagnostics.anomalyRaw.retornoRealClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.retornoRealClp, 'CLP')}`}
        {` · % ${formatPct(analysisDiagnostics.anomalyRaw.pct)}`}
      </Card>
    )}

    {(pendingSpendMonths.length > 0 || missingSpendMonths.length > 0) && (
      <Card className={cn(
        'p-3 text-xs',
        missingSpendMonths.length > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'
      )}>
        {missingSpendMonths.length > 0 && (
          <div>
            Meses cerrados sin gasto contable final: {missingSpendMonths.map((m) => monthLabel(m)).join(', ')}.
            No se incluyen en agregados cerrados.
          </div>
        )}
        {pendingSpendMonths.length > 0 && (
          <div className={missingSpendMonths.length > 0 ? 'mt-1' : ''}>
            Meses pendientes de cierre de gasto: {pendingSpendMonths.map((m) => monthLabel(m)).join(', ')}.
            Se muestran, pero no entran en agregados cerrados.
          </div>
        )}
      </Card>
    )}

    <Card className="border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <CalendarDays size={14} />
          Historial completo
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={copyTable}
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {copyStatus === 'done' ? 'Copiado' : copyStatus === 'error' ? 'Error al copiar' : 'Copiar tabla'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Exportar CSV
          </button>
        </div>
      </div>
      <div className="mt-2 max-h-[55vh] overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[600px] text-xs">
          <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur-[1px]">
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-2">Mes</th>
              <th className="py-1 pr-2 text-right">%</th>
              <th className="py-1 pr-2 text-right">Ret.Econ.</th>
              <th className="py-1 pr-2 text-right">Var.Pat</th>
              <th className="py-1 text-right">Gastos</th>
            </tr>
          </thead>
          <tbody>
            {monthlyRowsDesc.map((row) => {
              const varDisplay = row.varPatrimonioDisplay;
              const gastosDisplay = row.gastosDisplay;
              const retornoDisplay = row.retornoRealDisplay;
              const positive = (retornoDisplay || 0) >= 0;
              return (
                <tr key={row.monthKey} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{monthLabelShort(row.monthKey)}</td>
                  <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                    {formatPct(row.pct)}
                  </td>
                  <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                    {retornoDisplay === null ? '—' : formatCurrency(retornoDisplay, currency)}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-700">
                    {varDisplay === null ? '—' : formatCurrency(varDisplay, currency)}
                  </td>
                  <td className={cn(
                    'py-1.5 text-right',
                    row.gastosStatus === 'missing'
                      ? 'text-rose-700'
                      : row.gastosStatus === 'pending'
                        ? 'text-amber-700'
                        : 'text-slate-700'
                  )}>
                    {row.gastosStatus === 'missing'
                      ? 'Faltante'
                      : row.gastosStatus === 'pending'
                        ? 'Pendiente'
                        : gastosDisplay === null
                          ? '—'
                          : formatCurrency(gastosDisplay, currency)}
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
    <TrendLineCard
      title="Trayectoria acumulada"
      subtitle="Base 100"
      curve={trajectoryCurve}
      stroke="#0f766e"
      formatter={(value) => `${value.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`}
    />
    <TrendLineCard
      title="Evolución del patrimonio"
      subtitle={`${currency} por cierre`}
      curve={patrimonyCurve}
      stroke="#1d4ed8"
      currency={currency}
      formatter={(value) => formatCompactCurrency(value, currency)}
    />
  </>
  );
};
