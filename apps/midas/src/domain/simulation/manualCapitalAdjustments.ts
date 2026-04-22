import type { CashflowEvent, FutureCapitalEvent, ModelParameters } from '../model/types';

export type ManualAdjustmentImpact = {
  currentTotalDelta: number;
  currentBanksDelta: number;
  currentInvestmentsDelta: number;
  currentRiskDelta: number;
  futureEvents: CashflowEvent[];
  futureCapitalEvents: FutureCapitalEvent[];
};

const finiteOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isManualEventId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith('manual-');

const withoutManualCashflowEvents = (events: CashflowEvent[] | undefined): CashflowEvent[] =>
  (events ?? []).filter((event) => !isManualEventId(event.id));

const withoutManualFutureCapitalEvents = (events: FutureCapitalEvent[] | undefined): FutureCapitalEvent[] =>
  (events ?? []).filter((event) => !isManualEventId(event.id));

const isBlocksCompositionMode = (params: ModelParameters): boolean => {
  const mode = params.simulationComposition?.mode;
  return mode === 'full' || mode === 'partial';
};

export function stripManualAdjustmentImpactFromParams(
  params: ModelParameters,
  impact: ManualAdjustmentImpact,
): ModelParameters {
  const clean = JSON.parse(JSON.stringify(params)) as ModelParameters;
  clean.cashflowEvents = withoutManualCashflowEvents(clean.cashflowEvents);
  clean.futureCapitalEvents = withoutManualFutureCapitalEvents(clean.futureCapitalEvents);

  if (isBlocksCompositionMode(clean) && clean.simulationComposition) {
    const composition = clean.simulationComposition;
    const nextOptimizable = Math.max(
      0,
      finiteOrZero(composition.optimizableInvestmentsCLP) - impact.currentInvestmentsDelta,
    );
    const nextBanks = Math.max(
      0,
      finiteOrZero(composition.nonOptimizable?.banksCLP) - impact.currentBanksDelta,
    );
    const riskBlock = composition.nonOptimizable?.riskCapital;
    const nextRiskTotal = Math.max(
      0,
      finiteOrZero(riskBlock?.totalCLP) - impact.currentRiskDelta,
    );
    const riskSnapshot = finiteOrZero(riskBlock?.usdSnapshotCLP);
    const nextRiskUsd = riskSnapshot > 0 ? nextRiskTotal / riskSnapshot : finiteOrZero(riskBlock?.usdTotal);

    clean.simulationComposition = {
      ...composition,
      optimizableInvestmentsCLP: nextOptimizable,
      nonOptimizable: {
        ...composition.nonOptimizable,
        banksCLP: nextBanks,
        ...(riskBlock
          ? {
              riskCapital: {
                ...riskBlock,
                usdTotal: nextRiskUsd,
                usd: nextRiskUsd,
                totalCLP: nextRiskTotal,
              },
            }
          : {}),
      },
    };
    clean.capitalInitial = Math.max(1, nextOptimizable + nextBanks + nextRiskTotal);
    return clean;
  }

  clean.capitalInitial = Math.max(1, finiteOrZero(clean.capitalInitial) - impact.currentTotalDelta);
  return clean;
}
