import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, ChevronRight, Home, RefreshCcw, Shield, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, cn } from '../components/Components';
import { formatFreedomCompactClp, formatPct } from '../components/analysis/shared';
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
import { buildTrailingSummary, computeMonthlyRows } from '../services/returnsAnalysis';

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
  <Card className={cn('relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-3.5 shadow-[0_14px_34px_rgba(15,23,42,0.07)] sm:p-4', className)}>
    <div className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-50 text-slate-500 sm:h-10 sm:w-10">
      <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
    </div>
    <div className="min-w-0 pr-8 sm:pr-11">
      <div className={cn('text-[7px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:text-[8px] sm:tracking-[0.18em]', labelClassName)}>{label}</div>
      <div className={cn('mt-7 text-[clamp(1.5rem,5vw,2.3rem)] font-semibold leading-none tracking-[-0.06em] sm:mt-8', tone === 'neutral' ? 'text-slate-900' : toneClasses[tone], valueClassName)}>{value}</div>
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
      'rounded-[28px] border bg-[radial-gradient(circle_at_top_right,_rgba(99,245,177,0.08),_transparent_28%),linear-gradient(145deg,#071834_0%,#0d2449_52%,#08142d_100%)] p-4 text-white shadow-[0_22px_60px_rgba(3,10,26,0.28)] sm:p-5',
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
    <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-3.5">
      <div className="border-b border-white/10 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">USD</div>
        <div className="mt-2 text-[clamp(1.65rem,6.8vw,2.45rem)] font-semibold leading-none tracking-[-0.06em] text-emerald-300">{usdValue}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">UF</div>
        <div className="mt-2 text-[clamp(1.65rem,6.8vw,2.45rem)] font-semibold leading-none tracking-[-0.06em] text-emerald-300">{ufValue}</div>
      </div>
    </div>
    <div className="mt-4 border-t border-white/10 pt-3 text-[13px] text-slate-300/84">
      <div>{footer}</div>
    </div>
  </Card>
);

const CompactInfoCard = ({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</div>
    <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-900">{value}</div>
    <div className="mt-1 text-[11px] text-slate-500">{subtitle}</div>
  </div>
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

export const DashboardAurum: React.FC = () => {
  const navigate = useNavigate();
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => sortClosures(loadClosures()));
  const [records, setRecords] = useState<WealthRecord[]>(() => loadWealthRecords());
  const [fx, setFx] = useState<WealthFxRates>(() => loadFxRates());
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
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      refreshDashboardState();
    };

    refreshDashboardState();
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      refreshDashboardState as EventListener,
    );
    return () => {
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
  }, [closures, includeRiskCapitalInTotals]);

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
        <div className="grid grid-cols-3 gap-3">
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
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f4d03f]">Insight ejecutivo</div>
            <div className="mt-1.5 text-[15px] font-semibold leading-snug text-white sm:text-base">{model.insight}</div>
          </div>
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#f4d03f]">
            <ChevronRight className="h-5 w-5" />
          </div>
        </div>
      </Card>

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

      <Card data-testid="dashboard-secondary" className="rounded-[28px] border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Accesos secundarios</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-slate-200 bg-slate-50 px-3 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            onClick={() => navigate('/analysis', { state: { analysisTab: 'returns' } })}
          >
            Ver Retornos
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-slate-200 bg-slate-50 px-3 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            onClick={() => navigate('/analysis', { state: { analysisTab: 'freedom' } })}
          >
            <BrainCircuit className="mr-1 h-3.5 w-3.5" />
            Ver Libertad Financiera
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-slate-200 bg-slate-50 px-3 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            onClick={() => navigate('/analysis', { state: { analysisTab: 'lab' } })}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Ver Lab
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-slate-200 bg-slate-50 px-3 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            onClick={refreshDashboardState}
          >
            <RefreshCcw className="mr-1 h-3.5 w-3.5" />
            Actualizar datos
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CompactInfoCard
            title="Dependencia CapRiesgo"
            value={model.capRiskDependence.level}
            subtitle={model.capRiskDependence.dependenceSummary}
          />
          <CompactInfoCard
            title="Impacto en cobertura"
            value={
              model.capRiskDependence.impactRatioDelta === null
                ? '—'
                : `${model.capRiskDependence.impactRatioDelta >= 0 ? '+' : ''}${model.capRiskDependence.impactRatioDelta.toLocaleString('es-CL', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}x`
            }
            subtitle={model.capRiskDependence.impactSummary}
          />
        </div>
      </Card>
    </div>
  );
};
