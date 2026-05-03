import type { BucketExpectedCostAnalysis } from './bucketExpectedCostAnalysis';
import type { BucketTradeoffRow } from './bucketTradeoff';
import type { OperationalBucketProfile } from './operationalBucketProfile';
import type { OperationalBucketStressRow } from './operationalBucketStress';

export type BucketDecisionRecommendation =
  | 'maintain'
  | 'top_up_to_target'
  | 'consider_increase'
  | 'increase'
  | 'review_data';

export type BucketDecisionSummary = {
  recommendation: BucketDecisionRecommendation;
  headline: string;
  oneLineSummary: string;
  currentCleanDefenseMonths: number;
  targetBucketMonths: number;
  gapMonths: number;
  gapClp: number;
  gapOpportunityCostAnnualClp: number;
  nextBucketCandidateMonths: number | null;
  nextBucketExtraCapitalClp: number | null;
  nextBucketOpportunityCostAnnualClp: number | null;
  stressFirstFailureMonths: number | null;
  embeddedEquitySoldAtFirstFailureClp: number;
  embeddedEquitySoldAtSevereStressClp: number;
  currentBucketExpectedTotalCostClp: number;
  bestBucketMonths: number;
  bestBucketExpectedTotalCostClp: number;
  differenceVsCurrentClp: number;
  breakEvenProbability: number | null;
  decisionRationale: string[];
  warnings: string[];
};

export type BuildBucketDecisionSummaryInput = {
  profile: OperationalBucketProfile;
  stressRows: OperationalBucketStressRow[];
  tradeoffRows: BucketTradeoffRow[];
  targetBucketMonths: number;
  expectedCostAnalysis: BucketExpectedCostAnalysis;
};

const sortByCrisis = (rows: OperationalBucketStressRow[]) =>
  [...rows].sort((a, b) => a.crisisMonths - b.crisisMonths || a.equityDrawdown - b.equityDrawdown || a.fixedIncomeShock - b.fixedIncomeShock);

export function buildBucketDecisionSummary(
  input: BuildBucketDecisionSummaryInput,
): BucketDecisionSummary {
  const targetBucketMonths = Math.max(1, Number(input.targetBucketMonths || 0));
  const currentCleanDefenseMonths = input.profile.cleanDefensiveRunwayMonths;
  const gapMonths = Math.max(0, targetBucketMonths - currentCleanDefenseMonths);
  const gapClp = gapMonths * input.profile.monthlySpendClp;
  const sortedStress = sortByCrisis(input.stressRows);
  const firstFailure = sortedStress.find((row) => !row.cleanDefensiveEnough) ?? null;
  const severeStress = [...sortedStress].sort((a, b) => b.forcedSalePenalty - a.forcedSalePenalty)[0] ?? null;
  const currentOrHigherTradeoff =
    input.tradeoffRows.find((row) => row.bucketMonths >= targetBucketMonths && row.extraDefensiveCapitalClp > 0) ?? null;
  const nextBucketRow =
    input.tradeoffRows.find((row) => row.bucketMonths > targetBucketMonths) ?? null;
  const annualOpportunityRate =
    currentOrHigherTradeoff && currentOrHigherTradeoff.extraDefensiveCapitalClp > 0
      ? currentOrHigherTradeoff.opportunityCostAnnual / currentOrHigherTradeoff.extraDefensiveCapitalClp
      : 0;
  const gapOpportunityCostAnnualClp = gapClp * annualOpportunityRate;
  const warnings = [...input.profile.warnings];
  const decisionRationale: string[] = [];
  const bestCostRow = input.expectedCostAnalysis.rows[0];
  const currentCostRow =
    input.expectedCostAnalysis.rows.find((row) => row.bucketMonths === input.expectedCostAnalysis.currentBucketMonths) ??
    bestCostRow;

  let recommendation: BucketDecisionRecommendation = 'maintain';
  let headline = 'Mantener bucket actual';
  let oneLineSummary =
    `La defensa limpia cubre ${currentCleanDefenseMonths.toFixed(1).replace('.', ',')} meses y el bucket actual minimiza el costo esperado bajo estos supuestos.`;

  if (input.profile.coveragePctByClp < 0.8) {
    recommendation = 'review_data';
    headline = 'Revisar datos antes de decidir';
    oneLineSummary =
      'La cobertura del mix de instrumentos es insuficiente para recomendar un bucket con confianza.';
    decisionRationale.push('La cobertura de datos está bajo 80% del universo utilizable.');
    decisionRationale.push('Antes de mover bucket conviene revisar el Instrument Universe cargado.');
  } else if (bestCostRow.bucketMonths === currentCostRow.bucketMonths) {
    recommendation = 'maintain';
    headline = 'Mantener bucket actual';
    oneLineSummary =
      `El costo permanente de mover bucket no compensa el costo esperado de crisis bajo los supuestos actuales.`;
    decisionRationale.push(
      `Actual ${currentCostRow.bucketMonths}m: costo esperado ${Math.round(currentCostRow.expectedTotalCostClp).toLocaleString('es-CL')} CLP.`,
    );
  } else if (bestCostRow.bucketMonths < currentCostRow.bucketMonths) {
    recommendation = 'top_up_to_target';
    headline = 'Evaluar bajar bucket';
    oneLineSummary =
      `Bajar a ${bestCostRow.bucketMonths}m libera capital y mejora el costo esperado bajo los supuestos actuales.`;
    decisionRationale.push(
      `El mejor alternativo (${bestCostRow.bucketMonths}m) mejora en ${Math.round(
        currentCostRow.expectedTotalCostClp - bestCostRow.expectedTotalCostClp,
      ).toLocaleString('es-CL')} CLP/año esperado.`,
    );
  } else if (bestCostRow.bucketMonths > currentCostRow.bucketMonths && currentCleanDefenseMonths < 24) {
    recommendation = 'increase';
    headline = 'Subir bucket sí compensa';
    oneLineSummary =
      `Bajo estos supuestos, subir a ${bestCostRow.bucketMonths}m reduce el costo esperado total más que su costo permanente.`;
  } else if (bestCostRow.bucketMonths > currentCostRow.bucketMonths) {
    recommendation = 'consider_increase';
    headline = 'Considerar subir bucket';
    oneLineSummary =
      `El costo esperado de crisis largas supera el costo permanente de aumentar defensa bajo estos supuestos.`;
  }

  if (input.profile.mixedFundClp > input.profile.cleanDefensiveClp) {
    decisionRationale.push('Parte importante de la defensa depende de balanceados; al usarlos se vende RV embebida.');
  }
  if (bestCostRow.breakEvenProbability !== null) {
    decisionRationale.push(
      `Break-even para subir bucket: crisis largas > ${(bestCostRow.breakEvenProbability * 100).toFixed(1).replace('.', ',')}%.`,
    );
  } else if (nextBucketRow) {
    decisionRationale.push(
      `Subir a ${nextBucketRow.bucketMonths} meses agrega un costo permanente aprox. de ${Math.round(
        nextBucketRow.opportunityCostAnnual,
      ).toLocaleString('es-CL')} CLP/año.`,
    );
  }

  return {
    recommendation,
    headline,
    oneLineSummary,
    currentCleanDefenseMonths,
    targetBucketMonths,
    gapMonths,
    gapClp,
    gapOpportunityCostAnnualClp,
    nextBucketCandidateMonths: nextBucketRow?.bucketMonths ?? null,
    nextBucketExtraCapitalClp: nextBucketRow?.extraDefensiveCapitalClp ?? null,
    nextBucketOpportunityCostAnnualClp: nextBucketRow?.opportunityCostAnnual ?? null,
    stressFirstFailureMonths: firstFailure?.crisisMonths ?? null,
    embeddedEquitySoldAtFirstFailureClp: firstFailure?.embeddedEquitySoldClp ?? 0,
    embeddedEquitySoldAtSevereStressClp: severeStress?.embeddedEquitySoldClp ?? 0,
    currentBucketExpectedTotalCostClp: currentCostRow.expectedTotalCostClp,
    bestBucketMonths: bestCostRow.bucketMonths,
    bestBucketExpectedTotalCostClp: bestCostRow.expectedTotalCostClp,
    differenceVsCurrentClp: bestCostRow.expectedTotalCostClp - currentCostRow.expectedTotalCostClp,
    breakEvenProbability: bestCostRow.breakEvenProbability,
    decisionRationale: decisionRationale.slice(0, 3),
    warnings,
  };
}
