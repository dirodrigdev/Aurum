import { describe, expect, it } from 'vitest';
import { escapeCsvValue, buildCsv } from '../src/services/dataRoom/csv';
import { buildFinancialDataRoomManifest } from '../src/services/dataRoom/buildManifest';
import { buildFinancialDataRoom } from '../src/services/dataRoom/buildFinancialDataRoom';
import type {
  AurumAdapterResult,
  GastappLedgerPreviewAdapterResult,
  GastappMonthlyAdapterResult,
  MidasAdapterResult,
} from '../src/services/dataRoom/dataRoomTypes';

const baseAurum = (): AurumAdapterResult => ({
  included: true,
  warnings: [],
  dateRangeFrom: '2025-05',
  dateRangeTo: '2026-04',
  latestPatrimonioClp: 1000,
  latestPatrimonioUf: 25,
  lastClosedMonth: '2026-04',
  return12mPct: 12.5,
  monthlyPanelRows: [{
    monthKey: '2026-04',
    patrimonio_total_clp: 1000,
    patrimonio_total_uf: 25,
    variacion_patrimonial_clp: 50,
    retorno_economico_clp: 60,
    retorno_economico_pct: 0.06,
    deuda_hipotecaria_clp: 200,
    deuda_no_hipotecaria_clp: 100,
    bancos_clp: 300,
    inversiones_clp: 400,
    bienes_raices_clp: 500,
    capital_riesgo_clp: 50,
    uf_clp: 40000,
    usd_clp: 900,
    source_status: 'records_canonical|gastapp_firestore',
    warnings: '',
  }],
  patrimonioRows: [{
    monthKey: '2026-04',
    total_clp: 1000,
    total_uf: 25,
    bancos_clp: 300,
    inversiones_clp: 400,
    bienes_raices_clp: 500,
    deuda_hipotecaria_clp: 200,
    deuda_no_hipotecaria_clp: 100,
    capital_riesgo_clp: 50,
    cierre_status: 'complete',
    source: 'records_canonical',
  }],
  detailRows: [{
    monthKey: '2026-04',
    block: 'bank',
    item_name: 'Banco de Chile CLP',
    amount_clp: 300,
    currency: 'CLP',
    original_amount: 300,
    source: 'manual',
    is_estimated: false,
    notes: '',
  }],
  returnRows: [{
    period_label: 'Últ. 12M',
    from_month: '2025-05',
    to_month: '2026-04',
    retorno_economico_clp: 120,
    retorno_economico_pct: 0.12,
    patrimonio_inicio_clp: 800,
    patrimonio_fin_clp: 1000,
    gasto_periodo_clp_si_disponible: 40,
    valid_months: '12/12',
    notes: '',
  }],
  rawMinimal: { closures_count: 1 },
});

const baseMidas = (): MidasAdapterResult => ({
  status: 'ok',
  included: true,
  rows: [{
    source_doc: 'users/uid/midas_config/simulationActiveV1',
    scenario_name: 'simulationActiveV1',
    parameter: 'active_meta.hash',
    value: 'abc',
    currency: '',
    updated_at: '2026-06-04T10:00:00.000Z',
    notes: '',
  }],
  warnings: [],
  errorMessage: null,
  projectId: 'aurum-project',
  sourceDocsLoaded: ['users/uid/midas_config/simulationActiveV1'],
  rawMinimal: { simulationActiveV1: { path: 'users/uid/midas_config/simulationActiveV1' } },
});

const gastappOk = (): GastappMonthlyAdapterResult => ({
  status: 'ok',
  included: true,
  rows: [{
    monthKey: '2026-04',
    periodNumber: 4,
    periodLabel: 'Abr 2026',
    periodKey: '2026-04-01__2026-04-30',
    periodStartYMD: '2026-04-01',
    periodEndYMD: '2026-04-30',
    status: 'complete',
    dataQuality: 'ok',
    isStale: false,
    staleReason: null,
    total_contable_eur: 100,
    day_to_day_eur: 60,
    trips_eur: 20,
    others_eur: 10,
    legacy_csv_eur: 0,
    app_projects_eur: 10,
    sum_over_csv_eur: 0,
    closedAt: '2026-05-12T00:00:00.000Z',
    reportUpdatedAt: '2026-05-12T00:00:00.000Z',
    summaryUpdatedAt: '2026-05-12T00:00:00.000Z',
    lastExpenseUpdatedAt: '2026-05-11T00:00:00.000Z',
    publishedAt: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z',
    revision: 1,
    source: 'gastapp_firestore',
    day_to_day_source: 'gastapp',
    warnings: '',
  }],
  warnings: [],
  errorMessage: null,
  configuredProjectId: 'gastapp-project',
});

const gastappLedgerAvailable = (): GastappLedgerPreviewAdapterResult => ({
  status: 'available',
  included: true,
  manifest: {
    id: 'current',
    generatedAt: '2026-06-04T12:00:00.000Z',
    schemaVersion: '1',
    calculationVersion: 'preview-v1',
    periodRange: 'P29-P36',
    rowCounts: { rowsWritten: 37 },
    reconciliationStatus: 'matched_with_rounding_tolerance',
    aurumReadinessStatus: 'preview_only',
    dataQuality: 'preview',
    warnings: ['rounding_tolerance_applied'],
    knownLimitations: ['preview_only'],
    reconciliationToleranceEur: 0.01,
    maxAbsDiffEur: 0.01,
    roundingDiffCount: 1,
    needsReviewCount: 0,
    totalsByView: { aurum: 100 },
    totalsBySource: { csv: 100 },
    raw: { source: 'firestore' },
  },
  rows: [{
    ledger_id: 'led-1',
    source_kind: 'project',
    transaction_class: 'expense',
    project_name: 'Proyecto A',
    description: 'Hotel',
    transaction_date: '2026-04-03',
    accounting_date: '2026-04-05',
    period_key: 'P29',
    monthKey: '2026-04',
    amount_eur: 25,
    hybrid_contable_eur: 25,
    lifestyle_eur: 0,
    aurum_eur: 25,
    affects_aurum: true,
    affects_lifestyle: false,
    inclusion_reason: 'project_cost',
    exclusion_reason: null,
    duplication_risk: 'low',
    omission_risk: 'low',
    traceability_status: 'matched',
    raw: { source: 'preview' },
  }],
  warnings: ['rounding_tolerance_applied', 'preview_only'],
  errorMessage: null,
  configuredProjectId: 'gastapp-project',
  collectionName: 'gastapp_transaction_ledger_preview_v1',
  manifestCollectionName: 'gastapp_transaction_ledger_preview_manifest_v1/current',
  reconciliationStatus: 'matched_with_rounding_tolerance',
  aurumReadinessStatus: 'preview_only',
  periodRange: 'P29-P36',
  rowCount: 1,
  warningsPayload: { status: 'available', warnings: ['rounding_tolerance_applied'] },
  reconciliationPayload: { reconciliationStatus: 'matched_with_rounding_tolerance', maxAbsDiffEur: 0.01 },
});

const gastappLedgerMissingManifest = (): GastappLedgerPreviewAdapterResult => ({
  status: 'missing_manifest',
  included: false,
  manifest: null,
  rows: [],
  warnings: [],
  errorMessage: null,
  configuredProjectId: 'gastapp-project',
  collectionName: 'gastapp_transaction_ledger_preview_v1',
  manifestCollectionName: 'gastapp_transaction_ledger_preview_manifest_v1/current',
  reconciliationStatus: null,
  aurumReadinessStatus: null,
  periodRange: null,
  rowCount: 0,
  warningsPayload: null,
  reconciliationPayload: null,
});

const gastappLedgerMismatch = (): GastappLedgerPreviewAdapterResult => ({
  ...gastappLedgerAvailable(),
  status: 'mismatch',
  included: false,
  rows: [],
  rowCount: 0,
  warningsPayload: { status: 'mismatch', warnings: ['preview_only'] },
});

describe('data room csv', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(escapeCsvValue('hola')).toBe('hola');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('a"b')).toBe('"a""b"');
    expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
    expect(buildCsv(['a', 'b'], [{ a: 'x,y', b: 1 }])).toBe('a,b\n"x,y",1\n');
  });
});

describe('data room manifest', () => {
  it('keeps gastapp ok status', () => {
    const manifest = buildFinancialDataRoomManifest({
      generated_at: '2026-06-04T10:00:00.000Z',
      bundle_version: 'financial_data_room_mvp1',
      source_app: 'aurum',
      includes: {
        aurum: true,
        midas: true,
        gastapp_monthly: true,
        gastapp_ledger_preview: true,
        gastapp_categories: false,
        gastapp_transactions: false,
      },
      source_status: { aurum: 'ok', midas: 'ok', gastapp_status: 'ok', gastapp_ledger_preview_status: 'available' },
      missing_sources: [],
      warnings: [],
      row_counts: {},
      no_data_modified: true,
      firestore_projects: { aurum_shared: 'aurum', gastapp_external: 'gastapp' },
      gastapp_ledger_preview_available: true,
      gastapp_ledger_preview_status: 'available',
      gastapp_ledger_preview_collection: 'gastapp_transaction_ledger_preview_v1',
      gastapp_ledger_preview_manifest_collection: 'gastapp_transaction_ledger_preview_manifest_v1/current',
      gastapp_ledger_preview_period_range: 'P29-P36',
      gastapp_ledger_preview_row_count: 37,
      gastapp_ledger_preview_reconciliation_status: 'matched',
      gastapp_ledger_preview_max_abs_diff_eur: 0,
      gastapp_ledger_preview_rounding_diff_count: 0,
      gastapp_ledger_preview_aurum_readiness_status: 'preview_only',
      gastapp_ledger_preview_is_official_source: false,
    });
    expect(manifest.source_status.gastapp_status).toBe('ok');
    expect(manifest.gastapp_ledger_preview_status).toBe('available');
  });

  it('keeps gastapp unavailable status', () => {
    const manifest = buildFinancialDataRoomManifest({
      generated_at: '2026-06-04T10:00:00.000Z',
      bundle_version: 'financial_data_room_mvp1',
      source_app: 'aurum',
      includes: {
        aurum: true,
        midas: true,
        gastapp_monthly: false,
        gastapp_ledger_preview: false,
        gastapp_categories: false,
        gastapp_transactions: false,
      },
      source_status: { aurum: 'ok', midas: 'ok', gastapp_status: 'unavailable', gastapp_ledger_preview_status: 'missing_manifest' },
      missing_sources: ['gastapp_monthly'],
      warnings: ['gastapp_firestore_unavailable'],
      row_counts: {},
      no_data_modified: true,
      firestore_projects: { aurum_shared: 'aurum', gastapp_external: 'gastapp' },
      gastapp_ledger_preview_available: false,
      gastapp_ledger_preview_status: 'missing_manifest',
      gastapp_ledger_preview_collection: 'gastapp_transaction_ledger_preview_v1',
      gastapp_ledger_preview_manifest_collection: 'gastapp_transaction_ledger_preview_manifest_v1/current',
      gastapp_ledger_preview_period_range: null,
      gastapp_ledger_preview_row_count: 0,
      gastapp_ledger_preview_reconciliation_status: null,
      gastapp_ledger_preview_max_abs_diff_eur: null,
      gastapp_ledger_preview_rounding_diff_count: null,
      gastapp_ledger_preview_aurum_readiness_status: null,
      gastapp_ledger_preview_is_official_source: false,
    });
    expect(manifest.includes.gastapp_monthly).toBe(false);
    expect(manifest.source_status.gastapp_status).toBe('unavailable');
  });
});

describe('buildFinancialDataRoom', () => {
  it('builds the expected bundle and partial fallback', () => {
    const result = buildFinancialDataRoom({
      generatedAt: '2026-06-04T10:00:00.000Z',
      aurum: baseAurum(),
      midas: baseMidas(),
      gastapp: gastappOk(),
      gastappLedgerPreview: gastappLedgerAvailable(),
      aurumProjectId: 'aurum-project',
    });

    expect(result.filename).toBe('financial_data_room_2026-06-04.zip');
    expect(result.files.map((file) => file.name)).toEqual(expect.arrayContaining([
      '00_README_IA.md',
      '01_resumen_ejecutivo.csv',
      '02_panel_mensual_consolidado.csv',
      '03_aurum_patrimonio_mensual.csv',
      '04_aurum_retornos.csv',
      '05_aurum_detalle_bloques.csv',
      '06_gastapp_vista_contable.csv',
      'gastapp_ledger_preview_manifest.json',
      'gastapp_ledger_preview_rows.json',
      'gastapp_ledger_preview_rows.csv',
      'gastapp_ledger_preview_warnings.json',
      'gastapp_ledger_preview_reconciliation.json',
      '09_midas_inputs_resultados.csv',
      '10_cruces_aurum_gastapp.csv',
      'manifest.json',
      'raw_minimal.json',
    ]));
    expect(result.manifest.includes.gastapp_monthly).toBe(true);
    expect(result.manifest.gastapp_ledger_preview_status).toBe('available');
    expect(result.manifest.no_data_modified).toBe(true);
  });

  it('keeps exporting when ledger manifest is missing', () => {
    const result = buildFinancialDataRoom({
      generatedAt: '2026-06-04T10:00:00.000Z',
      aurum: baseAurum(),
      midas: baseMidas(),
      gastapp: gastappOk(),
      gastappLedgerPreview: gastappLedgerMissingManifest(),
      aurumProjectId: 'aurum-project',
    });

    expect(result.files.map((file) => file.name)).not.toContain('gastapp_ledger_preview_rows.csv');
    expect(result.manifest.gastapp_ledger_preview_status).toBe('missing_manifest');
    expect(result.manifest.includes.gastapp_monthly).toBe(true);
  });

  it('reports mismatch without exporting ledger rows', () => {
    const result = buildFinancialDataRoom({
      generatedAt: '2026-06-04T10:00:00.000Z',
      aurum: baseAurum(),
      midas: baseMidas(),
      gastapp: gastappOk(),
      gastappLedgerPreview: gastappLedgerMismatch(),
      aurumProjectId: 'aurum-project',
    });

    expect(result.manifest.gastapp_ledger_preview_status).toBe('mismatch');
    expect(result.files.map((file) => file.name)).toContain('gastapp_ledger_preview_manifest.json');
    expect(result.files.map((file) => file.name)).not.toContain('gastapp_ledger_preview_rows.csv');
  });
});

describe('gastapp ledger preview csv', () => {
  it('keeps the exported columns stable', () => {
    const result = buildFinancialDataRoom({
      generatedAt: '2026-06-04T10:00:00.000Z',
      aurum: baseAurum(),
      midas: baseMidas(),
      gastapp: gastappOk(),
      gastappLedgerPreview: gastappLedgerAvailable(),
      aurumProjectId: 'aurum-project',
    });
    const csv = result.files.find((file) => file.name === 'gastapp_ledger_preview_rows.csv')?.content || '';
    expect(csv).toContain('ledger_id,source_kind,transaction_class,project_name,description');
    expect(csv).toContain('led-1,project,expense,Proyecto A,Hotel');
  });
});
