import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonthlyReturnRow } from '../src/components/analysis/types';
import { buildCalendarReturnsPresentation } from '../src/services/gastappMonthlyCalendarValidation';

import {
  GASTAPP_AURUM_MONTHS_V2_PATH,
  GASTAPP_AURUM_PERIODS_V2_PATH,
  GASTAPP_CANONICAL_V2_CURRENT_PATH,
  GASTAPP_CANONICAL_V2_CONTRACT,
  GASTAPP_CANONICAL_V2_PROJECT_ID,
  GASTAPP_DATA_ROOM_V2_EXPRESS_PATH,
  GASTAPP_DATA_ROOM_V2_EXPRESS_ARTIFACT_VERSION,
  GASTAPP_DATA_ROOM_V2_FULL_PATH,
  GASTAPP_DATA_ROOM_V2_FULL_ARTIFACT_VERSION,
  GASTAPP_DATA_ROOM_V2_POINTER_PATH,
  GastappCanonicalV2Error,
  loadGastappCanonicalV2Contracts,
  loadGastappCanonicalV2MonthContract,
  loadGastappDataRoomV2Artifact,
  loadGastappDataRoomV2Pointer,
  validateGastappDataRoomV2FreshnessAgainstMetadata,
} from '../src/services/gastappCanonicalV2';
import {
  asFirestoreBytes,
  SANITIZED_DATA_ROOM_CANONICAL_HASH,
  SANITIZED_EXPRESS_HASH,
  SANITIZED_EXPRESS_ZIP_BYTES,
  SANITIZED_FULL_HASH,
  SANITIZED_FULL_ZIP_BYTES,
  createSanitizedDataRoomArtifact,
  createSanitizedDataRoomPointer,
} from './fixtures/gastapp-data-room-v2-artifacts';

const sharedGastappFixture = JSON.parse(
  readFileSync(new URL('./fixtures/gastappCanonicalV2AurumSharedFixture.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;

const GASTAPP_CANONICAL_V2_EXPECTED = Object.freeze({
  ...GASTAPP_CANONICAL_V2_CONTRACT,
  canonicalDataHash: 'sha256:4480ad7e2854726658feaf9ad00ab594076bc46f6709e0d5a5120e1c85fa69ae',
  canonicalRows: 2441,
  periods: 39,
  acceptedPeriods: 39,
  totalEur: 257523.41,
  dayToDayEur: 173042.19,
  tripsEur: 58641.16,
  othersEur: 25840.06,
  calendarMinusCanonicalEur: 0,
  completeFromMonthKey: '2023-06',
  completeThroughMonthKey: '2026-07',
  partialBoundaryMonths: ['2023-05', '2026-08'],
  periodsContractHash: 'sha256:8a720993c4702e2e1bba2d8895c951f158e8d58c8dc19525e76a8913b52aea2f',
  monthsContractHash: 'sha256:dff6406365b2cc2e4ea07aaf6850826f5cb11dcac7e10be5dedf163343ee8ced',
  expressBytes: 25974,
  expressHash: 'sha256:7306bf542232621b4594d8b297c2ab9385ad3b63721d8dc7f919970bbbd17270',
  fullBytes: 148924,
  fullHash: 'sha256:e9f49b18e2fbbd35ede7929f722110e61932784a7308c071c0c928ed7f90acae',
});

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('../src/services/firebase', () => ({
  getGastappConfiguredProjectId: () => GASTAPP_CANONICAL_V2_PROJECT_ID,
  getGastappFirestore: () => null,
  isGastappFirestoreConfigured: () => false,
}));

const metadata = () => ({
  pointerVersion: GASTAPP_CANONICAL_V2_EXPECTED.pointerVersion,
  packageVersion: GASTAPP_CANONICAL_V2_EXPECTED.packageVersion,
  canonicalDataHash: GASTAPP_CANONICAL_V2_EXPECTED.canonicalDataHash,
  qualityStatus: GASTAPP_CANONICAL_V2_EXPECTED.qualityStatus,
  generatedAt: '2026-08-15T01:35:21.024Z',
  coverage: {
    completeFromMonthKey: GASTAPP_CANONICAL_V2_EXPECTED.completeFromMonthKey,
    completeThroughMonthKey: GASTAPP_CANONICAL_V2_EXPECTED.completeThroughMonthKey,
    partialBoundaryMonths: [...GASTAPP_CANONICAL_V2_EXPECTED.partialBoundaryMonths],
  },
  counts: {
    canonicalRows: GASTAPP_CANONICAL_V2_EXPECTED.canonicalRows,
    periods: GASTAPP_CANONICAL_V2_EXPECTED.periods,
    acceptedPeriods: GASTAPP_CANONICAL_V2_EXPECTED.acceptedPeriods,
    months: 40,
  },
  totalsEur: {
    exact: GASTAPP_CANONICAL_V2_EXPECTED.totalEur,
    dayToDay: GASTAPP_CANONICAL_V2_EXPECTED.dayToDayEur,
    trips: GASTAPP_CANONICAL_V2_EXPECTED.tripsEur,
    others: GASTAPP_CANONICAL_V2_EXPECTED.othersEur,
    calendarMinusCanonical: GASTAPP_CANONICAL_V2_EXPECTED.calendarMinusCanonicalEur,
  },
});

const periodContract = () => ({
  contractId: GASTAPP_CANONICAL_V2_EXPECTED.periodsContractId,
  version: GASTAPP_CANONICAL_V2_EXPECTED.periodsContractVersion,
  generatedAt: '2026-08-15T01:35:21.024Z',
  sourceSystem: 'GastApp',
  canonicalDataHash: GASTAPP_CANONICAL_V2_EXPECTED.canonicalDataHash,
  axis: GASTAPP_CANONICAL_V2_EXPECTED.periodsAxis,
  dateSemantics: '12th through 11th',
  prohibitedFields: ['calendarMonthKey'],
  coverage: { firstPeriod: 'P1', lastPeriod: 'P39' },
  rowCount: GASTAPP_CANONICAL_V2_EXPECTED.canonicalRows,
  totalEur: GASTAPP_CANONICAL_V2_EXPECTED.totalEur,
  periods: Array.from({ length: 39 }, (_, index) => ({
    periodKeyOriginal: `P${index + 1}`,
    periodNumber: index + 1,
    periodStartYmd: '2023-05-12',
    periodEndYmd: '2023-06-11',
    rowCount: 1,
    totalEur: 1,
    byFamily: {},
    byCategory: {},
    byProject: {},
    control: null,
  })),
  examplePayload: {},
});

const monthContract = () => ({
  contractId: GASTAPP_CANONICAL_V2_EXPECTED.monthsContractId,
  version: GASTAPP_CANONICAL_V2_EXPECTED.monthsContractVersion,
  generatedAt: '2026-08-15T01:35:21.024Z',
  sourceSystem: 'GastApp',
  canonicalDataHash: GASTAPP_CANONICAL_V2_EXPECTED.canonicalDataHash,
  axis: GASTAPP_CANONICAL_V2_EXPECTED.monthsAxis,
  dateSemantics: 'Calendar month follows the transaction date',
  coverage: {
    completeFromMonthKey: GASTAPP_CANONICAL_V2_EXPECTED.completeFromMonthKey,
    completeThroughMonthKey: GASTAPP_CANONICAL_V2_EXPECTED.completeThroughMonthKey,
    partialBoundaryMonths: [...GASTAPP_CANONICAL_V2_EXPECTED.partialBoundaryMonths],
  },
  rowCount: GASTAPP_CANONICAL_V2_EXPECTED.canonicalRows,
  totalEur: GASTAPP_CANONICAL_V2_EXPECTED.totalEur,
  months: [
    { calendarMonthKey: '2023-05', status: 'pending', calendarStatus: 'partial_boundary_start', eligibleForAurumReturns: false, coverage: { fromYmd: '2023-05-12', toYmd: '2023-05-31' }, rowCount: 1, totalEur: 1, byFamily: {}, byCategory: {}, byProject: {} },
    ...Array.from({ length: 38 }, (_, index) => {
      const date = new Date(Date.UTC(2023, 5 + index, 1));
      return { calendarMonthKey: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, status: 'complete', calendarStatus: 'complete', eligibleForAurumReturns: true, coverage: { fromYmd: null, toYmd: null }, rowCount: 1, totalEur: 1, byFamily: {}, byCategory: {}, byProject: {} };
    }),
    { calendarMonthKey: '2026-08', status: 'pending', calendarStatus: 'partial_boundary_end', eligibleForAurumReturns: false, coverage: { fromYmd: '2026-08-01', toYmd: '2026-08-11' }, rowCount: 1, totalEur: 1, byFamily: {}, byCategory: {}, byProject: {} },
  ],
  examplePayload: {},
});

const contractReader = () => {
  const docs: Record<string, Record<string, unknown>> = {
    [GASTAPP_CANONICAL_V2_CURRENT_PATH]: metadata(),
    [GASTAPP_AURUM_PERIODS_V2_PATH]: periodContract(),
    [GASTAPP_AURUM_MONTHS_V2_PATH]: monthContract(),
  };
  const readDocument = vi.fn(async (path: string) => docs[path] || null);
  const sha256 = vi.fn(async (bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes);
    if (text.includes(GASTAPP_CANONICAL_V2_EXPECTED.periodsContractId)) return GASTAPP_CANONICAL_V2_EXPECTED.periodsContractHash;
    if (text.includes(GASTAPP_CANONICAL_V2_EXPECTED.monthsContractId)) return GASTAPP_CANONICAL_V2_EXPECTED.monthsContractHash;
    return 'sha256:unused';
  });
  return { docs, readDocument, sha256 };
};

const cloneSharedFixture = () => structuredClone(sharedGastappFixture);

const sharedFixtureSha256 = vi.fn(async (bytes: Uint8Array) => {
  const content = new TextDecoder().decode(bytes);
  if (content === 'gastapp-express-fixture-v2') {
    return 'sha256:82169a0b80fc6b7c5dd5f21cc1c4d595029df51ccf91d2104384c1077dd72084';
  }
  if (content === 'gastapp-full-fixture-v2') {
    return 'sha256:f7079881adcfeb3f17bb176badaa09d4a1a1eef0a3252e9a067927e06b1fb9e9';
  }
  return 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
});

const sharedFixtureReader = (
  fixture: Record<string, Record<string, unknown>> = cloneSharedFixture(),
  fullWindowOpen = true,
) => vi.fn(async (path: string) => {
  const paths = fixture.paths;
  const documents: Record<string, Record<string, unknown>> = {
    [paths.metadata as unknown as string]: fixture.metadata,
    [paths.periods as unknown as string]: fixture.periods_current,
    [paths.months as unknown as string]: fixture.months_current,
    [paths.pointer as unknown as string]: fixture.pointer,
    [paths.express as unknown as string]: fixture.express_current,
    [paths.full as unknown as string]: fixture.full_current,
  };
  if (path === paths.full && !fullWindowOpen) {
    throw new GastappCanonicalV2Error('permission_denied', 'La ventana Full de 30 minutos está cerrada.', path);
  }
  return documents[path] ? structuredClone(documents[path]) : null;
});

describe('GastApp Canónico V2', () => {
  beforeEach(() => vi.resetModules());

  it('lee metadata y los dos contratos como documentos individuales, sin consultas de colección', async () => {
    const fixture = contractReader();
    const result = await loadGastappCanonicalV2Contracts(fixture);

    expect(result.metadata.canonicalDataHash).toBe(GASTAPP_CANONICAL_V2_EXPECTED.canonicalDataHash);
    expect(result.periods.periods).toHaveLength(39);
    expect(result.months.months).toHaveLength(40);
    expect(fixture.readDocument).toHaveBeenCalledTimes(3);
    expect(fixture.readDocument).toHaveBeenCalledWith(GASTAPP_CANONICAL_V2_CURRENT_PATH);
    expect(fixture.readDocument).toHaveBeenCalledWith(GASTAPP_AURUM_PERIODS_V2_PATH);
    expect(fixture.readDocument).toHaveBeenCalledWith(GASTAPP_AURUM_MONTHS_V2_PATH);
  });

  it('acepta una nueva publicación coherente sin fijar el hash ni los totales del snapshot anterior', async () => {
    const fixture = contractReader();
    const nextHash = `sha256:${'c'.repeat(64)}`;
    const nextTotal = GASTAPP_CANONICAL_V2_EXPECTED.totalEur + 25;
    const nextRows = GASTAPP_CANONICAL_V2_EXPECTED.canonicalRows + 1;
    const nextMetadata = fixture.docs[GASTAPP_CANONICAL_V2_CURRENT_PATH];
    nextMetadata.canonicalDataHash = nextHash;
    (nextMetadata.counts as Record<string, unknown>).canonicalRows = nextRows;
    (nextMetadata.totalsEur as Record<string, unknown>).exact = nextTotal;
    const nextPeriods = fixture.docs[GASTAPP_AURUM_PERIODS_V2_PATH];
    nextPeriods.canonicalDataHash = nextHash;
    nextPeriods.rowCount = nextRows;
    nextPeriods.totalEur = nextTotal;
    ((nextPeriods.periods as Array<Record<string, unknown>>)[0]).rowCount = 2;
    ((nextPeriods.periods as Array<Record<string, unknown>>)[0]).totalEur = 2;
    const nextMonths = fixture.docs[GASTAPP_AURUM_MONTHS_V2_PATH];
    nextMonths.canonicalDataHash = nextHash;
    nextMonths.rowCount = nextRows;
    nextMonths.totalEur = nextTotal;
    ((nextMonths.months as Array<Record<string, unknown>>)[0]).rowCount = 2;
    ((nextMonths.months as Array<Record<string, unknown>>)[0]).totalEur = 2;

    const result = await loadGastappCanonicalV2Contracts(fixture);

    expect(result.metadata.canonicalDataHash).toBe(nextHash);
    expect(result.metadata.counts.canonicalRows).toBe(nextRows);
    expect(result.metadata.totalsEur.exact).toBe(nextTotal);
  });

  it('rechaza que el contrato de períodos mezcle el eje calendarMonthKey', async () => {
    const fixture = contractReader();
    (fixture.docs[GASTAPP_AURUM_PERIODS_V2_PATH].periods as Array<Record<string, unknown>>)[0].calendarMonthKey = '2026-01';

    await expect(loadGastappCanonicalV2Contracts(fixture)).rejects.toMatchObject({
      code: 'invalid_document',
      path: GASTAPP_AURUM_PERIODS_V2_PATH,
    });
  });

  it('lee puntero y un único artefacto, convierte zipBytes y verifica tamaño/hash antes de devolver Blob', async () => {
    const bytes = new Uint8Array(GASTAPP_CANONICAL_V2_EXPECTED.expressBytes);
    const readDocument = vi.fn(async (path: string) => {
      if (path === GASTAPP_DATA_ROOM_V2_POINTER_PATH) {
        return {
          pointerVersion: 'gastapp-data-room-pointer-v2',
          storageBackend: 'firestore_blob',
          canonicalDataHash: GASTAPP_CANONICAL_V2_EXPECTED.canonicalDataHash,
          operationalDataHash: `sha256:${'c'.repeat(64)}`,
          operationalRevision: 7,
          fullSnapshotHash: GASTAPP_CANONICAL_V2_EXPECTED.fullHash,
          fullSnapshotOperationalDataHash: `sha256:${'d'.repeat(64)}`,
          fullSnapshotGeneratedAt: '2026-08-01T00:00:00.000Z',
          fullSnapshotStale: true,
          express: { document: GASTAPP_DATA_ROOM_V2_EXPRESS_PATH, hash: GASTAPP_CANONICAL_V2_EXPECTED.expressHash, bytes: bytes.byteLength, mediaType: 'application/zip' },
          full: { document: 'gastapp_data_room_v2_artifacts/full_current', hash: GASTAPP_CANONICAL_V2_EXPECTED.fullHash, bytes: GASTAPP_CANONICAL_V2_EXPECTED.fullBytes, mediaType: 'application/zip', generatedAt: '2026-08-01T00:00:00.000Z', operationalDataHash: `sha256:${'d'.repeat(64)}`, operationalRevision: 6, staleAgainstOperationalHash: true },
        };
      }
      if (path === GASTAPP_DATA_ROOM_V2_EXPRESS_PATH) {
        return {
          artifactVersion: GASTAPP_DATA_ROOM_V2_EXPRESS_ARTIFACT_VERSION,
          mode: 'express',
          canonicalDataHash: GASTAPP_CANONICAL_V2_EXPECTED.canonicalDataHash,
          hash: GASTAPP_CANONICAL_V2_EXPECTED.expressHash,
          mediaType: 'application/zip',
          byteLength: bytes.byteLength,
          zipBytes: { toUint8Array: () => bytes },
        };
      }
      return null;
    });
    const sha256 = vi.fn(async () => GASTAPP_CANONICAL_V2_EXPECTED.expressHash);

    const result = await loadGastappDataRoomV2Artifact('express', { readDocument, sha256 });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('application/zip');
    expect(result.byteLength).toBe(GASTAPP_CANONICAL_V2_EXPECTED.expressBytes);
    expect(result.sha256).toBe(GASTAPP_CANONICAL_V2_EXPECTED.expressHash);
    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(readDocument).toHaveBeenNthCalledWith(1, GASTAPP_DATA_ROOM_V2_POINTER_PATH);
    expect(readDocument).toHaveBeenNthCalledWith(2, GASTAPP_DATA_ROOM_V2_EXPRESS_PATH);
  });

  it('acepta el fixture compartido exacto de GastApp: Full stale, número[] local y secuencia puntero → Blob', async () => {
    const readDocument = sharedFixtureReader();
    const result = await loadGastappDataRoomV2Artifact('full', {
      readDocument,
      sha256: sharedFixtureSha256,
      allowFixtureByteArray: true,
    });

    expect(result.blob.type).toBe('application/zip');
    expect(result.byteLength).toBe(23);
    expect(result.sha256).toBe('sha256:f7079881adcfeb3f17bb176badaa09d4a1a1eef0a3252e9a067927e06b1fb9e9');
    expect(result.fullFreshness).toMatchObject({
      generatedAt: '2026-08-01T00:00:00.000Z',
      isStale: true,
      snapshotOperationalDataHash: `sha256:${'d'.repeat(64)}`,
      currentOperationalDataHash: `sha256:${'c'.repeat(64)}`,
      snapshotOperationalRevision: 6,
      currentOperationalRevision: 7,
    });
    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(readDocument).toHaveBeenNthCalledWith(1, GASTAPP_DATA_ROOM_V2_POINTER_PATH);
    expect(readDocument).toHaveBeenNthCalledWith(2, GASTAPP_DATA_ROOM_V2_FULL_PATH);
  });

  it('exige que metadata y puntero sean coherentes sobre la frescura de Full', async () => {
    const fixture = cloneSharedFixture();
    const contractReader = sharedFixtureReader(fixture);
    const contracts = await loadGastappCanonicalV2Contracts({
      readDocument: contractReader,
      sha256: vi.fn(async () => `sha256:${'f'.repeat(64)}`),
    });
    const pointer = await loadGastappDataRoomV2Pointer({
      readDocument: sharedFixtureReader(fixture),
      expectedCanonicalDataHash: contracts.metadata.canonicalDataHash,
    });

    expect(validateGastappDataRoomV2FreshnessAgainstMetadata(contracts.metadata, pointer)).toEqual(pointer.fullFreshness);

    fixture.metadata.fullSnapshotStale = false;
    const mismatchedContracts = await loadGastappCanonicalV2Contracts({
      readDocument: sharedFixtureReader(fixture),
      sha256: vi.fn(async () => `sha256:${'f'.repeat(64)}`),
    });
    try {
      validateGastappDataRoomV2FreshnessAgainstMetadata(mismatchedContracts.metadata, pointer);
      throw new Error('Se esperaba rechazar metadata y puntero inconsistentes.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'artifact_pointer_invalid',
        path: GASTAPP_DATA_ROOM_V2_POINTER_PATH,
      });
    }
  });

  it('acepta un Full fresco cuando puntero y metadata declaran el mismo estado operacional', async () => {
    const fixture = cloneSharedFixture();
    const snapshotOperationalHash = (fixture.pointer.fullSnapshotOperationalDataHash as string);
    fixture.pointer.operationalDataHash = snapshotOperationalHash;
    fixture.pointer.operationalRevision = 6;
    fixture.pointer.fullSnapshotStale = false;
    (fixture.pointer.full as Record<string, unknown>).staleAgainstOperationalHash = false;
    fixture.metadata.operationalDataHash = snapshotOperationalHash;
    fixture.metadata.operationalRevision = 6;
    fixture.metadata.fullSnapshotStale = false;
    const result = await loadGastappDataRoomV2Artifact('full', {
      readDocument: sharedFixtureReader(fixture),
      sha256: sharedFixtureSha256,
      allowFixtureByteArray: true,
    });

    expect(result.fullFreshness).toMatchObject({
      isStale: false,
      snapshotOperationalDataHash: snapshotOperationalHash,
      currentOperationalDataHash: snapshotOperationalHash,
      snapshotOperationalRevision: 6,
      currentOperationalRevision: 6,
    });
  });

  it('rechaza Full si falta cualquier campo contractual obligatorio', async () => {
    const requiredFields = [
      'artifactVersion',
      'canonicalDataHash',
      'generatedAt',
      'operationalDataHash',
      'fullSnapshotHash',
      'fullSnapshotOperationalDataHash',
      'fullSnapshotOperationalRevision',
      'fullSnapshotGeneratedAt',
      'fullSnapshotStale',
      'hash',
      'byteLength',
      'mediaType',
      'zipBytes',
    ];

    for (const field of requiredFields) {
      const fixture = cloneSharedFixture();
      delete fixture.full_current[field];
      await expect(loadGastappDataRoomV2Artifact('full', {
        readDocument: sharedFixtureReader(fixture),
        sha256: sharedFixtureSha256,
        allowFixtureByteArray: true,
      }), `campo ausente: ${field}`).rejects.toBeInstanceOf(GastappCanonicalV2Error);
    }
  });

  it('acepta Firestore Bytes en runtime y número[] solamente para fixtures locales autorizados', async () => {
    const pointer = createSanitizedDataRoomPointer();
    const runtimeReader = vi.fn(async (path: string) => {
      if (path === GASTAPP_DATA_ROOM_V2_POINTER_PATH) return pointer;
      if (path === GASTAPP_DATA_ROOM_V2_FULL_PATH) return createSanitizedDataRoomArtifact('full');
      return null;
    });
    await expect(loadGastappDataRoomV2Artifact('full', {
      readDocument: runtimeReader,
      sha256: vi.fn(async () => SANITIZED_FULL_HASH),
    })).resolves.toMatchObject({ mode: 'full' });

    const localReader = sharedFixtureReader();
    await expect(loadGastappDataRoomV2Artifact('full', {
      readDocument: localReader,
      sha256: sharedFixtureSha256,
    })).rejects.toMatchObject({ code: 'artifact_bytes_missing' });
  });

  it('no modifica retornos mensuales al descargar Full ni al marcar su snapshot como stale', async () => {
    const monthlyRows = [{
      monthKey: '2026-02',
      netDisplay: 100,
      prevNetDisplay: 90,
      varPatrimonioDisplay: 10,
      gastosDisplay: 5,
      retornoRealDisplay: 15,
      pct: 16.67,
      pctReal: 16.67,
      varPatrimonioClp: 10,
      gastosClp: 5,
      retornoRealClp: 15,
      netClp: 100,
      prevNetClp: 90,
      invalidNet: false,
    }] as unknown as MonthlyReturnRow[];
    const before = buildCalendarReturnsPresentation(monthlyRows);

    await loadGastappDataRoomV2Artifact('full', {
      readDocument: sharedFixtureReader(),
      sha256: sharedFixtureSha256,
      allowFixtureByteArray: true,
    });

    expect(buildCalendarReturnsPresentation(monthlyRows)).toEqual(before);
  });

  it('acepta sólo la versión propia de cada modo y rechaza versiones cruzadas', async () => {
    const loadSanitized = async (requestedMode: 'express' | 'full', publishedMode: 'express' | 'full') => {
      const pointer = createSanitizedDataRoomPointer();
      const requestedPointer = pointer[requestedMode];
      const requestedBytes = requestedMode === 'express' ? SANITIZED_EXPRESS_ZIP_BYTES : SANITIZED_FULL_ZIP_BYTES;
      const readDocument = vi.fn(async (path: string) => {
        if (path === GASTAPP_DATA_ROOM_V2_POINTER_PATH) return pointer;
        if (path === requestedPointer.document) {
          return createSanitizedDataRoomArtifact(publishedMode, {
            mode: requestedMode,
            canonicalDataHash: SANITIZED_DATA_ROOM_CANONICAL_HASH,
            hash: requestedPointer.hash,
            byteLength: requestedPointer.bytes,
            zipBytes: asFirestoreBytes(requestedBytes),
          });
        }
        return null;
      });
      return loadGastappDataRoomV2Artifact(requestedMode, {
        readDocument,
        sha256: vi.fn(async () => requestedPointer.hash),
      });
    };

    await expect(loadSanitized('express', 'express')).resolves.toMatchObject({ mode: 'express', byteLength: SANITIZED_EXPRESS_ZIP_BYTES.byteLength });
    await expect(loadSanitized('full', 'full')).resolves.toMatchObject({ mode: 'full', byteLength: SANITIZED_FULL_ZIP_BYTES.byteLength });
    await expect(loadSanitized('express', 'full')).rejects.toMatchObject({
      code: 'artifact_pointer_invalid',
      path: GASTAPP_DATA_ROOM_V2_EXPRESS_PATH,
    });
    await expect(loadSanitized('full', 'express')).rejects.toMatchObject({
      code: 'artifact_pointer_invalid',
      path: GASTAPP_DATA_ROOM_V2_FULL_PATH,
    });
  });

  it('mantiene obligatorios los rechazos por hash, tamaño y MIME incorrectos', async () => {
    const loadSanitizedWith = async (overrides: Record<string, unknown>, calculatedHash = SANITIZED_EXPRESS_HASH) => {
      const pointer = createSanitizedDataRoomPointer();
      const readDocument = vi.fn(async (path: string) => {
        if (path === GASTAPP_DATA_ROOM_V2_POINTER_PATH) return pointer;
        if (path === GASTAPP_DATA_ROOM_V2_EXPRESS_PATH) return createSanitizedDataRoomArtifact('express', overrides);
        return null;
      });
      return loadGastappDataRoomV2Artifact('express', {
        readDocument,
        sha256: vi.fn(async () => calculatedHash),
      });
    };

    await expect(loadSanitizedWith({ hash: `sha256:${'d'.repeat(64)}` })).rejects.toMatchObject({ code: 'artifact_hash_mismatch' });
    await expect(loadSanitizedWith({ byteLength: SANITIZED_EXPRESS_ZIP_BYTES.byteLength + 1 })).rejects.toMatchObject({ code: 'artifact_size_mismatch' });
    await expect(loadSanitizedWith({ mediaType: 'application/octet-stream' })).rejects.toMatchObject({ code: 'artifact_pointer_invalid' });
  });

  it('mantiene Express y la serie mensual disponibles cuando la ventana Full de 30 minutos está cerrada', async () => {
    const readDocument = sharedFixtureReader(cloneSharedFixture(), false);

    await expect(loadGastappDataRoomV2Artifact('express', {
      readDocument,
      sha256: sharedFixtureSha256,
      allowFixtureByteArray: true,
    })).resolves.toMatchObject({ mode: 'express', byteLength: 26 });

    await expect(loadGastappDataRoomV2Artifact('full', {
      readDocument,
      sha256: sharedFixtureSha256,
      allowFixtureByteArray: true,
    })).rejects.toMatchObject({ code: 'permission_denied', path: GASTAPP_DATA_ROOM_V2_FULL_PATH });

    const monthlyReader = sharedFixtureReader(cloneSharedFixture(), false);
    await expect(loadGastappCanonicalV2MonthContract({
      readDocument: monthlyReader,
      sha256: vi.fn(async () => `sha256:${'f'.repeat(64)}`),
    })).resolves.toMatchObject({ months: { axis: 'calendarMonthKey' } });
    expect(monthlyReader).toHaveBeenCalledWith(GASTAPP_CANONICAL_V2_CURRENT_PATH);
    expect(monthlyReader).toHaveBeenCalledWith(GASTAPP_AURUM_MONTHS_V2_PATH);
    expect(monthlyReader).not.toHaveBeenCalledWith(GASTAPP_AURUM_PERIODS_V2_PATH);
    expect(monthlyReader).not.toHaveBeenCalledWith(GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  });

  it('rechaza un ZIP cuyo tamaño real no coincide, sin ofrecer Blob', async () => {
    const pointer = createSanitizedDataRoomPointer();
    const readDocument = vi.fn(async (path: string) => {
      if (path === GASTAPP_DATA_ROOM_V2_POINTER_PATH) return pointer;
      if (path === GASTAPP_DATA_ROOM_V2_EXPRESS_PATH) {
        return createSanitizedDataRoomArtifact('express', {
          zipBytes: asFirestoreBytes(new Uint8Array([1])),
        });
      }
      return null;
    });

    await expect(loadGastappDataRoomV2Artifact('express', { readDocument, sha256: vi.fn(async () => SANITIZED_EXPRESS_HASH) })).rejects.toBeInstanceOf(GastappCanonicalV2Error);
    await expect(loadGastappDataRoomV2Artifact('express', { readDocument, sha256: vi.fn(async () => SANITIZED_EXPRESS_HASH) })).rejects.toMatchObject({ code: 'artifact_size_mismatch' });
  });
});
