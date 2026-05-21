import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCanonicalBaseSimulationParams } from '../App';
import { DEFAULT_PARAMETERS, SCENARIO_VARIANTS } from '../domain/model/defaults';
import { applyScenarioVariant } from '../domain/simulation/engine';
import { resolveAurumEurUsdForMidas } from '../domain/model/operativeFx';
import { buildRunCapitalBreakdown } from '../domain/simulation/runCapitalPolicy';
import { resolveCapital } from '../domain/simulation/capitalResolver';
import { toM8Input } from '../domain/simulation/m8Adapter';
import { computeEnabledResourcesForUi, computeMidasConsideredWealth, summarizeManualAdjustmentsT0 } from './SimulationPage';

const source = readFileSync(new URL('./SimulationPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const adaptersSource = readFileSync(new URL('../integrations/aurum/adapters.ts', import.meta.url), 'utf8');

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

assert(source.includes('Foto Aurum neta'));
assert(!source.includes('Patrimonio total Aurum'));
assert(source.includes('Capital inicial líquido del motor'));
assert(source.includes('Capital inicial líquido del motor (corrida efectiva)'));
assert(source.includes('Foto Aurum neta (referencia patrimonial)'));
assert(source.includes('Impacto recursos habilitados (Depto/Riesgo)'));
assert(source.includes('Impacto deuda no hipotecaria no exigible'));
assert(source.includes('Impacto ajustes manuales T0 (+)'));
assert(source.includes('Capital efectivo usado por MIDAS (input actual)'));
assert(source.includes('Incluye ajuste manual T0'));
assert(source.includes('Core motor hoy'));
assert(source.includes('Recursos habilitados esta corrida'));
assert(source.includes('Este valor queda estable frente a Depto/Riesgo.'));
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
assert(source.includes('Ajustes manuales T0: +'));
assert(source.includes('Los ajustes manuales están expresados en valor T0/plata de hoy.'));
assert(source.includes('El capital del motor y los recursos ampliados pueden diferir'));
assert(source.includes('Resultado anterior'));
assert(source.includes('Pendiente de recalcular'));
assert(source.includes('No hay resultado actualizado para esta configuración.'));
assert(source.includes('Ejecuta simulación para validar los cambios.'));
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
assert(source.includes('Volver al Modelo Base'));
assert(source.includes('Estos cambios son temporales. No modifican el Modelo Base.'));
assert(source.includes('Escenario temporal'));
assert(source.includes('Monte Carlo'));
assert(source.includes('Neutro'));
assert(source.includes("const heroBaseChipLabel = 'Base';"));
assert(source.includes("id: 'state',"));
assert(source.includes('value: heroBaseChipLabel,'));
assert(!source.includes("variant.id === 'base' ? 'Base'"));
assert(!source.includes('Capital riesgo motor'));
assert(!source.includes('Aurum: Modelo base local (sin aplicar snapshot Aurum)'));
assert(!source.includes('Capital fuera del motor'));
assert(appSource.includes('setAurumFxSpotUsdEur'));
assert(appSource.includes('resolveAurumEurUsdForMidas'));
assert(appSource.includes('usdEurFixed: targetEurUsdForMidas'));
assert(appSource.includes('setAurumFxSourceUsdEur'));
assert(appSource.includes('computeEffectiveEngineInputHashForParams'));
assert(appSource.includes('setLastRunInputHash(runInputHash)'));
assert(appSource.includes('setLastRenderedResultHash(runInputHash)'));
assert(appSource.includes('const capitalAdjustmentsSource: SourceStatus = hasManualAdjustments'));
assert(appSource.includes("? (manualAdjustmentsAppliedToInput ? 'canonical' : 'error')"));
assert(appSource.includes('buildCanonicalBaseSimulationParams('));
assert(appSource.includes("diagnosticsLabel: 'cloud/active'"));
assert(appSource.includes("diagnosticsLabel: 'reset-session'"));
assert(appSource.includes("setSimulationActive(false);"));
assert(appSource.includes("setSimOverrides(null);"));
assert(appSource.includes('setManualCapitalAdjustments([]);'));
assert(appSource.includes('headerConfidenceLabel'));
assert(appSource.includes('headerHasOnlyRunResultBlockingReasons'));
assert(appSource.includes('headerShowsStaleResult'));
assert(appSource.includes('Resultado anterior:'));
assert(appSource.includes('Recalcular'));
assert(!appSource.includes('ParamSheet'));
assert(!appSource.includes('paramSheetOpen'));
assert(!appSource.includes('setParamSheetOpen(true)'));
assert(!appSource.includes('aria-label="Abrir parámetros"'));
assert(source.includes('title="Agregar evento patrimonial"'));
assert(source.includes('aria-label="Agregar evento patrimonial"'));
assert(adaptersSource.includes('resolveAurumEurUsdForMidas(fxReference.usdEur).eurUsdForMidas'));

const decisionStart = source.indexOf('Barra de decisión');
const decisionEnd = source.indexOf('Ver desglose patrimonial');
assert(decisionStart !== -1 && decisionEnd !== -1 && decisionEnd > decisionStart);
const decisionSlice = source.slice(decisionStart, decisionEnd);
const idxPatrimonioAurum = decisionSlice.indexOf('Foto Aurum neta');
const idxDepto = decisionSlice.indexOf('Depto');
const idxRiesgo = decisionSlice.indexOf('Capital de riesgo');
const idxPatrimonioMidas = decisionSlice.indexOf('Capital inicial líquido del motor');
const idxEscenario = decisionSlice.indexOf('Escenario');
const idxMonteCarlo = decisionSlice.indexOf('Monte Carlo');
assert(idxPatrimonioAurum !== -1 && idxDepto !== -1 && idxRiesgo !== -1 && idxPatrimonioMidas !== -1 && idxEscenario !== -1 && idxMonteCarlo !== -1);
assert(idxPatrimonioAurum < idxDepto);
assert(idxDepto < idxRiesgo);
assert(idxRiesgo < idxPatrimonioMidas);
assert(idxPatrimonioMidas < idxEscenario);
assert(idxEscenario < idxMonteCarlo);

assert(source.includes('open={modelBaseOpen}'));
assert(source.includes("style={{ order: 9"));
assert(source.includes('ref={diagnosticsRef}'));
assert(source.includes("style={{ order: 10 }}"));

console.log('SimulationPage tests passed');
