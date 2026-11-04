import { HISTORICAL_ADMIN_EMAIL, fingerprintValue, calculateHistoricalClosureSummary } from '../admin/_historicalClosureCore.js';
const fail = (code, message, statusCode = 409) => { throw Object.assign(new Error(message), { code, statusCode }); };
const number = value => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const same = (a, b) => fingerprintValue(a ?? null) === fingerprintValue(b ?? null);
const publicationContent = ({ publishedAt: _time, snapshotLabel: _label, publishedByUid: _uid, sourceClosureFingerprint: _sourceHash, publicationHash: _hash, ...snapshot }) => snapshot;
/** Validate values against the current persisted closure, never a client timestamp. */
export function assertCurrentClosureSnapshot(snapshot, closure) {
    if (!closure || snapshot.snapshotMonth !== closure.monthKey || snapshot.fxReference?.sourceId !== closure.id) {
        fail('source_changed', 'El cierre de origen cambió. Sincroniza Aurum y vuelve a publicar.');
    }
    const summary = closure.summary || {};
    const net = number(summary.netClp) ?? number(summary.netConsolidatedClp);
    const investment = number(summary.investmentClp);
    if (net === null || investment === null)
        fail('latest_closure_invalid', 'El último cierre no contiene los importes necesarios para publicar.');
    const assertAmount = (actual, expected) => {
        if (expected === null || number(actual) !== Math.round(expected))
            fail('source_changed', 'Los importes enviados no corresponden al cierre persistido. Sincroniza Aurum.');
    };
    assertAmount(snapshot.totalNetWorthCLP, net);
    assertAmount(snapshot.optimizableInvestmentsCLP, investment);
    for (const [key, value] of [
        ['totalNetWorthWithRiskCLP', number(summary.netClpWithRisk) ?? number(summary.netConsolidatedClp)],
        ['optimizableInvestmentsWithRiskCLP', number(summary.investmentClpWithRisk)],
    ]) {
        if (snapshot.version === 2 || snapshot[key] !== undefined) {
            if (value === null ? snapshot[key] !== undefined : number(snapshot[key]) !== Math.round(value))
                fail('source_changed', 'El desglose enviado no corresponde al cierre persistido.');
        }
    }
    const rates = closure.fxRates || {};
    const metadata = closure.fxMetadata || {};
    const used = metadata.usedFxRates || rates;
    if (metadata.economicMonthKey !== closure.monthKey || !String(metadata.economicDate || '').startsWith(closure.monthKey + '-')) {
        fail('latest_closure_invalid', 'El último cierre no tiene una referencia FX publicable.');
    }
    for (const key of ['usdClp', 'eurClp', 'ufClp']) {
        if (!(number(used[key]) > 0) || number(used[key]) !== number(rates[key]))
            fail('latest_closure_invalid', 'La referencia FX persistida no es coherente.');
    }
    const fx = snapshot.fxReference;
    const expectedRates = { clpUsd: Math.round(rates.usdClp), clpEur: Math.round(rates.eurClp),
        usdEur: Math.round(rates.usdClp / rates.eurClp * 10000) / 10000, ufClp: Math.round(rates.ufClp) };
    if (!fx || Object.entries(expectedRates).some(([k, value]) => fx[k] !== value) || fx.asOf !== metadata.economicDate) {
        fail('source_changed', 'La referencia FX enviada no coincide con el cierre persistido.');
    }
    for (const currency of ['usd', 'eur', 'uf']) {
        const origin = metadata.rateOrigin?.[currency];
        const source = String(metadata.source?.[currency] || (origin === 'manual' ? 'manual' : '')).trim();
        if (!origin || !source || fx.rateOrigin?.[currency] !== origin || fx.rateSource?.[currency] !== source)
            fail('source_changed', 'La procedencia FX enviada no coincide con el cierre persistido.');
    }
    if (snapshot.version !== 2)
        return;
    const records = Array.isArray(closure.records) ? closure.records : [];
    const clp = record => {
        const amount = Math.abs(Number(record.amount || 0));
        const rate = { CLP: 1, USD: rates.usdClp, EUR: rates.eurClp, UF: rates.ufClp }[record.currency];
        return Number.isFinite(amount * rate) ? amount * rate : null;
    };
    let property = 0, mortgage = 0, payment = 0, cards = 0;
    for (const record of records) {
        const value = clp(record);
        if (value === null)
            continue;
        const label = text(record.label);
        if (record.block === 'real_estate' && label.includes('valor propiedad'))
            property += value;
        if (record.block !== 'debt')
            continue;
        if (label.includes('saldo deuda hipotecaria'))
            mortgage += value;
        else if (label.includes('dividendo hipotecario'))
            payment += value;
        else if (label.includes('tarjeta'))
            cards += value;
    }
    const resolved = records.length ? calculateHistoricalClosureSummary(records, rates) : summary;
    const banks = number(resolved.bankClp) ?? number(summary.byBlock?.bank?.CLP);
    let debt = number(resolved.nonMortgageDebtClp) ?? Math.abs(number(summary.byBlock?.debt?.CLP) || 0);
    const extended = ['investmentClp', 'investmentClpWithRisk', 'bankClp', 'realEstateAssetsClp', 'mortgageDebtClp', 'realEstateNetClp', 'nonMortgageDebtClp', 'netClp', 'netClpWithRisk']
        .every(key => Number.isFinite(Number(summary[key])));
    const legacyDebt = Math.abs(number(summary.byBlock?.debt?.CLP) || 0);
    if (!records.length && extended && debt < 1 && legacyDebt >= 1000000)
        debt = legacyDebt;
    const non = snapshot.nonOptimizable || {};
    assertAmount(non.banksCLP, Math.max(0, banks ?? 0));
    assertAmount(non.nonMortgageDebtCLP, Math.abs(debt));
    if (property > 0 || mortgage > 0 || payment > 0) {
        const house = non.realEstate || {};
        for (const [key, value] of Object.entries({ propertyValueCLP: property, mortgageDebtOutstandingCLP: mortgage,
            monthlyMortgagePaymentCLP: payment, realEstateEquityCLP: Math.max(0, property - mortgage), ufSnapshotCLP: rates.ufClp }))
            assertAmount(house[key], value);
    }
    else if (non.realEstate)
        fail('source_changed', 'El inmueble enviado no corresponde al cierre persistido.');
    const riskTotal = Math.max(0, number(resolved.riskCapitalClp) || 0, (number(resolved.investmentClpWithRisk) ?? investment) - (number(resolved.investmentClp) ?? investment));
    if (riskTotal > 0) {
        assertAmount(snapshot.riskCapital?.totalCLP, riskTotal);
        const analysis = summary.analysisByCurrency || {};
        const usdDelta = number(analysis.usdWithRisk) !== null && number(analysis.usdWithoutRisk) !== null
            ? Math.max(0, Number(analysis.usdWithRisk) - Number(analysis.usdWithoutRisk)) : null;
        const clpDelta = number(analysis.clpWithRisk) !== null && number(analysis.clpWithoutRisk) !== null
            ? Math.max(0, Number(analysis.clpWithRisk) - Number(analysis.clpWithoutRisk)) : null;
        const expectedClp = clpDelta ?? (usdDelta !== null ? Math.max(0, riskTotal - usdDelta * rates.usdClp) : null);
        if (expectedClp !== null)
            assertAmount(snapshot.riskCapital?.clp, expectedClp);
        if (usdDelta !== null && snapshot.riskCapital?.usd !== Math.round(usdDelta * 100) / 100)
            fail('source_changed', 'El desglose de riesgo cambió.');
        assertAmount(snapshot.riskCapital?.usdSnapshotCLP, rates.usdClp);
    }
    else if (snapshot.riskCapital)
        fail('source_changed', 'El capital de riesgo enviado no corresponde al cierre persistido.');
}
export async function publishSnapshotFromCurrentSource(db, identity, snapshot, now = () => new Date().toISOString()) {
    if (!identity?.uid) {
        fail('publisher_forbidden', 'La sesión no está autorizada para publicar la base global de MIDAS.', 403);
    }
    const root = db.collection('aurum_wealth').doc(identity.uid);
    const published = db.collection('aurum_published').doc('optimizableInvestments');
    return db.runTransaction(async (tx) => {
        const [source, previous] = await Promise.all([tx.get(root), tx.get(published)]);
        if (!source.exists)
            fail('source_missing', 'No existe un cierre persistido para esta sesión.');
        const current = previous.exists ? previous.data() : null;
        // An established owner is pinned by immutable Firebase UID. A legacy or
        // missing publication is bootstrapped only by the existing verified admin.
        if (current?.publishedByUid ? current.publishedByUid !== identity.uid
            : identity.email?.toLowerCase() !== HISTORICAL_ADMIN_EMAIL || identity.emailVerified !== true) {
            fail('publisher_forbidden', 'La sesión no corresponde al propietario autorizado de la publicación.', 403);
        }
        const closures = source.data().closures;
        if (!Array.isArray(closures) || !closures.length)
            fail('source_missing', 'No hay cierres persistidos para publicar.');
        const latest = [...closures].sort((a, b) => String(b.monthKey).localeCompare(String(a.monthKey)))[0];
        const removed = source.data().closureDeletionTombstones?.find(t => t.monthKey === latest.monthKey);
        if (removed) {
            const numeric = value => Number(value) || 0;
            const summary = latest.summary || {};
            const fingerprint = JSON.stringify({ id: latest.id, monthKey: latest.monthKey, closedAt: latest.closedAt,
                netClp: numeric(summary.netClp ?? summary.netConsolidatedClp), investmentClp: numeric(summary.investmentClp),
                bankClp: numeric(summary.bankClp), realEstateNetClp: numeric(summary.realEstateNetClp), nonMortgageDebtClp: numeric(summary.nonMortgageDebtClp) });
            const suppressed = removed.removedClosureFingerprint ? fingerprint === removed.removedClosureFingerprint
                : Date.parse(latest.closedAt) <= Date.parse(removed.removedAt);
            if (suppressed)
                fail('source_deleted', 'El último cierre fue retirado. No se publicará un cierre anterior.');
        }
        if (closures.filter(c => c.monthKey === latest.monthKey).length !== 1)
            fail('source_ambiguous', 'Hay versiones actuales ambiguas para el último mes.');
        if (current?.snapshotMonth > latest.monthKey || (current?.version === 2 && snapshot.version === 1))
            fail('obsolete_publication', 'No se puede reemplazar una publicación por una versión anterior.');
        assertCurrentClosureSnapshot(snapshot, latest);
        // Technical refresh clocks come from the source, never an older browser.
        const {fetchedAt:_fetched,lastSuccessfulRefreshAt:_refreshed,...reference}=snapshot.fxReference;
        const retrievedAt=latest.fxMetadata?.retrievedAt;
        const snapshotToWrite={...snapshot,fxReference:{...reference,...(retrievedAt ? {fetchedAt:retrievedAt,lastSuccessfulRefreshAt:retrievedAt}: {})}};
        const publicationHash = fingerprintValue(publicationContent(snapshotToWrite));
        if (current && same(publicationContent(current), publicationContent(snapshotToWrite)))
            return { ok: true, result: 'unchanged' };
        const sourceClosureFingerprint = fingerprintValue({ id: latest.id, monthKey: latest.monthKey,
            summary: latest.summary, records: latest.records, fxRates: latest.fxRates, fxMetadata: latest.fxMetadata });
        tx.set(published, { ...snapshotToWrite, publishedAt: now(), publishedByUid: identity.uid, sourceClosureFingerprint, publicationHash }, { merge: false });
        return { ok: true, result: 'published' };
    });
}
