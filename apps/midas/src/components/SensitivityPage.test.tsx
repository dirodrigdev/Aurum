import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SensitivityPage } from './SensitivityPage';
import type { M8InputFingerprint } from '../domain/model/m8InputFingerprint';
import type { SimulationResults } from '../domain/model/types';
import type { M8Input } from '../domain/simulation/m8.types';

const source = readFileSync(new URL('./SensitivityPage.tsx', import.meta.url), 'utf8');

const normalizedInput: M8Input = {
  years: 40,
  n_paths: 100,
  seed: 42,
  simulation_frequency: 'monthly',
  use_real_terms: true,
  capital_initial_clp: 1_500_000_000,
  capital_source: 'aurum',
  portfolio_mix: {
    eq_global: 0.3,
    eq_chile: 0.1,
    fi_global: 0.2,
    fi_chile: 0.3,
    usd_liquidity: 0.05,
    clp_cash: 0.05,
  },
  phase1MonthlyClp: 6_000_000,
  phase2MonthlyClp: 6_000_000,
  phase3MonthlyClp: 3_900_000,
  phase4MonthlyClp: 5_400_000,
  phase1EndYear: 4,
  phase2EndYear: 20,
  phase3EndYear: 35,
  return_assumptions: {
    eq_global_real_annual: 0.07,
    eq_chile_real_annual: 0.06,
    fi_global_real_annual: 0.025,
    fi_chile_real_annual: 0.025,
    usd_liquidity_real_annual: 0.01,
    clp_cash_real_annual: 0.005,
  },
  generator_type: 'student_t',
  generator_params: {
    distribution: 'student_t',
    degrees_of_freedom: 7,
    sleeves: {
      eq_global: { mean_annual: 0.07, vol_annual: 0.18 },
      eq_chile: { mean_annual: 0.06, vol_annual: 0.2 },
      fi_global: { mean_annual: 0.025, vol_annual: 0.08 },
      fi_chile: { mean_annual: 0.025, vol_annual: 0.07 },
      usd_liquidity: { mean_annual: 0.01, vol_annual: 0.02 },
      clp_cash: { mean_annual: 0.005, vol_annual: 0.01 },
    },
    correlation_matrix: [
      [1, 0.7, 0.3, 0.2, 0.1, 0],
      [0.7, 1, 0.25, 0.2, 0.1, 0],
      [0.3, 0.25, 1, 0.45, 0.3, 0.1],
      [0.2, 0.2, 0.45, 1, 0.2, 0.15],
      [0.1, 0.1, 0.3, 0.2, 1, 0.2],
      [0, 0, 0.1, 0.15, 0.2, 1],
    ],
  },
  bucket: { bucket_mode: 'operational_simple', bucket_months: 24 },
  cuts: {
    cut1_floor: 0.92,
    cut2_floor: 0.84,
    recovery_cut2_to_cut1_months: 4,
    recovery_cut1_to_normal_months: 6,
    adjustment_alpha: 0.6,
    dd15_threshold: 0.15,
    dd25_threshold: 0.25,
    consecutive_months: 3,
  },
};

const fingerprint = {
  effectiveEngineInputHash: 'fnv1a-959dded4',
  normalizedInput,
} as unknown as M8InputFingerprint;

const simResult = {
  success40: 0.916,
  probRuin40: 0.084,
  probRuin: 0.084,
  nRuin: 84,
  houseSalePct: 0.246,
  saleYearMedian: 24.7,
  qualityOfLifeMetrics: {
    terminalWealthRatio: 2.18,
    csr85_4: 0.737,
    qualitySurvivalRate: 0.154,
    averageEffectiveSpendingRatio: 0.96,
    severeCutYearsMean: 2.9,
  },
} as unknown as SimulationResults;

const markup = renderToStaticMarkup(React.createElement(SensitivityPage, {
  canonicalInputReady: true,
  m8InputFingerprint: fingerprint,
  simResult,
}));

assert(markup.includes('Análisis de sensibilidad'));
assert(markup.includes('Calcular sensibilidad'));
assert(markup.includes('Baseline oficial'));
assert(markup.includes('Sensibilidad one-variable-at-a-time'));
assert(markup.includes('Valor requerido para subir +2 pp de éxito'));
assert(markup.includes('Estimación inversa manteniendo el resto constante'));
assert(markup.includes('Tablas one-variable-at-a-time'));
assert(markup.includes('No guarda cambios'));
assert(markup.includes('House sale aparece solo como métrica resultado'));
assert.equal(markup.includes('houseSaleTrigger'), false);
assert.equal(markup.includes('Capital inicial'), false);
assert.equal(source.includes('runOneVariableSensitivity('), true);
assert.equal(source.includes('Sensibilidad marginal'), true);
assert.equal(source.includes('Valor requerido estimado'), true);
assert.equal(source.includes('Base sensibilidad rápida'), true);
assert.equal(source.includes('Delta vs base sensibilidad'), true);
assert.equal(source.includes('Success objetivo'), true);
assert.equal(source.includes('Error vs target'), true);
assert.equal(source.includes('Resumen de palancas'), true);
assert.equal(source.includes('Más impacto'), true);
assert.equal(source.includes('Más accionable'), true);
assert.equal(source.includes('Mejor para calibrar'), true);
assert.equal(source.includes('Retorno esperado puede ser una variable muy sensible'), true);
assert.equal(source.includes('buildSensitivityLeverSummary(result)'), true);
assert.equal(source.includes('persistActiveSimulationConfig'), false);

console.log('SensitivityPage tests passed');
