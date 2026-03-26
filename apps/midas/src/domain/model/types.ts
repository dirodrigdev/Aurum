// domain/model/types.ts
// Tipos del dominio Midas — independientes de Aurum

export interface PortfolioWeights {
  rvGlobal: number;
  rfGlobal: number;
  rvChile:  number;
  rfChile:  number;
}

export interface CashflowEvent {
  id:          string;
  description: string;
  month:       number; // 1–480
  // Convención: eventos se aplican DESPUÉS de retornos y ANTES del gasto mensual
  // month = (año - 1) * 12 + 1  →  inicio del año indicado por el usuario
  type:        'inflow' | 'outflow';
  amount:      number; // en moneda original, siempre positivo
  currency:    'CLP' | 'USD' | 'EUR';
  sleeve?:     keyof PortfolioWeights;
  // Lógica de entrada/salida:
  //   inflow sin sleeve  → entra a rfChile (caja por defecto)
  //   inflow con sleeve  → entra al sleeve indicado
  //   outflow sin sleeve → waterfall: rfChile → rfGlobal → rvChile → rvGlobal
  //   outflow con sleeve → sale primero del sleeve indicado; si no alcanza, continúa waterfall
  // NOTA V1: AFP y fondos se tratan como liquidez inmediata.
  //          No se modelan plazos de rescate, gates ni restricciones operativas reales.
}

export type ScenarioVariantId = 'base' | 'pessimistic' | 'optimistic';

export interface ScenarioVariant {
  id:    ScenarioVariantId;
  label: string;
  // Valores ABSOLUTOS — no multiplicadores
  // Si undefined, usa el valor de DEFAULT_PARAMETERS (escenario base)
  rvGlobalAnnual?:    number;
  rfGlobalAnnual?:    number;
  rvChileAnnual?:     number;
  rfChileUFAnnual?:   number;
  rvGlobalVolAnnual?: number;
  rfGlobalVolAnnual?: number;
  rvChileVolAnnual?:  number;
  rfChileVolAnnual?:  number;
  ipcChileAnnual?:    number;
  tcrealLT?:          number;
}

export interface ScenarioPoint {
  probRuin:    number;
  terminalP50: number;
  terminalP10: number;
}

export interface ScenarioComparison {
  base:        ScenarioPoint;
  pessimistic: ScenarioPoint;
  optimistic:  ScenarioPoint;
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

export type CompositionMode = 'legacy' | 'partial' | 'full';

export type MortgageProjectionStatus = 'schedule' | 'reconstructed' | 'fallback_incomplete';

export interface RealEstateInput {
  propertyValueCLP: number;
  realEstateEquityCLP?: number;
  mortgageDebtOutstandingCLP?: number;
  monthlyMortgagePaymentCLP?: number;
  mortgageEndDate?: string;
  mortgageRate?: number;
  amortizationSystem?: 'french' | 'constant' | string;
  mortgageScheduleCLP?: Array<{ month: number; debtCLP: number }>;
}

export interface NonOptimizableBlocksInput {
  banksCLP: number;
  nonMortgageDebtCLP: number;
  realEstate?: RealEstateInput;
}

export interface SimulationCompositionDiagnostics {
  sourceVersion: 1 | 2;
  mode: CompositionMode;
  compositionGapCLP: number;
  compositionGapPct: number;
  notes: string[];
  saleTriggeredMonth?: number;
  saleExecutedMonth?: number;
  terminalAdjustmentApplied?: boolean;
  terminalAdjustmentCLP?: number;
}

export interface SimulationCompositionInput {
  mode: CompositionMode;
  totalNetWorthCLP: number;
  optimizableInvestmentsCLP: number;
  nonOptimizable: NonOptimizableBlocksInput;
  mortgageProjectionStatus?: MortgageProjectionStatus;
  diagnostics?: SimulationCompositionDiagnostics;
}

export interface RealEstatePolicy {
  enabled: boolean;
  triggerRunwayMonths: number;
  saleDelayMonths: number;
  saleCostPct: number;
}

export interface ModelParameters {
  label:                string;
  capitalInitial:       number;
  weights:              PortfolioWeights;
  cashflowEvents:       CashflowEvent[];
  activeScenario:       ScenarioVariantId;
  feeAnnual:            number;
  spendingPhases:       SpendingPhase[];
  spendingRule:         SpendingRule;
  returns:              ReturnAssumptions;
  inflation:            InflationAssumptions;
  fx:                   FXAssumptions;
  simulation:           SimulationConfig;
  simulationComposition?: SimulationCompositionInput;
  realEstatePolicy?: RealEstatePolicy;
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
  // Banda de incertidumbre heurística — NO es un intervalo de confianza estadístico.
  // Representa incertidumbre de parámetros (±6pp sobre probRuin).
  // Mostrar siempre con label: "Banda de incertidumbre (±6pp estimado)"
  uncertaintyBand:             { low: number; high: number };
  scenarioComparison?:         ScenarioComparison;
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
