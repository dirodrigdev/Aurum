import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  buildOptimizationConfirmationShortlist,
  buildOptimizationExpressGrid,
  buildOptimizationZoomShortlist,
  canUseDecisionFlowForImplementation,
  classifyImplementationMateriality,
  selectClosestDiscardedCompetitor,
  selectFinancialOptimumCandidate,
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
assert(source.includes('DECISION_OFFICIAL_GRID_STEP_PP = 5'));
assert(!source.includes('RV 69,25 / RF 30,75'));
assert(source.includes('Cálculo en segundo plano · puede avanzar más lento.'));
assert(source.includes('Chrome puede ralentizar cálculos en segundo plano; se verificará el progreso al volver.'));
assert(source.includes('Reanudar cálculo'));
assert(source.includes('Reiniciar cálculo'));
assert(source.includes('Estado ejecución:'));
assert(source.includes("document.addEventListener('visibilitychange'"));
assert(source.includes('setDecisionExecutionState(\'background\')'));
assert(source.includes('setDecisionExecutionState(\'interrupted\')'));
assert(source.includes('Referencia previa · no compite en la recomendación MIDAS'));
assert(source.includes('Escenarios evaluados por el modelo'));
assert(source.includes('Qué cambia frente a tu mix actual'));
assert(source.includes('Comparación confirmada'));
assert(source.includes('Comparación preliminar'));
assert(source.includes('Traspasos sugeridos por instrumento'));
assert(source.includes('No implementable automáticamente bajo restricciones actuales.'));
assert(source.includes('Cross-currency bloqueado/manual'));
assert(source.includes('El óptimo financiero queda fuera de este bloque'));
assert(source.includes('Referencia autónoma: estima qué mix reduce mejor el riesgo financiero sin venta de casa, sin recortes adaptativos y sin capital de riesgo.'));
assert(source.includes('shortlist refinada con vecinos ±5pp/±10pp'));
assert(!source.includes('Métrica financiera principal: Patrimonio final P50'));
assert(!source.includes('Muestra qué mix maximiza el resultado económico'));

console.log('OptimizationLightPage tests passed');
