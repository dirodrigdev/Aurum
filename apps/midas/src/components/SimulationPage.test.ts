import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAurumEurUsdForMidas } from '../domain/model/operativeFx';
import { computeMidasConsideredWealth, summarizeManualAdjustmentsT0 } from './SimulationPage';

const source = readFileSync(new URL('./SimulationPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const adaptersSource = readFileSync(new URL('../integrations/aurum/adapters.ts', import.meta.url), 'utf8');

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

const t0Summary = summarizeManualAdjustmentsT0([
  { id: 'a', direction: 'add', amount: 100_000_000, currency: 'CLP', effectiveDate: '2035-01', destination: 'liquidity' },
  { id: 'b', direction: 'remove', amount: 25_000_000, currency: 'CLP', effectiveDate: '2036-01', destination: 'liquidity' },
], (amount) => amount);
assert.equal(t0Summary.positiveClp, 100_000_000);
assert.equal(t0Summary.negativeClp, 25_000_000);
assert.equal(t0Summary.netClp, 75_000_000);
assert.equal(t0Summary.count, 2);

assert(source.includes('Patrimonio de referencia MIDAS'));
assert(!source.includes('Patrimonio total Aurum'));
assert(source.includes('Patrimonio considerado por MIDAS'));
assert(source.includes('MIDAS hoy'));
assert(source.includes('Patrimonio MIDAS hoy ajustado T0'));
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
assert(source.includes('Diferencia entre referencia MIDAS y considerado MIDAS'));
assert(source.includes('Explicación de la diferencia'));
assert(source.includes('Patrimonio considerado supera la referencia MIDAS. Revisar composición antes de usar.'));
assert(source.includes('Configuración OK'));
assert(source.includes('T0'));
assert(source.includes('Ajustes manuales T0: +'));
assert(source.includes('Los ajustes manuales están expresados en valor T0/plata de hoy.'));
assert(source.includes('El patrimonio MIDAS hoy muestra equivalentes actuales.'));
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
assert(source.includes('Estos cambios sirven para probar una corrida temporal. No reemplazan el Modelo Base guardado en cloud.'));
assert(source.includes('Escenario temporal:'));
assert(source.includes('Monte Carlo temporal:'));
assert(source.includes('Neutro'));
assert(source.includes("const heroBaseChipLabel = 'Base';"));
assert(source.includes("{ id: 'state', value: heroBaseChipLabel, onClick: simActive ? onResetSim : () => {} }"));
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
assert(appSource.includes('headerConfidenceLabel'));
assert(appSource.includes('headerHasOnlyRunResultBlockingReasons'));
assert(appSource.includes('headerShowsStaleResult'));
assert(appSource.includes('Resultado anterior:'));
assert(appSource.includes('Recalcular'));
assert(adaptersSource.includes('resolveAurumEurUsdForMidas(fxReference.usdEur).eurUsdForMidas'));

const decisionStart = source.indexOf('Barra de decisión');
const decisionEnd = source.indexOf('Ver desglose patrimonial');
assert(decisionStart !== -1 && decisionEnd !== -1 && decisionEnd > decisionStart);
const decisionSlice = source.slice(decisionStart, decisionEnd);
const idxPatrimonioAurum = decisionSlice.indexOf('Patrimonio de referencia MIDAS');
const idxDepto = decisionSlice.indexOf('Depto');
const idxRiesgo = decisionSlice.indexOf('Capital de riesgo');
const idxPatrimonioMidas = decisionSlice.indexOf('Patrimonio considerado por MIDAS');
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
