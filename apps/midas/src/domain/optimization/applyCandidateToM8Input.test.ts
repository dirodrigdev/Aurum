import assert from 'node:assert/strict';
import type { MidasCandidate } from './candidateSet';
import { applyCandidateToM8Input } from './applyCandidateToM8Input';
import type { M8Input } from '../simulation/m8.types';

function buildBaseInput(): M8Input {
  return {
    years: 40,
    n_paths: 120,
    seed: 42,
    simulation_frequency: 'monthly',
    use_real_terms: true,
    capital_initial_clp: 1_500_000_000,
    capital_source: 'aurum',
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

const candidate: MidasCandidate = {
  candidateId: 'cand_1',
  changes: {
    bucketMonths: 30,
    spendingPhases: {
      phase1MonthlyClp: 6_200_000,
      phase2MonthlyClp: 5_900_000,
      phase3MonthlyClp: 3_800_000,
      phase4MonthlyClp: 5_100_000,
    },
    phaseDurations: {
      phase1Years: 5,
      phase2Years: 14,
      phase3Years: 16,
      phase4Years: 5,
    },
    cutRules: {
      cut1: 0.93,
      cut2: 0.86,
    },
    portfolioMix: {
      eq_global: 0.28,
      eq_chile: 0.1,
      fi_global: 0.22,
      fi_chile: 0.3,
      usd_liquidity: 0.05,
      clp_cash: 0.05,
    },
    nSim: 240,
    seed: 99,
  },
};

const applied = applyCandidateToM8Input(buildBaseInput(), candidate);
assert.equal(applied.ok, true);
if (applied.ok) {
  assert.equal(applied.input.bucket.bucket_months, 30);
  assert.equal(applied.input.phase1MonthlyClp, 6_200_000);
  assert.equal(applied.input.phase1EndYear, 5);
  assert.equal(applied.input.phase2EndYear, 19);
  assert.equal(applied.input.phase3EndYear, 35);
  assert.equal(applied.input.cuts.cut1_floor, 0.93);
  assert.equal(applied.input.portfolio_mix.eq_global, 0.28);
  assert.equal(applied.input.n_paths, 240);
  assert.equal(applied.input.seed, 99);
}

const untouchedBase = buildBaseInput();
applyCandidateToM8Input(untouchedBase, candidate);
assert.equal(untouchedBase.bucket.bucket_months, 24);
assert.equal(untouchedBase.phase1MonthlyClp, 6_000_000);

const invalidMix = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'bad_mix',
  changes: {
    portfolioMix: {
      eq_global: 0.4,
      eq_chile: 0.1,
      fi_global: 0.2,
      fi_chile: 0.2,
      usd_liquidity: 0.05,
      clp_cash: 0.01,
    },
  },
});
assert.equal(invalidMix.ok, false);

const invalidDurations = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'bad_durations',
  changes: {
    phaseDurations: {
      phase1Years: 4,
      phase2Years: 16,
      phase3Years: 25,
      phase4Years: 5,
    },
  },
});
assert.equal(invalidDurations.ok, false);

const partialSpendingPhases = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'partial_spend',
  changes: {
    spendingPhases: {
      phase1MonthlyClp: 6_300_000,
      F3: 4_100_000,
    },
  },
});
assert.equal(partialSpendingPhases.ok, true);
if (partialSpendingPhases.ok) {
  assert.equal(partialSpendingPhases.input.phase1MonthlyClp, 6_300_000);
  assert.equal(partialSpendingPhases.input.phase2MonthlyClp, 6_000_000);
  assert.equal(partialSpendingPhases.input.phase3MonthlyClp, 4_100_000);
  assert.equal(partialSpendingPhases.input.phase4MonthlyClp, 5_400_000);
}

const partialCutRules = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'partial_cut_rules',
  changes: {
    cutRules: {
      cut1: 0.95,
    },
  },
});
assert.equal(partialCutRules.ok, true);
if (partialCutRules.ok) {
  assert.equal(partialCutRules.input.cuts.cut1_floor, 0.95);
  assert.equal(partialCutRules.input.cuts.cut2_floor, 0.84);
}

const futureCapitalEvents = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'future_events',
  changes: {
    futureCapitalEvents: [
      { id: 'bonus-2030', type: 'inflow', amount: 200_000_000, currency: 'CLP', effectiveMonth: 24 },
      { id: 'gift-2032', type: 'inflow', amount: 50_000, currency: 'USD', effectiveMonth: 48 },
    ],
  },
});
assert.equal(futureCapitalEvents.ok, true);
if (futureCapitalEvents.ok) {
  assert.equal(futureCapitalEvents.input.capital_initial_clp, 1_500_000_000);
  assert.equal(futureCapitalEvents.input.future_events?.length, 2);
  assert.equal(futureCapitalEvents.input.future_events?.[0]?.effective_month, 24);
  assert.equal(futureCapitalEvents.input.future_events?.[1]?.currency, 'USD');
}

const blockedHousePolicy = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'blocked_house',
  changes: {
    houseSaleTrigger: {
      yearsOfSpend: 2.5,
      lagMonths: 9,
    },
  },
} as unknown as MidasCandidate);
assert.equal(blockedHousePolicy.ok, false);

const unsupportedReturnScenario = applyCandidateToM8Input(buildBaseInput(), {
  candidateId: 'unsupported_return',
  changes: {
    returnScenario: 'optimistic',
  },
} as unknown as MidasCandidate);
assert.equal(unsupportedReturnScenario.ok, false);

console.log('applyCandidateToM8Input tests passed');
