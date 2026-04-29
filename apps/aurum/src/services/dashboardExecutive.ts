import type { WealthFxRates, WealthMonthlyClosure, WealthRecord } from './wealthStorage';
import { buildWealthFreshnessModel, type WealthFreshnessModel } from './wealthFreshness';
import { buildMonthlyWithdrawalPlan } from './financialFreedom';

// Inputs fijos de la lectura ejecutiva actual. Si el KPI principal cambia,
// debe cambiarse aquí y no en la UI.
export const DASHBOARD_LIFE_BASELINE_CLP = 6_000_000;
export const DASHBOARD_HORIZON_YEARS = 40;
export const DASHBOARD_ANNUAL_RATE_PCT = 5;
export const DASHBOARD_SENSITIVITY_ANNUAL_RATES = [3, 7] as const;
export const DASHBOARD_EXECUTIVE_ASSUMPTIONS = {
  lifeBaselineClp: DASHBOARD_LIFE_BASELINE_CLP,
  horizonYears: DASHBOARD_HORIZON_YEARS,
  annualRatePct: DASHBOARD_ANNUAL_RATE_PCT,
  sensitivityAnnualRates: DASHBOARD_SENSITIVITY_ANNUAL_RATES,
} as const;

export type DashboardCoverageTone = 'positive' | 'warning' | 'negative' | 'neutral';

export type DashboardFreshnessModel = WealthFreshnessModel;

export type DashboardCapRiskDependenceLevel = 'Baja' | 'Media' | 'Alta' | '—';

export type DashboardCapRiskDependence = {
  status: 'ok' | 'unavailable';
  level: DashboardCapRiskDependenceLevel;
  activeCoverageRatio: number | null;
  alternateCoverageRatio: number | null;
  relativeChangePct: number | null;
  dependenceSummary: string;
  impactRatioDelta: number | null;
  impactSummary: string;
};

export type DashboardQuickStat = {
  label: string;
  valueClp: number | null;
  tone: DashboardCoverageTone;
  subtitle: string;
};

export type DashboardSensitivityScenario = {
  annualRatePct: number;
  coverageRatio: number | null;
  coverageHeadline: string;
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
  freshness: DashboardFreshnessModel;
  capRiskDependence: DashboardCapRiskDependence;
  heroSensitivity: DashboardSensitivityScenario[];
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

const SMALL_MARGIN_CLP = 500_000;
const LOW_FRESHNESS_THRESHOLD = 0.6;
const CAPRISK_JUST_REACHES_THRESHOLD = 1.01;

const buildCapRiskDependence = (
  coverageWithoutRisk: number | null,
  coverageWithRisk: number | null,
  includeRiskCapitalInTotals: boolean,
): DashboardCapRiskDependence => {
  if (
    coverageWithoutRisk === null ||
    coverageWithRisk === null ||
    !Number.isFinite(coverageWithoutRisk) ||
    !Number.isFinite(coverageWithRisk)
  ) {
    return {
      status: 'unavailable',
      level: '—',
      activeCoverageRatio: includeRiskCapitalInTotals ? coverageWithRisk : coverageWithoutRisk,
      alternateCoverageRatio: includeRiskCapitalInTotals ? coverageWithoutRisk : coverageWithRisk,
      relativeChangePct: null,
      dependenceSummary: 'Sin base suficiente',
      impactRatioDelta: null,
      impactSummary: 'Sin base suficiente',
    };
  }

  const activeCoverageRatio = includeRiskCapitalInTotals ? coverageWithRisk : coverageWithoutRisk;
  const alternateCoverageRatio = includeRiskCapitalInTotals ? coverageWithoutRisk : coverageWithRisk;
  const impactRatioDelta = coverageWithRisk - coverageWithoutRisk;
  const relativeChangePct =
    (Math.abs(coverageWithRisk - coverageWithoutRisk) / Math.max(Math.min(coverageWithRisk, coverageWithoutRisk), 0.01)) * 100;
  const withoutRiskReaches = coverageWithoutRisk >= 1;

  let level: DashboardCapRiskDependenceLevel = 'Baja';
  let dependenceSummary = 'Sin CapRiesgo igual alcanza';
  if (!withoutRiskReaches) {
    level = 'Alta';
    dependenceSummary = 'Sin CapRiesgo ya no alcanza';
  } else if (coverageWithoutRisk < CAPRISK_JUST_REACHES_THRESHOLD) {
    level = 'Media';
    dependenceSummary = 'Sin CapRiesgo quedas muy justo';
  }

  let impactSummary = 'Sin cambio material';
  if (impactRatioDelta > 0.01) impactSummary = 'Amplía el colchón';
  else if (impactRatioDelta < -0.01) impactSummary = 'Reduce la cobertura';

  return {
    status: 'ok',
    level,
    activeCoverageRatio,
    alternateCoverageRatio,
    relativeChangePct,
    dependenceSummary,
    impactRatioDelta,
    impactSummary,
  };
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

const buildHeroSensitivity = (
  closures: WealthMonthlyClosure[],
  includeRiskCapitalInTotals: boolean,
  baseline: number,
): DashboardSensitivityScenario[] =>
  DASHBOARD_SENSITIVITY_ANNUAL_RATES.map((annualRatePct) => {
    const plan = buildMonthlyWithdrawalPlan(
      closures,
      annualRatePct,
      DASHBOARD_HORIZON_YEARS,
      includeRiskCapitalInTotals,
    );
    const monthlyWithdrawalClp = clampFinite(plan.monthlyWithdrawalClp);
    const coverageRatio = monthlyWithdrawalClp === null ? null : monthlyWithdrawalClp / baseline;
    return {
      annualRatePct,
      coverageRatio,
      coverageHeadline: coverageHeadlineFromRatio(coverageRatio),
    };
  });

const buildCoverageMessage = (
  ratio: number | null,
  capRiskDependence: DashboardCapRiskDependence,
  marginClp: number | null,
): string => {
  if (ratio === null || !Number.isFinite(ratio)) return 'Necesitas al menos un cierre confirmado';
  if (ratio >= 1 && capRiskDependence.level === 'Alta') {
    return 'Depende demasiado de CapRiesgo';
  }
  if (ratio < 1) return 'No la sostiene hoy';
  if (ratio < 1.1 || (marginClp !== null && marginClp < SMALL_MARGIN_CLP)) return 'Sostiene, pero con poco margen';
  return 'Sostiene tu vida actual';
};

const buildInsight = (
  ratio: number | null,
  capRiskDependence: DashboardCapRiskDependence,
  marginClp: number | null,
  freshness: DashboardFreshnessModel,
): string => {
  if (ratio === null || !Number.isFinite(ratio)) {
    return 'Todavía falta una base confiable para leer sostenibilidad.';
  }
  if (ratio < 1) return 'Hoy tu estándar de vida actual no queda cubierto a 40 años.';
  if (capRiskDependence.level === 'Alta') {
    return 'La conclusión depende demasiado de CapRiesgo.';
  }
  if (marginClp !== null && marginClp < SMALL_MARGIN_CLP) {
    return 'Sostiene tu vida actual, pero con margen corto.';
  }
  if (
    freshness.status === 'ok' &&
    freshness.fresh7dPct !== null &&
    freshness.fresh7dPct < LOW_FRESHNESS_THRESHOLD
  ) {
    return 'La foto patrimonial todavía es dispareja.';
  }
  return 'Sostiene tu vida actual con margen razonable.';
};

export const buildExecutiveDashboardModel = ({
  closures,
  records,
  fx,
  includeRiskCapitalInTotals,
  lifeBaselineClp = DASHBOARD_LIFE_BASELINE_CLP,
}: {
  closures: WealthMonthlyClosure[];
  records: WealthRecord[];
  fx: WealthFxRates;
  includeRiskCapitalInTotals: boolean;
  lifeBaselineClp?: number;
}): DashboardExecutiveModel => {
  const baseline = Number.isFinite(lifeBaselineClp) && lifeBaselineClp > 0 ? lifeBaselineClp : DASHBOARD_LIFE_BASELINE_CLP;

  // El KPI "cobertura de vida actual" nace de la capacidad de retiro mensual
  // estimada a 40 años / 5% anual sobre el último cierre confirmado.
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
  const heroSensitivity = buildHeroSensitivity(closures, includeRiskCapitalInTotals, baseline);
  const freshness = buildWealthFreshnessModel(records, fx, { includeRiskCapitalInTotals });
  const coverageWithoutRisk = includeRiskCapitalInTotals ? alternativeCoverageRatio : coverageRatio;
  const coverageWithRisk = includeRiskCapitalInTotals ? coverageRatio : alternativeCoverageRatio;
  const capRiskDependence = buildCapRiskDependence(
    coverageWithoutRisk,
    coverageWithRisk,
    includeRiskCapitalInTotals,
  );
  const coverageTone = coverageToneFromRatio(coverageRatio);
  const coverageMessage = buildCoverageMessage(coverageRatio, capRiskDependence, marginClp);
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
    freshness,
    capRiskDependence,
    heroSensitivity,
    chips: [
      `${DASHBOARD_HORIZON_YEARS} años`,
      'Vida actual',
      `${DASHBOARD_ANNUAL_RATE_PCT}% anual`,
      ...(includeRiskCapitalInTotals ? ['⚡ +CapRiesgo'] : []),
    ],
    insight: buildInsight(coverageRatio, capRiskDependence, marginClp, freshness),
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
