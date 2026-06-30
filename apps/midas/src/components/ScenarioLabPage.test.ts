import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ScenarioLabPage,
  buildScenarioLabExportState,
  buildScenarioLabM8EvaluationState,
  validateScenarioLabCandidateSetText,
} from './ScenarioLabPage';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import type { ResultConfidence } from '../domain/model/resultConfidence';
import type { SimulationResultDiagnostics } from '../domain/model/simulationResultDigest';
import type { SimulationRunBlockedReason } from '../domain/model/simulationRunGate';
import type { SimulationResults } from '../domain/model/types';

const source = readFileSync(new URL('./ScenarioLabPage.tsx', import.meta.url), 'utf8');

function buildProps(blocked = false) {
  const fingerprint = {
    hash: 'fnv1a-959dded4',
    effectiveEngineInputHash: 'fnv1a-959dded4',
    diagnosticHash: 'diag-123',
    hashIncludesDiagnostics: false,
    manualLocalAdjustmentsAffectEngine: false,
    normalizedInput: {
      simulation: {
        seed: 42,
        nSim: 1000,
      },
    },
    sources: {
      aurumSnapshot: { source: 'cloud', savedAt: '2026-06-30T00:00:00.000Z', hash: 'snap', detail: 'snapshot' },
      instrumentUniverse: { source: 'cloud', savedAt: '2026-06-30T00:00:00.000Z', hash: 'uni', detail: 'instrument-universe' },
      simulationParams: { source: 'cloud', savedAt: '2026-06-30T00:00:00.000Z', hash: 'cfg', detail: 'loaded' },
      spendingPhases: { source: 'cloud', savedAt: '2026-06-30T00:00:00.000Z', hash: 'spend', detail: '4 fases' },
      fx: { source: 'mixed', savedAt: '2026-06-30T00:00:00.000Z', hash: 'fx', detail: 'USD/CLP 900' },
    },
    warnings: [],
    createdAt: '2026-06-30T00:00:00.000Z',
    diagnosticInput: {
      replayTrace: {
        canonicalInput: {
          label: 'Modelo Base',
          baseLabel: null,
          m8Input: {
            simulation: { seed: 42, nSim: 1000 },
          },
          simulationBaseMonth: null,
          effectiveCapitalInitialClp: 1500000000,
          spendingPhases: { F1: 1, F2: 2, F3: 3, F4: 4 },
          portfolioMix: {},
          houseConfig: {},
          riskConfig: { riskCapitalClp: 0, riskCapitalPolicy: null, riskCapitalBtcDriver: null },
          cutsConfig: {},
          bucketConfig: {},
          futureEvents: [],
        },
        sourceMetadata: {
          simulationActiveV1: {
            pathLogical: 'users/{uid}/midas_config/simulationActiveV1',
            source: 'cloud',
            savedAt: '2026-06-30T00:00:00.000Z',
            hash: 'cfg',
            label: 'Modelo Base',
            baseLabel: null,
            readStatus: 'loaded',
            exists: true,
            missingFields: [],
          },
          instrumentUniverse: {
            source: 'cloud',
            sourceOrigin: 'firestore',
            weightsMode: 'instrument-universe',
            savedAt: '2026-06-30T00:00:00.000Z',
            hash: 'uni',
            cloudReadStatus: 'loaded',
            detail: null,
          },
          aurumSnapshot: {
            source: 'cloud',
            month: '2026-06',
            label: '2026-06 cierre',
            publishedAt: '2026-06-30T00:00:00.000Z',
            hash: 'snap',
          },
          fieldSources: {},
          capitalDerivation: {},
        },
        readiness: {
          canonicalInputReady: !blocked,
          state: blocked ? 'blocked' : 'ready',
          pendingSource: blocked ? 'simulationActiveV1' : null,
          blockedReason: blocked ? 'config_loading' : null,
          statusMessage: blocked ? 'Config cloud todavía cargando.' : null,
          simulationRunStatus: blocked ? 'blocked' : 'completed',
          simulated: !blocked,
          resultMetricsAvailable: !blocked,
        },
        fingerprints: {
          effectiveEngineInputFingerprint: 'fnv1a-959dded4',
          m8Fingerprint: 'fnv1a-959dded4',
          diagnosticFingerprint: 'diag-123',
          simulationConfigHash: 'cfg',
          instrumentUniverseFingerprint: 'uni',
          aurumSnapshotFingerprint: 'snap',
        },
        sourcePolicy: {
          isComparable: !blocked,
          warnings: [],
        },
      },
    },
  } as unknown as M8InputFingerprint;
  const diagnostics = {
    resultDigest: blocked ? null : 'digest-123',
  } as unknown as SimulationResultDiagnostics;
  const resultConfidence = {
    canUseForDecision: !blocked,
    status: blocked ? 'not_decisional' : 'canonical',
  } as unknown as ResultConfidence;
  const simResult = blocked ? null : ({
    success40: 0.916,
    probRuin40: 0.084,
    probRuin: 0.084,
    qualityOfLifeMetrics: {
      terminalWealthRatio: 2.1814,
      csr85_4: 0.737,
      qualitySurvivalRate: 0.154,
    },
  } as unknown as SimulationResults);
  return {
    canonicalInputReady: !blocked,
    canonicalInputBlockedReason: (blocked ? 'config_loading' : null) as SimulationRunBlockedReason | null,
    m8InputFingerprint: fingerprint,
    simulationResultDiagnostics: diagnostics,
    resultConfidence,
    simResult,
  };
}

const readyMarkup = renderToStaticMarkup(React.createElement(ScenarioLabPage, buildProps(false)));
assert(readyMarkup.includes('Laboratorio de Escenarios'));
assert(readyMarkup.includes('Exploratorio · no decisional'));
assert(readyMarkup.includes('La IA genera candidatos. MIDAS calcula resultados. Tú decides.'));
assert(readyMarkup.includes('La IA externa puede hacer pre-screening heurístico.'));
assert(readyMarkup.includes('Puede calcular scores proxy, pero no resultados M8.'));
assert(readyMarkup.includes('Evaluar candidatos con M8'));
assert(readyMarkup.includes('Baseline M8 sellado'));

const blockedProps = buildProps(true);
const blockedState = buildScenarioLabExportState({
  canonicalInputReady: blockedProps.canonicalInputReady,
  canonicalInputBlockedReason: blockedProps.canonicalInputBlockedReason,
  fingerprint: blockedProps.m8InputFingerprint,
  simulationResultDiagnostics: blockedProps.simulationResultDiagnostics,
  resultConfidence: blockedProps.resultConfidence,
  simResult: blockedProps.simResult,
});
assert.equal(blockedState.enabled, false);
const blockedEvaluationState = buildScenarioLabM8EvaluationState({
  exportState: blockedState,
  optimizationPack: null,
  candidateValidation: null,
});
assert.equal(blockedEvaluationState.enabled, false);

const validCandidateSet = validateScenarioLabCandidateSetText(JSON.stringify({
  type: 'midas_candidate_set',
  version: '1.0',
  packFingerprint: 'fnv1a-959dded4',
  selectedGoals: ['improve_quality_of_life'],
  customGoals: [],
  constraints: {},
  generationSummary: {
    approach: 'ai_proxy_prescreening',
    internalCandidatesConsidered: 22,
    candidateCountBeforeUserReview: 12,
    candidateCountAfterUserReview: 8,
    screeningCriteria: ['liquidez'],
    userReviewedBeforeJson: true,
    notes: ['Proxy heurístico, no resultado oficial.'],
  },
  candidates: [
    {
      candidateId: 'qol_001',
      heuristicPriority: 'high',
      preM8Score: 82,
      preM8ScoreExplanation: 'Proxy heurístico, no resultado oficial.',
      expectedDirectionalEffects: {
        qualityOfLife: 'likely_improve',
      },
      changes: { cutRules: { cut1: 0.92 } },
    },
  ],
}), 'fnv1a-959dded4');
assert.equal(validCandidateSet.ok, true);
const enabledEvaluationState = buildScenarioLabM8EvaluationState({
  exportState: buildScenarioLabExportState({
    canonicalInputReady: true,
    canonicalInputBlockedReason: null,
    fingerprint: buildProps(false).m8InputFingerprint,
    simulationResultDiagnostics: buildProps(false).simulationResultDiagnostics,
    resultConfidence: buildProps(false).resultConfidence,
    simResult: buildProps(false).simResult,
  }),
  optimizationPack: {
    baseline: { fingerprint: 'fnv1a-959dded4' },
  } as any,
  candidateValidation: validCandidateSet,
});
assert.equal(enabledEvaluationState.enabled, true);

const validMarkup = renderToStaticMarkup(React.createElement(ScenarioLabPage, {
  ...buildProps(false),
}));
assert(validMarkup.includes('Pégalo en una IA externa.'));

const invalidJson = validateScenarioLabCandidateSetText('{', 'fnv1a-959dded4');
assert.equal(invalidJson.ok, false);

const forbiddenVariables = validateScenarioLabCandidateSetText(JSON.stringify({
  type: 'midas_candidate_set',
  version: '1.0',
  packFingerprint: 'fnv1a-959dded4',
  selectedGoals: ['improve_quality_of_life'],
  customGoals: [],
  constraints: {},
  candidates: [
    {
      candidateId: 'qol_001',
      changes: { observedFx: 999 },
    },
  ],
}), 'fnv1a-959dded4');
assert.equal(forbiddenVariables.ok, false);

const forbiddenOfficialMetric = validateScenarioLabCandidateSetText(JSON.stringify({
  type: 'midas_candidate_set',
  version: '1.0',
  packFingerprint: 'fnv1a-959dded4',
  selectedGoals: ['improve_quality_of_life'],
  customGoals: [],
  constraints: {},
  candidates: [
    {
      candidateId: 'qol_001',
      success40: 0.91,
      changes: { cutRules: { cut1: 0.92 } },
    },
  ],
}), 'fnv1a-959dded4');
assert.equal(forbiddenOfficialMetric.ok, false);

assert.equal(source.includes('runSimulationCentral('), false);
assert.equal(source.includes('persistActiveSimulationConfig'), false);
assert.equal(source.includes('Proxy IA · no M8'), true);
assert.equal(source.includes('Este score es preliminar. M8 todavía no evaluó el candidato.'), true);
assert.equal(source.includes('Evaluar candidatos con M8'), true);
assert.equal(source.includes('Exploratorio evaluado por M8'), true);

console.log('ScenarioLabPage tests passed');
