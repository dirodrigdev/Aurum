import type { ModelParameters, PortfolioWeights } from '../model/types';
import { resolveCapital } from '../simulation/capitalResolver';
import { toM8Input } from '../simulation/m8Adapter';

export type OptimizationDiagnosticRow = {
  id: string;
  rvPct: number;
  rfPct: number;
  weights: PortfolioWeights;
  qasrStrict: number | null;
  csr85_4: number | null;
  classicSuccessRate: number | null;
  monthsInSevereCutMean: number | null;
  maxConsecutiveSevereCutMonthsP75: number | null;
  terminalWealthP25: number | null;
  terminalWealthP50: number | null;
  houseSaleRate: number | null;
};

export type EffectiveRvRfAssumptions = {
  units: 'real_annual';
  simulatedAt: 'monthly';
  outputBasis: 'real_clp_model';
  activeScenario: string;
  rvGlobalReturn: number;
  rvChileReturn: number;
  rfGlobalReturn: number;
  rfChileReturn: number;
  rvGlobalVol: number;
  rvChileVol: number;
  rfGlobalVol: number;
  rfChileVol: number;
  correlationMatrix4x4: number[][];
};

export type CandidateMixDiagnostics = {
  id: string;
  rvPct: number;
  rfPct: number;
  expectedRvReturn: number | null;
  expectedRfReturn: number | null;
  rvRfSpread: number | null;
  expectedPortfolioReturn: number | null;
  expectedPortfolioVol: number | null;
};

export type OptimizationFrontierDiagnostics = {
  assumptions: EffectiveRvRfAssumptions;
  winningMixReason: string;
  benchmarkRows: OptimizationDiagnosticRow[];
  candidateDiagnostics: CandidateMixDiagnostics[];
};

const BENCHMARK_RV_LEVELS = [0, 25, 50, 75, 80, 100];
const TECHNICAL_TIE = 0.005;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function clone4x4(matrix: number[][]): number[][] {
  return matrix.slice(0, 4).map((row) => row.slice(0, 4));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function quadraticForm(weights: number[], covariance: number[][]): number {
  const intermediate = covariance.map((row) => dot(row, weights));
  return dot(weights, intermediate);
}

export function buildEffectiveRvRfAssumptions(params: ModelParameters): EffectiveRvRfAssumptions {
  const input = toM8Input(params, resolveCapital({ params }));
  const overrides = input.scenario_overrides;
  const sleeves = input.generator_params.sleeves;

  return {
    units: 'real_annual',
    simulatedAt: 'monthly',
    outputBasis: 'real_clp_model',
    activeScenario: overrides?.scenario_id ?? params.activeScenario,
    rvGlobalReturn: isFiniteNumber(overrides?.rv_global_annual) ? overrides.rv_global_annual : input.return_assumptions.eq_global_real_annual,
    rvChileReturn: isFiniteNumber(overrides?.rv_chile_annual) ? overrides.rv_chile_annual : input.return_assumptions.eq_chile_real_annual,
    rfGlobalReturn: isFiniteNumber(overrides?.rf_global_annual) ? overrides.rf_global_annual : input.return_assumptions.fi_global_real_annual,
    rfChileReturn: isFiniteNumber(overrides?.rf_chile_annual) ? overrides.rf_chile_annual : input.return_assumptions.fi_chile_real_annual,
    rvGlobalVol: isFiniteNumber(overrides?.rv_global_vol_annual) ? overrides.rv_global_vol_annual : sleeves.eq_global.vol_annual,
    rvChileVol: isFiniteNumber(overrides?.rv_chile_vol_annual) ? overrides.rv_chile_vol_annual : sleeves.eq_chile.vol_annual,
    rfGlobalVol: isFiniteNumber(overrides?.rf_global_vol_annual) ? overrides.rf_global_vol_annual : sleeves.fi_global.vol_annual,
    rfChileVol: isFiniteNumber(overrides?.rf_chile_vol_annual) ? overrides.rf_chile_vol_annual : sleeves.fi_chile.vol_annual,
    correlationMatrix4x4: clone4x4(input.generator_params.correlation_matrix),
  };
}

export function buildCandidateMixDiagnostics(
  assumptions: EffectiveRvRfAssumptions,
  row: OptimizationDiagnosticRow,
): CandidateMixDiagnostics {
  const weights = [
    row.weights.rvGlobal,
    row.weights.rvChile,
    row.weights.rfGlobal,
    row.weights.rfChile,
  ];
  const returns = [
    assumptions.rvGlobalReturn,
    assumptions.rvChileReturn,
    assumptions.rfGlobalReturn,
    assumptions.rfChileReturn,
  ];
  const vols = [
    assumptions.rvGlobalVol,
    assumptions.rvChileVol,
    assumptions.rfGlobalVol,
    assumptions.rfChileVol,
  ];
  const covariance = assumptions.correlationMatrix4x4.map((covRow, rowIndex) =>
    covRow.map((corr, colIndex) => corr * vols[rowIndex] * vols[colIndex]),
  );

  const rvWeight = row.weights.rvGlobal + row.weights.rvChile;
  const rfWeight = row.weights.rfGlobal + row.weights.rfChile;
  const expectedRvReturn = rvWeight > 0
    ? ((row.weights.rvGlobal * assumptions.rvGlobalReturn) + (row.weights.rvChile * assumptions.rvChileReturn)) / rvWeight
    : null;
  const expectedRfReturn = rfWeight > 0
    ? ((row.weights.rfGlobal * assumptions.rfGlobalReturn) + (row.weights.rfChile * assumptions.rfChileReturn)) / rfWeight
    : null;
  const variance = quadraticForm(weights, covariance);

  return {
    id: row.id,
    rvPct: row.rvPct,
    rfPct: row.rfPct,
    expectedRvReturn,
    expectedRfReturn,
    rvRfSpread: isFiniteNumber(expectedRvReturn) && isFiniteNumber(expectedRfReturn)
      ? expectedRvReturn - expectedRfReturn
      : null,
    expectedPortfolioReturn: dot(weights, returns),
    expectedPortfolioVol: variance >= 0 ? Math.sqrt(variance) : null,
  };
}

export function selectBenchmarkRows(rows: OptimizationDiagnosticRow[]): OptimizationDiagnosticRow[] {
  const selected: OptimizationDiagnosticRow[] = [];
  for (const target of BENCHMARK_RV_LEVELS) {
    const match = rows.find((row) => Math.abs(row.rvPct - target) < 1e-9);
    if (match && !selected.some((row) => row.id === match.id)) selected.push(match);
  }
  return selected;
}

export function explainWinningMix(
  winner: OptimizationDiagnosticRow | null,
  rows: OptimizationDiagnosticRow[],
): string {
  if (!winner) return 'No hay suficientes métricas de calidad de vida para explicar el ganador.';
  const peers = rows.filter((row) => row.id !== winner.id && isFiniteNumber(row.qasrStrict));
  const runnerUp = [...peers].sort((a, b) => (b.qasrStrict ?? -Infinity) - (a.qasrStrict ?? -Infinity))[0] ?? null;
  if (!runnerUp || !isFiniteNumber(winner.qasrStrict)) {
    return 'Gana por mayor QASR estricto.';
  }
  const qasrGap = winner.qasrStrict - (runnerUp.qasrStrict ?? 0);
  if (qasrGap > TECHNICAL_TIE) {
    return 'Gana por mayor QASR estricto.';
  }
  const csrGap = (winner.csr85_4 ?? 0) - (runnerUp.csr85_4 ?? 0);
  const severeCutGap = (runnerUp.monthsInSevereCutMean ?? Infinity) - (winner.monthsInSevereCutMean ?? Infinity);
  if (csrGap > TECHNICAL_TIE || severeCutGap > 0.5) {
    return 'Gana por mejor CSR y/o menores recortes dentro de un empate técnico de QASR.';
  }
  const moreAggressive = rows
    .filter((row) => row.rvPct > winner.rvPct && isFiniteNumber(row.terminalWealthP25))
    .sort((a, b) => (b.rvPct - a.rvPct))[0] ?? null;
  if (
    moreAggressive
    && isFiniteNumber(moreAggressive.terminalWealthP25)
    && isFiniteNumber(winner.terminalWealthP25)
    && (moreAggressive.terminalWealthP25 as number) > (winner.terminalWealthP25 as number)
    && ((moreAggressive.qasrStrict ?? -Infinity) < (winner.qasrStrict ?? -Infinity) - 1e-9
      || (moreAggressive.csr85_4 ?? -Infinity) < (winner.csr85_4 ?? -Infinity) - 1e-9)
  ) {
    return 'Los mixes más agresivos dejan más patrimonio esperado, pero pierden calidad de vida ajustada por recortes o fragilidad.';
  }
  return 'Gana por mejor balance de calidad de vida entre QASR, CSR y severidad de recortes.';
}

export function buildOptimizationFrontierDiagnostics(
  params: ModelParameters,
  rows: OptimizationDiagnosticRow[],
  winner: OptimizationDiagnosticRow | null,
): OptimizationFrontierDiagnostics {
  const assumptions = buildEffectiveRvRfAssumptions(params);
  return {
    assumptions,
    winningMixReason: explainWinningMix(winner, rows),
    benchmarkRows: selectBenchmarkRows(rows),
    candidateDiagnostics: rows.map((row) => buildCandidateMixDiagnostics(assumptions, row)),
  };
}
