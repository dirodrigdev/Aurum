import React from 'react';
import { Info, X } from 'lucide-react';

import { Card, cn } from '../Components';
import { calculatePortfolioAnalytics } from '../../services/portfolioAnalytics';
import type { WealthCurrency } from '../../services/wealthStorage';
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

const formatRecovery = ({
  isRecovered,
  maxDrawdownPct,
  monthsToRecovery,
}: {
  isRecovered: boolean | null;
  maxDrawdownPct: number | null;
  monthsToRecovery: number | null;
}) => {
  if (maxDrawdownPct === null) return '—';
  if (maxDrawdownPct === 0) return 'Sin caída';
  if (isRecovered === true && monthsToRecovery !== null) return `Recuperado · ${monthsToRecovery} meses`;
  if (isRecovered === true) return 'Recuperado';
  if (isRecovered === false) return 'No recuperado';
  return '—';
};

type AnalyticsMetricKey =
  | 'cumulativeReturnPct'
  | 'annualizedReturnPct'
  | 'medianMonthlyReturnPct'
  | 'winsorizedMeanMonthlyReturnPct'
  | 'volatilityAnnualizedPct'
  | 'maxDrawdownPct'
  | 'currentDrawdownPct'
  | 'worstMonth'
  | 'positiveMonthsPct'
  | 'percentiles'
  | 'bestMonth'
  | 'sharpeSimple'
  | 'sortinoSimple'
  | 'calmarSimple'
  | 'recovery'
  | 'ulcerIndex';

type MetricDefinition = {
  key: AnalyticsMetricKey;
  label: string;
  infoTitle: string;
  infoBody: string;
  microcopy?: string;
  formatter: (value: ReturnType<typeof calculatePortfolioAnalytics>) => string;
};

const METRIC_DEFINITIONS: Array<{ section: string; metrics: MetricDefinition[] }> = [
  {
    section: 'Retorno',
    metrics: [
      {
        key: 'cumulativeReturnPct',
        label: 'Retorno compuesto',
        infoTitle: 'Retorno compuesto',
        infoBody:
          'Mide el retorno acumulado del período componiendo los retornos mensuales. No usa promedio mensual lineal.',
        formatter: (value) => formatPctDecimal(value.cumulativeReturnPct),
      },
      {
        key: 'annualizedReturnPct',
        label: 'Retorno anualizado',
        infoTitle: 'Retorno anualizado',
        infoBody:
          'Convierte el retorno compuesto del período a una tasa anual equivalente. Es más útil para comparar horizontes distintos.',
        formatter: (value) => formatPctDecimal(value.annualizedReturnPct),
      },
      {
        key: 'medianMonthlyReturnPct',
        label: 'Mediana mensual',
        infoTitle: 'Mediana mensual',
        infoBody:
          'Mes típico de retorno. La mitad de los meses quedó por encima y la mitad por debajo.',
        formatter: (value) => formatPctDecimal(value.medianMonthlyReturnPct),
      },
      {
        key: 'winsorizedMeanMonthlyReturnPct',
        label: 'Promedio mensual sin outliers',
        infoTitle: 'Promedio mensual sin outliers',
        infoBody:
          'Promedio mensual ajustado para reducir el efecto de meses extremos. Sirve para ver una tendencia más estable.',
        formatter: (value) => formatPctDecimal(value.winsorizedMeanMonthlyReturnPct),
      },
    ],
  },
  {
    section: 'Riesgo',
    metrics: [
      {
        key: 'volatilityAnnualizedPct',
        label: 'Volatilidad anualizada',
        infoTitle: 'Volatilidad anualizada',
        infoBody:
          'Mide cuánto varían los retornos mensuales, expresado en escala anual. Menor = más estable.',
        formatter: (value) => formatPctDecimal(value.volatilityAnnualizedPct),
      },
      {
        key: 'maxDrawdownPct',
        label: 'Máx. drawdown',
        infoTitle: 'Máx. drawdown',
        infoBody:
          'Mayor caída desde un máximo hasta un mínimo dentro del período. Menos negativo = mejor.',
        formatter: (value) => formatPctDecimal(value.maxDrawdownPct),
      },
      {
        key: 'currentDrawdownPct',
        label: 'Drawdown actual',
        infoTitle: 'Drawdown actual',
        infoBody:
          'Caída actual desde el último máximo del período. Si es 0%, está en máximo o recuperado.',
        formatter: (value) => formatPctDecimal(value.currentDrawdownPct),
      },
      {
        key: 'worstMonth',
        label: 'Peor mes',
        infoTitle: 'Peor mes',
        infoBody: 'Mes con menor retorno del período seleccionado.',
        formatter: (value) =>
          value.worstMonth
            ? `${monthLabelShort(value.worstMonth.monthKey)} · ${formatPctDecimal(value.worstMonth.returnPct)}`
            : '—',
      },
    ],
  },
  {
    section: 'Consistencia',
    metrics: [
      {
        key: 'positiveMonthsPct',
        label: '% meses positivos',
        infoTitle: '% meses positivos',
        infoBody: 'Porcentaje de meses con retorno económico positivo.',
        formatter: (value) => formatPctDecimal(value.positiveMonthsPct),
      },
      {
        key: 'percentiles',
        label: 'P10 / P50 / P90',
        infoTitle: 'P10 / P50 / P90',
        infoBody:
          'Percentiles de retornos mensuales. P50 es la mediana; P10 muestra un mes débil típico; P90 muestra un mes fuerte típico.',
        formatter: (value) =>
          value.percentiles.p50 === null
            ? '—'
            : `${formatPctDecimal(value.percentiles.p10)} · ${formatPctDecimal(value.percentiles.p50)} · ${formatPctDecimal(value.percentiles.p90)}`,
      },
      {
        key: 'bestMonth',
        label: 'Mejor mes',
        infoTitle: 'Mejor mes',
        infoBody: 'Mes con mayor retorno del período seleccionado.',
        formatter: (value) =>
          value.bestMonth
            ? `${monthLabelShort(value.bestMonth.monthKey)} · ${formatPctDecimal(value.bestMonth.returnPct)}`
            : '—',
      },
    ],
  },
  {
    section: 'Riesgo ajustado',
    metrics: [
      {
        key: 'sharpeSimple',
        label: 'Sharpe',
        infoTitle: 'Sharpe',
        infoBody:
          'Mide retorno anualizado por unidad de volatilidad. Mayor = mejor. En Aurum se calcula sobre retornos mensuales y tasa libre de riesgo 0% anual.',
        microcopy: 'mayor = mejor',
        formatter: (value) => formatPlainNumber(value.sharpeSimple, 2),
      },
      {
        key: 'sortinoSimple',
        label: 'Sortino',
        infoTitle: 'Sortino',
        infoBody:
          'Similar a Sharpe, pero penaliza solo la volatilidad negativa. Mayor = mejor. Útil para mirar riesgo de caídas.',
        microcopy: 'mayor = mejor',
        formatter: (value) => formatPlainNumber(value.sortinoSimple, 2),
      },
      {
        key: 'calmarSimple',
        label: 'Calmar',
        infoTitle: 'Calmar',
        infoBody:
          'Retorno anualizado dividido por máximo drawdown. Mayor = mejor. Si no hubo drawdown suficiente, puede mostrarse como —.',
        microcopy: 'mayor = mejor',
        formatter: (value) => formatPlainNumber(value.calmarSimple, 2),
      },
    ],
  },
  {
    section: 'Recuperación',
    metrics: [
      {
        key: 'recovery',
        label: 'Recuperación',
        infoTitle: 'Recuperación',
        infoBody:
          'Indica si la peor caída del período ya se recuperó. Si aplica, muestra cuántos meses tomó recuperarse.',
        formatter: (value) =>
          formatRecovery({
            isRecovered: value.isRecovered,
            maxDrawdownPct: value.maxDrawdownPct,
            monthsToRecovery: value.monthsToRecovery,
          }),
      },
      {
        key: 'ulcerIndex',
        label: 'Ulcer Index',
        infoTitle: 'Ulcer Index',
        infoBody:
          'Mide profundidad y duración de caídas. Menor = mejor. 0 indica ausencia de drawdowns mensuales.',
        microcopy: 'menor = mejor',
        formatter: (value) => formatPlainNumber(value.ulcerIndex, 3),
      },
    ],
  },
];

type HorizonConfig = {
  key: '3m' | '12m' | 'since_start';
  label: string;
  count: number | 'all';
};

const HORIZONS: HorizonConfig[] = [
  { key: '3m', label: '3M', count: 3 },
  { key: '12m', label: '12M', count: 12 },
  { key: 'since_start', label: 'Inicio', count: 'all' },
];

type MetricInfoDialogProps = {
  definition: MetricDefinition | null;
  onClose: () => void;
};

const MetricInfoDialog: React.FC<MetricInfoDialogProps> = ({ definition, onClose }) => {
  React.useEffect(() => {
    if (!definition) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [definition, onClose]);

  if (!definition) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-3 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Información: ${definition.label}`}
        className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{definition.infoTitle}</div>
            <div className="mt-1 text-sm leading-6 text-slate-600">{definition.infoBody}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ayuda"
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

type MetricComparisonCardProps = {
  definition: MetricDefinition;
  values: Array<{ horizonLabel: string; value: string; meta?: string | null }>;
  onOpenInfo: (definition: MetricDefinition) => void;
};

const MetricComparisonCard: React.FC<MetricComparisonCardProps> = ({ definition, values, onOpenInfo }) => (
  <div
    data-portfolio-metric-card="true"
    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
  >
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 lg:max-w-[28%]">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">{definition.label}</div>
          <button
            type="button"
            aria-label={`Información sobre ${definition.label}`}
            onClick={() => onOpenInfo(definition)}
            className="rounded-full border border-slate-200 p-1 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <Info size={14} />
          </button>
        </div>
        {definition.microcopy ? (
          <div className="mt-1 text-[11px] text-slate-500">{definition.microcopy}</div>
        ) : null}
      </div>

      <div className="grid flex-1 grid-cols-3 gap-2">
        {values.map((item) => (
          <div key={`${definition.key}-${item.horizonLabel}`} className="rounded-xl bg-slate-50 px-3 py-2 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{item.horizonLabel}</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 sm:text-base">{item.value}</div>
            {item.meta ? <div className="mt-1 text-[10px] text-slate-500">{item.meta}</div> : null}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export type PortfolioAnalyticsPanelProps = {
  monthlyRows: MonthlyReturnRow[];
  currency: WealthCurrency;
};

export const PortfolioAnalyticsPanel: React.FC<PortfolioAnalyticsPanelProps> = ({ monthlyRows, currency }) => {
  const [activeInfo, setActiveInfo] = React.useState<MetricDefinition | null>(null);

  const visibleSeries = React.useMemo(
    () =>
      [...monthlyRows]
        .filter((row) => Number.isFinite(row.pct))
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((row) => ({
          monthKey: row.monthKey,
          returnPct: Number(row.pct) / 100,
          isEstimated: Boolean(row.isEstimated),
        })),
    [monthlyRows],
  );

  const horizonResults = React.useMemo(
    () =>
      HORIZONS.map((horizon) => {
        const series =
          horizon.count === 'all'
            ? visibleSeries
            : visibleSeries.slice(Math.max(0, visibleSeries.length - horizon.count));
        return {
          horizon,
          series,
          result: calculatePortfolioAnalytics(series),
        };
      }),
    [visibleSeries],
  );

  const startHorizon = horizonResults.find((entry) => entry.horizon.key === 'since_start');
  const officialMonthsUsed = Math.max(
    0,
    Number(startHorizon?.result.monthsUsed ?? 0) - Number(startHorizon?.result.estimatedMonthsUsed ?? 0),
  );
  const estimatedMonthsUsed = Number(startHorizon?.result.estimatedMonthsUsed ?? 0);
  const lastMonthLabel = startHorizon?.result.lastMonthKey ? monthLabel(startHorizon.result.lastMonthKey) : null;
  const lastMonthTone = startHorizon?.result.lastMonthIsEstimated
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <>
      <Card className="border-slate-200 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portfolio Analytics</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Métricas sobre la serie mensual de retornos económicos.
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              {`Vista: ${currency}`}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
              {`Oficiales: ${officialMonthsUsed} meses`}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
              {`Estimados: ${estimatedMonthsUsed}`}
            </span>
            <span className={cn('rounded-full border px-2 py-0.5', lastMonthTone)}>
              {`Último mes: ${lastMonthLabel ?? '—'}${lastMonthLabel ? ` · ${startHorizon?.result.lastMonthIsEstimated ? 'estimado' : 'oficial'}` : ''}`}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {horizonResults.map(({ horizon, result }) => (
            <span
              key={horizon.key}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600"
            >
              {horizon.key === 'since_start' ? `${horizon.label} · ${result.monthsUsed} meses` : horizon.label}
            </span>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          {METRIC_DEFINITIONS.map((section) => (
            <section key={section.section}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{section.section}</div>
              <div className="space-y-2">
                {section.metrics.map((metric) => (
                  <MetricComparisonCard
                    key={metric.key}
                    definition={metric}
                    onOpenInfo={setActiveInfo}
                    values={horizonResults.map(({ horizon, result }) => ({
                      horizonLabel: horizon.label,
                      value: metric.formatter(result),
                    }))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <details className="mt-4 text-xs text-slate-600">
          <summary className="cursor-pointer select-none font-medium text-slate-700">Ver metodología</summary>
          <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div>Los retornos acumulados y anualizados se calculan de forma compuesta.</div>
            <div>Los promedios, mediana, percentiles y volatilidad describen retornos mensuales.</div>
            <div>No se usa promedio mensual lineal para calcular retornos de período.</div>
            <div>Drawdown mensual; no captura caídas intra-mes.</div>
            <div>Sharpe, Sortino y Calmar son indicadores simples.</div>
            <div>Tasa libre de riesgo usada: 0% anual.</div>
            <div>Meses estimados pueden cambiar al llegar el dato oficial.</div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Warnings del servicio</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {startHorizon && startHorizon.result.warnings.length > 0 ? (
                  startHorizon.result.warnings.map((warning) => (
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

      <MetricInfoDialog definition={activeInfo} onClose={() => setActiveInfo(null)} />
    </>
  );
};
