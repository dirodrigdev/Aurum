import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, CalendarRange, ChevronRight, Home, Landmark, LineChart, Network, RefreshCcw, Settings, Shield, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, cn } from '../components/Components';
import { formatFreedomCompactClp, formatPct } from '../components/analysis/shared';
import type { ReturnCurvePoint } from '../components/analysis/types';
import {
  GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
  warmGastappMonthlyContable,
} from '../services/gastosMonthly';
import {
  FX_RATES_UPDATED_EVENT,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  loadClosures,
  loadFxRates,
  loadIncludeRiskCapitalInTotals,
  loadWealthRecords,
  saveIncludeRiskCapitalInTotals,
  type WealthFxRates,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../services/wealthStorage';
import {
  DASHBOARD_LIFE_BASELINE_CLP,
  buildExecutiveDashboardModel,
  type DashboardCoverageTone,
} from '../services/dashboardExecutive';
import { buildTrailingSummary, buildWealthEvolutionComparisonModel, computeMonthlyRows } from '../services/returnsAnalysis';

const sortClosures = (items: WealthMonthlyClosure[]) => [...items].sort((a, b) => b.monthKey.localeCompare(a.monthKey));

const toneClasses: Record<DashboardCoverageTone, string> = {
  positive: 'text-emerald-300',
  warning: 'text-amber-200',
  negative: 'text-rose-200',
  neutral: 'text-slate-100',
};

const freshnessBarSegments = [
  { key: 'fresh7dPct', label: '≤ 7 días', className: 'bg-emerald-400' },
  { key: 'aging30dPct', label: '8–30 días', className: 'bg-amber-300' },
  { key: 'stalePct', label: '> 30 días', className: 'bg-rose-300' },
] as const;

const formatDashboardCompactClp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}$${scaled}MM`;
  }
  return formatFreedomCompactClp(value);
};

const ExecutivePositionCard = ({
  label,
  value,
  subtitle,
  tone,
  icon: Icon,
  className,
  valueClassName,
  subtitleClassName,
  labelClassName,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: DashboardCoverageTone;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
  valueClassName?: string;
  subtitleClassName?: string;
  labelClassName?: string;
}) => (
  <Card className={cn('relative min-w-0 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-3.5 shadow-[0_14px_34px_rgba(15,23,42,0.07)] sm:p-4', className)}>
    <div className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-50 text-slate-500 sm:h-10 sm:w-10">
      <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
    </div>
    <div className="min-w-0 pr-8 sm:pr-11">
      <div className={cn('min-h-[3.45rem] text-[7px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:min-h-[3.9rem] sm:text-[8px] sm:tracking-[0.18em]', labelClassName)}>{label}</div>
      <div className={cn('dashboard-position-value mt-2 font-semibold leading-none tracking-[-0.06em]', tone === 'neutral' ? 'text-slate-900' : toneClasses[tone], valueClassName)}>{value}</div>
      <div className={cn('mt-2 text-[12px] leading-tight text-slate-500 sm:text-[13px]', subtitleClassName)}>{subtitle}</div>
    </div>
  </Card>
);

const ExecutiveReturnCard = ({
  title,
  usdValue,
  ufValue,
  footer,
  emphasis,
  badge,
  testId,
}: {
  title: string;
  usdValue: string;
  ufValue: string;
  footer: string;
  emphasis: 'primary' | 'secondary';
  badge?: string;
  testId: string;
}) => (
  <Card
    data-testid={testId}
    data-emphasis={emphasis}
    className={cn(
      'dashboard-return-card min-w-0 rounded-[28px] border bg-[radial-gradient(circle_at_top_right,_rgba(99,245,177,0.08),_transparent_28%),linear-gradient(145deg,#071834_0%,#0d2449_52%,#08142d_100%)] p-4 text-white shadow-[0_22px_60px_rgba(3,10,26,0.28)] sm:p-5',
      emphasis === 'primary'
        ? 'border-emerald-400/30 ring-1 ring-emerald-300/15'
        : 'border-white/10 opacity-[0.94]',
    )}
  >
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-300/84">{title}</div>
        {badge ? (
          <div className="mt-2 inline-flex rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
            {badge}
          </div>
        ) : null}
      </div>
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-emerald-300 sm:h-10 sm:w-10">
        <TrendingUp className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
      </div>
    </div>
    <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 sm:gap-3.5">
      <div className="min-w-0 border-r border-white/10 pb-3 pr-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">USD</div>
        <div className="dashboard-return-value mt-2 font-semibold leading-none tracking-[-0.06em] text-emerald-300">{usdValue}</div>
      </div>
      <div className="min-w-0 pb-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">UF</div>
        <div className="dashboard-return-value mt-2 font-semibold leading-none tracking-[-0.06em] text-emerald-300">{ufValue}</div>
      </div>
    </div>
    <div className="mt-4 border-t border-white/10 pt-3 text-[13px] text-slate-300/84">
      <div>{footer}</div>
    </div>
  </Card>
);

const DashboardBar = ({
  values,
}: {
  values: Array<{ label: string; pct: number; className: string }>;
}) => (
  <div className="space-y-3">
    <div className="overflow-hidden rounded-full border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex h-2 overflow-hidden rounded-full bg-[#091427]">
        {values.map((item) => (
          <div
            key={item.label}
            className={item.className}
            style={{ width: `${Math.max(0, Math.min(100, item.pct * 100))}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
      {values.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', item.className)} />
          {item.label}
        </span>
      ))}
    </div>
  </div>
);

const formatChartValue = (value: number | null, unit: 'UF' | 'USD') => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === 'UF') {
    return `${Math.round(value).toLocaleString('es-CL')} UF`;
  }
  return `US$${(value / 1_000_000).toLocaleString('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}M`;
};

const curvePath = (
  points: ReturnCurvePoint[],
  pointX: (point: ReturnCurvePoint) => number,
  pointY: (value: number, series: 'uf' | 'usd') => number,
  series: 'uf' | 'usd',
) =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(point).toFixed(2)} ${pointY(point.value, series).toFixed(2)}`)
    .join(' ');

const buildTrendPoints = (
  points: ReturnCurvePoint[],
  monthIndex: Map<string, number>,
): ReturnCurvePoint[] => {
  const valid = points
    .map((point) => {
      const x = monthIndex.get(point.monthKey);
      if (x === undefined || !Number.isFinite(point.value)) return null;
      return { point, x };
    })
    .filter((item): item is { point: ReturnCurvePoint; x: number } => !!item);

  if (valid.length < 2) return [];

  const n = valid.length;
  const sumX = valid.reduce((sum, item) => sum + item.x, 0);
  const sumY = valid.reduce((sum, item) => sum + item.point.value, 0);
  const sumXY = valid.reduce((sum, item) => sum + item.x * item.point.value, 0);
  const sumXX = valid.reduce((sum, item) => sum + item.x * item.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 1e-9) return [];

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const first = valid[0];
  const last = valid[valid.length - 1];

  return [
    {
      id: `${first.point.id}-trend-start`,
      monthKey: first.point.monthKey,
      value: intercept + slope * first.x,
    },
    {
      id: `${last.point.id}-trend-end`,
      monthKey: last.point.monthKey,
      value: intercept + slope * last.x,
    },
  ];
};

const DashboardWealthEvolutionChart = ({
  ufPoints,
  usdPoints,
}: {
  ufPoints: ReturnCurvePoint[];
  usdPoints: ReturnCurvePoint[];
}) => {
  const months = Array.from(new Set([...ufPoints, ...usdPoints].map((point) => point.monthKey))).sort();
  if (months.length < 2 || ufPoints.length < 2 || usdPoints.length < 2) {
    return (
      <Card data-testid="dashboard-evolution" className="rounded-[28px] border-white/10 bg-[#0a1630] p-4 text-white shadow-[0_18px_50px_rgba(3,10,26,0.22)]">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/88">
          <LineChart className="h-4 w-4 text-emerald-300" />
          Evolución patrimonial
        </div>
        <div className="mt-3 text-sm text-slate-300">Aún faltan cierres auditables para comparar UF y USD.</div>
      </Card>
    );
  }

  const width = 640;
  const height = 178;
  const padding = { top: 14, right: 22, bottom: 24, left: 22 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const monthIndex = new Map(months.map((monthKey, index) => [monthKey, index]));
  const scale = (points: ReturnCurvePoint[]) => {
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(1, (max - min) * 0.12);
    return { min: min - pad, max: max + pad };
  };
  const ufScale = scale(ufPoints);
  const usdScale = scale(usdPoints);
  const pointX = (point: ReturnCurvePoint) => {
    const index = monthIndex.get(point.monthKey) ?? 0;
    return padding.left + (innerWidth * index) / Math.max(1, months.length - 1);
  };
  const pointY = (value: number, series: 'uf' | 'usd') => {
    const domain = series === 'uf' ? ufScale : usdScale;
    return padding.top + ((domain.max - value) / Math.max(1e-6, domain.max - domain.min)) * innerHeight;
  };
  const ufTrendPoints = buildTrendPoints(ufPoints, monthIndex);
  const usdTrendPoints = buildTrendPoints(usdPoints, monthIndex);
  const lastUf = ufPoints[ufPoints.length - 1]?.value ?? null;
  const lastUsd = usdPoints[usdPoints.length - 1]?.value ?? null;

  return (
    <Card data-testid="dashboard-evolution" className="rounded-[28px] border-white/10 bg-[linear-gradient(145deg,#071834_0%,#0d2449_52%,#08142d_100%)] p-4 text-white shadow-[0_18px_50px_rgba(3,10,26,0.24)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/88">
            <LineChart className="h-4 w-4 text-emerald-300" />
            Evolución patrimonial
          </div>
          <div className="mt-1 text-sm text-slate-300">Patrimonio expresado en UF y USD.</div>
        </div>
      </div>
      <div className="mt-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Evolución patrimonial en UF y USD">
          <text x={padding.left} y="12" fontSize="14" fontWeight="700" fill="#6ee7b7">
            UF
          </text>
          <text x={width - padding.right} y="12" textAnchor="end" fontSize="14" fontWeight="700" fill="#93c5fd">
            USD
          </text>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1={padding.left}
              x2={width - padding.right}
              y1={padding.top + innerHeight * ratio}
              y2={padding.top + innerHeight * ratio}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          ))}
          {ufTrendPoints.length ? (
            <path d={curvePath(ufTrendPoints, pointX, pointY, 'uf')} fill="none" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" strokeDasharray="7 7" opacity="0.46" />
          ) : null}
          {usdTrendPoints.length ? (
            <path d={curvePath(usdTrendPoints, pointX, pointY, 'usd')} fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeDasharray="7 7" opacity="0.46" />
          ) : null}
          <path d={curvePath(ufPoints, pointX, pointY, 'uf')} fill="none" stroke="#6ee7b7" strokeWidth="3.2" strokeLinecap="round" />
          <path d={curvePath(usdPoints, pointX, pointY, 'usd')} fill="none" stroke="#93c5fd" strokeWidth="3.2" strokeLinecap="round" />
          {[ufPoints[ufPoints.length - 1], usdPoints[usdPoints.length - 1]].map((point, index) => (
            <circle
              key={`${point.id}-${index}`}
              cx={pointX(point)}
              cy={pointY(point.value, index === 0 ? 'uf' : 'usd')}
              r="4"
              fill={index === 0 ? '#6ee7b7' : '#93c5fd'}
            />
          ))}
          <text x={padding.left} y={height - 6} fontSize="10" fill="rgba(226,232,240,0.72)">
            {months[0].slice(2)}
          </text>
          <text x={width - padding.right} y={height - 6} textAnchor="end" fontSize="10" fill="rgba(226,232,240,0.72)">
            {months[months.length - 1].slice(2)}
          </text>
        </svg>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-300/8 px-2 py-1">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          UF {formatChartValue(lastUf, 'UF')}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300/15 bg-blue-300/8 px-2 py-1">
          <span className="h-2 w-2 rounded-full bg-blue-300" />
          USD {formatChartValue(lastUsd, 'USD')}
        </span>
      </div>
    </Card>
  );
};

const DashboardCapRiskCard = ({
  level,
  dependenceSummary,
  impactValue,
  impactSummary,
}: {
  level: string;
  dependenceSummary: string;
  impactValue: string;
  impactSummary: string;
}) => (
  <Card data-testid="dashboard-cap-risk" className="rounded-[28px] border border-emerald-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(110,231,183,0.12),_transparent_34%),linear-gradient(145deg,#071834_0%,#102549_100%)] p-4 text-white shadow-[0_18px_50px_rgba(3,10,26,0.22)]">
    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/88">Dependencia CapRiesgo</div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div className="border-r border-white/10 pr-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/80">Dependencia</div>
        <div className="mt-2 text-[1.7rem] font-semibold leading-none tracking-[-0.04em] text-emerald-300">{level}</div>
        <div className="mt-2 text-[12px] leading-snug text-slate-300">{dependenceSummary}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/80">Cobertura</div>
        <div className="mt-2 text-[1.7rem] font-semibold leading-none tracking-[-0.04em] text-emerald-300">{impactValue}</div>
        <div className="mt-2 text-[12px] leading-snug text-slate-300">{impactSummary}</div>
      </div>
    </div>
  </Card>
);

const DashboardNavCard = ({
  title,
  subtitle,
  icon: Icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex min-h-[5.1rem] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
  >
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-600 group-hover:text-emerald-500">
      <Icon className="h-5 w-5" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold leading-tight text-slate-900">{title}</span>
      <span className="mt-1 block text-[11px] leading-tight text-slate-500">{subtitle}</span>
    </span>
    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-emerald-400" />
  </button>
);

export const DashboardAurum: React.FC = () => {
  const navigate = useNavigate();
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => sortClosures(loadClosures()));
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [fx, setFx] = useState<WealthFxRates>(() => loadFxRates());
  const [gastosSourceVersion, setGastosSourceVersion] = useState(0);
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState<boolean>(() =>
    loadIncludeRiskCapitalInTotals(),
  );

  const refreshDashboardState = useCallback(() => {
    setClosures(sortClosures(loadClosures()));
    setRecords(loadWealthRecords());
    setFx(loadFxRates());
    setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
  }, []);

  useEffect(() => {
    const onGastappSourceUpdated = () => setGastosSourceVersion((current) => current + 1);
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      refreshDashboardState();
    };

    refreshDashboardState();
    void warmGastappMonthlyContable();
    window.addEventListener(
      GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
      onGastappSourceUpdated as EventListener,
    );
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      refreshDashboardState as EventListener,
    );
    return () => {
      window.removeEventListener(
        GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT,
        onGastappSourceUpdated as EventListener,
      );
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshDashboardState as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        refreshDashboardState as EventListener,
      );
    };
  }, [refreshDashboardState]);

  const model = useMemo(
    () =>
      buildExecutiveDashboardModel({
        closures,
        records,
        fx,
        includeRiskCapitalInTotals,
        lifeBaselineClp: DASHBOARD_LIFE_BASELINE_CLP,
      }),
    [closures, records, fx, includeRiskCapitalInTotals],
  );

  const freshnessKpi = useMemo(() => {
    if (model.freshness.status !== 'ok' || model.freshness.fresh7dPct === null) return '—';
    return `${Math.round(model.freshness.fresh7dPct * 100)}%`;
  }, [model.freshness]);

  const dashboardReturns = useMemo(() => {
    const usdRows = computeMonthlyRows(closures, includeRiskCapitalInTotals, 'USD');
    const ufRows = computeMonthlyRows(closures, includeRiskCapitalInTotals, 'UF');
    return {
      return36Usd: buildTrailingSummary(usdRows, 36, 'dashboard-36m-usd', 'RETORNO 36M'),
      return36Uf: buildTrailingSummary(ufRows, 36, 'dashboard-36m-uf', 'RETORNO 36M'),
      return12Usd: buildTrailingSummary(usdRows, 12, 'dashboard-12m-usd', 'RETORNO 12M'),
      return12Uf: buildTrailingSummary(ufRows, 12, 'dashboard-12m-uf', 'RETORNO 12M'),
    };
  }, [closures, includeRiskCapitalInTotals, gastosSourceVersion]);

  const wealthEvolution = useMemo(
    () => buildWealthEvolutionComparisonModel(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );

  const heroMessage = useMemo(() => {
    if (model.coverageRatio === null) return 'Necesitas al menos un cierre confirmado para construir esta lectura.';
    if (model.coverageRatio < 1) return 'Hoy tu patrimonio no sostiene tu vida actual.';
    if ((model.marginClp ?? 0) < 0) return 'Tu cobertura existe, pero el margen todavía es negativo.';
    if ((model.marginClp ?? 0) < 500_000) return 'Puedes sostener tu vida actual, pero con un margen muy corto.';
    return 'Puedes sostener tu vida actual con un margen positivo.';
  }, [model.coverageRatio, model.marginClp]);

  const returnFootnote = (label: string, validMonths: number | null | undefined, expectedMonths: number) => {
    if (!validMonths || validMonths <= 0) return `Sin base suficiente para ${label}`;
    if (validMonths < expectedMonths) return `${validMonths} meses válidos`;
    return `Últimos ${expectedMonths} meses`;
  };

  const capRiskImpactValue =
    model.capRiskDependence.impactRatioDelta === null
      ? '—'
      : `${model.capRiskDependence.impactRatioDelta >= 0 ? '+' : ''}${model.capRiskDependence.impactRatioDelta.toLocaleString('es-CL', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}x`;

  return (
    <div className="space-y-4 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.08),transparent_38%)] px-3 py-2.5 sm:space-y-5 sm:px-4">
      <section
        data-testid="dashboard-hero"
        className="relative overflow-hidden rounded-[32px] border border-[#5c4b3d] bg-[radial-gradient(circle_at_top_right,_rgba(99,245,177,0.10),_transparent_30%),linear-gradient(145deg,#071834_0%,#0d2449_50%,#08142d_100%)] p-4 text-white shadow-[0_28px_90px_rgba(3,10,26,0.34)] sm:p-5"
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_40%,rgba(255,255,255,0.01))]" />
        <div className="relative space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[#d5c0a6]">Salud patrimonial</div>
              <h1 className="max-w-xl text-[28px] font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-[34px]">
                ¿Tu patrimonio sostiene tu vida actual?
              </h1>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !includeRiskCapitalInTotals;
                setIncludeRiskCapitalInTotals(next);
                saveIncludeRiskCapitalInTotals(next);
              }}
              aria-label={includeRiskCapitalInTotals ? 'Desactivar CapRiesgo' : 'Activar CapRiesgo'}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-[18px] border transition sm:h-12 sm:w-12',
                includeRiskCapitalInTotals
                  ? 'border-[#d4a017] bg-[#fff6df] text-[#c77300] shadow-[0_0_0_2px_rgba(212,160,23,0.14)]'
                  : 'border-white/20 bg-white/5 text-slate-300 hover:bg-white/10',
              )}
            >
              <Zap className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-2.5">
            <div className={cn('text-[4.05rem] font-semibold leading-none tracking-[-0.08em] sm:text-[5.15rem]', toneClasses[model.coverageTone])}>
              {model.coverageHeadline}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-left">
                {model.heroSensitivity.map((scenario) => (
                  <div
                    key={scenario.annualRatePct}
                    className="inline-flex items-center rounded-full border border-white/7 bg-white/[0.03] px-2.5 py-1 text-[13px] font-medium tracking-[-0.02em] text-slate-300/72 sm:text-[15px]"
                  >
                    <span className="text-slate-200/88">{scenario.coverageHeadline}</span>
                    <span className="ml-2 text-slate-400/80">{scenario.annualRatePct}%</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="border-t border-white/8 pt-3.5">
            <div className="flex items-center gap-2 text-[15px] text-slate-200/88">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span>{heroMessage}</span>
            </div>
          </div>
        </div>
      </section>

      <section data-testid="dashboard-returns" className="space-y-2.5">
        <div className="px-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Rendimiento anualizado compuesto</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ExecutiveReturnCard
            testId="dashboard-return-36m"
            title="Retorno 36M"
            badge="Largo plazo"
            emphasis="primary"
            usdValue={formatPct(dashboardReturns.return36Usd?.pctRetorno ?? null, 1)}
            ufValue={formatPct(dashboardReturns.return36Uf?.pctRetorno ?? null, 1)}
            footer={returnFootnote('36M', dashboardReturns.return36Usd?.validMonths, 36)}
          />
          <ExecutiveReturnCard
            testId="dashboard-return-12m"
            title="Retorno 12M"
            emphasis="secondary"
            usdValue={formatPct(dashboardReturns.return12Usd?.pctRetorno ?? null, 1)}
            ufValue={formatPct(dashboardReturns.return12Uf?.pctRetorno ?? null, 1)}
            footer={returnFootnote('12M', dashboardReturns.return12Usd?.validMonths, 12)}
          />
        </div>
      </section>

      <section data-testid="dashboard-position" className="space-y-2.5">
        <div className="px-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Tu posición financiera</div>
        </div>
        <div className="dashboard-position-grid grid min-w-0 grid-cols-3 gap-3">
        <ExecutivePositionCard
          label={model.cards.sustainable.label}
          value={formatDashboardCompactClp(model.cards.sustainable.valueClp)}
          subtitle={model.cards.sustainable.subtitle}
          tone={model.cards.sustainable.tone}
          icon={Shield}
        />
        <ExecutivePositionCard
          label={model.cards.lifestyle.label}
          value={formatDashboardCompactClp(model.cards.lifestyle.valueClp)}
          subtitle={model.cards.lifestyle.subtitle}
          tone={model.cards.lifestyle.tone}
          icon={Home}
          className="border-[#eadcca] bg-[linear-gradient(180deg,rgba(255,250,244,0.98),rgba(247,238,228,0.94))]"
          labelClassName="text-[#8a6541]"
          valueClassName="text-[#b68357]"
          subtitleClassName="text-[#7d6850]"
        />
        <ExecutivePositionCard
          label={model.cards.margin.label}
          value={formatDashboardCompactClp(model.cards.margin.valueClp)}
          subtitle={model.cards.margin.subtitle}
          tone={model.cards.margin.tone}
          icon={TrendingUp}
        />
        </div>
      </section>

      <Card
        data-testid="dashboard-insight"
        className={cn(
          'rounded-[26px] border p-3.5 shadow-[0_12px_30px_rgba(3,10,26,0.12)] sm:p-4',
          model.coverageTone === 'positive'
            ? 'border-emerald-400/12 bg-[#0a1630] text-emerald-50'
            : model.coverageTone === 'warning'
              ? 'border-amber-300/14 bg-[#0a1630] text-amber-50'
              : model.coverageTone === 'negative'
                ? 'border-rose-300/14 bg-[#0a1630] text-rose-50'
                : 'border-white/8 bg-[#0a1630] text-slate-50',
        )}
      >
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f4d03f]">Insight ejecutivo</div>
          <div className="mt-1.5 text-[15px] font-semibold leading-snug text-white sm:text-base">{model.insight}</div>
        </div>
      </Card>

      <DashboardCapRiskCard
        level={model.capRiskDependence.level}
        dependenceSummary={model.capRiskDependence.dependenceSummary}
        impactValue={capRiskImpactValue}
        impactSummary={model.capRiskDependence.impactSummary}
      />

      <DashboardWealthEvolutionChart
        ufPoints={wealthEvolution.ufSeries.points}
        usdPoints={wealthEvolution.usdSeries.points}
      />

      <section data-testid="dashboard-quality" className="space-y-2.5">
        <div className="px-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Calidad del patrimonio</div>
        </div>
        <Card className="rounded-[28px] border-white/10 bg-[linear-gradient(180deg,rgba(14,37,77,0.98),rgba(9,23,49,0.95))] p-4 text-white shadow-[0_18px_50px_rgba(3,10,26,0.28)] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-emerald-300 sm:h-14 sm:w-14">
                <Shield className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300/88">Frescura patrimonial</div>
                <div className="mt-1.5 text-[3rem] font-semibold leading-none tracking-[-0.05em] text-emerald-300">{freshnessKpi}</div>
                <div className="mt-2 text-sm text-slate-200/82">Patrimonio actualizado ≤ 7 días.</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 lg:max-w-[30rem]">
              <DashboardBar
                values={freshnessBarSegments.map((segment) => ({
                  label: segment.label,
                  pct: model.freshness[segment.key] ?? 0,
                  className: segment.className,
                }))}
              />
              {model.freshness.riskCapitalExcluded ? (
                <div className="mt-3 text-[11px] text-slate-400">CapRiesgo excluido de esta lectura.</div>
              ) : null}
            </div>
          </div>
        </Card>
      </section>

      <section data-testid="dashboard-secondary" className="space-y-2.5">
        <div className="px-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Explorar Aurum</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DashboardNavCard
            title="Retornos"
            subtitle="Serie histórica y retorno económico"
            icon={TrendingUp}
            onClick={() => navigate('/analysis', { state: { analysisTab: 'returns' } })}
          />
          <DashboardNavCard
            title="Libertad"
            subtitle="Capacidad, retiro y escenarios"
            icon={BrainCircuit}
            onClick={() => navigate('/analysis', { state: { analysisTab: 'freedom' } })}
          />
          <DashboardNavCard
            title="Patrimonio"
            subtitle="Activos, deuda y detalle vivo"
            icon={Landmark}
            onClick={() => navigate('/patrimonio')}
          />
          <DashboardNavCard
            title="Cierre"
            subtitle="Preflight y cierre mensual"
            icon={CalendarRange}
            onClick={() => navigate('/closing')}
          />
          <DashboardNavCard
            title="Lab"
            subtitle="Simulaciones y sensibilidad"
            icon={Sparkles}
            onClick={() => navigate('/analysis', { state: { analysisTab: 'lab' } })}
          />
          <DashboardNavCard
            title="Ajustes"
            subtitle="Sincronización y fuentes"
            icon={Settings}
            onClick={() => navigate('/settings')}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 rounded-full border border-slate-200 bg-white px-3 text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-slate-50 hover:text-slate-900"
          onClick={refreshDashboardState}
        >
          <RefreshCcw className="mr-1 h-3.5 w-3.5" />
          Actualizar datos
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="mt-1 rounded-full border-emerald-200 bg-emerald-50 px-3 text-emerald-800 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-emerald-100"
          onClick={() => navigate('/ecosystem')}
        >
          <Network className="mr-1 h-3.5 w-3.5" />
          Ver ecosistema
        </Button>
      </section>
    </div>
  );
};
