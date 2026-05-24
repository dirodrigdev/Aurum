import type { ModelParameters } from '../model/types';

export const SPENDING_HEADROOM_SCALES = [1, 1.2, 1.3] as const;

export type SpendingHeadroomScale = (typeof SPENDING_HEADROOM_SCALES)[number];

export type SpendingHeadroomThresholds = {
  minQasrStrict: number;
  minCsr85_4: number;
  minClassicSuccessRate: number;
};

export type SpendingHeadroomEvaluation = {
  spendScale: number;
  qasrStrict: number | null;
  csr85_4: number | null;
  classicSuccessRate: number | null;
  houseSaleRate?: number | null;
  terminalWealthP25?: number | null;
  terminalWealthP50?: number | null;
};

export const DEFAULT_SPENDING_HEADROOM_THRESHOLDS: SpendingHeadroomThresholds = {
  minQasrStrict: 0.9,
  minCsr85_4: 0.85,
  minClassicSuccessRate: 0.9,
};

function cloneParams<T>(params: T): T {
  return JSON.parse(JSON.stringify(params)) as T;
}

export function applyTemporarySpendScale(params: ModelParameters, spendScale: number): ModelParameters {
  const next = cloneParams(params);
  next.spendingPhases = next.spendingPhases.map((phase) => ({
    ...phase,
    amountReal: phase.amountReal * spendScale,
  }));
  return next;
}

export function passesQualityAtSpendScale(
  evaluation: SpendingHeadroomEvaluation,
  thresholds: SpendingHeadroomThresholds = DEFAULT_SPENDING_HEADROOM_THRESHOLDS,
): boolean {
  return (
    evaluation.qasrStrict !== null
    && evaluation.qasrStrict >= thresholds.minQasrStrict
    && evaluation.csr85_4 !== null
    && evaluation.csr85_4 >= thresholds.minCsr85_4
    && evaluation.classicSuccessRate !== null
    && evaluation.classicSuccessRate >= thresholds.minClassicSuccessRate
  );
}

export function computeMaxSpendScalePassingQoL(
  evaluations: SpendingHeadroomEvaluation[],
  thresholds: SpendingHeadroomThresholds = DEFAULT_SPENDING_HEADROOM_THRESHOLDS,
): number | null {
  const sorted = [...evaluations].sort((a, b) => a.spendScale - b.spendScale);
  if (!sorted.length || !passesQualityAtSpendScale(sorted[0], thresholds)) return null;
  let best = sorted[0].spendScale;
  for (const evaluation of sorted.slice(1)) {
    if (passesQualityAtSpendScale(evaluation, thresholds)) {
      best = evaluation.spendScale;
    }
  }
  return best;
}
