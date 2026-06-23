import JSZip from 'jszip';
import { db } from '../firebase';
import type {
  AnalysisExportContext,
  FinancialDataRoomBuildResult,
  GastappDataRoomV2ManifestResult,
  GastappDataRoomV2PeriodSummary,
  GastappDataRoomV2Row,
  GastappDataRoomV2RowsPageResult,
} from './dataRoomTypes';
import { buildAurumDataRoomData } from './aurumDataRoomAdapter';
import { buildFinancialDataRoom } from './buildFinancialDataRoom';
import { describeGastappDataRoomV2Status } from './gastappAccessGuidance';
import {
  getGastappDataRoomV2Manifest,
  getGastappDataRoomV2PeriodSummaries,
  getGastappDataRoomV2RowsPage,
} from './gastappDataRoomV2Adapter';
import { loadGastappLedgerPreviewDataRoomData } from './gastappLedgerPreviewAdapter';
import { loadGastappMonthlyDataRoomData } from './gastappMonthlyAdapter';
import { loadMidasDataRoomData } from './midasDataRoomAdapter';

const TRANSACTION_EXPORT_PAGE_SIZE = 250;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const downloadBundle = async (bundle: FinancialDataRoomBuildResult) => {
  const zip = new JSZip();
  bundle.files.forEach((file) => {
    zip.file(file.name, file.content);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, bundle.filename);
  return bundle;
};

const buildDataRoomV2ExportError = (
  manifestResult: GastappDataRoomV2ManifestResult,
  technicalDetail?: string | null,
) => {
  const message = describeGastappDataRoomV2Status({
    status: manifestResult.status,
    errorMessage: manifestResult.errorMessage,
    technicalDetail,
    retryActionLabel: 'Descargar base financiera con transacciones',
  });
  return new Error(message);
};

const assertDataRoomV2ReadyForExport = (manifestResult: GastappDataRoomV2ManifestResult) => {
  if (manifestResult.status === 'usable' && manifestResult.usable && manifestResult.manifest) {
    return;
  }
  if (manifestResult.status === 'not_usable' && manifestResult.manifest) {
    const manifest = manifestResult.manifest;
    throw new Error(
      `Data Room v2 existe, pero no está habilitado para descarga oficial. readinessStatus=${manifest.readinessStatus || 'unknown'} · officialRefreshAllowed=${String(manifest.officialRefreshAllowed)} · blockers=${manifest.blockers.join(', ') || '[]'}`,
    );
  }
  throw buildDataRoomV2ExportError(
    manifestResult,
    `${manifestResult.status} · ${manifestResult.currentDocumentPath}`,
  );
};

const assertRowsPageOk = (pageResult: GastappDataRoomV2RowsPageResult) => {
  if (pageResult.status === 'usable') return;
  throw buildDataRoomV2ExportError(
    {
      status: pageResult.status,
      usable: pageResult.usable,
      manifest: pageResult.manifest,
      warnings: pageResult.warnings,
      errorMessage: pageResult.errorMessage,
      configuredProjectId: pageResult.configuredProjectId,
      rootCollection: 'gastapp_data_room_v2',
      currentDocumentPath: 'gastapp_data_room_v2/current',
    },
    pageResult.collectionPath || 'gastapp_data_room_v2/rows',
  );
};

const loadGastappDataRoomV2RowsForExport = async (input?: {
  onProgress?: (message: string) => void;
}) => {
  const rows: GastappDataRoomV2Row[] = [];
  let cursor: string | null = null;
  let pageNumber = 0;

  while (true) {
    const pageResult = await getGastappDataRoomV2RowsPage({
      pageSize: TRANSACTION_EXPORT_PAGE_SIZE,
      cursor,
    });
    assertRowsPageOk(pageResult);
    pageNumber += 1;
    rows.push(...pageResult.page.rows);
    input?.onProgress?.(`Preparando ZIP con transacciones… ${rows.length} filas cargadas (${pageNumber} página${pageNumber === 1 ? '' : 's'})`);
    if (!pageResult.page.nextCursor) {
      return {
        rows,
        collectionPath: pageResult.collectionPath,
      };
    }
    cursor = pageResult.page.nextCursor;
  }
};

const buildBaseBundle = async (analysisContext: AnalysisExportContext) => {
  const generatedAt = new Date().toISOString();
  const aurum = buildAurumDataRoomData(analysisContext);
  const [midas, gastapp, gastappLedgerPreview] = await Promise.all([
    loadMidasDataRoomData(),
    loadGastappMonthlyDataRoomData(),
    loadGastappLedgerPreviewDataRoomData(),
  ]);
  return {
    generatedAt,
    aurum,
    midas,
    gastapp,
    gastappLedgerPreview,
  };
};

export const exportFinancialDataRoomZip = async (
  analysisContext: AnalysisExportContext,
): Promise<FinancialDataRoomBuildResult> => {
  const base = await buildBaseBundle(analysisContext);
  const bundle = buildFinancialDataRoom({
    ...base,
    aurumProjectId: String(db.app.options.projectId || ''),
  });
  return downloadBundle(bundle);
};

export const exportFinancialDataRoomWithTransactionsZip = async (
  analysisContext: AnalysisExportContext,
  options?: {
    onProgress?: (message: string) => void;
  },
): Promise<FinancialDataRoomBuildResult> => {
  options?.onProgress?.('Preparando base financiera con transacciones…');
  const base = await buildBaseBundle(analysisContext);
  const manifestResult = await getGastappDataRoomV2Manifest();
  assertDataRoomV2ReadyForExport(manifestResult);

  options?.onProgress?.('Leyendo manifest y resúmenes de GastApp Data Room v2…');
  const periodSummariesResult = await getGastappDataRoomV2PeriodSummaries();
  if (periodSummariesResult.status !== 'usable') {
    throw buildDataRoomV2ExportError(
      manifestResult,
      periodSummariesResult.collectionPath || 'gastapp_data_room_v2/period_summaries',
    );
  }

  const rowsResult = await loadGastappDataRoomV2RowsForExport({
    onProgress: options?.onProgress,
  });

  const bundle = buildFinancialDataRoom({
    ...base,
    aurumProjectId: String(db.app.options.projectId || ''),
    gastappDataRoomV2: {
      manifestResult,
      periodSummaries: periodSummariesResult.summaries as GastappDataRoomV2PeriodSummary[],
      rows: rowsResult.rows,
      periodSummariesCollectionPath: periodSummariesResult.collectionPath,
      rowsCollectionPath: rowsResult.collectionPath,
    },
  });

  options?.onProgress?.(`Generando ZIP con ${rowsResult.rows.length} transacciones…`);
  return downloadBundle(bundle);
};
