import assert from 'node:assert/strict';
import type { SimulationResults } from '../model/types';
import type { M8Input } from '../simulation/m8.types';
import { evaluateCandidateSetWithM8 } from './evaluateCandidateSetWithM8';

function buildBaseInput(): M8Input {
  return {
    years: 40,
    n_paths: 60,
    seed: 42,
    simulation_frequency: 'monthly',
    use_real_terms: true,
    capital_initial_clp: 1_500_000_000,
    capital_source: 'aurum',
    capital_source_label: 'Aurum',
    feeAnnual: 0.01,
    portfolio_mix: {
      eq_global: 0.3,
      eq_chile: 0.1,
      fi_global: 0.2,
      fi_chile: 0.3,
      usd_liquidity: 0.05,
      clp_cash: 0.05,
    },
    phase1MonthlyClp: 6_000_000,
    phase2MonthlyClp: 6_000_000,
    phase3MonthlyClp: 3_900_000,
    phase4MonthlyClp: 5_400_000,
    phase1EndYear: 4,
    phase2EndYear: 20,
    phase3EndYear: 35,
    return_assumptions: {
      eq_global_real_annual: 0.07,
      eq_chile_real_annual: 0.06,
      fi_global_real_annual: 0.025,
      fi_chile_real_annual: 0.025,
      usd_liquidity_real_annual: 0.01,
      clp_cash_real_annual: 0.005,
    },
    generator_type: 'student_t',
    generator_params: {
      distribution: 'student_t',
      degrees_of_freedom: 7,
      sleeves: {
        eq_global: { mean_annual: 0.07, vol_annual: 0.18 },
        eq_chile: { mean_annual: 0.06, vol_annual: 0.2 },
        fi_global: { mean_annual: 0.025, vol_annual: 0.08 },
        fi_chile: { mean_annual: 0.025, vol_annual: 0.07 },
        usd_liquidity: { mean_annual: 0.01, vol_annual: 0.02 },
        clp_cash: { mean_annual: 0.005, vol_annual: 0.01 },
      },
      correlation_matrix: [
        [1, 0.7, 0.3, 0.2, 0.1, 0],
        [0.7, 1, 0.25, 0.2, 0.1, 0],
        [0.3, 0.25, 1, 0.45, 0.3, 0.1],
        [0.2, 0.2, 0.45, 1, 0.2, 0.15],
        [0.1, 0.1, 0.3, 0.2, 1, 0.2],
        [0, 0, 0.1, 0.15, 0.2, 1],
      ],
    },
    bucket: {
      bucket_mode: 'operational_simple',
      bucket_months: 24,
    },
    cuts: {
      cut1_floor: 0.92,
      cut2_floor: 0.84,
      recovery_cut2_to_cut1_months: 4,
      recovery_cut1_to_normal_months: 6,
      adjustment_alpha: 0.6,
      dd15_threshold: 0.15,
      dd25_threshold: 0.25,
      consecutive_months: 3,
    },
    house: {
      include_house: true,
      houseValueUf: 12_000,
      mortgageBalanceUfNow: 0,
      monthlyAmortizationUf: 0,
      ufClpStart: 38_000,
      house_sale_trigger_years_of_spend: 2,
      house_sale_lag_months: 6,
    },
  };
}

function buildBaselineResult(): SimulationResults {
  return {
    probRuin: 0.084,
    success40: 0.916,
    probRuin40: 0.084,
    nRuin: 5,
    nTotal: 60,
    uncertaintyBand: { low: 0.024, high: 0.144 },
    terminalWealthPercentiles: { 50: 3_300_000_000 },
    terminalWealthAll: [],
    terminalWealthAllPaths: [],
    p50TerminalAllPaths: 3_300_000_000,
    p50TerminalSurvivors: 3_300_000_000,
    terminalP25AllPaths: 1_030_000_000,
    terminalP25IfSuccess: 1_030_000_000,
    terminalP75AllPaths: 5_000_000_000,
    terminalP75IfSuccess: 5_000_000_000,
    maxDrawdownPercentiles: { 50: 0.23 },
    ruinTimingMedian: 0,
    ruinTimingP25: 0,
    ruinTimingP75: 0,
    fanChartData: [],
    spendingRatioMedian: 0.96,
    houseSalePct: 0.246,
    saleYearMedian: 24.7,
    computedAt: new Date('2026-06-30T00:00:00.000Z'),
    durationMs: 1234,
    params: { simulation: { seed: 42, nSim: 60 } } as any,
    qualityOfLifeMetrics: {
      schemaVersion: 1,
      source: 'path_quality_diagnostics_v1',
      warnings: [],
      pathCount: 60,
      horizonMonths: 480,
      horizonYears: 40,
      classicSuccessRate: 0.916,
      ruinRate: 0.084,
      ruinedPathCount: 5,
      csr85_4: 0.737,
      csrPassingPathCount: 44,
      csrThresholds: { minAverageConsumptionRatio: 0.85, maxSevereCutMonths: 48 },
      qasrAlpha: 1.5,
      qasrStrict: 0.904,
      qualityScoreMean: 0.52,
      qualityScoreP25: 0.48,
      qualityScoreP50: 0.52,
      averageConsumptionRatioMean: 0.96,
      averageConsumptionRatioP25: 0.94,
      averageConsumptionRatioP50: 0.96,
      averageEffectiveSpendingRatio: 0.96,
      minMonthlyConsumptionRatioP10: 0.8,
      minMonthlyConsumptionRatioP25: 0.85,
      minAnnualConsumptionRatioP10: 0.8,
      minAnnualConsumptionRatioP25: 0.85,
      monthsBelow85: 35,
      maxConsecutiveMonthsBelow85: 12,
      monthsBelow90: 48,
      maxConsecutiveMonthsBelow90: 16,
      earlyStressMonths: 3,
      phaseStress: [],
      qualitySurvivalRate: 0.154,
      qualitySurvivalPassingPathCount: 9,
      qualitySurvivalThresholds: { minAverageConsumptionRatio: 0.9, maxConsecutiveMonthsBelow85: 6, maxTotalMonthsBelow85: 24 },
      monthsInCutMean: 24,
      monthsInCutP50: 18,
      monthsInSevereCutMean: 10,
      monthsInSevereCutP50: 8,
      maxConsecutiveSevereCutMonthsP50: 4,
      maxConsecutiveSevereCutMonthsP75: 7,
      severeCutYearsMean: 0.83,
      severeCutYearsP50: 0.67,
      houseSaleRate: 0.246,
      houseSoldPathCount: 15,
      houseSaleYearMedian: 24.7,
      houseSaleYearP10: 18,
      houseSaleYearP90: 31,
      houseSaleTriggerToSaleMonthsMedian: 6,
      houseSaleTriggerToSaleMonthsMean: 6,
      houseSaleTriggerToSaleMonthsP75: 7,
      severeCutMonthsDuringHouseSaleMean: 2,
      severeCutMonthsDuringHouseSaleMedian: 2,
      severeCutMonthsDuringHouseSaleP75: 4,
      monthsInCutBeforeHouseSaleMean: 5,
      monthsInSevereCutBeforeHouseSaleMean: 1,
      liquidWealthAfterHouseSaleP25: 400_000_000,
      liquidWealthAfterHouseSaleP50: 600_000_000,
      houseSaleIncidence: 0.246,
      terminalWealthP10: 200_000_000,
      terminalWealthP25: 1_030_000_000,
      terminalWealthP50: 3_300_000_000,
      terminalWealthP75: 5_000_000_000,
      terminalWealthRatio: 2.2,
    },
  };
}

const evaluation = evaluateCandidateSetWithM8({
  baseInput: buildBaseInput(),
  baselineFingerprint: 'fnv1a-959dded4',
  baselineResult: buildBaselineResult(),
  candidateSet: {
    type: 'midas_candidate_set',
    version: '1.0',
    packFingerprint: 'fnv1a-959dded4',
    selectedGoals: ['improve_quality_of_life'],
    customGoals: [],
    constraints: {},
    candidates: [
      {
        candidateId: 'liquidity_qol',
        label: 'Más bucket y recorte más suave',
        candidateFamily: 'liquidity',
        hypothesis: 'Podría suavizar estrés temprano.',
        heuristicPriority: 'high',
        preM8Score: 80,
        preM8ScoreExplanation: 'Proxy heurístico, no resultado oficial.',
        changes: {
          bucketMonths: 30,
          cutRules: { cut1: 0.94, cut2: 0.87 },
          seed: 99,
          nSim: 40,
        },
      },
      {
        candidateId: 'invalid_return',
        changes: {
          returnScenario: 'optimistic',
        },
      },
    ],
  },
});

assert.equal(evaluation.type, 'midas_optimization_results');
assert.equal(evaluation.baseline.metrics.success40, 0.916);
assert.equal(evaluation.candidates.length, 2);

const validCandidate = evaluation.candidates[0];
assert.equal(validCandidate.status, 'evaluated');
assert.equal(validCandidate.metrics?.success40 !== null, true);
assert.equal(Array.isArray(validCandidate.appliedChanges), true);
assert.equal(typeof validCandidate.deltaVsBaseline?.qolScore === 'number' || validCandidate.deltaVsBaseline?.qolScore === null, true);

const invalidCandidate = evaluation.candidates[1];
assert.equal(invalidCandidate.status, 'invalid');
assert.equal(invalidCandidate.metrics, null);
assert.equal(invalidCandidate.errors.some((error) => error.includes('returnScenario')), true);

console.log('evaluateCandidateSetWithM8 tests passed');
