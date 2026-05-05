import type { BucketExpectedCostRow } from './bucketExpectedCostAnalysis';

export type ExpectedValuePresentation = {
  label: string;
  tone: 'benefit' | 'cost' | 'neutral';
};

export type BucketTradeoffCard = {
  bucketMonths: number;
  defensiveCapitalRequiredClp: number;
  capitalDeltaClp: number;
  permanentValueClp: number;
  expectedForcedSaleCostClp: number;
  expectedTotalCostClp: number;
  differenceVsCurrentClp: number;
  comment: string;
  isCurrent: boolean;
};

export function describeExpectedValue(value: number): ExpectedValuePresentation {
  if (!Number.isFinite(value) || Math.abs(value) < 1) {
    return { label: 'Sin diferencia material', tone: 'neutral' };
  }
  if (value < 0) {
    return { label: `Mejora esperada: +${Math.round(Math.abs(value)).toLocaleString('es-CL')}`, tone: 'benefit' };
  }
  return { label: `Costo esperado: +${Math.round(value).toLocaleString('es-CL')}`, tone: 'cost' };
}

export function buildBucketTradeoffCards(
  rows: BucketExpectedCostRow[],
  currentBucketMonths: number,
): BucketTradeoffCard[] {
  return rows.map((row) => ({
    bucketMonths: row.bucketMonths,
    defensiveCapitalRequiredClp: row.defensiveCapitalRequiredClp,
    capitalDeltaClp: row.capitalExtraClp > 0 ? row.capitalExtraClp : -row.capitalReleasedClp,
    permanentValueClp: row.opportunityCostAnnualClp,
    expectedForcedSaleCostClp: row.expectedForcedSaleCostClp,
    expectedTotalCostClp: row.expectedTotalCostClp,
    differenceVsCurrentClp: row.expectedNetBenefitClp,
    comment: row.comment,
    isCurrent: row.bucketMonths === currentBucketMonths,
  }));
}
