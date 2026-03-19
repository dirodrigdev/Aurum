import { describe, expect, it } from 'vitest';
import { buildReturnSpendInsight } from '../src/components/analysis/shared';
import type { AggregatedSummary } from '../src/components/analysis/types';

const makeSummary = (overrides: Partial<AggregatedSummary>): AggregatedSummary => ({
  key: 'test',
  label: 'Test',
  validMonths: 12,
  varPatrimonioAcumClp: 10_000_000,
  gastosAcumClp: 5_000_000,
  retornoRealAcumClp: 20_000_000,
  pctRetorno: 10,
  pctRetornoNote: null,
  spendPct: 25,
  varPatrimonioAvgDisplay: 1_000_000,
  gastosAvgDisplay: 400_000,
  retornoRealAvgDisplay: 1_600_000,
  ...overrides,
});

describe('buildReturnSpendInsight', () => {
  it('shows the spend ratio when the return is positive and representative', () => {
    const insight = buildReturnSpendInsight(
      makeSummary({
        gastosAcumClp: 6_000_000,
        retornoRealAcumClp: 20_000_000,
        spendPct: 30,
      }),
    );

    expect(insight.kind).toBe('pct');
    expect(insight.primaryText).toBe('30,0%');
    expect(insight.secondaryText).toBe('del retorno');
  });

  it('shows prudent copy when the return is positive but too low for a useful ratio', () => {
    const insight = buildReturnSpendInsight(
      makeSummary({
        gastosAcumClp: 6_000_000,
        retornoRealAcumClp: 1_500_000,
        spendPct: 400,
      }),
    );

    expect(insight.kind).toBe('low-return');
    expect(insight.primaryText).toBe('Ratio no representativo');
    expect(insight.secondaryText).toBe('Gasto muy superior al retorno del período');
  });

  it('shows prudent copy when the period return is negative', () => {
    const insight = buildReturnSpendInsight(
      makeSummary({
        gastosAcumClp: 6_000_000,
        retornoRealAcumClp: -1_000_000,
        spendPct: -600,
      }),
    );

    expect(insight.kind).toBe('negative-return');
    expect(insight.primaryText).toBe('Retorno negativo');
    expect(insight.secondaryText).toBe('El gasto no fue cubierto por el retorno del período');
  });
});
