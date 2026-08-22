type GastappDataRoomV2Status =
  | 'usable'
  | 'not_usable'
  | 'missing_current'
  | 'missing_run'
  | 'missing_config'
  | 'permission_denied'
  | 'unavailable'
  | 'error';

type GastappPermissionLikeStatus =
  | GastappDataRoomV2Status
  | string
  | null
  | undefined;

export const GASTAPP_ACCESS_GUIDANCE_HEADER = 'Informe completo no disponible';

export const GASTAPP_ACCESS_GUIDANCE_STEPS = [
  '1. Comprueba que GastApp está abierta.',
  '2. Verifica que la sesión autenticada corresponde al administrador autorizado.',
  '3. Vuelve a intentar la descarga del Informe completo.',
];

export const GASTAPP_ACCESS_GUIDANCE_INTRO = 'El Informe completo requiere una sesión admin autenticada:';

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
  retryActionLabel?: string | null;
}) => {
  const { status, errorMessage, technicalDetail, retryActionLabel } = input;
  if (isGastappPermissionDenied(status, errorMessage)) {
    return buildGastappAccessGuidanceMessage(
      `4. Vuelve a Aurum y presiona “${retryActionLabel || 'Reintentar'}”.`,
      technicalDetail || 'permission_denied al leer el Informe completo de GastApp.',
    );
  }
  if (status === 'missing_config') return 'Faltan VITE_GASTAPP_FIREBASE_* en este entorno.';
  if (status === 'missing_current') return 'Informe completo no publicado: falta el documento current.';
  if (status === 'missing_run') return 'Informe completo incompleto: existe current pero falta el artefacto publicado.';
  if (status === 'not_usable') {
    return 'El Informe completo existe, pero no está habilitado para uso oficial. Revisa su estado de publicación.';
  }
  if (status === 'unavailable') {
    return 'No se pudo leer GastApp por un problema de red o disponibilidad.';
  }
  if (status === 'usable') return 'Lectura read-only OK.';
  return errorMessage || 'No se pudo completar la lectura del Informe completo de GastApp.';
};

export const describeGastappAnalysisAccessIssue = (input: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: 'firestore' | 'e2e_fixture' | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  missingMonths: string[];
}) => {
  if (input.missingMonths.length === 0) return null;
  if (input.errorCode === 'missing_config') {
    return 'Este entorno no tiene configurado el Firebase secundario de GastApp. Faltan VITE_GASTAPP_FIREBASE_* para leer months_current.';
  }
  if (isGastappPermissionDenied(input.errorCode || null, input.errorMessage)) {
    return `GastApp denegó la lectura pública de months_current. Debe revisarse la publicación del contrato agregado; no descargues el Informe completo ni inicies sesión. Meses afectados: ${input.missingMonths.join(', ')}.`;
  }
  if (input.status === 'error' || (input.status === 'ready' && input.mode === null && input.errorMessage)) {
    return `No se pudo leer months_current de GastApp. No se usó el Informe completo ni una ruta legacy. Detalle: ${input.errorMessage || input.errorCode || 'no disponible'}.`;
  }
  return null;
};
