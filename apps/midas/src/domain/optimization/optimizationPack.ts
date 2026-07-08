import { buildMidasEvaluation } from '../model/midasEvaluation';
import type { M8InputFingerprint } from '../model/m8InputFingerprint';
import {
  resolveQualityOfLifeKpiThreshold,
  type QualityOfLifePrimaryKpiId,
} from '../model/qualityOfLifeKpiThresholds';
import type { ResultConfidence } from '../model/resultConfidence';
import type { SimulationResultDiagnostics } from '../model/simulationResultDigest';
import type { SimulationResults } from '../model/types';
import {
  SCENARIO_LAB_BLOCKED_VARIABLE_REASONS,
  SCENARIO_LAB_EDITABLE_VARIABLES,
  SCENARIO_LAB_ENGINE_INVARIANTS,
  SCENARIO_LAB_ENGINE_READONLY_METRICS,
} from './scenarioLabEngineContract';

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
    id: 'reduce_liquidity_stress',
    label: 'Reducir estrés de liquidez',
    description: 'Disminuir presión de liquidez y activaciones tempranas según la política de casa definida por el motor.',
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
    id: 'minimize_terminal_residual',
    label: 'Minimizar patrimonio residual al horizonte',
    description: 'Aproximar el patrimonio terminal a cero sin romper guardrails de seguridad y calidad de vida.',
  },
  {
    id: 'custom',
    label: 'Objetivo personalizado',
    description: 'Permite que el usuario formule un objetivo libre traducible a variables permitidas.',
  },
] as const;

export const OPTIMIZATION_ALLOWED_VARIABLES = SCENARIO_LAB_EDITABLE_VARIABLES;

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
  ...Object.keys(SCENARIO_LAB_BLOCKED_VARIABLE_REASONS),
] as const;

export const CANDIDATE_FORBIDDEN_FINAL_METRICS = [
  'success40',
  'ruin40',
  'qolScore',
  'houseSalePct',
  'terminalWealthRatio',
  'terminalWealth',
  'ranking',
  'officialSuccess40',
  'officialRuin40',
  'm8Success40',
  'm8Ruin40',
  'recommendationFinal',
] as const;

export const MAX_CANDIDATES_PER_SET = 15;
export const TARGET_CANDIDATES_PER_SET = 12;
export const HEURISTIC_PRIORITY_VALUES = ['high', 'medium', 'low'] as const;
export const DIRECTIONAL_EFFECT_VALUES = [
  'likely_improve',
  'likely_worsen',
  'likely_up',
  'likely_down',
  'uncertain',
  'uncertain_or_slightly_up',
  'uncertain_or_slightly_down',
  'neutral',
] as const;

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
  externalAiInstructions: Record<string, unknown>;
  candidatePreScreeningPolicy: Record<string, unknown>;
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
    directCandidateSetForbiddenOnFirstTurn: true,
    firstResponseMustAskQuestion: true,
    finalJsonRequiresExplicitCommand: 'GENERAR_JSON_MIDAS',
    firstResponseTemplate: 'Recibí el Optimization Pack de MIDAS. No generaré escenarios ni JSON todavía. Primero definamos objetivos y restricciones. ¿Qué quieres priorizar: mejorar calidad de vida, aumentar gasto sostenible, reducir estrés de liquidez, reducir estrés temprano, evitar subuso patrimonial u otro objetivo?',
    flow: [
      'Recibe el Optimization Pack completo antes de proponer cambios.',
      'Primera respuesta obligatoria: no JSON, no candidates, solo entrevista guiada.',
      'Pregunta por objetivos y restricciones usando solo variables permitidas.',
      'Después de cada objetivo o restricción, pregunta: ¿Quieres seguir agregando objetivos/restricciones o terminaste? Responde seguir o terminé.',
      'Si el usuario responde seguir, continúa capturando objetivos o restricciones.',
      'Si el usuario responde terminé, no generes JSON todavía: primero haz preselección heurística.',
      'Luego pregunta: Tengo una preselección de candidatos. ¿Quieres depurar antes de generar el JSON final?',
      'Solo cuando el usuario escriba exactamente GENERAR_JSON_MIDAS, devuelve exclusivamente el JSON final midas_candidate_set.',
    ],
    rules: {
      askToContinueAfterEachConstraint: true,
      finalOutputType: 'midas_candidate_set',
      directCandidateSetForbiddenOnFirstTurn: true,
      firstResponseMustAskQuestion: true,
      finalJsonRequiresExplicitCommand: 'GENERAR_JSON_MIDAS',
      allowQualitativeHypotheses: true,
      doNotClaimFinalMetrics: true,
      finalEvaluationMustBeRunByMidasM8: true,
    },
  };
}

function buildExternalAiInstructions() {
  return {
    context: 'El usuario copiará este pack en una IA externa para conversación guiada y pre-screening heurístico.',
    interactionRules: [
      'Primera respuesta obligatoria: no JSON, no candidates, solo entrevista guiada.',
      'NO generes JSON ni candidatos en la primera respuesta.',
      'No emitas midas_candidate_set hasta que el usuario escriba exactamente GENERAR_JSON_MIDAS.',
      'candidateSetSchema es solo el formato final, no una instrucción para generarlo ahora.',
      'Aunque tengas baseline, goals y schema, debes entrevistar primero al usuario.',
      'No generes 6, 12, 15 ni ningún número de escenarios en la primera respuesta.',
      'Guía la conversación usando solo variables permitidas.',
      'La política de venta de casa está definida por el motor. No propongas vender/no vender casa como decisión independiente.',
      'Si necesitas hablar de casa, evalúa las métricas de venta de casa que devuelve M8 o usa solo supuestos explícitamente editables por contrato.',
      'Después de cada objetivo o restricción, pregunta: ¿Quieres seguir agregando objetivos/restricciones o terminaste? Responde seguir o terminé.',
      'Cuando el usuario diga terminé, NO generes JSON inmediatamente.',
      'Primero genera candidatos internamente, aplica heurística o proxy scoring, agrupa por familias y descarta candidatos redundantes o débiles.',
      `Propón una preselección de ${TARGET_CANDIDATES_PER_SET}-${MAX_CANDIDATES_PER_SET} candidatos como máximo.`,
      'Luego pregunta: Tengo una preselección de candidatos. ¿Quieres depurar antes de generar el JSON final?',
      'Si el usuario responde sí, muestra familias o candidatos y permite eliminar antes del JSON final.',
      'Si responde no, genera el JSON final.',
      'Cuando el usuario escriba exactamente GENERAR_JSON_MIDAS, devuelve exclusivamente midas_candidate_set.',
      'constraints debe salir como objeto JSON en la raíz. No uses un arreglo raíz para constraints.',
      'Si necesitas listar restricciones, usa un objeto por id o un contenedor tipo constraints.items.',
      'Si emites preM8Score, agrega siempre esta advertencia textual al inicio de preM8ScoreExplanation: "Score pre-M8 heurístico/no oficial; M8 es la fuente oficial de evaluación."',
      'customGoals debe salir siempre como arreglo de textos. Si no hay objetivos personalizados, usa [].',
      'No asumas maximizar éxito como objetivo por defecto.',
      'Si el usuario prioriza desacumulación o calidad de vida, trata success como guardrail mínimo a consultar, no como objetivo automático.',
      'Pregunta piso mínimo de éxito aceptable cuando corresponda, por ejemplo 85%, 88%, 90% u otro.',
    ],
    aiCanDo: [
      'Calcular scores heurísticos o proxy.',
      'Priorizar y agrupar candidatos.',
      'Pedir confirmación o depuración antes del JSON final.',
      'Descartar candidatos débiles antes de emitir el Candidate Set.',
    ],
    aiCannotDo: [
      'Presentar métricas oficiales M8.',
      'Afirmar éxito, ruina, QoL u otros resultados finales como cálculo oficial.',
      'Entregar recomendación final sin evaluación M8 oficial.',
    ],
  };
}

function buildCandidatePreScreeningPolicy() {
  return {
    mode: 'ai_proxy_prescreening',
    internalCandidateGeneration: true,
    allowHeuristicCalculations: true,
    allowProxyScores: true,
    proxyScoresAreNotM8Results: true,
    targetCandidateCount: TARGET_CANDIDATES_PER_SET,
    maxCandidateCount: MAX_CANDIDATES_PER_SET,
    requirePreJsonReviewPrompt: true,
    reviewPrompt: 'Tengo una preselección de candidatos. ¿Quieres depurar antes de generar el JSON final?',
    allowedReviewAnswers: ['sí', 'no'],
    ifReviewYes: 'Show grouped candidate families and let the user remove candidates or families before final JSON.',
    ifReviewNo: 'Generate the final midas_candidate_set JSON.',
    forbiddenClaims: [
      'official_success40',
      'official_ruin40',
      'official_qol_score',
      'official_house_sale_pct',
      'official_terminal_wealth',
      'final_recommendation_without_m8',
    ],
  };
}

function buildCandidateSetSchema() {
  return {
    type: 'midas_candidate_set',
    version: '1.0',
    required: ['type', 'version', 'packFingerprint', 'selectedGoals', 'customGoals', 'constraints', 'candidates'],
    optionalRootFields: ['generationSummary', 'discardedIdeas'],
    allowedVariables: OPTIMIZATION_ALLOWED_VARIABLES,
    forbiddenVariables: OPTIMIZATION_FORBIDDEN_VARIABLES,
    engineInvariants: SCENARIO_LAB_ENGINE_INVARIANTS,
    readonlyMetrics: SCENARIO_LAB_ENGINE_READONLY_METRICS,
    forbiddenFinalMetrics: CANDIDATE_FORBIDDEN_FINAL_METRICS,
    maxCandidates: MAX_CANDIDATES_PER_SET,
    targetCandidates: TARGET_CANDIDATES_PER_SET,
    heuristicFields: {
      candidateFamily: 'string',
      heuristicPriority: HEURISTIC_PRIORITY_VALUES,
      preM8Score: 'number(0..100)',
      preM8ScoreExplanation: 'required when preM8Score exists; must explicitly say it is heuristic/non-official and that M8 is the official source',
      preM8ScoreExplanationPrefix: 'Score pre-M8 heurístico/no oficial; M8 es la fuente oficial de evaluación.',
      expectedDirectionalEffects: {
        qualityOfLife: DIRECTIONAL_EFFECT_VALUES,
        success40: DIRECTIONAL_EFFECT_VALUES,
        houseSalePct: DIRECTIONAL_EFFECT_VALUES,
        terminalWealth: DIRECTIONAL_EFFECT_VALUES,
      },
      proxyScoresAreNotM8Results: true,
    },
    constraintsShape: {
      rootType: 'object',
      legacyArrayRootForbidden: true,
      preferredForms: [
        'Record<string, unknown>',
        '{ items: Array<Record<string, unknown>> }',
      ],
    },
    candidateShape: {
      required: ['candidateId', 'changes'],
      optional: [
        'label',
        'hypothesis',
        'riskNotes',
        'candidateFamily',
        'heuristicPriority',
        'preM8Score',
        'preM8ScoreExplanation',
        'expectedDirectionalEffects',
      ],
      changes: 'Record<allowedVariable, unknown>',
    },
    customGoalsShape: {
      rootType: 'array',
      itemType: 'string',
      emptyWhenNoCustomGoals: true,
      forbiddenForms: ['string', 'object'],
    },
    postM8GuidanceTodo: 'Después de evaluar con M8, comparar candidatos por trade-off: éxito, QoL, terminalWealthRatio, houseSalePct.',
  };
}

function buildEngineGuidance() {
  return {
    summary: [
      'La política de venta de casa está definida por el motor y no se modela como decisión libre vender/no vender.',
      'El horizonte cambia la duración total del plan y la exposición acumulada al riesgo.',
      'El gasto por fases cambia presión de liquidez, recortes y probabilidad de venta de casa.',
      'Bucket y liquidez afectan resiliencia temprana frente a secuencia de retornos.',
      'Mix, retornos y volatilidad cambian riesgo, holgura y subuso patrimonial.',
      'Las reglas de recorte alteran calidad de vida y supervivencia del plan.',
      'La venta de casa funciona como soporte de liquidez, no como señal única de fracaso.',
      'La secuencia de retornos importa especialmente en los primeros años.',
      'QoL y patrimonio terminal deben leerse juntos para evitar subuso o fragilidad.',
    ],
    invariants: SCENARIO_LAB_ENGINE_INVARIANTS,
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
    externalAiInstructions: buildExternalAiInstructions(),
    candidatePreScreeningPolicy: buildCandidatePreScreeningPolicy(),
    candidateSetSchema: buildCandidateSetSchema(),
    engineGuidance: buildEngineGuidance(),
  };
}
