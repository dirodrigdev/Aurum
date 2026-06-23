import type {
  DataRoomSourceStatus,
  GastappDataRoomV2Status,
  GastappLedgerPreviewStatus,
} from './dataRoomTypes';

type GastappPermissionLikeStatus =
  | DataRoomSourceStatus
  | GastappDataRoomV2Status
  | GastappLedgerPreviewStatus
  | string
  | null
  | undefined;

export const GASTAPP_ACCESS_GUIDANCE_HEADER = 'Acceso GastApp cerrado';

export const GASTAPP_ACCESS_GUIDANCE_STEPS = [
  '1. Abre GastApp.',
  '2. Ve a Ajustes → Diagnóstico Aurum/Data Room → Data Room para Aurum.',
  '3. Toca “Abrir Data Room para Aurum por 30 min”.',
];

export const GASTAPP_ACCESS_GUIDANCE_INTRO = 'Para leer el Data Room:';

export const buildGastappAccessTechnicalDetail = (
  technicalDetail?: string | null,
) => technicalDetail || 'permission_denied';

const normalizeMessage = (value: string | null | undefined) => String(value || '').toLowerCase();

export const isGastappPermissionDenied = (
  status: GastappPermissionLikeStatus,
  errorMessage?: string | null,
) => {
  if (status === 'permission_denied') return true;
  const message = normalizeMessage(errorMessage);
  return (
    message.includes('permission-denied') ||
    message.includes('permission denied') ||
    message.includes('insufficient permissions') ||
    message.includes('missing or insufficient permissions')
  );
};

export const buildGastappAccessGuidanceMessage = (
  finalStep = '4. Vuelve a Aurum y presiona “Reintentar” o “Actualizar análisis”.',
  technicalDetail?: string | null,
) => {
  const lines = [
    GASTAPP_ACCESS_GUIDANCE_HEADER,
    GASTAPP_ACCESS_GUIDANCE_INTRO,
    ...GASTAPP_ACCESS_GUIDANCE_STEPS,
    finalStep,
  ];
  if (technicalDetail) {
    lines.push(`Detalle técnico: ${technicalDetail}`);
  }
  return lines.join('\n');
};

export const describeGastappDataRoomV2Status = (input: {
  status: GastappDataRoomV2Status | null | undefined;
  errorMessage?: string | null;
  technicalDetail?: string | null;
}) => {
  const { status, errorMessage, technicalDetail } = input;
  if (isGastappPermissionDenied(status, errorMessage)) {
    return buildGastappAccessGuidanceMessage(
      '4. Vuelve a Aurum y presiona “Reintentar” o “Actualizar análisis”.',
      technicalDetail || 'permission_denied al leer GastApp Data Room v2.',
    );
  }
  if (status === 'missing_config') return 'Faltan VITE_GASTAPP_FIREBASE_* en este entorno.';
  if (status === 'missing_current') return 'Data Room v2 no publicado: falta el documento current.';
  if (status === 'missing_run') return 'Data Room v2 incompleto: existe current pero falta el run publicado.';
  if (status === 'not_usable') {
    return 'Data Room v2 existe, pero no está habilitado para uso oficial. Revisa readinessStatus, officialRefreshAllowed y blockers.';
  }
  if (status === 'unavailable') {
    return 'No se pudo leer GastApp por un problema de red o disponibilidad.';
  }
  if (status === 'usable') return 'Lectura read-only OK.';
  return errorMessage || 'No se pudo completar la lectura de GastApp Data Room v2.';
};

export const describeGastappAnalysisAccessIssue = (input: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: 'firestore' | 'legacy' | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  missingMonths: string[];
}) => {
  if (
    input.missingMonths.length > 0 &&
    input.mode === 'legacy' &&
    isGastappPermissionDenied(input.errorCode || null, input.errorMessage)
  ) {
    return buildGastappAccessGuidanceMessage(
      '4. Vuelve a Aurum y presiona “Actualizar análisis”.',
      `permission_denied al leer aurum_monthly_from_periods_v1. Meses afectados: ${input.missingMonths.join(', ')}.`,
    );
  }
  return null;
};

export const describeGastappZipExportStatus = (input: {
  filename: string;
  gastappStatus: DataRoomSourceStatus;
  ledgerPreviewStatus: GastappLedgerPreviewStatus;
}) => {
  const { filename, gastappStatus, ledgerPreviewStatus } = input;
  if (gastappStatus === 'ok' && (ledgerPreviewStatus === 'available' || ledgerPreviewStatus === 'missing_manifest')) {
    return `ZIP generado: ${filename} · Ledger preview ${ledgerPreviewStatus}`;
  }
  if (
    isGastappPermissionDenied(gastappStatus) ||
    isGastappPermissionDenied(ledgerPreviewStatus)
  ) {
    const blockedSources = [
      isGastappPermissionDenied(gastappStatus) ? 'GastApp mensual oficial' : null,
      isGastappPermissionDenied(ledgerPreviewStatus) ? 'Ledger preview' : null,
    ].filter(Boolean).join(' + ');
    return [
      `ZIP parcial generado: ${filename}`,
      buildGastappAccessGuidanceMessage(
        '4. Vuelve a Aurum y presiona “Descargar base financiera consolidada”.',
        `permission_denied en ${blockedSources}. GastApp=${gastappStatus} · Ledger preview=${ledgerPreviewStatus}.`,
      ),
    ].join('\n');
  }
  if (gastappStatus === 'not_found' || ledgerPreviewStatus === 'missing_manifest') {
    return `ZIP parcial generado: ${filename} · Falta una ruta publicada de GastApp. GastApp=${gastappStatus} · Ledger preview=${ledgerPreviewStatus}`;
  }
  if (gastappStatus === 'unavailable' || ledgerPreviewStatus === 'unavailable') {
    return `ZIP parcial generado: ${filename} · Error de red o disponibilidad al leer GastApp. GastApp=${gastappStatus} · Ledger preview=${ledgerPreviewStatus}`;
  }
  return `ZIP parcial generado: ${filename} · GastApp ${gastappStatus} · Ledger preview ${ledgerPreviewStatus}`;
};
