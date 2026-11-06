// Direct Node ESM + real Firestore transactions. Never falls back to production.
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { publishSnapshotFromCurrentSource } from '../apps/aurum/api/midas/_publicationIntegrity.js';
import { calculateHistoricalClosureSummary, HISTORICAL_ADMIN_EMAIL } from '../apps/aurum/api/admin/_historicalClosureCore.js';
import handler from '../apps/aurum/api/midas/publish-snapshot.js';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.GCLOUD_PROJECT, 'aurum-e2e-local');
const app = initializeApp({ projectId: 'aurum-e2e-local' }, 'publication-test');
const db = getFirestore(app);
const identity = { uid: 'publication-synthetic-owner', email: HISTORICAL_ADMIN_EMAIL, emailVerified: true };
const root = db.doc(`aurum_wealth/${identity.uid}`), published = db.doc('aurum_published/optimizableInvestments');
const fx = { usdClp: 900, eurClp: 1000, ufClp: 40000 };
const closure = delta => { const records = [{ id: 'investment', block: 'investment', label: 'Inversión', source: 'Manual', currency: 'CLP', amount: 1000000 + delta, createdAt: '2026-10-31' }]; return { id: 'closure-2026-10', monthKey: '2026-10', closedAt: '2026-10-31T12:00:00Z', records, summary: calculateHistoricalClosureSummary(records, fx), fxRates: fx, fxMetadata: { economicMonthKey: '2026-10', economicDate: '2026-10-31', usedFxRates: fx, rateOrigin: { usd: 'manual', eur: 'manual', uf: 'manual' }, source: { usd: 'manual', eur: 'manual', uf: 'manual' } } }; };
const snapshot = delta => ({ version: 2, publishedAt: '2099-01-01', snapshotMonth: '2026-10', snapshotLabel: 'Synthetic', currency: 'CLP', totalNetWorthCLP: 1000000 + delta, totalNetWorthWithRiskCLP: 1000000 + delta, optimizableInvestmentsCLP: 1000000 + delta, optimizableInvestmentsWithRiskCLP: 1000000 + delta, nonOptimizable: { banksCLP: 0, nonMortgageDebtCLP: 0 }, fxReference: { clpUsd: 900, clpEur: 1000, usdEur: .9, ufClp: 40000, source: 'closure_fx_metadata', sourceId: 'closure-2026-10', asOf: '2026-10-31', validationStatus: 'valid', schemaVersion: 1, rateOrigin: { usd: 'manual', eur: 'manual', uf: 'manual' }, rateSource: { usd: 'manual', eur: 'manual', uf: 'manual' } }, source: { app: 'aurum', basis: 'latest_confirmed_closure' }, fx: { usdClp: 900, eurClp: 1000, ufClp: 40000, source: 'closure_fx_metadata' } });
let status, payload;
const response = { status(n) { status = n; return this; }, json(x) { payload = x; return this; }, setHeader() { } };
await handler({ method: 'POST', headers: {}, body: { snapshot: snapshot(0) } }, response);
assert.equal(status, 401);
assert.equal(payload.ok, false);
console.log('PASS direct Node ESM endpoint: controlled unauthenticated rejection');
try {
    await published.delete();
    await root.set({ closures: [closure(0)], financialSentinel: 'unchanged' });
    await assert.rejects(publishSnapshotFromCurrentSource(db, { ...identity, email: 'other@example.test', uid: 'other-user' }, snapshot(0)));
    const realFetch = globalThis.fetch;
    process.env.FIREBASE_WEB_API_KEY = 'synthetic-emulator-key';
    globalThis.fetch = async (url) => {
        assert(String(url).startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup'));
        return { ok: true, json: async () => ({ users: [{ localId: identity.uid, email: identity.email, emailVerified: true }] }) };
    };
    try {
        await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-emulator-token' }, body: { snapshot: snapshot(0) } }, response);
    }
    finally {
        globalThis.fetch = realFetch;
        delete process.env.FIREBASE_WEB_API_KEY;
    }
    assert.equal(status, 200);
    assert.equal(payload.result, 'published');
    console.log('PASS actual API normalization, authenticated identity and persisted source transaction');
    const first = await published.get();
    await publishSnapshotFromCurrentSource(db, identity, { ...snapshot(0), publishedAt: '2100-01-01' });
    assert.equal((await published.get()).updateTime.toMillis(), first.updateTime.toMillis());
    console.log('PASS authoritative source, authorization and no-write idempotency');
    const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
    assert.match(authHost||'',/^(127\.0\.0\.1|localhost):\d+$/);
    const signIn=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
    const intruder=await signIn.json();assert.equal(signIn.status,200);
    try {
      const blocked=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/aurum-e2e-local/databases/(default)/documents/aurum_published/optimizableInvestments`,{method:'PATCH',headers:{authorization:`Bearer ${intruder.idToken}`,'content-type':'application/json'},body:JSON.stringify({fields:{version:{integerValue:'1'}}})});
      assert.equal(blocked.status,403,'signed-in browsers cannot bypass the publication API');
    } finally {await getAuth(app).deleteUser(intruder.localId);}
    console.log('PASS deployed Rules contract denies direct signed-in browser writes');

    // Pause after the source read. A real concurrent root mutation forces Firestore
    // to retry the publication transaction and reject the obsolete same-month payload.
    let release, started;
    const barrier = new Promise(r => release = r), readStarted = new Promise(r => started = r);
    let intercepted = false;
    const wrapped = { collection: (...args) => db.collection(...args), runTransaction: fn => db.runTransaction(tx => fn({
            get: async (ref) => { const result = await tx.get(ref); if (ref.path === root.path && !intercepted) {
                intercepted = true;
                started();
                await barrier;
            } return result; },
            set: (...args) => tx.set(...args),
        })) };
    // Pessimistic locking serializes the update with the in-flight source read.
    // Once the new source is committed, every delayed old publication must fail.
    const resultPromise = publishSnapshotFromCurrentSource(wrapped, identity, snapshot(0));
    await readStarted;
    const update = root.set({ closures: [closure(100)], financialSentinel: 'unchanged' });
    release();
    await resultPromise;
    await update;
    await assert.rejects(publishSnapshotFromCurrentSource(db, identity, snapshot(0)), e => e.code === 'source_changed');
    await publishSnapshotFromCurrentSource(db, identity, snapshot(100));
    await assert.rejects(publishSnapshotFromCurrentSource(db, identity, { ...snapshot(0), publishedAt: '2999-01-01' }), e => e.code === 'source_changed');
    const replies = await Promise.all(Array.from({ length: 4 }, () => publishSnapshotFromCurrentSource(db, identity, snapshot(100))));
    assert(replies.every(r => r.result === 'unchanged'));
    assert.equal((await published.get()).data().optimizableInvestmentsCLP, 1000100);
    assert.equal((await root.get()).data().financialSentinel, 'unchanged');
    console.log('PASS serialized concurrent source update, stale rejection and parallel idempotency');
    const unchangedPublication = await published.get();
    for (const [code, source, candidate] of [
      ['source_deleted', { closures: [closure(100)], closureDeletionTombstones: [{ monthKey: '2026-10', removedAt: '2026-11-01T00:00:00Z' }] }, snapshot(100)],
      ['source_ambiguous', { closures: [closure(100), { ...closure(100), id: 'other-current-closure' }] }, snapshot(100)],
      ['obsolete_publication', { closures: [closure(100)] }, { ...snapshot(100), version: 1 }],
    ]) {
      await root.set({ ...source, financialSentinel: 'unchanged' });
      await assert.rejects(publishSnapshotFromCurrentSource(db, identity, candidate), error => error.code === code);
      const afterRejection = await published.get();
      assert.equal(afterRejection.updateTime.toMillis(), unchangedPublication.updateTime.toMillis());
      assert.deepEqual(afterRejection.data(), unchangedPublication.data());
      console.log(`PASS ${code}: previous publication preserved without writes`);
    }
    const before = (await published.get()).updateTime.toMillis();
    await root.set({ closures: [{ ...closure(100), fxMetadata: {} }], financialSentinel: 'unchanged' });
    await assert.rejects(publishSnapshotFromCurrentSource(db, identity, snapshot(100)));
    assert.equal((await published.get()).updateTime.toMillis(), before);
    console.log('PASS invalid latest source fails safely without changing published data');
}
finally {
    await published.delete();
    await root.delete();
    await deleteApp(app);
}
