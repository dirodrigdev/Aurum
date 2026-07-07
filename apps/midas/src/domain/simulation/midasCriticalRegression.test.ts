import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEditableMoneyInput, parseHeroQuickEditReturnInput, parseHeroQuickEditYearsInput } from '../../components/SimulationPage';
import { applyCandidateToM8Input } from '../optimization/applyCandidateToM8Input';
import type { MidasCandidate } from '../optimization/candidateSet';
import { DEFAULT_PARAMETERS } from '../model/defaults';
import { buildM8InputFingerprint, type M8InputFingerprintInput } from '../model/m8InputFingerprint';
import { buildSimulationInputSyncState, buildSimulationVisualStatus } from '../model/simulationActionStatus';
import type { ModelParameters } from '../model/types';
import { resolveCapital } from './capitalResolver';
import { toM8Input } from './m8Adapter';

const cloneParams = (): ModelParameters => JSON.parse(JSON.stringify(DEFAULT_PARAMETERS)) as ModelParameters;

function buildCanonicalParams(): ModelParameters {
  const params = cloneParams();
  const optimizableInvestmentsCLP = 1_500_000_000;
  const banksCLP = 50_000_000;
  const propertyValueCLP = 900_000_000;
  const mortgageDebtOutstandingCLP = 100_000_000;

  params.label = 'Aurum cierre canonico 2026-04';
  params.capitalSource = 'aurum';
  params.simulationBaseMonth = '2026-04';
  params.capitalInitial = optimizableInvestmentsCLP + banksCLP;
  params.simulation = {
    ...params.simulation,
    horizonMonths: 480,
    nSim: 1_000,
    seed: 42,
  };
  params.simulationComposition = {
    mode: 'full',
    totalNetWorthCLP: optimizableInvestmentsCLP + banksCLP + propertyValueCLP - mortgageDebtOutstandingCLP,
    optimizableInvestmentsCLP,
    nonOptimizable: {
      banksCLP,
      nonMortgageDebtCLP: 0,
      realEstate: {
        propertyValueCLP,
        mortgageDebtOutstandingCLP,
        monthlyMortgagePaymentCLP: 0,
        ufSnapshotCLP: 38_000,
        snapshotMonth: '2026-04',
      },
    },
  };
  params.realEstatePolicy = {
    ...(params.realEstatePolicy ?? {
      enabled: true,
      triggerRunwayMonths: 36,
      saleDelayMonths: 12,
      saleCostPct: 0,
      realAppreciationAnnual: 0,
    }),
    enabled: true,
  };

  return params;
}

function buildFingerprintInput(params: ModelParameters, effectiveEngineInput: unknown): M8InputFingerprintInput {
  return {
    params,
    effectiveEngineInput,
    riskCapitalEnabled: false,
    riskCapitalEffective: false,
    weightsSourceMode: 'instrument-universe',
    universeSourceOrigin: 'firestore',
    aurumSnapshotMonth: '2026-04',
    aurumSnapshotLabel: '2026-04',
    aurumSnapshotPublishedAt: '2026-05-07T10:00:00.000Z',
    aurumSnapshotSignature: 'snap-regression',
    simulationConfigSource: 'cloud',
    simulationConfigSavedAt: '2026-05-07T10:01:00.000Z',
    simulationConfigHash: 'cfg-regression',
    instrumentUniverseSavedAt: '2026-05-07T10:02:00.000Z',
    instrumentUniverseHash: 'universe-regression',
    hydratedCloudSources: true,
  };
}

(() => {
  assert.equal(parseHeroQuickEditReturnInput(''), null, 'temporary empty return input must be allowed while editing');
  assert.equal(parseHeroQuickEditReturnInput('4'), 4);
  assert.equal(parseHeroQuickEditReturnInput('4.0'), 4);
  assert.equal(parseHeroQuickEditReturnInput('4,0'), 4);
  assert.equal(parseHeroQuickEditReturnInput('-10'), -10);
  assert.equal(parseHeroQuickEditReturnInput('30'), 30);
  assert.equal(parseHeroQuickEditReturnInput('31'), null, 'out-of-range return input must not be accepted');

  assert.equal(parseHeroQuickEditYearsInput(''), null, 'temporary empty horizon input must be allowed while editing');
  assert.equal(parseHeroQuickEditYearsInput('40'), 40);
  assert.equal(parseHeroQuickEditYearsInput('40.5'), null, 'horizon years stay integer-only');

  assert.equal(parseEditableMoneyInput(''), null, 'temporary empty money input must be allowed while editing');
  assert.equal(parseEditableMoneyInput('200.000.000'), 200_000_000);
  assert.equal(parseEditableMoneyInput('200000000'), 200_000_000);
  assert.equal(parseEditableMoneyInput('200,5'), 200.5);
  assert.equal(parseEditableMoneyInput('-1'), null, 'negative manual capital input must not be accepted');
})();

(() => {
  const baseParams = buildCanonicalParams();
  const withFutureFlow = buildCanonicalParams();
  withFutureFlow.futureCapitalEvents = [
    {
      id: 'manual-future-2039',
      type: 'inflow',
      amount: 200_000_000,
      currency: 'CLP',
      effectiveDate: '2039-01',
      description: 'Ajuste futuro +200MM',
    },
  ];

  const baseCapital = resolveCapital({ params: baseParams });
  const futureCapital = resolveCapital({ params: withFutureFlow });
  const baseM8Input = toM8Input(baseParams, baseCapital);
  const futureM8Input = toM8Input(withFutureFlow, futureCapital);

  assert.equal(baseM8Input.capital_initial_clp, 1_550_000_000, 'T0 must include only current optimizable investments plus banks');
  assert.equal(futureM8Input.capital_initial_clp, baseM8Input.capital_initial_clp, 'future flows must stay outside T0');
  assert.equal(futureM8Input.house?.include_house, true, 'real estate channel remains explicit');
  assert.equal(futureM8Input.capital_initial_clp < Number(withFutureFlow.simulationComposition?.totalNetWorthCLP), true, 'house equity must not be folded into T0');
  assert.deepEqual(futureM8Input.future_events, [
    {
      id: 'manual-future-2039',
      type: 'inflow',
      amount: 200_000_000,
      currency: 'CLP',
      effective_month: 154,
      description: 'Ajuste futuro +200MM',
    },
  ]);

  const baseFingerprint = buildM8InputFingerprint(buildFingerprintInput(baseParams, baseM8Input));
  const futureFingerprint = buildM8InputFingerprint(buildFingerprintInput(withFutureFlow, futureM8Input));
  assert.notEqual(
    baseFingerprint.effectiveEngineInputHash,
    futureFingerprint.effectiveEngineInputHash,
    'adding a future flow must change the evaluated M8 fingerprint',
  );
})();

(() => {
  const baseParams = buildCanonicalParams();
  const t0ScenarioParams = buildCanonicalParams();
  t0ScenarioParams.capitalInitial += 100_000_000;
  t0ScenarioParams.simulationComposition = {
    ...t0ScenarioParams.simulationComposition!,
    totalNetWorthCLP: t0ScenarioParams.simulationComposition!.totalNetWorthCLP + 100_000_000,
    optimizableInvestmentsCLP: t0ScenarioParams.simulationComposition!.optimizableInvestmentsCLP + 100_000_000,
  };

  const baseM8Input = toM8Input(baseParams, resolveCapital({ params: baseParams }));
  const t0ScenarioM8Input = toM8Input(t0ScenarioParams, resolveCapital({ params: t0ScenarioParams }));
  assert.equal(
    t0ScenarioM8Input.capital_initial_clp,
    baseM8Input.capital_initial_clp + 100_000_000,
    'allowed T0 manual/current adjustment must evaluate as a scenario input',
  );
})();

(() => {
  const currentBase = buildSimulationVisualStatus({
    inputSyncStatus: buildSimulationInputSyncState({
      visibleInputFingerprint: 'fnv1a-base',
      resultFingerprint: 'fnv1a-base',
      lastEvaluatedInputFingerprint: 'fnv1a-base',
    }).status,
    hasVisibleScenarioChanges: false,
    hasBlockingError: false,
  });
  assert.deepEqual(currentBase, { status: 'base', label: 'Base' });

  const currentScenario = buildSimulationVisualStatus({
    inputSyncStatus: buildSimulationInputSyncState({
      visibleInputFingerprint: 'fnv1a-scenario',
      resultFingerprint: 'fnv1a-scenario',
      lastEvaluatedInputFingerprint: 'fnv1a-scenario',
    }).status,
    hasVisibleScenarioChanges: true,
    hasBlockingError: false,
  });
  assert.deepEqual(currentScenario, { status: 'scenario', label: 'Escenario' });

  const pendingScenario = buildSimulationVisualStatus({
    inputSyncStatus: buildSimulationInputSyncState({
      visibleInputFingerprint: 'fnv1a-visible',
      resultFingerprint: 'fnv1a-evaluated',
      lastEvaluatedInputFingerprint: 'fnv1a-evaluated',
    }).status,
    hasVisibleScenarioChanges: true,
    hasBlockingError: false,
  });
  assert.deepEqual(pendingScenario, { status: 'pending', label: 'Pendiente' });

  const errorScenario = buildSimulationVisualStatus({
    inputSyncStatus: 'current',
    hasVisibleScenarioChanges: true,
    hasBlockingError: true,
  });
  assert.deepEqual(errorScenario, { status: 'error', label: 'Error' });

  const labels = [currentBase.label, currentScenario.label, pendingScenario.label, errorScenario.label] as readonly string[];
  assert.equal(labels.includes('Revisar'), false);
  assert.equal(labels.includes('No usar'), false);
})();

(() => {
  const params = buildCanonicalParams();
  const baseM8Input = toM8Input(params, resolveCapital({ params }));
  const incompletePatch: MidasCandidate = {
    candidateId: 'partial_spending_patch',
    changes: {
      spendingPhases: {
        phase1MonthlyClp: 6_500_000,
      },
    },
  };
  const applied = applyCandidateToM8Input(baseM8Input, incompletePatch);
  assert.equal(applied.ok, false, 'Scenario Lab must not evaluate partial spending phase patches as valid M8 input');
  if (!applied.ok) {
    assert.ok(applied.errors.some((error) => error.includes('4 montos positivos')));
  }
})();

(() => {
  const settingsSource = readFileSync(new URL('../../components/SettingsPage.tsx', import.meta.url), 'utf8');
  const mountHydrationBlock = settingsSource.match(
    /useEffect\(\(\) => \{\s*let cancelled = false;[\s\S]*?return \(\) => \{\s*cancelled = true;\s*\};\s*\}, \[\]\);/,
  );
  assert.ok(mountHydrationBlock, 'Settings mount hydration effect should exist');
  assert.doesNotMatch(
    mountHydrationBlock[0],
    /window\.dispatchEvent\(new CustomEvent\('midas:instrument-universe-updated'\)\);/,
    'opening Settings must not broadcast a fake universe update that can mark simulation as pending without semantic changes',
  );
})();

console.log('midasCriticalRegression tests passed');
