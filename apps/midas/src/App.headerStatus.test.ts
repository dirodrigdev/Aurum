import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

assert.match(
  appSource,
  /<Header\s+statusColor=\{headerStatusColor\}[\s\S]*?confidenceLabel=\{headerConfidenceLabel\}/,
  'the header indicator must use result validity, not a quality-of-life KPI',
);

assert.doesNotMatch(
  appSource,
  /headerDisplayStatusColor|headerQualityLabel|Calidad crítica|Calidad frágil/,
  'quality-of-life labels must remain in their dedicated dashboard block',
);

assert.match(
  appSource,
  /const focusDataTrust = useCallback\(\(\) => \{[\s\S]*?window\.dispatchEvent\(new Event\('midas:focus-data-trust'\)\)/,
  'a non-valid header status must route the user to the single data-trust diagnosis surface',
);

assert.match(
  appSource,
  /disabled=\{!canOpenDataTrust\}/,
  'a valid result header must not imply an outstanding data action',
);

console.log('App header status tests passed');
