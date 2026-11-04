import type { AurumOptimizableInvestmentsSnapshot } from './types';
import { normalizeRiskCapitalExposure } from '../../domain/model/aurumRiskExposure';
import { DEFAULT_PARAMETERS } from '../../domain/model/defaults';
import { resolveAurumEurUsdForMidas } from '../../domain/model/operativeFx';
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
/** The same risk fallback used when applying the snapshot, without provenance. */
export function getSnapshotRiskExposure(snapshot: AurumOptimizableInvestmentsSnapshot, fallbackUsdClp = DEFAULT_PARAMETERS.fx.clpUsdInitial) {
    const fx = 'fxReference' in snapshot ? snapshot.fxReference : undefined;
    const rate = finite(fx?.clpUsd) || fallbackUsdClp;
    const exposure = normalizeRiskCapitalExposure(snapshot.version === 2 ? snapshot.riskCapital : undefined, rate, finite(snapshot.totalNetWorthCLP), finite(snapshot.totalNetWorthWithRiskCLP));
    if (exposure.riskTotalCLP > 0)
        return exposure;
    const delta = Math.max(0, finite(snapshot.optimizableInvestmentsWithRiskCLP) - finite(snapshot.optimizableInvestmentsCLP));
    return delta > 0
        ? normalizeRiskCapitalExposure({ totalCLP: delta }, rate, finite(snapshot.totalNetWorthCLP), finite(snapshot.totalNetWorthCLP) + delta)
        : exposure;
}
/** Source values consumed by M8. Labels, lineage and historical spend are diagnostics. */
export function getCanonicalSnapshotEconomicSignature(snapshot: AurumOptimizableInvestmentsSnapshot): string {
    const v2 = snapshot.version === 2 ? snapshot : undefined;
    const house = v2?.nonOptimizable?.realEstate;
    const fx = 'fxReference' in snapshot ? snapshot.fxReference : undefined;
    return 'm8-source-v2:' + JSON.stringify({
        financialCapitalClp: finite(snapshot.optimizableInvestmentsCLP) + finite(v2?.nonOptimizable?.banksCLP),
        propertyValueClp: finite(house?.propertyValueCLP),
        mortgageDebtClp: finite(house?.mortgageDebtOutstandingCLP),
        ufClp: finite(house?.ufSnapshotCLP),
        riskCapitalClp: getSnapshotRiskExposure(snapshot).riskTotalCLP,
        clpUsd: finite(fx?.clpUsd),
        eurUsd: resolveAurumEurUsdForMidas(fx?.usdEur ?? null).eurUsdForMidas,
    });
}
