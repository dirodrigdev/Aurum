import type { WealthFxRates, WealthMonthlyClosure, WealthRecord } from './wealthStorage';
import { resolveClosureSectionAmounts } from './wealthStorage';
import { buildTrailingSummary, computeMonthlyRows } from './returnsAnalysis';
import { buildWealthFreshnessModel } from './wealthFreshness';

export type AurumPresentationViewModel = {
  status: 'ready' | 'partial' | 'empty';
  closurePeriodLabel: string | null;
  assetShares: Array<{ block: 'inversiones' | 'bancos' | 'vivienda'; pct: number }>;
  return36mUfPct: number | null;
  returnValidMonths: number;
  fresh7dPct: number | null;
  riskCapitalScope: 'incluido' | 'excluido' | 'no aplica';
  conclusions: {
    structure: 'Las inversiones representan el mayor bloque de activos.' | 'Los bancos representan el mayor bloque de activos.' | 'La vivienda representa el mayor bloque de activos.' | 'Aún no hay un desglose confirmado para interpretar.';
    evolution: 'El rendimiento histórico anualizado fue positivo.' | 'El rendimiento histórico anualizado fue negativo.' | 'El rendimiento histórico anualizado fue cercano a cero.' | 'Aún no hay 36 meses válidos para esta lectura.';
    scope: 'La mayor parte de la información está actualizada en los últimos 7 días.' | 'Parte de la información necesita actualización.' | 'Aún no hay información suficiente para evaluar la actualización.';
  };
};

const safePct = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

const periodLabel = (monthKey: string): string | null => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

export const buildAurumPresentationModel = (input: {
  closures: WealthMonthlyClosure[];
  records: WealthRecord[];
  fx: WealthFxRates;
  includeRiskCapitalInTotals: boolean;
  now?: Date;
}): AurumPresentationViewModel => {
  const confirmed = input.closures.filter((closure) => !closure.analysisProvisionalReason && !!closure.closedAt);
  const ordered = [...confirmed].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const selected = ordered.map((closure) => ({
    closure,
    amounts: resolveClosureSectionAmounts({ closure, includeRiskCapitalInTotals: input.includeRiskCapitalInTotals }),
  })).find(({ amounts }) => amounts.hasCanonicalSummary && amounts.source !== 'legacy_byBlock_fallback' &&
    [amounts.investmentClp, amounts.investmentClpWithRisk, amounts.bankClp, amounts.realEstateAssetsClp].every((value) => Number.isFinite(value) && value >= 0) &&
    (input.includeRiskCapitalInTotals ? amounts.investmentClpWithRisk : amounts.investmentClp) + amounts.bankClp + amounts.realEstateAssetsClp > 0);

  const assets = selected ? [
    { block: 'inversiones' as const, amount: input.includeRiskCapitalInTotals ? selected.amounts.investmentClpWithRisk : selected.amounts.investmentClp },
    { block: 'bancos' as const, amount: selected.amounts.bankClp },
    { block: 'vivienda' as const, amount: selected.amounts.realEstateAssetsClp },
  ] : [];
  const assetTotal = assets.reduce((sum, item) => sum + item.amount, 0);
  const assetShares = assetTotal > 0 ? assets.map((item) => ({ block: item.block, pct: Math.round(item.amount / assetTotal * 1000) / 10 })) : [];
  const top = [...assets].sort((a, b) => b.amount - a.amount)[0];

  const historical = buildTrailingSummary(computeMonthlyRows(confirmed, input.includeRiskCapitalInTotals, 'UF'), 36, 'presentation-36m-uf', '36 meses · UF');
  const returnValidMonths = historical?.validMonths ?? 0;
  const return36mUfPct = historical?.coverage.status === 'complete' && returnValidMonths >= 36
    ? safePct(historical.pctRetorno)
    : null;

  const freshness = buildWealthFreshnessModel(input.records, input.fx, {
    includeRiskCapitalInTotals: input.includeRiskCapitalInTotals,
    now: input.now,
  });
  const fresh7dPct = freshness.status === 'ok' && freshness.fresh7dPct !== null
    ? safePct(freshness.fresh7dPct * 100)
    : null;
  const hasRiskCapital = selected ? selected.amounts.riskCapitalClp > 0 : freshness.riskCapitalIncluded || freshness.riskCapitalExcluded;
  const riskCapitalScope = hasRiskCapital ? input.includeRiskCapitalInTotals ? 'incluido' : 'excluido' : 'no aplica';

  return {
    status: assetShares.length && return36mUfPct !== null && fresh7dPct !== null ? 'ready' :
      assetShares.length || returnValidMonths || fresh7dPct !== null ? 'partial' : 'empty',
    closurePeriodLabel: selected ? periodLabel(selected.closure.monthKey) : null,
    assetShares,
    return36mUfPct,
    returnValidMonths,
    fresh7dPct,
    riskCapitalScope,
    conclusions: {
      structure: top?.block === 'inversiones' ? 'Las inversiones representan el mayor bloque de activos.' :
        top?.block === 'bancos' ? 'Los bancos representan el mayor bloque de activos.' :
          top?.block === 'vivienda' ? 'La vivienda representa el mayor bloque de activos.' : 'Aún no hay un desglose confirmado para interpretar.',
      evolution: return36mUfPct === null ? 'Aún no hay 36 meses válidos para esta lectura.' :
        return36mUfPct > 0.5 ? 'El rendimiento histórico anualizado fue positivo.' :
          return36mUfPct < -0.5 ? 'El rendimiento histórico anualizado fue negativo.' : 'El rendimiento histórico anualizado fue cercano a cero.',
      scope: fresh7dPct === null ? 'Aún no hay información suficiente para evaluar la actualización.' :
        fresh7dPct >= 80 ? 'La mayor parte de la información está actualizada en los últimos 7 días.' : 'Parte de la información necesita actualización.',
    },
  };
};
