import assert from 'node:assert/strict';
import { normalizeSnapshotData, resetFxTraceDiagnostics, shouldEmitFxTrace } from './optimizableSnapshot';

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

(() => {
  const normalized = normalizeSnapshotData({
    version: 2,
    publishedAt: '2026-05-11T08:42:00.424Z',
    snapshotMonth: '2026-05',
    snapshotLabel: 'test',
    currency: 'CLP',
    totalNetWorthCLP: 2_000_000_000,
    optimizableInvestmentsCLP: 1_500_000_000,
    fxReference: {
      clpUsd: 891,
      usdEur: 1.16,
      source: 'active_fx_rates',
    },
    source: {
      app: 'aurum',
      basis: 'latest_confirmed_closure',
    },
  });
  assert.equal(normalized?.fxReference?.clpUsd, 891);
  assert.equal(normalized?.fxReference?.usdEur, 1.16);
})();

console.log('optimizableSnapshot tests passed');
