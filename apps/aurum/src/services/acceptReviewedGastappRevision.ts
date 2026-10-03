import { refreshGastappMonthlyContable, resolveGastappMonthlyCloseCandidate } from './gastosMonthly';
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
