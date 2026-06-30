import assert from 'node:assert/strict';
import { validateCandidateSet } from './candidateSet';

const expectedPackFingerprint = 'fnv1a-959dded4';

const validCandidateSet = {
  type: 'midas_candidate_set',
  version: '1.0',
  packFingerprint: expectedPackFingerprint,
  selectedGoals: ['improve_quality_of_life'],
  customGoals: ['bajar estrés sin reducir gasto F1'],
  constraints: {
    minSuccess40: 0.9,
    maxHouseSalePct: 0.25,
    doNotReduceF1Spending: true,
  },
  candidates: [
    {
      candidateId: 'qol_001',
      label: 'Suavizar recortes',
      changes: {
        cutRules: {
          cut1: 0.92,
          cut2: 0.84,
        },
        bucketMonths: 30,
      },
      hypothesis: 'Podría mejorar calidad de vida reduciendo profundidad de recortes.',
      riskNotes: ['Puede aumentar consumo terminal.'],
    },
  ],
};

const validResult = validateCandidateSet(validCandidateSet, { expectedPackFingerprint });
assert.equal(validResult.ok, true);

const wrongFingerprint = validateCandidateSet({
  ...validCandidateSet,
  packFingerprint: 'fnv1a-deadbeef',
}, { expectedPackFingerprint });
assert.equal(wrongFingerprint.ok, false);

const forbiddenVariables = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      changes: {
        realAurumSnapshot: { total: 1 },
      },
    },
  ],
}, { expectedPackFingerprint });
assert.equal(forbiddenVariables.ok, false);

const inventedMetrics = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      ranking: 1,
      success40: 0.97,
    },
  ],
}, { expectedPackFingerprint });
assert.equal(inventedMetrics.ok, false);

const tooManyCandidates = validateCandidateSet({
  ...validCandidateSet,
  candidates: Array.from({ length: 51 }, (_, index) => ({
    candidateId: `cand_${index}`,
    changes: { nSim: 1000 + index },
  })),
}, { expectedPackFingerprint });
assert.equal(tooManyCandidates.ok, false);

const customGoalsAccepted = validateCandidateSet({
  ...validCandidateSet,
  selectedGoals: ['custom'],
  customGoals: ['objetivo libre'],
}, { expectedPackFingerprint });
assert.equal(customGoalsAccepted.ok, true);

console.log('candidateSet tests passed');
