import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAurumEurUsdForMidas } from '../domain/model/operativeFx';

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

assert(source.includes('Capital de riesgo detectado'));
assert(source.includes('Detectado en composición. En motor:'));
assert(source.includes('Existe en la composición, pero esta corrida no lo usa como capital simulable.'));
assert(source.includes('Capital no usado por esta simulación'));
assert(source.includes('USD/CLP aplicado'));
assert(source.includes('EUR/USD aplicado'));
assert(source.includes('Aurum current'));
assert(source.includes('Snapshot Aurum no aplicado'));
assert(source.includes('Fuente de datos aplicada'));
assert(source.includes('dataSourceStatusLabel'));
assert(source.includes('dataSourceTone'));
assert(source.includes('EUR/USD no validado contra Aurum; usando valor estructural del modelo.'));
assert(source.includes('Ver detalle técnico'));
assert(source.includes('Valor fuente Aurum'));
assert(source.includes('USD/EUR'));
assert(source.includes('Transformación aplicada: 1 /'));
assert(source.includes('Capital riesgo motor'));
assert(source.includes('Monte Carlo'));
assert(source.includes('Capital usado'));
assert(!source.includes('Aurum: Modelo base local (sin aplicar snapshot Aurum)'));
assert(!source.includes('Capital fuera del motor'));
assert(appSource.includes('setAurumFxSpotUsdEur'));
assert(appSource.includes('resolveAurumEurUsdForMidas'));
assert(appSource.includes('usdEurFixed: targetEurUsdForMidas'));
assert(appSource.includes('setAurumFxSourceUsdEur'));
assert(adaptersSource.includes('resolveAurumEurUsdForMidas(fxReference.usdEur).eurUsdForMidas'));

console.log('SimulationPage tests passed');
