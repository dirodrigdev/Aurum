import { describe, expect, it } from 'vitest';
import {
  financialPerformancePeriodKey,
  isFinancialPerformancePeriodValid,
  PERFORMANCE_FINAL_MONTH,
  PERFORMANCE_INITIAL_MONTH,
  reconcileFinancialPerformance,
  reconcileFinancialPerformanceForPeriod,
  type FinancialPerformancePeriod,
  type FinancialPerformanceConfirmation,
} from '../../src/services/financialPerformance';
import {
  RISK_CAPITAL_LABELS,
  type WealthCurrency,
  type WealthMonthlyClosure,
  type WealthRecord,
} from '../../src/services/wealthStorage';

const rates = { usdClp: 1000, eurClp: 1100, ufClp: 40000 };
const legacyPeriod: FinancialPerformancePeriod = {
  startMonth: PERFORMANCE_INITIAL_MONTH,
  endMonth: PERFORMANCE_FINAL_MONTH,
};

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
  period: FinancialPerformancePeriod = legacyPeriod,
) => reconcileFinancialPerformanceForPeriod({
  period,
  initialClosure: makeClosure(
    period.startMonth,
    initialRecords,
    options?.initialRates,
    options?.initialFxMetadata,
    options?.initialFxMissing,
  ),
  finalClosure: makeClosure(
    period.endMonth,
    finalRecords,
    options?.finalRates,
    options?.finalFxMetadata,
    options?.finalFxMissing,
  ),
  confirmation,
  includeRiskCapital: options?.includeRiskCapital ?? false,
});

describe('reconcileFinancialPerformance', () => {
  it('defines a canonical key for consecutive monthly periods and rejects invalid intervals', () => {
    const juneToJuly = { startMonth: '2026-06', endMonth: '2026-07' };
    expect(isFinancialPerformancePeriodValid(juneToJuly)).toBe(true);
    expect(financialPerformancePeriodKey(juneToJuly)).toBe('2026-07');
    expect(isFinancialPerformancePeriodValid({ startMonth: '2026-06', endMonth: '2026-08' })).toBe(false);
    expect(isFinancialPerformancePeriodValid({ startMonth: '2026-13', endMonth: '2027-01' })).toBe(false);
  });

  it('keeps the legacy call compatible while the explicit period API is adopted', () => {
    const records = [makeRecord({ label: 'Fondo', amount: 100 })];
    const legacyResult = reconcileFinancialPerformance({
      closures: [
        makeClosure(PERFORMANCE_INITIAL_MONTH, records),
        makeClosure(PERFORMANCE_FINAL_MONTH, [makeRecord({ label: 'Fondo', amount: 105 })]),
      ],
      confirmation: closedZeroFlows,
      includeRiskCapital: false,
    });
    const explicitResult = run(records, [makeRecord({ label: 'Fondo', amount: 105 })], closedZeroFlows);

    expect(legacyResult.period).toEqual(legacyPeriod);
    expect(legacyResult.observedChange).toBe(explicitResult.observedChange);
    expect(legacyResult.returnPct).toBe(explicitResult.returnPct);
  });

  it('rejects closures that do not match the requested consecutive interval', () => {
    const period = { startMonth: '2026-06', endMonth: '2026-07' };
    const result = reconcileFinancialPerformanceForPeriod({
      period,
      initialClosure: makeClosure('2026-06', [makeRecord({ label: 'Fondo', amount: 100 })]),
      finalClosure: makeClosure('2026-08', [makeRecord({ label: 'Fondo', amount: 105 })]),
      confirmation: null,
      includeRiskCapital: false,
    });
    expect(result.period).toEqual(period);
    expect(result.quality).toBe('INSUFICIENTE');
    expect(result.initialValue).toBeNull();
  });

  it.each(['initial', 'final'] as const)('marks a missing %s closure insufficient for the explicit period', (missing) => {
    const period = { startMonth: '2026-06', endMonth: '2026-07' };
    const result = reconcileFinancialPerformanceForPeriod({
      period,
      initialClosure: missing === 'initial' ? null : makeClosure('2026-06', [makeRecord({ label: 'Fondo', amount: 100 })]),
      finalClosure: missing === 'final' ? null : makeClosure('2026-07', [makeRecord({ label: 'Fondo', amount: 105 })]),
      confirmation: null,
      includeRiskCapital: false,
    });
    expect(result.quality).toBe('INSUFICIENTE');
    expect(result.returnPct).toBeNull();
  });

  it('validates confirmation month and flow dates against the requested period', () => {
    const period = { startMonth: '2026-06', endMonth: '2026-07' };
    const initial = [makeRecord({ label: 'Fondo', amount: 100 })];
    const final = [makeRecord({ label: 'Fondo', amount: 110 })];
    const wrongMonth = run(initial, final, { ...closedZeroFlows, monthKey: '2026-08' }, {}, period);
    const outOfPeriod = run(initial, final, {
      ...closedZeroFlows,
      monthKey: '2026-07',
      flows: [{ id: 'f1', direction: 'aporte', effectiveDate: '2026-06-29', amountClp: 1 }],
    }, {}, period);

    expect(wrongMonth.quality).toBe('INDICATIVO');
    expect(wrongMonth.returnPct).toBeNull();
    expect(outOfPeriod.flowValidationError).not.toBeNull();
    expect(outOfPeriod.returnPct).toBeNull();
  });

  it('keeps the audited July-to-August regression values unchanged', () => {
    const initialBalance = 1_541_389_739;
    const finalBalance = 1_581_053_582;
    const investmentResult = 39_742_596;
    const fxResult = -78_753;
    const startRate = 930;
    const endRate = 929;
    const finalUsd = 78_753;
    const initialUsd = finalUsd - investmentResult / startRate;
    const localClp = initialBalance - initialUsd * startRate;
    const initialRecords = [
      makeRecord({ label: 'Fondo USD', amount: initialUsd, currency: 'USD' }),
      makeRecord({ label: 'Fondo CLP', amount: localClp }),
    ];
    const finalRecords = [
      makeRecord({ label: 'Fondo USD', amount: finalUsd, currency: 'USD' }),
      makeRecord({ label: 'Fondo CLP', amount: localClp }),
    ];
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      positionMovementCompleteness: 'no_unrecorded_movements',
    };
    const result = run(initialRecords, finalRecords, confirmation, {
      initialRates: { usdClp: startRate },
      finalRates: { usdClp: endRate },
    });

    expect(result.initialValue).toBeCloseTo(initialBalance, 5);
    expect(result.finalValue).toBeCloseTo(finalBalance, 5);
    expect(result.observedChange).toBeCloseTo(39_663_843, 5);
    expect(result.investmentAttributable).toBeCloseTo(investmentResult, 5);
    expect(result.usdFxAttributable).toBeCloseTo(fxResult, 5);
    expect(result.eurFxAttributable).toBe(0);
    expect(result.fxAttributable).toBeCloseTo(fxResult, 5);
    expect(result.ufAttributable).toBe(0);
    expect(result.unexplainedResidual).toBeCloseTo(0, 5);
    expect(result.returnPct).toBeCloseTo(39_663_843 / initialBalance, 10);
    expect(result.quality).toBe('RECONSTRUIDO');
  });

  it('calculates June-to-July components conditionally but keeps the unconfirmed interval indicative', () => {
    const period = { startMonth: '2026-06', endMonth: '2026-07' };
    const initialBalance = 1_540_741_434.24;
    const finalBalance = 1_541_389_739;
    const investmentResult = -94_255.64;
    const fxResult = 742_560.4;
    const startRate = 900;
    const endRate = 930;
    const finalUsd = fxResult / (endRate - startRate);
    const initialUsd = finalUsd - investmentResult / startRate;
    const localClp = initialBalance - initialUsd * startRate;
    const initialRecords = [
      makeRecord({ label: 'Fondo USD', amount: initialUsd, currency: 'USD' }),
      makeRecord({ label: 'Fondo CLP', amount: localClp }),
    ];
    const finalRecords = [
      makeRecord({ label: 'Fondo USD', amount: finalUsd, currency: 'USD' }),
      makeRecord({ label: 'Fondo CLP', amount: localClp }),
    ];
    const initialClosure = makeClosure('2026-06', initialRecords, { usdClp: startRate });
    const finalClosure = makeClosure('2026-07', finalRecords, { usdClp: endRate }, {
      economicDate: '2026-07-31',
      rateOrigin: { usd: 'manual' },
      source: { usd: 'manual_user_input' },
      manualOverrideReason: 'Corrección valor',
      reconciliation: { status: 'reconciled', checkedAt: '2026-08-01T22:15:35.035Z' },
    });
    const indicative = reconcileFinancialPerformanceForPeriod({
      period,
      initialClosure,
      finalClosure,
      confirmation: null,
      includeRiskCapital: false,
    });
    const conditional = reconcileFinancialPerformanceForPeriod({
      period,
      initialClosure,
      finalClosure,
      confirmation: {
        ...closedZeroFlows,
        monthKey: '2026-07',
        positionMovementCompleteness: 'no_unrecorded_movements',
      },
      includeRiskCapital: false,
    });

    expect(indicative.initialValue).toBeCloseTo(initialBalance, 5);
    expect(indicative.finalValue).toBeCloseTo(finalBalance, 5);
    expect(indicative.observedChange).toBeCloseTo(648_304.76, 5);
    expect(indicative.quality).toBe('INDICATIVO');
    expect(indicative.returnPct).toBeNull();
    expect(indicative.investmentAttributable).toBeNull();
    expect(indicative.fxAttributable).toBeNull();

    expect(conditional.investmentAttributable).toBeCloseTo(investmentResult, 5);
    expect(conditional.usdFxAttributable).toBeCloseTo(fxResult, 5);
    expect(conditional.eurFxAttributable).toBe(0);
    expect(conditional.fxAttributable).toBeCloseTo(fxResult, 5);
    expect(conditional.ufAttributable).toBe(0);
    expect(conditional.unexplainedResidual).toBeCloseTo(0, 5);
  });

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

  it('reports EUR translation separately while preserving the combined FX total', () => {
    const confirmation: FinancialPerformanceConfirmation = {
      ...closedZeroFlows,
      positionMovementCompleteness: 'no_unrecorded_movements',
    };
    const result = run(
      [makeRecord({ label: 'Fondo EUR', amount: 100, currency: 'EUR' })],
      [makeRecord({ label: 'Fondo EUR', amount: 110, currency: 'EUR' })],
      confirmation,
      { initialRates: { eurClp: 1100 }, finalRates: { eurClp: 1200 } },
    );
    expect(result.usdFxAttributable).toBe(0);
    expect(result.eurFxAttributable).toBe(11_000);
    expect(result.fxAttributable).toBe(11_000);
    expect(result.investmentAttributable).toBe(11_000);
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
