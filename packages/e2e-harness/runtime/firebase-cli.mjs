import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
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
const firebaseBinary = resolve(repositoryRoot, 'node_modules/firebase-tools/lib/bin/firebase.js');
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

export const runFirebaseCli = (argumentsForFirebase) => {
  if (!existsSync(firebaseBinary)) {
    throw new Error('No encuentro firebase-tools local. Ejecuta npm install desde la raíz del monorepo.');
  }
  const nodeBinary = resolveNodeBinary();
  const javaBinary = resolveJavaBinary();
  const javaHome = resolve(javaBinary, '..', '..');
  const result = spawnSync(nodeBinary, ['-r', motdLoader, firebaseBinary, ...argumentsForFirebase], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: `${resolve(javaHome, 'bin')}:${resolve(nodeBinary, '..')}:${process.env.PATH}`,
      NO_UPDATE_NOTIFIER: '1',
    },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};
