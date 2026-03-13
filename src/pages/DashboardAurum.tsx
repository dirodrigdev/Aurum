import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, RefreshCcw, Sparkles, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, cn } from '../components/Components';
import { formatFreedomCompactClp, monthKeyToYearLabel } from '../components/analysis/shared';
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
  DASHBOARD_EXECUTIVE_ASSUMPTIONS,
  DASHBOARD_LIFE_BASELINE_CLP,
  buildExecutiveDashboardModel,
  type DashboardCoverageTone,
} from '../services/dashboardExecutive';

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

const DashboardMetricCard = ({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: DashboardCoverageTone;
}) => (
  <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-4 backdrop-blur-sm shadow-[0_16px_40px_rgba(3,10,26,0.24)] sm:p-5">
    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/88">{label}</div>
    <div className={cn('mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-[2.15rem]', toneClasses[tone])}>{value}</div>
    <div className="mt-2 text-sm text-slate-200/82">{subtitle}</div>
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
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      refreshDashboardState as EventListener,
    );
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, refreshDashboardState as EventListener);
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

  const sourceLabel = useMemo(() => monthKeyToYearLabel(model.sourceMonthKey), [model.sourceMonthKey]);
  const baselineLabel = useMemo(
    () => formatFreedomCompactClp(DASHBOARD_EXECUTIVE_ASSUMPTIONS.lifeBaselineClp),
    [],
  );
  const freshnessKpi = useMemo(() => {
    if (model.freshness.status !== 'ok' || model.freshness.fresh7dPct === null) return '—';
    return `${Math.round(model.freshness.fresh7dPct * 100)}%`;
  }, [model.freshness]);

  return (
    <div className="space-y-4 px-3 py-2 sm:space-y-5 sm:px-4">
      <section className="relative overflow-hidden rounded-[30px] border border-[#5c4b3d] bg-[radial-gradient(circle_at_top_right,_rgba(181,126,74,0.18),_transparent_32%),linear-gradient(145deg,#071834_0%,#0d2449_50%,#08142d_100%)] p-5 text-white shadow-[0_28px_90px_rgba(3,10,26,0.46)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_40%,rgba(255,255,255,0.01))]" />
        <div className="relative space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[#d5c0a6]">Dashboard ejecutivo</div>
              <h1 className="max-w-xl text-[29px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[34px]">
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
                'inline-flex h-12 w-12 items-center justify-center rounded-full border transition',
                includeRiskCapitalInTotals
                  ? 'border-[#d4a017] bg-[#fff6df] text-[#c77300] shadow-[0_0_0_2px_rgba(212,160,23,0.14)]'
                  : 'border-white/20 bg-white/5 text-slate-300 hover:bg-white/10',
              )}
            >
              <Zap className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className={cn('text-[4.25rem] font-semibold leading-none tracking-[-0.07em] sm:text-[5.35rem]', toneClasses[model.coverageTone])}>
                {model.coverageHeadline}
              </div>
              <div className="flex flex-col gap-1.5 self-start rounded-2xl border border-white/8 bg-white/4 px-3 py-2 text-left sm:min-w-[124px] sm:self-auto sm:bg-transparent sm:px-0 sm:py-0">
                {model.heroSensitivity.map((scenario) => (
                  <div
                    key={scenario.annualRatePct}
                    className="text-sm font-medium tracking-[-0.02em] text-slate-300/78 sm:text-[15px]"
                  >
                    <span className="text-slate-200/88">{scenario.coverageHeadline}</span>
                    <span className="ml-2 text-slate-400/80">{scenario.annualRatePct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-300/82 sm:text-[11px]">
              {model.coverageLabel}
            </div>
            <div
              className={cn(
                'inline-flex w-fit rounded-full border px-3 py-1.5 text-sm font-semibold sm:text-[15px]',
                model.coverageTone === 'positive'
                  ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                  : model.coverageTone === 'warning'
                    ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
                    : model.coverageTone === 'negative'
                      ? 'border-rose-300/25 bg-rose-300/10 text-rose-100'
                      : 'border-white/10 bg-white/5 text-slate-100',
              )}
            >
              {model.coverageMessage}
            </div>
          </div>

          <div className="space-y-3 border-t border-white/8 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {model.chips.map((chip) => (
                <span
                  key={chip}
                  className={cn(
                    'inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-medium',
                    chip.includes('CapRiesgo')
                      ? 'border-[#d4a017] bg-[#fff6df] text-[#9b5417]'
                      : 'border-white/12 bg-white/6 text-slate-200',
                  )}
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1.5 text-xs text-slate-300/72 sm:flex-row sm:items-center sm:justify-between">
              <span>Simulación simple determinista</span>
              <span>
                Inputs: {DASHBOARD_EXECUTIVE_ASSUMPTIONS.horizonYears} años ·{' '}
                {DASHBOARD_EXECUTIVE_ASSUMPTIONS.annualRatePct}% anual · base {baselineLabel}
                {model.sourceMonthKey ? ` · cierre confirmado de ${sourceLabel}` : ''}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <DashboardMetricCard
          label={model.cards.sustainable.label}
          value={formatFreedomCompactClp(model.cards.sustainable.valueClp)}
          subtitle={model.cards.sustainable.subtitle}
          tone={model.cards.sustainable.tone}
        />
        <DashboardMetricCard
          label={model.cards.lifestyle.label}
          value={formatFreedomCompactClp(model.cards.lifestyle.valueClp)}
          subtitle={model.cards.lifestyle.subtitle}
          tone={model.cards.lifestyle.tone}
        />
        <DashboardMetricCard
          label={model.cards.margin.label}
          value={formatFreedomCompactClp(model.cards.margin.valueClp)}
          subtitle={model.cards.margin.subtitle}
          tone={model.cards.margin.tone}
        />
      </section>

      <section className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(14,37,77,0.98),rgba(9,23,49,0.95))] p-4 text-white shadow-[0_18px_50px_rgba(3,10,26,0.28)]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/88">
            Frescura patrimonial
          </div>
          <div className="mt-4 text-[2.4rem] font-semibold tracking-[-0.04em] text-white">{freshnessKpi}</div>
          <div className="mt-1 text-sm text-slate-200/82">Patrimonio actualizado ≤ 7 días</div>
          <div className="mt-5">
            <DashboardBar
              values={freshnessBarSegments.map((segment) => ({
                label: segment.label,
                pct: model.freshness[segment.key] ?? 0,
                className: segment.className,
              }))}
            />
          </div>
        </Card>

        <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(14,37,77,0.98),rgba(9,23,49,0.95))] p-4 text-white shadow-[0_18px_50px_rgba(3,10,26,0.28)]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/88">
            Dependencia de CapRiesgo
          </div>
          <div
            className={cn(
              'mt-4 text-[2.4rem] font-semibold tracking-[-0.04em]',
              model.capRiskDependence.level === 'Alta'
                ? 'text-amber-200'
                : model.capRiskDependence.level === 'Media'
                  ? 'text-slate-100'
                  : 'text-emerald-300',
            )}
          >
            {model.capRiskDependence.level}
          </div>
          <div className="mt-2 text-sm leading-relaxed text-slate-200/82">
            {model.capRiskDependence.summary}
          </div>
        </Card>
      </section>

      <Card
        className={cn(
          'border p-4 shadow-[0_12px_30px_rgba(3,10,26,0.14)]',
          model.coverageTone === 'positive'
            ? 'border-emerald-400/25 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(9,23,49,0.96))] text-emerald-50'
            : model.coverageTone === 'warning'
              ? 'border-amber-300/30 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(9,23,49,0.96))] text-amber-50'
              : model.coverageTone === 'negative'
                ? 'border-rose-300/28 bg-[linear-gradient(180deg,rgba(244,63,94,0.12),rgba(9,23,49,0.96))] text-rose-50'
                : 'border-white/10 bg-[linear-gradient(180deg,rgba(15,34,68,0.96),rgba(9,23,49,0.96))] text-slate-50',
        )}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-200/78">Insight ejecutivo</div>
        <div className="mt-2 text-[15px] font-semibold leading-snug text-white sm:text-base">{model.insight}</div>
      </Card>

      <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(15,34,68,0.94),rgba(9,23,49,0.92))] p-4 text-white shadow-[0_10px_24px_rgba(3,10,26,0.18)] backdrop-blur-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300/84">Accesos rápidos</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-white/12 bg-white/7 px-3 text-slate-100 hover:bg-white/12 hover:text-white"
            onClick={() => navigate('/analysis', { state: { analysisTab: 'returns' } })}
          >
            Ver Retornos
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-white/12 bg-white/7 px-3 text-slate-100 hover:bg-white/12 hover:text-white"
            onClick={() => navigate('/analysis', { state: { analysisTab: 'freedom' } })}
          >
            <BrainCircuit className="mr-1 h-3.5 w-3.5" />
            Ver Libertad Financiera
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-white/12 bg-white/7 px-3 text-slate-100 hover:bg-white/12 hover:text-white"
            onClick={() => navigate('/analysis', { state: { analysisTab: 'lab' } })}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Ver Lab
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full border border-white/12 bg-white/7 px-3 text-slate-100 hover:bg-white/12 hover:text-white"
            onClick={refreshDashboardState}
          >
            <RefreshCcw className="mr-1 h-3.5 w-3.5" />
            Actualizar datos
          </Button>
        </div>
      </Card>
    </div>
  );
};
