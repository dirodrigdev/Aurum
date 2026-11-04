import { expect, test } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { buildSimulationConfigHash } from '../src/integrations/midas/simulationConfigCanonical';
import { getFirestore } from 'firebase-admin/firestore';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';
import { publishSnapshotFromCurrentSource } from '../../aurum/api/midas/_publicationIntegrity.js';
import { calculateHistoricalClosureSummary, HISTORICAL_ADMIN_EMAIL } from '../../aurum/api/admin/_historicalClosureCore.js';
test('certified source publication reaches MIDAS; compensated and provenance changes do not ask to reapply', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8180');
    const app = initializeApp({ projectId: 'midas-e2e-local' }, 'publication-e2e');
    const db = getFirestore(app);
    const owner = { uid: 'publication-e2e-owner', email: HISTORICAL_ADMIN_EMAIL, emailVerified: true };
    const root = db.doc(`aurum_wealth/${owner.uid}`), published = db.doc('aurum_published/optimizableInvestments');
    const fx = { usdClp: 900, eurClp: 1000, ufClp: 40000 };
    const make = (delta = 0, houseDelta = 0) => {
        const records = [{ id: 'inv', block: 'investment', label: 'Inversión', amount: 1000000000 + delta, currency: 'CLP', source: 'Manual' },
            { id: 'bank', block: 'bank', label: 'Banco de Chile CLP', amount: 100000000 - delta, currency: 'CLP', source: 'Manual' },
            { id: 'house', block: 'real_estate', label: 'Valor propiedad', amount: 200000000 + houseDelta, currency: 'CLP', source: 'Manual' }];
        const summary = calculateHistoricalClosureSummary(records, fx);
        const closure = { id: 'e2e-source', monthKey: '2026-10', closedAt: '2026-10-31T12:00:00Z', records, summary, fxRates: fx, fxMetadata: { economicMonthKey: '2026-10', economicDate: '2026-10-31', usedFxRates: fx, rateOrigin: { usd: 'manual', eur: 'manual', uf: 'manual' }, source: { usd: 'manual', eur: 'manual', uf: 'manual' } } };
        const snapshot = { version: 2, publishedAt: '2026-11-03T12:00:00Z', snapshotMonth: '2026-10', snapshotLabel: 'Cierre sintético', currency: 'CLP', totalNetWorthCLP: summary.netClp, totalNetWorthWithRiskCLP: summary.netClpWithRisk, optimizableInvestmentsCLP: summary.investmentClp, optimizableInvestmentsWithRiskCLP: summary.investmentClpWithRisk, nonOptimizable: { banksCLP: summary.bankClp, nonMortgageDebtCLP: 0, realEstate: { propertyValueCLP: 200000000 + houseDelta, realEstateEquityCLP: 200000000 + houseDelta, mortgageDebtOutstandingCLP: 0, monthlyMortgagePaymentCLP: 0, ufSnapshotCLP: 40000 } }, fxReference: { clpUsd: 900, clpEur: 1000, usdEur: .9, ufClp: 40000, source: 'closure_fx_metadata', sourceId: 'e2e-source', asOf: '2026-10-31', validationStatus: 'valid', schemaVersion: 1, rateOrigin: { usd: 'manual', eur: 'manual', uf: 'manual' }, rateSource: { usd: 'manual', eur: 'manual', uf: 'manual' } }, source: { app: 'aurum', basis: 'latest_confirmed_closure' } };
        return { closure, snapshot };
    };
    const publish = async (delta = 0, houseDelta = 0) => { const { closure, snapshot } = make(delta, houseDelta); await root.set({ closures: [closure] }); await publishSnapshotFromCurrentSource(db, owner, snapshot); };
    const config=db.doc('users/midas-e2e-user/midas_config/simulationActiveV1');
    const initialConfig=(await config.get()).data()!;
    const params=JSON.parse(initialConfig.active.paramsJson);
    // Audit mode runs 3000 paths. Keep its fixture input equal to the actual
    // worker input so a Monte Carlo normalization is not mistaken for a source change.
    params.simulation.nSim=3000;
    await config.set({...initialConfig,active:{...initialConfig.active,paramsJson:JSON.stringify(params),hash:buildSimulationConfigHash(params),nSim:3000}});
    try {
        await publish();
        const guard = await installLocalNetworkGuard(page);
        await page.goto('/?audit=1');
        const apply = page.getByRole('button', { name: 'Aplicar Aurum', exact: true });
        await expect(apply).toBeVisible({ timeout: 30000 });
        await apply.click();
        await expect(apply).toHaveCount(0, { timeout: 30000 });
        await expect(page.getByTestId('aurum-snapshot-recovery')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.heroSource), { timeout: 30000 })
            .toBe('simResult');
        await page.getByRole('button', { name: '10 años', exact: true }).click();
        await page.getByLabel('Horizonte (anos)', { exact: true }).fill('12');
        await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
        await expect(page.getByRole('button', { name: '12 años', exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.m8Input?.years), { timeout: 30000 })
            .toBe(12);
        const evaluatedRequest = await page.evaluate(() => (window as any).__MIDAS_AUDIT__?.requestId);
        await published.update({ snapshotLabel: 'Solo etiqueta', publishedAt: '2026-11-03T13:00:00Z' });
        await expect(page.getByText('Solo etiqueta', { exact: false }).first()).toBeAttached({ timeout: 15000 });
        await expect(apply).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__MIDAS_AUDIT__?.requestId)).toBe(evaluatedRequest);
        await publish(10000000); // Same effective financial capital despite a different allocation between banks and investments.
        await expect.poll(async () => (await published.get()).data()?.optimizableInvestmentsCLP).toBe(1010000000);
        await expect(page.getByText('Solo etiqueta', { exact: false }).first()).toHaveCount(0);
        await expect(apply).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__MIDAS_AUDIT__?.requestId)).toBe(evaluatedRequest);
        await publish(10000000, 20000000); // Net worth can be compensated elsewhere; house is still an effective M8 input.
        await expect(apply).toBeVisible({ timeout: 15000 });
        await apply.click();
        await expect(apply).toHaveCount(0, { timeout: 30000 });
        await expect(page.getByRole('button', { name: '12 años', exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => (window as any).__MIDAS_AUDIT__?.m8Input?.years), { timeout: 30000 })
            .toBe(12);
        await expect.poll(()=>page.evaluate(()=>{
            const audit=(window as any).__MIDAS_AUDIT__;
            return audit?.heroSource==='simResult' ? audit?.m8Input?.house?.houseValueUf : null;
        }), { timeout: 30000 }).toBe(5500);
        expect(await page.evaluate(()=>(window as any).__MIDAS_AUDIT__?.requestId)).toBeGreaterThan(evaluatedRequest);
        await page.screenshot({ path: testInfo.outputPath('source-applied-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: testInfo.outputPath('source-applied-mobile.png'), fullPage: true });
        await page.setViewportSize({width:1024,height:768});
        await page.screenshot({path:testInfo.outputPath('source-applied-tablet.png'),fullPage:true});
        await guard.assertClean(testInfo);
    }
    finally {
        // Stop client autosave before restoring the synthetic cloud fixture.
        await page.close();
        await config.set(initialConfig);
        await published.delete();
        await root.delete();
        await deleteApp(app);
    }
});
