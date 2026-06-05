import JSZip from 'jszip';
import { db } from '../firebase';
import type { AnalysisExportContext, FinancialDataRoomBuildResult } from './dataRoomTypes';
import { buildAurumDataRoomData } from './aurumDataRoomAdapter';
import { buildFinancialDataRoom } from './buildFinancialDataRoom';
import { loadGastappLedgerPreviewDataRoomData } from './gastappLedgerPreviewAdapter';
import { loadGastappMonthlyDataRoomData } from './gastappMonthlyAdapter';
import { loadMidasDataRoomData } from './midasDataRoomAdapter';

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

export const exportFinancialDataRoomZip = async (
  analysisContext: AnalysisExportContext,
): Promise<FinancialDataRoomBuildResult> => {
  const generatedAt = new Date().toISOString();
  const aurum = buildAurumDataRoomData(analysisContext);
  const [midas, gastapp, gastappLedgerPreview] = await Promise.all([
    loadMidasDataRoomData(),
    loadGastappMonthlyDataRoomData(),
    loadGastappLedgerPreviewDataRoomData(),
  ]);
  const bundle = buildFinancialDataRoom({
    generatedAt,
    aurum,
    midas,
    gastapp,
    gastappLedgerPreview,
    aurumProjectId: String(db.app.options.projectId || ''),
  });

  const zip = new JSZip();
  bundle.files.forEach((file) => {
    zip.file(file.name, file.content);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, bundle.filename);
  return bundle;
};
