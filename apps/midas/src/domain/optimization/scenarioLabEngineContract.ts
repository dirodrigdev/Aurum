export const SCENARIO_LAB_ENGINE_INVARIANTS = [
  'horizon_baseline_defined_by_engine',
  't0_liquid_excludes_house',
  'house_sale_policy_defined_by_engine',
  'instrument_universe_is_official_mix_source',
  'economic_capital_comes_from_aurum',
  'future_flows_stay_outside_t0',
  'ruin_success_qol_metrics_come_from_m8',
  'golden_productive_must_not_change',
] as const;

export const SCENARIO_LAB_EDITABLE_VARIABLES = [
  'spendingPhases',
  'phaseDurations',
  'bucketMonths',
  'portfolioMix',
  'cutRules',
  'futureCapitalEvents',
  'nSim',
  'seed',
] as const;

export const SCENARIO_LAB_BLOCKED_VARIABLE_REASONS = {
  houseSaleTrigger: 'La política de venta de casa está definida por el motor y no se propone como decisión libre en Scenario Lab.',
  returnScenario: 'Scenario Lab no soporta returnScenario en este contrato porque no existe un patch canónico sellado para ese cambio.',
  horizonYears: 'Scenario Lab no soporta horizonYears porque el horizonte y sus eventos asociados se heredan del baseline del motor.',
  realEstatePolicy: 'realEstatePolicy es de solo lectura para Scenario Lab.',
  houseConfig: 'La configuración de casa se hereda del baseline y no se modifica desde Scenario Lab.',
  capitalInitial: 'capitalInitial se hereda del baseline/Aurum y no es editable en Scenario Lab.',
  simulationComposition: 'simulationComposition se hereda del baseline/Aurum y no es editable en Scenario Lab.',
  instrumentUniverse: 'Instrument Universe es una fuente oficial del baseline y no se modifica desde Scenario Lab.',
} as const;

export const SCENARIO_LAB_ENGINE_READONLY_METRICS = [
  'success40',
  'ruin40',
  'nRuin',
  'houseSalePct',
  'houseSaleYearMedian',
  'terminalWealthRatio',
  'qolScore',
  'qolLabel',
  'csr85_4',
  'qualitySurvivalRate',
  'averageEffectiveSpendingRatio',
  'severeCutYearsMean',
] as const;

export type ScenarioLabEditableVariable = (typeof SCENARIO_LAB_EDITABLE_VARIABLES)[number];
export type ScenarioLabBlockedVariable = keyof typeof SCENARIO_LAB_BLOCKED_VARIABLE_REASONS;
export type ScenarioLabReadonlyMetric = (typeof SCENARIO_LAB_ENGINE_READONLY_METRICS)[number];

export type ScenarioLabEngineContract = {
  invariants: readonly string[];
  editableVariables: readonly ScenarioLabEditableVariable[];
  blockedVariables: readonly ScenarioLabBlockedVariable[];
  blockedVariableReasons: Readonly<Record<ScenarioLabBlockedVariable, string>>;
  readonlyMetrics: readonly ScenarioLabReadonlyMetric[];
};

export const SCENARIO_LAB_ENGINE_CONTRACT: ScenarioLabEngineContract = {
  invariants: SCENARIO_LAB_ENGINE_INVARIANTS,
  editableVariables: SCENARIO_LAB_EDITABLE_VARIABLES,
  blockedVariables: Object.keys(SCENARIO_LAB_BLOCKED_VARIABLE_REASONS) as ScenarioLabBlockedVariable[],
  blockedVariableReasons: SCENARIO_LAB_BLOCKED_VARIABLE_REASONS,
  readonlyMetrics: SCENARIO_LAB_ENGINE_READONLY_METRICS,
};

export function isScenarioLabEditableVariable(value: string): value is ScenarioLabEditableVariable {
  return (SCENARIO_LAB_EDITABLE_VARIABLES as readonly string[]).includes(value);
}

export function getScenarioLabBlockedVariableReason(value: string): string | null {
  return SCENARIO_LAB_BLOCKED_VARIABLE_REASONS[value as ScenarioLabBlockedVariable] ?? null;
}
