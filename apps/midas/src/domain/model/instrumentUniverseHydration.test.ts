import assert from 'node:assert/strict';
import {
  isInstrumentUniverseReadStatusTerminal,
  shouldStartInstrumentUniverseHydration,
} from './instrumentUniverseHydration';

assert.equal(isInstrumentUniverseReadStatusTerminal('loading'), false);
assert.equal(isInstrumentUniverseReadStatusTerminal('loaded'), true);
assert.equal(isInstrumentUniverseReadStatusTerminal('missing'), true);
assert.equal(isInstrumentUniverseReadStatusTerminal('timeout'), true);
assert.equal(isInstrumentUniverseReadStatusTerminal('error'), true);

assert.equal(
  shouldStartInstrumentUniverseHydration({
    hydrationKey: 'uid:123',
    inFlightKey: null,
    lastSettledKey: 'uid:123',
    readStatus: 'loaded',
  }),
  false,
  'must not relaunch once the same hydration key is already loaded',
);

assert.equal(
  shouldStartInstrumentUniverseHydration({
    hydrationKey: 'uid:123',
    inFlightKey: 'uid:123',
    lastSettledKey: null,
    readStatus: 'loading',
  }),
  false,
  'must not relaunch while the same hydration key is already in flight',
);

assert.equal(
  shouldStartInstrumentUniverseHydration({
    hydrationKey: 'uid:123',
    inFlightKey: null,
    lastSettledKey: 'uid:123',
    readStatus: 'timeout',
  }),
  false,
  'must keep timeout terminal for the same hydration key until there is an explicit retry',
);

assert.equal(
  shouldStartInstrumentUniverseHydration({
    hydrationKey: 'uid:456',
    inFlightKey: null,
    lastSettledKey: 'uid:123',
    readStatus: 'loaded',
  }),
  true,
  'must allow a new read when the hydration key changes',
);

assert.equal(
  shouldStartInstrumentUniverseHydration({
    hydrationKey: 'uid:123',
    force: true,
    inFlightKey: 'uid:123',
    lastSettledKey: 'uid:123',
    readStatus: 'error',
  }),
  true,
  'must allow explicit retries or external refreshes on the same hydration key',
);

console.log('instrumentUniverseHydration tests passed');
