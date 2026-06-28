import type {
  PathQualityDiagnosticsV1,
  PathQualityPathDiagnosticsV1,
  QualityOfLifeMetricsV1,
  QualityOfLifePhaseStressV1,
} from '../model/types';

const QASR_ALPHA = 1.5 as const;
const CSR_MIN_AVG_CONSUMPTION = 0.85 as const;
const CSR_MAX_SEVERE_CUT_MONTHS = 48 as const;
const QUALITY_SURVIVAL_MIN_AVG_CONSUMPTION = 0.9 as const;
const QUALITY_SURVIVAL_MAX_CONSECUTIVE_MONTHS_BELOW_85 = 6 as const;
const QUALITY_SURVIVAL_MAX_TOTAL_MONTHS_BELOW_85 = 24 as const;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toFinite = (values: Array<number | null | undefined>): number[] =>
  values.filter(isFiniteNumber);

const mean = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

const dedupeWarnings = (warnings: string[]): string[] => Array.from(new Set(warnings));

const nullMetric = (): QualityOfLifeMetricsV1 => ({
  schemaVersion: 1,
  source: 'path_quality_diagnostics_v1',
  warnings: ['path_quality_diagnostics_missing'],
  pathCount: 0,
  horizonMonths: 0,
  horizonYears: 0,
  classicSuccessRate: null,
  ruinRate: null,
  ruinedPathCount: 0,
  csr85_4: null,
  csrPassingPathCount: 0,
  csrThresholds: {
    minAverageConsumptionRatio: CSR_MIN_AVG_CONSUMPTION,
    maxSevereCutMonths: CSR_MAX_SEVERE_CUT_MONTHS,
  },
  qasrAlpha: QASR_ALPHA,
  qasrStrict: null,
  qualityScoreMean: null,
  qualityScoreP25: null,
  qualityScoreP50: null,
  averageConsumptionRatioMean: null,
  averageConsumptionRatioP25: null,
  averageConsumptionRatioP50: null,
  averageEffectiveSpendingRatio: null,
  minMonthlyConsumptionRatioP10: null,
  minMonthlyConsumptionRatioP25: null,
  minAnnualConsumptionRatioP10: null,
  minAnnualConsumptionRatioP25: null,
  monthsBelow85: null,
  maxConsecutiveMonthsBelow85: null,
  monthsBelow90: null,
  maxConsecutiveMonthsBelow90: null,
  earlyStressMonths: null,
  phaseStress: [],
  qualitySurvivalRate: null,
  qualitySurvivalPassingPathCount: 0,
  qualitySurvivalThresholds: {
    minAverageConsumptionRatio: QUALITY_SURVIVAL_MIN_AVG_CONSUMPTION,
    maxConsecutiveMonthsBelow85: QUALITY_SURVIVAL_MAX_CONSECUTIVE_MONTHS_BELOW_85,
    maxTotalMonthsBelow85: QUALITY_SURVIVAL_MAX_TOTAL_MONTHS_BELOW_85,
  },
  monthsInCutMean: null,
  monthsInCutP50: null,
  monthsInSevereCutMean: null,
  monthsInSevereCutP50: null,
  maxConsecutiveSevereCutMonthsP50: null,
  maxConsecutiveSevereCutMonthsP75: null,
  severeCutYearsMean: null,
  severeCutYearsP50: null,
  houseSaleRate: null,
  houseSoldPathCount: 0,
  houseSaleYearMedian: null,
  houseSaleYearP10: null,
  houseSaleYearP90: null,
  houseSaleTriggerToSaleMonthsMedian: null,
  houseSaleTriggerToSaleMonthsMean: null,
  houseSaleTriggerToSaleMonthsP75: null,
  severeCutMonthsDuringHouseSaleMean: null,
  severeCutMonthsDuringHouseSaleMedian: null,
  severeCutMonthsDuringHouseSaleP75: null,
  monthsInCutBeforeHouseSaleMean: null,
  monthsInSevereCutBeforeHouseSaleMean: null,
  liquidWealthAfterHouseSaleP25: null,
  liquidWealthAfterHouseSaleP50: null,
  houseSaleIncidence: null,
  terminalWealthP10: null,
  terminalWealthP25: null,
  terminalWealthP50: null,
  terminalWealthP75: null,
  terminalWealthRatio: null,
});

const pushMissingWarning = (warnings: string[], code: string, values: number[]) => {
  if (values.length === 0) warnings.push(code);
};

const buildQasrStrictScores = (paths: PathQualityPathDiagnosticsV1[], warnings: string[]): number[] => {
  const strictScores: number[] = [];
  let missingQualityScoreCount = 0;
  for (const path of paths) {
    if (path.ruined) {
      strictScores.push(0);
      continue;
    }
    if (!isFiniteNumber(path.qualityScoreAlpha15)) {
      missingQualityScoreCount += 1;
      continue;
    }
    strictScores.push(path.qualityScoreAlpha15);
  }
  if (missingQualityScoreCount > 0) warnings.push('quality_score_missing_for_non_ruined_paths');
  return strictScores;
};

const buildPhaseStressSummary = (
  paths: PathQualityPathDiagnosticsV1[],
): QualityOfLifePhaseStressV1[] => {
  const phaseMap = new Map<number, {
    label: string;
    startMonth: number;
    endMonth: number;
    monthsBelow85: number[];
    monthsBelow90: number[];
  }>();

  for (const path of paths) {
    for (const phase of path.phaseStress ?? []) {
      if (phase.monthsObserved <= 0) continue;
      const existing = phaseMap.get(phase.phaseIndex) ?? {
        label: `F${phase.phaseIndex}`,
        startMonth: phase.startMonth,
        endMonth: phase.endMonth,
        monthsBelow85: [],
        monthsBelow90: [],
      };
      existing.monthsBelow85.push(phase.monthsBelow85);
      existing.monthsBelow90.push(phase.monthsBelow90);
      phaseMap.set(phase.phaseIndex, existing);
    }
  }

  return [...phaseMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phaseIndex, phase]) => ({
      phaseIndex,
      label: phase.label,
      startMonth: phase.startMonth,
      endMonth: phase.endMonth,
      monthsBelow85: mean(phase.monthsBelow85),
      monthsBelow90: mean(phase.monthsBelow90),
    }));
};

export function buildQualityOfLifeMetricsFromPathDiagnostics(
  pathQualityDiagnostics?: PathQualityDiagnosticsV1 | null,
  options?: {
    initialSimulableCapitalClp?: number | null;
  },
): QualityOfLifeMetricsV1 {
  if (!pathQualityDiagnostics) return nullMetric();

  const warnings = [...pathQualityDiagnostics.warnings];
  const pathCount = Math.max(0, Math.trunc(pathQualityDiagnostics.pathCount));
  const horizonMonths = Math.max(0, Math.trunc(pathQualityDiagnostics.horizonMonths));
  const horizonYears = horizonMonths / 12;
  const paths = pathQualityDiagnostics.paths ?? [];

  if (pathCount === 0) warnings.push('path_count_zero');
  if (paths.length === 0) warnings.push('path_details_missing');
  if (paths.some((path) => path.observedConsumptionMonths < horizonMonths)) {
    warnings.push('observed_consumption_months_incomplete');
  }
  if (paths.some((path) => (path.postRuinMonths ?? 0) > 0)) {
    warnings.push('post_ruin_months_present');
  }

  const ruinedPathCount = paths.filter((path) => path.ruined).length;
  const classicSuccessRate = pathCount > 0 ? (pathCount - ruinedPathCount) / pathCount : null;
  const ruinRate = pathCount > 0 ? ruinedPathCount / pathCount : null;

  const csrPassingPathCount = paths.filter((path) =>
    !path.ruined
    && isFiniteNumber(path.averageConsumptionRatio)
    && path.averageConsumptionRatio >= CSR_MIN_AVG_CONSUMPTION
    && isFiniteNumber(path.monthsInSevereCut)
    && path.monthsInSevereCut <= CSR_MAX_SEVERE_CUT_MONTHS,
  ).length;
  const csr85_4 = pathCount > 0 ? csrPassingPathCount / pathCount : null;

  const qualityScores = toFinite(paths.map((path) => path.qualityScoreAlpha15));
  pushMissingWarning(warnings, 'quality_score_missing', qualityScores);
  const qasrStrictScores = buildQasrStrictScores(paths, warnings);

  const averageConsumptionRatios = toFinite(paths.map((path) => path.averageConsumptionRatio));
  pushMissingWarning(warnings, 'average_consumption_ratio_missing', averageConsumptionRatios);
  const minMonthlyRatios = toFinite(paths.map((path) => path.minMonthlyConsumptionRatio));
  pushMissingWarning(warnings, 'min_monthly_consumption_ratio_missing', minMonthlyRatios);
  const minAnnualRatios = toFinite(paths.map((path) => path.minAnnualConsumptionRatio));
  pushMissingWarning(warnings, 'min_annual_consumption_ratio_missing', minAnnualRatios);
  const monthsBelow85 = toFinite(paths.map((path) => path.monthsBelow85));
  pushMissingWarning(warnings, 'months_below_85_missing', monthsBelow85);
  const maxConsecutiveMonthsBelow85 = toFinite(paths.map((path) => path.maxConsecutiveMonthsBelow85));
  pushMissingWarning(warnings, 'max_consecutive_months_below_85_missing', maxConsecutiveMonthsBelow85);
  const monthsBelow90 = toFinite(paths.map((path) => path.monthsBelow90));
  pushMissingWarning(warnings, 'months_below_90_missing', monthsBelow90);
  const maxConsecutiveMonthsBelow90 = toFinite(paths.map((path) => path.maxConsecutiveMonthsBelow90));
  pushMissingWarning(warnings, 'max_consecutive_months_below_90_missing', maxConsecutiveMonthsBelow90);
  const earlyStressMonths = toFinite(paths.map((path) => path.earlyStressMonthsBelow85));
  pushMissingWarning(warnings, 'early_stress_months_missing', earlyStressMonths);
  const phaseStress = buildPhaseStressSummary(paths);
  if (paths.length > 0 && phaseStress.length === 0) warnings.push('phase_stress_missing');

  const monthsInCut = toFinite(paths.map((path) => path.monthsInCut));
  const monthsInSevereCut = toFinite(paths.map((path) => path.monthsInSevereCut));
  const maxConsecutiveSevereCutMonths = toFinite(paths.map((path) => path.maxConsecutiveSevereCutMonths));
  const severeCutYears = monthsInSevereCut.map((months) => months / 12);

  const houseSoldPaths = paths.filter((path) => path.houseSold === true);
  const houseSoldPathCount = houseSoldPaths.length;
  const houseSaleRate = pathCount > 0 ? houseSoldPathCount / pathCount : null;
  const houseSaleYears = toFinite(houseSoldPaths.map((path) => path.houseSaleYear));
  const triggerToSaleMonths = toFinite(houseSoldPaths.map((path) => path.monthsBetweenHouseSaleTriggerAndSale));
  const severeCutDuringSale = toFinite(houseSoldPaths.map((path) => path.monthsInSevereCutBetweenHouseSaleTriggerAndSale));
  const cutBeforeSale = toFinite(houseSoldPaths.map((path) => path.monthsInCutBeforeHouseSale));
  const severeCutBeforeSale = toFinite(houseSoldPaths.map((path) => path.monthsInSevereCutBeforeHouseSale));
  const liquidAfterSale = toFinite(houseSoldPaths.map((path) => path.liquidWealthAfterHouseSaleClp));
  if (houseSoldPathCount === 0) warnings.push('house_sale_data_missing');
  if (houseSoldPathCount > 0 && triggerToSaleMonths.length === 0) {
    warnings.push('house_sale_trigger_to_sale_metrics_missing');
  }
  if (houseSoldPathCount > 0 && severeCutDuringSale.length === 0) {
    warnings.push('severe_cut_during_house_sale_missing');
  }

  const terminalWealth = toFinite(paths.map((path) => path.terminalWealthClp));
  pushMissingWarning(warnings, 'terminal_wealth_missing', terminalWealth);
  const terminalWealthP50 = percentile(terminalWealth, 50);
  const initialSimulableCapitalClp = options?.initialSimulableCapitalClp;
  const hasInitialSimulableCapital = isFiniteNumber(initialSimulableCapitalClp) && initialSimulableCapitalClp > 0;
  if (!hasInitialSimulableCapital) warnings.push('initial_simulable_capital_missing');
  const terminalWealthRatio = hasInitialSimulableCapital && terminalWealthP50 !== null
    ? terminalWealthP50 / initialSimulableCapitalClp
    : null;

  const qualitySurvivalPassingPathCount = paths.filter((path) =>
    !path.ruined
    && isFiniteNumber(path.averageConsumptionRatio)
    && path.averageConsumptionRatio >= QUALITY_SURVIVAL_MIN_AVG_CONSUMPTION
    && isFiniteNumber(path.maxConsecutiveMonthsBelow85)
    && path.maxConsecutiveMonthsBelow85 <= QUALITY_SURVIVAL_MAX_CONSECUTIVE_MONTHS_BELOW_85
    && isFiniteNumber(path.monthsBelow85)
    && path.monthsBelow85 <= QUALITY_SURVIVAL_MAX_TOTAL_MONTHS_BELOW_85,
  ).length;
  const qualitySurvivalRate = pathCount > 0 ? qualitySurvivalPassingPathCount / pathCount : null;

  return {
    schemaVersion: 1,
    source: 'path_quality_diagnostics_v1',
    warnings: dedupeWarnings(warnings),
    pathCount,
    horizonMonths,
    horizonYears,
    classicSuccessRate,
    ruinRate,
    ruinedPathCount,
    csr85_4,
    csrPassingPathCount,
    csrThresholds: {
      minAverageConsumptionRatio: CSR_MIN_AVG_CONSUMPTION,
      maxSevereCutMonths: CSR_MAX_SEVERE_CUT_MONTHS,
    },
    qasrAlpha: QASR_ALPHA,
    qasrStrict: mean(qasrStrictScores),
    qualityScoreMean: mean(qualityScores),
    qualityScoreP25: percentile(qualityScores, 25),
    qualityScoreP50: percentile(qualityScores, 50),
    averageConsumptionRatioMean: mean(averageConsumptionRatios),
    averageConsumptionRatioP25: percentile(averageConsumptionRatios, 25),
    averageConsumptionRatioP50: percentile(averageConsumptionRatios, 50),
    averageEffectiveSpendingRatio: mean(averageConsumptionRatios),
    minMonthlyConsumptionRatioP10: percentile(minMonthlyRatios, 10),
    minMonthlyConsumptionRatioP25: percentile(minMonthlyRatios, 25),
    minAnnualConsumptionRatioP10: percentile(minAnnualRatios, 10),
    minAnnualConsumptionRatioP25: percentile(minAnnualRatios, 25),
    monthsBelow85: mean(monthsBelow85),
    maxConsecutiveMonthsBelow85: percentile(maxConsecutiveMonthsBelow85, 75),
    monthsBelow90: mean(monthsBelow90),
    maxConsecutiveMonthsBelow90: percentile(maxConsecutiveMonthsBelow90, 75),
    earlyStressMonths: mean(earlyStressMonths),
    phaseStress,
    qualitySurvivalRate,
    qualitySurvivalPassingPathCount,
    qualitySurvivalThresholds: {
      minAverageConsumptionRatio: QUALITY_SURVIVAL_MIN_AVG_CONSUMPTION,
      maxConsecutiveMonthsBelow85: QUALITY_SURVIVAL_MAX_CONSECUTIVE_MONTHS_BELOW_85,
      maxTotalMonthsBelow85: QUALITY_SURVIVAL_MAX_TOTAL_MONTHS_BELOW_85,
    },
    monthsInCutMean: mean(monthsInCut),
    monthsInCutP50: percentile(monthsInCut, 50),
    monthsInSevereCutMean: mean(monthsInSevereCut),
    monthsInSevereCutP50: percentile(monthsInSevereCut, 50),
    maxConsecutiveSevereCutMonthsP50: percentile(maxConsecutiveSevereCutMonths, 50),
    maxConsecutiveSevereCutMonthsP75: percentile(maxConsecutiveSevereCutMonths, 75),
    severeCutYearsMean: mean(severeCutYears),
    severeCutYearsP50: percentile(severeCutYears, 50),
    houseSaleRate,
    houseSoldPathCount,
    houseSaleYearMedian: percentile(houseSaleYears, 50),
    houseSaleYearP10: percentile(houseSaleYears, 10),
    houseSaleYearP90: percentile(houseSaleYears, 90),
    houseSaleTriggerToSaleMonthsMedian: percentile(triggerToSaleMonths, 50),
    houseSaleTriggerToSaleMonthsMean: mean(triggerToSaleMonths),
    houseSaleTriggerToSaleMonthsP75: percentile(triggerToSaleMonths, 75),
    severeCutMonthsDuringHouseSaleMean: mean(severeCutDuringSale),
    severeCutMonthsDuringHouseSaleMedian: percentile(severeCutDuringSale, 50),
    severeCutMonthsDuringHouseSaleP75: percentile(severeCutDuringSale, 75),
    monthsInCutBeforeHouseSaleMean: mean(cutBeforeSale),
    monthsInSevereCutBeforeHouseSaleMean: mean(severeCutBeforeSale),
    liquidWealthAfterHouseSaleP25: percentile(liquidAfterSale, 25),
    liquidWealthAfterHouseSaleP50: percentile(liquidAfterSale, 50),
    houseSaleIncidence: houseSaleRate,
    terminalWealthP10: percentile(terminalWealth, 10),
    terminalWealthP25: percentile(terminalWealth, 25),
    terminalWealthP50,
    terminalWealthP75: percentile(terminalWealth, 75),
    terminalWealthRatio,
  };
}
