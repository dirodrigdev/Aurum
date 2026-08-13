import { doc, getDoc, type Firestore } from 'firebase/firestore';

import {
  auth,
  ensureGastappAuthPersistence,
  getGastappAuth,
  getGastappConfiguredProjectId,
  getGastappFirestore,
  signInWithGastappGoogle,
  waitForGastappAuthUser,
} from './firebase';
import {
  GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION,
  GASTAPP_CALENDAR_SOURCE_CONTRACT,
  GASTAPP_CALENDAR_SOURCE_METHODOLOGY_VERSION,
  type GastappCalendarMonthCoverage,
  type GastappCalendarShadowSnapshot,
  type GastappCanonicalExpense,
  validateGastappCalendarShadowRows,
} from './gastappCalendarShadowContract';

export const GASTAPP_CALENDAR_SOURCE_PROJECT_ID = 'duofin-c1894';
export const GASTAPP_CALENDAR_SOURCE_COLLECTION = 'gastapp_calendar_source_v1_private';
export const GASTAPP_CALENDAR_SOURCE_CURRENT_PATH = `${GASTAPP_CALENDAR_SOURCE_COLLECTION}/source_v1_current`;
export const GASTAPP_CALENDAR_PREDECESSOR_P30_CURRENT_PATH = `${GASTAPP_CALENDAR_SOURCE_COLLECTION}/source_v1_predecessor_p30_current`;
export const GASTAPP_CALENDAR_PREDECESSOR_P30_SNAPSHOT_PATH = `${GASTAPP_CALENDAR_SOURCE_COLLECTION}/source_v1_predecessor_p30_snapshot_fnv1a64_99e1fc0b6f925b37`;
export const GASTAPP_CALENDAR_PREDECESSOR_P30_HASH = 'fnv1a64:99e1fc0b6f925b37';
export const GASTAPP_CALENDAR_PREDECESSOR_P30_METHODOLOGY = 'gastapp-calendar-p30-predecessor-v1';

type AuthUserLike = { email?: string | null } | null;
type DocumentReader = (path: string) => Promise<Record<string, unknown> | null>;

export type GastappCalendarSourceDependencies = {
  configuredProjectId: () => string;
  primaryUser: () => AuthUserLike;
  secondaryUser: () => Promise<AuthUserLike>;
  signInSecondary: () => Promise<AuthUserLike>;
  ensureSecondaryPersistence: () => Promise<void>;
  readDocument: DocumentReader;
};

export type GastappCalendarSourceErrorCode =
  | 'missing_config'
  | 'wrong_project'
  | 'secondary_auth_required'
  | 'secondary_auth_failed'
  | 'primary_email_missing'
  | 'secondary_email_missing'
  | 'email_mismatch'
  | 'unauthorized_user'
  | 'inactive_user'
  | 'permission_denied'
  | 'current_pointer_missing'
  | 'current_pointer_invalid'
  | 'snapshot_path_invalid'
  | 'snapshot_missing'
  | 'snapshot_invalid'
  | 'snapshot_hash_invalid'
  | 'snapshot_counts_invalid'
  | 'snapshot_rows_invalid'
  | 'snapshot_coverage_invalid'
  | 'snapshot_reconciliation_invalid'
  | 'predecessor_missing'
  | 'predecessor_invalid'
  | 'calendar_boundary_invalid';

export class GastappCalendarSourceError extends Error {
  readonly code: GastappCalendarSourceErrorCode;

  constructor(code: GastappCalendarSourceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GastappCalendarSourceError';
    this.code = code;
  }
}

type PublishedCoverage = {
  rowCount: number;
  includedRowCount: number;
  amountNormalized: number;
};

type PublishedReconciliationRow = {
  periodKey: string;
  periodNumber: number;
  monthKey: string;
  expectedAmountNormalized: number | null;
  actualAmountNormalized: number;
  difference: number | null;
  status: 'matched' | 'mismatch' | 'missing_control';
};

export type GastappCalendarSourceManifestV1 = {
  contract: typeof GASTAPP_CALENDAR_SOURCE_CONTRACT;
  schemaVersion: typeof GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION;
  methodologyVersion: typeof GASTAPP_CALENDAR_SOURCE_METHODOLOGY_VERSION;
  sourceCommit: string;
  generatedAt: string;
  publicationState: 'complete';
  snapshotId: string;
  snapshotPath: string;
  currentPath: string;
  hash: string;
  closingConfig: { type: 'fixed_day'; closingDay: number; source: 'meta/closing_config' };
  coveredRange: {
    fromCalendarMonthKey: string;
    toCalendarMonthKey: string;
    fromTransactionDate: string;
    toTransactionDate: string;
    fromPeriodKey: string;
    toPeriodKey: string;
  };
  latestClosedMonthKey: string;
  counts: {
    totalRows: number;
    includedRows: number;
    canonicalIdentities: number;
    duplicateIdentities: number;
    warnings: number;
    rowsWithMissingFx: number;
    byNormalizationStatus: Record<string, number>;
  };
  duplicates: string[];
  warnings: string[];
  coverageByMonth: Record<string, PublishedCoverage>;
  coverageByOriginalPeriod: Record<string, PublishedCoverage>;
  reconciliation: {
    status: 'matched' | 'accepted_control_residual' | 'warning' | 'mismatch';
    reconciliationStatus: 'matched' | 'accepted_control_residual' | 'warning' | 'mismatch';
    controlSource: 'aurum_monthly_from_periods_v1';
    expectedTotalAmountNormalized: number | null;
    actualTotalAmountNormalized: number;
    difference: number | null;
    controlTotalEur: number | null;
    canonicalTotalEur: number;
    residualEur: number | null;
    residualByPeriod: Record<string, number>;
    warnings: string[];
    rows: PublishedReconciliationRow[];
  };
};

export type GastappCalendarSourceLoadResult = {
  authenticatedEmail: string;
  sourceManifest: GastappCalendarSourceManifestV1;
  predecessorManifest: GastappCalendarPredecessorP30Manifest;
  snapshot: GastappCalendarShadowSnapshot;
  coverageByMonth: Readonly<Record<string, GastappCalendarMonthCoverage>>;
  comparableMonthKeys: readonly string[];
  partialEdgeMonthKeys: readonly string[];
  novemberBoundary: GastappNovemberBoundaryEvidence;
};

export type GastappCalendarPredecessorP30Manifest = {
  contract: typeof GASTAPP_CALENDAR_SOURCE_CONTRACT;
  schemaVersion: typeof GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION;
  methodologyVersion: typeof GASTAPP_CALENDAR_PREDECESSOR_P30_METHODOLOGY;
  sourceCommit: string;
  sourceRole: 'historical_predecessor';
  generatedAt: string;
  publicationState: 'complete';
  snapshotId: string;
  snapshotPath: string;
  currentPath: typeof GASTAPP_CALENDAR_PREDECESSOR_P30_CURRENT_PATH;
  primaryCurrentPath: typeof GASTAPP_CALENDAR_SOURCE_CURRENT_PATH;
  primaryCurrentHashAtPublication: string;
  replacesPrimaryCurrent: false;
  closingConfig: { type: 'fixed_day'; closingDay: 11; source: 'meta/closing_config' };
  coveredRange: {
    fromCalendarMonthKey: '2025-10';
    toCalendarMonthKey: '2025-11';
    fromTransactionDate: '2025-10-12';
    toTransactionDate: '2025-11-11';
    fromPeriodKey: 'P30';
    toPeriodKey: 'P30';
  };
  periodKey: 'P30';
  periodNumber: 30;
  periodStartYMD: '2025-10-12';
  periodEndYMD: '2025-11-11';
  hash: typeof GASTAPP_CALENDAR_PREDECESSOR_P30_HASH;
  counts: {
    totalRows: number;
    includedRows: number;
    canonicalIdentities: number;
    duplicateIdentities: number;
    exactDateRows: number;
    historicallyInferredMonthRows: number;
  };
  duplicates: string[];
  warnings: string[];
  assignmentPolicy: {
    exactDate: string;
    missingDate: string;
    inferredRowsRemainTraceable: boolean;
    inferredDateInvented: boolean;
  };
  coverageByMonth: Record<string, PublishedCoverage>;
  coverageByOriginalPeriod: Record<string, PublishedCoverage>;
  reconciliation: {
    status: 'matched';
    officialControlPath: string;
    officialTotalEur: number;
    canonicalTotalEur: number;
    differenceEur: number;
    octoberTotalEur: number;
    november1To11TotalEur: number;
    monthConservationEur: number;
    rowsReconciled: number;
  };
};

export type GastappNovemberBoundaryEvidence = {
  status: 'complete_comparable';
  predecessorP30Rows: number;
  predecessorP30NovemberRows: number;
  predecessorP30NovemberAmountEur: number;
  primaryP31NovemberRows: number;
  primaryP31NovemberAmountEur: number;
  candidateRows: number;
  uniqueIdentities: number;
  duplicateIdentities: number;
  novemberRows: number;
  novemberAmountEur: number;
  reconciliationResidualEur: number;
  coverageStartYMD: '2025-11-01';
  coverageEndYMD: '2025-11-30';
};

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const PERIOD_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}__\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^fnv1a64:[0-9a-f]{16}$/;
const SOURCE_TYPES = new Set(['monthly_expense', 'project_expense', 'legacy_csv']);
const ASSIGNMENT_REASONS = new Set(['expense_date', 'project_date', 'legacy_date']);
const RESIDUAL_TOLERANCE_EUR = 0.01;

const cleanEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const sourceError = (code: GastappCalendarSourceErrorCode, message: string, cause?: unknown) =>
  new GastappCalendarSourceError(code, message, cause === undefined ? undefined : { cause });

const mapReadError = (error: unknown, context: string): never => {
  const code = String((error as { code?: unknown })?.code || '');
  if (code === 'permission-denied' || code.endsWith('/permission-denied')) {
    throw sourceError('permission_denied', `${context}: la sesión secundaria no tiene permiso de lectura.`, error);
  }
  throw error;
};

const defaultReadDocument = async (path: string) => {
  const db = getGastappFirestore();
  if (!db) throw sourceError('missing_config', 'Firestore secundario de GastApp no está configurado.');
  try {
    const snapshot = await getDoc(doc(db as Firestore, path));
    return snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null;
  } catch (error) {
    return mapReadError(error, path);
  }
};

const defaultDependencies: GastappCalendarSourceDependencies = {
  configuredProjectId: getGastappConfiguredProjectId,
  primaryUser: () => auth.currentUser,
  secondaryUser: waitForGastappAuthUser,
  signInSecondary: signInWithGastappGoogle,
  ensureSecondaryPersistence: ensureGastappAuthPersistence,
  readDocument: defaultReadDocument,
};

const assertConfiguredProject = (dependencies: GastappCalendarSourceDependencies) => {
  const projectId = String(dependencies.configuredProjectId() || '').trim();
  if (!projectId) throw sourceError('missing_config', 'Falta configurar el Firebase secundario de GastApp.');
  if (projectId !== GASTAPP_CALENDAR_SOURCE_PROJECT_ID) {
    throw sourceError('wrong_project', `El Firebase secundario configurado es ${projectId}; se esperaba ${GASTAPP_CALENDAR_SOURCE_PROJECT_ID}.`);
  }
};

const assertMatchingEmails = (primary: AuthUserLike, secondary: AuthUserLike) => {
  const primaryEmail = cleanEmail(primary?.email);
  const secondaryEmail = cleanEmail(secondary?.email);
  if (!primaryEmail) throw sourceError('primary_email_missing', 'La sesión principal de Aurum no tiene correo verificable.');
  if (!secondaryEmail) throw sourceError('secondary_email_missing', 'La sesión secundaria de GastApp no tiene correo verificable.');
  if (primaryEmail !== secondaryEmail) {
    throw sourceError('email_mismatch', `Aurum está autenticado como ${primaryEmail}, pero GastApp como ${secondaryEmail}.`);
  }
  return secondaryEmail;
};

const assertAuthorizedUser = async (email: string, dependencies: GastappCalendarSourceDependencies) => {
  let access: Record<string, unknown> | null;
  try {
    access = await dependencies.readDocument(`authorized_users/${email}`);
  } catch (error) {
    return mapReadError(error, 'authorized_users');
  }
  if (!access) throw sourceError('unauthorized_user', `El correo ${email} no figura en authorized_users de GastApp.`);
  if (access.active !== true) throw sourceError('inactive_user', `El acceso de ${email} está inactivo en GastApp.`);
};

export const authenticateGastappCalendarSourceV1 = async (
  dependencies: GastappCalendarSourceDependencies = defaultDependencies,
) => {
  assertConfiguredProject(dependencies);
  await dependencies.ensureSecondaryPersistence();
  let secondary = await dependencies.secondaryUser();
  if (!secondary) {
    try {
      secondary = await dependencies.signInSecondary();
    } catch (error) {
      throw sourceError('secondary_auth_failed', 'No se pudo iniciar la sesión explícita del Firebase secundario de GastApp.', error);
    }
  }
  const email = assertMatchingEmails(dependencies.primaryUser(), secondary);
  await assertAuthorizedUser(email, dependencies);
  return { email };
};

const requireGastappCalendarSourceAccess = async (dependencies: GastappCalendarSourceDependencies) => {
  assertConfiguredProject(dependencies);
  const secondary = await dependencies.secondaryUser();
  if (!secondary) {
    throw sourceError('secondary_auth_required', 'Debes conectar explícitamente la cuenta de GastApp antes de leer la fuente calendario.');
  }
  const email = assertMatchingEmails(dependencies.primaryUser(), secondary);
  await assertAuthorizedUser(email, dependencies);
  return email;
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
};

const fnv1a64 = (input: string) => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
};

export const calculateGastappCalendarSourceHash = (snapshot: Record<string, unknown>) => {
  const rows = Array.isArray(snapshot.rows) ? [...snapshot.rows] as GastappCanonicalExpense[] : [];
  rows.sort((left, right) =>
    String(left.canonicalRowId || '').localeCompare(String(right.canonicalRowId || '')) ||
    String(left.transactionDate || '').localeCompare(String(right.transactionDate || '')),
  );
  const content = {
    contract: snapshot.contract,
    schemaVersion: snapshot.schemaVersion,
    methodologyVersion: snapshot.methodologyVersion,
    sourceCommit: snapshot.sourceCommit,
    currentPath: snapshot.currentPath,
    closingConfig: snapshot.closingConfig,
    coveredRange: snapshot.coveredRange,
    latestClosedMonthKey: snapshot.latestClosedMonthKey,
    counts: snapshot.counts,
    duplicates: snapshot.duplicates,
    warnings: snapshot.warnings,
    coverageByMonth: snapshot.coverageByMonth,
    coverageByOriginalPeriod: snapshot.coverageByOriginalPeriod,
    reconciliation: snapshot.reconciliation,
    rows,
  };
  return `fnv1a64:${fnv1a64(stableStringify(content))}`;
};

const assertManifestShape = (value: Record<string, unknown>, context: 'current' | 'snapshot') => {
  if (
    value.contract !== GASTAPP_CALENDAR_SOURCE_CONTRACT ||
    value.schemaVersion !== GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION ||
    value.methodologyVersion !== GASTAPP_CALENDAR_SOURCE_METHODOLOGY_VERSION ||
    value.publicationState !== 'complete' ||
    typeof value.sourceCommit !== 'string' || !value.sourceCommit.trim() ||
    typeof value.generatedAt !== 'string' || !value.generatedAt.trim() ||
    typeof value.snapshotId !== 'string' || !value.snapshotId.trim() ||
    typeof value.snapshotPath !== 'string' || !value.snapshotPath.trim() ||
    value.currentPath !== GASTAPP_CALENDAR_SOURCE_CURRENT_PATH ||
    typeof value.hash !== 'string' || !HASH_PATTERN.test(value.hash)
  ) {
    throw sourceError(context === 'current' ? 'current_pointer_invalid' : 'snapshot_invalid', `${context}: contrato o manifest inválido.`);
  }
};

const assertSnapshotPath = (path: string, snapshotId: string) => {
  const expected = `${GASTAPP_CALENDAR_SOURCE_COLLECTION}/${snapshotId}`;
  if (path !== expected || !snapshotId.startsWith('source_v1_snapshot_fnv1a64_')) {
    throw sourceError('snapshot_path_invalid', `snapshotPath no pertenece al contrato privado esperado: ${path}`);
  }
};

const validDate = (value: unknown) => {
  if (!DATE_PATTERN.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const buildCoverage = (rows: readonly GastappCanonicalExpense[], selector: (row: GastappCanonicalExpense) => string | null) => {
  const coverage: Record<string, PublishedCoverage> = {};
  rows.forEach((row) => {
    const key = selector(row);
    if (!key) return;
    const bucket = coverage[key] || { rowCount: 0, includedRowCount: 0, amountNormalized: 0 };
    bucket.rowCount += 1;
    if (row.includedInCanonicalTotals) {
      bucket.includedRowCount += 1;
      bucket.amountNormalized = round2(bucket.amountNormalized + Number(row.amountNormalized || 0));
    }
    coverage[key] = bucket;
  });
  return Object.fromEntries(Object.entries(coverage).sort(([left], [right]) => left.localeCompare(right)));
};

const assertRows = (rows: readonly GastappCanonicalExpense[], manifest: GastappCalendarSourceManifestV1) => {
  const baseErrors: string[] = [];
  rows.forEach((row, index) => {
    const position = `row[${index}]`;
    if (!SOURCE_TYPES.has(row.sourceType)) baseErrors.push(`${position}:sourceType`);
    if (!row.originalState?.trim()) baseErrors.push(`${position}:originalState`);
    if (row.transactionDate !== null && !validDate(row.transactionDate)) baseErrors.push(`${position}:transactionDate`);
    if (row.accountingDate !== null && !validDate(row.accountingDate)) baseErrors.push(`${position}:accountingDate`);
    if (row.includedInCanonicalTotals) {
      if (!row.transactionDate || row.calendarMonthKey !== row.transactionDate.slice(0, 7)) baseErrors.push(`${position}:calendarMonthKey`);
      if (!PERIOD_KEY_PATTERN.test(String(row.periodKeyOriginal || ''))) baseErrors.push(`${position}:periodKeyOriginal`);
      if (!ASSIGNMENT_REASONS.has(String(row.periodAssignmentReason))) baseErrors.push(`${position}:periodAssignmentReason`);
    }
  });
  const validation = validateGastappCalendarShadowRows(rows);
  if (baseErrors.length || validation.status === 'blocked') {
    throw sourceError('snapshot_rows_invalid', `Filas inválidas: ${[...baseErrors, ...validation.errors].slice(0, 5).join(', ')}`);
  }
  const identities = new Set(rows.map((row) => row.canonicalRowId));
  const includedRows = rows.filter((row) => row.includedInCanonicalTotals);
  const normalizationCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.normalizationStatus] = (acc[row.normalizationStatus] || 0) + 1;
    return acc;
  }, {});
  if (
    manifest.counts.totalRows !== rows.length ||
    manifest.counts.includedRows !== includedRows.length ||
    manifest.counts.canonicalIdentities !== identities.size ||
    manifest.counts.duplicateIdentities !== validation.duplicateIdentityCount ||
    manifest.counts.duplicateIdentities !== 0 ||
    manifest.duplicates.length !== 0 ||
    manifest.counts.warnings !== manifest.warnings.length ||
    manifest.counts.rowsWithMissingFx !== rows.filter((row) => row.normalizationStatus === 'fx_missing').length ||
    stableStringify(manifest.counts.byNormalizationStatus) !== stableStringify(normalizationCounts)
  ) {
    throw sourceError('snapshot_counts_invalid', 'Los conteos del manifest no coinciden con las filas del snapshot.');
  }
  return validation;
};

const isPartialStart = (monthKey: string, transactionDate: string) => transactionDate !== `${monthKey}-01`;
const isPartialEnd = (monthKey: string, transactionDate: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return transactionDate !== `${monthKey}-${String(lastDay).padStart(2, '0')}`;
};

const assertCoverage = (rows: readonly GastappCanonicalExpense[], manifest: GastappCalendarSourceManifestV1) => {
  const coverageByMonth = buildCoverage(rows, (row) => row.calendarMonthKey);
  const coverageByPeriod = buildCoverage(rows, (row) => row.periodKeyOriginal);
  if (
    stableStringify(coverageByMonth) !== stableStringify(manifest.coverageByMonth) ||
    stableStringify(coverageByPeriod) !== stableStringify(manifest.coverageByOriginalPeriod)
  ) {
    throw sourceError('snapshot_coverage_invalid', 'La cobertura publicada no coincide con las filas del snapshot.');
  }
  const range = manifest.coveredRange;
  if (
    !MONTH_KEY_PATTERN.test(range.fromCalendarMonthKey) ||
    !MONTH_KEY_PATTERN.test(range.toCalendarMonthKey) ||
    !validDate(range.fromTransactionDate) ||
    !validDate(range.toTransactionDate) ||
    !PERIOD_KEY_PATTERN.test(range.fromPeriodKey) ||
    !PERIOD_KEY_PATTERN.test(range.toPeriodKey) ||
    !MONTH_KEY_PATTERN.test(manifest.latestClosedMonthKey) ||
    manifest.closingConfig.type !== 'fixed_day' ||
    manifest.closingConfig.source !== 'meta/closing_config' ||
    !Number.isInteger(manifest.closingConfig.closingDay) ||
    manifest.closingConfig.closingDay < 1 || manifest.closingConfig.closingDay > 27
  ) {
    throw sourceError('snapshot_coverage_invalid', 'Rango, mes cerrado o configuración de cierre inválidos.');
  }
  const partialEdgeMonthKeys = [
    isPartialStart(range.fromCalendarMonthKey, range.fromTransactionDate) ? range.fromCalendarMonthKey : null,
    isPartialEnd(range.toCalendarMonthKey, range.toTransactionDate) ? range.toCalendarMonthKey : null,
  ].filter((value): value is string => Boolean(value));
  const enrichedCoverage = Object.fromEntries(Object.entries(coverageByMonth).map(([monthKey, coverage]) => [
    monthKey,
    { ...coverage, status: partialEdgeMonthKeys.includes(monthKey) ? 'partial_edge_month' : 'complete' },
  ])) as Record<string, GastappCalendarMonthCoverage>;
  const comparableMonthKeys = Object.keys(enrichedCoverage)
    .filter((monthKey) => enrichedCoverage[monthKey].status === 'complete' && monthKey <= manifest.latestClosedMonthKey)
    .sort();
  return { coverageByMonth: enrichedCoverage, partialEdgeMonthKeys, comparableMonthKeys };
};

const assertReconciliation = (rows: readonly GastappCanonicalExpense[], manifest: GastappCalendarSourceManifestV1) => {
  const reconciliation = manifest.reconciliation;
  if (
    reconciliation.controlSource !== 'aurum_monthly_from_periods_v1' ||
    !['matched', 'accepted_control_residual'].includes(reconciliation.reconciliationStatus) ||
    reconciliation.status !== reconciliation.reconciliationStatus
  ) {
    throw sourceError('snapshot_reconciliation_invalid', 'La reconciliación no está aprobada para consumo shadow.');
  }
  const actualByPeriod = rows.reduce<Record<string, number>>((acc, row) => {
    if (!row.includedInCanonicalTotals || !row.periodKeyOriginal || !isFiniteNumber(row.amountNormalized)) return acc;
    acc[row.periodKeyOriginal] = round2((acc[row.periodKeyOriginal] || 0) + row.amountNormalized);
    return acc;
  }, {});
  for (const row of reconciliation.rows) {
    const actual = round2(actualByPeriod[row.periodKey] || 0);
    const difference = row.expectedAmountNormalized === null ? null : round2(actual - row.expectedAmountNormalized);
    if (actual !== row.actualAmountNormalized || difference !== row.difference || row.status === 'missing_control') {
      throw sourceError('snapshot_reconciliation_invalid', `Reconciliación inconsistente para P${row.periodNumber}.`);
    }
  }
  const canonicalTotal = round2(Object.values(actualByPeriod).reduce((sum, amount) => sum + amount, 0));
  if (canonicalTotal !== reconciliation.canonicalTotalEur || canonicalTotal !== reconciliation.actualTotalAmountNormalized) {
    throw sourceError('snapshot_reconciliation_invalid', 'El total canónico no coincide con la reconciliación.');
  }
  const residuals = Object.values(reconciliation.residualByPeriod);
  if (reconciliation.reconciliationStatus === 'accepted_control_residual') {
    if (
      reconciliation.residualEur === null ||
      Math.abs(reconciliation.residualEur) > RESIDUAL_TOLERANCE_EUR + Number.EPSILON ||
      residuals.some((value) => Math.abs(value) > RESIDUAL_TOLERANCE_EUR + Number.EPSILON)
    ) {
      throw sourceError('snapshot_reconciliation_invalid', 'El residual aceptado excede €0,01.');
    }
  }
};

export const validateGastappCalendarSourceV1 = (
  currentRaw: Record<string, unknown>,
  snapshotRaw: Record<string, unknown>,
) => {
  assertManifestShape(currentRaw, 'current');
  assertManifestShape(snapshotRaw, 'snapshot');
  const current = currentRaw as unknown as GastappCalendarSourceManifestV1;
  const sourceManifest = snapshotRaw as unknown as GastappCalendarSourceManifestV1;
  assertSnapshotPath(current.snapshotPath, current.snapshotId);
  assertSnapshotPath(sourceManifest.snapshotPath, sourceManifest.snapshotId);
  if (
    current.hash !== sourceManifest.hash ||
    current.snapshotId !== sourceManifest.snapshotId ||
    current.snapshotPath !== sourceManifest.snapshotPath
  ) {
    throw sourceError('current_pointer_invalid', 'El puntero current no coincide con el snapshot publicado.');
  }
  if (!Array.isArray(snapshotRaw.rows)) throw sourceError('snapshot_invalid', 'El snapshot no contiene rows.');
  const calculatedHash = calculateGastappCalendarSourceHash(snapshotRaw);
  if (calculatedHash !== sourceManifest.hash) {
    throw sourceError('snapshot_hash_invalid', `Hash inválido: calculado ${calculatedHash}, publicado ${sourceManifest.hash}.`);
  }
  const rows = snapshotRaw.rows as GastappCanonicalExpense[];
  const validation = assertRows(rows, sourceManifest);
  const coverage = assertCoverage(rows, sourceManifest);
  assertReconciliation(rows, sourceManifest);
  const monthKeys = Object.keys(validation.totalsByCalendarMonth).sort();
  const snapshot: GastappCalendarShadowSnapshot = {
    manifest: {
      schemaVersion: GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION,
      sourceKind: 'stable',
      sourceCommit: sourceManifest.sourceCommit,
      generatedAt: sourceManifest.generatedAt,
      readinessStatus: validation.warnings.length ? 'warning' : 'ready',
      firstMonthKey: monthKeys[0] || null,
      lastMonthKey: monthKeys.at(-1) || null,
      totalRowCount: rows.length,
      uniqueIdentityCount: validation.uniqueIdentityCount,
      duplicateIdentityCount: validation.duplicateIdentityCount,
      totalsByCalendarMonth: validation.totalsByCalendarMonth,
      comparableMonthKeys: coverage.comparableMonthKeys,
      partialEdgeMonthKeys: coverage.partialEdgeMonthKeys,
      sourceHash: sourceManifest.hash,
      methodologyVersion: sourceManifest.methodologyVersion,
      closingDay: sourceManifest.closingConfig.closingDay,
      latestClosedMonthKey: sourceManifest.latestClosedMonthKey,
      coverageByMonth: coverage.coverageByMonth,
    },
    rows,
  };
  return { sourceManifest, snapshot, ...coverage };
};

const assertPredecessorManifest = (
  raw: Record<string, unknown>,
  primaryHash: string,
  context: 'current' | 'snapshot',
) => {
  const manifest = raw as unknown as GastappCalendarPredecessorP30Manifest;
  if (
    manifest.contract !== GASTAPP_CALENDAR_SOURCE_CONTRACT ||
    manifest.schemaVersion !== GASTAPP_CALENDAR_SHADOW_SCHEMA_VERSION ||
    manifest.methodologyVersion !== GASTAPP_CALENDAR_PREDECESSOR_P30_METHODOLOGY ||
    manifest.sourceRole !== 'historical_predecessor' ||
    manifest.publicationState !== 'complete' ||
    manifest.currentPath !== GASTAPP_CALENDAR_PREDECESSOR_P30_CURRENT_PATH ||
    manifest.snapshotPath !== GASTAPP_CALENDAR_PREDECESSOR_P30_SNAPSHOT_PATH ||
    manifest.snapshotId !== GASTAPP_CALENDAR_PREDECESSOR_P30_SNAPSHOT_PATH.split('/').at(-1) ||
    manifest.hash !== GASTAPP_CALENDAR_PREDECESSOR_P30_HASH ||
    manifest.primaryCurrentPath !== GASTAPP_CALENDAR_SOURCE_CURRENT_PATH ||
    manifest.primaryCurrentHashAtPublication !== primaryHash ||
    manifest.replacesPrimaryCurrent !== false ||
    manifest.periodKey !== 'P30' ||
    manifest.periodNumber !== 30 ||
    manifest.periodStartYMD !== '2025-10-12' ||
    manifest.periodEndYMD !== '2025-11-11' ||
    manifest.coveredRange?.fromCalendarMonthKey !== '2025-10' ||
    manifest.coveredRange?.toCalendarMonthKey !== '2025-11' ||
    manifest.coveredRange?.fromTransactionDate !== '2025-10-12' ||
    manifest.coveredRange?.toTransactionDate !== '2025-11-11' ||
    manifest.coveredRange?.fromPeriodKey !== 'P30' ||
    manifest.coveredRange?.toPeriodKey !== 'P30' ||
    manifest.closingConfig?.closingDay !== 11 ||
    manifest.closingConfig?.type !== 'fixed_day' ||
    manifest.closingConfig?.source !== 'meta/closing_config'
  ) {
    throw sourceError('predecessor_invalid', `${context}: manifest P30 incompatible o no vinculado al snapshot primario.`);
  }
  return manifest;
};

export const validateGastappCalendarPredecessorP30 = (
  currentRaw: Record<string, unknown>,
  snapshotRaw: Record<string, unknown>,
  primaryHash: string,
) => {
  const current = assertPredecessorManifest(currentRaw, primaryHash, 'current');
  const predecessorManifest = assertPredecessorManifest(snapshotRaw, primaryHash, 'snapshot');
  if (
    current.hash !== predecessorManifest.hash ||
    current.snapshotId !== predecessorManifest.snapshotId ||
    current.snapshotPath !== predecessorManifest.snapshotPath
  ) {
    throw sourceError('predecessor_invalid', 'El puntero P30 no coincide con su snapshot publicado.');
  }
  if (!Array.isArray(snapshotRaw.rows)) throw sourceError('predecessor_invalid', 'El snapshot P30 no contiene rows.');
  const rows = snapshotRaw.rows as GastappCanonicalExpense[];
  const identities = rows.map((row) => String(row.canonicalRowId || ''));
  const uniqueIdentities = new Set(identities);
  const exactDateRows = rows.filter((row) => row.transactionDate !== null);
  const inferredRows = rows.filter((row) => row.transactionDate === null);
  const errors: string[] = [];
  const allowedSourceTypes = new Set([
    'p1_p30_reconstructed_history',
    'historical_consolidated_import',
    'consolidated_control_delta',
  ]);

  rows.forEach((row, index) => {
    const position = `p30[${index}]`;
    if (!row.canonicalRowId?.trim()) errors.push(`${position}:canonicalRowId`);
    if (!allowedSourceTypes.has(row.sourceType)) errors.push(`${position}:sourceType`);
    if (row.periodKeyOriginal !== 'P30' || row.periodNumberOriginal !== 30) errors.push(`${position}:period`);
    if (!['2025-10', '2025-11'].includes(String(row.calendarMonthKey))) errors.push(`${position}:calendarMonthKey`);
    if (row.normalizationStatus !== 'ready' || row.includedInCanonicalTotals !== true) errors.push(`${position}:status`);
    if (!isFiniteNumber(row.amountNormalized)) errors.push(`${position}:amountNormalized`);
    if (row.transactionDate !== null) {
      if (
        !validDate(row.transactionDate) ||
        row.transactionDate < '2025-10-12' ||
        row.transactionDate > '2025-11-11' ||
        row.calendarMonthKey !== row.transactionDate.slice(0, 7)
      ) errors.push(`${position}:transactionDate`);
    } else if (
      row.calendarMonthKey !== '2025-10' ||
      row.accountingDate !== null ||
      row.assignmentMethod !== 'historical_period_anchor_month' ||
      row.assignmentPrecision !== 'historical_inferred_month' ||
      row.historicalAssignmentWindow?.startYMD !== '2025-10-12' ||
      row.historicalAssignmentWindow?.endYMD !== '2025-10-31' ||
      !row.warnings?.includes('historical_month_assignment_without_invented_day')
    ) {
      errors.push(`${position}:historicalAssignment`);
    }
  });

  const coverageByMonth = buildCoverage(rows, (row) => row.calendarMonthKey);
  const coverageByPeriod = buildCoverage(rows, (row) => row.periodKeyOriginal);
  const total = round2(rows.reduce((sum, row) => sum + Number(row.amountNormalized || 0), 0));
  if (
    errors.length ||
    identities.some((identity) => !identity) ||
    uniqueIdentities.size !== rows.length ||
    rows.length !== 76 ||
    exactDateRows.length !== 74 ||
    inferredRows.length !== 2 ||
    predecessorManifest.counts.totalRows !== 76 ||
    predecessorManifest.counts.includedRows !== 76 ||
    predecessorManifest.counts.canonicalIdentities !== 76 ||
    predecessorManifest.counts.duplicateIdentities !== 0 ||
    predecessorManifest.counts.exactDateRows !== 74 ||
    predecessorManifest.counts.historicallyInferredMonthRows !== 2 ||
    predecessorManifest.duplicates.length !== 0 ||
    stableStringify(coverageByMonth) !== stableStringify(predecessorManifest.coverageByMonth) ||
    stableStringify(coverageByPeriod) !== stableStringify(predecessorManifest.coverageByOriginalPeriod) ||
    total !== 8190.76 ||
    predecessorManifest.reconciliation.status !== 'matched' ||
    predecessorManifest.reconciliation.officialTotalEur !== 8190.76 ||
    predecessorManifest.reconciliation.canonicalTotalEur !== 8190.76 ||
    predecessorManifest.reconciliation.differenceEur !== 0 ||
    predecessorManifest.reconciliation.octoberTotalEur !== 5926.08 ||
    predecessorManifest.reconciliation.november1To11TotalEur !== 2264.68 ||
    predecessorManifest.reconciliation.monthConservationEur !== 8190.76 ||
    predecessorManifest.reconciliation.rowsReconciled !== 76
  ) {
    throw sourceError('predecessor_invalid', `P30 no supera integridad, cobertura o reconciliación: ${errors.slice(0, 5).join(', ')}`);
  }
  return { predecessorManifest, rows, coverageByMonth };
};

export const integrateGastappCalendarPredecessorP30 = (
  primary: ReturnType<typeof validateGastappCalendarSourceV1>,
  predecessor: ReturnType<typeof validateGastappCalendarPredecessorP30>,
) => {
  const p30NovemberRows = predecessor.rows.filter((row) => row.calendarMonthKey === '2025-11');
  const p31NovemberRows = primary.snapshot.rows.filter((row) =>
    row.includedInCanonicalTotals &&
    row.periodKeyOriginal === '2025-11-12__2025-12-11' &&
    row.transactionDate !== null &&
    row.transactionDate >= '2025-11-12' &&
    row.transactionDate <= '2025-11-30',
  );
  const candidates = [...predecessor.rows, ...p31NovemberRows];
  const candidateIdentities = new Set(candidates.map((row) => row.canonicalRowId));
  const allRows = [...predecessor.rows, ...primary.snapshot.rows];
  const allIdentities = new Set(allRows.map((row) => row.canonicalRowId));
  const p30NovemberAmountEur = round2(p30NovemberRows.reduce((sum, row) => sum + Number(row.amountNormalized || 0), 0));
  const p31NovemberAmountEur = round2(p31NovemberRows.reduce((sum, row) => sum + Number(row.amountNormalized || 0), 0));
  const novemberAmountEur = round2(p30NovemberAmountEur + p31NovemberAmountEur);
  const duplicateIdentities = candidates.length - candidateIdentities.size;

  if (
    predecessor.rows.length !== 76 ||
    p31NovemberRows.length !== 41 ||
    candidates.length !== 117 ||
    candidateIdentities.size !== 117 ||
    duplicateIdentities !== 0 ||
    allIdentities.size !== allRows.length ||
    p30NovemberAmountEur !== 2264.68 ||
    p31NovemberAmountEur !== 4465.52 ||
    novemberAmountEur !== 6730.20
  ) {
    throw sourceError('calendar_boundary_invalid', 'La integración P30 + P31 no reconcilia noviembre o contiene identidades duplicadas.');
  }

  const combinedCoverage = buildCoverage(allRows, (row) => row.calendarMonthKey);
  const coverageByMonth = Object.fromEntries(Object.entries(combinedCoverage).map(([monthKey, coverage]) => [
    monthKey,
    {
      ...coverage,
      status: monthKey === '2025-10' || monthKey === '2026-08'
        ? 'partial_edge_month'
        : monthKey === '2025-11'
          ? 'complete_comparable'
          : 'complete',
    },
  ])) as Record<string, GastappCalendarMonthCoverage>;
  if (coverageByMonth['2025-11']?.amountNormalized !== 6730.20) {
    throw sourceError('calendar_boundary_invalid', 'La cobertura combinada de noviembre no coincide con €6.730,20.');
  }
  const partialEdgeMonthKeys = ['2025-10', '2026-08'];
  const comparableMonthKeys = Object.keys(coverageByMonth)
    .filter((monthKey) =>
      ['complete', 'complete_comparable'].includes(coverageByMonth[monthKey].status) &&
      monthKey <= primary.sourceManifest.latestClosedMonthKey,
    )
    .sort();
  const novemberBoundary: GastappNovemberBoundaryEvidence = {
    status: 'complete_comparable',
    predecessorP30Rows: 76,
    predecessorP30NovemberRows: p30NovemberRows.length,
    predecessorP30NovemberAmountEur: p30NovemberAmountEur,
    primaryP31NovemberRows: p31NovemberRows.length,
    primaryP31NovemberAmountEur: p31NovemberAmountEur,
    candidateRows: candidates.length,
    uniqueIdentities: candidateIdentities.size,
    duplicateIdentities,
    novemberRows: p30NovemberRows.length + p31NovemberRows.length,
    novemberAmountEur,
    reconciliationResidualEur: 0,
    coverageStartYMD: '2025-11-01',
    coverageEndYMD: '2025-11-30',
  };
  const snapshot: GastappCalendarShadowSnapshot = {
    manifest: {
      ...primary.snapshot.manifest,
      sourceCommit: `${predecessor.predecessorManifest.sourceCommit}+${primary.sourceManifest.sourceCommit}`,
      generatedAt: primary.sourceManifest.generatedAt,
      readinessStatus: 'ready',
      firstMonthKey: '2025-10',
      totalRowCount: allRows.length,
      uniqueIdentityCount: allIdentities.size,
      duplicateIdentityCount: 0,
      totalsByCalendarMonth: Object.fromEntries(Object.entries(combinedCoverage).map(([monthKey, coverage]) => [monthKey, coverage.amountNormalized])),
      comparableMonthKeys,
      partialEdgeMonthKeys,
      sourceHash: `${predecessor.predecessorManifest.hash}+${primary.sourceManifest.hash}`,
      methodologyVersion: `${GASTAPP_CALENDAR_PREDECESSOR_P30_METHODOLOGY}+${GASTAPP_CALENDAR_SOURCE_METHODOLOGY_VERSION}`,
      coverageByMonth,
    },
    rows: allRows,
  };
  return { snapshot, coverageByMonth, comparableMonthKeys, partialEdgeMonthKeys, novemberBoundary };
};

export const loadGastappCalendarSourceV1 = async (
  dependencies: GastappCalendarSourceDependencies = defaultDependencies,
): Promise<GastappCalendarSourceLoadResult> => {
  const authenticatedEmail = await requireGastappCalendarSourceAccess(dependencies);
  let currentRaw: Record<string, unknown> | null;
  try {
    currentRaw = await dependencies.readDocument(GASTAPP_CALENDAR_SOURCE_CURRENT_PATH);
  } catch (error) {
    return mapReadError(error, GASTAPP_CALENDAR_SOURCE_CURRENT_PATH);
  }
  if (!currentRaw) throw sourceError('current_pointer_missing', 'No existe source_v1_current en GastApp.');
  assertManifestShape(currentRaw, 'current');
  const snapshotPath = String(currentRaw.snapshotPath || '');
  assertSnapshotPath(snapshotPath, String(currentRaw.snapshotId || ''));
  let snapshotRaw: Record<string, unknown> | null;
  try {
    snapshotRaw = await dependencies.readDocument(snapshotPath);
  } catch (error) {
    return mapReadError(error, snapshotPath);
  }
  if (!snapshotRaw) throw sourceError('snapshot_missing', `No existe el snapshot ${snapshotPath}.`);
  const primary = validateGastappCalendarSourceV1(currentRaw, snapshotRaw);
  let predecessorCurrentRaw: Record<string, unknown> | null;
  try {
    predecessorCurrentRaw = await dependencies.readDocument(GASTAPP_CALENDAR_PREDECESSOR_P30_CURRENT_PATH);
  } catch (error) {
    return mapReadError(error, GASTAPP_CALENDAR_PREDECESSOR_P30_CURRENT_PATH);
  }
  if (!predecessorCurrentRaw) throw sourceError('predecessor_missing', 'No existe el puntero predecesor P30 en GastApp.');
  assertPredecessorManifest(predecessorCurrentRaw, primary.sourceManifest.hash, 'current');
  const predecessorSnapshotPath = String(predecessorCurrentRaw.snapshotPath || '');
  let predecessorSnapshotRaw: Record<string, unknown> | null;
  try {
    predecessorSnapshotRaw = await dependencies.readDocument(predecessorSnapshotPath);
  } catch (error) {
    return mapReadError(error, predecessorSnapshotPath);
  }
  if (!predecessorSnapshotRaw) throw sourceError('predecessor_missing', `No existe el snapshot predecesor ${predecessorSnapshotPath}.`);
  const predecessor = validateGastappCalendarPredecessorP30(
    predecessorCurrentRaw,
    predecessorSnapshotRaw,
    primary.sourceManifest.hash,
  );
  const integrated = integrateGastappCalendarPredecessorP30(primary, predecessor);
  return {
    authenticatedEmail,
    sourceManifest: primary.sourceManifest,
    predecessorManifest: predecessor.predecessorManifest,
    ...integrated,
  };
};

export const isGastappSecondaryAuthConfigured = () => Boolean(getGastappAuth());
