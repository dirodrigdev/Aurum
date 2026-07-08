import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

assert.match(
  appSource,
  /import React, \{ Suspense,/,
  'App must use Suspense to wrap lazy-loaded sections',
);

assert.match(
  appSource,
  /const \[activeTab, setActiveTab\] = useState<TabId>\('sim'\);/,
  'App must keep Simulación as the initial page',
);

assert.match(
  appSource,
  /import \{ SimulationPage, SimulationOverrides, SimulationPreset \} from '\.\/components\/SimulationPage';/,
  'SimulationPage must stay eager as the critical home page',
);

for (const lazyPage of [
  'AssistedSimulationPageLazy',
  'ScenarioLabPageLazy',
  'SensitivityPageLazy',
  'BucketLabPageLazy',
  'SettingsPageLazy',
  'OptimizationLightPageLazy',
]) {
  assert.match(
    appSource,
    new RegExp(`const ${lazyPage} = React\\.lazy\\(`),
    `${lazyPage} must be lazy-loaded`,
  );
}

assert.match(
  appSource,
  /<SectionSuspense>/,
  'Lazy tabs must render through the shared section Suspense boundary',
);

console.log('App lazy pages tests passed');
