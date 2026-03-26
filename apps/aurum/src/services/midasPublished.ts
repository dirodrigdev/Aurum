import { auth } from './firebase';
import type { WealthMonthlyClosure } from './wealthStorage';
import { formatMonthLabel } from '../utils/wealthFormat';

export type AurumOptimizableInvestmentsSnapshot = {
  version: 1 | 2;
  publishedAt: string;
  snapshotMonth: string;
  snapshotLabel: string;
  currency: 'CLP';
  totalNetWorthCLP: number;
  totalNetWorthWithRiskCLP?: number;
  optimizableInvestmentsCLP: number;
  optimizableInvestmentsWithRiskCLP?: number;
  nonOptimizable?: {
    banksCLP?: number;
    nonMortgageDebtCLP?: number;
    realEstate?: {
      propertyValueCLP?: number;
      realEstateEquityCLP?: number;
      mortgageDebtOutstandingCLP?: number;
      monthlyMortgagePaymentCLP?: number;
      mortgageEndDate?: string;
      mortgageRate?: number;
      amortizationSystem?: 'french' | 'constant' | string;
      mortgageScheduleCLP?: Array<{ month: number; debtCLP: number }>;
      ufSnapshotCLP?: number;
    };
  };
  source: {
    app: 'aurum';
    basis: 'latest_confirmed_closure';
  };
};

const PUBLISHED_COLLECTION = 'aurum_published';
const OPTIMIZABLE_DOC_ID = 'optimizableInvestments';

export type AurumOptimizableSnapshotBuildResult =
  | {
      ok: true;
      snapshot: AurumOptimizableInvestmentsSnapshot;
    }
  | {
      ok: false;
      reason: string;
    };

export type AurumOptimizableSnapshotPublishResult =
  | {
      ok: true;
      snapshot: AurumOptimizableInvestmentsSnapshot;
    }
  | {
      ok: false;
      reason: string;
      snapshot: AurumOptimizableInvestmentsSnapshot | null;
    };

const compareClosuresByMonthDesc = (a: WealthMonthlyClosure, b: WealthMonthlyClosure) =>
  b.monthKey.localeCompare(a.monthKey);

const asFiniteOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const toClp = (amount: number, currency: string, fxRates?: WealthMonthlyClosure['fxRates']) => {
  if (!Number.isFinite(amount)) return null;
  const rounded = Number(amount);
  if (currency === 'CLP') return rounded;
  if (currency === 'USD') {
    const usdClp = asFiniteOrNull(fxRates?.usdClp);
    return usdClp === null ? null : rounded * usdClp;
  }
  if (currency === 'EUR') {
    const eurClp = asFiniteOrNull(fxRates?.eurClp);
    return eurClp === null ? null : rounded * eurClp;
  }
  if (currency === 'UF') {
    const ufClp = asFiniteOrNull(fxRates?.ufClp);
    return ufClp === null ? null : rounded * ufClp;
  }
  return null;
};

const extractNonOptimizable = (closure: WealthMonthlyClosure) => {
  const summary = closure.summary as WealthMonthlyClosure['summary'] & {
    bankClp?: number;
    nonMortgageDebtClp?: number;
  };
  const records = Array.isArray(closure.records) ? closure.records : [];

  const summaryBankClp =
    asFiniteOrNull(summary.bankClp) ??
    asFiniteOrNull(summary.byBlock?.bank?.CLP) ??
    0;

  const summaryNonMortgageDebtClp = asFiniteOrNull(summary.nonMortgageDebtClp);

  let propertyValueCLP = 0;
  let mortgageDebtOutstandingCLP = 0;
  let monthlyMortgagePaymentCLP = 0;
  let nonMortgageDebtFromRecords = 0;
  const ufSnapshotCLP = asFiniteOrNull(closure.fxRates?.ufClp);

  for (const record of records) {
    const label = normalizeText(record.label || '');
    const clp = toClp(Math.abs(Number(record.amount || 0)), record.currency, closure.fxRates);
    if (clp === null) continue;

    if (record.block === 'real_estate' && label.includes('valor propiedad')) {
      propertyValueCLP += clp;
      continue;
    }
    if (record.block !== 'debt') continue;

    if (label.includes('saldo deuda hipotecaria')) {
      mortgageDebtOutstandingCLP += clp;
      continue;
    }
    if (label.includes('dividendo hipotecario')) {
      monthlyMortgagePaymentCLP += clp;
      continue;
    }
    if (label.includes('tarjeta')) {
      nonMortgageDebtFromRecords += clp;
    }
  }

  const nonMortgageDebtCLP = summaryNonMortgageDebtClp ?? nonMortgageDebtFromRecords;
  const realEstateEquityCLP = Math.max(0, propertyValueCLP - mortgageDebtOutstandingCLP);

  return {
    banksCLP: Math.round(Math.max(0, summaryBankClp)),
    nonMortgageDebtCLP: Math.round(Math.abs(nonMortgageDebtCLP)),
    realEstate:
      propertyValueCLP > 0 || mortgageDebtOutstandingCLP > 0 || monthlyMortgagePaymentCLP > 0
        ? {
            propertyValueCLP: Math.round(Math.max(0, propertyValueCLP)),
            realEstateEquityCLP: Math.round(Math.max(0, realEstateEquityCLP)),
            mortgageDebtOutstandingCLP: Math.round(Math.max(0, mortgageDebtOutstandingCLP)),
            monthlyMortgagePaymentCLP: Math.round(Math.max(0, monthlyMortgagePaymentCLP)),
            ...(ufSnapshotCLP !== null ? { ufSnapshotCLP: Math.round(ufSnapshotCLP) } : {}),
          }
        : undefined,
  };
};

export const buildAurumOptimizableInvestmentsSnapshot = (
  closures: WealthMonthlyClosure[],
): AurumOptimizableInvestmentsSnapshot | null => {
  const result = prepareAurumOptimizableInvestmentsSnapshot(closures);
  return result.ok ? result.snapshot : null;
};

export const prepareAurumOptimizableInvestmentsSnapshot = (
  closures: WealthMonthlyClosure[],
): AurumOptimizableSnapshotBuildResult => {
  const latest = [...closures]
    .sort(compareClosuresByMonthDesc)
    .find((closure) => asFiniteOrNull(closure.summary?.investmentClp) !== null);

  if (!latest) {
    return {
      ok: false,
      reason: 'No encontré un cierre confirmado con summary.investmentClp válido.',
    };
  }

  const withoutRisk = asFiniteOrNull(latest.summary?.investmentClp);
  if (withoutRisk === null) {
    return {
      ok: false,
      reason: `El cierre ${latest.monthKey} no tiene summary.investmentClp válido.`,
    };
  }
  const withRisk = asFiniteOrNull(latest.summary?.investmentClpWithRisk);
  const totalNetWorth = asFiniteOrNull(latest.summary?.netClp) ?? asFiniteOrNull(latest.summary?.netConsolidatedClp);
  if (totalNetWorth === null) {
    return {
      ok: false,
      reason: `El cierre ${latest.monthKey} no tiene summary.netClp ni summary.netConsolidatedClp válidos.`,
    };
  }
  const totalNetWorthWithRisk =
    asFiniteOrNull(latest.summary?.netClpWithRisk) ?? asFiniteOrNull(latest.summary?.netConsolidatedClp);

  return {
    ok: true,
    snapshot: {
      version: 2,
      publishedAt: new Date().toISOString(),
      snapshotMonth: latest.monthKey,
      snapshotLabel: `Cierre ${formatMonthLabel(latest.monthKey)}`,
      currency: 'CLP',
      totalNetWorthCLP: Math.round(totalNetWorth),
      ...(totalNetWorthWithRisk !== null ? { totalNetWorthWithRiskCLP: Math.round(totalNetWorthWithRisk) } : {}),
      optimizableInvestmentsCLP: Math.round(withoutRisk),
      ...(withRisk !== null ? { optimizableInvestmentsWithRiskCLP: Math.round(withRisk) } : {}),
      nonOptimizable: extractNonOptimizable(latest),
      source: {
        app: 'aurum',
        basis: 'latest_confirmed_closure',
      },
    },
  };
};

export const publishAurumOptimizableInvestmentsSnapshot = async (
  closures: WealthMonthlyClosure[],
): Promise<AurumOptimizableSnapshotPublishResult> => {
  const prepared = prepareAurumOptimizableInvestmentsSnapshot(closures);
  if (prepared.ok === false) {
    return {
      ok: false,
      reason: prepared.reason,
      snapshot: null,
    };
  }

  const snapshot = prepared.snapshot;
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return {
      ok: false,
      reason: 'No hay sesión Firebase activa para publicar el snapshot de integración.',
      snapshot,
    };
  }

  const idToken = await currentUser.getIdToken();
  if (!idToken) {
    return {
      ok: false,
      reason: 'No pude obtener el token Firebase del usuario actual para publicar el snapshot.',
      snapshot,
    };
  }

  const response = await fetch('/api/midas/publish-snapshot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ snapshot }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    return {
      ok: false,
      reason: String(payload?.error || 'No pude publicar el snapshot de integración en Firestore.'),
      snapshot,
    };
  }

  return {
    ok: true,
    snapshot,
  };
};
