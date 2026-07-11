import { doc, getDocFromServer } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from './firebase';
import {
  buildWealthNetBreakdown,
  isRiskCapitalInvestmentLabel,
  loadClosuresFromRaw,
  resolveRiskCapitalRecordsForTotals,
  selectCanonicalWealthExposureRecords,
  type WealthCurrency,
  type WealthFxRates,
  type WealthMonthlyClosure,
} from './wealthStorage';

const WEALTH_COLLECTION = 'aurum_wealth';
const CURRENCIES: WealthCurrency[] = ['CLP', 'USD', 'EUR', 'UF'];
export const CLOSURE_AUDIT_AUTHORIZED_EMAIL = 'diegorp.1978@gmail.com';

export const normalizeClosureAuditEmail = (email: string | null | undefined) =>
  String(email || '').trim().toLowerCase();

export const isClosureAuditAuthorizedUser = (user: Pick<User, 'email'> | null | undefined) =>
  normalizeClosureAuditEmail(user?.email) === CLOSURE_AUDIT_AUTHORIZED_EMAIL;

type Classification =
  | 'EXACT_POSITION_SNAPSHOT'
  | 'EXACT_CURRENCY_BUCKET'
  | 'SUMMARY_ONLY'
  | 'AMBIGUOUS'
  | 'UNAVAILABLE';

type ReconciliationStatus = 'EXACT' | 'NOT_RECONCILED' | 'NOT_AVAILABLE';

export type ClosureAuditReconciliation = {
  storedValue: number | null;
  reconstructedValue: number | null;
  difference: number | null;
  differencePct: number | null;
  status: ReconciliationStatus;
};

export type SanitizedClosureAuditEntry = {
  monthKey: string;
  status: Classification;
  closedAtPresent: boolean;
  hasRecords: boolean;
  recordCount: number;
  nativeCurrencies: WealthCurrency[];
  recordsWithNativeAmount: number;
  recordsMissingNativeAmount: number;
  hasFxRates: boolean;
  fxRates: { usdClp: number; eurClp: number; eurUsd: number | null; ufClp: number } | null;
  hasNetClp: boolean;
  netClp: number | null;
  hasNetClpWithRisk: boolean;
  netClpWithRisk: number | null;
  hasRiskCapitalRecords: boolean;
  riskCapitalRecordCount: number;
  assetRecordCount: number;
  liabilityRecordCount: number;
  nativeLiabilityCurrencies: WealthCurrency[];
  legacyAggregateCount: number;
  summaryOnly: boolean;
  classification: Classification;
  reconciliation: {
    withoutRisk: ClosureAuditReconciliation;
    withRisk: ClosureAuditReconciliation;
  };
};

export type ClosureAuditHorizon = {
  initialMonthKey: string | null;
  finalMonthKey: string | null;
  withoutRisk: 'available' | 'unavailable';
  withRisk: 'available' | 'unavailable';
  reason: string | null;
};

export type SanitizedClosureAudit = {
  generatedAt: string;
  source: 'aurum_wealth/authenticated-user';
  readOnly: true;
  closureCount: number;
  latestConfirmedMonthKey: string | null;
  closures: SanitizedClosureAuditEntry[];
  horizons: Record<'1M' | '6M' | '12M' | '24M' | '36M' | 'sinceStart' | 'sinceCompleteRecords', ClosureAuditHorizon>;
};

type AuditedClosure = SanitizedClosureAuditEntry & {
  exactWithoutRisk: boolean;
  exactWithRisk: boolean;
};

const finite = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const validFx = (fx: WealthFxRates | undefined): fx is WealthFxRates =>
  Boolean(fx && finite(fx.usdClp) && finite(fx.eurClp) && finite(fx.ufClp) && fx.usdClp > 0 && fx.eurClp > 0 && fx.ufClp > 0);

const sameWithinFinancialTolerance = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= Math.max(0.01, Math.abs(expected) * 1e-9);

const unavailableReconciliation = (): ClosureAuditReconciliation => ({
  storedValue: null,
  reconstructedValue: null,
  difference: null,
  differencePct: null,
  status: 'NOT_AVAILABLE',
});

const reconcile = (storedValue: number | null, reconstructedValue: number | null): ClosureAuditReconciliation => {
  if (storedValue === null || reconstructedValue === null) return unavailableReconciliation();
  const difference = reconstructedValue - storedValue;
  return {
    storedValue,
    reconstructedValue,
    difference,
    differencePct: storedValue === 0 ? null : difference / storedValue,
    status: sameWithinFinancialTolerance(reconstructedValue, storedValue) ? 'EXACT' : 'NOT_RECONCILED',
  };
};

const resolveStoredNet = (closure: WealthMonthlyClosure, includeRiskCapital: boolean) => {
  const summary = closure.summary;
  const explicit = includeRiskCapital ? finite(summary.netClpWithRisk) : finite(summary.netClp);
  if (explicit !== null) return explicit;
  return finite(summary.netConsolidatedClp);
};

const auditAggregatedBucket = (closure: WealthMonthlyClosure, fx: WealthFxRates | undefined) => {
  const bucket = closure.summary?.analysisByCurrency;
  if (!bucket || !validFx(fx)) return { withoutRisk: false, withRisk: false };
  const withoutRisk = finite(bucket.clpWithoutRisk);
  const withoutRiskUsd = finite(bucket.usdWithoutRisk);
  const withRisk = finite(bucket.clpWithRisk);
  const withRiskUsd = finite(bucket.usdWithRisk);
  return {
    withoutRisk:
      withoutRisk !== null &&
      withoutRiskUsd !== null &&
      resolveStoredNet(closure, false) !== null &&
      sameWithinFinancialTolerance(withoutRisk + withoutRiskUsd * fx.usdClp, resolveStoredNet(closure, false) as number),
    withRisk:
      withRisk !== null &&
      withRiskUsd !== null &&
      resolveStoredNet(closure, true) !== null &&
      sameWithinFinancialTolerance(withRisk + withRiskUsd * fx.usdClp, resolveStoredNet(closure, true) as number),
  };
};

const auditClosure = (closure: WealthMonthlyClosure): AuditedClosure => {
  const records = Array.isArray(closure.records) ? closure.records : [];
  const fx = closure.fxRates;
  const hasFxRates = validFx(fx) && !(closure.fxMissing?.length);
  const recordsWithNativeAmount = records.filter((record) => finite(record.amount) !== null).length;
  const recordsMissingNativeAmount = records.length - recordsWithNativeAmount;
  const nativeCurrencies = CURRENCIES.filter((currency) => records.some((record) => record.currency === currency));
  const liabilities = records.filter((record) => record.block === 'debt');
  const nativeLiabilityCurrencies = CURRENCIES.filter((currency) => liabilities.some((record) => record.currency === currency));
  const riskCapitalRecordCount = records.filter(
    (record) => record.block === 'investment' && isRiskCapitalInvestmentLabel(record.label),
  ).length;
  const canonicalCount = selectCanonicalWealthExposureRecords(records, true).length;
  const storedWithoutRisk = resolveStoredNet(closure, false);
  const storedWithRisk = resolveStoredNet(closure, true);
  const hasUsableRecords = records.length > 0 && recordsMissingNativeAmount === 0 && hasFxRates;

  const withoutRisk = hasUsableRecords
    ? reconcile(
        storedWithoutRisk,
        buildWealthNetBreakdown(resolveRiskCapitalRecordsForTotals(records, false).recordsForTotals, fx).netClp,
      )
    : unavailableReconciliation();
  const withRisk = hasUsableRecords
    ? reconcile(
        storedWithRisk,
        buildWealthNetBreakdown(resolveRiskCapitalRecordsForTotals(records, true).recordsForTotals, fx).netClp,
      )
    : unavailableReconciliation();

  const bucket = !records.length ? auditAggregatedBucket(closure, fx) : { withoutRisk: false, withRisk: false };
  const exactPosition = hasUsableRecords && withoutRisk.status === 'EXACT' && withRisk.status === 'EXACT';
  const exactBucket = !records.length && bucket.withoutRisk && bucket.withRisk;
  const hasSummary = storedWithoutRisk !== null || storedWithRisk !== null;
  const classification: Classification = exactPosition
    ? 'EXACT_POSITION_SNAPSHOT'
    : exactBucket
      ? 'EXACT_CURRENCY_BUCKET'
      : !records.length && hasSummary
        ? 'SUMMARY_ONLY'
        : records.length || hasSummary
          ? 'AMBIGUOUS'
          : 'UNAVAILABLE';

  return {
    monthKey: closure.monthKey,
    status: classification,
    closedAtPresent: Boolean(closure.closedAt),
    hasRecords: records.length > 0,
    recordCount: records.length,
    nativeCurrencies,
    recordsWithNativeAmount,
    recordsMissingNativeAmount,
    hasFxRates,
    fxRates: hasFxRates && fx
      ? { usdClp: fx.usdClp, eurClp: fx.eurClp, eurUsd: fx.eurClp / fx.usdClp, ufClp: fx.ufClp }
      : null,
    hasNetClp: finite(closure.summary?.netClp) !== null,
    netClp: finite(closure.summary?.netClp),
    hasNetClpWithRisk: finite(closure.summary?.netClpWithRisk) !== null,
    netClpWithRisk: finite(closure.summary?.netClpWithRisk),
    hasRiskCapitalRecords: riskCapitalRecordCount > 0,
    riskCapitalRecordCount,
    assetRecordCount: records.filter((record) => record.block !== 'debt').length,
    liabilityRecordCount: liabilities.length,
    nativeLiabilityCurrencies,
    legacyAggregateCount: Math.max(0, records.length - canonicalCount),
    summaryOnly: !records.length,
    classification,
    reconciliation: { withoutRisk, withRisk },
    exactWithoutRisk: exactPosition ? withoutRisk.status === 'EXACT' : exactBucket && bucket.withoutRisk,
    exactWithRisk: exactPosition ? withRisk.status === 'EXACT' : exactBucket && bucket.withRisk,
  };
};

const monthOffset = (monthKey: string, monthsBack: number) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const totalMonths = year * 12 + (month - 1) - monthsBack;
  return `${Math.floor(totalMonths / 12)}-${String((totalMonths % 12) + 1).padStart(2, '0')}`;
};

const isComparable = (initial: AuditedClosure, final: AuditedClosure) => initial.classification === final.classification;

const unavailableHorizon = (initialMonthKey: string | null, finalMonthKey: string | null, reason: string): ClosureAuditHorizon => ({
  initialMonthKey,
  finalMonthKey,
  withoutRisk: 'unavailable',
  withRisk: 'unavailable',
  reason,
});

const evaluateHorizon = (
  initial: AuditedClosure | undefined,
  final: AuditedClosure | undefined,
  initialMonthKey: string | null,
  finalMonthKey: string | null,
): ClosureAuditHorizon => {
  if (!final || !finalMonthKey) return unavailableHorizon(initialMonthKey, finalMonthKey, 'No existe un cierre final confirmado.');
  if (!initial || !initialMonthKey) return unavailableHorizon(initialMonthKey, finalMonthKey, 'No existe el cierre inicial requerido.');
  if (!isComparable(initial, final)) {
    return unavailableHorizon(initialMonthKey, finalMonthKey, 'Los endpoints usan fuentes de composición no comparables.');
  }
  const withoutRisk = initial.exactWithoutRisk && final.exactWithoutRisk ? 'available' : 'unavailable';
  const withRisk = initial.exactWithRisk && final.exactWithRisk ? 'available' : 'unavailable';
  return {
    initialMonthKey,
    finalMonthKey,
    withoutRisk,
    withRisk,
    reason: withoutRisk === 'available' && withRisk === 'available'
      ? null
      : 'Uno o ambos endpoints no tienen composición nativa y reconciliación exacta para ese universo.',
  };
};

export const buildSanitizedClosureAudit = (closures: WealthMonthlyClosure[]): SanitizedClosureAudit => {
  const audited = [...closures]
    .filter((closure) => /^\d{4}-\d{2}$/.test(closure.monthKey))
    .map(auditClosure)
    .sort((left, right) => right.monthKey.localeCompare(left.monthKey));
  const byMonth = new Map(audited.map((closure) => [closure.monthKey, closure]));
  const latest = audited[0];
  const latestMonthKey = latest?.monthKey || null;
  const sinceStart = audited.at(-1);
  const firstComplete = [...audited].reverse().find((closure) => closure.classification === 'EXACT_POSITION_SNAPSHOT');
  const bounded = (months: number) => {
    const initialMonthKey = latestMonthKey ? monthOffset(latestMonthKey, months) : null;
    return evaluateHorizon(byMonth.get(initialMonthKey || ''), latest, initialMonthKey, latestMonthKey);
  };

  return {
    generatedAt: new Date().toISOString(),
    source: 'aurum_wealth/authenticated-user',
    readOnly: true,
    closureCount: audited.length,
    latestConfirmedMonthKey: latestMonthKey,
    closures: audited.map(({ exactWithoutRisk, exactWithRisk, ...entry }) => entry),
    horizons: {
      '1M': bounded(1),
      '6M': bounded(6),
      '12M': bounded(12),
      '24M': bounded(24),
      '36M': bounded(36),
      sinceStart: evaluateHorizon(sinceStart, latest, sinceStart?.monthKey || null, latestMonthKey),
      sinceCompleteRecords: evaluateHorizon(firstComplete, latest, firstComplete?.monthKey || null, latestMonthKey),
    },
  };
};

const sanitizeReadError = (error: unknown) => {
  const code = String((error as { code?: unknown })?.code || 'unknown');
  if (code.includes('permission-denied')) return 'No hay permisos para leer los cierres en la nube.';
  if (code.includes('unavailable')) return 'Firestore no está disponible. Revisa la conexión e inténtalo otra vez.';
  return 'No pude leer los cierres en la nube.';
};

export const readAuthenticatedClosureAudit = async (): Promise<
  | { status: 'ok'; audit: SanitizedClosureAudit }
  | { status: 'unauthenticated' }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }
> => {
  const user = auth.currentUser;
  if (!user?.uid) return { status: 'unauthenticated' };
  if (!isClosureAuditAuthorizedUser(user)) return { status: 'unauthorized' };
  try {
    const snapshot = await getDocFromServer(doc(db, WEALTH_COLLECTION, user.uid));
    if (!snapshot.exists()) return { status: 'ok', audit: buildSanitizedClosureAudit([]) };
    const rawClosures = snapshot.data()?.closures;
    const closures = loadClosuresFromRaw(Array.isArray(rawClosures) ? rawClosures : []);
    return { status: 'ok', audit: buildSanitizedClosureAudit(closures) };
  } catch (error) {
    return { status: 'error', message: sanitizeReadError(error) };
  }
};
