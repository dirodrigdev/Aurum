/// <reference lib="webworker" />

import type { ModelParameters, SimulationResults } from '../model/types';
import { runMidasSimulation } from './policy';

type CentralWorkerStartMessage = {
  type: 'central-start';
  runId: number;
  channel: 'primary';
  params: ModelParameters;
};

type CentralWorkerDoneMessage = {
  type: 'done';
  runId: number;
  result: SimulationResults;
};

type CentralWorkerErrorMessage = {
  type: 'error';
  runId: number;
  message: string;
};

self.onmessage = (event: MessageEvent<CentralWorkerStartMessage>) => {
  if (event.data.type !== 'central-start') return;
  const { runId, params } = event.data;
  try {
    const result = runMidasSimulation(params, 'primary');
    const payload: CentralWorkerDoneMessage = {
      type: 'done',
      runId,
      result,
    };
    self.postMessage(payload);
  } catch (error: unknown) {
    const payload: CentralWorkerErrorMessage = {
      type: 'error',
      runId,
      message: error instanceof Error ? error.message : 'central_worker_failed',
    };
    self.postMessage(payload);
  }
};

export {};
