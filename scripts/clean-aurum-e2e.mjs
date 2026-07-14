import { rm } from 'node:fs/promises';

await Promise.all([
  rm('.playwright/aurum-e2e', { recursive: true, force: true }),
  rm('.firebase/aurum-e2e', { recursive: true, force: true }),
]);

console.log('Artefactos E2E locales eliminados.');
