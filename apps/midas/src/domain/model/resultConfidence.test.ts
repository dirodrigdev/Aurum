import assert from 'node:assert/strict';
import {
  buildResultConfidence,
  type BuildResultConfidenceInput,
  type ResultConfidenceCriticalSources,
} from './resultConfidence';

const canonicalSources = (): ResultConfidenceCriticalSources => ({
  aurumSnapshot: 'canonical',
  simulationConfig: 'canonical',
  instrumentUniverse: 'canonical',
  fx: 'canonical',
  capitalAdjustments: 'canonical',
  runResult: 'canonical',
  sandbox: 'canonical',
});

const canonicalInput = (): BuildResultConfidenceInput => ({
  criticalSources: canonicalSources(),
  run: {
    resultDigest: 'a'.repeat(64),
    isFinalForCurrentInput: true,
    resultInputHash: 'hash-1',
    effectiveEngineInputHash: 'hash-1',
    resultSeed: 42,
    expectedSeed: 42,
    resultNSim: 3000,
    expectedNSim: 3000,
    simulationRunStatus: 'completed',
    resultMetricsAvailable: true,
    lastRunInputHash: 'hash-1',
    lastRenderedResultHash: 'hash-1',
  },
  sandboxActive: false,
});

(() => {
  const result = buildResultConfidence(canonicalInput());
  assert.equal(result.status, 'canonical');
  assert.equal(result.label, 'OK');
  assert.equal(result.canUseForDecision, true);
  assert.equal(result.isCanonicalForDecision, true);
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), instrumentUniverse: 'fallback' },
  });
  assert.equal(result.status, 'review');
  assert.equal(result.label, 'Revisar');
  assert.equal(result.isCanonicalForDecision, false);
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), capitalAdjustments: 'local' },
  });
  assert.equal(result.status, 'canonical');
  assert.equal(result.label, 'OK');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), sandbox: 'sandbox' },
    sandboxActive: true,
  });
  assert.equal(result.status, 'review');
  assert.equal(result.label, 'Revisar');
})();

(() => {
  const input = canonicalInput();
  const result = buildResultConfidence({
    ...input,
    run: { ...input.run, resultDigest: null },
  });
  assert.equal(result.status, 'not_decisional');
  assert.equal(result.label, 'No usar');
  assert.equal(result.canUseForDecision, false);
})();

(() => {
  const input = canonicalInput();
  const result = buildResultConfidence({
    ...input,
    run: { ...input.run, lastRenderedResultHash: 'old-hash' },
  });
  assert.equal(result.status, 'not_decisional');
})();

(() => {
  const input = canonicalInput();
  const result = buildResultConfidence({
    ...input,
    run: { ...input.run, resultInputHash: 'old-hash' },
  });
  assert.equal(result.status, 'not_decisional');
})();

(() => {
  const input = canonicalInput();
  const result = buildResultConfidence({
    ...input,
    run: { ...input.run, simulationRunStatus: 'running' },
  });
  assert.equal(result.status, 'not_decisional');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), simulationConfig: 'missing' },
  });
  assert.equal(result.status, 'not_decisional');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), fx: 'fallback' },
  });
  assert.equal(result.status, 'review');
  assert.notEqual(result.label, 'OK');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: {
      ...canonicalSources(),
      instrumentUniverse: 'fallback',
      fx: 'fallback',
    },
  });
  assert.equal(result.status, 'review');
  assert.equal(result.isCanonicalForDecision, false);
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), capitalAdjustments: 'local' },
  });
  assert.equal(result.status, 'canonical');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), runResult: 'provisional' },
  });
  assert.equal(result.status, 'not_decisional');
  assert.notEqual(result.label, 'OK');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), instrumentUniverse: 'fallback' },
  });
  assert.equal(result.canUseForDecision, true);
  assert.equal(result.isCanonicalForDecision, false);
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), sandbox: 'sandbox' },
    sandboxActive: true,
  });
  assert.notEqual(result.status, 'canonical');
})();

(() => {
  const result = buildResultConfidence({
    ...canonicalInput(),
    criticalSources: { ...canonicalSources(), fx: 'error' },
  });
  assert.equal(result.status, 'not_decisional');
  assert.equal(result.canUseForDecision, false);
})();
