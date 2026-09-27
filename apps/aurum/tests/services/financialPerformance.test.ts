import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_FINAL_MONTH,
  PERFORMANCE_INITIAL_MONTH,
  reconcileFinancialPerformance,
  type FinancialPerformanceConfirmation,
} from '../../src/services/financialPerformance';
import {
  RISK_CAPITAL_LABELS,
  type WealthCurrency,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../../src/services/wealthStorage';

const rates = { usdClp: 1000, eurClp: 1100, ufClp: 40000 };

const makeRecord = (input: {
  label: string;
  amount: number;
  currency?: WealthCurrency;
  block?: WealthRecord['block'];
}): WealthRecord => ({
  id: `${input.label}-${input.currency || 'CLP'}`,
  block: input.block || 'investment',
  source: 'test',
  label: input.label,
  amount: input.amount,
  currency: input.currency || 'CLP',
  snapshotDate: `${PERFORMANCE_FINAL_MONTH}-31`,
  createdAt: `${PERFORMANCE_FINAL_MONTH}-31T23:59:00.000Z`,
});

const makeClosure = (
  monthKey: string,
  records: WealthRecord[],
  fxRateOverrides: Partial<typeof rates> = {},
  fxMetadataOverrides: Partial<NonNullable<WealthMonthlyClosure['fxMetadata']>> = {},
  fxMissing?: WealthMonthlyClosure['fxMissing'],
): WealthMonthlyClosure => {
  const fxRates = { ...rates, ...fxRateOverrides };
  const baseFxMetadata: NonNullable<WealthMonthlyClosure['fxMetadata']> = {
    economicMonthKey: monthKey,
    economicDate: `${monthKey}-28`,
    usedFxRates: fxRates,
    rateOrigin: { usd: 'automatic-final', eur: 'automatic-final', uf: 'automatic-final' },
    source: { usd: 'test-source', eur: 'test-source', uf: 'test-source' },
  };
  return {
    id: monthKey,
    monthKey,
    closedAt: `${monthKey}-31T23:59:00.000Z`,
    summary: {
      netByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      assetsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      debtsByCurrency: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      netConsolidatedClp: 0,
      byBlock: {
        bank: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
        investment: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
        real_estate: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
        debt: { CLP: 0, USD: 0, EUR: 0, UF: 0 },
      },
    },
    fxRates,
    fxMetadata: {
      ...baseFxMetadata,
      ...fxMetadataOverrides,
      usedFxRates: { ...fxRates, ...fxMetadataOverrides.usedFxRates },
      rateOrigin: { ...baseFxMetadata.rateOrigin, ...fxMetadataOverrides.rateOrigin },
      source: { ...baseFxMetadata.source, ...fxMetadataOverrides.source },
    },
    fxMissing,
    records,
  };
};

const closedZeroFlows: FinancialPerformanceConfirmation = {
  schemaVersion: 1,
  monthKey: PERFORMANCE_FINAL_MONTH,
  flowCompleteness: 'complete',
  positionMovementCompleteness: 'unconfirmed',
  flows: [],
};

const run = (
  initialRecords: WealthRecord[],
  finalRecords: WealthRecord[],
  confirmation: FinancialPerformanceConfirmation | null,
  options?: {
    initialRates?: Partial<typeof rates>;
    finalRates?: Partial<typeof rates>;
    initialFxMetadata?: Partial<NonNullable<WealthMonthlyClosure['fxMetadata']>>;
    finalFxMetadata?: Partial<NonNullable<WealthMonthlyClosure['fxMetadata']>>;
    initialFxMissing?: WealthMonthlyClosure['fxMissing'];
    finalFxMissing?: WealthMonthlyClosure['fxMissing'];
    includeRiskCapital?: boolean;
  },
) => reconcileFinancialPerformance({
  closures: [
    makeClosure(
      PERFORMANCE_INITIAL_MONTH,
      initialRecords,
      options?.initialRates,
      options?.initialFxMetadata,
      options?.initialFxMissing,
    ),
    makeClosure(
      PERFORMANCE_FINAL_MONTH,
      finalRecords,
      options?.finalRates,
      options?.finalFxMetadata,
      options?.finalFxMissing,
    ),
  ],
  confirmation,
  includeRiskCapital: options?.includeRiskCapital ?? false,
});

describe('reconcileFinancialPerformance', () => {
  it('uses a simple return only after an explicit complete zero-flow confirmation', () => {
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 105 })], closedZeroFlows);
    expect(result.returnPct).toBeCloseTo(0.05);
    expect(result.returnMethod).toBe('simple');
    expect(result.quality).toBe('RECONSTRUIDO');
  });

  it('uses the adjusted simple return for a contribution at the closing boundary', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      flows: [{ id: 'f1', direction: 'aporte', effectiveDate: '2026-08-31', amountClp: 10 }],
    };
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 115 })], confirmation);
    expect(result.portfolioResult).toBe(5);
    expect(result.returnPct).toBeCloseTo(0.05);
    expect(result.returnMethod).toBe('simple_adjusted');
  });

  it('does not publish return for an unconfirmed suspected contribution', () => {
    const confirmation: FinancialPerformanceConfirmation = { ...closedZeroFlows, flowCompleteness: 'incomplete' };
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 115 })], confirmation);
    expect(result.returnPct).toBeNull();
    expect(result.portfolioResult).toBeNull();
    expect(result.quality).toBe('INDICATIVO');
  });

  it('calculates Modified Dietz for a dated withdrawal inside the period', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      flows: [{ id: 'f1', direction: 'retiro', effectiveDate: '2026-08-16', amountClp: 10 }],
    };
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 95 })], confirmation);
    const denominator = 100 - 10 * (15 / 31);
    expect(result.portfolioResult).toBe(5);
    expect(result.returnPct).toBeCloseTo(5 / denominator);
    expect(result.returnMethod).toBe('modified_dietz');
  });

  it('allocates USD asset change and translation by the approved convention', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      positionMovementCompleteness: 'no_unrecorded_movements',
    };
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 103, currency: 'USD' })],
      confirmation,
      { initialRates: { usdClp: 1000 }, finalRates: { usdClp: 1060 } },
    );
    expect(result.initialValue).toBe(100000);
    expect(result.finalValue).toBe(109180);
    expect(result.investmentAttributable).toBe(3000);
    expect(result.fxAttributable).toBe(6180);
    expect(result.unexplainedResidual).toBeCloseTo(0);
    expect(result.fxCoveragePct).toBe(100);
  });

  it('reports UF indexation separately from FX', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      positionMovementCompleteness: 'no_unrecorded_movements',
    };
    const result = run(
      [makeRecord({ label: 'Fondo UF', amount: 100, currency: 'UF' })],
      [makeRecord({ label: 'Fondo UF', amount: 103, currency: 'UF' })],
      confirmation,
      { initialRates: { ufClp: 40000 }, finalRates: { ufClp: 40800 } },
    );
    expect(result.investmentAttributable).toBe(120000);
    expect(result.ufAttributable).toBe(82400);
    expect(result.fxAttributable).toBe(0);
    expect(result.unexplainedResidual).toBeCloseTo(0);
  });

  it('marks FX and UF coverage not applicable when the interval has no exposure in those currencies', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      positionMovementCompleteness: 'no_unrecorded_movements',
    };
    const result = run(
      [makeRecord({ label: 'Fondo CLP', amount: 100 })],
      [makeRecord({ label: 'Fondo CLP', amount: 105 })],
      confirmation,
    );
    expect(result.fxAttributable).toBe(0);
    expect(result.ufAttributable).toBe(0);
    expect(result.fxCoverageStatus).toBe('no_exposure');
    expect(result.ufCoverageStatus).toBe('no_exposure');
    expect(result.fxCoveragePct).toBeNull();
    expect(result.ufCoveragePct).toBeNull();
  });

  it('does not convert an internal move between included positions into an external flow', () => {
    const result = run(
      [makeRecord({ label: 'Inversión CLP', amount: 50000 })],
      [makeRecord({ label: 'Inversión USD', amount: 50, currency: 'USD' })],
      closedZeroFlows,
    );
    expect(result.confirmedFlowsNetClp).toBe(0);
    expect(result.portfolioResult).toBe(0);
    expect(result.returnPct).toBe(0);
  });

  it('keeps an unattributed balance change in the residual instead of calling it investment result', () => {
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 120 })], closedZeroFlows);
    expect(result.investmentAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(20);
  });

  it.each(['automatic', 'automatic-final'] as const)(
    'accepts a valid %s USD rate without changing automatic provenance behavior',
    (origin) => {
      const result = run(
        [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
        [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
        {
          ...closedZeroFlows,
          positionMovementCompleteness: 'no_unrecorded_movements',
        },
        {
          initialFxMetadata: { rateOrigin: { usd: origin } },
          finalRates: { usdClp: 1100 },
        },
      );

      expect(result.fxAttributable).toBe(10_000);
      expect(result.unexplainedResidual).toBeCloseTo(0);
    },
  );

  it('accepts an explicit reconciled manual USD override with a reason', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      {
        ...closedZeroFlows,
        positionMovementCompleteness: 'no_unrecorded_movements',
      },
      {
        initialFxMetadata: {
          rateOrigin: { usd: 'manual' },
          source: { usd: 'manual_user_input' },
          manualOverrideReason: 'Corrección valor',
          reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
        },
        finalRates: { usdClp: 1100 },
      },
    );

    expect(result.fxAttributable).toBe(10_000);
    expect(result.unexplainedResidual).toBeCloseTo(0);
  });

  it('rejects a manual USD rate without a correction reason', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
      {
        initialFxMetadata: {
          rateOrigin: { usd: 'manual' },
          source: { usd: 'manual_user_input' },
          reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
        },
        finalRates: { usdClp: 1100 },
      },
    );

    expect(result.fxAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(10_000);
  });

  it('rejects a manual USD rate marked as missing on the closure', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
      {
        initialFxMetadata: {
          rateOrigin: { usd: 'manual' },
          source: { usd: 'manual_user_input' },
          manualOverrideReason: 'Corrección valor',
          reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
        },
        initialFxMissing: ['usdClp'],
        finalRates: { usdClp: 1100 },
      },
    );

    expect(result.fxAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(10_000);
  });

  it('rejects fallback USD provenance', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
      {
        initialFxMetadata: {
          rateOrigin: { usd: 'fallback' },
          source: { usd: 'operational_fx_fallback' },
        },
        finalRates: { usdClp: 1100 },
      },
    );

    expect(result.fxAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(10_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a manual USD closure rate that is not finite and positive (%s)',
    (rate) => {
      const result = run(
        [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
        [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
        { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
        {
          initialRates: { usdClp: rate },
          initialFxMetadata: {
            rateOrigin: { usd: 'manual' },
            source: { usd: 'manual_user_input' },
            manualOverrideReason: 'Corrección valor',
            reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
          },
          finalRates: { usdClp: 1100 },
        },
      );

      expect(result.quality).toBe('INSUFICIENTE');
      expect(result.initialValue).toBeNull();
      expect(result.fxAttributable).toBeNull();
    },
  );

  it('rejects a manual rate with an economic month that does not match the closure', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
      {
        initialFxMetadata: {
          economicMonthKey: '2026-06',
          rateOrigin: { usd: 'manual' },
          source: { usd: 'manual_user_input' },
          manualOverrideReason: 'Corrección valor',
          reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
        },
        finalRates: { usdClp: 1100 },
      },
    );

    expect(result.fxAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(10_000);
  });

  it('rejects manual rates without exact input provenance or matching saved values', () => {
    const confirmation = { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' } as const;
    const initial = [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })];
    const final = [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })];
    const commonMetadata = {
      rateOrigin: { usd: 'manual' as const },
      manualOverrideReason: 'Corrección valor',
      reconciliation: { status: 'reconciled' as const, checkedAt: '2026-08-01T22:15:35.035Z' },
    };
    const unknownSource = run(initial, final, confirmation, {
      initialFxMetadata: { ...commonMetadata, source: { usd: 'unknown' } },
      finalRates: { usdClp: 1100 },
    });
    const mismatchedSavedRate = run(initial, final, confirmation, {
      initialFxMetadata: { ...commonMetadata, source: { usd: 'manual_user_input' }, usedFxRates: { usdClp: 999 } },
      finalRates: { usdClp: 1100 },
    });

    expect(unknownSource.fxAttributable).toBeNull();
    expect(mismatchedSavedRate.fxAttributable).toBeNull();
  });

  it('rejects a manual USD rate without saved closure reconciliation', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
      {
        initialFxMetadata: {
          rateOrigin: { usd: 'manual' },
          source: { usd: 'manual_user_input' },
          manualOverrideReason: 'Corrección valor',
          reconciliation: undefined,
        },
        finalRates: { usdClp: 1100 },
      },
    );

    expect(result.fxAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(10_000);
  });

  it('rejects manual provenance that is not attached to a saved closure', () => {
    const start = makeClosure(
      PERFORMANCE_INITIAL_MONTH,
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      {},
      {
        rateOrigin: { usd: 'manual' },
        source: { usd: 'manual_user_input' },
        manualOverrideReason: 'Corrección valor',
        reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
      },
    );
    start.closedAt = '';
    const end = makeClosure(
      PERFORMANCE_FINAL_MONTH,
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      { usdClp: 1100 },
    );
    const result = reconcileFinancialPerformance({
      closures: [start, end],
      confirmation: { ...closedZeroFlows, positionMovementCompleteness: 'no_unrecorded_movements' },
      includeRiskCapital: false,
    });

    expect(result.fxAttributable).toBeNull();
    expect(result.unexplainedResidual).toBe(10_000);
  });

  it('leaves FX in the residual if either close lacks reliable rate provenance', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      positionMovementCompleteness: 'no_unrecorded_movements',
    };
    const start = makeClosure(
      PERFORMANCE_INITIAL_MONTH,
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      {},
      { rateOrigin: { usd: 'fallback' }, source: { usd: 'operational_fx_fallback' } },
    );
    const end = makeClosure(PERFORMANCE_FINAL_MONTH, [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })], { usdClp: 1100 });
    const result = reconcileFinancialPerformance({ closures: [start, end], confirmation, includeRiskCapital: false });

    expect(result.fxAttributable).toBeNull();
    expect(result.fxCoveragePct).toBe(0);
    expect(result.unexplainedResidual).toBe(10_000);
    expect(result.returnPct).toBeCloseTo(0.1);
  });

  it('marks the interval insufficient when either certified detailed close is missing', () => {
    const result = reconcileFinancialPerformance({
      closures: [makeClosure(PERFORMANCE_FINAL_MONTH, [makeRecord({ label: 'Fondo', amount: 100 })])],
      confirmation: closedZeroFlows,
      includeRiskCapital: false,
    });
    expect(result.quality).toBe('INSUFICIENTE');
    expect(result.returnPct).toBeNull();
    expect(result.unexplainedResidual).toBeNull();
  });

  it('withholds return when the Modified Dietz denominator is not positive', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      flows: [{ id: 'f1', direction: 'retiro', effectiveDate: '2026-07-31', amountClp: 100 }],
    };
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 10 })], confirmation);
    expect(result.portfolioResult).toBe(10);
    expect(result.returnPct).toBeNull();
    expect(result.returnMethod).toBeNull();
  });

  it('treats the absence of a saved confirmation as unknown flows', () => {
    const result = run([makeRecord({ label: 'Fondo', amount: 100 })], [makeRecord({ label: 'Fondo', amount: 105 })], null);
    expect(result.flowListComplete).toBe(false);
    expect(result.confirmedFlowsNetClp).toBe(0);
    expect(result.returnPct).toBeNull();
    expect(result.quality).toBe('INDICATIVO');
  });

  it('keeps FX coverage unevaluated when exposure exists but external flows are unconfirmed', () => {
    const result = run(
      [makeRecord({ label: 'Fondo USD', amount: 100, currency: 'USD' })],
      [makeRecord({ label: 'Fondo USD', amount: 105, currency: 'USD' })],
      null,
    );
    expect(result.fxCoverageStatus).toBe('not_evaluated');
    expect(result.fxCoveragePct).toBeNull();
    expect(result.fxAttributable).toBeNull();
  });

  it('includes CapRiesgo only when the existing control is active', () => {
    const riskLabel = RISK_CAPITAL_LABELS[0];
    const initial = [makeRecord({ label: 'Fondo', amount: 100 }), makeRecord({ label: riskLabel, amount: 20 })];
    const final = [makeRecord({ label: 'Fondo', amount: 100 }), makeRecord({ label: riskLabel, amount: 30 })];
    const withoutRisk = run(initial, final, closedZeroFlows, { includeRiskCapital: false });
    const withRisk = run(initial, final, closedZeroFlows, { includeRiskCapital: true });
    expect(withoutRisk.observedChange).toBe(0);
    expect(withRisk.observedChange).toBe(10);
  });
});
