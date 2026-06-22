import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/Components', () => ({
  Button: () => null,
  Card: () => null,
}));
import {
  describeGastappDataRoomV2DiagnosticState,
  type GastappDataRoomV2DiagnosticViewState,
} from '../src/components/settings/SyncStatusSection';

const base = (status: GastappDataRoomV2DiagnosticViewState['status']): GastappDataRoomV2DiagnosticViewState => ({
  status,
  sourceStatus: null,
  message: '',
  manifest: null,
  summariesSample: [],
  rowsSample: [],
});

describe('SyncStatusSection gastapp v2 diagnostic label', () => {
  it('maps loading to loading', () => {
    expect(describeGastappDataRoomV2DiagnosticState(base('loading'))).toBe('loading');
  });

  it('maps ok to ok', () => {
    expect(describeGastappDataRoomV2DiagnosticState(base('ok'))).toBe('ok');
  });

  it('maps idle and error to error fallback', () => {
    expect(describeGastappDataRoomV2DiagnosticState(base('idle'))).toBe('error');
    expect(describeGastappDataRoomV2DiagnosticState(base('error'))).toBe('error');
  });
});
