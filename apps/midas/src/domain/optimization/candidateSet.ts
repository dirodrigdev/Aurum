import {
  CANDIDATE_FORBIDDEN_FINAL_METRICS,
  DIRECTIONAL_EFFECT_VALUES,
  HEURISTIC_PRIORITY_VALUES,
  MAX_CANDIDATES_PER_SET,
  OPTIMIZATION_ALLOWED_VARIABLES,
  OPTIMIZATION_MENU,
  OPTIMIZATION_FORBIDDEN_VARIABLES,
  type AllowedOptimizationVariable,
  type OptimizationGoalId,
} from './optimizationPack';
import { getScenarioLabBlockedVariableReason } from './scenarioLabEngineContract';

export const CANDIDATE_SET_TYPE = 'midas_candidate_set';
export const CANDIDATE_SET_VERSION = '1.0';
export const PRE_M8_SCORE_EXPLANATION_PREFIX = 'Score pre-M8 heurístico/no oficial; M8 es la fuente oficial de evaluación.';

export type MidasCandidate = {
  candidateId: string;
  label?: string;
  changes: Partial<Record<AllowedOptimizationVariable, unknown>>;
  hypothesis?: string;
  riskNotes?: string[];
  candidateFamily?: string;
  heuristicPriority?: (typeof HEURISTIC_PRIORITY_VALUES)[number];
  preM8Score?: number;
  preM8ScoreExplanation?: string;
  expectedDirectionalEffects?: Partial<Record<'qualityOfLife' | 'success40' | 'houseSalePct' | 'terminalWealth', (typeof DIRECTIONAL_EFFECT_VALUES)[number]>>;
};

export type MidasCandidateSet = {
  type: typeof CANDIDATE_SET_TYPE;
  version: typeof CANDIDATE_SET_VERSION;
  packFingerprint: string;
  selectedGoals: OptimizationGoalId[];
  customGoals: string[];
  constraints: Record<string, unknown>;
  generationSummary?: {
    approach?: string;
    internalCandidatesConsidered?: number;
    candidateCountBeforeUserReview?: number;
    candidateCountAfterUserReview?: number;
    screeningCriteria?: string[];
    userReviewedBeforeJson?: boolean;
    notes?: string[];
  };
  discardedIdeas?: Array<Record<string, unknown> | string>;
  candidates: MidasCandidate[];
};

export type CandidateSetValidationResult =
  | { ok: true; value: MidasCandidateSet }
  | { ok: false; errors: string[] };

const ALLOWED_GOALS = new Set<string>(OPTIMIZATION_MENU.map((goal) => goal.id));
const ALLOWED_CHANGE_KEYS = new Set<string>(OPTIMIZATION_ALLOWED_VARIABLES);
const HEURISTIC_PRIORITY_SET = new Set<string>(HEURISTIC_PRIORITY_VALUES);
const DIRECTIONAL_EFFECT_SET = new Set<string>(DIRECTIONAL_EFFECT_VALUES);
const REJECT_ESTIMATED_METRICS = new Set<string>(['estimatedSuccess', 'estimatedRuin', 'estimatedQol']);
const FORBIDDEN_KEYS = new Set<string>([
  ...OPTIMIZATION_FORBIDDEN_VARIABLES,
  ...CANDIDATE_FORBIDDEN_FINAL_METRICS,
  ...REJECT_ESTIMATED_METRICS,
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function ensurePreM8ScoreExplanation(value: unknown): string | undefined {
  if (typeof value !== 'string') return PRE_M8_SCORE_EXPLANATION_PREFIX;
  const trimmed = value.trim();
  if (trimmed.length === 0) return PRE_M8_SCORE_EXPLANATION_PREFIX;
  const normalized = trimmed.toLowerCase();
  const hasOfficialDisclosure = normalized.includes('heur') && normalized.includes('m8') && normalized.includes('oficial');
  if (hasOfficialDisclosure) return trimmed;
  return `${PRE_M8_SCORE_EXPLANATION_PREFIX} ${trimmed}`;
}

function normalizeLegacyConstraints(constraints: unknown): unknown {
  if (!Array.isArray(constraints)) return constraints;
  const keyedEntries: Array<[string, Record<string, unknown>]> = [];
  for (const entry of constraints) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      return { items: constraints };
    }
    keyedEntries.push([entry.id, { ...entry }]);
  }
  return Object.fromEntries(keyedEntries);
}

function normalizeCandidate(candidate: unknown): unknown {
  if (!isRecord(candidate)) return candidate;
  if (typeof candidate.preM8Score === 'undefined') return candidate;
  return {
    ...candidate,
    preM8ScoreExplanation: ensurePreM8ScoreExplanation(candidate.preM8ScoreExplanation),
  };
}

function normalizeCandidateSetPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    constraints: normalizeLegacyConstraints(payload.constraints),
    candidates: Array.isArray(payload.candidates) ? payload.candidates.map((candidate) => normalizeCandidate(candidate)) : payload.candidates,
  };
}

function findForbiddenKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenKeys(entry, [...path, String(index)]));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const currentPath = [...path, key];
    const isDirectionalEffectField =
      path[path.length - 1] === 'expectedDirectionalEffects'
      && ['qualityOfLife', 'success40', 'houseSalePct', 'terminalWealth'].includes(key);
    const matches = !isDirectionalEffectField && FORBIDDEN_KEYS.has(key) ? [currentPath.join('.')] : [];
    return [...matches, ...findForbiddenKeys(entry, currentPath)];
  });
}

function validateCandidate(candidate: unknown, index: number): string[] {
  if (!isRecord(candidate)) return [`candidates[${index}] debe ser un objeto.`];
  const errors: string[] = [];
  if (typeof candidate.candidateId !== 'string' || candidate.candidateId.trim().length === 0) {
    errors.push(`candidates[${index}].candidateId es obligatorio.`);
  }
  if (!isRecord(candidate.changes) || Object.keys(candidate.changes).length === 0) {
    errors.push(`candidates[${index}].changes debe incluir al menos una variable permitida.`);
  } else {
    for (const key of Object.keys(candidate.changes)) {
      if (!ALLOWED_CHANGE_KEYS.has(key)) {
        const blockedReason = getScenarioLabBlockedVariableReason(key);
        errors.push(
          blockedReason
            ? `candidates[${index}].changes.${key} está bloqueado por contrato. ${blockedReason}`
            : `candidates[${index}].changes.${key} no es una variable permitida.`,
        );
      }
    }
  }
  if (typeof candidate.label !== 'undefined' && typeof candidate.label !== 'string') {
    errors.push(`candidates[${index}].label debe ser texto si existe.`);
  }
  if (typeof candidate.hypothesis !== 'undefined' && typeof candidate.hypothesis !== 'string') {
    errors.push(`candidates[${index}].hypothesis debe ser texto si existe.`);
  }
  if (typeof candidate.riskNotes !== 'undefined') {
    if (!Array.isArray(candidate.riskNotes) || candidate.riskNotes.some((item) => typeof item !== 'string')) {
      errors.push(`candidates[${index}].riskNotes debe ser un arreglo de textos.`);
    }
  }
  if (typeof candidate.candidateFamily !== 'undefined' && typeof candidate.candidateFamily !== 'string') {
    errors.push(`candidates[${index}].candidateFamily debe ser texto si existe.`);
  }
  if (typeof candidate.heuristicPriority !== 'undefined' && !HEURISTIC_PRIORITY_SET.has(String(candidate.heuristicPriority))) {
    errors.push(`candidates[${index}].heuristicPriority debe ser high, medium o low.`);
  }
  if (typeof candidate.preM8Score !== 'undefined') {
    const score = Number(candidate.preM8Score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      errors.push(`candidates[${index}].preM8Score debe estar entre 0 y 100.`);
    }
    if (typeof candidate.preM8ScoreExplanation !== 'string' || candidate.preM8ScoreExplanation.trim().length === 0) {
      errors.push(`candidates[${index}].preM8Score requiere preM8ScoreExplanation.`);
    } else if (!candidate.preM8ScoreExplanation.toLowerCase().includes('heur')) {
      errors.push(`candidates[${index}].preM8ScoreExplanation debe dejar explícito que es heurístico o no oficial.`);
    }
  }
  if (typeof candidate.preM8ScoreExplanation !== 'undefined' && typeof candidate.preM8Score === 'undefined') {
    errors.push(`candidates[${index}].preM8ScoreExplanation no debe existir sin preM8Score.`);
  }
  if (typeof candidate.expectedDirectionalEffects !== 'undefined') {
    if (!isRecord(candidate.expectedDirectionalEffects)) {
      errors.push(`candidates[${index}].expectedDirectionalEffects debe ser un objeto.`);
    } else {
      for (const [key, value] of Object.entries(candidate.expectedDirectionalEffects)) {
        if (!['qualityOfLife', 'success40', 'houseSalePct', 'terminalWealth'].includes(key)) {
          errors.push(`candidates[${index}].expectedDirectionalEffects.${key} no es un campo permitido.`);
          continue;
        }
        if (!DIRECTIONAL_EFFECT_SET.has(String(value))) {
          errors.push(`candidates[${index}].expectedDirectionalEffects.${key} usa un enum no permitido.`);
        }
      }
    }
  }
  const forbiddenKeyPaths = findForbiddenKeys(candidate);
  if (forbiddenKeyPaths.length > 0) {
    errors.push(`candidates[${index}] contiene campos prohibidos: ${forbiddenKeyPaths.join(', ')}.`);
  }
  return errors;
}

export function validateCandidateSet(
  input: unknown,
  options: { expectedPackFingerprint: string },
): CandidateSetValidationResult {
  const parsedPayload = typeof input === 'string'
    ? (() => {
      try {
        return JSON.parse(input) as unknown;
      } catch {
        return null;
      }
    })()
    : input;

  if (!parsedPayload) return { ok: false, errors: ['JSON inválido: no se pudo parsear el Candidate Set.'] };
  if (!isRecord(parsedPayload)) return { ok: false, errors: ['Candidate Set inválido: la raíz debe ser un objeto.'] };
  const payload = normalizeCandidateSetPayload(parsedPayload);

  const errors: string[] = [];
  if (payload.type !== CANDIDATE_SET_TYPE) errors.push(`type debe ser ${CANDIDATE_SET_TYPE}.`);
  if (payload.version !== CANDIDATE_SET_VERSION) errors.push(`version debe ser ${CANDIDATE_SET_VERSION}.`);
  if (payload.packFingerprint !== options.expectedPackFingerprint) {
    errors.push('packFingerprint no coincide con el Optimization Pack actual.');
  }

  if (!Array.isArray(payload.selectedGoals) || payload.selectedGoals.some((goal) => typeof goal !== 'string')) {
    errors.push('selectedGoals debe ser un arreglo de objetivos.');
  } else if (payload.selectedGoals.some((goal) => !ALLOWED_GOALS.has(goal))) {
    errors.push('selectedGoals contiene objetivos fuera del menú permitido.');
  }

  if (!Array.isArray(payload.customGoals) || payload.customGoals.some((goal) => typeof goal !== 'string')) {
    errors.push('customGoals debe ser un arreglo de textos.');
  }

  if (!isRecord(payload.constraints)) {
    errors.push('constraints debe ser un objeto.');
  }
  if (typeof payload.generationSummary !== 'undefined') {
    if (!isRecord(payload.generationSummary)) {
      errors.push('generationSummary debe ser un objeto.');
    } else {
      if (typeof payload.generationSummary.approach !== 'undefined' && payload.generationSummary.approach !== 'ai_proxy_prescreening') {
        errors.push('generationSummary.approach debe ser ai_proxy_prescreening si existe.');
      }
      for (const numericField of ['internalCandidatesConsidered', 'candidateCountBeforeUserReview', 'candidateCountAfterUserReview']) {
        if (typeof payload.generationSummary[numericField] !== 'undefined' && !Number.isFinite(Number(payload.generationSummary[numericField]))) {
          errors.push(`generationSummary.${numericField} debe ser numérico.`);
        }
      }
      if (
        typeof payload.generationSummary.screeningCriteria !== 'undefined'
        && (!Array.isArray(payload.generationSummary.screeningCriteria) || payload.generationSummary.screeningCriteria.some((item) => typeof item !== 'string'))
      ) {
        errors.push('generationSummary.screeningCriteria debe ser un arreglo de textos.');
      }
      if (
        typeof payload.generationSummary.notes !== 'undefined'
        && (!Array.isArray(payload.generationSummary.notes) || payload.generationSummary.notes.some((item) => typeof item !== 'string'))
      ) {
        errors.push('generationSummary.notes debe ser un arreglo de textos.');
      }
      if (
        typeof payload.generationSummary.userReviewedBeforeJson !== 'undefined'
        && typeof payload.generationSummary.userReviewedBeforeJson !== 'boolean'
      ) {
        errors.push('generationSummary.userReviewedBeforeJson debe ser boolean si existe.');
      }
    }
  }
  if (typeof payload.discardedIdeas !== 'undefined') {
    if (!Array.isArray(payload.discardedIdeas)) {
      errors.push('discardedIdeas debe ser un arreglo si existe.');
    }
  }

  if (!Array.isArray(payload.candidates)) {
    errors.push('candidates debe ser un arreglo.');
  } else {
    if (payload.candidates.length > MAX_CANDIDATES_PER_SET) {
      errors.push(`candidates excede el máximo de ${MAX_CANDIDATES_PER_SET}.`);
    }
    payload.candidates.forEach((candidate, index) => {
      errors.push(...validateCandidate(candidate, index));
    });
  }

  const forbiddenRootKeys = findForbiddenKeys(payload.constraints);
  if (forbiddenRootKeys.length > 0) {
    errors.push(`constraints contiene campos prohibidos: ${forbiddenRootKeys.join(', ')}.`);
  }
  if (typeof payload.generationSummary !== 'undefined') {
    const forbiddenGenerationKeys = findForbiddenKeys(payload.generationSummary);
    if (forbiddenGenerationKeys.length > 0) {
      errors.push(`generationSummary contiene campos prohibidos: ${forbiddenGenerationKeys.join(', ')}.`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: payload as unknown as MidasCandidateSet };
}
