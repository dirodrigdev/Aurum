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

const monthKeys = Array.from({ length: 38 }, (_, index) => {
  const date = new Date(Date.UTC(2023, 4 + index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
});

const recordsForMonth = (monthKey, index) => {
  const snapshotDate = `${monthKey}-15`;
  const createdAt = `${snapshotDate}T12:00:00.000Z`;
  const wave = Math.round(Math.sin(index / 3) * 1_200_000);
  return [
    ['bank', 'Saldo bancos CLP', 30_000_000 + index * 220_000 + wave],
    ['investment', 'Fondo diversificado ficticio', 86_000_000 + index * 1_450_000 + wave * 2],
    ['investment', 'Capital de riesgo CLP', 14_000_000 + index * 180_000],
    ['real_estate', 'Valor propiedad', 110_000_000 + index * 350_000],
    ['debt', 'Crédito ficticio', 24_000_000 - index * 210_000],
  ].map(([block, label, amount], recordIndex) => ({
    id: `e2e-${monthKey}-${recordIndex + 1}`,
    block,
    source: 'e2e_fixture',
    label,
    amount: Math.max(1_000_000, Number(amount)),
    currency: 'CLP',
    snapshotDate,
    createdAt,
  }));
};

const summaryFor = (records) => {
  const amountFor = (block, label) =>
    records.find((record) => record.block === block && (!label || record.label === label))?.amount || 0;
  const bankClp = amountFor('bank');
  const investmentClp = amountFor('investment', 'Fondo diversificado ficticio');
  const riskCapitalClp = amountFor('investment', 'Capital de riesgo CLP');
  const realEstateAssetsClp = amountFor('real_estate');
  const nonMortgageDebtClp = amountFor('debt');
  const netClp = bankClp + investmentClp + realEstateAssetsClp - nonMortgageDebtClp;
  const netClpWithRisk = netClp + riskCapitalClp;
  return {
    netByCurrency: { CLP: netClpWithRisk, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: netClpWithRisk + nonMortgageDebtClp, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: nonMortgageDebtClp, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: netClpWithRisk,
    byBlock: {
      bank: { CLP: bankClp, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: investmentClp + riskCapitalClp, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: realEstateAssetsClp, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: nonMortgageDebtClp, USD: 0, EUR: 0, UF: 0 },
    },
    investmentClp,
    riskCapitalClp,
    investmentClpWithRisk: investmentClp + riskCapitalClp,
    netClp,
    netClpWithRisk,
    bankClp,
    nonMortgageDebtClp,
    realEstateNetClp: realEstateAssetsClp,
    realEstateAssetsClp,
    mortgageDebtClp: 0,
  };
};

const closures = monthKeys.map((monthKey, index) => {
  const records = recordsForMonth(monthKey, index);
  const [year, month] = monthKey.split('-').map(Number);
  const fxRates = {
    usdClp: 820 + index * 3,
    eurClp: 900 + index * 4,
    ufClp: 35_000 + index * 120,
  };
  const economicDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {
    id: `e2e-closure-${monthKey}`,
    monthKey,
    closedAt: new Date(Date.UTC(year, month, 1, 12)).toISOString(),
    fxRates,
    fxMetadata: {
      economicMonthKey: monthKey,
      economicDate,
      usedFxRates: fxRates,
      rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
      source: { usd: 'e2e-fixture', eur: 'e2e-fixture', uf: 'e2e-fixture' },
      retrievedAt: `${economicDate}T12:00:00.000Z`,
    },
    summary: summaryFor(records),
    records,
  };
});

const records = recordsForMonth('2026-07', monthKeys.length);
const currentSummary = summaryFor(records);

await db.doc(`aurum_wealth/${uid}`).set({
  schemaVersion: 1,
  updatedAt: '2026-07-15T12:00:00.000Z',
  fx: { usdClp: 934, eurClp: 1052, ufClp: 39560 },
  records,
  closures,
  closureDeletionTombstones: [],
  instruments: [],
  bankTokens: {},
  deletedRecordIds: [],
  deletedRecordAssetMonthKeys: [],
});

console.log(`Seed E2E listo para ${projectId}/${uid}: ${closures.length} cierres ficticios, neto actual ${currentSummary.netClpWithRisk}.`);
