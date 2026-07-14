import { loadAppConfig } from '../firebase/app-config.mjs';
import { cleanArtifacts } from './artifacts.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Uso: node clean-app-e2e.mjs <configuración-e2e>.');

await cleanArtifacts(await loadAppConfig(configPath));
