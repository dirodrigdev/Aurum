export type BackupSourceMode =
  | 'online'
  | 'cloud'
  | 'local_cache'
  | 'bundled'
  | 'default'
  | 'missing';

export type BackupAttemptStatus = 'success' | 'unavailable' | 'permission_denied' | 'missing' | 'invalid' | 'unknown';

export type BackupMetadata = {
  sourceMode: BackupSourceMode;
  economicDate: string | null;
  asOf: string | null;
  capturedAt: string | null;
  retrievedAt: string | null;
  publishedAt: string | null;
  payloadHash: string | null;
  configRevision: string | null;
  engineRevision: string | null;
  freshnessPolicyVersion: string;
  lastOnlineAttemptAt: string | null;
  lastOnlineAttemptStatus: BackupAttemptStatus | null;
  selectedReason: string | null;
  rejectedReason: string | null;
};

export const BACKUP_FRESHNESS_POLICY_VERSION = 'midas-data-trust-v1';

export const hasVerifiableTimestamp = (metadata: Pick<BackupMetadata, 'capturedAt' | 'retrievedAt'> | null | undefined) => (
  Boolean(metadata?.capturedAt || metadata?.retrievedAt)
);

export const buildBackupMetadata = (
  input: Partial<BackupMetadata> & Pick<BackupMetadata, 'sourceMode'>,
): BackupMetadata => ({
  sourceMode: input.sourceMode,
  economicDate: input.economicDate ?? null,
  asOf: input.asOf ?? null,
  capturedAt: input.capturedAt ?? null,
  retrievedAt: input.retrievedAt ?? null,
  publishedAt: input.publishedAt ?? null,
  payloadHash: input.payloadHash ?? null,
  configRevision: input.configRevision ?? null,
  engineRevision: input.engineRevision ?? null,
  freshnessPolicyVersion: input.freshnessPolicyVersion ?? BACKUP_FRESHNESS_POLICY_VERSION,
  lastOnlineAttemptAt: input.lastOnlineAttemptAt ?? null,
  lastOnlineAttemptStatus: input.lastOnlineAttemptStatus ?? null,
  selectedReason: input.selectedReason ?? null,
  rejectedReason: input.rejectedReason ?? null,
});

export type BackupCandidate<T> = {
  value: T;
  metadata: BackupMetadata;
};

const parseDate = (value: string | null) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sourceRank = (sourceMode: BackupSourceMode) => (
  sourceMode === 'online' || sourceMode === 'cloud' ? 3
    : sourceMode === 'local_cache' ? 2
      : sourceMode === 'bundled' ? 1
        : 0
);

export function selectBestBackupCandidate<T>(candidates: Array<BackupCandidate<T>>): BackupCandidate<T> | null {
  const valid = candidates.filter((candidate) => hasVerifiableTimestamp(candidate.metadata));
  if (valid.length === 0) return null;
  const ordered = [...valid].sort((left, right) => {
    const sourceDifference = sourceRank(right.metadata.sourceMode) - sourceRank(left.metadata.sourceMode);
    if (sourceDifference !== 0) return sourceDifference;
    const economicLeft = parseDate(left.metadata.economicDate ?? left.metadata.asOf) ?? -Infinity;
    const economicRight = parseDate(right.metadata.economicDate ?? right.metadata.asOf) ?? -Infinity;
    if (economicRight !== economicLeft) return economicRight - economicLeft;
    const capturedLeft = parseDate(left.metadata.capturedAt ?? left.metadata.retrievedAt) ?? -Infinity;
    const capturedRight = parseDate(right.metadata.capturedAt ?? right.metadata.retrievedAt) ?? -Infinity;
    return capturedRight - capturedLeft;
  });
  const selected = ordered[0];
  return {
    ...selected,
    metadata: {
      ...selected.metadata,
      selectedReason: selected.metadata.selectedReason ?? 'highest_source_and_economic_date',
    },
  };
}
