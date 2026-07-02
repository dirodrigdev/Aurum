import { describe, expect, it } from 'vitest';

import {
  calculatePortfolioAnalytics,
  type PortfolioAnalyticsMonthlyPoint,
} from '../src/services/portfolioAnalytics';

const buildPoint = (
  monthKey: string,
  returnPct: number,
  overrides: Partial<PortfolioAnalyticsMonthlyPoint> = {},
): PortfolioAnalyticsMonthlyPoint => ({
  monthKey,
  returnPct,
  ...overrides,
});

describe('portfolio analytics', () => {
  it('calcula retorno acumulado compuesto y anualizado', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0.1),
      buildPoint('2026-02', 0.05),
    ]);

    expect(result.cumulativeReturnPct).toBeCloseTo(0.155, 10);
    expect(result.annualizedReturnPct).toBeCloseTo((1.155 ** 6) - 1, 10);
  });

  it('ordena internamente y no muta el input', () => {
    const input = [
      buildPoint('2026-03', 0.03),
      buildPoint('2026-01', 0.01),
      buildPoint('2026-02', 0.02),
    ];
    const snapshot = [...input];

    const result = calculatePortfolioAnalytics(input);

    expect(result.firstMonthKey).toBe('2026-01');
    expect(result.lastMonthKey).toBe('2026-03');
    expect(input).toEqual(snapshot);
  });

  it('calcula promedio aritmético, geométrico, mediana y percentiles', () => {
    const returns = [-0.02, 0, 0.01, 0.03, 0.08];
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', returns[0]),
      buildPoint('2026-02', returns[1]),
      buildPoint('2026-03', returns[2]),
      buildPoint('2026-04', returns[3]),
      buildPoint('2026-05', returns[4]),
    ]);
    const cumulativeGrowth = returns.reduce((product, value) => product * (1 + value), 1);

    expect(result.averageMonthlyReturnPct).toBeCloseTo(0.02, 10);
    expect(result.geometricMonthlyReturnPct).toBeCloseTo(cumulativeGrowth ** (1 / returns.length) - 1, 10);
    expect(result.medianMonthlyReturnPct).toBeCloseTo(0.01, 10);
    expect(result.percentiles).toEqual({
      p10: expect.closeTo(-0.012, 10),
      p25: expect.closeTo(0, 10),
      p50: expect.closeTo(0.01, 10),
      p75: expect.closeTo(0.03, 10),
      p90: expect.closeTo(0.06, 10),
    });
  });

  it('calcula volatilidad mensual y anualizada', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0.01),
      buildPoint('2026-02', 0.03),
      buildPoint('2026-03', -0.02),
    ]);

    expect(result.volatilityMonthlyPct).toBeCloseTo(0.0251661148, 10);
    expect(result.volatilityAnnualizedPct).toBeCloseTo(0.0871779789, 10);
  });

  it('calcula mejor/peor mes y porcentajes de consistencia', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0.01),
      buildPoint('2026-02', 0),
      buildPoint('2026-03', -0.02, { isEstimated: true }),
      buildPoint('2026-04', 0.03),
    ]);

    expect(result.bestMonth).toEqual({
      monthKey: '2026-04',
      returnPct: 0.03,
      isEstimated: false,
    });
    expect(result.worstMonth).toEqual({
      monthKey: '2026-03',
      returnPct: -0.02,
      isEstimated: true,
    });
    expect(result.positiveMonthsPct).toBeCloseTo(0.5, 10);
    expect(result.negativeMonthsPct).toBeCloseTo(0.25, 10);
    expect(result.zeroMonthsPct).toBeCloseTo(0.25, 10);
  });

  it('calcula drawdown recuperado y meses hasta recuperación', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0.1),
      buildPoint('2026-02', -0.2),
      buildPoint('2026-03', 0.05),
      buildPoint('2026-04', 0.1),
      buildPoint('2026-05', 0.1),
    ]);

    expect(result.maxDrawdownPct).toBeCloseTo(-0.2, 10);
    expect(result.maxDrawdownStartMonthKey).toBe('2026-01');
    expect(result.maxDrawdownTroughMonthKey).toBe('2026-02');
    expect(result.maxDrawdownRecoveryMonthKey).toBe('2026-05');
    expect(result.currentDrawdownPct).toBeCloseTo(0, 10);
    expect(result.monthsToRecovery).toBe(3);
    expect(result.isRecovered).toBe(true);
  });

  it('calcula drawdown actual no recuperado y ulcer index', () => {
    const returns = [0.05, -0.1, -0.05, 0.02];
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', returns[0]),
      buildPoint('2026-02', returns[1]),
      buildPoint('2026-03', returns[2]),
      buildPoint('2026-04', returns[3]),
    ]);
    const equities = returns.reduce<number[]>((values, value) => {
      const previous = values[values.length - 1] ?? 1;
      values.push(previous * (1 + value));
      return values;
    }, []);
    const peaks: number[] = [];
    const drawdowns = equities.map((equity) => {
      const runningPeak = Math.max(peaks[peaks.length - 1] ?? 1, equity);
      peaks.push(runningPeak);
      return equity / runningPeak - 1;
    });
    const expectedCurrentDrawdown = drawdowns[drawdowns.length - 1];
    const expectedUlcerIndex = Math.sqrt(
      drawdowns
        .filter((value) => value < 0)
        .reduce((sum, value, _, values) => sum + (value ** 2) / values.length, 0),
    );

    expect(result.maxDrawdownPct).toBeCloseTo(-0.145, 10);
    expect(result.currentDrawdownPct).toBeCloseTo(expectedCurrentDrawdown, 10);
    expect(result.maxDrawdownRecoveryMonthKey).toBeUndefined();
    expect(result.monthsToRecovery).toBeNull();
    expect(result.isRecovered).toBe(false);
    expect(result.ulcerIndex).toBeCloseTo(expectedUlcerIndex, 10);
  });

  it('calcula sharpe, sortino y calmar simples', () => {
    const result = calculatePortfolioAnalytics(
      [
        buildPoint('2026-01', 0.02),
        buildPoint('2026-02', 0.01),
        buildPoint('2026-03', -0.01),
        buildPoint('2026-04', -0.005),
        buildPoint('2026-05', 0.03),
      ],
      { riskFreeRateAnnualPct: 0 },
    );

    expect(result.sharpeSimple).not.toBeNull();
    expect(result.sortinoSimple).not.toBeNull();
    expect(result.calmarSimple).not.toBeNull();
  });

  it('deja calmar en null cuando no hay drawdown y agrega warning', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0.01),
      buildPoint('2026-02', 0.02),
      buildPoint('2026-03', 0.03),
    ]);

    expect(result.maxDrawdownPct).toBe(0);
    expect(result.calmarSimple).toBeNull();
    expect(result.warnings).toContain('zero_max_drawdown');
  });

  it('trimmed mean y winsorized mean reducen el efecto de outliers', () => {
    const values = [0.01, 0.02, 0.015, 0.018, 0.5, -0.4, 0.017, 0.019, 0.016, 0.018];
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', values[0]),
      buildPoint('2026-02', values[1]),
      buildPoint('2026-03', values[2]),
      buildPoint('2026-04', values[3]),
      buildPoint('2026-05', values[4]),
      buildPoint('2026-06', values[5]),
      buildPoint('2026-07', values[6]),
      buildPoint('2026-08', values[7]),
      buildPoint('2026-09', values[8]),
      buildPoint('2026-10', values[9]),
    ]);
    const sorted = [...values].sort((a, b) => a - b);
    const trimmedExpected = sorted.slice(1, -1).reduce((sum, value) => sum + value, 0) / 8;
    const winsorizedExpected =
      [sorted[1], sorted[1], ...sorted.slice(2, -2), sorted[sorted.length - 2], sorted[sorted.length - 2]]
        .reduce((sum, value) => sum + value, 0) / sorted.length;

    expect(result.averageMonthlyReturnPct).toBeCloseTo(0.0233, 4);
    expect(result.trimmedMeanMonthlyReturnPct).toBeCloseTo(trimmedExpected, 10);
    expect(result.winsorizedMeanMonthlyReturnPct).toBeCloseTo(winsorizedExpected, 10);
  });

  it('excluye o incluye estimados según la opción', () => {
    const input = [
      buildPoint('2026-01', 0.01),
      buildPoint('2026-02', 0.02, { isEstimated: true }),
      buildPoint('2026-03', 0.03),
    ];

    const excluded = calculatePortfolioAnalytics(input, { includeEstimated: false });
    const included = calculatePortfolioAnalytics(input, { includeEstimated: true });

    expect(excluded.monthsUsed).toBe(2);
    expect(excluded.estimatedMonthsUsed).toBe(0);
    expect(excluded.warnings).not.toContain('estimated_months_included');
    expect(included.monthsUsed).toBe(3);
    expect(included.estimatedMonthsUsed).toBe(1);
    expect(included.warnings).toContain('estimated_months_included');
  });

  it('devuelve controlado para serie vacía o de un solo mes', () => {
    const empty = calculatePortfolioAnalytics([]);
    const single = calculatePortfolioAnalytics([buildPoint('2026-01', 0.01)]);

    expect(empty.monthsUsed).toBe(0);
    expect(empty.cumulativeReturnPct).toBeNull();
    expect(empty.warnings).toContain('empty_series');
    expect(single.monthsUsed).toBe(1);
    expect(single.volatilityMonthlyPct).toBeNull();
    expect(single.warnings).toContain('insufficient_months');
  });

  it('excluye retornos inválidos sin romper el cálculo', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0.01),
      buildPoint('2026-02', Number.NaN),
      buildPoint('2026-03', Number.POSITIVE_INFINITY),
      buildPoint('2026-04', -1.2),
      buildPoint('2026-05', 0.03),
    ]);

    expect(result.monthsTotal).toBe(5);
    expect(result.monthsUsed).toBe(2);
    expect(result.cumulativeReturnPct).toBeCloseTo(0.0403, 10);
    expect(result.warnings).toContain('invalid_returns_excluded');
  });

  it('maneja todos cero sin romper ratios y warnings metodológicos', () => {
    const result = calculatePortfolioAnalytics([
      buildPoint('2026-01', 0),
      buildPoint('2026-02', 0),
      buildPoint('2026-03', 0),
    ]);

    expect(result.cumulativeReturnPct).toBe(0);
    expect(result.volatilityMonthlyPct).toBe(0);
    expect(result.downsideDeviationMonthlyPct).toBe(0);
    expect(result.sharpeSimple).toBeNull();
    expect(result.sortinoSimple).toBeNull();
    expect(result.warnings).toContain('risk_free_rate_default_zero');
    expect(result.warnings).toContain('zero_volatility');
    expect(result.warnings).toContain('zero_downside_deviation');
    expect(result.warnings).toContain('monthly_drawdown_only');
  });

  it('defaultea trim y winsorize inválidos con warning semántico', () => {
    const result = calculatePortfolioAnalytics(
      [
        buildPoint('2026-01', 0.01),
        buildPoint('2026-02', 0.02),
        buildPoint('2026-03', 0.03),
      ],
      { trimPct: 0.9, winsorizePct: -1 },
    );

    expect(result.warnings).toContain('invalid_trim_pct_defaulted');
    expect(result.warnings).toContain('invalid_winsorize_pct_defaulted');
  });
});
