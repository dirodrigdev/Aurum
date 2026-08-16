import {
  GASTAPP_DATA_ROOM_V2_EXPRESS_PATH,
  GASTAPP_DATA_ROOM_V2_FULL_PATH,
} from '../../src/services/gastappCanonicalV2';

export const SANITIZED_DATA_ROOM_CANONICAL_HASH = `sha256:${'a'.repeat(64)}`;
export const SANITIZED_CURRENT_OPERATIONAL_HASH = `sha256:${'d'.repeat(64)}`;
export const SANITIZED_FULL_SNAPSHOT_OPERATIONAL_HASH = `sha256:${'e'.repeat(64)}`;
export const SANITIZED_EXPRESS_HASH = `sha256:${'b'.repeat(64)}`;
export const SANITIZED_FULL_HASH = `sha256:${'c'.repeat(64)}`;
export const SANITIZED_EXPRESS_ARTIFACT_VERSION = 'gastapp-data-room-express-v2';
export const SANITIZED_FULL_ARTIFACT_VERSION = 'gastapp-data-room-artifact-v2';

// Synthetic ZIP-like bytes only: no GastApp rows, identifiers, or production data.
export const SANITIZED_EXPRESS_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x10, 0x11]);
export const SANITIZED_FULL_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x20, 0x21, 0x22]);

export const asFirestoreBytes = (bytes: Uint8Array) => ({
  toUint8Array: () => new Uint8Array(bytes),
});

export const createSanitizedDataRoomPointer = () => ({
  pointerVersion: 'gastapp-data-room-pointer-v2',
  storageBackend: 'firestore_blob',
  canonicalDataHash: SANITIZED_DATA_ROOM_CANONICAL_HASH,
  operationalDataHash: SANITIZED_CURRENT_OPERATIONAL_HASH,
  operationalRevision: 7,
  fullSnapshotHash: SANITIZED_FULL_HASH,
  fullSnapshotOperationalDataHash: SANITIZED_FULL_SNAPSHOT_OPERATIONAL_HASH,
  fullSnapshotGeneratedAt: '2026-08-01T10:00:00.000Z',
  fullSnapshotStale: true,
  express: {
    document: GASTAPP_DATA_ROOM_V2_EXPRESS_PATH,
    hash: SANITIZED_EXPRESS_HASH,
    bytes: SANITIZED_EXPRESS_ZIP_BYTES.byteLength,
    mediaType: 'application/zip',
    generatedAt: '2026-08-15T10:00:00.000Z',
  },
  full: {
    document: GASTAPP_DATA_ROOM_V2_FULL_PATH,
    hash: SANITIZED_FULL_HASH,
    bytes: SANITIZED_FULL_ZIP_BYTES.byteLength,
    mediaType: 'application/zip',
    generatedAt: '2026-08-01T10:00:00.000Z',
    operationalDataHash: SANITIZED_FULL_SNAPSHOT_OPERATIONAL_HASH,
    operationalRevision: 6,
    staleAgainstOperationalHash: true,
  },
});

export const createSanitizedDataRoomArtifact = (
  mode: 'express' | 'full',
  overrides: Record<string, unknown> = {},
) => {
  const isExpress = mode === 'express';
  const bytes = isExpress ? SANITIZED_EXPRESS_ZIP_BYTES : SANITIZED_FULL_ZIP_BYTES;
  const hash = isExpress ? SANITIZED_EXPRESS_HASH : SANITIZED_FULL_HASH;
  return {
    artifactVersion: isExpress ? SANITIZED_EXPRESS_ARTIFACT_VERSION : SANITIZED_FULL_ARTIFACT_VERSION,
    mode,
    canonicalDataHash: SANITIZED_DATA_ROOM_CANONICAL_HASH,
    hash,
    mediaType: 'application/zip',
    byteLength: bytes.byteLength,
    zipBytes: asFirestoreBytes(bytes),
    ...(isExpress ? {} : {
      generatedAt: '2026-08-01T10:00:00.000Z',
      operationalDataHash: SANITIZED_FULL_SNAPSHOT_OPERATIONAL_HASH,
      operationalRevision: 6,
      fullSnapshotHash: SANITIZED_FULL_HASH,
      fullSnapshotOperationalDataHash: SANITIZED_FULL_SNAPSHOT_OPERATIONAL_HASH,
      fullSnapshotOperationalRevision: 6,
      fullSnapshotGeneratedAt: '2026-08-01T10:00:00.000Z',
      fullSnapshotStale: false,
    }),
    ...overrides,
  };
};
