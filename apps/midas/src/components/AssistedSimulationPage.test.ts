import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAssistedDataSourceSummary,
  validateAssistedRuntimeInputs,
} from './AssistedSimulationPage';
import type { AssistedInputs } from '../domain/simulation/assistedSimulation';

const source = readFileSync(new URL('./AssistedSimulationPage.tsx', import.meta.url), 'utf8');

const baseInputs = (): AssistedInputs => ({
  initialCapitalClp: 1_500_000_000,
  extraContributionEnabled: false,
  extraContributionClp: 100_000_000,
  extraContributionYear: 5,
  horizonYears: 30,
  spendingMode: 'fixed',
  fixedMonthlyClp: 1_000_000,
  phase1MonthlyClp: 1_000_000,
  phase1Years: 8,
  phase2MonthlyClp: 800_000,
  portfolioMode: 'manual',
  portfolioEntryMode: 'amount',
  portfolioEntries: [],
  includeTwoOfThreeCheck: true,
  optimizationObjective: 'max_success',
  successThreshold: 0.85,
  gridStepPct: 5,
  nSim: 1000,
  seed: 42,
});

(() => {
  const summary = buildAssistedDataSourceSummary({
    profileId: 'custom',
    portfolioSourceMode: 'instruments',
    scenarioSignature: 'abcde12345fghij',
  });
  assert.equal(summary.source, 'Fuente: capital ingresado manualmente · instrumentos seleccionados');
  assert.equal(summary.sync, 'No sincronizado con Simulación principal');
  assert.equal(summary.fingerprintShort, 'abcde12345');
})();

(() => {
  const summary = buildAssistedDataSourceSummary({
    profileId: 'me_scenario',
    portfolioSourceMode: 'simple',
    scenarioSignature: null,
  });
  assert.equal(summary.source, 'Fuente: perfil rápido · mix simple RV/RF');
  assert.equal(summary.fingerprintShort, null);
})();

(() => {
  const invalidCapital = baseInputs();
  invalidCapital.initialCapitalClp = 0;
  assert.equal(
    validateAssistedRuntimeInputs({
      runtimeInputs: invalidCapital,
      questionMode: 'success',
      portfolioSourceMode: 'instruments',
    }),
    'Ingresa un capital total mayor a 0 antes de calcular.',
  );
})();

(() => {
  const invalidPct = baseInputs();
  invalidPct.portfolioEntryMode = 'percentage';
  invalidPct.portfolioEntries = [
    { instrumentId: 'a', amountClp: 0, percentage: 60 },
    { instrumentId: 'b', amountClp: 0, percentage: 30 },
  ];
  assert.equal(
    validateAssistedRuntimeInputs({
      runtimeInputs: invalidPct,
      questionMode: 'success',
      portfolioSourceMode: 'instruments',
    }),
    'Los porcentajes del portafolio deben sumar 100%.',
  );
})();

(() => {
  const invalidSpend = baseInputs();
  invalidSpend.fixedMonthlyClp = 0;
  assert.equal(
    validateAssistedRuntimeInputs({
      runtimeInputs: invalidSpend,
      questionMode: 'success',
      portfolioSourceMode: 'simple',
    }),
    'Ingresa un gasto mensual mayor a 0 para este modo.',
  );
})();

(() => {
  const valid = baseInputs();
  valid.portfolioEntryMode = 'percentage';
  valid.portfolioEntries = [
    { instrumentId: 'a', amountClp: 0, percentage: 60 },
    { instrumentId: 'b', amountClp: 0, percentage: 40 },
  ];
  assert.equal(
    validateAssistedRuntimeInputs({
      runtimeInputs: valid,
      questionMode: 'success',
      portfolioSourceMode: 'instruments',
    }),
    null,
  );
})();

assert(source.includes('Asistida'));
assert(source.includes('Exploratorio'));
assert(source.includes('Calculadora simplificada para explorar preguntas rápidas. Para decidir, valida en Simulación.'));
assert(source.includes('No sincronizado con Simulación principal'));
assert(source.includes('Resultado exploratorio. No reemplaza el resultado auditado de Simulación.'));
assert(source.includes('Fuente:'));
assert(source.includes('Capital ingresado'));
assert(!source.includes('onClick={() => {}}'));

console.log('AssistedSimulationPage tests passed');
