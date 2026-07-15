import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { repositoryRoot } from '../runtime/firebase-cli.mjs';

const LOCAL_PROJECT_ID = /^[a-z][a-z0-9-]*-e2e-local$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const withinRepository = (root, value) => {
  const path = resolve(root, value);
  const relation = relative(root, path);
  return relation && !relation.startsWith('..') && !relation.includes('/../') ? path : null;
};

export const loadAppConfig = async (configPath) => {
  const externalRepository = process.env.E2E_APP_REPO_DIR;
  const appRepository = externalRepository ? resolve(externalRepository) : repositoryRoot;
  if (process.env.CI && externalRepository && !isAbsolute(externalRepository)) {
    throw new Error('E2E_APP_REPO_DIR debe ser una ruta absoluta aprobada en CI.');
  }
  if (!existsSync(appRepository)) throw new Error(`No existe el repositorio E2E: ${appRepository}`);
  const absolutePath = withinRepository(appRepository, configPath);
  if (!absolutePath || !existsSync(absolutePath)) {
    throw new Error(`No encuentro la configuración E2E dentro del repositorio: ${configPath}`);
  }
  const module = await import(absolutePath);
  return validateAppConfig(module.default, appRepository);
};

export const validateAppConfig = (config, appRepository = repositoryRoot) => {
  if (!config || typeof config !== 'object') throw new Error('La configuración E2E debe exportar un objeto.');
  const { appName, projectId, host, ports, artifactDirectories, seedCommand, playwrightCommand, verifyCommand } = config;
  const firebaseConfigPath = config.firebaseConfigPath ?? 'firebase.json';
  if (!/^[a-z][a-z0-9-]*$/.test(String(appName || ''))) throw new Error('appName E2E debe ser un identificador minúsculo.');
  if (!LOCAL_PROJECT_ID.test(String(projectId || ''))) throw new Error(`projectId E2E inseguro: ${projectId}. Debe terminar en -e2e-local.`);
  if (!LOCAL_HOSTS.has(host)) throw new Error(`host E2E inseguro: ${host}. Usa sólo loopback.`);
  if (!ports || typeof ports !== 'object') throw new Error(`Faltan puertos E2E para ${appName}.`);
  const values = Object.entries(ports);
  if (!['auth', 'firestore', 'app'].every((name) => name in ports)) throw new Error(`Puertos incompletos para ${appName}.`);
  if (values.some(([, value]) => !Number.isInteger(value) || value < 1024 || value > 65535)) throw new Error(`Puertos inválidos para ${appName}.`);
  if (new Set(values.map(([, value]) => value)).size !== values.length) throw new Error(`Puertos duplicados para ${appName}.`);
  const firebasePath = withinRepository(appRepository, firebaseConfigPath);
  if (!firebasePath || !existsSync(firebasePath)) throw new Error(`firebaseConfigPath inválido para ${appName}.`);
  if (!Array.isArray(artifactDirectories) || artifactDirectories.length === 0 || artifactDirectories.some((entry) => !withinRepository(appRepository, entry))) {
    throw new Error(`artifactDirectories inválidos para ${appName}.`);
  }
  if (typeof seedCommand !== 'string' || typeof playwrightCommand !== 'string') throw new Error(`Faltan comandos E2E para ${appName}.`);
  if (verifyCommand !== undefined && typeof verifyCommand !== 'string') throw new Error(`verifyCommand inválido para ${appName}.`);
  return {
    ...config,
    repositoryDir: appRepository,
    firebaseConfigPath,
    firebaseConfigAbsolutePath: firebasePath,
    usesDefaultFirebaseConfig: !Object.hasOwn(config, 'firebaseConfigPath'),
    artifactDirectories: artifactDirectories.map((entry) => resolve(appRepository, entry)),
  };
};
