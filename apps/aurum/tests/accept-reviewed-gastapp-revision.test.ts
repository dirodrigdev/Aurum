import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GastappMonthlyCloseCandidate } from '../src/services/gastosMonthly';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), resolve: vi.fn(), load: vi.fn(), accept: vi.fn(), returns: vi.fn(),
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
}));
import {
  acceptReviewedGastappRevision,
  applyCertifiedGastappRevisions,
  buildGastappRevisionNotices,
  buildGastappRevisionInbox,
  gastappRevisionNoticeKey,
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
});
});
