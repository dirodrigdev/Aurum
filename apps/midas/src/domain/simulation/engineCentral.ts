import type { ModelParameters, SimulationResults } from '../model/types';
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
  // El motor central debe respetar los supuestos economicos efectivos
  // que ya vienen resueltos desde App (Base / Optimista / Pesimista / Custom).
  return cloneParams(params);
}

export function runSimulationCentral(params: ModelParameters): SimulationResults {
  return runSimulationParametric(withCentralAssumptions(params));
}

export function runSimulationCentralAudit(params: ModelParameters): CentralAuditResults {
  return runSimulationParametricAudit(withCentralAssumptions(params));
}
