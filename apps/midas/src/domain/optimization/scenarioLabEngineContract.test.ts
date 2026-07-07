import assert from 'node:assert/strict';
import {
  SCENARIO_LAB_ENGINE_CONTRACT,
  getScenarioLabBlockedVariableReason,
  isScenarioLabEditableVariable,
} from './scenarioLabEngineContract';

assert(SCENARIO_LAB_ENGINE_CONTRACT.invariants.includes('house_sale_policy_defined_by_engine'));
assert(SCENARIO_LAB_ENGINE_CONTRACT.invariants.includes('t0_liquid_excludes_house'));
assert(SCENARIO_LAB_ENGINE_CONTRACT.invariants.includes('future_flows_stay_outside_t0'));

assert.equal(isScenarioLabEditableVariable('spendingPhases'), true);
assert.equal(isScenarioLabEditableVariable('futureCapitalEvents'), true);
assert.equal(isScenarioLabEditableVariable('houseSaleTrigger'), false);
assert.equal(isScenarioLabEditableVariable('returnScenario'), false);
assert.equal(isScenarioLabEditableVariable('horizonYears'), false);

assert.match(
  getScenarioLabBlockedVariableReason('houseSaleTrigger') ?? '',
  /venta de casa está definida por el motor/i,
);
assert.match(
  getScenarioLabBlockedVariableReason('realEstatePolicy') ?? '',
  /solo lectura/i,
);

assert(SCENARIO_LAB_ENGINE_CONTRACT.readonlyMetrics.includes('houseSalePct'));
assert(SCENARIO_LAB_ENGINE_CONTRACT.readonlyMetrics.includes('houseSaleYearMedian'));
assert(SCENARIO_LAB_ENGINE_CONTRACT.readonlyMetrics.includes('success40'));

console.log('scenarioLabEngineContract tests passed');
