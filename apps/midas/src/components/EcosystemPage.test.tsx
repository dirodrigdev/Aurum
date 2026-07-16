import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EcosystemPage } from './EcosystemPage';

const markup = renderToStaticMarkup(<EcosystemPage onBack={() => {}} />);

assert(markup.includes('data-testid="midas-ecosystem"'));
assert(markup.includes('Un ecosistema para entender el presente y proyectar el futuro'));
assert(markup.includes('GastApp observa. Aurum integra. MIDAS proyecta.'));
assert(markup.includes('Acceso protegido'));
assert(markup.includes('Pruebas automáticas'));
assert(markup.includes('Firebase Auth · Firestore · GitHub · Vercel · Playwright'));
assert.doesNotMatch(markup, /(?:CLP|USD|EUR|UF)\s*[\$€]?\s*\d[\d.,]{2,}/i);
assert.doesNotMatch(markup, /(?:\$|€)\s*\d/);

console.log('EcosystemPage tests passed');
