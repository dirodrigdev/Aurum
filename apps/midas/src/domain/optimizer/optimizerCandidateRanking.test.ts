import assert from 'node:assert/strict';
import type { OptimizerEvaluationCandidate } from './optimizerCandidateRanking';
import { rankOptimizerCandidates } from './optimizerCandidateRanking';

function makeCandidate(overrides: Partial<OptimizerEvaluationCandidate>): OptimizerEvaluationCandidate {
  return {
    id: 'candidate',
    isComparable: true,
    evaluationScore: 80,
    qasrStrict: 0.85,
    csr85_4: 0.8,
    classicSuccessRate: 0.9,
    qualitySurvivalRate: 0.8,
    monthsBelow85: 6,
    maxConsecutiveMonthsBelow85: 3,
    earlyStressMonths: 1,
    terminalWealthRatio: 0.5,
    houseSaleRate: 0.2,
    warnings: [],
    midasEvaluation: {
      label: 'Bueno alto',
      rawScore: 82,
      cappedScore: 80,
      capsApplied: [],
      alerts: [],
      warnings: [],
      isComparable: true,
    },
    ...overrides,
  };
}

{
  const comparable = makeCandidate({ id: 'ok' });
  const notComparable = makeCandidate({
    id: 'bad',
    isComparable: false,
    evaluationScore: null,
    midasEvaluation: {
      label: 'No comparable',
      rawScore: null,
      cappedScore: null,
      capsApplied: [],
      alerts: ['Sin comparabilidad'],
      warnings: ['quality_of_life_metrics_missing'],
      isComparable: false,
    },
  });
  const ranked = rankOptimizerCandidates([notComparable, comparable]);
  assert.equal(ranked.recommendedCandidateId, 'ok');
  assert.equal(ranked.ranked[1]?.candidateId, 'bad');
}

{
  const highNoRuinLowQoL = makeCandidate({
    id: 'high-no-ruin',
    classicSuccessRate: 0.95,
    qualitySurvivalRate: 0.45,
    monthsBelow85: 20,
    maxConsecutiveMonthsBelow85: 8,
    earlyStressMonths: 5,
    evaluationScore: 58,
    midasEvaluation: {
      label: 'Exigido',
      rawScore: 66,
      cappedScore: 58,
      capsApplied: ['qualitySurvivalRate exigido'],
      alerts: [],
      warnings: [],
      isComparable: true,
    },
  });
  const lowerNoRuinBetterQoL = makeCandidate({
    id: 'better-qol',
    classicSuccessRate: 0.9,
    qualitySurvivalRate: 0.82,
    monthsBelow85: 4,
    maxConsecutiveMonthsBelow85: 2,
    earlyStressMonths: 1,
    evaluationScore: 84,
    midasEvaluation: {
      label: 'Bueno alto',
      rawScore: 84,
      cappedScore: 84,
      capsApplied: [],
      alerts: [],
      warnings: [],
      isComparable: true,
    },
  });
  const ranked = rankOptimizerCandidates([highNoRuinLowQoL, lowerNoRuinBetterQoL]);
  assert.equal(ranked.recommendedCandidateId, 'better-qol');
}

{
  const highNoRuinWeakQuality = makeCandidate({
    id: 'weak-quality',
    classicSuccessRate: 0.96,
    qualitySurvivalRate: 0.4,
    evaluationScore: 55,
    midasEvaluation: {
      label: 'Exigido',
      rawScore: 60,
      cappedScore: 55,
      capsApplied: ['qualitySurvivalRate exigido'],
      alerts: [],
      warnings: [],
      isComparable: true,
    },
  });
  const balanced = makeCandidate({ id: 'balanced', evaluationScore: 78, qualitySurvivalRate: 0.75 });
  const ranked = rankOptimizerCandidates([highNoRuinWeakQuality, balanced]);
  assert.equal(ranked.recommendedCandidateId, 'balanced');
}

{
  const stressedHighTerminal = makeCandidate({
    id: 'stressed-terminal',
    evaluationScore: 80,
    monthsBelow85: 10,
    maxConsecutiveMonthsBelow85: 4,
    terminalWealthRatio: 1.1,
    midasEvaluation: {
      label: 'Exigido',
      rawScore: 84,
      cappedScore: 80,
      capsApplied: ['terminal wealth alto pese a recortes'],
      alerts: ['Patrimonio terminal >100% del capital inicial pese a recortes.'],
      warnings: [],
      isComparable: true,
    },
  });
  const cleaner = makeCandidate({
    id: 'cleaner',
    evaluationScore: 80,
    monthsBelow85: 10,
    maxConsecutiveMonthsBelow85: 4,
    terminalWealthRatio: 0.4,
  });
  const ranked = rankOptimizerCandidates([stressedHighTerminal, cleaner]);
  assert.equal(ranked.recommendedCandidateId, 'cleaner');
  assert.ok(ranked.ranked.find((row) => row.candidateId === 'stressed-terminal')?.primaryAlerts.length);
}

{
  const lowHouseSale = makeCandidate({ id: 'low-house', houseSaleRate: 0.05 });
  const highHouseSale = makeCandidate({ id: 'high-house', houseSaleRate: 0.95 });
  const ranked = rankOptimizerCandidates([highHouseSale, lowHouseSale]);
  assert.equal(ranked.ranked[0]?.candidateId, 'high-house');
}

{
  const higherStress = makeCandidate({
    id: 'higher-stress',
    evaluationScore: 78,
    monthsBelow85: 8,
    maxConsecutiveMonthsBelow85: 4,
    earlyStressMonths: 3,
  });
  const lowerStress = makeCandidate({
    id: 'lower-stress',
    evaluationScore: 78,
    monthsBelow85: 8,
    maxConsecutiveMonthsBelow85: 3,
    earlyStressMonths: 1,
  });
  const ranked = rankOptimizerCandidates([higherStress, lowerStress]);
  assert.equal(ranked.recommendedCandidateId, 'lower-stress');
}

{
  const missingData = makeCandidate({
    id: 'missing-data',
    warnings: ['candidate_not_rankable_by_quality'],
    monthsBelow85: null,
    maxConsecutiveMonthsBelow85: null,
    earlyStressMonths: null,
  });
  const clean = makeCandidate({ id: 'clean' });
  const ranked = rankOptimizerCandidates([missingData, clean]);
  assert.equal(ranked.recommendedCandidateId, 'clean');
  assert.ok(ranked.ranked.find((row) => row.candidateId === 'missing-data')?.warningCount);
}

console.log('optimizerCandidateRanking tests passed');
