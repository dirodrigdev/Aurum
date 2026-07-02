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
  if (isRecovered === true && monthsToRecovery !== null) {
    return monthsToRecovery === 1 ? '1 mes' : `${monthsToRecovery} meses`;
  }
  if (isRecovered === true) return 'Recuperado';
  if (isRecovered === false) return 'No recuperado';
  return '—';
};

type MetricDisplayValue = {
  value: string;
  detail?: string;
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
  infoLimit?: string;
  microcopy?: string;
  scale?: {
    direction: 'higher_better' | 'lower_better' | 'less_negative_better';
    items: string[];
    note: string;
  };
  formatter: (value: ReturnType<typeof calculatePortfolioAnalytics>) => MetricDisplayValue;
};

const metricValue = (value: string, detail?: string): MetricDisplayValue => ({ value, detail });

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
        infoLimit: 'Se basa en la serie mensual visible en Aurum.',
        formatter: (value) => metricValue(formatPctDecimal(value.cumulativeReturnPct)),
      },
      {
        key: 'annualizedReturnPct',
        label: 'Retorno anualizado',
        infoTitle: 'Retorno anualizado',
        infoBody:
          'Convierte el retorno compuesto del período a una tasa anual equivalente. Es más útil para comparar horizontes distintos.',
        infoLimit: 'Puede variar si cambia la ventana o entran meses estimados.',
        formatter: (value) => metricValue(formatPctDecimal(value.annualizedReturnPct)),
      },
      {
        key: 'medianMonthlyReturnPct',
        label: 'Mediana mensual',
        infoTitle: 'Mediana mensual',
        infoBody:
          'Mes típico de retorno. La mitad de los meses quedó por encima y la mitad por debajo.',
        infoLimit: 'Describe retornos mensuales; no resume por sí sola el retorno acumulado.',
        formatter: (value) => metricValue(formatPctDecimal(value.medianMonthlyReturnPct)),
      },
      {
        key: 'winsorizedMeanMonthlyReturnPct',
        label: 'Promedio mensual sin outliers',
        infoTitle: 'Promedio mensual sin outliers',
        infoBody:
          'Promedio mensual ajustado para reducir el efecto de meses extremos. Sirve para ver una tendencia más estable.',
        infoLimit: 'Es una métrica descriptiva mensual, no un retorno acumulado.',
        formatter: (value) => metricValue(formatPctDecimal(value.winsorizedMeanMonthlyReturnPct)),
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
        infoLimit: 'Se calcula con retornos mensuales visibles, no con movimientos intra-mes.',
        scale: {
          direction: 'lower_better',
          items: ['0%–5% baja', '5%–10% moderada', '10%–20% alta', '>20% muy alta'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPctDecimal(value.volatilityAnnualizedPct)),
      },
      {
        key: 'maxDrawdownPct',
        label: 'Máx. drawdown',
        infoTitle: 'Máx. drawdown',
        infoBody:
          'Mayor caída desde un máximo hasta un mínimo dentro del período. Menos negativo = mejor.',
        infoLimit: 'Aurum usa drawdown mensual; no captura caídas intra-mes.',
        scale: {
          direction: 'less_negative_better',
          items: ['0% a -5% bajo', '-5% a -10% moderado', '-10% a -20% alto', '< -20% severo'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPctDecimal(value.maxDrawdownPct)),
      },
      {
        key: 'currentDrawdownPct',
        label: 'Drawdown actual',
        infoTitle: 'Drawdown actual',
        infoBody:
          'Caída actual desde el último máximo del período. Si es 0%, está en máximo o recuperado.',
        infoLimit: 'Se calcula sobre cierres mensuales visibles.',
        formatter: (value) => metricValue(formatPctDecimal(value.currentDrawdownPct)),
      },
      {
        key: 'worstMonth',
        label: 'Peor mes',
        infoTitle: 'Peor mes',
        infoBody: 'Mes con menor retorno del período seleccionado.',
        infoLimit: 'Identifica un mes puntual; no resume persistencia de caídas.',
        formatter: (value) =>
          value.worstMonth
            ? metricValue(formatPctDecimal(value.worstMonth.returnPct), monthLabelShort(value.worstMonth.monthKey))
            : metricValue('—'),
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
        infoLimit: 'No mide magnitud del retorno, solo frecuencia de meses positivos.',
        scale: {
          direction: 'higher_better',
          items: ['<45% débil', '45%–55% mixto', '55%–65% bueno', '>65% fuerte'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPctDecimal(value.positiveMonthsPct)),
      },
      {
        key: 'percentiles',
        label: 'P10 / P50 / P90',
        infoTitle: 'P10 / P50 / P90',
        infoBody:
          'Percentiles de retornos mensuales. P50 es la mediana; P10 muestra un mes débil típico; P90 muestra un mes fuerte típico.',
        infoLimit: 'Describen distribución mensual; no son metas ni garantías.',
        formatter: (value) =>
          value.percentiles.p50 === null
            ? metricValue('—')
            : metricValue(
                `${formatPctDecimal(value.percentiles.p10)} · ${formatPctDecimal(value.percentiles.p50)} · ${formatPctDecimal(value.percentiles.p90)}`,
              ),
      },
      {
        key: 'bestMonth',
        label: 'Mejor mes',
        infoTitle: 'Mejor mes',
        infoBody: 'Mes con mayor retorno del período seleccionado.',
        infoLimit: 'Es un extremo puntual y puede depender de un solo mes fuera de tendencia.',
        formatter: (value) =>
          value.bestMonth
            ? metricValue(formatPctDecimal(value.bestMonth.returnPct), monthLabelShort(value.bestMonth.monthKey))
            : metricValue('—'),
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
        infoLimit: 'Es un indicador simple; no reemplaza juicio de riesgo ni attribution.',
        scale: {
          direction: 'higher_better',
          items: ['<0 débil', '0–0,5 bajo', '0,5–1 razonable', '1–2 bueno', '>2 muy bueno'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPlainNumber(value.sharpeSimple, 2)),
      },
      {
        key: 'sortinoSimple',
        label: 'Sortino',
        infoTitle: 'Sortino',
        infoBody:
          'Similar a Sharpe, pero penaliza solo la volatilidad negativa. Mayor = mejor. Útil para mirar riesgo de caídas.',
        microcopy: 'mayor = mejor',
        infoLimit: 'Usa downside risk mensual visible; no mide colas extremas intra-mes.',
        scale: {
          direction: 'higher_better',
          items: ['<0 débil', '0–1 bajo/razonable', '1–2 bueno', '>2 muy bueno'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPlainNumber(value.sortinoSimple, 2)),
      },
      {
        key: 'calmarSimple',
        label: 'Calmar',
        infoTitle: 'Calmar',
        infoBody:
          'Retorno anualizado dividido por máximo drawdown. Mayor = mejor. Si no hubo drawdown suficiente, puede mostrarse como —.',
        microcopy: 'mayor = mejor',
        infoLimit: 'Es sensible a drawdowns cortos o atípicos dentro del horizonte.',
        scale: {
          direction: 'higher_better',
          items: ['<0 débil', '0–0,5 bajo', '0,5–1 razonable', '1–3 bueno', '>3 muy bueno'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPlainNumber(value.calmarSimple, 2)),
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
        infoLimit: 'Mira solo la peor caída del período visible.',
        formatter: (value) =>
          metricValue(
            formatRecovery({
              isRecovered: value.isRecovered,
              maxDrawdownPct: value.maxDrawdownPct,
              monthsToRecovery: value.monthsToRecovery,
            }),
          ),
      },
      {
        key: 'ulcerIndex',
        label: 'Ulcer Index',
        infoTitle: 'Ulcer Index',
        infoBody:
          'Mide profundidad y duración de caídas. Menor = mejor. 0 indica ausencia de drawdowns mensuales.',
        microcopy: 'menor = mejor',
        infoLimit: 'Se construye con drawdowns mensuales visibles, no diarios.',
        scale: {
          direction: 'lower_better',
          items: ['0 sin caídas', '0–2 muy bajo', '2–5 moderado', '5–10 elevado', '>10 alto'],
          note: 'Rangos referenciales; dependen del horizonte, moneda y perfil de riesgo.',
        },
        formatter: (value) => metricValue(formatPlainNumber(value.ulcerIndex, 3)),
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

const scaleGradientClass = (direction: 'higher_better' | 'lower_better' | 'less_negative_better') => {
  if (direction === 'higher_better') return 'bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400';
  return 'bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400';
};

type HintTone = 'good' | 'mixed' | 'risk';

const hintToneClass: Record<HintTone, string> = {
  good: 'bg-emerald-500',
  mixed: 'bg-amber-400',
  risk: 'bg-rose-500',
};

const getMetricHintTone = (
  definition: MetricDefinition,
  result: ReturnType<typeof calculatePortfolioAnalytics>,
): HintTone | null => {
  const valueByKey: Partial<Record<AnalyticsMetricKey, number | null>> = {
    volatilityAnnualizedPct: result.volatilityAnnualizedPct,
    maxDrawdownPct: result.maxDrawdownPct,
    positiveMonthsPct: result.positiveMonthsPct,
    sharpeSimple: result.sharpeSimple,
    sortinoSimple: result.sortinoSimple,
    calmarSimple: result.calmarSimple,
    ulcerIndex: result.ulcerIndex,
  };

  const value = valueByKey[definition.key];
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  if (definition.key === 'volatilityAnnualizedPct') {
    if (value <= 0.05) return 'good';
    if (value <= 0.1) return 'mixed';
    return 'risk';
  }
  if (definition.key === 'maxDrawdownPct') {
    if (value >= -0.05) return 'good';
    if (value >= -0.1) return 'mixed';
    return 'risk';
  }
  if (definition.key === 'positiveMonthsPct') {
    if (value >= 0.65) return 'good';
    if (value >= 0.45) return 'mixed';
    return 'risk';
  }
  if (definition.key === 'ulcerIndex') {
    if (value <= 2) return 'good';
    if (value <= 5) return 'mixed';
    return 'risk';
  }
  if (definition.key === 'calmarSimple') {
    if (value >= 1) return 'good';
    if (value >= 0.5) return 'mixed';
    return 'risk';
  }
  if (definition.key === 'sharpeSimple' || definition.key === 'sortinoSimple') {
    if (value >= 1) return 'good';
    if (value >= 0) return 'mixed';
    return 'risk';
  }

  return null;
};

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/35 px-3 pb-3 pt-[12vh] sm:pt-[10vh]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Información: ${definition.label}`}
        className="w-full max-w-lg rounded-[24px] border border-slate-200 bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{definition.infoTitle}</div>
            <div className="mt-1 text-sm leading-6 text-slate-600">{definition.infoBody}</div>
            {definition.infoLimit ? (
              <div className="mt-2 text-[12px] leading-5 text-slate-500">{definition.infoLimit}</div>
            ) : null}
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

        {definition.scale ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Escala referencial</div>
            <div className={cn('mt-2 h-2.5 rounded-full', scaleGradientClass(definition.scale.direction))} />
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
              {definition.scale.items.map((item) => (
                <span key={item} className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-5 text-slate-500">{definition.scale.note}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

type MetricComparisonCardProps = {
  definition: MetricDefinition;
  values: Array<{ horizonLabel: string; display: MetricDisplayValue; hintTone: HintTone | null }>;
  onOpenInfo: (definition: MetricDefinition) => void;
};

const MetricComparisonCard: React.FC<MetricComparisonCardProps> = ({ definition, values, onOpenInfo }) => (
  <div
    data-portfolio-metric-card="true"
    className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
  >
    <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1.35fr)_minmax(74px,0.65fr)_minmax(74px,0.65fr)_minmax(88px,0.75fr)] md:items-center md:gap-3">
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 text-sm font-semibold leading-5 text-slate-900">{definition.label}</div>
          <button
            type="button"
            aria-label={`Información sobre ${definition.label}`}
            onClick={() => onOpenInfo(definition)}
            className="mt-0.5 shrink-0 rounded-full border border-slate-200 p-1 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <Info size={14} />
          </button>
        </div>
        {definition.microcopy ? (
          <div className="mt-0.5 text-[11px] text-slate-500">{definition.microcopy}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 md:contents">
        {values.map((item) => (
          <div
            key={`${definition.key}-${item.horizonLabel}`}
            className="rounded-xl bg-slate-50 px-2.5 py-2 text-right md:bg-transparent md:px-0 md:py-0"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 md:hidden">{item.horizonLabel}</div>
            <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[13px] font-semibold text-slate-900 sm:text-sm">
              {item.hintTone ? (
                <span
                  aria-hidden="true"
                  data-testid="portfolio-interpretation-hint"
                  className={cn('h-1.5 w-1.5 rounded-full', hintToneClass[item.hintTone])}
                />
              ) : null}
              <span data-testid="portfolio-metric-value">{item.display.value}</span>
            </div>
            {item.display.detail ? (
              <div data-testid="portfolio-metric-detail" className="mt-0.5 text-[9px] text-slate-400 sm:text-[10px]">
                {item.display.detail}
              </div>
            ) : null}
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

        <div className="mt-4 space-y-4">
          {METRIC_DEFINITIONS.map((section) => (
            <section key={section.section}>
              <div
                data-testid="portfolio-section-header"
                className="mb-2 grid grid-cols-[minmax(0,1.35fr)_minmax(48px,0.65fr)_minmax(48px,0.65fr)_minmax(58px,0.75fr)] items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 md:grid-cols-[minmax(0,1.35fr)_minmax(74px,0.65fr)_minmax(74px,0.65fr)_minmax(88px,0.75fr)] md:gap-3 md:px-3"
              >
                <div className="text-[11px] text-slate-500">{section.section}</div>
                {HORIZONS.map((horizon) => (
                  <div key={horizon.key} className="text-right">
                    {horizon.label}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {section.metrics.map((metric) => (
                  <MetricComparisonCard
                    key={metric.key}
                    definition={metric}
                    onOpenInfo={setActiveInfo}
                    values={horizonResults.map(({ horizon, result }) => ({
                      horizonLabel: horizon.label,
                      display: metric.formatter(result),
                      hintTone: getMetricHintTone(metric, result),
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
            <div>Las escalas de interpretación son referenciales.</div>

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
