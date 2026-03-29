/// <reference lib="webworker" />

import { SCENARIO_VARIANTS, SENSITIVITY_PARAMS, STRESS_SCENARIOS } from '../model/defaults';
import type {
  ModelParameters,
  SensitivityParameter,
  StressResult,
  StressScenario,
} from '../model/types';
import { runStressTest } from '../simulation/engine';
import { applyScenarioVariant } from '../simulation/engine';
import { runMidasSimulation } from '../simulation/policy';

type SensitivityPointResult = {
  label: string;
  probRuin: number;
  p50: number;
  probRuinDelta: number;
  p50Delta: number;
};

type SensitivityGroupResult = {
  id: string;
  label: string;
  points: SensitivityPointResult[];
};

type StressScenarioResult = {
  scenario: StressScenario;
  result: StressResult;
  terminalWealthDelta: number;
  maxDrawdownDelta: number;
  minSpendingMultDelta: number;
  ruinMonthDelta: number | null;
};

type StartMessage =
  | {
      type: 'sensitivity-start';
      runId: number;
      params: ModelParameters;
    }
  | {
      type: 'stress-start';
      runId: number;
      params: ModelParameters;
      scenarioIds: string[];
    };

type WorkerMessage =
  | {
      type: 'progress';
      runId: number;
      stage: 'baseline' | 'running' | 'done';
      pct: number;
      detail: string;
    }
  | {
      type: 'sensitivity-done';
      runId: number;
      baseline: { probRuin: number; p50: number };
      groups: SensitivityGroupResult[];
    }
  | {
      type: 'stress-done';
      runId: number;
      baseline: StressResult;
      scenarios: StressScenarioResult[];
    }
  | {
      type: 'error';
      runId: number;
      message: string;
    };

const ACTIVE_SENSITIVITY_PARAMS = SENSITIVITY_PARAMS.filter(
  (p) => p.paramPath !== 'simulation.blockLength',
);

const STRESS_BASELINE_SCENARIO: StressScenario = {
  id: 'baseline',
  label: 'Base',
  description: 'Escenario base sin shocks adicionales.',
  monthlyOverrides: [],
};

function cloneParams(params: ModelParameters): ModelParameters {
  return JSON.parse(JSON.stringify(params));
}

function applyValueAtPath(target: ModelParameters, path: string, value: number): ModelParameters {
  const next = cloneParams(target);
  const parts = path.split('.');
  let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    obj = obj[parts[i]] as Record<string, unknown>;
  }
  obj[parts[parts.length - 1]] = value;
  return next;
}

function buildSensitivityBaseline(params: ModelParameters) {
  const baselineParams = cloneParams(params);
  baselineParams.simulation.nSim = 1500;
  baselineParams.simulation.seed = 42;
  const result = runMidasSimulation(baselineParams, 'primary');
  return {
    probRuin: result.probRuin,
    p50: result.terminalWealthPercentiles[50] || 0,
  };
}

function runSensitivity(
  runId: number,
  params: ModelParameters,
  post: (message: WorkerMessage) => void,
) {
  post({
    type: 'progress',
    runId,
    stage: 'baseline',
    pct: 5,
    detail: 'Calculando base',
  });

  const baseline = buildSensitivityBaseline(params);
  const scenarioBase = SCENARIO_VARIANTS.find((variant) => variant.id === 'base') ?? SCENARIO_VARIANTS[0];
  const scenarioPess = SCENARIO_VARIANTS.find((variant) => variant.id === 'pessimistic') ?? scenarioBase;
  const scenarioOpt = SCENARIO_VARIANTS.find((variant) => variant.id === 'optimistic') ?? scenarioBase;
  const riskCurrent = params.simulationComposition?.nonOptimizable?.riskCapital;
  const riskCurrentTotal =
    Number(riskCurrent?.totalCLP ?? 0) > 0
      ? Number(riskCurrent?.totalCLP ?? 0)
      : Math.max(0, Number(params.simulationComposition?.totalNetWorthCLP ?? params.capitalInitial) * 0.1);
  const horizonBase = Math.max(60, Math.round(params.simulation.horizonMonths || 480));
  const horizonValues = Array.from(new Set([
    Math.max(60, horizonBase - 120),
    horizonBase,
    Math.min(720, horizonBase + 120),
  ]));
  const phase0 = params.spendingPhases[0];
  const spendBase = phase0?.amountReal ?? 0;
  const baseRealEstatePolicy = params.realEstatePolicy ?? {
    enabled: true,
    triggerRunwayMonths: 36,
    saleDelayMonths: 12,
    saleCostPct: 0,
    realAppreciationAnnual: 0,
  };

  const customGroups: Array<{
    id: string;
    label: string;
    points: Array<{ label: string; build: (base: ModelParameters) => ModelParameters }>;
  }> = [
    {
      id: 'capitalInitial',
      label: 'Patrimonio inicial',
      points: [
        { label: '-20%', build: (base) => ({ ...base, capitalInitial: base.capitalInitial * 0.8 }) },
        { label: 'Base', build: (base) => ({ ...base, capitalInitial: base.capitalInitial }) },
        { label: '+20%', build: (base) => ({ ...base, capitalInitial: base.capitalInitial * 1.2 }) },
      ],
    },
    {
      id: 'spendingMonthly',
      label: 'Gasto mensual',
      points: [
        {
          label: '-20%',
          build: (base) => ({
            ...base,
            spendingPhases: base.spendingPhases.map((phase, idx) => idx === 0 ? { ...phase, amountReal: spendBase * 0.8 } : phase),
          }),
        },
        { label: 'Base', build: (base) => ({ ...base }) },
        {
          label: '+20%',
          build: (base) => ({
            ...base,
            spendingPhases: base.spendingPhases.map((phase, idx) => idx === 0 ? { ...phase, amountReal: spendBase * 1.2 } : phase),
          }),
        },
      ],
    },
    {
      id: 'horizon',
      label: 'Horizonte',
      points: horizonValues.map((months) => ({
        label: `${Math.round(months / 12)} años`,
        build: (base) => ({ ...base, simulation: { ...base.simulation, horizonMonths: months } }),
      })),
    },
    {
      id: 'scenario',
      label: 'Escenario',
      points: [
        { label: 'Pesimista', build: (base) => applyScenarioVariant(base, scenarioPess) },
        { label: 'Base', build: (base) => applyScenarioVariant(base, scenarioBase) },
        { label: 'Optimista', build: (base) => applyScenarioVariant(base, scenarioOpt) },
      ],
    },
    {
      id: 'riskCapital',
      label: 'Capital de riesgo',
      points: [
        {
          label: 'OFF',
          build: (base) => ({
            ...base,
            simulationComposition: base.simulationComposition
              ? {
                  ...base.simulationComposition,
                  nonOptimizable: {
                    ...base.simulationComposition.nonOptimizable,
                    riskCapital: { ...(base.simulationComposition.nonOptimizable.riskCapital ?? {}), totalCLP: 0, clp: 0, usd: 0, usdTotal: 0 },
                  },
                }
              : base.simulationComposition,
          }),
        },
        {
          label: 'ON',
          build: (base) => ({
            ...base,
            simulationComposition: base.simulationComposition
              ? {
                  ...base.simulationComposition,
                  nonOptimizable: {
                    ...base.simulationComposition.nonOptimizable,
                    riskCapital: {
                      ...(base.simulationComposition.nonOptimizable.riskCapital ?? {}),
                      totalCLP: riskCurrentTotal,
                    },
                  },
                }
              : base.simulationComposition,
          }),
        },
      ],
    },
    {
      id: 'realEstate',
      label: 'Inmueble',
      points: [
        { label: 'OFF', build: (base) => ({ ...base, realEstatePolicy: { ...baseRealEstatePolicy, enabled: false } }) },
        { label: 'ON', build: (base) => ({ ...base, realEstatePolicy: { ...baseRealEstatePolicy, enabled: true } }) },
      ],
    },
  ];

  const paramGroups = ACTIVE_SENSITIVITY_PARAMS.map((sp: SensitivityParameter) => ({
    id: sp.id,
    label: sp.label,
    points: sp.values.map((value, index) => ({
      label: sp.valueLabels[index],
      build: (base: ModelParameters) => applyValueAtPath(base, sp.paramPath, value),
    })),
  }));
  const allGroups = [...customGroups, ...paramGroups];
  const totalPoints = allGroups.reduce((sum, group) => sum + group.points.length, 0);
  let completedPoints = 0;

  const groups = allGroups.map((group) => {
    const points = group.points.map((point) => {
      const nextParams = point.build(cloneParams(params));
      nextParams.simulation.nSim = 1500;
      nextParams.simulation.seed = 42;
      const result = runMidasSimulation(nextParams, 'primary');
      completedPoints += 1;
      const pct = Math.min(95, 5 + Math.round((completedPoints / Math.max(1, totalPoints)) * 90));
      post({
        type: 'progress',
        runId,
        stage: 'running',
        pct,
        detail: `${group.label}: ${point.label}`,
      });
      return {
        label: point.label,
        probRuin: result.probRuin,
        p50: result.terminalWealthPercentiles[50] || 0,
        probRuinDelta: result.probRuin - baseline.probRuin,
        p50Delta: (result.terminalWealthPercentiles[50] || 0) - baseline.p50,
      };
    });
    return {
      id: group.id,
      label: group.label,
      points,
    };
  });

  post({
    type: 'progress',
    runId,
    stage: 'done',
    pct: 100,
    detail: 'Sensibilidades listas',
  });
  post({
    type: 'sensitivity-done',
    runId,
    baseline,
    groups,
  });
}

function runStress(
  runId: number,
  params: ModelParameters,
  scenarioIds: string[],
  post: (message: WorkerMessage) => void,
) {
  post({
    type: 'progress',
    runId,
    stage: 'baseline',
    pct: 5,
    detail: 'Calculando escenario base',
  });

  const baseline = runStressTest(params, STRESS_BASELINE_SCENARIO);
  const scenarios = STRESS_SCENARIOS.filter((scenario) => scenarioIds.includes(scenario.id));
  const total = Math.max(1, scenarios.length);
  const results: StressScenarioResult[] = [];

  scenarios.forEach((scenario, index) => {
    const result = runStressTest(params, scenario);
    results.push({
      scenario,
      result,
      terminalWealthDelta: result.terminalWealthReal - baseline.terminalWealthReal,
      maxDrawdownDelta: result.maxDrawdownReal - baseline.maxDrawdownReal,
      minSpendingMultDelta: result.minSpendingMult - baseline.minSpendingMult,
      ruinMonthDelta:
        result.ruinMonth === null || baseline.ruinMonth === null
          ? null
          : result.ruinMonth - baseline.ruinMonth,
    });
    const pct = Math.min(95, 5 + Math.round(((index + 1) / total) * 90));
    post({
      type: 'progress',
      runId,
      stage: 'running',
      pct,
      detail: scenario.label,
    });
  });

  post({
    type: 'progress',
    runId,
    stage: 'done',
    pct: 100,
    detail: 'Stress tests listos',
  });
  post({
    type: 'stress-done',
    runId,
    baseline,
    scenarios: results,
  });
}

self.onmessage = (event: MessageEvent<StartMessage>) => {
  const post = (message: WorkerMessage) => self.postMessage(message);
  try {
    if (event.data.type === 'sensitivity-start') {
      runSensitivity(event.data.runId, event.data.params, post);
      return;
    }
    if (event.data.type === 'stress-start') {
      runStress(event.data.runId, event.data.params, event.data.scenarioIds, post);
    }
  } catch (error) {
    post({
      type: 'error',
      runId: event.data.runId,
      message: error instanceof Error ? error.message : 'scenario_worker_failed',
    });
  }
};

export {};
