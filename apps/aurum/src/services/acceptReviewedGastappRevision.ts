import { refreshGastappMonthlyContable, resolveGastappMonthlyCloseCandidate } from './gastosMonthly';
import { computeMonthlyRows } from './returnsAnalysis';
import {
  applyCertifiedHistoricalGastappSidecarRevisions,
  getHistoricalGastappSidecarAnalysisState,
  readHistoricalGastappSidecarFromServer,
  type HistoricalGastappSidecarDocument,
  type HistoricalGastappSidecarRevisionUpdate,
} from './historicalGastappSidecar';
import {
  acceptGastappMonthlyClosureRevision,
  loadClosures,
  readWealthCloudDocumentForAudit,
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
  audit: GastappHistoricalRevisionAuditRow[];
  writesDisabled?: boolean;
};

export const isGastappAutomaticRevisionSyncEnabled = () =>
  import.meta.env.VITE_GASTAPP_REVISION_AUTO_SYNC === 'true';

export type GastappHistoricalSnapshotStatus = 'current' | 'stale' | 'missing' | 'blocked';
export type GastappHistoricalRevisionAuditRow = {
  monthKey: string;
  closureId: string;
  effectiveSource: 'closure' | 'sidecar' | 'none' | 'blocked';
  status: GastappHistoricalSnapshotStatus;
  currentContractHash: string | null;
  currentTotalEur: number | null;
  closureSnapshot: { status: GastappHistoricalSnapshotStatus; contractHash: string | null; totalEur: number | null };
  sidecarSnapshot: { status: GastappHistoricalSnapshotStatus; contractHash: string | null; totalEur: number | null };
  message: string | null;
};

export const summarizeGastappHistoricalRevisionAudit = (rows: GastappHistoricalRevisionAuditRow[]) => {
  const counts = {
    current: rows.filter((row) => row.status === 'current').length,
    stale: rows.filter((row) => row.status === 'stale').length,
    missing: rows.filter((row) => row.status === 'missing').length,
    blocked: rows.filter((row) => row.status === 'blocked').length,
  };
  const outstanding = rows.filter((row) => row.status !== 'current');
  const details = outstanding.slice(0, 8).map((row) => `${row.monthKey} ${row.status}`).join(', ');
  const remaining = outstanding.length - Math.min(8, outstanding.length);
  return `Auditoría de GastApp solo lectura: ${counts.current} actuales, ${counts.stale} desactualizados, ${counts.missing} sin snapshot y ${counts.blocked} bloqueados.`
    + (details ? ` Pendientes: ${details}${remaining ? ` y ${remaining} más` : ''}.` : ' Sin meses pendientes.')
    + ' No se modificaron datos.';
};

const snapshotStatus = (
  snapshot: GastappMonthlyExpenseCloseSnapshot | undefined,
  candidate: ReturnType<typeof resolveGastappMonthlyCloseCandidate>,
  sidecarMatchesClosure = true,
): GastappHistoricalSnapshotStatus => {
  if (!snapshot) return 'missing';
  if (!sidecarMatchesClosure || !candidate.snapshot) return 'blocked';
  return snapshot.contractHash === candidate.snapshot.contractHash &&
      snapshot.totalEur === candidate.snapshot.totalEur
    ? 'current'
    : 'stale';
};

const auditGastappHistoricalSnapshots = (
  closures: WealthMonthlyClosure[],
  sidecar: HistoricalGastappSidecarDocument | null,
  sidecarReady: boolean,
): GastappHistoricalRevisionAuditRow[] => {
  const sidecarEntries = sidecar?.snapshotsByMonth || {};
  const closureByMonth = new Map(closures.map((closure) => [closure.monthKey, closure]));
  const monthKeys = [...new Set([...closures.map((closure) => closure.monthKey), ...Object.keys(sidecarEntries)])].sort();
  return monthKeys.map((monthKey) => {
    const closure = closureByMonth.get(monthKey);
    const sidecarEntry = sidecarEntries[monthKey];
    const sidecarMatchesClosure = Boolean(closure && sidecarEntry && sidecarEntry.closureId === closure.id);
    const effectiveSnapshot = closure?.gastappExpenseClose ||
      (sidecarMatchesClosure ? sidecarEntry?.snapshot : undefined);
    const candidate = resolveGastappMonthlyCloseCandidate(monthKey, {
      previousSnapshot: effectiveSnapshot,
    });
    const currentContractHash = candidate.snapshot?.contractHash || candidate.currentContractHash || null;
    const currentTotalEur = candidate.snapshot?.totalEur ?? candidate.partialGastosEur ?? null;
    const closureStatus = snapshotStatus(closure?.gastappExpenseClose, candidate);
    const sidecarStatus = sidecarReady
      ? snapshotStatus(sidecarEntry?.snapshot, candidate, sidecarMatchesClosure)
      : 'blocked';
    const effectiveSource = closure?.gastappExpenseClose
      ? 'closure'
      : sidecarEntry && !sidecarMatchesClosure ? 'blocked'
        : sidecarEntry ? 'sidecar' : 'none';
    const status = effectiveSource === 'closure' ? closureStatus
      : effectiveSource === 'sidecar' ? sidecarStatus
        : effectiveSource === 'blocked' || !sidecarReady ? 'blocked'
          : 'missing';
    const message = effectiveSource === 'blocked'
      ? 'El sidecar no coincide con el cierre histórico.'
      : !sidecarReady && !closure?.gastappExpenseClose
        ? 'No hay lectura autoritativa del sidecar.'
        : status === 'blocked' && !candidate.snapshot
          ? candidate.message || 'GastApp aún no ofrece un contrato certificado utilizable.'
          : null;
    return {
      monthKey,
      closureId: closure?.id || sidecarEntry?.closureId || '',
      effectiveSource,
      status,
      currentContractHash,
      currentTotalEur,
      closureSnapshot: {
        status: closureStatus,
        contractHash: closure?.gastappExpenseClose?.contractHash || null,
        totalEur: closure?.gastappExpenseClose?.totalEur ?? null,
      },
      sidecarSnapshot: {
        status: sidecarStatus,
        contractHash: sidecarEntry?.snapshot.contractHash || null,
        totalEur: sidecarEntry?.snapshot.totalEur ?? null,
      },
      message,
    };
  });
};

/** Read-only comparison of every closure/sidecar month with current certified GastApp contracts. */
export const auditGastappHistoricalRevisions = async (): Promise<GastappHistoricalRevisionAuditRow[]> => {
  await refreshGastappMonthlyContable();
  const [wealth, sidecar] = await Promise.all([
    readWealthCloudDocumentForAudit(),
    readHistoricalGastappSidecarFromServer(),
  ]);
  return auditGastappHistoricalSnapshots(
    wealth.closures,
    sidecar.document,
    true,
  );
};

/**
 * Applies every complete, certified GastApp revision automatically.
 * The storage transaction remains the authority: it archives the replaced
 * snapshot and refuses concurrent financial changes. Uncertified revisions
 * remain pending and are never written.
 */
export const applyCertifiedGastappRevisions = async (): Promise<GastappRevisionAutoSyncResult> => {
  if (!isGastappAutomaticRevisionSyncEnabled()) {
    const audit = await auditGastappHistoricalRevisions();
    return { applied: [], pendingUncertified: [], failed: [], audit, writesDisabled: true };
  }
  await refreshGastappMonthlyContable();
  const closures = loadClosures();
  const sidecarState = getHistoricalGastappSidecarAnalysisState();
  const sidecar = sidecarState.hasAuthoritativeSnapshot ? sidecarState.document : null;
  const sidecarReady = sidecarState.status === 'ready' && sidecarState.hasAuthoritativeSnapshot;
  const audit = auditGastappHistoricalSnapshots(closures, sidecar, sidecarReady);
  const applied: GastappRevisionAutoSyncResult['applied'] = [];
  const pendingUncertified: string[] = [];
  const failed: GastappRevisionAutoSyncResult['failed'] = [];
  const sidecarUpdates: HistoricalGastappSidecarRevisionUpdate[] = [];

  for (const initialClosure of closures) {
    const monthKey = initialClosure.monthKey;
    const currentClosure = loadClosures().find((item) => item.monthKey === monthKey) || initialClosure;
    const sidecarEntry = sidecar?.snapshotsByMonth[monthKey];
    const hasClosureSnapshot = Boolean(currentClosure.gastappExpenseClose);
    const previousSnapshot = currentClosure.gastappExpenseClose ||
      (sidecarEntry?.closureId === currentClosure.id ? sidecarEntry.snapshot : undefined);
    if (!previousSnapshot) continue;

    const candidate = resolveGastappMonthlyCloseCandidate(monthKey, {
      previousSnapshot,
    });
    // The emulator fixture intentionally supplies a synthetic, application-
    // local contract. Treating its fixed demo hash as a published revision
    // would rewrite every historical sidecar in authenticated E2E runs.
    if (candidate.snapshot?.contractVersion === 'e2e_fixture') continue;
    if (candidate.snapshot && candidate.snapshot.contractHash === previousSnapshot.contractHash &&
        candidate.snapshot.totalEur !== previousSnapshot.totalEur) {
      failed.push({ monthKey, message: 'Mismo hash GastApp con importe distinto; no se escribió.' });
      continue;
    }
    if (!candidate.sourceChangedAfterClosure) continue;
    if (!candidate.snapshot) {
      pendingUncertified.push(monthKey);
      continue;
    }

    if (!hasClosureSnapshot) {
      if (!sidecarReady || sidecarEntry?.closureId !== currentClosure.id) {
        failed.push({ monthKey, message: 'No hay sidecar autoritativo para ese cierre; no se escribió.' });
        continue;
      }
      sidecarUpdates.push({
        monthKey,
        closureId: currentClosure.id,
        expectedPreviousContractHash: previousSnapshot.contractHash,
        expectedCandidateContractHash: candidate.snapshot.contractHash,
        snapshot: candidate.snapshot,
      });
      continue;
    }

    const previousContractHash = previousSnapshot.contractHash;
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

  if (sidecarUpdates.length) {
    try {
      const result = await applyCertifiedHistoricalGastappSidecarRevisions(sidecarUpdates);
      for (const monthKey of result.changed) {
        const update = sidecarUpdates.find((item) => item.monthKey === monthKey)!;
        applied.push({
          monthKey,
          changed: true,
          previousContractHash: update.expectedPreviousContractHash,
          currentContractHash: update.expectedCandidateContractHash,
        });
      }
      for (const monthKey of result.unchanged) {
        const update = sidecarUpdates.find((item) => item.monthKey === monthKey)!;
        applied.push({
          monthKey,
          changed: false,
          previousContractHash: update.expectedPreviousContractHash,
          currentContractHash: update.expectedCandidateContractHash,
        });
      }
      failed.push(...result.failed);
    } catch (error) {
      failed.push(...sidecarUpdates.map(({ monthKey }) => ({
        monthKey,
        message: String((error as Error)?.message || 'No se pudo conciliar el sidecar histórico.'),
      })));
    }
  }

  if (!sidecarReady) {
    for (const closure of closures) {
      if (closure.gastappExpenseClose) continue;
      const row = audit.find((item) => item.monthKey === closure.monthKey);
      if (row?.status === 'blocked' && !failed.some((item) => item.monthKey === closure.monthKey)) {
        failed.push({ monthKey: closure.monthKey, message: row.message || 'Sidecar histórico aún no disponible.' });
      }
    }
  }

  return { applied, pendingUncertified, failed, audit, writesDisabled: false };
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

export const GASTAPP_REVISION_NOTICE_SEEN_EVENT = 'aurum:gastapp-revision-notice-seen-updated';

export const gastappRevisionNoticeKeysFromSeenHashes = (
  seenHashes: Record<string, string>,
) => new Set(Object.entries(seenHashes)
  .filter(([monthKey, contractHash]) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) && Boolean(contractHash?.trim()))
  .map(([monthKey, contractHash]) => gastappRevisionNoticeKey(monthKey, contractHash)));

export const parseLegacyGastappRevisionNoticeAcknowledgements = (
  raw: string | null,
): Array<{ monthKey: string; contractHash: string }> => {
  try {
    const values = JSON.parse(raw || '[]');
    if (!Array.isArray(values)) return [];
    const latestByMonth = new Map<string, string>();
    values.forEach((value) => {
      if (typeof value !== 'string') return;
      const separator = value.indexOf('::');
      if (separator < 0) return;
      const monthKey = value.slice(0, separator);
      const contractHash = value.slice(separator + 2).trim();
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) && contractHash && contractHash.length <= 160) {
        latestByMonth.set(monthKey, contractHash);
      }
    });
    return [...latestByMonth].map(([monthKey, contractHash]) => ({ monthKey, contractHash }));
  } catch {
    return [];
  }
};

export const legacyGastappRevisionAcknowledgementsToMigrate = (
  seenHashes: Record<string, string>,
  legacy: Array<{ monthKey: string; contractHash: string }>,
  currentHashes: Record<string, string> = {},
) => legacy.filter(({ monthKey, contractHash }) =>
  currentHashes[monthKey] === contractHash && !seenHashes[monthKey]);

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
  certificationRevision: number;
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
  sidecar: HistoricalGastappSidecarDocument | null = null,
): GastappRevisionInboxItem[] => {
  const closuresByMonth = new Map(closures.map((closure) => [closure.monthKey, closure]));
  const effectiveClosures = closures.map((closure) => {
    if (closure.gastappExpenseClose) return closure;
    const entry = sidecar?.snapshotsByMonth[closure.monthKey];
    return entry?.closureId === closure.id
      ? { ...closure, gastappExpenseClose: entry.snapshot }
      : closure;
  });
  const currentReturns = new Map(
    computeMonthlyRows(effectiveClosures, includeRiskCapitalInTotals, 'CLP')
      .map((row) => [row.monthKey, row.pct]),
  );

  return effectiveClosures.flatMap((closure) => {
    const current = closure.gastappExpenseClose;
    if (!current || seenHashes[closure.monthKey] === current.contractHash) return [];

    const sidecarEntry = sidecar?.snapshotsByMonth[closure.monthKey];
    const isSidecarSnapshot = !closuresByMonth.get(closure.monthKey)?.gastappExpenseClose &&
      sidecarEntry?.closureId === closure.id && sidecarEntry.snapshot.contractHash === current.contractHash;
    const sidecarVersions: WealthMonthlyClosureVersion[] = isSidecarSnapshot
      ? (sidecarEntry?.previousVersions || []).map((version) => ({
          id: `${closure.id}:gastapp:${version.snapshot.certificationRevision}:${version.snapshot.contractHash.slice(-8)}`,
          monthKey: closure.monthKey,
          closedAt: closure.closedAt,
          replacedAt: version.replacedAt,
          summary: closure.summary,
          fxRates: closure.fxRates,
          gastappExpenseClose: version.snapshot,
        }))
      : [];

    // Only certified revisions accepted by Aurum archive a :gastapp: version.
    // Wealth-only corrections must not generate GastApp revision notices.
    const ordered = [...(isSidecarSnapshot ? sidecarVersions : closure.previousVersions || [])]
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
      effectiveClosures.map((row) => row.monthKey === closure.monthKey
        ? { ...row, gastappExpenseClose: baseline } : row),
      includeRiskCapitalInTotals,
      'CLP',
    );
    const originalReturn = baselineRows.find((row) => row.monthKey === closure.monthKey);

    return [{
      monthKey: closure.monthKey,
      contractHash: current.contractHash,
      certificationRevision: current.certificationRevision,
      originalGastosEur: baseline.totalEur,
      updatedGastosEur: current.totalEur,
      originalReturnPct: originalReturn?.pct ?? null,
      updatedReturnPct: currentReturns.get(closure.monthKey) ?? null,
      revisionCount: Math.max(1, current.certificationRevision - baseline.certificationRevision),
      appliedAt: current.capturedAt || null,
    }];
  }).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
};
