import type { PathQualityDiagnosticsV1, PathQualityPathDiagnosticsV1 } from '../model/types';

export type M8PathQualityRuntimeSummary = {
  pathId: number;
  ruined: boolean;
  ruinMonth: number | null;
  terminalWealthClp: number | null;
  monthlyConsumptionRatios?: number[];
  cutStates?: number[];
  houseSaleMonth: number | null;
  liquidWealthAfterHouseSaleClp: number | null;
};

const QASR_ALPHA = 1.5 as const;

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

export function buildPathQualityDiagnosticsFromM8Output(args: {
  pathCount: number;
  horizonMonths: number;
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
    const houseSaleMonth = finiteOrNull(path.houseSaleMonth);
    const ruinMonth = finiteOrNull(path.ruinMonth);
    const beforeSaleStates = houseSaleMonth !== null
      ? cutStates.slice(0, Math.max(0, houseSaleMonth - 1))
      : [];
    const meanShortfallPenaltyAlpha15 = meanShortfallPenalty(ratios);
    const qualityScoreAlpha15 = meanShortfallPenaltyAlpha15 === null
      ? null
      : Math.max(0, Math.min(1, 1 - meanShortfallPenaltyAlpha15));
    const observedConsumptionMonths = ratios.length;
    const postRuinMonths = ruinMonth === null
      ? 0
      : Math.max(0, horizonMonths - ruinMonth);

    if (ratios.length === 0) pathWarnings.push('consumption_ratios_missing');
    if (ratios.length > 0 && ratios.length < horizonMonths) pathWarnings.push('observed_consumption_months_incomplete');
    if (cutStates.length === 0) pathWarnings.push('cut_states_missing');
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
      monthsInCut: cutStates.length ? cutStates.filter((state) => state >= 1).length : null,
      monthsInSevereCut: cutStates.length ? cutStates.filter((state) => state >= 2).length : null,
      maxConsecutiveCutMonths: cutStates.length ? maxConsecutive(cutStates, (state) => state >= 1) : null,
      maxConsecutiveSevereCutMonths: cutStates.length ? maxConsecutive(cutStates, (state) => state >= 2) : null,
      houseSold: houseSaleMonth !== null,
      houseSaleMonth,
      houseSaleYear: houseSaleMonth !== null ? houseSaleMonth / 12 : null,
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
