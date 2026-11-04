import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/firebase', () => ({ db: {}, auth: { currentUser: null } }));
import { prepareAurumOptimizableInvestmentsSnapshot } from '../src/services/midasPublished';
import { buildCanonicalClosureSummary } from '../src/services/wealthStorage';
import { HISTORICAL_ADMIN_EMAIL } from '../api/admin/_historicalClosureCore.js';
import { assertCurrentClosureSnapshot, publishSnapshotFromCurrentSource } from '../api/midas/_publicationIntegrity.js';
export const identity = { uid: 'synthetic-owner', email: HISTORICAL_ADMIN_EMAIL, emailVerified: true };
export function fixture(monthKey = '2026-06', delta = 0) {
    const fxRates = { usdClp: 922.34, eurClp: 1050.38, ufClp: 40820.31 };
    const records = [
        { id: 'investment', block: 'investment', label: 'Inversión CLP', amount: 500000000 + delta, currency: 'CLP' },
        { id: 'risk', block: 'investment', label: 'Capital de riesgo USD', amount: 2500, currency: 'USD' },
        { id: 'bank', block: 'bank', label: 'Banco de Chile CLP', amount: 20000000, currency: 'CLP' },
        { id: 'bank-usd', block: 'bank', label: 'Banco de Chile USD', amount: 1000.33, currency: 'USD' },
        { id: 'aggregate', block: 'bank', label: 'Saldo bancos CLP', amount: 999000000, currency: 'CLP' },
        { id: 'card', block: 'bank', label: 'Deuda tarjetas CLP', amount: 2000000, currency: 'CLP' },
        { id: 'property', block: 'real_estate', label: 'Valor propiedad', amount: 12000, currency: 'UF' },
        { id: 'mortgage', block: 'debt', label: 'Saldo deuda hipotecaria', amount: 4000, currency: 'UF' },
        { id: 'payment', block: 'debt', label: 'Dividendo hipotecario', amount: 25, currency: 'UF' },
    ].map(r => ({ ...r, source: 'Manual', snapshotDate: `${monthKey}-28`, createdAt: `${monthKey}-28T12:00:00Z` }));
    const closure = { id: `closure-${monthKey}`, monthKey, closedAt: `${monthKey}-28T12:00:00Z`, records, fxRates,
        fxMetadata: { economicMonthKey: monthKey, economicDate: `${monthKey}-28`, usedFxRates: fxRates,
            rateOrigin: { usd: 'manual', eur: 'manual', uf: 'manual' }, source: { usd: 'manual', eur: 'manual', uf: 'manual' }, retrievedAt: `${monthKey}-28T12:00:00Z` },
        summary: buildCanonicalClosureSummary(records as never[], fxRates) };
    const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure] as never[]);
    if (!prepared.ok)
        throw Error(prepared.reason);
    return { closure, snapshot: prepared.snapshot };
}
function fakeDb(closures: unknown[], current: unknown = null) {
    const state = { current, writes: 0 };
    return { state, collection: (collection: string) => ({ doc: (id: string) => ({ collection, id }) }),
        runTransaction: async (run: (tx: unknown) => unknown) => run({
            get: async (ref: {
                collection: string;
            }) => ({ exists: ref.collection === 'aurum_wealth' || state.current !== null,
                data: () => ref.collection === 'aurum_wealth' ? { closures } : state.current }),
            set: (_ref: unknown, value: unknown) => { state.current = value; state.writes++; },
        }) };
}
describe('publication authorized against persisted source', () => {
    it('matches the current browser projection, including canonical records and decimal FX', () => {
        const { closure, snapshot } = fixture();
        expect(() => assertCurrentClosureSnapshot(snapshot, closure)).not.toThrow();
        const legacy = { ...snapshot, version: 1 };
        delete legacy.nonOptimizable;
        expect(() => assertCurrentClosureSnapshot(legacy, closure)).not.toThrow();
    });
    it('retains summary-only historical compatibility', () => {
        const { closure } = fixture();
        closure.records = [];
        const prepared = prepareAurumOptimizableInvestmentsSnapshot([closure] as never[]);
        expect(prepared.ok).toBe(true);
        if (prepared.ok)
            expect(() => assertCurrentClosureSnapshot(prepared.snapshot, closure)).not.toThrow();
    });
    it('rejects unauthorized or unverified sessions before reading', async () => {
        const { closure, snapshot } = fixture();
        const db = fakeDb([closure]);
        for (const unauthorized of [{ ...identity, uid: 'other-user', email: 'other@example.test' }, { ...identity, emailVerified: false }])
            await expect(publishSnapshotFromCurrentSource(db, unauthorized, snapshot)).rejects.toMatchObject({ statusCode: 403 });
        expect(db.state.writes).toBe(0);
    });
    it('rejects same-month obsolete amounts even with a future browser publication time', async () => {
        const old = fixture();
        const current = fixture('2026-06', 500);
        const db = fakeDb([current.closure]);
        await expect(publishSnapshotFromCurrentSource(db, identity, { ...old.snapshot, publishedAt: '2099-01-01' })).rejects.toMatchObject({ code: 'source_changed' });
        expect(db.state.writes).toBe(0);
    });
    it('rejects forged bank, house, FX and risk values', () => {
        const { closure, snapshot } = fixture();
        for (const forged of [
            { ...snapshot, nonOptimizable: { ...snapshot.nonOptimizable, banksCLP: 1 } },
            { ...snapshot, nonOptimizable: { ...snapshot.nonOptimizable, realEstate: { ...snapshot.nonOptimizable?.realEstate, propertyValueCLP: 1 } } },
            { ...snapshot, riskCapital: { ...snapshot.riskCapital, totalCLP: 1 } },
            { ...snapshot, fxReference: { ...snapshot.fxReference, clpUsd: 1 } },
        ])
            expect(() => assertCurrentClosureSnapshot(forged, closure)).toThrow();
    });
    it('never selects a valid older month when the latest source is invalid', async () => {
        const old = fixture('2026-05');
        const latest = fixture();
        delete latest.closure.fxMetadata;
        const db = fakeDb([old.closure, latest.closure]);
        await expect(publishSnapshotFromCurrentSource(db, identity, old.snapshot)).rejects.toMatchObject({ code: 'source_changed' });
        await expect(publishSnapshotFromCurrentSource(db, identity, latest.snapshot)).rejects.toMatchObject({ code: 'latest_closure_invalid' });
        expect(db.state.writes).toBe(0);
    });
    it('is idempotent without trusting timestamps and cannot take over another owner', async () => {
        const { closure, snapshot } = fixture();
        const db = fakeDb([closure]);
        expect(await publishSnapshotFromCurrentSource(db, identity, snapshot)).toMatchObject({ result: 'published' });
        expect(await publishSnapshotFromCurrentSource(db, identity, { ...snapshot, publishedAt: '2099-01-01' })).toMatchObject({ result: 'unchanged' });
        expect(db.state.writes).toBe(1);
        (db.state.current as Record<string, unknown>).publishedByUid = 'other-owner';
        await expect(publishSnapshotFromCurrentSource(db, identity, snapshot)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('does not roll refresh provenance backward when an otherwise identical request is retried',async()=>{
      const {closure,snapshot}=fixture();const db=fakeDb([closure]);
      await publishSnapshotFromCurrentSource(db,identity,snapshot);
      await publishSnapshotFromCurrentSource(db,identity,{...snapshot,fxReference:{...snapshot.fxReference,fetchedAt:'2000-01-01',lastSuccessfulRefreshAt:'2000-01-01'}});
      expect(db.state.writes).toBe(1);
      expect((db.state.current as any).fxReference.fetchedAt).toBe(closure.fxMetadata.retrievedAt);
    });

});
