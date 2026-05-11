import assert from 'node:assert/strict';
import { resolveCanonicalInstrumentUniverseState } from './canonicalInstrumentUniverse';
import { DEFAULT_PARAMETERS } from './defaults';
import type { InstrumentUniverseSnapshot, InstrumentUniverseSnapshotMetadata } from '../instrumentUniverse';

const makeUniverse = (mix: { rv: number; rf: number; global: number; local: number }, savedAt = '2026-05-11T00:00:00.000Z'): InstrumentUniverseSnapshot => {
  const rawJson = JSON.stringify({
    instruments: [
      {
        instrument_master: {
          instrument_id: `u-${mix.rv}-${mix.global}`,
          name: 'Universe',
          vehicle_type: 'fund',
          currency: 'CLP',
          is_captive: false,
          is_sellable: true,
        },
        instrument_mix_profile: {
          current_mix_used: { rv: mix.rv, rf: mix.rf, cash: 0, other: 0 },
          current_exposure_used: { global: mix.global, local: mix.local },
          historical_used_range: {
            rv: [mix.rv, mix.rv],
            rf: [mix.rf, mix.rf],
            cash: [0, 0],
            other: [0, 0],
          },
        },
        portfolio_position: {
          amount_clp: 1,
          weight_portfolio: 1,
          role: 'core',
        },
        optimizer_metadata: {
          structural_mix_driver: 'test',
          estimated_mix_impact_points: 0,
          replaceability_score: 1,
          replacement_constraint: 'same_currency',
        },
      },
    ],
  });
  return {
    version: 1,
    savedAt,
    rawJson,
    instruments: [
      {
        instrumentId: 'u-1',
        name: 'Universe',
        vehicleType: 'fund',
        currency: 'CLP',
        taxWrapper: null,
        isCaptive: false,
        isSellable: true,
        currentMixUsed: { rv: mix.rv, rf: mix.rf, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: {
          rv: { min: mix.rv, max: mix.rv },
          rf: { min: mix.rf, max: mix.rf },
          cash: { min: 0, max: 0 },
          other: { min: 0, max: 0 },
        },
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: mix.global, local: mix.local },
        amountClp: 1,
        amountNative: null,
        amountNativeCurrency: null,
        fxToClpUsed: null,
        weightPortfolio: 1,
        role: 'core',
        structuralMixDriver: 'test',
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: 'same_currency',
        sameCurrencyCandidates: [],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: [],
        decisionEligible: true,
        missingCriticalFields: [],
        warnings: [],
        usable: true,
      },
    ],
    optimizerMetadata: null,
    portfolioSummary: null,
    methodology: null,
  };
};

const makeMeta = (checksum: string): InstrumentUniverseSnapshotMetadata => ({
  loadedAt: '2026-05-11T00:00:00.000Z',
  importedAt: '2026-05-11T00:00:00.000Z',
  fileName: 'test.json',
  source: 'test',
  instrumentsCount: 1,
  validInstrumentsCount: 1,
  totalWeightPortfolio: 1,
  totalAmountClp: 1,
  hasUsableAmounts: true,
  hasUsableWeights: true,
  hasUsableMix: true,
  warnings: [],
  amountSource: 'mixed',
  checksum,
  schemaVersion: 1,
  lastValid: true,
});

(() => {
  const cloudSnapshot = makeUniverse({ rv: 0.59, rf: 0.41, global: 0.68, local: 0.32 });
  const localSnapshot = makeUniverse({ rv: 0.62, rf: 0.38, global: 0.48, local: 0.52 });
  const resolved = resolveCanonicalInstrumentUniverseState({
    cloudSnapshot,
    cloudMetadata: makeMeta('cloud-hash'),
    localCacheSnapshot: localSnapshot,
    localCacheMetadata: makeMeta('local-hash'),
    instrumentBaseSnapshot: null,
    returns: DEFAULT_PARAMETERS.returns,
    defaultWeights: DEFAULT_PARAMETERS.weights,
  });
  assert.equal(resolved.universeSourceOrigin, 'firestore');
  assert.equal(resolved.instrumentUniverseDiagnostics.effectiveSource, 'cloud');
  assert.equal(resolved.instrumentUniverseDiagnostics.localCacheAccepted, false);
})();

(() => {
  const localSnapshot = makeUniverse({ rv: 0.62, rf: 0.38, global: 0.48, local: 0.52 });
  const resolved = resolveCanonicalInstrumentUniverseState({
    cloudSnapshot: null,
    cloudMetadata: null,
    localCacheSnapshot: localSnapshot,
    localCacheMetadata: makeMeta('local-hash'),
    instrumentBaseSnapshot: null,
    returns: DEFAULT_PARAMETERS.returns,
    defaultWeights: DEFAULT_PARAMETERS.weights,
  });
  assert.equal(resolved.universeSourceOrigin, 'bundled');
  assert.equal(resolved.instrumentUniverseDiagnostics.effectiveSource, 'bundled');
  assert.equal(resolved.instrumentUniverseDiagnostics.localCacheAccepted, false);
})();

(() => {
  const resolved = resolveCanonicalInstrumentUniverseState({
    cloudSnapshot: null,
    cloudMetadata: null,
    localCacheSnapshot: null,
    localCacheMetadata: null,
    instrumentBaseSnapshot: null,
    returns: DEFAULT_PARAMETERS.returns,
    defaultWeights: DEFAULT_PARAMETERS.weights,
  });
  assert.equal(resolved.universeSourceOrigin, 'bundled');
  assert.equal(resolved.instrumentUniverseDiagnostics.effectiveSource, 'bundled');
})();

console.log('canonicalInstrumentUniverse tests passed');
