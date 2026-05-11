import assert from 'node:assert/strict';
import { buildM8InputFingerprint } from './m8InputFingerprint';
import type { M8InputFingerprintInput } from './m8InputFingerprint';
import { DEFAULT_PARAMETERS } from './defaults';
import type { ModelParameters } from './types';

const clone = (value: ModelParameters): ModelParameters => JSON.parse(JSON.stringify(value)) as ModelParameters;

const baseInput = (): M8InputFingerprintInput => {
  const params = clone(DEFAULT_PARAMETERS);
  params.simulation.nSim = 3000;
  params.simulation.seed = 42;
  params.spendingPhases = [
    { durationMonths: 120, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 4_000_000, currency: 'CLP' },
    { durationMonths: 120, amountReal: 3_000_000, currency: 'CLP' },
  ];
  return {
    params,
    effectiveEngineInput: {
      capital_initial_clp: Number(params.capitalInitial ?? 0),
      seed: Number(params.simulation.seed ?? 0),
      n_paths: Number(params.simulation.nSim ?? 0),
      bucket: { bucket_months: Number(params.bucketMonths ?? 0) },
      phase1MonthlyClp: Number(params.spendingPhases?.[0]?.amountReal ?? 0),
      phase2MonthlyClp: Number(params.spendingPhases?.[1]?.amountReal ?? 0),
      phase3MonthlyClp: Number(params.spendingPhases?.[2]?.amountReal ?? 0),
      phase4MonthlyClp: Number(params.spendingPhases?.[3]?.amountReal ?? 0),
      return_assumptions: {
        eq_global_real_annual: Number(params.returns.rvGlobalAnnual ?? 0),
        fi_global_real_annual: Number(params.returns.rfGlobalAnnual ?? 0),
        eq_chile_real_annual: Number(params.returns.rvChileAnnual ?? 0),
        fi_chile_real_annual: Number(params.returns.rfChileUFAnnual ?? 0),
      },
    },
    riskCapitalEnabled: true,
    riskCapitalEffective: true,
    weightsSourceMode: 'instrument-universe',
    universeSourceOrigin: 'firestore' as const,
    aurumSnapshotLabel: '2026-04',
    aurumSnapshotPublishedAt: '2026-05-07T10:00:00.000Z',
    aurumSnapshotSignature: 'snap-abc',
    simulationConfigSource: 'cloud',
    simulationConfigSavedAt: '2026-05-07T10:01:00.000Z',
    simulationConfigHash: 'cfg-abc',
    simulationConfigDiagnostics: {
      path: 'midas_config/simulationActiveV1',
      previousGlobalConfigPath: 'midas_config/simulationActiveV1',
      projectId: 'test-project',
      configured: true,
      authUid: 'anon-test',
      authEmail: 'test@example.com',
      authProvider: 'google.com',
      isAnonymous: false,
      loginRequired: false,
      isCanonicalUserSession: true,
      readStatus: 'loaded',
      errorMessage: null,
      exists: true,
      updatedAt: '2026-05-07T10:01:10.000Z',
      activeHash: 'cfg-abc',
      activeSavedAt: '2026-05-07T10:01:00.000Z',
      activeParamsJsonExists: true,
      activeSpendingPhasesExists: true,
      activeSeedExists: true,
      activeNSimExists: true,
      activeBucketMonthsExists: true,
      legacyGlobalReadStatus: null,
      legacyGlobalErrorMessage: null,
      legacyGlobalExists: null,
      legacyGlobalHash: null,
      missingFields: [],
    },
    instrumentUniverseSavedAt: '2026-05-07T10:02:00.000Z',
    instrumentUniverseHash: 'u-abc',
    hydratedCloudSources: true,
  };
};

(() => {
  const first = buildM8InputFingerprint(baseInput());
  const second = buildM8InputFingerprint(baseInput());
  assert.equal(first.effectiveEngineInputHash, second.effectiveEngineInputHash, 'same effective input must produce same hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: 1_000_000_000,
    optimizableInvestmentsCLP: 800_000_000,
    nonOptimizable: {
      banksCLP: 100_000_000,
      nonMortgageDebtCLP: 0,
    },
  };
  const withBanks = buildM8InputFingerprint(input);
  input.params.simulationComposition.nonOptimizable.banksCLP = 120_000_000;
  input.params.capitalInitial += 20_000_000;
  (input.effectiveEngineInput as any).capital_initial_clp += 20_000_000;
  const changed = buildM8InputFingerprint(input);
  assert.equal(original.effectiveEngineInputHash, withBanks.effectiveEngineInputHash, 'composition diagnostics alone must not change effective engine hash');
  assert.notEqual(withBanks.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing effective capital must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.spendingPhases[0].amountReal = 6_200_000;
  (input.effectiveEngineInput as any).phase1MonthlyClp = 6_200_000;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing F1 must change hash');
})();

(() => {
  const original = buildM8InputFingerprint(baseInput());
  [1, 2, 3].forEach((index) => {
    const input = baseInput();
    input.params.spendingPhases[index].amountReal += 100_000 * (index + 1);
    (input.effectiveEngineInput as any)[`phase${index + 1}MonthlyClp`] += 100_000 * (index + 1);
    const changed = buildM8InputFingerprint(input);
    assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, `changing F${index + 1} must change hash`);
  });
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.capitalInitial = Number(input.params.capitalInitial) + 10_000_000;
  (input.effectiveEngineInput as any).capital_initial_clp += 10_000_000;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing capital must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.simulation.seed = 84;
  (input.effectiveEngineInput as any).seed = 84;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing seed must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.simulation.nSim = 5000;
  (input.effectiveEngineInput as any).n_paths = 5000;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing nSim must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.activeScenario = 'pessimistic';
  const changed = buildM8InputFingerprint(input);
  assert.equal(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing diagnostics-only scenario label must not change effective engine hash unless m8 input changes');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.returns.rvGlobalAnnual += 0.01;
  (input.effectiveEngineInput as any).return_assumptions.eq_global_real_annual += 0.01;
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing return assumptions must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.params.weights.rvGlobal += 0.01;
  input.params.weights.rfGlobal -= 0.01;
  (input.effectiveEngineInput as any).portfolio_mix = { changed: true };
  const changed = buildM8InputFingerprint(input);
  assert.notEqual(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing RV/RF mix must change hash');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.instrumentUniverseHash = 'u-def';
  const changed = buildM8InputFingerprint(input);
  assert.equal(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing source hash only must not change effective engine hash');
  assert.notEqual(original.diagnosticHash, changed.diagnosticHash, 'diagnostic hash should capture source changes');
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.simulationConfigSource = 'local_cache';
  const changed = buildM8InputFingerprint(input);
  assert.equal(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'changing config source alone must not change effective engine hash');
  assert.notEqual(original.diagnosticHash, changed.diagnosticHash, 'diagnostic hash should capture source changes');
})();

(() => {
  const input = baseInput();
  input.simulationConfigSource = 'local_cache';
  input.hydratedCloudSources = false;
  input.simulationConfigDiagnostics = {
    ...input.simulationConfigDiagnostics!,
    readStatus: 'error',
    errorMessage: 'Missing or insufficient permissions',
    exists: null,
  };
  const fingerprint = buildM8InputFingerprint(input);
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('Hydratación cloud incompleta')));
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('simulación no vienen desde cloud')));
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('Config cloud no hidratada')));
  assert.equal((fingerprint.diagnosticInput.cloudConfig as { readStatus: string }).readStatus, 'error');
})();

(() => {
  const input = baseInput();
  input.runtimeDiagnostics = {
    simulationRunStatus: 'completed',
    simulationRunStartedAt: '2026-05-11T10:00:00.000Z',
    simulationRunCompletedAt: '2026-05-11T10:00:02.000Z',
    blockedReason: null,
    lastRunInputHash: 'fnv1a-same',
    lastRenderedResultHash: 'fnv1a-same',
    resultMetricsAvailable: true,
    resultSource: 'simResult',
    staleResult: false,
    heroMetricsSource: 'simResult',
  };
  const fingerprint = buildM8InputFingerprint(input);
  const runtimeDiagnostics = fingerprint.diagnosticInput.runtimeDiagnostics as Record<string, unknown>;
  assert.equal(runtimeDiagnostics.simulationRunStatus, 'completed');
  assert.equal(runtimeDiagnostics.resultMetricsAvailable, true);
  assert.equal(runtimeDiagnostics.heroMetricsSource, 'simResult');
})();

(() => {
  const input = baseInput();
  input.capitalDerivationDiagnostics = {
    manualLocalAdjustmentsAffectEngine: false,
    manualAdjustmentsCount: 1,
    manualCurrentTotalDeltaClp: 20_000_000,
    manualAdjustmentsSource: 'localStorage:midas:manualCapitalAdjustments',
  };
  const fingerprint = buildM8InputFingerprint(input);
  assert.equal(fingerprint.manualLocalAdjustmentsAffectEngine, false);
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('residuales')));
})();

(() => {
  const input = baseInput();
  const original = buildM8InputFingerprint(input);
  input.authDiagnostics = { foo: 'bar' };
  input.runtimeDiagnostics = { hostname: 'mobile' };
  input.capitalDerivationDiagnostics = {
    manualLocalAdjustmentsAffectEngine: false,
    manualAdjustmentsCount: 1,
  };
  const changed = buildM8InputFingerprint(input);
  assert.equal(original.effectiveEngineInputHash, changed.effectiveEngineInputHash, 'auth/runtime diagnostics must not change effective engine hash');
  assert.notEqual(original.diagnosticHash, changed.diagnosticHash, 'diagnostic hash should change');
})();

(() => {
  const input = baseInput();
  input.capitalDerivationDiagnostics = {
    capitalFromAurumClp: 1_530_974_913,
    manualCapitalAdjustmentsClp: 20_000_000,
    capitalAfterManualAdjustmentsClp: 1_550_974_913,
    source: 'aurum_snapshot_cloud_plus_manual_local_adjustments',
    enabled: true,
    manualLocalAdjustmentsAffectEngine: true,
    manualAdjustmentsCount: 1,
  };
  (input.effectiveEngineInput as any).capital_initial_clp = 1_550_974_913;
  const fingerprint = buildM8InputFingerprint(input);
  assert.equal(fingerprint.manualLocalAdjustmentsAffectEngine, true);
  assert.ok(fingerprint.warnings.some((warning) => warning.includes('ajustes manuales locales')));
})();

console.log('m8InputFingerprint tests passed');
