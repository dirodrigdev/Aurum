import type {
  CapitalSource,
  FutureCapitalEvent,
  ModelParameters,
  PortfolioWeights,
  SimulationResults,
} from '../model/types';
import { SCENARIO_VARIANTS } from '../model/defaults';
import { normalizeModelSpendingPhases } from '../model/spendingPhases';
import type { CapitalResolution } from './capitalResolver';
import type {
  M8CutsInput,
  M8GaussianIIDGeneratorParams,
  M8HouseInput,
  M8Input,
  M8OperationalWeights,
  M8Output,
  M8GeneratorParams,
  M8AnyGeneratorParams,
  M8ScenarioOverrides,
  M8PortfolioMix,
  M8StudentTGeneratorParams,
  M8TwoRegimeGeneratorParams,
  M8GeneratorSleeveStats,
} from './m8.types';
import { M8_BASE_CORRELATION_MATRIX } from './engineM8';

const M8_DEFAULT_N_PATHS = 3000;
const M8_DEFAULT_USD_LIQUIDITY_REAL_ANNUAL = 0.008;
const M8_DEFAULT_CLP_CASH_REAL_ANNUAL = 0.0025;
// Warning de integracion: los sleeves de caja se mantienen con vol 0 hasta que el dueño de M8 confirme otra calibracion.
const M8_STUDENT_T_DF = 7;
const M8_DEFAULT_OPERATIONAL_WEIGHTS: M8OperationalWeights = {
  usd_liquidity: 0,
  clp_cash: 0,
};

type ValidationResult = {
  ok: boolean;
  errors: string[];
};

const isValidCapitalSource = (value: unknown): value is CapitalSource => value === 'aurum' || value === 'manual';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const parseYearMonth = (value: string): { year: number; month: number } | null => {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
};

const isValidYearMonth = (value: unknown): value is string =>
  typeof value === 'string' && parseYearMonth(value) !== null;

const buildScenarioOverrides = (params: ModelParameters): M8ScenarioOverrides => {
  const variant = SCENARIO_VARIANTS.find((item) => item.id === params.activeScenario);
  if (!variant) {
    throw new Error(`activeScenario invalido: ${String(params.activeScenario)}`);
  }

  return {
    scenario_id: variant.id,
    ...(variant.rvGlobalAnnual !== undefined ? { rv_global_annual: variant.rvGlobalAnnual } : {}),
    ...(variant.rfGlobalAnnual !== undefined ? { rf_global_annual: variant.rfGlobalAnnual } : {}),
    ...(variant.rvChileAnnual !== undefined ? { rv_chile_annual: variant.rvChileAnnual } : {}),
    ...(variant.rfChileUFAnnual !== undefined ? { rf_chile_annual: variant.rfChileUFAnnual } : {}),
    ...(variant.rvGlobalVolAnnual !== undefined ? { rv_global_vol_annual: variant.rvGlobalVolAnnual } : {}),
    ...(variant.rfGlobalVolAnnual !== undefined ? { rf_global_vol_annual: variant.rfGlobalVolAnnual } : {}),
    ...(variant.rvChileVolAnnual !== undefined ? { rv_chile_vol_annual: variant.rvChileVolAnnual } : {}),
    ...(variant.rfChileVolAnnual !== undefined ? { rf_chile_vol_annual: variant.rfChileVolAnnual } : {}),
    ...(variant.ipcChileAnnual !== undefined ? { ipc_chile_annual: variant.ipcChileAnnual } : {}),
    ...(variant.tcrealLT !== undefined ? { tcreal_lt: variant.tcrealLT } : {}),
  };
};

const resolveRiskCapitalClp = (capitalResolution: CapitalResolution): number => {
  const raw = Number(capitalResolution.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0);
  if (!isFiniteNumber(raw) || raw < 0) {
    throw new Error('simulationComposition.nonOptimizable.riskCapital.totalCLP invalido');
  }
  return raw;
};

const buildCuts = (params: ModelParameters): M8CutsInput => ({
  cut1_floor: params.spendingRule.softCut,
  cut2_floor: params.spendingRule.hardCut,
  recovery_cut2_to_cut1_months: 4,
  recovery_cut1_to_normal_months: 6,
  adjustment_alpha: params.spendingRule.adjustmentAlpha,
  dd15_threshold: params.spendingRule.dd15Threshold,
  dd25_threshold: params.spendingRule.dd25Threshold,
  consecutive_months: params.spendingRule.consecutiveMonths,
});

const resolveSimulationBaseMonth = (params: ModelParameters): string | undefined => {
  const baseMonth = typeof params.simulationBaseMonth === 'string' ? params.simulationBaseMonth.trim() : '';
  if (!baseMonth) return undefined;
  if (!isValidYearMonth(baseMonth)) {
    throw new Error(`simulationBaseMonth invalido: ${params.simulationBaseMonth}`);
  }
  return baseMonth;
};

const toM8Month = (effectiveDate: string, simulationBaseMonth: string | undefined, totalMonths: number): number => {
  const base = simulationBaseMonth ? parseYearMonth(simulationBaseMonth) : null;
  if (!base) {
    throw new Error('futureCapitalEvents requieren simulationBaseMonth de referencia para normalizar effectiveDate');
  }

  const raw = effectiveDate.trim();
  const target =
    parseYearMonth(raw) ??
    (raw.match(/^(\d{4})$/)
      ? { year: Number(raw), month: 1 }
      : null);
  if (!target) {
    throw new Error(`futureCapitalEvents.effectiveDate debe ser YYYY o YYYY-MM: ${effectiveDate}`);
  }

  const effectiveMonth = (target.year - base.year) * 12 + (target.month - base.month) + 1;
  if (effectiveMonth < 1 || effectiveMonth > totalMonths) {
    throw new Error(`futureCapitalEvents.effectiveDate fuera de horizonte: ${effectiveDate}`);
  }
  return effectiveMonth;
};

const buildSleeveStats = (meanAnnual: number, volAnnual: number): M8GeneratorSleeveStats => ({
  mean_annual: meanAnnual,
  vol_annual: volAnnual,
});

const cloneMatrix = (matrix: number[][]): number[][] => matrix.map((row) => row.slice());

const expandCorrelationMatrix = (legacyMatrix: number[][]): number[][] => {
  if (!Array.isArray(legacyMatrix) || legacyMatrix.length === 0) {
    return cloneMatrix(M8_BASE_CORRELATION_MATRIX);
  }

  const size = legacyMatrix.length;
  const isSquare = legacyMatrix.every((row) => Array.isArray(row) && row.length === size);
  if (!isSquare) {
    throw new Error(`correlationMatrix invalida: se esperaba matriz cuadrada y se recibió ${size}x?`);
  }

  if (size === M8_BASE_CORRELATION_MATRIX.length) {
    return cloneMatrix(legacyMatrix);
  }

  if (size !== 4) {
    throw new Error(`correlationMatrix invalida: se esperaba 4x4 o 6x6 y se recibió ${size}x${size}`);
  }

  const expanded = cloneMatrix(M8_BASE_CORRELATION_MATRIX);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      expanded[i][j] = legacyMatrix[i][j];
    }
  }
  return expanded;
};

const buildGeneratorSleeves = (params: ModelParameters): M8GeneratorParams['sleeves'] => ({
  eq_global: buildSleeveStats(params.returns.rvGlobalAnnual, params.returns.rvGlobalVolAnnual),
  eq_chile: buildSleeveStats(params.returns.rvChileAnnual, params.returns.rvChileVolAnnual),
  fi_global: buildSleeveStats(params.returns.rfGlobalAnnual, params.returns.rfGlobalVolAnnual),
  fi_chile: buildSleeveStats(params.returns.rfChileUFAnnual, params.returns.rfChileVolAnnual),
  usd_liquidity: buildSleeveStats(M8_DEFAULT_USD_LIQUIDITY_REAL_ANNUAL, 0),
  clp_cash: buildSleeveStats(M8_DEFAULT_CLP_CASH_REAL_ANNUAL, 0),
});

const buildGeneratorParams = (params: ModelParameters): M8AnyGeneratorParams => {
  const sleeves = buildGeneratorSleeves(params);
  const correlationMatrix = expandCorrelationMatrix(params.returns.correlationMatrix);

  if ((params.generatorType ?? 'student_t') === 'gaussian_iid') {
    const gaussian: M8GaussianIIDGeneratorParams = {
      distribution: 'gaussian_iid',
      sleeves,
      correlation_matrix: correlationMatrix,
    };
    return gaussian;
  }

  if ((params.generatorType ?? 'student_t') === 'student_t') {
    const studentT: M8StudentTGeneratorParams = {
      distribution: 'student_t',
      degrees_of_freedom: M8_STUDENT_T_DF,
      sleeves,
      correlation_matrix: correlationMatrix,
    };
    return studentT;
  }

  const stressSleeves: M8GeneratorParams['sleeves'] = {
    eq_global: buildSleeveStats(0.0, params.returns.rvGlobalVolAnnual * 1.32),
    eq_chile: buildSleeveStats(-0.01, params.returns.rvChileVolAnnual * 1.38),
    fi_global: buildSleeveStats(0.019, params.returns.rfGlobalVolAnnual * 1.18),
    fi_chile: buildSleeveStats(0.005, params.returns.rfChileVolAnnual * 1.18),
    usd_liquidity: sleeves.usd_liquidity,
    clp_cash: sleeves.clp_cash,
  };
  const twoRegime: M8TwoRegimeGeneratorParams = {
    distribution: 'two_regime',
    sleeves,
    correlation_matrix: correlationMatrix,
    transition_matrix: {
      normal: { normal: 0.9975, stress: 0.0025 },
      stress: { stress: 0.85, normal: 0.15 },
    },
    regimes: {
      normal: sleeves,
      stress: stressSleeves,
    },
  };
  return twoRegime;
};

const normalizeOperationalWeights = (
  weights: M8OperationalWeights = M8_DEFAULT_OPERATIONAL_WEIGHTS
): M8OperationalWeights => {
  const raw = {
    usd_liquidity: weights.usd_liquidity,
    clp_cash: weights.clp_cash,
  };

  for (const [key, value] of Object.entries(raw)) {
    if (!isFiniteNumber(value) || value < 0) {
      throw new Error(`Peso invalido en ${key}: ${String(value)}`);
    }
  }

  return {
    usd_liquidity: raw.usd_liquidity,
    clp_cash: raw.clp_cash,
  };
};

const combineM8PortfolioMix = (
  legacyWeights: PortfolioWeights,
  operationalWeights?: M8OperationalWeights
): M8PortfolioMix => {
  const overlay = normalizeOperationalWeights(operationalWeights);
  const raw = {
    eq_global: legacyWeights.rvGlobal,
    eq_chile: legacyWeights.rvChile,
    fi_global: legacyWeights.rfGlobal,
    fi_chile: legacyWeights.rfChile,
    usd_liquidity: overlay.usd_liquidity,
    clp_cash: overlay.clp_cash,
  };

  const total = Object.values(raw).reduce((acc, value) => acc + value, 0);
  if (!isFiniteNumber(total) || total <= 0) {
    throw new Error('M8 portfolio mix invalido: total debe ser > 0');
  }

  return {
    eq_global: raw.eq_global / total,
    eq_chile: raw.eq_chile / total,
    fi_global: raw.fi_global / total,
    fi_chile: raw.fi_chile / total,
    usd_liquidity: raw.usd_liquidity / total,
    clp_cash: raw.clp_cash / total,
  };
};

const validateFutureEvents = (
  events: FutureCapitalEvent[] | undefined,
  simulationBaseMonth: string | undefined,
  totalMonths: number
): void => {
  if (!events || events.length === 0) return;

  for (const event of events) {
    if (!event.id?.trim()) throw new Error('futureCapitalEvents: id es obligatorio');
    if (event.type !== 'inflow' && event.type !== 'outflow') {
      throw new Error(`futureCapitalEvents[${event.id}].type invalido`);
    }
    if (!isFiniteNumber(event.amount) || event.amount <= 0) {
      throw new Error(`futureCapitalEvents[${event.id}].amount debe ser > 0`);
    }
    if (event.currency !== 'CLP' && event.currency !== 'USD' && event.currency !== 'UF') {
      throw new Error(`futureCapitalEvents[${event.id}].currency invalida`);
    }
    if (!event.effectiveDate?.trim()) {
      throw new Error(`futureCapitalEvents[${event.id}].effectiveDate es obligatorio`);
    }
    toM8Month(event.effectiveDate, simulationBaseMonth, totalMonths);
  }
};

const resolveHouse = (params: ModelParameters, capitalResolution: CapitalResolution): M8HouseInput | undefined => {
  const includeHouse = params.realEstatePolicy?.enabled ?? false;
  const resolvedHouse = capitalResolution.simulationComposition.nonOptimizable.realEstate;
  if (!includeHouse) return undefined;
  if (!resolvedHouse) {
    // En boot o bases sin inmueble, apagamos house de forma segura para evitar fallo en frio.
    return undefined;
  }
  if (!isFiniteNumber(resolvedHouse.propertyValueCLP) || resolvedHouse.propertyValueCLP <= 0) {
    throw new Error('propertyValueCLP invalido');
  }
  if (!isFiniteNumber(resolvedHouse.mortgageDebtOutstandingCLP) || resolvedHouse.mortgageDebtOutstandingCLP < 0) {
    throw new Error('mortgageDebtOutstandingCLP invalido');
  }
  if (!isFiniteNumber(resolvedHouse.ufSnapshotCLP) || resolvedHouse.ufSnapshotCLP <= 0) {
    throw new Error('ufSnapshotCLP invalido');
  }
  if (!isFiniteNumber(params.realEstatePolicy?.triggerRunwayMonths)) {
    throw new Error('realEstatePolicy.triggerRunwayMonths es obligatorio cuando include_house=true');
  }
  if (!isFiniteNumber(params.realEstatePolicy?.saleDelayMonths) || params.realEstatePolicy.saleDelayMonths < 0) {
    throw new Error('realEstatePolicy.saleDelayMonths invalido cuando include_house=true');
  }

  return {
    include_house: true,
    houseValueUf: resolvedHouse.propertyValueCLP / resolvedHouse.ufSnapshotCLP,
    mortgageBalanceUfNow: resolvedHouse.mortgageDebtOutstandingCLP / resolvedHouse.ufSnapshotCLP,
    monthlyAmortizationUf: resolvedHouse.monthlyMortgagePaymentCLP
      ? resolvedHouse.monthlyMortgagePaymentCLP / resolvedHouse.ufSnapshotCLP
      : 0,
    ufClpStart: resolvedHouse.ufSnapshotCLP,
    house_sale_trigger_years_of_spend: params.realEstatePolicy.triggerRunwayMonths / 12,
    house_sale_lag_months: params.realEstatePolicy.saleDelayMonths,
  };
};

export const validateM8Preconditions = (
  params: ModelParameters,
  capitalResolution: CapitalResolution,
  operationalWeights: M8OperationalWeights = M8_DEFAULT_OPERATIONAL_WEIGHTS
): ValidationResult => {
  const errors: string[] = [];

  try {
    const horizonMonths = params.simulation.horizonMonths;
    if (!Number.isInteger(horizonMonths) || horizonMonths <= 0) {
      errors.push('simulation.horizonMonths debe ser entero positivo');
    }
    if (horizonMonths % 12 !== 0) {
      errors.push('simulation.horizonMonths debe ser multiplo de 12 (no se permite redondeo)');
    }

    const capitalSource = params.capitalSource ?? 'aurum';
    if (!isValidCapitalSource(capitalSource)) {
      errors.push('capitalSource invalido: debe ser "aurum" o "manual"');
    }
    const generatorType = params.generatorType ?? 'student_t';
    if (generatorType !== 'gaussian_iid' && generatorType !== 'student_t' && generatorType !== 'two_regime') {
      errors.push('generatorType invalido: debe ser gaussian_iid, student_t o two_regime');
    }

    const simulationBaseMonth = resolveSimulationBaseMonth(params);
    if (params.futureCapitalEvents?.length && !simulationBaseMonth) {
      errors.push('futureCapitalEvents requieren simulationBaseMonth valido para normalizar effectiveDate');
    }

    combineM8PortfolioMix(params.weights, operationalWeights);

    buildScenarioOverrides(params);

    const phases = normalizeModelSpendingPhases(params);
    if (phases.length < 4) {
      errors.push('spendingPhases debe incluir al menos 4 fases para mapear a M8');
    } else {
      const firstFour = phases.slice(0, 4);
      for (const [idx, phase] of firstFour.entries()) {
        if (phase.currency !== 'CLP') {
          errors.push(`spendingPhases[${idx}] debe estar en CLP para M8`);
        }
        if (!isFiniteNumber(phase.amountReal) || phase.amountReal <= 0) {
          errors.push(`spendingPhases[${idx}].amountReal debe ser > 0`);
        }
        if (!Number.isInteger(phase.durationMonths) || phase.durationMonths <= 0) {
          errors.push(`spendingPhases[${idx}].durationMonths debe ser entero positivo`);
        }
      }
    }

    validateFutureEvents(
      params.futureCapitalEvents,
      simulationBaseMonth,
      params.simulation.horizonMonths,
    );

    if (!isFiniteNumber(capitalResolution.capitalInitial) || capitalResolution.capitalInitial < 0) {
      errors.push('capitalResolution.capitalInitial debe ser >= 0');
    }
    if (!capitalResolution.sourceLabel?.trim()) {
      errors.push('capitalResolution.sourceLabel es obligatorio');
    }

    const riskCapitalClp = resolveRiskCapitalClp(capitalResolution);
    if (riskCapitalClp > capitalResolution.capitalInitial + 1e-6) {
      errors.push('riskCapital no puede superar el capitalInitial visible');
    }

    if (params.feeAnnual !== undefined && (!isFiniteNumber(params.feeAnnual) || params.feeAnnual < 0)) {
      errors.push('feeAnnual debe ser finito y >= 0');
    }

    resolveHouse(params, capitalResolution);
  } catch (error) {
    errors.push((error as Error).message);
  }

  return { ok: errors.length === 0, errors };
};

export const toM8Input = (
  params: ModelParameters,
  capitalResolution: CapitalResolution,
  operationalWeights: M8OperationalWeights = M8_DEFAULT_OPERATIONAL_WEIGHTS
): M8Input => {
  const validation = validateM8Preconditions(params, capitalResolution, operationalWeights);
  if (!validation.ok) {
    throw new Error(`M8 preconditions failed:\n- ${validation.errors.join('\n- ')}`);
  }

  const horizonMonths = params.simulation.horizonMonths;
  const years = horizonMonths / 12;
  const portfolioMix = combineM8PortfolioMix(params.weights, operationalWeights);
  const normalizedPhases = normalizeModelSpendingPhases(params);
  const [phase1, phase2, phase3, phase4] = normalizedPhases;
  const simulationBaseMonth = resolveSimulationBaseMonth(params);
  const riskCapitalClp = resolveRiskCapitalClp(capitalResolution);
  const futureEvents =
    params.futureCapitalEvents?.map((event) => ({
      id: event.id,
      type: event.type,
      amount: event.amount,
      currency: event.currency,
      effective_month: toM8Month(event.effectiveDate, simulationBaseMonth, horizonMonths),
      description: event.description,
    })) ?? [];

  return {
    years,
    n_paths: params.simulation.nSim ?? M8_DEFAULT_N_PATHS,
    seed: params.simulation.seed,
    simulation_frequency: 'monthly',
    use_real_terms: true,
    ...(simulationBaseMonth ? { simulation_base_month: simulationBaseMonth } : {}),
    capital_initial_clp: Math.max(0, capitalResolution.capitalInitial - riskCapitalClp),
    capital_source: (params.capitalSource ?? 'aurum') as CapitalSource,
    capital_source_label: capitalResolution.sourceLabel,
    feeAnnual: params.feeAnnual ?? 0,
    risk_capital_clp: riskCapitalClp,
    portfolio_mix: portfolioMix,
    phase1MonthlyClp: phase1.amountReal,
    phase2MonthlyClp: phase2.amountReal,
    phase3MonthlyClp: phase3.amountReal,
    phase4MonthlyClp: phase4.amountReal,
    phase1EndYear: phase1.durationMonths / 12,
    phase2EndYear: (phase1.durationMonths + phase2.durationMonths) / 12,
    phase3EndYear: (phase1.durationMonths + phase2.durationMonths + phase3.durationMonths) / 12,
    return_assumptions: {
      eq_global_real_annual: params.returns.rvGlobalAnnual,
      eq_chile_real_annual: params.returns.rvChileAnnual,
      fi_global_real_annual: params.returns.rfGlobalAnnual,
      fi_chile_real_annual: params.returns.rfChileUFAnnual,
      usd_liquidity_real_annual: M8_DEFAULT_USD_LIQUIDITY_REAL_ANNUAL,
      clp_cash_real_annual: M8_DEFAULT_CLP_CASH_REAL_ANNUAL,
    },
    generator_type: params.generatorType ?? 'student_t',
    generator_params: buildGeneratorParams(params),
    scenario_overrides: buildScenarioOverrides(params),
    bucket: {
      bucket_mode: 'operational_simple',
      bucket_months: params.bucketMonths ?? 24,
    },
    cuts: buildCuts(params),
    house: resolveHouse(params, capitalResolution),
    future_events: futureEvents,
  };
};

export const fromM8Output = (
  output: M8Output,
  params: ModelParameters,
  durationMs = 0
): SimulationResults => {
  const nTotal = params.simulation.nSim ?? M8_DEFAULT_N_PATHS;
  const nRuin = Math.round(output.ProbRuin40 * nTotal);
  if (!output.maxDrawdownPercentiles || Object.keys(output.maxDrawdownPercentiles).length === 0) {
    throw new Error('M8Output.maxDrawdownPercentiles requerido para cutover');
  }

  return {
    probRuin: output.ProbRuin40,
    success40: output.Success40,
    probRuin40: output.ProbRuin40,
    probRuin20: output.ProbRuin20,
    nRuin,
    nTotal,
    uncertaintyBand: {
      low: Math.max(0, output.ProbRuin40 - 0.06),
      high: Math.min(1, output.ProbRuin40 + 0.06),
    },
    terminalWealthPercentiles: {
      25: output.TerminalP25CLP,
      50: output.TerminalMedianIfSuccessCLP,
      75: output.TerminalP75CLP,
    },
    terminalWealthAll: [],
    terminalWealthAllPaths: output.terminalWealthAllPaths ?? [],
    p50TerminalAllPaths: output.TerminalMedianCLP,
    p50TerminalSurvivors: output.TerminalMedianIfSuccessCLP,
    maxDrawdownPercentiles: output.maxDrawdownPercentiles,
    ruinTimingMedian: output.RuinYearMedian,
    ruinTimingP25: output.RuinYearP25,
    ruinTimingP75: output.RuinYearP75,
    fanChartData: output.fanChart ?? [],
    spendingRatioMedian: output.SpendFactorTotal,
    spendFactorTotal: output.SpendFactorTotal,
    houseSalePct: output.HouseSalePct,
    triggerYearMedian: output.TriggerYearMedian,
    saleYearMedian: output.SaleYearMedian,
    spendFactorPhase2: output.SpendFactorPhase2,
    spendFactorPhase3: output.SpendFactorPhase3,
    spendFactorCutMonths: output.SpendFactorCutMonths,
    spendFactorNoCutMonths: output.SpendFactorNoCutMonths,
    spendFactorCut1Months: output.SpendFactorCut1Months,
    spendFactorCut2Months: output.SpendFactorCut2Months,
    cutTimeShare: output.CutTimeShare,
    stressTimeShare: output.StressTimeShare,
    cut1TimeShare: output.Cut1TimeShare,
    cut2TimeShare: output.Cut2TimeShare,
    computedAt: new Date(),
    durationMs,
    params,
  };
};
