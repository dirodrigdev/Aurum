import type { ModelParameters, SimulationResults } from '../model/types';
import { DEFAULT_PARAMETERS } from '../model/defaults';
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

function normalizeSpendingPhasesForM8(params: ModelParameters): ModelParameters['spendingPhases'] {
  const phases = params.spendingPhases.slice(0, 3).map((phase) => ({ ...phase }));
  const fallbackPhases = DEFAULT_PARAMETERS.spendingPhases;
  while (phases.length < 3) {
    const fallback = fallbackPhases[phases.length];
    if (!fallback) break;
    phases.push({ ...fallback });
  }

  const horizonMonths = params.simulation.horizonMonths;
  if (Number.isFinite(horizonMonths) && horizonMonths > 0 && phases.length >= 3) {
    const phase1Months = phases[0].durationMonths;
    const phase2Months = phases[1].durationMonths;
    if (phase1Months + phase2Months >= horizonMonths) {
      const chunk = Math.max(1, Math.floor(horizonMonths / 3));
      const phase3Months = Math.max(1, horizonMonths - (chunk * 2));
      phases[0] = { ...phases[0], durationMonths: chunk };
      phases[1] = { ...phases[1], durationMonths: chunk };
      phases[2] = { ...phases[2], durationMonths: phase3Months };
    }
  }

  return phases;
}

function normalizeM8Params(params: ModelParameters): ModelParameters {
  const cloned = cloneParams(params);
  if (cloned.simulation.horizonMonths < 36) {
    cloned.simulation = {
      ...cloned.simulation,
      horizonMonths: 36,
    };
  }
  cloned.spendingPhases = normalizeSpendingPhasesForM8(cloned);
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
