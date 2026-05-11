import assert from 'node:assert/strict';
import { buildAssumptionModeDiagnostics } from './assumptionMode';

(() => {
  const diagnostics = buildAssumptionModeDiagnostics();
  assert.equal(diagnostics.assumptionMode, 'base');
  assert.equal(diagnostics.sandboxActive, false);
  assert.equal(diagnostics.localUnsyncedAdjustments, false);
  assert.equal(diagnostics.structuralAssumptionsSource, 'not_implemented');
})();

(() => {
  const diagnostics = buildAssumptionModeDiagnostics({
    localUnsyncedAdjustments: true,
  });
  assert.equal(diagnostics.assumptionMode, 'base');
  assert.equal(diagnostics.localUnsyncedAdjustments, true);
  assert.equal(diagnostics.sandboxActive, false);
})();

(() => {
  const diagnostics = buildAssumptionModeDiagnostics({
    sandboxActive: true,
  });
  assert.equal(diagnostics.assumptionMode, 'sandbox');
  assert.equal(diagnostics.sandboxActive, true);
})();

(() => {
  const diagnostics = buildAssumptionModeDiagnostics({
    assumptionMode: 'scenario',
    structuralAssumptionsSource: 'missing',
  });
  assert.equal(diagnostics.assumptionMode, 'scenario');
  assert.equal(diagnostics.structuralAssumptionsSource, 'missing');
})();
