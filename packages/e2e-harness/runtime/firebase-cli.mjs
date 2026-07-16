import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repositoryRoot = resolve(harnessRoot, '../..');
const configuredRuntimeRoot = process.env.E2E_FIREBASE_RUNTIME_DIR;
const runtimeRoot = configuredRuntimeRoot
  ? resolve(configuredRuntimeRoot)
  : resolve(homedir(), '.cache/firebase-e2e');
const legacyRuntimeRoot = resolve(homedir(), '.cache/aurum-e2e');
const nodeVersion = '22.18.0';
const firebaseBinaryFor = (workspaceDir) => resolve(workspaceDir, 'node_modules/firebase-tools/lib/bin/firebase.js');
const motdLoader = resolve(harnessRoot, 'runtime/firebase-cli-loader.cjs');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Falló: ${command} ${args.join(' ')}`);
};

const commandOutput = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) return '';
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
};

const nodeMajor = (binary) => {
  const match = commandOutput(binary, ['--version']).match(/v?(\d+)\./);
  return match ? Number(match[1]) : null;
};

const javaMajor = (binary) => {
  const match = commandOutput(binary, ['-version']).match(/version\s+"(?:1\.)?(\d+)/i);
  return match ? Number(match[1]) : null;
};

const usableNode = (binary) => existsSync(binary) && nodeMajor(binary) === 22;
const usableJava = (binary) => existsSync(binary) && (javaMajor(binary) ?? 0) >= 17;

const download = (url, target) => {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.partial`;
  run('curl', ['--fail', '--location', '--silent', '--show-error', '--output', temporary, url]);
  renameSync(temporary, target);
};

const platform = process.platform === 'darwin' ? 'darwin' : process.platform;
const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
if (!architecture || !['darwin', 'linux'].includes(platform)) {
  throw new Error(`No hay bootstrap E2E para ${process.platform}/${process.arch}. Define E2E_NODE_BINARY y E2E_JAVA_HOME.`);
}

const resolveNodeBinary = () => {
  const candidates = [
    process.env.E2E_NODE_BINARY,
    resolve(runtimeRoot, 'node-22/bin/node'),
    resolve(legacyRuntimeRoot, 'node-22/bin/node'),
  ].filter(Boolean);
  const installed = candidates.find(usableNode);
  if (installed) return installed;

  const archive = resolve(runtimeRoot, `node-v${nodeVersion}-${platform}-${architecture}.tar.xz`);
  const extracted = resolve(runtimeRoot, `node-v${nodeVersion}-${platform}-${architecture}`);
  const binary = resolve(extracted, 'bin/node');
  if (!usableNode(binary)) {
    if (!existsSync(archive)) {
      download(`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-${platform}-${architecture}.tar.xz`, archive);
    }
    mkdirSync(runtimeRoot, { recursive: true });
    run('tar', ['-xJf', archive, '-C', runtimeRoot]);
  }
  if (!usableNode(binary)) throw new Error(`No pude preparar Node ${nodeVersion} para Firebase E2E en ${runtimeRoot}.`);
  return binary;
};

const resolveJavaBinary = () => {
  const configuredJavaHome = process.env.E2E_JAVA_HOME || process.env.JAVA_HOME;
  const candidates = [
    configuredJavaHome ? resolve(configuredJavaHome, 'bin/java') : null,
    resolve(runtimeRoot, 'jdk-21/bin/java'),
    resolve(legacyRuntimeRoot, 'jdk-21/bin/java'),
    '/usr/bin/java',
  ].filter(Boolean);
  const installed = candidates.find(usableJava);
  if (installed) return installed;

  const archive = resolve(runtimeRoot, `temurin-21-${platform}-${architecture}.tar.gz`);
  const extractedRoot = resolve(runtimeRoot, 'jdk-21');
  const binary = resolve(extractedRoot, 'bin/java');
  if (!usableJava(binary)) {
    if (!existsSync(archive)) {
      const temurinOs = platform === 'darwin' ? 'mac' : platform;
      const temurinArch = architecture === 'arm64' ? 'aarch64' : architecture;
      download(`https://api.adoptium.net/v3/binary/latest/21/ga/${temurinOs}/${temurinArch}/jdk/hotspot/normal/eclipse`, archive);
    }
    const temporaryRoot = resolve(runtimeRoot, 'jdk-21.partial');
    run('rm', ['-rf', temporaryRoot]);
    mkdirSync(temporaryRoot, { recursive: true });
    run('tar', ['-xzf', archive, '-C', temporaryRoot, '--strip-components=1']);
    run('rm', ['-rf', extractedRoot]);
    renameSync(temporaryRoot, extractedRoot);
  }
  if (!usableJava(binary)) throw new Error(`No pude preparar Java 21 para Firebase E2E en ${runtimeRoot}.`);
  return binary;
};

const descendantPids = (rootPid) => {
  const output = commandOutput('ps', ['-axo', 'pid=,ppid=']);
  const childrenByParent = new Map();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const children = childrenByParent.get(parentPid) || [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const descendants = [];
  const pending = [...(childrenByParent.get(rootPid) || [])];
  while (pending.length) {
    const pid = pending.pop();
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) || []));
  }
  return descendants.reverse();
};

const signalOwnedTree = (rootPid, signal) => {
  for (const pid of [...descendantPids(rootPid), rootPid]) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
};

export const runFirebaseCli = async (argumentsForFirebase, workspaceDir = repositoryRoot) => {
  const firebaseBinary = firebaseBinaryFor(workspaceDir);
  if (!existsSync(firebaseBinary)) {
    throw new Error('No encuentro firebase-tools local. Ejecuta npm install desde la raíz del monorepo.');
  }
  const nodeBinary = resolveNodeBinary();
  const javaBinary = resolveJavaBinary();
  const javaHome = resolve(javaBinary, '..', '..');
  const child = spawn(nodeBinary, ['-r', motdLoader, firebaseBinary, ...argumentsForFirebase], {
    cwd: workspaceDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: `${resolve(javaHome, 'bin')}:${resolve(nodeBinary, '..')}:${process.env.PATH}`,
      NO_UPDATE_NOTIFIER: '1',
      E2E_FIREBASE_WORKSPACE_DIR: workspaceDir,
    },
  });
  let forcedKillTimer;
  const forwardSignal = (signal) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    signalOwnedTree(child.pid, signal);
    forcedKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) signalOwnedTree(child.pid, 'SIGKILL');
    }, 5_000);
    forcedKillTimer.unref();
  };
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    return await new Promise((resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolveResult(code ?? 1));
    });
  } finally {
    if (forcedKillTimer) clearTimeout(forcedKillTimer);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
};

export const removeEmulatorHubLocator = (projectId) => {
  if (!/^[a-z][a-z0-9-]*-e2e-local$/.test(String(projectId || ''))) {
    throw new Error(`No limpiaré un locator de Firebase para un projectId no local: ${projectId}.`);
  }
  rmSync(resolve(tmpdir(), `hub-${projectId}.json`), { force: true });
};
