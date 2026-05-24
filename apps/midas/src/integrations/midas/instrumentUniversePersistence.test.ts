import assert from 'node:assert/strict';
import {
  getUserScopedInstrumentUniversePath,
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

