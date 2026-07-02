import React from 'react';

import { Card, cn } from '../Components';
import { calculatePortfolioAnalytics } from '../../services/portfolioAnalytics';
import type { MonthlyReturnRow } from './types';
import { formatMonthLabel as monthLabel } from '../../utils/wealthFormat';

const MONTH_SHORT_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;

const monthLabelShort = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return monthKey;
  return `${MONTH_SHORT_ES[month - 1]} ${year}`;
};

const formatPctDecimal = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(decimals).replace('.', ',')}%`;
};

const formatPlainNumber = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

type MetricCardProps = {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  detail?: string | null;
};

const MetricCard: React.FC<MetricCardProps> = ({ label, value, tone = 'default', detail }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-3">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div
      className={cn(
        'mt-1 text-base font-semibold',
        tone === 'positive' && 'text-emerald-700',
        tone === 'negative' && 'text-rose-700',
        tone === 'warning' && 'text-amber-700',
        tone === 'default' && 'text-slate-900',
      )}
    >
      {value}
    </div>
    {detail ? <div className="mt-1 text-[11px] text-slate-500">{detail}</div> : null}
  </div>
);

export type PortfolioAnalyticsPanelProps = {
  monthlyRows: MonthlyReturnRow[];
};

export const PortfolioAnalyticsPanel: React.FC<PortfolioAnalyticsPanelProps> = ({ monthlyRows }) => {
  const series = React.useMemo(
    () =>
      monthlyRows
        .filter((row) => Number.isFinite(row.pct))
        .map((row) => ({
          monthKey: row.monthKey,
          returnPct: Number(row.pct) / 100,
          isEstimated: Boolean(row.isEstimated),
        })),
    [monthlyRows],
  );

  const analytics = React.useMemo(() => calculatePortfolioAnalytics(series), [series]);
  const officialMonthsUsed = Math.max(0, analytics.monthsUsed - analytics.estimatedMonthsUsed);
  const lastMonthLabel = analytics.lastMonthKey ? monthLabel(analytics.lastMonthKey) : null;
  const lastMonthBadge = analytics.lastMonthIsEstimated ? 'estimado' : 'oficial';
  const lastMonthTone = analytics.lastMonthIsEstimated
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <Card className="border-slate-200 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portfolio Analytics</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Métricas sobre la serie mensual de retornos económicos.
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
            {`Oficiales: ${officialMonthsUsed} meses`}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
            {`Estimados: ${analytics.estimatedMonthsUsed}`}
          </span>
          <span className={cn('rounded-full border px-2 py-0.5', lastMonthTone)}>
            {`Último mes: ${lastMonthLabel ?? '—'}${lastMonthLabel ? ` · ${lastMonthBadge}` : ''}`}
          </span>
          {analytics.lastMonthIsEstimated && analytics.lastMonthKey ? (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
              E
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Retorno</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Retorno acumulado" value={formatPctDecimal(analytics.cumulativeReturnPct)} />
            <MetricCard label="Retorno anualizado" value={formatPctDecimal(analytics.annualizedReturnPct)} />
            <MetricCard label="Mediana mensual" value={formatPctDecimal(analytics.medianMonthlyReturnPct)} />
            <MetricCard label="Promedio sin outliers" value={formatPctDecimal(analytics.winsorizedMeanMonthlyReturnPct)} />
          </div>
        </section>

        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Riesgo</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Volatilidad anualizada" value={formatPctDecimal(analytics.volatilityAnnualizedPct)} />
            <MetricCard
              label="Máximo drawdown"
              value={formatPctDecimal(analytics.maxDrawdownPct)}
              tone={analytics.maxDrawdownPct === null ? 'default' : analytics.maxDrawdownPct < 0 ? 'negative' : 'default'}
              detail={
                analytics.maxDrawdownTroughMonthKey
                  ? `${monthLabelShort(analytics.maxDrawdownTroughMonthKey)}`
                  : null
              }
            />
            <MetricCard
              label="Drawdown actual"
              value={formatPctDecimal(analytics.currentDrawdownPct)}
              tone={analytics.currentDrawdownPct === null ? 'default' : analytics.currentDrawdownPct < 0 ? 'negative' : 'default'}
            />
            <MetricCard
              label="Peor mes"
              value={analytics.worstMonth ? formatPctDecimal(analytics.worstMonth.returnPct) : '—'}
              tone={analytics.worstMonth && analytics.worstMonth.returnPct < 0 ? 'negative' : 'default'}
              detail={analytics.worstMonth ? monthLabelShort(analytics.worstMonth.monthKey) : null}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Consistencia</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="% meses positivos" value={formatPctDecimal(analytics.positiveMonthsPct)} tone="positive" />
            <MetricCard
              label="P10 / P50 / P90"
              value={
                analytics.percentiles.p50 === null
                  ? '—'
                  : `${formatPctDecimal(analytics.percentiles.p10)} · ${formatPctDecimal(analytics.percentiles.p50)} · ${formatPctDecimal(analytics.percentiles.p90)}`
              }
            />
            <MetricCard
              label="Mejor mes"
              value={analytics.bestMonth ? formatPctDecimal(analytics.bestMonth.returnPct) : '—'}
              tone={analytics.bestMonth && analytics.bestMonth.returnPct > 0 ? 'positive' : 'default'}
              detail={analytics.bestMonth ? monthLabelShort(analytics.bestMonth.monthKey) : null}
            />
            <MetricCard label="Meses usados" value={String(analytics.monthsUsed)} detail={`Serie visible: ${analytics.monthsTotal}`} />
          </div>
        </section>

        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recuperación</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Meses hasta recuperación"
              value={analytics.monthsToRecovery === null ? '—' : String(analytics.monthsToRecovery)}
            />
            <MetricCard label="Ulcer Index" value={formatPlainNumber(analytics.ulcerIndex, 3)} />
            <MetricCard label="Calmar simple" value={formatPlainNumber(analytics.calmarSimple, 2)} />
            <MetricCard
              label="Estado"
              value={analytics.isRecovered === null ? '—' : analytics.isRecovered ? 'Recuperado' : 'Sin recuperar'}
              tone={analytics.isRecovered === null ? 'default' : analytics.isRecovered ? 'positive' : 'warning'}
            />
          </div>
        </section>
      </div>

      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer select-none font-medium text-slate-700">Ver metodología</summary>
        <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div>Cálculo basado en cierres mensuales.</div>
          <div>Drawdown mensual; no captura caídas intra-mes.</div>
          <div>Sharpe, Sortino y Calmar son indicadores simples.</div>
          <div>Tasa libre de riesgo usada: 0% anual, salvo configuración futura.</div>
          <div>Meses estimados pueden cambiar al llegar el dato oficial.</div>

          <div className="grid gap-2 pt-1 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Sharpe simple" value={formatPlainNumber(analytics.sharpeSimple, 2)} />
            <MetricCard label="Sortino simple" value={formatPlainNumber(analytics.sortinoSimple, 2)} />
            <MetricCard label="Meses usados" value={String(analytics.monthsUsed)} />
            <MetricCard
              label="Último mes"
              value={analytics.lastMonthKey ? monthLabelShort(analytics.lastMonthKey) : '—'}
              detail={analytics.lastMonthIsEstimated ? 'Estimado' : analytics.lastMonthKey ? 'Oficial' : null}
            />
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Warnings del servicio</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {analytics.warnings.length > 0 ? (
                analytics.warnings.map((warning) => (
                  <span key={warning} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600">
                    {warning}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-slate-500">Sin warnings.</span>
              )}
            </div>
          </div>
        </div>
      </details>
    </Card>
  );
};
