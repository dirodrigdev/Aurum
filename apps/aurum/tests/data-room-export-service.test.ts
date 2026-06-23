/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateAsyncMock,
  zipFileMock,
  buildFinancialDataRoomMock,
  getGastappDataRoomV2ManifestMock,
  getGastappDataRoomV2PeriodSummariesMock,
  getGastappDataRoomV2RowsPageMock,
} = vi.hoisted(() => ({
  generateAsyncMock: vi.fn(async () => new Blob(['zip'])),
  zipFileMock: vi.fn(),
  buildFinancialDataRoomMock: vi.fn((input: any) => ({
    filename: input.gastappDataRoomV2 ? 'financial_data_room_with_transactions_2026-06-23.zip' : 'financial_data_room_2026-06-23.zip',
    files: [{ name: 'manifest.json', content: '{}', mimeType: 'application/json;charset=utf-8;', rowCount: 1 }],
    manifest: {
      source_status: {
        gastapp_status: 'ok',
        gastapp_ledger_preview_status: 'available',
        gastapp_data_room_v2_status: input.gastappDataRoomV2 ? 'usable' : null,
      },
    },
    rawMinimal: {},
  })),
  getGastappDataRoomV2ManifestMock: vi.fn(),
  getGastappDataRoomV2PeriodSummariesMock: vi.fn(),
  getGastappDataRoomV2RowsPageMock: vi.fn(),
}));

vi.mock('jszip', () => ({
  default: class MockZip {
    file = zipFileMock;
    generateAsync = generateAsyncMock;
  },
}));

vi.mock('../src/services/firebase', () => ({
  db: { app: { options: { projectId: 'aurum-project' } } },
}));

vi.mock('../src/services/dataRoom/aurumDataRoomAdapter', () => ({
  buildAurumDataRoomData: vi.fn(() => ({ included: true })),
}));

vi.mock('../src/services/dataRoom/buildFinancialDataRoom', () => ({
  buildFinancialDataRoom: buildFinancialDataRoomMock,
}));

vi.mock('../src/services/dataRoom/gastappLedgerPreviewAdapter', () => ({
  loadGastappLedgerPreviewDataRoomData: vi.fn(async () => ({ status: 'available', included: true, rows: [], warnings: [], errorMessage: null })),
}));

vi.mock('../src/services/dataRoom/gastappMonthlyAdapter', () => ({
  loadGastappMonthlyDataRoomData: vi.fn(async () => ({ status: 'ok', included: true, rows: [], warnings: [], errorMessage: null })),
}));

vi.mock('../src/services/dataRoom/midasDataRoomAdapter', () => ({
  loadMidasDataRoomData: vi.fn(async () => ({ status: 'ok', included: true, rows: [], warnings: [], errorMessage: null })),
}));

vi.mock('../src/services/dataRoom/gastappDataRoomV2Adapter', () => ({
  getGastappDataRoomV2Manifest: getGastappDataRoomV2ManifestMock,
  getGastappDataRoomV2PeriodSummaries: getGastappDataRoomV2PeriodSummariesMock,
  getGastappDataRoomV2RowsPage: getGastappDataRoomV2RowsPageMock,
}));

import {
  exportFinancialDataRoomWithTransactionsZip,
  exportFinancialDataRoomZip,
} from '../src/services/dataRoom/exportDataRoomZip';

const baseAnalysisContext = {
  closures: [],
  officialMonthlyRowsAsc: [],
  wealthEvolutionModel: {} as any,
  periodSummaries: [],
  yearlySummaries: [],
  heroSinceStart: null,
  heroLast12: null,
  heroYtd2026: null,
  heroLastMonth: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe('data room export service', () => {
  it('does not load v2 rows for the consolidated zip', async () => {
    await exportFinancialDataRoomZip(baseAnalysisContext);
    expect(getGastappDataRoomV2ManifestMock).not.toHaveBeenCalled();
    expect(getGastappDataRoomV2RowsPageMock).not.toHaveBeenCalled();
  });

  it('loads v2 rows only during the explicit transaction export', async () => {
    getGastappDataRoomV2ManifestMock.mockResolvedValue({
      status: 'usable',
      usable: true,
      manifest: {
        id: 'current',
        runId: 'run-1',
        schemaVersion: '2',
        calculationVersion: 'v2',
        dataHash: 'hash-1',
        sourceCommit: 'commit-1',
        readinessStatus: 'warning',
        officialRefreshAllowed: true,
        consumerRefreshRequired: false,
        blockers: [],
        warnings: [],
        rowCount: 3,
        periodSummariesCount: 1,
        generatedAt: '2026-06-23T10:00:00.000Z',
        raw: {},
      },
      warnings: [],
      errorMessage: null,
      configuredProjectId: 'gastapp-project',
      rootCollection: 'gastapp_data_room_v2',
      currentDocumentPath: 'gastapp_data_room_v2/current',
    });
    getGastappDataRoomV2PeriodSummariesMock.mockResolvedValue({
      status: 'usable',
      usable: true,
      manifest: { runId: 'run-1' },
      summaries: [{ id: '2026-04', period: '2026-04', warnings: [], blockers: [] }],
      warnings: [],
      errorMessage: null,
      configuredProjectId: 'gastapp-project',
      collectionPath: 'gastapp_data_room_v2/run-1/period_summaries',
    });
    getGastappDataRoomV2RowsPageMock
      .mockResolvedValueOnce({
        status: 'usable',
        usable: true,
        manifest: { runId: 'run-1' },
        page: {
          rows: [{ id: 'row-1' }, { id: 'row-2' }],
          pageSize: 250,
          nextCursor: 'row-2',
        },
        warnings: [],
        errorMessage: null,
        configuredProjectId: 'gastapp-project',
        collectionPath: 'gastapp_data_room_v2/run-1/rows',
      })
      .mockResolvedValueOnce({
        status: 'usable',
        usable: true,
        manifest: { runId: 'run-1' },
        page: {
          rows: [{ id: 'row-3' }],
          pageSize: 250,
          nextCursor: null,
        },
        warnings: [],
        errorMessage: null,
        configuredProjectId: 'gastapp-project',
        collectionPath: 'gastapp_data_room_v2/run-1/rows',
      });

    const onProgress = vi.fn();
    await exportFinancialDataRoomWithTransactionsZip(baseAnalysisContext, { onProgress });

    expect(getGastappDataRoomV2ManifestMock).toHaveBeenCalledTimes(1);
    expect(getGastappDataRoomV2PeriodSummariesMock).toHaveBeenCalledTimes(1);
    expect(getGastappDataRoomV2RowsPageMock).toHaveBeenCalledTimes(2);
    expect(buildFinancialDataRoomMock).toHaveBeenCalledWith(expect.objectContaining({
      gastappDataRoomV2: expect.objectContaining({
        periodSummaries: expect.any(Array),
        rows: expect.arrayContaining([{ id: 'row-1' }, { id: 'row-3' }]),
      }),
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('filas cargadas'));
  });
});
