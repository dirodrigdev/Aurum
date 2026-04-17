import type { PortfolioWeights } from './model/types';

export type InstrumentUniverseMixKey = 'rv' | 'rf' | 'cash' | 'other';
export type InstrumentUniverseRange = { min: number; max: number };
export type InstrumentUniverseMix = Record<InstrumentUniverseMixKey, number>;
export type InstrumentUniverseRangeMix = Record<InstrumentUniverseMixKey, InstrumentUniverseRange>;
export type InstrumentUniverseExposureUsed = {
  global: number | null;
  local: number | null;
};

export type InstrumentUniverseInstrument = {
  instrumentId: string;
  name: string | null;
  vehicleType: string | null;
  currency: string | null;
  taxWrapper: string | null;
  isCaptive: boolean | null;
  isSellable: boolean | null;
  currentMixUsed: InstrumentUniverseMix | null;
  legalRange: unknown;
  historicalUsedRange: InstrumentUniverseRangeMix | null;
  observedWindowMonths: number | null;
  observedFrom: string | null;
  observedTo: string | null;
  estimationMethod: string | null;
  confidenceScore: number | null;
  sourcePreference: string | null;
  exposureUsed: InstrumentUniverseExposureUsed | null;
  amountClp: number | null;
  weightPortfolio: number | null;
  role: string | null;
  structuralMixDriver: string | null;
  estimatedMixImpactPoints: number | null;
  replaceabilityScore: number | null;
  replacementConstraint: string | null;
  sameCurrencyCandidates: string[];
  sameManagerCandidates: string[];
  sameTaxWrapperCandidates: string[];
  decisionEligible: boolean | null;
  missingCriticalFields: string[];
  warnings: string[];
  usable: boolean;
};

export type InstrumentUniverseSummary = {
  instrumentCount: number;
  usableInstrumentCount: number;
  totalWeightPortfolio: number;
  totalAmountClp: number;
  currentMix: InstrumentUniverseMix | null;
  historicalUsedRange: InstrumentUniverseRangeMix | null;
  targetRv: number | null;
  targetWithinHistoricalRange: boolean | null;
  structuralChangeRequired: boolean | null;
  warnings: string[];
};

export type InstrumentUniverseSnapshot = {
  version: 1;
  savedAt: string;
  rawJson: string;
  instruments: InstrumentUniverseInstrument[];
  optimizerMetadata: unknown;
  portfolioSummary: unknown;
  methodology: unknown;
};

export type InstrumentUniverseValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  snapshot: InstrumentUniverseSnapshot | null;
  summary: InstrumentUniverseSummary | null;
};

const STORAGE_KEY = 'midas.instrument-universe.v1';
const VERSION = 1 as const;
const MIX_KEYS: InstrumentUniverseMixKey[] = ['rv', 'rf', 'cash', 'other'];
const CRITICAL_FIELDS = [
  'instrument_id',
  'name',
  'vehicle_type',
  'currency',
  'tax_wrapper',
  'is_captive',
  'is_sellable',
  'current_mix_used',
  'legal_range',
  'historical_used_range',
  'observed_window_months',
  'observed_from',
  'observed_to',
  'estimation_method',
  'confidence_score',
  'amount_clp',
  'weight_portfolio',
  'role',
  'structural_mix_driver',
  'estimated_mix_impact_points',
  'replaceability_score',
  'replacement_constraint',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeRatio = (value: unknown): number | null => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(1, Math.abs(parsed) > 1 ? parsed / 100 : parsed));
};

const normalizeLooseNumber = (value: unknown): number | null => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : parsed;
};

const readString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'si', 'sí', '1'].includes(normalized)) return true;
    if (['false', 'no', '0'].includes(normalized)) return false;
  }
  return null;
};

const pickArray = (root: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] => {
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
};

const parseMix = (value: unknown): InstrumentUniverseMix | null => {
  if (!isRecord(value)) return null;
  const mix = MIX_KEYS.reduce<InstrumentUniverseMix>((acc, key) => {
    acc[key] = normalizeRatio(value[key]) ?? 0;
    return acc;
  }, { rv: 0, rf: 0, cash: 0, other: 0 });
  return MIX_KEYS.some((key) => mix[key] > 0) ? mix : null;
};

const parseRangeValue = (value: unknown): InstrumentUniverseRange | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const first = normalizeRatio(value[0]);
    const second = normalizeRatio(value[1]);
    if (first === null || second === null) return null;
    return { min: Math.min(first, second), max: Math.max(first, second) };
  }
  if (isRecord(value)) {
    const min = normalizeRatio(value.min ?? value.low ?? value.from);
    const max = normalizeRatio(value.max ?? value.high ?? value.to);
    if (min === null || max === null) return null;
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  return null;
};

const parseRangeMix = (value: unknown): InstrumentUniverseRangeMix | null => {
  if (!isRecord(value)) return null;
  const range = MIX_KEYS.reduce<InstrumentUniverseRangeMix>((acc, key) => {
    acc[key] =
      parseRangeValue(value[key]) ??
      parseRangeValue([value[`${key}_min`], value[`${key}_max`]]) ??
      { min: 0, max: 0 };
    return acc;
  }, {
    rv: { min: 0, max: 0 },
    rf: { min: 0, max: 0 },
    cash: { min: 0, max: 0 },
    other: { min: 0, max: 0 },
  });
  return MIX_KEYS.some((key) => range[key].max > 0) ? range : null;
};

const parseExposureUsed = (value: unknown): InstrumentUniverseExposureUsed | null => {
  if (!isRecord(value)) return null;
  const global = normalizeRatio(value.global);
  const local = normalizeRatio(value.local);
  if (global === null && local === null) return null;
  return { global, local };
};

const idFrom = (row: Record<string, unknown>) => readString(row.instrument_id ?? row.instrumentId ?? row.id);

const mergeByInstrumentId = (rows: Record<string, unknown>[][]): Map<string, Record<string, unknown>> => {
  const map = new Map<string, Record<string, unknown>>();
  rows.flat().forEach((row) => {
    const id = idFrom(row);
    if (!id) return;
    map.set(id, { ...(map.get(id) ?? {}), ...row, instrument_id: id });
  });
  return map;
};

const hasValue = (source: Record<string, unknown>, snakeKey: string) => {
  const camelKey = snakeKey.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const value = source[snakeKey] ?? source[camelKey];
  return value !== undefined && value !== null && value !== '';
};

const missingCriticalFieldsFor = (source: Record<string, unknown>) =>
  CRITICAL_FIELDS.filter((field) => {
    const camel = field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return !hasValue(source, field) && !hasValue(source, camel);
  });

const mixSumWarning = (label: string, mix: InstrumentUniverseMix | null) => {
  if (!mix) return null;
  const sum = MIX_KEYS.reduce((acc, key) => acc + mix[key], 0);
  return Math.abs(sum - 1) > 0.03 ? `${label}: RV + RF + cash + other suma ${(sum * 100).toFixed(1)}%.` : null;
};

const exposureWarning = (label: string, exposure: InstrumentUniverseExposureUsed | null) => {
  if (!exposure || exposure.global === null || exposure.local === null) return null;
  const sum = exposure.global + exposure.local;
  return Math.abs(sum - 1) > 0.03 ? `${label}: global + local suma ${(sum * 100).toFixed(1)}%.` : null;
};

const buildInstrument = (source: Record<string, unknown>): InstrumentUniverseInstrument => {
  const instrumentId = idFrom(source) ?? '';
  const currentMixUsed = parseMix(source.current_mix_used ?? source.currentMixUsed);
  const historicalUsedRange = parseRangeMix(source.historical_used_range ?? source.historicalUsedRange);
  const dataQuality = isRecord(source.data_quality ?? source.dataQuality)
    ? (source.data_quality ?? source.dataQuality) as Record<string, unknown>
    : null;
  const sourceMetadata = isRecord(source.source_metadata ?? source.sourceMetadata)
    ? (source.source_metadata ?? source.sourceMetadata) as Record<string, unknown>
    : null;
  const exposureUsed = parseExposureUsed(
    source.exposure_used ?? source.current_exposure_used ?? source.exposureUsed ?? source.currentExposureUsed,
  );
  const missingCriticalFields = missingCriticalFieldsFor(source);
  const warnings = [
    mixSumWarning(instrumentId, currentMixUsed),
    exposureWarning(instrumentId, exposureUsed),
  ].filter((item): item is string => !!item);

  return {
    instrumentId,
    name: readString(source.name),
    vehicleType: readString(source.vehicle_type ?? source.vehicleType),
    currency: readString(source.currency),
    taxWrapper: readString(source.tax_wrapper ?? source.taxWrapper),
    isCaptive: readBoolean(source.is_captive ?? source.isCaptive),
    isSellable: readBoolean(source.is_sellable ?? source.isSellable),
    currentMixUsed,
    legalRange: source.legal_range ?? source.legalRange ?? null,
    historicalUsedRange,
    observedWindowMonths: normalizeLooseNumber(
      source.observed_window_months
      ?? source.observedWindowMonths
      ?? sourceMetadata?.observed_window_months
      ?? sourceMetadata?.window_months,
    ),
    observedFrom: readString(source.observed_from ?? source.observedFrom ?? sourceMetadata?.observed_from ?? sourceMetadata?.from),
    observedTo: readString(source.observed_to ?? source.observedTo ?? sourceMetadata?.observed_to ?? sourceMetadata?.to),
    estimationMethod: readString(source.estimation_method ?? source.estimationMethod ?? sourceMetadata?.estimation_method ?? sourceMetadata?.method),
    confidenceScore: normalizeRatio(source.confidence_score ?? source.confidenceScore ?? dataQuality?.confidence_score),
    sourcePreference: readString(source.source_preference ?? source.sourcePreference ?? sourceMetadata?.source_preference ?? dataQuality?.range_source_type),
    exposureUsed,
    amountClp: normalizeLooseNumber(source.amount_clp ?? source.amountClp),
    weightPortfolio: normalizeRatio(source.weight_portfolio ?? source.weightPortfolio),
    role: readString(source.role),
    structuralMixDriver: readString(source.structural_mix_driver ?? source.structuralMixDriver),
    estimatedMixImpactPoints: normalizeLooseNumber(source.estimated_mix_impact_points ?? source.estimatedMixImpactPoints),
    replaceabilityScore: normalizeRatio(source.replaceability_score ?? source.replaceabilityScore),
    replacementConstraint: readString(source.replacement_constraint ?? source.replacementConstraint),
    sameCurrencyCandidates: Array.isArray(source.same_currency_candidates)
      ? source.same_currency_candidates.map((item) => String(item)).filter(Boolean)
      : [],
    sameManagerCandidates: Array.isArray(source.same_manager_candidates)
      ? source.same_manager_candidates.map((item) => String(item)).filter(Boolean)
      : [],
    sameTaxWrapperCandidates: Array.isArray(source.same_tax_wrapper_candidates)
      ? source.same_tax_wrapper_candidates.map((item) => String(item)).filter(Boolean)
      : [],
    decisionEligible: readBoolean(source.decision_eligible ?? source.decisionEligible),
    missingCriticalFields,
    warnings,
    usable:
      !!instrumentId &&
      !!currentMixUsed &&
      !!historicalUsedRange &&
      (normalizeRatio(source.weight_portfolio ?? source.weightPortfolio) ?? 0) > 0,
  };
};

export const summarizeInstrumentUniverse = (
  snapshot: InstrumentUniverseSnapshot | null,
  targetWeights?: PortfolioWeights | null,
): InstrumentUniverseSummary | null => {
  if (!snapshot) return null;
  const usable = snapshot.instruments.filter((item) => item.usable && item.weightPortfolio !== null);
  const totalWeightPortfolio = usable.reduce((sum, item) => sum + (item.weightPortfolio ?? 0), 0);
  const totalAmountClp = snapshot.instruments.reduce((sum, item) => sum + Math.max(0, item.amountClp ?? 0), 0);
  const warnings = snapshot.instruments.flatMap((item) => [
    ...item.warnings,
    ...item.missingCriticalFields.map((field) => `${item.instrumentId || item.name || 'Instrumento'}: falta ${field}.`),
  ]);

  const currentMix =
    totalWeightPortfolio > 0
      ? usable.reduce<InstrumentUniverseMix>(
          (acc, item) => {
            MIX_KEYS.forEach((key) => {
              acc[key] += (item.currentMixUsed?.[key] ?? 0) * (item.weightPortfolio ?? 0);
            });
            return acc;
          },
          { rv: 0, rf: 0, cash: 0, other: 0 },
        )
      : null;

  const historicalUsedRange =
    totalWeightPortfolio > 0
      ? usable.reduce<InstrumentUniverseRangeMix>(
          (acc, item) => {
            MIX_KEYS.forEach((key) => {
              const range = item.historicalUsedRange?.[key];
              const weight = item.weightPortfolio ?? 0;
              acc[key].min += (range?.min ?? 0) * weight;
              acc[key].max += (range?.max ?? 0) * weight;
            });
            return acc;
          },
          {
            rv: { min: 0, max: 0 },
            rf: { min: 0, max: 0 },
            cash: { min: 0, max: 0 },
            other: { min: 0, max: 0 },
          },
        )
      : null;

  const targetRv = targetWeights
    ? Math.max(0, Math.min(1, targetWeights.rvGlobal + targetWeights.rvChile))
    : null;
  const targetWithinHistoricalRange =
    targetRv === null || !historicalUsedRange
      ? null
      : targetRv >= historicalUsedRange.rv.min - 0.005 && targetRv <= historicalUsedRange.rv.max + 0.005;

  return {
    instrumentCount: snapshot.instruments.length,
    usableInstrumentCount: usable.length,
    totalWeightPortfolio,
    totalAmountClp,
    currentMix,
    historicalUsedRange,
    targetRv,
    targetWithinHistoricalRange,
    structuralChangeRequired: targetWithinHistoricalRange === null ? null : !targetWithinHistoricalRange,
    warnings,
  };
};

export const validateInstrumentUniverseJson = (
  rawJson: string,
  targetWeights?: PortfolioWeights | null,
): InstrumentUniverseValidation => {
  const trimmed = String(rawJson || '').trim();
  if (!trimmed) {
    return { ok: false, errors: ['Pega o carga un instrument_universe.json antes de validar.'], warnings: [], snapshot: null, summary: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, errors: ['El JSON instrument_universe no es válido.'], warnings: [], snapshot: null, summary: null };
  }
  if (!isRecord(parsed)) {
    return { ok: false, errors: ['El JSON instrument_universe debe ser un objeto.'], warnings: [], snapshot: null, summary: null };
  }

  const topLevelRows = [
    pickArray(parsed, 'instrument_master', 'instrumentMaster'),
    pickArray(parsed, 'instrument_mix_profile', 'instrumentMixProfile'),
    pickArray(parsed, 'portfolio_position', 'portfolioPosition'),
    pickArray(parsed, 'optimizer_metadata', 'optimizerMetadata'),
  ];
  const nestedInstrumentRows = Array.isArray(parsed.instruments)
    ? parsed.instruments.flatMap((entry) => {
      if (!isRecord(entry)) return [] as Record<string, unknown>[];
      const nestedMaster = isRecord(entry.instrument_master) ? [entry.instrument_master] : [];
      const nestedMix = isRecord(entry.instrument_mix_profile) ? [entry.instrument_mix_profile] : [];
      const nestedPosition = isRecord(entry.portfolio_position) ? [entry.portfolio_position] : [];
      const nestedOptimizer = isRecord(entry.optimizer_metadata) ? [entry.optimizer_metadata] : [];
      return [
        ...nestedMaster,
        ...nestedMix,
        ...nestedPosition,
        ...nestedOptimizer,
        ...pickArray(entry, 'instrument_master', 'instrumentMaster'),
        ...pickArray(entry, 'instrument_mix_profile', 'instrumentMixProfile'),
        ...pickArray(entry, 'portfolio_position', 'portfolioPosition'),
        ...pickArray(entry, 'optimizer_metadata', 'optimizerMetadata'),
      ];
    })
    : [];
  const nestedCombinedRows = Array.isArray(parsed.instruments)
    ? parsed.instruments.flatMap((entry) => {
      if (!isRecord(entry)) return [] as Record<string, unknown>[];
      const master = isRecord(entry.instrument_master) ? entry.instrument_master : {};
      const mix = isRecord(entry.instrument_mix_profile) ? entry.instrument_mix_profile : {};
      const position = isRecord(entry.portfolio_position) ? entry.portfolio_position : {};
      const optimizer = isRecord(entry.optimizer_metadata) ? entry.optimizer_metadata : {};
      const combined = {
        ...master,
        ...mix,
        ...position,
        ...optimizer,
      };
      return idFrom(combined) ? [combined] : [];
    })
    : [];
  const instrumentRows = mergeByInstrumentId([
    ...topLevelRows,
    nestedInstrumentRows,
    nestedCombinedRows,
  ]);
  if (instrumentRows.size === 0) {
    return {
      ok: false,
      errors: ['No encontré instrumentos en instrument_master / instrument_mix_profile / portfolio_position.'],
      warnings: [],
      snapshot: null,
      summary: null,
    };
  }

  const instruments = [...instrumentRows.values()].map(buildInstrument);
  const snapshot: InstrumentUniverseSnapshot = {
    version: VERSION,
    savedAt: new Date().toISOString(),
    rawJson: trimmed,
    instruments,
    optimizerMetadata: parsed.optimizer_metadata ?? parsed.optimizerMetadata ?? null,
    portfolioSummary: parsed.portfolio_summary ?? parsed.portfolioSummary ?? null,
    methodology: parsed.methodology ?? null,
  };
  const summary = summarizeInstrumentUniverse(snapshot, targetWeights);
  const warnings = summary?.warnings ?? [];

  return {
    ok: true,
    errors: [],
    warnings,
    snapshot,
    summary,
  };
};

export const loadInstrumentUniverseSnapshot = (): InstrumentUniverseSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstrumentUniverseSnapshot | null;
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.instruments)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveInstrumentUniverseSnapshot = (snapshot: InstrumentUniverseSnapshot) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

export const clearInstrumentUniverseSnapshot = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
};
