import type { AurumOptimizableInvestmentsSnapshot } from './types';

/**
 * Stable identity for the economic Aurum input. Publication and refresh
 * timestamps are deliberately excluded: they do not change M8 economics.
 */
export function getCanonicalSnapshotEconomicSignature(snapshot: AurumOptimizableInvestmentsSnapshot): string {
  const fx = snapshot.version === 2 ? snapshot.fxReference : undefined;
  const realEstate = snapshot.version === 2 ? snapshot.nonOptimizable?.realEstate : undefined;
  const risk = snapshot.version === 2 ? snapshot.riskCapital : undefined;
  return [
    snapshot.version,
    snapshot.snapshotMonth,
    snapshot.snapshotLabel,
    snapshot.totalNetWorthCLP,
    snapshot.optimizableInvestmentsCLP,
    realEstate?.ufSnapshotCLP ?? '',
    risk?.totalCLP ?? '',
    risk?.clp ?? '',
    risk?.usd ?? '',
    fx?.clpUsd ?? '',
    fx?.clpEur ?? '',
    fx?.usdEur ?? '',
    fx?.ufClp ?? '',
    fx?.source ?? '',
    fx?.sourceId ?? '',
    fx?.asOf ?? '',
    fx?.validationStatus ?? '',
    fx?.schemaVersion ?? '',
    fx ? [fx.rateOrigin.usd, fx.rateOrigin.eur, fx.rateOrigin.uf].join(',') : '',
    fx ? [fx.rateSource.usd, fx.rateSource.eur, fx.rateSource.uf].join(',') : '',
  ].join('|');
}
