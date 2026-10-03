import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GastappMonthlyCloseCandidate } from '../src/services/gastosMonthly';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), resolve: vi.fn(), load: vi.fn(), accept: vi.fn(),
}));
vi.mock('../src/services/gastosMonthly', () => ({
  refreshGastappMonthlyContable: mocks.refresh,
  resolveGastappMonthlyCloseCandidate: mocks.resolve,
}));
vi.mock('../src/services/wealthStorage', () => ({
  loadClosures: mocks.load,
  acceptGastappMonthlyClosureRevision: mocks.accept,
}));
import { acceptReviewedGastappRevision } from '../src/services/acceptReviewedGastappRevision';

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
});
