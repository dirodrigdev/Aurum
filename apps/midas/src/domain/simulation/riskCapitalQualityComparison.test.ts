import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runM8, type M8RuntimeResult } from './engineM8';
import type { M8Input } from './m8.types';
import { buildQualityOfLifeMetricsFromPathDiagnostics } from './qualityOfLifeMetrics';

type ComparisonFixture = {
  normalizedInput: M8Input;
  replayTrace: {
    sourceMetadata: {
      capitalDerivation: {
        compositionRiskCapitalClp: number;
      };
    };
  };
};

const FIXTURE_PATH = new URL('./__fixtures__/productionGoldenRun.v1.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ComparisonFixture;

const cloneInput = (input: M8Input): M8Input => structuredClone(input);

const buildOffInput = (): M8Input => {
  const input = cloneInput(fixture.normalizedInput);
  input.risk_capital_clp = 0;
  delete input.risk_capital_policy;
  delete input.risk_capital_btc_driver;
  return input;
};

const buildOnInput = (riskCapitalClp: number): M8Input => ({
  ...cloneInput(fixture.normalizedInput),
  risk_capital_clp: riskCapitalClp,
  risk_capital_policy: 'btc_like_realista_e_cycle_min',
  risk_capital_btc_driver: 'btc_like_v1',
});

const buildMetrics = (input: M8Input) => {
  const runtime = runM8(input);
  const diagnostics = runtime.pathQualityDiagnostics;
  assert.ok(diagnostics, 'M8 must expose path quality diagnostics for risk-capital comparison');
  const quality = buildQualityOfLifeMetricsFromPathDiagnostics(diagnostics, {
    initialSimulableCapitalClp: input.capital_initial_clp,
  });
  return { runtime, diagnostics, quality };
};

const assertNear = (actual: number | null, expected: number, tolerance: number, label: string) => {
  assert.notEqual(actual, null, `${label} must be available`);
  assert.ok(
    Math.abs((actual as number) - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
};

const qualifiesForQualitySurvival = (
  path: NonNullable<M8RuntimeResult['pathQualityDiagnostics']>['paths'][number],
): boolean => (
  !path.ruined
  && path.averageConsumptionRatio !== null
  && path.averageConsumptionRatio >= 0.9
  && path.maxConsecutiveMonthsBelow85 !== null
  && path.maxConsecutiveMonthsBelow85 <= 6
  && path.monthsBelow85 !== null
  && path.monthsBelow85 <= 24
);

const riskCapitalClp = fixture.replayTrace.sourceMetadata.capitalDerivation.compositionRiskCapitalClp;
const offInput = buildOffInput();
const zeroCapitalPolicyInput = buildOnInput(0);
const onInput = buildOnInput(riskCapitalClp);

const off = buildMetrics(offInput);
const zeroCapitalPolicy = buildMetrics(zeroCapitalPolicyInput);
const on = buildMetrics(onInput);

// Selecting the risk policy without adding capital must not perturb the base market paths.
assert.deepEqual(
  zeroCapitalPolicy.runtime,
  off.runtime,
  'a zero-value risk sleeve must not consume the core portfolio random stream',
);

assertNear(off.quality.classicSuccessRate, 0.91, 1e-12, 'OFF sustainability');
assertNear(on.quality.classicSuccessRate, 0.944, 1e-12, 'ON sustainability');
assertNear(off.quality.qualitySurvivalRate, 0.153, 1e-12, 'OFF quality survival');
assertNear(on.quality.qualitySurvivalRate, 0.169, 1e-12, 'ON quality survival');
assertNear(off.quality.csr85_4, 0.732, 1e-12, 'OFF CSR 85/4');
assertNear(on.quality.csr85_4, 0.776, 1e-12, 'ON CSR 85/4');
assertNear(off.quality.averageEffectiveSpendingRatio, 0.9592675084884893, 1e-12, 'OFF effective spending');
assertNear(on.quality.averageEffectiveSpendingRatio, 0.9622201373304615, 1e-12, 'ON effective spending');
assertNear(off.quality.monthsBelow85, 35.762, 1e-12, 'OFF months below 85%');
assertNear(on.quality.monthsBelow85, 32.966, 1e-12, 'ON months below 85%');
assertNear(off.quality.maxConsecutiveMonthsBelow85, 23, 1e-12, 'OFF max streak below 85%');
assertNear(on.quality.maxConsecutiveMonthsBelow85, 21, 1e-12, 'ON max streak below 85%');
assertNear(off.quality.severeCutYearsMean, 2.980166666666666, 1e-12, 'OFF severe-cut years');
assertNear(on.quality.severeCutYearsMean, 2.7471666666666628, 1e-12, 'ON severe-cut years');
assertNear(off.quality.terminalWealthP50, 3357104872.753105, 1e-3, 'OFF terminal wealth P50');
assertNear(on.quality.terminalWealthP50, 4323207884.4991255, 1e-3, 'ON terminal wealth P50');

const offPaths = new Map(off.diagnostics.paths.map((path) => [path.pathId, path]));
const onPaths = new Map(on.diagnostics.paths.map((path) => [path.pathId, path]));
const rescuedPaths = on.diagnostics.paths.filter(
  (path) => offPaths.get(path.pathId)?.ruined === true && !path.ruined,
);
const regressedPaths = off.diagnostics.paths.filter(
  (path) => !path.ruined && onPaths.get(path.pathId)?.ruined === true,
);
const newlyQualityPassingPaths = on.diagnostics.paths.filter((path) => {
  const previous = offPaths.get(path.pathId);
  return qualifiesForQualitySurvival(path) && Boolean(previous) && !qualifiesForQualitySurvival(previous!);
});
const noLongerQualityPassingPaths = off.diagnostics.paths.filter((path) => {
  const current = onPaths.get(path.pathId);
  return qualifiesForQualitySurvival(path) && Boolean(current) && !qualifiesForQualitySurvival(current!);
});

assert.equal(rescuedPaths.length, 34, 'risk capital must rescue the expected paired paths');
assert.equal(regressedPaths.length, 0, 'additional risk capital must not ruin a previously surviving paired path');
assert.equal(
  rescuedPaths.filter(qualifiesForQualitySurvival).length,
  0,
  'rescued paths remain outside the stricter quality-survival thresholds',
);
assert.equal(
  rescuedPaths.filter((path) => (path.maxConsecutiveMonthsBelow85 ?? 0) > 6).length,
  34,
  'all rescued paths still exceed the allowed low-consumption streak',
);
assert.equal(
  rescuedPaths.filter((path) => (path.monthsBelow85 ?? 0) > 24).length,
  34,
  'all rescued paths still exceed the allowed total months below 85%',
);
assert.equal(
  newlyQualityPassingPaths.length,
  18,
  'risk-capital transfers must move the expected surviving paths into quality survival',
);
assert.equal(
  noLongerQualityPassingPaths.length,
  2,
  'the hard six-month streak threshold makes the binary quality metric locally non-monotonic',
);
assert.equal(
  newlyQualityPassingPaths.length - noLongerQualityPassingPaths.length,
  16,
  'quality survival must improve by the expected net number of paths',
);

console.log('Risk-capital OFF/ON quality comparison passed');
