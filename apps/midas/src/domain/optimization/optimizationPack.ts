import { buildMidasEvaluation } from '../model/midasEvaluation';
import type { M8InputFingerprint } from '../model/m8InputFingerprint';
import {
  resolveQualityOfLifeKpiThreshold,
  type QualityOfLifePrimaryKpiId,
} from '../model/qualityOfLifeKpiThresholds';
import type { ResultConfidence } from '../model/resultConfidence';
import type { SimulationResultDiagnostics } from '../model/simulationResultDigest';
import type { SimulationResults } from '../model/types';

export const OPTIMIZATION_PACK_TYPE = 'midas_optimization_pack';
export const OPTIMIZATION_PACK_VERSION = '1.0';

export const OPTIMIZATION_MENU = [
  {
    id: 'maximize_success',
    label: 'Aumentar probabilidad de éxito',
    description: 'Buscar escenarios con menor probabilidad de ruina.',
  },
  {
    id: 'improve_quality_of_life',
    label: 'Mejorar calidad de vida',
    description: 'Reducir recortes, estrés y meses bajo umbral.',
  },
  {
    id: 'reduce_house_sale',
    label: 'Reducir probabilidad de vender la casa',
    description: 'Disminuir presión de liquidez y venta forzada.',
  },
  {
    id: 'increase_sustainable_spending',
    label: 'Aumentar gasto sostenible',
    description: 'Explorar mayor consumo sin romper límites de riesgo.',
  },
  {
    id: 'reduce_early_stress',
    label: 'Reducir estrés temprano',
    description: 'Optimizar primeros años y riesgo de secuencia.',
  },
  {
    id: 'avoid_underuse',
    label: 'Evitar subuso patrimonial',
    description: 'Detectar patrimonio terminal alto con recortes innecesarios.',
  },
  {
    id: 'custom',
    label: 'Objetivo personalizado',
    description: 'Permite que el usuario formule un objetivo libre traducible a variables permitidas.',
  },
] as const;

export const OPTIMIZATION_ALLOWED_VARIABLES = [
  'spendingPhases',
  'phaseDurations',
  'bucketMonths',
  'portfolioMix',
  'cutRules',
  'houseSaleTrigger',
  'returnScenario',
  'horizonYears',
  'nSim',
  'seed',
] as const;

export const OPTIMIZATION_FORBIDDEN_VARIABLES = [
  'realAurumSnapshot',
  'historicalGastAppExpenses',
  'observedFx',
  'observedMortgageBalance',
  'observedPortfolioValue',
  'userIdentity',
  'authUser',
  'email',
  'uid',
] as const;

export const CANDIDATE_FORBIDDEN_FINAL_METRICS = [
  'success40',
  'ruin40',
  'qolScore',
  'houseSalePct',
  'terminalWealth',
  'ranking',
  'recommendationFinal',
] as const;

export const MAX_CANDIDATES_PER_SET = 50;

export type OptimizationGoalId = (typeof OPTIMIZATION_MENU)[number]['id'];
export type AllowedOptimizationVariable = (typeof OPTIMIZATION_ALLOWED_VARIABLES)[number];
export type ForbiddenOptimizationVariable = (typeof OPTIMIZATION_FORBIDDEN_VARIABLES)[number];

export type OptimizationPack = {
  packType: typeof OPTIMIZATION_PACK_TYPE;
  version: typeof OPTIMIZATION_PACK_VERSION;
  createdAt: string;
  app: 'midas';
  engine: 'M8';
  purpose: string;
  baseline: {
    fingerprint: string;
    resultDigest: string;
    success40: number | null;
    ruin40: number | null;
    qolLabel: string | null;
    qolScore: number | null;
    houseSalePct: number | null;
    terminalWealthRatio: number | null;
    csr85_4: number | null;
    qualitySurvivalRate: number | null;
  };
  canonicalInput: Record<string, unknown>;
  sourceLineage: Record<string, unknown>;
  qolThresholds: unknown;
  optimizationMenu: ReadonlyArray<{
    id: OptimizationGoalId;
    label: string;
    description: string;
  }>;
  allowedVariables: ReadonlyArray<AllowedOptimizationVariable>;
  forbiddenVariables: ReadonlyArray<ForbiddenOptimizationVariable>;
  conversationProtocol: Record<string, unknown>;
  candidateSetSchema: Record<string, unknown>;
  engineGuidance: Record<string, unknown>;
};

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const finiteOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

function deriveSuccess40(result: SimulationResults): number | null {
  return finiteOrNull(result.success40 ?? (typeof result.probRuin40 === 'number' ? 1 - result.probRuin40 : 1 - result.probRuin));
}

function deriveRuin40(result: SimulationResults): number | null {
  return finiteOrNull(result.probRuin40 ?? result.probRuin);
}

function buildQolThresholdGuide() {
  const baseMetrics = {
    csr85_4: 0.737,
    qualitySurvivalRate: 0.154,
    averageEffectiveSpendingRatio: 0.96,
    severeCutYearsMean: 2.9,
    monthsBelow85: 35,
    terminalWealthRatio: 2.18,
  };
  const kpis: QualityOfLifePrimaryKpiId[] = [
    'csr85_4',
    'qualitySurvivalRate',
    'averageEffectiveSpendingRatio',
    'severeCutYearsMean',
    'terminalWealthRatio',
  ];
  return kpis.map((kpiId) => ({
    kpiId,
    currentThreshold: resolveQualityOfLifeKpiThreshold(kpiId, baseMetrics),
  }));
}

function buildConversationProtocol() {
  return {
    strictInput: true,
    guidedFlexibleConversation: true,
    strictOutput: true,
    flow: [
      'Recibe el Optimization Pack completo antes de proponer cambios.',
      'Pregunta por objetivos y restricciones usando solo variables permitidas.',
      'Después de cada objetivo o restricción, pregunta: ¿Quieres seguir agregando objetivos/restricciones o terminaste?',
      'Si el usuario responde seguir, continúa capturando objetivos o restricciones.',
      'Si el usuario responde terminé, devuelve solo el JSON final midas_candidate_set.',
    ],
    rules: {
      askToContinueAfterEachConstraint: true,
      finalOutputType: 'midas_candidate_set',
      allowQualitativeHypotheses: true,
      doNotClaimFinalMetrics: true,
      finalEvaluationMustBeRunByMidasM8: true,
    },
  };
}

function buildCandidateSetSchema() {
  return {
    type: 'midas_candidate_set',
    version: '1.0',
    required: ['type', 'version', 'packFingerprint', 'selectedGoals', 'customGoals', 'constraints', 'candidates'],
    allowedVariables: OPTIMIZATION_ALLOWED_VARIABLES,
    forbiddenVariables: OPTIMIZATION_FORBIDDEN_VARIABLES,
    forbiddenFinalMetrics: CANDIDATE_FORBIDDEN_FINAL_METRICS,
    maxCandidates: MAX_CANDIDATES_PER_SET,
    candidateShape: {
      required: ['candidateId', 'changes'],
      optional: ['label', 'hypothesis', 'riskNotes'],
      changes: 'Record<allowedVariable, unknown>',
    },
  };
}

function buildEngineGuidance() {
  return {
    summary: [
      'El horizonte cambia la duración total del plan y la exposición acumulada al riesgo.',
      'El gasto por fases cambia presión de liquidez, recortes y probabilidad de venta de casa.',
      'Bucket y liquidez afectan resiliencia temprana frente a secuencia de retornos.',
      'Mix, retornos y volatilidad cambian riesgo, holgura y subuso patrimonial.',
      'Las reglas de recorte alteran calidad de vida y supervivencia del plan.',
      'La venta de casa funciona como soporte de liquidez, no como señal única de fracaso.',
      'La secuencia de retornos importa especialmente en los primeros años.',
      'QoL y patrimonio terminal deben leerse juntos para evitar subuso o fragilidad.',
    ],
    doNotCalculateFinalMetrics: true,
    finalEvaluationMustBeRunByMidasM8: true,
  };
}

export function buildOptimizationPack(params: {
  createdAt?: string;
  fingerprint: M8InputFingerprint;
  simulationResultDiagnostics: SimulationResultDiagnostics;
  resultConfidence: ResultConfidence;
  simResult: SimulationResults;
}): OptimizationPack {
  const { fingerprint, simulationResultDiagnostics, resultConfidence, simResult } = params;
  const replayTrace = fingerprint.diagnosticInput.replayTrace;
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: simResult.qualityOfLifeMetrics ?? null,
    inputAuditable: true,
    canUseForDecision: resultConfidence.canUseForDecision,
    decisionStatus: resultConfidence.status,
    comparabilityWarnings: replayTrace.sourcePolicy.warnings,
  });

  return {
    packType: OPTIMIZATION_PACK_TYPE,
    version: OPTIMIZATION_PACK_VERSION,
    createdAt: params.createdAt ?? new Date().toISOString(),
    app: 'midas',
    engine: 'M8',
    purpose: 'Generate candidate scenarios only. Final evaluation must be run by official MIDAS M8.',
    baseline: {
      fingerprint: fingerprint.effectiveEngineInputHash,
      resultDigest: simulationResultDiagnostics.resultDigest ?? '',
      success40: deriveSuccess40(simResult),
      ruin40: deriveRuin40(simResult),
      qolLabel: evaluation.label,
      qolScore: evaluation.cappedScore,
      houseSalePct: finiteOrNull(simResult.houseSalePct),
      terminalWealthRatio: finiteOrNull(simResult.qualityOfLifeMetrics?.terminalWealthRatio),
      csr85_4: finiteOrNull(simResult.qualityOfLifeMetrics?.csr85_4),
      qualitySurvivalRate: finiteOrNull(simResult.qualityOfLifeMetrics?.qualitySurvivalRate),
    },
    canonicalInput: cloneJson(fingerprint.normalizedInput),
    sourceLineage: cloneJson({
      sourcePolicy: replayTrace.sourcePolicy,
      sourceMetadata: replayTrace.sourceMetadata,
      readiness: replayTrace.readiness,
      fingerprints: replayTrace.fingerprints,
    }),
    qolThresholds: buildQolThresholdGuide(),
    optimizationMenu: OPTIMIZATION_MENU,
    allowedVariables: OPTIMIZATION_ALLOWED_VARIABLES,
    forbiddenVariables: OPTIMIZATION_FORBIDDEN_VARIABLES,
    conversationProtocol: buildConversationProtocol(),
    candidateSetSchema: buildCandidateSetSchema(),
    engineGuidance: buildEngineGuidance(),
  };
}
