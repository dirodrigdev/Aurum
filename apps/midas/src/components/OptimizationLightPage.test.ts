import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InstrumentImplementationPlan } from '../domain/instrumentImplementationTypes';
import type { PortfolioWeights } from '../domain/model/types';
import type { ModelParameters } from '../domain/model/types';
import {
  DECISION_EXPRESS_STEP_PP,
  IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP,
  OptimizationLightPage,
  buildOptimizationConfirmationShortlist,
  buildOptimizationExpressGrid,
  buildOptimizationZoomShortlist,
  canUseDecisionFlowForImplementation,
  classifyImplementationMateriality,
} from './OptimizationLightPage';

function buildWeights(rvGlobal: number, rvChile: number, rfGlobal: number, rfChile: number): PortfolioWeights {
  return {
    rvGlobal,
    rvChile,
    rfGlobal,
    rfChile,
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

const expressGrid = buildOptimizationExpressGrid();
assert.deepEqual(expressGrid, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
assert.equal(expressGrid[1] - expressGrid[0], DECISION_EXPRESS_STEP_PP);

const zoomShortlist = buildOptimizationZoomShortlist({
  preliminaryRecommendationRv: 60,
  defensiveReferenceRv: 25,
  technicalPreludeRv: 55,
  currentRv: 59,
});
assert(zoomShortlist.includes(50));
assert(zoomShortlist.includes(55));
assert(zoomShortlist.includes(60));
assert(zoomShortlist.includes(65));
assert(zoomShortlist.includes(70));
assert(zoomShortlist.includes(25));
assert(zoomShortlist.includes(80));
assert(zoomShortlist.includes(100));
assert.equal(new Set(zoomShortlist).size, zoomShortlist.length);
assert.equal(zoomShortlist[0], 15);
assert.equal(zoomShortlist[zoomShortlist.length - 1], 100);

const boundedZoom = buildOptimizationZoomShortlist({
  preliminaryRecommendationRv: 0,
  defensiveReferenceRv: 100,
  technicalPreludeRv: null,
  currentRv: null,
});
assert.equal(boundedZoom[0], 0);
assert.equal(boundedZoom[boundedZoom.length - 1], 100);
assert(!boundedZoom.some((value) => value < 0 || value > 100));

const confirmationShortlist = buildOptimizationConfirmationShortlist({
  zoomRecommendationRv: 60,
  defensiveReferenceRv: 25,
  technicalPreludeRv: 55,
  currentRv: 59,
});
assert(confirmationShortlist.length < 21);
assert(confirmationShortlist.includes(50));
assert(confirmationShortlist.includes(55));
assert(confirmationShortlist.includes(60));
assert(confirmationShortlist.includes(65));
assert(confirmationShortlist.includes(70));
assert(confirmationShortlist.includes(100));

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

assert.equal(canUseDecisionFlowForImplementation(null), false);
assert.equal(canUseDecisionFlowForImplementation({
  stage: 'express',
  badge: 'Express · preliminar',
  message: 'tmp',
  nSim: 750,
  stepPp: 10,
  candidateCount: 11,
  seed: 123,
  implementationEnabled: false,
}), false);
assert.equal(canUseDecisionFlowForImplementation({
  stage: 'zoom',
  badge: 'Zoom · preliminar refinado',
  message: 'tmp',
  nSim: 1000,
  stepPp: 5,
  candidateCount: 9,
  seed: 123,
  implementationEnabled: false,
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
}), true);

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

const source = readFileSync(new URL('./OptimizationLightPage.tsx', import.meta.url), 'utf8');
assert(source.includes("onClick={runDecisionProfiles}"));
assert(source.includes("onClick={runDecisionConfirmation}"));
assert(!/Calcular Óptimo MIDAS recomendado[\\s\\S]{0,500}runPhase1/.test(source));
assert(!/Calcular Óptimo MIDAS recomendado[\\s\\S]{0,500}runPhase2/.test(source));
assert(source.includes('DECISION_EXPRESS_NSIM = 750'));
assert(source.includes('DECISION_ZOOM_NSIM = 1000'));

console.log('OptimizationLightPage tests passed');
