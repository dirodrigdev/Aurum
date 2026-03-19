// domain/optimizer/gridSearch.ts
// Optimizador de composición patrimonial por grid search

import type {
  ModelParameters, PortfolioWeights,
  OptimizerConstraints, OptimizerObjective, OptimizerResult
} from '../model/types';
import { runSimulation } from '../simulation/engine';

type GridPoint = {
  weights: PortfolioWeights;
  probRuin: number;
  terminalP50: number;
  terminalP10: number;
};

/**
 * Genera todas las combinaciones de pesos válidas dentro de las restricciones.
 * Usa step fijo y garantiza que sumen 1.0 (± tolerancia).
 */
function generateGrid(c: OptimizerConstraints): PortfolioWeights[] {
  const result: PortfolioWeights[] = [];
  const s = c.step;
  const TOL = s / 10;

  for (let rvg = c.minRvGlobal; rvg <= c.maxRvGlobal + TOL; rvg += s) {
    for (let rfg = c.minRfGlobal; rfg <= c.maxRfGlobal + TOL; rfg += s) {
      for (let rvc = c.minRvChile; rvc <= c.maxRvChile + TOL; rvc += s) {
        const rfc = 1 - rvg - rfg - rvc;
        if (rfc < c.minRfChile - TOL || rfc > c.maxRfChile + TOL) continue;
        const sum = Math.round((rvg + rfg + rvc + rfc) * 1000) / 1000;
        if (Math.abs(sum - 1) > TOL) continue;
        result.push({
          rvGlobal: Math.round(rvg * 100) / 100,
          rfGlobal: Math.round(rfg * 100) / 100,
          rvChile:  Math.round(rvc * 100) / 100,
          rfChile:  Math.round(rfc * 100) / 100,
        });
      }
    }
  }
  return result;
}

/**
 * Scoring function según el objetivo elegido.
 */
function score(point: GridPoint, obj: OptimizerObjective): number {
  switch (obj) {
    case 'minRuin':
      return -point.probRuin;
    case 'maxP50':
      return point.terminalP50;
    case 'balanced':
      // Minimizar ruina y maximizar P50 simultáneamente
      // Normalizar: ruina ~0-15%, P50 ~0-10B CLP
      return -point.probRuin * 5 + point.terminalP50 / 1e9;
  }
}

/**
 * Describe los movimientos vs portafolio actual.
 */
function describeMoves(
  current: PortfolioWeights, optimal: PortfolioWeights
): Array<{ sleeve: string; delta: number; direction: 'up' | 'down' }> {
  const sleeves: Array<[string, keyof PortfolioWeights]> = [
    ['RV Global', 'rvGlobal'], ['RF Global', 'rfGlobal'],
    ['RV Chile', 'rvChile'],   ['RF Chile UF', 'rfChile'],
  ];
  return sleeves
    .map(([label, key]) => ({
      sleeve: label,
      delta: Math.round((optimal[key] - current[key]) * 1000) / 10,
      direction: (optimal[key] >= current[key] ? 'up' : 'down') as 'up' | 'down',
    }))
    .filter(m => Math.abs(m.delta) >= 0.5);
}

/**
 * Corre el optimizador por grid search.
 * nSimPerPoint: número de simulaciones por punto (recomendado: 1000-2000 para velocidad)
 */
export function runOptimizer(
  baseParams: ModelParameters,
  constraints: OptimizerConstraints,
  objective: OptimizerObjective,
  nSimPerPoint = 1500,
  onProgress?: (pct: number) => void,
): OptimizerResult {

  const grid = generateGrid(constraints);
  const results: GridPoint[] = [];

  // Parámetros de simulación reducidos para velocidad
  const simParams: ModelParameters = {
    ...baseParams,
    simulation: {
      ...baseParams.simulation,
      nSim: nSimPerPoint,
      seed: 42,
    },
  };

  for (let i = 0; i < grid.length; i++) {
    const weights = grid[i];
    const testParams = { ...simParams, weights };
    const r = runSimulation(testParams);
    results.push({
      weights,
      probRuin:    r.probRuin,
      terminalP50: r.terminalWealthPercentiles[50] || 0,
      terminalP10: r.terminalWealthPercentiles[10] || 0,
    });
    if (onProgress && i % 10 === 0) {
      onProgress(Math.round((i / grid.length) * 100));
    }
  }

  // Encontrar el óptimo
  const best = results.reduce((a, b) => score(a, objective) > score(b, objective) ? a : b);

  // Correr el punto actual para comparar
  const currentResult = runSimulation({ ...simParams, weights: baseParams.weights });

  return {
    weights:       best.weights,
    probRuin:      best.probRuin,
    terminalP50:   best.terminalP50,
    terminalP10:   best.terminalP10,
    vsCurrentRuin: best.probRuin - currentResult.probRuin,
    vsCurrentP50:  best.terminalP50 - (currentResult.terminalWealthPercentiles[50] || 0),
    moves:         describeMoves(baseParams.weights, best.weights),
  };
}

/**
 * Genera la frontera eficiente: curva P(ruina) vs E[P50].
 * Útil para visualizar el trade-off riesgo/retorno.
 */
export function runFrontier(
  baseParams: ModelParameters,
  constraints: OptimizerConstraints,
  nSimPerPoint = 1000,
): Array<{ probRuin: number; terminalP50: number; weights: PortfolioWeights }> {
  const grid = generateGrid(constraints);
  const simParams = { ...baseParams, simulation: { ...baseParams.simulation, nSim: nSimPerPoint, seed: 42 } };

  return grid.map(weights => {
    const r = runSimulation({ ...simParams, weights });
    return {
      probRuin:    r.probRuin,
      terminalP50: r.terminalWealthPercentiles[50] || 0,
      weights,
    };
  });
}
