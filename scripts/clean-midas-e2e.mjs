import { rm } from 'node:fs/promises';

await Promise.all([
  rm('.playwright/midas-e2e', { recursive: true, force: true }),
  rm('.firebase/midas-e2e', { recursive: true, force: true }),
]);

console.log('Artefactos E2E locales de MIDAS eliminados.');
