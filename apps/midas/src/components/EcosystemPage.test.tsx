import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EcosystemPage } from './EcosystemPage';

const markup = renderToStaticMarkup(<EcosystemPage onBack={() => {}} />);

assert(markup.includes('data-testid="midas-ecosystem"'));
assert(markup.includes('Del comportamiento cotidiano a las decisiones de largo plazo'));
assert(markup.includes('La información mensual de GastApp alimenta análisis en Aurum.'));
assert(markup.includes('La base patrimonial de Aurum sirve de partida para MIDAS.'));
assert(markup.includes('Las decisiones futuras pueden modificar los hábitos presentes.'));
assert(markup.includes('Volver a GastApp'));
assert.doesNotMatch(markup, /Firebase|Firestore|GitHub|Vercel|Playwright|Dashboard/);
assert.doesNotMatch(markup, /(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
assert.doesNotMatch(markup, /(?:\$|€)\s*\d/);

console.log('EcosystemPage tests passed');
