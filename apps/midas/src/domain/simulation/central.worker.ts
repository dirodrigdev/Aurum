/// <reference lib="webworker" />

import type { ModelParameters, SimulationResults } from '../model/types';
import { runMidasSimulation } from './policy';
import { runSimulationCore } from './engine';

type CentralWorkerStartMessage = {
  type: 'central-start';
  runId: number;
  channel: 'primary' | 'bootstrap-control';
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

type CentralWorkerTraceMessage = {
  type: 'trace';
  runId: number;
  event: 'worker_message_received' | 'worker_compute_started' | 'worker_compute_finished' | 'worker_post_done' | 'worker_post_error';
  atMs: number;
  summary?: {
    capitalInitial: number;
    compositionMode: string;
    banksCLP: number;
    optimizableInvestmentsCLP: number;
    riskBlockPresent: boolean;
    realEstateEnabled: boolean;
  };
  message?: string;
};

self.onmessage = (event: MessageEvent<CentralWorkerStartMessage>) => {
  if (event.data.type !== 'central-start') return;
  const { runId, params } = event.data;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const summarizeParams = () => ({
    capitalInitial: Number(params.capitalInitial ?? 0),
    compositionMode: params.simulationComposition?.mode ?? 'legacy',
    banksCLP: Number(params.simulationComposition?.nonOptimizable?.banksCLP ?? 0),
    optimizableInvestmentsCLP: Number(params.simulationComposition?.optimizableInvestmentsCLP ?? 0),
    riskBlockPresent: Number(params.simulationComposition?.nonOptimizable?.riskCapital?.totalCLP ?? 0) > 0,
    realEstateEnabled: params.realEstatePolicy?.enabled ?? true,
  });
  const emitTrace = (
    traceEvent: CentralWorkerTraceMessage['event'],
    extra?: { message?: string; includeSummary?: boolean },
  ) => {
    const payload: CentralWorkerTraceMessage = {
      type: 'trace',
      runId,
      event: traceEvent,
      atMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
      ...(extra?.includeSummary ? { summary: summarizeParams() } : {}),
      ...(extra?.message ? { message: extra.message } : {}),
    };
    self.postMessage(payload);
  };
  emitTrace('worker_message_received', { includeSummary: true });
  try {
    emitTrace('worker_compute_started');
    const result =
      event.data.channel === 'bootstrap-control'
        ? runSimulationCore(params)
        : runMidasSimulation(params, 'primary');
    emitTrace('worker_compute_finished');
    emitTrace('worker_post_done');
    const payload: CentralWorkerDoneMessage = {
      type: 'done',
      runId,
      result,
    };
    self.postMessage(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'central_worker_failed';
    emitTrace('worker_post_error', { message });
    const payload: CentralWorkerErrorMessage = {
      type: 'error',
      runId,
      message,
    };
    self.postMessage(payload);
  }
};

export {};
