import { loadAppConfig } from './app-config.mjs';
import { assertPortsAvailable } from '../process/ports.mjs';
import { runFirebaseCli } from '../runtime/firebase-cli.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Uso: node start-app-emulators.mjs <configuración-e2e>.');

const config = await loadAppConfig(configPath);
await assertPortsAvailable(config);
const firebaseArguments = [
  ...(config.usesDefaultFirebaseConfig ? [] : ['--config', config.firebaseConfigPath]),
  'emulators:start',
  '--only', 'auth,firestore',
  '--project', config.projectId,
];
process.exitCode = runFirebaseCli(firebaseArguments, config.repositoryDir);
