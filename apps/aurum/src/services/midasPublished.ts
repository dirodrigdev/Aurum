import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { WealthMonthlyClosure } from './wealthStorage';
import { formatMonthLabel } from '../utils/wealthFormat';

export type AurumOptimizableInvestmentsSnapshot = {
  version: 1;
  publishedAt: string;
  snapshotMonth: string;
  snapshotLabel: string;
  currency: 'CLP';
  totalNetWorthCLP: number;
  totalNetWorthWithRiskCLP?: number;
  optimizableInvestmentsCLP: number;
  optimizableInvestmentsWithRiskCLP?: number;
  source: {
    app: 'aurum';
    basis: 'latest_confirmed_closure';
  };
};

const PUBLISHED_COLLECTION = 'aurum_published';
const OPTIMIZABLE_DOC_ID = 'optimizableInvestments';

const compareClosuresByMonthDesc = (a: WealthMonthlyClosure, b: WealthMonthlyClosure) =>
  b.monthKey.localeCompare(a.monthKey);

const asFiniteOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildAurumOptimizableInvestmentsSnapshot = (
  closures: WealthMonthlyClosure[],
): AurumOptimizableInvestmentsSnapshot | null => {
  const latest = [...closures]
    .sort(compareClosuresByMonthDesc)
    .find((closure) => asFiniteOrNull(closure.summary?.investmentClp) !== null);

  if (!latest) return null;

  const withoutRisk = asFiniteOrNull(latest.summary?.investmentClp);
  if (withoutRisk === null) return null;
  const withRisk = asFiniteOrNull(latest.summary?.investmentClpWithRisk);
  const totalNetWorth = asFiniteOrNull(latest.summary?.netClp) ?? asFiniteOrNull(latest.summary?.netConsolidatedClp);
  if (totalNetWorth === null) return null;
  const totalNetWorthWithRisk =
    asFiniteOrNull(latest.summary?.netClpWithRisk) ?? asFiniteOrNull(latest.summary?.netConsolidatedClp);

  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    snapshotMonth: latest.monthKey,
    snapshotLabel: `Cierre ${formatMonthLabel(latest.monthKey)}`,
    currency: 'CLP',
    totalNetWorthCLP: Math.round(totalNetWorth),
    ...(totalNetWorthWithRisk !== null ? { totalNetWorthWithRiskCLP: Math.round(totalNetWorthWithRisk) } : {}),
    optimizableInvestmentsCLP: Math.round(withoutRisk),
    ...(withRisk !== null ? { optimizableInvestmentsWithRiskCLP: Math.round(withRisk) } : {}),
    source: {
      app: 'aurum',
      basis: 'latest_confirmed_closure',
    },
  };
};

export const publishAurumOptimizableInvestmentsSnapshot = async (
  closures: WealthMonthlyClosure[],
): Promise<boolean> => {
  const snapshot = buildAurumOptimizableInvestmentsSnapshot(closures);
  if (!snapshot) return false;
  await setDoc(doc(db, PUBLISHED_COLLECTION, OPTIMIZABLE_DOC_ID), snapshot, { merge: true });
  return true;
};
