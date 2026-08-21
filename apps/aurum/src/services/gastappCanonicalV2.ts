import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { getGastappConfiguredProjectId, getGastappFirestore, isGastappFirestoreConfigured } from './firebase';

export const GASTAPP_CANONICAL_V2_PROJECT_ID = 'duofin-c1894';
export const GASTAPP_CANONICAL_V2_CURRENT_PATH = 'gastapp_canonical_v2/current';
export const GASTAPP_AURUM_PERIODS_V2_PATH = 'gastapp_aurum_contracts_v2/periods_current';
export const GASTAPP_AURUM_MONTHS_V2_PATH = 'gastapp_aurum_contracts_v2/months_current';
export const GASTAPP_DATA_ROOM_V2_POINTER_PATH = 'gastapp_data_room_v2_pointers/current';
export const GASTAPP_DATA_ROOM_V2_EXPRESS_PATH = 'gastapp_data_room_v2_artifacts/express_current';
export const GASTAPP_DATA_ROOM_V2_FULL_PATH = 'gastapp_data_room_v2_artifacts/full_current';
export const GASTAPP_DATA_ROOM_V2_EXPRESS_ARTIFACT_VERSION = 'gastapp-data-room-express-v2';
export const GASTAPP_DATA_ROOM_V2_FULL_ARTIFACT_VERSION = 'gastapp-data-room-artifact-v2';
// GastApp publica totales operativos y contratos mensuales con redondeos
// independientes. Aurum acepta hasta un euro de diferencia, pero no más:
// una discrepancia mayor sigue bloqueando el consumo oficial.
export const GASTAPP_CANONICAL_V2_RECONCILIATION_TOLERANCE_EUR = 1;

// Stable schema identities. The canonical hash, totals, counts and artifact
// hashes are publication data and must always be read from current documents.
export const GASTAPP_CANONICAL_V2_CONTRACT = Object.freeze({
  packageVersion: 'gastapp-canonical-calendar-offline-v2',
  pointerVersion: 'gastapp-canonical-pointer-v2',
  qualityStatus: 'validated',
  periodsContractVersion: 'gastapp-aurum-periods-v2',
  periodsContractId: 'gastapp_to_aurum_periods',
  periodsAxis: 'periodKeyOriginal',
  monthsContractVersion: 'gastapp-aurum-calendar-months-v2',
  monthsContractId: 'gastapp_to_aurum_calendar_months',
  monthsAxis: 'calendarMonthKey',
});

export type GastappCanonicalV2ReadCode =
  | 'missing_config'
  | 'wrong_project'
  | 'unavailable'
  | 'permission_denied'
  | 'missing_document'
  | 'invalid_document'
  | 'canonical_hash_mismatch'
  | 'contract_hash_mismatch'
  | 'artifact_pointer_invalid'
  | 'artifact_missing'
  | 'artifact_bytes_missing'
  | 'artifact_size_mismatch'
  | 'artifact_hash_mismatch';

export class GastappCanonicalV2Error extends Error {
  readonly code: GastappCanonicalV2ReadCode;
  readonly path: string | null;

  constructor(code: GastappCanonicalV2ReadCode, message: string, path: string | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GastappCanonicalV2Error';
    this.code = code;
    this.path = path;
  }
}

type RecordValue = Record<string, unknown>;
type DocumentReader = (path: string) => Promise<RecordValue | null>;
type Sha256 = (bytes: Uint8Array) => Promise<string>;

export type GastappCanonicalV2Aggregate = {
  key: string;
  label: string;
  rowCount: number;
  totalEur: number;
};

export type GastappCanonicalV2Period = {
  periodKeyOriginal: string;
  periodNumber: number;
  periodStartYmd: string;
  periodEndYmd: string;
  rowCount: number;
  totalEur: number;
  byFamily: Record<string, number>;
  byCategory: Record<string, GastappCanonicalV2Aggregate>;
  byProject: Record<string, GastappCanonicalV2Aggregate>;
  raw: RecordValue;
};

export type GastappCanonicalV2Month = {
  calendarMonthKey: string;
  status: string;
  calendarStatus: string;
  eligibleForAurumReturns: boolean;
  fromYmd: string | null;
  toYmd: string | null;
  rowCount: number;
  totalEur: number;
  byFamily: Record<string, number>;
  byCategory: Record<string, GastappCanonicalV2Aggregate>;
  byProject: Record<string, GastappCanonicalV2Aggregate>;
  raw: RecordValue;
};

export type GastappCanonicalV2Metadata = {
  pointerVersion: string;
  packageVersion: string;
  canonicalDataHash: string;
  operationalDataHash: string | null;
  operationalRevision: number | null;
  fullSnapshotHash: string | null;
  fullSnapshotOperationalDataHash: string | null;
  fullSnapshotOperationalRevision: number | null;
  fullSnapshotGeneratedAt: string | null;
  fullSnapshotStale: boolean | null;
  qualityStatus: string;
  generatedAt: string | null;
  coverage: {
    completeFromMonthKey: string | null;
    completeThroughMonthKey: string | null;
    partialBoundaryMonths: string[];
  };
  counts: {
    canonicalRows: number | null;
    periods: number | null;
    acceptedPeriods: number | null;
    months: number | null;
  };
  totalsEur: {
    exact: number | null;
    dayToDay: number | null;
    trips: number | null;
    others: number | null;
    calendarMinusCanonical: number | null;
  };
  raw: RecordValue;
};

export type GastappCanonicalV2PeriodContract = {
  contractId: string;
  version: string;
  axis: string;
  canonicalDataHash: string;
  generatedAt: string | null;
  rowCount: number;
  totalEur: number;
  periods: GastappCanonicalV2Period[];
  contractHash: string;
  raw: RecordValue;
};

export type GastappCanonicalV2MonthContract = {
  contractId: string;
  version: string;
  axis: string;
  canonicalDataHash: string;
  generatedAt: string | null;
  rowCount: number;
  totalEur: number;
  coverage: GastappCanonicalV2Metadata['coverage'];
  months: GastappCanonicalV2Month[];
  contractHash: string;
  raw: RecordValue;
};

export type GastappCanonicalV2Contracts = {
  metadata: GastappCanonicalV2Metadata;
  periods: GastappCanonicalV2PeriodContract;
  months: GastappCanonicalV2MonthContract;
  readPaths: readonly [
    typeof GASTAPP_CANONICAL_V2_CURRENT_PATH,
    typeof GASTAPP_AURUM_PERIODS_V2_PATH,
    typeof GASTAPP_AURUM_MONTHS_V2_PATH,
  ];
};

export type GastappDataRoomV2ArtifactMode = 'express' | 'full';

export type GastappDataRoomV2ArtifactPointer = {
  document: string;
  hash: string;
  bytes: number;
  mediaType: 'application/zip';
  generatedAt: string | null;
  operationalDataHash: string | null;
  operationalRevision: number | null;
  staleAgainstOperationalHash: boolean | null;
};

export type GastappDataRoomV2FullFreshness = {
  generatedAt: string;
  isStale: boolean;
  snapshotOperationalDataHash: string;
  currentOperationalDataHash: string;
  snapshotOperationalRevision: number;
  currentOperationalRevision: number;
};

export type GastappDataRoomV2Pointer = {
  pointerVersion: string;
  storageBackend: string;
  canonicalDataHash: string;
  operationalDataHash: string;
  operationalRevision: number;
  fullSnapshotHash: string | null;
  fullSnapshotOperationalDataHash: string | null;
  fullSnapshotOperationalRevision: number | null;
  fullSnapshotGeneratedAt: string | null;
  fullSnapshotStale: boolean | null;
  express: GastappDataRoomV2ArtifactPointer;
  full: GastappDataRoomV2ArtifactPointer | null;
  fullFreshness: GastappDataRoomV2FullFreshness | null;
  raw: RecordValue;
};

export type GastappDataRoomV2VerifiedArtifact = {
  mode: GastappDataRoomV2ArtifactMode;
  filename: string;
  blob: Blob;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  canonicalDataHash: string;
  pointerPath: typeof GASTAPP_DATA_ROOM_V2_POINTER_PATH;
  artifactPath: string;
  fullFreshness: GastappDataRoomV2FullFreshness | null;
};

export type GastappCanonicalV2Dependencies = {
  readDocument?: DocumentReader;
  sha256?: Sha256;
  expectedCanonicalDataHash?: string;
  allowFixtureByteArray?: boolean;
};

/**
 * The monthly close consumes this narrow, public contract only.  It is kept
 * separate from the broader V2 reader because periods and Data Room remain
 * useful for their own audit/export paths but are never a monthly fallback.
 */
export type GastappCanonicalV2OfficialMonthCertification = {
  status: 'certified' | 'revised';
  certificationRevision: number;
  certificationHash: string;
  monthContractRevision: number;
  monthContractHash: string;
  sourceGeneration: number;
  operationalRevision: number;
  canonicalDataHash: string;
};

export type GastappCanonicalV2OfficialMonth = {
  calendarMonthKey: string;
  status: 'complete' | 'pending';
  calendarStatus: string;
  eligibleForAurumReturns: boolean;
  coverage: { fromYmd: string; toYmd: string };
  totalEur: number;
  byFamily: { dayToDay: number; trips: number; others: number };
  monthContractRevision: number;
  monthContractHash: string;
  calendarCertification: GastappCanonicalV2OfficialMonthCertification | null;
};

export type GastappCanonicalV2OfficialMonthContract = {
  canonicalDataHash: string;
  operationalDataHash: string;
  operationalRevision: number;
  sourceGeneration: number | null;
  generatedAt: string;
  version: string;
  months: GastappCanonicalV2OfficialMonth[];
};

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const readRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(readString).filter((item): item is string => Boolean(item))
    : [];

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const totalsAgreeWithinTolerance = (candidate: number | null, expected: number | null) =>
  candidate != null &&
  expected != null &&
  Math.abs(Math.round((candidate - expected) * 100) / 100) <= GASTAPP_CANONICAL_V2_RECONCILIATION_TOLERANCE_EUR;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as RecordValue;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

const defaultSha256: Sha256 = async (bytes) => {
  if (!globalThis.crypto?.subtle) {
    throw new GastappCanonicalV2Error('unavailable', 'El navegador no expone Web Crypto para verificar SHA-256.');
  }
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput.buffer);
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
};

const hashDocument = async (value: RecordValue, sha256: Sha256) =>
  sha256(new TextEncoder().encode(stableStringify(value)));

const defaultReadDocument: DocumentReader = async (path) => {
  if (!isGastappFirestoreConfigured()) {
    throw new GastappCanonicalV2Error('missing_config', 'Falta configurar el Firebase de GastApp.', path);
  }
  const configuredProjectId = getGastappConfiguredProjectId();
  if (configuredProjectId !== GASTAPP_CANONICAL_V2_PROJECT_ID) {
    throw new GastappCanonicalV2Error(
      'wrong_project',
      `El Firebase configurado para GastApp es ${configuredProjectId || 'desconocido'}; se esperaba ${GASTAPP_CANONICAL_V2_PROJECT_ID}.`,
      path,
    );
  }
  const db = getGastappFirestore();
  if (!db) throw new GastappCanonicalV2Error('unavailable', 'Firestore de GastApp no está disponible.', path);
  try {
    const snapshot = await getDoc(doc(db, path));
    return snapshot.exists() ? (snapshot.data() as RecordValue) : null;
  } catch (error: any) {
    const code = String(error?.code || '');
    if (code === 'permission-denied' || code.endsWith('/permission-denied')) {
      throw new GastappCanonicalV2Error(
        'permission_denied',
        'La sesión autorizada de GastApp no tiene permiso de lectura para este documento.',
        path,
        { cause: error },
      );
    }
    throw new GastappCanonicalV2Error('unavailable', String(error?.message || error || 'No se pudo leer GastApp.'), path, { cause: error });
  }
};

const serverReadDocument: DocumentReader = async (path) => {
  if (!isGastappFirestoreConfigured()) {
    throw new GastappCanonicalV2Error('missing_config', 'Falta configurar el Firebase de GastApp.', path);
  }
  const configuredProjectId = getGastappConfiguredProjectId();
  if (configuredProjectId !== GASTAPP_CANONICAL_V2_PROJECT_ID) {
    throw new GastappCanonicalV2Error('wrong_project', `El Firebase configurado para GastApp es ${configuredProjectId || 'desconocido'}; se esperaba ${GASTAPP_CANONICAL_V2_PROJECT_ID}.`, path);
  }
  const db = getGastappFirestore();
  if (!db) throw new GastappCanonicalV2Error('unavailable', 'Firestore de GastApp no está disponible.', path);
  try {
    const snapshot = await getDocFromServer(doc(db, path));
    return snapshot.exists() ? (snapshot.data() as RecordValue) : null;
  } catch (error: any) {
    const code = String(error?.code || '');
    if (code === 'permission-denied' || code.endsWith('/permission-denied')) {
      throw new GastappCanonicalV2Error('permission_denied', 'La sesión autorizada de GastApp no tiene permiso de lectura para este documento.', path, { cause: error });
    }
    throw new GastappCanonicalV2Error('unavailable', String(error?.message || error || 'No se pudo leer GastApp desde servidor.'), path, { cause: error });
  }
};

const readRequiredDocument = async (readDocument: DocumentReader, path: string) => {
  const raw = await readDocument(path);
  if (!raw) throw new GastappCanonicalV2Error('missing_document', `No existe el documento ${path}.`, path);
  return raw;
};

const assertExpected = (condition: boolean, code: GastappCanonicalV2ReadCode, message: string, path: string) => {
  if (!condition) throw new GastappCanonicalV2Error(code, message, path);
};

const normalizeAggregateMap = (value: unknown): Record<string, GastappCanonicalV2Aggregate> => {
  const source = readRecord(value);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => {
    const aggregate = readRecord(item);
    return [key, {
      key: readString(aggregate.key) || key,
      label: readString(aggregate.label) || key,
      rowCount: readNumber(aggregate.rowCount) || 0,
      totalEur: readNumber(aggregate.totalEur) || 0,
    }];
  }));
};

const normalizeNumberMap = (value: unknown): Record<string, number> => {
  const source = readRecord(value);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, readNumber(item) || 0]));
};

const normalizeCanonicalMetadata = (raw: RecordValue): GastappCanonicalV2Metadata => {
  const coverage = readRecord(raw.coverage);
  const counts = readRecord(raw.counts);
  const totals = readRecord(raw.totalsEur);
  return {
    pointerVersion: readString(raw.pointerVersion) || '',
    packageVersion: readString(raw.packageVersion) || '',
    canonicalDataHash: readString(raw.canonicalDataHash) || '',
    operationalDataHash: readString(raw.operationalDataHash),
    operationalRevision: readNumber(raw.operationalRevision),
    fullSnapshotHash: readString(raw.fullSnapshotHash),
    fullSnapshotOperationalDataHash: readString(raw.fullSnapshotOperationalDataHash),
    fullSnapshotOperationalRevision: readNumber(raw.fullSnapshotOperationalRevision),
    fullSnapshotGeneratedAt: readString(raw.fullSnapshotGeneratedAt),
    fullSnapshotStale: readBoolean(raw.fullSnapshotStale),
    qualityStatus: readString(raw.qualityStatus) || '',
    generatedAt: readString(raw.generatedAt),
    coverage: {
      completeFromMonthKey: readString(coverage.completeFromMonthKey),
      completeThroughMonthKey: readString(coverage.completeThroughMonthKey),
      partialBoundaryMonths: readStringArray(coverage.partialBoundaryMonths),
    },
    counts: {
      canonicalRows: readNumber(counts.canonicalRows),
      periods: readNumber(counts.periods),
      acceptedPeriods: readNumber(counts.acceptedPeriods),
      months: readNumber(counts.months),
    },
    totalsEur: {
      exact: readNumber(totals.exact),
      dayToDay: readNumber(totals.dayToDay),
      trips: readNumber(totals.trips),
      others: readNumber(totals.others),
      calendarMinusCanonical: readNumber(totals.calendarMinusCanonical),
    },
    raw,
  };
};

const validateCanonicalMetadata = (raw: RecordValue): GastappCanonicalV2Metadata => {
  const metadata = normalizeCanonicalMetadata(raw);
  assertExpected(metadata.pointerVersion === GASTAPP_CANONICAL_V2_CONTRACT.pointerVersion, 'invalid_document', 'pointerVersion canónico inesperado.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(metadata.packageVersion === GASTAPP_CANONICAL_V2_CONTRACT.packageVersion, 'invalid_document', 'packageVersion canónico inesperado.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(SHA256_PATTERN.test(metadata.canonicalDataHash), 'canonical_hash_mismatch', 'El hash canónico no tiene formato SHA-256.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(metadata.qualityStatus === GASTAPP_CANONICAL_V2_CONTRACT.qualityStatus, 'invalid_document', 'El estado de calidad canónico no está validado.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(Number.isInteger(metadata.counts.canonicalRows) && metadata.counts.canonicalRows >= 0, 'invalid_document', 'El conteo canónico no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(Number.isInteger(metadata.counts.periods) && metadata.counts.periods >= 0, 'invalid_document', 'El conteo de períodos no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(Number.isInteger(metadata.counts.acceptedPeriods) && metadata.counts.acceptedPeriods >= 0 && metadata.counts.acceptedPeriods <= metadata.counts.periods, 'invalid_document', 'La cobertura de períodos no es válida.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(Number.isInteger(metadata.counts.months) && metadata.counts.months >= 0, 'invalid_document', 'El conteo de meses no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(Object.values(metadata.totalsEur).every((value) => typeof value === 'number' && Number.isFinite(value)), 'invalid_document', 'Los totales canónicos no son válidos.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(
    metadata.totalsEur.calendarMinusCanonical != null &&
      Math.abs(metadata.totalsEur.calendarMinusCanonical) <= GASTAPP_CANONICAL_V2_RECONCILIATION_TOLERANCE_EUR,
    'invalid_document',
    'La diferencia meses vs. filas supera 1,00 €.',
    GASTAPP_CANONICAL_V2_CURRENT_PATH,
  );
  assertExpected(Boolean(metadata.coverage.completeFromMonthKey && MONTH_KEY_PATTERN.test(metadata.coverage.completeFromMonthKey)), 'invalid_document', 'El inicio de cobertura no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(Boolean(metadata.coverage.completeThroughMonthKey && MONTH_KEY_PATTERN.test(metadata.coverage.completeThroughMonthKey)), 'invalid_document', 'El final de cobertura no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  assertExpected(metadata.coverage.partialBoundaryMonths.every((value) => MONTH_KEY_PATTERN.test(value)), 'invalid_document', 'Las fronteras parciales no son válidas.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  const hasOperationalFreshness = [metadata.operationalDataHash, metadata.operationalRevision].some((value) => value !== null);
  if (hasOperationalFreshness) {
    assertExpected(SHA256_PATTERN.test(metadata.operationalDataHash || ''), 'invalid_document', 'El hash operacional canónico no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
    assertExpected(Number.isInteger(metadata.operationalRevision) && metadata.operationalRevision >= 0, 'invalid_document', 'La revisión operacional canónica no es válida.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  }
  const fullIdentity = [
    metadata.fullSnapshotHash,
    metadata.fullSnapshotOperationalDataHash,
    metadata.fullSnapshotOperationalRevision,
    metadata.fullSnapshotGeneratedAt,
    metadata.fullSnapshotStale,
  ];
  if (fullIdentity.some((value) => value !== null)) {
    assertExpected(SHA256_PATTERN.test(metadata.fullSnapshotHash || ''), 'invalid_document', 'El hash del snapshot Full no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
    assertExpected(SHA256_PATTERN.test(metadata.fullSnapshotOperationalDataHash || ''), 'invalid_document', 'El hash operacional del snapshot Full no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
    assertExpected(Number.isInteger(metadata.fullSnapshotOperationalRevision) && metadata.fullSnapshotOperationalRevision >= 0, 'invalid_document', 'La revisión operacional del snapshot Full no es válida.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
    assertExpected(Boolean(metadata.fullSnapshotGeneratedAt), 'invalid_document', 'La fecha del snapshot Full no es válida.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
    assertExpected(typeof metadata.fullSnapshotStale === 'boolean', 'invalid_document', 'El estado stale del snapshot Full no es válido.', GASTAPP_CANONICAL_V2_CURRENT_PATH);
  }
  return metadata;
};

const normalizePeriod = (raw: RecordValue): GastappCanonicalV2Period => {
  const control = readRecord(raw.control);
  return {
    periodKeyOriginal: readString(raw.periodKeyOriginal) || '',
    periodNumber: readNumber(raw.periodNumber) || 0,
    periodStartYmd: readString(raw.periodStartYmd) || '',
    periodEndYmd: readString(raw.periodEndYmd) || '',
    rowCount: readNumber(raw.rowCount) || 0,
    totalEur: readNumber(raw.totalEur) || 0,
    byFamily: normalizeNumberMap(raw.byFamily),
    byCategory: normalizeAggregateMap(raw.byCategory),
    byProject: normalizeAggregateMap(raw.byProject),
    raw: { ...raw, control },
  };
};

const normalizeMonth = (raw: RecordValue): GastappCanonicalV2Month => {
  const coverage = readRecord(raw.coverage);
  return {
    calendarMonthKey: readString(raw.calendarMonthKey) || '',
    status: readString(raw.status) || '',
    calendarStatus: readString(raw.calendarStatus) || '',
    eligibleForAurumReturns: readBoolean(raw.eligibleForAurumReturns) === true,
    fromYmd: readString(coverage.fromYmd),
    toYmd: readString(coverage.toYmd),
    rowCount: readNumber(raw.rowCount) || 0,
    totalEur: readNumber(raw.totalEur) || 0,
    byFamily: normalizeNumberMap(raw.byFamily),
    byCategory: normalizeAggregateMap(raw.byCategory),
    byProject: normalizeAggregateMap(raw.byProject),
    raw,
  };
};

const validatePeriodContract = async (
  raw: RecordValue,
  metadata: GastappCanonicalV2Metadata,
  sha256: Sha256,
): Promise<GastappCanonicalV2PeriodContract> => {
  const contractHash = await hashDocument(raw, sha256);
  assertExpected(SHA256_PATTERN.test(contractHash), 'contract_hash_mismatch', 'El hash del contrato de períodos no tiene formato SHA-256.', GASTAPP_AURUM_PERIODS_V2_PATH);
  assertExpected(readString(raw.contractId) === GASTAPP_CANONICAL_V2_CONTRACT.periodsContractId, 'invalid_document', 'El identificador del contrato de períodos es incorrecto.', GASTAPP_AURUM_PERIODS_V2_PATH);
  assertExpected(readString(raw.version) === GASTAPP_CANONICAL_V2_CONTRACT.periodsContractVersion, 'invalid_document', 'La versión del contrato de períodos es incorrecta.', GASTAPP_AURUM_PERIODS_V2_PATH);
  assertExpected(readString(raw.axis) === GASTAPP_CANONICAL_V2_CONTRACT.periodsAxis, 'invalid_document', 'El eje del contrato de períodos es incorrecto.', GASTAPP_AURUM_PERIODS_V2_PATH);
  assertExpected(readString(raw.canonicalDataHash) === metadata.canonicalDataHash, 'canonical_hash_mismatch', 'El contrato de períodos apunta a otro hash canónico.', GASTAPP_AURUM_PERIODS_V2_PATH);
  const periodsRaw = Array.isArray(raw.periods) ? raw.periods.map(readRecord) : [];
  assertExpected(periodsRaw.length === metadata.counts.periods, 'invalid_document', 'El número de períodos no coincide con metadata.', GASTAPP_AURUM_PERIODS_V2_PATH);
  assertExpected(readNumber(raw.rowCount) === metadata.counts.canonicalRows, 'invalid_document', 'El número de filas del contrato de períodos no coincide con metadata.', GASTAPP_AURUM_PERIODS_V2_PATH);
  assertExpected(totalsAgreeWithinTolerance(readNumber(raw.totalEur), metadata.totalsEur.exact), 'invalid_document', 'El total del contrato de períodos no coincide con metadata.', GASTAPP_AURUM_PERIODS_V2_PATH);
  periodsRaw.forEach((period) => {
    assertExpected(!Object.prototype.hasOwnProperty.call(period, 'calendarMonthKey'), 'invalid_document', 'El contrato de períodos no puede mezclar calendarMonthKey.', GASTAPP_AURUM_PERIODS_V2_PATH);
  });
  const periods = periodsRaw.map(normalizePeriod);
  assertExpected(periods.every((period) => /^P\d+$/.test(period.periodKeyOriginal) && period.periodNumber > 0), 'invalid_document', 'El eje periodKeyOriginal contiene una clave inválida.', GASTAPP_AURUM_PERIODS_V2_PATH);
  return {
    contractId: GASTAPP_CANONICAL_V2_CONTRACT.periodsContractId,
    version: GASTAPP_CANONICAL_V2_CONTRACT.periodsContractVersion,
    axis: GASTAPP_CANONICAL_V2_CONTRACT.periodsAxis,
    canonicalDataHash: metadata.canonicalDataHash,
    generatedAt: readString(raw.generatedAt),
    rowCount: readNumber(raw.rowCount) || 0,
    totalEur: readNumber(raw.totalEur) || 0,
    periods,
    contractHash,
    raw,
  };
};

const validateMonthContract = async (
  raw: RecordValue,
  metadata: GastappCanonicalV2Metadata,
  sha256: Sha256,
): Promise<GastappCanonicalV2MonthContract> => {
  const contractHash = await hashDocument(raw, sha256);
  assertExpected(SHA256_PATTERN.test(contractHash), 'contract_hash_mismatch', 'El hash del contrato de meses no tiene formato SHA-256.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(readString(raw.contractId) === GASTAPP_CANONICAL_V2_CONTRACT.monthsContractId, 'invalid_document', 'El identificador del contrato de meses es incorrecto.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(readString(raw.version) === GASTAPP_CANONICAL_V2_CONTRACT.monthsContractVersion, 'invalid_document', 'La versión del contrato de meses es incorrecta.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(readString(raw.axis) === GASTAPP_CANONICAL_V2_CONTRACT.monthsAxis, 'invalid_document', 'El eje del contrato de meses es incorrecto.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(readString(raw.canonicalDataHash) === metadata.canonicalDataHash, 'canonical_hash_mismatch', 'El contrato de meses apunta a otro hash canónico.', GASTAPP_AURUM_MONTHS_V2_PATH);
  const monthsRaw = Array.isArray(raw.months) ? raw.months.map(readRecord) : [];
  assertExpected(monthsRaw.length === metadata.counts.months, 'invalid_document', 'El número de meses no coincide con metadata.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(readNumber(raw.rowCount) === metadata.counts.canonicalRows, 'invalid_document', 'El número de filas del contrato de meses no coincide con metadata.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(totalsAgreeWithinTolerance(readNumber(raw.totalEur), metadata.totalsEur.exact), 'invalid_document', 'El total del contrato de meses no coincide con metadata.', GASTAPP_AURUM_MONTHS_V2_PATH);
  const coverage = readRecord(raw.coverage);
  const normalizedCoverage = {
    completeFromMonthKey: readString(coverage.completeFromMonthKey),
    completeThroughMonthKey: readString(coverage.completeThroughMonthKey),
    partialBoundaryMonths: readStringArray(coverage.partialBoundaryMonths),
  };
  assertExpected(normalizedCoverage.completeFromMonthKey === metadata.coverage.completeFromMonthKey, 'invalid_document', 'El inicio del contrato de meses no coincide con metadata.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(normalizedCoverage.completeThroughMonthKey === metadata.coverage.completeThroughMonthKey, 'invalid_document', 'El final del contrato de meses no coincide con metadata.', GASTAPP_AURUM_MONTHS_V2_PATH);
  assertExpected(normalizedCoverage.partialBoundaryMonths.join('|') === metadata.coverage.partialBoundaryMonths.join('|'), 'invalid_document', 'Las fronteras del contrato de meses no coinciden con metadata.', GASTAPP_AURUM_MONTHS_V2_PATH);
  const months = monthsRaw.map(normalizeMonth);
  assertExpected(months.every((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month.calendarMonthKey)), 'invalid_document', 'El eje calendarMonthKey contiene una clave inválida.', GASTAPP_AURUM_MONTHS_V2_PATH);
  return {
    contractId: GASTAPP_CANONICAL_V2_CONTRACT.monthsContractId,
    version: GASTAPP_CANONICAL_V2_CONTRACT.monthsContractVersion,
    axis: GASTAPP_CANONICAL_V2_CONTRACT.monthsAxis,
    canonicalDataHash: metadata.canonicalDataHash,
    generatedAt: readString(raw.generatedAt),
    rowCount: readNumber(raw.rowCount) || 0,
    totalEur: readNumber(raw.totalEur) || 0,
    coverage: normalizedCoverage,
    months,
    contractHash,
    raw,
  };
};

const resolveDependencies = (dependencies?: GastappCanonicalV2Dependencies) => ({
  readDocument: dependencies?.readDocument || defaultReadDocument,
  sha256: dependencies?.sha256 || defaultSha256,
});

const readMetadata = async (readDocument: DocumentReader) => {
  const raw = await readRequiredDocument(readDocument, GASTAPP_CANONICAL_V2_CURRENT_PATH);
  return validateCanonicalMetadata(raw);
};

export const loadGastappCanonicalV2Contracts = async (
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<GastappCanonicalV2Contracts> => {
  const { readDocument, sha256 } = resolveDependencies(dependencies);
  const metadata = await readMetadata(readDocument);
  const [periodsRaw, monthsRaw] = await Promise.all([
    readRequiredDocument(readDocument, GASTAPP_AURUM_PERIODS_V2_PATH),
    readRequiredDocument(readDocument, GASTAPP_AURUM_MONTHS_V2_PATH),
  ]);
  const [periods, months] = await Promise.all([
    validatePeriodContract(periodsRaw, metadata, sha256),
    validateMonthContract(monthsRaw, metadata, sha256),
  ]);
  return {
    metadata,
    periods,
    months,
    readPaths: [GASTAPP_CANONICAL_V2_CURRENT_PATH, GASTAPP_AURUM_PERIODS_V2_PATH, GASTAPP_AURUM_MONTHS_V2_PATH],
  };
};

let canonicalContractsCache: Promise<GastappCanonicalV2Contracts> | null = null;
let canonicalMonthContractCache: Promise<{ metadata: GastappCanonicalV2Metadata; months: GastappCanonicalV2MonthContract }> | null = null;

export const loadGastappCanonicalV2ContractsCached = async (): Promise<GastappCanonicalV2Contracts> => {
  if (!canonicalContractsCache) {
    const pending = loadGastappCanonicalV2Contracts();
    canonicalContractsCache = pending.catch((error) => {
      canonicalContractsCache = null;
      throw error;
    });
  }
  return canonicalContractsCache;
};

/**
 * Explicit operator check. This bypasses the in-memory cache and reads only
 * the three small canonical contract documents; it never reads transaction
 * rows or reconstructs either Data Room artifact.
 */
export const loadGastappCanonicalV2ContractsFresh = async (
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<GastappCanonicalV2Contracts> => {
  clearGastappCanonicalV2Cache();
  return loadGastappCanonicalV2Contracts(dependencies);
};

export const loadGastappCanonicalV2MonthContract = async (
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<{ metadata: GastappCanonicalV2Metadata; months: GastappCanonicalV2MonthContract }> => {
  const { readDocument, sha256 } = resolveDependencies(dependencies);
  const metadata = await readMetadata(readDocument);
  const monthsRaw = await readRequiredDocument(readDocument, GASTAPP_AURUM_MONTHS_V2_PATH);
  return { metadata, months: await validateMonthContract(monthsRaw, metadata, sha256) };
};

export const loadGastappCanonicalV2MonthContractCached = async (): Promise<{ metadata: GastappCanonicalV2Metadata; months: GastappCanonicalV2MonthContract }> => {
  if (!canonicalMonthContractCache) {
    const pending = loadGastappCanonicalV2MonthContract();
    canonicalMonthContractCache = pending.catch((error) => {
      canonicalMonthContractCache = null;
      throw error;
    });
  }
  return canonicalMonthContractCache;
};

export const clearGastappCanonicalV2Cache = () => {
  canonicalContractsCache = null;
  canonicalMonthContractCache = null;
};

const isStrictFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStrictNonNegativeInteger = (value: unknown): value is number =>
  isStrictFiniteNumber(value) && Number.isInteger(value) && value >= 0;

const assertOfficial = (condition: boolean, message: string, path: string) =>
  assertExpected(condition, 'invalid_document', message, path);

const strictMonthFamilies = (value: unknown, path: string) => {
  const family = readRecord(value);
  const dayToDay = family.day_to_day;
  const trips = family.trips;
  const others = family.others;
  assertOfficial(
    [dayToDay, trips, others].every((entry) => isStrictFiniteNumber(entry) && entry >= 0),
    'Las familias mensuales deben ser números finitos no negativos.',
    path,
  );
  return { dayToDay: dayToDay as number, trips: trips as number, others: others as number };
};

const strictCoverage = (value: unknown, monthKey: string, path: string, requireFullMonth: boolean) => {
  const coverage = readRecord(value);
  const fromYmd = coverage.fromYmd;
  const toYmd = coverage.toYmd;
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const fullMonthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  const ymdPattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  const boundedPartial =
    typeof fromYmd === 'string' &&
    typeof toYmd === 'string' &&
    ymdPattern.test(fromYmd) &&
    ymdPattern.test(toYmd) &&
    fromYmd >= `${monthKey}-01` &&
    toYmd <= fullMonthEnd &&
    fromYmd <= toYmd;
  assertOfficial(
    requireFullMonth ? fromYmd === `${monthKey}-01` && toYmd === fullMonthEnd : boundedPartial,
    requireFullMonth ? 'La cobertura mensual no cubre exactamente el mes calendario.' : 'La cobertura provisional mensual es inválida.',
    path,
  );
  return { fromYmd: fromYmd as string, toYmd: toYmd as string };
};

const strictMonthCertification = (
  raw: RecordValue,
  monthContractRevision: number,
  monthContractHash: string,
  metadata: RecordValue,
  path: string,
): GastappCanonicalV2OfficialMonthCertification | null => {
  const certification = readRecord(raw.calendarCertification);
  if (Object.keys(certification).length === 0) return null;
  const status = certification.status;
  const certificationRevision = certification.certificationRevision;
  const certificationHash = certification.certificationHash;
  const provenance = readRecord(certification.provenance);
  const sourceGeneration = provenance.sourceGeneration;
  const operationalRevision = provenance.operationalRevision;
  const canonicalDataHash = provenance.canonicalDataHash;
  assertOfficial(['certified', 'revised', 'open', 'stale', 'invalidated'].includes(String(status)), 'El estado de certificación mensual es desconocido.', path);
  assertOfficial(isStrictNonNegativeInteger(certificationRevision), 'La revisión de certificación mensual no es válida.', path);
  if (status !== 'open') {
    assertOfficial((certificationRevision as number) > 0, 'La revisión de certificación mensual no es válida.', path);
    assertOfficial(typeof certificationHash === 'string' && SHA256_PATTERN.test(certificationHash), 'El hash de certificación mensual no es válido.', path);
  } else {
    assertOfficial(certificationHash === null || certificationHash === undefined || SHA256_PATTERN.test(String(certificationHash)), 'El hash de certificación abierta no es válido.', path);
  }
  assertOfficial(certification.monthContractRevision === monthContractRevision && certification.monthContractHash === monthContractHash, 'La certificación no referencia la identidad mensual vigente.', path);
  assertOfficial(isStrictNonNegativeInteger(sourceGeneration), 'La provenance de certificación no contiene sourceGeneration válido.', path);
  assertOfficial(isStrictNonNegativeInteger(operationalRevision), 'La provenance de certificación no contiene revisión operacional válida.', path);
  assertOfficial(typeof canonicalDataHash === 'string' && SHA256_PATTERN.test(canonicalDataHash), 'La provenance de certificación no contiene hash canónico válido.', path);
  if (status !== 'certified' && status !== 'revised') return null;
  // Certification validity is month-local.  The month hash/revision above
  // identify the material contract that was certified; global publication
  // provenance is retained for audit only and must not invalidate an
  // otherwise unchanged month when another month is republished.
  return {
    status: status as 'certified' | 'revised',
    certificationRevision: certificationRevision as number,
    certificationHash: certificationHash as string,
    monthContractRevision,
    monthContractHash,
    sourceGeneration: sourceGeneration as number,
    operationalRevision: operationalRevision as number,
    canonicalDataHash: canonicalDataHash as string,
  };
};

/**
 * Exact-document, server-only reader for the sole official monthly authority.
 * It deliberately does not touch periods, Full, Express, Data Room or rows.
 */
export const loadGastappCanonicalV2OfficialMonthContractFresh = async (
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<GastappCanonicalV2OfficialMonthContract> => {
  const readDocument = dependencies?.readDocument || serverReadDocument;
  const [metadata, contract] = await Promise.all([
    readRequiredDocument(readDocument, GASTAPP_CANONICAL_V2_CURRENT_PATH),
    readRequiredDocument(readDocument, GASTAPP_AURUM_MONTHS_V2_PATH),
  ]);
  const path = GASTAPP_AURUM_MONTHS_V2_PATH;
  const metadataPath = GASTAPP_CANONICAL_V2_CURRENT_PATH;
  const metadataCounts = readRecord(metadata.counts);
  const metadataTotals = readRecord(metadata.totalsEur);
  assertOfficial(metadata.publicationMode === 'operational' && metadata.officialPublication === true, 'GastApp no publicó un snapshot mensual oficial.', metadataPath);
  assertOfficial(typeof metadata.canonicalDataHash === 'string' && SHA256_PATTERN.test(metadata.canonicalDataHash), 'El hash canónico oficial no es válido.', metadataPath);
  assertOfficial(typeof metadata.operationalDataHash === 'string' && SHA256_PATTERN.test(metadata.operationalDataHash), 'El hash operacional oficial no es válido.', metadataPath);
  assertOfficial(isStrictNonNegativeInteger(metadata.operationalRevision), 'La revisión operacional oficial no es válida.', metadataPath);
  assertOfficial(contract.contractId === GASTAPP_CANONICAL_V2_CONTRACT.monthsContractId && contract.version === GASTAPP_CANONICAL_V2_CONTRACT.monthsContractVersion && contract.axis === GASTAPP_CANONICAL_V2_CONTRACT.monthsAxis, 'El contrato mensual oficial no coincide con Canonical V2.', path);
  assertOfficial(contract.publicationMode === 'operational' && contract.officialPublication === true, 'months_current no está publicado oficialmente.', path);
  assertOfficial(contract.canonicalDataHash === metadata.canonicalDataHash && contract.operationalDataHash === metadata.operationalDataHash && contract.operationalRevision === metadata.operationalRevision, 'Metadata y months_current pertenecen a snapshots distintos.', path);
  for (const [field, value] of [['months', metadataCounts.months], ['rowCount', metadataCounts.rowCount ?? metadataCounts.canonicalRows]] as const) {
    if (value !== undefined) assertOfficial(isStrictNonNegativeInteger(value), `metadata.counts.${field} no es válido.`, metadataPath);
  }
  if (metadata.canonicalSnapshotHash !== undefined) {
    assertOfficial(metadata.canonicalSnapshotHash === metadata.canonicalDataHash && contract.canonicalSnapshotHash === metadata.canonicalDataHash, 'El snapshot canónico no coincide entre documentos.', path);
  }
  if (metadataTotals.exact !== undefined || contract.totalEur !== undefined) {
    assertOfficial(isStrictFiniteNumber(metadataTotals.exact) && isStrictFiniteNumber(contract.totalEur), 'Los totales publicados no son válidos.', path);
    const metadataTotal = metadataTotals.exact as number;
    const contractTotal = contract.totalEur as number;
    assertOfficial(Math.abs(Math.round((metadataTotal - contractTotal) * 100) / 100) <= 0.01, 'Metadata y months_current no concilian su total publicado.', path);
  }
  if (metadata.sourceGeneration !== undefined || contract.sourceGeneration !== undefined) {
    assertOfficial(isStrictNonNegativeInteger(metadata.sourceGeneration) && contract.sourceGeneration === metadata.sourceGeneration, 'sourceGeneration no coincide entre metadata y months_current.', path);
  }
  assertOfficial(typeof contract.generatedAt === 'string' && Number.isFinite(new Date(contract.generatedAt).getTime()), 'months_current no declara una fecha de publicación válida.', path);
  assertOfficial(Array.isArray(contract.months), 'months_current no contiene una lista mensual válida.', path);
  const months = (contract.months as unknown[]).map((entry: unknown) => {
    const month = readRecord(entry);
    const calendarMonthKey = month.calendarMonthKey;
    assertOfficial(typeof calendarMonthKey === 'string' && MONTH_KEY_PATTERN.test(calendarMonthKey), 'calendarMonthKey mensual inválido.', path);
    assertOfficial(month.status === 'complete' || month.status === 'pending', 'El estado mensual es desconocido.', path);
    assertOfficial(typeof month.calendarStatus === 'string' && month.calendarStatus.length > 0, 'calendarStatus mensual inválido.', path);
    assertOfficial(typeof month.eligibleForAurumReturns === 'boolean', 'eligibleForAurumReturns mensual inválido.', path);
    assertOfficial(isStrictFiniteNumber(month.totalEur) && month.totalEur >= 0, 'totalEur mensual inválido.', path);
    assertOfficial(isStrictNonNegativeInteger(month.rowCount), 'rowCount mensual inválido.', path);
    assertOfficial(isStrictNonNegativeInteger(month.monthContractRevision) && month.monthContractRevision > 0, 'monthContractRevision mensual inválido.', path);
    assertOfficial(typeof month.monthContractHash === 'string' && SHA256_PATTERN.test(month.monthContractHash), 'monthContractHash mensual inválido.', path);
    const monthKey = calendarMonthKey as string;
    const totalEur = month.totalEur as number;
    const monthContractRevision = month.monthContractRevision as number;
    const monthContractHash = month.monthContractHash as string;
    const coverage = strictCoverage(month.coverage, monthKey, path, month.status === 'complete');
    const byFamily = strictMonthFamilies(month.byFamily, path);
    const reconciled = Math.abs(Math.round((totalEur - byFamily.dayToDay - byFamily.trips - byFamily.others) * 100) / 100) <= 0.01;
    assertOfficial(reconciled, 'totalEur mensual no concilia con sus familias dentro de ±0,01 €.', path);
    const calendarCertification = strictMonthCertification(month, monthContractRevision, monthContractHash, metadata, path);
    return {
      calendarMonthKey: monthKey,
      status: month.status as 'complete' | 'pending',
      calendarStatus: month.calendarStatus as string,
      eligibleForAurumReturns: month.eligibleForAurumReturns as boolean,
      coverage,
      totalEur,
      byFamily,
      monthContractRevision,
      monthContractHash,
      calendarCertification,
    };
  });
  if (metadataCounts.months !== undefined) {
    assertOfficial(months.length === metadataCounts.months, 'metadata.counts.months no coincide con months_current.', path);
  }
  if (contract.rowCount !== undefined) {
    assertOfficial(isStrictNonNegativeInteger(contract.rowCount), 'rowCount de months_current no es válido.', path);
  }
  if (metadataCounts.rowCount !== undefined || metadataCounts.canonicalRows !== undefined) {
    const expectedRows = metadataCounts.rowCount ?? metadataCounts.canonicalRows;
    assertOfficial(contract.rowCount === expectedRows, 'metadata.counts.rowCount no coincide con months_current.', path);
  }
  assertOfficial(new Set(months.map((month) => month.calendarMonthKey)).size === months.length, 'months_current contiene meses duplicados.', path);
  return {
    canonicalDataHash: metadata.canonicalDataHash as string,
    operationalDataHash: metadata.operationalDataHash as string,
    operationalRevision: metadata.operationalRevision as number,
    sourceGeneration: isStrictNonNegativeInteger(metadata.sourceGeneration) ? metadata.sourceGeneration : null,
    generatedAt: contract.generatedAt as string,
    version: contract.version as string,
    months,
  };
};

export const loadGastappCanonicalV2PeriodContract = async (
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<{ metadata: GastappCanonicalV2Metadata; periods: GastappCanonicalV2PeriodContract }> => {
  const { readDocument, sha256 } = resolveDependencies(dependencies);
  const metadata = await readMetadata(readDocument);
  const periodsRaw = await readRequiredDocument(readDocument, GASTAPP_AURUM_PERIODS_V2_PATH);
  return { metadata, periods: await validatePeriodContract(periodsRaw, metadata, sha256) };
};

const normalizeArtifactPointer = (value: unknown, mode: GastappDataRoomV2ArtifactMode): GastappDataRoomV2ArtifactPointer => {
  const raw = readRecord(value);
  const expectedPath = mode === 'express' ? GASTAPP_DATA_ROOM_V2_EXPRESS_PATH : GASTAPP_DATA_ROOM_V2_FULL_PATH;
  const document = readString(raw.document) || '';
  const hash = readString(raw.hash) || '';
  const bytes = readNumber(raw.bytes ?? raw.byteLength) || 0;
  const mediaType = readString(raw.mediaType);
  const generatedAt = readString(raw.generatedAt ?? raw.updatedAt ?? raw.publishedAt);
  const operationalDataHash = readString(raw.operationalDataHash);
  const operationalRevision = readNumber(raw.operationalRevision);
  const staleAgainstOperationalHash = readBoolean(raw.staleAgainstOperationalHash);
  if (document !== expectedPath || !/^sha256:[0-9a-f]{64}$/.test(hash) || bytes <= 0 || mediaType !== 'application/zip') {
    throw new GastappCanonicalV2Error('artifact_pointer_invalid', `El puntero ${mode} no es un ZIP Firestore válido.`, GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  }
  if (mode === 'full' && (
    !generatedAt ||
    !SHA256_PATTERN.test(operationalDataHash || '') ||
    !Number.isInteger(operationalRevision) || operationalRevision < 0 ||
    typeof staleAgainstOperationalHash !== 'boolean'
  )) {
    throw new GastappCanonicalV2Error('artifact_pointer_invalid', 'El puntero Full no contiene su estado operacional completo.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  }
  return {
    document,
    hash,
    bytes,
    mediaType: 'application/zip',
    generatedAt,
    operationalDataHash,
    operationalRevision,
    staleAgainstOperationalHash,
  };
};

export const loadGastappDataRoomV2Pointer = async (
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<GastappDataRoomV2Pointer> => {
  const { readDocument } = resolveDependencies(dependencies);
  const raw = await readRequiredDocument(readDocument, GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  const pointerVersion = readString(raw.pointerVersion) || '';
  const storageBackend = readString(raw.storageBackend) || '';
  const canonicalDataHash = readString(raw.canonicalDataHash) || '';
  const operationalDataHash = readString(raw.operationalDataHash) || '';
  const operationalRevision = readNumber(raw.operationalRevision);
  const fullSnapshotHash = readString(raw.fullSnapshotHash);
  const fullSnapshotOperationalDataHash = readString(raw.fullSnapshotOperationalDataHash);
  const fullSnapshotOperationalRevision = readNumber(raw.fullSnapshotOperationalRevision ?? readRecord(raw.full).operationalRevision);
  const fullSnapshotGeneratedAt = readString(raw.fullSnapshotGeneratedAt);
  const fullSnapshotStale = readBoolean(raw.fullSnapshotStale);
  assertExpected(pointerVersion === 'gastapp-data-room-pointer-v2', 'artifact_pointer_invalid', 'La versión del puntero Data Room no coincide.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  assertExpected(storageBackend === 'firestore_blob', 'artifact_pointer_invalid', 'El backend del Data Room no es firestore_blob.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  assertExpected(SHA256_PATTERN.test(canonicalDataHash), 'canonical_hash_mismatch', 'El puntero Data Room no tiene hash canónico SHA-256.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  assertExpected(SHA256_PATTERN.test(operationalDataHash), 'artifact_pointer_invalid', 'El puntero no tiene hash operacional SHA-256.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  assertExpected(Number.isInteger(operationalRevision) && operationalRevision >= 0, 'artifact_pointer_invalid', 'El puntero no tiene revisión operacional válida.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  if (dependencies?.expectedCanonicalDataHash) {
    assertExpected(canonicalDataHash === dependencies.expectedCanonicalDataHash, 'canonical_hash_mismatch', 'El puntero Data Room no coincide con el contrato mensual leído.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  }
  const express = normalizeArtifactPointer(raw.express, 'express');
  const fullAbsent = raw.full === null;
  const fullIdentityValues = [fullSnapshotHash, fullSnapshotOperationalDataHash, fullSnapshotOperationalRevision, fullSnapshotGeneratedAt, fullSnapshotStale];
  if (fullAbsent) {
    assertExpected(fullIdentityValues.every((value) => value === null), 'artifact_pointer_invalid', 'Full ausente no puede conservar una identidad o ventana activa.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  } else {
    assertExpected(fullIdentityValues.every((value) => value !== null), 'artifact_pointer_invalid', 'Full presente requiere una identidad completa.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  }
  const full = fullAbsent ? null : normalizeArtifactPointer(raw.full, 'full');
  const fullFreshness = full
    ? {
        generatedAt: fullSnapshotGeneratedAt!,
        isStale: fullSnapshotStale!,
        snapshotOperationalDataHash: fullSnapshotOperationalDataHash!,
        currentOperationalDataHash: operationalDataHash,
        snapshotOperationalRevision: full.operationalRevision!,
        currentOperationalRevision: operationalRevision,
      }
    : null;
  if (full) {
    assertExpected(full.hash === fullSnapshotHash, 'artifact_pointer_invalid', 'El hash Full no coincide con el snapshot anunciado.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
    assertExpected(full.operationalDataHash === fullSnapshotOperationalDataHash, 'artifact_pointer_invalid', 'El hash operacional de Full no coincide con el snapshot anunciado.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
    assertExpected(full.generatedAt === fullSnapshotGeneratedAt, 'artifact_pointer_invalid', 'La fecha de Full no coincide con el snapshot anunciado.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
    assertExpected(full.staleAgainstOperationalHash === fullSnapshotStale, 'artifact_pointer_invalid', 'El estado stale de Full no coincide con el puntero.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  }
  return {
    pointerVersion,
    storageBackend,
    canonicalDataHash,
    operationalDataHash,
    operationalRevision,
    fullSnapshotHash,
    fullSnapshotOperationalDataHash,
    fullSnapshotOperationalRevision,
    fullSnapshotGeneratedAt,
    fullSnapshotStale,
    express,
    full,
    fullFreshness,
    raw,
  };
};

export const validateGastappDataRoomV2FreshnessAgainstMetadata = (
  metadata: GastappCanonicalV2Metadata,
  pointer: GastappDataRoomV2Pointer,
): GastappDataRoomV2FullFreshness | null => {
  assertExpected(
    metadata.canonicalDataHash === pointer.canonicalDataHash,
    'canonical_hash_mismatch',
    'La metadata y el puntero Data Room no coinciden en el hash canónico.',
    GASTAPP_DATA_ROOM_V2_POINTER_PATH,
  );
  assertExpected(
    metadata.operationalDataHash === pointer.operationalDataHash &&
      metadata.operationalRevision === pointer.operationalRevision,
    'artifact_pointer_invalid',
    'La metadata y el puntero no coinciden en el estado operacional vigente.',
    GASTAPP_DATA_ROOM_V2_POINTER_PATH,
  );
  assertExpected(
    metadata.fullSnapshotHash === pointer.fullSnapshotHash &&
      metadata.fullSnapshotOperationalDataHash === pointer.fullSnapshotOperationalDataHash &&
      metadata.fullSnapshotOperationalRevision === pointer.fullSnapshotOperationalRevision &&
      metadata.fullSnapshotGeneratedAt === pointer.fullSnapshotGeneratedAt &&
      metadata.fullSnapshotStale === pointer.fullSnapshotStale,
    'artifact_pointer_invalid',
    'La metadata y el puntero no coinciden en la identidad o frescura del snapshot Full.',
    GASTAPP_DATA_ROOM_V2_POINTER_PATH,
  );
  return pointer.fullFreshness;
};

const toUint8Array = (value: unknown, allowFixtureByteArray: boolean): Uint8Array => {
  if (value && typeof (value as { toUint8Array?: unknown }).toUint8Array === 'function') {
    const bytes = (value as { toUint8Array: () => Uint8Array }).toUint8Array();
    if (bytes instanceof Uint8Array) return bytes;
  }
  if (allowFixtureByteArray && Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return Uint8Array.from(value);
  }
  throw new GastappCanonicalV2Error('artifact_bytes_missing', 'El artefacto no contiene Firestore Bytes ni bytes de fixture autorizados.');
};

export const loadGastappDataRoomV2Artifact = async (
  mode: GastappDataRoomV2ArtifactMode,
  dependencies?: GastappCanonicalV2Dependencies,
): Promise<GastappDataRoomV2VerifiedArtifact> => {
  const { readDocument, sha256 } = resolveDependencies(dependencies);
  const pointer = await loadGastappDataRoomV2Pointer({ ...dependencies, readDocument });
  const artifactPointer = mode === 'express' ? pointer.express : pointer.full;
  if (!artifactPointer) throw new GastappCanonicalV2Error('artifact_missing', 'No existe un artefacto Full activo para descargar.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
  const artifactRaw = await readRequiredDocument(readDocument, artifactPointer.document);
  const bytes = toUint8Array(artifactRaw.zipBytes, dependencies?.allowFixtureByteArray === true);
  const expectedBytes = artifactPointer.bytes;
  const expectedHash = artifactPointer.hash;
  const expectedArtifactVersion = mode === 'express'
    ? GASTAPP_DATA_ROOM_V2_EXPRESS_ARTIFACT_VERSION
    : GASTAPP_DATA_ROOM_V2_FULL_ARTIFACT_VERSION;
  assertExpected(readString(artifactRaw.artifactVersion) === expectedArtifactVersion, 'artifact_pointer_invalid', 'La versión del artefacto no coincide con el modo solicitado.', artifactPointer.document);
  assertExpected(readString(artifactRaw.mode) === mode, 'artifact_pointer_invalid', 'El modo del artefacto no coincide con el puntero.', artifactPointer.document);
  assertExpected(readString(artifactRaw.canonicalDataHash) === pointer.canonicalDataHash, 'canonical_hash_mismatch', 'El artefacto apunta a otro hash canónico.', artifactPointer.document);
  assertExpected(readString(artifactRaw.mediaType) === 'application/zip', 'artifact_pointer_invalid', 'El artefacto no declara MIME application/zip.', artifactPointer.document);
  assertExpected(readNumber(artifactRaw.byteLength) === expectedBytes, 'artifact_size_mismatch', 'El tamaño declarado del artefacto no coincide.', artifactPointer.document);
  assertExpected(bytes.byteLength === expectedBytes, 'artifact_size_mismatch', `El ZIP ${mode} tiene ${bytes.byteLength} bytes; se esperaban ${expectedBytes}.`, artifactPointer.document);
  const calculatedHash = await sha256(bytes);
  assertExpected(readString(artifactRaw.hash) === expectedHash && calculatedHash === expectedHash, 'artifact_hash_mismatch', 'El SHA-256 del ZIP no coincide con el puntero publicado.', artifactPointer.document);
  if (mode === 'full') {
    const freshness = pointer.fullFreshness;
    if (!freshness) throw new GastappCanonicalV2Error('artifact_missing', 'No existe un artefacto Full activo para descargar.', GASTAPP_DATA_ROOM_V2_POINTER_PATH);
    assertExpected(readString(artifactRaw.generatedAt) === freshness.generatedAt, 'artifact_pointer_invalid', 'La fecha de Full no coincide con el puntero.', artifactPointer.document);
    assertExpected(readString(artifactRaw.operationalDataHash) === freshness.snapshotOperationalDataHash, 'artifact_pointer_invalid', 'El hash operacional de Full no coincide con su snapshot.', artifactPointer.document);
    assertExpected(readString(artifactRaw.fullSnapshotOperationalDataHash) === freshness.snapshotOperationalDataHash, 'artifact_pointer_invalid', 'El hash operacional declarado por Full no coincide con su snapshot.', artifactPointer.document);
    assertExpected(readString(artifactRaw.fullSnapshotHash) === pointer.fullSnapshotHash, 'artifact_pointer_invalid', 'La identidad inmutable del snapshot Full no coincide con el puntero.', artifactPointer.document);
    assertExpected(readString(artifactRaw.fullSnapshotGeneratedAt) === freshness.generatedAt, 'artifact_pointer_invalid', 'La fecha declarada del snapshot Full no coincide con el puntero.', artifactPointer.document);
    assertExpected(readNumber(artifactRaw.operationalRevision) === freshness.snapshotOperationalRevision, 'artifact_pointer_invalid', 'La revisión operacional de Full no coincide con el puntero.', artifactPointer.document);
    assertExpected(readNumber(artifactRaw.fullSnapshotOperationalRevision) === freshness.snapshotOperationalRevision, 'artifact_pointer_invalid', 'La revisión declarada del snapshot Full no coincide con el puntero.', artifactPointer.document);
    assertExpected(typeof readBoolean(artifactRaw.fullSnapshotStale) === 'boolean', 'artifact_pointer_invalid', 'Full no declara su estado stale de snapshot.', artifactPointer.document);
  }
  const blobInput = new Uint8Array(bytes.byteLength);
  blobInput.set(bytes);
  const blob = new Blob([blobInput.buffer], { type: 'application/zip' });
  return {
    mode,
    filename: `gastapp-canonical-calendar-offline-v2-data-room-${mode}.zip`,
    blob,
    bytes,
    byteLength: bytes.byteLength,
    sha256: calculatedHash,
    canonicalDataHash: pointer.canonicalDataHash,
    pointerPath: GASTAPP_DATA_ROOM_V2_POINTER_PATH,
    artifactPath: artifactPointer.document,
    fullFreshness: mode === 'full' ? pointer.fullFreshness : null,
  };
};

export const downloadGastappDataRoomV2Artifact = async (
  mode: GastappDataRoomV2ArtifactMode,
  dependencies?: GastappCanonicalV2Dependencies,
) => {
  const artifact = await loadGastappDataRoomV2Artifact(mode, dependencies);
  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return artifact;
};

export const getGastappCanonicalV2ConfiguredProjectId = () => getGastappConfiguredProjectId() || null;

export const roundGastappCanonicalV2Eur = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? null : round2(Number(value));
