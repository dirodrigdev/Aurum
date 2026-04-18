import { auth } from './firebase';
import type { WealthFxRates, WealthMonthlyClosure } from './wealthStorage';
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
  riskCapital?: {
    totalCLP: number;
    clp?: number;
    usd?: number;
    source?: 'summary_riskCapitalClp' | 'analysis_delta' | 'usd_only';
  };
  fxReference?: {
    clpUsd: number;
    clpEur?: number;
    usdEur?: number;
    ufClp?: number;
    source?: 'closure_fxRates';
  };
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

const roundUsd = (value: number) => Math.round(value * 100) / 100;

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
  const ufSnapshotCLP = asFiniteOrNull(
    (closure.fxRates as { ufClp?: number; uf_clp?: number; ufCLP?: number } | undefined)?.ufClp ??
      (closure.fxRates as { ufClp?: number; uf_clp?: number; ufCLP?: number } | undefined)?.uf_clp ??
      (closure.fxRates as { ufClp?: number; uf_clp?: number; ufCLP?: number } | undefined)?.ufCLP,
  );

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

const extractRiskCapital = (closure: WealthMonthlyClosure) => {
  const summary = closure.summary as WealthMonthlyClosure['summary'] & {
    analysisByCurrency?: {
      clpWithRisk?: number;
      clpWithoutRisk?: number;
      usdWithRisk?: number;
      usdWithoutRisk?: number;
    };
  };
  const riskCapitalFromSummary = asFiniteOrNull(summary?.riskCapitalClp);
  const clpWithRisk = asFiniteOrNull(summary?.analysisByCurrency?.clpWithRisk);
  const clpWithoutRisk = asFiniteOrNull(summary?.analysisByCurrency?.clpWithoutRisk);
  const usdWithRisk = asFiniteOrNull(summary?.analysisByCurrency?.usdWithRisk);
  const usdWithoutRisk = asFiniteOrNull(summary?.analysisByCurrency?.usdWithoutRisk);
  const usdDelta = usdWithRisk !== null && usdWithoutRisk !== null
    ? Math.max(0, usdWithRisk - usdWithoutRisk)
    : null;
  const clpDelta = clpWithRisk !== null && clpWithoutRisk !== null
    ? Math.max(0, clpWithRisk - clpWithoutRisk)
    : null;
  const usdClp = asFiniteOrNull(closure.fxRates?.usdClp);
  const usdComponentClp = usdDelta !== null && usdClp !== null ? usdDelta * usdClp : null;
  const totalCLP = riskCapitalFromSummary ?? clpDelta ?? usdComponentClp;
  if (totalCLP === null || totalCLP <= 0) return undefined;

  // `analysisByCurrency.clpWithRisk - clpWithoutRisk` representa el tramo CLP real.
  // No debe descontar la porción USD convertida.
  let clpComponent: number | null = null;
  if (clpDelta !== null) {
    clpComponent = Math.max(0, clpDelta);
  } else if (usdDelta !== null && usdComponentClp !== null) {
    // Fallback cuando no hay desglose CLP explícito.
    clpComponent = Math.max(0, totalCLP - usdComponentClp);
  }

  return {
    totalCLP: Math.round(totalCLP),
    ...(clpComponent !== null ? { clp: Math.round(clpComponent) } : {}),
    ...(usdDelta !== null ? { usd: roundUsd(usdDelta) } : {}),
    ...(usdClp !== null ? { usdSnapshotCLP: Math.round(usdClp) } : {}),
    ...(riskCapitalFromSummary !== null
      ? { source: 'summary_riskCapitalClp' as const }
      : clpDelta !== null
        ? { source: 'analysis_delta' as const }
        : { source: 'usd_only' as const }),
  };
};

const extractFxReference = (
  closure: WealthMonthlyClosure,
  activeFxRates?: WealthFxRates | null,
) => {
  const usdClp = asFiniteOrNull(activeFxRates?.usdClp) ?? asFiniteOrNull(closure.fxRates?.usdClp);
  if (usdClp === null || usdClp <= 0) return undefined;
  const eurClp = asFiniteOrNull(activeFxRates?.eurClp) ?? asFiniteOrNull(closure.fxRates?.eurClp);
  const ufClp = asFiniteOrNull(activeFxRates?.ufClp) ?? asFiniteOrNull(closure.fxRates?.ufClp);
  const usdEur =
    eurClp !== null && eurClp > 0
      ? usdClp / eurClp
      : null;
  return {
    clpUsd: Math.round(usdClp),
    ...(eurClp !== null && eurClp > 0 ? { clpEur: Math.round(eurClp) } : {}),
    ...(usdEur !== null && Number.isFinite(usdEur) && usdEur > 0 ? { usdEur: Math.round(usdEur * 10_000) / 10_000 } : {}),
    ...(ufClp !== null && ufClp > 0 ? { ufClp: Math.round(ufClp) } : {}),
    source: 'closure_fxRates' as const,
  };
};

export const buildAurumOptimizableInvestmentsSnapshot = (
  closures: WealthMonthlyClosure[],
  options?: { activeFxRates?: WealthFxRates | null },
): AurumOptimizableInvestmentsSnapshot | null => {
  const result = prepareAurumOptimizableInvestmentsSnapshot(closures, options);
  return result.ok ? result.snapshot : null;
};

export const prepareAurumOptimizableInvestmentsSnapshot = (
  closures: WealthMonthlyClosure[],
  options?: { activeFxRates?: WealthFxRates | null },
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
  const riskCapital = extractRiskCapital(latest);
  const fxReference = extractFxReference(latest, options?.activeFxRates);

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
      ...(riskCapital ? { riskCapital } : {}),
      ...(fxReference ? { fxReference } : {}),
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
  options?: { activeFxRates?: WealthFxRates | null },
): Promise<AurumOptimizableSnapshotPublishResult> => {
  const prepared = prepareAurumOptimizableInvestmentsSnapshot(closures, options);
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
