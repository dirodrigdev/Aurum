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
  pct: number | null;
};

export type AggregatedSummary = {
  key: string;
  label: string;
  validMonths: number;
  varPatrimonioAcumClp: number | null;
  gastosAcumClp: number | null;
  retornoRealAcumClp: number | null;
  pctRetorno: number | null;
  pctRetornoNote: string | null;
  spendPct: number | null;
  varPatrimonioAvgDisplay: number | null;
  gastosAvgDisplay: number | null;
  retornoRealAvgDisplay: number | null;
};

export type CrpContributionInsight = {
  monthsLabel: string;
  aporteClp: number;
  aporteMensualClp: number;
  total12mClp: number;
  pctCrp: number | null;
  tone: 'positive' | 'negative' | 'neutral';
  summaryText: string;
  detailText: string | null;
  totalText: string | null;
};
