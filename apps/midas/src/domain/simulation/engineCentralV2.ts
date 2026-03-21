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

  // Motor 6 fija una capa economica central explicita:
  // misma mecanica patrimonial del Motor 2, pero con retornos de RV
  // intermedios entre el bloque prudente y el sesgo amable de Motor 1.
  next.returns = {
    ...next.returns,
    rvGlobalAnnual: 0.0725,
    rfGlobalAnnual: BASE_ECONOMIC_ASSUMPTIONS.rfGlobalAnnual,
    rvChileAnnual: 0.0785,
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

export function runSimulationCentralV2(params: ModelParameters): SimulationResults {
  return runSimulationParametric(withCentralAssumptions(params));
}

export function runSimulationCentralV2Audit(params: ModelParameters): CentralAuditResults {
  return runSimulationParametricAudit(withCentralAssumptions(params));
}
