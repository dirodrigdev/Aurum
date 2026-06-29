import assert from 'node:assert/strict';
import type { RankedOptimizerCandidate } from './optimizerCandidateRanking';
import type { RvRfDecisionCandidate } from './rvRfDecisionProfiles';
import { buildOptimizerDecisionBrief } from './optimizerDecisionBrief';

function makeCandidate(overrides: Partial<RvRfDecisionCandidate> = {}): RvRfDecisionCandidate {
  return {
    candidateId: 'rv_60_rf_40',
    mixLabel: 'RV 60 / RF 40',
    rvPct: 60,
    rfPct: 40,
    rvReal: 0.6,
    rfReal: 0.4,
    qasrBase: 0.91,
    qasrAt120: 0.88,
    qasrAt130: 0.85,
    csrBase: 0.82,
    ruinRate: 0.07,
    monthsInSevereCutMean: 16,
    maxConsecutiveSevereCutMonthsP75: 5,
    terminalWealthP25: 1_000,
    terminalWealthP50: 3_000,
    houseSaleRate: 0,
    severeCutDuringSaleMonths: 0,
    recSevPctBase: 16 / 480,
    qualitySurvivalRate: 0.81,
    monthsBelow85: 8,
    maxConsecutiveMonthsBelow85: 4,
    earlyStressMonths: 1,
    terminalWealthRatio: 0.48,
    midasEvaluationLabel: 'Bueno alto',
    midasEvaluationScore: 82,
    midasEvaluationComparable: true,
    midasEvaluationCapsApplied: [],
    midasEvaluationAlerts: [],
    ...overrides,
  };
}

function makeRanked(overrides: Partial<RankedOptimizerCandidate> = {}): RankedOptimizerCandidate {
  return {
    rank: 1,
    candidateId: 'rv_60_rf_40',
    label: 'Bueno alto',
    score: 82,
    isComparable: true,
    rankingReason: 'Gana por mejor calidad de vida agregada y estrés contenido.',
    primaryAlerts: [],
    capsApplied: [],
    tradeoffs: ['qualitySurvivalRate limitado'],
    warningCount: 0,
    ...overrides,
  };
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate(),
    rankedCandidates: [makeRanked()],
    baselineCandidate: makeCandidate({ candidateId: 'rv_50_rf_50', mixLabel: 'RV 50 / RF 50', qasrBase: 0.89 }),
    inputFingerprint: 'abc',
    traceFingerprint: 'abc',
    recommendationKind: 'official',
  });
  assert.match(brief.headline, /Mejor balance dentro de los candidatos evaluados/i);
  assert.ok(brief.whyThisWins.some((item) => /calidad de vida/i.test(item)));
  assert.ok(brief.keyTradeoffs.length > 0);
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate({ midasEvaluationAlerts: ['Patrimonio terminal >100% del capital inicial pese a recortes.'], terminalWealthRatio: 1.1, monthsBelow85: 10 }),
    rankedCandidates: [makeRanked({ primaryAlerts: ['Patrimonio terminal >100% del capital inicial pese a recortes.'] })],
    inputFingerprint: 'abc',
    traceFingerprint: 'abc',
    recommendationKind: 'official',
  });
  assert.ok(brief.riskWarnings.some((item) => /Patrimonio terminal/i.test(item)));
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate({ midasEvaluationComparable: false, midasEvaluationLabel: 'No comparable', midasEvaluationScore: null }),
    rankedCandidates: [makeRanked({ isComparable: false, label: 'No comparable', score: null })],
    inputFingerprint: 'abc',
    traceFingerprint: 'abc',
    recommendationKind: 'official',
  });
  assert.equal(brief.headline, 'Sin recomendación comparable');
  assert.equal(brief.recommendationLevel, 'not_comparable');
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate(),
    rankedCandidates: [makeRanked()],
    inputFingerprint: 'abc',
    traceFingerprint: 'abc',
    recommendationKind: 'official',
  });
  assert.equal(brief.baselineComparison, null);
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate(),
    rankedCandidates: [makeRanked()],
    recommendationKind: 'official',
  });
  assert.equal(brief.auditability.status, 'weak');
  assert.notEqual(brief.recommendationLevel, 'strong');
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate({ terminalWealthRatio: 1.1, monthsBelow85: 12 }),
    rankedCandidates: [makeRanked({ primaryAlerts: ['Patrimonio terminal >100% del capital inicial pese a recortes.'] })],
    inputFingerprint: 'abc',
    traceFingerprint: 'abc',
    recommendationKind: 'official',
  });
  assert.ok(brief.riskWarnings.some((item) => /subuso/i.test(item)));
}

{
  const brief = buildOptimizerDecisionBrief({
    recommendedCandidate: makeCandidate({ houseSaleRate: 0.2, severeCutDuringSaleMonths: 2 }),
    rankedCandidates: [makeRanked()],
    inputFingerprint: 'abc',
    traceFingerprint: 'abc',
    recommendationKind: 'official',
  });
  assert.ok(brief.qualityOfLifeSummary.some((item) => /liquidez, no como fracaso automático/i.test(item)));
}

console.log('optimizerDecisionBrief tests passed');
