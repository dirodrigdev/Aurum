import type { InstrumentBaseSnapshot } from '../instrumentBase';
import { inferImplicitMixFromInstrumentBase } from '../instrumentBase';
import type { InstrumentUniverseSnapshot } from '../instrumentUniverse';
import type { ModelParameters, PortfolioWeights, ReturnAssumptions } from './types';

export type WeightsSourceMode =
  | 'instrument-universe'
  | 'instrument-base'
  | 'json-official'
  | 'last-known-official'
  | 'system-defaults'
  | 'simulation'
  | 'error';

export type EffectiveMixSourceMode = 'instrument-universe' | 'instrument-base' | 'system-defaults' | 'error';

export type EffectiveMixDiagnostics = {
  universeUsableCount: number;
  universeTotalWeightPortfolio: number;
  cashOtherSleeve: keyof Pick<PortfolioWeights, 'rfGlobal' | 'rfChile'>;
  cashOtherWeight: number;
  notes: string[];
};

export type EffectiveMixResolution = {
  universeWeights: PortfolioWeights | null;
  instrumentBaseWeights: PortfolioWeights | null;
  activeWeights: PortfolioWeights;
  weightsSourceMode: EffectiveMixSourceMode;
  sourceLabel: string;
  fallbackReason: string | null;
  activeWeightsSavedAt: string | null;
  diagnostics: EffectiveMixDiagnostics;
};

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

const resolveLowestReturnFixedIncomeSleeve = (
  returns: Pick<ReturnAssumptions, 'rfGlobalAnnual' | 'rfChileUFAnnual'>,
): keyof Pick<PortfolioWeights, 'rfGlobal' | 'rfChile'> =>
  returns.rfChileUFAnnual <= returns.rfGlobalAnnual ? 'rfChile' : 'rfGlobal';

const normalizePair = (first: number | null | undefined, second: number | null | undefined) => {
  const safeFirst = clamp01(Number(first ?? 0));
  const safeSecond = clamp01(Number(second ?? 0));
  const sum = safeFirst + safeSecond;
  if (sum <= 0) return null;
  return { first: safeFirst / sum, second: safeSecond / sum };
};

const normalizeUniverseMix = (mix: InstrumentUniverseSnapshot['instruments'][number]['currentMixUsed']) => {
  if (!mix) return null;
  const rv = clamp01(mix.rv);
  const rf = clamp01(mix.rf);
  const cash = clamp01(mix.cash);
  const other = clamp01(mix.other);
  const sum = rv + rf + cash + other;
  if (sum <= 0) return null;
  return {
    rv: rv / sum,
    rf: rf / sum,
    cash: cash / sum,
    other: other / sum,
  };
};

export function deriveInstrumentUniverseDistributionWeights(input: {
  snapshot: InstrumentUniverseSnapshot | null;
  returns: Pick<ReturnAssumptions, 'rfGlobalAnnual' | 'rfChileUFAnnual'>;
}): {
  weights: PortfolioWeights;
  diagnostics: EffectiveMixDiagnostics;
} | null {
  const cashOtherSleeve = resolveLowestReturnFixedIncomeSleeve(input.returns);
  const emptyDiagnostics: EffectiveMixDiagnostics = {
    universeUsableCount: 0,
    universeTotalWeightPortfolio: 0,
    cashOtherSleeve,
    cashOtherWeight: 0,
    notes: [],
  };
  if (!input.snapshot) return null;

  const usable = input.snapshot.instruments.filter((item) => item.usable && (item.weightPortfolio ?? 0) > 0);
  if (usable.length === 0) return null;

  const diagnostics: EffectiveMixDiagnostics = {
    ...emptyDiagnostics,
    universeUsableCount: usable.length,
    universeTotalWeightPortfolio: usable.reduce((sum, item) => sum + Math.max(0, item.weightPortfolio ?? 0), 0),
  };
  const weights = usable.reduce<PortfolioWeights>((acc, item) => {
    const weight = Math.max(0, item.weightPortfolio ?? 0);
    const mix = item.currentMixUsed;
    const exposure = item.exposureUsed;
    const normalizedMix = normalizeUniverseMix(mix);
    const globalLocal = normalizePair(exposure?.global, exposure?.local);
    if (!normalizedMix || ((normalizedMix.rv + normalizedMix.rf) > 0 && !globalLocal)) {
      diagnostics.notes.push(`${item.instrumentId || item.name || 'instrumento'}: mix/exposure insuficiente para sleeves.`);
      return acc;
    }

    const cashOther = normalizedMix.cash + normalizedMix.other;
    if (globalLocal) {
      acc.rvGlobal += weight * normalizedMix.rv * globalLocal.first;
      acc.rvChile += weight * normalizedMix.rv * globalLocal.second;
      acc.rfGlobal += weight * normalizedMix.rf * globalLocal.first;
      acc.rfChile += weight * normalizedMix.rf * globalLocal.second;
    }
    acc[cashOtherSleeve] += weight * cashOther;
    diagnostics.cashOtherWeight += weight * cashOther;
    return acc;
  }, { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 0 });

  const total = weights.rvGlobal + weights.rfGlobal + weights.rvChile + weights.rfChile;
  if (total <= 0 || diagnostics.notes.length > 0) return null;
  diagnostics.notes.push(
    `cash/other asignado a ${cashOtherSleeve} por menor retorno esperado RF: ` +
      `rfChile=${(input.returns.rfChileUFAnnual * 100).toFixed(2)}%, ` +
      `rfGlobal=${(input.returns.rfGlobalAnnual * 100).toFixed(2)}%.`,
  );
  return {
    weights: normalizePortfolioWeights(weights),
    diagnostics,
  };
}

export function resolveEffectiveMixFromUniverseFirst(input: {
  universeWeights: PortfolioWeights | null;
  instrumentBaseWeights: PortfolioWeights | null;
  defaultWeights: PortfolioWeights | null;
  universeSavedAt?: string | null;
  instrumentBaseSavedAt?: string | null;
  diagnostics?: EffectiveMixDiagnostics | null;
}): EffectiveMixResolution {
  const universeWeights = sanitizePortfolioWeights(input.universeWeights);
  const instrumentBaseWeights = sanitizePortfolioWeights(input.instrumentBaseWeights);
  const defaultWeights = sanitizePortfolioWeights(input.defaultWeights);
  const fallbackDiagnostics = input.diagnostics ?? {
    universeUsableCount: 0,
    universeTotalWeightPortfolio: 0,
    cashOtherSleeve: 'rfChile',
    cashOtherWeight: 0,
    notes: [],
  };

  if (universeWeights) {
    return {
      universeWeights,
      instrumentBaseWeights,
      activeWeights: universeWeights,
      weightsSourceMode: 'instrument-universe',
      sourceLabel: 'Instrument Universe',
      fallbackReason: null,
      activeWeightsSavedAt: input.universeSavedAt ?? null,
      diagnostics: fallbackDiagnostics,
    };
  }
  if (instrumentBaseWeights) {
    return {
      universeWeights: null,
      instrumentBaseWeights,
      activeWeights: instrumentBaseWeights,
      weightsSourceMode: 'instrument-base',
      sourceLabel: 'Base instrumental real',
      fallbackReason: 'instrument_universe_missing_or_invalid',
      activeWeightsSavedAt: input.instrumentBaseSavedAt ?? null,
      diagnostics: fallbackDiagnostics,
    };
  }
  if (defaultWeights) {
    return {
      universeWeights: null,
      instrumentBaseWeights: null,
      activeWeights: defaultWeights,
      weightsSourceMode: 'system-defaults',
      sourceLabel: 'Defaults del sistema',
      fallbackReason: 'instrument_universe_and_instrument_base_missing',
      activeWeightsSavedAt: null,
      diagnostics: fallbackDiagnostics,
    };
  }
  return {
    universeWeights: null,
    instrumentBaseWeights: null,
    activeWeights: { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 },
    weightsSourceMode: 'error',
    sourceLabel: 'Error (sin distribución usable)',
    fallbackReason: 'no_usable_weights_found',
    activeWeightsSavedAt: null,
    diagnostics: fallbackDiagnostics,
  };
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
