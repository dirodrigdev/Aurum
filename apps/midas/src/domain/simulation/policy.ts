import type { ModelParameters, SimulationResults } from '../model/types';
import { runSimulationCentral } from './engineCentral';

export type MidasSimulationChannel = 'primary' | 'favorable' | 'prudent';
export type MidasEngineId = 'central';

/**
 * Single source of truth for simulation engine routing in Midas.
 *
 * Product rule (active flow):
 * - Runtime product simulation uses only the central engine.
 * - Auxiliary engines remain in repository for reference, outside active flow.
 */
export const MIDAS_SIMULATION_POLICY: Record<MidasSimulationChannel, MidasEngineId> = {
  primary: 'central',
  favorable: 'central',
  prudent: 'central',
};

export function getMidasEngineFor(channel: MidasSimulationChannel): MidasEngineId {
  return MIDAS_SIMULATION_POLICY[channel];
}

export function runMidasSimulation(
  params: ModelParameters,
  _channel: MidasSimulationChannel = 'primary',
): SimulationResults {
  return runSimulationCentral(params);
}

export function runMidasTriSimulation(params: ModelParameters) {
  // Compatibility wrapper. Active product flow should consume only `central`.
  const central = runMidasSimulation(params, 'primary');
  return {
    central,
    favorable: null,
    prudent: null,
  };
}
