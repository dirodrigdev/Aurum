import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

assert.match(
  appSource,
  /const startRecalculation = useCallback\(\(\s*cause: RecalcCause,\s*run: \(\) => ModelParameters,[\s\S]*?const paramsBaseForGate = run\(\);[\s\S]*?const \{ readiness \} = evaluateCanonicalInputReadinessForParams\(paramsBaseForGate, readinessOverrides\);[\s\S]*?if \(!readiness\.ready\) \{[\s\S]*?applyBlockedSimulationRunState\(cause, readiness\.blockedReason\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?beginRecalculationVisual\(cause\);/,
  'startRecalculation must block before boot/init or any worker run when canonical input is not ready',
);

assert.match(
  appSource,
  /const gate = evaluateSimulationRunGate\(\{[\s\S]*?authResolved,[\s\S]*?cloudUniverseReadStatus,[\s\S]*?universeSourceOrigin,[\s\S]*?\}\);/,
  'App auto-run gate must include auth and instrument universe hydration state',
);

assert.match(
  appSource,
  /if \(gate\.status === 'blocked'\) \{[\s\S]*?applyBlockedSimulationRunState\(simResult \? 'params-change' : 'boot-init', gate\.blockedReason\);[\s\S]*?return;[\s\S]*?\}/,
  'boot-init must flow through the blocked canonical gate branch before any recalculation starts',
);

assert.match(
  appSource,
  /canonicalInputReady: canonicalInputReadiness\.ready,[\s\S]*?canonicalInputPendingSource: canonicalInputBlockDisplay\?\.pendingSource \?\? null,[\s\S]*?canonicalInputStatusMessage: canonicalInputBlockDisplay\?\.explanation \?\? null,/,
  'runtime diagnostics must expose canonical readiness, pending source, and user-facing status message',
);

assert.match(
  appSource,
  /<OptimizationLightPageLazy[\s\S]*?canonicalInputReady=\{canonicalInputReadiness\.ready\}[\s\S]*?canonicalInputBlockedReason=\{canonicalInputBlockedReason\}[\s\S]*?m8InputFingerprint=\{m8InputFingerprint\}/,
  'optimizer must receive canonical readiness and the applied M8 fingerprint',
);

console.log('App canonical gate tests passed');
