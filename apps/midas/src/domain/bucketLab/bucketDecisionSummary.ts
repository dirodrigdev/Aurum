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
  decisionRationale: string[];
  warnings: string[];
};

export type BuildBucketDecisionSummaryInput = {
  profile: OperationalBucketProfile;
  stressRows: OperationalBucketStressRow[];
  tradeoffRows: BucketTradeoffRow[];
  targetBucketMonths: number;
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

  let recommendation: BucketDecisionRecommendation = 'maintain';
  let headline = 'Mantener bucket actual';
  let oneLineSummary =
    `La defensa limpia cubre ${currentCleanDefenseMonths.toFixed(1).replace('.', ',')} meses y hoy no sugiere un ajuste urgente del bucket.`;

  if (input.profile.coveragePctByClp < 0.8) {
    recommendation = 'review_data';
    headline = 'Revisar datos antes de decidir';
    oneLineSummary =
      'La cobertura del mix de instrumentos es insuficiente para recomendar un bucket con confianza.';
    decisionRationale.push('La cobertura de datos está bajo 80% del universo utilizable.');
    decisionRationale.push('Antes de mover bucket conviene revisar el Instrument Universe cargado.');
  } else if (currentCleanDefenseMonths >= targetBucketMonths * 0.945) {
    recommendation = 'maintain';
    headline = 'Mantener bucket actual';
    oneLineSummary =
      `La defensa limpia ya cubre ${currentCleanDefenseMonths.toFixed(1).replace('.', ',')} meses, muy cerca del objetivo de ${targetBucketMonths} meses.`;
    decisionRationale.push('La brecha al objetivo es pequeña frente al costo permanente de subir bucket.');
    if (firstFailure) {
      decisionRationale.push(`La venta de balanceados aparece recién en crisis de ${firstFailure.crisisMonths} meses.`);
    }
  } else if (currentCleanDefenseMonths >= targetBucketMonths * 0.85 && gapClp <= input.profile.monthlySpendClp * 12) {
    recommendation = 'top_up_to_target';
    headline = 'Completar brecha menor';
    oneLineSummary =
      `La defensa limpia está cerca del objetivo; cerrar la brecha de ${gapMonths.toFixed(1).replace('.', ',')} meses parece un ajuste fino, no un cambio estructural.`;
    decisionRationale.push(`Cerrar la brecha exige aproximadamente ${Math.round(gapClp).toLocaleString('es-CL')} CLP.`);
    decisionRationale.push('El costo permanente de completar esa brecha parece acotado.');
  } else if (currentCleanDefenseMonths < 24) {
    recommendation = 'increase';
    headline = 'Defensa limpia insuficiente';
    oneLineSummary =
      'La defensa limpia actual es baja y deja demasiado peso en vender balanceados si la crisis se prolonga.';
    decisionRationale.push('La defensa limpia queda bajo 24 meses.');
    if (firstFailure) {
      decisionRationale.push(`La defensa limpia falla desde crisis de ${firstFailure.crisisMonths} meses.`);
    }
  } else if (currentCleanDefenseMonths < 36) {
    recommendation = 'consider_increase';
    headline = 'Considerar subir bucket';
    oneLineSummary =
      'La defensa limpia es limitada; parte importante del colchón depende de balanceados y venta de RV embebida.';
    decisionRationale.push('La defensa limpia queda bajo 36 meses.');
    if (firstFailure) {
      decisionRationale.push(`El uso de balanceados empieza en crisis de ${firstFailure.crisisMonths} meses.`);
    }
  }

  if (input.profile.mixedFundClp > input.profile.cleanDefensiveClp) {
    decisionRationale.push('Parte importante de la defensa depende de balanceados; al usarlos se vende RV embebida.');
  }
  if (nextBucketRow) {
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
    decisionRationale: decisionRationale.slice(0, 3),
    warnings,
  };
}
