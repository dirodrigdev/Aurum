import { doc, getDoc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { aurumDb, aurumIntegrationConfigured, ensureAurumIntegrationAuth } from './firebase';
import type { AurumOptimizableInvestmentsSnapshot } from './types';

const PUBLISHED_COLLECTION = 'aurum_published';
const OPTIMIZABLE_DOC_ID = 'optimizableInvestments';

const asFiniteOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function loadPublishedOptimizableInvestmentsSnapshot(): Promise<AurumOptimizableInvestmentsSnapshot | null> {
  if (!aurumIntegrationConfigured || !aurumDb) return null;

  await ensureAurumIntegrationAuth();
  const snap = await getDoc(doc(aurumDb, PUBLISHED_COLLECTION, OPTIMIZABLE_DOC_ID));
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<AurumOptimizableInvestmentsSnapshot> | undefined;
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
  const nonMortgageDebtCLP = asFiniteOrNull(nonOptimizableObj?.nonMortgageDebtCLP);
  const propertyValueCLP = asFiniteOrNull(realEstateRaw?.propertyValueCLP);
  const realEstateEquityCLP = asFiniteOrNull(realEstateRaw?.realEstateEquityCLP);
  const mortgageDebtOutstandingCLP = asFiniteOrNull(realEstateRaw?.mortgageDebtOutstandingCLP);
  const monthlyMortgagePaymentCLP = asFiniteOrNull(realEstateRaw?.monthlyMortgagePaymentCLP);
  const mortgageRate = asFiniteOrNull(realEstateRaw?.mortgageRate);
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
            ...(nonMortgageDebtCLP !== null ? { nonMortgageDebtCLP } : {}),
            ...(realEstateRaw
              ? {
                  realEstate: {
                    ...(propertyValueCLP !== null ? { propertyValueCLP } : {}),
                    ...(realEstateEquityCLP !== null ? { realEstateEquityCLP } : {}),
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
