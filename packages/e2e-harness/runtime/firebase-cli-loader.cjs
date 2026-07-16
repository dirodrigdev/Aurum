const path = require('node:path');
const childProcess = require('node:child_process');
const { rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const originalSpawn = childProcess.spawn;
childProcess.spawn = (command, args = [], options = {}) => {
  const isFirestoreJava =
    path.basename(String(command || '')) === 'java' &&
    args.some((argument) => String(argument).includes('cloud-firestore-emulator'));
  return originalSpawn(command, args, isFirestoreJava ? { ...options, detached: false } : options);
};

const projectFlagIndex = process.argv.indexOf('--project');
const localProjectId = projectFlagIndex >= 0 ? String(process.argv[projectFlagIndex + 1] || '') : '';
if (/^[a-z][a-z0-9-]*-e2e-local$/.test(localProjectId)) {
  const removeLocalHubLocator = () => {
    rmSync(path.resolve(tmpdir(), `hub-${localProjectId}.json`), { force: true });
  };
  process.once('exit', removeLocalHubLocator);
  process.prependOnceListener('SIGINT', removeLocalHubLocator);
  process.prependOnceListener('SIGTERM', removeLocalHubLocator);
}

// Firebase CLI's MOTD fetch can keep local emulator commands alive offline.
const workspaceRoot = process.env.E2E_FIREBASE_WORKSPACE_DIR || path.resolve(__dirname, '../../..');
const motd = require(path.resolve(workspaceRoot, 'node_modules/firebase-tools/lib/fetchMOTD.js'));
motd.fetchMOTD = () => undefined;
