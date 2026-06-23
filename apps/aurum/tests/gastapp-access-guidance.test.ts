import { describe, expect, it } from 'vitest';
import {
  buildGastappAccessGuidanceMessage,
  describeGastappAnalysisAccessIssue,
  describeGastappDataRoomV2Status,
  describeGastappZipExportStatus,
  isGastappPermissionDenied,
} from '../src/services/dataRoom/gastappAccessGuidance';

describe('gastappAccessGuidance', () => {
  it('detects permission denied from status or firestore message', () => {
    expect(isGastappPermissionDenied('permission_denied')).toBe(true);
    expect(isGastappPermissionDenied(null, 'Missing or insufficient permissions.')).toBe(true);
    expect(isGastappPermissionDenied('unavailable', 'network error')).toBe(false);
  });

  it('builds the shared actionable guidance copy', () => {
    const message = buildGastappAccessGuidanceMessage();
    expect(message).toContain('Acceso GastApp cerrado');
    expect(message).toContain('Abre GastApp.');
    expect(message).toContain('Ajustes → Diagnóstico Aurum/Data Room → Data Room para Aurum');
    expect(message).toContain('Abrir Data Room para Aurum por 30 min');
  });

  it('maps permission denied in settings diagnostic to the GastApp access flow', () => {
    const message = describeGastappDataRoomV2Status({
      status: 'permission_denied',
      technicalDetail: 'permission_denied · gastapp_data_room_v2/current',
    });
    expect(message).toContain('Acceso GastApp cerrado');
    expect(message).toContain('Reintentar');
    expect(message).toContain('permission_denied · gastapp_data_room_v2/current');
  });

  it('maps analysis missing months plus permission denied runtime to the actionable flow', () => {
    const message = describeGastappAnalysisAccessIssue({
      status: 'error',
      mode: 'legacy',
      errorCode: 'permission-denied',
      errorMessage: 'Missing or insufficient permissions.',
      missingMonths: ['2026-03', '2026-04'],
    });
    expect(message).toContain('Actualizar análisis');
    expect(message).toContain('2026-03, 2026-04');
  });

  it('keeps zip exports actionable when GastApp access is closed', () => {
    const message = describeGastappZipExportStatus({
      filename: 'financial_data_room_2026-06-23.zip',
      gastappStatus: 'permission_denied',
      ledgerPreviewStatus: 'available',
    });
    expect(message).toContain('ZIP parcial generado');
    expect(message).toContain('Descargar base financiera consolidada');
    expect(message).toContain('GastApp mensual oficial');
  });
});
