import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, RefreshCcw, Sparkles, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, cn } from '../components/Components';
import { formatFreedomCompactClp, monthKeyToYearLabel } from '../components/analysis/shared';
import {
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  loadClosures,
  loadIncludeRiskCapitalInTotals,
  saveIncludeRiskCapitalInTotals,
  type WealthMonthlyClosure,
} from '../services/wealthStorage';
import {
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

const toneAccentClasses: Record<DashboardCoverageTone, string> = {
  positive: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  warning: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
  negative: 'border-rose-300/35 bg-rose-300/10 text-rose-100',
  neutral: 'border-slate-300/20 bg-white/5 text-slate-100',
};

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
  <Card className="border-white/10 bg-white/5 p-4 backdrop-blur-sm">
    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className={cn('mt-3 text-3xl font-semibold tracking-tight', toneClasses[tone])}>{value}</div>
    <div className="mt-2 text-sm text-slate-400">{subtitle}</div>
  </Card>
);

export const DashboardAurum: React.FC = () => {
  const navigate = useNavigate();
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() => sortClosures(loadClosures()));
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState<boolean>(() =>
    loadIncludeRiskCapitalInTotals(),
  );

  const refreshDashboardState = useCallback(() => {
    setClosures(sortClosures(loadClosures()));
    setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
  }, []);

  useEffect(() => {
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      refreshDashboardState as EventListener,
    );
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, refreshDashboardState as EventListener);
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
        includeRiskCapitalInTotals,
        lifeBaselineClp: DASHBOARD_LIFE_BASELINE_CLP,
      }),
    [closures, includeRiskCapitalInTotals],
  );

  const sourceLabel = useMemo(() => monthKeyToYearLabel(model.sourceMonthKey), [model.sourceMonthKey]);

  return (
    <div className="space-y-4 p-3">
      <section className="relative overflow-hidden rounded-[28px] border border-[#5c4b3d] bg-[radial-gradient(circle_at_top_right,_rgba(181,126,74,0.16),_transparent_34%),linear-gradient(145deg,#071834_0%,#0c2247_54%,#0a1630_100%)] p-5 text-white shadow-[0_24px_80px_rgba(3,10,26,0.42)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_40%,rgba(255,255,255,0.01))]" />
        <div className="relative space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#d5c0a6]">Dashboard</div>
              <h1 className="max-w-md text-[28px] font-semibold leading-tight tracking-tight text-white">
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

          <div className="flex flex-wrap items-center gap-2">
            {model.chips.map((chip) => (
              <span
                key={chip}
                className={cn(
                  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium',
                  chip.includes('CapRiesgo')
                    ? 'border-[#d4a017] bg-[#fff6df] text-[#9b5417]'
                    : 'border-white/12 bg-white/6 text-slate-200',
                )}
              >
                {chip}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            <div className={cn('text-6xl font-semibold tracking-[-0.05em] sm:text-7xl', toneClasses[model.coverageTone])}>
              {model.coverageHeadline}
            </div>
            <div className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
              {model.coverageLabel}
            </div>
            <div className={cn('text-lg font-medium', toneClasses[model.coverageTone])}>{model.coverageMessage}</div>
            <div className="text-sm text-slate-400">Simulación simple determinista</div>
            {model.sourceMonthKey ? (
              <div className="text-xs text-slate-500">Basado en cierre confirmado de {sourceLabel}</div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
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

      <Card className={cn('border p-4 shadow-sm', toneAccentClasses[model.coverageTone])}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-80">Insight ejecutivo</div>
        <div className="mt-2 text-base font-medium leading-relaxed">{model.insight}</div>
      </Card>

      <Card className="border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Accesos rápidos</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate('/analysis', { state: { analysisTab: 'returns' } })}>
            Ver Retornos
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/analysis', { state: { analysisTab: 'freedom' } })}>
            <BrainCircuit className="mr-1 h-3.5 w-3.5" />
            Ver Libertad Financiera
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/analysis', { state: { analysisTab: 'lab' } })}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Ver Lab
          </Button>
          <Button size="sm" variant="outline" onClick={refreshDashboardState}>
            <RefreshCcw className="mr-1 h-3.5 w-3.5" />
            Actualizar datos
          </Button>
        </div>
      </Card>

      <Card className="border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        El Dashboard sintetiza sostenibilidad personal. Para detalle del período, usa Retornos; para simulación completa, Libertad Financiera; para lectura exploratoria, Lab.
      </Card>
    </div>
  );
};
