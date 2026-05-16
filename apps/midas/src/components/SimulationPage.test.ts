import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SimulationPage.tsx', import.meta.url), 'utf8');

assert(source.includes('Capital de riesgo detectado'));
assert(source.includes('Disponible en la composición. Incluido en el motor:'));
assert(source.includes('Existe en la composición, pero esta corrida no lo usa como capital simulable.'));
assert(source.includes('Capital no usado por esta simulación'));
assert(source.includes('USD/CLP aplicado'));
assert(source.includes('EUR/USD usado por el modelo'));
assert(source.includes('EUR/USD no validado contra Aurum; usando valor estructural del modelo.'));
assert(source.includes('Snapshot Aurum no aplicado'));
assert(source.includes('Ver detalle técnico'));
assert(source.includes('Incluir capital de riesgo en motor'));
assert(!source.includes('Capital fuera del motor'));

console.log('SimulationPage tests passed');
