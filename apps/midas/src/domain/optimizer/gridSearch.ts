// domain/optimizer/gridSearch.ts
// Optimizador de composición patrimonial por grid search

import type {
  ModelParameters, PortfolioWeights,
  OptimizerConstraints, OptimizerObjective, OptimizerResult
} from '../model/types';
import { runSimulationCentral } from '../simulation/engineCentral';

type GridPoint = {
  weights: PortfolioWeights;
  probRuin: number;
  terminalP50: number;
  terminalP10: number;
};

type OptimizerProgress = {
  pct: number;
  evaluated: number;
  total: number;
};

type AsyncOptimizerOptions = {
  onProgress?: (progress: OptimizerProgress) => void;
  shouldYield?: () => Promise<void>;
  yieldEvery?: number;
  signal?: { cancelled: boolean };
};

type SimulationPoint = {
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
      delta: (optimal[key] - current[key]) * 100,
      direction: (optimal[key] >= current[key] ? 'up' : 'down') as 'up' | 'down',
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function buildOptimizerParams(
  baseParams: ModelParameters,
  weights: PortfolioWeights,
  nSimPerPoint: number,
): ModelParameters {
  return {
    ...baseParams,
    weights,
    simulation: {
      ...baseParams.simulation,
      nSim: nSimPerPoint,
      seed: 42,
    },
  };
}

export function evaluateOptimizerPoint(
  baseParams: ModelParameters,
  weights: PortfolioWeights,
  nSimPerPoint: number,
): SimulationPoint {
  const result = runSimulationCentral(buildOptimizerParams(baseParams, weights, nSimPerPoint));
  return {
    probRuin: result.probRuin,
    terminalP50: result.terminalWealthPercentiles[50] || 0,
    terminalP10: result.terminalWealthPercentiles[10] || 0,
  };
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
  const progressEvery = Math.max(1, Math.floor(grid.length / 20));

  for (let i = 0; i < grid.length; i++) {
    const weights = grid[i];
    const r = evaluateOptimizerPoint(baseParams, weights, nSimPerPoint);
    results.push({
      weights,
      probRuin:    r.probRuin,
      terminalP50: r.terminalP50,
      terminalP10: r.terminalP10,
    });
    if (onProgress && (((i + 1) % progressEvery === 0) || i === grid.length - 1)) {
      onProgress(Math.round(((i + 1) / grid.length) * 100));
    }
  }

  // Encontrar el óptimo
  const best = results.reduce((a, b) => score(a, objective) > score(b, objective) ? a : b);

  const displaySimCount = baseParams.simulation.nSim;
  const bestResult = evaluateOptimizerPoint(baseParams, best.weights, displaySimCount);
  const currentResult = evaluateOptimizerPoint(baseParams, baseParams.weights, displaySimCount);

  return {
    weights:       best.weights,
    probRuin:      bestResult.probRuin,
    terminalP50:   bestResult.terminalP50,
    terminalP10:   bestResult.terminalP10,
    vsCurrentRuin: currentResult.probRuin - bestResult.probRuin,
    vsCurrentP50:  bestResult.terminalP50 - currentResult.terminalP50,
    moves:         describeMoves(baseParams.weights, best.weights),
  };
}

export async function runOptimizerAsync(
  baseParams: ModelParameters,
  constraints: OptimizerConstraints,
  objective: OptimizerObjective,
  nSimPerPoint = 1500,
  options: AsyncOptimizerOptions = {},
): Promise<OptimizerResult> {
  const grid = generateGrid(constraints);
  const results: GridPoint[] = [];
  const total = grid.length;
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1);

  const reportProgress = (evaluated: number) => {
    if (!options.onProgress || total <= 0) return;
    options.onProgress({
      pct: Math.round((evaluated / total) * 100),
      evaluated,
      total,
    });
  };

  if (total === 0) {
    const currentResult = evaluateOptimizerPoint(baseParams, baseParams.weights, baseParams.simulation.nSim);
    return {
      weights: baseParams.weights,
      probRuin: currentResult.probRuin,
      terminalP50: currentResult.terminalP50,
      terminalP10: currentResult.terminalP10,
      vsCurrentRuin: 0,
      vsCurrentP50: 0,
      moves: [],
    };
  }

  for (let i = 0; i < total; i++) {
    if (options.signal?.cancelled) {
      throw new Error('optimizer_cancelled');
    }
    const weights = grid[i];
    const r = evaluateOptimizerPoint(baseParams, weights, nSimPerPoint);
    results.push({
      weights,
      probRuin: r.probRuin,
      terminalP50: r.terminalP50,
      terminalP10: r.terminalP10,
    });
    reportProgress(i + 1);
    if (options.shouldYield && ((i + 1) % yieldEvery === 0)) {
      await options.shouldYield();
    }
  }

  const best = results.reduce((a, b) => (score(a, objective) > score(b, objective) ? a : b));
  const displaySimCount = baseParams.simulation.nSim;
  const bestResult = evaluateOptimizerPoint(baseParams, best.weights, displaySimCount);
  const currentResult = evaluateOptimizerPoint(baseParams, baseParams.weights, displaySimCount);

  return {
    weights: best.weights,
    probRuin: bestResult.probRuin,
    terminalP50: bestResult.terminalP50,
    terminalP10: bestResult.terminalP10,
    vsCurrentRuin: currentResult.probRuin - bestResult.probRuin,
    vsCurrentP50: bestResult.terminalP50 - currentResult.terminalP50,
    moves: describeMoves(baseParams.weights, best.weights),
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

  return grid.map(weights => {
    const r = evaluateOptimizerPoint(baseParams, weights, nSimPerPoint);
    return {
      probRuin:    r.probRuin,
      terminalP50: r.terminalP50,
      weights,
    };
  });
}
