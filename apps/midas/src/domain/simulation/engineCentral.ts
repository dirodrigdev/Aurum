import type { ModelParameters, SimulationResults } from '../model/types';
import { BASE_ECONOMIC_ASSUMPTIONS } from '../model/economicAssumptions';
import { runSimulationParametric, runSimulationParametricAudit } from './engineParametric';

type CentralAuditResults = {
  probRuin: number;
  successRate: number;
  ruinLt20y: number;
  ruinLt40y: number;
  monthsCutPct: number;
  terminalP50: number;
};

function cloneParams(params: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(params)) as ModelParameters;
}

function withCentralAssumptions(params: ModelParameters): ModelParameters {
  const next = cloneParams(params);

  // Motor 5 fija una capa economica central explicita y prudente.
  // La logica patrimonial se mantiene identica a Motor 2.
  next.returns = {
    ...next.returns,
    rvGlobalAnnual: BASE_ECONOMIC_ASSUMPTIONS.rvGlobalAnnual,
    rfGlobalAnnual: BASE_ECONOMIC_ASSUMPTIONS.rfGlobalAnnual,
    rvChileAnnual: BASE_ECONOMIC_ASSUMPTIONS.rvChileAnnual,
    rfChileUFAnnual: BASE_ECONOMIC_ASSUMPTIONS.rfChileRealAnnual,
    rvGlobalVolAnnual: BASE_ECONOMIC_ASSUMPTIONS.rvGlobalVolAnnual,
    rfGlobalVolAnnual: BASE_ECONOMIC_ASSUMPTIONS.rfGlobalVolAnnual,
    rvChileVolAnnual: BASE_ECONOMIC_ASSUMPTIONS.rvChileVolAnnual,
    rfChileVolAnnual: BASE_ECONOMIC_ASSUMPTIONS.rfChileVolAnnual,
    correlationMatrix: BASE_ECONOMIC_ASSUMPTIONS.correlationMatrix.map(row => [...row]),
  };

  next.inflation = {
    ...next.inflation,
    ipcChileAnnual: BASE_ECONOMIC_ASSUMPTIONS.ipcChileAnnual,
    hipcEurAnnual: BASE_ECONOMIC_ASSUMPTIONS.hicpEuroAnnual,
  };

  next.fx = {
    ...next.fx,
    tcrealLT: BASE_ECONOMIC_ASSUMPTIONS.tcrealLT,
    mrHalfLifeYears: BASE_ECONOMIC_ASSUMPTIONS.mrHalfLifeYears,
  };

  return next;
}

export function runSimulationCentral(params: ModelParameters): SimulationResults {
  return runSimulationParametric(withCentralAssumptions(params));
}

export function runSimulationCentralAudit(params: ModelParameters): CentralAuditResults {
  return runSimulationParametricAudit(withCentralAssumptions(params));
}
