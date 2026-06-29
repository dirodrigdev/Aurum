import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

assert.match(
  appSource,
  /const instrumentUniverseHydrationKey = useMemo\(\(\) => \{[\s\S]*?getUserScopedInstrumentUniversePath\(authUser\.uid\)[\s\S]*?\}, \[authResolved, authUser\?\.uid, isCanonicalUserSession\]\);/,
  'App must derive a stable instrument universe hydration key from the canonical auth/path scope',
);

assert.match(
  appSource,
  /const runInstrumentUniverseHydration = useCallback\(\(options\?: \{ force\?: boolean \}\) => \{[\s\S]*?shouldStartInstrumentUniverseHydration\(\{[\s\S]*?hydrationKey: instrumentUniverseHydrationKey,[\s\S]*?inFlightKey: instrumentUniverseHydrationInFlightKeyRef\.current,[\s\S]*?lastSettledKey: instrumentUniverseHydrationLastSettledKeyRef\.current,[\s\S]*?readStatus: cloudUniverseReadStatusRef\.current,[\s\S]*?\}\);/,
  'App must guard hydration re-entry with stable-key, in-flight, and terminal-state checks',
);

assert.match(
  appSource,
  /const requestId = instrumentUniverseHydrationRequestIdRef\.current \+ 1;[\s\S]*?if \(cancelled \|\| requestId !== instrumentUniverseHydrationRequestIdRef\.current\) return;[\s\S]*?if \(cancelled \|\| requestId !== instrumentUniverseHydrationRequestIdRef\.current\) return;/,
  'App must ignore stale hydration resolutions so only the latest read can write terminal state',
);

assert.match(
  appSource,
  /useEffect\(\(\) => runInstrumentUniverseHydration\(\), \[instrumentUniverseHydrationKey, runInstrumentUniverseHydration\]\);/,
  'boot hydration must run through the guarded instrument universe hydrator',
);

assert.match(
  appSource,
  /runInstrumentUniverseHydration\(\{ force: true \}\);/,
  'explicit instrument universe refreshes must go through the same hydrator with force=true',
);

assert.doesNotMatch(
  appSource,
  /window\.dispatchEvent\(new CustomEvent\('midas:instrument-universe-updated'\)\);/,
  'App must not self-dispatch instrument-universe-updated after its own hydration, or it will relaunch the same read',
);

console.log('App instrument universe hydration tests passed');
