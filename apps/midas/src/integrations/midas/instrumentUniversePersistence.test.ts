import assert from 'node:assert/strict';
import {
  getUserScopedInstrumentUniversePath,
  hydrateInstrumentUniverseCacheFromFirestoreWithTimeout,
  INSTRUMENT_UNIVERSE_READ_TIMEOUT_MS,
  resolveInstrumentUniverseAccess,
} from './instrumentUniversePersistence';

{
  const uid = 'uid-123';
  assert.equal(
    getUserScopedInstrumentUniversePath(uid),
    'users/uid-123/midas_config/instrumentUniverseV1',
    'must build user-scoped path for instrument universe',
  );
}

{
  const resolved = resolveInstrumentUniverseAccess({
    configured: true,
    uid: 'abc',
    isAnonymous: false,
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.path, 'users/abc/midas_config/instrumentUniverseV1');
  }
}

{
  const resolved = resolveInstrumentUniverseAccess({
    configured: true,
    uid: null,
    isAnonymous: false,
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reason, 'auth_required');
}

{
  const resolved = resolveInstrumentUniverseAccess({
    configured: true,
    uid: 'anon-user',
    isAnonymous: true,
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reason, 'auth_required');
}

{
  const resolved = resolveInstrumentUniverseAccess({
    configured: false,
    uid: 'abc',
    isAnonymous: false,
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reason, 'firestore_not_configured');
}

(async () => {
  const timeoutResult = await hydrateInstrumentUniverseCacheFromFirestoreWithTimeout({
    timeoutMs: 5,
    load: () => new Promise(() => {}),
  });
  assert.equal(timeoutResult.ok, false);
  if (!timeoutResult.ok) assert.equal(timeoutResult.reason, 'instrument_universe_timeout');

  const missingResult = await hydrateInstrumentUniverseCacheFromFirestoreWithTimeout({
    timeoutMs: INSTRUMENT_UNIVERSE_READ_TIMEOUT_MS,
    load: async () => ({ ok: false, reason: 'active_not_found' }),
  });
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.equal(missingResult.reason, 'active_not_found');

  const errorResult = await hydrateInstrumentUniverseCacheFromFirestoreWithTimeout({
    timeoutMs: INSTRUMENT_UNIVERSE_READ_TIMEOUT_MS,
    load: async () => ({ ok: false, reason: 'permission-denied' }),
  });
  assert.equal(errorResult.ok, false);
  if (!errorResult.ok) assert.equal(errorResult.reason, 'permission-denied');

  console.log('instrumentUniversePersistence tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
