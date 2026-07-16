import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCanonicalBaseSimulationParams } from '../App';
import { DEFAULT_PARAMETERS, SCENARIO_VARIANTS } from '../domain/model/defaults';
import { buildSourceFreshnessPolicy } from '../domain/model/sourceFreshnessPolicy';
import { applyScenarioVariant } from '../domain/simulation/engine';
import { resolveAurumEurUsdForMidas } from '../domain/model/operativeFx';
import { buildRunCapitalBreakdown } from '../domain/simulation/runCapitalPolicy';
import { resolveCapital } from '../domain/simulation/capitalResolver';
import { toM8Input } from '../domain/simulation/m8Adapter';
import {
  buildHeroTargetAgeQuestion,
  buildMixSourceCompactLabel,
  buildSourcePolicyUserSummary,
  computeCurrentAgeFromBirthDate,
  buildEnabledResourcesSubcopy,
  computeEnabledResourcesForUi,
  computeMidasConsideredWealth,
  summarizeManualAdjustmentsFuture,
  summarizeManualAdjustmentsT0,
} from './SimulationPage';

const source = readFileSync(new URL('./SimulationPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const adaptersSource = readFileSync(new URL('../integrations/aurum/adapters.ts', import.meta.url), 'utf8');
const sensitivitySource = readFileSync(new URL('./SensitivityPage.tsx', import.meta.url), 'utf8');
const bucketLabSource = readFileSync(new URL('./BucketLabPage.tsx', import.meta.url), 'utf8');
const bottomNavSource = readFileSync(new URL('./BottomNav.tsx', import.meta.url), 'utf8');
const qualityOfLifeSource = readFileSync(new URL('./QualityOfLifeMetricsBlock.tsx', import.meta.url), 'utf8');

const buildMixSourcePolicy = (savedAt: string) => buildSourceFreshnessPolicy({
  nowMs: Date.parse('2026-06-29T12:00:00.000Z'),
  canonicalInputReady: true,
  blockedReason: null,
  hasReplayTrace: true,
  m8Fingerprint: 'm8-123',
  diagnosticFingerprint: 'diag-123',
  simulationActiveV1: {
    source: 'cloud',
    savedAt: '2026-06-28T12:00:00.000Z',
    hash: 'cfg-1',
    readStatus: 'loaded',
    exists: true,
    missingFields: [],
    legacyGlobalReadStatus: null,
    legacyGlobalExists: null,
  },
  instrumentUniverse: {
    source: 'cloud',
    sourceOrigin: 'firestore',
    weightsMode: 'instrument-universe',
    savedAt,
    hash: 'uni-1',
    cloudReadStatus: 'loaded',
    localCacheAvailable: false,
  },
  aurumSnapshot: {
    source: 'cloud',
    month: '2026-06',
    label: '2026-06 cierre',
    publishedAt: '2026-06-27T12:00:00.000Z',
    hash: 'snap-1',
  },
  localDiagnostics: {
    persistedBaseExists: false,
    localReadOnlyFallbackActive: false,
  },
  capitalDerivation: {
    manualAdjustmentsCount: 0,
    manualAdjustmentsSource: null,
    manualLocalAdjustmentsAffectEngine: false,
  },
  warnings: [],
});

const computeWeightedReturn = (p: typeof DEFAULT_PARAMETERS) => (
  p.weights.rvGlobal * p.returns.rvGlobalAnnual
  + p.weights.rfGlobal * p.returns.rfGlobalAnnual
  + p.weights.rvChile * p.returns.rvChileAnnual
  + p.weights.rfChile * p.returns.rfChileUFAnnual
);

const cloneParams = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const canonicalBase = buildCanonicalBaseSimulationParams(cloneParams(DEFAULT_PARAMETERS));
const canonicalWeightedReturn = computeWeightedReturn(canonicalBase);
assert(Math.abs(canonicalWeightedReturn - computeWeightedReturn(DEFAULT_PARAMETERS)) < 1e-12);

const pessimisticVariant = SCENARIO_VARIANTS.find((variant) => variant.id === 'pessimistic');
assert(pessimisticVariant);
const pessimisticParams = applyScenarioVariant({
  ...cloneParams(DEFAULT_PARAMETERS),
  activeScenario: 'pessimistic',
}, pessimisticVariant!);
const pessimisticWeightedReturn = computeWeightedReturn(pessimisticParams as typeof DEFAULT_PARAMETERS);
assert(Math.abs(pessimisticWeightedReturn - 0.026705) < 1e-4);

const contaminatedBase = {
  ...cloneParams(DEFAULT_PARAMETERS),
  activeScenario: 'pessimistic' as const,
  returns: cloneParams((pessimisticParams as typeof DEFAULT_PARAMETERS).returns),
  inflation: cloneParams((pessimisticParams as typeof DEFAULT_PARAMETERS).inflation),
  capitalInitial: 2_150_000_000,
  fx: {
    ...cloneParams(DEFAULT_PARAMETERS.fx),
    clpUsdInitial: 903.25,
    usdEurFixed: 1.113,
  },
  simulationComposition: {
    ...cloneParams(DEFAULT_PARAMETERS.simulationComposition!),
    totalNetWorthCLP: 2_150_000_000,
    optimizableInvestmentsCLP: 1_770_000_000,
    nonOptimizable: {
      ...cloneParams(DEFAULT_PARAMETERS.simulationComposition!.nonOptimizable),
      banksCLP: 380_000_000,
    },
  },
};
const canonicalFromContaminated = buildCanonicalBaseSimulationParams(contaminatedBase);
assert.equal(canonicalFromContaminated.activeScenario, 'base');
assert.equal(canonicalFromContaminated.capitalInitial, contaminatedBase.capitalInitial);
assert.equal(canonicalFromContaminated.fx.clpUsdInitial, contaminatedBase.fx.clpUsdInitial);
assert.equal(canonicalFromContaminated.fx.usdEurFixed, contaminatedBase.fx.usdEurFixed);
assert.deepEqual(canonicalFromContaminated.simulationComposition, contaminatedBase.simulationComposition);
assert.deepEqual(canonicalFromContaminated.returns, DEFAULT_PARAMETERS.returns);
assert.deepEqual(canonicalFromContaminated.inflation, DEFAULT_PARAMETERS.inflation);
assert(Math.abs(computeWeightedReturn(canonicalFromContaminated as typeof DEFAULT_PARAMETERS) - canonicalWeightedReturn) < 1e-8);
assert(
  Math.abs(computeWeightedReturn(canonicalFromContaminated as typeof DEFAULT_PARAMETERS) - pessimisticWeightedReturn)
    > 0.01,
);

const converted = resolveAurumEurUsdForMidas(0.86);
assert.equal(converted.valid, true);
assert.equal(converted.sourceUsdEur, 0.86);
assert(Math.abs((converted.eurUsdForMidas ?? 0) - (1 / 0.86)) < 1e-12);
assert.equal(resolveAurumEurUsdForMidas(0).valid, false);
assert.equal(resolveAurumEurUsdForMidas(-0.86).valid, false);
assert.equal(resolveAurumEurUsdForMidas(1.4).eurUsdForMidas, null);

const referenceWealth = 1_980_000_000;
const riskCapital = 294_000_000;
const realEstateSupport = 155_000_000;
assert.equal(computeMidasConsideredWealth({
  referenceWealthClp: referenceWealth,
  realEstateSupportClp: realEstateSupport,
  riskCapitalClp: riskCapital,
  realEstateEnabled: true,
  riskCapitalEnabled: true,
}).consideredWealthClp, 1_980_000_000);
assert.equal(computeMidasConsideredWealth({
  referenceWealthClp: referenceWealth,
  realEstateSupportClp: realEstateSupport,
  riskCapitalClp: riskCapital,
  realEstateEnabled: false,
  riskCapitalEnabled: true,
}).consideredWealthClp, 1_825_000_000);
assert.equal(computeMidasConsideredWealth({
  referenceWealthClp: referenceWealth,
  realEstateSupportClp: realEstateSupport,
  riskCapitalClp: riskCapital,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
}).consideredWealthClp, 1_686_000_000);
assert.equal(computeMidasConsideredWealth({
  referenceWealthClp: referenceWealth,
  realEstateSupportClp: realEstateSupport,
  riskCapitalClp: riskCapital,
  realEstateEnabled: false,
  riskCapitalEnabled: false,
}).consideredWealthClp, 1_531_000_000);

const compositionMatrix = {
  mode: 'full' as const,
  totalNetWorthCLP: 1_980_000_000,
  optimizableInvestmentsCLP: 1_500_000_000,
  nonOptimizable: {
    banksCLP: 31_000_000,
    nonMortgageDebtCLP: 93_000_000,
    realEstate: {
      propertyValueCLP: 0,
      realEstateEquityCLP: 155_000_000,
      mortgageDebtOutstandingCLP: 0,
    },
    riskCapital: {
      totalCLP: 294_000_000,
      clp: 294_000_000,
      usdSnapshotCLP: 900,
      usdTotal: 326_666.666,
    },
  },
};
const runNoDebtOnOn = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: true,
  riskCapitalEnabled: true,
  includeNonExigibleDebtInRunCapital: false,
});
const runNoDebtOnOff = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  includeNonExigibleDebtInRunCapital: false,
});
const runNoDebtOffOn = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: false,
  riskCapitalEnabled: true,
  includeNonExigibleDebtInRunCapital: false,
});
const runNoDebtOffOff = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: false,
  riskCapitalEnabled: false,
  includeNonExigibleDebtInRunCapital: false,
});
assert.equal(runNoDebtOnOn.runCapitalFromComponentsCLP, 1_980_000_000);
assert.equal(runNoDebtOnOff.runCapitalFromComponentsCLP, 1_686_000_000);
assert.equal(runNoDebtOffOn.runCapitalFromComponentsCLP, 1_825_000_000);
assert.equal(runNoDebtOffOff.runCapitalFromComponentsCLP, 1_531_000_000);

const runWithDebtOnOn = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: true,
  riskCapitalEnabled: true,
  includeNonExigibleDebtInRunCapital: true,
});
const runWithDebtOnOff = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  includeNonExigibleDebtInRunCapital: true,
});
const runWithDebtOffOn = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: false,
  riskCapitalEnabled: true,
  includeNonExigibleDebtInRunCapital: true,
});
const runWithDebtOffOff = buildRunCapitalBreakdown({
  composition: compositionMatrix,
  realEstateEnabled: false,
  riskCapitalEnabled: false,
  includeNonExigibleDebtInRunCapital: true,
});
assert.equal(runWithDebtOnOn.runCapitalFromComponentsCLP, 2_073_000_000);
assert.equal(runWithDebtOnOff.runCapitalFromComponentsCLP, 1_779_000_000);
assert.equal(runWithDebtOffOn.runCapitalFromComponentsCLP, 1_918_000_000);
assert.equal(runWithDebtOffOff.runCapitalFromComponentsCLP, 1_624_000_000);

const enabledResourcesCore = 1_530_974_913;
const enabledResourcesRealEstate = 248_506_886;
const enabledResourcesRisk = 294_112_400;
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: enabledResourcesCore,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: true,
  riskCapitalEnabled: true,
  manualLocalAdjustmentsImpactClp: 0,
}), 2_073_594_199);
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: enabledResourcesCore,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_779_481_799);
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: enabledResourcesCore,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: false,
  riskCapitalEnabled: true,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_825_087_313);
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: enabledResourcesCore,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: false,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_530_974_913);
const t0Plus100 = 100_000_000;
const coreWithT0Plus100 = enabledResourcesCore + t0Plus100;
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: coreWithT0Plus100,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_879_481_799);
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: coreWithT0Plus100,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: false,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_630_974_913);
const t0Minus100 = -100_000_000;
const coreWithT0Minus100 = enabledResourcesCore + t0Minus100;
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: coreWithT0Minus100,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_679_481_799);
assert.equal(computeEnabledResourcesForUi({
  coreLiquidCapitalClp: coreWithT0Minus100,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: false,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
}), 1_430_974_913);

const apr2026Reference = 1_980_337_721;
const apr2026Optimizable = 1_793_600_594;
const apr2026Banks = 31_486_718;
const apr2026RealEstate = 248_506_886;
const apr2026NonMortgageDebt = -93_256_478;
const apr2026Risk = 294_112_400;
const apr2026Composition = {
  mode: 'full' as const,
  totalNetWorthCLP: apr2026Reference,
  optimizableInvestmentsCLP: apr2026Optimizable,
  nonOptimizable: {
    banksCLP: apr2026Banks,
    nonMortgageDebtCLP: apr2026NonMortgageDebt,
    realEstate: {
      propertyValueCLP: 601_605_000,
      realEstateEquityCLP: apr2026RealEstate,
      mortgageDebtOutstandingCLP: 353_098_113,
      ufSnapshotCLP: 39_000,
      snapshotMonth: '2026-04',
    },
    riskCapital: {
      enabled: true,
      totalCLP: apr2026Risk,
      clp: 139_642_000,
      usd: 172_400,
      usdTotal: 172_400,
      usdSnapshotCLP: 888,
      source: 'snapshot',
    },
  },
  diagnostics: {
    sourceVersion: 2 as const,
    mode: 'full' as const,
    compositionGapCLP: 0,
    compositionGapPct: 0,
    notes: [],
  },
};
const auditCombos = [
  { depto: true, risk: true, expectedExpanded: 2_073_594_199 },
  { depto: true, risk: false, expectedExpanded: 1_779_481_799 },
  { depto: false, risk: true, expectedExpanded: 1_825_087_313 },
  { depto: false, risk: false, expectedExpanded: 1_530_974_913 },
];
for (const combo of auditCombos) {
  const breakdown = buildRunCapitalBreakdown({
    composition: apr2026Composition,
    realEstateEnabled: combo.depto,
    riskCapitalEnabled: combo.risk,
    includeNonExigibleDebtInRunCapital: true,
    manualLocalAdjustmentsImpactCLP: 0,
    riskCapitalOverrideCLP: apr2026Risk,
  });
  assert.equal(breakdown.referenceCapitalCLP, apr2026Reference);
  assert.equal(breakdown.nonExigibleDebtPolicyImpactCLP, 93_256_478);
  assert.equal(breakdown.realEstateSupportCLP, apr2026RealEstate);
  assert.equal(breakdown.riskCapitalCLP, apr2026Risk);
  assert.equal(breakdown.runCapitalFromComponentsCLP, combo.expectedExpanded);

  const params = cloneParams(DEFAULT_PARAMETERS);
  params.capitalSource = 'aurum';
  params.capitalInitial = combo.expectedExpanded;
  params.realEstatePolicy = {
    ...(params.realEstatePolicy ?? { enabled: true, triggerRunwayMonths: 36, saleDelayMonths: 12, saleCostPct: 0, realAppreciationAnnual: 0 }),
    enabled: combo.depto,
  };
  params.simulationComposition = {
    ...cloneParams(apr2026Composition as any),
    nonOptimizable: {
      ...cloneParams(apr2026Composition.nonOptimizable as any),
      riskCapital: {
        ...cloneParams(apr2026Composition.nonOptimizable.riskCapital as any),
        enabled: combo.risk,
      },
    },
  };
  const cap = resolveCapital({ params });
  const m8 = toM8Input(params, cap);
  assert.equal(m8.capital_initial_clp, apr2026Optimizable + apr2026Banks);
  assert.equal(m8.risk_capital_clp ?? 0, combo.risk ? apr2026Risk : 0);
  assert.equal(Boolean(m8.house?.include_house), combo.depto);
}

const t0FutureOnly = summarizeManualAdjustmentsT0([
  { id: 'a', direction: 'add', amount: 100_000_000, currency: 'CLP', effectiveDate: '2035-01', destination: 'liquidity' },
  { id: 'b', direction: 'remove', amount: 25_000_000, currency: 'CLP', effectiveDate: '2036-01', destination: 'liquidity' },
], (amount) => amount);
assert.equal(t0FutureOnly.positiveClp, 0);
assert.equal(t0FutureOnly.negativeClp, 0);
assert.equal(t0FutureOnly.netClp, 0);
assert.equal(t0FutureOnly.count, 0);
const todayKey = new Date().toISOString().slice(0, 7);
const t0Summary = summarizeManualAdjustmentsT0([
  { id: 'c', direction: 'add', amount: 100_000_000, currency: 'CLP', effectiveDate: todayKey, destination: 'liquidity' },
  { id: 'd', direction: 'remove', amount: 25_000_000, currency: 'CLP', effectiveDate: todayKey, destination: 'liquidity' },
], (amount) => amount);
assert.equal(t0Summary.positiveClp, 100_000_000);
assert.equal(t0Summary.negativeClp, 25_000_000);
assert.equal(t0Summary.netClp, 75_000_000);
assert.equal(t0Summary.count, 2);
const futureSummary = summarizeManualAdjustmentsFuture([
  { id: 'e', direction: 'add', amount: 150_000_000, currency: 'CLP', effectiveDate: '2039-05', destination: 'investments' },
  { id: 'f', direction: 'remove', amount: 25_000_000, currency: 'CLP', effectiveDate: '2040-02', destination: 'liquidity' },
  { id: 'g', direction: 'add', amount: 100_000_000, currency: 'CLP', effectiveDate: todayKey, destination: 'liquidity' },
], (amount) => amount);
assert.equal(futureSummary.positiveClp, 150_000_000);
assert.equal(futureSummary.negativeClp, 25_000_000);
assert.equal(futureSummary.netClp, 125_000_000);
assert.equal(futureSummary.count, 2);
assert.equal(futureSummary.firstFutureDate, '2039-05');
const mixedAdjustments = [
  { id: 'h', direction: 'add' as const, amount: 100_000_000, currency: 'CLP' as const, effectiveDate: todayKey, destination: 'liquidity' as const },
  { id: 'i', direction: 'add' as const, amount: 150_000_000, currency: 'CLP' as const, effectiveDate: '2039-05', destination: 'investments' as const },
];
const mixedT0Summary = summarizeManualAdjustmentsT0(mixedAdjustments, (amount) => amount);
const mixedFutureSummary = summarizeManualAdjustmentsFuture(mixedAdjustments, (amount) => amount);
assert.equal(mixedT0Summary.netClp, 100_000_000);
assert.equal(mixedFutureSummary.netClp, 150_000_000);
const mixedCoreWithT0 = enabledResourcesCore + mixedT0Summary.netClp;
const mixedResourcesToday = computeEnabledResourcesForUi({
  coreLiquidCapitalClp: mixedCoreWithT0,
  realEstateSupportClp: enabledResourcesRealEstate,
  riskCapitalClp: enabledResourcesRisk,
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  manualLocalAdjustmentsImpactClp: 0,
});
assert.equal(mixedResourcesToday, 1_879_481_799);
assert.equal(mixedResourcesToday, 1_779_481_799 + 100_000_000);
assert.equal(buildEnabledResourcesSubcopy({
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  hasManualT0Adjustments: false,
  hasFutureAdjustments: false,
}), 'Core + Depto');
assert.equal(buildEnabledResourcesSubcopy({
  realEstateEnabled: true,
  riskCapitalEnabled: false,
  hasManualT0Adjustments: false,
  hasFutureAdjustments: true,
}), 'Core + Depto + Aj. futuros');
assert.equal(buildEnabledResourcesSubcopy({
  realEstateEnabled: true,
  riskCapitalEnabled: true,
  hasManualT0Adjustments: false,
  hasFutureAdjustments: true,
}), 'Core + Depto + Riesgo + Aj. futuros');
assert.equal(buildEnabledResourcesSubcopy({
  realEstateEnabled: false,
  riskCapitalEnabled: true,
  hasManualT0Adjustments: false,
  hasFutureAdjustments: true,
}), 'Core + Riesgo + Aj. futuros');
assert.equal(buildEnabledResourcesSubcopy({
  realEstateEnabled: false,
  riskCapitalEnabled: false,
  hasManualT0Adjustments: false,
  hasFutureAdjustments: true,
}), 'Core + Aj. futuros');

assert.equal(computeCurrentAgeFromBirthDate('1978-07-11', new Date('2026-06-30T12:00:00.000Z')), 47);
assert.equal(computeCurrentAgeFromBirthDate('1978-07-11', new Date('2026-07-12T12:00:00.000Z')), 48);
assert.equal(buildHeroTargetAgeQuestion({
  birthDateIso: '1978-07-11',
  horizonYears: 40,
  now: new Date('2026-06-30T12:00:00.000Z'),
}), '¿Llegarás a los 87 años?');
assert.equal(buildHeroTargetAgeQuestion({
  birthDateIso: '1978-07-11',
  horizonYears: 30,
  now: new Date('2026-06-30T12:00:00.000Z'),
}), '¿Llegarás a los 77 años?');

assert(source.includes('Patrimonio total hoy'));
assert(source.includes('Patrimonio total hoy (Aurum + capital de riesgo)'));
assert(!source.includes('Patrimonio total Aurum'));
assert(source.includes('Capital inicial líquido del motor'));
assert(source.includes('Capital inicial líquido del motor (corrida efectiva)'));
assert(source.includes('Foto Aurum neta (referencia patrimonial)'));
assert(source.includes('Impacto recursos habilitados (Depto/Riesgo)'));
assert(source.includes('Impacto deuda no exigible (diagnóstico)'));
assert(source.includes('Impacto ajustes manuales T0 (+)'));
assert(source.includes('Ajustes futuros programados (no afectan hoy):'));
assert(source.includes('Capital efectivo usado por MIDAS (input actual)'));
assert(source.includes('manualLocalAdjustmentsImpactClp: 0'));
assert(source.includes('ajuste manual T0'));
assert(source.includes('Capital inicial evaluado'));
assert(!source.includes('Recursos habilitados hoy'));
assert(source.includes('Ajustes futuros:'));
assert(!source.includes('Core motor hoy'));
assert(source.includes('Recursos habilitados esta corrida'));
assert(source.includes('Core + Depto + Riesgo'));
assert(source.includes('Aj. futuros'));
assert(!source.includes('Solo core'));
assert(source.includes('Recursos ampliados bajo modelo'));
assert(source.includes('Ver desglose patrimonial'));
assert(source.includes('Patrimonio Aurum base visible'));
assert(source.includes('Capital inicial del motor'));
assert(source.includes('Capital de riesgo detectado'));
assert(source.includes('Capital de riesgo incluido en patrimonio Aurum base'));
assert(source.includes('Ajuste de referencia por capital de riesgo'));
assert(source.includes('Capital de riesgo habilitado para esta corrida'));
assert(source.includes('Capital de riesgo incluido en patrimonio considerado'));
assert(source.includes('Respaldo/depto detectado'));
assert(source.includes('Respaldo/depto incluido en patrimonio considerado'));
assert(source.includes('Capital no usado por esta simulación'));
assert(source.includes('Diferencia referencia vs capital core motor'));
assert(source.includes('Diferencia referencia vs recursos ampliados'));
assert(source.includes('Explicación de la diferencia ampliada'));
assert(source.includes('El capital líquido del motor supera la referencia patrimonial. Revisar composición antes de usar.'));
assert(source.includes('Configuración OK'));
assert(source.includes('T0'));
assert(source.includes('Ajustes T0 netos:'));
assert(source.includes('Ajustes futuros netos:'));
assert(source.includes('Primer evento futuro:'));
assert(source.includes('Ajustes de capital'));
assert(source.includes('Agrega entradas o salidas T0/futuras para esta corrida.'));
assert(source.includes('const formatMonthYearLabel = (value: string | null | undefined): string => {'));
assert(source.includes("toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })"));
assert(source.includes('Recursos hoy'));
assert(source.includes('Próximo evento:'));
assert(source.includes('Próximo evento: {formatMonthYearLabel(draftManualSummaryFuture.firstFutureDate)}'));
assert(source.includes('Ver detalle técnico / conciliación'));
assert(!source.includes('<details open style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: \'8px 10px\', background: T.surfaceEl }}>'));
assert(!source.includes('Ajustes manuales de capital'));
assert(source.includes('Los ajustes manuales están expresados en valor T0/plata de hoy.'));
assert(source.includes('Los ajustes futuros no cambian los recursos habilitados hoy, pero sí forman parte de la corrida.'));
assert(source.includes('El capital del motor y los recursos ampliados pueden diferir'));
assert(source.includes('Fingerprint visible:'));
assert(source.includes('Ultimo fingerprint evaluado:'));
assert(source.includes('Estado input/resultado:'));
assert(source.includes('Configuración pendiente de recalcular.'));
assert(source.includes('Hay un resultado anterior visible.'));
assert(source.includes('No hay resultado actualizado para esta configuración.'));
assert(source.includes('Recalcula para validar los cambios.'));
assert(source.includes('Recalcula para validar esta configuración.'));
assert(source.includes("label: evaluatedScenarioState.label"));
assert(source.includes("headline: 'Resultado vigente.'"));
assert(!source.includes('Resultado usable con salvedades.'));
assert(!source.includes('Confirmar o descartar esos ajustes locales'));
assert(source.includes('hasOnlyRunResultBlockingReasons'));
assert(source.includes('Respaldo habilitado.'));
assert(source.includes('No se usa como respaldo.'));
assert(source.includes('Habilitado.'));
assert(source.includes('No entra.'));
assert(source.includes('USD/CLP aplicado'));
assert(source.includes('EUR/USD aplicado'));
assert(source.includes('Aurum current'));
assert(source.includes('Snapshot Aurum no aplicado'));
assert(source.includes('Fuente de datos'));
assert(source.includes('dataSourceStatusLabel'));
assert(source.includes('dataSourceTone'));
assert(source.includes('EUR/USD no validado contra Aurum; usando valor estructural del modelo.'));
assert(source.includes('Ver detalle técnico'));
assert(source.includes('<details style={{ marginTop: 0 }}>'));
assert(!source.includes("open={dataSourceTone !== 'ok'}"));
assert(source.includes('Valor fuente Aurum'));
assert(source.includes('USD/EUR'));
assert(source.includes('Transformación aplicada: 1 /'));
assert(source.includes('Monte Carlo'));
assert(source.includes('Modelo Base'));
assert(source.includes('Edita los supuestos oficiales guardados. La simulación temporal no modifica este modelo.'));
assert(source.includes('Hay una simulación temporal activa. Cambiar el Modelo Base modifica la fuente oficial, no solo esta prueba.'));
assert(source.includes('Horizonte base'));
assert(source.includes('Gasto por tramos'));
assert(source.includes('Fee anual'));
assert(source.includes('Monte Carlo oficial'));
assert(source.includes('Seed oficial'));
assert(source.includes('Bucket months'));
assert(source.includes('Cloud canónico'));
assert(!source.includes('\n                Volver al Modelo Base\n'));
assert(source.includes('Estos cambios son temporales. No modifican el Modelo Base.'));
assert(source.includes('Escenario temporal'));
assert(source.includes('Monte Carlo'));
assert(source.includes('Neutro'));
assert(source.includes("const heroBaseChipLabel = 'Base';"));
assert(source.includes('const canResetToBase = simActive;'));
assert(source.includes("id: 'state',"));
assert(source.includes('value: heroBaseChipLabel,'));
assert(source.includes('disabled: !canResetToBase,'));
assert(source.includes('data-simulation-section="hero-result"'));
assert(source.includes('data-simulation-section="hero-express-controls"'));
assert(source.includes('aria-expanded={heroExpressOpen}'));
assert(source.includes('aria-controls="hero-express-controls-panel"'));
assert(source.includes('Depto · Riesgo · Escenario · Monte Carlo'));
assert(source.includes("key={`hero-express-scenario-${variant.id}`}"));
assert(source.includes("key={`hero-express-nsim-${nSimOption}`}"));
assert(source.includes("id: 'return', value: `${(effectiveReturn * 100).toFixed(1)}%`, onClick: () => openHeroQuickEdit('return')"));
assert(source.includes("id: 'years', value: `${formatNumber(effectiveYears)} años`, onClick: () => openHeroQuickEdit('years')"));
assert(source.includes('aria-label="Edicion rapida del hero"'));
assert(source.includes('Ajuste express. Al aplicar, MIDAS recalcula y actualiza el resultado vigente.'));
assert(source.includes('Cancelar'));
assert(source.includes('Aplicar'));
assert(source.includes('const [heroExpressOpen, setHeroExpressOpen] = useState(false);'));
assert(source.includes('const [heroQuickEditMode, setHeroQuickEditMode] = useState<HeroQuickEditMode | null>(null);'));
assert(source.includes('const openHeroQuickEdit = useCallback((mode: HeroQuickEditMode) => {'));
assert(source.includes('const applyHeroQuickEdit = useCallback(() => {'));
assert(!source.includes("onClick: openSimulationPanelShortcut"));
assert(source.includes("const USER_BIRTH_DATE_ISO = '1978-07-11';"));
assert(source.includes("return `¿Llegarás a los ${age + Math.round(horizonYears)} años?`;"));
assert(source.includes("label={heroQuestion}"));
assert(!source.includes("label={heroQuestion.toUpperCase()}"));
assert(!source.includes(': () => {},'));
assert(!source.includes('onClick={() => {}}'));
assert(!source.includes("{simActive && (\n          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>"));
assert(!source.includes('title="Agregar evento"'));
assert(!source.includes('aria-label="Agregar evento"'));
assert(!source.includes("variant.id === 'base' ? 'Base'"));
assert(!source.includes('Capital riesgo motor'));
assert(!source.includes('Aurum: Modelo base local (sin aplicar snapshot Aurum)'));
assert(!source.includes('Capital fuera del motor'));
assert(appSource.includes('setAurumFxSpotUsdEur'));
assert(appSource.includes('resolveAurumEurUsdForMidas'));
assert(appSource.includes('usdEurFixed: targetEurUsdForMidas'));
assert(appSource.includes('setAurumFxSourceUsdEur'));
assert(appSource.includes('computeEffectiveEngineInputHashForParams'));
assert(appSource.includes('const effectiveRunInputHash = useMemo('));
assert(appSource.includes('() => computeEffectiveEngineInputHashForParams(visibleSimParams)'));
assert(appSource.includes('effectiveEngineInputHash: effectiveRunInputHash'));
assert(appSource.includes('setLastRunInputHash(runInputHash)'));
assert(appSource.includes('setLastRenderedResultHash(runInputHash)'));
assert(appSource.includes('aurumSnapshotMonth'));
assert(appSource.includes("const capitalAdjustmentsSource: SourceStatus = hasManualAdjustments ? 'local' : 'canonical';"));
assert(appSource.includes('const hasVisibleScenarioChanges = useMemo('));
assert(appSource.includes('buildSimulationVisualStatus({'));
assert(appSource.includes('buildCanonicalBaseSimulationParams('));
assert(appSource.includes("diagnosticsLabel: 'cloud/active'"));
assert(appSource.includes("diagnosticsLabel: 'reset-session'"));
assert(appSource.includes("setSimulationActive(false);"));
assert(appSource.includes("setSimulationPreset('base');"));
assert(appSource.includes("setSimOverrides(null);"));
assert(appSource.includes('setManualCapitalAdjustments([]);'));
assert(/const resetSimulationSession[\s\S]*setRiskCapitalEnabled\(false\);/.test(appSource));
assert(/const resetSimulationSession[\s\S]*riskCapitalEnabled:\s*false,/.test(appSource));
assert(/const resetSimulationSession[\s\S]*manualImpact:\s*EMPTY_MANUAL_ADJUSTMENT_IMPACT,/.test(appSource));
assert(/const resetSimulationSession[\s\S]*startRecalculation\('session-reset',\s*\(\)\s*=>\s*canonicalBase\);/.test(appSource));
assert(appSource.includes("const LEGACY_TABS = new Set<TabId>(['stress', 'optv0']);"));
assert(appSource.includes("const resolveProductTab = (tab: TabId): TabId => (LEGACY_TABS.has(tab) ? 'sim' : tab);"));
assert(appSource.includes('const nextTab = resolveProductTab(tab);'));
assert(appSource.includes('setActiveTab(nextTab);'));
assert(appSource.includes('syncProductTabRoute(nextTab);'));
assert(appSource.includes('if (LEGACY_TABS.has(activeTab)) {'));
assert(appSource.includes("setActiveTab('sim');"));
assert(!appSource.includes("activeTab === 'stress'"));
assert(!appSource.includes("activeTab === 'optv0'"));
assert(appSource.includes('headerConfidenceLabel'));
assert(appSource.includes('headerHasOnlyRunResultBlockingReasons'));
assert(appSource.includes('headerShowsStaleResult'));
assert(appSource.includes('Sostenibilidad anterior:'));
assert(qualityOfLifeSource.includes('midasEvaluation?.rawScore ?? midasEvaluation?.cappedScore'));
assert(appSource.includes('Recalcular'));
assert(appSource.includes('<BottomNav active={productActiveTab} onChange={handleTabChange} />'));
assert(!appSource.includes('ParamSheet'));
assert(!appSource.includes('paramSheetOpen'));
assert(!appSource.includes('setParamSheetOpen(true)'));
assert(!appSource.includes('aria-label="Abrir parámetros"'));
assert(source.includes('title="Agregar evento patrimonial"'));
assert(source.includes('aria-label="Agregar evento patrimonial"'));
assert(source.includes('Resultado no auditado para decisión productiva.'));
assert(source.includes('Datos locales/degradados por configuración cloud no disponible.'));
assert(source.includes('Modo local de revisión: útil para QA visual. Los montos pueden no coincidir con Aurum productivo.'));
assert(source.includes('No disponible en modo local: falta configuración/snapshot cloud.'));
assert(source.includes('Sin capital de riesgo disponible en modo local; ON/OFF no modifica recursos.'));
assert(source.includes('const localReadOnlyVisualOnly = localReadOnlyFallbackActive && !workerRecalcActive;'));
assert(source.includes('const isRecalculating = !localReadOnlyVisualOnly'));
assert(source.includes("type CanonicalInputDisplayState = 'hydrating' | 'ready' | 'blocked' | 'missingCanonicalConfig' | 'timeout' | 'error';"));
assert(source.includes('const CANONICAL_HYDRATION_TIMEOUT_MS = 12_000;'));
assert(source.includes('function resolveCanonicalInputDisplayState'));
assert(source.includes('Hidratando Modelo Base…'));
assert(source.includes('instrument_universe_timeout'));
assert(source.includes('instrument_universe_error'));
assert(source.includes('Falta Modelo Base canónico'));
assert(source.includes('No hay Modelo Base canónico guardado en cloud. Por seguridad, MIDAS no lo crea automáticamente desde cache local.'));
assert(source.includes('No se pudo completar la hidratación'));
assert(source.includes('Aún no hay simulación válida'));
assert(source.includes('Revisa Modelo Base antes de ejecutar simulación.'));
assert(source.includes('Razón técnica: ${canonicalInputBlockedReason}.'));
assert(source.includes('Simulación: ${canonicalInputDisplayState} (${canonicalInputBlockedReason})'));
assert(source.includes('const [simulationDataOpen, setSimulationDataOpen] = useState(() =>'));
assert(source.includes('setSimulationDataOpen(!isMobileViewport);'));
assert(source.includes("data-simulation-section=\"quality-of-life\""));
assert(source.includes("data-simulation-section=\"simulation-data\""));
assert(source.includes('style={{ position: \'relative\', order: 1 }} data-simulation-section="hero-result"'));
assert(source.includes('order: 2,'));
assert(source.includes('style={{ order: 4 }} data-simulation-section="quality-of-life"'));
assert(source.includes('style={{ order: 5, background: T.surface'));

const heroSectionStart = source.indexOf('data-simulation-section="hero-result"');
const heroExpressStart = source.indexOf('data-simulation-section="hero-express-controls"');
const qualitySectionStart = source.indexOf('data-simulation-section="quality-of-life"');
const simulationDataSectionStart = source.indexOf('data-simulation-section="simulation-data"');
assert(heroSectionStart !== -1 && heroExpressStart !== -1 && qualitySectionStart !== -1 && simulationDataSectionStart !== -1);
assert(heroSectionStart < heroExpressStart);
assert(heroExpressStart < qualitySectionStart);
assert(qualitySectionStart < simulationDataSectionStart);

const heroChipsStart = source.indexOf('chips={[');
const heroChipsEnd = source.indexOf(']}', heroChipsStart);
assert(heroChipsStart !== -1 && heroChipsEnd !== -1 && heroChipsEnd > heroChipsStart);
const heroChipsSlice = source.slice(heroChipsStart, heroChipsEnd);
assert(!heroChipsSlice.includes("id: 'scenario'"));
assert(!heroChipsSlice.includes("id: 'nSim'"));
assert(heroChipsSlice.includes("id: 'return'"));
assert(heroChipsSlice.includes("id: 'years'"));
assert(heroChipsSlice.includes("id: 'capital'"));
assert(source.includes('84 de 1000 trayectorias terminaron en ruina.') || source.includes('trayectorias terminaron en ruina.'));
assert(source.includes("explanation: null as string | null"));
assert.equal((source.match(/Resultado vigente\./g) ?? []).length, 1);
assert(source.includes('Mix cloud pendiente'));
assert(source.includes('Instrument Universe timeout'));
assert(source.includes('Falta Universe cloud'));
assert(source.includes('Error Universe cloud'));
assert(source.includes("return `Mix oficial · ${formatAgeDaysCompact(instrumentUniverseSource.freshness.ageDays)} · ${freshnessStatus}`;"));
assert(source.includes('Instrument Universe cloud sigue cargando; no lo tratamos como fuente lista.'));
assert(source.includes('Timeout de lectura cloud para Instrument Universe.'));
assert(source.includes('Instrument Universe cloud:'));
assert(source.includes('Path esperado:'));
assert(appSource.includes('Falta Modelo Base canónico'));
assert(appSource.includes('simulationActiveV1 ausente'));
assert(appSource.includes('No hay Modelo Base canónico guardado en cloud. Por seguridad, MIDAS no lo crea desde cache local.'));
assert(appSource.includes('Hidratación cloud incompleta'));
assert(appSource.includes('instrument_universe_timeout'));
assert(appSource.includes('instrument_universe_error'));
assert(source.includes('Trace replay:'));
assert(source.includes('replayTrace,'));
assert(source.includes("m8InputFingerprint.diagnosticInput.replayTrace"));
assert(source.includes("import { buildMidasEvaluation } from '../domain/model/midasEvaluation';"));
assert(source.includes('qualityOfLifeMetrics: resultCentral?.qualityOfLifeMetrics ?? null,'));
assert(source.includes('midasEvaluation: midasEvaluation ?? null,'));
assert(source.includes('midasEvaluation={midasEvaluation}'));
assert(appSource.includes('QA visual: los montos pueden no coincidir con Aurum productivo'));
assert(bucketLabSource.includes('Array.from(new Set([24, 36, activeExpectedCostAnalysis.currentBucketMonths]))'));
assert(adaptersSource.includes('resolveAurumEurUsdForMidas(fxReference.usdEur).eurUsdForMidas'));
assert(sensitivitySource.includes('Análisis de sensibilidad'));
assert(sensitivitySource.includes('Calcular sensibilidad'));
assert(sensitivitySource.includes('Sensibilidad one-variable-at-a-time'));
assert(sensitivitySource.includes('Valor requerido para subir +2 pp de éxito'));
assert(sensitivitySource.includes('House sale aparece solo como métrica resultado.'));
assert(bottomNavSource.includes("{ id: 'sens', label: 'Sensibilidad' }"));
assert(bucketLabSource.includes('Laboratorio técnico'));
assert(bucketLabSource.includes('Laboratorio de buckets'));
assert(bucketLabSource.includes('No reemplaza el resultado auditado de Simulación.'));
assert(bottomNavSource.includes("{ id: 'bucketlab', label: 'Lab técnico' }"));

const decisionStart = source.indexOf('Barra de decisión');
const decisionEnd = source.indexOf('Ver desglose patrimonial');
assert(decisionStart !== -1 && decisionEnd !== -1 && decisionEnd > decisionStart);
const decisionSlice = source.slice(decisionStart, decisionEnd);
const idxPatrimonioTotalHoy = decisionSlice.indexOf('Patrimonio total hoy');
const idxDepto = decisionSlice.indexOf('Depto');
const idxRiesgo = decisionSlice.indexOf('Capital de riesgo');
const idxRecursos = decisionSlice.indexOf('Recursos habilitados esta corrida');
const idxEscenario = decisionSlice.indexOf('Escenario');
const idxMonteCarlo = decisionSlice.indexOf('Monte Carlo');
assert(idxPatrimonioTotalHoy !== -1 && idxDepto !== -1 && idxRiesgo !== -1 && idxRecursos !== -1 && idxEscenario !== -1 && idxMonteCarlo !== -1);
assert(idxPatrimonioTotalHoy < idxDepto);
assert(idxDepto < idxRiesgo);
assert(idxRiesgo < idxRecursos);
assert(idxRecursos < idxEscenario);
assert(idxEscenario < idxMonteCarlo);
assert(!decisionSlice.includes('Capital inicial líquido del motor'));

assert(source.includes('open={modelBaseOpen}'));
assert(source.includes("style={{ order: 9"));
assert(source.includes('ref={diagnosticsRef}'));
assert(source.includes("style={{ order: 11 }}"));
assert(source.includes('sourcePolicy'));
assert(source.includes('SourcePolicyStatusBadge'));
assert(source.includes('function SurfaceSemanticBadge'));
assert(source.includes('function SurfaceSemanticRow'));
assert(source.includes('Avisos'));
assert(source.includes('Notas técnicas:'));
assert(source.includes('Control decisional canónico'));
assert(source.includes('Exploratorio'));
assert(source.includes('Cambios pendientes · Guardar y salir para recalcular y actualizar fingerprint.'));
assert(source.includes('Guardar y recalcular'));
assert(source.includes('Cambia fingerprint al guardar'));
assert(source.includes('Afecta resultado vigente'));
assert(source.includes('Grupo con confirmación'));
assert(source.includes('Copiar no modifica cálculo'));
assert(source.includes('Política de fuente:'));
assert(qualityOfLifeSource.includes('Qué mirar primero'));
assert(qualityOfLifeSource.includes('Detalle de recortes y fases'));
assert(qualityOfLifeSource.includes('Éxito con calidad de vida'));
assert(qualityOfLifeSource.includes('Supervivencia con calidad estricta'));
assert(qualityOfLifeSource.includes('Consumo efectivo promedio'));
assert(qualityOfLifeSource.includes('Tiempo en recorte severo'));
assert(qualityOfLifeSource.includes('Patrimonio final mediano / capital inicial'));
assert(qualityOfLifeSource.includes("import { resolveQualityOfLifeKpiThreshold } from '../domain/model/qualityOfLifeKpiThresholds';"));
assert(qualityOfLifeSource.includes('Calidad media en simulación'));
assert(!qualityOfLifeSource.includes('Calidad media observada'));

assert.equal(buildMixSourceCompactLabel({
  weightsSourceMode: 'instrument-universe',
  instrumentUniverseCloudReadStatus: 'loaded',
  universeSourceOrigin: 'firestore',
  sourcePolicy: buildMixSourcePolicy('2026-05-13T15:40:33.080Z'),
}), 'Mix oficial · 47 días · vigente');

assert.equal(buildMixSourceCompactLabel({
  weightsSourceMode: 'instrument-universe',
  instrumentUniverseCloudReadStatus: 'loaded',
  universeSourceOrigin: 'firestore',
  sourcePolicy: buildMixSourcePolicy('2026-04-27T12:00:00.000Z'),
}), 'Mix oficial · 63 días · actualizar');

assert.equal(buildSourcePolicyUserSummary(buildMixSourcePolicy('2026-05-13T15:40:33.080Z')), 'Fuente oficial trazable.');
assert.equal(buildSourcePolicyUserSummary(buildMixSourcePolicy('2026-04-27T12:00:00.000Z')), 'Fuente oficial con revisión visible.');

console.log('SimulationPage tests passed');
