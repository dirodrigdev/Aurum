import { describe, expect, it } from 'vitest';
import {
  buildGastappAccessGuidanceMessage,
  describeGastappAnalysisAccessIssue,
  describeGastappDataRoomV2Status,
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
    expect(message).toContain('Informe completo no disponible');
    expect(message).toContain('Comprueba que GastApp está abierta.');
    expect(message).toContain('sesión autenticada corresponde al administrador autorizado');
    expect(message).toContain('Vuelve a intentar la descarga del Informe completo.');
  });

  it('maps permission denied in settings diagnostic to the GastApp access flow', () => {
    const message = describeGastappDataRoomV2Status({
      status: 'permission_denied',
      technicalDetail: 'permission_denied · gastapp_data_room_v2/current',
    });
    expect(message).toContain('Informe completo no disponible');
    expect(message).toContain('Reintentar');
    expect(message).toContain('permission_denied · gastapp_data_room_v2/current');
  });

  it('allows a custom retry action label for transaction exports', () => {
    const message = describeGastappDataRoomV2Status({
      status: 'permission_denied',
      technicalDetail: 'permission_denied · gastapp_data_room_v2/current',
      retryActionLabel: 'Descargar base financiera con transacciones',
    });
    expect(message).toContain('Descargar base financiera con transacciones');
  });

  it('maps analysis missing months plus permission denied to the monthly contract without Data Room guidance', () => {
    const message = describeGastappAnalysisAccessIssue({
      status: 'error',
      mode: null,
      errorCode: 'permission-denied',
      errorMessage: 'Missing or insufficient permissions.',
      missingMonths: ['2026-03', '2026-04'],
    });
    expect(message).toContain('months_current');
    expect(message).toContain('lectura pública');
    expect(message).toContain('no descargues el Informe completo');
    expect(message).toContain('2026-03, 2026-04');
  });

});
