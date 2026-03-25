/// <reference lib="webworker" />

import type { ModelParameters, OptimizerObjective, OptimizerResult } from '../model/types';
import { DEFAULT_OPTIMIZER_CONSTRAINTS, SCENARIO_VARIANTS } from '../model/defaults';
import { applyScenarioVariant, runSimulationCore } from '../simulation/engine';
import { runOptimizer } from './gridSearch';

type StartMessage = {
  type: 'start';
  runId: number;
  params: ModelParameters;
  objective: OptimizerObjective;
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

const QUICK_STEP = 0.2;
const FULL_STEP = 0.1;
const BASELINE_SIM_COUNT = 140;
const QUICK_SIM_COUNT = 48;
const FULL_SIM_COUNT = 96;

function post(message: WorkerMessage) {
  self.postMessage(message);
}

function buildBaseline(params: ModelParameters) {
  const variant = SCENARIO_VARIANTS.find((item) => item.id === params.activeScenario) ?? SCENARIO_VARIANTS[0];
  const result = runSimulationCore(
    applyScenarioVariant(
      {
        ...params,
        simulation: {
          ...params.simulation,
          nSim: BASELINE_SIM_COUNT,
          seed: 42,
        },
      },
      variant,
    ),
  );
  return {
    probRuin: result.probRuin,
    terminalP50: result.terminalWealthPercentiles[50] || 0,
  };
}

self.onmessage = (event: MessageEvent<StartMessage>) => {
  if (event.data?.type !== 'start') return;

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
      step: Math.max(DEFAULT_OPTIMIZER_CONSTRAINTS.step * 4, QUICK_STEP),
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
      step: Math.max(DEFAULT_OPTIMIZER_CONSTRAINTS.step * 2, FULL_STEP),
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
