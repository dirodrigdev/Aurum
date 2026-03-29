/// <reference lib="webworker" />

import type { ModelParameters, OptimizerObjective, OptimizerRealisticResult, OptimizerResult } from '../model/types';
import { DEFAULT_OPTIMIZER_CONSTRAINTS } from '../model/defaults';
import { evaluateOptimizerPoint, runOptimizer } from './gridSearch';
import type { InstrumentBaseItem } from '../instrumentBase';
import { buildRealisticInstrumentProposal } from '../instrumentBase';

type StartMessage =
  | {
      type: 'start';
      runId: number;
      params: ModelParameters;
      objective: OptimizerObjective;
      decisionShare?: number;
      instrumentBase?: InstrumentBaseItem[] | null;
      optimizableBaseClp?: number | null;
    }
  | {
      type: 'baseline-only';
      runId: number;
      params: ModelParameters;
      decisionShare?: number;
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function buildBaseline(params: ModelParameters, decisionShare = 1) {
  const result = evaluateOptimizerPoint(params, params.weights, params.simulation.nSim, { decisionShare });
  return {
    probRuin: result.probRuin,
    terminalP50: result.terminalP50 || 0,
  };
}

self.onmessage = (event: MessageEvent<StartMessage>) => {
  if (!event.data) return;

  if (event.data.type === 'baseline-only') {
    const { runId, params } = event.data;
    const decisionShare = clamp01(event.data.decisionShare ?? 1);
    try {
      const baseline = buildBaseline(params, decisionShare);
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

  const { runId, params, objective, instrumentBase, optimizableBaseClp } = event.data;
  const decisionShare = clamp01(event.data.decisionShare ?? 1);
  let baselineProbRuin: number | undefined;
  let baselineP50: number | undefined;
  let quickResult: OptimizerResult | undefined;

  try {
    const baseline = buildBaseline(params, decisionShare);
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
    }, { decisionShare });

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
    }, { decisionShare });

    const realisticProposal = buildRealisticInstrumentProposal(
      instrumentBase ?? null,
      fullResult.weights,
      { optimizableBaseClp },
    );
    let realistic: OptimizerRealisticResult | undefined;
    if (realisticProposal) {
      const simulated = evaluateOptimizerPoint(params, realisticProposal.proposedMix, FULL_SIM_COUNT, { decisionShare });
      realistic = {
        weights: realisticProposal.proposedMix,
        probRuin: simulated.probRuin,
        terminalP50: simulated.terminalP50,
        terminalP10: simulated.terminalP10,
        moves: realisticProposal.moves,
        quality: realisticProposal.quality,
        coverageRatio: realisticProposal.coverageRatio,
        withinManagerShare: realisticProposal.withinManagerShare,
        currentMix: realisticProposal.currentMix,
        targetMix: realisticProposal.targetMix,
        proposedMix: realisticProposal.proposedMix,
        baseTotalClp: realisticProposal.baseTotalClp,
        notes: realisticProposal.notes,
      };
    }

    post({
      type: 'done',
      runId,
      result: {
        ...fullResult,
        realistic,
      },
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
