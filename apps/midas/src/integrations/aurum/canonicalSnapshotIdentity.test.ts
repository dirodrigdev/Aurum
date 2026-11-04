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
assert.equal(
  getCanonicalSnapshotEconomicSignature({
    ...snapshot,
    fxReference: { ...fxReference, asOf: '2026-05-30' },
  }),
  baseline,
  'provenance alone must not alter M8 economic inputs',
);



for (const patch of [
  { nonOptimizable: { banksCLP: 10 } },
  { nonOptimizable: { realEstate: { propertyValueCLP: 10 } } },
  { nonOptimizable: { realEstate: { mortgageDebtOutstandingCLP: 10 } } },
  { nonOptimizable: { realEstate: { ufSnapshotCLP: 40000 } } },
  { riskCapital: { totalCLP: 10 } },
]) assert.notEqual(getCanonicalSnapshotEconomicSignature({ ...snapshot, ...patch }), baseline);
for (const patch of [
  { snapshotMonth: '2026-06', snapshotLabel: 'Otra etiqueta' },
  { totalNetWorthCLP: snapshot.totalNetWorthCLP + 10 },
  { nonOptimizable: { nonMortgageDebtCLP: 10, usdLiquidity: 10 } },
  { nonOptimizable: { realEstate: { mortgageRate: .05, mortgageEndDate: '2040-01' } } },
]) assert.equal(getCanonicalSnapshotEconomicSignature({ ...snapshot, ...patch }), baseline);
assert.equal(getCanonicalSnapshotEconomicSignature({ ...snapshot,
  optimizableInvestmentsCLP: snapshot.optimizableInvestmentsCLP - 10,
  nonOptimizable: { banksCLP: 10 } }), baseline, 'compensated financial capital is unchanged');

assert.equal(getCanonicalSnapshotEconomicSignature({...snapshot,fxReference:{...fxReference,sourceId:'different-source',rateSource:{usd:'Other',eur:'Other',uf:'Other'}}}),baseline);
assert.equal(getCanonicalSnapshotEconomicSignature({...snapshot,nonOptimizable:{realEstate:{monthlyMortgagePaymentCLP:1000000}}}),baseline,'mortgage payment is already modeled through configured spending, not a second deduction');
assert.notEqual(getCanonicalSnapshotEconomicSignature({...snapshot,totalNetWorthCLP:snapshot.totalNetWorthCLP,nonOptimizable:{banksCLP:100,realEstate:{propertyValueCLP:200, mortgageDebtOutstandingCLP:100}},optimizableInvestmentsCLP:snapshot.optimizableInvestmentsCLP-100}),baseline,'compensated patrimonial changes must detect changed house inputs');
console.log('canonical snapshot identity: effective fields, compensated changes and ignored provenance passed');

const canonicalV1={...snapshot,version:1 as const};
assert.notEqual(getCanonicalSnapshotEconomicSignature(canonicalV1),getCanonicalSnapshotEconomicSignature({...canonicalV1,fxReference:{...fxReference,clpUsd:901}}),'canonical FX carried by legacy V1 still feeds M8');
