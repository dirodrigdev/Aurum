import type {
  PathQualityDiagnosticsV1,
  PathQualityPathDiagnosticsV1,
  PathQualityPhaseStressV1,
} from '../model/types';
import { buildFixedSpendingDurations } from '../model/spendingPhases';
import {
  buildM8PhaseBoundaries,
  buildM8PhaseBoundariesFromDurations,
  type M8PhaseBoundary,
  type M8PhaseEndYears,
} from './phaseTimeline';

export type M8PathQualityRuntimeSummary = {
  pathId: number;
  ruined: boolean;
  ruinMonth: number | null;
  terminalWealthClp: number | null;
  monthlyConsumptionRatios?: number[];
  cutStates?: number[];
  houseSaleTriggerMonth: number | null;
  houseSaleMonth: number | null;
  liquidWealthAfterHouseSaleClp: number | null;
};

const QASR_ALPHA = 1.5 as const;
const SEVERE_RATIO_THRESHOLD = 0.85 as const;
const MODERATE_RATIO_THRESHOLD = 0.9 as const;
const EARLY_STRESS_WINDOW_MONTHS = 60 as const;

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const percentile = (values: number[], p: number): number | null => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

const mean = (values: number[]): number | null => {
  const clean = values.filter(Number.isFinite);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
};

const meanShortfallPenalty = (ratios: number[]): number | null => {
  if (ratios.length === 0) return null;
  const penalties = ratios.map((ratio) => Math.pow(Math.max(0, 1 - ratio), QASR_ALPHA));
  return mean(penalties);
};

const countBelowThreshold = (ratios: number[], threshold: number): number =>
  ratios.filter((ratio) => ratio < threshold).length;

const maxConsecutive = (states: number[], predicate: (state: number) => boolean): number => {
  let current = 0;
  let best = 0;
  for (const state of states) {
    if (predicate(state)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
};

const maxConsecutiveBelowThreshold = (ratios: number[], threshold: number): number =>
  maxConsecutive(ratios, (ratio) => Number.isFinite(ratio) && ratio < threshold);

const minAnnualConsumptionRatio = (monthlyRatios: number[]): number | null => {
  const clean = monthlyRatios.filter(Number.isFinite);
  if (clean.length === 0) return null;
  const annual: number[] = [];
  for (let start = 0; start < clean.length; start += 12) {
    const chunk = clean.slice(start, start + 12);
    const chunkMean = mean(chunk);
    if (chunkMean !== null) annual.push(chunkMean);
  }
  return annual.length ? Math.min(...annual) : null;
};

const buildPhaseStress = (
  monthlyRatios: number[],
  horizonMonths: number,
  phaseEndYears?: M8PhaseEndYears,
): PathQualityPhaseStressV1[] => {
  if (monthlyRatios.length === 0 || horizonMonths <= 0) return [];

  let boundaries: M8PhaseBoundary[];
  try {
    boundaries = phaseEndYears
      ? buildM8PhaseBoundaries(horizonMonths, phaseEndYears)
      : buildM8PhaseBoundariesFromDurations(horizonMonths, buildFixedSpendingDurations(horizonMonths));
  } catch {
    return [];
  }
  const phases: PathQualityPhaseStressV1[] = [];
  for (const boundary of boundaries) {
    const phaseRatios = monthlyRatios.slice(boundary.startMonth - 1, boundary.endMonth);
    phases.push({
      phaseIndex: boundary.phaseIndex,
      startMonth: boundary.startMonth,
      endMonth: boundary.endMonth,
      monthsObserved: phaseRatios.length,
      monthsBelow85: countBelowThreshold(phaseRatios, SEVERE_RATIO_THRESHOLD),
      monthsBelow90: countBelowThreshold(phaseRatios, MODERATE_RATIO_THRESHOLD),
      maxConsecutiveMonthsBelow85: maxConsecutiveBelowThreshold(phaseRatios, SEVERE_RATIO_THRESHOLD),
      maxConsecutiveMonthsBelow90: maxConsecutiveBelowThreshold(phaseRatios, MODERATE_RATIO_THRESHOLD),
    });
  }

  return phases;
};

export function buildPathQualityDiagnosticsFromM8Output(args: {
  pathCount: number;
  horizonMonths: number;
  phaseEndYears?: M8PhaseEndYears;
  pathSummaries?: M8PathQualityRuntimeSummary[];
}): PathQualityDiagnosticsV1 {
  const warnings: string[] = [];
  const pathCount = Math.max(0, Math.trunc(args.pathCount));
  const horizonMonths = Math.max(0, Math.trunc(args.horizonMonths));
  const summaries = args.pathSummaries ?? [];

  if (summaries.length !== pathCount) {
    warnings.push('path_summary_count_mismatch');
  }

  const paths: PathQualityPathDiagnosticsV1[] = summaries.map((path) => {
    const pathWarnings: string[] = [];
    const ratios = (path.monthlyConsumptionRatios ?? []).filter(Number.isFinite);
    const cutStates = path.cutStates ?? [];
    const houseSaleTriggerMonth = finiteOrNull(path.houseSaleTriggerMonth);
    const houseSaleMonth = finiteOrNull(path.houseSaleMonth);
    const ruinMonth = finiteOrNull(path.ruinMonth);
    const hasTriggerAndSale =
      houseSaleTriggerMonth !== null && houseSaleMonth !== null && houseSaleMonth >= houseSaleTriggerMonth;
    const saleWindowStates = hasTriggerAndSale
      ? cutStates.slice(Math.max(0, houseSaleTriggerMonth - 1), Math.max(0, houseSaleMonth - 1))
      : [];
    const monthsBetweenHouseSaleTriggerAndSale = hasTriggerAndSale
      ? Math.max(0, houseSaleMonth - houseSaleTriggerMonth)
      : null;
    const beforeSaleStates = houseSaleMonth !== null
      ? cutStates.slice(0, Math.max(0, houseSaleMonth - 1))
      : [];
    const meanShortfallPenaltyAlpha15 = meanShortfallPenalty(ratios);
    const qualityScoreAlpha15 = meanShortfallPenaltyAlpha15 === null
      ? null
      : Math.max(0, Math.min(1, 1 - meanShortfallPenaltyAlpha15));
    const observedConsumptionMonths = ratios.length;
    const monthsBelow85 = ratios.length ? countBelowThreshold(ratios, SEVERE_RATIO_THRESHOLD) : null;
    const maxConsecutiveMonthsBelow85 = ratios.length ? maxConsecutiveBelowThreshold(ratios, SEVERE_RATIO_THRESHOLD) : null;
    const monthsBelow90 = ratios.length ? countBelowThreshold(ratios, MODERATE_RATIO_THRESHOLD) : null;
    const maxConsecutiveMonthsBelow90 = ratios.length ? maxConsecutiveBelowThreshold(ratios, MODERATE_RATIO_THRESHOLD) : null;
    const earlyStressMonthsBelow85 = ratios.length
      ? countBelowThreshold(ratios.slice(0, Math.min(EARLY_STRESS_WINDOW_MONTHS, horizonMonths)), SEVERE_RATIO_THRESHOLD)
      : null;
    const phaseStress = buildPhaseStress(ratios, horizonMonths, args.phaseEndYears);
    const postRuinMonths = ruinMonth === null
      ? 0
      : Math.max(0, horizonMonths - ruinMonth);

    if (ratios.length === 0) pathWarnings.push('consumption_ratios_missing');
    if (ratios.length > 0 && ratios.length < horizonMonths) pathWarnings.push('observed_consumption_months_incomplete');
    if (cutStates.length === 0) pathWarnings.push('cut_states_missing');
    if (houseSaleMonth !== null && houseSaleTriggerMonth === null) {
      pathWarnings.push('house_sale_trigger_missing_for_sale');
    }
    if (houseSaleMonth !== null && houseSaleTriggerMonth !== null && houseSaleMonth < houseSaleTriggerMonth) {
      pathWarnings.push('house_sale_trigger_after_sale');
    }
    if (ruinMonth !== null && postRuinMonths > 0 && ratios.length <= ruinMonth) {
      pathWarnings.push('post_ruin_months_unobserved');
    }
    if (houseSaleMonth === null && path.liquidWealthAfterHouseSaleClp !== null) {
      pathWarnings.push('house_sale_liquid_wealth_without_sale_month');
    }

    return {
      pathId: path.pathId,
      ruined: path.ruined,
      ruinMonth,
      ruinYear: ruinMonth !== null ? ruinMonth / 12 : null,
      terminalWealthClp: finiteOrNull(path.terminalWealthClp),
      qasrAlpha: QASR_ALPHA,
      meanShortfallPenaltyAlpha15,
      qualityScoreAlpha15,
      observedConsumptionMonths,
      postRuinMonths,
      averageConsumptionRatio: mean(ratios),
      minMonthlyConsumptionRatio: ratios.length ? Math.min(...ratios) : null,
      minAnnualConsumptionRatio: minAnnualConsumptionRatio(ratios),
      p10MonthlyConsumptionRatio: percentile(ratios, 10),
      p25MonthlyConsumptionRatio: percentile(ratios, 25),
      monthsBelow85,
      maxConsecutiveMonthsBelow85,
      monthsBelow90,
      maxConsecutiveMonthsBelow90,
      earlyStressMonthsBelow85,
      phaseStress,
      monthsInCut: cutStates.length ? cutStates.filter((state) => state >= 1).length : null,
      monthsInSevereCut: cutStates.length ? cutStates.filter((state) => state >= 2).length : null,
      maxConsecutiveCutMonths: cutStates.length ? maxConsecutive(cutStates, (state) => state >= 1) : null,
      maxConsecutiveSevereCutMonths: cutStates.length ? maxConsecutive(cutStates, (state) => state >= 2) : null,
      houseSold: houseSaleMonth !== null,
      houseSaleTriggerMonth,
      houseSaleTriggerYear: houseSaleTriggerMonth !== null ? houseSaleTriggerMonth / 12 : null,
      houseSaleMonth,
      houseSaleYear: houseSaleMonth !== null ? houseSaleMonth / 12 : null,
      monthsBetweenHouseSaleTriggerAndSale,
      monthsInCutBetweenHouseSaleTriggerAndSale: hasTriggerAndSale
        ? saleWindowStates.filter((state) => state >= 1).length
        : null,
      monthsInSevereCutBetweenHouseSaleTriggerAndSale: hasTriggerAndSale
        ? saleWindowStates.filter((state) => state >= 2).length
        : null,
      monthsInCutBeforeHouseSale: houseSaleMonth !== null
        ? beforeSaleStates.filter((state) => state >= 1).length
        : null,
      monthsInSevereCutBeforeHouseSale: houseSaleMonth !== null
        ? beforeSaleStates.filter((state) => state >= 2).length
        : null,
      liquidWealthAfterHouseSaleClp: finiteOrNull(path.liquidWealthAfterHouseSaleClp),
      warnings: pathWarnings,
    };
  });

  return {
    schemaVersion: 1,
    pathCount,
    horizonMonths,
    source: 'm8_runtime_path_summary',
    warnings,
    paths,
  };
}
