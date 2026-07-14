import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'midas-e2e-local';
const uid = 'midas-e2e-user';
const email = 'midas.e2e@example.test';
const password = 'midas-e2e-only-not-a-secret';
const emulatorHosts = [process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.FIRESTORE_EMULATOR_HOST];

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') {
  throw new Error('El seed E2E de MIDAS requiere Auth Emulator 127.0.0.1:9199 y Firestore Emulator 127.0.0.1:8180.');
}
if (!emulatorHosts.every(Boolean)) throw new Error('El seed E2E de MIDAS requiere emuladores activos.');

const stableSerialize = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(',')}}`;
};

const hash = (value) => {
  let output = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 0x01000193);
  }
  return `fnv1a-${(output >>> 0).toString(16).padStart(8, '0')}`;
};

const params = {
  label: 'Fixture MIDAS E2E',
  capitalInitial: 12500000,
  capitalSource: 'manual',
  manualCapitalInput: { financialCapitalCLP: 12500000 },
  weights: { rvGlobal: 0.4, rfGlobal: 0.2, rvChile: 0.2, rfChile: 0.2 },
  cashflowEvents: [],
  futureCapitalEvents: [],
  activeScenario: 'base',
  feeAnnual: 0.003,
  spendingPhases: [
    { durationMonths: 120, amountReal: 900000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 750000, currency: 'CLP' },
    { durationMonths: 240, amountReal: 600000, currency: 'CLP' },
  ],
  spendingRule: { dd15Threshold: 0.15, dd25Threshold: 0.25, consecutiveMonths: 3, softCut: 0.9, hardCut: 0.8, adjustmentAlpha: 0.2, recoveryAlpha: 0.8 },
  returns: {
    rvGlobalAnnual: 0.06,
    rfGlobalAnnual: 0.02,
    rvChileAnnual: 0.05,
    rfChileUFAnnual: 0.015,
    rvGlobalVolAnnual: 0.14,
    rfGlobalVolAnnual: 0.04,
    rvChileVolAnnual: 0.17,
    rfChileVolAnnual: 0.03,
    correlationMatrix: [[1, 0.05, 0.6, 0], [0.05, 1, 0.05, 0.2], [0.6, 0.05, 1, 0.1], [0, 0.2, 0.1, 1]],
  },
  inflation: { ipcChileAnnual: 0.03, hipcEurAnnual: 0.02, ipcChileVolAnnual: 0.01, hipcEurVolAnnual: 0.01 },
  fx: { clpUsdInitial: 900, usdEurFixed: 1.05, tcrealLT: 650, mrHalfLifeYears: 6 },
  generatorType: 'gaussian_iid',
  bucketMonths: 18,
  simulation: { nSim: 100, horizonMonths: 120, blockLength: 12, seed: 20260714, useHistoricalData: false },
  simulationComposition: {
    mode: 'legacy',
    totalNetWorthCLP: 12500000,
    optimizableInvestmentsCLP: 12500000,
    nonOptimizable: { banksCLP: 0, nonMortgageDebtCLP: 0 },
    diagnostics: { sourceVersion: 1, mode: 'legacy', compositionGapCLP: 0, compositionGapPct: 0, notes: ['midas-e2e-fixture'] },
  },
  realEstatePolicy: { enabled: false, triggerRunwayMonths: 36, saleDelayMonths: 12, saleCostPct: 0, realAppreciationAnnual: 0 },
  ruinThresholdMonths: 3,
};

const serialized = stableSerialize(params);
const active = {
  schemaVersion: 1,
  savedAt: '2026-07-14T12:00:00.000Z',
  hash: hash(serialized),
  source: 'midas_e2e_seed',
  paramsJson: JSON.stringify(params),
  spendingPhases: params.spendingPhases.map((phase, index) => ({ id: `F${index + 1}`, ...phase })),
  nSim: params.simulation.nSim,
  seed: params.simulation.seed,
  bucketMonths: params.bucketMonths,
  capitalInitialClp: params.capitalInitial,
};

const app = getApps()[0] ?? initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

try {
  await auth.updateUser(uid, { email, password, emailVerified: true, disabled: false });
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  await auth.createUser({ uid, email, password, emailVerified: true });
}

await db.doc(`users/${uid}/midas_config/simulationActiveV1`).set({
  active,
  previous: null,
  updatedAt: '2026-07-14T12:00:00.000Z',
  e2eSeedMarker: 'midas-e2e-seed-v1',
});

console.log(`Seed E2E de MIDAS listo para ${projectId}/${uid}.`);
await app.delete();
