import { doc, getDoc } from 'firebase/firestore';
import { aurumDb, aurumIntegrationConfigured, ensureAurumIntegrationAuth } from './firebase';
import type { AurumOptimizableInvestmentsSnapshot } from './types';

const PUBLISHED_COLLECTION = 'aurum_published';
const OPTIMIZABLE_DOC_ID = 'optimizableInvestments';

export async function loadPublishedOptimizableInvestmentsSnapshot(): Promise<AurumOptimizableInvestmentsSnapshot | null> {
  if (!aurumIntegrationConfigured || !aurumDb) return null;

  await ensureAurumIntegrationAuth();
  const snap = await getDoc(doc(aurumDb, PUBLISHED_COLLECTION, OPTIMIZABLE_DOC_ID));
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<AurumOptimizableInvestmentsSnapshot> | undefined;
  if (!data || !Number.isFinite(Number(data.optimizableInvestmentsCLP))) return null;
  const totalNetWorthClp =
    Number.isFinite(Number(data.totalNetWorthCLP)) ? Number(data.totalNetWorthCLP) : null;

  return {
    version: 1,
    publishedAt: String(data.publishedAt || ''),
    snapshotMonth: String(data.snapshotMonth || ''),
    snapshotLabel: String(data.snapshotLabel || ''),
    currency: 'CLP',
    totalNetWorthCLP: totalNetWorthClp ?? 0,
    ...(Number.isFinite(Number(data.totalNetWorthWithRiskCLP))
      ? { totalNetWorthWithRiskCLP: Number(data.totalNetWorthWithRiskCLP) }
      : {}),
    optimizableInvestmentsCLP: Number(data.optimizableInvestmentsCLP),
    ...(Number.isFinite(Number(data.optimizableInvestmentsWithRiskCLP))
      ? { optimizableInvestmentsWithRiskCLP: Number(data.optimizableInvestmentsWithRiskCLP) }
      : {}),
    source: {
      app: 'aurum',
      basis: 'latest_confirmed_closure',
    },
  };
}
