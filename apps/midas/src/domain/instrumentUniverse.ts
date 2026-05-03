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
  legalRangeMix: InstrumentUniverseRangeMix | null;
  historicalUsedRange: InstrumentUniverseRangeMix | null;
  optimizerSafeRange: InstrumentUniverseRangeMix | null;
  operationalRange: InstrumentUniverseRangeMix | null;
  observedWindowMonths: number | null;
  observedFrom: string | null;
  observedTo: string | null;
  estimationMethod: string | null;
  confidenceScore: number | null;
  sourcePreference: string | null;
  exposureUsed: InstrumentUniverseExposureUsed | null;
  amountClp: number | null;
  amountNative: number | null;
  amountNativeCurrency: string | null;
  fxToClpUsed: number | null;
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

export type InstrumentUniverseSnapshotMetadata = {
  loadedAt: string;
  importedAt: string;
  fileName: string | null;
  source: string;
  instrumentsCount: number;
  validInstrumentsCount: number;
  totalWeightPortfolio: number;
  totalAmountClp: number;
  hasUsableAmounts: boolean;
  hasUsableWeights: boolean;
  hasUsableMix: boolean;
  warnings: string[];
  amountSource: 'amount_clp' | 'weight_portfolio' | 'mixed' | 'unknown';
  checksum: string;
  schemaVersion: number;
  lastValid: true;
};

export type InstrumentUniverseFailedImport = {
  attemptedAt: string;
  fileName: string | null;
  source: string;
  errors: string[];
  warnings: string[];
};

export type InstrumentUniverseValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  snapshot: InstrumentUniverseSnapshot | null;
  summary: InstrumentUniverseSummary | null;
  instrumentsCount: number;
  validInstrumentsCount: number;
  totalWeightPortfolio: number;
  totalAmountClp: number;
  hasUsableAmounts: boolean;
  hasUsableWeights: boolean;
  hasUsableMix: boolean;
  schemaVersion: number | null;
};

const STORAGE_KEY = 'midas.instrument-universe.v1';
const STORAGE_META_KEY = 'midas.instrument-universe.meta.v1';
const STORAGE_FAILED_KEY = 'midas.instrument-universe.failed-import.v1';
const VERSION = 1 as const;
const MIX_KEYS: InstrumentUniverseMixKey[] = ['rv', 'rf', 'cash', 'other'];
const CRITICAL_FIELDS = [
  'instrument_id',
  'name',
  'vehicle_type',
  'currency',
  'is_captive',
  'is_sellable',
  'current_mix_used',
  'legal_range',
  'historical_used_range',
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

const mergeUnique = (items: string[]) => [...new Set(items)];

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

const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const buildInstrument = (source: Record<string, unknown>): InstrumentUniverseInstrument => {
  const instrumentId = idFrom(source) ?? '';
  const currentMixUsed = parseMix(source.current_mix_used ?? source.currentMixUsed);
  const legalRangeMix = parseRangeMix(source.legal_range ?? source.legalRange);
  const historicalUsedRange = parseRangeMix(source.historical_used_range ?? source.historicalUsedRange);
  const optimizerSafeRange = parseRangeMix(source.optimizer_safe_range ?? source.optimizerSafeRange);
  const operationalRange = optimizerSafeRange ?? historicalUsedRange;
  const historicalRangeSource = isRecord(source.historical_used_range ?? source.historicalUsedRange)
    ? (source.historical_used_range ?? source.historicalUsedRange) as Record<string, unknown>
    : null;
  const dataQuality = isRecord(source.data_quality ?? source.dataQuality)
    ? (source.data_quality ?? source.dataQuality) as Record<string, unknown>
    : null;
  const sourceMetadata = isRecord(source.source_metadata ?? source.sourceMetadata)
    ? (source.source_metadata ?? source.sourceMetadata) as Record<string, unknown>
    : null;
  const exposureUsed = parseExposureUsed(
    source.exposure_used ?? source.current_exposure_used ?? source.exposureUsed ?? source.currentExposureUsed,
  );
  const observedWindowMonths = normalizeLooseNumber(
    source.observed_window_months
    ?? source.observedWindowMonths
    ?? historicalRangeSource?.observed_window_months
    ?? historicalRangeSource?.observedWindowMonths
    ?? sourceMetadata?.observed_window_months
    ?? sourceMetadata?.window_months,
  );
  const observedFrom = readString(
    source.observed_from
    ?? source.observedFrom
    ?? historicalRangeSource?.observed_from
    ?? historicalRangeSource?.observedFrom
    ?? sourceMetadata?.observed_from
    ?? sourceMetadata?.from,
  );
  const observedTo = readString(
    source.observed_to
    ?? source.observedTo
    ?? historicalRangeSource?.observed_to
    ?? historicalRangeSource?.observedTo
    ?? sourceMetadata?.observed_to
    ?? sourceMetadata?.to,
  );
  const estimationMethod = readString(
    source.estimation_method
    ?? source.estimationMethod
    ?? historicalRangeSource?.estimation_method
    ?? historicalRangeSource?.estimationMethod
    ?? sourceMetadata?.estimation_method
    ?? sourceMetadata?.method,
  );
  const confidenceScore = normalizeRatio(source.confidence_score ?? source.confidenceScore ?? dataQuality?.confidence_score);
  const missingCriticalFields = mergeUnique([
    ...missingCriticalFieldsFor(source),
    ...(!currentMixUsed ? ['current_mix_used'] : []),
    ...(!operationalRange ? ['historical_used_range'] : []),
    ...(normalizeRatio(source.weight_portfolio ?? source.weightPortfolio) === null ? ['weight_portfolio'] : []),
  ]);
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
    legalRangeMix,
    historicalUsedRange,
    optimizerSafeRange,
    operationalRange,
    observedWindowMonths,
    observedFrom,
    observedTo,
    estimationMethod,
    confidenceScore,
    sourcePreference: readString(source.source_preference ?? source.sourcePreference ?? sourceMetadata?.source_preference ?? dataQuality?.range_source_type),
    exposureUsed,
    amountClp: normalizeLooseNumber(source.amount_clp ?? source.amountClp),
    amountNative: normalizeLooseNumber(source.amount_native ?? source.amountNative),
    amountNativeCurrency: readString(source.amount_native_currency ?? source.amountNativeCurrency ?? source.currency),
    fxToClpUsed: normalizeLooseNumber(source.fx_to_clp_used ?? source.fxToClpUsed),
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
      !!operationalRange &&
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
              const range = item.operationalRange?.[key];
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
    return {
      ok: false,
      errors: ['La carga no se aplicó. El archivo está vacío o no contiene instrumentos válidos. Se mantiene la última carga válida.'],
      warnings: [],
      snapshot: null,
      summary: null,
      instrumentsCount: 0,
      validInstrumentsCount: 0,
      totalWeightPortfolio: 0,
      totalAmountClp: 0,
      hasUsableAmounts: false,
      hasUsableWeights: false,
      hasUsableMix: false,
      schemaVersion: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      errors: ['La carga no se aplicó. El archivo no es JSON válido. Se mantiene la última carga válida.'],
      warnings: [],
      snapshot: null,
      summary: null,
      instrumentsCount: 0,
      validInstrumentsCount: 0,
      totalWeightPortfolio: 0,
      totalAmountClp: 0,
      hasUsableAmounts: false,
      hasUsableWeights: false,
      hasUsableMix: false,
      schemaVersion: null,
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      errors: ['La carga no se aplicó. El instrument_universe debe ser un objeto JSON. Se mantiene la última carga válida.'],
      warnings: [],
      snapshot: null,
      summary: null,
      instrumentsCount: 0,
      validInstrumentsCount: 0,
      totalWeightPortfolio: 0,
      totalAmountClp: 0,
      hasUsableAmounts: false,
      hasUsableWeights: false,
      hasUsableMix: false,
      schemaVersion: null,
    };
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
      errors: ['La carga no se aplicó. El archivo no contiene instrumentos válidos. Se mantiene la última carga válida.'],
      warnings: [],
      snapshot: null,
      summary: null,
      instrumentsCount: 0,
      validInstrumentsCount: 0,
      totalWeightPortfolio: 0,
      totalAmountClp: 0,
      hasUsableAmounts: false,
      hasUsableWeights: false,
      hasUsableMix: false,
      schemaVersion: null,
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
  return validateInstrumentUniverseSnapshot(snapshot, targetWeights);
};

export const validateInstrumentUniverseSnapshot = (
  snapshot: InstrumentUniverseSnapshot | null,
  targetWeights?: PortfolioWeights | null,
): InstrumentUniverseValidation => {
  if (!snapshot) {
    return {
      ok: false,
      errors: ['La carga no se aplicó. El archivo no contiene instrumentos válidos. Se mantiene la última carga válida.'],
      warnings: [],
      snapshot: null,
      summary: null,
      instrumentsCount: 0,
      validInstrumentsCount: 0,
      totalWeightPortfolio: 0,
      totalAmountClp: 0,
      hasUsableAmounts: false,
      hasUsableWeights: false,
      hasUsableMix: false,
      schemaVersion: null,
    };
  }
  const summary = summarizeInstrumentUniverse(snapshot, targetWeights);
  const instrumentsCount = snapshot.instruments.length;
  const validInstrumentsCount = snapshot.instruments.filter((item) => item.usable).length;
  const totalWeightPortfolio = snapshot.instruments.reduce((sum, item) => sum + Math.max(0, item.weightPortfolio ?? 0), 0);
  const totalAmountClp = snapshot.instruments.reduce((sum, item) => sum + Math.max(0, item.amountClp ?? 0), 0);
  const hasUsableAmounts = snapshot.instruments.some((item) => Number(item.amountClp ?? 0) > 0);
  const hasUsableWeights = snapshot.instruments.some((item) => Number(item.weightPortfolio ?? 0) > 0);
  const hasUsableMix = snapshot.instruments.some((item) => !!item.currentMixUsed);
  const warnings = summary?.warnings ?? [];
  const errors: string[] = [];

  if (instrumentsCount === 0) errors.push('El archivo no contiene instrumentos.');
  if (!hasUsableAmounts) errors.push('Todos los amountClp vienen en cero o faltan.');
  if (!hasUsableWeights) errors.push('Todos los weightPortfolio vienen en cero o faltan.');
  if (!hasUsableMix) errors.push('No hay currentMixUsed utilizable en ningún instrumento.');
  if (!hasUsableAmounts && Math.abs(totalWeightPortfolio - 1) > 0.08) {
    errors.push('El peso total está muy lejos de 100% y no hay montos utilizables para respaldar la carga.');
  }

  return {
    ok: errors.length === 0,
    errors:
      errors.length > 0
        ? [
            'La carga no se aplicó. El archivo está vacío o no contiene instrumentos válidos. Se mantiene la última carga válida.',
            ...errors,
          ]
        : [],
    warnings,
    snapshot: errors.length === 0 ? snapshot : null,
    summary,
    instrumentsCount,
    validInstrumentsCount,
    totalWeightPortfolio,
    totalAmountClp,
    hasUsableAmounts,
    hasUsableWeights,
    hasUsableMix,
    schemaVersion: snapshot.version,
  };
};

export const buildInstrumentUniverseSnapshotMetadata = (
  snapshot: InstrumentUniverseSnapshot,
  validation: InstrumentUniverseValidation,
  input?: { fileName?: string | null; source?: string; loadedAt?: string },
): InstrumentUniverseSnapshotMetadata => {
  const loadedAt = input?.loadedAt ?? new Date().toISOString();
  const amountSource = validation.hasUsableAmounts
    ? validation.hasUsableWeights
      ? 'mixed'
      : 'amount_clp'
    : validation.hasUsableWeights
      ? 'weight_portfolio'
      : 'unknown';
  return {
    loadedAt,
    importedAt: snapshot.savedAt,
    fileName: input?.fileName ?? null,
    source: input?.source ?? 'manual_upload',
    instrumentsCount: validation.instrumentsCount,
    validInstrumentsCount: validation.validInstrumentsCount,
    totalWeightPortfolio: validation.totalWeightPortfolio,
    totalAmountClp: validation.totalAmountClp,
    hasUsableAmounts: validation.hasUsableAmounts,
    hasUsableWeights: validation.hasUsableWeights,
    hasUsableMix: validation.hasUsableMix,
    warnings: validation.warnings,
    amountSource,
    checksum: hashString(snapshot.rawJson),
    schemaVersion: validation.schemaVersion ?? VERSION,
    lastValid: true,
  };
};
export const parseStoredInstrumentUniverseSnapshot = (raw: string): InstrumentUniverseSnapshot | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'active' in parsed) {
      const active = (parsed as { active?: unknown }).active;
      if (
        active &&
        typeof active === 'object' &&
        'version' in active &&
        'instruments' in active &&
        (active as { version?: unknown }).version === VERSION &&
        Array.isArray((active as { instruments?: unknown }).instruments)
      ) {
        return active as InstrumentUniverseSnapshot;
      }
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      'instruments' in parsed &&
      (parsed as { version?: unknown }).version === VERSION &&
      Array.isArray((parsed as { instruments?: unknown }).instruments)
    ) {
      return parsed as InstrumentUniverseSnapshot;
    }
  } catch {
    // Fall through to schema validation: old cache entries may contain the raw uploaded JSON.
  }
  const validation = validateInstrumentUniverseJson(raw);
  return validation.ok ? validation.snapshot : null;
};

export const loadInstrumentUniverseSnapshot = (): InstrumentUniverseSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseStoredInstrumentUniverseSnapshot(raw);
  } catch {
    return null;
  }
};

export const saveInstrumentUniverseSnapshot = (snapshot: InstrumentUniverseSnapshot) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

export const loadInstrumentUniverseSnapshotMetadata = (): InstrumentUniverseSnapshotMetadata | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstrumentUniverseSnapshotMetadata | null;
    if (!parsed || typeof parsed !== 'object' || parsed.lastValid !== true) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveInstrumentUniverseSnapshotWithMetadata = (
  snapshot: InstrumentUniverseSnapshot,
  metadata: InstrumentUniverseSnapshotMetadata,
) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  window.localStorage.setItem(STORAGE_META_KEY, JSON.stringify(metadata));
};

export const loadLastFailedInstrumentUniverseImport = (): InstrumentUniverseFailedImport | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_FAILED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstrumentUniverseFailedImport | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.attemptedAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveLastFailedInstrumentUniverseImport = (failed: InstrumentUniverseFailedImport) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_FAILED_KEY, JSON.stringify(failed));
};

export const clearLastFailedInstrumentUniverseImport = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_FAILED_KEY);
};

export const clearInstrumentUniverseSnapshot = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(STORAGE_META_KEY);
};
