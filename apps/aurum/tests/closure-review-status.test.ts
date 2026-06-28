import { describe, expect, it } from 'vitest';
import {
  buildHistoricalClosureReviewBuckets,
  classifyHistoricalClosureReviewStatus,
  describeHistoricalClosureReviewStatus,
  groupClosureMonthKeysByYear,
  isClosureReviewCompletionCandidate,
} from '../src/services/closureReviewStatus';
import type { WealthMonthlyClosure } from '../src/services/wealthStorage';

const baseSummary = {
  netByCurrency: { CLP: 1_000_000, USD: 0, EUR: 0, UF: 0 },
  assetsByCurrency: { CLP: 1_100_000, USD: 0, EUR: 0, UF: 0 },
  debtsByCurrency: { CLP: 100_000, USD: 0, EUR: 0, UF: 0 },
  netConsolidatedClp: 1_000_000,
  byBlock: {
    bank: { CLP: 100_000, USD: 0, EUR: 0, UF: 0 },
    investment: { CLP: 900_000, USD: 0, EUR: 0, UF: 0 },
    real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
    debt: { CLP: 100_000, USD: 0, EUR: 0, UF: 0 },
  },
  investmentClp: 900_000,
  investmentClpWithRisk: 900_000,
  bankClp: 100_000,
  nonMortgageDebtClp: 100_000,
  realEstateNetClp: 0,
  netClp: 1_000_000,
  netClpWithRisk: 1_000_000,
} satisfies WealthMonthlyClosure['summary'];

const makeClosure = (input: Partial<WealthMonthlyClosure> & { monthKey: string }): WealthMonthlyClosure => ({
  id: input.monthKey,
  monthKey: input.monthKey,
  closedAt: input.closedAt ?? `${input.monthKey}-28T23:59:59Z`,
  summary: Object.prototype.hasOwnProperty.call(input, 'summary') ? input.summary : baseSummary,
  fxRates: input.fxRates ?? { usdClp: 950, eurClp: 1030, ufClp: 39000 },
  fxMissing: input.fxMissing,
  records: input.records,
  previousVersions: input.previousVersions,
  repairAudit: input.repairAudit,
});

describe('closure review status classification', () => {
  it('treats a summary-only historical closure as usable history, not critical', () => {
    const status = classifyHistoricalClosureReviewStatus(
      makeClosure({ monthKey: '2024-06', records: undefined }),
    );

    expect(status.classification).toBe('historical_summary_only');
    expect(status.isCriticalPending).toBe(false);
    expect(status.isHistoricalSummaryOnly).toBe(true);
    expect(isClosureReviewCompletionCandidate(status)).toBe(true);
  });

  it('keeps missing critical FX as a real pending review issue', () => {
    const status = classifyHistoricalClosureReviewStatus(
      makeClosure({
        monthKey: '2024-07',
        fxRates: undefined,
        fxMissing: ['usdClp'],
        records: [],
      }),
    );

    expect(status.classification).toBe('critical_pending');
    expect(status.isCriticalPending).toBe(true);
    expect(status.pendingReasons).toContain('missing_fx');
    expect(isClosureReviewCompletionCandidate(status)).toBe(false);
  });

  it('keeps a closure without summary as a real pending review issue', () => {
    const status = classifyHistoricalClosureReviewStatus(
      makeClosure({
        monthKey: '2024-08',
        summary: undefined as unknown as WealthMonthlyClosure['summary'],
        records: [],
      }),
    );

    expect(status.classification).toBe('critical_pending');
    expect(status.pendingReasons).toContain('missing_summary');
  });

  it('keeps external pending metadata as administrative when the closure is otherwise usable', () => {
    const status = classifyHistoricalClosureReviewStatus(
      makeClosure({
        monthKey: '2024-09',
        records: [
          {
            id: 'record-1',
            block: 'bank',
            source: 'manual',
            label: 'Banco',
            amount: 100_000,
            currency: 'CLP',
            snapshotDate: '2024-09-30',
            createdAt: '2024-09-30T12:00:00Z',
          },
        ],
      }),
      'pending',
    );

    expect(status.classification).toBe('administrative_pending');
    expect(status.isAdministrativePending).toBe(true);
    expect(status.isCriticalPending).toBe(false);
  });

  it('reports no critical warning when only historical summary-only closures exist', () => {
    const closures = [
      makeClosure({ monthKey: '2023-05' }),
      makeClosure({ monthKey: '2024-01' }),
      makeClosure({ monthKey: '2025-12' }),
    ];
    const buckets = buildHistoricalClosureReviewBuckets(closures);
    const summary = describeHistoricalClosureReviewStatus(37, buckets);

    expect(buckets.critical).toHaveLength(0);
    expect(buckets.historicalSummaryOnly).toHaveLength(3);
    expect(summary.text).toBe('Sin pendientes críticos');
  });

  it('groups historical summary-only months by year for Settings copy', () => {
    const labels = groupClosureMonthKeysByYear([
      '2023-05',
      '2023-06',
      '2023-12',
      '2024-01',
      '2024-12',
      '2025-01',
      '2025-12',
    ]);

    expect(labels).toEqual([
      '2023: mayo–diciembre',
      '2024: enero–diciembre',
      '2025: enero–diciembre',
    ]);
  });
});
