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
  /const canonicalBaseParamsCurrent = stripManualAdjustmentImpactFromParams\(\s*baseParamsCurrent,\s*manualAdjustmentImpact,\s*\);[\s\S]*?const canonicalCurrentSimParams = stripManualAdjustmentImpactFromParams\(\s*currentSimParams,\s*manualAdjustmentImpact,\s*\);[\s\S]*?const manualImpact = options\?\.manualImpact \?\? manualAdjustmentImpact;/,
  'canonical simulation params must rebuild the comparable M8 input using the effective manual/future flow impact',
);

assert.match(
  appSource,
  /const capitalAdjustmentsSource: SourceStatus = hasManualAdjustments \? 'local' : 'canonical';/,
  'manual adjustments remain traceable in diagnostics, but no longer downgrade an evaluated scenario by themselves',
);

assert.match(
  appSource,
  /const commitManualCapitalAdjustments = useCallback\(\(next: ManualCapitalAdjustment\[]\) => \{[\s\S]*?const impact = computeManualAdjustmentImpact\(next\);[\s\S]*?const nextParams = buildCanonicalSimParams\(cleanBaseParams, cleanBaseParams, \{[\s\S]*?manualImpact: impact,[\s\S]*?\}\);[\s\S]*?startRecalculation\('ledger-commit', \(\) => base\);/,
  'manual capital commit must rebuild params with future flows and trigger a recalculation',
);

console.log('App canonical sources tests passed');
