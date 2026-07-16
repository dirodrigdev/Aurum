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
  /const \[activeTab, setActiveTab\] = useState<TabId>\(resolveInitialProductTab\);/,
  'App must resolve the initial page without losing the direct Dashboard route',
);

assert.match(
  appSource,
  /SimulationPage,[\s\S]*SimulationOverrides,[\s\S]*SimulationPreset,[\s\S]*from '\.\/components\/SimulationPage';/,
  'SimulationPage must stay eager as the critical home page',
);

for (const lazyPage of [
  'DashboardPageLazy',
  'EcosystemPageLazy',
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
  /if \(hashRoute === 'dashboard'\) return 'dashboard';[\s\S]*if \(hashRoute === 'ecosystem'\) return 'ecosystem';[\s\S]*return 'sim';/,
  'Direct Dashboard and Ecosystem routes must resolve safely and default to Simulación',
);

assert.match(appSource, /`Sostenibilidad \$\{formatSuccessPct\(headerSuccess40\)\}`/, 'Header must describe no-ruin probability as sustainability');
assert.doesNotMatch(appSource, /`Éxito \$\{formatSuccessPct\(headerSuccess40\)\}`/, 'Header must not present sustainability as integral success');

assert.match(
  appSource,
  /productActiveTab === 'dashboard'[\s\S]*No se pudo completar la lectura[\s\S]*Revisa Simulación para consultar el diagnóstico técnico/,
  'Dashboard must replace raw runtime errors with a privacy-safe message',
);

assert.match(
  appSource,
  /<SectionSuspense>/,
  'Lazy tabs must render through the shared section Suspense boundary',
);

console.log('App lazy pages tests passed');
