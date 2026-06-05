import { buildFinancialDataRoomManifest } from './buildManifest';
import { buildFinancialDataRoomReadme } from './buildReadme';
import { buildCsv } from './csv';
import { buildGastappLedgerPreviewCsv } from './gastappLedgerPreviewAdapter';
import type {
  AurumAdapterResult,
  DataRoomFile,
  FinancialDataRoomBuildResult,
  FinancialDataRoomManifest,
  GastappLedgerPreviewAdapterResult,
  GastappMonthlyAdapterResult,
  MidasAdapterResult,
} from './dataRoomTypes';

const todayYmd = (iso: string) => {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const monthInRange = (monthKey: string, from: string | null | undefined, to: string | null | undefined) => {
  if (!from || !to) return false;
  return monthKey >= from && monthKey <= to;
};

const unique = (values: Array<string | null | undefined>) => Array.from(new Set(values.filter(Boolean) as string[]));

const midasScenarioName = (midas: MidasAdapterResult) =>
  midas.rows.find((row) => row.source_doc.includes('simulationActiveV1'))?.scenario_name || '';

const buildExecutiveCsvRows = (input: {
  generatedAt: string;
  aurum: AurumAdapterResult;
  gastapp: GastappMonthlyAdapterResult;
  midas: MidasAdapterResult;
  warnings: string[];
}) => {
  const gasto12mEur = (() => {
    const summary12 = input.aurum.returnRows.find((row) => row.period_label === 'Últ. 12M' || row.period_label === '12M') || null;
    if (!summary12?.from_month || !summary12?.to_month) return null;
    return input.gastapp.rows
      .filter((row) => monthInRange(row.monthKey, summary12.from_month, summary12.to_month))
      .reduce((sum, row) => sum + Number(row.total_contable_eur || 0), 0);
  })();

  return [{
    generated_at: input.generatedAt,
    date_range_from: input.aurum.dateRangeFrom,
    date_range_to: input.aurum.dateRangeTo,
    patrimonio_actual_clp: input.aurum.latestPatrimonioClp,
    patrimonio_actual_uf: input.aurum.latestPatrimonioUf,
    ultimo_mes_cerrado: input.aurum.lastClosedMonth,
    retorno_12m_pct: input.aurum.return12mPct,
    gasto_12m_eur_si_disponible: gasto12mEur,
    midas_scenario: midasScenarioName(input.midas),
    data_quality_notes: input.warnings.join(' | '),
  }];
};

const buildMonthlyConsolidatedRows = (aurum: AurumAdapterResult, gastapp: GastappMonthlyAdapterResult) => {
  const aurumByMonth = new Map(aurum.monthlyPanelRows.map((row) => [row.monthKey, row]));
  const gastappByMonth = new Map(gastapp.rows.map((row) => [row.monthKey, row]));
  const monthKeys = unique([...aurumByMonth.keys(), ...gastappByMonth.keys()]).sort();
  return monthKeys.map((monthKey) => {
    const a = aurumByMonth.get(monthKey) || null;
    const g = gastappByMonth.get(monthKey) || null;
    return {
      monthKey,
      patrimonio_total_clp: a?.patrimonio_total_clp ?? null,
      patrimonio_total_uf: a?.patrimonio_total_uf ?? null,
      variacion_patrimonial_clp: a?.variacion_patrimonial_clp ?? null,
      retorno_economico_clp: a?.retorno_economico_clp ?? null,
      retorno_economico_pct: a?.retorno_economico_pct ?? null,
      gasto_total_gastapp_eur: g?.total_contable_eur ?? null,
      gasto_day_to_day_eur: g?.day_to_day_eur ?? null,
      gasto_trips_eur: g?.trips_eur ?? null,
      gasto_others_eur: g?.others_eur ?? null,
      gasto_app_projects_eur: g?.app_projects_eur ?? null,
      deuda_hipotecaria_clp: a?.deuda_hipotecaria_clp ?? null,
      deuda_no_hipotecaria_clp: a?.deuda_no_hipotecaria_clp ?? null,
      bancos_clp: a?.bancos_clp ?? null,
      inversiones_clp: a?.inversiones_clp ?? null,
      bienes_raices_clp: a?.bienes_raices_clp ?? null,
      capital_riesgo_clp: a?.capital_riesgo_clp ?? null,
      uf_clp: a?.uf_clp ?? null,
      usd_clp: a?.usd_clp ?? null,
      source_status: [a?.source_status || 'aurum_missing', gastapp.status !== 'ok' ? `gastapp_${gastapp.status}` : 'gastapp_ok'].join('|'),
      warnings: [a?.warnings || '', g?.warnings || ''].filter(Boolean).join(' | '),
    };
  });
};

const buildCrossRows = (aurum: AurumAdapterResult, gastapp: GastappMonthlyAdapterResult) => {
  const consolidated = buildMonthlyConsolidatedRows(aurum, gastapp);
  return consolidated.map((row) => ({
    monthKey: row.monthKey,
    patrimonio_total_clp: row.patrimonio_total_clp,
    variacion_patrimonial_clp: row.variacion_patrimonial_clp,
    retorno_economico_clp: row.retorno_economico_clp,
    gasto_total_gastapp_eur: row.gasto_total_gastapp_eur,
    gasto_day_to_day_eur: row.gasto_day_to_day_eur,
    gasto_trips_eur: row.gasto_trips_eur,
    gasto_projects_eur: row.gasto_app_projects_eur,
    notes: row.warnings,
  }));
};

const toCsvFile = (name: string, headers: string[], rows: Record<string, unknown>[]): DataRoomFile => ({
  name,
  content: buildCsv(headers, rows),
  mimeType: 'text/csv;charset=utf-8;',
  rowCount: rows.length,
});

export const buildFinancialDataRoom = (input: {
  generatedAt: string;
  aurum: AurumAdapterResult;
  midas: MidasAdapterResult;
  gastapp: GastappMonthlyAdapterResult;
  gastappLedgerPreview: GastappLedgerPreviewAdapterResult;
  aurumProjectId: string | null;
}): FinancialDataRoomBuildResult => {
  const consolidatedRows = buildMonthlyConsolidatedRows(input.aurum, input.gastapp);
  const crossRows = buildCrossRows(input.aurum, input.gastapp);
  const warnings = unique([
    ...input.aurum.warnings,
    ...input.midas.warnings,
    ...input.gastapp.warnings,
    ...input.gastappLedgerPreview.warnings,
    input.midas.errorMessage,
    input.gastapp.errorMessage,
    input.gastappLedgerPreview.errorMessage,
  ]);
  const manifest: FinancialDataRoomManifest = buildFinancialDataRoomManifest({
    generated_at: input.generatedAt,
    bundle_version: 'financial_data_room_mvp1',
    source_app: 'aurum',
    includes: {
      aurum: true,
      midas: input.midas.included,
      gastapp_monthly: input.gastapp.included,
      gastapp_ledger_preview: input.gastappLedgerPreview.included,
      gastapp_categories: false,
      gastapp_transactions: false,
    },
    source_status: {
      aurum: 'ok',
      midas: input.midas.status,
      gastapp_status: input.gastapp.status,
      gastapp_ledger_preview_status: input.gastappLedgerPreview.status,
    },
    missing_sources: [
      ...(!input.midas.included ? ['midas'] : []),
      ...(!input.gastapp.included ? ['gastapp_monthly'] : []),
      ...(!input.gastappLedgerPreview.included ? ['gastapp_ledger_preview'] : []),
    ],
    warnings,
    row_counts: {},
    no_data_modified: true,
    firestore_projects: {
      aurum_shared: input.aurumProjectId,
      gastapp_external: input.gastapp.configuredProjectId || input.gastappLedgerPreview.configuredProjectId,
    },
    gastapp_ledger_preview_available: input.gastappLedgerPreview.included,
    gastapp_ledger_preview_status: input.gastappLedgerPreview.status,
    gastapp_ledger_preview_collection: input.gastappLedgerPreview.collectionName,
    gastapp_ledger_preview_manifest_collection: input.gastappLedgerPreview.manifestCollectionName,
    gastapp_ledger_preview_period_range: input.gastappLedgerPreview.periodRange,
    gastapp_ledger_preview_row_count: input.gastappLedgerPreview.rowCount,
    gastapp_ledger_preview_reconciliation_status: input.gastappLedgerPreview.reconciliationStatus,
    gastapp_ledger_preview_max_abs_diff_eur: input.gastappLedgerPreview.manifest?.maxAbsDiffEur ?? null,
    gastapp_ledger_preview_rounding_diff_count: input.gastappLedgerPreview.manifest?.roundingDiffCount ?? null,
    gastapp_ledger_preview_aurum_readiness_status: input.gastappLedgerPreview.aurumReadinessStatus,
    gastapp_ledger_preview_is_official_source: false,
  });

  const files: DataRoomFile[] = [];
  files.push({ name: '00_README_IA.md', content: buildFinancialDataRoomReadme(manifest), mimeType: 'text/markdown;charset=utf-8;' });
  files.push(toCsvFile('01_resumen_ejecutivo.csv', [
    'generated_at',
    'date_range_from',
    'date_range_to',
    'patrimonio_actual_clp',
    'patrimonio_actual_uf',
    'ultimo_mes_cerrado',
    'retorno_12m_pct',
    'gasto_12m_eur_si_disponible',
    'midas_scenario',
    'data_quality_notes',
  ], buildExecutiveCsvRows({
    generatedAt: input.generatedAt,
    aurum: input.aurum,
    gastapp: input.gastapp,
    midas: input.midas,
    warnings,
  })));
  files.push(toCsvFile('02_panel_mensual_consolidado.csv', [
    'monthKey',
    'patrimonio_total_clp',
    'patrimonio_total_uf',
    'variacion_patrimonial_clp',
    'retorno_economico_clp',
    'retorno_economico_pct',
    'gasto_total_gastapp_eur',
    'gasto_day_to_day_eur',
    'gasto_trips_eur',
    'gasto_others_eur',
    'gasto_app_projects_eur',
    'deuda_hipotecaria_clp',
    'deuda_no_hipotecaria_clp',
    'bancos_clp',
    'inversiones_clp',
    'bienes_raices_clp',
    'capital_riesgo_clp',
    'uf_clp',
    'usd_clp',
    'source_status',
    'warnings',
  ], consolidatedRows));
  files.push(toCsvFile('03_aurum_patrimonio_mensual.csv', [
    'monthKey',
    'total_clp',
    'total_uf',
    'bancos_clp',
    'inversiones_clp',
    'bienes_raices_clp',
    'deuda_hipotecaria_clp',
    'deuda_no_hipotecaria_clp',
    'capital_riesgo_clp',
    'cierre_status',
    'source',
  ], input.aurum.patrimonioRows));
  files.push(toCsvFile('04_aurum_retornos.csv', [
    'period_label',
    'from_month',
    'to_month',
    'retorno_economico_clp',
    'retorno_economico_pct',
    'patrimonio_inicio_clp',
    'patrimonio_fin_clp',
    'gasto_periodo_clp_si_disponible',
    'valid_months',
    'notes',
  ], input.aurum.returnRows));
  files.push(toCsvFile('05_aurum_detalle_bloques.csv', [
    'monthKey',
    'block',
    'item_name',
    'amount_clp',
    'currency',
    'original_amount',
    'source',
    'is_estimated',
    'notes',
  ], input.aurum.detailRows));
  files.push(toCsvFile('06_gastapp_vista_contable.csv', [
    'monthKey',
    'periodNumber',
    'periodLabel',
    'periodKey',
    'periodStartYMD',
    'periodEndYMD',
    'status',
    'dataQuality',
    'isStale',
    'staleReason',
    'total_contable_eur',
    'day_to_day_eur',
    'trips_eur',
    'others_eur',
    'legacy_csv_eur',
    'app_projects_eur',
    'sum_over_csv_eur',
    'closedAt',
    'reportUpdatedAt',
    'summaryUpdatedAt',
    'lastExpenseUpdatedAt',
    'publishedAt',
    'updated_at',
    'revision',
    'source',
    'day_to_day_source',
    'warnings',
  ], input.gastapp.rows));
  if (input.gastappLedgerPreview.manifest) {
    files.push({
      name: 'gastapp_ledger_preview_manifest.json',
      content: `${JSON.stringify(input.gastappLedgerPreview.manifest, null, 2)}\n`,
      mimeType: 'application/json;charset=utf-8;',
      rowCount: 1,
    });
  }
  if (input.gastappLedgerPreview.rows.length > 0) {
    files.push({
      name: 'gastapp_ledger_preview_rows.json',
      content: `${JSON.stringify(input.gastappLedgerPreview.rows, null, 2)}\n`,
      mimeType: 'application/json;charset=utf-8;',
      rowCount: input.gastappLedgerPreview.rows.length,
    });
    files.push({
      name: 'gastapp_ledger_preview_rows.csv',
      content: buildGastappLedgerPreviewCsv(input.gastappLedgerPreview.rows),
      mimeType: 'text/csv;charset=utf-8;',
      rowCount: input.gastappLedgerPreview.rows.length,
    });
  }
  if (input.gastappLedgerPreview.warningsPayload) {
    files.push({
      name: 'gastapp_ledger_preview_warnings.json',
      content: `${JSON.stringify(input.gastappLedgerPreview.warningsPayload, null, 2)}\n`,
      mimeType: 'application/json;charset=utf-8;',
      rowCount: 1,
    });
  }
  if (input.gastappLedgerPreview.reconciliationPayload) {
    files.push({
      name: 'gastapp_ledger_preview_reconciliation.json',
      content: `${JSON.stringify(input.gastappLedgerPreview.reconciliationPayload, null, 2)}\n`,
      mimeType: 'application/json;charset=utf-8;',
      rowCount: 1,
    });
  }
  files.push(toCsvFile('09_midas_inputs_resultados.csv', [
    'source_doc',
    'scenario_name',
    'parameter',
    'value',
    'currency',
    'updated_at',
    'notes',
  ], input.midas.rows));
  files.push(toCsvFile('10_cruces_aurum_gastapp.csv', [
    'monthKey',
    'patrimonio_total_clp',
    'variacion_patrimonial_clp',
    'retorno_economico_clp',
    'gasto_total_gastapp_eur',
    'gasto_day_to_day_eur',
    'gasto_trips_eur',
    'gasto_projects_eur',
    'notes',
  ], crossRows));

  const rawMinimal = {
    generated_at: input.generatedAt,
    aurum: input.aurum.rawMinimal,
    midas: input.midas.rawMinimal,
    gastapp: {
      status: input.gastapp.status,
      rows: input.gastapp.rows.length,
      latest_month: input.gastapp.rows.at(-1)?.monthKey || null,
    },
    gastapp_ledger_preview: {
      status: input.gastappLedgerPreview.status,
      rows: input.gastappLedgerPreview.rows.length,
      period_range: input.gastappLedgerPreview.periodRange,
      reconciliation_status: input.gastappLedgerPreview.reconciliationStatus,
      aurum_readiness_status: input.gastappLedgerPreview.aurumReadinessStatus,
    },
  };

  const rawMinimalContent = `${JSON.stringify(rawMinimal, null, 2)}\n`;
  files.push({ name: 'raw_minimal.json', content: rawMinimalContent, mimeType: 'application/json;charset=utf-8;', rowCount: 1 });

  manifest.row_counts = Object.fromEntries(files.map((file) => [file.name, file.rowCount ?? 0]));
  manifest.row_counts['manifest.json'] = 1;
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  files.push({ name: 'manifest.json', content: manifestContent, mimeType: 'application/json;charset=utf-8;', rowCount: 1 });

  return {
    filename: `financial_data_room_${todayYmd(input.generatedAt)}.zip`,
    files,
    manifest,
    rawMinimal,
  };
};
