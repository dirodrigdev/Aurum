import type { RankedOptimizerCandidate } from './optimizerCandidateRanking';
import type { RvRfDecisionCandidate } from './rvRfDecisionProfiles';

export type OptimizerDecisionBriefRecommendationLevel =
  | 'strong'
  | 'preliminary'
  | 'review'
  | 'not_comparable';

export type OptimizerDecisionBrief = {
  recommendationLevel: OptimizerDecisionBriefRecommendationLevel;
  headline: string;
  recommendedCandidateId: string | null;
  whyThisWins: string[];
  keyTradeoffs: string[];
  riskWarnings: string[];
  qualityOfLifeSummary: string[];
  baselineComparison: {
    summary: string;
    deltas: string[];
  } | null;
  implementationNotes: string[];
  auditability: {
    status: 'strong' | 'weak';
    summary: string;
    hasTraceFingerprint: boolean;
    comparable: boolean;
  };
  nextReviewTriggers: string[];
};

type BuildOptimizerDecisionBriefInput = {
  recommendedCandidate: RvRfDecisionCandidate | null;
  rankedCandidates: RankedOptimizerCandidate[];
  baselineCandidate?: RvRfDecisionCandidate | null;
  inputFingerprint?: string | null;
  traceFingerprint?: string | null;
  recommendationKind?: 'official' | 'contingency' | 'none';
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const formatPctDelta = (delta: number): string =>
  `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pp`;

const formatMonthsDelta = (delta: number): string =>
  `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} meses`;

const dedupe = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

function buildBaselineComparison(
  recommendedCandidate: RvRfDecisionCandidate,
  baselineCandidate: RvRfDecisionCandidate | null | undefined,
): OptimizerDecisionBrief['baselineComparison'] {
  if (!baselineCandidate) return null;
  if (baselineCandidate.candidateId === recommendedCandidate.candidateId) {
    return {
      summary: 'Coincide con el baseline disponible; no aparece una mejora material nueva frente al mix ya evaluado.',
      deltas: [],
    };
  }

  const deltas: string[] = [];
  if (isFiniteNumber(recommendedCandidate.qasrBase) && isFiniteNumber(baselineCandidate.qasrBase)) {
    deltas.push(`QASR base ${formatPctDelta(recommendedCandidate.qasrBase - baselineCandidate.qasrBase)} vs baseline.`);
  }
  if (isFiniteNumber(recommendedCandidate.csrBase) && isFiniteNumber(baselineCandidate.csrBase)) {
    deltas.push(`CSR ${formatPctDelta(recommendedCandidate.csrBase - baselineCandidate.csrBase)} vs baseline.`);
  }
  if (isFiniteNumber(recommendedCandidate.monthsInSevereCutMean) && isFiniteNumber(baselineCandidate.monthsInSevereCutMean)) {
    deltas.push(`Recorte severo ${formatMonthsDelta(recommendedCandidate.monthsInSevereCutMean - baselineCandidate.monthsInSevereCutMean)} vs baseline.`);
  }
  if (isFiniteNumber(recommendedCandidate.earlyStressMonths) && isFiniteNumber(baselineCandidate.earlyStressMonths)) {
    deltas.push(`Estrés temprano ${formatMonthsDelta(recommendedCandidate.earlyStressMonths - baselineCandidate.earlyStressMonths)} vs baseline.`);
  }
  if (isFiniteNumber(recommendedCandidate.terminalWealthRatio) && isFiniteNumber(baselineCandidate.terminalWealthRatio)) {
    deltas.push(`Margen terminal ${formatPctDelta(recommendedCandidate.terminalWealthRatio - baselineCandidate.terminalWealthRatio)} vs baseline.`);
  }

  return {
    summary: `Compara contra ${baselineCandidate.mixLabel} sin recalcular el optimizer.`,
    deltas,
  };
}

function buildQualityOfLifeSummary(candidate: RvRfDecisionCandidate): string[] {
  const items: string[] = [];
  if (candidate.midasEvaluationLabel) {
    items.push(`Lectura MIDAS: ${candidate.midasEvaluationLabel}.`);
  }
  if (isFiniteNumber(candidate.qualitySurvivalRate)) {
    items.push(`qualitySurvivalRate ${(candidate.qualitySurvivalRate * 100).toFixed(1)}%.`);
  }
  if (isFiniteNumber(candidate.monthsBelow85) || isFiniteNumber(candidate.maxConsecutiveMonthsBelow85)) {
    items.push(`Rachas bajo 85%: total ${candidate.monthsBelow85?.toFixed(1) ?? 'n/d'} meses; racha máxima ${candidate.maxConsecutiveMonthsBelow85?.toFixed(1) ?? 'n/d'} meses.`);
  }
  if (isFiniteNumber(candidate.earlyStressMonths)) {
    items.push(`Estrés temprano visible durante ${candidate.earlyStressMonths.toFixed(1)} meses.`);
  }
  if (isFiniteNumber(candidate.terminalWealthRatio)) {
    items.push(`Margen terminal ${(candidate.terminalWealthRatio * 100).toFixed(1)}% del capital inicial.`);
  }
  if (isFiniteNumber(candidate.houseSaleRate) && candidate.houseSaleRate > 0) {
    items.push('La venta de casa se interpreta como liquidez, no como fracaso automático.');
  }
  return items;
}

function buildRiskWarnings(
  candidate: RvRfDecisionCandidate,
  ranking: RankedOptimizerCandidate | null,
  comparable: boolean,
  hasTraceFingerprint: boolean,
): string[] {
  const items = [
    ...(ranking?.primaryAlerts ?? []),
    ...(ranking?.capsApplied ?? []),
  ];
  if (!comparable) items.push('No comparable: requiere cerrar input auditable antes de usar esta salida como recomendación.');
  if (!hasTraceFingerprint) items.push('Trazabilidad incompleta: falta fingerprint/trace de la corrida evaluada.');
  if (
    isFiniteNumber(candidate.monthsBelow85)
    && candidate.monthsBelow85 > 0
    && isFiniteNumber(candidate.terminalWealthRatio)
    && candidate.terminalWealthRatio > 0.75
  ) {
    items.push('Patrimonio terminal alto con recortes: posible subuso del patrimonio.');
  }
  if (isFiniteNumber(candidate.houseSaleRate) && candidate.houseSaleRate > 0) {
    if (isFiniteNumber(candidate.severeCutDuringSaleMonths) && candidate.severeCutDuringSaleMonths > 6) {
      items.push('La venta de casa aparece con estrés operativo relevante.');
    } else {
      items.push('La venta de casa aparece como evento de liquidez y debe revisarse, no como fracaso automático.');
    }
  }
  return dedupe(items);
}

export function buildOptimizerDecisionBrief(
  input: BuildOptimizerDecisionBriefInput,
): OptimizerDecisionBrief {
  const recommendedCandidate = input.recommendedCandidate;
  if (!recommendedCandidate) {
    return {
      recommendationLevel: 'not_comparable',
      headline: 'Sin recomendación comparable',
      recommendedCandidateId: null,
      whyThisWins: ['No hay un candidato evaluado y comparable para resumir.'],
      keyTradeoffs: [],
      riskWarnings: ['Genera o confirma una corrida válida del optimizer antes de usar este bloque.'],
      qualityOfLifeSummary: [],
      baselineComparison: input.baselineCandidate ? buildBaselineComparison(input.baselineCandidate, input.baselineCandidate) : null,
      implementationNotes: ['No ejecutar cambios automáticos con una salida incompleta.'],
      auditability: {
        status: 'weak',
        summary: 'No hay candidato resumible ni fingerprint verificable.',
        hasTraceFingerprint: false,
        comparable: false,
      },
      nextReviewTriggers: ['Completar una corrida con trazabilidad y candidato comparable.'],
    };
  }

  const ranking = input.rankedCandidates.find((candidate) => candidate.candidateId === recommendedCandidate.candidateId) ?? null;
  const comparable = recommendedCandidate.midasEvaluationComparable ?? ranking?.isComparable ?? false;
  const hasTraceFingerprint = Boolean(input.traceFingerprint ?? input.inputFingerprint);
  const recommendationKind = input.recommendationKind ?? 'none';

  const recommendationLevel: OptimizerDecisionBriefRecommendationLevel =
    !comparable
      ? 'not_comparable'
      : !hasTraceFingerprint || recommendationKind === 'contingency'
        ? 'preliminary'
        : (ranking?.primaryAlerts.length || ranking?.capsApplied.length)
          ? 'review'
          : 'strong';

  const headline = !comparable
    ? 'Sin recomendación comparable'
    : recommendationLevel === 'preliminary'
      ? 'Recomendación preliminar: mejor balance dentro de los candidatos evaluados'
      : recommendationLevel === 'review'
        ? 'Mejor balance dentro de los candidatos evaluados, con revisión pendiente'
        : 'Mejor balance dentro de los candidatos evaluados';

  const whyThisWins = dedupe([
    ranking?.rankingReason ?? '',
    comparable && recommendedCandidate.midasEvaluationLabel
      ? `Etiqueta MIDAS ${recommendedCandidate.midasEvaluationLabel} sobre el mix ${recommendedCandidate.mixLabel}.`
      : '',
    isFiniteNumber(recommendedCandidate.qualitySurvivalRate) && recommendedCandidate.qualitySurvivalRate >= 0.8
      ? 'Sostiene una calidad de vida alta durante la mayor parte de la trayectoria.'
      : '',
    isFiniteNumber(recommendedCandidate.earlyStressMonths) && recommendedCandidate.earlyStressMonths <= 2
      ? 'Mantiene estrés temprano contenido.'
      : '',
  ]).slice(0, 4);

  const keyTradeoffs = dedupe([
    ...(ranking?.tradeoffs ?? []),
    ...(isFiniteNumber(recommendedCandidate.monthsBelow85) && recommendedCandidate.monthsBelow85 > 0
      ? ['Acepta algo de tiempo bajo 85% para mejorar el balance global.']
      : []),
    ...(isFiniteNumber(recommendedCandidate.houseSaleRate) && recommendedCandidate.houseSaleRate > 0
      ? ['Puede requerir liquidez vía venta de casa en algunos caminos, sin tratarlo como fracaso automático.']
      : []),
  ]).slice(0, 4);

  const riskWarnings = buildRiskWarnings(recommendedCandidate, ranking, comparable, hasTraceFingerprint);
  const qualityOfLifeSummary = buildQualityOfLifeSummary(recommendedCandidate);
  const baselineComparison = buildBaselineComparison(recommendedCandidate, input.baselineCandidate);

  const implementationNotes = [
    recommendationLevel === 'not_comparable'
      ? 'No usar este resultado como recomendación fuerte hasta cerrar comparabilidad y trazabilidad.'
      : recommendationKind === 'contingency'
        ? 'Usar solo como contingencia; confirma antes de mover cartera.'
        : 'Confirmar con simulación completa e implementación antes de ejecutar cambios.',
    'No es asesoría financiera definitiva; resume solo los candidatos ya evaluados por MIDAS.',
  ];

  const nextReviewTriggers = dedupe([
    !hasTraceFingerprint ? 'Repetir la corrida con fingerprint y trace disponibles.' : '',
    ranking?.capsApplied.length ? 'Revisar caps aplicados antes de convertir esto en recomendación fuerte.' : '',
    riskWarnings.some((warning) => warning.toLowerCase().includes('subuso')) ? 'Revisar si el patrimonio está quedando subutilizado frente al nivel de recortes.' : '',
    isFiniteNumber(recommendedCandidate.houseSaleRate) && recommendedCandidate.houseSaleRate > 0 ? 'Validar si la liquidez vía venta de casa es aceptable operacionalmente.' : '',
    isFiniteNumber(recommendedCandidate.earlyStressMonths) && recommendedCandidate.earlyStressMonths > 2 ? 'Revisar sensibilidad de estrés temprano antes de implementar.' : '',
  ]);

  return {
    recommendationLevel,
    headline,
    recommendedCandidateId: recommendedCandidate.candidateId,
    whyThisWins,
    keyTradeoffs,
    riskWarnings,
    qualityOfLifeSummary,
    baselineComparison,
    implementationNotes,
    auditability: {
      status: comparable && hasTraceFingerprint ? 'strong' : 'weak',
      summary: comparable
        ? hasTraceFingerprint
          ? 'Resultado comparable y con fingerprint/trace disponible.'
          : 'Resultado comparable, pero con trazabilidad débil por falta de fingerprint/trace.'
        : 'Resultado no comparable; requiere revisión antes de usarlo como recomendación.',
      hasTraceFingerprint,
      comparable,
    },
    nextReviewTriggers,
  };
}
