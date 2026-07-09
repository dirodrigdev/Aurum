import { buildMidasEvaluation } from '../model/midasEvaluation';
import { runM8 } from '../simulation/engineM8';
import type { M8GeneratorSleeveStats, M8Input, M8PortfolioMix } from '../simulation/m8.types';
import { buildQualityOfLifeMetricsFromPathDiagnostics } from '../simulation/qualityOfLifeMetrics';

export type SensitivityGroupId = 'horizon' | 'return' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'bucket' | 'cutRules';

export type SensitivityVariableId =
  | 'horizonYears'
  | 'expectedRealReturn'
  | 'phase1MonthlyClp'
  | 'phase2MonthlyClp'
  | 'phase3MonthlyClp'
  | 'phase4MonthlyClp'
  | 'bucketMonths'
  | 'cutRulesProfile';

export type SensitivityVariant = {
  id: string;
  groupId: SensitivityGroupId;
  variable: SensitivityVariableId;
  label: string;
  value: number | string;
  valueLabel: string;
  baseline: boolean;
  comparableSuccess: boolean;
  note: string | null;
  apply: (input: M8Input) => M8Input;
};

export type SensitivityMetrics = {
  horizonYears: number;
  success: number | null;
  successAtHorizon: number | null;
  ruin: number | null;
  nRuin: number | null;
  houseSalePct: number | null;
  houseSaleYearMedian: number | null;
  terminalWealthRatio: number | null;
  qolScore: number | null;
  qolLabel: string | null;
  csr85_4: number | null;
  qualitySurvivalRate: number | null;
  averageEffectiveSpendingRatio: number | null;
  severeCutYearsMean: number | null;
};

export type SensitivityMetricDeltas = {
  success: number | null;
  ruin: number | null;
  qolScore: number | null;
  terminalWealthRatio: number | null;
  houseSalePct: number | null;
  qualitySurvivalRate: number | null;
  severeCutYearsMean: number | null;
};

export type SensitivityMarginal = {
  deltaSuccess: number | null;
  stepLabel: string | null;
  classification: 'Baja' | 'Media' | 'Alta' | null;
};

export type SensitivityRow = {
  id: string;
  groupId: SensitivityGroupId;
  variable: SensitivityVariableId;
  label: string;
  value: number | string;
  valueLabel: string;
  baseline: boolean;
  comparableSuccess: boolean;
  note: string | null;
  metrics: SensitivityMetrics;
  deltaVsBaseline: SensitivityMetricDeltas;
  marginal: SensitivityMarginal;
  warnings: string[];
};

export type SensitivityTargetResult = {
  variable: SensitivityVariableId;
  label: string;
  baselineValue: number | string;
  baselineValueLabel: string;
  testedValue: number | string;
  testedValueLabel: string;
  success: number | null;
  deltaSuccess: number | null;
  deltaQolScore: number | null;
  deltaTerminalWealthRatio: number | null;
  deltaHouseSalePct: number | null;
  reachedTarget: boolean;
  estimated: boolean;
  observation: string;
};

export type SensitivityRunResult = {
  generatedAt: string;
  baseline: SensitivityMetrics;
  targetDeltaPp: number;
  targetSuccess: number | null;
  rows: SensitivityRow[];
  targetResults: SensitivityTargetResult[];
  warnings: string[];
};

const RETURN_TARGETS = [0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08];
const HORIZON_YEARS = [10, 15, 20, 25, 30, 35, 40, 45, 50];
const BUCKET_MONTHS = [6, 12, 18, 24, 30, 36, 42, 48];
const PHASE_KEYS = ['phase1MonthlyClp', 'phase2MonthlyClp', 'phase3MonthlyClp', 'phase4MonthlyClp'] as const;
const ASSET_KEYS: Array<keyof M8PortfolioMix> = ['eq_global', 'eq_chile', 'fi_global', 'fi_chile', 'usd_liquidity', 'clp_cash'];

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const uniqueSortedNumbers = (values: number[]): number[] => Array.from(new Set(values)).sort((a, b) => a - b);

const finiteOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const metricDelta = (value: number | null, baseline: number | null): number | null =>
  value === null || baseline === null ? null : value - baseline;

const formatMillions = (value: number): string => `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}MM`;

function readSleeves(input: M8Input): Record<string, M8GeneratorSleeveStats> {
  const params = input.generator_params as unknown as {
    sleeves?: Record<string, M8GeneratorSleeveStats>;
    regimes?: { normal?: { sleeves?: Record<string, M8GeneratorSleeveStats> } };
  };
  return params.sleeves ?? params.regimes?.normal?.sleeves ?? {};
}

function applySleeveMeanShift(input: M8Input, shift: number): M8Input {
  const next = cloneJson(input);
  const adjustSleeves = (sleeves: Record<string, M8GeneratorSleeveStats> | undefined) => {
    if (!sleeves) return;
    for (const key of ASSET_KEYS) {
      if (sleeves[key]) sleeves[key].mean_annual += shift;
    }
  };
  const params = next.generator_params as unknown as {
    sleeves?: Record<string, M8GeneratorSleeveStats>;
    regimes?: {
      normal?: { sleeves?: Record<string, M8GeneratorSleeveStats> };
      stress?: { sleeves?: Record<string, M8GeneratorSleeveStats> };
    };
  };
  adjustSleeves(params.sleeves);
  adjustSleeves(params.regimes?.normal?.sleeves);
  adjustSleeves(params.regimes?.stress?.sleeves);
  for (const key of Object.keys(next.return_assumptions) as Array<keyof M8Input['return_assumptions']>) {
    next.return_assumptions[key] = Number(next.return_assumptions[key]) + shift;
  }
  return next;
}

export function computeExpectedPortfolioReturn(input: M8Input): number {
  const sleeves = readSleeves(input);
  return ASSET_KEYS.reduce((sum, key) => {
    const weight = Number(input.portfolio_mix[key] ?? 0);
    const mean = Number(sleeves[key]?.mean_annual ?? 0);
    return sum + weight * mean;
  }, 0);
}

function buildPhaseValues(baseValue: number): number[] {
  return uniqueSortedNumbers([-1_000_000, -500_000, -250_000, 0, 250_000, 500_000, 1_000_000]
    .map((delta) => baseValue + delta)
    .filter((value) => value > 0));
}

function applyHorizon(input: M8Input, years: number): M8Input {
  const next = { ...cloneJson(input), years };
  const phase1EndYear = Math.min(next.phase1EndYear, Math.max(1, years - 3));
  const phase2EndYear = Math.min(Math.max(next.phase2EndYear, phase1EndYear + 1), Math.max(2, years - 2));
  const phase3EndYear = Math.min(Math.max(next.phase3EndYear, phase2EndYear + 1), Math.max(3, years - 1));
  next.phase1EndYear = phase1EndYear;
  next.phase2EndYear = phase2EndYear;
  next.phase3EndYear = phase3EndYear;
  if (next.future_events) {
    const horizonMonths = years * 12;
    next.future_events = next.future_events.filter((event) => Number(event.effective_month) <= horizonMonths);
  }
  return next;
}

export function buildSensitivityGrid(baseInput: M8Input): SensitivityVariant[] {
  const baselineReturn = computeExpectedPortfolioReturn(baseInput);
  const variants: SensitivityVariant[] = [];

  for (const years of uniqueSortedNumbers([...HORIZON_YEARS, baseInput.years])) {
    variants.push({
      id: `horizon-${years}`,
      groupId: 'horizon',
      variable: 'horizonYears',
      label: 'Horizonte',
      value: years,
      valueLabel: `${years} años`,
      baseline: years === baseInput.years,
      comparableSuccess: years === baseInput.years,
      note: 'Éxito al horizonte evaluado; no mezclar con éxito a 40 si cambia el horizonte.',
      apply: (input) => applyHorizon(input, years),
    });
  }

  for (const target of uniqueSortedNumbers([...RETURN_TARGETS, baselineReturn])) {
    variants.push({
      id: `return-${Math.round(target * 1000)}`,
      groupId: 'return',
      variable: 'expectedRealReturn',
      label: 'Retorno real esperado',
      value: target,
      valueLabel: `${(target * 100).toFixed(1)}%`,
      baseline: Math.abs(target - baselineReturn) < 0.0005,
      comparableSuccess: true,
      note: 'Sensibilidad experimental de retorno; no cambia supuestos oficiales.',
      apply: (input) => applySleeveMeanShift(input, target - baselineReturn),
    });
  }

  PHASE_KEYS.forEach((phaseKey, phaseIndex) => {
    const groupId = `phase${phaseIndex + 1}` as SensitivityGroupId;
    for (const value of buildPhaseValues(Number(baseInput[phaseKey]))) {
      variants.push({
        id: `${groupId}-${value}`,
        groupId,
        variable: phaseKey,
        label: `F${phaseIndex + 1}`,
        value,
        valueLabel: formatMillions(value),
        baseline: value === baseInput[phaseKey],
        comparableSuccess: true,
        note: 'Solo cambia esta fase de gasto; el resto queda constante.',
        apply: (input) => ({ ...cloneJson(input), [phaseKey]: value }),
      });
    }
  });

  for (const months of uniqueSortedNumbers([...BUCKET_MONTHS, baseInput.bucket.bucket_months])) {
    variants.push({
      id: `bucket-${months}`,
      groupId: 'bucket',
      variable: 'bucketMonths',
      label: 'Bucket',
      value: months,
      valueLabel: `${months} meses`,
      baseline: months === baseInput.bucket.bucket_months,
      comparableSuccess: true,
      note: 'Solo cambia el bucket operativo; no guarda política real.',
      apply: (input) => ({ ...cloneJson(input), bucket: { ...input.bucket, bucket_months: months } }),
    });
  }

  [
    { id: 'current', label: 'Actual', cut1: baseInput.cuts.cut1_floor, cut2: baseInput.cuts.cut2_floor, baseline: true },
    { id: 'harder', label: 'Más protector', cut1: Math.max(0.5, baseInput.cuts.cut1_floor - 0.03), cut2: Math.max(0.5, baseInput.cuts.cut2_floor - 0.04), baseline: false },
    { id: 'softer', label: 'Menos castigador', cut1: Math.min(1, baseInput.cuts.cut1_floor + 0.03), cut2: Math.min(1, baseInput.cuts.cut2_floor + 0.04), baseline: false },
  ].forEach((profile) => {
    variants.push({
      id: `cut-${profile.id}`,
      groupId: 'cutRules',
      variable: 'cutRulesProfile',
      label: 'Reglas de recorte',
      value: profile.id,
      valueLabel: profile.label,
      baseline: profile.baseline,
      comparableSuccess: true,
      note: 'Perfil mecánico de sensibilidad; no cambia reglas oficiales.',
      apply: (input) => ({
        ...cloneJson(input),
        cuts: {
          ...input.cuts,
          cut1_floor: profile.cut1,
          cut2_floor: profile.cut2,
        },
      }),
    });
  });

  return variants;
}

function buildMetricsFromInput(input: M8Input): { metrics: SensitivityMetrics; warnings: string[] } {
  const runtime = runM8(input);
  const quality = buildQualityOfLifeMetricsFromPathDiagnostics(runtime.pathQualityDiagnostics, {
    initialSimulableCapitalClp: input.capital_initial_clp,
  });
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: quality,
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'review',
  });
  return {
    metrics: {
      horizonYears: input.years,
      success: finiteOrNull(runtime.Success40),
      successAtHorizon: finiteOrNull(runtime.Success40),
      ruin: finiteOrNull(runtime.ProbRuin40),
      nRuin: Number.isFinite(runtime.ProbRuin40) ? Math.round(runtime.ProbRuin40 * input.n_paths) : null,
      houseSalePct: finiteOrNull(runtime.HouseSalePct),
      houseSaleYearMedian: finiteOrNull(runtime.SaleYearMedian),
      terminalWealthRatio: finiteOrNull(quality.terminalWealthRatio),
      qolScore: finiteOrNull(evaluation.cappedScore),
      qolLabel: evaluation.label,
      csr85_4: finiteOrNull(quality.csr85_4),
      qualitySurvivalRate: finiteOrNull(quality.qualitySurvivalRate),
      averageEffectiveSpendingRatio: finiteOrNull(quality.averageEffectiveSpendingRatio),
      severeCutYearsMean: finiteOrNull(quality.severeCutYearsMean),
    },
    warnings: Array.from(new Set([...(quality.warnings ?? []), ...(evaluation.warnings ?? [])])),
  };
}

function buildMetricDeltas(baseline: SensitivityMetrics, metrics: SensitivityMetrics): SensitivityMetricDeltas {
  return {
    success: metricDelta(metrics.success, baseline.success),
    ruin: metricDelta(metrics.ruin, baseline.ruin),
    qolScore: metricDelta(metrics.qolScore, baseline.qolScore),
    terminalWealthRatio: metricDelta(metrics.terminalWealthRatio, baseline.terminalWealthRatio),
    houseSalePct: metricDelta(metrics.houseSalePct, baseline.houseSalePct),
    qualitySurvivalRate: metricDelta(metrics.qualitySurvivalRate, baseline.qualitySurvivalRate),
    severeCutYearsMean: metricDelta(metrics.severeCutYearsMean, baseline.severeCutYearsMean),
  };
}

function emptyMarginal(): SensitivityMarginal {
  return { deltaSuccess: null, stepLabel: null, classification: null };
}

function marginalUnit(variable: SensitivityVariableId): { size: number; label: string } | null {
  switch (variable) {
    case 'phase1MonthlyClp':
    case 'phase2MonthlyClp':
    case 'phase3MonthlyClp':
    case 'phase4MonthlyClp':
      return { size: 500_000, label: '$500k' };
    case 'expectedRealReturn':
      return { size: 0.005, label: '0,5 pp retorno' };
    case 'bucketMonths':
      return { size: 6, label: '6 meses' };
    case 'horizonYears':
      return { size: 5, label: '5 años' };
    default:
      return null;
  }
}

function classifyMarginal(deltaSuccess: number | null): SensitivityMarginal['classification'] {
  if (deltaSuccess === null) return null;
  const magnitudePp = Math.abs(deltaSuccess * 100);
  if (magnitudePp < 0.5) return 'Baja';
  if (magnitudePp <= 1.5) return 'Media';
  return 'Alta';
}

export function addSensitivityMarginals(rows: SensitivityRow[]): SensitivityRow[] {
  const byGroup = new Map<SensitivityGroupId, SensitivityRow[]>();
  rows.forEach((row) => byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), row]));
  return rows.map((row) => {
    const unit = marginalUnit(row.variable);
    if (!unit || typeof row.value !== 'number') return { ...row, marginal: emptyMarginal() };
    const ordered = (byGroup.get(row.groupId) ?? [])
      .filter((candidate) => typeof candidate.value === 'number')
      .slice()
      .sort((a, b) => Number(a.value) - Number(b.value));
    const index = ordered.findIndex((candidate) => candidate.id === row.id);
    const adjacent = index > 0 ? ordered[index - 1] : ordered[index + 1] ?? null;
    const valueDistance = adjacent === null ? 0 : Number(row.value) - Number(adjacent.value);
    const successDistance = adjacent === null || row.metrics.success === null || adjacent.metrics.success === null
      ? null
      : row.metrics.success - adjacent.metrics.success;
    const deltaSuccess = successDistance === null || valueDistance === 0
      ? null
      : successDistance / (valueDistance / unit.size);
    return {
      ...row,
      marginal: {
        deltaSuccess,
        stepLabel: deltaSuccess === null ? null : unit.label,
        classification: classifyMarginal(deltaSuccess),
      },
    };
  });
}

export function runOneVariableSensitivity(
  baseInput: M8Input,
  baselineMetrics?: SensitivityMetrics | null,
  options: { nPathsOverride?: number; targetDeltaPp?: number } = {},
): SensitivityRunResult {
  const stableBase = cloneJson(baseInput);
  if (options.nPathsOverride && options.nPathsOverride > 0) stableBase.n_paths = options.nPathsOverride;
  const baseline = baselineMetrics ?? buildMetricsFromInput(stableBase).metrics;
  const grid = buildSensitivityGrid(stableBase);
  const unscoredRows = grid.map<SensitivityRow>((variant) => {
    const input = variant.apply(stableBase);
    const evaluated = buildMetricsFromInput(input);
    return {
      id: variant.id,
      groupId: variant.groupId,
      variable: variant.variable,
      label: variant.label,
      value: variant.value,
      valueLabel: variant.valueLabel,
      baseline: variant.baseline,
      comparableSuccess: variant.comparableSuccess,
      note: variant.note,
      metrics: evaluated.metrics,
      deltaVsBaseline: buildMetricDeltas(baseline, evaluated.metrics),
      marginal: emptyMarginal(),
      warnings: evaluated.warnings,
    };
  });
  const rows = addSensitivityMarginals(unscoredRows);
  const targetDeltaPp = options.targetDeltaPp ?? 2;
  return {
    generatedAt: new Date().toISOString(),
    baseline,
    targetDeltaPp,
    targetSuccess: baseline.success === null ? null : baseline.success + targetDeltaPp / 100,
    rows,
    targetResults: findChangeForSuccessTarget(stableBase, baseline, targetDeltaPp, rows),
    warnings: options.nPathsOverride && options.nPathsOverride !== baseInput.n_paths
      ? [`Modo rápido: sensibilidad aproximada con n=${options.nPathsOverride}; la simulación oficial usa n=${baseInput.n_paths}.`]
      : [],
  };
}

type TargetSearchDefinition = {
  variable: SensitivityVariableId;
  label: string;
  baselineValue: number;
  baselineValueLabel: string;
  values: number[];
  comparableSuccess: boolean;
  apply: (input: M8Input, value: number) => M8Input;
  valueLabel: (value: number) => string;
  searchMode: 'monotonic-up' | 'monotonic-down' | 'closest';
  noTargetObservation: string;
};

function phaseSearchValues(baseline: number): number[] {
  const minimum = Math.max(500_000, baseline * 0.2);
  const values = [baseline];
  for (let value = baseline - 500_000; value > minimum; value -= 500_000) values.push(value);
  values.push(minimum);
  return uniqueSortedNumbers(values).sort((a, b) => b - a);
}

function buildTargetSearchDefinitions(baseInput: M8Input): TargetSearchDefinition[] {
  const baselineReturn = computeExpectedPortfolioReturn(baseInput);
  const phaseDefinitions = PHASE_KEYS.map((phaseKey, index): TargetSearchDefinition => ({
    variable: phaseKey,
    label: `F${index + 1}`,
    baselineValue: Number(baseInput[phaseKey]),
    baselineValueLabel: formatMillions(Number(baseInput[phaseKey])),
    values: phaseSearchValues(Number(baseInput[phaseKey])),
    comparableSuccess: true,
    apply: (input, value) => ({ ...cloneJson(input), [phaseKey]: value }),
    valueLabel: formatMillions,
    searchMode: 'monotonic-down',
    noTargetObservation: 'No alcanza dentro del mínimo evaluado.',
  }));
  return [
    ...phaseDefinitions,
    {
      variable: 'bucketMonths',
      label: 'Bucket',
      baselineValue: baseInput.bucket.bucket_months,
      baselineValueLabel: `${baseInput.bucket.bucket_months} meses`,
      values: uniqueSortedNumbers([...BUCKET_MONTHS, baseInput.bucket.bucket_months]),
      comparableSuccess: true,
      apply: (input, value) => ({ ...cloneJson(input), bucket: { ...input.bucket, bucket_months: value } }),
      valueLabel: (value) => `${value} meses`,
      searchMode: 'closest',
      noTargetObservation: 'No alcanza dentro del rango 6–48 meses.',
    },
    {
      variable: 'expectedRealReturn',
      label: 'Retorno real esperado',
      baselineValue: baselineReturn,
      baselineValueLabel: `${(baselineReturn * 100).toFixed(1)}%`,
      values: uniqueSortedNumbers([baselineReturn, ...RETURN_TARGETS.filter((value) => value >= baselineReturn)]),
      comparableSuccess: true,
      apply: (input, value) => applySleeveMeanShift(input, value - baselineReturn),
      valueLabel: (value) => `${(value * 100).toFixed(1)}%`,
      searchMode: 'monotonic-up',
      noTargetObservation: 'No alcanza dentro del máximo evaluado de 8,0%.',
    },
    {
      variable: 'horizonYears',
      label: 'Horizonte',
      baselineValue: baseInput.years,
      baselineValueLabel: `${baseInput.years} años`,
      values: uniqueSortedNumbers([...HORIZON_YEARS, baseInput.years]),
      comparableSuccess: false,
      apply: (input, value) => applyHorizon(input, value),
      valueLabel: (value) => `${value} años`,
      searchMode: 'closest',
      noTargetObservation: 'No alcanza dentro del rango 10–50 años.',
    },
  ];
}

type TargetPoint = { value: number; metrics: SensitivityMetrics };

function targetResultFromPoint(
  definition: TargetSearchDefinition,
  baseline: SensitivityMetrics,
  point: TargetPoint,
  reachedTarget: boolean,
  observation: string,
  estimated: boolean,
): SensitivityTargetResult {
  return {
    variable: definition.variable,
    label: definition.label,
    baselineValue: definition.baselineValue,
    baselineValueLabel: definition.baselineValueLabel,
    testedValue: point.value,
    testedValueLabel: definition.valueLabel(point.value),
    success: point.metrics.success,
    deltaSuccess: metricDelta(point.metrics.success, baseline.success),
    deltaQolScore: metricDelta(point.metrics.qolScore, baseline.qolScore),
    deltaTerminalWealthRatio: metricDelta(point.metrics.terminalWealthRatio, baseline.terminalWealthRatio),
    deltaHouseSalePct: metricDelta(point.metrics.houseSalePct, baseline.houseSalePct),
    reachedTarget,
    estimated,
    observation,
  };
}

function evaluateTargetPoint(baseInput: M8Input, definition: TargetSearchDefinition, value: number): TargetPoint {
  return { value, metrics: buildMetricsFromInput(definition.apply(baseInput, value)).metrics };
}

function solveMonotonicTarget(
  baseInput: M8Input,
  definition: TargetSearchDefinition,
  baseline: SensitivityMetrics,
  targetSuccess: number,
): SensitivityTargetResult {
  const points = definition.values.map((value) => evaluateTargetPoint(baseInput, definition, value));
  const firstHitIndex = points.findIndex((point) => (point.metrics.success ?? -Infinity) >= targetSuccess);
  if (firstHitIndex < 0) {
    const best = points.slice().sort((a, b) => (b.metrics.success ?? -Infinity) - (a.metrics.success ?? -Infinity))[0];
    return targetResultFromPoint(definition, baseline, best, false, definition.noTargetObservation, false);
  }
  let hit = points[firstHitIndex];
  const previous = points[firstHitIndex - 1];
  if (!previous || hit.value === previous.value) {
    return targetResultFromPoint(definition, baseline, hit, true, 'Valor requerido estimado.', false);
  }
  let miss = previous;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const midpoint = (miss.value + hit.value) / 2;
    const candidate = evaluateTargetPoint(baseInput, definition, midpoint);
    if ((candidate.metrics.success ?? -Infinity) >= targetSuccess) hit = candidate;
    else miss = candidate;
  }
  return targetResultFromPoint(definition, baseline, hit, true, 'Valor requerido estimado; refinado entre dos puntos simulados.', true);
}

export function findChangeForSuccessTarget(
  baseInput: M8Input,
  baselineMetrics: SensitivityMetrics,
  targetDeltaPp = 2,
  _existingRows?: SensitivityRow[],
): SensitivityTargetResult[] {
  const targetSuccess = baselineMetrics.success === null ? null : baselineMetrics.success + targetDeltaPp / 100;
  if (targetSuccess === null) return [];
  return buildTargetSearchDefinitions(baseInput).map((definition) => {
    if (definition.searchMode === 'monotonic-up' || definition.searchMode === 'monotonic-down') {
      return solveMonotonicTarget(baseInput, definition, baselineMetrics, targetSuccess);
    }
    const points = definition.values.map((value) => evaluateTargetPoint(baseInput, definition, value));
    const reached = points.filter((point) => (point.metrics.success ?? -Infinity) >= targetSuccess);
    const picked = (reached.length > 0 ? reached : points)
      .slice()
      .sort((a, b) => {
        if (reached.length > 0) return Math.abs(a.value - definition.baselineValue) - Math.abs(b.value - definition.baselineValue);
        return (b.metrics.success ?? -Infinity) - (a.metrics.success ?? -Infinity);
      })[0];
    const horizonNote = definition.variable === 'horizonYears'
      ? 'No comparable directo: cambia el horizonte del plan.'
      : reached.length > 0
        ? 'Valor requerido estimado dentro del rango evaluado.'
        : definition.noTargetObservation;
    return targetResultFromPoint(definition, baselineMetrics, picked, reached.length > 0, horizonNote, false);
  });
}
