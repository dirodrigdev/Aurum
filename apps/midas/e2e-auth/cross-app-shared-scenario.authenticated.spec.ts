import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildSimulationConfigHash } from '../src/integrations/midas/simulationConfigCanonical';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

const scenarioPath = process.env.CROSS_APP_SCENARIO_PATH;

const readScenario = () => {
  if (!scenarioPath) return null;
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  if (scenario.schemaVersion !== 'gastapp-aurum-midas-cross-app-synthetic-v1'
      || scenario.aurum?.sourceContractHash !== scenario.gastapp?.currentContract?.contractHash
      || scenario.aurum?.closure?.gastappExpenseClose?.contractHash !== scenario.aurum?.sourceContractHash) {
    throw new Error('cross_app_midas_source_handoff_invalid');
  }
  return scenario;
};

test('cross-app shared scenario publishes Aurum to MIDAS once, preserves overrides through rebases and persists the new source', async ({ page }, testInfo) => {
  const scenario = readScenario();
  test.skip(!scenario, 'Requiere el orquestador transversal y el cierre sintético aceptado por Aurum.');
  test.setTimeout(150_000);
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8180');
  const app = initializeApp({ projectId: 'midas-e2e-local' }, 'cross-app-midas-scenario');
  const db = getFirestore(app);
  const closure = scenario!.aurum.closure;
  const published = db.doc('aurum_published/optimizableInvestments');
  const config = db.doc('users/midas-e2e-user/midas_config/simulationActiveV1');
  const initialConfig = (await config.get()).data()!;
  const params = JSON.parse(initialConfig.active.paramsJson);
  params.simulation.nSim = 3000;
  // A saved manual base and a temporary what-if override have different
  // lifetimes. Reload must preserve the former, not silently persist the latter.
  params.simulation.horizonMonths = 132;
  const savedHorizonYears = params.simulation.horizonMonths / 12;
  await config.set({ ...initialConfig, active: { ...initialConfig.active, paramsJson: JSON.stringify(params), hash: buildSimulationConfigHash(params), nSim: 3000 } });

  try {
    const sourceSnapshot = scenario!.aurum.publishedSnapshot;
    await published.set(sourceSnapshot);
    const concurrentPublication = scenario!.aurum.publicationHttpResults.slice(0, 2).map((value: any) => value.payload.result).sort();
    expect(concurrentPublication).toEqual(['published', 'unchanged']);
    const stored = (await published.get()).data()!;
    expect(stored).toMatchObject({
      snapshotMonth: closure.monthKey,
      optimizableInvestmentsCLP: sourceSnapshot.optimizableInvestmentsCLP,
      fxReference: { sourceId: closure.id, asOf: closure.fxMetadata.economicDate },
    });
    const firstUpdateTime = (await published.get()).updateTime?.toMillis();

    const guard = await installLocalNetworkGuard(page);
    await page.route('**/src/integrations/aurum/optimizableSnapshot.ts*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      const marker = 'export function subscribeToPublishedOptimizableInvestmentsSnapshot(listener) {';
      expect(body).toContain(marker);
      await route.fulfill({ response, body: body.replace(marker, `${marker}
        window.addEventListener('cross-app-read-error', () => listener.onError?.(Object.assign(new Error('synthetic unavailable'), {code:'unavailable'})));`) });
    });
    await page.goto('/?audit=1');
    const apply = page.getByRole('button', { name: 'Aplicar Aurum', exact: true });
    await expect(apply).toBeVisible({ timeout: 30_000 });
    await apply.click();
    await expect(apply).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.heroSource), { timeout: 30_000 }).toBe('simResult');
    const identityAfterApply = await page.evaluate(() => ({
      requestId: (window as any).__MIDAS_AUDIT__?.requestId,
      capitalInitialClp: (window as any).__MIDAS_AUDIT__?.m8Input?.capital_initial_clp,
    }));
    expect(identityAfterApply.capitalInitialClp).toBe(
      sourceSnapshot.optimizableInvestmentsCLP + sourceSnapshot.nonOptimizable.banksCLP,
    );

    await page.getByRole('button', { name: '11 años', exact: true }).click();
    await page.getByLabel('Horizonte (anos)', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(page.getByRole('button', { name: '12 años', exact: true })).toBeVisible();
    // The label changes before the worker finishes the requested manual run.
    // Establish its completed result before counting any recovery-triggered run.
    await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.m8Input?.years), { timeout: 60_000 }).toBe(12);
    const adjustedAudit = await page.evaluate(() => (window as any).__MIDAS_AUDIT__);
    const adjustedRequestId = adjustedAudit.requestId;

    // A corrected GastApp expense is carried by the same Aurum closure, but it
    // is outside M8's inputs. Republishing its unchanged patrimonial projection
    // must not discard the user's manual horizon adjustment or request a run.
    const expenseOnly = scenario!.aurum.publicationVariants.expenseOnly;
    expect(expenseOnly).toEqual(sourceSnapshot);
    expect((await published.get()).updateTime?.toMillis()).toBe(firstUpdateTime);
    await expect(page.getByRole('button', { name: 'Aplicar Aurum', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__MIDAS_AUDIT__?.requestId)).toBe(adjustedRequestId);
    await expect(page.getByRole('button', { name: '12 años', exact: true })).toBeVisible();

    // A transport failure must not turn an identical economic identity into a
    // new base or discard manual scenario settings.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('cross-app-read-error')));
    await expect(page.getByTestId('aurum-snapshot-recovery')).toBeVisible();
    for (const [name, width, height] of [['desktop', 1280, 900], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.getByTestId('aurum-snapshot-recovery').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`midas-recovery-error-${name}.png`) });
    }
    await page.getByRole('button', { name: 'Reintentar lectura', exact: true }).click();
    await expect(page.getByTestId('aurum-snapshot-recovery')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '12 años', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.heroSource)).toBe('simResult');
    const recoveredAudit = await page.evaluate(() => (window as any).__MIDAS_AUDIT__);
    expect(recoveredAudit.requestId).toBe(adjustedRequestId);
    expect(recoveredAudit.inputHash).toBe(adjustedAudit.inputHash);
    expect(recoveredAudit.m8Input).toEqual(adjustedAudit.m8Input);
    for (const [name, width, height] of [['desktop', 1280, 900], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`midas-recovery-restored-${name}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const revisedPublication = scenario!.aurum.publicationVariants.patrimonial;
    const expectedHouseValueUf = revisedPublication.nonOptimizable.realEstate.propertyValueCLP / revisedPublication.nonOptimizable.realEstate.ufSnapshotCLP;
    await published.set(revisedPublication);
    await expect(apply).toBeVisible({ timeout: 30_000 });
    await apply.click();
    await expect(apply).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: '12 años', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.requestId), { timeout: 60_000 }).toBeGreaterThan(adjustedRequestId);
    await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.heroSource), { timeout: 60_000 }).toBe('simResult');
    const settledAudit = await page.evaluate(() => (window as any).__MIDAS_AUDIT__);
    expect(settledAudit.heroSource).toBe('simResult');
    expect(settledAudit.m8Input.house.houseValueUf).toBeCloseTo(expectedHouseValueUf, 8);
    expect(settledAudit.requestId).toBeGreaterThan(adjustedRequestId);

    await page.reload();
    await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.heroSource), { timeout: 30_000 }).toBe('simResult');
    const reloadedAudit = await page.evaluate(() => (window as any).__MIDAS_AUDIT__);
    expect(reloadedAudit.m8Input.years).toBe(savedHorizonYears);
    await expect(page.getByRole('button', { name: '11 años', exact: true })).toBeVisible();
    const persistedParams = JSON.parse((await config.get()).data()!.active.paramsJson);
    expect(persistedParams.simulation.horizonMonths).toBe(132);
    expect(reloadedAudit.m8Input.house.houseValueUf).toBeCloseTo(expectedHouseValueUf, 8);
    expect(reloadedAudit.m8Input.capital_initial_clp).toBe(
      sourceSnapshot.optimizableInvestmentsCLP + sourceSnapshot.nonOptimizable.banksCLP,
    );
    await guard.assertClean(testInfo);
    const midasEvidence = {
      scenarioId: scenario!.scenarioId,
      sourceGastappContractHash: scenario!.aurum.sourceContractHash,
      sourceSpendEur: scenario!.aurum.acceptedSpendEur,
      m8InvestmentCLP: sourceSnapshot.optimizableInvestmentsCLP,
      m8NetWorthCLP: sourceSnapshot.totalNetWorthCLP,
      concurrentPublication,
      manualHorizonYearsKeptThroughRebase: 12,
      finalHouseValueUf: reloadedAudit.m8Input.house.houseValueUf,
      sameHashRecovery: { requestBefore: adjustedRequestId, requestAfter: recoveredAudit.requestId,
        inputHashBefore: adjustedAudit.inputHash, inputHashAfter: recoveredAudit.inputHash },
      reloadedHorizonYears: reloadedAudit.m8Input.years,
      savedManualHorizonYears: savedHorizonYears,
      result: 'PASS',
    };
    writeFileSync(scenarioPath!, JSON.stringify({ ...scenario, midas: midasEvidence }, null, 2), { mode: 0o600 });
    await testInfo.attach('cross-app-midas-result.json', { body: JSON.stringify(midasEvidence, null, 2), contentType: 'application/json' });
  } finally {
    await page.close();
    await config.set(initialConfig);
    await published.delete();
    await deleteApp(app);
  }
});
