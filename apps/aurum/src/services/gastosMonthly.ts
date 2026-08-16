export type GastosMonthStatus = 'complete' | 'pending' | 'missing';
export type GastosContractStatus = GastosMonthStatus | 'stale';
export type GastosMonthSource = 'gastapp_firestore' | 'legacy_static';
export type GastosMonthDataQuality = 'ok' | 'warning' | 'error';

export type GastosMonthResolution = {
  monthKey: string;
  status: GastosMonthStatus;
  gastosEur: number | null;
  source: GastosMonthSource;
  contractStatus?: GastosContractStatus | null;
  dataQuality?: GastosMonthDataQuality | null;
  isStale?: boolean;
  staleReason?: string | null;
  dayToDaySource?: string | null;
  contractSource?: string | null;
  schemaVersion?: string | null;
  methodologyVersion?: string | null;
  periodKey?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  reportUpdatedAt?: string | null;
  summaryUpdatedAt?: string | null;
  lastExpenseUpdatedAt?: string | null;
  revision?: number | null;
  reportTotalEur?: number | null;
  summaryTotalEur?: number | null;
  directExpenseTotalEur?: number | null;
  reportVsDirectDiffEur?: number | null;
  summaryVsDirectDiffEur?: number | null;
  reportVsSummaryDiffEur?: number | null;
  categoryGapEur?: number | null;
  repairedAt?: string | null;
  reason?: 'gastapp_monthly_backfill' | null;
  migratedFrom?: 'legacy_static' | null;
  /** Avance publicado por GastApp. Nunca se usa como gasto oficial sin activar modo P. */
  partialGastosEur?: number | null;
  partialByFamilyEur?: GastappMonthlyFamilyTotalsEur | null;
};

export type GastappMonthlyFamilyTotalsEur = {
  dayToDay: number;
  trips: number;
  others: number;
};

export type GastappMonthlyCloseSnapshotInput = {
  monthKey: string;
  totalEur: number;
  byFamilyEur: GastappMonthlyFamilyTotalsEur;
  canonicalDataHash: string;
  contractHash: string;
  contractVersion: string;
  generatedAt: string;
};

export type GastappMonthlyCloseCandidate = {
  monthKey: string;
  status: 'complete' | 'pending' | 'stale' | 'missing' | 'invalid' | 'unavailable';
  partialGastosEur: number | null;
  partialByFamilyEur: GastappMonthlyFamilyTotalsEur | null;
  snapshot: GastappMonthlyCloseSnapshotInput | null;
  message: string;
};

type GastappMonthlyContableEntry = {
  status: GastosMonthStatus;
  contractStatus: GastosContractStatus | null;
  gastosEur: number | null;
  dataQuality: GastosMonthDataQuality | null;
  isStale: boolean;
  staleReason: string | null;
  dayToDaySource: string | null;
  contractSource: string | null;
  schemaVersion: string | null;
  methodologyVersion: string | null;
  periodKey: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  reportUpdatedAt: string | null;
  summaryUpdatedAt: string | null;
  lastExpenseUpdatedAt: string | null;
  revision: number | null;
  reportTotalEur: number | null;
  summaryTotalEur: number | null;
  directExpenseTotalEur: number | null;
  reportVsDirectDiffEur: number | null;
  summaryVsDirectDiffEur: number | null;
  reportVsSummaryDiffEur: number | null;
  categoryGapEur: number | null;
  repairedAt: string | null;
  reason: 'gastapp_monthly_backfill' | null;
  migratedFrom: 'legacy_static' | null;
  partialGastosEur: number | null;
  partialByFamilyEur: GastappMonthlyFamilyTotalsEur | null;
  canonicalDataHash: string | null;
  contractHash: string | null;
};

export const GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT = 'aurum:gastapp-monthly-source-updated';
const GASTAPP_DIAG_PREFIX = '[AURUM][gastapp-monthly][diag]';
const GASTAPP_MONTHLY_CONTRACT_PATH = 'gastapp_aurum_contracts_v2/months_current';
const GASTAPP_DIAG_ENABLED = Boolean(import.meta.env.DEV || import.meta.env.VITE_GASTAPP_DIAG === '1');
const E2E_GASTAPP_FIXTURE_REASON = 'e2e_gastapp_disabled';
const USE_E2E_GASTAPP_FIXTURE = import.meta.env.VITE_E2E_USE_FIREBASE_EMULATOR === 'true';

const diagInfo = (message: string) => {
  if (!GASTAPP_DIAG_ENABLED) return;
  console.info(message);
};

const diagWarn = (message: string) => {
  if (!GASTAPP_DIAG_ENABLED) return;
  console.warn(message);
};

const gastappMonthlyRuntime: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: 'firestore' | 'e2e_fixture' | null;
  map: Record<string, GastappMonthlyContableEntry>;
  loadPromise: Promise<void> | null;
  error: string | null;
  errorCode: string | null;
  lastUpdatedAt: string | null;
  configuredProjectId: string;
} = {
  status: USE_E2E_GASTAPP_FIXTURE ? 'ready' : 'idle',
  mode: USE_E2E_GASTAPP_FIXTURE ? 'e2e_fixture' : null,
  map: {},
  loadPromise: null,
  error: USE_E2E_GASTAPP_FIXTURE ? E2E_GASTAPP_FIXTURE_REASON : null,
  errorCode: USE_E2E_GASTAPP_FIXTURE ? 'e2e_fixture' : null,
  lastUpdatedAt: USE_E2E_GASTAPP_FIXTURE ? new Date().toISOString() : null,
  configuredProjectId: '',
};

const gastappMonthlyDiag = {
  didLogMode: false,
  lastMarchSignature: '',
};

type GastappFirebaseBridge = {
  getGastappConfiguredProjectId: () => string;
  isGastappFirestoreConfigured: () => boolean;
  isE2EFirebaseEmulatorEnabled: () => boolean;
  getGastappFirestore: () => ReturnType<typeof import('firebase/firestore').getFirestore> | null;
  ensureGastappAuthPersistence: () => Promise<void>;
  waitForGastappAuthUser: () => Promise<{ email?: string | null } | null>;
  signInWithGastappGoogle: () => Promise<{ email?: string | null } | null>;
};

const loadGastappFirebaseBridge = async (): Promise<GastappFirebaseBridge | null> => {
  try {
    const mod = await import('./firebase');
    return {
      getGastappConfiguredProjectId: mod.getGastappConfiguredProjectId,
      isGastappFirestoreConfigured: mod.isGastappFirestoreConfigured,
      isE2EFirebaseEmulatorEnabled: mod.isE2EFirebaseEmulatorEnabled,
      getGastappFirestore: mod.getGastappFirestore,
      ensureGastappAuthPersistence: mod.ensureGastappAuthPersistence,
      waitForGastappAuthUser: mod.waitForGastappAuthUser,
      signInWithGastappGoogle: mod.signInWithGastappGoogle,
    };
  } catch (error: any) {
    gastappMonthlyRuntime.error = `gastapp_firebase_bridge_unavailable:${String(error?.message || error || 'unknown_error')}`;
    gastappMonthlyRuntime.errorCode = String(error?.code || 'bridge_unavailable');
    return null;
  }
};

const loadGastappCanonicalMonthContract = async () => {
  const mod = await import('./gastappCanonicalV2');
  return mod.loadGastappCanonicalV2MonthContractCached();
};

const parseMonthKey = (monthKey: string): { year: number; month: number } | null => {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
};

const monthCloseCutoff = (monthKey: string, closingDay = 11): Date | null => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  // Regla operativa: el mes YYYY-MM queda "cerrado" desde el día 12 del mes siguiente.
  const nextMonthIndex = parsed.month; // Date usa base 0
  return new Date(parsed.year, nextMonthIndex, closingDay + 1, 0, 0, 0, 0);
};

export const isGastappMonthClosed = (monthKey: string, now = new Date(), closingDay = 11): boolean => {
  const cutoff = monthCloseCutoff(monthKey, closingDay);
  if (!cutoff) return false;
  return now.getTime() >= cutoff.getTime();
};

const inferStatusWithoutTotal = (monthKey: string, now: Date): GastosMonthStatus =>
  isGastappMonthClosed(monthKey, now) ? 'missing' : 'pending';

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const readNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readMonthFamilies = (raw: Record<string, number>): GastappMonthlyFamilyTotalsEur | null => {
  const dayToDay = readNumber(raw.day_to_day);
  const trips = readNumber(raw.trips);
  const others = readNumber(raw.others);
  if (
    dayToDay === null ||
    trips === null ||
    others === null ||
    dayToDay < 0 ||
    trips < 0 ||
    others < 0
  ) {
    return null;
  }
  return { dayToDay, trips, others };
};

const hasFamilyTotalMatch = (
  totalEur: number | null,
  families: GastappMonthlyFamilyTotalsEur | null,
) =>
  totalEur !== null &&
  totalEur >= 0 &&
  !!families &&
  Math.abs(totalEur - families.dayToDay - families.trips - families.others) <= 0.01;

// The old static map contains period totals labelled as months. It must never be
// used as an official fallback for the calendar contract.
const resolveFromE2EFixture = (monthKey: string, now: Date): GastosMonthResolution => {
  if (gastappMonthlyRuntime.error === E2E_GASTAPP_FIXTURE_REASON) {
    const parsed = parseMonthKey(monthKey);
    const monthIndex = parsed ? parsed.year * 12 + parsed.month : 0;
    const gastosEur = 2_400 + (monthIndex % 12) * 45;
    return {
      monthKey,
      status: 'complete',
      gastosEur,
      source: 'gastapp_firestore',
      contractStatus: 'complete',
      dataQuality: 'ok',
      isStale: false,
      staleReason: null,
      dayToDaySource: 'e2e_fixture',
      contractSource: 'e2e_fixture',
      partialGastosEur: gastosEur,
      partialByFamilyEur: { dayToDay: gastosEur, trips: 0, others: 0 },
    };
  }

  return {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'gastapp_firestore',
    contractStatus: null,
    dataQuality: null,
    isStale: false,
    staleReason: 'calendar_contract_unavailable',
    dayToDaySource: null,
    contractSource: 'aurum_monthly_calendar_v2',
    partialGastosEur: null,
    partialByFamilyEur: null,
  };
};

const resolveCanonicalUnavailable = (monthKey: string, now: Date): GastosMonthResolution => ({
  monthKey,
  status: inferStatusWithoutTotal(monthKey, now),
  gastosEur: null,
  source: 'gastapp_firestore',
  contractStatus: null,
  dataQuality: null,
  isStale: false,
  staleReason: null,
  dayToDaySource: null,
  contractSource: null,
  partialGastosEur: null,
  partialByFamilyEur: null,
});

const isValidMonthKey = (value: string) => /^\d{4}-\d{2}$/.test(value);

const emitGastappSourceUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GASTAPP_MONTHLY_SOURCE_UPDATED_EVENT));
};

const configuredProjectIdForLogs = () => gastappMonthlyRuntime.configuredProjectId || 'n/a';

const markGastappMonthlyUnavailable = (errorCode: string, error: string) => {
  gastappMonthlyRuntime.status = 'ready';
  gastappMonthlyRuntime.mode = null;
  gastappMonthlyRuntime.error = error;
  gastappMonthlyRuntime.errorCode = errorCode;
  gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
  emitGastappSourceUpdated();
};

const resetGastappMonthlyRuntime = () => {
  gastappMonthlyRuntime.status = 'idle';
  gastappMonthlyRuntime.mode = null;
  gastappMonthlyRuntime.map = {};
  gastappMonthlyRuntime.loadPromise = null;
  gastappMonthlyRuntime.error = null;
  gastappMonthlyRuntime.errorCode = null;
  gastappMonthlyRuntime.lastUpdatedAt = null;
};

const logSourceModeOnce = () => {
  if (gastappMonthlyDiag.didLogMode) return;
  if (gastappMonthlyRuntime.mode === 'firestore') {
    diagInfo(
      `${GASTAPP_DIAG_PREFIX} source=gastapp_firestore projectId_configured=${configuredProjectIdForLogs()}`,
    );
    gastappMonthlyDiag.didLogMode = true;
    return;
  }
  if (gastappMonthlyRuntime.mode === 'e2e_fixture') {
    const message = `${GASTAPP_DIAG_PREFIX} source=e2e_fixture reason=${gastappMonthlyRuntime.error || 'unknown'} projectId_configured=${configuredProjectIdForLogs()}`;
    if (gastappMonthlyRuntime.error === E2E_GASTAPP_FIXTURE_REASON) {
      diagInfo(message);
    } else {
      console.error(message);
    }
    gastappMonthlyDiag.didLogMode = true;
  }
};

const logMarchResolutionIfNeeded = (
  origin: 'firestore' | 'e2e_fixture',
  resolution: GastosMonthResolution,
  reason: string,
) => {
  if (resolution.monthKey !== '2026-03') return;
  const signature = `${origin}|${resolution.source}|${resolution.status}|${resolution.gastosEur ?? 'null'}|${reason}|${gastappMonthlyRuntime.mode}|${gastappMonthlyRuntime.status}|${gastappMonthlyRuntime.error || 'none'}`;
  if (gastappMonthlyDiag.lastMarchSignature === signature) return;
  gastappMonthlyDiag.lastMarchSignature = signature;
  diagWarn(
    `${GASTAPP_DIAG_PREFIX} month=2026-03 source=${resolution.source} status=${resolution.status} total_contable_eur=${resolution.gastosEur ?? 'null'} reason=${reason} runtime_mode=${gastappMonthlyRuntime.mode || 'n/a'} runtime_status=${gastappMonthlyRuntime.status} runtime_error=${gastappMonthlyRuntime.error || 'none'}`,
  );
};

const resolveFromFirestore = (monthKey: string, now: Date): GastosMonthResolution => {
  const fromMap = gastappMonthlyRuntime.map[monthKey];
  if (fromMap) {
    const resolution: GastosMonthResolution = {
      monthKey,
      status: fromMap.status,
      gastosEur: fromMap.gastosEur,
      source: 'gastapp_firestore',
      contractStatus: fromMap.contractStatus,
      dataQuality: fromMap.dataQuality,
      isStale: fromMap.isStale,
      staleReason: fromMap.staleReason,
      dayToDaySource: fromMap.dayToDaySource,
      contractSource: fromMap.contractSource,
      schemaVersion: fromMap.schemaVersion,
      methodologyVersion: fromMap.methodologyVersion,
      periodKey: fromMap.periodKey,
      publishedAt: fromMap.publishedAt,
      updatedAt: fromMap.updatedAt,
      closedAt: fromMap.closedAt,
      reportUpdatedAt: fromMap.reportUpdatedAt,
      summaryUpdatedAt: fromMap.summaryUpdatedAt,
      lastExpenseUpdatedAt: fromMap.lastExpenseUpdatedAt,
      revision: fromMap.revision,
      reportTotalEur: fromMap.reportTotalEur,
      summaryTotalEur: fromMap.summaryTotalEur,
      directExpenseTotalEur: fromMap.directExpenseTotalEur,
      reportVsDirectDiffEur: fromMap.reportVsDirectDiffEur,
      summaryVsDirectDiffEur: fromMap.summaryVsDirectDiffEur,
      reportVsSummaryDiffEur: fromMap.reportVsSummaryDiffEur,
      categoryGapEur: fromMap.categoryGapEur,
      repairedAt: fromMap.repairedAt,
      reason: fromMap.reason,
      migratedFrom: fromMap.migratedFrom,
      partialGastosEur: fromMap.partialGastosEur,
      partialByFamilyEur: fromMap.partialByFamilyEur,
    };
    logMarchResolutionIfNeeded('firestore', resolution, 'doc_found_in_firestore');
    return resolution;
  }

  const resolution: GastosMonthResolution = {
    monthKey,
    status: inferStatusWithoutTotal(monthKey, now),
    gastosEur: null,
    source: 'gastapp_firestore',
    contractStatus: null,
    dataQuality: null,
    isStale: false,
    staleReason: null,
    dayToDaySource: null,
    contractSource: null,
    partialGastosEur: null,
    partialByFamilyEur: null,
  };
  const reason =
    gastappMonthlyRuntime.status === 'ready'
      ? 'doc_not_found_in_firestore_cache'
      : `firestore_runtime_${gastappMonthlyRuntime.status}`;
  logMarchResolutionIfNeeded('firestore', resolution, reason);
  return resolution;
};

const loadGastappMonthlyContable = async () => {
  if (gastappMonthlyRuntime.status === 'loading' && gastappMonthlyRuntime.loadPromise) {
    return gastappMonthlyRuntime.loadPromise;
  }
  if (gastappMonthlyRuntime.status === 'ready') return;

  gastappMonthlyRuntime.status = 'loading';
  gastappMonthlyRuntime.error = null;
  gastappMonthlyRuntime.errorCode = null;
  gastappMonthlyRuntime.loadPromise = (async () => {
    const firebaseBridge = await loadGastappFirebaseBridge();
    if (!firebaseBridge) {
      markGastappMonthlyUnavailable(
        gastappMonthlyRuntime.errorCode || 'bridge_unavailable',
        gastappMonthlyRuntime.error || 'No pude iniciar la conexión de GastApp.',
      );
      logSourceModeOnce();
      return;
    }

    if (firebaseBridge.isE2EFirebaseEmulatorEnabled()) {
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'e2e_fixture';
      gastappMonthlyRuntime.error = E2E_GASTAPP_FIXTURE_REASON;
      gastappMonthlyRuntime.errorCode = 'e2e_fixture';
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      logSourceModeOnce();
      emitGastappSourceUpdated();
      return;
    }

    gastappMonthlyRuntime.configuredProjectId = String(firebaseBridge.getGastappConfiguredProjectId() || '');
    const firestoreConfigured = firebaseBridge.isGastappFirestoreConfigured();
    diagInfo(
      `${GASTAPP_DIAG_PREFIX} loading_start firestore_configured=${firestoreConfigured} projectId_configured=${configuredProjectIdForLogs()}`,
    );

    if (!firestoreConfigured) {
      markGastappMonthlyUnavailable('missing_config', 'gastapp_firestore_not_configured');
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=gastapp_canonical_v2_unavailable reason=gastapp_firestore_not_configured projectId_configured=${configuredProjectIdForLogs()}`,
      );
      logSourceModeOnce();
      return;
    }

    let secondaryUser: { email?: string | null } | null;
    try {
      secondaryUser = await firebaseBridge.waitForGastappAuthUser();
    } catch (error: any) {
      markGastappMonthlyUnavailable(
        'secondary_auth_unavailable',
        `gastapp_secondary_auth_unavailable:${String(error?.message || error || 'unknown_error')}`,
      );
      logSourceModeOnce();
      return;
    }

    if (!secondaryUser) {
      markGastappMonthlyUnavailable(
        'secondary_auth_required',
        'Conecta la cuenta autorizada de GastApp para leer el resumen mensual oficial.',
      );
      diagInfo(`${GASTAPP_DIAG_PREFIX} source=gastapp_canonical_v2_unavailable reason=secondary_auth_required`);
      logSourceModeOnce();
      return;
    }

    const db = firebaseBridge.getGastappFirestore();
    if (!db) {
      markGastappMonthlyUnavailable('unavailable', 'gastapp_firestore_unavailable');
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=gastapp_canonical_v2_unavailable reason=gastapp_firestore_unavailable projectId_configured=${configuredProjectIdForLogs()}`,
      );
      logSourceModeOnce();
      return;
    }

    try {
      const runtimeProjectId = String(db.app.options.projectId || '');
      diagInfo(
        `${GASTAPP_DIAG_PREFIX} read_start document=${GASTAPP_MONTHLY_CONTRACT_PATH} projectId_runtime=${runtimeProjectId || 'n/a'}`,
      );
      const contractResult = await loadGastappCanonicalMonthContract();
      const loaded: Record<string, GastappMonthlyContableEntry> = {};
      contractResult.months.months.forEach((month) => {
        if (!isValidMonthKey(month.calendarMonthKey)) return;
        const isComplete = month.status === 'complete' && month.eligibleForAurumReturns;
        const contractStatus: GastosContractStatus = isComplete
          ? 'complete'
          : month.status === 'stale'
            ? 'stale'
            : month.status === 'pending'
              ? 'pending'
              : 'missing';
        const partialGastosEur = readNumber(month.totalEur);
        const partialByFamilyEur = readMonthFamilies(month.byFamily);
        loaded[month.calendarMonthKey] = {
          status: isComplete ? 'complete' : contractStatus === 'pending' ? 'pending' : 'missing',
          contractStatus,
          gastosEur: isComplete ? month.totalEur : null,
          dataQuality: isComplete ? 'ok' : 'warning',
          isStale: contractStatus === 'stale',
          staleReason: isComplete ? null : month.calendarStatus || month.status,
          dayToDaySource: 'gastapp-canonical-calendar-v2',
          contractSource: contractResult.months.version,
          schemaVersion: contractResult.months.version,
          methodologyVersion: readString(contractResult.months.raw.dateSemantics),
          periodKey: null,
          publishedAt: contractResult.months.generatedAt,
          updatedAt: contractResult.months.generatedAt,
          closedAt: null,
          reportUpdatedAt: null,
          summaryUpdatedAt: null,
          lastExpenseUpdatedAt: null,
          revision: null,
          reportTotalEur: isComplete ? month.totalEur : null,
          summaryTotalEur: isComplete ? month.totalEur : null,
          directExpenseTotalEur: isComplete ? month.totalEur : null,
          reportVsDirectDiffEur: 0,
          summaryVsDirectDiffEur: 0,
          reportVsSummaryDiffEur: 0,
          categoryGapEur: 0,
          repairedAt: null,
          reason: null,
          migratedFrom: null,
          partialGastosEur,
          partialByFamilyEur,
          canonicalDataHash: readString(contractResult.months.canonicalDataHash),
          contractHash: readString(contractResult.months.contractHash),
        };
      });

      gastappMonthlyRuntime.map = loaded;
      gastappMonthlyRuntime.status = 'ready';
      gastappMonthlyRuntime.mode = 'firestore';
      gastappMonthlyRuntime.errorCode = null;
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      logSourceModeOnce();
      const march = loaded['2026-03'] || null;
      diagInfo(
        `${GASTAPP_DIAG_PREFIX} read_done document=${GASTAPP_MONTHLY_CONTRACT_PATH} months=${Object.keys(loaded).length} month_2026_03_found=${Boolean(march)} projectId_runtime=${runtimeProjectId || 'n/a'}`,
      );
      if (march) {
        diagInfo(
          `${GASTAPP_DIAG_PREFIX} month=2026-03 status=${march.status} total_contable_eur=${march.gastosEur ?? 'null'} source=gastapp_firestore`,
        );
      } else {
        const reason = 'month_not_found_in_contract';
        diagWarn(
          `${GASTAPP_DIAG_PREFIX} month=2026-03 not_found reason=${reason}`,
        );
      }
      emitGastappSourceUpdated();
    } catch (error: any) {
      gastappMonthlyRuntime.status = 'error';
      gastappMonthlyRuntime.mode = null;
      gastappMonthlyRuntime.errorCode = String(error?.code || '');
      gastappMonthlyRuntime.error = String(error?.message || error || 'unknown_error');
      gastappMonthlyRuntime.lastUpdatedAt = new Date().toISOString();
      console.error(
        `${GASTAPP_DIAG_PREFIX} source=gastapp_canonical_v2_unavailable reason=document_read_exception error=${gastappMonthlyRuntime.error} projectId_configured=${configuredProjectIdForLogs()}`,
      );
      logSourceModeOnce();
      emitGastappSourceUpdated();
    }
  })()
    .finally(() => {
      gastappMonthlyRuntime.loadPromise = null;
    });

  return gastappMonthlyRuntime.loadPromise;
};

export const warmGastappMonthlyContable = async () => {
  await loadGastappMonthlyContable();
};

/**
 * User-initiated only. It establishes the persisted secondary Firebase session
 * required by GastApp's private monthly contract, then reads the same two
 * cacheable contract documents. It never opens Data Room or queries rows.
 */
export const connectGastappMonthlyContable = async () => {
  const firebaseBridge = await loadGastappFirebaseBridge();
  if (!firebaseBridge) {
    markGastappMonthlyUnavailable(
      gastappMonthlyRuntime.errorCode || 'bridge_unavailable',
      gastappMonthlyRuntime.error || 'No pude iniciar la conexión de GastApp.',
    );
    return getGastappMonthlyRuntimeDiagnostic();
  }
  if (!firebaseBridge.isGastappFirestoreConfigured()) {
    markGastappMonthlyUnavailable('missing_config', 'gastapp_firestore_not_configured');
    return getGastappMonthlyRuntimeDiagnostic();
  }

  try {
    await firebaseBridge.ensureGastappAuthPersistence();
    const existingUser = await firebaseBridge.waitForGastappAuthUser();
    const connectedUser = existingUser || await firebaseBridge.signInWithGastappGoogle();
    // Redirect-based sign-in leaves the current page. Avoid any Firestore read
    // until the redirected page restores the persisted GastApp session.
    if (!connectedUser) return getGastappMonthlyRuntimeDiagnostic();

    const canonical = await import('./gastappCanonicalV2');
    canonical.clearGastappCanonicalV2Cache();
    resetGastappMonthlyRuntime();
    await loadGastappMonthlyContable();
  } catch (error: any) {
    markGastappMonthlyUnavailable(
      'secondary_auth_failed',
      `No pude conectar GastApp: ${String(error?.message || error || 'unknown_error')}`,
    );
  }

  return getGastappMonthlyRuntimeDiagnostic();
};

export type GastappMonthlyRuntimeDiagnostic = {
  contractPath: typeof GASTAPP_MONTHLY_CONTRACT_PATH;
  mode: 'firestore' | 'e2e_fixture' | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  errorCode: string | null;
  docsLoaded: number;
  configuredProjectId: string;
  lastUpdatedAt: string | null;
};

export const getGastappMonthlyRuntimeDiagnostic = (): GastappMonthlyRuntimeDiagnostic => ({
  contractPath: GASTAPP_MONTHLY_CONTRACT_PATH,
  mode: gastappMonthlyRuntime.mode,
  status: gastappMonthlyRuntime.status,
  error: gastappMonthlyRuntime.error,
  errorCode: gastappMonthlyRuntime.errorCode,
  docsLoaded: Object.keys(gastappMonthlyRuntime.map).length,
  configuredProjectId: gastappMonthlyRuntime.configuredProjectId,
  lastUpdatedAt: gastappMonthlyRuntime.lastUpdatedAt,
});

export const resolveGastappMonthlyCloseCandidate = (monthKey: string): GastappMonthlyCloseCandidate => {
  if (gastappMonthlyRuntime.status === 'idle') {
    void loadGastappMonthlyContable();
  }
  if (gastappMonthlyRuntime.error === E2E_GASTAPP_FIXTURE_REASON) {
    const spend = resolveFromE2EFixture(monthKey, new Date());
    const totalEur = spend.gastosEur;
    const byFamilyEur = spend.partialByFamilyEur || null;
    if (totalEur === null || !byFamilyEur) {
      return { monthKey, status: 'unavailable', partialGastosEur: null, partialByFamilyEur: null, snapshot: null, message: 'Fixture local sin gasto mensual.' };
    }
    return {
      monthKey,
      status: 'complete',
      partialGastosEur: totalEur,
      partialByFamilyEur: byFamilyEur,
      snapshot: {
        monthKey,
        totalEur,
        byFamilyEur,
        canonicalDataHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        contractHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        contractVersion: 'e2e_fixture',
        generatedAt: gastappMonthlyRuntime.lastUpdatedAt || new Date().toISOString(),
      },
      message: 'Fixture local de GastApp listo para cierre.',
    };
  }
  if (gastappMonthlyRuntime.mode !== 'firestore' || gastappMonthlyRuntime.status !== 'ready') {
    return {
      monthKey,
      status: 'unavailable',
      partialGastosEur: null,
      partialByFamilyEur: null,
      snapshot: null,
      message: 'Aurum aún no pudo leer months_current de GastApp.',
    };
  }
  const entry = gastappMonthlyRuntime.map[monthKey];
  if (!entry) {
    return { monthKey, status: 'missing', partialGastosEur: null, partialByFamilyEur: null, snapshot: null, message: 'GastApp no publicó este mes en months_current.' };
  }
  const status = entry.contractStatus || 'missing';
  const familiesMatch = hasFamilyTotalMatch(entry.partialGastosEur, entry.partialByFamilyEur);
  const hasIdentity = Boolean(entry.canonicalDataHash && entry.contractHash && entry.contractSource && entry.publishedAt);
  if (status === 'complete' && familiesMatch && hasIdentity && entry.partialGastosEur !== null && entry.partialByFamilyEur) {
    return {
      monthKey,
      status: 'complete',
      partialGastosEur: entry.partialGastosEur,
      partialByFamilyEur: entry.partialByFamilyEur,
      snapshot: {
        monthKey,
        totalEur: entry.partialGastosEur,
        byFamilyEur: entry.partialByFamilyEur,
        canonicalDataHash: entry.canonicalDataHash!,
        contractHash: entry.contractHash!,
        contractVersion: entry.contractSource!,
        generatedAt: entry.publishedAt!,
      },
      message: 'Cierre mensual oficial de GastApp disponible.',
    };
  }
  if (status === 'complete') {
    return {
      monthKey,
      status: 'invalid',
      partialGastosEur: entry.partialGastosEur,
      partialByFamilyEur: entry.partialByFamilyEur,
      snapshot: null,
      message: 'El cierre de GastApp no tiene identidad o familias conciliadas.',
    };
  }
  return {
    monthKey,
    status,
    partialGastosEur: entry.partialGastosEur,
    partialByFamilyEur: entry.partialByFamilyEur,
    snapshot: null,
    message: status === 'pending'
      ? 'GastApp publicó un avance parcial; falta el cierre oficial del mes.'
      : status === 'stale'
        ? 'GastApp marcó este mes como stale; no se puede cerrar.'
        : 'GastApp no publicó un cierre mensual válido.',
  };
};

export type GastappMonthlyBackfillCandidate = {
  monthKey: string;
  gastosEur: number;
  source: 'legacy_static';
  reason: 'missing_canonical_doc';
};

export const previewGastappMonthlyLegacyBackfill = async (
  monthKeys?: string[],
): Promise<{
  status: 'ready' | 'unavailable';
  sourceMode: 'firestore' | 'e2e_fixture' | null;
  candidates: GastappMonthlyBackfillCandidate[];
  skipped: Array<{ monthKey: string; reason: 'canonical_exists' | 'no_legacy_value' }>;
  error: string | null;
}> => {
  await loadGastappMonthlyContable();
  const keys = monthKeys?.length ? monthKeys : [];
  return {
    status: 'unavailable',
    sourceMode: gastappMonthlyRuntime.mode,
    candidates: [],
    skipped: keys.map((monthKey) => ({ monthKey, reason: 'no_legacy_value' as const })),
    error: 'period_legacy_backfill_disabled_for_calendar_contract',
  };
};

export const backfillGastappMonthlyFromLegacy = async (
  monthKeys: string[],
): Promise<{
  backfilled: Array<{ monthKey: string; gastosEur: number; repairedAt: string }>;
  skipped: Array<{ monthKey: string; reason: 'period_legacy_backfill_disabled' }>;
}> => {
  return {
    backfilled: [],
    skipped: monthKeys.map((monthKey) => ({ monthKey, reason: 'period_legacy_backfill_disabled' as const })),
  };
};

export const resolveGastappMonthlySpend = (monthKey: string, now = new Date()): GastosMonthResolution => {
  if (gastappMonthlyRuntime.status === 'idle') {
    void loadGastappMonthlyContable();
  }

  if (gastappMonthlyRuntime.error === E2E_GASTAPP_FIXTURE_REASON) {
    return resolveFromE2EFixture(monthKey, now);
  }

  if (gastappMonthlyRuntime.mode === 'firestore' && gastappMonthlyRuntime.status === 'ready') {
    return resolveFromFirestore(monthKey, now);
  }

  return resolveCanonicalUnavailable(monthKey, now);
};
