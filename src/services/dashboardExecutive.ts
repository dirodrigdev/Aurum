import type { WealthMonthlyClosure } from './wealthStorage';
import { buildMonthlyWithdrawalPlan } from './financialFreedom';

export const DASHBOARD_LIFE_BASELINE_CLP = 6_000_000;
export const DASHBOARD_HORIZON_YEARS = 40;
export const DASHBOARD_ANNUAL_RATE_PCT = 5;

export type DashboardCoverageTone = 'positive' | 'warning' | 'negative' | 'neutral';

export type DashboardQuickStat = {
  label: string;
  valueClp: number | null;
  tone: DashboardCoverageTone;
  subtitle: string;
};

export type DashboardExecutiveModel = {
  status: 'ok' | 'missing_patrimony' | 'invalid';
  lifeBaselineClp: number;
  monthlySustainableClp: number | null;
  coverageRatio: number | null;
  coveragePct: number | null;
  marginClp: number | null;
  coverageHeadline: string;
  coverageLabel: string;
  coverageMessage: string;
  coverageTone: DashboardCoverageTone;
  sourceMonthKey: string | null;
  includeRiskCapitalInTotals: boolean;
  alternativeCoverageRatio: number | null;
  alternativeMonthlySustainableClp: number | null;
  chips: string[];
  insight: string;
  cards: {
    sustainable: DashboardQuickStat;
    lifestyle: DashboardQuickStat;
    margin: DashboardQuickStat;
  };
};

const clampFinite = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  return value;
};

const coverageToneFromRatio = (ratio: number | null): DashboardCoverageTone => {
  if (ratio === null || !Number.isFinite(ratio)) return 'neutral';
  if (ratio < 1) return 'negative';
  if (ratio < 1.1) return 'warning';
  return 'positive';
};

const coverageHeadlineFromRatio = (ratio: number | null): string => {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  return `${ratio.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
};

const buildCoverageMessage = (
  ratio: number | null,
  includeRiskCapitalInTotals: boolean,
  alternativeRatio: number | null,
  marginClp: number | null,
): string => {
  if (ratio === null || !Number.isFinite(ratio)) return 'Necesitas al menos un cierre confirmado';
  if (
    includeRiskCapitalInTotals &&
    alternativeRatio !== null &&
    Number.isFinite(alternativeRatio) &&
    ratio >= 1 &&
    alternativeRatio < 1
  ) {
    return 'Depende demasiado de CapRiesgo';
  }
  if (ratio < 1) return 'No la sostiene hoy';
  if (ratio < 1.1 || (marginClp !== null && marginClp < 500_000)) return 'Sostiene, pero con poco margen';
  return 'Sostiene tu vida actual';
};

const buildInsight = (
  ratio: number | null,
  includeRiskCapitalInTotals: boolean,
  alternativeRatio: number | null,
  marginClp: number | null,
): string => {
  if (ratio === null || !Number.isFinite(ratio)) {
    return 'Necesitas al menos un cierre confirmado para evaluar sostenibilidad.';
  }
  if (
    includeRiskCapitalInTotals &&
    alternativeRatio !== null &&
    Number.isFinite(alternativeRatio) &&
    ratio >= 1 &&
    alternativeRatio < 1
  ) {
    return 'Hoy la conclusión depende demasiado de CapRiesgo.';
  }
  if (ratio < 1) return 'Hoy tu estándar de vida actual no queda cubierto por 40 años.';
  if (marginClp !== null && marginClp < 500_000) {
    return 'Hoy tu patrimonio sostiene tu vida actual, pero con margen acotado.';
  }
  return 'Hoy tu patrimonio sostiene tu vida actual con holgura razonable.';
};

export const buildExecutiveDashboardModel = ({
  closures,
  includeRiskCapitalInTotals,
  lifeBaselineClp = DASHBOARD_LIFE_BASELINE_CLP,
}: {
  closures: WealthMonthlyClosure[];
  includeRiskCapitalInTotals: boolean;
  lifeBaselineClp?: number;
}): DashboardExecutiveModel => {
  const baseline = Number.isFinite(lifeBaselineClp) && lifeBaselineClp > 0 ? lifeBaselineClp : DASHBOARD_LIFE_BASELINE_CLP;

  const activePlan = buildMonthlyWithdrawalPlan(
    closures,
    DASHBOARD_ANNUAL_RATE_PCT,
    DASHBOARD_HORIZON_YEARS,
    includeRiskCapitalInTotals,
  );
  const alternatePlan = buildMonthlyWithdrawalPlan(
    closures,
    DASHBOARD_ANNUAL_RATE_PCT,
    DASHBOARD_HORIZON_YEARS,
    !includeRiskCapitalInTotals,
  );

  const monthlySustainableClp = clampFinite(activePlan.monthlyWithdrawalClp);
  const alternativeMonthlySustainableClp = clampFinite(alternatePlan.monthlyWithdrawalClp);
  const coverageRatio = monthlySustainableClp === null ? null : monthlySustainableClp / baseline;
  const alternativeCoverageRatio =
    alternativeMonthlySustainableClp === null ? null : alternativeMonthlySustainableClp / baseline;
  const marginClp = monthlySustainableClp === null ? null : monthlySustainableClp - baseline;
  const coverageTone = coverageToneFromRatio(coverageRatio);
  const coverageMessage = buildCoverageMessage(
    coverageRatio,
    includeRiskCapitalInTotals,
    alternativeCoverageRatio,
    marginClp,
  );
  const status = monthlySustainableClp === null ? (activePlan.status === 'missing_patrimony' ? 'missing_patrimony' : 'invalid') : 'ok';

  return {
    status,
    lifeBaselineClp: baseline,
    monthlySustainableClp,
    coverageRatio,
    coveragePct: coverageRatio === null ? null : coverageRatio * 100,
    marginClp,
    coverageHeadline: coverageHeadlineFromRatio(coverageRatio),
    coverageLabel: 'Cobertura de vida actual',
    coverageMessage,
    coverageTone,
    sourceMonthKey: activePlan.sourceMonthKey,
    includeRiskCapitalInTotals,
    alternativeCoverageRatio,
    alternativeMonthlySustainableClp,
    chips: [
      `${DASHBOARD_HORIZON_YEARS} años`,
      'Vida actual',
      `${DASHBOARD_ANNUAL_RATE_PCT}% anual`,
      ...(includeRiskCapitalInTotals ? ['⚡ +CapRiesgo'] : []),
    ],
    insight: buildInsight(coverageRatio, includeRiskCapitalInTotals, alternativeCoverageRatio, marginClp),
    cards: {
      sustainable: {
        label: 'Capacidad sostenible mensual',
        valueClp: monthlySustainableClp,
        tone: coverageTone,
        subtitle: 'a 40 años',
      },
      lifestyle: {
        label: 'Vida actual mensual',
        valueClp: baseline,
        tone: 'neutral',
        subtitle: 'Base actual',
      },
      margin: {
        label: 'Margen sostenible',
        valueClp: marginClp,
        tone: marginClp === null ? 'neutral' : marginClp >= 0 ? (marginClp < 500_000 ? 'warning' : 'positive') : 'negative',
        subtitle: marginClp === null ? 'Sin base suficiente' : marginClp >= 0 ? (marginClp < 500_000 ? 'Vas justo' : 'Te sobra') : 'Te falta',
      },
    },
  };
};
