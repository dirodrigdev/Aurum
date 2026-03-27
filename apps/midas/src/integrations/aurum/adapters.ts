// integrations/aurum/adapters.ts
// Convierte snapshots de Aurum en parámetros de Midas
// Esta capa evita coupling directo entre dominios

import type { AurumOptimizableInvestmentsSnapshot, AurumWealthSnapshot } from './types';
import type {
  CompositionMode,
  ModelParameters,
  PortfolioWeights,
  SimulationCompositionInput,
  SimulationCompositionDiagnostics,
} from '../../domain/model/types';
import { DEFAULT_PARAMETERS } from '../../domain/model/defaults';
import type { OptimizableBaseReference } from '../../domain/instrumentBase';

/**
 * Convierte un snapshot de Aurum en parámetros de Midas.
 * Solo sobreescribe capital y pesos — el resto de los supuestos
 * del modelo (retornos, inflación, FX) los maneja Midas internamente.
 */
export function snapshotToParams(
  snapshot: AurumWealthSnapshot,
  baseParams: ModelParameters = DEFAULT_PARAMETERS,
): ModelParameters {
  const { allocation, totalCapitalCLP, fxReference } = snapshot;

  // Redistribuir "other" y "cash" proporcionalmente entre los sleeves
  const knownSum = allocation.rvGlobal + allocation.rfGlobal +
                   allocation.rvChile  + allocation.rfChile;
  const remainder = 1 - knownSum;
  const scale = knownSum > 0 ? 1 / knownSum : 1;

  const weights: PortfolioWeights = {
    rvGlobal: (allocation.rvGlobal + remainder * 0.3) * scale,
    rfGlobal: (allocation.rfGlobal + remainder * 0.2) * scale,
    rvChile:  (allocation.rvChile  + remainder * 0.3) * scale,
    rfChile:  (allocation.rfChile  + remainder * 0.2) * scale,
  };

  // Normalizar a 1.0
  const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
  (['rvGlobal', 'rfGlobal', 'rvChile', 'rfChile'] as const).forEach(k => {
    weights[k] /= wSum;
  });

  return {
    ...baseParams,
    capitalInitial: totalCapitalCLP,
    weights,
    fx: {
      ...baseParams.fx,
      clpUsdInitial: fxReference.clpUsd,
      usdEurFixed:   fxReference.usdEur,
    },
    label: `Desde Aurum — ${snapshot.snapshotDate}`,
  };
}

/**
 * Valida que un snapshot de Aurum es usable por Midas.
 */
export function validateSnapshot(snapshot: AurumWealthSnapshot): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!snapshot.totalCapitalCLP || snapshot.totalCapitalCLP <= 0)
    warnings.push('Capital total inválido');

  const alloc = snapshot.allocation;
  const sum = alloc.rvGlobal + alloc.rfGlobal + alloc.rvChile + alloc.rfChile +
              alloc.cash + alloc.other;
  if (Math.abs(sum - 1) > 0.05)
    warnings.push(`Asignación no suma 100% (${(sum * 100).toFixed(1)}%)`);

  const snapshotAge = Date.now() - new Date(snapshot.snapshotDate).getTime();
  const daysOld = snapshotAge / (1000 * 60 * 60 * 24);
  if (daysOld > 90)
    warnings.push(`Snapshot tiene ${Math.round(daysOld)} días — considerar actualizar`);

  return { valid: warnings.length === 0, warnings };
}

export function optimizableSnapshotToReference(
  snapshot: AurumOptimizableInvestmentsSnapshot | null,
): OptimizableBaseReference {
  if (!snapshot || !Number.isFinite(snapshot.optimizableInvestmentsCLP)) {
    return {
      amountClp: null,
      asOf: null,
      sourceLabel: 'Aurum · último cierre confirmado',
      status: 'pending',
    };
  }

  return {
    amountClp: snapshot.optimizableInvestmentsCLP,
    asOf: snapshot.publishedAt,
    sourceLabel: `Aurum · ${snapshot.snapshotLabel}`,
    status: 'available',
  };
}

const asFiniteOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function computeCompositionDiagnostics(
  sourceVersion: 1 | 2,
  mode: CompositionMode,
  totalNetWorthCLP: number,
  optimizableInvestmentsCLP: number,
  banksCLP: number,
  realEstateEquityCLP: number,
  nonMortgageDebtCLP: number,
): SimulationCompositionDiagnostics {
  const debtAbs = Math.abs(nonMortgageDebtCLP);
  const modeledNet = optimizableInvestmentsCLP + banksCLP + realEstateEquityCLP - debtAbs;
  const compositionGapCLP = Math.round(totalNetWorthCLP - modeledNet);
  const denom = Math.max(1, Math.abs(totalNetWorthCLP));
  const compositionGapPct = compositionGapCLP / denom;
  const notes: string[] = [];
  if (mode === 'legacy') notes.push('legacy-v1');
  if (mode === 'partial') notes.push('partial-v2');
  if (Math.abs(compositionGapCLP) > 1_000) notes.push('warn-and-run:composition-gap');
  return {
    sourceVersion,
    mode,
    compositionGapCLP,
    compositionGapPct,
    notes,
  };
}

export function snapshotToSimulationComposition(
  snapshot: AurumOptimizableInvestmentsSnapshot | null,
): SimulationCompositionInput | null {
  if (!snapshot) return null;
  const totalNetWorthCLP = asFiniteOrZero(snapshot.totalNetWorthCLP);
  const optimizableInvestmentsCLP = asFiniteOrZero(snapshot.optimizableInvestmentsCLP);
  if (optimizableInvestmentsCLP <= 0) return null;

  const isV2 = snapshot.version === 2;
  const snapshotV2 = isV2 ? snapshot : null;
  const banksCLP = isV2 ? asFiniteOrZero(snapshotV2?.nonOptimizable?.banksCLP) : 0;
  const nonMortgageDebtCLP = isV2 ? asFiniteOrZero(snapshotV2?.nonOptimizable?.nonMortgageDebtCLP) : 0;
  const propertyValueCLP = isV2 ? asFiniteOrZero(snapshotV2?.nonOptimizable?.realEstate?.propertyValueCLP) : 0;
  const mortgageDebtOutstandingCLP = isV2 ? asFiniteOrZero(snapshotV2?.nonOptimizable?.realEstate?.mortgageDebtOutstandingCLP) : 0;
  const ufSnapshotCLP = isV2 ? asFiniteOrZero(snapshotV2?.nonOptimizable?.realEstate?.ufSnapshotCLP) : 0;
  const riskCapitalTotalCLP = isV2 ? asFiniteOrZero(snapshotV2?.riskCapital?.totalCLP) : 0;
  const riskCapitalCLP = isV2 ? asFiniteOrZero(snapshotV2?.riskCapital?.clp) : 0;
  const riskCapitalUSD = isV2 ? asFiniteOrZero(snapshotV2?.riskCapital?.usd) : 0;
  const riskCapitalUsdSnapshotCLP = isV2 ? asFiniteOrZero(snapshotV2?.riskCapital?.usdSnapshotCLP) : 0;
  const realEstateEquityDerived = Math.max(0, propertyValueCLP - mortgageDebtOutstandingCLP);
  const realEstateEquityFromSnapshot = isV2 ? asFiniteOrZero(snapshotV2?.nonOptimizable?.realEstate?.realEstateEquityCLP) : 0;
  const realEstateEquityCLP = realEstateEquityFromSnapshot > 0 ? realEstateEquityFromSnapshot : realEstateEquityDerived;

  const hasMortgageCore =
    isV2 &&
    realEstateEquityCLP > 0 &&
    ufSnapshotCLP > 0 &&
    Boolean(snapshotV2?.snapshotMonth);
  const hasAnyV2Block =
    isV2 &&
    (banksCLP > 0 ||
      nonMortgageDebtCLP !== 0 ||
      propertyValueCLP > 0 ||
      mortgageDebtOutstandingCLP > 0 ||
      realEstateEquityCLP > 0);

  const mode: CompositionMode = !isV2 ? 'legacy' : hasMortgageCore ? 'full' : hasAnyV2Block ? 'partial' : 'legacy';
  const sourceVersion: 1 | 2 = isV2 ? 2 : 1;
  const diagnostics = computeCompositionDiagnostics(
    sourceVersion,
    mode,
    totalNetWorthCLP,
    optimizableInvestmentsCLP,
    banksCLP,
    realEstateEquityCLP,
    nonMortgageDebtCLP,
  );

  const hasUfSnapshot = ufSnapshotCLP > 0 && Boolean(snapshotV2?.snapshotMonth);
  const mortgageProjectionStatus = !isV2
    ? undefined
    : hasUfSnapshot
      ? 'uf_schedule'
      : hasAnyV2Block
        ? 'fallback_incomplete'
        : undefined;

  return {
    mode,
    totalNetWorthCLP,
    optimizableInvestmentsCLP,
    ...(mortgageProjectionStatus ? { mortgageProjectionStatus } : {}),
    nonOptimizable: {
      banksCLP,
      nonMortgageDebtCLP,
      ...(hasAnyV2Block
        ? {
            realEstate: {
              propertyValueCLP,
              realEstateEquityCLP,
              ...(ufSnapshotCLP > 0 ? { ufSnapshotCLP } : {}),
              ...(snapshotV2?.snapshotMonth ? { snapshotMonth: snapshotV2.snapshotMonth } : {}),
              ...(Number.isFinite(snapshotV2?.nonOptimizable?.realEstate?.mortgageDebtOutstandingCLP)
                ? { mortgageDebtOutstandingCLP }
                : {}),
              ...(Number.isFinite(snapshotV2?.nonOptimizable?.realEstate?.monthlyMortgagePaymentCLP)
                ? { monthlyMortgagePaymentCLP: asFiniteOrZero(snapshotV2?.nonOptimizable?.realEstate?.monthlyMortgagePaymentCLP) }
                : {}),
              ...(Number.isFinite(snapshotV2?.nonOptimizable?.realEstate?.mortgageRate)
                ? { mortgageRate: asFiniteOrZero(snapshotV2?.nonOptimizable?.realEstate?.mortgageRate) }
                : {}),
              ...(snapshotV2?.nonOptimizable?.realEstate?.mortgageEndDate
                ? { mortgageEndDate: snapshotV2.nonOptimizable.realEstate.mortgageEndDate }
                : {}),
              ...(snapshotV2?.nonOptimizable?.realEstate?.amortizationSystem
                ? { amortizationSystem: snapshotV2.nonOptimizable.realEstate.amortizationSystem }
                : {}),
            },
          }
        : {}),
      ...(riskCapitalTotalCLP > 0 || riskCapitalCLP > 0 || riskCapitalUSD > 0
        ? {
            riskCapital: {
              ...(riskCapitalTotalCLP > 0 ? { totalCLP: riskCapitalTotalCLP } : {}),
              ...(riskCapitalCLP > 0 ? { clp: riskCapitalCLP } : {}),
              ...(riskCapitalUSD > 0 ? { usd: riskCapitalUSD } : {}),
              ...(riskCapitalUsdSnapshotCLP > 0 ? { usdSnapshotCLP: riskCapitalUsdSnapshotCLP } : {}),
              ...(snapshotV2?.riskCapital?.source ? { source: snapshotV2.riskCapital.source } : {}),
            },
          }
        : {}),
    },
    diagnostics,
  };
}
