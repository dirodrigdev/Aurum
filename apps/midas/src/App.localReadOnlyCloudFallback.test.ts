import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
const settingsSource = readFileSync(join(process.cwd(), 'src', 'components', 'SettingsPage.tsx'), 'utf8');

assert.match(
  appSource,
  /const shouldBlockForAuthGate = authGateStatus\.isBlocking && !localReadOnlyCloudFallbackEnabled;/,
  'App must keep production auth gate strict while allowing localhost read-only fallback',
);

assert.match(
  appSource,
  /if \(localReadOnlyCloudFallbackEnabled\) return;/,
  'App must block productive cloud config persistence during local read-only fallback',
);

assert.match(
  appSource,
  /Modo local de revisión/,
  'App must show a visible local read-only fallback banner',
);

assert.match(
  appSource,
  /QA visual: los montos pueden no coincidir con Aurum productivo/,
  'App must explain that local read-only fallback is degraded QA mode',
);

assert.match(
  settingsSource,
  /disabled=\{localReadOnlyMode\.enabled\}/,
  'SettingsPage must disable mutating actions during local read-only fallback',
);

console.log('App local read-only fallback source tests passed');
