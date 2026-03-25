/// <reference lib="webworker" />

import type { ModelParameters, OptimizerObjective, OptimizerResult } from '../model/types';
import { DEFAULT_OPTIMIZER_CONSTRAINTS } from '../model/defaults';
import { evaluateOptimizerPoint, runOptimizer } from './gridSearch';

type StartMessage =
  | {
      type: 'start';
      runId: number;
      params: ModelParameters;
      objective: OptimizerObjective;
    }
  | {
      type: 'baseline-only';
      runId: number;
      params: ModelParameters;
    };

type WorkerMessage =
  | {
      type: 'baseline';
      runId: number;
      probRuin: number;
      terminalP50: number;
    }
  | {
      type: 'progress';
      runId: number;
      phase: 'quick' | 'full';
      pct: number;
      detail: string;
    }
  | {
      type: 'quick-result';
      runId: number;
      result: OptimizerResult;
    }
  | {
      type: 'done';
      runId: number;
      result: OptimizerResult;
    }
  | {
      type: 'error';
      runId: number;
      message: string;
      baselineProbRuin?: number;
      baselineP50?: number;
      quickResult?: OptimizerResult;
    };

const QUICK_STEP = 0.15;
const QUICK_SIM_COUNT = 96;
const FULL_SIM_COUNT = 220;

function post(message: WorkerMessage) {
  self.postMessage(message);
}

function buildBaseline(params: ModelParameters) {
  const result = evaluateOptimizerPoint(params, params.weights, params.simulation.nSim);
  return {
    probRuin: result.probRuin,
    terminalP50: result.terminalP50 || 0,
  };
}

self.onmessage = (event: MessageEvent<StartMessage>) => {
  if (!event.data) return;

  if (event.data.type === 'baseline-only') {
    const { runId, params } = event.data;
    try {
      const baseline = buildBaseline(params);
      post({
        type: 'baseline',
        runId,
        probRuin: baseline.probRuin,
        terminalP50: baseline.terminalP50,
      });
    } catch (error) {
      post({
        type: 'error',
        runId,
        message: error instanceof Error ? error.message : 'optimizer_worker_failed',
      });
    }
    return;
  }

  if (event.data.type !== 'start') return;

  const { runId, params, objective } = event.data;
  let baselineProbRuin: number | undefined;
  let baselineP50: number | undefined;
  let quickResult: OptimizerResult | undefined;

  try {
    const baseline = buildBaseline(params);
    baselineProbRuin = baseline.probRuin;
    baselineP50 = baseline.terminalP50;
    post({
      type: 'baseline',
      runId,
      probRuin: baseline.probRuin,
      terminalP50: baseline.terminalP50,
    });

    const quickConstraints = {
      ...DEFAULT_OPTIMIZER_CONSTRAINTS,
      step: Math.max(DEFAULT_OPTIMIZER_CONSTRAINTS.step * 3, QUICK_STEP),
    };

    quickResult = runOptimizer(params, quickConstraints, objective, QUICK_SIM_COUNT, (pct) => {
      post({
        type: 'progress',
        runId,
        phase: 'quick',
        pct: Math.max(1, Math.round(pct * 0.35)),
        detail: `Estimación rápida (${pct}%)`,
      });
    });

    post({
      type: 'quick-result',
      runId,
      result: quickResult,
    });

    const fullConstraints = {
      ...DEFAULT_OPTIMIZER_CONSTRAINTS,
      step: DEFAULT_OPTIMIZER_CONSTRAINTS.step,
    };

    const fullResult = runOptimizer(params, fullConstraints, objective, FULL_SIM_COUNT, (pct) => {
      post({
        type: 'progress',
        runId,
        phase: 'full',
        pct: Math.min(99, 35 + Math.round(pct * 0.65)),
        detail: `Refinando (${pct}%)`,
      });
    });

    post({
      type: 'done',
      runId,
      result: fullResult,
    });
  } catch (error) {
    post({
      type: 'error',
      runId,
      message: error instanceof Error ? error.message : 'optimizer_worker_failed',
      baselineProbRuin,
      baselineP50,
      quickResult,
    });
  }
};

export {};
