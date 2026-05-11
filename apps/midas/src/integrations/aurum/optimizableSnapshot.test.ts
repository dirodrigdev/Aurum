import assert from 'node:assert/strict';
import { resetFxTraceDiagnostics, shouldEmitFxTrace } from './optimizableSnapshot';

(() => {
  resetFxTraceDiagnostics();
  const payload = {
    docPath: 'aurum_published/optimizableInvestments',
    publishedAt: '2026-05-11T08:42:00.424Z',
    version: 2,
    rawFxReferenceClpUsd: 891,
    rawFxReferenceSource: 'active_fx_rates',
  };
  assert.equal(shouldEmitFxTrace('snapshot_subscribe_onSnapshot', payload), true);
  assert.equal(shouldEmitFxTrace('snapshot_subscribe_onSnapshot', payload), false);
})();

(() => {
  resetFxTraceDiagnostics();
  const first = {
    rawFxReferenceClpUsd: 891,
    rawFxReferenceSource: 'active_fx_rates',
    rawLegacyFxUsdClp: null,
    normalizedFxClpUsd: 891,
    normalizedFxSource: 'active_fx_rates',
  };
  const second = {
    ...first,
    normalizedFxClpUsd: 892,
  };
  assert.equal(shouldEmitFxTrace('snapshot_hydration_raw', first), true);
  assert.equal(shouldEmitFxTrace('snapshot_hydration_raw', first), false);
  assert.equal(shouldEmitFxTrace('snapshot_hydration_raw', second), true);
})();

console.log('optimizableSnapshot tests passed');
