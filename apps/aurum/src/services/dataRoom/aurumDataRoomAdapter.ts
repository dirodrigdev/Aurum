import type { AggregatedSummary, MonthlyReturnRow } from '../../components/analysis/types';
import type { WealthEvolutionPoint } from '../returnsAnalysis';
import type { AnalysisExportContext, AurumAdapterResult, AurumReturnExportRow } from './dataRoomTypes';
import { defaultFxRates, resolveClosureSectionAmounts, type WealthCurrency, type WealthMonthlyClosure, type WealthRecord } from '../wealthStorage';

const sortClosuresAsc = (closures: WealthMonthlyClosure[]) => [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));

const toClp = (amount: number, currency: WealthCurrency, fx = defaultFxRates): number | null => {
  if (!Number.isFinite(amount)) return null;
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * Number(fx.usdClp || 0);
  if (currency === 'EUR') return amount * Number(fx.eurClp || 0);
  if (currency === 'UF') return amount * Number(fx.ufClp || 0);
  return null;
};

const buildReturnNotes = (summary: AggregatedSummary) => {
  const notes = [summary.pctRetornoNote, summary.coverage.status !== 'complete' ? `coverage:${summary.coverage.status}` : null]
    .filter(Boolean);
  return notes.join(' | ');
};

const summaryToReturnRow = (
  summary: AggregatedSummary,
  officialRowsByMonth: Map<string, MonthlyReturnRow>,
): AurumReturnExportRow => {
  const fromMonth = summary.periodStartMonthKey ?? null;
  const toMonth = summary.periodEndMonthKey ?? null;
  const startRow = fromMonth ? officialRowsByMonth.get(fromMonth) || null : null;
  const endRow = toMonth ? officialRowsByMonth.get(toMonth) || null : null;
  return {
    period_label: summary.label,
    from_month: fromMonth,
    to_month: toMonth,
    retorno_economico_clp: summary.retornoRealAcumClp,
    retorno_economico_pct: summary.pctRetorno,
    patrimonio_inicio_clp: startRow?.prevNetClp ?? null,
    patrimonio_fin_clp: endRow?.netClp ?? null,
    gasto_periodo_clp_si_disponible: summary.gastosAcumClp,
    valid_months: `${summary.validMonths}/${summary.coverage.expectedMonths}`,
    notes: buildReturnNotes(summary),
  };
};

const buildOrderedReturnRows = (
  input: AnalysisExportContext,
  officialRowsByMonth: Map<string, MonthlyReturnRow>,
): AurumReturnExportRow[] => {
  const ordered = [
    input.heroLastMonth,
    input.heroLast12,
    input.heroYtd2026,
    ...input.periodSummaries,
    input.heroSinceStart,
    ...input.yearlySummaries,
  ].filter((item): item is AggregatedSummary => Boolean(item));

  const seen = new Set<string>();
  return ordered
    .filter((summary) => {
      if (seen.has(summary.key)) return false;
      seen.add(summary.key);
      return true;
    })
    .map((summary) => summaryToReturnRow(summary, officialRowsByMonth));
};

export const buildAurumDataRoomData = (input: AnalysisExportContext): AurumAdapterResult => {
  const closures = sortClosuresAsc(input.closures);
  const officialRowsByMonth = new Map(input.officialMonthlyRowsAsc.map((row) => [row.monthKey, row]));
  const wealthPointsByMonth = new Map(input.wealthEvolutionModel.points.map((point) => [point.monthKey, point]));
  const patrimonioRows = closures.map((closure) => {
    const resolved = resolveClosureSectionAmounts({ closure, includeRiskCapitalInTotals: false });
    const point = wealthPointsByMonth.get(closure.monthKey) || null;
    return {
      monthKey: closure.monthKey,
      total_clp: point?.netClp ?? resolved.totalNetClp ?? null,
      total_uf: point?.netUf ?? null,
      bancos_clp: resolved.bankClp,
      inversiones_clp: resolved.investmentClp,
      bienes_raices_clp: resolved.realEstateNetClp,
      deuda_hipotecaria_clp: resolved.mortgageDebtClp,
      deuda_no_hipotecaria_clp: resolved.nonMortgageDebtClp,
      capital_riesgo_clp: resolved.riskCapitalTotalClp,
      cierre_status: closure.fxMissing?.length ? 'incomplete_fx' : 'complete',
      source: resolved.source,
    };
  });

  const monthlyPanelRows = closures.map((closure) => {
    const resolved = resolveClosureSectionAmounts({ closure, includeRiskCapitalInTotals: false });
    const point = wealthPointsByMonth.get(closure.monthKey) || null;
    const official = officialRowsByMonth.get(closure.monthKey) || null;
    const warnings = [
      ...resolved.warnings,
      official?.gastosStatus === 'missing' ? 'gastos_missing' : null,
      official?.gastosStatus === 'pending' ? 'gastos_pending' : null,
      official?.gastosSource === 'legacy_static' ? 'gastos_legacy_static' : null,
    ].filter(Boolean);
    return {
      monthKey: closure.monthKey,
      patrimonio_total_clp: point?.netClp ?? resolved.totalNetClp ?? null,
      patrimonio_total_uf: point?.netUf ?? null,
      variacion_patrimonial_clp: official?.varPatrimonioClp ?? null,
      retorno_economico_clp: official?.retornoRealClp ?? null,
      retorno_economico_pct: official?.pct ?? null,
      deuda_hipotecaria_clp: resolved.mortgageDebtClp,
      deuda_no_hipotecaria_clp: resolved.nonMortgageDebtClp,
      bancos_clp: resolved.bankClp,
      inversiones_clp: resolved.investmentClp,
      bienes_raices_clp: resolved.realEstateNetClp,
      capital_riesgo_clp: resolved.riskCapitalTotalClp,
      uf_clp: Number(closure.fxRates?.ufClp ?? defaultFxRates.ufClp),
      usd_clp: Number(closure.fxRates?.usdClp ?? defaultFxRates.usdClp),
      source_status: `${resolved.source}|${official?.gastosSource || 'no_returns_row'}`,
      warnings: warnings.join(' | '),
    };
  });

  const detailRows = closures.flatMap((closure) =>
    (closure.records || []).map((record: WealthRecord) => ({
      monthKey: closure.monthKey,
      block: record.block,
      item_name: record.label,
      amount_clp: toClp(Number(record.amount || 0), record.currency, closure.fxRates || defaultFxRates),
      currency: record.currency,
      original_amount: Number.isFinite(Number(record.amount)) ? Number(record.amount) : null,
      source: record.source,
      is_estimated: record.source === 'legacy_static' || record.source === 'gastapp_monthly_backfill',
      notes: [record.note || '', record.updatedAt ? `updatedAt:${record.updatedAt}` : ''].filter(Boolean).join(' | '),
    })),
  );

  const returnRows = buildOrderedReturnRows(input, officialRowsByMonth);
  const latestPoint: WealthEvolutionPoint | null = input.wealthEvolutionModel.points.at(-1) || null;

  return {
    included: true,
    warnings: [],
    dateRangeFrom: closures[0]?.monthKey || null,
    dateRangeTo: closures.at(-1)?.monthKey || null,
    latestPatrimonioClp: latestPoint?.netClp ?? null,
    latestPatrimonioUf: latestPoint?.netUf ?? null,
    lastClosedMonth: closures.at(-1)?.monthKey || null,
    return12mPct: input.heroLast12?.pctRetorno ?? null,
    monthlyPanelRows,
    patrimonioRows,
    detailRows,
    returnRows,
    rawMinimal: {
      closures_count: closures.length,
      latest_closure: closures.at(-1)
        ? {
            id: closures.at(-1)?.id,
            monthKey: closures.at(-1)?.monthKey,
            closedAt: closures.at(-1)?.closedAt,
            summary: closures.at(-1)?.summary,
          }
        : null,
      months: closures.map((closure) => closure.monthKey),
    },
  };
};
