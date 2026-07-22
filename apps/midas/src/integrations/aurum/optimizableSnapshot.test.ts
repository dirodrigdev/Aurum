import assert from 'node:assert/strict';
import {
  normalizeSnapshotData,
  resetFxTraceDiagnostics,
  resolvePublishedSnapshotData,
  shouldEmitFxTrace,
} from './optimizableSnapshot';

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
      clpEur: 1_025,
      usdEur: 1.16,
      ufClp: 39_500,
      source: 'closure_fx_metadata',
      sourceId: 'closure-2026-05',
      asOf: '2026-05-31',
      validationStatus: 'valid',
      schemaVersion: 1,
      rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
      rateSource: { usd: 'BCCh', eur: 'BCCh', uf: 'SII' },
    },
    source: {
      app: 'aurum',
      basis: 'latest_confirmed_closure',
    },
  });
  assert.equal(normalized?.fxReference?.clpUsd, 891);
  assert.equal(normalized?.fxReference?.usdEur, 1.16);
})();

(() => {
  const snapshot = {
    version: 2,
    publishedAt: '2026-05-11T08:42:00.424Z',
    snapshotMonth: '2026-05',
    snapshotLabel: 'test',
    currency: 'CLP',
    totalNetWorthCLP: 2_000_000_000,
    optimizableInvestmentsCLP: 1_500_000_000,
    fxReference: {
      clpUsd: 891,
      clpEur: 1_025,
      usdEur: 1.16,
      ufClp: 39_500,
      source: 'closure_fx_metadata',
      sourceId: 'closure-2026-05',
      asOf: '2026-05-31',
      validationStatus: 'valid',
      schemaVersion: 1,
      rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
      rateSource: { usd: 'BCCh', eur: 'BCCh', uf: 'SII' },
    },
    source: { app: 'aurum', basis: 'latest_confirmed_closure' },
  } as const;
  const deviceA = normalizeSnapshotData({ ...snapshot, fx: { usdClp: 800 } } as unknown as Parameters<typeof normalizeSnapshotData>[0]);
  const deviceB = normalizeSnapshotData({ ...snapshot, fx: { usdClp: 1_400 } } as unknown as Parameters<typeof normalizeSnapshotData>[0]);
  assert.deepEqual(deviceA?.fxReference, deviceB?.fxReference, 'local/legacy FX must not alter the canonical snapshot');
  assert.equal(normalizeSnapshotData({ ...snapshot, fxReference: { clpUsd: 891 } } as unknown as Parameters<typeof normalizeSnapshotData>[0]), null);
  assert.equal(normalizeSnapshotData({ ...snapshot, fxReference: { ...snapshot.fxReference, clpUsd: 0 } }), null);
  assert.equal(normalizeSnapshotData({ ...snapshot, fxReference: { ...snapshot.fxReference, asOf: '2026-04-30' } }), null);
})();

(() => {
  const validSnapshot = {
    version: 2,
    publishedAt: '2026-05-11T08:42:00.424Z',
    snapshotMonth: '2026-05',
    optimizableInvestmentsCLP: 1_500_000_000,
    fxReference: {
      clpUsd: 891,
      clpEur: 1_025,
      usdEur: 1.16,
      ufClp: 39_500,
      source: 'closure_fx_metadata',
      sourceId: 'closure-2026-05',
      asOf: '2026-05-31',
      validationStatus: 'valid',
      schemaVersion: 1,
      rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
      rateSource: { usd: 'BCCh', eur: 'BCCh', uf: 'SII' },
    },
  } as const;

  assert.deepEqual(resolvePublishedSnapshotData(undefined), { status: 'missing' });
  assert.deepEqual(
    resolvePublishedSnapshotData({ optimizableInvestmentsCLP: 1 }),
    { status: 'invalid', reason: 'missing_snapshot_month' },
  );
  assert.deepEqual(
    resolvePublishedSnapshotData({
      ...validSnapshot,
      fxReference: { clpUsd: 891 },
    } as unknown as Parameters<typeof resolvePublishedSnapshotData>[0]),
    { status: 'invalid', reason: 'invalid_canonical_fx' },
  );
  const resolved = resolvePublishedSnapshotData(validSnapshot);
  assert.equal(resolved.status, 'valid');
  if (resolved.status === 'valid') {
    assert.equal(resolved.snapshot.snapshotMonth, '2026-05');
    assert.equal(resolved.snapshot.fxReference?.source, 'closure_fx_metadata');
  }
})();

console.log('optimizableSnapshot tests passed');
