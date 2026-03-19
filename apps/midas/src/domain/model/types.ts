// domain/model/types.ts
// Tipos del dominio Midas — independientes de Aurum

export interface PortfolioWeights {
  rvGlobal: number;
  rfGlobal: number;
  rvChile:  number;
  rfChile:  number;
}

export interface SpendingPhase {
  durationMonths: number;
  amountReal:     number;
  currency:       'EUR' | 'CLP';
}

export interface SpendingRule {
  dd15Threshold:      number;
  dd25Threshold:      number;
  consecutiveMonths:  number;
  softCut:            number;
  hardCut:            number;
  adjustmentAlpha:    number;
}

export interface ReturnAssumptions {
  rvGlobalAnnual:      number;
  rfGlobalAnnual:      number;
  rvChileAnnual:       number;
  rfChileUFAnnual:     number;
  rvGlobalVolAnnual:   number;
  rfGlobalVolAnnual:   number;
  rvChileVolAnnual:    number;
  rfChileVolAnnual:    number;
  correlationMatrix:   number[][];
}

export interface InflationAssumptions {
  ipcChileAnnual:    number;
  hipcEurAnnual:     number;
  ipcChileVolAnnual: number;
  hipcEurVolAnnual:  number;
}

export interface FXAssumptions {
  clpUsdInitial:   number;
  usdEurFixed:     number;
  tcrealLT:        number;
  mrHalfLifeYears: number;
}

export interface SimulationConfig {
  nSim:              number;
  horizonMonths:     number;
  blockLength:       number;
  seed:              number;
  useHistoricalData: boolean;
}

export interface ModelParameters {
  label:                string;
  capitalInitial:       number;
  weights:              PortfolioWeights;
  feeAnnual:            number;
  spendingPhases:       SpendingPhase[];
  spendingRule:         SpendingRule;
  returns:              ReturnAssumptions;
  inflation:            InflationAssumptions;
  fx:                   FXAssumptions;
  simulation:           SimulationConfig;
  ruinThresholdMonths:  number;
}

export interface FanChartPoint {
  year: number;
  p5: number; p10: number; p25: number;
  p50: number;
  p75: number; p90: number; p95: number;
}

export interface SimulationResults {
  probRuin:                    number;
  nRuin:                       number;
  nTotal:                      number;
  terminalWealthPercentiles:   Record<number, number>;
  terminalWealthAll:           number[];
  maxDrawdownPercentiles:      Record<number, number>;
  ruinTimingMedian:            number;
  ruinTimingP25:               number;
  ruinTimingP75:               number;
  fanChartData:                FanChartPoint[];
  spendingRatioMedian:         number;
  computedAt:                  Date;
  durationMs:                  number;
  params:                      ModelParameters;
}

export interface SensitivityParameter {
  id:          string;
  label:       string;
  values:      number[];
  valueLabels: string[];
  paramPath:   string;
}

export interface SensitivityPoint {
  valueLabel: string;
  value:      number;
  probRuin:   number;
  terminalP50: number;
}

export interface SensitivityResult {
  paramId:    string;
  paramLabel: string;
  points:     SensitivityPoint[];
}

export interface StressScenario {
  id:          string;
  label:       string;
  description: string;
  monthlyOverrides: Array<{
    fromMonth: number;
    toMonth:   number;
    overrides: Partial<{
      r_RVg: number; r_RFg: number;
      r_RVcl: number; r_RFcl: number;
      ipc_cl_m: number; hicp_eur_m: number;
      d_logCLPUSD: number;
    }>;
  }>;
}

export interface StressResult {
  scenario:           StressScenario;
  ruinMonth:          number | null;
  terminalWealthReal: number;
  maxDrawdownReal:    number;
  minSpendingMult:    number;
  wealthTrajectory:   Array<{ year: number; wealth: number }>;
}

// Optimizador
export interface OptimizerConstraints {
  minRvGlobal: number; maxRvGlobal: number;
  minRfGlobal: number; maxRfGlobal: number;
  minRvChile:  number; maxRvChile:  number;
  minRfChile:  number; maxRfChile:  number;
  step:        number;
}

export type OptimizerObjective = 'minRuin' | 'maxP50' | 'balanced';

export interface OptimizerResult {
  weights:         PortfolioWeights;
  probRuin:        number;
  terminalP50:     number;
  terminalP10:     number;
  vsCurrentRuin:   number;  // delta vs current
  vsCurrentP50:    number;
  moves:           Array<{ sleeve: string; delta: number; direction: 'up' | 'down' }>;
}
