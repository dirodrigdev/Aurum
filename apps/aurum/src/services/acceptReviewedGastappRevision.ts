import { refreshGastappMonthlyContable, resolveGastappMonthlyCloseCandidate } from './gastosMonthly';
import { computeMonthlyRows } from './returnsAnalysis';
import {
  acceptGastappMonthlyClosureRevision,
  loadClosures,
  type GastappMonthlyExpenseCloseSnapshot,
  type WealthMonthlyClosure,
  type WealthMonthlyClosureVersion,
} from './wealthStorage';

const comparisonChanged = 'La revisión cambió o aún no está certificada. Actualiza la comparación.';

const readClosureWithSnapshot = (monthKey: string) => {
  const closure = loadClosures().find((item) => item.monthKey === monthKey);
  if (!closure?.gastappExpenseClose) {
    throw new Error('No encontré el snapshot de GastApp guardado para este cierre.');
  }
  return closure;
};

/** The accepted revision must be the exact version the customer reviewed. */
export const acceptReviewedGastappRevision = async (input: {
  monthKey: string;
  expectedPreviousContractHash: string;
  expectedCandidateContractHash: string;
}) => {
  const readReviewedClosure = () => {
    const closure = readClosureWithSnapshot(input.monthKey);
    if (closure.gastappExpenseClose!.contractHash !== input.expectedPreviousContractHash) {
      throw new Error(comparisonChanged);
    }
    return closure;
  };
  readReviewedClosure();
  await refreshGastappMonthlyContable();
  const closure = readReviewedClosure();
  const candidate = resolveGastappMonthlyCloseCandidate(input.monthKey, {
    previousSnapshot: closure.gastappExpenseClose,
  });
  if (!candidate.snapshot || !candidate.sourceChangedAfterClosure) {
    throw new Error(candidate.message || comparisonChanged);
  }
  if (candidate.snapshot.contractHash !== input.expectedCandidateContractHash) {
    throw new Error(comparisonChanged);
  }
  return acceptGastappMonthlyClosureRevision({ ...input, snapshot: candidate.snapshot });
};

export type GastappRevisionAutoSyncResult = {
  applied: Array<{
    monthKey: string;
    changed: boolean;
    previousContractHash: string;
    currentContractHash: string;
  }>;
  pendingUncertified: string[];
  failed: Array<{ monthKey: string; message: string }>;
};

/**
 * Applies every complete, certified GastApp revision automatically.
 * The storage transaction remains the authority: it archives the replaced
 * snapshot and refuses concurrent financial changes. Uncertified revisions
 * remain pending and are never written.
 */
export const applyCertifiedGastappRevisions = async (): Promise<GastappRevisionAutoSyncResult> => {
  await refreshGastappMonthlyContable();
  const closures = loadClosures();
  const applied: GastappRevisionAutoSyncResult['applied'] = [];
  const pendingUncertified: string[] = [];
  const failed: GastappRevisionAutoSyncResult['failed'] = [];

  for (const initialClosure of closures) {
    if (!initialClosure.gastappExpenseClose) continue;
    const monthKey = initialClosure.monthKey;
    const currentClosure = loadClosures().find((item) => item.monthKey === monthKey) || initialClosure;
    if (!currentClosure.gastappExpenseClose) continue;

    const candidate = resolveGastappMonthlyCloseCandidate(monthKey, {
      previousSnapshot: currentClosure.gastappExpenseClose,
    });
    if (!candidate.sourceChangedAfterClosure) continue;
    if (!candidate.snapshot) {
      pendingUncertified.push(monthKey);
      continue;
    }

    const previousContractHash = currentClosure.gastappExpenseClose.contractHash;
    try {
      const result = await acceptGastappMonthlyClosureRevision({
        monthKey,
        expectedPreviousContractHash: previousContractHash,
        expectedCandidateContractHash: candidate.snapshot.contractHash,
        snapshot: candidate.snapshot,
      });
      applied.push({
        monthKey,
        changed: result.changed,
        previousContractHash,
        currentContractHash: candidate.snapshot.contractHash,
      });
    } catch (error) {
      failed.push({
        monthKey,
        message: String((error as Error)?.message || 'No se pudo aplicar la revisión certificada de GastApp.'),
      });
    }
  }

  return { applied, pendingUncertified, failed };
};

export type GastappRevisionNotice = {
  id: string;
  monthKey: string;
  appliedAt: string | null;
  previousSnapshot: GastappMonthlyExpenseCloseSnapshot;
  currentSnapshot: GastappMonthlyExpenseCloseSnapshot;
};

export const gastappRevisionNoticeKey = (monthKey: string, contractHash: string) =>
  `${monthKey}::${contractHash}`;

const versionTimestamp = (version: WealthMonthlyClosureVersion) => {
  const value = new Date(version.replacedAt || version.closedAt || '').getTime();
  return Number.isFinite(value) ? value : 0;
};

/**
 * Builds post-application notices from the immutable closure history. This
 * means a revision applied in another tab/device is still explainable when
 * this browser hydrates the updated closure.
 */
export const buildGastappRevisionNotices = (
  closures: WealthMonthlyClosure[],
  acknowledged = new Set<string>(),
): GastappRevisionNotice[] =>
  closures.flatMap((closure) => {
    const currentSnapshot = closure.gastappExpenseClose;
    if (!currentSnapshot) return [];
    const id = gastappRevisionNoticeKey(closure.monthKey, currentSnapshot.contractHash);
    if (acknowledged.has(id)) return [];

    const previousVersion = [...(closure.previousVersions || [])]
      .filter((version) =>
        version.id.includes(':gastapp:') &&
        Boolean(version.gastappExpenseClose) &&
        version.gastappExpenseClose!.contractHash !== currentSnapshot.contractHash,
      )
      .sort((left, right) => versionTimestamp(right) - versionTimestamp(left))[0];
    const previousSnapshot = previousVersion?.gastappExpenseClose;
    if (!previousSnapshot) return [];

    return [{
      id,
      monthKey: closure.monthKey,
      appliedAt: previousVersion.replacedAt || currentSnapshot.capturedAt || null,
      previousSnapshot,
      currentSnapshot,
    }];
  }).sort((left, right) => right.monthKey.localeCompare(left.monthKey));


/**
 * Temporary, read-once notification data derived exclusively from sealed
 * historical GastApp snapshots. Multiple unseen revisions of the same calendar
 * month produce one entry comparing the last acknowledged state with current.
 */
export type GastappRevisionInboxItem = {
  monthKey: string;
  contractHash: string;
  originalGastosEur: number;
  updatedGastosEur: number;
  originalReturnPct: number | null;
  updatedReturnPct: number | null;
  revisionCount: number;
  appliedAt: string | null;
};

export const buildGastappRevisionInbox = (
  closures: WealthMonthlyClosure[],
  seenHashes: Record<string, string>,
  includeRiskCapitalInTotals: boolean,
): GastappRevisionInboxItem[] => {
  const currentReturns = new Map(
    computeMonthlyRows(closures, includeRiskCapitalInTotals, 'CLP')
      .map((row) => [row.monthKey, row.pct]),
  );

  return closures.flatMap((closure) => {
    const current = closure.gastappExpenseClose;
    if (!current || seenHashes[closure.monthKey] === current.contractHash) return [];

    // Only certified revisions accepted by Aurum archive a :gastapp: version.
    // Wealth-only corrections must not generate GastApp revision notices.
    const ordered = [...(closure.previousVersions || [])]
      .filter((entry) => entry.id.includes(':gastapp:')
        && entry.gastappExpenseClose
        && entry.gastappExpenseClose.contractHash !== current.contractHash)
      .sort((a, b) =>
        (Date.parse(a.replacedAt || a.closedAt) || 0)
        - (Date.parse(b.replacedAt || b.closedAt) || 0));
    const byHash = new Map<string, WealthMonthlyClosureVersion>();
    for (const version of ordered) {
      const hash = version.gastappExpenseClose!.contractHash;
      if (!byHash.has(hash)) byHash.set(hash, version);
    }
    const predecessorVersions = [...byHash.values()];
    if (!predecessorVersions.length) return [];

    // When a previous notification was acknowledged, that exact version is
    // the baseline. Otherwise the first retained certified version is used.
    const seenPredecessor = seenHashes[closure.monthKey]
      ? predecessorVersions.find(
        (v) => v.gastappExpenseClose?.contractHash === seenHashes[closure.monthKey])
      : undefined;
    const baseline = (seenPredecessor || predecessorVersions[0])
      .gastappExpenseClose as GastappMonthlyExpenseCloseSnapshot;
    const baselineRows = computeMonthlyRows(
      closures.map((row) => row.monthKey === closure.monthKey
        ? { ...row, gastappExpenseClose: baseline } : row),
      includeRiskCapitalInTotals,
      'CLP',
    );
    const originalReturn = baselineRows.find((row) => row.monthKey === closure.monthKey);

    return [{
      monthKey: closure.monthKey,
      contractHash: current.contractHash,
      originalGastosEur: baseline.totalEur,
      updatedGastosEur: current.totalEur,
      originalReturnPct: originalReturn?.pct ?? null,
      updatedReturnPct: currentReturns.get(closure.monthKey) ?? null,
      revisionCount: Math.max(1, current.certificationRevision - baseline.certificationRevision),
      appliedAt: current.capturedAt || null,
    }];
  }).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
};
