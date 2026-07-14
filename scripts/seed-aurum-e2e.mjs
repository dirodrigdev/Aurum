import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'aurum-e2e-local';
const uid = 'aurum-e2e-user';
const email = 'aurum.e2e@example.test';
const password = 'aurum-e2e-only-not-a-secret';
const emulatorHosts = [process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.FIRESTORE_EMULATOR_HOST];

if (!emulatorHosts.every((host) => /^127\.0\.0\.1:\d+$/.test(String(host || '')))) {
  throw new Error('El seed E2E requiere Auth y Firestore Emulator en 127.0.0.1.');
}

const app = getApps()[0] ?? initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

try {
  await auth.updateUser(uid, { email, password, emailVerified: true, disabled: false });
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  await auth.createUser({ uid, email, password, emailVerified: true });
}

const records = [
  {
    id: 'e2e-bank-clp',
    block: 'bank',
    source: 'e2e_fixture',
    label: 'Banco local ficticio',
    amount: 2500000,
    currency: 'CLP',
    snapshotDate: '2026-01-15',
    createdAt: '2026-01-15T12:00:00.000Z',
  },
  {
    id: 'e2e-investment-clp',
    block: 'investment',
    source: 'e2e_fixture',
    label: 'Inversión local ficticia',
    amount: 7500000,
    currency: 'CLP',
    snapshotDate: '2026-01-15',
    createdAt: '2026-01-15T12:00:00.000Z',
  },
  {
    id: 'e2e-debt-clp',
    block: 'debt',
    source: 'e2e_fixture',
    label: 'Deuda local ficticia',
    amount: -500000,
    currency: 'CLP',
    snapshotDate: '2026-01-15',
    createdAt: '2026-01-15T12:00:00.000Z',
  },
];

const closure = {
  id: 'e2e-closure-2025-12',
  monthKey: '2025-12',
  closedAt: '2026-01-01T12:00:00.000Z',
  fxRates: { usdClp: 950, eurClp: 1030, ufClp: 38000 },
  summary: {
    netByCurrency: { CLP: 9500000, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: 10000000, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: -500000, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: 9500000,
    byBlock: {
      bank: { CLP: 2500000, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: 7500000, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: -500000, USD: 0, EUR: 0, UF: 0 },
    },
    investmentClp: 7500000,
    investmentClpWithRisk: 7500000,
    netClp: 9500000,
    netClpWithRisk: 9500000,
    bankClp: 2500000,
    nonMortgageDebtClp: -500000,
  },
  records,
};

await db.doc(`aurum_wealth/${uid}`).set({
  schemaVersion: 1,
  updatedAt: '2026-01-15T12:00:00.000Z',
  fx: { usdClp: 950, eurClp: 1030, ufClp: 38000 },
  records,
  closures: [closure],
  closureDeletionTombstones: [],
  instruments: [],
  bankTokens: {},
  deletedRecordIds: [],
  deletedRecordAssetMonthKeys: [],
});

console.log(`Seed E2E listo para ${projectId}/${uid}.`);
