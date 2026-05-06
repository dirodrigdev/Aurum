import assert from 'node:assert/strict';
import { buildM8InputFingerprint } from './m8InputFingerprint';
import type { M8InputFingerprintInput } from './m8InputFingerprint';
import { DEFAULT_PARAMETERS } from './defaults';
import type { ModelParameters } from './types';

const clone = (value: ModelParameters): ModelParameters => JSON.parse(JSON.stringify(value)) as ModelParameters;

const baseInput = (): M8InputFingerprintInput => {
  const params = clone(DEFAULT_PARAMETERS);
  params.simulation.nSim = 3000;
  params.simulation.seed = 42;
  params.spendingPhases = [
    { durationMonths: 120, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 4_000_000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 3_000_000, currency: 'CLP' },
  ];
  return {
    params,
    riskCapitalEnabled: true,
    riskCapitalEffective: true,
    weightsSourceMode: 'instrument-universe',
    universeSourceOrigin: 'firestore' as const,
    aurumSnapshotLabel: '2026-04',
    aurumSnapshotPublishedAt: '2026-05-07T10:00:00.000Z',
    aurumSnapshotSignature: 'snap-abc',
    simulationConfigSource: 'cloud',
    simulationConfigSavedAt: '2026-05-07T10:01:00.000Z',
    simulationConfigHash: 'cfg-abc',
    instrumentUniverseSavedAt: '2026-05-07T10:02:00.000Z',
    instrumentUniverseHash: 'u-abc',
    hydratedCloudSources: true,
  };
};

(() => {
  const first = buildM8InputFingerprint(baseInput());
  const second = buildM8InputFingerprint(baseInput());
  assert.equal(first.hash, second.hash, 'same input must produce same hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.spendingPhases[0].amountReal = 6_200_000;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.hash, changed.hash, 'changing F1 must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.capitalInitial = Number(input.params.capitalInitial) + 10_000_000;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.hash, changed.hash, 'changing capital must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.simulation.seed = 84;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.hash, changed.hash, 'changing seed must change hash');
})();

(() => {
  const input = baseInput();
  input.simulationConfigSource = 'local_cache';
  input.hydratedCloudSources = false;
  const fingerprint = buildM8InputFingerprint(input);
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('Hydratación cloud incompleta')));
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('simulación no vienen desde cloud')));
})();

console.log('m8InputFingerprint tests passed');
