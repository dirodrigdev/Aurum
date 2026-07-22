import { describe, expect, it, vi } from 'vitest';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

vi.mock('../src/services/firebase', () => ({
  auth: { currentUser: null },
}));
vi.mock('../../midas/src/integrations/aurum/firebase', () => ({
  aurumDb: {},
  aurumIntegrationConfigured: false,
  ensureAurumIntegrationAuthPersistence: vi.fn(async () => undefined),
  isMidasE2EFirebaseEmulatorEnabled: vi.fn(() => false),
}));

const { prepareAurumOptimizableInvestmentsSnapshot } = await import('../src/services/midasPublished');
const { resolvePublishedSnapshotData } = await import('../../midas/src/integrations/aurum/optimizableSnapshot');

const makeClosure = (usdClp: number, monthKey = '2026-03'): WealthMonthlyClosure => ({
  id: `c-${monthKey}`,
  monthKey,
  closedAt: `${monthKey}-28T23:59:59.000Z`,
  summary: {
    netByCurrency: { CLP: 1_000_000_000, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: 1_050_000_000, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 50_000_000, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: 1_000_000_000,
    byBlock: {
      bank: { CLP: 120_000_000, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: 650_000_000, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 280_000_000, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: -50_000_000, USD: 0, EUR: 0, UF: 0 },
    },
    investmentClp: 650_000_000,
    netClp: 1_000_000_000,
  },
  fxRates: {
    usdClp,
    eurClp: 1_050,
    ufClp: 38_500,
  },
  fxMetadata: {
    economicMonthKey: monthKey,
    economicDate: `${monthKey}-28`,
    usedFxRates: { usdClp, eurClp: 1_050, ufClp: 38_500 },
    rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
    source: { usd: 'BCCh', eur: 'BCCh', uf: 'SII' },
    retrievedAt: '2026-04-01T09:00:00.000Z',
  },
  records: [],
});

describe('midasPublished fxReference source-of-truth', () => {
  it('uses closure FX provenance instead of device-local active rates', () => {
    const closure = makeClosure(985);
    const deviceA = prepareAurumOptimizableInvestmentsSnapshot([closure], {
      activeFxRates: { usdClp: 886, eurClp: 1_020, ufClp: 38_300 },
    });
    const deviceB = prepareAurumOptimizableInvestmentsSnapshot([closure], {
      activeFxRates: { usdClp: 1_321, eurClp: 1_410, ufClp: 41_200 },
    });
    expect(deviceA.ok).toBe(true);
    expect(deviceB.ok).toBe(true);
    if (!deviceA.ok || !deviceB.ok) return;
    expect(deviceA.snapshot.fxReference).toEqual(deviceB.snapshot.fxReference);
    expect(deviceA.snapshot.fxReference?.clpUsd).toBe(985);
    expect(deviceA.snapshot.fxReference).toMatchObject({
      source: 'closure_fx_metadata',
      sourceId: 'c-2026-03',
      asOf: '2026-03-28',
      validationStatus: 'valid',
      schemaVersion: 1,
    });
  });

  it('uses the same canonical closure FX when local FX is absent', () => {
    const closure = makeClosure(985);
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.fxReference?.clpUsd).toBe(985);
    expect(prepared.snapshot.fxReference?.source).toBe('closure_fx_metadata');
  });

  it('blocks publication when the closure lacks canonical FX provenance', () => {
    const closure = makeClosure(985);
    delete closure.fxMetadata;
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure], {
      activeFxRates: { usdClp: 886, eurClp: 1_020, ufClp: 38_300 },
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain('El cierre 2026-03 no tiene FX canónico completo y trazable');
    expect(prepared.selection.selectedClosureMonthKey).toBeNull();
  });

  it('publishes the latest closure when it is fully canonical', () => {
    const prior = makeClosure(980, '2026-02');
    const latest = makeClosure(985, '2026-03');
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([prior, latest]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.snapshotMonth).toBe('2026-03');
    expect(prepared.selection.skippedClosures).toEqual([]);
  });

  it('skips an invalid latest closure and publishes the previous fully canonical closure', () => {
    const prior = makeClosure(980, '2026-02');
    const latest = makeClosure(985, '2026-03');
    delete latest.fxMetadata;

    const prepared = prepareAurumOptimizableInvestmentsSnapshot([prior, latest]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.snapshotMonth).toBe('2026-02');
    expect(prepared.snapshot.fxReference?.asOf).toBe('2026-02-28');
    expect(prepared.selection).toMatchObject({
      latestClosureMonthKey: '2026-03',
      selectedClosureMonthKey: '2026-02',
      selectedEconomicDate: '2026-02-28',
    });
    expect(prepared.selection.skippedClosures[0]).toMatchObject({ monthKey: '2026-03' });
    expect(resolvePublishedSnapshotData(prepared.snapshot).status).toBe('valid');
  });

  it('does not fall back to local or live FX when no closure is fully canonical', () => {
    const latest = makeClosure(985, '2026-03');
    const prior = makeClosure(980, '2026-02');
    delete latest.fxMetadata;
    delete prior.fxMetadata;
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([latest, prior], {
      activeFxRates: { usdClp: 1_000, eurClp: 1_100, ufClp: 40_000 },
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.selection.selectedClosureMonthKey).toBeNull();
    expect(prepared.selection.skippedClosures.map((item) => item.monthKey)).toEqual(['2026-03', '2026-02']);
  });

  it('uses canonical records for non-optimizable subtotals instead of legacy byBlock when records exist', () => {
    const closure = makeClosure(985);
    closure.summary.byBlock.bank.CLP = 999_999_999;
    closure.summary.byBlock.debt.CLP = -999_999_999;
    closure.records = [
      {
        id: 'bank-real',
        block: 'bank',
        source: 'Fintoc',
        label: 'Banco de Chile CLP',
        amount: 120_000_000,
        currency: 'CLP',
        snapshotDate: '2026-03-31',
        createdAt: '2026-03-31T12:00:00Z',
      },
      {
        id: 'card-debt',
        block: 'bank',
        source: 'Fintoc',
        label: 'Deuda tarjetas CLP',
        amount: 20_000_000,
        currency: 'CLP',
        snapshotDate: '2026-03-31',
        createdAt: '2026-03-31T12:00:00Z',
      },
      {
        id: 'property',
        block: 'real_estate',
        source: 'Manual',
        label: 'Valor propiedad',
        amount: 300_000_000,
        currency: 'CLP',
        snapshotDate: '2026-03-31',
        createdAt: '2026-03-31T12:00:00Z',
      },
      {
        id: 'mortgage',
        block: 'debt',
        source: 'Banco',
        label: 'Saldo deuda hipotecaria',
        amount: 120_000_000,
        currency: 'CLP',
        snapshotDate: '2026-03-31',
        createdAt: '2026-03-31T12:00:00Z',
      },
    ];
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.nonOptimizable?.banksCLP).toBe(120_000_000);
    expect(prepared.snapshot.nonOptimizable?.nonMortgageDebtCLP).toBe(20_000_000);
    expect(prepared.snapshot.nonOptimizable?.realEstate?.propertyValueCLP).toBe(300_000_000);
    expect(prepared.snapshot.nonOptimizable?.realEstate?.mortgageDebtOutstandingCLP).toBe(120_000_000);
  });
});
