import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GastappMonthlyCloseCandidate } from '../src/services/gastosMonthly';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), resolve: vi.fn(), load: vi.fn(), accept: vi.fn(), returns: vi.fn(),
  sidecarState: { value: null as any }, applySidecar: vi.fn(), readSidecar: vi.fn(), readWealth: vi.fn(),
}));
vi.mock('../src/services/returnsAnalysis', () => ({
  computeMonthlyRows: mocks.returns,
}));
vi.mock('../src/services/gastosMonthly', () => ({
  refreshGastappMonthlyContable: mocks.refresh,
  resolveGastappMonthlyCloseCandidate: mocks.resolve,
}));
vi.mock('../src/services/wealthStorage', () => ({
  loadClosures: mocks.load,
  acceptGastappMonthlyClosureRevision: mocks.accept,
  readWealthCloudDocumentForAudit: mocks.readWealth,
}));
vi.mock('../src/services/historicalGastappSidecar', () => ({
  getHistoricalGastappSidecarAnalysisState: () => mocks.sidecarState.value,
  applyCertifiedHistoricalGastappSidecarRevisions: mocks.applySidecar,
  readHistoricalGastappSidecarFromServer: mocks.readSidecar,
}));
import {
  acceptReviewedGastappRevision,
  applyCertifiedGastappRevisions,
  auditGastappHistoricalRevisions,
  buildGastappRevisionNotices,
  buildGastappRevisionInbox,
  gastappRevisionNoticeKey,
  summarizeGastappHistoricalRevisionAudit,
} from '../src/services/acceptReviewedGastappRevision';

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const input = { monthKey: '2026-09', expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b') };
const candidate = (letter: string, revision: number): GastappMonthlyCloseCandidate => ({
  monthKey: '2026-09', status: 'complete', partialGastosEur: 2715,
  partialByFamilyEur: { dayToDay: 2500, trips: 200, others: 15 },
  sourceChangedAfterClosure: true, currentContractHash: hash(letter), storedContractHash: hash('a'),
  message: 'Mes certificado y conciliado.',
  snapshot: {
    monthKey: '2026-09', calendarMonthKey: '2026-09', totalEur: 2715,
    byFamilyEur: { dayToDay: 2500, trips: 200, others: 15 },
    canonicalDataHash: hash('e'), operationalDataHash: hash('e'), operationalRevision: revision,
    sourceGeneration: revision, monthContractRevision: revision, monthContractHash: hash(letter),
    certificationStatus: 'revised', certificationRevision: revision, certificationHash: hash('d'),
    contractHash: hash(letter), contractVersion: 'gastapp-aurum-calendar-months-v2',
    generatedAt: '2026-10-01T12:00:00Z',
  },
});

describe('accept the reviewed GastApp revision', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockReturnValue([{ monthKey: '2026-09', gastappExpenseClose: { contractHash: hash('a') } }]);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.resolve.mockReturnValue(candidate('b', 2));
    mocks.accept.mockResolvedValue({ changed: true });
    mocks.sidecarState.value = {
      status: 'ready', hasAuthoritativeSnapshot: true, document: null,
    };
    mocks.applySidecar.mockResolvedValue({ changed: [], unchanged: [], failed: [], document: null });
    mocks.readWealth.mockResolvedValue({ closures: [] });
    mocks.readSidecar.mockImplementation(async () => ({ document: mocks.sidecarState.value.document }));
  });

  it('rejects a newer valid certified revision published after comparison, then allows a reviewed retry', async () => {
    mocks.refresh.mockImplementationOnce(async () => { mocks.resolve.mockReturnValue(candidate('c', 3)); });
    await expect(acceptReviewedGastappRevision(input)).rejects.toThrow('Actualiza la comparación');
    expect(mocks.accept).not.toHaveBeenCalled();
    await expect(acceptReviewedGastappRevision({ ...input, expectedCandidateContractHash: hash('c') })).resolves.toMatchObject({ changed: true });
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(mocks.accept).toHaveBeenCalledWith({ ...input, expectedCandidateContractHash: hash('c'), snapshot: candidate('c', 3).snapshot });
  });

  it('rejects a closure that changes during the source refresh without writing', async () => {
    mocks.refresh.mockImplementationOnce(async () => { mocks.load.mockReturnValue([{ monthKey: '2026-09', gastappExpenseClose: { contractHash: hash('c') } }]); });
    await expect(acceptReviewedGastappRevision(input)).rejects.toThrow('Actualiza la comparación');
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it('does not write when GastApp refresh fails', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('Lectura no disponible'));
    await expect(acceptReviewedGastappRevision(input)).rejects.toThrow('Lectura no disponible');
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it('does not accept an uncertified revision', async () => {
    mocks.resolve.mockReturnValue({ ...candidate('b', 2), status: 'stale', snapshot: null, message: 'Falta certificar' });
    await expect(acceptReviewedGastappRevision(input)).rejects.toThrow('Falta certificar');
    expect(mocks.accept).not.toHaveBeenCalled();
  });


describe('automatic certified GastApp revision sync', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockReturnValue([{ monthKey: '2026-09', gastappExpenseClose: { contractHash: hash('a') } }]);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.resolve.mockReturnValue(candidate('b', 2));
    mocks.accept.mockResolvedValue({ changed: true, closure: { monthKey: '2026-09' } });
  });

  it('applies a certified revision without requiring a second user approval', async () => {
    const result = await applyCertifiedGastappRevisions();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.accept).toHaveBeenCalledWith({
      monthKey: '2026-09',
      expectedPreviousContractHash: hash('a'),
      expectedCandidateContractHash: hash('b'),
      snapshot: candidate('b', 2).snapshot,
    });
    expect(result.applied).toEqual([{
      monthKey: '2026-09',
      changed: true,
      previousContractHash: hash('a'),
      currentContractHash: hash('b'),
    }]);
    expect(result.pendingUncertified).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('runs only the read-only audit when automatic historical writes are disabled', async () => {
    vi.stubEnv('VITE_GASTAPP_REVISION_AUTO_SYNC', 'false');
    mocks.readWealth.mockResolvedValue({ closures: [] });
    mocks.readSidecar.mockResolvedValue({ document: null });

    try {
      const result = await applyCertifiedGastappRevisions();

      expect(result.writesDisabled).toBe(true);
      expect(result.applied).toEqual([]);
      expect(mocks.readWealth).toHaveBeenCalledTimes(1);
      expect(mocks.readSidecar).toHaveBeenCalledTimes(1);
      expect(mocks.accept).not.toHaveBeenCalled();
      expect(mocks.applySidecar).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps an incomplete or uncertified revision pending without writing', async () => {
    mocks.resolve.mockReturnValue({ ...candidate('b', 2), status: 'stale', snapshot: null, message: 'Falta certificar' });
    const result = await applyCertifiedGastappRevisions();
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(result.pendingUncertified).toEqual(['2026-09']);
    expect(result.applied).toEqual([]);
  });

  it('contains a concurrent write failure and leaves it available for a later retry', async () => {
    mocks.accept.mockRejectedValueOnce(new Error('La versión cloud del cierre cambió.'));
    const result = await applyCertifiedGastappRevisions();
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([{ monthKey: '2026-09', message: 'La versión cloud del cierre cambió.' }]);
  });

  it('never treats the synthetic emulator fixture hash as a published revision', async () => {
    mocks.load.mockReturnValue([{ id: 'closure-2026-09', monthKey: '2026-09' }]);
    mocks.sidecarState.value = {
      status: 'ready', hasAuthoritativeSnapshot: true,
      document: { schemaVersion: 'aurum-gastapp-historical-sidecar-v1', snapshotsByMonth: {
        '2026-09': { closureId: 'closure-2026-09', snapshot: { contractHash: hash('a'), totalEur: 100 } },
      } },
    };
    mocks.resolve.mockReturnValue({
      ...candidate('b', 2),
      sourceChangedAfterClosure: true,
      snapshot: { ...candidate('b', 2).snapshot, contractVersion: 'e2e_fixture' },
    });

    const result = await applyCertifiedGastappRevisions();

    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.applySidecar).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('reports historical snapshots as missing or blocked when they cannot be paired with a closure', async () => {
    const closures = [
      { id: 'missing-closure', monthKey: '2026-01' },
      { id: 'real-closure', monthKey: '2026-02' },
    ];
    const sidecar = {
      schemaVersion: 'aurum-gastapp-historical-sidecar-v1',
      snapshotsByMonth: {
        '2026-02': { closureId: 'different-closure', snapshot: { contractHash: hash('a'), totalEur: 10 } },
      },
    };
    mocks.readWealth.mockResolvedValue({ closures });
    mocks.readSidecar.mockResolvedValue({ document: sidecar });
    mocks.sidecarState.value = { status: 'ready', hasAuthoritativeSnapshot: true, document: sidecar };
    mocks.resolve.mockReturnValue({
      ...candidate('b', 2), status: 'pending', sourceChangedAfterClosure: false,
      currentContractHash: null, partialGastosEur: null, snapshot: null,
      message: 'GastApp sin contrato certificado.',
    });

    const audit = await auditGastappHistoricalRevisions();

    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ monthKey: '2026-01', status: 'missing', effectiveSource: 'none' }),
      expect.objectContaining({ monthKey: '2026-02', status: 'blocked', effectiveSource: 'blocked', message: 'El sidecar no coincide con el cierre histórico.' }),
    ]));
  });

  it('summarizes the read-only audit with explicit status counts and months', () => {
    expect(summarizeGastappHistoricalRevisionAudit([
      { monthKey: '2026-01', status: 'current' },
      { monthKey: '2026-02', status: 'stale' },
      { monthKey: '2026-04', status: 'missing' },
      { monthKey: '2026-09', status: 'blocked' },
    ] as any)).toContain('1 actuales, 1 desactualizados, 1 sin snapshot y 1 bloqueados. Pendientes: 2026-02 stale, 2026-04 missing, 2026-09 blocked. No se modificaron datos.');
  });

  it('audits and applies January, February and April sidecar corrections, while September stays idempotently current', async () => {
    const monthInputs: Record<string, { previous: string; current: string; oldTotal: number; newTotal: number }> = {
      '2026-01': { previous: 'a', current: 'b', oldTotal: 7675.01, newTotal: 7764.01 },
      '2026-02': { previous: 'c', current: 'd', oldTotal: 5946.19, newTotal: 6059.47 },
      '2026-04': { previous: 'e', current: 'f', oldTotal: 5830.86, newTotal: 11378.28 },
      '2026-09': { previous: 'g', current: 'g', oldTotal: 10313.78, newTotal: 10313.78 },
    };
    const makeInput = (monthKey: string, letter: string, totalEur: number, revision: number) => ({
      monthKey, calendarMonthKey: monthKey, totalEur,
      byFamilyEur: { dayToDay: totalEur, trips: 0, others: 0 },
      canonicalDataHash: hash('1'), operationalDataHash: hash('2'), operationalRevision: revision,
      sourceGeneration: revision, monthContractRevision: revision,
      monthContractHash: hash(letter), certificationStatus: 'revised' as const,
      certificationRevision: revision, certificationHash: hash('3'), contractHash: hash(letter),
      contractVersion: 'gastapp-aurum-calendar-months-v2', generatedAt: '2026-10-01T12:00:00.000Z',
    });
    const makeSnapshot = (monthKey: string, letter: string, totalEur: number, revision: number) => ({
      ...makeInput(monthKey, letter, totalEur, revision),
      schemaVersion: 'aurum-gastapp-monthly-close-v2' as const,
      sourcePath: 'gastapp_aurum_contracts_v2/months_current' as const,
      capturedAt: '2026-10-02T12:00:00.000Z',
      fxRates: { usdClp: 900, eurClp: 1000, ufClp: 40000 },
      amountsByCurrency: {
        EUR: { total: totalEur, dayToDay: totalEur, trips: 0, others: 0 },
        CLP: { total: totalEur * 1000, dayToDay: totalEur * 1000, trips: 0, others: 0 },
        USD: { total: totalEur * 1000 / 900, dayToDay: totalEur * 1000 / 900, trips: 0, others: 0 },
        UF: { total: totalEur / 40, dayToDay: totalEur / 40, trips: 0, others: 0 },
      },
    });
    const sidecarMonths = Object.entries(monthInputs).filter(([month]) => month !== '2026-09');
    const sidecar = {
      schemaVersion: 'aurum-gastapp-historical-sidecar-v1' as const,
      snapshotsByMonth: Object.fromEntries(sidecarMonths.map(([monthKey, input]) => [monthKey, {
        closureId: `closure-${monthKey}`,
        snapshot: makeSnapshot(monthKey, input.previous, input.oldTotal, 1),
        repairAudit: {
          reason: 'historical_schema_compatibility_reconstruction' as const,
          reconstructedAt: '2026-10-01T00:00:00.000Z', originalClosureAt: `${monthKey}-28T00:00:00.000Z`,
          preFingerprint: hash('4'), postFingerprint: hash('4'), sourceContractHash: hash(input.previous),
        },
        previousVersions: [],
      }])),
    };
    const closures = [
      ...sidecarMonths.map(([monthKey]) => ({ id: `closure-${monthKey}`, monthKey, closedAt: `${monthKey}-28T00:00:00.000Z`, summary: {} as never })),
      {
        id: 'closure-2026-09', monthKey: '2026-09', closedAt: '2026-09-30T00:00:00.000Z',
        summary: {} as never,
        gastappExpenseClose: makeSnapshot('2026-09', 'g', 10313.78, 2),
      },
    ];
    mocks.load.mockReturnValue(closures);
    mocks.sidecarState.value = { status: 'ready', hasAuthoritativeSnapshot: true, document: sidecar };
    mocks.resolve.mockImplementation((monthKey: string, options: { previousSnapshot?: { contractHash: string } }) => {
      const month = monthInputs[monthKey];
      const current = makeInput(monthKey, month.current, month.newTotal, month.current === month.previous ? 1 : 2);
      const storedHash = options.previousSnapshot?.contractHash || null;
      return {
        monthKey, status: 'complete', partialGastosEur: month.newTotal,
        partialByFamilyEur: { dayToDay: month.newTotal, trips: 0, others: 0 },
        sourceChangedAfterClosure: Boolean(storedHash && storedHash !== current.contractHash),
        currentContractHash: current.contractHash, storedContractHash: storedHash, message: 'certificado', snapshot: current,
      };
    });
    mocks.applySidecar.mockResolvedValue({
      changed: ['2026-01', '2026-02', '2026-04'], unchanged: [], failed: [], document: sidecar,
    });
    mocks.readWealth.mockResolvedValue({ closures });
    mocks.readSidecar.mockResolvedValue({ document: sidecar });

    const audit = await auditGastappHistoricalRevisions();
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ monthKey: '2026-01', status: 'stale', effectiveSource: 'sidecar', currentTotalEur: 7764.01 }),
      expect.objectContaining({ monthKey: '2026-02', status: 'stale', effectiveSource: 'sidecar', currentTotalEur: 6059.47 }),
      expect.objectContaining({ monthKey: '2026-04', status: 'stale', effectiveSource: 'sidecar', currentTotalEur: 11378.28 }),
      expect.objectContaining({ monthKey: '2026-09', status: 'current', effectiveSource: 'closure', currentTotalEur: 10313.78 }),
    ]));

    const result = await applyCertifiedGastappRevisions();
    expect(mocks.applySidecar).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ monthKey: '2026-01', expectedPreviousContractHash: hash('a'), expectedCandidateContractHash: hash('b') }),
      expect.objectContaining({ monthKey: '2026-02', expectedPreviousContractHash: hash('c'), expectedCandidateContractHash: hash('d') }),
      expect.objectContaining({ monthKey: '2026-04', expectedPreviousContractHash: hash('e'), expectedCandidateContractHash: hash('f') }),
    ]));
    expect(mocks.applySidecar.mock.calls[0][0]).toHaveLength(3);
    expect(result.applied.map(({ monthKey, changed }) => [monthKey, changed])).toEqual([
      ['2026-01', true], ['2026-02', true], ['2026-04', true],
    ]);
    expect(result.failed).toEqual([]);
  });
});

describe('post-application GastApp revision notices', () => {
  beforeEach(() => {
    mocks.returns.mockImplementation((clos: Array<{monthKey: string; gastappExpenseClose?: {totalEur: number}}>) =>
      clos.map((row) => ({ monthKey: row.monthKey, pct: (row.gastappExpenseClose?.totalEur || 0) / 100 })));
  });
  const snapshot = (letter: string, revision: number, totalEur: number) => ({
    ...candidate(letter, revision).snapshot!,
    schemaVersion: 'aurum-gastapp-monthly-close-v2' as const,
    sourcePath: 'gastapp_aurum_contracts_v2/months_current' as const,
    capturedAt: `2026-10-0${revision}T12:00:00Z`,
    fxRates: { usdClp: 900, eurClp: 1000, ufClp: 40000 },
    amountsByCurrency: {
      EUR: { total: totalEur, dayToDay: totalEur, trips: 0, others: 0 },
      CLP: { total: totalEur * 1000, dayToDay: totalEur * 1000, trips: 0, others: 0 },
      USD: { total: totalEur * 1000 / 900, dayToDay: totalEur * 1000 / 900, trips: 0, others: 0 },
      UF: { total: totalEur / 40, dayToDay: totalEur / 40, trips: 0, others: 0 },
    },
    totalEur,
    byFamilyEur: { dayToDay: totalEur, trips: 0, others: 0 },
  });

  it('derives the before/after notice from the archived closure version', () => {
    const previous = snapshot('a', 1, 2000);
    const current = snapshot('b', 2, 2715);
    const notices = buildGastappRevisionNotices([{
      id: 'jul',
      monthKey: '2026-09',
      closedAt: '2026-09-30T23:00:00Z',
      summary: {} as never,
      gastappExpenseClose: current,
      previousVersions: [{
        id: 'jul:gastapp:1',
        monthKey: '2026-09',
        closedAt: '2026-09-30T23:00:00Z',
        replacedAt: '2026-10-02T12:00:00Z',
        summary: {} as never,
        gastappExpenseClose: previous,
      }],
    }]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      id: gastappRevisionNoticeKey('2026-09', current.contractHash),
      monthKey: '2026-09',
      previousSnapshot: { totalEur: 2000 },
      currentSnapshot: { totalEur: 2715 },
    });
  });


  it('groups multiple unseen corrections and starts a new notice only after acknowledgement', () => {
    const first = snapshot('a', 1, 2000);
    const second = snapshot('b', 2, 2300);
    const latest = snapshot('c', 3, 2500);
    const closure = {
      id: 'apr', monthKey: '2026-04', closedAt: '2026-04-30T23:00:00Z',
      summary: {} as never,
      gastappExpenseClose: latest,
      previousVersions: [
        { id: 'apr:gastapp:1', monthKey: '2026-04', closedAt: '2026-04-30T23:00:00Z', replacedAt: '2026-05-01T12:00:00Z', summary: {} as never, gastappExpenseClose: first },
        { id: 'apr:gastapp:2', monthKey: '2026-04', closedAt: '2026-04-30T23:00:00Z', replacedAt: '2026-05-02T12:00:00Z', summary: {} as never, gastappExpenseClose: second },
      ],
    };
    const unseen = buildGastappRevisionInbox([closure], {}, false);
    expect(unseen).toHaveLength(1);
    expect(unseen[0]).toMatchObject({
      monthKey: '2026-04', originalGastosEur: 2000, updatedGastosEur: 2500,
      originalReturnPct: 20, updatedReturnPct: 25, revisionCount: 2,
    });
    // Last acknowledged state is the baseline; older changes do not accumulate.
    const afterFirstAck = buildGastappRevisionInbox([closure], { '2026-04': second.contractHash }, false);
    expect(afterFirstAck).toHaveLength(1);
    expect(afterFirstAck[0]).toMatchObject({
      originalGastosEur: 2300, updatedGastosEur: 2500,
      originalReturnPct: 23, updatedReturnPct: 25, revisionCount: 1,
    });
    expect(buildGastappRevisionInbox([closure], { '2026-04': latest.contractHash }, false)).toEqual([]);
  });

  it('ignores ordinary closure history that was not created by a GastApp revision', () => {
    const previous = snapshot('a', 1, 2000);
    const current = snapshot('b', 2, 2715);
    const notices = buildGastappRevisionNotices([{
      id: 'sep',
      monthKey: '2026-09',
      closedAt: '2026-09-30T23:00:00Z',
      summary: {} as never,
      gastappExpenseClose: current,
      previousVersions: [{
        id: 'sep:ordinary-reclose',
        monthKey: '2026-09',
        closedAt: '2026-09-30T23:00:00Z',
        replacedAt: '2026-10-02T12:00:00Z',
        summary: {} as never,
        gastappExpenseClose: previous,
      }],
    }]);
    expect(notices).toEqual([]);
  });

  it('hides only the exact revision that the user already acknowledged', () => {
    const previous = snapshot('a', 1, 2000);
    const current = snapshot('b', 2, 2715);
    const closure = {
      id: 'sep',
      monthKey: '2026-09',
      closedAt: '2026-09-30T23:00:00Z',
      summary: {} as never,
      gastappExpenseClose: current,
      previousVersions: [{
        id: 'sep:gastapp:1', monthKey: '2026-09', closedAt: '2026-09-30T23:00:00Z',
        replacedAt: '2026-10-02T12:00:00Z', summary: {} as never, gastappExpenseClose: previous,
      }],
    };
    const acknowledged = new Set([gastappRevisionNoticeKey('2026-09', current.contractHash)]);
    expect(buildGastappRevisionNotices([closure], acknowledged)).toEqual([]);
  });

  it('notifies sidecar revisions using the same per-month seen hash and suppresses acknowledged months', () => {
    const previous = snapshot('b', 1, 5830.86);
    const current = snapshot('f', 2, 11378.28);
    const sidecar = {
      schemaVersion: 'aurum-gastapp-historical-sidecar-v1' as const,
      snapshotsByMonth: {
        '2026-04': {
          closureId: 'apr', snapshot: current,
          repairAudit: {
            reason: 'historical_schema_compatibility_reconstruction' as const,
            reconstructedAt: '2026-10-01T00:00:00.000Z', originalClosureAt: '2026-04-30T00:00:00.000Z',
            preFingerprint: hash('1'), postFingerprint: hash('1'), sourceContractHash: current.contractHash,
          },
          previousVersions: [{ snapshot: previous, replacedAt: '2026-10-02T00:00:00.000Z', repairAudit: {
            reason: 'historical_schema_compatibility_reconstruction' as const,
            reconstructedAt: '2026-10-01T00:00:00.000Z', originalClosureAt: '2026-04-30T00:00:00.000Z',
            preFingerprint: hash('1'), postFingerprint: hash('1'), sourceContractHash: previous.contractHash,
          } }],
        },
      },
    };
    const closure = { id: 'apr', monthKey: '2026-04', closedAt: '2026-04-30T00:00:00.000Z', summary: {} as never };
    expect(buildGastappRevisionInbox([closure], {}, false, sidecar)).toMatchObject([{
      monthKey: '2026-04', originalGastosEur: 5830.86, updatedGastosEur: 11378.28, revisionCount: 1,
    }]);
    expect(buildGastappRevisionInbox([closure], { '2026-04': current.contractHash }, false, sidecar)).toEqual([]);
  });
});
});
