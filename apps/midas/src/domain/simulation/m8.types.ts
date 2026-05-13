// domain/simulation/m8.types.ts
// Contrato puente M8 v12 — solo tipos (fase 1, sin integración del motor)

import type { CapitalSource, M8GeneratorType } from '../model/types';
import type { ScenarioVariantId } from '../model/types';

export interface M8LegacyPortfolioWeights {
  rvGlobal: number;
  rfGlobal: number;
  rvChile: number;
  rfChile: number;
}

export interface M8OperationalWeights {
  usd_liquidity: number;
  clp_cash: number;
}

export interface M8PortfolioMix {
  eq_global: number;
  eq_chile: number;
  fi_global: number;
  fi_chile: number;
  usd_liquidity: number;
  clp_cash: number;
}

export interface M8ReturnAssumptions {
  eq_global_real_annual: number;
  eq_chile_real_annual: number;
  fi_global_real_annual: number;
  fi_chile_real_annual: number;
  usd_liquidity_real_annual: number;
  clp_cash_real_annual: number;
}

export interface M8GeneratorParams {
  distribution: 'gaussian_iid' | 'student_t' | 'two_regime';
  sleeves: {
    eq_global: M8GeneratorSleeveStats;
    eq_chile: M8GeneratorSleeveStats;
    fi_global: M8GeneratorSleeveStats;
    fi_chile: M8GeneratorSleeveStats;
    usd_liquidity: M8GeneratorSleeveStats;
    clp_cash: M8GeneratorSleeveStats;
  };
  correlation_matrix: number[][];
}

export type M8AnyGeneratorParams =
  | M8GaussianIIDGeneratorParams
  | M8StudentTGeneratorParams
  | M8TwoRegimeGeneratorParams;

export interface M8GeneratorSleeveStats {
  mean_annual: number;
  vol_annual: number;
}

export interface M8GaussianIIDGeneratorParams extends M8GeneratorParams {
  distribution: 'gaussian_iid';
}

export interface M8StudentTGeneratorParams extends M8GeneratorParams {
  distribution: 'student_t';
  degrees_of_freedom: number;
}

export interface M8TwoRegimeGeneratorParams extends M8GeneratorParams {
  distribution: 'two_regime';
  transition_matrix: {
    normal: { normal: number; stress: number };
    stress: { stress: number; normal: number };
  };
  regimes: {
    normal: M8GeneratorParams['sleeves'];
    stress: M8GeneratorParams['sleeves'];
  };
}

export interface M8ScenarioOverrides {
  scenario_id: ScenarioVariantId;
  rv_global_annual?: number;
  rf_global_annual?: number;
  rv_chile_annual?: number;
  rf_chile_annual?: number;
  rv_global_vol_annual?: number;
  rf_global_vol_annual?: number;
  rv_chile_vol_annual?: number;
  rf_chile_vol_annual?: number;
  ipc_chile_annual?: number;
  tcreal_lt?: number;
}

export interface M8CutsInput {
  cut1_floor: number;
  cut2_floor: number;
  recovery_cut2_to_cut1_months: number;
  recovery_cut1_to_normal_months: number;
  adjustment_alpha: number;
  dd15_threshold: number;
  dd25_threshold: number;
  consecutive_months: number;
}

export interface M8HouseInput {
  include_house: boolean;
  houseValueUf: number;
  mortgageBalanceUfNow: number;
  monthlyAmortizationUf: number;
  ufClpStart: number;
  house_sale_trigger_years_of_spend: number;
  house_sale_lag_months: number;
}

export interface M8FutureEventInput {
  id: string;
  type: 'inflow' | 'outflow';
  amount: number;
  currency: 'CLP' | 'USD' | 'UF';
  effective_month: number; // 1..years*12
  description?: string;
}

export type M8RiskCapitalPolicy =
  | 'reserve_late_full'
  | 'reserve_late_haircut40'
  | 'reserve_stress_haircut40_prehouse20'
  | 'btc_like_realista_e'
  | 'btc_like_realista_e_cycle_min';

export type M8RiskCapitalBtcDriver =
  | 'eq_global_proxy'
  | 'btc_like_v1';

export interface M8RiskELargeSaleStat {
  saleIndex: 1 | 2 | 3 | 4;
  executionPct: number;
  yearMedian: number;
  yearP25: number;
  yearP75: number;
  yearMean: number;
}

export interface M8RiskEMicroSaleStat {
  executionPct: number;
  firstYearMedian: number;
  lastYearMedian: number;
  countMedian: number;
  countMean: number;
}

export interface M8Input {
  years: number;
  // Default contractual M8: 3000 (si UI abre con 1000, no cambia el default del motor).
  n_paths: number;
  seed: number;
  simulation_frequency: 'monthly';
  use_real_terms: true;
  simulation_base_month?: string;
  capital_initial_clp: number;
  capital_source: CapitalSource;
  capital_source_label?: string;
  feeAnnual?: number;
  risk_capital_clp?: number;
  risk_capital_policy?: M8RiskCapitalPolicy;
  risk_capital_btc_driver?: M8RiskCapitalBtcDriver;
  portfolio_mix: M8PortfolioMix;
  phase1MonthlyClp: number;
  phase2MonthlyClp: number;
  phase3MonthlyClp: number;
  phase4MonthlyClp: number;
  phase1EndYear: number;
  phase2EndYear: number;
  phase3EndYear: number;
  return_assumptions: M8ReturnAssumptions;
  generator_type: M8GeneratorType;
  generator_params: M8AnyGeneratorParams;
  scenario_overrides?: M8ScenarioOverrides;
  bucket: {
    bucket_mode: 'operational_simple';
    bucket_months: number;
  };
  cuts: M8CutsInput;
  house?: M8HouseInput;
  future_events?: M8FutureEventInput[];
}

export interface M8FanChartPoint {
  year: number;
  p5: number; p10: number; p25: number;
  p50: number;
  p75: number; p90: number; p95: number;
}

export interface M8Output {
  Success40: number;
  ProbRuin20: number;
  ProbRuin40: number;
  RuinYearMedian: number;
  RuinYearP10?: number;
  RuinYearP25: number;
  RuinYearP75: number;
  RuinYearP90?: number;
  TerminalMedianCLP: number;
  TerminalMedianIfSuccessCLP: number;
  TerminalP25AllPaths: number;
  TerminalP25IfSuccess: number;
  TerminalP75AllPaths: number;
  TerminalP75IfSuccess: number;
  HouseSalePct: number;
  TriggerYearMedian: number;
  SaleYearMedian: number;
  SpendFactorTotal: number;
  SpendFactorPhase2: number;
  SpendFactorPhase3?: number;
  SpendFactorCutMonths: number;
  SpendFactorNoCutMonths: number;
  SpendFactorCut1Months: number;
  SpendFactorCut2Months: number;
  CutTimeShare: number;
  CutScenarioPct?: number;
  CutSeverityMean?: number;
  FirstCutYearMedian?: number;
  terminalWealthAllPaths?: number[];
  maxDrawdownPercentiles: Record<number, number>;
  fanChart?: M8FanChartPoint[];
  // Métricas adicionales opcionales
  StressTimeShare?: number;
  Cut1TimeShare?: number;
  Cut2TimeShare?: number;
  RiskELargeSell1YearMedian?: number;
  RiskELargeSell2YearMedian?: number;
  RiskEAnyLargeSalePct?: number;
  RiskELargeSalesStats?: M8RiskELargeSaleStat[];
  RiskEMicroSalesStats?: M8RiskEMicroSaleStat;
}
