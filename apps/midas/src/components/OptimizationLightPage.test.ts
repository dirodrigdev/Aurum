import assert from 'node:assert/strict';
import type { InstrumentImplementationPlan } from '../domain/instrumentImplementationTypes';
import type { PortfolioWeights } from '../domain/model/types';
import {
  DECISION_EXPRESS_STEP_PP,
  IMPLEMENTATION_RV_RF_GAP_NO_ACTION_PP,
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

console.log('OptimizationLightPage tests passed');
