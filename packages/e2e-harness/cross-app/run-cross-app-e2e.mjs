import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertPortsAvailable, assertPortsReleased } from '../process/ports.mjs';
import { loadAppConfig } from '../firebase/app-config.mjs';
import { removeEmulatorHubLocator, runFirebaseCli } from '../runtime/firebase-cli.mjs';

const aurumRepository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const gastappRepository = resolve(process.env.GASTAPP_REPO_DIR || '');
if (!process.env.GASTAPP_REPO_DIR || !statSync(gastappRepository, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('Define GASTAPP_REPO_DIR con el checkout aislado de GastApp.');
}
if (process.env.CI && !process.env.GASTAPP_REPO_DIR.startsWith('/')) {
  throw new Error('GASTAPP_REPO_DIR debe ser una ruta absoluta en CI.');
}

const evidenceRoot = process.env.CROSS_APP_E2E_ARTIFACT_DIR
  ? resolve(process.env.CROSS_APP_E2E_ARTIFACT_DIR)
  : mkdtempSync(join(tmpdir(), 'gastapp-aurum-midas-e2e-'));
const scenarioPath = join(evidenceRoot, 'scenario.json');

const stage = async ({ name, repositoryDir, configPath, command, appRepoDir, harnessDir }) => {
  process.env.E2E_APP_REPO_DIR = appRepoDir || repositoryDir;
  if (harnessDir) process.env.E2E_HARNESS_DIR = harnessDir;
  const config = await loadAppConfig(configPath);
  if (!config.projectId.endsWith('-e2e-local') || config.host !== '127.0.0.1') {
    throw new Error(`${name}: proyecto Firebase no local o host no loopback.`);
  }
  await assertPortsAvailable(config);
  const firebaseArguments = [
    ...(config.usesDefaultFirebaseConfig ? [] : ['--config', config.firebaseConfigPath]),
    'emulators:exec', '--only', 'auth,firestore', '--project', config.projectId, command,
  ];
  let exitCode = 1;
  try {
    console.info(`[cross-app] START ${name} (${config.projectId})`);
    exitCode = await runFirebaseCli(firebaseArguments, repositoryDir);
  } finally {
    removeEmulatorHubLocator(config.projectId);
    await assertPortsReleased(config);
  }
  if (exitCode !== 0) throw new Error(`${name} falló (exit ${exitCode}); evidencia: ${evidenceRoot}`);
  console.info(`[cross-app] PASS ${name}`);
};

const scenarioFromDisk = () => {
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  if (scenario.schemaVersion !== 'gastapp-aurum-midas-cross-app-synthetic-v1'
      || scenario.scenarioId !== 'cross-app-synthetic-2026-11-04'
      || !scenario.gastapp?.initialContract?.contractHash
      || !scenario.gastapp?.currentContract?.contractHash
      || scenario.gastapp?.partialMayCoverage?.coverage?.fromYmd !== '2023-05-12'
      || scenario.gastapp?.partialMayCoverage?.certification?.status !== 'open'
      || scenario.gastapp?.partialMayCoverage?.eligibleForAurumReturns !== false) {
    throw new Error('El handoff de GastApp no cumple el contrato transversal.');
  }
  return scenario;
};

await stage({
  name: 'GastApp: mutación, certificación y exportaciones',
  repositoryDir: gastappRepository,
  appRepoDir: gastappRepository,
  harnessDir: join(aurumRepository, 'packages/e2e-harness'),
  configPath: 'e2e/gastapp.e2e.config.mjs',
  command: `GASTAPP_E2E_RULES_PROFILE=spark npm run seed:e2e:gastapp && CROSS_APP_SCENARIO_PATH='${scenarioPath}' ./node_modules/.bin/playwright test -c playwright.e2e.config.ts --project desktop --grep 'cross-app synthetic source mutates'`,
});
scenarioFromDisk();

await stage({
  name: 'Aurum: revisión certificada, aviso, rentabilidad y handoff',
  repositoryDir: aurumRepository,
  configPath: 'e2e/apps/aurum.e2e.config.mjs',
  command: `npm run seed:e2e:aurum && CROSS_APP_SCENARIO_PATH='${scenarioPath}' ./node_modules/.bin/playwright test -c apps/aurum/playwright.authenticated.config.ts --grep 'cross-app shared scenario applies GastApp revision'`,
});
const aurumScenario = scenarioFromDisk();
if (aurumScenario.aurum?.sourceContractHash !== aurumScenario.gastapp.currentContract.contractHash
    || aurumScenario.aurum?.noticeSeenHash !== aurumScenario.aurum?.sourceContractHash) {
  throw new Error('Aurum no confirmó el contrato GastApp actual y su aviso compartido.');
}

await stage({
  name: 'MIDAS: publicación económica M8, idempotencia y ajustes',
  repositoryDir: aurumRepository,
  configPath: 'e2e/apps/midas.e2e.config.mjs',
  command: `npm run seed:e2e:midas && CROSS_APP_SCENARIO_PATH='${scenarioPath}' ./node_modules/.bin/playwright test -c apps/midas/playwright.authenticated.config.ts --grep 'cross-app shared scenario publishes Aurum' && node scripts/verify-midas-e2e.mjs`,
});

const completedScenario = scenarioFromDisk();
if (completedScenario.midas?.result !== 'PASS'
    || completedScenario.midas.sourceGastappContractHash !== completedScenario.gastapp.currentContract.contractHash) {
  throw new Error('MIDAS no confirmó el mismo escenario GastApp/Aurum de extremo a extremo.');
}
console.info(`[cross-app] E2E TRANSVERSAL PASS; artefacto sintético: ${scenarioPath}`);
