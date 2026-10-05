import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('crypto', webcrypto);
vi.mock('../src/services/firebase', () => ({
  db: {},
  ensureAuthPersistence: vi.fn(async () => {}),
  getCurrentUid: vi.fn(() => null),
  isE2EFirebaseEmulatorEnabled: vi.fn(() => false),
}));
vi.mock('../src/services/gastosMonthly', () => ({
  resolveGastappMonthlyCloseCandidate: vi.fn(),
  resolveGastappMonthlySpend: vi.fn(),
}));

import type { GastappMonthlyCloseCandidate } from '../src/services/gastosMonthly';
import {
  buildGastappMonthlyExpenseCloseSnapshot,
  mergeClosuresForSync,
  type GastappMonthlyExpenseCloseInput,
  type WealthMonthlyClosure,
} from '../src/services/wealthStorage';
import { buildHistoricalGastappBackfillPreview } from '../src/services/historicalGastappSnapshotBackfill';
import { buildHistoricalGastappSidecarPlan } from '../src/services/historicalGastappBackfillWrite';
import { getHistoricalGastappSnapshotForAnalysis, parseHistoricalGastappSidecar, setHistoricalGastappSidecarForAnalysis } from '../src/services/historicalGastappSidecar';
import { computeMonthlyRows } from '../src/services/returnsAnalysis';

const sha = (letter: string) => `sha256:${letter.repeat(64)}`;

const monthsBetween = (startMonthKey: string, endMonthKey: string) => {
  const [startYear, startMonth] = startMonthKey.split('-').map(Number);
  const [endYear, endMonth] = endMonthKey.split('-').map(Number);
  const keys: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return keys;
};

const makeClosure = (monthKey: string, index: number, fxMissing?: Array<'usdClp' | 'eurClp' | 'ufClp'>): WealthMonthlyClosure => {
  const netClp = 10_000_000 + index * 100_000;
  const fxRates = { usdClp: 800 + index, eurClp: 1_000 + index, ufClp: 38_000 + index };
  const summary = {
    netByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    assetsByCurrency: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
    debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    netConsolidatedClp: netClp,
    byBlock: {
      bank: { CLP: netClp, USD: 0, EUR: 0, UF: 0 },
      investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    },
    netClp,
    netClpWithRisk: netClp,
  };
  return {
    id: `closure-${monthKey}`,
    monthKey,
    closedAt: `${monthKey}-28T23:59:59.000Z`,
    summary,
    records: [{
      id: `record-${monthKey}`,
      block: 'bank',
      source: 'test_fixture',
      label: 'Balance sintético',
      amount: netClp,
      currency: 'CLP',
      snapshotDate: `${monthKey}-28`,
      createdAt: `${monthKey}-28T23:59:59.000Z`,
    }],
    fxRates,
    fxMetadata: {
      economicMonthKey: monthKey,
      economicDate: `${monthKey}-28`,
      usedFxRates: fxRates,
      rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
    },
    fxMissing,
    previousVersions: [{
      id: `previous-${monthKey}`,
      monthKey,
      closedAt: `${monthKey}-27T23:59:59.000Z`,
      summary,
      records: [],
      fxRates,
      fxMetadata: {
        economicMonthKey: monthKey,
        economicDate: `${monthKey}-28`,
        usedFxRates: fxRates,
        rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
      },
    }],
  };
};

const makeCandidate = (
  monthKey: string,
  options: { status?: GastappMonthlyCloseCandidate['status']; certificationStatus?: 'certified' | 'revised'; partialEur?: number; familyTotal?: number } = {},
): GastappMonthlyCloseCandidate => {
  const partialEur = options.partialEur ?? 100 + Number(monthKey.slice(5, 7));
  const contractHash = sha(String.fromCharCode(97 + (Number(monthKey.slice(5, 7)) % 6)));
  const certificationStatus = options.certificationStatus ?? 'certified';
  const candidateStatus = options.status ?? 'complete';
  const byFamilyEur = {
    dayToDay: options.familyTotal ?? partialEur - 20,
    trips: 10,
    others: 10,
  };
  const snapshot: GastappMonthlyExpenseCloseInput | null = candidateStatus === 'complete'
    ? {
        monthKey,
        calendarMonthKey: monthKey,
        totalEur: partialEur,
        byFamilyEur,
        canonicalDataHash: sha('a'),
        operationalDataHash: sha('b'),
        operationalRevision: 4,
        sourceGeneration: 4,
        monthContractRevision: 4,
        monthContractHash: contractHash,
        certificationStatus,
        certificationRevision: 4,
        certificationHash: sha('c'),
        contractHash,
        contractVersion: 'gastapp-aurum-calendar-months-v2',
        generatedAt: '2026-10-04T10:00:00.000Z',
      }
    : null;
  return {
    monthKey,
    status: candidateStatus,
    partialGastosEur: candidateStatus === 'missing' ? partialEur : candidateStatus === 'complete' ? partialEur : null,
    partialByFamilyEur: byFamilyEur,
    snapshot,
    sourceChangedAfterClosure: false,
    currentContractHash: contractHash,
    storedContractHash: null,
    message: candidateStatus,
  };
};

const addExistingSnapshot = (closure: WealthMonthlyClosure, candidate: GastappMonthlyCloseCandidate) => ({
  ...closure,
  gastappExpenseClose: buildGastappMonthlyExpenseCloseSnapshot(
    candidate.snapshot!,
    closure.fxRates!,
    '2026-10-04T10:00:00.000Z',
  ),
});

describe('historical GastApp snapshot audit and in-memory simulation', () => {
  it('projects a multi-year recovery without changing sealed financial fields or existing snapshots', async () => {
    const monthKeys = monthsBetween('2023-05', '2026-08');
    const candidatesByMonth: Record<string, GastappMonthlyCloseCandidate> = {};
    const closures = monthKeys.map((monthKey, index) => makeClosure(monthKey, index));
    for (const [index, monthKey] of monthKeys.entries()) {
      candidatesByMonth[monthKey] = makeCandidate(monthKey, {
        certificationStatus: index % 2 === 0 ? 'certified' : 'revised',
      });
    }
    const existingMonth = '2023-06';
    const existingIndex = monthKeys.indexOf(existingMonth);
    closures[existingIndex] = addExistingSnapshot(closures[existingIndex], candidatesByMonth[existingMonth]);
    candidatesByMonth['2026-09'] = makeCandidate('2026-09', { certificationStatus: 'revised' });
    const originalClosures = structuredClone(closures);
    const wealthDocument = { ownerUid: 'synthetic-owner', closures };

    const preview = await buildHistoricalGastappBackfillPreview({
      closures,
      candidatesByMonth,
      reconstructionAt: '2026-10-04T12:00:00.000Z',
      includeRiskCapitalInTotals: false,
      currency: 'CLP',
      wealthDocument,
    });

    expect(preview.totalClosures).toBe(40);
    expect(preview.baseMonth).toBe('2023-05');
    expect(preview.comparableMonths).toBe(39);
    expect(preview.snapshotsPresent).toBe(1);
    expect(preview.snapshotsToComplete).toBe(38);
    expect(preview.blockers).toBe(0);
    expect(preview.coverage.current.sinceStart).toEqual({ valid: 1, expected: 39 });
    expect(preview.coverage.projected.sinceStart).toEqual({ valid: 39, expected: 39 });
    expect(preview.coverage.projected.last12m).toEqual({ valid: 12, expected: 12 });
    expect(preview.coverage.projected.ytd).toEqual({ valid: 8, expected: 8 });
    expect(preview.lastOfficialMonth).toBe('2026-08');
    expect(preview.manifest.some((row) => row.monthKey === '2026-09')).toBe(false);
    expect(preview.manifest.find((row) => row.monthKey === '2023-05')?.status).toBe('base_month_non_comparable');
    expect(preview.documentSize.available).toBe(true);
    expect(preview.documentSize.incrementApproxBytes).toBe(0);
    expect(preview.documentSize.status).toBe('within_limit');
    expect(preview.writesPerformed).toBe(false);
    expect(closures).toEqual(originalClosures);

    for (const row of preview.manifest.filter((item) => item.status === 'eligible_for_backfill')) {
      expect(row.fingerprintsMatch).toBe(true);
      expect(row.preFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(row.postFingerprint).toBe(row.preFingerprint);
      const before = originalClosures.find((closure) => closure.monthKey === row.monthKey)!;
      const after = preview.simulatedClosures.find((closure) => closure.monthKey === row.monthKey)!;
      expect(after).toMatchObject({
        id: before.id,
        monthKey: before.monthKey,
        closedAt: before.closedAt,
        summary: before.summary,
        records: before.records,
        fxRates: before.fxRates,
        fxMetadata: before.fxMetadata,
        fxMissing: before.fxMissing,
        previousVersions: before.previousVersions,
      });
      expect(row.proposedSnapshot?.fxRates).toEqual(before.fxRates);
    }
    expect(preview.simulatedClosures[existingIndex].gastappExpenseClose).toEqual(closures[existingIndex].gastappExpenseClose);

    const sidecar = buildHistoricalGastappSidecarPlan(preview, null);
    expect(parseHistoricalGastappSidecar(structuredClone(sidecar))).toEqual(sidecar);
    expect(Object.keys(sidecar.snapshotsByMonth)).toHaveLength(38);
    expect(preview.sidecarSize.status).toBe('within_limit');
    expect(closures).toEqual(originalClosures);
    const after = await buildHistoricalGastappBackfillPreview({
      closures,
      candidatesByMonth,
      reconstructionAt: preview.reconstructionAt,
      wealthDocument,
      sidecar,
    });
    expect(after.snapshotsToComplete).toBe(0);
    expect(after.coverage.current.sinceStart).toEqual({ valid: 39, expected: 39 });
    expect(after.coverage.current.last12m).toEqual({ valid: 12, expected: 12 });
    expect(after.coverage.current.ytd).toEqual({ valid: 8, expected: 8 });
    expect(buildHistoricalGastappSidecarPlan(after, sidecar)).toEqual(sidecar);

    // The embedded snapshot remains authoritative even if a conflicting historical entry appears.
    const conflictingCandidate = makeCandidate(existingMonth, { partialEur: 999 });
    const conflictingSnapshot = buildGastappMonthlyExpenseCloseSnapshot(
      conflictingCandidate.snapshot!,
      closures[existingIndex].fxRates!,
      '2026-10-04T10:00:00.000Z',
    );
    const sidecarWithConflict = structuredClone(sidecar);
    sidecarWithConflict.snapshotsByMonth[existingMonth] = {
      closureId: closures[existingIndex].id,
      snapshot: conflictingSnapshot,
      repairAudit: {
        reason: 'historical_schema_compatibility_reconstruction',
        reconstructedAt: '2026-10-04T12:00:00.000Z',
        originalClosureAt: closures[existingIndex].closedAt,
        preFingerprint: sha('f'),
        postFingerprint: sha('f'),
        sourceContractHash: conflictingSnapshot.contractHash,
      },
    };
    setHistoricalGastappSidecarForAnalysis('synthetic-owner', sidecarWithConflict);
    const embeddedRow = computeMonthlyRows([closures[existingIndex]], false, 'CLP')[0];
    expect(embeddedRow.gastosClp).toBeCloseTo(
      closures[existingIndex].gastappExpenseClose!.totalEur * closures[existingIndex].fxRates!.eurClp,
    );
    expect(getHistoricalGastappSnapshotForAnalysis(existingMonth, 'different-closure')).toBeUndefined();

    // A stale client still has root closures without sidecars. Cloud merging must never embed the overlay.
    expect(getHistoricalGastappSnapshotForAnalysis('2023-07', 'closure-2023-07')).toBeDefined();
    expect(computeMonthlyRows(closures, false, 'CLP').find((row) => row.monthKey === '2023-07')?.gastosClp).toBeGreaterThan(0);
    const staleMerge = mergeClosuresForSync(structuredClone(closures), structuredClone(closures), true);
    expect(staleMerge.every((closure) => closure.gastappExpenseClose === undefined || closure.monthKey === existingMonth)).toBe(true);
    expect(closures).toEqual(originalClosures);
    setHistoricalGastappSidecarForAnalysis(null, null);
  });

  it('surfaces missing closures, uncertified GastApp, and missing historical FX as separate blockers', async () => {
    const closures = [
      makeClosure('2023-05', 0),
      makeClosure('2023-06', 1),
      makeClosure('2023-08', 3, ['eurClp']),
    ];
    const candidatesByMonth = {
      '2023-06': makeCandidate('2023-06', { status: 'pending' }),
      '2023-07': makeCandidate('2023-07'),
      '2023-08': makeCandidate('2023-08', { status: 'stale' }),
    };

    const preview = await buildHistoricalGastappBackfillPreview({
      closures,
      candidatesByMonth,
      reconstructionAt: '2026-10-04T12:00:00.000Z',
    });
    const byMonth = new Map(preview.manifest.map((row) => [row.monthKey, row]));

    expect(byMonth.get('2023-06')?.status).toBe('gastapp_not_certified');
    expect(byMonth.get('2023-07')?.status).toBe('missing_closure');
    expect(byMonth.get('2023-08')?.status).toBe('missing_fx');
    expect(byMonth.get('2023-08')?.blockers).toHaveLength(2);
    expect(preview.snapshotsToComplete).toBe(0);
    expect(preview.coverage.projected.sinceStart.valid).toBe(0);
  });

  it('does not mark a missing Canonical V2 month eligible', async () => {
    const closures = [makeClosure('2023-05', 0), makeClosure('2023-06', 1)];
    const preview = await buildHistoricalGastappBackfillPreview({
      closures,
      candidatesByMonth: {},
      reconstructionAt: '2026-10-04T12:00:00.000Z',
    });
    expect(preview.manifest.find((row) => row.monthKey === '2023-06')?.status).toBe('gastapp_missing');
    expect(preview.snapshotsToComplete).toBe(0);
    expect(preview.documentSize.status).toBe('unavailable');
  });

  it('preserves an unnormalizable snapshot already present in the raw cloud document', async () => {
    const closures = [makeClosure('2023-05', 0), makeClosure('2023-06', 1)];
    const rawClosures = structuredClone(closures) as Array<Record<string, unknown>>;
    rawClosures[1].gastappExpenseClose = { schemaVersion: 'unknown-corrupt-snapshot' };
    const preview = await buildHistoricalGastappBackfillPreview({
      closures,
      candidatesByMonth: { '2023-06': makeCandidate('2023-06') },
      reconstructionAt: '2026-10-04T12:00:00.000Z',
      wealthDocument: { closures: rawClosures },
    });
    const row = preview.manifest.find((item) => item.monthKey === '2023-06');

    expect(row?.status).toBe('conflict_existing_snapshot');
    expect(row?.snapshotPresent).toBe(true);
    expect(row?.proposedSnapshot).toBeUndefined();
    expect(preview.snapshotsToComplete).toBe(0);
    expect(preview.documentSize.status).toBe('within_limit');
    expect(preview.documentSize.incrementApproxBytes).toBe(0);
  });

  it('leaves the root size unchanged even when the root is already near the Firestore limit', async () => {
    const closures = monthsBetween('2023-05', '2026-08').map((monthKey, index) => makeClosure(monthKey, index));
    const candidatesByMonth = Object.fromEntries(closures.map((closure) => [closure.monthKey, makeCandidate(closure.monthKey)]));
    const preview = await buildHistoricalGastappBackfillPreview({
      closures,
      candidatesByMonth,
      reconstructionAt: '2026-10-04T12:00:00.000Z',
      wealthDocument: { closures, padding: 'x'.repeat(900_000) },
    });
    expect(preview.documentSize.incrementApproxBytes).toBe(0);
    expect(preview.documentSize.projectedApproxBytes).toBe(preview.documentSize.currentApproxBytes);
    expect(preview.sidecarSize.status).toBe('within_limit');
  });
});
