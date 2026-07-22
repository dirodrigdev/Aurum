import assert from 'node:assert/strict';
import { getCanonicalSnapshotEconomicSignature } from './canonicalSnapshotIdentity';
import type { AurumOptimizableInvestmentsSnapshotV2 } from './types';

const snapshot: AurumOptimizableInvestmentsSnapshotV2 = {
  version: 2,
  publishedAt: '2026-06-01T10:00:00.000Z',
  snapshotMonth: '2026-05',
  snapshotLabel: 'Cierre mayo 2026',
  currency: 'CLP',
  totalNetWorthCLP: 2_000_000_000,
  optimizableInvestmentsCLP: 1_500_000_000,
  fxReference: {
    clpUsd: 900,
    clpEur: 1_030,
    usdEur: 0.8738,
    ufClp: 39_000,
    source: 'closure_fx_metadata',
    sourceId: 'closure-2026-05',
    asOf: '2026-05-31',
    fetchedAt: '2026-06-01T09:00:00.000Z',
    lastSuccessfulRefreshAt: '2026-06-01T09:00:00.000Z',
    validationStatus: 'valid',
    schemaVersion: 1,
    rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
    rateSource: { usd: 'BCCh', eur: 'BCCh', uf: 'SII' },
  },
  source: { app: 'aurum', basis: 'latest_confirmed_closure' },
};

const baseline = getCanonicalSnapshotEconomicSignature(snapshot);
const fxReference = snapshot.fxReference!;
assert.equal(
  getCanonicalSnapshotEconomicSignature({ ...snapshot, publishedAt: '2026-07-01T10:00:00.000Z' }),
  baseline,
  'technical publication time must not alter economic identity',
);
assert.equal(
  getCanonicalSnapshotEconomicSignature({
    ...snapshot,
    fxReference: { ...fxReference, fetchedAt: '2026-07-01T10:00:00.000Z' },
  }),
  baseline,
  'technical refresh time must not alter economic identity',
);
assert.notEqual(
  getCanonicalSnapshotEconomicSignature({
    ...snapshot,
    fxReference: { ...fxReference, clpUsd: 901 },
  }),
  baseline,
  'effective FX must alter economic identity',
);
assert.notEqual(
  getCanonicalSnapshotEconomicSignature({
    ...snapshot,
    fxReference: { ...fxReference, asOf: '2026-05-30' },
  }),
  baseline,
  'economic asOf must alter economic identity',
);

console.log('canonical snapshot identity tests passed');
