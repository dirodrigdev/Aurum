import type { BucketExpectedCostRow } from './bucketExpectedCostAnalysis';

export type ExpectedValuePresentation = {
  label: string;
  tone: 'benefit' | 'cost' | 'neutral';
};

export type BucketTradeoffCard = {
  bucketMonths: number;
  cleanBucketRequiredClp: number;
  defensiveCapitalRequiredClp: number;
  position: 'lower' | 'current' | 'higher';
  capitalLabel: string;
  capitalValueClp: number;
  capitalTone: 'benefit' | 'cost' | 'neutral';
  permanentLabel: string;
  permanentValueClp: number;
  permanentTone: 'benefit' | 'cost' | 'neutral';
  crisisCostLabel: string;
  crisisCostValueClp: number;
  crisisCostTone: 'cost' | 'neutral';
  netResultLabel: string;
  netResultValueClp: number;
  netResultTone: 'benefit' | 'cost' | 'neutral';
  comparisonLabel: string;
  comparisonValueClp: number;
  comparisonTone: 'benefit' | 'cost' | 'neutral';
  capitalDeltaClp: number;
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
  return rows.map((row) => {
    const isCurrent = row.bucketMonths === currentBucketMonths;
    const position = isCurrent ? 'current' : row.bucketMonths < currentBucketMonths ? 'lower' : 'higher';
    const capitalLabel =
      position === 'lower'
        ? 'Capital liberado'
        : position === 'higher'
          ? 'Capital adicional requerido'
          : 'Referencia actual';
    const capitalValueClp =
      position === 'lower' ? row.capitalReleasedClp : position === 'higher' ? row.capitalExtraClp : 0;
    const permanentLabel =
      position === 'lower'
        ? 'Beneficio permanente esperado'
        : position === 'higher'
          ? 'Costo permanente'
          : 'Costo / beneficio permanente';
    const permanentValueClp =
      position === 'lower'
        ? row.expectedGrowthBenefitAnnualClp
        : position === 'higher'
          ? -Math.abs(row.opportunityCostAnnualClp)
          : row.opportunityCostAnnualClp;
    const comparisonValueClp = row.expectedNetBenefitClp;
    const netResultValueClp = -row.expectedTotalCostClp;

    return {
      bucketMonths: row.bucketMonths,
      cleanBucketRequiredClp: row.defensiveCapitalRequiredClp,
      defensiveCapitalRequiredClp: row.defensiveCapitalRequiredClp,
      position,
      capitalLabel,
      capitalValueClp,
      capitalTone: position === 'lower' ? 'benefit' : position === 'higher' ? 'cost' : 'neutral',
      permanentLabel,
      permanentValueClp,
      permanentTone: permanentValueClp > 0 ? 'benefit' : permanentValueClp < 0 ? 'cost' : 'neutral',
      crisisCostLabel: 'Costo esperado crisis',
      crisisCostValueClp: row.expectedForcedSaleCostClp > 0 ? -row.expectedForcedSaleCostClp : 0,
      crisisCostTone: row.expectedForcedSaleCostClp > 0 ? 'cost' : 'neutral',
      netResultLabel: position === 'current' ? 'Costo total esperado actual' : 'Resultado neto esperado',
      netResultValueClp,
      netResultTone: netResultValueClp > 0 ? 'benefit' : netResultValueClp < 0 ? 'cost' : 'neutral',
      comparisonLabel: position === 'current' ? 'Referencia' : position === 'lower' ? 'Mejora vs actual' : 'Diferencia vs actual',
      comparisonValueClp,
      comparisonTone: comparisonValueClp > 0 ? 'benefit' : comparisonValueClp < 0 ? 'cost' : 'neutral',
      capitalDeltaClp: row.capitalExtraClp > 0 ? row.capitalExtraClp : -row.capitalReleasedClp,
      expectedForcedSaleCostClp: row.expectedForcedSaleCostClp,
      expectedTotalCostClp: row.expectedTotalCostClp,
      differenceVsCurrentClp: row.expectedNetBenefitClp,
      comment: row.comment,
      isCurrent,
    };
  });
}
