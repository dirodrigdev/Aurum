import type { InstrumentBaseSnapshot } from '../instrumentBase';
import { inferImplicitMixFromInstrumentBase } from '../instrumentBase';
import type { ModelParameters, PortfolioWeights } from './types';

export type WeightsSourceMode =
  | 'json-official'
  | 'last-known-official'
  | 'system-defaults'
  | 'simulation'
  | 'error';

export type OfficialDistributionState = {
  officialWeights: PortfolioWeights | null;
  lastKnownOfficialWeights: PortfolioWeights | null;
  activeWeights: PortfolioWeights;
  weightsSourceMode: Exclude<WeightsSourceMode, 'simulation'>;
  fallbackReason: string | null;
};

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export function sanitizePortfolioWeights(weights: PortfolioWeights | null | undefined): PortfolioWeights | null {
  if (!weights) return null;
  const normalized = normalizePortfolioWeights(weights);
  const sum = normalized.rvGlobal + normalized.rfGlobal + normalized.rvChile + normalized.rfChile;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return normalized;
}

export function normalizePortfolioWeights(weights: PortfolioWeights): PortfolioWeights {
  const rvGlobal = clamp01(weights.rvGlobal);
  const rfGlobal = clamp01(weights.rfGlobal);
  const rvChile = clamp01(weights.rvChile);
  const rfChile = clamp01(weights.rfChile);
  const sum = rvGlobal + rfGlobal + rvChile + rfChile;
  if (sum <= 0) return { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  return {
    rvGlobal: rvGlobal / sum,
    rfGlobal: rfGlobal / sum,
    rvChile: rvChile / sum,
    rfChile: rfChile / sum,
  };
}

export function deriveOfficialDistributionWeights(
  snapshot: InstrumentBaseSnapshot | null,
): PortfolioWeights | null {
  const mix = inferImplicitMixFromInstrumentBase(snapshot);
  if (!mix) return null;
  return normalizePortfolioWeights(mix.sleeves);
}

export function applyOfficialDistributionToParams(
  params: ModelParameters,
  officialWeights: PortfolioWeights | null,
): ModelParameters {
  if (!officialWeights) return params;
  return {
    ...params,
    weights: normalizePortfolioWeights(officialWeights),
  };
}

export function applyActiveDistributionToParams(
  params: ModelParameters,
  activeWeights: PortfolioWeights,
): ModelParameters {
  return {
    ...params,
    weights: normalizePortfolioWeights(activeWeights),
  };
}

export function resolveOfficialDistributionState(input: {
  jsonOfficialWeights: PortfolioWeights | null;
  lastKnownOfficialWeights: PortfolioWeights | null;
  defaultWeights: PortfolioWeights | null;
}): OfficialDistributionState {
  const jsonOfficialWeights = sanitizePortfolioWeights(input.jsonOfficialWeights);
  const lastKnownOfficialWeights = sanitizePortfolioWeights(input.lastKnownOfficialWeights);
  const defaultWeights = sanitizePortfolioWeights(input.defaultWeights);

  if (jsonOfficialWeights) {
    return {
      officialWeights: jsonOfficialWeights,
      lastKnownOfficialWeights: jsonOfficialWeights,
      activeWeights: jsonOfficialWeights,
      weightsSourceMode: 'json-official',
      fallbackReason: null,
    };
  }
  if (lastKnownOfficialWeights) {
    return {
      officialWeights: null,
      lastKnownOfficialWeights,
      activeWeights: lastKnownOfficialWeights,
      weightsSourceMode: 'last-known-official',
      fallbackReason: 'json_unavailable_or_invalid',
    };
  }
  if (defaultWeights) {
    return {
      officialWeights: null,
      lastKnownOfficialWeights: null,
      activeWeights: defaultWeights,
      weightsSourceMode: 'system-defaults',
      fallbackReason: 'official_and_last_known_missing',
    };
  }
  return {
    officialWeights: null,
    lastKnownOfficialWeights: null,
    activeWeights: { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 },
    weightsSourceMode: 'error',
    fallbackReason: 'no_usable_weights_found',
  };
}

export function shouldEnterSimulationWeightsMode(
  currentWeights: PortfolioWeights,
  nextWeights: PortfolioWeights,
  tolerance = 1e-9,
): boolean {
  const current = normalizePortfolioWeights(currentWeights);
  const next = normalizePortfolioWeights(nextWeights);
  return !areWeightsEquivalent(current, next, tolerance);
}

export function areWeightsEquivalent(
  a: PortfolioWeights,
  b: PortfolioWeights,
  tolerance = 1e-9,
): boolean {
  return (
    Math.abs(a.rvGlobal - b.rvGlobal) <= tolerance &&
    Math.abs(a.rfGlobal - b.rfGlobal) <= tolerance &&
    Math.abs(a.rvChile - b.rvChile) <= tolerance &&
    Math.abs(a.rfChile - b.rfChile) <= tolerance
  );
}
