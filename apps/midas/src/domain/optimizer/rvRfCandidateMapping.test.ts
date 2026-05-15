import assert from 'node:assert/strict';
import type { PortfolioWeights } from '../model/types';
import { buildRvRfCandidateWeights, summarizeRvRfCandidateWeights } from './rvRfCandidateMapping';

const baseWeights: PortfolioWeights = {
  rvGlobal: 0.44,
  rvChile: 0.16,
  rfGlobal: 0.24,
  rfChile: 0.16,
};

const closeTo = (actual: number, expected: number, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} !== ${expected}`);
};

{
  const weights = buildRvRfCandidateWeights(baseWeights, 25);
  const summary = summarizeRvRfCandidateWeights(weights);
  closeTo(summary.rvTotal, 0.25);
  closeTo(summary.rfTotal, 0.75);
  closeTo(summary.total, 1);
}

{
  const zeroRv = buildRvRfCandidateWeights(baseWeights, 0);
  closeTo(zeroRv.rvGlobal + zeroRv.rvChile, 0);
  closeTo(zeroRv.rfGlobal + zeroRv.rfChile, 1);

  const allRv = buildRvRfCandidateWeights(baseWeights, 100);
  closeTo(allRv.rvGlobal + allRv.rvChile, 1);
  closeTo(allRv.rfGlobal + allRv.rfChile, 0);
}

{
  const weights = buildRvRfCandidateWeights(baseWeights, 50);
  const originalRvGlobalShare = baseWeights.rvGlobal / (baseWeights.rvGlobal + baseWeights.rvChile);
  const originalRfGlobalShare = baseWeights.rfGlobal / (baseWeights.rfGlobal + baseWeights.rfChile);
  const candidateRvGlobalShare = weights.rvGlobal / (weights.rvGlobal + weights.rvChile);
  const candidateRfGlobalShare = weights.rfGlobal / (weights.rfGlobal + weights.rfChile);
  closeTo(candidateRvGlobalShare, originalRvGlobalShare);
  closeTo(candidateRfGlobalShare, originalRfGlobalShare);
}

{
  const noRv: PortfolioWeights = { rvGlobal: 0, rvChile: 0, rfGlobal: 0.65, rfChile: 0.35 };
  const weights = buildRvRfCandidateWeights(noRv, 40);
  closeTo(weights.rvGlobal + weights.rvChile, 0.4);
  closeTo(weights.rfGlobal + weights.rfChile, 0.6);
  closeTo(weights.rvGlobal / (weights.rvGlobal + weights.rvChile), 0.65);
}

{
  const noRf: PortfolioWeights = { rvGlobal: 0.75, rvChile: 0.25, rfGlobal: 0, rfChile: 0 };
  const weights = buildRvRfCandidateWeights(noRf, 40);
  closeTo(weights.rvGlobal + weights.rvChile, 0.4);
  closeTo(weights.rfGlobal + weights.rfChile, 0.6);
  closeTo(weights.rfGlobal / (weights.rfGlobal + weights.rfChile), 0.75);
}

console.log('rvRfCandidateMapping tests passed');
