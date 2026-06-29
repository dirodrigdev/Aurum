import type {
  MidasEvaluationConfidenceBand,
  MidasEvaluationLabel,
  MidasEvaluationV1,
  QualityOfLifeMetricsV1,
} from './types';

type BuildMidasEvaluationInput = {
  qualityOfLifeMetrics?: QualityOfLifeMetricsV1 | null;
  inputAuditable?: boolean;
  canUseForDecision?: boolean;
  decisionStatus?: 'canonical' | 'review' | 'not_decisional';
  comparabilityWarnings?: string[];
};

const CRITICAL_QOL_WARNINGS = new Set([
  'path_quality_diagnostics_missing',
  'path_count_zero',
  'path_details_missing',
  'average_consumption_ratio_missing',
  'months_below_85_missing',
  'max_consecutive_months_below_85_missing',
  'terminal_wealth_missing',
]);

const LABEL_ORDER: MidasEvaluationLabel[] = [
  'No comparable',
  'Frágil',
  'Exigido',
  'Bueno',
  'Bueno alto',
  'Muy sólido',
];

const dedupe = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const capLabel = (
  current: MidasEvaluationLabel,
  maxAllowed: MidasEvaluationLabel,
): MidasEvaluationLabel => {
  const currentIndex = LABEL_ORDER.indexOf(current);
  const maxIndex = LABEL_ORDER.indexOf(maxAllowed);
  if (currentIndex === -1 || maxIndex === -1) return current;
  return currentIndex > maxIndex ? maxAllowed : current;
};

const scoreToLabel = (score: number): MidasEvaluationLabel => {
  if (score >= 88) return 'Muy sólido';
  if (score >= 78) return 'Bueno alto';
  if (score >= 68) return 'Bueno';
  if (score >= 52) return 'Exigido';
  return 'Frágil';
};

const buildNotComparable = (warnings: string[]): MidasEvaluationV1 => ({
  schemaVersion: 1,
  source: 'quality_of_life_metrics_v1',
  label: 'No comparable',
  rawScore: null,
  cappedScore: null,
  confidenceBand: 'low',
  noRuinAssessment: 'Comparabilidad insuficiente.',
  qualityAssessment: 'Faltan datos auditables para clasificar.',
  earlyStressAssessment: 'Sin lectura comparable.',
  tailStressAssessment: 'Sin lectura comparable.',
  terminalWealthAssessment: 'Sin lectura comparable.',
  houseSaleAssessment: 'Sin lectura comparable.',
  capsApplied: [],
  alerts: ['La simulación no es comparable con confianza suficiente.'],
  warnings,
  isComparable: false,
});

const assessNoRuin = (value: number | null | undefined): string => {
  if (!isFiniteNumber(value)) return 'No ruina no disponible.';
  if (value >= 0.9) return 'No ruina fuerte.';
  if (value >= 0.8) return 'No ruina razonable.';
  if (value >= 0.7) return 'No ruina justa.';
  return 'No ruina frágil.';
};

const assessQuality = (value: number | null | undefined): string => {
  if (!isFiniteNumber(value)) return 'Calidad no disponible.';
  if (value >= 0.8) return 'Calidad de vida limpia.';
  if (value >= 0.65) return 'Calidad buena con salvedades.';
  if (value >= 0.5) return 'Calidad exigida.';
  return 'Calidad frágil.';
};

const assessEarlyStress = (months: number | null | undefined): string => {
  if (!isFiniteNumber(months)) return 'Estrés temprano no disponible.';
  if (months <= 1) return 'Sin estrés temprano relevante.';
  if (months <= 2) return 'Estrés temprano leve.';
  if (months <= 3) return 'Estrés temprano visible.';
  if (months <= 6) return 'Estrés temprano exigente.';
  return 'Estrés temprano frágil.';
};

const assessTailStress = (
  totalMonths: number | null | undefined,
  streakMonths: number | null | undefined,
): string => {
  if (!isFiniteNumber(totalMonths) || !isFiniteNumber(streakMonths)) return 'Estrés acumulado no disponible.';
  if (totalMonths <= 12 && streakMonths <= 3) return 'Estrés acumulado bajo.';
  if (totalMonths <= 24 && streakMonths <= 6) return 'Estrés acumulado manejable.';
  if (totalMonths <= 36 && streakMonths <= 12) return 'Estrés acumulado exigente.';
  return 'Estrés acumulado frágil.';
};

const assessTerminalWealth = (
  ratio: number | null | undefined,
  monthsBelow85: number | null | undefined,
): string => {
  if (!isFiniteNumber(ratio)) return 'Margen terminal no disponible.';
  const hasStress = isFiniteNumber(monthsBelow85) && monthsBelow85 > 0;
  if (hasStress && ratio > 1) return 'Patrimonio final alto pese a recortes: posible subuso.';
  if (hasStress && ratio > 0.75) return 'Patrimonio final holgado con recortes: revisar uso.';
  if (!hasStress && ratio > 1) return 'Patrimonio final alto sin estrés relevante: alerta suave.';
  if (ratio < 0.25) return 'Margen terminal acotado.';
  return 'Margen terminal consistente con la trayectoria.';
};

const assessHouseSale = (
  incidence: number | null | undefined,
  severeDuringSale: number | null | undefined,
): string => {
  if (!isFiniteNumber(incidence)) return 'Sin lectura de venta de casa.';
  if (incidence === 0) return 'No requiere venta de casa.';
  if (isFiniteNumber(severeDuringSale) && severeDuringSale > 6) {
    return 'La venta de casa aparece bajo estrés operativo.';
  }
  return 'La venta de casa aparece como liquidez, no como fracaso automático.';
};

const determineConfidenceBand = (
  decisionStatus: BuildMidasEvaluationInput['decisionStatus'],
  warnings: string[],
  comparable: boolean,
): MidasEvaluationConfidenceBand => {
  if (!comparable) return 'low';
  if (decisionStatus === 'canonical' && warnings.length === 0) return 'high';
  if (decisionStatus === 'review' || warnings.length <= 3) return 'medium';
  return 'low';
};

export function buildMidasEvaluation(
  input: BuildMidasEvaluationInput,
): MidasEvaluationV1 {
  const quality = input.qualityOfLifeMetrics;
  const warnings = dedupe([
    ...(quality?.warnings ?? []),
    ...(input.comparabilityWarnings ?? []),
    ...(input.inputAuditable === false ? ['input_not_auditable'] : []),
    ...(input.canUseForDecision === false ? ['result_not_comparable_for_decision'] : []),
  ]);

  if (!quality) {
    return buildNotComparable(dedupe(['quality_of_life_metrics_missing', ...warnings]));
  }

  const hasCriticalWarnings = warnings.some((warning) => CRITICAL_QOL_WARNINGS.has(warning));
  const comparable = (input.inputAuditable ?? true) && (input.canUseForDecision ?? true) && !hasCriticalWarnings;
  if (!comparable) {
    return buildNotComparable(warnings);
  }

  const classicSuccessRate = quality.classicSuccessRate ?? 0;
  const qualitySurvivalRate = quality.qualitySurvivalRate ?? 0;
  const qasrStrict = quality.qasrStrict ?? 0;
  const effectiveSpendingRatio = clamp(quality.averageEffectiveSpendingRatio ?? 0, 0, 1);
  const monthsBelow85 = quality.monthsBelow85;
  const maxConsecutiveMonthsBelow85 = quality.maxConsecutiveMonthsBelow85;
  const earlyStressMonths = quality.earlyStressMonths;
  const terminalWealthRatio = quality.terminalWealthRatio;
  const houseSaleIncidence = quality.houseSaleIncidence;
  const severeDuringSale = quality.severeCutMonthsDuringHouseSaleMedian ?? quality.severeCutMonthsDuringHouseSaleMean;

  let rawScore = (
    (classicSuccessRate * 0.3)
    + (qualitySurvivalRate * 0.4)
    + (qasrStrict * 0.2)
    + (effectiveSpendingRatio * 0.1)
  ) * 100;

  if (isFiniteNumber(earlyStressMonths)) rawScore -= Math.min(10, earlyStressMonths * 1.4);
  if (isFiniteNumber(terminalWealthRatio) && isFiniteNumber(monthsBelow85) && monthsBelow85 > 0) {
    if (terminalWealthRatio > 1) rawScore -= 8;
    else if (terminalWealthRatio > 0.75) rawScore -= 4;
  }

  rawScore = clamp(rawScore, 0, 100);

  let label = scoreToLabel(rawScore);
  const capsApplied: string[] = [];
  const alerts: string[] = [];

  const applyCap = (maxAllowed: MidasEvaluationLabel, reason: string) => {
    const nextLabel = capLabel(label, maxAllowed);
    if (nextLabel !== label) {
      label = nextLabel;
      capsApplied.push(reason);
    }
  };

  if (qualitySurvivalRate < 0.35) applyCap('Frágil', 'qualitySurvivalRate bajo');
  else if (qualitySurvivalRate < 0.55) applyCap('Exigido', 'qualitySurvivalRate exigido');
  else if (qualitySurvivalRate < 0.7) applyCap('Bueno', 'qualitySurvivalRate limita el tramo alto');

  if (isFiniteNumber(earlyStressMonths)) {
    if (earlyStressMonths === 2) applyCap('Bueno alto', 'estrés temprano: 2 meses bajo 85%');
    else if (earlyStressMonths === 3) applyCap('Bueno', 'estrés temprano: 3 meses bajo 85%');
    else if (earlyStressMonths >= 4 && earlyStressMonths <= 5) applyCap('Exigido', 'estrés temprano: 4-5 meses bajo 85%');
    else if (earlyStressMonths >= 6) applyCap('Frágil', 'estrés temprano: 6+ meses bajo 85%');
  }

  if (isFiniteNumber(maxConsecutiveMonthsBelow85)) {
    if (maxConsecutiveMonthsBelow85 > 12) applyCap('Frágil', 'racha bajo 85% demasiado larga');
    else if (maxConsecutiveMonthsBelow85 > 6) applyCap('Exigido', 'racha bajo 85% mayor a 6 meses');
  }

  if (isFiniteNumber(monthsBelow85)) {
    if (monthsBelow85 > 36) applyCap('Frágil', 'meses acumulados bajo 85% demasiado altos');
    else if (monthsBelow85 > 24) applyCap('Exigido', 'meses acumulados bajo 85% sobre el umbral');
  }

  if (isFiniteNumber(terminalWealthRatio)) {
    const hasStress = isFiniteNumber(monthsBelow85) && monthsBelow85 > 0;
    if (hasStress && terminalWealthRatio > 1) {
      applyCap('Exigido', 'terminal wealth alto pese a recortes');
      alerts.push('Patrimonio terminal >100% del capital inicial pese a recortes.');
    } else if (hasStress && terminalWealthRatio > 0.75) {
      applyCap('Bueno', 'terminal wealth alto con recortes');
      alerts.push('Patrimonio terminal >75% del capital inicial con recortes.');
    } else if (!hasStress && terminalWealthRatio > 1) {
      alerts.push('Patrimonio terminal alto sin recortes relevantes: revisar subuso.');
    }
  }

  if (isFiniteNumber(houseSaleIncidence) && houseSaleIncidence > 0) {
    if (isFiniteNumber(severeDuringSale) && severeDuringSale > 6) {
      alerts.push('La liquidez vía venta de casa aparece con estrés operativo relevante.');
    } else {
      alerts.push('La venta de casa se interpreta como liquidez, no como fracaso automático.');
    }
  }

  const cappedScore = LABEL_ORDER.indexOf(label) <= 0
    ? rawScore
    : ({
      'Muy sólido': Math.max(rawScore, 88),
      'Bueno alto': clamp(rawScore, 78, 87.99),
      'Bueno': clamp(rawScore, 68, 77.99),
      'Exigido': clamp(rawScore, 52, 67.99),
      'Frágil': clamp(rawScore, 0, 51.99),
      'No comparable': rawScore,
    } as Record<MidasEvaluationLabel, number>)[label];

  return {
    schemaVersion: 1,
    source: 'quality_of_life_metrics_v1',
    label,
    rawScore: Number(rawScore.toFixed(1)),
    cappedScore: Number(cappedScore.toFixed(1)),
    confidenceBand: determineConfidenceBand(input.decisionStatus, warnings, true),
    noRuinAssessment: assessNoRuin(quality.classicSuccessRate),
    qualityAssessment: assessQuality(quality.qualitySurvivalRate),
    earlyStressAssessment: assessEarlyStress(quality.earlyStressMonths),
    tailStressAssessment: assessTailStress(quality.monthsBelow85, quality.maxConsecutiveMonthsBelow85),
    terminalWealthAssessment: assessTerminalWealth(quality.terminalWealthRatio, quality.monthsBelow85),
    houseSaleAssessment: assessHouseSale(quality.houseSaleIncidence, severeDuringSale),
    capsApplied,
    alerts: dedupe(alerts),
    warnings,
    isComparable: true,
  };
}
