import { requireFirebaseAuth } from '../_firebaseAuth.js';
import { getAdminDb } from '../_firestoreAdmin.js';

const PUBLISHED_COLLECTION = 'aurum_published';
const OPTIMIZABLE_DOC_ID = 'optimizableInvestments';
const WEALTH_COLLECTION = 'aurum_wealth';

const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const asFiniteOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeRealEstate = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const realEstate = value;
  const propertyValueCLP = asFiniteOrNull(realEstate.propertyValueCLP);
  const realEstateEquityCLP = asFiniteOrNull(realEstate.realEstateEquityCLP);
  const mortgageDebtOutstandingCLP = asFiniteOrNull(realEstate.mortgageDebtOutstandingCLP);
  const monthlyMortgagePaymentCLP = asFiniteOrNull(realEstate.monthlyMortgagePaymentCLP);
  const mortgageRate = asFiniteOrNull(realEstate.mortgageRate);
  const ufSnapshotCLP = asFiniteOrNull(realEstate.ufSnapshotCLP);
  const mortgageEndDate =
    typeof realEstate.mortgageEndDate === 'string' && realEstate.mortgageEndDate.trim()
      ? realEstate.mortgageEndDate.trim()
      : undefined;
  const amortizationSystem =
    typeof realEstate.amortizationSystem === 'string' && realEstate.amortizationSystem.trim()
      ? realEstate.amortizationSystem.trim()
      : undefined;
  const mortgageScheduleCLP = Array.isArray(realEstate.mortgageScheduleCLP)
    ? realEstate.mortgageScheduleCLP
        .map((point) => {
          if (!point || typeof point !== 'object') return null;
          const month = asFiniteOrNull(point.month);
          const debtCLP = asFiniteOrNull(point.debtCLP);
          if (month === null || debtCLP === null) return null;
          return {
            month: Math.max(1, Math.round(month)),
            debtCLP: Math.max(0, Math.round(debtCLP)),
          };
        })
        .filter(Boolean)
    : undefined;

  const normalized = {
    ...(propertyValueCLP !== null ? { propertyValueCLP: Math.round(propertyValueCLP) } : {}),
    ...(realEstateEquityCLP !== null ? { realEstateEquityCLP: Math.round(realEstateEquityCLP) } : {}),
    ...(mortgageDebtOutstandingCLP !== null
      ? { mortgageDebtOutstandingCLP: Math.round(mortgageDebtOutstandingCLP) }
      : {}),
    ...(monthlyMortgagePaymentCLP !== null
      ? { monthlyMortgagePaymentCLP: Math.round(monthlyMortgagePaymentCLP) }
      : {}),
    ...(mortgageRate !== null ? { mortgageRate } : {}),
    ...(ufSnapshotCLP !== null ? { ufSnapshotCLP: Math.round(ufSnapshotCLP) } : {}),
    ...(mortgageEndDate ? { mortgageEndDate } : {}),
    ...(amortizationSystem ? { amortizationSystem } : {}),
    ...(mortgageScheduleCLP && mortgageScheduleCLP.length > 0 ? { mortgageScheduleCLP } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeRiskCapital = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const risk = value;
  const totalCLP = asFiniteOrNull(risk.totalCLP ?? risk.totalClp ?? risk.clpTotal);
  const clp = asFiniteOrNull(risk.clp);
  const usd = asFiniteOrNull(risk.usd);
  const usdSnapshotCLP = asFiniteOrNull(risk.usdSnapshotCLP);
  const source =
    typeof risk.source === 'string' && risk.source.trim()
      ? risk.source.trim()
      : undefined;

  if (totalCLP === null || totalCLP <= 0) return undefined;

  const normalized = {
    totalCLP: Math.round(totalCLP),
    ...(clp !== null ? { clp: Math.round(Math.max(0, clp)) } : {}),
    ...(usd !== null ? { usd: Math.round(Math.max(0, usd) * 100) / 100 } : {}),
    ...(usdSnapshotCLP !== null && usdSnapshotCLP > 0 ? { usdSnapshotCLP: Math.round(usdSnapshotCLP) } : {}),
    ...(source ? { source } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeFxReference = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const fx = value;
  const clpUsd = asFiniteOrNull(fx.clpUsd);
  if (clpUsd === null || clpUsd <= 0) return undefined;
  const clpEur = asFiniteOrNull(fx.clpEur);
  const usdEur = asFiniteOrNull(fx.usdEur);
  const ufClp = asFiniteOrNull(fx.ufClp);
  const source =
    typeof fx.source === 'string' && fx.source.trim()
      ? fx.source.trim()
      : undefined;
  const normalized = {
    clpUsd: Math.round(clpUsd),
    ...(clpEur !== null && clpEur > 0 ? { clpEur: Math.round(clpEur) } : {}),
    ...(usdEur !== null && usdEur > 0 ? { usdEur: Math.round(usdEur * 10_000) / 10_000 } : {}),
    ...(ufClp !== null && ufClp > 0 ? { ufClp: Math.round(ufClp) } : {}),
    ...(source ? { source } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeActiveFxRates = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const usdClp = asFiniteOrNull(value.usdClp);
  if (usdClp === null || usdClp <= 0) return undefined;
  const eurClp = asFiniteOrNull(value.eurClp);
  const ufClp = asFiniteOrNull(value.ufClp);
  const usdEur = eurClp !== null && eurClp > 0 ? usdClp / eurClp : null;
  return {
    clpUsd: Math.round(usdClp),
    ...(eurClp !== null && eurClp > 0 ? { clpEur: Math.round(eurClp) } : {}),
    ...(usdEur !== null && usdEur > 0 ? { usdEur: Math.round(usdEur * 10_000) / 10_000 } : {}),
    ...(ufClp !== null && ufClp > 0 ? { ufClp: Math.round(ufClp) } : {}),
    source: 'active_fx_rates',
  };
};

const withFxReferenceFromActiveRates = (snapshot, activeRates) => {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (snapshot.fxReference && asFiniteOrNull(snapshot.fxReference.clpUsd) > 0) return snapshot;
  const derived = normalizeActiveFxRates(activeRates);
  if (!derived) return snapshot;
  return {
    ...snapshot,
    fxReference: derived,
  };
};

const mirrorLegacyFxFromFxReference = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const clpUsd = asFiniteOrNull(snapshot.fxReference?.clpUsd);
  if (clpUsd === null || clpUsd <= 0) return snapshot;
  const clpEur = asFiniteOrNull(snapshot.fxReference?.clpEur);
  const ufClp = asFiniteOrNull(snapshot.fxReference?.ufClp);
  return {
    ...snapshot,
    fx: {
      usdClp: Math.round(clpUsd),
      ...(clpEur !== null && clpEur > 0 ? { eurClp: Math.round(clpEur) } : {}),
      ...(ufClp !== null && ufClp > 0 ? { ufClp: Math.round(ufClp) } : {}),
      source: snapshot.fxReference?.source || 'active_fx_rates',
    },
  };
};

const normalizeSnapshotPayload = (raw, activeFxRatesRaw) => {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Debes enviar snapshot en el body.' };
  }

  const snapshot = raw;
  const version = Number(snapshot.version) === 2 ? 2 : 1;
  const publishedAt =
    typeof snapshot.publishedAt === 'string' && snapshot.publishedAt.trim()
      ? snapshot.publishedAt.trim()
      : new Date().toISOString();
  const snapshotMonth =
    typeof snapshot.snapshotMonth === 'string' && snapshot.snapshotMonth.trim()
      ? snapshot.snapshotMonth.trim()
      : '';
  const snapshotLabel =
    typeof snapshot.snapshotLabel === 'string' && snapshot.snapshotLabel.trim()
      ? snapshot.snapshotLabel.trim()
      : '';
  const totalNetWorthCLP = asFiniteOrNull(snapshot.totalNetWorthCLP);
  const optimizableInvestmentsCLP = asFiniteOrNull(snapshot.optimizableInvestmentsCLP);

  if (!snapshotMonth) return { ok: false, error: 'snapshotMonth es obligatorio.' };
  if (!snapshotLabel) return { ok: false, error: 'snapshotLabel es obligatorio.' };
  if (totalNetWorthCLP === null) return { ok: false, error: 'totalNetWorthCLP inválido.' };
  if (optimizableInvestmentsCLP === null) return { ok: false, error: 'optimizableInvestmentsCLP inválido.' };

  const totalNetWorthWithRiskCLP = asFiniteOrNull(snapshot.totalNetWorthWithRiskCLP);
  const optimizableInvestmentsWithRiskCLP = asFiniteOrNull(snapshot.optimizableInvestmentsWithRiskCLP);
  const riskCapital = normalizeRiskCapital(snapshot.riskCapital);
  const fxReference =
    normalizeFxReference(snapshot.fxReference) ||
    normalizeActiveFxRates(activeFxRatesRaw) ||
    normalizeActiveFxRates(snapshot.fx);
  const nonOptimizable =
    snapshot.nonOptimizable && typeof snapshot.nonOptimizable === 'object'
      ? {
          ...(asFiniteOrNull(snapshot.nonOptimizable.banksCLP) !== null
            ? { banksCLP: Math.round(asFiniteOrNull(snapshot.nonOptimizable.banksCLP)) }
            : {}),
          ...(asFiniteOrNull(snapshot.nonOptimizable.nonMortgageDebtCLP) !== null
            ? { nonMortgageDebtCLP: Math.round(asFiniteOrNull(snapshot.nonOptimizable.nonMortgageDebtCLP)) }
            : {}),
          ...(normalizeRealEstate(snapshot.nonOptimizable.realEstate)
            ? { realEstate: normalizeRealEstate(snapshot.nonOptimizable.realEstate) }
            : {}),
        }
      : undefined;

  return {
    ok: true,
    snapshot: {
      version,
      publishedAt,
      snapshotMonth,
      snapshotLabel,
      currency: 'CLP',
      totalNetWorthCLP: Math.round(totalNetWorthCLP),
      ...(totalNetWorthWithRiskCLP !== null
        ? { totalNetWorthWithRiskCLP: Math.round(totalNetWorthWithRiskCLP) }
        : {}),
      optimizableInvestmentsCLP: Math.round(optimizableInvestmentsCLP),
      ...(optimizableInvestmentsWithRiskCLP !== null
        ? { optimizableInvestmentsWithRiskCLP: Math.round(optimizableInvestmentsWithRiskCLP) }
        : {}),
      ...(riskCapital ? { riskCapital } : {}),
      ...(fxReference ? { fxReference } : {}),
      ...(nonOptimizable && Object.keys(nonOptimizable).length > 0 ? { nonOptimizable } : {}),
      source: {
        app: 'aurum',
        basis: 'latest_confirmed_closure',
      },
    },
  };
};

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const auth = await requireFirebaseAuth(req, res);
  if (!auth) return;

  const normalized = normalizeSnapshotPayload(req.body?.snapshot, req.body?.activeFxRates);
  if (!normalized.ok) {
    return res.status(400).json({ ok: false, error: normalized.error });
  }

  try {
    const db = getAdminDb();
    let snapshotToWrite = normalized.snapshot;
    const payloadActiveFx = normalizeActiveFxRates(req.body?.activeFxRates);
    snapshotToWrite = withFxReferenceFromActiveRates(snapshotToWrite, payloadActiveFx);

    if (!snapshotToWrite.fxReference || asFiniteOrNull(snapshotToWrite.fxReference.clpUsd) === null) {
      try {
        const wealthSnap = await db.collection(WEALTH_COLLECTION).doc(auth.uid).get();
        const wealthData = wealthSnap.exists ? wealthSnap.data() || {} : {};
        snapshotToWrite = withFxReferenceFromActiveRates(snapshotToWrite, wealthData.fx);
        console.info(`[FX TRACE][Aurum API publish] fx_reference_backfill_attempt ${JSON.stringify({
          uid: auth.uid,
          payloadActiveFxClpUsd: payloadActiveFx?.clpUsd ?? null,
          wealthFxUsdClp: asFiniteOrNull(wealthData?.fx?.usdClp) ?? null,
          resultingFxReferenceClpUsd: snapshotToWrite?.fxReference?.clpUsd ?? null,
        })}`);
      } catch (err) {
        console.info(`[FX TRACE][Aurum API publish] fx_reference_backfill_error ${JSON.stringify({
          error: err?.message || 'No pude leer aurum_wealth para backfill FX.',
          uid: auth.uid,
        })}`);
      }
    }
    snapshotToWrite = mirrorLegacyFxFromFxReference(snapshotToWrite);
    const docPath = `${PUBLISHED_COLLECTION}/${OPTIMIZABLE_DOC_ID}`;
    console.info(`[FX TRACE][Aurum API publish] write_snapshot ${JSON.stringify({
      docPath,
      publishedAt: snapshotToWrite.publishedAt,
      version: snapshotToWrite.version,
      snapshotMonth: snapshotToWrite.snapshotMonth,
      fxReferenceClpUsd: snapshotToWrite.fxReference?.clpUsd ?? null,
      fxReferenceSource: snapshotToWrite.fxReference?.source ?? null,
      legacyFxUsdClp: asFiniteOrNull(snapshotToWrite?.fx?.usdClp) ?? null,
      legacyFxSource: snapshotToWrite?.fx?.source ?? null,
      uid: auth.uid,
    })}`);
    await db.collection(PUBLISHED_COLLECTION).doc(OPTIMIZABLE_DOC_ID).set(
      {
        ...snapshotToWrite,
        publishedByUid: auth.uid,
      },
      { merge: false },
    );
    console.info(`[FX TRACE][Aurum API publish] write_snapshot_ok ${JSON.stringify({
      docPath,
      fxReferenceClpUsd: snapshotToWrite.fxReference?.clpUsd ?? null,
      fxReferenceSource: snapshotToWrite.fxReference?.source ?? null,
      legacyFxUsdClp: asFiniteOrNull(snapshotToWrite?.fx?.usdClp) ?? null,
      legacyFxSource: snapshotToWrite?.fx?.source ?? null,
    })}`);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.info(`[FX TRACE][Aurum API publish] write_snapshot_error ${JSON.stringify({
      error: error?.message || 'No pude escribir el snapshot publicado en Firestore.',
    })}`);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'No pude escribir el snapshot publicado en Firestore.',
    });
  }
}
