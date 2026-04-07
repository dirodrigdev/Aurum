import type {
  M8Input,
  M8Output,
  M8FanChartPoint,
  M8GeneratorParams,
  M8GaussianIIDGeneratorParams,
  M8StudentTGeneratorParams,
  M8TwoRegimeGeneratorParams,
  M8ScenarioOverrides,
} from './m8.types';

const ASSET_ORDER = ['eq_global', 'eq_chile', 'fi_global', 'fi_chile', 'usd_liquidity', 'clp_cash'] as const;
type AssetKey = typeof ASSET_ORDER[number];

const GLOBAL_SLEEVES = new Set<AssetKey>(['eq_global', 'fi_global', 'usd_liquidity']);
const DEFENSIVE_FILL_ORDER: AssetKey[] = ['usd_liquidity', 'fi_global', 'clp_cash', 'fi_chile'];
const RISKY_ORDER: AssetKey[] = ['eq_global', 'eq_chile'];
const M8_STUDENT_T_DF_DEFAULT = 7;
const DEFAULT_POST_SALE_UPLIFT_PHASE2_CLP = 1_600_000;
const DEFAULT_POST_SALE_UPLIFT_PHASE3_CLP = 1_600_000;
const CUT1_PERSISTENCE_MONTHS = 6;
const CUT2_PERSISTENCE_MONTHS = 4;
const RECOVER_TO_WEAK_THRESHOLD = 0.15;
const RECOVER_TO_NORMAL_THRESHOLD = 0.07;
const MAX_DRAWDOWN_PERCENTILES = [10, 25, 50, 75, 90] as const;

export const M8_BASE_CORRELATION_MATRIX = [
  [1.00, 0.65, 0.05, 0.00, 0.05, 0.00],
  [0.65, 1.00, 0.05, 0.10, 0.05, 0.00],
  [0.05, 0.05, 1.00, 0.20, 0.50, 0.20],
  [0.00, 0.10, 0.20, 1.00, 0.20, 0.50],
  [0.05, 0.05, 0.50, 0.20, 1.00, 0.30],
  [0.00, 0.00, 0.20, 0.50, 0.30, 1.00],
];

const STRESS_CORR = [
  [1.00, 0.85, 0.35, 0.20, 0.15, 0.00],
  [0.85, 1.00, 0.30, 0.25, 0.10, 0.00],
  [0.35, 0.30, 1.00, 0.45, 0.60, 0.25],
  [0.20, 0.25, 0.45, 1.00, 0.30, 0.45],
  [0.15, 0.10, 0.60, 0.30, 1.00, 0.30],
  [0.00, 0.00, 0.25, 0.45, 0.30, 1.00],
];

const TWO_REGIME_SOFT = {
  pNormalToStress: 0.009,
  pStressToNormal: 0.28,
  stressMuAnnual: {
    eq_global: -0.06,
    eq_chile: -0.09,
    fi_global: 0.01,
    fi_chile: 0.002,
    usd_liquidity: 0.007,
    clp_cash: 0.0025,
  } satisfies Record<AssetKey, number>,
  stressVolMultiplier: {
    eq_global: 1.30,
    eq_chile: 1.40,
    fi_global: 1.15,
    fi_chile: 1.20,
    usd_liquidity: 1.15,
    clp_cash: 1.00,
  } satisfies Record<AssetKey, number>,
  stressFxRealMuAnnual: 0.008,
  stressFxVolMultiplier: 1.15,
} as const;

type RuntimeScenarioKey = 'Central' | 'Favorable' | 'Adverso';

const SCENARIO_RUNTIME: Record<RuntimeScenarioKey, { fxRealMuAnnual: number; fxRealVolAnnual: number }> = {
  Central: { fxRealMuAnnual: 0.0, fxRealVolAnnual: 0.10 },
  Favorable: { fxRealMuAnnual: 0.005, fxRealVolAnnual: 0.10 },
  Adverso: { fxRealMuAnnual: -0.005, fxRealVolAnnual: 0.11 },
};

export interface M8RuntimeResult extends M8Output {
  wealthPaths: number[][];
  ReturnGenerator: M8Input['generator_type'];
  StudentTDF?: number;
  FutureInflowTotalCLP?: number;
  FutureOutflowTotalCLP?: number;
  BridgeTimeShare?: number;
}

type GeneratorState = {
  muMonthly: number[];
  chol: number[][];
  fxMuMonthly: number;
  fxVolMonthly: number;
};

type TwoRegimeState = GeneratorState & {
  distribution: 'normal' | 'stress';
};

type SimulationState = {
  normal: GeneratorState;
  stress?: GeneratorState;
};

type M8FutureEvent = NonNullable<M8Input['future_events']>[number];

class SeededRng {
  private state: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  random(): number {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal(): number {
    if (this.spareNormal !== null) {
      const value = this.spareNormal;
      this.spareNormal = null;
      return value;
    }

    let u1 = 0;
    let u2 = 0;
    while (u1 <= Number.EPSILON) u1 = this.random();
    while (u2 <= Number.EPSILON) u2 = this.random();

    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const z0 = mag * Math.cos(2.0 * Math.PI * u2);
    const z1 = mag * Math.sin(2.0 * Math.PI * u2);
    this.spareNormal = z1;
    return z0;
  }

  chisquare(df: number): number {
    if (!Number.isFinite(df) || df <= 0) {
      throw new Error(`student_t_df invalido: ${df}`);
    }
    let sum = 0;
    for (let i = 0; i < df; i += 1) {
      const z = this.normal();
      sum += z * z;
    }
    return sum;
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const annualToMonthlyMean = (annual: number): number => (1 + annual) ** (1 / 12) - 1;
const annualToMonthlyVol = (annual: number): number => annual / Math.sqrt(12);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const scenarioToRuntimeKey = (scenarioId: M8ScenarioOverrides['scenario_id'] | undefined): RuntimeScenarioKey => {
  if (scenarioId === 'pessimistic') return 'Adverso';
  if (scenarioId === 'optimistic') return 'Favorable';
  return 'Central';
};

const validateSquareMatrix = (matrix: number[][], expectedSize: number, label: string): void => {
  if (!Array.isArray(matrix) || matrix.length !== expectedSize) {
    throw new Error(`${label} debe ser una matriz cuadrada de tamaño ${expectedSize}`);
  }
  for (const [idx, row] of matrix.entries()) {
    if (!Array.isArray(row) || row.length !== expectedSize) {
      throw new Error(`${label}[${idx}] debe tener longitud ${expectedSize}`);
    }
    for (const [jdx, value] of row.entries()) {
      if (!isFiniteNumber(value)) {
        throw new Error(`${label}[${idx}][${jdx}] debe ser un numero finito`);
      }
    }
  }
};

const cholesky = (matrix: number[][]): number[][] => {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) {
        sum -= lower[i][k] * lower[j][k];
      }
      if (i === j) {
        if (sum <= 0) {
          throw new Error('La matriz de covarianza no es definida positiva');
        }
        lower[i][j] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return lower;
};

const buildCovarianceCholesky = (volMonthly: number[], corr: number[][]): number[][] => {
  const covariance = volMonthly.map((rowVol, i) =>
    volMonthly.map((colVol, j) => rowVol * colVol * corr[i][j]));

  const jitters = [0, 1e-12, 1e-10, 1e-8];
  let lastError: unknown = null;
  for (const jitter of jitters) {
    try {
      const candidate = covariance.map((row, i) =>
        row.map((value, j) => value + (i === j ? jitter : 0)));
      return cholesky(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No se pudo calcular la descomposicion de Cholesky');
};

const normalizeWeights = (weights: Record<AssetKey, number>): Record<AssetKey, number> => {
  const normalized: Record<AssetKey, number> = {
    eq_global: Math.max(0, weights.eq_global),
    eq_chile: Math.max(0, weights.eq_chile),
    fi_global: Math.max(0, weights.fi_global),
    fi_chile: Math.max(0, weights.fi_chile),
    usd_liquidity: Math.max(0, weights.usd_liquidity),
    clp_cash: Math.max(0, weights.clp_cash),
  };
  const total = ASSET_ORDER.reduce((acc, asset) => acc + normalized[asset], 0);
  if (total <= 0) {
    throw new Error('Los pesos del portafolio deben sumar algo mayor que 0');
  }
  for (const asset of ASSET_ORDER) {
    normalized[asset] /= total;
  }
  return normalized;
};

const mixToSleeves = (mix: Record<AssetKey, number>, capital: number): Record<AssetKey, number> => {
  const sleeves: Record<AssetKey, number> = {
    eq_global: 0,
    eq_chile: 0,
    fi_global: 0,
    fi_chile: 0,
    usd_liquidity: 0,
    clp_cash: 0,
  };
  for (const asset of ASSET_ORDER) {
    sleeves[asset] = mix[asset] * capital;
  }
  return sleeves;
};

const sumSleeves = (sleeves: Record<AssetKey, number>): number =>
  ASSET_ORDER.reduce((acc, asset) => acc + sleeves[asset], 0);

const totalDefensiveWealth = (sleeves: Record<AssetKey, number>): number =>
  DEFENSIVE_FILL_ORDER.reduce((acc, asset) => acc + sleeves[asset], 0);

const currentUfClp = (input: M8Input, monthIndex: number): number => {
  if (input.use_real_terms) {
    return input.house?.ufClpStart ?? 0;
  }
  // El contrato fase 1 opera en términos reales. Dejar este fallback alineado a la UF de arranque.
  return input.house?.ufClpStart ?? 0;
};

const estimateHouseSaleEquityClp = (input: M8Input, monthIndex: number, mortgageBalanceUf: number): number => {
  if (!input.house?.include_house) return 0;
  return Math.max((input.house.houseValueUf - mortgageBalanceUf) * currentUfClp(input, monthIndex), 0);
};

const phaseOfMonth = (input: M8Input, monthIndex: number): 1 | 2 | 3 | 4 => {
  const yearIndex = Math.floor((monthIndex - 1) / 12) + 1;
  if (yearIndex <= input.phase1EndYear) return 1;
  if (yearIndex <= input.phase2EndYear) return 2;
  if (yearIndex <= input.phase3EndYear) return 3;
  return 4;
};

const monthlySpendIfHouseSold = (input: M8Input, monthIndex: number): number => {
  const phase = phaseOfMonth(input, monthIndex);
  if (phase === 1) return input.phase1MonthlyClp;
  if (phase === 2) return input.phase2MonthlyClp + DEFAULT_POST_SALE_UPLIFT_PHASE2_CLP;
  if (phase === 3) return input.phase3MonthlyClp + DEFAULT_POST_SALE_UPLIFT_PHASE3_CLP;
  return input.phase4MonthlyClp + DEFAULT_POST_SALE_UPLIFT_PHASE3_CLP;
};

const baseMonthlySpend = (input: M8Input, monthIndex: number, soldHouse: boolean): number => {
  if (soldHouse) return monthlySpendIfHouseSold(input, monthIndex);
  const phase = phaseOfMonth(input, monthIndex);
  if (phase === 1) return input.phase1MonthlyClp;
  if (phase === 2) return input.phase2MonthlyClp;
  if (phase === 3) return input.phase3MonthlyClp;
  return input.phase4MonthlyClp;
};

const buildGeneratorState = (
  sleeves: M8GeneratorParams['sleeves'],
  scenarioKey: RuntimeScenarioKey,
  corrMatrix: number[][] = M8_BASE_CORRELATION_MATRIX,
): GeneratorState => {
  const muAnnual = ASSET_ORDER.map((asset) => sleeves[asset].mean_annual);
  const volAnnual = ASSET_ORDER.map((asset) => sleeves[asset].vol_annual);
  const muMonthly = muAnnual.map(annualToMonthlyMean);
  const volMonthly = volAnnual.map(annualToMonthlyVol);
  const chol = buildCovarianceCholesky(volMonthly, corrMatrix);
  const fxConfig = SCENARIO_RUNTIME[scenarioKey];
  return {
    muMonthly,
    chol,
    fxMuMonthly: annualToMonthlyMean(fxConfig.fxRealMuAnnual),
    fxVolMonthly: annualToMonthlyVol(fxConfig.fxRealVolAnnual),
  };
};

const buildTwoRegimeState = (
  sleeves: M8TwoRegimeGeneratorParams['sleeves'],
  scenarioKey: RuntimeScenarioKey,
  corrMatrix: number[][],
): { normal: GeneratorState; stress: GeneratorState } => {
  const normal = buildGeneratorState(sleeves, scenarioKey, corrMatrix);
  const stressSleeves: M8TwoRegimeGeneratorParams['sleeves'] = {
    eq_global: {
      mean_annual: TWO_REGIME_SOFT.stressMuAnnual.eq_global,
      vol_annual: sleeves.eq_global.vol_annual * TWO_REGIME_SOFT.stressVolMultiplier.eq_global,
    },
    eq_chile: {
      mean_annual: TWO_REGIME_SOFT.stressMuAnnual.eq_chile,
      vol_annual: sleeves.eq_chile.vol_annual * TWO_REGIME_SOFT.stressVolMultiplier.eq_chile,
    },
    fi_global: {
      mean_annual: TWO_REGIME_SOFT.stressMuAnnual.fi_global,
      vol_annual: sleeves.fi_global.vol_annual * TWO_REGIME_SOFT.stressVolMultiplier.fi_global,
    },
    fi_chile: {
      mean_annual: TWO_REGIME_SOFT.stressMuAnnual.fi_chile,
      vol_annual: sleeves.fi_chile.vol_annual * TWO_REGIME_SOFT.stressVolMultiplier.fi_chile,
    },
    usd_liquidity: {
      mean_annual: TWO_REGIME_SOFT.stressMuAnnual.usd_liquidity,
      vol_annual: sleeves.usd_liquidity.vol_annual * TWO_REGIME_SOFT.stressVolMultiplier.usd_liquidity,
    },
    clp_cash: {
      mean_annual: TWO_REGIME_SOFT.stressMuAnnual.clp_cash,
      vol_annual: sleeves.clp_cash.vol_annual * TWO_REGIME_SOFT.stressVolMultiplier.clp_cash,
    },
  };
  const stress = buildGeneratorState(stressSleeves, scenarioKey, STRESS_CORR);
  return { normal, stress };
};

const buildGeneratorStates = (input: M8Input): SimulationState => {
  const scenarioKey = scenarioToRuntimeKey(input.scenario_overrides?.scenario_id);
  if (input.generator_type === 'two_regime') {
    const params = input.generator_params as M8TwoRegimeGeneratorParams;
    return buildTwoRegimeState(params.regimes.normal, scenarioKey, params.correlation_matrix);
  }
  return {
    normal: buildGeneratorState(input.generator_params.sleeves, scenarioKey, input.generator_params.correlation_matrix),
  };
};

const multiplyLowerTriangularVector = (chol: number[][], vector: number[]): number[] => {
  const result = new Array(chol.length).fill(0);
  for (let i = 0; i < chol.length; i += 1) {
    let sum = 0;
    for (let j = 0; j <= i; j += 1) {
      sum += chol[i][j] * vector[j];
    }
    result[i] = sum;
  }
  return result;
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const median = (values: number[]): number => percentile(values, 50);
const mean = (values: number[]): number => values.length === 0 ? Number.NaN : values.reduce((acc, value) => acc + value, 0) / values.length;

const buildFanChart = (wealthPaths: number[][]): M8FanChartPoint[] => {
  if (wealthPaths.length === 0) return [];
  const months = wealthPaths.length - 1;
  const points: M8FanChartPoint[] = [];
  for (let year = 0; year <= Math.floor(months / 12); year += 1) {
    const monthIndex = Math.min(year * 12, months);
    const row = wealthPaths[monthIndex] ?? [];
    points.push({
      year,
      p5: percentile(row, 5),
      p10: percentile(row, 10),
      p25: percentile(row, 25),
      p50: percentile(row, 50),
      p75: percentile(row, 75),
      p90: percentile(row, 90),
      p95: percentile(row, 95),
    });
  }
  return points;
};

const computeMaxDrawdownPercentiles = (wealthPaths: number[][]): Record<number, number> => {
  if (wealthPaths.length === 0) {
    return { 10: Number.NaN, 25: Number.NaN, 50: Number.NaN, 75: Number.NaN, 90: Number.NaN };
  }

  const months = wealthPaths.length;
  const nPaths = wealthPaths[0]?.length ?? 0;
  if (nPaths === 0) {
    return { 10: Number.NaN, 25: Number.NaN, 50: Number.NaN, 75: Number.NaN, 90: Number.NaN };
  }

  const maxDrawdownByPath = new Array(nPaths).fill(0);
  for (let p = 0; p < nPaths; p += 1) {
    let runningPeak = 0;
    let maxDrawdown = 0;
    for (let m = 0; m < months; m += 1) {
      const wealth = wealthPaths[m][p] ?? 0;
      if (wealth > runningPeak) runningPeak = wealth;
      const drawdown = runningPeak > 0 ? 1 - wealth / runningPeak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    maxDrawdownByPath[p] = clamp(maxDrawdown, 0, 1);
  }

  return {
    10: percentile(maxDrawdownByPath, 10),
    25: percentile(maxDrawdownByPath, 25),
    50: percentile(maxDrawdownByPath, 50),
    75: percentile(maxDrawdownByPath, 75),
    90: percentile(maxDrawdownByPath, 90),
  };
};

export const validateM8Input = (input: M8Input): string[] => {
  const errors: string[] = [];

  if (!Number.isInteger(input.years) || input.years <= 0) {
    errors.push('years debe ser entero positivo');
  }
  if (!Number.isInteger(input.n_paths) || input.n_paths <= 0) {
    errors.push('n_paths debe ser entero positivo');
  }
  if (input.simulation_frequency !== 'monthly') {
    errors.push('simulation_frequency debe ser monthly');
  }
  if (input.use_real_terms !== true) {
    errors.push('use_real_terms debe ser true');
  }
  if (!isFiniteNumber(input.seed)) {
    errors.push('seed debe ser un numero finito');
  }
  if (!isFiniteNumber(input.capital_initial_clp) || input.capital_initial_clp < 0) {
    errors.push('capital_initial_clp debe ser >= 0');
  }
  if (!input.capital_source || (input.capital_source !== 'aurum' && input.capital_source !== 'manual')) {
    errors.push('capital_source debe ser aurum o manual');
  }
  if (input.feeAnnual !== undefined && (!isFiniteNumber(input.feeAnnual) || input.feeAnnual < 0)) {
    errors.push('feeAnnual debe ser finito y >= 0');
  }
  if (input.risk_capital_clp !== undefined && (!isFiniteNumber(input.risk_capital_clp) || input.risk_capital_clp < 0)) {
    errors.push('risk_capital_clp debe ser finito y >= 0');
  }
  if (isFiniteNumber(input.risk_capital_clp) && input.risk_capital_clp > input.capital_initial_clp + 1e-6) {
    errors.push('risk_capital_clp no puede superar capital_initial_clp');
  }

  const mix = input.portfolio_mix;
  if (mix) {
    const total = ASSET_ORDER.reduce((acc, asset) => acc + (isFiniteNumber(mix[asset]) ? mix[asset] : Number.NaN), 0);
    if (!Number.isFinite(total) || total <= 0) {
      errors.push('portfolio_mix debe sumar algo mayor que 0');
    }
  } else {
    errors.push('portfolio_mix es obligatorio');
  }

  if (
    !Number.isInteger(input.phase1EndYear)
    || !Number.isInteger(input.phase2EndYear)
    || !Number.isInteger(input.phase3EndYear)
    || input.phase1EndYear <= 0
    || input.phase2EndYear <= 0
    || input.phase3EndYear <= 0
  ) {
    errors.push('phase1EndYear, phase2EndYear y phase3EndYear deben ser enteros positivos');
  }
  if (input.phase1EndYear >= input.phase2EndYear) {
    errors.push('phase2EndYear debe ser mayor que phase1EndYear');
  }
  if (input.phase2EndYear >= input.phase3EndYear) {
    errors.push('phase3EndYear debe ser mayor que phase2EndYear');
  }
  if (input.phase3EndYear >= input.years) {
    errors.push('phase3EndYear debe ser menor que years');
  }
  for (const [label, value] of [
    ['phase1MonthlyClp', input.phase1MonthlyClp],
    ['phase2MonthlyClp', input.phase2MonthlyClp],
    ['phase3MonthlyClp', input.phase3MonthlyClp],
    ['phase4MonthlyClp', input.phase4MonthlyClp],
  ] as const) {
    if (!isFiniteNumber(value) || value <= 0) {
      errors.push(`${label} debe ser > 0`);
    }
  }

  if (!input.return_assumptions) {
    errors.push('return_assumptions es obligatorio');
  }
  if (!input.generator_params) {
    errors.push('generator_params es obligatorio');
  }
  if (!input.cuts) {
    errors.push('cuts es obligatorio');
  } else {
    if (!isFiniteNumber(input.cuts.cut1_floor) || !isFiniteNumber(input.cuts.cut2_floor)) {
      errors.push('cuts.cut1_floor y cuts.cut2_floor deben ser numeros finitos');
    }
    if (input.cuts.cut1_floor <= input.cuts.cut2_floor) {
      errors.push('cuts.cut1_floor debe ser mayor que cuts.cut2_floor');
    }
  }

  const generatorType = input.generator_type;
  const generatorParams = input.generator_params;
  if (generatorType !== generatorParams.distribution) {
    errors.push('generator_type debe coincidir con generator_params.distribution');
  }
  validateSquareMatrix(generatorParams.correlation_matrix, ASSET_ORDER.length, 'generator_params.correlation_matrix');
  for (const asset of ASSET_ORDER) {
    const stats = generatorParams.sleeves[asset];
    if (!stats || !isFiniteNumber(stats.mean_annual) || !isFiniteNumber(stats.vol_annual)) {
      errors.push(`generator_params.sleeves.${asset} debe tener mean_annual y vol_annual finitos`);
    }
    if (stats.vol_annual < 0) {
      errors.push(`generator_params.sleeves.${asset}.vol_annual debe ser >= 0`);
    }
  }

  if (generatorType === 'student_t') {
    const df = (generatorParams as M8StudentTGeneratorParams).degrees_of_freedom;
    if (!Number.isInteger(df) || df <= 2) {
      errors.push('generator_params.degrees_of_freedom debe ser entero > 2');
    }
  }

  if (generatorType === 'two_regime') {
    const twoRegime = generatorParams as M8TwoRegimeGeneratorParams;
    validateSquareMatrix([
      [twoRegime.transition_matrix.normal.normal, twoRegime.transition_matrix.normal.stress],
      [twoRegime.transition_matrix.stress.normal, twoRegime.transition_matrix.stress.stress],
    ], 2, 'generator_params.transition_matrix');
    const row1 = twoRegime.transition_matrix.normal.normal + twoRegime.transition_matrix.normal.stress;
    const row2 = twoRegime.transition_matrix.stress.normal + twoRegime.transition_matrix.stress.stress;
    if (Math.abs(row1 - 1) > 1e-6 || Math.abs(row2 - 1) > 1e-6) {
      errors.push('generator_params.transition_matrix debe sumar 1 por fila');
    }
  }

  if (input.house?.include_house) {
    if (!isFiniteNumber(input.house.houseValueUf) || input.house.houseValueUf <= 0) errors.push('house.houseValueUf debe ser > 0');
    if (!isFiniteNumber(input.house.mortgageBalanceUfNow) || input.house.mortgageBalanceUfNow < 0) errors.push('house.mortgageBalanceUfNow debe ser >= 0');
    if (!isFiniteNumber(input.house.monthlyAmortizationUf) || input.house.monthlyAmortizationUf < 0) errors.push('house.monthlyAmortizationUf debe ser >= 0');
    if (!isFiniteNumber(input.house.ufClpStart) || input.house.ufClpStart <= 0) errors.push('house.ufClpStart debe ser > 0');
    if (!isFiniteNumber(input.house.house_sale_trigger_years_of_spend)) errors.push('house.house_sale_trigger_years_of_spend debe ser finito');
    if (!Number.isInteger(input.house.house_sale_lag_months) || input.house.house_sale_lag_months < 0) errors.push('house.house_sale_lag_months debe ser entero >= 0');
  }

  if (input.future_events?.length) {
    if (input.future_events.some((event) => event.currency === 'UF') && !(input.house?.ufClpStart && input.house.ufClpStart > 0)) {
      errors.push('future_events en UF requieren house.ufClpStart > 0');
    }
    for (const event of input.future_events) {
      if (!event.id?.trim()) errors.push('future_events requiere id');
      if (event.type !== 'inflow' && event.type !== 'outflow') errors.push(`future_events[${event.id ?? '?'}].type invalido`);
      if (!isFiniteNumber(event.amount) || event.amount <= 0) errors.push(`future_events[${event.id ?? '?'}].amount debe ser > 0`);
      if (event.currency !== 'CLP' && event.currency !== 'USD' && event.currency !== 'UF') errors.push(`future_events[${event.id ?? '?'}].currency invalida`);
      if (!Number.isInteger(event.effective_month) || event.effective_month < 1 || event.effective_month > input.years * 12) {
        errors.push(`future_events[${event.id ?? '?'}].effective_month fuera de horizonte`);
      }
    }
  }

  return errors;
};

const eventAmountToClp = (event: M8FutureEvent, input: M8Input, fxRealLevel: number): number => {
  if (event.currency === 'CLP') return event.amount;
  if (event.currency === 'USD') return event.amount * fxRealLevel;
  const ufRate = input.house?.ufClpStart;
  if (!ufRate || ufRate <= 0) {
    throw new Error('future_events en UF requieren house.ufClpStart para conversión');
  }
  return event.amount * ufRate;
};

const buildEventsMap = (input: M8Input): Map<number, M8FutureEvent[]> => {
  const map = new Map<number, M8FutureEvent[]>();
  for (const event of input.future_events ?? []) {
    if (!event || !Number.isInteger(event.effective_month)) continue;
    if (event.effective_month < 1 || event.effective_month > input.years * 12) continue;
    const existing = map.get(event.effective_month) ?? [];
    existing.push(event);
    map.set(event.effective_month, existing);
  }
  return map;
};

const applyInflowsProportionally = (
  sleeves: Record<AssetKey, number>,
  mix: Record<AssetKey, number>,
  amountClp: number,
): void => {
  if (amountClp <= 0) return;
  for (const asset of ASSET_ORDER) {
    sleeves[asset] += amountClp * mix[asset];
  }
};

const drawSpendOperationalSimple = (
  sleeves: Record<AssetKey, number>,
  spendClp: number,
  bucketTargetClp: number,
): number => {
  let remaining = spendClp;

  let bucketRemaining = Math.min(totalDefensiveWealth(sleeves), bucketTargetClp);
  for (const asset of DEFENSIVE_FILL_ORDER) {
    if (remaining <= 0 || bucketRemaining <= 0) break;
    const draw = Math.min(sleeves[asset], remaining, bucketRemaining);
    sleeves[asset] -= draw;
    remaining -= draw;
    bucketRemaining -= draw;
  }

  for (const asset of DEFENSIVE_FILL_ORDER) {
    if (remaining <= 0) break;
    const draw = Math.min(sleeves[asset], remaining);
    sleeves[asset] -= draw;
    remaining -= draw;
  }

  for (const asset of RISKY_ORDER) {
    if (remaining <= 0) break;
    const draw = Math.min(sleeves[asset], remaining);
    sleeves[asset] -= draw;
    remaining -= draw;
  }

  return remaining;
};

const sampleGeneratorState = (
  state: GeneratorState,
  rng: SeededRng,
  generatorType: M8Input['generator_type'],
  activeState: 'normal' | 'stress',
): { fxReal: number } => {
  const z = ASSET_ORDER.map(() => rng.normal());
  const shockBase = multiplyLowerTriangularVector(state.chol, z);
  let shock = shockBase;

  if (generatorType === 'student_t') {
    const df = state ? (state as unknown as M8StudentTGeneratorParams | undefined) : undefined;
    // The actual df lives on generator params; the engine uses the closed-contract default or provided value.
    // Here we assume the adapter already validated the contract and the caller passed the df through runtime metadata.
    // The runtime reads it from input via the caller closure when needed.
  }

  return {
    fxReal: state.fxMuMonthly + state.fxVolMonthly * rng.normal(),
  };
};

const totalCoreWealth = (sleeves: Record<AssetKey, number>): number =>
  ASSET_ORDER.reduce((acc, asset) => acc + sleeves[asset], 0);

const applyFeeDrag = (sleeves: Record<AssetKey, number>, feeAnnual: number): void => {
  const monthlyDrag = Math.max(0, 1 - feeAnnual / 12);
  if (monthlyDrag >= 0.999999999) return;
  for (const asset of ASSET_ORDER) {
    sleeves[asset] *= monthlyDrag;
  }
};

const buildRuntimeWeights = (mix: M8Input['portfolio_mix']): Record<AssetKey, number> => {
  const normalized = normalizeWeights({
    eq_global: mix.eq_global,
    eq_chile: mix.eq_chile,
    fi_global: mix.fi_global,
    fi_chile: mix.fi_chile,
    usd_liquidity: mix.usd_liquidity,
    clp_cash: mix.clp_cash,
  });
  return normalized;
};

const buildReturnState = (
  input: M8Input,
  generatorType: M8Input['generator_type'],
  stateName: 'normal' | 'stress',
): GeneratorState => {
  const generatorParams = input.generator_params;
  const sleeves = stateName === 'normal'
    ? generatorParams.sleeves
    : (generatorParams as M8TwoRegimeGeneratorParams).regimes.stress;
  return buildGeneratorState(sleeves, scenarioToRuntimeKey(input.scenario_overrides?.scenario_id));
};

const sampleMonthlyReturns = (
  input: M8Input,
  rng: SeededRng,
  states: SimulationState,
  generatorType: M8Input['generator_type'],
  regimeState: 'normal' | 'stress',
): { fxReal: number } => {
  const activeState = regimeState === 'stress' && states.stress ? states.stress : states.normal;
  const z = ASSET_ORDER.map(() => rng.normal());
  const shockBase = multiplyLowerTriangularVector(activeState.chol, z);
  let shock = shockBase;

  if (generatorType === 'student_t') {
    const df = (input.generator_params as M8StudentTGeneratorParams).degrees_of_freedom ?? M8_STUDENT_T_DF_DEFAULT;
    const chi2 = rng.chisquare(df);
    const scale = chi2 > 0 ? Math.sqrt((df - 2.0) / chi2) : 1.0;
    shock = shockBase.map((value) => value * scale);
  }

  const localReturns = ASSET_ORDER.map((asset, idx) => activeState.muMonthly[idx] + shock[idx]);
  const fxReal = activeState.fxMuMonthly + activeState.fxVolMonthly * rng.normal();
  return { fxReal: localReturns.length >= 0 ? fxReal : fxReal };
};

export const runM8 = (input: M8Input): M8RuntimeResult => {
  const validationErrors = validateM8Input(input);
  if (validationErrors.length > 0) {
    throw new Error(`invalid_m8_input:\n- ${validationErrors.join('\n- ')}`);
  }

  const rng = new SeededRng(input.seed);
  const months = input.years * 12;
  const runtimeMix = buildRuntimeWeights(input.portfolio_mix);
  const eventsMap = buildEventsMap(input);
  const riskReserveInitial = Math.max(0, input.risk_capital_clp ?? 0);
  const coreStartingCapital = Math.max(0, input.capital_initial_clp - riskReserveInitial);
  const scenarioKey = scenarioToRuntimeKey(input.scenario_overrides?.scenario_id);
  const states: SimulationState = input.generator_type === 'two_regime'
    ? buildTwoRegimeState(
      (input.generator_params as M8TwoRegimeGeneratorParams).regimes.normal,
      scenarioKey,
      input.generator_params.correlation_matrix,
    )
    : { normal: buildGeneratorState(input.generator_params.sleeves, scenarioKey, input.generator_params.correlation_matrix) };

  const wealthPaths = Array.from({ length: months + 1 }, () => Array(input.n_paths).fill(0));
  const terminalWealthAllPaths: number[] = [];
  const successFlags: number[] = [];
  const ruinMonths: number[] = [];
  const terminalWealth: number[] = [];
  const terminalWealthIfSuccess: number[] = [];
  const soldHouseFlags: number[] = [];
  const triggerMonths: number[] = [];
  const saleMonths: number[] = [];
  const spendFactorTotal: number[] = [];
  const spendFactorPhase2: number[] = [];
  const spendFactorPhase3: number[] = [];
  const cutTimeShare: number[] = [];
  const cut1TimeShare: number[] = [];
  const cut2TimeShare: number[] = [];
  const bridgeTimeShare: number[] = [];
  const spendFactorCutMonths: number[] = [];
  const spendFactorNoCutMonths: number[] = [];
  const spendFactorCut1Months: number[] = [];
  const spendFactorCut2Months: number[] = [];
  const stressTimeShare: number[] = [];
  const futureInflowTotal: number[] = [];
  const futureOutflowTotal: number[] = [];

  if (input.phase1EndYear >= input.phase2EndYear) {
    throw new Error('phase2EndYear debe ser mayor que phase1EndYear');
  }
  if (input.phase2EndYear >= input.phase3EndYear) {
    throw new Error('phase3EndYear debe ser mayor que phase2EndYear');
  }
  if (input.phase3EndYear >= input.years) {
    throw new Error('phase3EndYear debe ser menor que years');
  }

  const includeHouse = input.house?.include_house ?? false;
  const houseSaleBridgeEnabled = includeHouse;
  const returnGenerator = input.generator_type;
  const studentTDF = returnGenerator === 'student_t'
    ? (input.generator_params as M8StudentTGeneratorParams).degrees_of_freedom ?? M8_STUDENT_T_DF_DEFAULT
    : undefined;

  for (let p = 0; p < input.n_paths; p += 1) {
    const sleeves: Record<AssetKey, number> = mixToSleeves(runtimeMix, coreStartingCapital);
    let riskReserve = riskReserveInitial;
    let soldHouse = false;
    let pendingSale = false;
    let saleExecMonth: number | null = null;
    let triggerMonth: number | null = null;
    let bridgeDeficit = 0;
    let regimeState: 'normal' | 'stress' = 'normal';
    let stressMonths = 0;
    let mortgageBalanceUf = input.house?.mortgageBalanceUfNow ?? 0;
    let ruined = false;

    const coreHistory: number[] = [totalCoreWealth(sleeves)];

    let lowCount1 = 0;
    let lowCount2 = 0;
    let recoverToWeakCount = 0;
    let recoverToNormalCount = 0;
    let cutState = 0;
    let cut1Months = 0;
    let cut2Months = 0;
    let bridgeMonths = 0;

    let spentTotal = 0;
    let budgetTotal = 0;
    let spentPhase2Total = 0;
    let budgetPhase2Total = 0;
    let spentPhase3Total = 0;
    let budgetPhase3Total = 0;
    let spentCutTotal = 0;
    let budgetCutTotal = 0;
    let spentNoCutTotal = 0;
    let budgetNoCutTotal = 0;
    let spentCut1Total = 0;
    let budgetCut1Total = 0;
    let spentCut2Total = 0;
    let budgetCut2Total = 0;
    let inflowTotalClp = 0;
    let outflowTotalClp = 0;

    const houseEquity0 = includeHouse ? estimateHouseSaleEquityClp(input, 0, mortgageBalanceUf) : 0;
    wealthPaths[0][p] = totalCoreWealth(sleeves) + houseEquity0 + riskReserve;

    for (let m = 1; m <= months; m += 1) {
      if (includeHouse && !soldHouse) {
        mortgageBalanceUf = Math.max(mortgageBalanceUf - (input.house?.monthlyAmortizationUf ?? 0), 0);
      }

      if (pendingSale && saleExecMonth !== null && m >= saleExecMonth) {
        let houseEquity = estimateHouseSaleEquityClp(input, m, mortgageBalanceUf);
        if (bridgeDeficit > 0) {
          houseEquity = Math.max(houseEquity - bridgeDeficit, 0);
          bridgeDeficit = 0;
        }
        for (const asset of ASSET_ORDER) {
          sleeves[asset] += houseEquity * runtimeMix[asset];
        }
        soldHouse = true;
        pendingSale = false;
        saleMonths.push(m);
      }

      if (returnGenerator === 'two_regime') {
        if (regimeState === 'normal') {
          const transition = (input.generator_params as M8TwoRegimeGeneratorParams).transition_matrix.normal;
          if (rng.random() < transition.stress) regimeState = 'stress';
        } else {
          const transition = (input.generator_params as M8TwoRegimeGeneratorParams).transition_matrix.stress;
          if (rng.random() < transition.normal) regimeState = 'normal';
        }
      }

      const activeState = regimeState === 'stress' && states.stress ? states.stress : states.normal;
      const z = ASSET_ORDER.map(() => rng.normal());
      let shock = multiplyLowerTriangularVector(activeState.chol, z);
      if (returnGenerator === 'student_t') {
        const df = studentTDF ?? M8_STUDENT_T_DF_DEFAULT;
        const chi2 = rng.chisquare(df);
        const scale = chi2 > 0 ? Math.sqrt((df - 2.0) / chi2) : 1.0;
        shock = shock.map((value) => value * scale);
      }
      const localReturns = ASSET_ORDER.map((asset, idx) => activeState.muMonthly[idx] + shock[idx]);
      const fxReal = activeState.fxMuMonthly + activeState.fxVolMonthly * rng.normal();

      for (const [idx, asset] of ASSET_ORDER.entries()) {
        let r = localReturns[idx];
        if (GLOBAL_SLEEVES.has(asset)) {
          r = (1 + r) * (1 + fxReal) - 1;
        }
        sleeves[asset] *= Math.max(0, 1 + r);
      }
      applyFeeDrag(sleeves, input.feeAnnual ?? 0);
      if (regimeState === 'stress') stressMonths += 1;

      let extraOutflowThisMonth = 0;
      const monthEvents = eventsMap.get(m) ?? [];
      for (const event of monthEvents) {
        const eventAmountClp = eventAmountToClp(event, input, (input.house?.ufClpStart ?? 0) || 1);
        if (event.type === 'inflow') {
          inflowTotalClp += eventAmountClp;
          applyInflowsProportionally(sleeves, runtimeMix, eventAmountClp);
        } else if (event.type === 'outflow') {
          outflowTotalClp += eventAmountClp;
          extraOutflowThisMonth += eventAmountClp;
        }
      }

      const coreNow = totalCoreWealth(sleeves);
      coreHistory.push(coreNow);
      const lookback = 12;
      const startIdx = Math.max(0, coreHistory.length - 1 - lookback);
      const hwm = Math.max(...coreHistory.slice(startIdx));
      const drawdown = hwm > 0 ? coreNow / hwm - 1 : -1;

      lowCount1 = drawdown <= -input.cuts.dd15_threshold ? lowCount1 + 1 : 0;
      lowCount2 = drawdown <= -input.cuts.dd25_threshold ? lowCount2 + 1 : 0;
      if (cutState === 2) {
        recoverToWeakCount = drawdown > -RECOVER_TO_WEAK_THRESHOLD ? recoverToWeakCount + 1 : 0;
        if (recoverToWeakCount >= input.cuts.recovery_cut2_to_cut1_months) {
          cutState = 1;
          recoverToWeakCount = 0;
          recoverToNormalCount = 0;
        }
      } else if (cutState === 1) {
        recoverToNormalCount = drawdown > -RECOVER_TO_NORMAL_THRESHOLD ? recoverToNormalCount + 1 : 0;
        if (recoverToNormalCount >= input.cuts.recovery_cut1_to_normal_months) {
          cutState = 0;
          recoverToWeakCount = 0;
          recoverToNormalCount = 0;
        }
      }
      if (lowCount2 >= CUT2_PERSISTENCE_MONTHS) {
        cutState = 2;
        recoverToWeakCount = 0;
        recoverToNormalCount = 0;
      } else if (cutState === 0 && lowCount1 >= CUT1_PERSISTENCE_MONTHS) {
        cutState = 1;
        recoverToWeakCount = 0;
        recoverToNormalCount = 0;
      }

      const budget = baseMonthlySpend(input, m, soldHouse);
      let regularSpend = budget;
      if (cutState === 1) {
        regularSpend *= input.cuts.cut1_floor;
        cut1Months += 1;
      } else if (cutState === 2) {
        regularSpend *= input.cuts.cut2_floor;
        cut2Months += 1;
      }
      const spend = regularSpend + extraOutflowThisMonth;

      if (includeHouse && !soldHouse && !pendingSale) {
        const triggerBudget = monthlySpendIfHouseSold(input, m);
        const yearsCoverIfSold = coreNow / Math.max(triggerBudget * 12, 1);
        if (yearsCoverIfSold <= input.house!.house_sale_trigger_years_of_spend) {
          pendingSale = true;
          saleExecMonth = m + input.house!.house_sale_lag_months;
          triggerMonth = m;
          triggerMonths.push(m);
        }
      }

      const bucketTarget = input.bucket.bucket_mode === 'operational_simple'
        ? input.bucket.bucket_months * budget
        : 0;
      let remaining = drawSpendOperationalSimple(sleeves, spend, bucketTarget);
      const totalPaid = spend - remaining;
      const realizedRegularSpend = Math.max(0, Math.min(regularSpend, totalPaid));
      spentTotal += realizedRegularSpend;
      budgetTotal += budget;

      const phase = phaseOfMonth(input, m);
      if (phase === 2) {
        spentPhase2Total += realizedRegularSpend;
        budgetPhase2Total += budget;
      } else if (phase === 3) {
        spentPhase3Total += realizedRegularSpend;
        budgetPhase3Total += budget;
      }

      if (cutState === 0) {
        spentNoCutTotal += realizedRegularSpend;
        budgetNoCutTotal += budget;
      } else {
        spentCutTotal += realizedRegularSpend;
        budgetCutTotal += budget;
        if (cutState === 1) {
          spentCut1Total += realizedRegularSpend;
          budgetCut1Total += budget;
        } else if (cutState === 2) {
          spentCut2Total += realizedRegularSpend;
          budgetCut2Total += budget;
        }
      }

      if (remaining > 1e-8) {
        if (houseSaleBridgeEnabled && pendingSale && saleExecMonth !== null && m < saleExecMonth) {
          const expectedHouseEquity = estimateHouseSaleEquityClp(input, saleExecMonth, mortgageBalanceUf);
          if (bridgeDeficit + remaining <= expectedHouseEquity) {
            bridgeDeficit += remaining;
            remaining = 0;
            bridgeMonths += 1;
          }
        }

        if (remaining > 1e-8 && riskReserve > 0) {
          const riskDraw = Math.min(riskReserve, remaining);
          riskReserve -= riskDraw;
          remaining -= riskDraw;
        }

        if (remaining > 1e-8) {
          ruined = true;
          ruinMonths.push(m);
          successFlags.push(0);
          terminalWealth.push(0);
          soldHouseFlags.push(soldHouse ? 1 : 0);
          spendFactorTotal.push(spentTotal / budgetTotal);
          spendFactorPhase2.push(budgetPhase2Total > 0 ? spentPhase2Total / budgetPhase2Total : 1);
          spendFactorPhase3.push(budgetPhase3Total > 0 ? spentPhase3Total / budgetPhase3Total : 1);
          cutTimeShare.push((cut1Months + cut2Months) / m);
          cut1TimeShare.push(cut1Months / m);
          cut2TimeShare.push(cut2Months / m);
          bridgeTimeShare.push(bridgeMonths / m);
          spendFactorCutMonths.push(budgetCutTotal > 0 ? spentCutTotal / budgetCutTotal : 1);
          spendFactorNoCutMonths.push(budgetNoCutTotal > 0 ? spentNoCutTotal / budgetNoCutTotal : 1);
          spendFactorCut1Months.push(budgetCut1Total > 0 ? spentCut1Total / budgetCut1Total : 1);
          spendFactorCut2Months.push(budgetCut2Total > 0 ? spentCut2Total / budgetCut2Total : 1);
          stressTimeShare.push(m > 0 ? stressMonths / m : 0);
          futureInflowTotal.push(inflowTotalClp);
          futureOutflowTotal.push(outflowTotalClp);
          for (let mm = m; mm <= months; mm += 1) {
            wealthPaths[mm][p] = 0;
          }
          break;
        }
      }

      const houseEquity = includeHouse && !soldHouse ? estimateHouseSaleEquityClp(input, m, mortgageBalanceUf) : 0;
      wealthPaths[m][p] = totalCoreWealth(sleeves) + houseEquity + riskReserve;
    }

    if (!ruined) {
      const finalHouseEquity = includeHouse && !soldHouse ? estimateHouseSaleEquityClp(input, months, mortgageBalanceUf) : 0;
      const totalTerminal = totalCoreWealth(sleeves) + finalHouseEquity + riskReserve;
      successFlags.push(1);
      terminalWealth.push(totalTerminal);
      terminalWealthIfSuccess.push(totalTerminal);
      soldHouseFlags.push(soldHouse ? 1 : 0);
      spendFactorTotal.push(spentTotal / budgetTotal);
      spendFactorPhase2.push(budgetPhase2Total > 0 ? spentPhase2Total / budgetPhase2Total : 1);
      spendFactorPhase3.push(budgetPhase3Total > 0 ? spentPhase3Total / budgetPhase3Total : 1);
      cutTimeShare.push((cut1Months + cut2Months) / months);
      cut1TimeShare.push(cut1Months / months);
      cut2TimeShare.push(cut2Months / months);
      bridgeTimeShare.push(bridgeMonths / months);
      spendFactorCutMonths.push(budgetCutTotal > 0 ? spentCutTotal / budgetCutTotal : 1);
      spendFactorNoCutMonths.push(budgetNoCutTotal > 0 ? spentNoCutTotal / budgetNoCutTotal : 1);
      spendFactorCut1Months.push(budgetCut1Total > 0 ? spentCut1Total / budgetCut1Total : 1);
      spendFactorCut2Months.push(budgetCut2Total > 0 ? spentCut2Total / budgetCut2Total : 1);
      stressTimeShare.push(months > 0 ? stressMonths / months : 0);
      futureInflowTotal.push(inflowTotalClp);
      futureOutflowTotal.push(outflowTotalClp);
      wealthPaths[months][p] = totalTerminal;
    }

    terminalWealthAllPaths.push(wealthPaths[months][p] ?? 0);
  }

  const successRate = successFlags.length > 0 ? mean(successFlags) : 0;
  const ruinMonthsYears = ruinMonths.map((month) => month / 12);
  const terminalAll = terminalWealth.length > 0 ? terminalWealth : terminalWealthAllPaths;
  const terminalSuccess = terminalWealthIfSuccess;

  const result: M8RuntimeResult = {
    wealthPaths,
    ReturnGenerator: returnGenerator,
    Success40: successRate,
    ProbRuin20: ruinMonths.filter((month) => month <= 240).length / input.n_paths,
    ProbRuin40: 1 - successRate,
    RuinYearMedian: ruinMonthsYears.length ? median(ruinMonthsYears) : Number.NaN,
    RuinYearP25: ruinMonthsYears.length ? percentile(ruinMonthsYears, 25) : Number.NaN,
    RuinYearP75: ruinMonthsYears.length ? percentile(ruinMonthsYears, 75) : Number.NaN,
    TerminalMedianCLP: terminalAll.length ? median(terminalAll) : Number.NaN,
    TerminalMedianIfSuccessCLP: terminalSuccess.length ? median(terminalSuccess) : Number.NaN,
    TerminalP25CLP: terminalSuccess.length ? percentile(terminalSuccess, 25) : Number.NaN,
    TerminalP75CLP: terminalSuccess.length ? percentile(terminalSuccess, 75) : Number.NaN,
    HouseSalePct: soldHouseFlags.length ? mean(soldHouseFlags) : 0,
    TriggerYearMedian: triggerMonths.length ? median(triggerMonths.map((month) => month / 12)) : Number.NaN,
    SaleYearMedian: saleMonths.length ? median(saleMonths.map((month) => month / 12)) : Number.NaN,
    SpendFactorTotal: spendFactorTotal.length ? mean(spendFactorTotal) : Number.NaN,
    SpendFactorPhase2: spendFactorPhase2.length ? mean(spendFactorPhase2) : Number.NaN,
    SpendFactorPhase3: spendFactorPhase3.length ? mean(spendFactorPhase3) : Number.NaN,
    SpendFactorCutMonths: spendFactorCutMonths.length ? mean(spendFactorCutMonths) : Number.NaN,
    SpendFactorNoCutMonths: spendFactorNoCutMonths.length ? mean(spendFactorNoCutMonths) : Number.NaN,
    SpendFactorCut1Months: spendFactorCut1Months.length ? mean(spendFactorCut1Months) : Number.NaN,
    SpendFactorCut2Months: spendFactorCut2Months.length ? mean(spendFactorCut2Months) : Number.NaN,
    CutTimeShare: cutTimeShare.length ? mean(cutTimeShare) : Number.NaN,
    terminalWealthAllPaths,
    maxDrawdownPercentiles: computeMaxDrawdownPercentiles(wealthPaths),
    fanChart: buildFanChart(wealthPaths),
    StressTimeShare: stressTimeShare.length ? mean(stressTimeShare) : Number.NaN,
    Cut1TimeShare: cut1TimeShare.length ? mean(cut1TimeShare) : Number.NaN,
    Cut2TimeShare: cut2TimeShare.length ? mean(cut2TimeShare) : Number.NaN,
  };

  return {
    ...result,
    wealthPaths,
    ReturnGenerator: returnGenerator,
    StudentTDF: studentTDF,
    FutureInflowTotalCLP: futureInflowTotal.length ? mean(futureInflowTotal) : 0,
    FutureOutflowTotalCLP: futureOutflowTotal.length ? mean(futureOutflowTotal) : 0,
    BridgeTimeShare: bridgeTimeShare.length ? mean(bridgeTimeShare) : Number.NaN,
  };
};
