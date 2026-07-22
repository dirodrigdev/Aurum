import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import type { ModelParameters } from '../model/types';
import { buildM8InputFingerprint } from '../model/m8InputFingerprint';
import { resolveCapital } from './capitalResolver';
import { runM8 } from './engineM8';
import { toM8Input } from './m8Adapter';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const makeParams = (scenario: ModelParameters['activeScenario'] = 'base'): ModelParameters => {
  const params = clone(DEFAULT_PARAMETERS);
  params.activeScenario = scenario;
  params.generatorType = 'gaussian_iid';
  params.simulation = {
    ...params.simulation,
    nSim: 64,
    horizonMonths: 48,
    seed: 4242,
    useHistoricalData: false,
  };
  params.spendingPhases = params.spendingPhases.map((phase) => ({ ...phase, amountReal: 1 }));
  params.realEstatePolicy = { ...params.realEstatePolicy!, enabled: false };
  params.simulationComposition = {
    ...params.simulationComposition!,
    nonOptimizable: {
      ...params.simulationComposition!.nonOptimizable,
      riskCapital: { totalCLP: 0 },
    },
  };
  return params;
};

const buildInput = (params: ModelParameters) => toM8Input(params, resolveCapital({ params }));

const fingerprint = (params: ModelParameters, effectiveEngineInput: ReturnType<typeof buildInput>) =>
  buildM8InputFingerprint({
    params,
    effectiveEngineInput,
    riskCapitalEnabled: false,
    riskCapitalEffective: false,
    weightsSourceMode: 'test',
    universeSourceOrigin: 'none',
    aurumSnapshotMonth: null,
    aurumSnapshotLabel: null,
    aurumSnapshotPublishedAt: null,
    aurumSnapshotSignature: null,
    simulationConfigSource: 'fallback',
    simulationConfigSavedAt: null,
    simulationConfigHash: null,
    instrumentUniverseSavedAt: null,
    instrumentUniverseHash: null,
    hydratedCloudSources: false,
  }).effectiveEngineInputHash;

const outputDigest = (output: ReturnType<typeof runM8>) => JSON.stringify({
  success: output.Success40,
  ruin: output.ProbRuin40,
  terminal: [output.TerminalMedianCLP, output.TerminalP25AllPaths, output.TerminalP75AllPaths],
  paths: output.terminalWealthAllPaths,
});

const baseParams = makeParams();
const baseInput = buildInput(baseParams);
assert.deepEqual(baseInput.scenario_overrides, { scenario_id: 'base' });

const pessimisticInput = buildInput(makeParams('pessimistic'));
assert.equal(pessimisticInput.scenario_overrides?.rv_global_annual, 0.04);
assert.equal(pessimisticInput.scenario_overrides?.rf_chile_annual, 0);
assert.equal(pessimisticInput.scenario_overrides?.rv_global_vol_annual, 0.192);
assert.equal('ipc_chile_annual' in (pessimisticInput.scenario_overrides ?? {}), false);
assert.equal('tcreal_lt' in (pessimisticInput.scenario_overrides ?? {}), false);

const optimisticInput = buildInput(makeParams('optimistic'));
const baseOutput = runM8(baseInput);
const optimisticOutput = runM8(optimisticInput);
assert.notEqual(outputDigest(baseOutput), outputDigest(optimisticOutput), 'effective scenario overrides must alter M8 output');
assert.notEqual(fingerprint(baseParams, baseInput), fingerprint(makeParams('optimistic'), optimisticInput));

const inertOnlyParams = makeParams();
inertOnlyParams.inflation = { ...inertOnlyParams.inflation, ipcChileAnnual: 0.09 };
inertOnlyParams.fx = { ...inertOnlyParams.fx, tcrealLT: 999 };
const inertOnlyInput = buildInput(inertOnlyParams);
assert.deepEqual(inertOnlyInput, baseInput, 'M8 effective input must not carry inert scenario dimensions');
assert.equal(fingerprint(inertOnlyParams, inertOnlyInput), fingerprint(baseParams, baseInput));
assert.equal(outputDigest(runM8(inertOnlyInput)), outputDigest(baseOutput));

console.log('scenarioOverrides.test.ts: all assertions passed');
