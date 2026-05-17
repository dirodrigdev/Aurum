import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SimulationPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

assert(source.includes('Capital de riesgo detectado'));
assert(source.includes('Detectado en composición. En motor:'));
assert(source.includes('Existe en la composición, pero esta corrida no lo usa como capital simulable.'));
assert(source.includes('Capital no usado por esta simulación'));
assert(source.includes('USD/CLP aplicado'));
assert(source.includes('EUR/USD modelo'));
assert(source.includes('Aurum current'));
assert(source.includes('Snapshot Aurum no aplicado'));
assert(source.includes('Fuente de datos aplicada'));
assert(source.includes('EUR/USD no validado contra Aurum; usando valor estructural del modelo.'));
assert(source.includes('Ver detalle técnico'));
assert(source.includes('Capital riesgo motor'));
assert(source.includes('Monte Carlo'));
assert(source.includes('Capital usado'));
assert(!source.includes('Aurum: Modelo base local (sin aplicar snapshot Aurum)'));
assert(!source.includes('Capital fuera del motor'));
assert(appSource.includes('setAurumFxSpotUsdEur'));
assert(appSource.includes('usdEurFixed: target'));

console.log('SimulationPage tests passed');
