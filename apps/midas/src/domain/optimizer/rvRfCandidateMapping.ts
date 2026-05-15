import type { PortfolioWeights } from '../model/types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function shareOrFallback(numerator: number, denominator: number, fallback: number): number {
  if (denominator > 0 && Number.isFinite(numerator / denominator)) {
    return clamp01(numerator / denominator);
  }
  return fallback;
}

export function buildRvRfCandidateWeights(currentWeights: PortfolioWeights, rvPct: number): PortfolioWeights {
  const totalGlobalShare = clamp01((currentWeights.rvGlobal + currentWeights.rfGlobal) || 0.5);
  const currentRvTotal = currentWeights.rvGlobal + currentWeights.rvChile;
  const currentRfTotal = currentWeights.rfGlobal + currentWeights.rfChile;
  const rvGlobalShare = shareOrFallback(currentWeights.rvGlobal, currentRvTotal, totalGlobalShare);
  const rfGlobalShare = shareOrFallback(currentWeights.rfGlobal, currentRfTotal, totalGlobalShare);
  const rv = clamp01(rvPct / 100);
  const rf = 1 - rv;

  return {
    rvGlobal: rv * rvGlobalShare,
    rvChile: rv * (1 - rvGlobalShare),
    rfGlobal: rf * rfGlobalShare,
    rfChile: rf * (1 - rfGlobalShare),
  };
}

export function summarizeRvRfCandidateWeights(weights: PortfolioWeights): {
  rvTotal: number;
  rfTotal: number;
  total: number;
} {
  const rvTotal = weights.rvGlobal + weights.rvChile;
  const rfTotal = weights.rfGlobal + weights.rfChile;
  return {
    rvTotal,
    rfTotal,
    total: rvTotal + rfTotal,
  };
}
