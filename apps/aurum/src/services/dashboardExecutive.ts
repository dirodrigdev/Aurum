import { labelMatchKey } from '../utils/wealthLabels';
import type { WealthFxRates, WealthMonthlyClosure, WealthRecord } from './wealthStorage';
import { buildMonthlyWithdrawalPlan } from './financialFreedom';
import {
  MORTGAGE_DEBT_BALANCE_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
} from './wealthStorage';

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

export type DashboardFreshnessBucket = 'fresh' | 'aging' | 'stale';

export type DashboardFreshnessModel = {
  status: 'ok' | 'unavailable';
  fresh7dPct: number | null;
  aging30dPct: number | null;
  stalePct: number | null;
  totalWeightedClp: number;
  laggards: Array<{
    label: string;
    weightPct: number;
    ageDays: number;
  }>;
};

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SMALL_MARGIN_CLP = 500_000;
const LOW_FRESHNESS_THRESHOLD = 0.6;
const CAPRISK_JUST_REACHES_THRESHOLD = 1.01;
const RISK_CAPITAL_LABEL_KEYS = new Set([
  labelMatchKey('Capital de riesgo CLP'),
  labelMatchKey('Capital de riesgo USD'),
]);

const isRiskCapitalLabel = (label: string) => RISK_CAPITAL_LABEL_KEYS.has(labelMatchKey(label));

const makeDashboardAssetKey = (record: Pick<WealthRecord, 'block' | 'label' | 'currency'>) =>
  `${record.block}::${labelMatchKey(record.label)}::${record.currency}`;

const isCarriedNote = (note?: string) => {
  const normalized = String(note || '').toLowerCase();
  return normalized.includes('arrastrado') || normalized.includes('mes anterior');
};

const isStableAssetRecord = (record: WealthRecord) => {
  if (record.block !== 'real_estate') return false;
  const key = labelMatchKey(record.label);
  return (
    key === labelMatchKey(REAL_ESTATE_PROPERTY_VALUE_LABEL) ||
    key === labelMatchKey(MORTGAGE_DEBT_BALANCE_LABEL)
  );
};

const monthKeyToEndDateMs = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return NaN;
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(`${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T12:00:00`).getTime();
};

const carriedSourceMonthFromNote = (note?: string) => {
  const match = String(note || '').match(/cierre\s+(\d{4}-\d{2})/i);
  return match?.[1] || null;
};

const recordDateMs = (record: WealthRecord): number => {
  if (isCarriedNote(record.note) && !isStableAssetRecord(record)) {
    const sourceMonth = carriedSourceMonthFromNote(record.note);
    const sourceDate = sourceMonth ? monthKeyToEndDateMs(sourceMonth) : NaN;
    if (Number.isFinite(sourceDate)) return sourceDate;
    return NaN;
  }
  const created = new Date(record.createdAt).getTime();
  if (Number.isFinite(created) && created > 0) return created;
  const snapshot = new Date(`${record.snapshotDate}T12:00:00`).getTime();
  return Number.isFinite(snapshot) ? snapshot : NaN;
};

const convertRecordToClp = (record: WealthRecord, fx: WealthFxRates): number => {
  if (!Number.isFinite(record.amount)) return 0;
  if (record.currency === 'CLP') return record.amount;
  if (record.currency === 'USD') return record.amount * fx.usdClp;
  if (record.currency === 'EUR') return record.amount * fx.eurClp;
  return record.amount * fx.ufClp;
};

const bucketFromAgeDays = (days: number): DashboardFreshnessBucket => {
  if (days <= 7) return 'fresh';
  if (days <= 30) return 'aging';
  return 'stale';
};

const buildFreshnessModel = (
  records: WealthRecord[],
  fx: WealthFxRates,
  includeRiskCapitalInTotals: boolean,
): DashboardFreshnessModel => {
  const latestByAsset = new Map<string, WealthRecord>();
  for (const record of records) {
    if (!includeRiskCapitalInTotals && isRiskCapitalLabel(record.label)) continue;
    const key = makeDashboardAssetKey(record);
    const prev = latestByAsset.get(key);
    if (!prev) {
      latestByAsset.set(key, record);
      continue;
    }
    if ((recordDateMs(record) || 0) >= (recordDateMs(prev) || 0)) {
      latestByAsset.set(key, record);
    }
  }

  const latestRecords = [...latestByAsset.values()];
  if (!latestRecords.length) {
    return {
      status: 'unavailable',
      fresh7dPct: null,
      aging30dPct: null,
      stalePct: null,
      totalWeightedClp: 0,
      laggards: [],
    };
  }

  const now = Date.now();
  let fresh = 0;
  let aging = 0;
  let stale = 0;
  let total = 0;

  for (const record of latestRecords) {
    const valueClp = Math.abs(convertRecordToClp(record, fx));
    if (!Number.isFinite(valueClp) || valueClp <= 0) continue;
    const ageMs = now - recordDateMs(record);
    const ageDays = Number.isFinite(ageMs) && ageMs >= 0 ? ageMs / MS_PER_DAY : Number.POSITIVE_INFINITY;
    const bucket = bucketFromAgeDays(ageDays);
    total += valueClp;
    if (bucket === 'fresh') fresh += valueClp;
    else if (bucket === 'aging') aging += valueClp;
    else stale += valueClp;
  }

  if (total <= 0) {
    return {
      status: 'unavailable',
      fresh7dPct: null,
      aging30dPct: null,
      stalePct: null,
      totalWeightedClp: 0,
      laggards: [],
    };
  }

  const laggards = latestRecords
    .map((record) => {
      const valueClp = Math.abs(convertRecordToClp(record, fx));
      const ageMs = now - recordDateMs(record);
      const ageDays = Number.isFinite(ageMs) && ageMs >= 0 ? ageMs / MS_PER_DAY : Number.POSITIVE_INFINITY;
      return {
        label: record.label,
        valueClp,
        ageDays: Number.isFinite(ageDays) ? Math.round(ageDays) : 0,
      };
    })
    .filter((item) => Number.isFinite(item.valueClp) && item.valueClp > 0 && Number.isFinite(item.ageDays))
    .map((item) => ({
      label: item.label,
      weightPct: total > 0 ? item.valueClp / total : 0,
      ageDays: item.ageDays,
    }))
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, 5);

  return {
    status: 'ok',
    fresh7dPct: fresh / total,
    aging30dPct: aging / total,
    stalePct: stale / total,
    totalWeightedClp: total,
    laggards,
  };
};

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
  const freshness = buildFreshnessModel(records, fx, includeRiskCapitalInTotals);
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
