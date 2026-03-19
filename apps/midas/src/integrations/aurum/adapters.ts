// integrations/aurum/adapters.ts
// Convierte snapshots de Aurum en parámetros de Midas
// Esta capa evita coupling directo entre dominios

import type { AurumWealthSnapshot } from './types';
import type { ModelParameters, PortfolioWeights } from '../../domain/model/types';
import { DEFAULT_PARAMETERS } from '../../domain/model/defaults';

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
  Object.keys(weights).forEach(k => {
    (weights as Record<string, number>)[k] /= wSum;
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
