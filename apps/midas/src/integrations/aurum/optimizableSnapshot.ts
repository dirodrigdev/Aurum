import { doc, getDoc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { aurumDb, aurumIntegrationConfigured, ensureAurumIntegrationAuth } from './firebase';
import type { AurumOptimizableInvestmentsSnapshot } from './types';

const PUBLISHED_COLLECTION = 'aurum_published';
const OPTIMIZABLE_DOC_ID = 'optimizableInvestments';

const asFiniteOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const logFxTrace = (stage: string, payload: Record<string, unknown>) => {
  if (typeof window === 'undefined') return;
  try {
    console.info(`[FX TRACE][Midas] ${stage}`, payload);
  } catch {
    // ignore
  }
};

export async function loadPublishedOptimizableInvestmentsSnapshot(): Promise<AurumOptimizableInvestmentsSnapshot | null> {
  if (!aurumIntegrationConfigured || !aurumDb) return null;

  await ensureAurumIntegrationAuth();
  const ref = doc(aurumDb, PUBLISHED_COLLECTION, OPTIMIZABLE_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<AurumOptimizableInvestmentsSnapshot> | undefined;
  logFxTrace('snapshot_load_getdoc', {
    docPath: ref.path,
    publishedAt: (data as { publishedAt?: unknown })?.publishedAt ?? null,
    version: (data as { version?: unknown })?.version ?? null,
    rawFxReferenceClpUsd: (data as { fxReference?: { clpUsd?: unknown } })?.fxReference?.clpUsd ?? null,
    rawFxReferenceSource: (data as { fxReference?: { source?: unknown } })?.fxReference?.source ?? null,
  });
  return normalizeSnapshotData(data);
}

export type PublishedSnapshotListener = {
  onValue: (snapshot: AurumOptimizableInvestmentsSnapshot | null) => void;
  onError?: (error: unknown) => void;
};

export function subscribeToPublishedOptimizableInvestmentsSnapshot(listener: PublishedSnapshotListener): () => void {
  if (!aurumIntegrationConfigured || !aurumDb) {
    listener.onValue(null);
    return () => {};
  }

  const ref = doc(aurumDb, PUBLISHED_COLLECTION, OPTIMIZABLE_DOC_ID);
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;

  void ensureAurumIntegrationAuth()
    .then(() => {
      if (cancelled) return;
      unsubscribe = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          if (!snap.exists()) {
            listener.onValue(null);
            return;
          }
          const data = snap.data() as Partial<AurumOptimizableInvestmentsSnapshot>;
          logFxTrace('snapshot_subscribe_onSnapshot', {
            docPath: snap.ref.path,
            fromCache: snap.metadata.fromCache,
            hasPendingWrites: snap.metadata.hasPendingWrites,
            publishedAt: (data as { publishedAt?: unknown })?.publishedAt ?? null,
            version: (data as { version?: unknown })?.version ?? null,
            rawFxReferenceClpUsd: (data as { fxReference?: { clpUsd?: unknown } })?.fxReference?.clpUsd ?? null,
            rawFxReferenceSource: (data as { fxReference?: { source?: unknown } })?.fxReference?.source ?? null,
          });
          const normalized = normalizeSnapshotData(data);
          listener.onValue(normalized);
        },
        (error: FirestoreError) => {
          if (cancelled) return;
          listener.onError?.(error);
        },
      );
    })
    .catch((error) => {
      if (cancelled) return;
      listener.onError?.(error);
    });

  return () => {
    cancelled = true;
    if (unsubscribe) unsubscribe();
  };
}

function normalizeSnapshotData(data: Partial<AurumOptimizableInvestmentsSnapshot> | undefined) {
  if (!data) return null;
  const optimizable = asFiniteOrNull((data as { optimizableInvestmentsCLP?: unknown }).optimizableInvestmentsCLP);
  if (optimizable === null) return null;

  const version = Number((data as { version?: unknown }).version) === 2 ? 2 : 1;
  const totalNetWorthClp = asFiniteOrNull((data as { totalNetWorthCLP?: unknown }).totalNetWorthCLP);
  const totalNetWorthWithRisk = asFiniteOrNull((data as { totalNetWorthWithRiskCLP?: unknown }).totalNetWorthWithRiskCLP);
  const optimizableWithRisk = asFiniteOrNull((data as { optimizableInvestmentsWithRiskCLP?: unknown }).optimizableInvestmentsWithRiskCLP);
  const riskCapitalRaw = (data as { riskCapital?: unknown }).riskCapital;
  const riskCapitalObj =
    riskCapitalRaw && typeof riskCapitalRaw === 'object'
      ? (riskCapitalRaw as Record<string, unknown>)
      : null;
  const riskCapitalTotalCLP = asFiniteOrNull(riskCapitalObj?.totalCLP);
  const riskCapitalCLP = asFiniteOrNull(riskCapitalObj?.clp);
  const riskCapitalUSD = asFiniteOrNull(riskCapitalObj?.usd);
  const riskCapitalUsdSnapshotCLP = asFiniteOrNull(riskCapitalObj?.usdSnapshotCLP);
  const riskCapitalSource = typeof riskCapitalObj?.source === 'string' ? riskCapitalObj.source : undefined;
  const fxReferenceRaw = (data as { fxReference?: unknown }).fxReference;
  const fxReferenceObj =
    fxReferenceRaw && typeof fxReferenceRaw === 'object'
      ? (fxReferenceRaw as Record<string, unknown>)
      : null;
  const legacyFxRaw = (data as { fx?: unknown }).fx;
  const legacyFxObj =
    legacyFxRaw && typeof legacyFxRaw === 'object'
      ? (legacyFxRaw as Record<string, unknown>)
      : null;
  const fxClpUsd = asFiniteOrNull(fxReferenceObj?.clpUsd) ?? asFiniteOrNull(legacyFxObj?.usdClp) ?? asFiniteOrNull(legacyFxObj?.clpUsd);
  const fxClpEur = asFiniteOrNull(fxReferenceObj?.clpEur) ?? asFiniteOrNull(legacyFxObj?.eurClp) ?? asFiniteOrNull(legacyFxObj?.clpEur);
  const fxUsdEur = asFiniteOrNull(fxReferenceObj?.usdEur) ?? asFiniteOrNull(legacyFxObj?.eurUsd);
  const fxUfClp = asFiniteOrNull(fxReferenceObj?.ufClp) ?? asFiniteOrNull(legacyFxObj?.ufClp);
  const fxSource = typeof fxReferenceObj?.source === 'string'
    ? fxReferenceObj.source
    : typeof legacyFxObj?.source === 'string'
      ? legacyFxObj.source
      : undefined;
  logFxTrace('snapshot_hydration_raw', {
    rawFxReferenceClpUsd: fxReferenceObj?.clpUsd ?? null,
    rawFxReferenceSource: fxReferenceObj?.source ?? null,
    rawLegacyFxUsdClp: legacyFxObj?.usdClp ?? null,
    normalizedFxClpUsd: fxClpUsd,
    normalizedFxSource: fxSource ?? null,
  });

  const base = {
    version,
    publishedAt: String((data as { publishedAt?: unknown }).publishedAt || ''),
    snapshotMonth: String((data as { snapshotMonth?: unknown }).snapshotMonth || ''),
    snapshotLabel: String((data as { snapshotLabel?: unknown }).snapshotLabel || ''),
    currency: 'CLP' as const,
    totalNetWorthCLP: totalNetWorthClp ?? 0,
    ...(totalNetWorthWithRisk !== null ? { totalNetWorthWithRiskCLP: totalNetWorthWithRisk } : {}),
    optimizableInvestmentsCLP: optimizable,
    ...(optimizableWithRisk !== null ? { optimizableInvestmentsWithRiskCLP: optimizableWithRisk } : {}),
    ...(riskCapitalTotalCLP !== null
      ? {
          riskCapital: {
            totalCLP: riskCapitalTotalCLP,
            ...(riskCapitalCLP !== null ? { clp: riskCapitalCLP } : {}),
            ...(riskCapitalUSD !== null ? { usd: riskCapitalUSD } : {}),
            ...(riskCapitalUsdSnapshotCLP !== null ? { usdSnapshotCLP: riskCapitalUsdSnapshotCLP } : {}),
            ...(riskCapitalSource ? { source: riskCapitalSource } : {}),
          },
        }
      : {}),
    ...(fxClpUsd !== null && fxClpUsd > 0
      ? {
          fxReference: {
            clpUsd: fxClpUsd,
            ...(fxClpEur !== null && fxClpEur > 0 ? { clpEur: fxClpEur } : {}),
            ...(fxUsdEur !== null && fxUsdEur > 0 ? { usdEur: fxUsdEur } : {}),
            ...(fxUfClp !== null && fxUfClp > 0 ? { ufClp: fxUfClp } : {}),
            ...(fxSource ? { source: fxSource } : {}),
          },
        }
      : {}),
    source: {
      app: 'aurum' as const,
      basis: 'latest_confirmed_closure' as const,
    },
  };

  if (version !== 2) {
    return {
      ...base,
      version: 1 as const,
    };
  }

  const nonOptimizableRaw = (data as { nonOptimizable?: unknown }).nonOptimizable;
  const nonOptimizableObj = (nonOptimizableRaw && typeof nonOptimizableRaw === 'object')
    ? (nonOptimizableRaw as Record<string, unknown>)
    : null;
  const realEstateRaw = (nonOptimizableObj?.realEstate && typeof nonOptimizableObj.realEstate === 'object')
    ? (nonOptimizableObj.realEstate as Record<string, unknown>)
    : null;

  const banksCLP = asFiniteOrNull(nonOptimizableObj?.banksCLP);
  const usdLiquidityCLP = asFiniteOrNull(nonOptimizableObj?.usdLiquidityCLP);
  const nonMortgageDebtCLP = asFiniteOrNull(nonOptimizableObj?.nonMortgageDebtCLP);
  const propertyValueCLP = asFiniteOrNull(realEstateRaw?.propertyValueCLP);
  const realEstateEquityCLP = asFiniteOrNull(realEstateRaw?.realEstateEquityCLP);
  const mortgageDebtOutstandingCLP = asFiniteOrNull(realEstateRaw?.mortgageDebtOutstandingCLP);
  const monthlyMortgagePaymentCLP = asFiniteOrNull(realEstateRaw?.monthlyMortgagePaymentCLP);
  const mortgageRate = asFiniteOrNull(realEstateRaw?.mortgageRate);
  const ufSnapshotCLP = asFiniteOrNull(realEstateRaw?.ufSnapshotCLP);
  const mortgageEndDate = typeof realEstateRaw?.mortgageEndDate === 'string' ? realEstateRaw.mortgageEndDate : undefined;
  const amortizationSystem = typeof realEstateRaw?.amortizationSystem === 'string' ? realEstateRaw.amortizationSystem : undefined;
  const scheduleRaw = Array.isArray(realEstateRaw?.mortgageScheduleCLP) ? realEstateRaw?.mortgageScheduleCLP : null;
  const mortgageScheduleCLP = scheduleRaw
    ? scheduleRaw
      .map((point) => {
        const pointObj = point && typeof point === 'object' ? (point as Record<string, unknown>) : null;
        const month = asFiniteOrNull(pointObj?.month);
        const debtCLP = asFiniteOrNull(pointObj?.debtCLP);
        if (month === null || debtCLP === null) return null;
        return {
          month: Math.max(1, Math.round(month)),
          debtCLP: Math.max(0, debtCLP),
        };
      })
      .filter((point): point is { month: number; debtCLP: number } => point !== null)
    : null;

  return {
    ...base,
    version: 2 as const,
    ...(nonOptimizableObj
      ? {
          nonOptimizable: {
            ...(banksCLP !== null ? { banksCLP } : {}),
            ...(usdLiquidityCLP !== null ? { usdLiquidityCLP } : {}),
            ...(nonMortgageDebtCLP !== null ? { nonMortgageDebtCLP } : {}),
            ...(realEstateRaw
              ? {
                  realEstate: {
                    ...(propertyValueCLP !== null ? { propertyValueCLP } : {}),
                    ...(realEstateEquityCLP !== null ? { realEstateEquityCLP } : {}),
                    ...(ufSnapshotCLP !== null ? { ufSnapshotCLP } : {}),
                    ...(mortgageDebtOutstandingCLP !== null ? { mortgageDebtOutstandingCLP } : {}),
                    ...(monthlyMortgagePaymentCLP !== null ? { monthlyMortgagePaymentCLP } : {}),
                    ...(mortgageRate !== null ? { mortgageRate } : {}),
                    ...(mortgageEndDate ? { mortgageEndDate } : {}),
                    ...(amortizationSystem ? { amortizationSystem } : {}),
                    ...(mortgageScheduleCLP && mortgageScheduleCLP.length > 0 ? { mortgageScheduleCLP } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
