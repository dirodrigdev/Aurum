import type { WealthCurrency, WealthFxRates } from '../../services/wealthStorage';
import type { GastosContractStatus, GastosMonthDataQuality, GastosMonthSource, GastosMonthStatus } from '../../services/gastosMonthly';

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
  fxMethod: 'real_closure' | 'default_fallback';
  fxAuditable: boolean;
  fxMissing: Array<'usdClp' | 'eurClp' | 'ufClp'>;
  gastosStatus: GastosMonthStatus;
  gastosSource: GastosMonthSource;
  gastosContractStatus: GastosContractStatus | null;
  gastosDataQuality: GastosMonthDataQuality | null;
  gastosIsStale: boolean;
  gastosStaleReason: string | null;
  gastosDayToDaySource: string | null;
  gastosContractSource: string | null;
  gastosSchemaVersion: string | null;
  gastosMethodologyVersion: string | null;
  gastosPeriodKey: string | null;
  gastosPublishedAt: string | null;
  gastosUpdatedAt: string | null;
  gastosClosedAt: string | null;
  gastosReportUpdatedAt: string | null;
  gastosSummaryUpdatedAt: string | null;
  gastosLastExpenseUpdatedAt: string | null;
  gastosRevision: number | null;
  gastosReportTotalEur: number | null;
  gastosSummaryTotalEur: number | null;
  gastosDirectExpenseTotalEur: number | null;
  gastosReportVsDirectDiffEur: number | null;
  gastosSummaryVsDirectDiffEur: number | null;
  gastosReportVsSummaryDiffEur: number | null;
  gastosCategoryGapEur: number | null;
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
  isEstimated?: boolean;
  estimateMethod?: 'avg_12m_closed' | 'avg_available_closed' | null;
  estimatedSpendClp?: number | null;
  estimatedFromMonthsCount?: number | null;
  officialAvailableDate?: string | null;
  referencePreviousMonthSpendClp?: number | null;
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
