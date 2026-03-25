import type { ModelParameters, SimulationResults } from '../model/types';
import { runSimulation } from './engine';
import { runSimulationCentral } from './engineCentral';
import { runSimulationRobust } from './engineRobust';

export type MidasSimulationChannel = 'primary' | 'favorable' | 'prudent';
export type MidasEngineId = 'central' | 'historical' | 'robust';

/**
 * Single source of truth for simulation engine routing in Midas.
 *
 * Product rule:
 * - `primary` is the only official baseline engine and must stay `central`.
 * - `historical` and `robust` are auxiliary engines for range/comparison only.
 * - No principal screen should silently use auxiliary engines as baseline.
 */
export const MIDAS_SIMULATION_POLICY: Record<MidasSimulationChannel, MidasEngineId> = {
  primary: 'central',
  favorable: 'historical',
  prudent: 'robust',
};

export function getMidasEngineFor(channel: MidasSimulationChannel): MidasEngineId {
  return MIDAS_SIMULATION_POLICY[channel];
}

export function runMidasSimulation(
  params: ModelParameters,
  channel: MidasSimulationChannel = 'primary',
): SimulationResults {
  const engine = getMidasEngineFor(channel);
  switch (engine) {
    case 'central':
      return runSimulationCentral(params);
    case 'historical':
      return runSimulation(params);
    case 'robust':
      return runSimulationRobust(params);
  }
}

export function runMidasTriSimulation(params: ModelParameters) {
  return {
    central: runMidasSimulation(params, 'primary'),
    favorable: runMidasSimulation(params, 'favorable'),
    prudent: runMidasSimulation(params, 'prudent'),
  };
}
