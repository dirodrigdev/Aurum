import assert from 'node:assert/strict';
import {
  buildInstrumentUniverseSnapshotMetadata,
  clearInstrumentUniverseSnapshot,
  clearLastFailedInstrumentUniverseImport,
  loadInstrumentUniverseSnapshot,
  loadInstrumentUniverseSnapshotMetadata,
  loadLastFailedInstrumentUniverseImport,
  saveInstrumentUniverseSnapshotWithMetadata,
  saveLastFailedInstrumentUniverseImport,
  validateInstrumentUniverseJson,
} from './instrumentUniverse';
import { deriveInstrumentUniverseDistributionWeights } from './model/officialDistribution';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
const test = (name: string, fn: TestFn) => tests.push({ name, fn });

const makeLocalStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
};

const withWindow = (fn: () => void) => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: makeLocalStorage() };
  try {
    fn();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
};

const VALID_UNIVERSE = JSON.stringify({
  instruments: [
    {
      instrument_master: {
        instrument_id: 'u-1',
        name: 'Universe Equity',
        vehicle_type: 'fund',
        currency: 'CLP',
        is_captive: false,
        is_sellable: true,
      },
      instrument_mix_profile: {
        current_mix_used: { rv: 0.8, rf: 0.2, cash: 0, other: 0 },
        current_exposure_used: { global: 0.5, local: 0.5 },
        historical_used_range: { rv: [0.7, 0.9], rf: [0.1, 0.3], cash: [0, 0], other: [0, 0] },
      },
      portfolio_position: {
        amount_clp: 100,
        weight_portfolio: 1,
        role: 'core',
      },
      optimizer_metadata: {
        structural_mix_driver: 'profile',
        estimated_mix_impact_points: 1,
        replaceability_score: 1,
        replacement_constraint: 'same_currency',
      },
    },
  ],
});

test('valid load persists and reloads last valid snapshot', () => {
  withWindow(() => {
    const validation = validateInstrumentUniverseJson(VALID_UNIVERSE);
    assert.equal(validation.ok, true);
    const metadata = buildInstrumentUniverseSnapshotMetadata(validation.snapshot!, validation, {
      fileName: 'universe.json',
      source: 'settings_upload',
    });
    saveInstrumentUniverseSnapshotWithMetadata(validation.snapshot!, metadata);
    assert.ok(loadInstrumentUniverseSnapshot());
    assert.equal(loadInstrumentUniverseSnapshotMetadata()?.fileName, 'universe.json');
  });
});

test('empty load is rejected and does not replace last valid snapshot', () => {
  withWindow(() => {
    const validation = validateInstrumentUniverseJson(VALID_UNIVERSE);
    const metadata = buildInstrumentUniverseSnapshotMetadata(validation.snapshot!, validation);
    saveInstrumentUniverseSnapshotWithMetadata(validation.snapshot!, metadata);
    const failed = validateInstrumentUniverseJson('');
    assert.equal(failed.ok, false);
    assert.ok(loadInstrumentUniverseSnapshot());
  });
});

test('instruments empty is rejected', () => {
  const validation = validateInstrumentUniverseJson(JSON.stringify({ instruments: [] }));
  assert.equal(validation.ok, false);
});

test('zero weights and zero amounts are rejected', () => {
  const validation = validateInstrumentUniverseJson(
    JSON.stringify({
      instruments: [
        {
          instrument_master: { instrument_id: 'u-1', name: 'Bad', vehicle_type: 'fund', currency: 'CLP', is_captive: false, is_sellable: true },
          instrument_mix_profile: {
            current_mix_used: { rv: 0.5, rf: 0.5, cash: 0, other: 0 },
            historical_used_range: { rv: [0.4, 0.6], rf: [0.4, 0.6], cash: [0, 0], other: [0, 0] },
          },
          portfolio_position: { amount_clp: 0, weight_portfolio: 0, role: 'core' },
          optimizer_metadata: { structural_mix_driver: 'profile', estimated_mix_impact_points: 1, replaceability_score: 1, replacement_constraint: 'same_currency' },
        },
      ],
    }),
  );
  assert.equal(validation.ok, false);
});

test('failed import metadata is stored separately', () => {
  withWindow(() => {
    saveLastFailedInstrumentUniverseImport({
      attemptedAt: '2026-05-03T10:00:00.000Z',
      fileName: 'bad.json',
      source: 'settings_upload',
      errors: ['bad'],
      warnings: [],
    });
    assert.equal(loadLastFailedInstrumentUniverseImport()?.fileName, 'bad.json');
    clearLastFailedInstrumentUniverseImport();
    assert.equal(loadLastFailedInstrumentUniverseImport(), null);
  });
});

test('failed validation does not force mix derivation to zero when last valid snapshot remains', () => {
  withWindow(() => {
    const validation = validateInstrumentUniverseJson(VALID_UNIVERSE);
    const metadata = buildInstrumentUniverseSnapshotMetadata(validation.snapshot!, validation);
    saveInstrumentUniverseSnapshotWithMetadata(validation.snapshot!, metadata);
    const failed = validateInstrumentUniverseJson('');
    assert.equal(failed.ok, false);
    const derived = deriveInstrumentUniverseDistributionWeights({
      snapshot: loadInstrumentUniverseSnapshot(),
      returns: { rfGlobalAnnual: 0.03, rfChileUFAnnual: 0.02 },
    });
    assert.ok(derived);
  });
});

test('clear removes active snapshot and metadata together', () => {
  withWindow(() => {
    const validation = validateInstrumentUniverseJson(VALID_UNIVERSE);
    const metadata = buildInstrumentUniverseSnapshotMetadata(validation.snapshot!, validation);
    saveInstrumentUniverseSnapshotWithMetadata(validation.snapshot!, metadata);
    clearInstrumentUniverseSnapshot();
    assert.equal(loadInstrumentUniverseSnapshot(), null);
    assert.equal(loadInstrumentUniverseSnapshotMetadata(), null);
  });
});

const failures: string[] = [];
for (const entry of tests) {
  try {
    entry.fn();
    console.log(`ok: ${entry.name}`);
  } catch (error) {
    failures.push(entry.name);
    console.error(`fail: ${entry.name}`);
    console.error(error);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} test(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
