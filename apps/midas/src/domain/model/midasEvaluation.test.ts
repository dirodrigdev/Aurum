import assert from 'node:assert/strict';
import type { QualityOfLifeMetricsV1 } from './types';
import { buildMidasEvaluation } from './midasEvaluation';

const makeMetrics = (overrides: Partial<QualityOfLifeMetricsV1> = {}): QualityOfLifeMetricsV1 => ({
  schemaVersion: 1,
  source: 'path_quality_diagnostics_v1',
  warnings: [],
  pathCount: 3000,
  horizonMonths: 360,
  horizonYears: 30,
  classicSuccessRate: 0.92,
  ruinRate: 0.08,
  ruinedPathCount: 240,
  csr85_4: 0.86,
  csrPassingPathCount: 2580,
  csrThresholds: {
    minAverageConsumptionRatio: 0.85,
    maxSevereCutMonths: 48,
  },
  qasrAlpha: 1.5,
  qasrStrict: 0.9,
  qualityScoreMean: 0.9,
  qualityScoreP25: 0.8,
  qualityScoreP50: 0.9,
  averageConsumptionRatioMean: 0.97,
  averageConsumptionRatioP25: 0.92,
  averageConsumptionRatioP50: 0.97,
  averageEffectiveSpendingRatio: 0.97,
  minMonthlyConsumptionRatioP10: 0.88,
  minMonthlyConsumptionRatioP25: 0.9,
  minAnnualConsumptionRatioP10: 0.9,
  minAnnualConsumptionRatioP25: 0.92,
  monthsBelow85: 4,
  maxConsecutiveMonthsBelow85: 2,
  monthsBelow90: 8,
  maxConsecutiveMonthsBelow90: 4,
  earlyStressMonths: 0,
  phaseStress: [
    { phaseIndex: 1, label: 'F1', startMonth: 1, endMonth: 48, monthsBelow85: 1, monthsBelow90: 2 },
    { phaseIndex: 2, label: 'F2', startMonth: 49, endMonth: 240, monthsBelow85: 3, monthsBelow90: 6 },
  ],
  qualitySurvivalRate: 0.9,
  qualitySurvivalPassingPathCount: 2700,
  qualitySurvivalThresholds: {
    minAverageConsumptionRatio: 0.9,
    maxConsecutiveMonthsBelow85: 6,
    maxTotalMonthsBelow85: 24,
  },
  monthsInCutMean: 10,
  monthsInCutP50: 8,
  monthsInSevereCutMean: 4,
  monthsInSevereCutP50: 3,
  maxConsecutiveSevereCutMonthsP50: 2,
  maxConsecutiveSevereCutMonthsP75: 4,
  severeCutYearsMean: 0.3,
  severeCutYearsP50: 0.2,
  houseSaleRate: 0.2,
  houseSoldPathCount: 600,
  houseSaleYearMedian: 18,
  houseSaleYearP10: 12,
  houseSaleYearP90: 24,
  houseSaleTriggerToSaleMonthsMedian: 4,
  houseSaleTriggerToSaleMonthsMean: 4.5,
  houseSaleTriggerToSaleMonthsP75: 6,
  severeCutMonthsDuringHouseSaleMean: 2,
  severeCutMonthsDuringHouseSaleMedian: 2,
  severeCutMonthsDuringHouseSaleP75: 4,
  monthsInCutBeforeHouseSaleMean: 6,
  monthsInSevereCutBeforeHouseSaleMean: 2,
  liquidWealthAfterHouseSaleP25: 100,
  liquidWealthAfterHouseSaleP50: 200,
  houseSaleIncidence: 0.2,
  terminalWealthP10: 100,
  terminalWealthP25: 200,
  terminalWealthP50: 500,
  terminalWealthP75: 900,
  terminalWealthRatio: 0.5,
  ...overrides,
});

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics(),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'Muy sólido');
  assert.equal(evaluation.isComparable, true);
  assert.ok((evaluation.cappedScore ?? 0) >= 88);
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({ earlyStressMonths: 2 }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'Bueno alto');
  assert.ok(evaluation.capsApplied.some((item) => item.includes('estrés temprano')));
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({ earlyStressMonths: 3 }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'Bueno');
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({ earlyStressMonths: 5 }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'Exigido');
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({ earlyStressMonths: 6 }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'Frágil');
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({
      classicSuccessRate: 0.95,
      qualitySurvivalRate: 0.48,
      qasrStrict: 0.7,
      averageEffectiveSpendingRatio: 0.9,
    }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.ok(['Exigido', 'Bueno'].includes(evaluation.label));
  assert.ok(evaluation.capsApplied.some((item) => item.includes('qualitySurvivalRate')));
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({
      monthsBelow85: 10,
      maxConsecutiveMonthsBelow85: 5,
      terminalWealthRatio: 1.1,
    }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'Exigido');
  assert.ok(evaluation.alerts.some((item) => item.includes('>100%')));
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({
      monthsBelow85: 0,
      maxConsecutiveMonthsBelow85: 0,
      earlyStressMonths: 0,
      terminalWealthRatio: 1.05,
      houseSaleIncidence: 0.4,
    }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.notEqual(evaluation.label, 'Exigido');
  assert.ok(evaluation.alerts.some((item) => item.includes('liquidez')));
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics({ warnings: ['terminal_wealth_missing'] }),
    inputAuditable: true,
    canUseForDecision: true,
    decisionStatus: 'canonical',
  });
  assert.equal(evaluation.label, 'No comparable');
  assert.equal(evaluation.isComparable, false);
}

{
  const evaluation = buildMidasEvaluation({
    qualityOfLifeMetrics: makeMetrics(),
    inputAuditable: false,
    canUseForDecision: false,
    decisionStatus: 'not_decisional',
    comparabilityWarnings: ['result_not_final_for_input'],
  });
  assert.equal(evaluation.label, 'No comparable');
  assert.ok(evaluation.warnings.includes('input_not_auditable'));
  assert.ok(evaluation.warnings.includes('result_not_comparable_for_decision'));
}

console.log('midasEvaluation tests passed');
