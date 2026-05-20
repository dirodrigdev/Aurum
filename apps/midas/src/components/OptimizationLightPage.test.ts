import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildImplementationUniverseInstruments } from '../domain/instrumentImplementationLoader';
import { buildInstrumentImplementationPlan } from '../domain/instrumentImplementationPlanner';
import type { InstrumentImplementationUniverse } from '../domain/instrumentImplementationTypes';
import type { InstrumentImplementationPlan } from '../domain/instrumentImplementationTypes';
import type { PortfolioWeights } from '../domain/model/types';
import type { ModelParameters } from '../domain/model/types';
import type { RvRfDecisionCandidate, RvRfDecisionProfiles } from '../domain/optimizer/rvRfDecisionProfiles';
import {
  DECISION_EXPRESS_STEP_PP,
  DECISION_REFINEMENT_MAX_WINDOW_PP,
  IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP,
  OptimizationLightPage,
    buildFinancialReferenceParams,
    buildSimulationReconciliationMessage,
    buildCurrentVsMidasComparisonRows,
    buildCurrentVsMidasTradeoffs,
    buildOptimizationInputFingerprint,
    buildOptimizationConfirmationShortlist,
    buildOptimizationExpressGrid,
    buildOptimizationZoomFallbackShortlist,
    buildOptimizationZoomShortlist,
    canUseDecisionFlowForImplementation,
    classifyImplementationMateriality,
    hasStaleOptimizationMeta,
    isOptimizationResultMetaCurrent,
    selectClosestDiscardedCompetitor,
    selectFinancialOptimumCandidate,
    selectBestAvailableFallbackCandidate,
    type FinancialReferenceCandidate,
} from './OptimizationLightPage';

function buildWeights(rvGlobal: number, rvChile: number, rfGlobal: number, rfChile: number): PortfolioWeights {
  return {
    rvGlobal,
    rvChile,
    rfGlobal,
    rfChile,
  };
}

function buildImplementationUniverse(): InstrumentImplementationUniverse {
  return {
    snapshot: {
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      rawJson: '{}',
      instruments: [],
      optimizerMetadata: null,
      portfolioSummary: null,
      methodology: null,
    },
    instruments: [
      {
        instrumentId: 'sura-rf',
        name: 'SURA RF Chile',
        vehicleType: 'fund',
        currency: 'CLP',
        taxWrapper: 'FM',
        isCaptive: false,
        isSellable: true,
        currentMixUsed: { rv: 0, rf: 1, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: null,
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: 0, local: 1 },
        amountClp: 100_000_000,
        amountNative: 100_000_000,
        amountNativeCurrency: 'CLP',
        fxToClpUsed: 1,
        weightPortfolio: 1,
        role: null,
        structuralMixDriver: null,
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: null,
        sameCurrencyCandidates: ['sura-rv'],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: ['sura-rv'],
        decisionEligible: true,
        missingCriticalFields: [],
        warnings: [],
        usable: true,
      },
      {
        instrumentId: 'sura-rv',
        name: 'SURA RV Global',
        vehicleType: 'fund',
        currency: 'CLP',
        taxWrapper: 'FM',
        isCaptive: false,
        isSellable: true,
        currentMixUsed: { rv: 1, rf: 0, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: null,
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: 1, local: 0 },
        amountClp: 0,
        amountNative: 0,
        amountNativeCurrency: 'CLP',
        fxToClpUsed: 1,
        weightPortfolio: 0,
        role: null,
        structuralMixDriver: null,
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: null,
        sameCurrencyCandidates: ['sura-rf'],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: ['sura-rf'],
        decisionEligible: true,
        missingCriticalFields: [],
        warnings: [],
        usable: false,
      },
    ],
  };
}

function buildUniverseNeedingCrossManager(): InstrumentImplementationUniverse {
  const base = buildImplementationUniverse();
  return {
    ...base,
    instruments: [
      {
        ...base.instruments[0],
        instrumentId: 'sura-rf',
        name: 'SURA RF Chile',
        weightPortfolio: 0.2,
        amountClp: 20_000_000,
      },
      {
        ...base.instruments[1],
        instrumentId: 'sura-rv',
        name: 'SURA RV Global',
        weightPortfolio: 0.6,
        amountClp: 60_000_000,
        usable: true,
      },
      {
        instrumentId: 'btg-rf',
        name: 'BTG RF Chile',
        vehicleType: 'fund',
        currency: 'CLP',
        taxWrapper: 'FM',
        isCaptive: false,
        isSellable: true,
        currentMixUsed: { rv: 0, rf: 1, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: null,
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: 0, local: 1 },
        amountClp: 20_000_000,
        amountNative: 20_000_000,
        amountNativeCurrency: 'CLP',
        fxToClpUsed: 1,
        weightPortfolio: 0.2,
        role: null,
        structuralMixDriver: null,
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: null,
        sameCurrencyCandidates: ['sura-rv'],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: ['sura-rv'],
        decisionEligible: true,
        missingCriticalFields: [],
        warnings: [],
        usable: true,
      },
      {
        instrumentId: 'planvital-fondo-a',
        name: 'PlanVital Fondo A',
        vehicleType: 'AFP',
        currency: 'CLP',
        taxWrapper: null,
        isCaptive: false,
        isSellable: false,
        currentMixUsed: { rv: 1, rf: 0, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: null,
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: 1, local: 0 },
        amountClp: 0,
        amountNative: 0,
        amountNativeCurrency: 'CLP',
        fxToClpUsed: 1,
        weightPortfolio: 0,
        role: 'mandatory',
        structuralMixDriver: null,
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: 'afp_obligatoria',
        sameCurrencyCandidates: [],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: [],
        decisionEligible: false,
        missingCriticalFields: [],
        warnings: [],
        usable: false,
      },
    ],
  };
}

function buildUniverseNeedingCrossCurrency(): InstrumentImplementationUniverse {
  return {
    snapshot: {
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      rawJson: '{}',
      instruments: [],
      optimizerMetadata: null,
      portfolioSummary: null,
      methodology: null,
    },
    instruments: [
      {
        instrumentId: 'sura-rf-usd',
        name: 'SURA RF USD',
        vehicleType: 'fund',
        currency: 'USD',
        taxWrapper: 'FM',
        isCaptive: false,
        isSellable: true,
        currentMixUsed: { rv: 0, rf: 1, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: null,
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: 1, local: 0 },
        amountClp: 100_000_000,
        amountNative: 110_000,
        amountNativeCurrency: 'USD',
        fxToClpUsed: 900,
        weightPortfolio: 1,
        role: null,
        structuralMixDriver: null,
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: null,
        sameCurrencyCandidates: [],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: [],
        decisionEligible: true,
        missingCriticalFields: [],
        warnings: [],
        usable: true,
      },
      {
        instrumentId: 'sura-rv-clp',
        name: 'SURA RV CLP',
        vehicleType: 'fund',
        currency: 'CLP',
        taxWrapper: 'FM',
        isCaptive: false,
        isSellable: true,
        currentMixUsed: { rv: 1, rf: 0, cash: 0, other: 0 },
        legalRange: null,
        legalRangeMix: null,
        historicalUsedRange: null,
        optimizerSafeRange: null,
        operationalRange: null,
        observedWindowMonths: null,
        observedFrom: null,
        observedTo: null,
        estimationMethod: null,
        confidenceScore: null,
        sourcePreference: null,
        exposureUsed: { global: 1, local: 0 },
        amountClp: 0,
        amountNative: 0,
        amountNativeCurrency: 'CLP',
        fxToClpUsed: 1,
        weightPortfolio: 0,
        role: null,
        structuralMixDriver: null,
        estimatedMixImpactPoints: 0,
        replaceabilityScore: 1,
        replacementConstraint: null,
        sameCurrencyCandidates: [],
        sameManagerCandidates: [],
        sameTaxWrapperCandidates: [],
        decisionEligible: true,
        missingCriticalFields: [],
        warnings: [],
        usable: false,
      },
    ],
  };
}

function buildUniverseWithPlanVitalCuenta2Destination(): InstrumentImplementationUniverse {
  const base = buildImplementationUniverse();
  return {
    ...base,
    instruments: [
      {
        ...base.instruments[0],
        instrumentId: 'sura-rf',
        name: 'SURA RF Chile',
        weightPortfolio: 1,
        amountClp: 100_000_000,
      },
      {
        ...base.instruments[1],
        instrumentId: 'planvital-cuenta2-a',
        name: 'PlanVital Cuenta 2 Fondo A',
        vehicleType: 'Cuenta 2',
        currency: 'CLP',
        taxWrapper: 'Cuenta2',
        isCaptive: false,
        isSellable: false,
        currentMixUsed: { rv: 1, rf: 0, cash: 0, other: 0 },
        weightPortfolio: 0,
        amountClp: 0,
        amountNative: 0,
        decisionEligible: true,
        replacementConstraint: null,
        usable: false,
      },
    ],
  };
}

function buildParams(): ModelParameters {
  return {
    label: 'Test',
    capitalInitial: 1_000_000_000,
    capitalSource: 'manual',
    manualCapitalInput: { financialCapitalCLP: 1_000_000_000 },
    weights: buildWeights(0.35, 0.25, 0.2, 0.2),
    cashflowEvents: [],
    activeScenario: 'base',
    feeAnnual: 0.006,
    spendingPhases: [
      { durationMonths: 120, amountReal: 4_000_000, currency: 'CLP' },
      { durationMonths: 120, amountReal: 4_500_000, currency: 'CLP' },
      { durationMonths: 120, amountReal: 4_000_000, currency: 'CLP' },
      { durationMonths: 120, amountReal: 3_500_000, currency: 'CLP' },
    ],
    spendingRule: {
      dd15Threshold: 0.15,
      dd25Threshold: 0.25,
      consecutiveMonths: 3,
      softCut: 0.9,
      hardCut: 0.8,
      adjustmentAlpha: 0.5,
      recoveryAlpha: 0.8,
    },
    returns: {
      rvGlobalAnnual: 0.069,
      rfGlobalAnnual: 0.024,
      rvChileAnnual: 0.074,
      rfChileUFAnnual: 0.019,
      rvGlobalVolAnnual: 0.16,
      rfGlobalVolAnnual: 0.05,
      rvChileVolAnnual: 0.2,
      rfChileVolAnnual: 0.06,
      correlationMatrix: [
        [1, 0.2, 0.3, 0.1],
        [0.2, 1, 0.1, 0.3],
        [0.3, 0.1, 1, 0.2],
        [0.1, 0.3, 0.2, 1],
      ],
    },
    inflation: {
      ipcChileAnnual: 0.03,
      hipcEurAnnual: 0.02,
      ipcChileVolAnnual: 0.01,
      hipcEurVolAnnual: 0.01,
    },
    fx: {
      clpUsdInitial: 900,
      usdEurFixed: 0.92,
      tcrealLT: 100,
      mrHalfLifeYears: 8,
    },
    bucketMonths: 12,
    simulation: {
      nSim: 3000,
      horizonMonths: 480,
      blockLength: 12,
      seed: 123,
      useHistoricalData: false,
    },
    ruinThresholdMonths: 6,
  };
}

function buildPlan(overrides?: Partial<InstrumentImplementationPlan>): InstrumentImplementationPlan {
  return {
    targetMixIdeal: { rv: 0.6, rf: 0.4 },
    currentMix: { rv: 0.592, rf: 0.408 },
    reachableMix: { rv: 0.6, rf: 0.4 },
    gapVsIdealRvPp: 0.8,
    equivalentToIdeal: true,
    structuralChangeRequired: false,
    transfers: [
      {
        fromInstrumentId: 'a',
        fromName: 'A',
        toInstrumentId: 'b',
        toName: 'B',
        weightMoved: 0.0104,
        amountNativeMoved: 15_100_000,
        nativeCurrency: 'CLP',
        amountClpMoved: 15_100_000,
        stage: 'clean',
        rationale: 'rebalance',
        constraints: {
          sameCurrency: true,
          sameManager: true,
          sameTaxWrapper: true,
          crossManager: false,
          crossCurrency: false,
        },
      },
    ],
    stageSummaries: [
      {
        stage: 'clean',
        used: true,
        statusReason: 'used',
        operationCount: 1,
        movedClp: 15_100_000,
        reachedMix: { rv: 0.6, rf: 0.4 },
        remainingGapRvPp: 0.8,
      },
      {
        stage: 'cross_manager',
        used: false,
        statusReason: 'not_required',
        operationCount: 0,
        movedClp: 0,
        reachedMix: { rv: 0.6, rf: 0.4 },
        remainingGapRvPp: 0.8,
      },
      {
        stage: 'cross_currency',
        used: false,
        statusReason: 'not_required',
        operationCount: 0,
        movedClp: 0,
        reachedMix: { rv: 0.6, rf: 0.4 },
        remainingGapRvPp: 0.8,
      },
    ],
    destinationDiagnostics: [],
    restrictionsApplied: {
      sameCurrency: true,
      sameManager: true,
      sameTaxWrapper: true,
      crossManager: false,
      crossCurrency: false,
    },
    warnings: [],
    baseTargetWeights: buildWeights(0.35, 0.25, 0.2, 0.2),
    reachableWeights: buildWeights(0.35, 0.25, 0.2, 0.2),
    ...overrides,
  };
}

function buildDecisionCandidate(overrides: Partial<RvRfDecisionCandidate> & { rvPct: number }): RvRfDecisionCandidate {
  const { rvPct, ...rest } = overrides;
  return {
    candidateId: `rv_${rvPct}_rf_${100 - rvPct}`,
    mixLabel: `RV ${rvPct} / RF ${100 - rvPct}`,
    rvPct,
    rfPct: 100 - rvPct,
    rvReal: rvPct / 100,
    rfReal: 1 - rvPct / 100,
    qasrBase: 0.94,
    qasrAt120: 0.9,
    qasrAt130: 0.86,
    csrBase: 0.92,
    ruinRate: 0.04,
    monthsInSevereCutMean: 10,
    maxConsecutiveSevereCutMonthsP75: 14,
    terminalWealthP25: 1_000_000_000,
    terminalWealthP50: 2_000_000_000,
    houseSaleRate: 0.2,
    severeCutDuringSaleMonths: 0,
    recSevPctBase: 10 / 480,
    ...rest,
  };
}

function buildProfiles(rows: RvRfDecisionCandidate[]): RvRfDecisionProfiles {
  return {
    seQasrEstimated: 0.5,
    seQasrMaxCandidateId: rows[0]?.candidateId ?? null,
    paretoToleranceUsed: 0.5,
    defensiveReferenceSource: 'guardrail_pool',
    warnings: [],
    guardrails: {
      qasrMin: 87,
      ruinMax: 0.1,
      severeCutMonthsMax: 48,
      severeCutStreakP75Max: 30,
    },
    fineGridCount: rows.length,
    paretoFrontierSize: rows.length,
    ratioUsed: 2,
    ratioSensitivity: {
      ratio15CandidateId: null,
      ratio20CandidateId: null,
      ratio30CandidateId: null,
      recommendationSensitive: false,
    },
    defensiveReference: rows[0] ?? null,
    primaryRecommendation: rows[1] ?? rows[0] ?? null,
    headroomAlternative: null,
    benchmarkExtreme: rows.find((row) => row.rvPct === 100) ?? null,
    rows: rows.map((row) => ({
      ...row,
      passesHardGuardrails: true,
      failedGuardrails: [],
      inParetoFrontier: true,
      role: row.rvPct === 100 ? 'benchmark_extreme' : 'none',
      deltaQasrBaseVsDefensive: null,
      deltaQasr120VsDefensive: null,
      tradeoffRatioVsDefensive: null,
      mainDifference: 'test',
    })),
  };
}

function buildFinancialCandidate(overrides: Partial<FinancialReferenceCandidate> & { rvPct: number }): FinancialReferenceCandidate {
  const { rvPct, ...rest } = overrides;
  return {
    candidateId: `financial_${rvPct}`,
    mixLabel: `RV ${rvPct} / RF ${100 - rvPct}`,
    rvPct,
    rfPct: 100 - rvPct,
    success40: 0.9,
    ruin20: 0.08,
    ruinP10: 20,
    drawdownP50: 0.25,
    terminalWealthP50: 1_000_000_000,
    weights: buildWeights(rvPct / 200, rvPct / 200, (100 - rvPct) / 200, (100 - rvPct) / 200),
    ...rest,
  };
}

const expressGrid = buildOptimizationExpressGrid();
assert.deepEqual(expressGrid, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
assert.equal(expressGrid[1] - expressGrid[0], DECISION_EXPRESS_STEP_PP);
const expressWithCurrent = buildOptimizationExpressGrid(59.2);
assert(expressWithCurrent.includes(60));
assert(!expressWithCurrent.includes(59.2));

const zoomShortlist = buildOptimizationZoomShortlist({
  preliminaryRecommendationRv: 60,
  defensiveReferenceRv: 25,
  technicalPreludeRv: 55,
  currentRvRounded: 60,
});
assert(zoomShortlist.includes(50));
assert(zoomShortlist.includes(55));
assert(zoomShortlist.includes(60));
assert(zoomShortlist.includes(65));
assert(zoomShortlist.includes(70));
assert(!zoomShortlist.includes(25));
assert(!zoomShortlist.includes(90));
assert(!zoomShortlist.includes(95));
assert(!zoomShortlist.includes(100));
assert(!zoomShortlist.includes(59.2));
assert(zoomShortlist.every((value) => value % 5 === 0));
assert.equal(new Set(zoomShortlist).size, zoomShortlist.length);
assert.equal(zoomShortlist[0], 45);
assert.equal(zoomShortlist[zoomShortlist.length - 1], 70);
assert(zoomShortlist.every((value) => Math.abs(value - 60) <= DECISION_REFINEMENT_MAX_WINDOW_PP));

const boundedZoom = buildOptimizationZoomShortlist({
  preliminaryRecommendationRv: 0,
  defensiveReferenceRv: 100,
  technicalPreludeRv: null,
  currentRvRounded: null,
});
assert.equal(boundedZoom[0], 0);
assert.equal(boundedZoom[boundedZoom.length - 1], 10);
assert(!boundedZoom.some((value) => value < 0 || value > 100));

const zoomFallback = buildOptimizationZoomFallbackShortlist(60);
assert.deepEqual(zoomFallback, [50, 55, 60, 65, 70]);
assert.deepEqual(buildOptimizationZoomFallbackShortlist(null), []);

const zoomFromVisibleExpressFallback = buildOptimizationZoomShortlist({
  preliminaryRecommendationRv: 100,
  defensiveReferenceRv: 25,
  technicalPreludeRv: 55,
  currentRvRounded: 60,
});
assert(zoomFromVisibleExpressFallback.includes(100));
assert(zoomFromVisibleExpressFallback.every((value) => value % 5 === 0));

const bestAvailableFallback = selectBestAvailableFallbackCandidate([
  {
    ...buildDecisionCandidate({ rvPct: 55, qasrBase: 0.935, qasrAt120: 0.89, ruinRate: 0.04, monthsInSevereCutMean: 12, maxConsecutiveSevereCutMonthsP75: 16, csrBase: 0.91 }),
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min'],
    inParetoFrontier: true,
    role: 'none',
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'test',
  },
  {
    ...buildDecisionCandidate({ rvPct: 60, qasrBase: 0.93, qasrAt120: 0.88, ruinRate: 0.03, monthsInSevereCutMean: 10, maxConsecutiveSevereCutMonthsP75: 14, csrBase: 0.92 }),
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min', 'severe_cut_mean_above_max'],
    inParetoFrontier: true,
    role: 'none',
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'test',
  },
]);
assert.equal(bestAvailableFallback?.rvPct, 55);

const currentBaseline = buildDecisionCandidate({
  rvPct: 59.2,
  qasrBase: 0.93,
  qasrAt120: 0.89,
  csrBase: 0.91,
  ruinRate: 0.04,
  monthsInSevereCutMean: 13,
  maxConsecutiveSevereCutMonthsP75: 16,
});

const dominatedExtremeFallback = selectBestAvailableFallbackCandidate([
  {
    ...buildDecisionCandidate({ rvPct: 0, qasrBase: 0.89, qasrAt120: 0.82, csrBase: 0.86, ruinRate: 0.07, monthsInSevereCutMean: 8, maxConsecutiveSevereCutMonthsP75: 10 }),
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min'],
    inParetoFrontier: true,
    role: 'benchmark_extreme',
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'benchmark',
  },
  {
    ...buildDecisionCandidate({ rvPct: 70, qasrBase: 0.935, qasrAt120: 0.9, csrBase: 0.92, ruinRate: 0.035, monthsInSevereCutMean: 12, maxConsecutiveSevereCutMonthsP75: 14 }),
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min'],
    inParetoFrontier: true,
    role: 'none',
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'candidate',
  },
], currentBaseline);
assert.equal(dominatedExtremeFallback?.rvPct, 70);

const noImprovementFallback = selectBestAvailableFallbackCandidate([
  {
    ...buildDecisionCandidate({ rvPct: 0, qasrBase: 0.89, qasrAt120: 0.82, csrBase: 0.86, ruinRate: 0.07, monthsInSevereCutMean: 8, maxConsecutiveSevereCutMonthsP75: 10 }),
    passesHardGuardrails: false,
    failedGuardrails: ['qasr_base_below_min'],
    inParetoFrontier: true,
    role: 'benchmark_extreme',
    deltaQasrBaseVsDefensive: null,
    deltaQasr120VsDefensive: null,
    tradeoffRatioVsDefensive: null,
    mainDifference: 'benchmark',
  },
], currentBaseline);
assert.equal(noImprovementFallback, null);

const confirmationShortlist = buildOptimizationConfirmationShortlist({
  zoomRecommendationRv: 60,
  expressRecommendationRv: 60,
  defensiveReferenceRv: 25,
  technicalPreludeRv: 55,
  currentRvRounded: 60,
});
assert(confirmationShortlist.length < 21);
assert(confirmationShortlist.includes(50));
assert(confirmationShortlist.includes(55));
assert(confirmationShortlist.includes(60));
assert(confirmationShortlist.includes(65));
assert(confirmationShortlist.includes(70));
assert(!confirmationShortlist.includes(95));
assert(!confirmationShortlist.includes(100));
assert(!confirmationShortlist.includes(59.2));
assert(confirmationShortlist.every((value) => value % 5 === 0));
assert(confirmationShortlist.every((value) => Math.abs(value - 60) <= DECISION_REFINEMENT_MAX_WINDOW_PP));

const confirmationWithVisibleExpressFallback = buildOptimizationConfirmationShortlist({
  zoomRecommendationRv: 70,
  expressRecommendationRv: 100,
  defensiveReferenceRv: 25,
  technicalPreludeRv: 55,
  currentRvRounded: 60,
});
assert(confirmationWithVisibleExpressFallback.includes(80));
assert(!confirmationWithVisibleExpressFallback.includes(100));

const decisionProfiles = buildProfiles([
  buildDecisionCandidate({ rvPct: 25, terminalWealthP50: 1_000_000_000, qasrAt120: 0.89 }),
  buildDecisionCandidate({ rvPct: 60, terminalWealthP50: 2_000_000_000, qasrAt120: 0.91 }),
  buildDecisionCandidate({ rvPct: 80, terminalWealthP50: 5_000_000_000, qasrAt120: 0.905 }),
  buildDecisionCandidate({ rvPct: 100, terminalWealthP50: 4_000_000_000, qasrAt120: 0.88 }),
]);
const financialReferenceParams = buildFinancialReferenceParams(buildParams());
assert.equal(financialReferenceParams.realEstatePolicy?.enabled, false);
assert.equal(financialReferenceParams.spendingRule.consecutiveMonths, 999);
assert.equal(financialReferenceParams.spendingRule.dd15Threshold, 10);
assert.equal(financialReferenceParams.spendingRule.dd25Threshold, 10);
const financialWinner = selectFinancialOptimumCandidate([
  buildFinancialCandidate({ rvPct: 25, success40: 0.92, ruin20: 0.05, terminalWealthP50: 1_000_000_000 }),
  buildFinancialCandidate({ rvPct: 80, success40: 0.90, ruin20: 0.04, terminalWealthP50: 9_000_000_000 }),
]);
assert.equal(financialWinner?.rvPct, 25);
const discarded = selectClosestDiscardedCompetitor({
  profiles: decisionProfiles,
  mainRecommendation: decisionProfiles.rows[1],
  defensiveReference: decisionProfiles.rows[0],
  headroomAlternative: null,
  benchmarkExtreme: decisionProfiles.rows[3],
  financialReference: financialWinner,
});
assert(discarded.reason.length > 0);
const runnerUpProfiles = buildProfiles([
  buildDecisionCandidate({ rvPct: 25, qasrAt120: 0.88 }),
  buildDecisionCandidate({ rvPct: 60, qasrAt120: 0.9 }),
  buildDecisionCandidate({ rvPct: 65, qasrAt120: 0.91 }),
  buildDecisionCandidate({ rvPct: 95, qasrAt120: 0.99 }),
  buildDecisionCandidate({ rvPct: 100, qasrAt120: 0.87 }),
]);
runnerUpProfiles.rows = runnerUpProfiles.rows.map((row) => (
  row.rvPct === 65
    ? { ...row, inParetoFrontier: true, tradeoffRatioVsDefensive: 1.8 }
    : row.rvPct === 95
      ? { ...row, inParetoFrontier: true, tradeoffRatioVsDefensive: 1.9 }
      : row
));
const interpretableDiscarded = selectClosestDiscardedCompetitor({
  profiles: runnerUpProfiles,
  mainRecommendation: runnerUpProfiles.rows.find((row) => row.rvPct === 60) ?? null,
  defensiveReference: runnerUpProfiles.rows.find((row) => row.rvPct === 25) ?? null,
  headroomAlternative: null,
  benchmarkExtreme: runnerUpProfiles.rows.find((row) => row.rvPct === 100) ?? null,
  financialReference: null,
});
assert.equal(interpretableDiscarded.candidate?.rvPct, 65);
assert.equal(interpretableDiscarded.reason, 'No supera ratio estabilidad/holgura.');

const currentVsRows = buildCurrentVsMidasComparisonRows({
  currentWeights: buildWeights(0.345, 0.247, 0.205, 0.203),
  recommendedWeights: buildWeights(0.35, 0.25, 0.2, 0.2),
  currentCandidate: buildDecisionCandidate({ rvPct: 59.2, qasrBase: 0.93, qasrAt120: 0.88, ruinRate: 0.05 }),
  recommendedCandidate: buildDecisionCandidate({ rvPct: 60, qasrBase: 0.94, qasrAt120: 0.9, ruinRate: 0.04 }),
});
assert(currentVsRows.some((row) => row.label === 'QASR base'));
assert(currentVsRows.some((row) => row.label === 'QASR +20% gasto'));
assert(currentVsRows.some((row) => row.label === 'CSR'));
assert(currentVsRows.some((row) => row.label === 'Ruina'));
assert(currentVsRows.some((row) => row.label === 'Recorte severo promedio'));
assert(currentVsRows.some((row) => row.label === 'Patrimonio final P50'));
assert(currentVsRows.some((row) => row.label === 'Max drawdown P50' && row.current === 'No disponible'));

const currentVsTradeoffs = buildCurrentVsMidasTradeoffs({
  currentWeights: buildWeights(0.345, 0.247, 0.205, 0.203),
  recommendedWeights: buildWeights(0.35, 0.25, 0.2, 0.2),
  currentCandidate: buildDecisionCandidate({ rvPct: 59.2, qasrAt120: 0.88 }),
  recommendedCandidate: buildDecisionCandidate({ rvPct: 60, qasrAt120: 0.9 }),
});
assert.equal(currentVsTradeoffs.marginal, true);
assert(currentVsTradeoffs.gains.some((item) => item.includes('QASR +20')));

const currentWeights = buildWeights(0.345, 0.247, 0.205, 0.203);
const noActionSummary = classifyImplementationMateriality({
  currentWeights,
  plan: buildPlan(),
});
assert.equal(noActionSummary.status, 'no_action');
assert.equal(noActionSummary.statusLabel, 'No requiere acción');
assert(noActionSummary.gapRvPp < IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP);
assert(noActionSummary.totalTradePortfolioPct < 1.5);

const optionalSummary = classifyImplementationMateriality({
  currentWeights: buildWeights(0.33, 0.25, 0.22, 0.2),
  plan: buildPlan({
    currentMix: { rv: 0.585, rf: 0.415 },
    gapVsIdealRvPp: 1.5,
    transfers: [
      {
        ...buildPlan().transfers[0],
        weightMoved: 0.022,
        amountClpMoved: 30_000_000,
      },
    ],
  }),
});
assert.equal(optionalSummary.status, 'optional');

const recommendedSummary = classifyImplementationMateriality({
  currentWeights: buildWeights(0.28, 0.22, 0.26, 0.24),
  plan: buildPlan({
    currentMix: { rv: 0.5, rf: 0.5 },
    gapVsIdealRvPp: 10,
    equivalentToIdeal: false,
    baseTargetWeights: buildWeights(0.4, 0.2, 0.2, 0.2),
    reachableWeights: buildWeights(0.38, 0.19, 0.21, 0.22),
    transfers: [
      {
        ...buildPlan().transfers[0],
        weightMoved: 0.05,
        amountClpMoved: 80_000_000,
      },
    ],
  }),
});
assert.equal(recommendedSummary.status, 'recommended');
assert.equal(recommendedSummary.sleeveValidation.rows[0].label, 'RV global');
assert.equal(recommendedSummary.sleeveValidation.rows[1].label, 'RV local / Chile');
assert.equal(recommendedSummary.sleeveValidation.rows[2].label, 'RF global');
assert.equal(recommendedSummary.sleeveValidation.rows[3].label, 'RF local / Chile');

const zeroWeightDestinationPlan = buildInstrumentImplementationPlan({
  universe: buildImplementationUniverse(),
  targetWeights: buildWeights(0.6, 0, 0.4, 0),
});
assert(zeroWeightDestinationPlan);
assert.equal(zeroWeightDestinationPlan.transfers.length, 1);
assert.equal(zeroWeightDestinationPlan.transfers[0].fromInstrumentId, 'sura-rf');
assert.equal(zeroWeightDestinationPlan.transfers[0].toInstrumentId, 'sura-rv');
assert.equal(zeroWeightDestinationPlan.transfers[0].constraints.sameCurrency, true);
assert.equal(zeroWeightDestinationPlan.transfers[0].constraints.sameManager, true);
assert.equal(zeroWeightDestinationPlan.transfers[0].stage, 'clean');
assert(zeroWeightDestinationPlan.reachableMix.rv >= 0.6 - 1e-9);

const needsCrossManagerPlan = buildInstrumentImplementationPlan({
  universe: buildUniverseNeedingCrossManager(),
  targetWeights: buildWeights(0.9, 0, 0.1, 0),
});
assert(needsCrossManagerPlan);
assert(needsCrossManagerPlan.transfers.some((row) => row.stage === 'cross_manager'));
assert(!needsCrossManagerPlan.transfers.some((row) => row.stage === 'cross_currency'));
const crossManagerSummary = needsCrossManagerPlan.stageSummaries.find((row) => row.stage === 'cross_manager');
assert(crossManagerSummary);
if (Math.abs(needsCrossManagerPlan.gapVsIdealRvPp) > 3 + 1e-9) {
  assert.notEqual(crossManagerSummary.statusReason, 'not_required');
}
assert(needsCrossManagerPlan.destinationDiagnostics.some((row) => row.instrumentId === 'planvital-fondo-a' && row.eligible === false));
assert(needsCrossManagerPlan.destinationDiagnostics.some((row) =>
  row.instrumentId === 'planvital-fondo-a'
  && (
    row.reason.toLowerCase().includes('cuenta 2')
    || row.reason.toLowerCase().includes('no operable')
    || row.reason.toLowerCase().includes('cautivo')
  )));

const enrichedPlanVitalUniverse = buildImplementationUniverseInstruments(buildUniverseNeedingCrossManager().instruments);
const syntheticPlanVitalCuenta2 = enrichedPlanVitalUniverse.instruments.find((row) => row.instrumentId === 'planvital_fondo_a_cuenta2');
assert(syntheticPlanVitalCuenta2);
assert.equal(syntheticPlanVitalCuenta2.name, 'PlanVital Fondo A Cuenta 2');
assert.equal(syntheticPlanVitalCuenta2.taxWrapper, 'cuenta_2');
assert.equal(syntheticPlanVitalCuenta2.weightPortfolio, 0);
assert.equal(syntheticPlanVitalCuenta2.amountClp, 0);
assert.equal(syntheticPlanVitalCuenta2.decisionEligible, true);
assert.equal(syntheticPlanVitalCuenta2.isCaptive, false);
assert.equal(syntheticPlanVitalCuenta2.isSellable, false);
assert.equal(syntheticPlanVitalCuenta2.currentMixUsed?.rv, 1);
assert.equal(
  enrichedPlanVitalUniverse.instruments.find((row) => row.instrumentId === 'planvital-fondo-a')?.decisionEligible,
  false,
);

const planVitalCuenta2Plan = buildInstrumentImplementationPlan({
  universe: buildUniverseWithPlanVitalCuenta2Destination(),
  targetWeights: buildWeights(0.8, 0, 0.2, 0),
});
assert(planVitalCuenta2Plan);
assert(planVitalCuenta2Plan.transfers.some((row) => row.toInstrumentId === 'planvital-cuenta2-a'));
assert(!planVitalCuenta2Plan.transfers.some((row) => row.stage === 'cross_currency'));

const planVitalCuenta2FromLoaderPlan = buildInstrumentImplementationPlan({
  universe: {
    ...buildUniverseNeedingCrossManager(),
    instruments: enrichedPlanVitalUniverse.instruments,
  },
  targetWeights: buildWeights(0.8, 0, 0.2, 0),
});
assert(planVitalCuenta2FromLoaderPlan);

const planVitalNeededUniverse: InstrumentImplementationUniverse = {
  ...buildUniverseNeedingCrossManager(),
  instruments: enrichedPlanVitalUniverse.instruments.map((row) => {
    if (row.instrumentId === 'sura-rv') {
      return {
        ...row,
        currentMixUsed: { rv: 0.75, rf: 0.25, cash: 0, other: 0 },
      };
    }
    return row;
  }),
};
const planVitalNeededUniverseWithoutSynthetic: InstrumentImplementationUniverse = {
  ...planVitalNeededUniverse,
  instruments: planVitalNeededUniverse.instruments.filter((row) => row.instrumentId !== 'planvital_fondo_a_cuenta2'),
};
const planVitalNeededPlanWithoutSynthetic = buildInstrumentImplementationPlan({
  universe: planVitalNeededUniverseWithoutSynthetic,
  targetWeights: buildWeights(0.8, 0, 0.2, 0),
});
assert(planVitalNeededPlanWithoutSynthetic);
const planVitalNeededPlan = buildInstrumentImplementationPlan({
  universe: planVitalNeededUniverse,
  targetWeights: buildWeights(0.8, 0, 0.2, 0),
});
assert(planVitalNeededPlan);
assert(planVitalNeededPlan.transfers.some((row) => row.toInstrumentId === 'planvital_fondo_a_cuenta2'));
assert(planVitalNeededPlanWithoutSynthetic.transfers.every((row) => row.toInstrumentId !== 'planvital_fondo_a_cuenta2'));

const needsCrossCurrencyPlan = buildInstrumentImplementationPlan({
  universe: buildUniverseNeedingCrossCurrency(),
  targetWeights: buildWeights(0.95, 0, 0.05, 0),
});
assert(needsCrossCurrencyPlan);
assert(needsCrossCurrencyPlan.transfers.some((row) => row.stage === 'cross_currency'));
assert(needsCrossCurrencyPlan.warnings.some((warning) => warning.includes('cambio de moneda')));

const baseFingerprint = buildOptimizationInputFingerprint({
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  params: buildParams(),
});
const simulationFingerprint = buildOptimizationInputFingerprint({
  sourceMode: 'simulation',
  sourceLabel: 'Simulación activa',
  params: {
    ...buildParams(),
    simulation: {
      ...buildParams().simulation,
      nSim: 5000,
    },
  },
});
assert.notEqual(baseFingerprint, simulationFingerprint);
assert.equal(isOptimizationResultMetaCurrent({
  inputFingerprint: baseFingerprint,
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  scenarioLabel: null,
  nSim: 3000,
  seed: 123,
  ranAtLabel: '2026-05-18 10:00',
}, baseFingerprint), true);
assert.equal(isOptimizationResultMetaCurrent({
  inputFingerprint: baseFingerprint,
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  scenarioLabel: null,
  nSim: 3000,
  seed: 123,
  ranAtLabel: '2026-05-18 10:00',
}, simulationFingerprint), false);
assert.equal(isOptimizationResultMetaCurrent(null, baseFingerprint), false);
assert.equal(hasStaleOptimizationMeta(null, baseFingerprint), false);
assert.equal(hasStaleOptimizationMeta({
  inputFingerprint: baseFingerprint,
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  scenarioLabel: null,
  nSim: 3000,
  seed: 123,
  ranAtLabel: '2026-05-18 10:00',
}, baseFingerprint), false);
assert.equal(hasStaleOptimizationMeta({
  inputFingerprint: baseFingerprint,
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  scenarioLabel: null,
  nSim: 3000,
  seed: 123,
  ranAtLabel: '2026-05-18 10:00',
}, simulationFingerprint), true);

assert.equal(canUseDecisionFlowForImplementation(null), false);
assert.equal(canUseDecisionFlowForImplementation({
  stage: 'express',
  badge: 'Preliminar · Express',
  message: 'tmp',
  nSim: 750,
  stepPp: 10,
  candidateCount: 11,
  seed: 123,
  implementationEnabled: false,
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  scenarioLabel: null,
  inputFingerprint: baseFingerprint,
  ranAtLabel: null,
}), false);
assert.equal(canUseDecisionFlowForImplementation({
  stage: 'zoom',
  badge: 'Preliminar · Zoom refinado',
  message: 'tmp',
  nSim: 1000,
  stepPp: 5,
  candidateCount: 9,
  seed: 123,
  implementationEnabled: false,
  sourceMode: 'base',
  sourceLabel: 'Base vigente',
  scenarioLabel: null,
  inputFingerprint: baseFingerprint,
  ranAtLabel: null,
}), false);
assert.equal(canUseDecisionFlowForImplementation({
  stage: 'confirmed',
  badge: 'Confirmado · apto para implementación',
  message: 'tmp',
  nSim: 3000,
  stepPp: 5,
  candidateCount: 9,
  seed: 123,
  implementationEnabled: true,
  sourceMode: 'simulation',
  sourceLabel: 'Simulación activa',
  scenarioLabel: 'Base',
  inputFingerprint: simulationFingerprint,
  ranAtLabel: '2026-05-18 10:05',
}), true);
assert.equal(
  buildSimulationReconciliationMessage({ snapshot: { comparable: true }, nSim: 3000, seed: 123 }),
  'Actual validado contra Simulación.',
);
assert.equal(
  buildSimulationReconciliationMessage({ snapshot: { comparable: false }, nSim: 3000, seed: 123 }),
  'Actual recalculado en Optimización. No coincide exactamente con la corrida visible de Simulación.',
);
assert.equal(
  buildSimulationReconciliationMessage({ snapshot: null, nSim: 750, seed: 123 }),
  'Actual recalculado en Optimización con nSim 750 / seed 123.',
);

const initialMarkup = renderToStaticMarkup(
  React.createElement(OptimizationLightPage, {
    baseParams: buildParams(),
    simulationParams: buildParams(),
    simulationActive: false,
    simulationLabel: 'Test',
  }),
);

assert(initialMarkup.includes('Óptimo MIDAS recomendado'));
assert(initialMarkup.includes('Calcular Óptimo MIDAS recomendado'));
assert(initialMarkup.includes('Simulación activa no disponible: primero valida o recalcula Simulación.'));
assert(!initialMarkup.includes('Ejecutar Fase 1'));
assert(!initialMarkup.includes('Preparar diagnósticos complementarios'));
assert(!initialMarkup.includes('Fase 1'));
assert(!initialMarkup.includes('Fase 2'));
assert(!initialMarkup.includes('decisionProfiles.mainRecommendation'));
assert(!initialMarkup.includes('Decision RV/RF por perfiles'));
assert(!initialMarkup.includes('Pasa F2'));
assert(!initialMarkup.includes('No pasa F2'));
assert(!initialMarkup.includes('Campeón + retador'));
assert(!initialMarkup.includes('Baseline + ranking técnico'));

const simulationSourceMarkup = renderToStaticMarkup(
  React.createElement(OptimizationLightPage, {
    baseParams: buildParams(),
    simulationParams: buildParams(),
    simulationActive: true,
    simulationLabel: 'Base',
  }),
);
assert(simulationSourceMarkup.includes('Simulación activa'));
assert(simulationSourceMarkup.includes('Escenario: Base'));
assert(!simulationSourceMarkup.includes('Fuente usada: Base'));

const source = readFileSync(new URL('./OptimizationLightPage.tsx', import.meta.url), 'utf8');
assert(source.includes("onClick={runDecisionProfiles}"));
assert(source.includes("onClick={runDecisionConfirmation}"));
assert(!/Calcular Óptimo MIDAS recomendado[\\s\\S]{0,500}runPhase1/.test(source));
assert(!/Calcular Óptimo MIDAS recomendado[\\s\\S]{0,500}runPhase2/.test(source));
assert(source.includes('DECISION_EXPRESS_NSIM = 750'));
assert(source.includes('DECISION_ZOOM_NSIM = 1000'));
assert(source.includes('DECISION_OFFICIAL_GRID_STEP_PP = 5'));
assert(!source.includes('RV 69,25 / RF 30,75'));
assert(source.includes('Cálculo en segundo plano · puede avanzar más lento.'));
assert(source.includes('Chrome puede ralentizar cálculos en segundo plano; se verificará el progreso al volver.'));
assert(source.includes('Reanudar cálculo'));
assert(source.includes('Reiniciar cálculo'));
assert(source.includes('Estado ejecución:'));
assert(source.includes("document.addEventListener('visibilitychange'"));
assert(source.includes('buildOptimizationInputFingerprint'));
assert(source.includes('inputFingerprint'));
assert(source.includes('sourceMode'));
assert(source.includes('Traza diagnóstica de Optimización'));
assert(source.includes('JSON read-only del flujo Express'));
assert(source.includes('decisionDiagnosticTrace'));
assert(source.includes('decisionResultMeta'));
assert(source.includes('hasStaleOptimizationMeta'));
assert(source.includes('Resultado anterior: calculado con'));
assert(source.includes('Fuente usada:'));
assert(source.includes('Escenario:'));
assert(source.includes('Simulación activa'));
assert(source.includes('Base vigente'));
assert(source.includes('decisionProfilesRunning'));
assert(source.includes('setDecisionExecutionState(\'background\')'));
assert(source.includes('setDecisionExecutionState(\'interrupted\')'));
assert(source.includes('Referencia previa · no compite en la recomendación MIDAS'));
assert(source.includes('Escenarios evaluados por el modelo'));
assert(source.includes('Qué cambia frente a tu mix actual'));
assert(source.includes('Comparación confirmada'));
assert(source.includes('Comparación preliminar'));
assert(source.includes('Traspasos sugeridos por instrumento'));
assert(source.includes('Candidatos RV no usados / parcialmente usados'));
assert(source.includes('No implementable automáticamente por instrumento'));
assert(source.includes('No se encontraron traspasos ejecutables con las restricciones actuales.'));
assert(source.includes('Mix objetivo vs mix alcanzado estimado'));
assert(source.includes('Este es el mix estimado después de aplicar los traspasos sugeridos. Puede diferir del objetivo MIDAS por restricciones de instrumentos.'));
assert(source.includes('Validar mix alcanzado antes de ejecutar. Las métricas de éxito deben recalcularse sobre el mix alcanzado, no sobre el objetivo ideal.'));
assert(source.includes('Implementación parcial: falta'));
assert(source.includes('Revisar instrumentos bloqueados o agregar destinos operables.'));
assert(source.includes('Diagnóstico técnico por sleeve'));
assert(source.includes('La composición global/local es secundaria. La validación operativa principal es RV/RF total.'));
assert(source.includes('La implementación se aproxima al objetivo RV/RF.'));
assert(source.includes('Para implementar esto falta un instrumento destino compatible en RV/RF'));
assert(source.includes('Cross-currency bloqueado/manual'));
assert(source.includes('El óptimo financiero queda fuera de este bloque'));
assert(source.includes('Referencia autónoma: estima qué mix reduce mejor el riesgo financiero sin venta de casa, sin recortes adaptativos y sin capital de riesgo.'));
assert(source.includes('shortlist refinada con vecinos ±5pp/±10pp'));
assert(source.includes('buildOptimizationZoomFallbackShortlist'));
assert(source.includes('Express no produjo recomendación oficial; Zoom usó fallback local alrededor del mix actual redondeado.'));
assert(source.includes('const expressVisibleRv = expressRenderable?.rvPct ?? null;'));
assert(source.includes('preliminaryRecommendationRv: expressVisibleRv'));
assert(source.includes('expressRecommendationRv: expressVisibleRv ?? preliminaryMain?.rvPct ?? null'));
assert(source.includes('No hay candidatos oficiales de optimización para evaluar.'));
assert(source.includes('Mejor opción disponible bajo escenario exigente'));
assert(source.includes('No cumple todos los guardrails MIDAS'));
assert(source.includes('Implementación de contingencia: el candidato confirmado no cumple estándar MIDAS.'));
assert(source.includes('Confirmar mejor opción disponible'));
assert(source.includes('Qué cambia frente a tu mix actual — alternativa de contingencia'));
assert(source.includes('Ruta: Express'));
assert(source.includes('Mover'));
assert(source.includes('Monto CLP principal'));
assert(source.includes('Esto es una guía por sleeve, no una instrucción operativa por instrumento.'));
assert(source.includes('hasDecisionRunResult'));
assert(source.includes('hasEvaluatedCandidates'));
assert(source.includes('needsBestAvailableFallback'));
assert(source.includes('selectBestAvailableFallbackCandidate'));
assert(!source.includes('Métrica financiera principal: Patrimonio final P50'));
assert(!source.includes('Muestra qué mix maximiza el resultado económico'));

console.log('OptimizationLightPage tests passed');
