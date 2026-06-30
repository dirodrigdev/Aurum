import {
  CANDIDATE_FORBIDDEN_FINAL_METRICS,
  MAX_CANDIDATES_PER_SET,
  OPTIMIZATION_ALLOWED_VARIABLES,
  OPTIMIZATION_MENU,
  OPTIMIZATION_FORBIDDEN_VARIABLES,
  type AllowedOptimizationVariable,
  type OptimizationGoalId,
} from './optimizationPack';

export const CANDIDATE_SET_TYPE = 'midas_candidate_set';
export const CANDIDATE_SET_VERSION = '1.0';

export type MidasCandidate = {
  candidateId: string;
  label?: string;
  changes: Partial<Record<AllowedOptimizationVariable, unknown>>;
  hypothesis?: string;
  riskNotes?: string[];
};

export type MidasCandidateSet = {
  type: typeof CANDIDATE_SET_TYPE;
  version: typeof CANDIDATE_SET_VERSION;
  packFingerprint: string;
  selectedGoals: OptimizationGoalId[];
  customGoals: string[];
  constraints: Record<string, unknown>;
  candidates: MidasCandidate[];
};

export type CandidateSetValidationResult =
  | { ok: true; value: MidasCandidateSet }
  | { ok: false; errors: string[] };

const ALLOWED_GOALS = new Set<string>(OPTIMIZATION_MENU.map((goal) => goal.id));
const ALLOWED_CHANGE_KEYS = new Set<string>(OPTIMIZATION_ALLOWED_VARIABLES);
const FORBIDDEN_KEYS = new Set<string>([
  ...OPTIMIZATION_FORBIDDEN_VARIABLES,
  ...CANDIDATE_FORBIDDEN_FINAL_METRICS,
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function findForbiddenKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenKeys(entry, [...path, String(index)]));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const currentPath = [...path, key];
    const matches = FORBIDDEN_KEYS.has(key) ? [currentPath.join('.')] : [];
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
        errors.push(`candidates[${index}].changes.${key} no es una variable permitida.`);
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
  const payload = typeof input === 'string'
    ? (() => {
      try {
        return JSON.parse(input) as unknown;
      } catch {
        return null;
      }
    })()
    : input;

  if (!payload) return { ok: false, errors: ['JSON inválido: no se pudo parsear el Candidate Set.'] };
  if (!isRecord(payload)) return { ok: false, errors: ['Candidate Set inválido: la raíz debe ser un objeto.'] };

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

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: payload as unknown as MidasCandidateSet };
}
