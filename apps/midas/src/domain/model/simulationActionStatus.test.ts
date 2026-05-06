import assert from 'node:assert/strict';
import { buildSimulationActionStatus } from './simulationActionStatus';
import type { M8InputFingerprint } from './m8InputFingerprint';

const baseFingerprint: M8InputFingerprint = {
  hash: 'abc123',
  normalizedInput: {},
  sources: {
    aurumSnapshot: { source: 'cloud' },
    instrumentUniverse: { source: 'cloud' },
    simulationParams: { source: 'cloud' },
    spendingPhases: { source: 'cloud' },
    fx: { source: 'cloud' },
  },
  warnings: [],
  createdAt: new Date().toISOString(),
};

(() => {
  const status = buildSimulationActionStatus({
    cloudHydrationReady: true,
    simulationConfigSource: 'cloud',
    universeSourceOrigin: 'firestore',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'ok');
  assert.equal(status.canUseForDecision, true);
})();

(() => {
  const status = buildSimulationActionStatus({
    cloudHydrationReady: false,
    simulationConfigSource: 'local_cache',
    universeSourceOrigin: 'cache-local',
    aurumIntegrationStatus: 'refreshing',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: { ...baseFingerprint, warnings: ['Hydratación cloud incompleta'] },
  });
  assert.equal(status.level, 'provisional');
})();

(() => {
  const status = buildSimulationActionStatus({
    cloudHydrationReady: true,
    simulationConfigSource: 'cloud',
    universeSourceOrigin: 'none',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: false,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'blocked');
  assert.ok(status.actionItems.length <= 3);
})();

(() => {
  const status = buildSimulationActionStatus({
    cloudHydrationReady: true,
    simulationConfigSource: 'local_cache',
    universeSourceOrigin: 'cache-local',
    aurumIntegrationStatus: 'available',
    hasValidSpendingPhases: true,
    hasValidCapital: true,
    hasValidUniverseMix: true,
    fingerprint: baseFingerprint,
  });
  assert.equal(status.level, 'review');
})();

console.log('simulationActionStatus tests passed');
