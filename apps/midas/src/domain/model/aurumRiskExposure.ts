import type { RiskCapitalInput } from './types';
export type NormalizedRiskCapitalExposure = {
    baseWithoutRiskCLP: number;
    baseWithRiskCLP: number;
    riskTotalCLP: number;
    usdTotal: number;
    usdSnapshotCLP: number;
    visibleCLP: number;
    source?: string;
};
export function normalizeRiskCapitalExposure(risk: RiskCapitalInput | null | undefined, fallbackUsdSnapshotCLP: number, totalWithoutRiskCLP?: number, totalWithRiskCLP?: number): NormalizedRiskCapitalExposure {
    const rawTotalWithoutRisk = Number(totalWithoutRiskCLP ?? 0);
    const rawTotalWithRisk = Number(totalWithRiskCLP ?? 0);
    const baseWithoutRiskCLP = Number.isFinite(rawTotalWithoutRisk) && rawTotalWithoutRisk > 0 ? rawTotalWithoutRisk : 0;
    const baseWithRiskCLP = Number.isFinite(rawTotalWithRisk) && rawTotalWithRisk > 0 ? rawTotalWithRisk : 0;
    const riskFromTotals = baseWithoutRiskCLP > 0 && baseWithRiskCLP > baseWithoutRiskCLP
        ? baseWithRiskCLP - baseWithoutRiskCLP
        : 0;
    const rawTotalCLP = Number(risk?.totalCLP ?? 0);
    const hasExplicitTotalCLP = risk != null &&
        Object.prototype.hasOwnProperty.call(risk, 'totalCLP') &&
        Number.isFinite(rawTotalCLP);
    const rawCLP = Number(risk?.clp ?? 0);
    const rawUSD = Number(risk?.usd ?? 0);
    const rawUsdTotal = Number(risk?.usdTotal ?? 0);
    const usdSnapshotCLP = Number(risk?.usdSnapshotCLP ?? fallbackUsdSnapshotCLP);
    const safeUsdSnapshotCLP = Number.isFinite(usdSnapshotCLP) && usdSnapshotCLP > 0 ? usdSnapshotCLP : 1;
    const clpComponent = Number.isFinite(rawCLP) && rawCLP > 0 ? rawCLP : 0;
    const usdComponent = Number.isFinite(rawUSD) && rawUSD > 0 ? rawUSD : 0;
    const totalClpComponent = Number.isFinite(rawTotalCLP) && rawTotalCLP > 0 ? rawTotalCLP : 0;
    const usdTotalFromRaw = usdComponent + (clpComponent / safeUsdSnapshotCLP);
    const totalClpForExposure = hasExplicitTotalCLP ? Math.max(0, rawTotalCLP) : Math.max(totalClpComponent, riskFromTotals);
    const usdTotalFromTotalClp = totalClpForExposure / safeUsdSnapshotCLP;
    const usdTotalFromInput = Number.isFinite(rawUsdTotal) && rawUsdTotal > 0 ? rawUsdTotal : 0;
    const usdTotal = hasExplicitTotalCLP
        ? Math.max(0, usdTotalFromTotalClp)
        : Math.max(0, usdTotalFromInput, usdTotalFromRaw, usdTotalFromTotalClp);
    const riskTotalCLP = totalClpForExposure > 0 ? totalClpForExposure : usdTotal * safeUsdSnapshotCLP;
    const finalWithRisk = baseWithoutRiskCLP > 0
        ? baseWithoutRiskCLP + riskTotalCLP
        : baseWithRiskCLP > 0
            ? baseWithRiskCLP
            : riskTotalCLP;
    return {
        baseWithoutRiskCLP,
        baseWithRiskCLP: finalWithRisk,
        riskTotalCLP,
        usdTotal,
        usdSnapshotCLP: safeUsdSnapshotCLP,
        visibleCLP: riskTotalCLP,
        ...(risk?.source ? { source: risk.source } : {}),
    };
}
