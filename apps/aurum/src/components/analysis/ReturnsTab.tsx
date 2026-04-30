import React from 'react';
import { CalendarDays, ChevronDown, LineChart, Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import type { WealthCurrency } from '../../services/wealthStorage';
import { formatCurrency, formatIsoDateTime, formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import { buildPendingOfficialReturnInfo } from '../../services/returnsAnalysis';
import type { ProvisionalReturnScenario } from '../../services/returnsAnalysis';
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

type SpendTrustSeverity = 'ok' | 'warning' | 'alert';

const humanizeDayToDaySource = (source: string | null) => {
  if (source === 'monthly_reports') return 'reporte mensual';
  if (source === 'direct_sum') return 'suma directa';
  if (source === 'period_summaries') return 'resumen de periodos';
  if (source === 'legacy') return 'respaldo legacy';
  return source || null;
};

const spendTrustTone = (severity: SpendTrustSeverity) => {
  if (severity === 'ok') return 'border-slate-200 bg-slate-50/70 text-slate-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50/60 text-amber-900';
  return 'border-rose-200 bg-rose-50/70 text-rose-800';
};

type ReturnsTabProps = {
  heroSinceStart: AggregatedSummary | null;
  heroLast12: AggregatedSummary | null;
  heroYtd2026: AggregatedSummary | null;
  heroLastMonth: AggregatedSummary | null;
  heroLastMonthPctMonthly: number | null;
  currency: WealthCurrency;
  includeEstimatedMonth: boolean;
  hasEstimatedMonth: boolean;
  estimatedMonthMeta: {
    monthKey: string;
    estimateMethod: 'avg_12m_closed' | 'avg_available_closed';
    estimatedSpendClp: number;
    estimatedSpendDisplay: number;
    estimatedFromMonthsCount: number;
    officialAvailableDate: string | null;
    gastosPeriodKey: string | null;
    referencePreviousMonthSpendClp: number | null;
  } | null;
  pendingEstimateDetail: {
    monthKey: string;
    availabilityLabel: string | null;
    periodRangeLabel: string | null;
    varPatrimonioDisplay: number;
    scenarios: ProvisionalReturnScenario[];
  } | null;
  officialAvailabilityNotice: {
    monthKey: string;
    monthLabel: string;
    officialReturnDisplay: number;
    officialRatePct: number;
    officialSpendDisplay: number;
    officialAvailableDate: string | null;
    status: 'official';
    wasEstimatedOrPending: boolean;
    source: 'returns_series_official';
  } | null;
  onToggleIncludeEstimatedMonth: () => void;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  crpContributionInsight: CrpContributionInsight | null;
  analysisDiagnostics: {
    anomalyRaw: MonthlyReturnRow | null;
  };
  fxExcludedMonths: string[];
  officialMonthlyRowsAsc: MonthlyReturnRow[];
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
  includeEstimatedMonth: boolean;
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
  includeEstimatedMonth,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  crpContributionInsight,
}) => {
  const rows = [
    { key: 'inicio', label: 'DESDE INICIO', showEstimatedBadge: includeEstimatedMonth, value: sinceStart, pct: sinceStart?.pctRetorno ?? null },
    { key: '12m', label: 'ÚLT. 12M', showEstimatedBadge: includeEstimatedMonth, value: last12, pct: last12?.pctRetorno ?? null },
    { key: 'ytd', label: 'YTD 2026', showEstimatedBadge: includeEstimatedMonth, value: ytd2026, pct: ytd2026?.pctRetorno ?? null },
    { key: 'mes', label: 'ÚLT. MES VÁLIDO', showEstimatedBadge: false, value: lastMonth, pct: lastMonthPctMonthly },
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
          const cleanLabel = row.label.replace(/\s*\(E\)\s*$/u, '');

          return (
            <div
              key={row.key}
              className="rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[2px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {cleanLabel}
                    </div>
                    {row.showEstimatedBadge && (
                      <span
                        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-amber-200 bg-amber-300/95 px-1 text-[9px] font-bold leading-none text-amber-950 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]"
                        aria-label="Estimado"
                        title="Estimado"
                      >
                        E
                      </span>
                    )}
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
  includeEstimatedMonth,
  hasEstimatedMonth,
  estimatedMonthMeta,
  pendingEstimateDetail,
  officialAvailabilityNotice,
  onToggleIncludeEstimatedMonth,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  crpContributionInsight,
  analysisDiagnostics,
  fxExcludedMonths,
  officialMonthlyRowsAsc,
  monthlyRowsAsc,
  monthlyRowsDesc,
  periodSummaries,
  yearlySummaries,
  trajectoryCurve,
  patrimonyCurve,
}) => {
  const [isSpendTrustExpanded, setIsSpendTrustExpanded] = React.useState(false);
  const [isProvisionalExpanded, setIsProvisionalExpanded] = React.useState(false);
  const [isOfficialNoticeDismissed, setIsOfficialNoticeDismissed] = React.useState(false);
  React.useEffect(() => {
    setIsOfficialNoticeDismissed(false);
  }, [officialAvailabilityNotice?.monthKey]);
  const pendingSpendMonths = officialMonthlyRowsAsc.filter((row) => row.gastosStatus === 'pending').map((row) => row.monthKey);
  const missingSpendMonths = officialMonthlyRowsAsc.filter((row) => row.gastosStatus === 'missing').map((row) => row.monthKey);
  const legacySpendMonths = officialMonthlyRowsAsc.filter((row) => row.gastosSource === 'legacy_static').map((row) => row.monthKey);
  const firestoreSpendMonths = officialMonthlyRowsAsc.filter((row) => row.gastosSource === 'gastapp_firestore').map((row) => row.monthKey);
  const latestGastappSpendRow = React.useMemo(
    () =>
      [...officialMonthlyRowsAsc]
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
        .find((row) =>
        row.gastosSource === 'gastapp_firestore' && (
          row.gastosContractStatus !== null
          || row.gastosDataQuality !== null
          || row.gastosIsStale
          || row.gastosStaleReason !== null
          || row.gastosDayToDaySource !== null
          || row.gastosPublishedAt !== null
          || row.gastosUpdatedAt !== null
          || row.gastosPeriodKey !== null
          || row.gastosRevision !== null
          || row.gastosReportVsDirectDiffEur !== null
          || row.gastosSummaryVsDirectDiffEur !== null
          || row.gastosReportVsSummaryDiffEur !== null
          || row.gastosCategoryGapEur !== null
        ),
      ) ?? [...officialMonthlyRowsAsc]
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
        .find((row) => row.gastosSource === 'gastapp_firestore') ?? null,
    [officialMonthlyRowsAsc],
  );
  const spendTrustState = React.useMemo(() => {
    if (missingSpendMonths.length > 0) {
      return {
        severity: 'alert' as SpendTrustSeverity,
        title: 'Gasto observado faltante',
        body: `Meses cerrados sin gasto contable final: ${missingSpendMonths.map((m) => monthLabel(m)).join(', ')}. No se incluyen en agregados cerrados.`,
      };
    }
    if (legacySpendMonths.length > 0) {
      return {
        severity: 'warning' as SpendTrustSeverity,
        title: 'Gasto de respaldo legacy',
        body: 'Gasto de respaldo legacy, no desde periodos actuales sincronizados.',
      };
    }
    const row = latestGastappSpendRow;
    if (!row) {
      return null;
    }
    const hasAlert =
      row.gastosDataQuality === 'error'
      || row.gastosContractStatus === 'missing';
    const hasWarning =
      row.gastosIsStale
      || row.gastosContractStatus === 'stale'
      || row.gastosDataQuality === 'warning'
      || row.gastosContractStatus === 'pending';
    if (hasAlert) {
      return {
        severity: 'alert' as SpendTrustSeverity,
        title: 'Gasto observado con alerta',
        body: row.gastosIsStale || row.gastosContractStatus === 'stale'
          ? 'Gasto observado marcado como stale por GastApp. Revisa o reconstruye el cierre.'
          : 'Gasto observado con alerta de calidad o estado incompleto del contrato.',
      };
    }
    if (hasWarning) {
      return {
        severity: 'warning' as SpendTrustSeverity,
        title: 'Gasto observado con advertencia',
        body: 'Gasto observado con advertencia: cierre desfasado respecto a movimientos recientes.',
      };
    }
    return {
      severity: 'ok' as SpendTrustSeverity,
      title: 'Gasto observado desde GastApp por periodo',
      body: 'Gasto observado desde GastApp por periodo · contrato actualizado.',
    };
  }, [latestGastappSpendRow, legacySpendMonths.length, missingSpendMonths]);
  const spendTrustDetails = React.useMemo(() => {
    const row = latestGastappSpendRow;
    if (!row || legacySpendMonths.length > 0) return [];
    const details: string[] = [];
    if (row.gastosContractStatus || row.gastosDataQuality) {
      details.push(
        `Estado contrato: ${row.gastosContractStatus || 'n/d'}${row.gastosDataQuality ? ` · Calidad: ${row.gastosDataQuality}` : ''}`,
      );
    }
    if (row.gastosContractSource) {
      details.push(`Fuente contrato: ${row.gastosContractSource}`);
    }
    const dayToDaySource = humanizeDayToDaySource(row.gastosDayToDaySource);
    if (dayToDaySource) {
      details.push(`Fuente diaria: ${dayToDaySource}`);
    }
    if (row.gastosPeriodKey) {
      details.push(`Periodo: ${row.gastosPeriodKey}`);
    }
    if (row.gastosSchemaVersion || row.gastosMethodologyVersion) {
      details.push(
        `Contrato: ${row.gastosSchemaVersion || 'schema n/d'}${row.gastosMethodologyVersion ? ` · metodología ${row.gastosMethodologyVersion}` : ''}`,
      );
    }
    if (row.gastosRevision !== null) {
      details.push(`Revisión: ${row.gastosRevision}`);
    }
    if (row.gastosPublishedAt || row.gastosUpdatedAt) {
      details.push(
        `Actualizado: ${formatIsoDateTime(row.gastosPublishedAt || row.gastosUpdatedAt || undefined)}`,
      );
    }
    return details;
  }, [latestGastappSpendRow, legacySpendMonths.length]);
  const spendTrustDiffs = React.useMemo(() => {
    const row = latestGastappSpendRow;
    if (!row || legacySpendMonths.length > 0) return [];
    const diffEntries = [
      { label: 'cierre vs suma directa', value: row.gastosReportVsDirectDiffEur },
      { label: 'resumen vs suma directa', value: row.gastosSummaryVsDirectDiffEur },
      { label: 'cierre vs resumen', value: row.gastosReportVsSummaryDiffEur },
      { label: 'brecha de categorías', value: row.gastosCategoryGapEur },
    ].filter((entry) => entry.value !== null && Math.abs(Number(entry.value)) > 0.01);
    return diffEntries.map((entry) => `Diferencia detectada entre ${entry.label}: ${formatCurrency(Number(entry.value), 'EUR')}`);
  }, [latestGastappSpendRow, legacySpendMonths.length]);
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'done' | 'error'>('idle');
  const pendingOfficialRows = React.useMemo(
    () =>
      [...officialMonthlyRowsAsc]
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
        .filter((row) => row.gastosStatus === 'pending' && row.varPatrimonioDisplay !== null)
        .map((row) => ({
          row,
          info: buildPendingOfficialReturnInfo(row),
        })),
    [officialMonthlyRowsAsc],
  );
  const mainPendingOfficial = pendingOfficialRows[0] || null;
  const provisionalEstimate = pendingEstimateDetail;
  const spendTrustCollapsedLine = React.useMemo(() => {
    if (mainPendingOfficial?.info?.availabilityLabel) {
      return `${monthLabel(mainPendingOfficial.row.monthKey)} pendiente de gasto · Oficial disponible ${mainPendingOfficial.info.availabilityLabel}`;
    }
    if (missingSpendMonths.length > 0) {
      return `${missingSpendMonths.length} mes(es) sin gasto final · no entra(n) en cerrados`;
    }
    if (pendingSpendMonths.length > 0) {
      return `${pendingSpendMonths.length} mes(es) pendiente(s) de gasto · Retorno oficial en espera`;
    }
    if (spendTrustState?.severity === 'alert') return 'Revisar calidad de gasto observado';
    if (spendTrustState?.severity === 'warning') return 'Gasto observado con advertencia';
    if (spendTrustState?.severity === 'ok') return 'Gasto observado desde fuente principal';
    return 'Sin avisos de datos';
  }, [mainPendingOfficial, pendingSpendMonths.length, missingSpendMonths.length, spendTrustState]);

  const historyRows = React.useMemo(
    () =>
      monthlyRowsDesc.map((row) => {
        const retornoDisplay = row.retornoRealDisplay;
        const varDisplay = row.varPatrimonioDisplay;
        const gastosDisplay = row.gastosDisplay;
        const pendingInfo = row.gastosStatus === 'pending' ? buildPendingOfficialReturnInfo(row) : null;
        const estimatedSuffix = row.isEstimated ? ' (E)' : '';
        return {
          monthKey: row.monthKey,
          isEstimated: Boolean(row.isEstimated),
          estimateMethod: row.estimateMethod || '',
          estimatedSpendClp: row.estimatedSpendClp,
          officialAvailableDate: row.officialAvailableDate || '',
          month: monthLabelShort(row.monthKey),
          pct: row.gastosStatus === 'pending' ? 'Pendiente gasto' : `${formatPct(row.pct)}${estimatedSuffix}`,
          retorno:
            row.gastosStatus === 'pending'
              ? pendingInfo?.availabilityLabel
                ? `Disponible ${pendingInfo.availabilityLabel}`
                : 'Pendiente gasto'
              : retornoDisplay === null
                ? '—'
                : `${formatCurrency(retornoDisplay, currency)}${estimatedSuffix}`,
          varPat: varDisplay === null ? '—' : formatCurrency(varDisplay, currency),
          gastos:
            row.gastosStatus === 'missing'
              ? 'Faltante'
              : row.gastosStatus === 'pending'
                ? 'Pendiente'
                : gastosDisplay === null
                  ? '—'
                  : `${formatCurrency(gastosDisplay, currency)}${estimatedSuffix}`,
        };
      }),
    [monthlyRowsDesc, currency],
  );

  const copyTable = React.useCallback(async () => {
    const header = ['monthKey', 'Mes', '%', 'Ret.Econ.', 'Var.Pat', 'Gastos', 'isEstimated', 'estimateMethod', 'estimatedSpendClp', 'officialAvailableDate'];
    const lines = [
      header.join('\t'),
      ...historyRows.map((row) => [
        row.monthKey,
        row.month,
        row.pct,
        row.retorno,
        row.varPat,
        row.gastos,
        row.isEstimated ? 'true' : 'false',
        row.estimateMethod,
        row.estimatedSpendClp ?? '',
        row.officialAvailableDate,
      ].join('\t')),
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
    const header = ['monthKey', 'Mes', '%', 'Ret.Econ.', 'Var.Pat', 'Gastos', 'isEstimated', 'estimateMethod', 'estimatedSpendClp', 'officialAvailableDate'];
    const lines = [
      header.map(escape).join(','),
      ...historyRows.map((row) => [
        row.monthKey,
        row.month,
        row.pct,
        row.retorno,
        row.varPat,
        row.gastos,
        row.isEstimated ? 'true' : 'false',
        row.estimateMethod,
        String(row.estimatedSpendClp ?? ''),
        row.officialAvailableDate,
      ].map(escape).join(',')),
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
    <ReturnRealHero
      sinceStart={heroSinceStart}
      last12={heroLast12}
      ytd2026={heroYtd2026}
      lastMonth={heroLastMonth}
      lastMonthPctMonthly={heroLastMonthPctMonthly}
      currency={currency}
      includeEstimatedMonth={includeEstimatedMonth}
      includeRiskCapitalInTotals={includeRiskCapitalInTotals}
      onToggleRiskMode={onToggleRiskMode}
      crpContributionInsight={crpContributionInsight}
    />

    {hasEstimatedMonth && estimatedMonthMeta && (
      <Card className="border-slate-200 bg-slate-50/70 p-2.5 text-xs text-slate-700 shadow-none">
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-900">Incluir último mes estimado (E)</div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              Usa el cierre patrimonial del mes y un gasto estimado. No reemplaza el dato oficial.
            </div>
            {includeEstimatedMonth && (
              <div className="mt-1 text-[11px] font-medium text-slate-800">
                {`Modo estimado activo · incluye ${monthLabel(estimatedMonthMeta.monthKey)} (E)${estimatedMonthMeta.officialAvailableDate ? ` · oficial ${estimatedMonthMeta.officialAvailableDate}` : ''}`}
              </div>
            )}
          </div>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-400 text-slate-700 focus:ring-slate-500"
            checked={includeEstimatedMonth}
            onChange={onToggleIncludeEstimatedMonth}
          />
        </label>
      </Card>
    )}

    {officialAvailabilityNotice && !isOfficialNoticeDismissed && (
      <Card className="border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900 shadow-none">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold">
              {`${officialAvailabilityNotice.monthLabel} ya tiene retorno oficial`}
            </div>
            <div className="mt-0.5 text-[11px] text-emerald-800">
              El gasto real de GastApp está cerrado y este mes ya entra en la serie oficial.
            </div>
            {includeEstimatedMonth && (
              <div className="mt-1 text-[11px] text-emerald-800">
                El modo estimado ya no aplica para este mes.
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full border border-emerald-200 bg-white/80 px-2 py-0.5">
                {`Retorno oficial: ${formatCurrency(officialAvailabilityNotice.officialReturnDisplay, currency)}`}
              </span>
              <span className="rounded-full border border-emerald-200 bg-white/80 px-2 py-0.5">
                {`Tasa oficial: ${formatPct(officialAvailabilityNotice.officialRatePct)}`}
              </span>
              <span className="rounded-full border border-emerald-200 bg-white/80 px-2 py-0.5">
                {`Gasto real: ${formatCurrency(officialAvailabilityNotice.officialSpendDisplay, currency)}`}
              </span>
              <span className="rounded-full border border-emerald-200 bg-white/80 px-2 py-0.5">
                {`Estado: Oficial cerrado${officialAvailabilityNotice.officialAvailableDate ? ` · ${officialAvailabilityNotice.officialAvailableDate}` : ''}`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOfficialNoticeDismissed(true)}
            className="rounded border border-emerald-300 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 transition hover:bg-emerald-100"
          >
            Ocultar
          </button>
        </div>
      </Card>
    )}

    {spendTrustState && (legacySpendMonths.length > 0 || firestoreSpendMonths.length > 0 || pendingSpendMonths.length > 0 || missingSpendMonths.length > 0) && (
      <Card className={cn(
        'p-2 text-xs shadow-none',
        spendTrustTone(spendTrustState.severity),
      )}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => setIsSpendTrustExpanded((prev) => !prev)}
          aria-expanded={isSpendTrustExpanded}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                spendTrustState.severity === 'alert'
                  ? 'bg-rose-500'
                  : spendTrustState.severity === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-slate-400',
              )}
            />
            <div className="truncate text-[12px] font-semibold">
            {`Avisos · ${spendTrustCollapsedLine}`}
            </div>
          </div>
          <ChevronDown size={16} className={cn('shrink-0 transition-transform', isSpendTrustExpanded ? 'rotate-180' : 'rotate-0')} />
        </button>
        {isSpendTrustExpanded && (
          <div className="mt-2 border-t border-current/15 pt-2.5">
            <div>{spendTrustState.body}</div>
            {mainPendingOfficial && (
              <div className="mt-1">
                {`${monthLabel(mainPendingOfficial.row.monthKey)} tiene cierre patrimonial, pero el gasto asociado aún no está cerrado. El retorno económico oficial estará disponible ${
                  mainPendingOfficial.info.availabilityLabel ? `el ${mainPendingOfficial.info.availabilityLabel}` : 'cuando cierre GastApp'
                }${
                  mainPendingOfficial.info.periodRangeLabel
                    ? `, cuando cierre el periodo de gasto ${mainPendingOfficial.info.periodRangeLabel}.`
                    : '.'
                }`}
              </div>
            )}
            {latestGastappSpendRow?.gastosStaleReason && legacySpendMonths.length === 0 && (
              <div className="mt-1 text-[11px]">Motivo: {latestGastappSpendRow.gastosStaleReason}</div>
            )}
            {spendTrustDetails.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spendTrustDetails.map((detail) => (
                  <span key={detail} className="rounded-full border border-current/15 bg-white/40 px-2 py-0.5 text-[10px]">
                    {detail}
                  </span>
                ))}
              </div>
            )}
            {spendTrustDiffs.length > 0 && (
              <div className="mt-2 space-y-1 text-[11px]">
                {spendTrustDiffs.map((detail) => (
                  <div key={detail}>{detail}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    )}

    {fxExcludedMonths.length > 0 && (
      <Card className="border-amber-200 bg-amber-50/80 p-2.5 text-[11px] text-amber-700">
        {fxExcludedMonths.length === 1
          ? `1 mes excluido de agregados cerrados por FX no auditable: ${fxExcludedMonths[0]}.`
          : `${fxExcludedMonths.length} meses excluidos de agregados cerrados por FX no auditable: ${fxExcludedMonths.join(', ')}.`}
      </Card>
    )}

    {analysisDiagnostics.anomalyRaw && Math.abs(Number(analysisDiagnostics.anomalyRaw.pct || 0)) >= 200 && (
      <Card className="border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Diagnóstico previo: mes anómalo detectado en {analysisDiagnostics.anomalyRaw.monthKey}
        {` · Var.Pat ${analysisDiagnostics.anomalyRaw.varPatrimonioClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.varPatrimonioClp, 'CLP')}`}
        {` · Gastos ${analysisDiagnostics.anomalyRaw.gastosClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.gastosClp, 'CLP')}`}
        {` · Ret.Econ. ${analysisDiagnostics.anomalyRaw.retornoRealClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.retornoRealClp, 'CLP')}`}
        {` · % ${formatPct(analysisDiagnostics.anomalyRaw.pct)}`}
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
              const pendingInfo = row.gastosStatus === 'pending' ? buildPendingOfficialReturnInfo(row) : null;
              const estimated = Boolean(row.isEstimated);
              return (
                <tr key={row.monthKey} className={cn('border-t border-slate-100', estimated && 'bg-amber-50/40')}>
                  <td className="py-1.5 pr-2 font-medium text-slate-700">
                    <div className="inline-flex items-center gap-1.5">
                      <span>{monthLabelShort(row.monthKey)}</span>
                      {estimated && (
                        <span className="rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          E
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(
                    'py-1.5 pr-2 text-right font-semibold',
                    row.gastosStatus === 'pending' ? 'text-amber-700' : positive ? 'text-emerald-700' : 'text-rose-700',
                  )}>
                    {row.gastosStatus === 'pending' ? 'Pendiente gasto' : `${formatPct(row.pct)}${estimated ? ' (E)' : ''}`}
                  </td>
                  <td className={cn(
                    'py-1.5 pr-2 text-right font-semibold',
                    row.gastosStatus === 'pending' ? 'text-amber-700' : positive ? 'text-emerald-700' : 'text-rose-700',
                  )}>
                    {row.gastosStatus === 'pending'
                      ? pendingInfo?.availabilityLabel
                        ? `Disponible ${pendingInfo.availabilityLabel}`
                        : 'Pendiente gasto'
                      : retornoDisplay === null
                        ? '—'
                        : `${formatCurrency(retornoDisplay, currency)}${estimated ? ' (E)' : ''}`}
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

    {provisionalEstimate && (
      <Card className="border-dashed border-amber-300 bg-white p-2.5 text-xs text-slate-700">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setIsProvisionalExpanded((prev) => !prev)}
          aria-expanded={isProvisionalExpanded}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">Estimación provisional</span>
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                Estimado
              </span>
            </div>
            <div className="truncate text-[11px] text-slate-500">
              {`${monthLabel(provisionalEstimate.monthKey)} · ${provisionalEstimate.availabilityLabel ? `oficial disponible ${provisionalEstimate.availabilityLabel}` : 'no oficial'}`}
            </div>
          </div>
          <ChevronDown size={16} className={cn('shrink-0 transition-transform', isProvisionalExpanded ? 'rotate-180' : 'rotate-0')} />
        </button>
        {isProvisionalExpanded && (
          <div className="mt-2 border-t border-slate-200 pt-2">
            <div className="text-[11px] text-slate-500">
              Estimado, no cierre oficial. Se reemplazará por el dato oficial cuando cierre GastApp.
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {provisionalEstimate.periodRangeLabel ? `Periodo ${provisionalEstimate.periodRangeLabel}` : 'Periodo pendiente de cierre'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Var.Pat. visible: {formatCurrency(provisionalEstimate.varPatrimonioDisplay, currency)}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {provisionalEstimate.scenarios.map((scenario) => (
                <div key={scenario.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold text-slate-800">{scenario.label}</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <span className="text-slate-500">Gasto usado</span>
                    <span className="text-right font-medium text-slate-800">{formatCurrency(scenario.spendDisplay, currency)}</span>
                    <span className="text-slate-500">Ret.Econ. estimado</span>
                    <span className={cn('text-right font-semibold', scenario.retornoRealDisplay >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                      {formatCurrency(scenario.retornoRealDisplay, currency)}
                    </span>
                    <span className="text-slate-500">Tasa estimada</span>
                    <span className={cn('text-right font-semibold', (scenario.pct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                      {formatPct(scenario.pct)}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] font-medium text-amber-700">Estimado, no cierre oficial.</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    )}

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
