import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

assert(!appSource.includes("source: 'seed_legacy_global'"));
assert(!appSource.includes("source: 'seed_local_cache_initial'"));
assert(!appSource.includes("diagnosticsLabel: 'cloud/seed-legacy'"));
assert(!appSource.includes("diagnosticsLabel: 'cloud/seed-local-cache'"));

assert.match(
  appSource,
  /if \(!loaded\.ok\) \{[\s\S]*?setCloudSimulationHydrated\(false\);[\s\S]*?setSimulationConfigSource\(loaded\.reason === 'active_not_found' \? 'fallback' : 'local_cache'\);[\s\S]*?setSimulationConfigHydrationStatus\(loaded\.reason === 'active_not_found' \? 'missing' : 'error'\);/,
  'missing simulationActiveV1 must stay in safe fallback/read-only state without seeding cloud automatically',
);

assert.match(
  appSource,
  /const canonicalBaseParamsCurrent = stripManualAdjustmentImpactFromParams\(\s*baseParamsCurrent,\s*manualAdjustmentImpact,\s*\);[\s\S]*?const canonicalCurrentSimParams = stripManualAdjustmentImpactFromParams\(\s*currentSimParams,\s*manualAdjustmentImpact,\s*\);[\s\S]*?const manualImpact = EMPTY_MANUAL_ADJUSTMENT_IMPACT;/,
  'canonical simulation params must strip local manual adjustments before rebuilding the comparable M8 input',
);

assert.match(
  appSource,
  /const capitalAdjustmentsSource: SourceStatus = engineFingerprintDiagnostics\.manualLocalAdjustmentsAffectEngine\s*\?\s*'error'\s*:\s*hasManualAdjustments\s*\?\s*'local'\s*:\s*'canonical';/,
  'local manual adjustments should surface as a review/local source unless they still contaminate the canonical input',
);

console.log('App canonical sources tests passed');
