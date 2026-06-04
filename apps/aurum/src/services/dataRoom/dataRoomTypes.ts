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
    gastapp_categories: false;
    gastapp_transactions: false;
  };
  source_status: {
    aurum: 'ok';
    midas: DataRoomSourceStatus;
    gastapp_status: DataRoomSourceStatus;
  };
  missing_sources: string[];
  warnings: string[];
  row_counts: Record<string, number>;
  no_data_modified: true;
  firestore_projects: {
    aurum_shared: string | null;
    gastapp_external: string | null;
  };
};

export type FinancialDataRoomBuildResult = {
  filename: string;
  files: DataRoomFile[];
  manifest: FinancialDataRoomManifest;
  rawMinimal: Record<string, unknown>;
};
