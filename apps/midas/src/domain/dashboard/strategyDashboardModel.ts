import { buildMidasEvaluation } from '../model/midasEvaluation';
import { resolveQualityOfLifeKpiThreshold } from '../model/qualityOfLifeKpiThresholds';
import type { ModelParameters, SimulationResults } from '../model/types';
import type { M8GeneratorSleeveStats, M8Input, M8PortfolioMix } from '../simulation/m8.types';

export type DashboardTone = 'positive' | 'warning' | 'negative' | 'neutral';

export type DashboardMetric = {
  id: string;
  label: string;
  value: number | null;
  unit: '%' | 'años' | 'edad' | 'puntos';
  tone: DashboardTone;
  detail: string;
  category?: string;
};

export type DashboardRate = {
  id: string;
  label: string;
  value: number | null;
  detail: string;
};

export type DashboardShare = {
  id: string;
  label: string;
  share: number;
  color: string;
};

export type DashboardStrategyState = {
  active: boolean;
  label: string;
  detail: string;
  probability: number | null;
  expectedAge: number | null;
  relativeShare: number | null;
  dependence: 'baja' | 'media' | 'alta' | 'no aplicable';
};

export type DashboardLayer = {
  id: string;
  label: string;
  horizonLabel: string;
  categories: string[];
  role: string;
};

export type DashboardQualityIndicator = {
  id: string;
  label: string;
  value: number | null;
  valueKind: 'percent' | 'years' | 'score';
  status: DashboardTone;
  statusLabel: string;
  explanation: string;
};

export type DashboardSignal = {
  id: string;
  label: string;
  status: DashboardTone;
  statusLabel: 'Saludable' | 'Seguimiento' | 'Riesgo relevante' | 'Informativo';
  explanation: string;
};

export type DashboardScenario = {
  id: 'optimistic' | 'base' | 'pessimistic';
  label: string;
  success: number | null;
  note: string;
};

export type StrategyDashboardModel = {
  status: 'ready' | 'loading' | 'empty' | 'partial' | 'error';
  statusMessage: string;
  hero: {
    eyebrow: string;
    headline: string;
    conclusion: string;
    tone: DashboardTone;
    privacyNote: string;
  };
  primaryMetrics: DashboardMetric[];
  currentAge: number | null;
  targetAge: number | null;
  horizonYears: number | null;
  scenarioLabel: string;
  rates: DashboardRate[];
  house: DashboardStrategyState;
  riskReserve: DashboardStrategyState;
  mix: DashboardShare[];
  regionalExposure: DashboardShare[];
  layers: DashboardLayer[];
  scenarios: DashboardScenario[];
  quality: DashboardQualityIndicator[];
  signals: DashboardSignal[];
  interpretation: {
    strength: string;
    mainRisk: string;
    dependence: string;
    watchVariable: string;
    qualityOfLife: string;
    generalState: string;
  };
};

export type BuildStrategyDashboardInput = {
  result: SimulationResults | null;
  params: ModelParameters;
  m8Input: M8Input | null;
  currentAge: number | null;
  scenarioLabel: string;
  canonicalInputReady: boolean;
  simulationWorking: boolean;
  simulationError: string | null;
  riskCapitalEnabled: boolean;
  riskCapitalEffective: boolean;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toneFromProbability = (value: number | null, inverse = false): DashboardTone => {
  if (value === null) return 'neutral';
  const healthy = inverse ? value <= 0.05 : value >= 0.95;
  const watch = inverse ? value <= 0.15 : value >= 0.85;
  if (healthy) return 'positive';
  if (watch) return 'warning';
  return 'negative';
};

const statusLabel = (status: DashboardTone): DashboardSignal['statusLabel'] => {
  if (status === 'positive') return 'Saludable';
  if (status === 'warning') return 'Seguimiento';
  if (status === 'negative') return 'Riesgo relevante';
  return 'Informativo';
};

const qualityTone = (status: 'green' | 'yellow' | 'red' | 'neutral'): DashboardTone => {
  if (status === 'green') return 'positive';
  if (status === 'yellow') return 'warning';
  if (status === 'red') return 'negative';
  return 'neutral';
};

const normalizeMix = (mix: M8PortfolioMix): M8PortfolioMix => {
  const total = Object.values(mix).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (total <= 0) return { eq_global: 0, eq_chile: 0, fi_global: 0, fi_chile: 0, usd_liquidity: 0, clp_cash: 0 };
  return Object.fromEntries(Object.entries(mix).map(([key, value]) => [key, Math.max(0, Number(value) || 0) / total])) as unknown as M8PortfolioMix;
};

const readSleeves = (input: M8Input): Record<string, M8GeneratorSleeveStats> => {
  const generator = input.generator_params as unknown as {
    sleeves?: Record<string, M8GeneratorSleeveStats>;
    regimes?: { normal?: { sleeves?: Record<string, M8GeneratorSleeveStats> } };
  };
  return generator.sleeves ?? generator.regimes?.normal?.sleeves ?? {};
};

const expectedReturn = (input: M8Input): number | null => {
  const mix = normalizeMix(input.portfolio_mix);
  const sleeves = readSleeves(input);
  const keys = Object.keys(mix) as Array<keyof M8PortfolioMix>;
  const value = keys.reduce((sum, key) => sum + mix[key] * Number(sleeves[key]?.mean_annual ?? input.return_assumptions[`${key}_real_annual` as keyof M8Input['return_assumptions']] ?? 0), 0);
  return finite(value);
};

const expectedVolatility = (input: M8Input): number | null => {
  const mix = normalizeMix(input.portfolio_mix);
  const sleeves = readSleeves(input);
  const keys = Object.keys(mix) as Array<keyof M8PortfolioMix>;
  const weighted = keys.reduce((sum, key) => sum + mix[key] * Number(sleeves[key]?.vol_annual ?? 0), 0);
  return finite(weighted);
};

const dependenceFromShare = (share: number | null): DashboardStrategyState['dependence'] => {
  if (share === null || share <= 0) return 'no aplicable';
  if (share <= 0.05) return 'baja';
  if (share <= 0.12) return 'media';
  return 'alta';
};

const buildEmptyModel = (input: BuildStrategyDashboardInput): StrategyDashboardModel => {
  const horizonYears = input.m8Input?.years ?? Math.round(input.params.simulation.horizonMonths / 12);
  const targetAge = input.currentAge === null ? null : input.currentAge + horizonYears;
  const status: StrategyDashboardModel['status'] = input.simulationError
    ? 'error'
    : input.simulationWorking || !input.canonicalInputReady
      ? 'loading'
      : 'empty';
  const statusMessage = input.simulationError
    ? 'No fue posible leer un resultado vigente. Revisa Simulación y vuelve a ejecutar el modelo.'
    : status === 'loading'
      ? 'Preparando el input canónico y los indicadores del plan.'
      : 'Ejecuta una simulación para generar los indicadores del Dashboard.';
  return {
    status,
    statusMessage,
    hero: {
      eyebrow: 'Lectura estratégica · MIDAS M8',
      headline: 'Dashboard de estrategia',
      conclusion: statusMessage,
      tone: 'neutral',
      privacyNote: 'Vista de presentación: los valores monetarios permanecen ocultos.',
    },
    primaryMetrics: [],
    currentAge: input.currentAge,
    targetAge,
    horizonYears,
    scenarioLabel: input.scenarioLabel,
    rates: [],
    house: { active: false, label: 'Sin resultado vigente', detail: 'Se completará al ejecutar la simulación.', probability: null, expectedAge: null, relativeShare: null, dependence: 'no aplicable' },
    riskReserve: { active: false, label: 'Sin resultado vigente', detail: 'Se completará al ejecutar la simulación.', probability: null, expectedAge: null, relativeShare: null, dependence: 'no aplicable' },
    mix: [],
    regionalExposure: [],
    layers: [],
    scenarios: [],
    quality: [],
    signals: [],
    interpretation: {
      strength: 'Sin lectura disponible.', mainRisk: 'Sin lectura disponible.', dependence: 'Sin lectura disponible.',
      watchVariable: 'Sin lectura disponible.', qualityOfLife: 'Sin lectura disponible.', generalState: statusMessage,
    },
  };
};

export function buildStrategyDashboardModel(input: BuildStrategyDashboardInput): StrategyDashboardModel {
  if (!input.result || !input.m8Input) return buildEmptyModel(input);

  const result = input.result;
  const m8 = input.m8Input;
  const quality = result.qualityOfLifeMetrics ?? null;
  const rawRuin = finite(result.probRuin40 ?? result.probRuin);
  const rawSuccess = finite(result.success40 ?? (rawRuin === null ? null : 1 - rawRuin));
  const success = rawSuccess === null ? null : clamp01(rawSuccess);
  const ruin = success === null ? (rawRuin === null ? null : clamp01(rawRuin)) : clamp01(1 - success);
  const horizonYears = Math.round(m8.years);
  const targetAge = input.currentAge === null ? null : input.currentAge + horizonYears;
  const evaluation = buildMidasEvaluation({ qualityOfLifeMetrics: quality, inputAuditable: true, canUseForDecision: true, decisionStatus: 'canonical' });
  const mix = normalizeMix(m8.portfolio_mix);
  const equityShare = clamp01(mix.eq_global + mix.eq_chile);
  const fixedIncomeShare = clamp01(mix.fi_global + mix.fi_chile);
  const liquidityShare = clamp01(mix.usd_liquidity + mix.clp_cash);
  const globalSleevesShare = clamp01(mix.eq_global + mix.fi_global + mix.usd_liquidity);
  const chileSleevesShare = clamp01(mix.eq_chile + mix.fi_chile + mix.clp_cash);
  const withdrawalRate = m8.capital_initial_clp > 0 ? clamp01((m8.phase1MonthlyClp * 12) / m8.capital_initial_clp) : null;
  const riskShare = Number(m8.risk_capital_clp ?? 0) > 0 && m8.capital_initial_clp > 0
    ? clamp01(Number(m8.risk_capital_clp) / (m8.capital_initial_clp + Number(m8.risk_capital_clp)))
    : null;
  const houseActive = Boolean(m8.house?.include_house);
  const houseProbability = houseActive ? finite(result.houseSalePct ?? quality?.houseSaleIncidence) : null;
  const houseSaleYear = houseActive ? finite(result.saleYearMedian ?? quality?.houseSaleYearMedian) : null;
  const houseExpectedAge = houseSaleYear === null || input.currentAge === null ? null : Math.round(input.currentAge + houseSaleYear);

  const mixShares: DashboardShare[] = [
    { id: 'equity', label: 'Renta variable', share: equityShare, color: '#63F5B1' },
    { id: 'fixed-income', label: 'Renta fija', share: fixedIncomeShare, color: '#6D9DFF' },
    { id: 'liquidity', label: 'Liquidez', share: liquidityShare, color: '#E8C774' },
  ].filter((item) => item.share > 0.0001);

  const qualityIds = ['csr85_4', 'qualitySurvivalRate', 'averageEffectiveSpendingRatio', 'severeCutYearsMean'] as const;
  const qualityLabels = {
    csr85_4: 'Calidad mínima sostenible',
    qualitySurvivalRate: 'Supervivencia con calidad',
    averageEffectiveSpendingRatio: 'Estabilidad del nivel de vida',
    severeCutYearsMean: 'Años medios de recorte severo',
  };
  const qualityIndicators: DashboardQualityIndicator[] = quality ? qualityIds.map((id) => {
    const threshold = resolveQualityOfLifeKpiThreshold(id, quality);
    return {
      id,
      label: qualityLabels[id],
      value: finite(quality[id]),
      valueKind: id === 'severeCutYearsMean' ? 'years' : 'percent',
      status: qualityTone(threshold.status),
      statusLabel: threshold.label,
      explanation: threshold.explanation,
    };
  }) : [];

  const sustainabilityTone = toneFromProbability(success);
  const ruinTone = toneFromProbability(ruin, true);
  const bucketMonths = finite(m8.bucket?.bucket_months) ?? 0;
  const drawdownP50 = finite(result.maxDrawdownPercentiles?.[50]);
  const qualityPrimaryTone = qualityIndicators.find((item) => item.id === 'qualitySurvivalRate')?.status ?? 'neutral';

  const signals: DashboardSignal[] = [
    { id: 'sustainability', label: 'Sostenibilidad general', status: sustainabilityTone, statusLabel: statusLabel(sustainabilityTone), explanation: success === null ? 'Sin resultado suficiente.' : 'Clasificación basada en la probabilidad de sostenibilidad al horizonte.' },
    { id: 'liquidity', label: 'Liquidez de corto plazo', status: 'neutral', statusLabel: statusLabel('neutral'), explanation: `La capa operativa configurada cubre ${Math.round(bucketMonths)} meses; se informa sin asignar un umbral de salud nuevo.` },
    { id: 'resilience', label: 'Resiliencia ante caídas', status: 'neutral', statusLabel: statusLabel('neutral'), explanation: drawdownP50 === null ? 'El motor no entregó una mediana de drawdown utilizable.' : 'Lectura informativa basada en el drawdown mediano de las trayectorias.' },
    { id: 'diversification', label: 'Consistencia del mix', status: 'neutral', statusLabel: statusLabel('neutral'), explanation: 'Composición relativa del mix; no se clasifica sin un umbral oficial.' },
    { id: 'ruin-risk', label: 'Riesgo de agotamiento', status: ruinTone, statusLabel: statusLabel(ruinTone), explanation: 'Es el complemento de la sostenibilidad al mismo horizonte evaluado.' },
    { id: 'house-dependence', label: 'Dependencia de venta de vivienda', status: 'neutral', statusLabel: statusLabel('neutral'), explanation: !houseActive ? 'La vivienda no forma parte del escenario activo.' : 'Incidencia informativa de venta dentro de las trayectorias.' },
    { id: 'risk-dependence', label: 'Dependencia de capital de riesgo', status: 'neutral', statusLabel: statusLabel('neutral'), explanation: !input.riskCapitalEffective ? 'La reserva de riesgo no está activa en esta corrida.' : 'Participación relativa informativa dentro de la estrategia.' },
    { id: 'quality', label: 'Calidad de vida', status: qualityPrimaryTone, statusLabel: statusLabel(qualityPrimaryTone), explanation: 'Usa el filtro estricto de calidad de vida ya calculado por MIDAS.' },
  ];

  const optimisticRuin = finite(result.scenarioComparison?.optimistic.probRuin);
  const baseRuin = finite(result.scenarioComparison?.base.probRuin ?? ruin);
  const pessimisticRuin = finite(result.scenarioComparison?.pessimistic.probRuin);
  const scenarios: DashboardScenario[] = [
    { id: 'optimistic', label: 'Entorno favorable', success: optimisticRuin === null ? null : clamp01(1 - optimisticRuin), note: 'Supuestos favorables del comparador vigente.' },
    { id: 'base', label: 'Escenario activo', success: baseRuin === null ? success : clamp01(1 - baseRuin), note: input.scenarioLabel },
    { id: 'pessimistic', label: 'Entorno adverso', success: pessimisticRuin === null ? null : clamp01(1 - pessimisticRuin), note: 'Supuestos adversos del comparador vigente.' },
  ];

  const heroTone = sustainabilityTone;
  const targetText = targetAge === null ? 'el horizonte objetivo' : `los ${targetAge} años`;
  const conclusion = success === null
    ? 'El resultado vigente no permite establecer una probabilidad de sostenibilidad.'
    : `La estrategia presenta una probabilidad de sostenibilidad del ${(success * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })}% hasta ${targetText}.`;
  const strongestSignal = signals.find((signal) => signal.status === 'positive');
  const weakestSignal = signals.find((signal) => signal.status === 'negative') ?? signals.find((signal) => signal.status === 'warning');
  const qualityOfLifeSummary = !quality
    ? 'Las métricas de calidad de vida están incompletas.'
    : evaluation.label === 'Frágil' && success !== null && success >= 0.85
      ? 'Alta sostenibilidad financiera, con fragilidad relevante en calidad de vida bajo los supuestos actuales.'
      : evaluation.label === 'Frágil'
        ? 'Bajo los supuestos actuales, la calidad de vida presenta fragilidad relevante y requiere atención.'
        : qualityPrimaryTone === 'warning' && sustainabilityTone === 'positive'
          ? 'Sostenibilidad financiera alta, con calidad de vida que requiere seguimiento.'
          : `${evaluation.label}. ${evaluation.qualityAssessment}`;
  const qualityScoreDetail = evaluation.label === 'Frágil'
    ? 'La puntuación mejora, pero la clasificación permanece frágil porque la supervivencia con calidad continúa bajo el umbral requerido.'
    : 'La puntuación y la clasificación son dimensiones relacionadas pero distintas.';

  return {
    status: quality ? 'ready' : 'partial',
    statusMessage: quality ? 'Resultado vigente y métricas de calidad disponibles.' : 'Resultado vigente con indicadores de calidad parciales.',
    hero: {
      eyebrow: 'Lectura estratégica · MIDAS M8',
      headline: `¿El plan se sostiene hasta ${targetText}?`,
      conclusion,
      tone: heroTone,
      privacyNote: 'Vista de presentación: los valores monetarios permanecen ocultos.',
    },
    primaryMetrics: [
      { id: 'success', label: `Sostenibilidad hasta ${targetText}`, value: success, unit: '%', tone: sustainabilityTone, detail: 'Probabilidad de completar el horizonte sin agotamiento.' },
      { id: 'ruin', label: `Agotamiento antes de ${targetText}`, value: ruin, unit: '%', tone: ruinTone, detail: 'Complemento de la sostenibilidad en el mismo horizonte.' },
      { id: 'horizon', label: 'Horizonte evaluado', value: horizonYears, unit: 'años', tone: 'neutral', detail: 'Duración total considerada por el motor.' },
      { id: 'withdrawal-rate', label: 'Tasa inicial de retiro', value: withdrawalRate, unit: '%', tone: withdrawalRate === null ? 'neutral' : withdrawalRate <= 0.05 ? 'positive' : withdrawalRate <= 0.07 ? 'warning' : 'negative', detail: 'Relación anual inicial utilizada por el escenario activo.' },
      { id: 'qol-score', label: 'Índice de calidad de vida', value: finite(evaluation.rawScore), unit: 'puntos', tone: qualityPrimaryTone, detail: qualityScoreDetail, category: evaluation.label },
    ],
    currentAge: input.currentAge,
    targetAge,
    horizonYears,
    scenarioLabel: input.scenarioLabel,
    rates: [
      { id: 'expected-return', label: 'Retorno real esperado del mix', value: expectedReturn(m8), detail: 'Promedio ponderado de los supuestos reales por sleeve.' },
      { id: 'inflation', label: 'IPC declarado (no aplicado por M8)', value: finite(input.params.inflation.ipcChileAnnual), detail: 'Referencia técnica heredada; el M8 activo trabaja en términos reales.' },
      { id: 'fee', label: 'Costo anual considerado', value: finite(m8.feeAnnual ?? input.params.feeAnnual), detail: 'Tasa anual aplicada en la configuración vigente.' },
      { id: 'volatility', label: 'Volatilidad ponderada indicativa', value: expectedVolatility(m8), detail: 'Promedio ponderado de volatilidades; no es una proyección.' },
    ],
    house: {
      active: houseActive,
      label: houseActive ? 'Venta de vivienda considerada' : 'Venta de vivienda no incorporada',
      detail: houseActive ? 'Funciona como liquidez contingente si el motor activa la regla.' : 'No aporta liquidez al escenario evaluado.',
      probability: houseProbability,
      expectedAge: houseExpectedAge,
      relativeShare: null,
      dependence: dependenceFromShare(houseProbability),
    },
    riskReserve: {
      active: input.riskCapitalEnabled && input.riskCapitalEffective,
      label: input.riskCapitalEnabled && input.riskCapitalEffective ? 'Capital de riesgo activado' : 'Capital de riesgo inactivo',
      detail: input.riskCapitalEnabled && input.riskCapitalEffective ? 'Reserva contingente de largo plazo según la política vigente.' : 'No participa en la corrida efectiva.',
      probability: null,
      expectedAge: null,
      relativeShare: riskShare,
      dependence: dependenceFromShare(riskShare),
    },
    mix: mixShares,
    regionalExposure: [
      { id: 'global', label: 'Sleeves globales', share: globalSleevesShare, color: '#9A7BFF' },
      { id: 'chile', label: 'Sleeves Chile', share: chileSleevesShare, color: '#47C7D8' },
    ].filter((item) => item.share > 0.0001),
    layers: [
      { id: 'operational', label: 'Liquidez operativa', horizonLabel: `0–${Math.max(1, Math.round(bucketMonths / 12))} años`, categories: ['EUR', 'USD utilizable', 'Caja CLP'], role: 'Absorber gasto próximo y reducir ventas forzadas.' },
      { id: 'stability', label: 'Capa de estabilidad', horizonLabel: `${Math.max(1, Math.round(bucketMonths / 12))}+ años`, categories: ['Renta fija global', 'Renta fija CLP'], role: 'Recargar liquidez y amortiguar volatilidad.' },
      { id: 'growth', label: 'Capa de crecimiento', horizonLabel: 'Largo plazo', categories: ['Renta variable global', 'Renta variable Chile'], role: 'Sostener crecimiento real durante el horizonte.' },
      ...(input.riskCapitalEnabled && input.riskCapitalEffective ? [{ id: 'contingency', label: 'Reserva contingente', horizonLabel: 'Condicional', categories: ['Capital de riesgo'], role: 'Apoyo tardío bajo la política configurada.' }] : []),
    ],
    scenarios,
    quality: qualityIndicators,
    signals,
    interpretation: {
      strength: strongestSignal ? `${strongestSignal.label}: ${strongestSignal.explanation}` : 'No hay una fortaleza suficientemente respaldada para destacar.',
      mainRisk: weakestSignal ? `${weakestSignal.label}: ${weakestSignal.explanation}` : 'No aparece una alerta dominante en los indicadores disponibles.',
      dependence: houseActive && (houseProbability ?? 0) > 0.35 ? 'La venta de vivienda tiene una incidencia relevante en las trayectorias.' : input.riskCapitalEffective && (riskShare ?? 0) > 0.12 ? 'La reserva de riesgo tiene una participación relativa relevante.' : 'No se observa una dependencia extraordinaria dominante.',
      watchVariable: expectedReturn(m8) === null ? 'Revisar la completitud de los supuestos de retorno.' : 'Vigilar retorno real esperado y estabilidad del gasto efectivo.',
      qualityOfLife: qualityOfLifeSummary,
      generalState: conclusion,
    },
  };
}
