import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

// Regression assertions describe the required customer behaviour. Known defects
// deliberately remain failing until corrected; do not skip or invert assertions.
const projectId = 'aurum-e2e-local';
const uid = 'aurum-e2e-user';
const rates = { usdClp: 934, eurClp: 1052, ufClp: 39560 };
let restoreFixture: (() => Promise<void>) | null = null;

function emulatorDb() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw new Error('Close audit requires the local Firestore Emulator.');
  }
  const name = 'aurum-close-audit';
  const app = getApps().find((item) => item.name === name) || initializeApp({ projectId }, name);
  return getFirestore(app);
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

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, rejectFx: true },
  { name: 'mobile', width: 390, height: 844, rejectFx: false },
]) {
  test(`next month start preserves history and applies mortgage once on ${viewport.name}`, async ({ page }, testInfo) => {
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

    if (viewport.rejectFx) {
      // The emulator deliberately has no live FX HTTP request. Reject just the
      // FX persistence boundary to exercise the real failure/retry path.
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        (window as Window & { restoreAuditFx?: () => void }).restoreAuditFx = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === window.localStorage && key === 'wealth_fx_v1') throw new Error('Fallo ficticio al guardar TC/UF');
          return original.call(this, key, value);
        };
      });
      await start.first().click();
      await confirmation.getByRole('button', { name: 'Iniciar agosto de 2026', exact: true }).click();
      await expect(page.getByText('Fallo ficticio al guardar TC/UF', { exact: true })).toBeVisible();
      const failed = await monthStartState(page);
      expect(nativeAmounts(failed.records, '2026-08')).toEqual(nativeAmounts(beforeAccept.records, '2026-08'));
      expect(failed.fx).toEqual(beforeAccept.fx);
      expect(failed.checkpoint.failedStep).toBe('fx');
      expect(failed.checkpoint.explicitMonthStarted).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('month-start-fx-failure-desktop.png') });
      await page.evaluate(() => (window as Window & { restoreAuditFx?: () => void }).restoreAuditFx?.());
      await page.getByRole('button', { name: 'Reintentar paso: TC/UF', exact: true }).click();
      await expect.poll(async () => (await monthStartState(page)).checkpoint?.actions.fx).toBe('applied');
      const retriedFx = await monthStartState(page);
      expect(retriedFx.checkpoint.explicitMonthStarted).toBe(false);
      expect(nativeAmounts(retriedFx.records, '2026-08')).toEqual(nativeAmounts(beforeAccept.records, '2026-08'));
    }

    await start.first().click();
    const acceptStart = confirmation.getByRole('button', { name: 'Iniciar agosto de 2026', exact: true });
    await expect(acceptStart).toBeEnabled();
    await acceptStart.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(async () => (await monthStartState(page)).checkpoint?.explicitMonthStarted).toBe(true);
    const started = await monthStartState(page);
    expect(started.fx).toEqual(liveRates);
    const expected = nativeAmounts(beforeAccept.records, '2026-08').map((record) => ({
      ...record, amount: record.label === mortgagePrincipalLabel ? 2990 : record.amount,
    }));
    expect(nativeAmounts(started.records, '2026-08')).toEqual(expected);
    expect(started.checkpoint.actions.fx).toBe('applied');
    expect(started.checkpoint.actions.realEstate).toBe('applied');
    await expect(start).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`month-start-success-${viewport.name}.png`) });
    const ref = emulatorDb().doc(`aurum_wealth/${uid}`);
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
  await page.close();
  const restore = restoreFixture;
  restoreFixture = null;
  if (restore) await restore();
});

async function prepare(page: Page, monthKey = '2026-07') {
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
    await expect(closeSummaryButton).toBeAttached();
    await closeSummaryButton.scrollIntoViewIfNeeded();
    await expect(closeSummaryButton).toBeVisible();
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
