import { expect, test } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

const userId = 'aurum-e2e-user';
const appName = 'aurum-historical-sidecar-e2e';
const firebaseApp = getApps().find((candidate) => candidate.name === appName)
  || initializeApp({ projectId: 'aurum-e2e-local' }, appName);
const firestore = getFirestore(firebaseApp);
const wealthRef = firestore.doc(`aurum_wealth/${userId}`);
const sidecarRef = firestore.doc(`aurum_wealth/${userId}/gastapp_snapshots/historical_v1`);

let originalWealth: Record<string, unknown> | null = null;
let originalSidecar: Record<string, unknown> | null = null;
let existedWealth = false;
let existedSidecar = false;

test.afterEach(async () => {
  if (existedWealth && originalWealth) await wealthRef.set(originalWealth);
  else await wealthRef.delete();
  if (existedSidecar && originalSidecar) await sidecarRef.set(originalSidecar);
  else await sidecarRef.delete();
  originalWealth = null;
  originalSidecar = null;
  existedWealth = false;
  existedSidecar = false;
});

const sha = (letter: string) => `sha256:${letter.repeat(64)}`;

const summaryFor = (netClp: number) => ({
  netByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
  assetsByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
  debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
  netConsolidatedClp: netClp,
  byBlock: {
    bank: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
  },
  investmentClp: 0,
  riskCapitalClp: 0,
  investmentClpWithRisk: 0,
  netClp,
  netClpWithRisk: netClp,
  bankClp: netClp,
  nonMortgageDebtClp: 0,
  realEstateNetClp: 0,
  realEstateAssetsClp: 0,
  mortgageDebtClp: 0,
});

const makeSnapshot = (monthKey: string, index: number, fxRates: { usdClp: number; eurClp: number; ufClp: number }) => {
  const totalEur = 220 + index;
  const byFamilyEur = { dayToDay: 180 + index, trips: 20, others: 20 };
  const amount = (factor: number) => ({
    total: totalEur * factor,
    dayToDay: byFamilyEur.dayToDay * factor,
    trips: byFamilyEur.trips * factor,
    others: byFamilyEur.others * factor,
  });
  const date = `${monthKey}-28`;
  return {
    schemaVersion: 'aurum-gastapp-monthly-close-v2',
    sourcePath: 'gastapp_aurum_contracts_v2/months_current',
    monthKey,
    calendarMonthKey: monthKey,
    totalEur,
    byFamilyEur,
    canonicalDataHash: sha('a'),
    operationalDataHash: sha('b'),
    operationalRevision: 1,
    sourceGeneration: 1,
    monthContractRevision: 1,
    monthContractHash: sha('c'),
    certificationStatus: 'certified',
    certificationRevision: 1,
    certificationHash: sha('d'),
    contractHash: sha('e'),
    contractVersion: 'gastapp-aurum-calendar-months-v2',
    generatedAt: `${date}T12:00:00.000Z`,
    capturedAt: `${date}T23:59:59.000Z`,
    fxRates,
    amountsByCurrency: {
      EUR: amount(1),
      CLP: amount(fxRates.eurClp),
      USD: amount(fxRates.eurClp / fxRates.usdClp),
      UF: amount(fxRates.eurClp / fxRates.ufClp),
    },
  };
};

const monthsBetween = (start: string, end: string) => {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  const result: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return result;
};

const makeClosure = (monthKey: string, index: number, withEmbeddedSnapshot: boolean) => {
  const date = `${monthKey}-28`;
  const closedAt = `${monthKey}-28T23:59:59.000Z`;
  const fxRates = { usdClp: 900, eurClp: 1_000, ufClp: 40_000 };
  const records = [{
    id: `record-${monthKey}`,
    block: 'bank',
    source: 'e2e_fixture',
    label: 'Banco ficticio',
    amount: 20_000_000 + index * 125_000,
    currency: 'CLP',
    snapshotDate: date,
    createdAt: closedAt,
  }];
  const fxMetadata = {
    economicMonthKey: monthKey,
    economicDate: date,
    usedFxRates: fxRates,
    rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
    source: { usd: 'e2e-fixture', eur: 'e2e-fixture', uf: 'e2e-fixture' },
    retrievedAt: `${date}T12:00:00.000Z`,
  };
  const snapshot = makeSnapshot(monthKey, index, fxRates);
  return {
    snapshot,
    closure: {
      id: `closure-${monthKey}`,
      monthKey,
      closedAt,
      summary: summaryFor(20_000_000 + index * 125_000),
      records,
      fxRates,
      fxMetadata,
      previousVersions: [],
      ...(withEmbeddedSnapshot ? { gastappExpenseClose: snapshot } : {}),
    },
  };
};

const installMultiYearFixture = async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^127\.0\.0\.1:\d+$/.test(emulatorHost)) {
    throw new Error('El fixture histórico sólo puede escribir en Firestore Emulator local.');
  }
  const [wealthSnapshot, sidecarSnapshot] = await Promise.all([wealthRef.get(), sidecarRef.get()]);
  existedWealth = wealthSnapshot.exists;
  existedSidecar = sidecarSnapshot.exists;
  originalWealth = wealthSnapshot.exists ? wealthSnapshot.data() || {} : null;
  originalSidecar = sidecarSnapshot.exists ? sidecarSnapshot.data() || {} : null;

  const snapshotsByMonth = new Map<string, ReturnType<typeof makeClosure>['snapshot']>();
  const closures = monthsBetween('2023-05', '2026-08').map((monthKey, index) => {
    const fixture = makeClosure(monthKey, index, monthKey === '2026-08');
    snapshotsByMonth.set(monthKey, fixture.snapshot);
    return fixture.closure;
  });
  const sidecarEntries = Object.fromEntries(
    closures
      .filter((closure) => closure.monthKey >= '2023-06' && closure.monthKey <= '2026-07')
      .map((closure) => {
        const snapshot = snapshotsByMonth.get(closure.monthKey);
        if (!snapshot) throw new Error(`Falta el snapshot de fixture para ${closure.monthKey}.`);
        return [closure.monthKey, {
          closureId: closure.id,
          snapshot,
          repairAudit: {
            reason: 'historical_schema_compatibility_reconstruction',
            reconstructedAt: '2026-10-05T12:00:00.000Z',
            originalClosureAt: closure.closedAt,
            preFingerprint: sha('f'),
            postFingerprint: sha('f'),
            sourceContractHash: snapshot.contractHash,
          },
        }];
      }),
  );
  if (Object.keys(sidecarEntries).length !== 38) throw new Error('La fixture debe tener 38 sidecars históricos.');

  await wealthRef.set({ ...(originalWealth || {}), closures });
  await sidecarRef.set({ schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: sidecarEntries });
  return { closures, sidecar: { schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: sidecarEntries } };
};

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

test('multi-year sidecar remains authoritative through a new close, route changes, and full reload', async ({ page }, testInfo) => {
  const networkGuard = await installLocalNetworkGuard(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  let releaseSidecarRead!: () => void;
  let markSidecarReadIntercepted!: () => void;
  const sidecarReadHold = new Promise<void>((resolve) => { releaseSidecarRead = resolve; });
  const sidecarReadIntercepted = new Promise<void>((resolve) => { markSidecarReadIntercepted = resolve; });
  await page.route('**/google.firestore.v1.Firestore/Listen/channel**', async (route) => {
    const form = new URLSearchParams(route.request().postData() || '');
    const targetDocuments = [...form.entries()]
      .filter(([name]) => /^req\d+___data__$/u.test(name))
      .flatMap(([, value]) => {
        try {
          const data = JSON.parse(value);
          return data?.addTarget?.documents?.documents || [];
        } catch {
          return [];
        }
      });
    if (targetDocuments.some((path) => path.endsWith('/gastapp_snapshots/historical_v1'))) {
      markSidecarReadIntercepted();
      await sidecarReadHold;
    }
    await route.continue();
  });

  let { closures, sidecar } = await installMultiYearFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/analysis');
  const dismissPrompt = page.getByRole('button', { name: 'Omitir', exact: true });
  if (await dismissPrompt.isVisible()) await dismissPrompt.click();
  await sidecarReadIntercepted;
  await expect(page.getByTestId('historical-gastapp-sidecar-state')).toBeVisible();
  await expect(page.getByText('Cargando histórico de GastApp para el análisis…', { exact: true })).toBeVisible();
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByTestId('historical-gastapp-sidecar-state')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`sidecar-loading-${viewport.name}.png`), fullPage: true });
  }
  releaseSidecarRead();
  await expect(page.getByText('39/39 meses válidos', { exact: true }).first()).toBeVisible();

  const september = makeClosure('2026-09', closures.length, true).closure;
  closures = [...closures, september];
  await wealthRef.update({ closures });
  await expect(page.getByText('40/40 meses válidos', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('12/12 meses válidos', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('9/9 meses válidos', { exact: true }).first()).toBeVisible();
  if (await dismissPrompt.isVisible()) await dismissPrompt.click();

  const sealedHistoricalClosures = new Map(
    closures
      .filter((closure) => closure.monthKey >= '2023-06' && closure.monthKey <= '2026-07')
      .map((closure) => [closure.monthKey, structuredClone({
        id: closure.id,
        monthKey: closure.monthKey,
        closedAt: closure.closedAt,
        summary: closure.summary,
        records: closure.records,
        fxRates: closure.fxRates,
        fxMetadata: closure.fxMetadata,
        fxMissing: closure.fxMissing,
        previousVersions: closure.previousVersions,
      })]),
  );
  const sidecarBeforeNavigation = structuredClone(sidecar);
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByText('40/40 meses válidos', { exact: true }).first()).toBeVisible();
    if (await dismissPrompt.isVisible()) await dismissPrompt.click();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`retornos-sidecar-${viewport.name}.png`), fullPage: true });
  }

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/#/dashboard');
    await expect(page.getByText('Evolución patrimonial', { exact: true })).toBeVisible();
    if (await dismissPrompt.isVisible()) await dismissPrompt.click();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-sidecar-${viewport.name}.png`), fullPage: true });

    await page.goto('/#/presentation');
    await expect(page.getByTestId('aurum-presentation')).toBeVisible();
    if (await dismissPrompt.isVisible()) await dismissPrompt.click();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`presentation-sidecar-${viewport.name}.png`), fullPage: true });
  }

  await page.goto('/#/analysis');
  await expect(page.getByText('40/40 meses válidos', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('40/40 meses válidos', { exact: true }).first()).toBeVisible();

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/#/dashboard');
  await expect(page.getByText('Evolución patrimonial', { exact: true })).toBeVisible();
  if (await dismissPrompt.isVisible()) await dismissPrompt.click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('dashboard-sidecar-tablet.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/presentation');
  await expect(page.getByTestId('aurum-presentation')).toBeVisible();
  if (await dismissPrompt.isVisible()) await dismissPrompt.click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('presentation-sidecar-mobile.png'), fullPage: true });

  await page.goto('/#/analysis');
  await expect(page.getByText('40/40 meses válidos', { exact: true }).first()).toBeVisible();
  const [wealthAfter, sidecarAfter] = await Promise.all([wealthRef.get(), sidecarRef.get()]);
  const closuresAfter = wealthAfter.get('closures') as Array<Record<string, unknown>>;
  for (const [monthKey, sidecarEntry] of Object.entries(sidecarBeforeNavigation.snapshotsByMonth)) {
    const current = closuresAfter.find((closure) => closure.monthKey === monthKey);
    expect(current).toBeDefined();
    expect(current?.id).toBe(sidecarEntry.closureId);
    expect(current?.gastappExpenseClose).toBeUndefined();
    expect({
      id: current?.id,
      monthKey: current?.monthKey,
      closedAt: current?.closedAt,
      summary: current?.summary,
      records: current?.records,
      fxRates: current?.fxRates,
      fxMetadata: current?.fxMetadata,
      fxMissing: current?.fxMissing,
      previousVersions: current?.previousVersions,
    }).toEqual(sealedHistoricalClosures.get(monthKey));
  }
  expect(sidecarAfter.data()).toEqual(sidecarBeforeNavigation);
  expect(Object.keys((sidecarAfter.get('snapshotsByMonth') || {}) as Record<string, unknown>)).toHaveLength(38);

  await networkGuard.assertClean(testInfo);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
