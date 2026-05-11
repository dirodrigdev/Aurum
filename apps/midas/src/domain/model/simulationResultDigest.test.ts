import assert from 'node:assert/strict';
import {
  buildSimulationResultDigest,
  buildSimulationResultDiagnostics,
} from './simulationResultDigest';

const baseDigestInput = {
  success40: 0.929,
  ruin40: 0.071,
  houseSalePct: 0.238,
  maxDrawdownP50: 0.493,
  resultSeed: 42,
  resultNSim: 3000,
  resultInputHash: 'fnv1a-fbad2c6a',
};

(() => {
  const first = buildSimulationResultDigest(baseDigestInput);
  const second = buildSimulationResultDigest({ ...baseDigestInput });
  assert.equal(first, second);
  assert.match(first ?? '', /^[0-9a-f]{64}$/);
})();

(() => {
  const original = buildSimulationResultDigest(baseDigestInput);
  const changed = buildSimulationResultDigest({ ...baseDigestInput, resultSeed: 43 });
  assert.notEqual(original, changed);
})();

(() => {
  const original = buildSimulationResultDigest(baseDigestInput);
  const changed = buildSimulationResultDigest({ ...baseDigestInput, resultInputHash: 'fnv1a-other' });
  assert.notEqual(original, changed);
})();

(() => {
  const original = buildSimulationResultDigest(baseDigestInput);
  const changed = buildSimulationResultDigest({ ...baseDigestInput, success40: 0.928 });
  assert.notEqual(original, changed);
})();

(() => {
  const original = buildSimulationResultDigest(baseDigestInput);
  const changed = buildSimulationResultDigest({ ...baseDigestInput, ruin40: 0.072 });
  assert.notEqual(original, changed);
})();

(() => {
  const original = buildSimulationResultDigest(baseDigestInput);
  const changed = buildSimulationResultDigest({ ...baseDigestInput, houseSalePct: 0.239 });
  assert.notEqual(original, changed);
})();

(() => {
  const original = buildSimulationResultDigest(baseDigestInput);
  const changed = buildSimulationResultDigest({ ...baseDigestInput, maxDrawdownP50: 0.494 });
  assert.notEqual(original, changed);
})();

(() => {
  const diagnostics = buildSimulationResultDiagnostics({
    result: {
      success40: baseDigestInput.success40,
      probRuin40: baseDigestInput.ruin40,
      houseSalePct: baseDigestInput.houseSalePct,
      maxDrawdownPercentiles: { 50: baseDigestInput.maxDrawdownP50 },
      nTotal: 3000,
    },
    resultInputHash: baseDigestInput.resultInputHash,
    effectiveEngineInputHash: baseDigestInput.resultInputHash,
    resultSeed: baseDigestInput.resultSeed,
    expectedSeed: baseDigestInput.resultSeed,
    resultNSim: baseDigestInput.resultNSim,
    expectedNSim: baseDigestInput.resultNSim,
    completedAt: '2026-05-12T00:00:00.000Z',
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: baseDigestInput.resultInputHash,
    lastRenderedResultHash: baseDigestInput.resultInputHash,
  });
  assert.equal(diagnostics.isFinalForCurrentInput, true);
  assert.equal(diagnostics.resultInputHash, baseDigestInput.resultInputHash);
})();

(() => {
  const diagnostics = buildSimulationResultDiagnostics({
    result: {
      success40: baseDigestInput.success40,
      probRuin40: baseDigestInput.ruin40,
      houseSalePct: baseDigestInput.houseSalePct,
      maxDrawdownPercentiles: { 50: baseDigestInput.maxDrawdownP50 },
      nTotal: 3000,
    },
    resultInputHash: 'fnv1a-old',
    effectiveEngineInputHash: baseDigestInput.resultInputHash,
    resultSeed: baseDigestInput.resultSeed,
    expectedSeed: baseDigestInput.resultSeed,
    resultNSim: baseDigestInput.resultNSim,
    expectedNSim: baseDigestInput.resultNSim,
    completedAt: '2026-05-12T00:00:00.000Z',
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: 'fnv1a-old',
    lastRenderedResultHash: 'fnv1a-old',
  });
  assert.equal(diagnostics.isFinalForCurrentInput, false);
})();

(() => {
  const diagnostics = buildSimulationResultDiagnostics({
    result: {
      success40: baseDigestInput.success40,
      probRuin40: baseDigestInput.ruin40,
      houseSalePct: null,
      maxDrawdownPercentiles: { 50: baseDigestInput.maxDrawdownP50 },
      nTotal: 3000,
    },
    resultInputHash: baseDigestInput.resultInputHash,
    effectiveEngineInputHash: baseDigestInput.resultInputHash,
    resultSeed: baseDigestInput.resultSeed,
    expectedSeed: baseDigestInput.resultSeed,
    resultNSim: baseDigestInput.resultNSim,
    expectedNSim: baseDigestInput.resultNSim,
    completedAt: '2026-05-12T00:00:00.000Z',
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: baseDigestInput.resultInputHash,
    lastRenderedResultHash: baseDigestInput.resultInputHash,
  });
  assert.equal(diagnostics.resultDigest, null);
  assert.equal(diagnostics.isFinalForCurrentInput, false);
})();
