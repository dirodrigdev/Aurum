import assert from 'node:assert/strict';
import { PRE_M8_SCORE_EXPLANATION_PREFIX, validateCandidateSet } from './candidateSet';

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
        futureCapitalEvents: [
          {
            id: 'bonus-2030',
            type: 'inflow',
            amount: 200000000,
            currency: 'CLP',
            effectiveMonth: 24,
          },
        ],
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
assert.equal(missingProxyExplanation.ok, true);
if (missingProxyExplanation.ok) {
  assert.equal(
    missingProxyExplanation.value.candidates[0]?.preM8ScoreExplanation,
    PRE_M8_SCORE_EXPLANATION_PREFIX,
  );
}

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

const blockedHouseChange = validateCandidateSet({
  ...validCandidateSet,
  candidates: [
    {
      ...validCandidateSet.candidates[0],
      changes: {
        houseSaleTrigger: {
          yearsOfSpend: 2.5,
        },
      },
    },
  ],
}, { expectedPackFingerprint });
assert.equal(blockedHouseChange.ok, false);

const legacyGeneratedCandidateSet = {
  type: 'midas_candidate_set',
  version: '1.0',
  packFingerprint: expectedPackFingerprint,
  selectedGoals: ['improve_quality_of_life', 'increase_sustainable_spending', 'avoid_underuse'],
  customGoals: [
    'F2/F3 con mejor calidad de vida',
    'F1 sin recorte preventivo innecesario',
    'F4 sin sobre-acumular patrimonio terminal',
  ],
  constraints: [
    { id: 'preserve_f1', label: 'Preservar F1', mode: 'hard', rule: 'no bajar F1' },
    { id: 'prioritize_f2_f3', label: 'Priorizar F2/F3', mode: 'soft', rule: 'mejorar F2/F3' },
    { id: 'avoid_final_metric_claims', label: 'Sin claims finales', mode: 'hard', rule: 'no inventar métricas M8' },
  ],
  candidates: [
    {
      candidateId: 'C04',
      preM8Score: 72,
      preM8ScoreExplanation: 'Primer candidato limpio para medir si el baseline está subutilizando patrimonio.',
      changes: {
        spendingPhases: {
          phase2MonthlyClp: 6_400_000,
          F3: 4_200_000,
        },
      },
    },
    {
      candidateId: 'C05',
      preM8Score: 70,
      preM8ScoreExplanation: '',
      changes: {
        cutRules: {
          cut1: 0.93,
        },
      },
    },
    {
      candidateId: 'C07',
      preM8Score: 77,
      changes: {
        bucketMonths: 30,
        futureCapitalEvents: [
          { id: 'bonus-2039', type: 'inflow', amount: 200000000, currency: 'CLP', effectiveMonth: 156 },
        ],
      },
    },
    {
      candidateId: 'C08',
      preM8Score: 74,
      preM8ScoreExplanation: 'Proxy inicial para aliviar estrés de secuencia.',
      changes: {
        spendingPhases: {
          phase1MonthlyClp: 5_900_000,
        },
        cutRules: {
          cut2: 0.86,
        },
      },
    },
    {
      candidateId: 'C11',
      preM8Score: 68,
      preM8ScoreExplanation: 'Explora subir F2 manteniendo control de recortes.',
      changes: {
        spendingPhases: {
          phase2MonthlyClp: 6_300_000,
        },
      },
    },
    {
      candidateId: 'C13',
      preM8Score: 75,
      preM8ScoreExplanation: 'Evalúa liberar consumo sin tocar variables estructurales.',
      changes: {
        cutRules: {
          cut1: 0.94,
          cut2: 0.87,
        },
      },
    },
  ],
};

const legacyRoundtripResult = validateCandidateSet(JSON.stringify(legacyGeneratedCandidateSet), { expectedPackFingerprint });
assert.equal(legacyRoundtripResult.ok, true);
if (legacyRoundtripResult.ok) {
  assert.equal(Array.isArray(legacyRoundtripResult.value.constraints), false);
  assert.deepEqual(Object.keys(legacyRoundtripResult.value.constraints).sort(), [
    'avoid_final_metric_claims',
    'preserve_f1',
    'prioritize_f2_f3',
  ]);
  assert.equal(
    legacyRoundtripResult.value.candidates.every((candidate) => candidate.preM8ScoreExplanation?.includes(PRE_M8_SCORE_EXPLANATION_PREFIX) ?? false),
    true,
  );
  const c04 = legacyRoundtripResult.value.candidates.find((candidate) => candidate.candidateId === 'C04');
  assert.equal(c04?.changes.spendingPhases && typeof c04.changes.spendingPhases === 'object', true);
  assert.equal((c04?.changes.spendingPhases as { phase2MonthlyClp?: number }).phase2MonthlyClp, 6_400_000);
  const c05 = legacyRoundtripResult.value.candidates.find((candidate) => candidate.candidateId === 'C05');
  assert.equal(c05?.changes.cutRules && typeof c05.changes.cutRules === 'object', true);
  assert.equal((c05?.changes.cutRules as { cut1?: number }).cut1, 0.93);
}

const blockedFieldStillRejected = validateCandidateSet({
  ...legacyGeneratedCandidateSet,
  constraints: {
    preserve_f1: { mode: 'hard' },
  },
  candidates: [
    ...legacyGeneratedCandidateSet.candidates,
    {
      candidateId: 'blocked_field',
      preM8Score: 60,
      preM8ScoreExplanation: 'Intento inválido de tocar capital base.',
      changes: {
        capitalInitial: 123,
      },
    },
  ],
}, { expectedPackFingerprint });
assert.equal(blockedFieldStillRejected.ok, false);

console.log('candidateSet tests passed');
