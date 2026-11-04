import type { ModelParameters, FutureCapitalEvent, SimulationCompositionInput } from '../../domain/model/types';
import { DEFAULT_PARAMETERS } from '../../domain/model/defaults';
import { normalizeModelSpendingPhases } from '../../domain/model/spendingPhases';
import { normalizeRiskCapitalExposure } from '../../domain/model/aurumRiskExposure';
import { stripManualAdjustmentImpactFromParams, type ManualAdjustmentImpact } from '../../domain/simulation/manualCapitalAdjustments';
const EMPTY_MANUAL_ADJUSTMENT_IMPACT: ManualAdjustmentImpact = { currentTotalDelta: 0, currentBanksDelta: 0, currentInvestmentsDelta: 0, currentRiskDelta: 0, futureEvents: [], futureCapitalEvents: [] };
const isBlocksCompositionMode = (p: ModelParameters) => p.simulationComposition?.mode === 'full' || p.simulationComposition?.mode === 'partial';
export type RebaseOptions = {
    applyCapital?: boolean;
    manualImpact?: ManualAdjustmentImpact;
    riskCapitalEnabled?: boolean;
    sourceBase?: boolean;
};
export function rebaseSimulationParams(baseParamsCurrent: ModelParameters, currentSimParams: ModelParameters, options: RebaseOptions | undefined, context: {
    manualAdjustmentImpact: ManualAdjustmentImpact;
    riskCapitalEnabled: boolean;
    riskCapitalCLP: number;
    riskCapitalUsdSnapshotCLP: number;
    applyActiveDistribution: (p: ModelParameters) => ModelParameters;
    resolveSimulationBaseMonth: (p: ModelParameters) => string;
}): ModelParameters {
    const { manualAdjustmentImpact, riskCapitalEnabled, applyActiveDistribution, resolveSimulationBaseMonth } = context;
    const sourceRisk = baseParamsCurrent.simulationComposition?.nonOptimizable?.riskCapital;
    const riskCapitalCLP = options?.sourceBase ? Number(sourceRisk?.totalCLP ?? 0) : context.riskCapitalCLP;
    const riskCapitalUsdSnapshotCLP = options?.sourceBase ? Number(sourceRisk?.usdSnapshotCLP ?? baseParamsCurrent.fx.clpUsdInitial) : context.riskCapitalUsdSnapshotCLP;
    const applyCapital = options?.applyCapital ?? true;
    const canonicalBaseParamsCurrent = options?.sourceBase
        ? stripManualAdjustmentImpactFromParams(baseParamsCurrent, EMPTY_MANUAL_ADJUSTMENT_IMPACT)
        : stripManualAdjustmentImpactFromParams(baseParamsCurrent, manualAdjustmentImpact);
    const canonicalCurrentSimParams = stripManualAdjustmentImpactFromParams(currentSimParams, manualAdjustmentImpact);
    const manualImpact = options?.manualImpact ?? manualAdjustmentImpact;
    const riskEnabled = options?.riskCapitalEnabled ?? riskCapitalEnabled;
    const mergedEvents = [
        ...(canonicalBaseParamsCurrent.cashflowEvents ?? []),
        ...manualImpact.futureEvents,
    ];
    const mergedFutureCapitalEvents = (() => {
        const map = new Map<string, FutureCapitalEvent>();
        for (const event of canonicalBaseParamsCurrent.futureCapitalEvents ?? []) {
            map.set(event.id, event);
        }
        for (const event of canonicalCurrentSimParams.futureCapitalEvents ?? []) {
            map.set(event.id, event);
        }
        for (const event of manualImpact.futureCapitalEvents ?? []) {
            map.set(event.id, event);
        }
        return [...map.values()].sort((a, b) => {
            const dateCmp = a.effectiveDate.localeCompare(b.effectiveDate);
            if (dateCmp !== 0)
                return dateCmp;
            return a.id.localeCompare(b.id);
        });
    })();
    const blocksMode = isBlocksCompositionMode(canonicalBaseParamsCurrent);
    let next: ModelParameters = {
        ...canonicalCurrentSimParams,
        ...(options?.sourceBase ? { capitalSource: canonicalBaseParamsCurrent.capitalSource, manualCapitalInput: canonicalBaseParamsCurrent.manualCapitalInput } : {}),
        cashflowEvents: mergedEvents,
        futureCapitalEvents: mergedFutureCapitalEvents,
        simulationBaseMonth: canonicalCurrentSimParams.simulationBaseMonth
            ?? canonicalBaseParamsCurrent.simulationBaseMonth
            ?? resolveSimulationBaseMonth(canonicalCurrentSimParams),
    };
    if (blocksMode && canonicalBaseParamsCurrent.simulationComposition) {
        const baseComposition = JSON.parse(JSON.stringify(canonicalBaseParamsCurrent.simulationComposition)) as SimulationCompositionInput;
        let nextOptimizable = Math.max(0, Number(baseComposition.optimizableInvestmentsCLP ?? 0) + manualImpact.currentInvestmentsDelta);
        let nextBanks = Math.max(0, Number(baseComposition.nonOptimizable?.banksCLP ?? 0) + manualImpact.currentBanksDelta);
        const baseRiskExposure = normalizeRiskCapitalExposure(baseComposition.nonOptimizable?.riskCapital, riskCapitalUsdSnapshotCLP || baseParamsCurrent.fx.clpUsdInitial || DEFAULT_PARAMETERS.fx.clpUsdInitial, Number(baseComposition.totalNetWorthCLP ?? 0), Number(baseComposition.totalNetWorthCLP ?? 0) + Number(riskCapitalCLP ?? 0));
        const riskUsdSnapshot = baseRiskExposure.usdSnapshotCLP;
        const riskBaseClp = Math.max(0, riskCapitalCLP || baseRiskExposure.riskTotalCLP);
        const riskManualClp = manualImpact.currentRiskDelta;
        const riskEnabledClpTotal = Math.max(0, riskBaseClp + riskManualClp);
        const riskUsdEnabledTotal = riskUsdSnapshot > 0
            ? riskEnabledClpTotal / riskUsdSnapshot
            : 0;
        const targetWithoutRisk = Math.max(1, Number(baseComposition.optimizableInvestmentsCLP ?? 0) +
            Number(baseComposition.nonOptimizable?.banksCLP ?? 0) +
            manualImpact.currentBanksDelta +
            manualImpact.currentInvestmentsDelta);
        const modeledWithoutRisk = nextOptimizable + nextBanks;
        let gap = targetWithoutRisk - modeledWithoutRisk;
        if (Math.abs(gap) > 0.5) {
            nextBanks = Math.max(0, nextBanks + gap);
            const remainingGap = targetWithoutRisk - (nextOptimizable + nextBanks);
            if (Math.abs(remainingGap) > 0.5) {
                nextOptimizable = Math.max(0, nextOptimizable + remainingGap);
            }
        }
        // capitalInitial debe seguir el capital core líquido usado por el motor (optimizable + bancos).
        // Casa y riesgo viajan por canales separados (house / risk_capital_clp) en el payload M8.
        const targetVisibleCapital = targetWithoutRisk;
        const nextComposition: SimulationCompositionInput = {
            ...baseComposition,
            optimizableInvestmentsCLP: nextOptimizable,
            nonOptimizable: {
                ...baseComposition.nonOptimizable,
                banksCLP: nextBanks,
                riskCapital: {
                    enabled: riskEnabled,
                    source: baseComposition.nonOptimizable?.riskCapital?.source ?? 'normalized-usd',
                    usdSnapshotCLP: riskUsdSnapshot,
                    usdTotal: riskUsdEnabledTotal,
                    usd: riskUsdEnabledTotal,
                    totalCLP: riskEnabledClpTotal,
                },
            },
        };
        next = {
            ...next,
            simulationComposition: nextComposition,
            capitalInitial: applyCapital ? Math.max(1, targetVisibleCapital) : canonicalCurrentSimParams.capitalInitial,
        };
    }
    else {
        const riskDelta = riskEnabled
            ? manualImpact.currentRiskDelta + riskCapitalCLP
            : 0;
        const nextDelta = manualImpact.currentBanksDelta + manualImpact.currentInvestmentsDelta + riskDelta;
        const targetCapital = Math.max(1, canonicalBaseParamsCurrent.capitalInitial + nextDelta);
        next = {
            ...next,
            capitalInitial: applyCapital ? targetCapital : canonicalCurrentSimParams.capitalInitial,
        };
    }
    const normalizedNext: ModelParameters = {
        ...next,
        spendingPhases: normalizeModelSpendingPhases(next),
    };
    const hasRealEstateBlock = Boolean(normalizedNext.simulationComposition?.nonOptimizable?.realEstate);
    if (!hasRealEstateBlock && normalizedNext.realEstatePolicy?.enabled) {
        normalizedNext.realEstatePolicy = {
            ...normalizedNext.realEstatePolicy,
            enabled: false,
        };
    }
    return applyActiveDistribution(normalizedNext);
}
