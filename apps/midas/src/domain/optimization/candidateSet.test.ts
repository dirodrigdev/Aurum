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
  generationSummary: {
    approach: 'ai_proxy_prescreening',
    internalCandidatesConsidered: 40,
    candidateCountBeforeUserReview: 15,
    candidateCountAfterUserReview: 10,
    screeningCriteria: ['liquidez', 'redundancia'],
    userReviewedBeforeJson: true,
    notes: ['Proxy heurístico, no resultado oficial.'],
  },
  discardedIdeas: ['subir riesgo extremo'],
  candidates: [
    {
      candidateId: 'qol_001',
      label: 'Suavizar recortes',
      candidateFamily: 'qol_liquidity',
      heuristicPriority: 'high',
      preM8Score: 82,
      preM8ScoreExplanation: 'Proxy heurístico, no resultado oficial.',
      expectedDirectionalEffects: {
        qualityOfLife: 'likely_improve',
        success40: 'uncertain_or_slightly_down',
        houseSalePct: 'likely_up',
        terminalWealth: 'likely_down',
      },
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

const missingProxyExplanation = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      preM8ScoreExplanation: undefined,
    },
  ],
}, { expectedPackFingerprint });
assert.equal(missingProxyExplanation.ok, false);

const invalidProxyRange = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      preM8Score: 120,
    },
  ],
}, { expectedPackFingerprint });
assert.equal(invalidProxyRange.ok, false);

const estimatedMetricsRejected = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      estimatedSuccess: 0.91,
    },
  ],
}, { expectedPackFingerprint });
assert.equal(estimatedMetricsRejected.ok, false);

const m8MetricRejected = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      m8Success40: 0.91,
    },
  ],
}, { expectedPackFingerprint });
assert.equal(m8MetricRejected.ok, false);

const tooManyCandidates = validateCandidateSet({
  ...validCandidateSet,
  candidates: Array.from({ length: 16 }, (_, index) => ({
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
