// domain/model/defaults.ts
// Parámetros calibrados con datos reales hasta 2026-02
// V1.2: BTG corregido con carteras CMF + datos MSCI/AGGU 2025-2026

import type {
  ModelParameters, SensitivityParameter, StressScenario, OptimizerConstraints,
  ScenarioVariant
} from './types';

export const DEFAULT_PARAMETERS: ModelParameters = {
  label: 'Portafolio Real — V1.4',
  capitalInitial: 1_401_000_000,

  // CONFIRMED + corrección BTG (carteras CMF ene/abr/jul/oct 2025, ene 2026)
  // BTG Gestión Activa: promedio 4 períodos estables = 49% RV / 48% RF
  // BTG RV es ~75% nacional / 25% global (carteras CMF)
  // Movimiento vs V1.1: +4.5pp rvChile, -4.5pp rfChile
  weights: {
    rvGlobal: 0.359,
    rfGlobal: 0.119,
    rvChile:  0.264,
    rfChile:  0.257,
  },
  cashflowEvents: [],
  activeScenario: 'base',

  feeAnnual: 0.0035,

  spendingPhases: [
    { durationMonths: 36,  amountReal: 6_000,     currency: 'EUR' },
    { durationMonths: 204, amountReal: 6_000_000, currency: 'CLP' },
    { durationMonths: 240, amountReal: 4_000_000, currency: 'CLP' },
  ],

  spendingRule: {
    dd15Threshold: 0.15, dd25Threshold: 0.25,
    consecutiveMonths: 3, softCut: 0.90, hardCut: 0.80,
    adjustmentAlpha: 0.20,
  },

  // Calibrado con datos reales hasta 2026-02
  returns: {
    rvGlobalAnnual:   0.0765,  // MSCI World real 2000-2026 (era 0.0741 con 300 meses)
    rfGlobalAnnual:   0.0305,  // AGGU real 2000-2026 (era 0.0266)
    rvChileAnnual:    0.0927,  // blend SURA+AFP — sin cambio
    rfChileUFAnnual:  0.0102,  // real UF — sin cambio
    rvGlobalVolAnnual:  0.1532,
    rfGlobalVolAnnual:  0.0368,
    rvChileVolAnnual:   0.1141,
    rfChileVolAnnual:   0.0237,
    correlationMatrix: [
      [ 1.00, -0.20,  0.45,  0.08],
      [-0.20,  1.00,  0.05,  0.38],
      [ 0.45,  0.05,  1.00,  0.18],
      [ 0.08,  0.38,  0.18,  1.00],
    ],
  },

  inflation: {
    ipcChileAnnual:    0.0378,
    hipcEurAnnual:     0.0213,
    ipcChileVolAnnual: 0.0140,
    hipcEurVolAnnual:  0.0160,
  },

  fx: {
    clpUsdInitial:   984.59,
    usdEurFixed:     1.0472,
    tcrealLT:        640.0,
    mrHalfLifeYears: 5.0,      // PLACEHOLDER
  },

  simulation: {
    nSim: 5_000, horizonMonths: 480,
    blockLength: 12, seed: 42,
    useHistoricalData: true,
  },

  ruinThresholdMonths: 3,
};

// Escenarios con valores absolutos y auditables.
// Base = calibración histórica real 2000-2026. No apilar conservadurismo aquí.
// Pessimistic = plausible pero exigente. Optimistic = plausible pero favorable.
// Si se recalibra el base, estos valores NO cambian automáticamente.
export const SCENARIO_VARIANTS: ScenarioVariant[] = [
  {
    id: 'base', label: 'Base',
    // Sin overrides — usa todos los valores de DEFAULT_PARAMETERS
  },
  {
    id: 'pessimistic', label: 'Pesimista',
    rvGlobalAnnual:    0.045,
    rfGlobalAnnual:    0.015,
    rvChileAnnual:     0.055,
    rfChileUFAnnual:   0.000,
    rvGlobalVolAnnual: 0.200,
    rfGlobalVolAnnual: 0.048,
    rvChileVolAnnual:  0.148,
    rfChileVolAnnual:  0.031,
    ipcChileAnnual:    0.055,
    tcrealLT:          720,
  },
  {
    id: 'optimistic', label: 'Optimista',
    rvGlobalAnnual:    0.095,
    rfGlobalAnnual:    0.040,
    rvChileAnnual:     0.120,
    rfChileUFAnnual:   0.020,
    rvGlobalVolAnnual: 0.130,
    rfGlobalVolAnnual: 0.032,
    rvChileVolAnnual:  0.097,
    rfChileVolAnnual:  0.020,
    ipcChileAnnual:    0.025,
    tcrealLT:          560,
  },
];

// Pesos V1.1 para comparación en optimizador
export const WEIGHTS_V1_1 = {
  rvGlobal: 0.306, rfGlobal: 0.176, rvChile: 0.229, rfChile: 0.289,
};

export const SENSITIVITY_PARAMS: SensitivityParameter[] = [
  {
    id: 'blockLength', label: 'Block Length',
    paramPath: 'simulation.blockLength',
    values: [6, 12, 18], valueLabels: ['L=6', 'L=12', 'L=18'],
  },
  {
    id: 'tcrealLT', label: 'TCREAL LT',
    paramPath: 'fx.tcrealLT',
    values: [574, 650, 727],
    valueLabels: ['574 (LT)', '650 (base)', '727 (actual)'],
  },
  {
    id: 'feeAnnual', label: 'Fee anual',
    paramPath: 'feeAnnual',
    values: [0.0020, 0.0035, 0.0050],
    valueLabels: ['0.20%', '0.35%', '0.50%'],
  },
  {
    id: 'rvGlobalAnnual', label: 'Retorno RV Global',
    paramPath: 'returns.rvGlobalAnnual',
    values: [0.04, 0.0765, 0.10],
    valueLabels: ['4%', '7.7%', '10%'],
  },
  {
    id: 'rvChileAnnual', label: 'Retorno RV Chile',
    paramPath: 'returns.rvChileAnnual',
    values: [0.05, 0.0927, 0.12],
    valueLabels: ['5%', '9.3%', '12%'],
  },
  {
    id: 'ipcChileAnnual', label: 'IPC Chile',
    paramPath: 'inflation.ipcChileAnnual',
    values: [0.025, 0.038, 0.050, 0.070],
    valueLabels: ['2.5%', '3.8%', '5.0%', '7.0%'],
  },
  {
    id: 'spendingPhase2', label: 'Gasto Fase 2',
    paramPath: 'spendingPhases.1.amountReal',
    values: [4_000_000, 6_000_000, 8_000_000],
    valueLabels: ['4M', '6M', '8M'],
  },
  {
    id: 'rvChileWeight', label: 'Peso RV Chile',
    paramPath: 'weights.rvChile',
    values: [0.15, 0.263, 0.40],
    valueLabels: ['15%', '26%', '40%'],
  },
];

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: 'crisis_inicio', label: 'Crisis años 1–5',
    description: 'Crash inicial + mala secuencia de retornos. Peor caso para portafolio en retiro.',
    monthlyOverrides: [
      { fromMonth: 1, toMonth: 12, overrides: { r_RVg: -0.014, r_RFg: -0.008, r_RVcl: -0.018, r_RFcl: -0.004, ipc_cl_m: 0.0064, d_logCLPUSD: 0.0165 } },
      { fromMonth: 13, toMonth: 24, overrides: { r_RVg: -0.015, r_RFg: -0.004, r_RVcl: -0.016, ipc_cl_m: 0.0064, d_logCLPUSD: 0.007 } },
      { fromMonth: 25, toMonth: 60, overrides: { r_RVg: 0.001, r_RFg: 0.002, r_RVcl: 0.002, ipc_cl_m: 0.0050, d_logCLPUSD: 0.002 } },
    ],
  },
  {
    id: 'inflacion_alta', label: 'Inflación 7% × 10 años',
    description: 'IPC Chile 7% durante 10 años, luego normaliza a 4%.',
    monthlyOverrides: [
      { fromMonth: 1, toMonth: 120, overrides: { ipc_cl_m: 0.005654, d_logCLPUSD: 0.0018, r_RVcl: 0.0048, r_RFcl: 0.0040 } },
      { fromMonth: 121, toMonth: 480, overrides: { ipc_cl_m: 0.003274, d_logCLPUSD: 0.0010 } },
    ],
  },
  {
    id: 'caida_lenta', label: 'Crash –40% + L',
    description: 'Caída severa con recuperación muy lenta. Estilo 2000–2009.',
    monthlyOverrides: [
      { fromMonth: 1, toMonth: 1, overrides: { r_RVg: -0.40, r_RVcl: -0.35 } },
      { fromMonth: 2, toMonth: 12, overrides: { r_RVg: -0.005, r_RVcl: -0.006 } },
      { fromMonth: 13, toMonth: 60, overrides: { r_RVg: 0.001, r_RVcl: 0.001 } },
      { fromMonth: 61, toMonth: 120, overrides: { r_RVg: 0.003, r_RVcl: 0.003 } },
    ],
  },
  {
    id: 'clp_colapso', label: 'CLP –40% años 1–3',
    description: 'Depreciación del CLP en ventana crítica de gasto en EUR.',
    monthlyOverrides: [
      { fromMonth: 1, toMonth: 36, overrides: { d_logCLPUSD: 0.0280, ipc_cl_m: 0.0093, r_RVcl: -0.014 } },
      { fromMonth: 37, toMonth: 84, overrides: { d_logCLPUSD: -0.005 } },
    ],
  },
];

export const DEFAULT_OPTIMIZER_CONSTRAINTS: OptimizerConstraints = {
  minRvGlobal: 0.10, maxRvGlobal: 0.60,
  minRfGlobal: 0.05, maxRfGlobal: 0.40,
  minRvChile:  0.10, maxRvChile:  0.50,
  minRfChile:  0.10, maxRfChile:  0.50,
  step: 0.05,
};
