import React from 'react';
import { CalendarDays, LineChart, Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import type { WealthCurrency } from '../../services/wealthStorage';
import { formatCurrency, formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import type { AggregatedSummary, CrpContributionInsight, MonthlyReturnRow } from './types';
import { buildReturnSpendInsight, convertFromClp, formatCompactCurrency, formatPct, xLabelFromMonthKey } from './shared';

type ReturnsTabProps = {
  heroSinceStart: AggregatedSummary | null;
  heroLast12: AggregatedSummary | null;
  heroLastMonth: AggregatedSummary | null;
  heroLastMonthPctMonthly: number | null;
  currency: WealthCurrency;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  crpContributionInsight: CrpContributionInsight | null;
  analysisDiagnostics: {
    anomalyRaw: MonthlyReturnRow | null;
  };
  monthlyRowsAsc: MonthlyReturnRow[];
  monthlyRowsDesc: MonthlyReturnRow[];
  periodSummaries: AggregatedSummary[];
  yearlySummaries: AggregatedSummary[];
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
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  crpContributionInsight: CrpContributionInsight | null;
}> = ({
  sinceStart,
  last12,
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
    { key: 'mes', label: 'ÚLT. MES', value: lastMonth, pct: lastMonthPctMonthly },
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
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#08152f] via-[#0d2146] to-[#0a1730] p-4 text-slate-100 shadow-[0_16px_40px_rgba(4,16,40,0.28)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(110,231,183,0.14),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(96,165,250,0.12),_transparent_38%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Retorno económico</div>
            <div className="mt-1 text-[11px] text-slate-400">Lectura oficial del período, incluyendo lo que gastaste</div>
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
      <div className="relative mt-3 space-y-2">
        {rows.map((row) => {
          const spendInsight = buildReturnSpendInsight(row.value);

          return (
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

export const ReturnsTab: React.FC<ReturnsTabProps> = ({
  heroSinceStart,
  heroLast12,
  heroLastMonth,
  heroLastMonthPctMonthly,
  currency,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  crpContributionInsight,
  analysisDiagnostics,
  monthlyRowsAsc,
  monthlyRowsDesc,
  periodSummaries,
  yearlySummaries,
}) => (
  <>
    <ReturnRealHero
      sinceStart={heroSinceStart}
      last12={heroLast12}
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
              <th className="py-1 pr-2 text-right">Ret.Econ.</th>
              <th className="py-1 pr-2 text-right">Var.Pat</th>
              <th className="py-1 text-right">Gastos</th>
            </tr>
          </thead>
          <tbody>
            {monthlyRowsDesc.map((row) => {
              const varDisplay = row.varPatrimonioClp === null ? null : convertFromClp(row.varPatrimonioClp, currency, row.fx);
              const gastosDisplay = row.gastosClp === null ? null : convertFromClp(row.gastosClp, currency, row.fx);
              const retornoDisplay = row.retornoRealClp === null ? null : convertFromClp(row.retornoRealClp, currency, row.fx);
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
);
