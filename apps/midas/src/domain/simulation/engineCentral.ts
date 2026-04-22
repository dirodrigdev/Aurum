import type { ModelParameters, SimulationResults } from '../model/types';
import { normalizeModelSpendingPhases } from '../model/spendingPhases';
import { resolveCapital } from './capitalResolver';
import { fromM8Output, toM8Input } from './m8Adapter';
import { runM8 } from './engineM8';

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

function normalizeM8Params(params: ModelParameters): ModelParameters {
  const cloned = cloneParams(params);
  if (cloned.simulation.horizonMonths < 48) {
    cloned.simulation = {
      ...cloned.simulation,
      horizonMonths: 48,
    };
  }
  cloned.spendingPhases = normalizeModelSpendingPhases(cloned);
  return cloned;
}

function runCentralM8(params: ModelParameters): SimulationResults {
  const cloned = normalizeM8Params(params);
  const capitalResolution = resolveCapital({ params: cloned });
  const input = toM8Input(cloned, capitalResolution);
  const output = runM8(input);
  return fromM8Output(output, cloned);
}

export function runSimulationCentral(params: ModelParameters): SimulationResults {
  return runCentralM8(params);
}

export function runSimulationCentralAudit(params: ModelParameters): CentralAuditResults {
  const cloned = normalizeM8Params(params);
  const capitalResolution = resolveCapital({ params: cloned });
  const input = toM8Input(cloned, capitalResolution);
  const output = runM8(input);
  return {
    probRuin: output.ProbRuin40,
    successRate: output.Success40,
    ruinLt20y: output.ProbRuin20,
    ruinLt40y: output.ProbRuin40,
    monthsCutPct: output.CutTimeShare,
    terminalP50: output.TerminalMedianCLP,
  };
}
