import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const runtimeRoot = resolve(homedir(), '.cache/aurum-e2e');
const nodeBinary = resolve(runtimeRoot, 'node-22/bin/node');
const javaHome = resolve(runtimeRoot, 'jdk-21');
const firebaseBinary = resolve('node_modules/firebase-tools/lib/bin/firebase.js');
const motdLoader = resolve('scripts/firebase-cli-e2e-loader.cjs');

if (!existsSync(nodeBinary) || !existsSync(resolve(javaHome, 'bin/java'))) {
  throw new Error('Falta el runtime local E2E de Node 22 o Java 21 en ~/.cache/aurum-e2e.');
}

const result = spawnSync(nodeBinary, ['-r', motdLoader, firebaseBinary, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${resolve(javaHome, 'bin')}:${resolve(runtimeRoot, 'node-22/bin')}:${process.env.PATH}`,
    NO_UPDATE_NOTIFIER: '1',
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
