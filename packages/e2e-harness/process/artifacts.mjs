import { rm } from 'node:fs/promises';

export const cleanArtifacts = async (config) => {
  await Promise.all(config.artifactDirectories.map((path) => rm(path, { recursive: true, force: true })));
  console.log(`Artefactos E2E locales de ${config.appName} eliminados.`);
};
