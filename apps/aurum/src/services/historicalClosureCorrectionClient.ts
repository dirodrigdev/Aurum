import { auth } from './firebase';

export type HistoricalFxRates = { usdClp: number; eurClp: number; ufClp: number };

export type HistoricalClosureRead = {
  monthKey: string;
  closure: Record<string, any>;
  recordCount: number;
  currencies: string[];
  assetCount: number;
  liabilityCount: number;
  riskCapitalCount: number;
  fingerprint: string;
  rootFingerprint: string;
  rootUpdateTime: string | null;
  checkpointCount: number;
  readAt: string;
};

export type HistoricalPreview = {
  monthKey: string;
  economicDate: string;
  recordCount: number;
  currentFxRates: HistoricalFxRates;
  proposedFxRates: HistoricalFxRates;
  exposureNetByCurrency: Record<string, number>;
  withoutRisk: HistoricalDelta;
  withRisk: HistoricalDelta;
  presentation: Record<string, HistoricalDelta>;
  reconciliation: { beforeWithoutRisk: boolean; beforeWithRisk: boolean; after: boolean };
  fingerprint: string;
  consumers: { derivedAutomatically: string[]; notModified: string[] };
};

export type HistoricalDelta = {
  before: number;
  after: number;
  difference: number;
  differencePct: number | null;
};

export type HistoricalPreparedCorrection = {
  backupId: string;
  checkpointId: string;
  operationId: string;
  closureFingerprint: string;
  rootDocumentFingerprint: string;
  chunkCount: number;
  status: 'prepared';
  cloudVerified: boolean;
  approvedCorrection: {
    monthKey: string;
    proposedFxRates: HistoricalFxRates;
    expectedNetClp: number;
    expectedNetClpWithRisk: number;
    previewFingerprint: string;
  };
  approvedCorrectionFingerprint: string;
};

export type HistoricalApplyResult = {
  status: 'applied_verified';
  operationId: string;
  monthKey: string;
  fingerprint: string;
  preview: HistoricalPreview;
  reconciliation: HistoricalPreview['reconciliation'];
  persistedFxRates: HistoricalFxRates;
  persistedNetClp: number;
  persistedNetClpWithRisk: number;
};

export type HistoricalRollbackPreview = {
  monthKey: string;
  checkpointId: string;
  currentFingerprint: string;
  restoredFingerprint: string;
  currentFxRates: HistoricalFxRates;
  restoredFxRates: HistoricalFxRates;
  currentNetClp: number;
  restoredNetClp: number;
};

const endpoint = '/api/admin/historical-closure';

const messageFrom = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.ok) return payload.result;
  const error = new Error(String(payload?.error || `Error administrativo (${response.status}).`));
  Object.assign(error, { status: response.status, code: payload?.code || 'historical_service_error' });
  throw error;
};

const request = async <T,>(method: 'GET' | 'POST', action: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error('Debes iniciar sesión con la cuenta autorizada para usar esta herramienta.');
    Object.assign(error, { status: 401, code: 'unauthenticated' });
    throw error;
  }
  const token = await user.getIdToken();
  const params = new URLSearchParams({ action, uid: user.uid });
  Object.entries(payload).forEach(([key, value]) => {
    if (method === 'GET' && value !== undefined && value !== null) params.set(key, String(value));
  });
  const response = await fetch(method === 'GET' ? `${endpoint}?${params.toString()}` : endpoint, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify({ action, uid: user.uid, ...payload }) : undefined,
  });
  return messageFrom(response) as Promise<T>;
};

export const readHistoricalClosureCloud = (monthKey: string) =>
  request<HistoricalClosureRead>('GET', 'read', { monthKey });

export const previewHistoricalClosureCorrection = (input: {
  monthKey: string;
  expectedFingerprint: string;
  proposedFxRates: HistoricalFxRates;
}) => request<HistoricalPreview>('POST', 'preview', input);

export const prepareHistoricalClosureCorrection = (input: {
  monthKey: string;
  expectedFingerprint: string;
  proposedFxRates: HistoricalFxRates;
  reason: string;
}) => request<HistoricalPreparedCorrection>('POST', 'prepare', input);

export const exportHistoricalClosureBackup = (backupId: string) =>
  request<Record<string, unknown>>('GET', 'export', { backupId });

export const applyHistoricalClosureCorrection = (input: Record<string, unknown>) =>
  request<HistoricalApplyResult>('POST', 'apply', input);

export const previewHistoricalClosureRollback = (monthKey: string, checkpointId: string) =>
  request<HistoricalRollbackPreview>('POST', 'rollback-preview', { monthKey, checkpointId });

export const rollbackHistoricalClosureCorrection = (input: Record<string, unknown>) =>
  request<{ operationId: string; monthKey: string; fingerprint: string; safetyBackupId: string }>('POST', 'rollback', input);

export const downloadHistoricalBackup = (payload: Record<string, unknown>, monthKey: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `aurum-closure-backup-${monthKey}-${timestamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};
