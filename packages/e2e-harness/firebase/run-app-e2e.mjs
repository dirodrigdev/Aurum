import { loadAppConfig } from './app-config.mjs';
import { assertPortsAvailable, assertPortsReleased } from '../process/ports.mjs';
import { removeEmulatorHubLocator, runFirebaseCli } from '../runtime/firebase-cli.mjs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Uso: node run-app-e2e.mjs <configuración-e2e>.');

const config = await loadAppConfig(configPath);
await assertPortsAvailable(config);
const command = [config.seedCommand, config.playwrightCommand, config.verifyCommand].filter(Boolean).join(' && ');
let exitCode = 1;
try {
  const firebaseArguments = [
    ...(config.usesDefaultFirebaseConfig ? [] : ['--config', config.firebaseConfigPath]),
    'emulators:exec',
    '--only', 'auth,firestore',
    '--project', config.projectId,
    command,
  ];
  exitCode = await runFirebaseCli(firebaseArguments, config.repositoryDir);
} finally {
  removeEmulatorHubLocator(config.projectId);
  try {
    await assertPortsReleased(config);
  } catch (error) {
    if (exitCode === 0) throw error;
    console.error(error instanceof Error ? error.message : String(error));
  }
}
process.exitCode = exitCode;
