import type { AggregatedSummary, MonthlyReturnRow } from '../../components/analysis/types';
import type { WealthEvolutionComparisonModel } from '../returnsAnalysis';
import type { WealthMonthlyClosure } from '../wealthStorage';

export type DataRoomSourceStatus =
  | 'ok'
  | 'missing_config'
  | 'permission_denied'
  | 'unavailable'
  | 'error'
  | 'missing_auth'
  | 'not_found';

export type DataRoomFile = {
  name: string;
  content: string;
  mimeType: string;
  rowCount?: number;
};

export type MidasExportRow = {
  source_doc: string;
  scenario_name: string;
  parameter: string;
  value: string | number | boolean | null;
  currency: string;
  updated_at: string;
  notes: string;
};

export type GastappMonthlyExportRow = {
  monthKey: string;
  periodNumber: number | null;
  periodLabel: string | null;
  periodKey: string | null;
  periodStartYMD: string | null;
  periodEndYMD: string | null;
  status: string | null;
  dataQuality: string | null;
  isStale: boolean | null;
  staleReason: string | null;
  total_contable_eur: number | null;
  day_to_day_eur: number | null;
  trips_eur: number | null;
  others_eur: number | null;
  legacy_csv_eur: number | null;
  app_projects_eur: number | null;
  sum_over_csv_eur: number | null;
  closedAt: string | null;
  reportUpdatedAt: string | null;
  summaryUpdatedAt: string | null;
  lastExpenseUpdatedAt: string | null;
  publishedAt: string | null;
  updated_at: string | null;
  revision: number | null;
  source: string | null;
  day_to_day_source: string | null;
  warnings: string;
};

export type GastappMonthlyAdapterResult = {
  status: DataRoomSourceStatus;
  included: boolean;
  rows: GastappMonthlyExportRow[];
  warnings: string[];
  errorMessage: string | null;
  configuredProjectId: string | null;
};

export type GastappLedgerPreviewStatus =
  | 'available'
  | 'missing_manifest'
  | 'missing_config'
  | 'permission_denied'
  | 'unavailable'
  | 'mismatch'
  | 'error';

export type GastappLedgerPreviewPeriodRange = {
  fromPeriod: string | null;
  toPeriod: string | null;
  fromMonthKey: string | null;
  toMonthKey: string | null;
  label: string | null;
};

export type GastappLedgerPreviewManifest = {
  id: string;
  generatedAt: string | null;
  schemaVersion: string | null;
  calculationVersion: string | null;
  periodRange: GastappLedgerPreviewPeriodRange | null;
  rowCounts: Record<string, number>;
  reconciliationStatus: string | null;
  aurumReadinessStatus: string | null;
  dataQuality: string | null;
  warnings: string[];
  knownLimitations: string[];
  reconciliationToleranceEur: number | null;
  maxAbsDiffEur: number | null;
  roundingDiffCount: number | null;
  needsReviewCount: number | null;
  totalsByView: Record<string, number>;
  totalsBySource: Record<string, number>;
  raw: Record<string, unknown>;
};

export type GastappLedgerPreviewRow = {
  ledger_id: string;
  source_kind: string | null;
  transaction_class: string | null;
  project_name: string | null;
  description: string | null;
  transaction_date: string | null;
  accounting_date: string | null;
  period_key: string | null;
  monthKey: string | null;
  amount_eur: number | null;
  hybrid_contable_eur: number | null;
  lifestyle_eur: number | null;
  aurum_eur: number | null;
  affects_aurum: boolean | null;
  affects_lifestyle: boolean | null;
  inclusion_reason: string | null;
  exclusion_reason: string | null;
  duplication_risk: string | null;
  omission_risk: string | null;
  traceability_status: string | null;
  raw: Record<string, unknown>;
};

export type GastappLedgerPreviewAdapterResult = {
  status: GastappLedgerPreviewStatus;
  included: boolean;
  manifest: GastappLedgerPreviewManifest | null;
  rows: GastappLedgerPreviewRow[];
  warnings: string[];
  errorMessage: string | null;
  configuredProjectId: string | null;
  collectionName: string;
  manifestCollectionName: string;
  reconciliationStatus: string | null;
  aurumReadinessStatus: string | null;
  periodRange: GastappLedgerPreviewPeriodRange | null;
  rowCount: number;
  warningsPayload: Record<string, unknown> | null;
  reconciliationPayload: Record<string, unknown> | null;
};

export type MidasAdapterResult = {
  status: DataRoomSourceStatus;
  included: boolean;
  rows: MidasExportRow[];
  warnings: string[];
  errorMessage: string | null;
  projectId: string | null;
  sourceDocsLoaded: string[];
  rawMinimal: Record<string, unknown>;
};

export type AnalysisExportContext = {
  closures: WealthMonthlyClosure[];
  officialMonthlyRowsAsc: MonthlyReturnRow[];
  wealthEvolutionModel: WealthEvolutionComparisonModel;
  periodSummaries: AggregatedSummary[];
  yearlySummaries: AggregatedSummary[];
  heroSinceStart: AggregatedSummary | null;
  heroLast12: AggregatedSummary | null;
  heroYtd2026: AggregatedSummary | null;
  heroLastMonth: AggregatedSummary | null;
};

export type AurumMonthlyPanelRow = {
  monthKey: string;
  patrimonio_total_clp: number | null;
  patrimonio_total_uf: number | null;
  variacion_patrimonial_clp: number | null;
  retorno_economico_clp: number | null;
  retorno_economico_pct: number | null;
  deuda_hipotecaria_clp: number | null;
  deuda_no_hipotecaria_clp: number | null;
  bancos_clp: number | null;
  inversiones_clp: number | null;
  bienes_raices_clp: number | null;
  capital_riesgo_clp: number | null;
  uf_clp: number | null;
  usd_clp: number | null;
  source_status: string;
  warnings: string;
};

export type AurumPatrimonioRow = {
  monthKey: string;
  total_clp: number | null;
  total_uf: number | null;
  bancos_clp: number | null;
  inversiones_clp: number | null;
  bienes_raices_clp: number | null;
  deuda_hipotecaria_clp: number | null;
  deuda_no_hipotecaria_clp: number | null;
  capital_riesgo_clp: number | null;
  cierre_status: string;
  source: string;
};

export type AurumDetalleBloqueRow = {
  monthKey: string;
  block: string;
  item_name: string;
  amount_clp: number | null;
  currency: string;
  original_amount: number | null;
  source: string;
  is_estimated: boolean;
  notes: string;
};

export type AurumReturnExportRow = {
  period_label: string;
  from_month: string | null;
  to_month: string | null;
  retorno_economico_clp: number | null;
  retorno_economico_pct: number | null;
  patrimonio_inicio_clp: number | null;
  patrimonio_fin_clp: number | null;
  gasto_periodo_clp_si_disponible: number | null;
  valid_months: string;
  notes: string;
};

export type AurumAdapterResult = {
  included: true;
  warnings: string[];
  dateRangeFrom: string | null;
  dateRangeTo: string | null;
  latestPatrimonioClp: number | null;
  latestPatrimonioUf: number | null;
  lastClosedMonth: string | null;
  return12mPct: number | null;
  monthlyPanelRows: AurumMonthlyPanelRow[];
  patrimonioRows: AurumPatrimonioRow[];
  detailRows: AurumDetalleBloqueRow[];
  returnRows: AurumReturnExportRow[];
  rawMinimal: Record<string, unknown>;
};

export type FinancialDataRoomManifest = {
  generated_at: string;
  bundle_version: 'financial_data_room_mvp1';
  source_app: 'aurum';
  includes: {
    aurum: true;
    midas: boolean;
    gastapp_monthly: boolean;
    gastapp_ledger_preview: boolean;
    gastapp_categories: false;
    gastapp_transactions: false;
  };
  source_status: {
    aurum: 'ok';
    midas: DataRoomSourceStatus;
    gastapp_status: DataRoomSourceStatus;
    gastapp_ledger_preview_status: GastappLedgerPreviewStatus;
  };
  missing_sources: string[];
  warnings: string[];
  row_counts: Record<string, number>;
  no_data_modified: true;
  firestore_projects: {
    aurum_shared: string | null;
    gastapp_external: string | null;
  };
  gastapp_ledger_preview_available: boolean;
  gastapp_ledger_preview_status: GastappLedgerPreviewStatus;
  gastapp_ledger_preview_collection: string;
  gastapp_ledger_preview_manifest_collection: string;
  gastapp_ledger_preview_period_range: GastappLedgerPreviewPeriodRange | null;
  gastapp_ledger_preview_row_count: number;
  gastapp_ledger_preview_reconciliation_status: string | null;
  gastapp_ledger_preview_max_abs_diff_eur: number | null;
  gastapp_ledger_preview_rounding_diff_count: number | null;
  gastapp_ledger_preview_aurum_readiness_status: string | null;
  gastapp_ledger_preview_is_official_source: false;
};

export type FinancialDataRoomBuildResult = {
  filename: string;
  files: DataRoomFile[];
  manifest: FinancialDataRoomManifest;
  rawMinimal: Record<string, unknown>;
};
