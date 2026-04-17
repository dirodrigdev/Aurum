export const optimizerPolicyConfig = {
  phase1: {
    shortlistBestSuccessBand: 0.015,
    shortlistMinRvDistancePp: 10,
    shortlistTarget: 5,
    technicalTieBandPp: 0.2,
    materialitySuccessPp: 0.5,
  },
  phase2Competition: {
    autonomousEligibilityGapPp: 1.0,
    material: {
      houseSalePctPpLower: 5.0,
      houseSaleYearLaterYears: 2.0,
      cutScenarioPctPpLower: 5.0,
      cutSeverityPpLower: 2.0,
      firstCutYearLaterYears: 2.0,
      ruin20PpLower: 0.5,
      maxDDP50PpLower: 3.0,
    },
    redFlags: {
      success40AssistedPpWorse: 0.5,
      houseSalePctPpWorse: 5.0,
      cutScenarioPctPpWorse: 5.0,
      cutSeverityPpWorse: 2.0,
      firstCutYearEarlierYears: 2.0,
      ruin20AssistedPpWorse: 0.5,
      maxDDP50PpWorse: 3.0,
    },
    compete: {
      minMaterialImprovements: 2,
    },
    displace: {
      success40AssistedMaxWorsePp: 0.2,
      minMaterialImprovements: 3,
    },
  },
  implementation: {
    realisticValidationGapRvPp: 0.25,
  },
  phase3: {
    successSacrificeBand: [
      { minSuccess: 0.90, band: 0.03 },
      { minSuccess: 0.85, band: 0.025 },
      { minSuccess: 0.80, band: 0.02 },
      { minSuccess: 0.70, band: 0.015 },
      { minSuccess: 0, band: 0.01 },
    ],
    poolEntryBand: [
      { minSuccess: 0.90, band: 0.015 },
      { minSuccess: 0.80, band: 0.01 },
      { minSuccess: 0, band: 0.005 },
    ],
    qolWeights: [0.25, 0.40, 0.25, 0.10] as const,
    guardrails: {
      ruin20MaxWorse: 0.005,
      cutScenarioPctMaxWorse: 0.05,
      houseSalePctMaxWorse: 0.05,
      maxDDP50MaxWorse: 0.03,
    },
  },
  moveRecommendation: {
    successPpConsiderMin: 0.5,
    successPpStrongMin: 1.5,
    strongQolImprovementPct: 5.0,
    ruin20PpImprovement: 0.5,
    ruinP10YearsImprovement: 1.0,
    maxDDP50PpImprovement: 3.0,
  },
} as const;

export const REALISTIC_VALIDATION_GAP_THRESHOLD_RV_PP = optimizerPolicyConfig.implementation.realisticValidationGapRvPp;
