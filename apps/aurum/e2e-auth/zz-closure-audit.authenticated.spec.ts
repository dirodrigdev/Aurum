import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { calculateHistoricalClosureSummary } from '../api/admin/_historicalClosureCore.js';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

// Regression assertions describe the required customer behaviour. Known defects
// deliberately remain failing until corrected; do not skip or invert assertions.
const projectId = 'aurum-e2e-local';
const uid = 'aurum-e2e-user';
const rates = { usdClp: 934, eurClp: 1052, ufClp: 39560 };
const sharedScenarioPath = process.env.CROSS_APP_SCENARIO_PATH;
let restoreFixture: (() => Promise<void>) | null = null;

const readSharedScenario = () => {
  if (!sharedScenarioPath) return null;
  const value = JSON.parse(readFileSync(sharedScenarioPath, 'utf8'));
  if (value.schemaVersion !== 'gastapp-aurum-midas-cross-app-synthetic-v1'
      || value.gastapp?.initialContract?.contractVersion !== 'gastapp-aurum-calendar-months-v2'
      || value.gastapp?.currentContract?.contractVersion !== 'gastapp-aurum-calendar-months-v2') {
    throw new Error('cross_app_shared_scenario_contract_invalid');
  }
  return value;
};

function emulatorDb() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw new Error('Close audit requires the local Firestore Emulator.');
  }
  const name = 'aurum-close-audit';
  const app = getApps().find((item) => item.name === name) || initializeApp({ projectId }, name);
  return getFirestore(app);
}

type FirestoreCommitAttempt = {
  sequence: number;
  elapsedMs: number;
  operation: string;
  document: string;
  updateMask: string[];
  precondition: string[];
  status: number | null;
};

function observeFirestoreCommits(page: Page, userId: string) {
  const startedAt = Date.now();
  const attempts: FirestoreCommitAttempt[] = [];
  const requestAttempts = new WeakMap<object, FirestoreCommitAttempt>();
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.endsWith('/documents:commit')) return;
    let body: any = {};
    try { body = JSON.parse(request.postData() || '{}'); } catch { /* Never log request bodies. */ }
    const write = Array.isArray(body.writes) ? body.writes[0] || {} : {};
    const operation = ['update', 'delete', 'transform'].find((key) => write[key] !== undefined) || 'unknown';
    const documentName = String(write[operation]?.name || write[operation]?.document || 'unknown')
      .split('/documents/').pop() || 'unknown';
    const attempt: FirestoreCommitAttempt = {
      sequence: attempts.length + 1,
      elapsedMs: Date.now() - startedAt,
      operation,
      document: documentName.replace(userId, '{uid}'),
      updateMask: Array.isArray(write.updateMask?.fieldPaths) ? write.updateMask.fieldPaths : [],
      precondition: Object.keys(write.currentDocument || {}),
      status: null,
    };
    attempts.push(attempt);
    requestAttempts.set(request, attempt);
  });
  page.on('response', (response) => {
    const attempt = requestAttempts.get(response.request());
    if (!attempt) return;
    attempt.status = response.status();
    console.info('[E2E Firestore commit]', JSON.stringify(attempt));
  });
  return attempts;
}

type AuditRecord = {
  id: string; block: string; label: string; currency: string; amount: number;
  snapshotDate: string; note?: string;
};

const mortgagePrincipalLabel = 'Saldo deuda hipotecaria';
const checkpointLabel = 'Checkpoint inicio mes';
const liveRates = { usdClp: 950, eurClp: 1030, ufClp: 38000 };

function nativeAmounts(records: AuditRecord[], monthKey: string) {
  return records.filter((record) => record.snapshotDate.startsWith(`${monthKey}-`) && record.label !== checkpointLabel)
    .map(({ block, label, currency, amount }) => ({ block, label, currency, amount }))
    .sort((a, b) => `${a.block}:${a.label}:${a.currency}`.localeCompare(`${b.block}:${b.label}:${b.currency}`));
}

async function monthStartState(page: Page) {
  return page.evaluate(() => {
    const records = JSON.parse(window.localStorage.getItem('wealth_records_v1') || '[]');
    const checkpoint = records.find((record: { snapshotDate: string; label: string }) =>
      record.snapshotDate.startsWith('2026-08-') && record.label === 'Checkpoint inicio mes');
    return {
      records,
      fx: JSON.parse(window.localStorage.getItem('wealth_fx_v1') || '{}'),
      checkpoint: checkpoint ? JSON.parse(checkpoint.note) : null,
    };
  });
}

async function seedMortgageStart() {
  const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
  const data = (await ref.get()).data()!;
  const added = [
    [mortgagePrincipalLabel, 3000],
    ['Dividendo hipotecario mensual', 20],
    ['Interés hipotecario mensual', 8],
    ['Seguros hipotecarios mensuales', 2],
    ['Amortización hipotecaria mensual', 10],
  ].map(([label, amount], index) => ({
    id: `audit-mortgage-${index}`, block: 'debt', label, amount, currency: 'UF',
    source: 'e2e_fixture', snapshotDate: '2026-07-15', createdAt: '2026-07-15T12:00:00.000Z',
  }));
  await ref.update({ records: [...data.records, ...added, {
    id: 'audit-manual-usd', block: 'bank', label: 'Saldo bancos USD', amount: 1250,
    currency: 'USD', source: 'Manual', snapshotDate: '2026-07-15', createdAt: '2026-07-15T12:00:00.000Z',
  }] });
}

test('preflight summary check remains readable across viewports', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-07-31T12:00:00.000Z'));
  const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Simular cierre / Preflight', exact: true }).click();
  const summaryCheck = page.getByText('sum(targetRecords) == summary', { exact: true });
  await expect(summaryCheck).toBeVisible();
  await expect(summaryCheck.locator('..')).toContainText('ok');
  // Capture the settled screen after the existing transient balance notification.
  await expect(page.locator('.pointer-events-none.fixed.inset-x-0')).toBeHidden();
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await summaryCheck.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`preflight-summary-${viewport.name}.png`) });
    await expect(summaryCheck).toBeVisible();
  }
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('a certified GastApp revision updates the whole Aurum chain automatically and only asks for read acknowledgement', async ({ page }, testInfo) => {
  // This end-to-end scenario covers closure, automatic revision propagation,
  // read acknowledgement, and downstream analysis in one isolated session.
  test.setTimeout(60_000);
  await page.clock.setFixedTime(new Date('2026-07-31T12:00:00.000Z'));
  const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page, '2026-07', true);
  await confirm(page, modal);
  const originalClosure = await cloudClosure('2026-07');
  expect(originalClosure.gastappExpenseClose).toMatchObject({
    schemaVersion: 'aurum-gastapp-monthly-close-v2',
    sourcePath: 'gastapp_aurum_contracts_v2/months_current',
    monthKey: '2026-07',
  });
  await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
  const startReminder = page.locator('div.fixed.inset-0').filter({ hasText: 'Mes cerrado correctamente' });
  await expect(startReminder).toBeVisible();
  await startReminder.getByRole('button', { name: 'Recordarme después', exact: true }).click();
  await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar mes', exact: true })).toBeVisible();

  const previousSnapshot = {
    ...originalClosure.gastappExpenseClose,
    totalEur: 2000,
    operationalRevision:1,sourceGeneration:1,monthContractRevision:1,certificationRevision:1,
    byFamilyEur: { dayToDay: 1800, trips: 100, others: 100 },
    contractHash: `sha256:${'a'.repeat(64)}`,
    monthContractHash: `sha256:${'a'.repeat(64)}`,
    certificationHash: `sha256:${'b'.repeat(64)}`,
  };
  const oldFx = originalClosure.gastappExpenseClose.fxRates;
  const oldEur = { total: 2000, dayToDay: 1800, trips: 100, others: 100 };
  const toCurrency = (factor: number) => Object.fromEntries(
    Object.entries(oldEur).map(([key, value]) => [key, value * factor]),
  );
  previousSnapshot.amountsByCurrency = {
    EUR: oldEur,
    CLP: toCurrency(oldFx.eurClp),
    USD: toCurrency(oldFx.eurClp / oldFx.usdClp),
    UF: toCurrency(oldFx.eurClp / oldFx.ufClp),
  };
  const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
  const root = (await ref.get()).data()!;
  // Entirely synthetic accepted snapshots make 12/36-month consumers testable.
  // These are fixture data; no historical production snapshot is reconstructed.
  const seededClosures = await page.evaluate(async ({ closures, previous, template }) => {
    const path = '/src/services/wealthStorage.ts';
    const { buildGastappMonthlyExpenseCloseSnapshot } = await import(path);
    return closures.map((closure: { monthKey: string; fxRates: typeof rates }) => {
      const totalEur = 2400 + (Number(closure.monthKey.slice(5)) % 12) * 45;
      const snapshot = closure.monthKey === '2026-07' ? previous : buildGastappMonthlyExpenseCloseSnapshot({
        ...template, monthKey: closure.monthKey, calendarMonthKey: closure.monthKey,
        totalEur, byFamilyEur: { dayToDay: totalEur, trips: 0, others: 0 },
      }, closure.fxRates);
      return { ...closure, gastappExpenseClose: snapshot };
    });
  }, { closures: root.closures, previous: previousSnapshot, template: originalClosure.gastappExpenseClose });
  await ref.update({ closures: seededClosures });
  await page.evaluate((closures) => {
    window.localStorage.setItem('wealth_closures_v1', JSON.stringify(closures));
    window.localStorage.removeItem('aurum.gastapp.revision.notice.ack.v1');
  }, seededClosures);

  // Capture the synthetic old chain directly from storage before reloading.
  // Reloading Aurum is now enough to trigger the app-wide automatic sync.
  const beforeChain = await readAcceptedChain(page);
  expect(beforeChain.monthSpendEur).toBe(2000);

  await page.reload();
  await page.goto('/#/patrimonio');
  await expect(page.getByRole('button', { name: 'Cerrar mes', exact: true })).toBeVisible();
  const sourceFixture = await page.evaluate(async () => {
    const sourcePath = '/src/services/gastosMonthly.ts';
    const revisionPath = '/src/services/acceptReviewedGastappRevision.ts';
    const { resolveGastappMonthlyCloseCandidate } = await import(sourcePath);
    const { isGastappAutomaticRevisionSyncEnabled } = await import(revisionPath);
    return { enabled: isGastappAutomaticRevisionSyncEnabled(), candidate: resolveGastappMonthlyCloseCandidate('2026-07').snapshot };
  });
  expect(sourceFixture).toMatchObject({ enabled: true, candidate: { contractVersion: 'gastapp-aurum-calendar-months-v2', certificationRevision: 2 } });
  await expect.poll(async () => (await cloudClosure('2026-07')).gastappExpenseClose?.totalEur).toBe(2715);
  const revisionAlert = page.getByText('GastApp actualizó cierres de aurum', { exact: true });
  await expect(revisionAlert).toBeVisible();
  const revisionSection = page.locator('section[aria-live="polite"]').filter({ hasText: 'La corrección ya está aplicada.' });
  await expect(revisionSection).toContainText('Antes: 2000,00 €');
  await expect(revisionSection).toContainText('Ahora: 2715,00 €');
  await expect(revisionSection).toContainText('Diferencia: 715,00 €');
  await expect(page.getByRole('button', { name: 'Aceptar y actualizar cadena', exact: true })).toHaveCount(0);

  // The global and detailed views share the same cloud hash acknowledgement;
  // reading the global notice must suppress the duplicate detail in Patrimonio.
  const groupedNotice = page.getByRole('dialog', { name: 'Cambios financieros aplicados', exact: true });
  await expect(groupedNotice).toBeVisible();
  await expect(groupedNotice).toContainText('Julio de 2026');
  const appliedBeforeAcknowledgement = await cloudClosure('2026-07');
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(groupedNotice).toBeVisible();
    const dialogBox = await groupedNotice.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath(`gastapp-revision-global-${viewport.name}.png`) });
  }
  await groupedNotice.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(groupedNotice).toHaveCount(0);
  expect(await cloudClosure('2026-07')).toEqual(appliedBeforeAcknowledgement);
  await expect(revisionSection).toHaveCount(0);
  const acknowledgedUserState = (await ref.get()).data()!;
  expect(acknowledgedUserState.gastappRevisionNoticeSeenV1).toMatchObject({
    '2026-07': appliedBeforeAcknowledgement.gastappExpenseClose.contractHash,
  });
  const acknowledgementUpdateTime = (await ref.get()).updateTime?.toMillis();
  await page.evaluate(async (contractHash) => {
    const { acknowledgeGastappRevisionNotices } = await import('/src/services/wealthStorage.ts');
    await Promise.all(Array.from({ length: 3 }, () => acknowledgeGastappRevisionNotices([
      { monthKey: '2026-07', contractHash },
    ])));
  }, appliedBeforeAcknowledgement.gastappExpenseClose.contractHash);
  expect((await ref.get()).updateTime?.toMillis()).toBe(acknowledgementUpdateTime);

  const updated = await cloudClosure('2026-07');
  expect(updated.gastappExpenseClose.totalEur).toBe(2715);
  expect(updated.gastappExpenseClose.certificationRevision).toBe(2);
  expect(updated.summary).toEqual(originalClosure.summary);
  expect(updated.records).toEqual(originalClosure.records);
  expect(updated.fxRates).toEqual(originalClosure.fxRates);
  expect(updated.previousVersions.some((version: { gastappExpenseClose?: { contractHash: string; totalEur: number } }) =>
    version.gastappExpenseClose?.contractHash === previousSnapshot.contractHash && version.gastappExpenseClose.totalEur === 2000)).toBe(true);

  // Exercise the one-time migration of the old per-device acknowledgement.
  // It must write the exact current hash to the shared field and suppress both
  // views after the closure is rehydrated from Firestore.
  const appliedHash = appliedBeforeAcknowledgement.gastappExpenseClose.contractHash;
  await ref.update({ gastappRevisionNoticeSeenV1: {} });
  await page.evaluate((contractHash) => {
    window.localStorage.setItem('aurum.gastapp.revision.notice.ack.v1', JSON.stringify([`2026-07::${contractHash}`]));
    window.localStorage.removeItem('wealth_closures_v1');
  }, appliedHash);
  await page.reload();
  await page.goto('/#/patrimonio');
  await expect(page.getByRole('button', { name: 'Cerrar mes', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Cambios financieros aplicados', exact: true })).toHaveCount(0);
  await expect(page.getByText('GastApp actualizó cierres de aurum', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await ref.get()).data()?.gastappRevisionNoticeSeenV1?.['2026-07']).toBe(appliedHash);
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('aurum.gastapp.revision.notice.ack.v1'))).toBeNull();
  expect(await cloudClosure('2026-07')).toEqual(updated);

  // All consumers now read the automatically accepted snapshot even though
  // wealth records, the sealed summary and FX never changed.
  const analysisPage = await page.context().newPage();
  await analysisPage.clock.setFixedTime(new Date('2026-07-31T12:00:00.000Z'));
  analysisPage.on('pageerror', (error) => pageErrors.push(error.message));
  analysisPage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const analysisGuard = await installLocalNetworkGuard(analysisPage);
  await analysisPage.goto('/#/analysis');
  await analysisPage.locator('[aria-label="Moneda"]').getByRole('button', { name: 'EUR', exact: true }).click();
  const julyRow = analysisPage.getByRole('row').filter({ has: analysisPage.getByText('Jul 2026', { exact: true }) });
  await expect(julyRow.locator('td').nth(4)).toHaveText('2.715,00 EUR');
  const afterChain = await readAcceptedChain(analysisPage);
  expect(afterChain.monthSpendEur).toBe(2715);
  expect(afterChain.accumulatedSpendClp - beforeChain.accumulatedSpendClp).toBe(715 * rates.eurClp);
  expect(afterChain.labSpendClp - beforeChain.labSpendClp).toBe(715 * rates.eurClp);
  expect(afterChain.dashboard12Uf).not.toBe(beforeChain.dashboard12Uf);
  expect(afterChain.dashboard36Uf).not.toBe(beforeChain.dashboard36Uf);
  expect(afterChain.presentation36Uf).toBe(Number(afterChain.dashboard36Uf.toFixed(1)));
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await analysisPage.setViewportSize(viewport);
    await julyRow.scrollIntoViewIfNeeded();
    await analysisPage.screenshot({ path: testInfo.outputPath(`gastapp-revised-analysis-${viewport.name}.png`) });
    expect(await analysisPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await attachEvidence(testInfo, { beforeChain, afterChain, updated });
  await analysisGuard.assertClean(testInfo);
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('cross-app shared scenario applies GastApp revision, acknowledges once and persists Aurum inputs for MIDAS', async ({ page, browser }, testInfo) => {
  const scenario = readSharedScenario();
  test.skip(!scenario, 'Requiere el orquestador E2E transversal y el handoff sintético de GastApp.');
  test.setTimeout(90_000);
  const monthKey = scenario!.monthKey as string;
  const initial = scenario!.gastapp.initialContract;
  const current = scenario!.gastapp.currentContract;
  expect(current.totalEur).toBeGreaterThan(initial.totalEur);
  expect(current.contractHash).not.toBe(initial.contractHash);
  expect(scenario!.expense).toMatchObject({ amountEur: 25, category: 'cross-app-transit' });
  const firestoreCommitSequence = observeFirestoreCommits(page, uid);
  const upstreamApp = getApps().find(app => app.name === 'cross-upstream') || initializeApp({ projectId: 'gastapp-e2e-local' }, 'cross-upstream');
  const upstream = getFirestore(upstreamApp);
  const rules = readFileSync(resolve(process.env.GASTAPP_REPO_DIR!, 'firestore.rules'), 'utf8');
  const rulesResponse = await fetch('http://127.0.0.1:8080/emulator/v1/projects/gastapp-e2e-local:securityRules', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
  });
  expect(rulesResponse.ok).toBe(true);
  // The shared Auth Emulator uses its configured aurum-e2e-local namespace;
  // the independently authorized GastApp reader has its own signed-in user.
  const upstreamAuthApp = getApps().find(app => app.name === 'cross-upstream-auth') || initializeApp({ projectId: 'aurum-e2e-local' }, 'cross-upstream-auth');
  const upstreamAuth = getAuth(upstreamAuthApp);
  try { await upstreamAuth.createUser({ uid: 'gastapp-e2e-user', email: 'gastapp-e2e@example.test', password: 'gastapp-e2e-password' }); } catch (error: any) { if (error.code !== 'auth/uid-already-exists') throw error; }
  await upstream.doc('authorized_users/gastapp-e2e@example.test').set({ active: true, role: 'admin' });
  const writeRawUpstream = async (documents: Record<string, any>) => {
    const batch = upstream.batch(); for (const [path, document] of Object.entries(documents)) batch.set(upstream.doc(path), document);
    await batch.commit();
  };
  await writeRawUpstream(scenario!.gastapp.initialDocuments);
  const publicationRef = emulatorDb().doc('aurum_published/optimizableInvestments');
  await publicationRef.set({ publishedByUid: uid });

  await page.clock.setFixedTime(new Date('2026-07-31T12:00:00.000Z'));
  const rootRef = emulatorDb().doc(`aurum_wealth/${uid}`);
  const rootBeforeBrowser = (await rootRef.get()).data()!;
  const juneTemplate = rootBeforeBrowser.closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-06');
  if (!juneTemplate) throw new Error('Aurum emulator seed is missing the June closure template.');
  const economicDate = '2026-07-31';
  const convert = (factor: number) => Object.fromEntries(
    Object.entries({ total: initial.totalEur, ...initial.byFamilyEur }).map(([key, value]) => [key, Number(value) * factor]),
  );
  const initialSnapshot = {
    ...initial,
    schemaVersion: 'aurum-gastapp-monthly-close-v2',
    sourcePath: 'gastapp_aurum_contracts_v2/months_current',
    capturedAt: '2026-07-31T12:00:00.000Z',
    fxRates: rates,
    amountsByCurrency: {
      EUR: { total: initial.totalEur, ...initial.byFamilyEur },
      CLP: convert(rates.eurClp),
      USD: convert(rates.eurClp / rates.usdClp),
      UF: convert(rates.eurClp / rates.ufClp),
    },
  };
  const seededRecords = (juneTemplate.records || []).map((record: any) => ({
    ...record,
    id: `cross-app-${record.id}`,
    snapshotDate: String(record.snapshotDate || '').replace(/^\d{4}-\d{2}/, monthKey),
    createdAt: String(record.createdAt || '').replace(/^\d{4}-\d{2}/, monthKey),
  }));
  const seededClosure = {
    ...juneTemplate,
    id: 'cross-app-synthetic-closure',
    monthKey,
    closedAt: `${economicDate}T12:00:00.000Z`,
    records: seededRecords,
    summary: calculateHistoricalClosureSummary(seededRecords, rates),
    fxRates: { ...rates },
    fxMetadata: {
      economicMonthKey: monthKey,
      economicDate,
      usedFxRates: { ...rates },
      rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
      source: { usd: 'synthetic-e2e', eur: 'synthetic-e2e', uf: 'synthetic-e2e' },
      retrievedAt: `${economicDate}T12:00:00.000Z`,
    },
    gastappExpenseClose: initialSnapshot,
    previousVersions: [],
  };
  // Seed the synthetic closure before opening Aurum so browser autosync cannot
  // race a test-only Admin SDK write. The fixture is isolated to the emulator.
  await rootRef.update({ closures: [seededClosure, ...rootBeforeBrowser.closures] });
  const { networkGuard, pageErrors, consoleErrors } = await prepare(page, monthKey, false, undefined, false);
  await expect.poll(async () => (await cloudClosure(monthKey)).gastappExpenseClose?.contractHash).toBe(initial.contractHash);
  const before = await cloudClosure(monthKey);
  expect(before.id).toBe(seededClosure.id);
  expect(before.gastappExpenseClose).toMatchObject({
    contractHash: initial.contractHash,
    totalEur: initial.totalEur,
    certificationRevision: initial.certificationRevision,
  });
  const beforeChain = await readAcceptedChain(page);
  expect(beforeChain.monthSpendEur).toBe(initial.totalEur);

  const browserSyncSettled = async () => {
    const status = await page.evaluate(async () => {
      const { loadWealthSyncUiState } = await import('/src/services/wealthStorage.ts');
      return loadWealthSyncUiState().status;
    });
    return status === 'synced' && firestoreCommitSequence.length > 0
      && firestoreCommitSequence.every((attempt) => attempt.status !== null);
  };
  await expect.poll(browserSyncSettled, { timeout: 15_000 }).toBe(true);
  const settledCommitCount = firestoreCommitSequence.length;
  await page.waitForTimeout(200);
  await expect.poll(browserSyncSettled, { timeout: 15_000 }).toBe(true);
  expect(firestoreCommitSequence).toHaveLength(settledCommitCount);

  await writeRawUpstream(scenario!.gastapp.currentDocuments);
  await page.evaluate(async () => {
    const source = await import('/src/services/gastosMonthly.ts');
    await source.refreshGastappMonthlyContable();
    const candidate = source.resolveGastappMonthlyCloseCandidate('2026-07');
    if (!candidate.snapshot) throw new Error(candidate.message);
  });
  const partialMay = await page.evaluate(async () => {
    const source = await import('/src/services/gastosMonthly.ts');
    return source.resolveGastappMonthlyCloseCandidate('2023-05');
  });
  expect(partialMay.snapshot).toBeNull();
  expect(partialMay.partialGastosEur).toBe(scenario!.gastapp.partialMayCoverage.amountEur);
  expect(partialMay.status).not.toBe('complete');
  await expect.poll(async () => (await cloudClosure(monthKey)).gastappExpenseClose?.contractHash).toBe(current.contractHash);
  const notice = page.getByRole('dialog', { name: 'Cambios financieros aplicados', exact: true });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Julio de 2026');
  await expect(notice).toContainText('Gastos anteriores');
  await expect(notice).toContainText('99,00 €');
  await expect(notice).toContainText('Gastos actualizados');
  await expect(notice).toContainText('104,00 €');

  const updated = await cloudClosure(monthKey);
  expect(updated.gastappExpenseClose).toMatchObject({
    contractHash: current.contractHash,
    totalEur: current.totalEur,
    certificationRevision: current.certificationRevision,
  });
  expect(updated.summary).toEqual(before.summary);
  expect(updated.records).toEqual(before.records);
  expect(updated.fxRates).toEqual(before.fxRates);
  expect(updated.previousVersions.some((version: any) =>
    version.gastappExpenseClose?.contractHash === initial.contractHash
      && version.gastappExpenseClose?.totalEur === initial.totalEur)).toBe(true);

  await notice.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect.poll(async () => (await rootRef.get()).data()?.gastappRevisionNoticeSeenV1?.[monthKey]).toBe(current.contractHash);
  await page.reload();
  // Let the real secondary Firebase sign-in finish before another navigation.
  // Navigating immediately after load aborts its top-level module request.
  await page.evaluate(async () => {
    const source = await import('/src/services/gastosMonthly.ts');
    await source.refreshGastappMonthlyContable();
  });
  await page.evaluate(() => { window.location.hash = '/patrimonio'; });
  await expect(page.getByRole('button', { name: 'Cerrar mes', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Cambios financieros aplicados', exact: true })).toHaveCount(0);
  expect((await cloudClosure(monthKey)).gastappExpenseClose.contractHash).toBe(current.contractHash);

  await page.evaluate(() => { window.location.hash = '/analysis'; });
  await page.locator('[aria-label="Moneda"]').getByRole('button', { name: 'EUR', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByText('Jul 2026', { exact: true }) });
  await expect(row.locator('td').nth(4)).toHaveText('104,00 EUR');
  const chain = await readAcceptedChain(page);
  expect(chain.monthSpendEur).toBe(current.totalEur);
  expect(chain.accumulatedSpendClp - beforeChain.accumulatedSpendClp).toBeCloseTo(
    (current.totalEur - initial.totalEur) * rates.eurClp,
    4,
  );
  expect(chain.labSpendClp - beforeChain.labSpendClp).toBeCloseTo(
    (current.totalEur - initial.totalEur) * rates.eurClp,
    4,
  );
  expect(Number.isFinite(chain.dashboard12Uf)).toBe(true);

  await page.getByRole('button', { name: 'Mostrar secciones de Análisis', exact: true }).click();
  await page.getByRole('button', { name: 'Rendimiento', exact: true }).click();
  await page.getByText('Revisar validación del período', { exact: true }).click();
  await page.getByRole('button', { name: 'No hubo otros flujos este mes', exact: true }).click();
  await expect(page.getByText('RECONSTRUIDO', { exact: true })).toBeVisible();
  const positionMovements = page.getByRole('checkbox', {
    name: 'Confirmo que aurum registra todas las compras, ventas y traslados de posición de este período.',
  });
  await positionMovements.uncheck();
  await page.getByRole('button', { name: 'Guardar confirmación', exact: true }).click();
  await expect(page.getByText('Rentabilidad financiera · INDICATIVA', { exact: true })).toBeVisible();
  await expect(page.getByTestId('financial-performance-published-value')).not.toHaveText('—');
  await expect(page.getByRole('note')).toContainText('falta validar movimientos internos de posiciones y atribuciones');

  const cloud = (await rootRef.get()).data()!;
  const acceptedClosure = await cloudClosure(monthKey);
  const httpResults: any[] = [];
  page.on('response', async response => {
    if (new URL(response.url()).pathname === '/api/midas/publish-snapshot') {
      httpResults.push({ status: response.status(), payload: await response.json() });
    }
  });
  await publicationRef.set({ publishedByUid: uid });
  const publish = async (closure: any, concurrent = false) => {
    await rootRef.update({ closures: [closure, ...cloud.closures.filter((value: any) => value.monthKey !== monthKey)] });
    const results = await page.evaluate(async ({ closure, concurrent }) => {
      const { publishAurumOptimizableInvestmentsSnapshot } = await import('/src/services/midasPublished.ts');
      const run = () => publishAurumOptimizableInvestmentsSnapshot([closure]);
      return concurrent ? Promise.all([run(), run()]) : [await run()];
    }, { closure, concurrent });
    expect(results.every(value => value.ok)).toBe(true);
    return (await publicationRef.get()).data()!;
  };
  const publishedSnapshot = await publish(acceptedClosure, true);
  await expect.poll(() => httpResults.length).toBeGreaterThanOrEqual(2);
  expect(httpResults.slice(0, 2).map(value => value.payload.result).sort()).toEqual(['published', 'unchanged']);
  const firstTime = (await publicationRef.get()).updateTime!.toMillis();
  const expenseOnly = await publish({ ...acceptedClosure, gastappExpenseClose: { ...acceptedClosure.gastappExpenseClose, totalEur: current.totalEur + 1 } });
  expect((await publicationRef.get()).updateTime!.toMillis()).toBe(firstTime);
  const records = acceptedClosure.records.map((record: any) => record.block === 'real_estate' && record.label.toLowerCase().includes('valor propiedad')
    ? { ...record, amount: record.amount + 20000000 } : record);
  const revisedClosure = { ...acceptedClosure, records, summary: calculateHistoricalClosureSummary(records, acceptedClosure.fxRates) };
  const patrimonial = await publish(revisedClosure);
  const ownerToken = await page.evaluate(async () => {
    const { auth } = await import('/src/services/firebase.ts');
    if (!auth.currentUser) throw new Error('Synthetic publisher session is missing');
    return auth.currentUser.getIdToken();
  });
  const beforeStaleRequest = await publicationRef.get();
  const staleRequest = await page.request.post('/api/midas/publish-snapshot', {
    headers: { Authorization: `Bearer ${ownerToken}` }, data: { snapshot: { ...publishedSnapshot, publishedAt: '2099-01-01T00:00:00Z' } },
  });
  expect(staleRequest.status()).toBe(409);
  const stalePayload = await staleRequest.json();
  expect(stalePayload.code).toBe('source_changed');
  expect((await publicationRef.get()).updateTime!.toMillis()).toBe(beforeStaleRequest.updateTime!.toMillis());
  // Exercise the real HTTP handler and real Auth Emulator tokens for rejection too.
  const noAuth = await page.request.post('/api/midas/publish-snapshot', { data: { snapshot: publishedSnapshot } });
  expect(noAuth.status()).toBe(401);
  const unauthorized = await page.request.post('/api/midas/publish-snapshot', { headers: { Authorization: 'Bearer invalid-synthetic-token' }, data: { snapshot: publishedSnapshot } });
  expect(unauthorized.status()).toBe(401);
  const intruder = await page.request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-local-key', {
    data: { returnSecureToken: true },
  });
  expect(intruder.ok()).toBe(true);
  const intruderIdentity = await intruder.json();
  await emulatorDb().doc(`aurum_wealth/${intruderIdentity.localId}`).set({ closures: [revisedClosure] });
  const beforeUnauthorized = await publicationRef.get();
  const forbidden = await page.request.post('/api/midas/publish-snapshot', {
    headers: { Authorization: `Bearer ${intruderIdentity.idToken}` }, data: { snapshot: patrimonial },
  });
  expect(forbidden.status()).toBe(403);
  const forbiddenPayload = await forbidden.json();
  expect(forbiddenPayload.code).toBe('publisher_forbidden');
  expect((await publicationRef.get()).updateTime!.toMillis()).toBe(beforeUnauthorized.updateTime!.toMillis());
  await emulatorDb().doc(`aurum_wealth/${intruderIdentity.localId}`).delete();
  await upstreamAuth.deleteUser(intruderIdentity.localId);
  const output = {
    ...scenario,
    aurum: {
      monthKey,
      closure: acceptedClosure,
      publishedSnapshot, publicationVariants: { expenseOnly, patrimonial },
      publicationHttpResults: httpResults,
      publicationRejections: {
        stale: { status: staleRequest.status(), code: stalePayload.code },
        noCredentials: { status: noAuth.status() }, invalidCredentials: { status: unauthorized.status() },
        unauthorizedUser: { status: forbidden.status(), code: forbiddenPayload.code },
      },
      records: cloud.records,
      fx: cloud.fx,
      sourceContractHash: current.contractHash,
      acceptedSpendEur: current.totalEur,
      acceptedCertificationRevision: current.certificationRevision,
      noticeSeenHash: cloud.gastappRevisionNoticeSeenV1?.[monthKey] || null,
      partialMay: { status: partialMay.status, partialGastosEur: partialMay.partialGastosEur, snapshot: partialMay.snapshot },
    },
  };
  const path = resolve(sharedScenarioPath!);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(output, null, 2), { mode: 0o600 });
  await testInfo.attach('cross-app-aurum-handoff.json', { body: JSON.stringify(output, null, 2), contentType: 'application/json' });
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(firestoreCommitSequence.filter((attempt) => (attempt.status || 0) >= 400)).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // Repeat the historical reads from a fresh session with no embedded snapshot.
  // Close the first session before moving this synthetic fixture to avoid a
  // stale autosync write racing the deliberate Admin-only fixture change.
  await page.close();
  const rootWithAccepted = (await rootRef.get()).data()!;
  const sidecarRef = rootRef.collection('gastapp_snapshots').doc('historical_v1');
  // Use the original accepted perimeter, not the later property-change
  // publication variant, so its persisted indicative confirmation still fits.
  const historicalClosure = acceptedClosure;
  const sidecarSnapshot = historicalClosure.gastappExpenseClose;
  expect(sidecarSnapshot.contractHash).toBe(current.contractHash);
  const closureWithoutSnapshot = { ...historicalClosure };
  delete closureWithoutSnapshot.gastappExpenseClose;
  await sidecarRef.set({ schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: {
    [monthKey]: { closureId: historicalClosure.id, snapshot: sidecarSnapshot, repairAudit: {
      reason: 'historical_schema_compatibility_reconstruction', reconstructedAt: '2026-07-31T12:00:00.000Z',
      originalClosureAt: historicalClosure.closedAt, preFingerprint: 'synthetic-unchanged', postFingerprint: 'synthetic-unchanged',
      sourceContractHash: current.contractHash,
    } },
  } });
  await rootRef.update({ closures: rootWithAccepted.closures.map((value: any) => value.monthKey === monthKey ? closureWithoutSnapshot : value) });
  // A different page shares localStorage; use an actually fresh device.
  const sidecarContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  try {
  const sidecarPage = await sidecarContext.newPage();
  await sidecarPage.clock.setFixedTime(new Date('2026-07-31T12:00:00.000Z'));
  const sidecarChecks = await prepare(sidecarPage, monthKey, false, undefined, false);
  const waitForSidecar = async () => {
    await expect.poll(() => sidecarPage.evaluate(async () => {
      const storage = await import('/src/services/wealthStorage.ts');
      const sidecar = await import('/src/services/historicalGastappSidecar.ts');
      const closure = storage.loadClosures().find((value: any) => value.monthKey === '2026-07');
      return closure ? { embedded: Boolean(closure.gastappExpenseClose), hash: sidecar.resolveAcceptedGastappSnapshot(closure)?.contractHash } : null;
    })).toEqual({ embedded: false, hash: current.contractHash });
  };
  await waitForSidecar();
  for (const reload of [false, true]) {
    if (reload) {
      await sidecarPage.reload();
      await waitForSidecar();
    }
    await sidecarPage.evaluate(() => { window.location.hash = '/analysis'; });
    const effective = await readAcceptedChain(sidecarPage);
    expect(effective.monthSpendEur).toBe(104);
    expect(effective.labSpendClp).toBe(104 * rates.eurClp);
    expect(effective.accumulatedSpendClp).toBe(chain.accumulatedSpendClp);
    await sidecarPage.getByRole('button', { name: 'Mostrar secciones de Análisis', exact: true }).click();
    await sidecarPage.getByRole('button', { name: 'Rendimiento', exact: true }).click();
    await expect(sidecarPage.getByText('Rentabilidad financiera · INDICATIVA', { exact: true })).toBeVisible();
    await expect(sidecarPage.getByTestId('financial-performance-published-value')).not.toHaveText('—');
  }
  expect(await cloudClosure(monthKey)).toEqual(closureWithoutSnapshot);
  await sidecarChecks.networkGuard.assertClean(testInfo);
  expect(sidecarChecks.pageErrors).toEqual([]);
  expect(sidecarChecks.consoleErrors).toEqual([]);
  // Deny only the upstream reader using the actual GastApp Rules. Accepted
  // historical consumption must survive a failed live refresh unchanged.
  const authorizedReader = upstream.doc('authorized_users/gastapp-e2e@example.test');
  try {
    await authorizedReader.update({ active: false });
    const unavailable = await sidecarPage.evaluate(async () => {
      const source = await import('/src/services/gastosMonthly.ts');
      let rejection: string | null = null;
      try { await source.refreshGastappMonthlyContable(); }
      catch (error) { rejection = error instanceof Error ? error.message : String(error); }
      return { rejection, candidate: source.resolveGastappMonthlyCloseCandidate('2026-07') };
    });
    expect(unavailable.rejection).toBe('La sesión autorizada de GastApp no tiene permiso de lectura para este documento.');
    expect(unavailable.candidate.status).toBe('unavailable');
    expect(unavailable.candidate.snapshot).toBeNull();
    const retained = await readAcceptedChain(sidecarPage);
    expect(retained.monthSpendEur).toBe(104);
    expect(retained.labSpendClp).toBe(104 * rates.eurClp);
    await expect(sidecarPage.getByTestId('financial-performance-published-value')).not.toHaveText('—');
    expect(sidecarChecks.consoleErrors.length).toBeGreaterThan(0);
    expect(sidecarChecks.consoleErrors.every(message => /GastApp|permission|insufficient/i.test(message))).toBe(true);
    expect(sidecarChecks.pageErrors).toEqual([]);
    expect(await cloudClosure(monthKey)).toEqual(closureWithoutSnapshot);
  } finally { await authorizedReader.update({ active: true }); }
  await sidecarChecks.networkGuard.assertClean(testInfo);
  } finally { await sidecarContext.close(); }
});
test('accepted GastApp snapshots survive reload and match Dashboard and presentation', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-08-01T12:00:00.000Z'));
  const firestoreCommitSequence = observeFirestoreCommits(page, uid);
  const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const appSyncIsSettled = async () => {
    const status = await page.evaluate(async () => {
      const { loadWealthSyncUiState } = await import('/src/services/wealthStorage.ts');
      return loadWealthSyncUiState().status;
    });
    return status === 'synced' && firestoreCommitSequence.length > 0
      && firestoreCommitSequence.every((attempt) => attempt.status !== null);
  };
  await expect.poll(appSyncIsSettled, { timeout: 15_000 }).toBe(true);
  const settledCommitCount = firestoreCommitSequence.length;
  // The fixture below updates the cloud document through Admin SDK. Let initial
  // app defaults/autosync finish first so this deliberate out-of-band seed cannot
  // race a stale transaction from startup.
  await page.waitForTimeout(200);
  await expect.poll(appSyncIsSettled, { timeout: 15_000 }).toBe(true);
  expect(firestoreCommitSequence).toHaveLength(settledCommitCount);
  const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
  const root = (await ref.get()).data()!;
  const seededClosures = await page.evaluate(async ({ closures, records, fx }) => {
    const storagePath = '/src/services/wealthStorage.ts';
    const gastosPath = '/src/services/gastosMonthly.ts';
    const { buildGastappMonthlyExpenseCloseSnapshot, buildCanonicalClosureSummary } = await import(storagePath);
    const { resolveGastappMonthlyCloseCandidate } = await import(gastosPath);
    const template = resolveGastappMonthlyCloseCandidate('2026-07').snapshot;
    const june = closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-06');
    const july = {
      ...june, id: 'synthetic-accepted-july', monthKey: '2026-07', closedAt: '2026-08-01T12:00:00.000Z',
      records, summary: buildCanonicalClosureSummary(records, fx), fxRates: fx,
      fxMetadata: { ...june.fxMetadata, economicMonthKey: '2026-07', economicDate: '2026-07-31', usedFxRates: fx },
    };
    return [...closures, july].map((closure) => {
      const totalEur = 2400 + (Number(closure.monthKey.slice(5)) % 12) * 45;
      return { ...closure, gastappExpenseClose: buildGastappMonthlyExpenseCloseSnapshot({
        ...template, monthKey: closure.monthKey, calendarMonthKey: closure.monthKey,
        totalEur, byFamilyEur: { dayToDay: totalEur, trips: 0, others: 0 },
      }, closure.fxRates) };
    });
  }, { closures: root.closures, records: root.records, fx: rates });
  console.info('[E2E Firestore fixture] admin update aurum_wealth/{uid} fields=closures');
  await ref.update({ closures: seededClosures });
  console.info('[E2E Firestore fixture] admin update complete aurum_wealth/{uid}');
  await page.goto('/#/analysis');
  await page.locator('[aria-label="Moneda"]').getByRole('button', { name: 'EUR', exact: true }).click();
  const julyRow = page.getByRole('row').filter({ has: page.getByText('Jul 2026', { exact: true }) });
  await expect(julyRow.locator('td').nth(4)).toHaveText('2.715,00 EUR');
  const expected = await readAcceptedChain(page);
  const saved = await cloudClosure('2026-07');
  await page.reload();
  await page.locator('[aria-label="Moneda"]').getByRole('button', { name: 'EUR', exact: true }).click();
  await expect(julyRow.locator('td').nth(4)).toHaveText('2.715,00 EUR');
  expect(await readAcceptedChain(page)).toEqual(expected);
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('dashboard-return-12m')).toContainText(expected.dashboard12UfText);
  await expect(page.getByTestId('dashboard-return-36m')).toContainText(expected.dashboard36UfText);
  await page.goto('/#/presentation');
  await expect(page.getByTestId('aurum-presentation')).toContainText(expected.presentation36UfText);
  expect(await cloudClosure('2026-07')).toEqual(saved);
  await attachEvidence(testInfo, { expected, saved, firestoreCommitSequence });
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('legacy close expenses stay explicitly unavailable without rebuilding history', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-07-31T12:00:00.000Z'));
  const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  // Hydration enriches old synthetic summaries before cloud sync settles.
  // Establish that full baseline before testing the Analysis navigation.
  const ordered = (closures: Array<{ monthKey: string }>) => [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const before = await page.evaluate(() => JSON.parse(window.localStorage.getItem('wealth_closures_v1') || '[]'));
  expect(before).toHaveLength(38);
  await expect.poll(async () => ordered((await emulatorDb().doc(`aurum_wealth/${uid}`).get()).get('closures'))).toEqual(ordered(before));
  await page.goto('/#/analysis');
  await page.getByRole('button', { name: /Avisos ·/ }).click();
  const warning = page.getByText(/Meses cerrados sin una versión de GastApp confirmada y guardada en aurum:/);
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('ni se reconstruye el histórico automáticamente');
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await warning.scrollIntoViewIfNeeded();
    const statusText = page.getByRole('button', { name: /Avisos ·/ }).getByText(/^Avisos ·/);
    expect(await statusText.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`legacy-expense-warning-${viewport.name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  // Sync normalizes array order; compare every complete close by month identity.
  expect(ordered((await emulatorDb().doc(`aurum_wealth/${uid}`).get()).get('closures'))).toEqual(ordered(before));
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

async function seedSeptemberAudit() {
  await seedMortgageStart();
  const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
  const root = (await ref.get()).data()!;
  const june = root.closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-06');
  const august = {
    ...june, id: 'synthetic-august-before-september', monthKey: '2026-08', closedAt: '2026-09-01T12:00:00.000Z',
    fxMetadata: { ...june.fxMetadata, economicMonthKey: '2026-08', economicDate: '2026-08-31' },
    records: june.records.map((record: AuditRecord) => ({ ...record, id: `august-${record.id}`, snapshotDate: '2026-08-31' })),
  };
  const septemberRecords = root.records.map((record: AuditRecord) => ({
    ...record, id: `september-${record.id}`, snapshotDate: '2026-09-30', createdAt: '2026-09-30T12:00:00.000Z',
  }));
  await ref.update({ records: septemberRecords, closures: [...root.closures, august] });
  return ref;
}

test('September preflight compares its own freshness despite different October values', async ({ page }, testInfo) => {
  const ref = await seedSeptemberAudit();
  const root = (await ref.get()).data()!;
  const tenencia = { block: 'investment', source: 'manual', label: 'Tenencia / CxC', currency: 'CLP' };
  await ref.update({ records: [
    ...root.records,
    { ...tenencia, id: 'september-tenencia', amount: 16_497_820, snapshotDate: '2026-09-30', createdAt: '2026-09-30T12:00:00Z' },
    { ...tenencia, id: 'october-tenencia', amount: 31_539_950, snapshotDate: '2026-10-03', createdAt: '2026-10-03T12:00:00Z' },
  ] });
  await page.clock.setFixedTime(new Date('2026-10-03T12:00:00.000Z'));
  const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page, '2026-09');
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('combobox').selectOption('2026-09');
  await page.getByRole('button', { name: 'Simular cierre / Preflight', exact: true }).click();
  await expect(page.getByText('Final al', { exact: false })).toHaveCount(3);
  await page.getByRole('checkbox', { name: /tasas utilizadas corresponden al cierre económico de septiembre/i }).check();
  await expect(page.getByText('GO PARA CERRAR', { exact: true })).toBeVisible();
  const freshnessCheck = page.getByText('Frescura y cierre usan mismos assets materiales o diferencia explicada', { exact: true }).locator('..');
  await expect(freshnessCheck).toContainText('ok');
  await expect(page.getByText(/Tenencia \/ CxC: freshness/)).toHaveCount(0);
  await expect(page.getByText(/Inversiones actualizadas.*Bienes raíces actualizados/)).toBeHidden();
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await freshnessCheck.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: testInfo.outputPath(`september-freshness-${viewport.name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  const after = (await ref.get()).data()!;
  expect(after.records.find((record: AuditRecord) => record.id === 'september-tenencia')).toMatchObject({ amount: 16_497_820, snapshotDate: '2026-09-30' });
  expect(after.records.find((record: AuditRecord) => record.id === 'october-tenencia')).toMatchObject({ amount: 31_539_950, snapshotDate: '2026-10-03' });
  expect(after.closures.some((closure: { monthKey: string }) => closure.monthKey === '2026-09')).toBe(false);
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('September close seals its own GastApp snapshot and prepares October without changing history', async ({ page }, testInfo) => {
  const ref = await seedSeptemberAudit();
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00.000Z'));
  const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page, '2026-09');
  const augustBeforeClose = await page.evaluate(async () => {
    const storagePath = '/src/services/wealthStorage.ts';
    return (await import(storagePath)).loadClosures().find((closure: { monthKey: string }) => closure.monthKey === '2026-08');
  });
  await expect.poll(() => cloudClosure('2026-08')).toEqual(augustBeforeClose);
  const preview = await previewAmounts(modal);
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('combobox').selectOption('2026-09');
  await page.getByRole('button', { name: 'Simular cierre / Preflight', exact: true }).click();
  // Capture the settled view after the normal, non-interactive update toast.
  await expect(page.getByText(/Inversiones actualizadas.*Bienes raíces actualizados/)).toBeHidden();
  await expect(page.getByText('Final al', { exact: false })).toHaveCount(3);
  await page.getByRole('checkbox', { name: /tasas utilizadas corresponden al cierre económico de septiembre/i }).check();
  await expect(page.getByText('GO PARA CERRAR', { exact: true })).toBeVisible();
  await expect(page.getByText(/GastApp cerró 2026-09 con/)).toBeVisible();
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByText('GO PARA CERRAR', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`september-preflight-${viewport.name}.png`) });
    await page.getByTestId('preflight-gastapp-snapshot').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: testInfo.outputPath(`september-gastapp-snapshot-${viewport.name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Cerrar mes', exact: true }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole('checkbox', { name: /tasas utilizadas corresponden al cierre económico/i }).check();
  await confirm(page, modal);
  const saved = await cloudClosure('2026-09');
  expect(saved.summary).toMatchObject(preview);
  expect(saved.fxRates).toEqual(rates);
  expect(saved.gastappExpenseClose).toMatchObject({ monthKey: '2026-09', calendarMonthKey: '2026-09', totalEur: 2805 });
  expect(saved.gastappExpenseClose.amountsByCurrency.CLP.total).toBe(2805 * rates.eurClp);
  await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
  await expect(page.getByText(/Resumen estratégico octubre de 2026/i)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Resumen estratégico octubre de 2026/i)).toBeVisible();
  expect(await cloudClosure('2026-09')).toEqual(saved);
  const after = (await ref.get()).data()!;
  expect(after.closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-08')).toEqual(augustBeforeClose);
  expect(nativeAmounts(after.records, '2026-10')).toEqual(nativeAmounts(saved.records, '2026-09'));
  expect(after.closures.filter((closure: { monthKey: string }) => closure.monthKey === '2026-09')).toHaveLength(1);
  await attachEvidence(testInfo, { preview, saved, previousClosure: augustBeforeClose });
  await networkGuard.assertClean(testInfo);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, rejectFx: true },
  { name: 'mobile', width: 390, height: 844, rejectFx: true },
]) {
  test(`next month start preserves history and applies mortgage once on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await seedMortgageStart();
    await page.clock.setFixedTime(new Date('2026-08-01T12:00:00.000Z'));
    await page.setViewportSize(viewport);
    const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page);
    await confirm(page, modal);
    const closed = await cloudClosure('2026-07');
    expect(closed.records.find((record: AuditRecord) => record.label === mortgagePrincipalLabel).amount).toBe(3000);
    expect(closed.fxRates).toEqual(rates);
    await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
    const reminder = page.locator('div.fixed.inset-0').filter({ hasText: 'Mes cerrado correctamente' });
    await expect(reminder).toBeVisible();
    const carried = await monthStartState(page);
    expect(nativeAmounts(carried.records, '2026-08')).toEqual(nativeAmounts(closed.records, '2026-07'));
    expect(carried.checkpoint?.explicitMonthStarted).not.toBe(true);
    await reminder.getByRole('button', { name: 'Recordarme después', exact: true }).click();
    await page.reload();
    await expect(page.getByText(/Resumen estratégico agosto de 2026/i)).toBeVisible();
    await expect(reminder).toHaveCount(0);
    const afterSnooze = await monthStartState(page);
    expect(nativeAmounts(afterSnooze.records, '2026-08')).toEqual(nativeAmounts(carried.records, '2026-08'));
    // Expire the persisted reminder without jumping Date during an active
    // Firestore WebChannel connection (which treats that jump as a timeout).
    await page.evaluate(() => {
      const key = 'aurum.next-month-start-reminder.snooze.v1.2026-08';
      const until = window.localStorage.getItem(key);
      if (!until || Date.parse(until) <= Date.now()) throw new Error('Snooze must persist a future expiry.');
      window.localStorage.setItem(key, '2026-07-31T12:00:00.000Z');
    });
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
    const start = page.getByRole('button', { name: 'Iniciar agosto de 2026', exact: true });
    await expect(start.first()).toBeVisible();
    await start.first().click();
    const confirmation = page.locator('div.fixed.inset-0').filter({ hasText: 'Vas a iniciar AGOSTO DE 2026' });
    await expect(confirmation).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`month-start-confirm-${viewport.name}.png`) });
    if (viewport.name === 'desktop') {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.screenshot({ path: testInfo.outputPath('month-start-confirm-tablet.png') });
      await page.setViewportSize(viewport);
    }
    const beforeAccept = await monthStartState(page);
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(await monthStartState(page)).toEqual(beforeAccept);

    const expected = nativeAmounts(beforeAccept.records, '2026-08').map((record) => ({
      ...record, amount: record.label === mortgagePrincipalLabel ? 2990 : record.amount,
    }));
    const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
    let started: Awaited<ReturnType<typeof monthStartState>>;

    if (viewport.rejectFx) {
      // The emulator provides deterministic live rates. Reject only those so
      // the previous close can be persisted as the fallback.
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        (window as Window & { restoreAuditFx?: () => void }).restoreAuditFx = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.localStorage && key === 'wealth_fx_v1') {
            const attemptedRates = JSON.parse(value);
            if (
              attemptedRates.usdClp === 950 &&
              attemptedRates.eurClp === 1030 &&
              attemptedRates.ufClp === 38000
            ) {
              throw new Error('Fallo ficticio al guardar TC/UF');
            }
          }
          return original.call(this, key, value);
        };
      });
      await start.first().click();
      const acceptStart = confirmation.getByRole('button', { name: 'Iniciar agosto de 2026', exact: true });
      if (viewport.name === 'mobile') {
        await acceptStart.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      } else {
        await acceptStart.click();
      }
      await expect(page.getByText(/mes de agosto de 2026 quedó iniciado con la hipoteca aplicada.*Fallo ficticio al guardar TC\/UF/i)).toBeVisible();
      const failed = await monthStartState(page);
      expect(nativeAmounts(failed.records, '2026-08')).toEqual(expected);
      expect(failed.fx).toEqual(closed.fxRates);
      expect(failed.checkpoint.failedStep).toBe('fx');
      expect(failed.checkpoint.explicitMonthStarted).toBe(true);
      expect(failed.checkpoint.actions.carry).toBe('applied');
      expect(failed.checkpoint.actions.realEstate).toBe('applied');
      await expect(start).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`month-start-fx-failure-${viewport.name}.png`) });
      if (viewport.name === 'desktop') {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.screenshot({ path: testInfo.outputPath('month-start-fx-failure-tablet.png') });
        await page.setViewportSize(viewport);
      }
      await expect.poll(async () => nativeAmounts((await ref.get()).get('records'), '2026-08')).toEqual(expected);
      const afterFailedStart = (await ref.get()).data()!;
      expect(afterFailedStart.fx).toEqual(closed.fxRates);
      expect(afterFailedStart.closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-07')).toEqual(closed);
      expect(afterFailedStart.closures.some((closure: { monthKey: string }) => closure.monthKey === '2026-08')).toBe(false);

      await page.evaluate(() => (window as Window & { restoreAuditFx?: () => void }).restoreAuditFx?.());
      await page.getByRole('button', { name: 'Reintentar paso: TC/UF', exact: true }).click();
      await expect.poll(async () => (await monthStartState(page)).checkpoint?.actions.fx).toBe('applied');
      started = await monthStartState(page);
      expect(started.fx).toEqual(liveRates);
      expect(started.checkpoint.explicitMonthStarted).toBe(true);
      expect(nativeAmounts(started.records, '2026-08')).toEqual(expected);
      await expect(start).toHaveCount(0);
    } else {
      await start.first().click();
      const acceptStart = confirmation.getByRole('button', { name: 'Iniciar agosto de 2026', exact: true });
      await expect(acceptStart).toBeEnabled();
      await acceptStart.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      await expect.poll(async () => (await monthStartState(page)).checkpoint?.explicitMonthStarted).toBe(true);
      started = await monthStartState(page);
      expect(started.fx).toEqual(liveRates);
      expect(nativeAmounts(started.records, '2026-08')).toEqual(expected);
      expect(started.checkpoint.actions.fx).toBe('applied');
      expect(started.checkpoint.actions.realEstate).toBe('applied');
      await expect(start).toHaveCount(0);
    }

    await expect(start).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`month-start-success-${viewport.name}.png`) });
    await expect.poll(async () => nativeAmounts((await ref.get()).get('records'), '2026-08')).toEqual(expected);
    await expect.poll(async () => {
      const checkpoint = (await ref.get()).get('records').find((record: AuditRecord) =>
        record.snapshotDate.startsWith('2026-08-') && record.label === checkpointLabel);
      return checkpoint ? JSON.parse(checkpoint.note).explicitMonthStarted : null;
    }).toBe(true);
    expect(await cloudClosure('2026-07')).toEqual(closed);
    await page.reload();
    await expect(page.getByText(/Resumen estratégico agosto de 2026/i)).toBeVisible();
    await expect.poll(async () => (await monthStartState(page)).checkpoint?.explicitMonthStarted).toBe(true);
    const reloaded = await monthStartState(page);
    expect(nativeAmounts(reloaded.records, '2026-08')).toEqual(expected);
    expect(reloaded.records.filter((record: AuditRecord) => record.snapshotDate.startsWith('2026-08-') && record.label === mortgagePrincipalLabel)).toHaveLength(1);
    expect(reloaded.records.filter((record: AuditRecord) => record.snapshotDate.startsWith('2026-08-') && record.label === checkpointLabel)).toHaveLength(1);
    await expect(start).toHaveCount(0);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
    expect(nativeAmounts((await monthStartState(page)).records, '2026-08')).toEqual(expected);
    expect(await cloudClosure('2026-07')).toEqual(closed);
    expect((await ref.get()).get('fx')).toEqual(liveRates);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await attachEvidence(testInfo, { closed, carried, beforeAccept, started, reloaded, expected });
    await networkGuard.assertClean(testInfo);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test.beforeEach(async () => {
  const db = emulatorDb();
  const ref = db.doc(`aurum_wealth/${uid}`);
  const original = (await ref.get()).data();
  if (!original) throw new Error('Missing synthetic Aurum fixture.');
  const checkpointCollection = ref.collection('monthly_close_checkpoints');
  const checkpoints = await checkpointCollection.get();
  restoreFixture = async () => {
    await ref.set(original);
    const current = await checkpointCollection.get();
    const batch = db.batch();
    current.docs.forEach((document) => batch.delete(document.ref));
    checkpoints.docs.forEach((document) => batch.set(document.ref, document.data()));
    await batch.commit();
  };
  // This file runs after the existing smoke. Recreate its July working month
  // for every audit case; never rely on the previous test's active month.
  const julyRecords = original.records.filter((record: { snapshotDate: string }) => record.snapshotDate.startsWith('2026-07-'));
  if (!julyRecords.length) throw new Error('Missing synthetic July records.');
  await ref.set({
    ...original,
    records: julyRecords,
    closures: original.closures.filter((closure: { monthKey: string }) => closure.monthKey < '2026-07'),
    fx: rates,
    instruments: [],
    closureDeletionTombstones: [],
  });
});

test.afterEach(async ({ page }) => {
  // Stop browser autosync before restoring the isolated fixture.
  await Promise.all(page.context().pages().map((openPage) => openPage.close()));
  const restore = restoreFixture;
  restoreFixture = null;
  if (restore) await restore();
});

async function prepare(
  page: Page,
  monthKey = '2026-07',
  certifiedRevisionFixture = false,
  sharedGastappContracts?: any[],
  openCloseDialog = true,
) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const confirmationWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning' && (
      message.text().includes('cloud confirmation did not match attempted closure') ||
      message.text().includes('monthly-close-debt-guard')
    )) {
      confirmationWarnings.push(message.text());
    }
  });
  const networkGuard = await installLocalNetworkGuard(page);
  if (certifiedRevisionFixture) {
    // Supply a certified upstream contract for this month only. The default
    // synthetic demo contract is deliberately excluded from automatic revisions.
    // Intercept local fixture data, leaving every production validator intact.
    if (sharedGastappContracts) {
      await page.addInitScript((contracts) => {
        if (!window.localStorage.getItem('cross-app.gastapp-contracts.v1')) {
          window.localStorage.setItem('cross-app.gastapp-contracts.v1', JSON.stringify(contracts));
          window.localStorage.setItem('cross-app.gastapp-contract-index.v1', '0');
        }
      }, { monthKey: '2026-07', contracts: sharedGastappContracts });
    }
    let certifiedFixtureModule: string | null = null;
    await page.route('**/src/services/gastosMonthly.ts*', async (route) => {
      if (certifiedFixtureModule !== null) {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: certifiedFixtureModule });
        return;
      }
      const response = await route.fetch();
      const body = await response.text();
      let fixture = body;
      if (sharedGastappContracts) {
        const marker = 'const storedContractHash = readString(options.previousSnapshot?.contractHash);';
        expect(body.split(marker), 'The shared contract fixture must inject at the candidate resolver boundary').toHaveLength(2);
        const branch = `const sharedRaw = window.localStorage.getItem('cross-app.gastapp-contracts.v1');
        const sharedContracts = sharedRaw ? JSON.parse(sharedRaw) : null;
        const sharedIndex = Number(window.localStorage.getItem('cross-app.gastapp-contract-index.v1') || 0);
        const sharedSnapshot = sharedContracts?.monthKey === monthKey ? sharedContracts.contracts?.[sharedIndex] : null;
        if (sharedSnapshot) {
          const sharedPreviousHash = readString(options.previousSnapshot?.contractHash) || null;
          return {
            monthKey, status: 'complete', partialGastosEur: sharedSnapshot.totalEur,
            partialByFamilyEur: sharedSnapshot.byFamilyEur, snapshot: sharedSnapshot,
            sourceChangedAfterClosure: Boolean(sharedPreviousHash && sharedPreviousHash !== sharedSnapshot.contractHash),
            currentContractHash: sharedSnapshot.monthContractHash, storedContractHash: sharedPreviousHash,
            message: 'Fixture E2E transversal desde contrato GastApp certificado.',
          };
        }
        ${marker}`;
        fixture = body.replace(marker, branch);
      } else {
        const marker = /contractVersion:\s*["']e2e_fixture["']/g;
        expect(body.match(marker), 'The scoped source fixture marker must exist exactly once').toHaveLength(1);
        fixture = body.replace(marker,
          'contractVersion: monthKey === "2026-07" ? "gastapp-aurum-calendar-months-v2" : "e2e_fixture"');
        for (const key of ['operationalRevision', 'sourceGeneration', 'monthContractRevision', 'certificationRevision']) {
          const revision = new RegExp(`${key}:\\s*1,`, 'g');
          expect(fixture.match(revision), `Fixture revision ${key} must be explicit`).toHaveLength(1);
          fixture = fixture.replace(revision, `${key}: monthKey === "2026-07" ? 2 : 1,`);
        }
      }
      certifiedFixtureModule = fixture;
      await route.fulfill({ response, body: fixture });
    });
  }
  await page.addInitScript(() => {
    window.localStorage.setItem('aurum.banks.update.mode.v1', 'manual');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // The synthetic month can be complete or incomplete depending on the case;
    // closure audit tests cover the close flow, not this separate reminder.
    window.localStorage.setItem('aurum.incomplete-closure.prompt.day.v1', today);
    const rules = Object.fromEntries([
      'investments_value', 'banks_fintoc', 'tenencia', 'cards_used',
      'property_value', 'mortgage_balance', 'mortgage_amortization',
    ].map((key) => [key, { enabled: false, maxAgeDays: null }]));
    window.localStorage.setItem('aurum.closing.config.v1', JSON.stringify({ rules }));
  });
  await page.route('**/api/fx/closure?**', async (route) => {
    const requestedMonth = new URL(route.request().url()).searchParams.get('monthKey') || monthKey;
    const [year, month] = requestedMonth.split('-').map(Number);
    const economicDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true, monthKey: requestedMonth, economicDate, rates,
        sources: { usd: 'e2e-official', eur: 'e2e-official', uf: 'e2e-official' },
        effectiveDates: { usd: economicDate, eur: economicDate, uf: economicDate },
        references: Object.fromEntries([
          ['usd', rates.usdClp], ['eur', rates.eurClp], ['uf', rates.ufClp],
        ].map(([key, value]) => [key, { value, availability: 'final', effectiveDate: economicDate, source: 'e2e-official' }])),
        retrievedAt: `${economicDate}T12:00:00.000Z`, warnings: [],
      }),
    });
  });
  await page.goto('/#/dashboard');
  await page.getByRole('link', { name: 'Patrimonio', exact: true }).click();
  await expect.poll(() => page.evaluate((targetMonth) => {
    const records = JSON.parse(window.localStorage.getItem('wealth_records_v1') || '[]');
    return records.filter((record: { snapshotDate?: string }) => record.snapshotDate?.startsWith(`${targetMonth}-`)).length;
  }, monthKey), { message: `Synthetic records for ${monthKey} must hydrate before closing` }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Cerrar mes', exact: true })).toBeVisible();
  // These optional instruments are created after cloud hydration. Read their
  // final IDs before configuring this close fixture, not an intermediate list.
  await expect.poll(() => page.evaluate(() => {
    const instruments = JSON.parse(window.localStorage.getItem('wealth_investment_instruments_v1') || '[]');
    return ['Capital de riesgo CLP', 'Capital de riesgo USD'].every((label) =>
      instruments.some((instrument: { label: string }) => instrument.label === label));
  }), { message: 'Default instruments must finish initializing before configuring the close fixture' }).toBe(true);
  await page.evaluate(() => {
    const config = JSON.parse(window.localStorage.getItem('aurum.closing.config.v1') || '{"rules":{}}');
    const instruments = JSON.parse(window.localStorage.getItem('wealth_investment_instruments_v1') || '[]');
    instruments.forEach((instrument: { id: string }) => {
      config.rules[`investment:${instrument.id}`] = { enabled: false, maxAgeDays: null };
    });
    window.localStorage.setItem('aurum.closing.config.v1', JSON.stringify(config));
  });
  if (!openCloseDialog) {
    return {
      modal: page.locator('div.fixed.inset-0').filter({ hasText: 'Confirmar cierre mensual' }),
      networkGuard, pageErrors, consoleErrors, confirmationWarnings,
    };
  }
  await page.getByRole('button', { name: 'Cerrar mes', exact: true }).click();
  const modal = page.locator('div.fixed.inset-0').filter({ hasText: 'Confirmar cierre mensual' });
  await expect(modal).toBeVisible();
  const monthInput = modal.locator('input[type="month"]');
  if (await monthInput.inputValue() !== monthKey) await monthInput.fill(monthKey);
  await expect(modal.getByText('Final al', { exact: false })).toHaveCount(3);
  await modal.getByRole('checkbox', { name: /tasas utilizadas corresponden al cierre económico/i }).check();
  const manual = modal.getByRole('checkbox', { name: /deseo utilizar tasas particulares distintas/i });
  if (await manual.count()) {
    await modal.locator('#close-fx-manual-reason').fill('Tasas ficticias de auditoría local');
    await manual.check();
    await modal.getByRole('checkbox', { name: /tasas utilizadas corresponden al cierre económico/i }).check();
  }
  return { modal, networkGuard, pageErrors, consoleErrors, confirmationWarnings };
}

async function previewAmounts(modal: Locator) {
  const read = async (label: string) => {
    const text = await modal.getByText(label, { exact: true }).locator('..').locator('span').last().innerText();
    return Math.abs(Number(text.replace(/[^\d-]/g, '')));
  };
  return {
    bankClp: await read('Bancos'),
    investmentClp: await read('Inversiones'),
    nonMortgageDebtClp: await read('Deuda no hipotecaria'),
    netClp: await read('Patrimonio total'),
  };
}

async function confirm(page: Page, modal: Locator, overwrite = false) {
  await modal.getByRole('button', { name: /Confirmar cierre|Cerrar con arrastres|Sobrescribir/ }).click();
  if (overwrite) await page.getByRole('button', { name: 'Reemplazar cierre', exact: true }).click();
  try {
    const closeSummaryButton = page.getByRole('button', { name: 'Cerrar ventana', exact: true });
    await expect(closeSummaryButton).toBeAttached({ timeout: 10_000 });
    await closeSummaryButton.scrollIntoViewIfNeeded();
    await expect(closeSummaryButton).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    const monthKey = await modal.locator('input[type="month"]').inputValue().catch(() => 'unknown');
    const closeError = await modal.locator('.border-red-200.bg-red-50').last().innerText().catch(() => 'no visible close error');
    const syncIssue = await page.evaluate(() => window.localStorage.getItem('aurum:wealth-sync-issue'));
    const root = (await emulatorDb().doc(`aurum_wealth/${uid}`).get()).data() || {};
    const cloud = root.closures?.find((closure: { monthKey: string }) => closure.monthKey === monthKey) || null;
    throw new Error(`${error instanceof Error ? error.message : String(error)}; closeError=${closeError}; syncIssue=${syncIssue || 'none'}; cloudSummary=${JSON.stringify(cloud?.summary || null)}`);
  }
}

async function cloudClosure(monthKey: string) {
  const data = (await emulatorDb().doc(`aurum_wealth/${uid}`).get()).data();
  const closure = data?.closures.find((item: { monthKey: string }) => item.monthKey === monthKey);
  if (!closure) throw new Error(`No cloud closure for ${monthKey}.`);
  return closure;
}

async function readAcceptedChain(page: Page) {
  return page.evaluate(async () => {
    const storagePath = '/src/services/wealthStorage.ts';
    const returnsPath = '/src/services/returnsAnalysis.ts';
    const labPath = '/src/services/wealthLab.ts';
    const presentationPath = '/src/services/presentationAurumModel.ts';
    const { loadClosures, loadWealthRecords, loadFxRates, loadIncludeRiskCapitalInTotals } = await import(storagePath);
    const { computeMonthlyRows, aggregateRows, buildTrailingSummary } = await import(returnsPath);
    const { buildWealthLabModel } = await import(labPath);
    const { resolveAcceptedGastappSnapshot } = await import('/src/services/historicalGastappSidecar.ts');
    const { buildAurumPresentationModel } = await import(presentationPath);
    const closures = loadClosures();
    const includeRisk = loadIncludeRiskCapitalInTotals();
    const rows = computeMonthlyRows(closures, includeRisk, 'CLP');
    const ufRows = computeMonthlyRows(closures, includeRisk, 'UF');
    const pct12 = buildTrailingSummary(ufRows, 12, 'test-12', '12M')?.pctRetorno;
    const pct36 = buildTrailingSummary(ufRows, 36, 'test-36', '36M')?.pctRetorno;
    const presentation = buildAurumPresentationModel({ closures, records: loadWealthRecords(), fx: loadFxRates(), includeRiskCapitalInTotals: includeRisk });
    const pctText = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%`;
    return {
      monthSpendEur: resolveAcceptedGastappSnapshot(closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-07'))?.totalEur ?? null,
      accumulatedSpendClp: aggregateRows('test-total', 'Total', rows, null).gastosAcumClp,
      labSpendClp: buildWealthLabModel(closures, includeRisk).points.find((point: { monthKey: string }) => point.monthKey === '2026-07').gastosClp,
      dashboard12Uf: pct12, dashboard36Uf: pct36,
      dashboard12UfText: pctText(pct12), dashboard36UfText: pctText(pct36),
      presentation36Uf: presentation.return36mUfPct,
      presentation36UfText: presentation.return36mUfPct === null
        ? null
        : `${presentation.return36mUfPct.toLocaleString('es-CL', { maximumFractionDigits: 1 })} % anualizado`,
    };
  });
}

async function attachEvidence(testInfo: TestInfo, value: unknown) {
  await testInfo.attach('close-audit-evidence.json', {
    body: JSON.stringify(value, null, 2), contentType: 'application/json',
  });
}

test('overwrite must show the amounts that are actually sealed [close audit]', async ({ page }, testInfo) => {
  const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
  const data = (await ref.get()).data()!;
  const june = data.closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-06');
  const changedJune = june.records.map((record: { block: string; amount: number; id: string }) => ({
    ...record, id: `audit-live-${record.id}`,
    amount: record.block === 'bank' ? 50_000_000 : record.amount,
    createdAt: '2026-06-30T12:00:00.000Z',
  }));
  await ref.update({ records: [...data.records, ...changedJune] });
  const { modal, networkGuard } = await prepare(page, '2026-06');
  const preview = await previewAmounts(modal);
  await page.screenshot({ path: testInfo.outputPath('overwrite-preview-desktop.png') });
  await confirm(page, modal, true);
  const saved = await cloudClosure('2026-06');
  await attachEvidence(testInfo, { preview, savedSummary: saved.summary, expectedBankClp: 50_000_000 });
  await networkGuard.assertClean(testInfo);
  expect.soft(saved.summary.bankClp).toBe(50_000_000);
  expect(saved.summary.bankClp, 'Customer-confirmed bank subtotal must match cloud close').toBe(preview.bankClp);
});

test('blocks stale multi-debt data instead of inflating the close [close audit]', async ({ page }, testInfo) => {
  const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
  const data = (await ref.get()).data()!;
  const debt = data.records.find((record: { block: string }) => record.block === 'debt');
  const records = data.records.filter((record: { block: string }) => record.block !== 'debt');
  records.push(
    { ...debt, id: 'audit-debt-a', label: 'Crédito ficticio A', amount: 2_000_000 },
    { ...debt, id: 'audit-debt-b', label: 'Crédito ficticio B', amount: 3_000_000 },
  );
  // Keep the same debt families in June so automatic carry-forward cannot add
  // a third unrelated liability and obscure the stale-cache adjustment branch.
  const closures = data.closures.map((closure: { monthKey: string; records: Array<{ block: string }>; summary: Record<string, number> }) => {
    if (closure.monthKey !== '2026-06') return closure;
    const debtRecords = records.filter((record: { block: string }) => record.block === 'debt').map((record: { id: string }) => ({
      ...record, id: `june-${record.id}`, snapshotDate: '2026-06-30', createdAt: '2026-06-30T12:00:00.000Z',
    }));
    const difference = closure.summary.nonMortgageDebtClp - 5_000_000;
    return {
      ...closure,
      records: [...closure.records.filter((record) => record.block !== 'debt'), ...debtRecords],
      summary: {
        ...closure.summary,
        nonMortgageDebtClp: 5_000_000,
        netClp: closure.summary.netClp + difference,
        netClpWithRisk: closure.summary.netClpWithRisk + difference,
      },
    };
  });
  await ref.update({ records, closures });
  const { modal, networkGuard, confirmationWarnings } = await prepare(page);
  const preview = await previewAmounts(modal);
  expect(preview.nonMortgageDebtClp).toBe(5_000_000);
  // Inject an explicitly stale local cache without changing the React preview.
  // This targets the production branch documented as reconciling stale storage.
  await page.evaluate(() => {
    const records = JSON.parse(window.localStorage.getItem('wealth_records_v1') || '[]');
    for (const record of records) {
      if (record.id === 'audit-debt-a' || record.id === 'audit-debt-b') record.amount = 1_000_000;
    }
    window.localStorage.setItem('wealth_records_v1', JSON.stringify(records));
  });
  const cachedDebtBeforeConfirmation = await page.evaluate(() => {
    const records = JSON.parse(window.localStorage.getItem('wealth_records_v1') || '[]');
    return records
      .filter((record: { id?: string }) => record.id === 'audit-debt-a' || record.id === 'audit-debt-b')
      .map((record: { id: string; label: string; amount: number; block: string }) => ({
        id: record.id, label: record.label, amount: record.amount, block: record.block,
      }));
  });
  await modal.getByRole('button', { name: /Confirmar cierre|Cerrar con arrastres|Sobrescribir/ }).click();
  const successButton = page.getByRole('button', { name: 'Cerrar ventana', exact: true });
  const errorPanel = modal.locator('.border-red-200.bg-red-50').last();
  const outcome = await Promise.race([
    successButton.waitFor({ state: 'visible' }).then(() => ({ kind: 'success' as const, message: '' })),
    errorPanel.waitFor({ state: 'visible' }).then(async () => ({ kind: 'error' as const, message: await errorPanel.innerText() })),
  ]);
  const afterData = (await ref.get()).data() || {};
  const saved = afterData.closures?.find((closure: { monthKey: string }) => closure.monthKey === '2026-07') || null;
  const afterDebtRecords = (afterData.records || []).filter((record: { block: string }) => record.block === 'debt');
  const currentSyncIssue = await page.evaluate(() => window.localStorage.getItem('aurum:wealth-sync-issue'));
  await attachEvidence(testInfo, {
    preview,
    outcome,
    syncIssue: currentSyncIssue,
    savedSummary: saved?.summary || null,
    savedDebtRecords: saved?.records?.filter((record: { block: string }) => record.block === 'debt') || [],
    cloudDebtRecordsAfterAttempt: afterDebtRecords,
    cachedDebtBeforeConfirmation,
    confirmationWarnings,
  });
  if (
    outcome.kind === 'error' &&
    (outcome.message.includes('Los datos de deuda guardados cambiaron') ||
      outcome.message.includes('No se puede reconciliar el total de varias deudas'))
  ) {
    expect(saved, 'A safe debt guard must not persist a July close').toBeNull();
    expect(afterDebtRecords, 'A safe debt guard must leave cloud debt records unchanged').toEqual(
      records.filter((record: { block: string }) => record.block === 'debt'),
    );
    await networkGuard.assertClean(testInfo);
    return;
  }
  expect(outcome.kind, `Customer close failed: ${outcome.message}; sync issue: ${currentSyncIssue || 'none'}; confirmation details: ${confirmationWarnings.join(' | ') || 'none'}`).toBe('success');
  expect(saved, 'Successful close must be present in cloud').not.toBeNull();
  await networkGuard.assertClean(testInfo);
  expect(
    saved.summary.nonMortgageDebtClp,
    `Saving must retain the confirmed debt total or block; never silently add debt. preview=${preview.nonMortgageDebtClp}; saved=${JSON.stringify(saved.records.filter((record: { block: string }) => record.block === 'debt'))}; cache=${JSON.stringify(cachedDebtBeforeConfirmation)}; warnings=${confirmationWarnings.join(' | ') || 'none'}`,
  ).toBe(preview.nonMortgageDebtClp);
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`customer close matches preview, survives reload and advances on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const { modal, networkGuard, pageErrors, consoleErrors } = await prepare(page);
    const preview = await previewAmounts(modal);
    // Capture the preview and the final action in the actual viewport, with the
    // modal scrolled to each relevant section rather than full-page stitching.
    await modal.getByText('Preview numérico del cierre', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`close-preview-${viewport.name}.png`) });
    const action = modal.getByRole('button', { name: /Confirmar cierre|Cerrar con arrastres/ });
    await action.scrollIntoViewIfNeeded();
    if (!(await action.isEnabled())) {
      throw new Error(`Close confirmation is disabled on ${viewport.name}: ${await modal.innerText()}`);
    }
    await expect(action).toBeEnabled();
    const actionTextFits = await action.evaluate((button) => button.scrollHeight <= button.clientHeight + 1);
    expect(actionTextFits, 'Close action label must not be clipped in the modal').toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`close-confirm-${viewport.name}.png`) });
    await confirm(page, modal);
    const saved = await cloudClosure('2026-07');
    await attachEvidence(testInfo, { preview, savedSummary: saved.summary, closureId: saved.id });
    expect(saved.summary).toMatchObject(preview);
    expect(saved.fxRates).toEqual(rates);
    expect(saved.gastappExpenseClose.monthKey).toBe('2026-07');
    await page.screenshot({ path: testInfo.outputPath(`close-success-${viewport.name}.png`) });
    if (viewport.name === 'mobile') {
      await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('close-success-actions-mobile.png') });
    }
    await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
    await expect(page.getByText(/Resumen estratégico agosto de 2026/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Resumen estratégico agosto de 2026/i)).toBeVisible();
    const restored = await page.evaluate(() => {
      const closures = JSON.parse(window.localStorage.getItem('wealth_closures_v1') || '[]');
      return closures.find((closure: { monthKey: string }) => closure.monthKey === '2026-07');
    });
    expect(restored.id).toBe(saved.id);
    expect(restored.summary).toMatchObject(preview);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await networkGuard.assertClean(testInfo);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
