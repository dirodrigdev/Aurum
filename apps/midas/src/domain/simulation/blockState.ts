import type { ModelParameters, PortfolioWeights } from '../model/types';
import type { MortgageProjectionPoint } from './mortgageProjection';

export type LiquidPathState = {
  banks: number;
  riskUsdCLP: number;
  sleeves: {
    rvGlobal: number;
    rfGlobal: number;
    rvChile: number;
    rfChile: number;
  };
};

export type BlockSnapshot = {
  month: number;
  banks: number;
  riskCapitalCLP: number;
  bucketRF: number;
  otherRF: number;
  equityAssets: number;
  liquidCapital: number;
  expense: number;
  propertyValueCLP: number;
  mortgageDebtCLP: number;
  realEstateEquityCLP: number;
};

export type AnnualRebalanceResult = {
  bucketTarget: number;
  bucketBeforeRebalance: number;
  bucketAfterRebalance: number;
  usedBanksForBucket: number;
  equitySoldForBucket: number;
};

const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

function normalizeWeights(weights: PortfolioWeights): PortfolioWeights {
  const rvGlobal = clamp(weights.rvGlobal);
  const rfGlobal = clamp(weights.rfGlobal);
  const rvChile = clamp(weights.rvChile);
  const rfChile = clamp(weights.rfChile);
  const sum = rvGlobal + rfGlobal + rvChile + rfChile;
  if (sum <= 0) return { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  return {
    rvGlobal: rvGlobal / sum,
    rfGlobal: rfGlobal / sum,
    rvChile: rvChile / sum,
    rfChile: rfChile / sum,
  };
}

export function getBaseExpenseForMonth(
  params: ModelParameters,
  month: number,
  CPU_t: number,
  EURUSDt: number,
  cumCL: number,
): number {
  let phaseStart = 0;
  for (const phase of params.spendingPhases) {
    if (month <= phaseStart + phase.durationMonths) {
      return phase.currency === 'EUR' ? phase.amountReal * EURUSDt * CPU_t : phase.amountReal * cumCL;
    }
    phaseStart += phase.durationMonths;
  }
  const fallback = params.spendingPhases[params.spendingPhases.length - 1];
  if (!fallback) return 0;
  return fallback.currency === 'EUR' ? fallback.amountReal * EURUSDt * CPU_t : fallback.amountReal * cumCL;
}

export function buildInitialLiquidState(params: ModelParameters): LiquidPathState {
  const composition = params.simulationComposition;
  const normalized = normalizeWeights(params.weights);
  const optimizable = clamp(composition?.optimizableInvestmentsCLP ?? params.capitalInitial);
  const banks = clamp(composition?.nonOptimizable?.banksCLP ?? 0);
  const riskCapital = composition?.nonOptimizable?.riskCapital;
  const usdSnapshotCLP = clamp(riskCapital?.usdSnapshotCLP ?? params.fx?.clpUsdInitial ?? 0);
  const usdTotal = clamp(
    riskCapital?.usdTotal ??
      (clamp(riskCapital?.usd ?? 0) + (usdSnapshotCLP > 0 ? clamp(riskCapital?.clp ?? 0) / usdSnapshotCLP : 0)),
  );
  const riskUsdCLP = usdTotal > 0
    ? usdTotal * (usdSnapshotCLP > 0 ? usdSnapshotCLP : 1)
    : clamp(riskCapital?.totalCLP ?? 0);
  return {
    banks,
    riskUsdCLP,
    sleeves: {
      rvGlobal: normalized.rvGlobal * optimizable,
      rfGlobal: normalized.rfGlobal * optimizable,
      rvChile: normalized.rvChile * optimizable,
      rfChile: normalized.rfChile * optimizable,
    },
  };
}

export function applySleeveReturns(state: LiquidPathState, monthlyReturns: {
  rvGlobal: number;
  rfGlobal: number;
  rvChile: number;
  rfChile: number;
  banks: number;
  riskUsd: number;
}): void {
  state.sleeves.rvGlobal *= 1 + monthlyReturns.rvGlobal;
  state.sleeves.rfGlobal *= 1 + monthlyReturns.rfGlobal;
  state.sleeves.rvChile *= 1 + monthlyReturns.rvChile;
  state.sleeves.rfChile *= 1 + monthlyReturns.rfChile;
  state.banks *= 1 + monthlyReturns.banks;
  state.riskUsdCLP *= 1 + monthlyReturns.riskUsd;
}

function splitRf(sleeves: LiquidPathState['sleeves'], bucketTarget: number) {
  const rfTotal = clamp(sleeves.rfGlobal) + clamp(sleeves.rfChile);
  const bucketRF = Math.min(rfTotal, clamp(bucketTarget));
  const otherRF = Math.max(0, rfTotal - bucketRF);
  return { rfTotal, bucketRF, otherRF };
}

function sumRf(sleeves: LiquidPathState['sleeves']): number {
  return clamp(sleeves.rfGlobal) + clamp(sleeves.rfChile);
}

function sumEquity(sleeves: LiquidPathState['sleeves']): number {
  return clamp(sleeves.rvGlobal) + clamp(sleeves.rvChile);
}

function withdrawFromRfProRata(sleeves: LiquidPathState['sleeves'], amount: number): number {
  let remaining = Math.max(0, amount);
  const rfTotal = clamp(sleeves.rfGlobal) + clamp(sleeves.rfChile);
  if (rfTotal <= 0 || remaining <= 0) return remaining;
  const take = Math.min(remaining, rfTotal);
  const shareGlobal = rfTotal > 0 ? sleeves.rfGlobal / rfTotal : 0.5;
  const globalTake = take * shareGlobal;
  const chileTake = take - globalTake;
  sleeves.rfGlobal = Math.max(0, sleeves.rfGlobal - globalTake);
  sleeves.rfChile = Math.max(0, sleeves.rfChile - chileTake);
  remaining -= take;
  return remaining;
}

function withdrawFromEquityProRata(sleeves: LiquidPathState['sleeves'], amount: number): number {
  let remaining = Math.max(0, amount);
  const eqTotal = clamp(sleeves.rvGlobal) + clamp(sleeves.rvChile);
  if (eqTotal <= 0 || remaining <= 0) return remaining;
  const take = Math.min(remaining, eqTotal);
  const shareGlobal = eqTotal > 0 ? sleeves.rvGlobal / eqTotal : 0.5;
  const globalTake = take * shareGlobal;
  const chileTake = take - globalTake;
  sleeves.rvGlobal = Math.max(0, sleeves.rvGlobal - globalTake);
  sleeves.rvChile = Math.max(0, sleeves.rvChile - chileTake);
  remaining -= take;
  return remaining;
}

function withdrawFromRisk(state: LiquidPathState, amount: number): number {
  let remaining = Math.max(0, amount);
  const take = Math.min(remaining, clamp(state.riskUsdCLP));
  state.riskUsdCLP = Math.max(0, state.riskUsdCLP - take);
  remaining -= take;
  return remaining;
}

export function applyExpenseWaterfall(
  state: LiquidPathState,
  monthlyExpense: number,
  bucketTarget: number,
): { paid: number; shortfall: number } {
  let remaining = Math.max(0, monthlyExpense);
  const before = remaining;

  const banksTake = Math.min(remaining, clamp(state.banks));
  state.banks = Math.max(0, state.banks - banksTake);
  remaining -= banksTake;

  const afterBanksSplit = splitRf(state.sleeves, bucketTarget);
  const bucketTake = Math.min(remaining, afterBanksSplit.bucketRF);
  remaining = withdrawFromRfProRata(state.sleeves, bucketTake);

  const afterBucketSplit = splitRf(state.sleeves, 0);
  const otherTake = Math.min(remaining, afterBucketSplit.rfTotal);
  remaining = withdrawFromRfProRata(state.sleeves, otherTake);

  remaining = withdrawFromEquityProRata(state.sleeves, remaining);
  remaining = withdrawFromRisk(state, remaining);

  return {
    paid: before - remaining,
    shortfall: remaining,
  };
}

export function runAnnualRebalance(
  state: LiquidPathState,
  params: ModelParameters,
  bucketTarget: number,
): AnnualRebalanceResult {
  const normalized = normalizeWeights(params.weights);
  const target = clamp(bucketTarget);
  const rfBefore = sumRf(state.sleeves);
  const bucketBeforeRebalance = Math.min(rfBefore, target);

  let deficit = Math.max(0, target - rfBefore);
  let usedBanksForBucket = 0;
  let equitySoldForBucket = 0;

  if (deficit > 0) {
    usedBanksForBucket = Math.min(deficit, clamp(state.banks));
    state.banks = Math.max(0, state.banks - usedBanksForBucket);
    state.sleeves.rfChile += usedBanksForBucket;
    deficit -= usedBanksForBucket;
  }

  if (deficit > 0) {
    const missingBeforeEquitySell = deficit;
    deficit = withdrawFromEquityProRata(state.sleeves, deficit);
    equitySoldForBucket = Math.max(0, missingBeforeEquitySell - deficit);
    state.sleeves.rfChile += equitySoldForBucket;
  }

  const rfAfterBucketFill = sumRf(state.sleeves);
  const bucketReserve = Math.min(target, rfAfterBucketFill);
  const totalInvestable =
    sumRf(state.sleeves) +
    sumEquity(state.sleeves);
  const allocatable = Math.max(0, totalInvestable - bucketReserve);

  state.sleeves.rvGlobal = allocatable * normalized.rvGlobal;
  state.sleeves.rvChile = allocatable * normalized.rvChile;
  state.sleeves.rfGlobal = allocatable * normalized.rfGlobal;
  state.sleeves.rfChile = bucketReserve + allocatable * normalized.rfChile;

  const bucketAfterRebalance = Math.min(sumRf(state.sleeves), target);

  return {
    bucketTarget: target,
    bucketBeforeRebalance,
    bucketAfterRebalance,
    usedBanksForBucket,
    equitySoldForBucket,
  };
}

export function captureBlockSnapshot(
  month: number,
  state: LiquidPathState,
  expense: number,
  mortgagePoint: MortgageProjectionPoint,
): BlockSnapshot {
  const rfSplit = splitRf(state.sleeves, expense * 36);
  const equityAssets = clamp(state.sleeves.rvGlobal) + clamp(state.sleeves.rvChile);
  const riskCapitalCLP = clamp(state.riskUsdCLP);
  const liquidCapital = clamp(state.banks) + rfSplit.rfTotal + equityAssets + riskCapitalCLP;
  return {
    month,
    banks: clamp(state.banks),
    riskCapitalCLP,
    bucketRF: rfSplit.bucketRF,
    otherRF: rfSplit.otherRF,
    equityAssets,
    liquidCapital,
    expense,
    propertyValueCLP: clamp(mortgagePoint.propertyValueCLP),
    mortgageDebtCLP: clamp(mortgagePoint.mortgageDebtCLP),
    realEstateEquityCLP: clamp(mortgagePoint.realEstateEquityCLP),
  };
}
