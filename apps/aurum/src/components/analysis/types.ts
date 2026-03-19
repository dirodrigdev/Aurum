import type { WealthCurrency, WealthFxRates } from '../../services/wealthStorage';

export type AnalysisTab = 'returns' | 'freedom' | 'lab';

export type FreedomControlDraft = {
  annualRatePct: string;
  horizonYears: string;
  monthlySpendClp: string;
};

export type MonthlyReturnRow = {
  monthKey: string;
  fx: WealthFxRates;
  rawEurClp: number;
  netClp: number | null;
  prevNetClp: number | null;
  invalidNet: boolean;
  varPatrimonioClp: number | null;
  gastosClp: number | null;
  retornoRealClp: number | null;
  netDisplay: number | null;
  prevNetDisplay: number | null;
  varPatrimonioDisplay: number | null;
  gastosDisplay: number | null;
  retornoRealDisplay: number | null;
  pct: number | null;
};

export type AggregatedSummary = {
  key: string;
  label: string;
  validMonths: number;
  varPatrimonioAcumClp: number | null;
  gastosAcumClp: number | null;
  retornoRealAcumClp: number | null;
  varPatrimonioAcumDisplay: number | null;
  gastosAcumDisplay: number | null;
  retornoRealAcumDisplay: number | null;
  pctRetorno: number | null;
  pctRetornoNote: string | null;
  spendPct: number | null;
  varPatrimonioAvgDisplay: number | null;
  gastosAvgDisplay: number | null;
  retornoRealAvgDisplay: number | null;
};

export type ReturnSpendInsight = {
  kind: 'pct' | 'low-return' | 'negative-return' | 'unavailable';
  tone: 'neutral' | 'positive' | 'warning' | 'negative';
  primaryText: string;
  secondaryText: string | null;
  titleText: string;
};

export type CrpContributionInsight = {
  monthsLabel: string;
  aporteDisplay: number;
  aporteMensualDisplay: number;
  total12mDisplay: number;
  pctCrp: number | null;
  tone: 'positive' | 'negative' | 'neutral';
  summaryText: string;
  detailText: string | null;
  totalText: string | null;
};

export type ReturnCurveMarkerKind = 'start' | 'end' | 'max' | 'min';

export type ReturnCurvePoint = {
  id: string;
  monthKey: string;
  value: number;
  synthetic?: boolean;
};

export type ReturnCurveMarker = {
  pointId: string;
  pointIndex: number;
  monthKey: string;
  value: number;
  kinds: ReturnCurveMarkerKind[];
};

export type ReturnCurveModel = {
  status: 'ok' | 'insufficient_data';
  points: ReturnCurvePoint[];
  markers: ReturnCurveMarker[];
  domainMin: number | null;
  domainMax: number | null;
  minValue: number | null;
  maxValue: number | null;
};
