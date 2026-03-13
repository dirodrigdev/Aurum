import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, ChevronDown, LineChart, Zap } from 'lucide-react';
import { Button, Card, cn, Input } from '../components/Components';
import {
  WealthCurrency,
  WealthFxRates,
  WealthMonthlyClosure,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
  currentMonthKey,
  defaultFxRates,
  loadClosures,
  loadIncludeRiskCapitalInTotals,
  saveIncludeRiskCapitalInTotals,
} from '../services/wealthStorage';
import {
  buildCoveragePlan,
  buildMonthlyWithdrawalPlan,
  resolveFinancialFreedomBase,
} from '../services/financialFreedom';
import {
  buildWealthLabModel,
  GASTAPP_TOTALS,
  selectWealthLabPeriod,
  type WealthLabPoint,
  type WealthLabWindow,
} from '../services/wealthLab';
import { formatCurrency, formatMonthLabel as monthLabel } from '../utils/wealthFormat';

type AnalysisTab = 'returns' | 'freedom' | 'lab';

type FreedomControlDraft = {
  annualRatePct: string;
  horizonYears: string;
  monthlySpendClp: string;
};

type MonthlyReturnRow = {
  monthKey: string;
  fx: WealthFxRates;
  rawEurClp: number;
  netClp: number | null;
  prevNetClp: number | null;
  invalidNet: boolean;
  varPatrimonioClp: number | null;
  gastosClp: number | null;
  retornoRealClp: number | null;
  pct: number | null;
};

type AggregatedSummary = {
  key: string;
  label: string;
  validMonths: number;
  varPatrimonioAcumClp: number | null;
  gastosAcumClp: number | null;
  retornoRealAcumClp: number | null;
  pctRetorno: number | null;
  pctRetornoNote: string | null;
  spendPct: number | null;
  varPatrimonioAvgDisplay: number | null;
  gastosAvgDisplay: number | null;
  retornoRealAvgDisplay: number | null;
};

type CrpContributionInsight = {
  monthsLabel: string;
  aporteClp: number;
  aporteMensualClp: number;
  total12mClp: number;
  pctCrp: number | null;
  tone: 'positive' | 'negative' | 'neutral';
  summaryText: string;
  detailText: string | null;
  totalText: string | null;
};

const loadWealthClosures = () => loadClosures();

const summaryNetClp = (closure: WealthMonthlyClosure, includeRiskCapitalInTotals: boolean): number | null => {
  if (includeRiskCapitalInTotals && Number.isFinite(closure.summary?.netClpWithRisk)) {
    return Number(closure.summary.netClpWithRisk);
  }
  if (Number.isFinite(closure.summary?.netClp)) return Number(closure.summary.netClp);
  if (Number.isFinite(closure.summary?.netConsolidatedClp)) return Number(closure.summary.netConsolidatedClp);
  return null;
};

const safeUsdClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : defaultFxRates.usdClp;

const safeUfClp = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : defaultFxRates.ufClp;

const safeFxRaw = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: safeUsdClp(Number(fx?.usdClp)),
  eurClp: Number.isFinite(Number(fx?.eurClp)) && Number(fx?.eurClp) > 0 ? Number(fx?.eurClp) : defaultFxRates.eurClp,
  ufClp: safeUfClp(Number(fx?.ufClp)),
});

const convertFromClp = (valueClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return valueClp;
  if (currency === 'USD') return valueClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return valueClp / Math.max(1, fx.eurClp);
  return valueClp / Math.max(1, fx.ufClp);
};

const formatPct = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals).replace('.', ',')}%`;
};

const formatCompactCurrency = (value: number, currency: WealthCurrency) => {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    const scaled = (abs / 1_000_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'CLP' ? `${sign}$${scaled}B` : `${sign}${scaled}B ${currency}`;
  }

  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency === 'CLP' ? `${sign}$${scaled}MM` : `${sign}${scaled}MM ${currency}`;
  }

  if (abs >= 1_000) {
    const scaled = (abs / 1_000).toLocaleString('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return currency === 'CLP' ? `${sign}$${scaled}K` : `${sign}${scaled}K ${currency}`;
  }

  return formatCurrency(value, currency);
};

const parseNumericDraft = (value: string): number | null => {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDraftPercent = (value: string) => {
  const cleaned = String(value ?? '').replace(/[^\d,.]/g, '').replace(',', '.');
  const [whole, decimal] = cleaned.split('.');
  if (decimal === undefined) return whole;
  return `${whole}.${decimal.slice(0, 2)}`;
};

const formatDraftInteger = (value: string) => String(value ?? '').replace(/[^\d]/g, '');

const formatDraftMoney = (value: string) => {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('es-CL');
};

const formatFreedomCompactClp = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = (abs / 1_000_000).toLocaleString('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${sign}$${scaled}MM`;
  }
  if (abs >= 1_000) {
    const scaled = (abs / 1_000).toLocaleString('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}$${scaled}K`;
  }
  return formatCurrency(value, 'CLP');
};

const sumNumbers = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

const monthYear = (monthKey: string) => Number(monthKey.slice(0, 4));

const xLabelFromMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-');
  return `${month}/${year.slice(2)}`;
};

const buildCrpContributionInsight = (
  rowsWithCrp: MonthlyReturnRow[],
  rowsWithoutCrp: MonthlyReturnRow[],
): CrpContributionInsight | null => {
  const recentWithCrp = rowsWithCrp
    .filter((row) => row.retornoRealClp !== null)
    .slice(Math.max(0, rowsWithCrp.length - 12));
  if (!recentWithCrp.length) return null;

  const comparableRows = recentWithCrp
    .map((row) => {
      const withoutCrp = rowsWithoutCrp.find(
        (candidate) => candidate.monthKey === row.monthKey && candidate.retornoRealClp !== null,
      );
      if (!withoutCrp || row.retornoRealClp === null || withoutCrp.retornoRealClp === null) return null;
      return {
        monthKey: row.monthKey,
        retornoConCrpClp: row.retornoRealClp,
        retornoSinCrpClp: withoutCrp.retornoRealClp,
      };
    })
    .filter(
      (
        item,
      ): item is {
        monthKey: string;
        retornoConCrpClp: number;
        retornoSinCrpClp: number;
      } => item !== null,
    );
  if (!comparableRows.length) return null;

  const aporteClp = sumNumbers(
    comparableRows.map((row) => row.retornoConCrpClp - row.retornoSinCrpClp),
  );
  const retornoConCrpClp = sumNumbers(comparableRows.map((row) => row.retornoConCrpClp));
  const aporteMensualClp = aporteClp / 12;
  const absAporte = Math.abs(aporteMensualClp);
  const tone: CrpContributionInsight['tone'] =
    absAporte < 1_000 ? 'neutral' : aporteClp > 0 ? 'positive' : 'negative';
  const headlineAmount = formatCompactCurrency(Math.abs(aporteMensualClp), 'CLP');

  const summaryText =
    tone === 'neutral'
      ? 'CapRiesgo no movió materialmente el resultado en los últ. 12M'
      : aporteMensualClp > 0
        ? `CapRiesgo aportó ${headlineAmount}/mes en los últ. 12M`
        : `CapRiesgo restó ${headlineAmount}/mes en los últ. 12M`;

  const canShowPct = retornoConCrpClp > 1_000_000 && Math.abs(aporteClp) > 100_000;
  const pctCrp = canShowPct ? (aporteClp / retornoConCrpClp) * 100 : null;
  const detailText =
    pctCrp !== null
      ? `Cambio explicado por CapRiesgo · Explicó ${Math.abs(pctCrp).toFixed(1).replace('.', ',')}% del resultado`
      : tone === 'neutral'
        ? null
        : 'Cambio explicado por CapRiesgo';
  const totalText =
    tone === 'neutral' ? null : `Total período: ${formatCompactCurrency(aporteClp, 'CLP')}`;

  return {
    monthsLabel: 'últ. 12M',
    aporteClp,
    aporteMensualClp,
    total12mClp: aporteClp,
    pctCrp,
    tone,
    summaryText,
    detailText,
    totalText,
  };
};

const computeMonthlyRows = (closures: WealthMonthlyClosure[], includeRiskCapitalInTotals: boolean): MonthlyReturnRow[] => {
  const sorted = [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const calendarCurrent = currentMonthKey();
  const filtered = sorted.filter((closure) => closure.monthKey !== calendarCurrent);
  const rows: MonthlyReturnRow[] = [];
  let previousValidNet: number | null = null;

  for (const closure of filtered) {
    const fxRaw = safeFxRaw(closure.fxRates);
    const fx = fxRaw;
    const netClp = summaryNetClp(closure, includeRiskCapitalInTotals);
    const invalidNet = netClp === null || !Number.isFinite(netClp) || netClp <= 0;
    const prevNetClp = invalidNet ? null : previousValidNet;
    const varPatrimonioClp =
      invalidNet || prevNetClp === null || netClp === null ? null : netClp - prevNetClp;
    // [PRODUCT RULE] Cruce directo por month_key; no hay desfase entre Aurum y Gastapp.
    const gastosEur = Number.isFinite(GASTAPP_TOTALS[closure.monthKey]) ? Number(GASTAPP_TOTALS[closure.monthKey]) : null;
    const gastosClp = invalidNet || gastosEur === null ? null : gastosEur * fx.eurClp;

    const retornoRealClp =
      varPatrimonioClp === null || gastosClp === null ? null : varPatrimonioClp + gastosClp;
    const pct =
      retornoRealClp === null || prevNetClp === null || prevNetClp === 0
        ? null
        : (retornoRealClp / prevNetClp) * 100;

    if (invalidNet) {
      console.warn('[Analysis][invalid-net]', {
        monthKey: closure.monthKey,
        netClp: closure.summary?.netClp ?? null,
        netConsolidatedClp: closure.summary?.netConsolidatedClp ?? null,
      });
    } else {
      previousValidNet = Number(netClp);
    }
    rows.push({
      monthKey: closure.monthKey,
      fx,
      rawEurClp: fxRaw.eurClp,
      netClp,
      prevNetClp,
      invalidNet,
      varPatrimonioClp,
      gastosClp,
      retornoRealClp,
      pct,
    });
  }
  return rows;
};

const aggregateRows = (
  key: string,
  label: string,
  rows: MonthlyReturnRow[],
  currency: WealthCurrency,
  baseNetClp: number | null,
): AggregatedSummary => {
  // [PRODUCT RULE] N para promedio mensual = meses con retornoReal válido.
  const validRows = rows.filter(
    (row) =>
      row.varPatrimonioClp !== null &&
      row.gastosClp !== null &&
      row.retornoRealClp !== null,
  ) as Array<
    MonthlyReturnRow & {
      varPatrimonioClp: number;
      gastosClp: number;
      retornoRealClp: number;
    }
  >;

  const validMonths = validRows.length;
  const varPatrimonioAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.varPatrimonioClp)) : null;
  const gastosAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.gastosClp)) : null;
  const retornoRealAcumClp = validMonths ? sumNumbers(validRows.map((row) => row.retornoRealClp)) : null;
  let pctRetorno: number | null = null;
  let pctRetornoNote: string | null = null;
  if (validMonths > 0 && retornoRealAcumClp !== null && baseNetClp !== null && baseNetClp > 0) {
    const periodReturn = retornoRealAcumClp / baseNetClp;
    const growthBase = 1 + periodReturn;
    if (growthBase <= 0) {
      pctRetorno = null;
      pctRetornoNote = 'período negativo';
      console.warn('[Analysis][pct-anual-equiv-negativo]', { key, label, validMonths, periodReturn, baseNetClp });
    } else {
      const annualized = (Math.pow(growthBase, 12 / validMonths) - 1) * 100;
      if (annualized > 200 || annualized < -100) {
        pctRetorno = null;
        pctRetornoNote = 'fuera de rango';
        console.warn('[Analysis][pct-anual-equiv-fuera-rango]', {
          key,
          label,
          validMonths,
          annualized,
          periodReturn,
          baseNetClp,
          retornoRealAcumClp,
        });
      } else {
        pctRetorno = annualized;
      }
    }
  }
  const spendPct =
    retornoRealAcumClp === null || retornoRealAcumClp === 0 || gastosAcumClp === null
      ? null
      : (gastosAcumClp / retornoRealAcumClp) * 100;

  const varPatrimonioAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.varPatrimonioClp, currency, row.fx)),
      ) / validMonths
    : null;
  const gastosAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.gastosClp, currency, row.fx)),
      ) / validMonths
    : null;
  const retornoRealAvgDisplay = validMonths
    ? sumNumbers(
        validRows.map((row) => convertFromClp(row.retornoRealClp, currency, row.fx)),
      ) / validMonths
    : null;

  return {
    key,
    label,
    validMonths,
    varPatrimonioAcumClp,
    gastosAcumClp,
    retornoRealAcumClp,
    pctRetorno,
    pctRetornoNote,
    spendPct,
    varPatrimonioAvgDisplay,
    gastosAvgDisplay,
    retornoRealAvgDisplay,
  };
};

const SummaryTable: React.FC<{
  title: string;
  items: AggregatedSummary[];
  currency: WealthCurrency;
}> = ({ title, items, currency }) => (
  <Card className="p-3 border-slate-200">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
    <div className="mt-0.5 text-[11px] text-slate-500">Promedio mensual</div>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[600px] text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-2">Tramo</th>
            <th className="py-1 pr-2 text-right">% anual equiv.</th>
            <th className="py-1 pr-2 text-right">Ret.Real</th>
            <th className="py-1 pr-2 text-right">Var.Pat</th>
            <th className="py-1 text-right">Gastos</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const positive = (item.retornoRealAvgDisplay || 0) >= 0;
            return (
              <tr key={item.key} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 font-medium text-slate-700">
                  <div>{item.label}</div>
                  <div className="text-[10px] text-slate-500">N={item.validMonths}</div>
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatPct(item.pctRetorno)}
                  {item.pctRetorno === null && item.pctRetornoNote ? (
                    <div className="text-[10px] font-normal text-amber-700">{item.pctRetornoNote}</div>
                  ) : null}
                </td>
                <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                  {item.retornoRealAvgDisplay === null ? '—' : formatCurrency(item.retornoRealAvgDisplay, currency)}
                </td>
                <td className="py-1.5 pr-2 text-right text-slate-700">
                  {item.varPatrimonioAvgDisplay === null ? '—' : formatCurrency(item.varPatrimonioAvgDisplay, currency)}
                </td>
                <td className="py-1.5 text-right text-slate-700">
                  {item.gastosAvgDisplay === null ? '—' : formatCurrency(item.gastosAvgDisplay, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </Card>
);

const ReturnRealHero: React.FC<{
  sinceStart: AggregatedSummary | null;
  last12: AggregatedSummary | null;
  lastMonth: AggregatedSummary | null;
  lastMonthPctMonthly: number | null;
  currency: WealthCurrency;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  crpContributionInsight: CrpContributionInsight | null;
}> = ({
  sinceStart,
  last12,
  lastMonth,
  lastMonthPctMonthly,
  currency,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  crpContributionInsight,
}) => {
  const rows = [
    { key: 'inicio', label: 'DESDE INICIO', value: sinceStart, pct: sinceStart?.pctRetorno ?? null },
    { key: '12m', label: 'ÚLT. 12M', value: last12, pct: last12?.pctRetorno ?? null },
    { key: 'mes', label: 'ÚLT. MES', value: lastMonth, pct: lastMonthPctMonthly },
  ] as const;
  const spentClass = (value: AggregatedSummary | null | undefined) => {
    if (value?.spendPct === null || value?.spendPct === undefined) return 'text-slate-200';
    return value.spendPct > 100 ? 'text-rose-300' : 'text-emerald-300';
  };
  const pctClass = (pctValue: number | null) => (pctValue === null || pctValue >= 0 ? 'text-emerald-300' : 'text-rose-300');
  const retornoClass = (value: AggregatedSummary | null | undefined) =>
    (value?.retornoRealAvgDisplay || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300';

  return (
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#08152f] via-[#0d2146] to-[#0a1730] p-4 text-slate-100 shadow-[0_16px_40px_rgba(4,16,40,0.28)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(110,231,183,0.14),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(96,165,250,0.12),_transparent_38%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Retorno real</div>
            <div className="mt-1 text-[11px] text-slate-400">Lo que generó tu patrimonio, incluyendo lo que gastaste</div>
            {includeRiskCapitalInTotals && crpContributionInsight && (
              <div
                className={cn(
                  'mt-2 inline-flex flex-col rounded-xl border px-2.5 py-2 text-left',
                  crpContributionInsight.tone === 'positive'
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                    : crpContributionInsight.tone === 'negative'
                      ? 'border-rose-400/25 bg-rose-400/10 text-rose-200'
                      : 'border-slate-400/25 bg-white/5 text-slate-200',
                )}
              >
                <span className="text-[11px] font-medium">{crpContributionInsight.summaryText}</span>
                {crpContributionInsight.detailText ? (
                  <span className="mt-0.5 text-[10px] text-slate-300">{crpContributionInsight.detailText}</span>
                ) : null}
                {crpContributionInsight.totalText ? (
                  <span className="mt-0.5 text-[10px] text-slate-400">{crpContributionInsight.totalText}</span>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleRiskMode}
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition',
              includeRiskCapitalInTotals
                ? 'border-amber-300 bg-amber-50 text-amber-600'
                : 'border-slate-500/50 bg-white/5 text-slate-300',
            )}
            title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
            aria-label="Alternar capital de riesgo"
          >
            <Zap size={16} />
          </button>
        </div>
      </div>
      <div className="relative mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[2px]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {row.label}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {row.key === 'mes' ? 'Comparación mensual' : 'Tasa anual equivalente'}
                </div>
              </div>
              <div className="min-w-0 text-right">
                <div className={cn('text-[22px] font-semibold leading-none tracking-tight', pctClass(row.pct))}>
                  {formatPct(row.pct, 1)}
                </div>
                {row.pct === null && row.value?.pctRetornoNote ? (
                  <div className="mt-0.5 text-[10px] font-medium text-amber-300">{row.value.pctRetornoNote}</div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Prom. mensual</div>
                <div
                  className={cn('mt-0.5 truncate text-[15px] font-semibold leading-tight', retornoClass(row.value))}
                  title={
                    row.value?.retornoRealAvgDisplay === null || row.value?.retornoRealAvgDisplay === undefined
                      ? '—'
                      : formatCurrency(row.value.retornoRealAvgDisplay, currency)
                  }
                >
                  {row.value?.retornoRealAvgDisplay === null || row.value?.retornoRealAvgDisplay === undefined
                    ? '—'
                    : formatCompactCurrency(row.value.retornoRealAvgDisplay, currency)}
                </div>
              </div>
              <div
                className="rounded-xl bg-white/[0.04] px-2.5 py-1.5 text-right"
                title={
                  row.value?.spendPct === null || row.value?.spendPct === undefined
                    ? '—'
                    : `${row.value.spendPct.toFixed(1).replace('.', ',')}% del retorno se gasta`
                }
              >
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Gastado</div>
                <div className={cn('mt-0.5 text-[15px] font-semibold leading-tight', spentClass(row.value))}>
                  {row.value?.spendPct === null || row.value?.spendPct === undefined
                    ? '—'
                    : `${row.value.spendPct.toFixed(1).replace('.', ',')}%`}
                </div>
                <div className="text-[9px] text-slate-400">del retorno</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const ReturnsChart: React.FC<{ rows: MonthlyReturnRow[] }> = ({ rows }) => {
  const data = useMemo(
    () =>
      rows
        .filter((row) => row.pct !== null)
        .map((row) => ({ monthKey: row.monthKey, pct: Number(row.pct) })),
    [rows],
  );

  if (data.length < 2) {
    return (
      <Card className="p-3 border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Curva de retorno mensual (%)</div>
        <div className="mt-3 text-xs text-slate-500">Aún no hay suficientes cierres para dibujar la curva.</div>
      </Card>
    );
  }

  const width = 640;
  const height = 160;
  const padding = { top: 12, right: 14, bottom: 22, left: 14 };
  const minRaw = Math.min(...data.map((point) => point.pct));
  const maxRaw = Math.max(...data.map((point) => point.pct));
  const range = Math.max(0.5, maxRaw - minRaw);
  const min = minRaw - range * 0.12;
  const max = maxRaw + range * 0.12;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const average = sumNumbers(data.map((point) => point.pct)) / data.length;

  const pointX = (index: number) =>
    padding.left + (data.length === 1 ? innerWidth / 2 : (innerWidth * index) / (data.length - 1));
  const pointY = (value: number) => padding.top + ((max - value) / Math.max(1e-6, max - min)) * innerHeight;
  const path = data
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index).toFixed(2)} ${pointY(point.pct).toFixed(2)}`)
    .join(' ');
  const avgY = pointY(average);

  return (
    <Card className="p-3 border-slate-200">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <LineChart size={14} />
        Curva de retorno mensual (%)
      </div>
      <div className="mt-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
          <line
            x1={padding.left}
            y1={avgY}
            x2={width - padding.right}
            y2={avgY}
            stroke="#64748b"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <path d={path} fill="none" stroke="#0f766e" strokeWidth="2" />
          {data.map((point, index) => {
            const x = pointX(index);
            const y = pointY(point.pct);
            const showLabel = index % 6 === 0 || index === data.length - 1;
            return (
              <g key={point.monthKey}>
                <circle cx={x} cy={y} r="3" fill={point.pct >= 0 ? '#059669' : '#dc2626'} />
                {showLabel && (
                  <text x={x} y={height - 6} textAnchor="middle" fontSize="9" fill="#64748b">
                    {xLabelFromMonthKey(point.monthKey)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Línea punteada: promedio {average.toFixed(2).replace('.', ',')}%
      </div>
    </Card>
  );
};

const LAB_WINDOW_OPTIONS: Array<{ key: WealthLabWindow; label: string }> = [
  { key: 'since_start', label: 'Desde inicio' },
  { key: 'last_12m', label: 'Últ. 12M' },
  { key: 'last_month', label: 'Últ. mes' },
];

const LabHeaderCard: React.FC<{
  periodLabel: string;
  monthKey: string | null;
  headlineMetrics: ReturnType<typeof selectWealthLabPeriod>['headlineMetrics'];
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
  selectedWindow: WealthLabWindow;
  onSelectWindow: (window: WealthLabWindow) => void;
  fxCoverageNote: string | null;
}> = ({
  periodLabel,
  monthKey,
  headlineMetrics,
  includeRiskCapitalInTotals,
  onToggleRiskMode,
  selectedWindow,
  onSelectWindow,
  fxCoverageNote,
}) => {
  const realMonthlyEquivalent = headlineMetrics?.real.monthlyEquivalentClp ?? null;
  const sinFxMonthlyEquivalent = headlineMetrics?.resultadoSinFx.monthlyEquivalentClp ?? null;
  const fxMonthlyEquivalent = headlineMetrics?.aporteFx.monthlyEquivalentClp ?? null;
  const headlineMonths = headlineMetrics?.real.months ?? 0;
  const hasComposition =
    realMonthlyEquivalent !== null &&
    sinFxMonthlyEquivalent !== null &&
    fxMonthlyEquivalent !== null;
  const totalParts = hasComposition
    ? Math.abs(sinFxMonthlyEquivalent) + Math.abs(fxMonthlyEquivalent)
    : 0;
  const sinFxShare = totalParts > 0 && sinFxMonthlyEquivalent !== null ? (Math.abs(sinFxMonthlyEquivalent) / totalParts) * 100 : 0;
  const fxShare = totalParts > 0 && fxMonthlyEquivalent !== null ? (Math.abs(fxMonthlyEquivalent) / totalParts) * 100 : 0;

  const cards = [
    {
      key: 'real',
      label: 'Resultado real mensual equiv.',
      value: realMonthlyEquivalent,
      total: headlineMetrics?.real.totalClp ?? null,
      tone: (realMonthlyEquivalent || 0) >= 0 ? 'text-white' : 'text-rose-300',
    },
    {
      key: 'sinfx',
      label: 'Resultado sin FX mensual equiv.',
      value: sinFxMonthlyEquivalent,
      total: headlineMetrics?.resultadoSinFx.totalClp ?? null,
      tone: (sinFxMonthlyEquivalent || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300',
    },
    {
      key: 'fx',
      label: 'Aporte FX mensual equiv.',
      value: fxMonthlyEquivalent,
      total: headlineMetrics?.aporteFx.totalClp ?? null,
      tone: (fxMonthlyEquivalent || 0) >= 0 ? 'text-sky-300' : 'text-rose-300',
    },
  ];

  return (
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#0b1728] via-[#10203a] to-[#12284a] p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Lab</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="text-sm text-slate-300">
              {monthKey ? `Lectura analítica de ${monthLabel(monthKey)}` : 'Lectura analítica del período seleccionado'}
            </div>
            {includeRiskCapitalInTotals && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                +CapRiesgo
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleRiskMode}
          className={cn(
            'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition',
            includeRiskCapitalInTotals
              ? 'border-amber-300 bg-amber-50 text-amber-600'
              : 'border-white/20 bg-white/5 text-slate-300',
          )}
          title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
          aria-label={includeRiskCapitalInTotals ? 'Activar vista sin capital de riesgo' : 'Activar vista con capital de riesgo'}
        >
          <Zap size={16} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LAB_WINDOW_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelectWindow(option.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-semibold transition',
              selectedWindow === option.key
                ? 'border-white/20 bg-white/12 text-white'
                : 'border-white/10 bg-transparent text-slate-300',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.key} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{card.label}</div>
            <div className={cn('mt-1 text-xl font-semibold', card.tone)}>
              {card.value !== null ? formatFreedomCompactClp(card.value) : '—'}
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              {headlineMonths > 1 ? `${periodLabel} · ${headlineMonths} meses comparables` : periodLabel}
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              {card.total !== null ? `Total período: ${formatFreedomCompactClp(card.total)}` : 'Total período: —'}
            </div>
          </div>
        ))}
      </div>

      {fxCoverageNote && <div className="mt-2 text-[11px] text-slate-300/80">{fxCoverageNote}</div>}

      {hasComposition && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Composición del promedio mensual equivalente</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="flex h-full w-full">
              <div
                className="bg-emerald-400/90"
                style={{ width: `${Math.max(0, Math.min(100, sinFxShare))}%` }}
              />
              <div
                className={cn('transition-all', (fxMonthlyEquivalent || 0) >= 0 ? 'bg-sky-400/90' : 'bg-rose-400/90')}
                style={{ width: `${Math.max(0, Math.min(100, fxShare))}%` }}
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
            <div className="inline-flex items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              Resultado sin FX
            </div>
            <div className="inline-flex items-center gap-2 text-slate-300">
              <span className={cn('h-2.5 w-2.5 rounded-full', (fxMonthlyEquivalent || 0) >= 0 ? 'bg-sky-400' : 'bg-rose-400')} />
              Aporte FX
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

const LabIndicesChart: React.FC<{ points: WealthLabPoint[]; periodLabel: string }> = ({ points, periodLabel }) => {
  if (points.length < 2) {
    return (
      <Card className="border-slate-200 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retorno sin efecto cambiario</div>
        <div className="mt-2 text-[11px] text-slate-500">
          {periodLabel === 'Últ. mes'
            ? 'El corte Últ. mes muestra el último tramo comparable; se necesitan al menos dos puntos para dibujar la comparación base 100.'
            : 'Aún no hay suficientes meses comparables con exposición USD identificable para dibujar el índice.'}
        </div>
      </Card>
    );
  }

  const width = 640;
  const height = 200;
  const padding = { top: 14, right: 16, bottom: 28, left: 16 };
  const values = points.flatMap((point) => [Number(point.indiceReal), Number(point.indiceSinFx)]).filter(Number.isFinite);
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const range = Math.max(1, maxRaw - minRaw);
  const min = Math.max(0, minRaw - range * 0.15);
  const max = maxRaw + range * 0.15;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
  const y = (value: number) => padding.top + ((max - value) / Math.max(1e-6, max - min)) * innerHeight;
  const realPath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(Number(point.indiceReal)).toFixed(2)}`)
    .join(' ');
  const sinFxPath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(Number(point.indiceSinFx)).toFixed(2)}`)
    .join(' ');
  const labelIndexes = Array.from(new Set([0, ...points.map((_, index) => index).filter((index) => index % 6 === 0), points.length - 1]));

  return (
    <Card className="border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retorno sin efecto cambiario</div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{periodLabel}</div>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Neutraliza USD/CLP mensual sobre bloques expuestos a USD. El gráfico compara índice real vs índice sin FX, ambos base 100.
      </div>
      <div className="mt-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full">
          <line
            x1={padding.left}
            y1={y(100)}
            x2={width - padding.right}
            y2={y(100)}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <path d={realPath} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
          <path d={sinFxPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
          {points.map((point, index) => {
            if (!labelIndexes.includes(index)) return null;
            return (
              <g key={point.monthKey}>
                <circle cx={x(index)} cy={y(Number(point.indiceReal))} r="3" fill="#0f766e" />
                <circle cx={x(index)} cy={y(Number(point.indiceSinFx))} r="3" fill="#2563eb" />
                <text x={x(index)} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                  {xLabelFromMonthKey(point.monthKey)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
        <div className="inline-flex items-center gap-2 text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full bg-teal-700" />
          Índice real base 100
        </div>
        <div className="inline-flex items-center gap-2 text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
          Índice sin FX base 100
        </div>
      </div>
    </Card>
  );
};

const LabMetricsGrid: React.FC<{
  period: ReturnType<typeof selectWealthLabPeriod>;
}> = ({ period }) => {
  const items = [
    {
      key: 'resultado-sin-fx-periodo',
      label: period.key === 'last_month' ? 'Resultado sin FX mensual' : 'Resultado sin FX del período',
      valueClp: period.key === 'last_month' ? period.monthlyMetrics?.resultadoSinFx.valueClp ?? null : period.cumulativeMetrics?.resultadoSinFx.valueClp ?? null,
      months: period.key === 'last_month' ? 1 : period.cumulativeMetrics?.resultadoSinFx.months ?? 0,
    },
    {
      key: 'real-periodo',
      label: period.key === 'last_month' ? 'Real mensual' : 'Real del período',
      valueClp: period.key === 'last_month' ? period.monthlyMetrics?.real.valueClp ?? null : period.cumulativeMetrics?.real.valueClp ?? null,
      months: period.key === 'last_month' ? 1 : period.cumulativeMetrics?.real.months ?? 0,
    },
    {
      key: 'aporte-fx-periodo',
      label: period.key === 'last_month' ? 'Aporte FX mensual' : 'Aporte FX del período',
      valueClp: period.key === 'last_month' ? period.monthlyMetrics?.aporteFx.valueClp ?? null : period.cumulativeMetrics?.aporteFx.valueClp ?? null,
      months: period.key === 'last_month' ? 1 : period.cumulativeMetrics?.aporteFx.months ?? 0,
    },
  ].filter((item) => item.valueClp !== null || item.months > 0);

  if (!items.length) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.key} className="border-slate-200 p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{item.label}</div>
          <div className={cn('mt-1 text-lg font-semibold', (item.valueClp || 0) >= 0 ? 'text-slate-900' : 'text-rose-700')}>
            {item.valueClp !== null ? formatFreedomCompactClp(item.valueClp) : '—'}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {item.months > 1 ? `${item.months} meses comparables` : 'Último período comparable'}
          </div>
        </Card>
      ))}
    </div>
  );
};

const LabTabContent: React.FC<{
  model: ReturnType<typeof buildWealthLabModel>;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
}> = ({ model, includeRiskCapitalInTotals, onToggleRiskMode }) => {
  const [selectedWindow, setSelectedWindow] = useState<WealthLabWindow>('since_start');
  const selectedPeriod = useMemo(() => selectWealthLabPeriod(model, selectedWindow), [model, selectedWindow]);
  const fxCoverageNote =
    selectedPeriod.realMonths === 0
      ? null
      : selectedPeriod.fxComparableMonths === 0
        ? 'Este corte todavía no tiene base CLP/USD suficiente para calcular el ajuste sin FX.'
        : selectedPeriod.fxComparableMonths < selectedPeriod.realMonths
          ? `Este corte usa ${selectedPeriod.fxComparableMonths} de ${selectedPeriod.realMonths} meses con base CLP/USD suficiente; el ajuste sin FX aún es parcial.`
          : null;

  return (
    <div className="space-y-3">
      <LabHeaderCard
        periodLabel={selectedPeriod.label}
        monthKey={selectedPeriod.currentPeriodLabel}
        headlineMetrics={selectedPeriod.headlineMetrics}
        includeRiskCapitalInTotals={includeRiskCapitalInTotals}
        onToggleRiskMode={onToggleRiskMode}
        selectedWindow={selectedWindow}
        onSelectWindow={setSelectedWindow}
        fxCoverageNote={fxCoverageNote}
      />

      <Card className="border-slate-200 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retorno sin efecto cambiario</div>
        <div className="mt-2 space-y-1 text-[11px] text-slate-500">
          {model.notes.map((note) => (
            <div key={note}>• {note}</div>
          ))}
        </div>
      </Card>

      <LabIndicesChart points={selectedPeriod.chartPoints} periodLabel={selectedPeriod.label} />
      <LabMetricsGrid period={selectedPeriod} />
    </div>
  );
};

const FreedomStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config =
    status === 'ok'
      ? { label: 'Listo', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
      : status === 'never_depletes'
        ? { label: 'No se agota', className: 'border-sky-200 bg-sky-50 text-sky-700' }
        : status === 'missing_patrimony'
          ? { label: 'Sin patrimonio', className: 'border-amber-200 bg-amber-50 text-amber-700' }
          : { label: 'Revisar', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', config.className)}>
      {config.label}
    </span>
  );
};

const FreedomParametersCard: React.FC<{
  sourceMonthKey: string | null;
  patrimonioBaseClp: number | null;
  draft: FreedomControlDraft;
  onChange: (key: keyof FreedomControlDraft, value: string) => void;
  includeRiskCapitalInTotals: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onToggleRiskMode: () => void;
}> = ({
  sourceMonthKey,
  patrimonioBaseClp,
  draft,
  onChange,
  includeRiskCapitalInTotals,
  isOpen,
  onToggle,
  onToggleRiskMode,
}) => (
  <Card className="border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parámetros</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">Escenario base de Libertad Financiera</div>
          {includeRiskCapitalInTotals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              +CapRiesgo
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {sourceMonthKey ? `Tomado automáticamente desde ${monthLabel(sourceMonthKey)}.` : 'Sin cierre base confirmado todavía.'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleRiskMode}
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-full border transition',
            includeRiskCapitalInTotals
              ? 'border-amber-300 bg-amber-50 text-amber-600'
              : 'border-slate-300 bg-white text-slate-500',
          )}
          title={includeRiskCapitalInTotals ? 'Vista con capital de riesgo' : 'Vista de patrimonio puro'}
          aria-label="Alternar capital de riesgo"
        >
          <Zap size={16} />
        </button>
        <div className="rounded-xl bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
          {sourceMonthKey ? monthLabel(sourceMonthKey) : 'Sin cierre'}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600"
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Ocultar parámetros' : 'Mostrar parámetros'}
        >
          <span>{isOpen ? 'Ocultar' : 'Editar'}</span>
          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', isOpen ? 'rotate-180' : '')} />
        </button>
      </div>
    </div>

    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Patrimonio base</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold text-slate-900">
          {patrimonioBaseClp && patrimonioBaseClp > 0 ? formatCurrency(patrimonioBaseClp, 'CLP') : 'Sin datos de patrimonio'}
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">Dato de escenario, no editable.</div>
    </div>

    {!isOpen && (
      <button
        type="button"
        onClick={onToggle}
        className="mt-3 flex w-full items-center justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left text-[11px] text-slate-600"
      >
        <span>Ajustar tasa, horizonte y gasto mensual</span>
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </button>
    )}

    {isOpen && (
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 md:col-span-2">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Tasa anual supuesta</span>
              <div className="relative">
                <Input
                  value={draft.annualRatePct}
                  onChange={(event) => onChange('annualRatePct', formatDraftPercent(event.target.value))}
                  inputMode="decimal"
                  placeholder="5"
                  className="pr-8"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">%</span>
              </div>
              <span className="text-[11px] text-slate-500">Rango pensado para UI: 1% a 15%. Motor usa tasa mensual compuesta.</span>
            </label>

            <label className="grid gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Horizonte años</span>
              <Input
                value={draft.horizonYears}
                onChange={(event) => onChange('horizonYears', formatDraftInteger(event.target.value))}
                inputMode="numeric"
                placeholder="40"
              />
              <span className="text-[11px] text-slate-500">Referencia para el cálculo de retiro mensual máximo.</span>
            </label>

            <label className="grid gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Gasto mensual</span>
              <div className="relative">
                <Input
                  value={draft.monthlySpendClp}
                  onChange={(event) => onChange('monthlySpendClp', formatDraftMoney(event.target.value))}
                  inputMode="numeric"
                  placeholder="6.000.000"
                  className="pl-7"
                />
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">$</span>
              </div>
              <span className="text-[11px] text-slate-500">Usado para estimar cuántos años duraría el patrimonio.</span>
            </label>
          </div>
        </div>
      </div>
    )}

    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-slate-700">
      <span className="font-medium text-slate-900">Modelo simple determinista:</span>{' '}
      usa una tasa constante y no incorpora volatilidad, crisis, secuencia de retornos ni simulación Monte Carlo.
      Úsalo como referencia rápida, no como proyección exhaustiva.
    </div>
  </Card>
);

const monthKeyToYearLabel = (monthKey: string | null) => {
  if (!monthKey) return '—';
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '—';
  return `${monthLabel(monthKey)} (${year})`;
};

const FreedomDrawdownChart: React.FC<{
  points: { monthKey: string; balanceEndClp: number }[];
}> = ({ points }) => {
  if (points.length < 2) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4 text-[11px] text-slate-500">
        La curva aparecerá cuando haya un cálculo válido.
      </div>
    );
  }

  const width = 640;
  const height = 160;
  const padding = { top: 14, right: 14, bottom: 26, left: 14 };
  const values = points.map((point) => point.balanceEndClp);
  const max = Math.max(...values, 1);
  const min = 0;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
  const y = (value: number) => padding.top + ((max - value) / Math.max(1e-6, max - min)) * innerHeight;
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.balanceEndClp).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${x(0).toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
  const labelIndexes = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const startPoint = points[0];
  const midPoint = points[Math.floor((points.length - 1) / 2)];
  const endPoint = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
        <defs>
          <linearGradient id="freedomArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#freedomArea)" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
        {points.map((point, index) => {
          if (!labelIndexes.includes(index)) return null;
          return (
            <g key={`${point.monthKey}-${index}`}>
              <circle cx={x(index)} cy={y(point.balanceEndClp)} r="3.5" fill="#1d4ed8" />
              <text x={x(index)} y={height - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                {xLabelFromMonthKey(point.monthKey)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-500">
        <div className="rounded-xl bg-white px-2 py-2">
          <div className="uppercase tracking-wide text-slate-400">Inicio</div>
          <div className="mt-0.5 font-semibold text-slate-700">{formatFreedomCompactClp(startPoint.balanceEndClp)}</div>
        </div>
        <div className="rounded-xl bg-white px-2 py-2">
          <div className="uppercase tracking-wide text-slate-400">Mitad</div>
          <div className="mt-0.5 font-semibold text-slate-700">{formatFreedomCompactClp(midPoint.balanceEndClp)}</div>
        </div>
        <div className="rounded-xl bg-white px-2 py-2">
          <div className="uppercase tracking-wide text-slate-400">Final</div>
          <div className="mt-0.5 font-semibold text-slate-700">{formatFreedomCompactClp(endPoint.balanceEndClp)}</div>
        </div>
      </div>
    </div>
  );
};

const FreedomWithdrawalBlock: React.FC<{
  plan: ReturnType<typeof buildMonthlyWithdrawalPlan>;
  includeRiskCapitalInTotals: boolean;
}> = ({ plan, includeRiskCapitalInTotals }) => (
  <Card className="border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">¿Cuánto puedo retirar?</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Consumiendo capital + rendimientos hasta llegar a 0.</span>
          {includeRiskCapitalInTotals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              +CapRiesgo
            </span>
          )}
        </div>
      </div>
      <FreedomStatusBadge status={plan.status} />
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {plan.horizonYears} años
      </span>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {plan.annualRatePct.toFixed(1).replace('.', ',')}% anual
      </span>
    </div>

    <div className="mt-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">Retiro mensual estimado</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
        {plan.monthlyWithdrawalClp !== null ? formatFreedomCompactClp(plan.monthlyWithdrawalClp) : '—'}
      </div>
      <div className="mt-1 text-[12px] text-slate-600">
        {plan.status === 'ok'
          ? `mensual durante ${plan.horizonYears} años con tasa supuesta de ${plan.annualRatePct.toFixed(1).replace('.', ',')}% anual`
          : plan.message || 'Completa parámetros válidos para calcular el retiro mensual.'}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {plan.totalWithdrawnClp !== null
          ? `Total retirado en el período: ${formatFreedomCompactClp(plan.totalWithdrawnClp)}`
          : 'El total retirado aparecerá cuando el cálculo sea válido.'}
      </div>
    </div>

    <div className="mt-4">
      <FreedomDrawdownChart points={plan.curve} />
    </div>
  </Card>
);

const FreedomCoverageBlock: React.FC<{
  plan: ReturnType<typeof buildCoveragePlan>;
  includeRiskCapitalInTotals: boolean;
}> = ({ plan, includeRiskCapitalInTotals }) => (
  <Card className="border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cobertura estimada del patrimonio</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Cuánto duraría bajo el mismo supuesto determinista.</span>
          {includeRiskCapitalInTotals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              +CapRiesgo
            </span>
          )}
        </div>
      </div>
      <FreedomStatusBadge status={plan.status} />
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {plan.annualRatePct.toFixed(1).replace('.', ',')}% anual
      </span>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
        {formatFreedomCompactClp(plan.monthlySpendClp)}/mes
      </span>
    </div>

    <div className="mt-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">Años de cobertura</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
        {plan.status === 'never_depletes'
          ? 'No se agota'
          : plan.yearsCoverage !== null
            ? `${plan.yearsCoverage.toFixed(1).replace('.', ',')} años`
            : '—'}
      </div>
      <div className="mt-1 text-[12px] text-slate-600">
        {plan.status === 'never_depletes'
          ? 'Con este escenario simple, el patrimonio no se agota.'
          : plan.status === 'ok'
            ? `retirando ${formatFreedomCompactClp(plan.monthlySpendClp)} mensual con tasa supuesta de ${plan.annualRatePct.toFixed(1).replace('.', ',')}% anual`
            : plan.message || 'Completa parámetros válidos para estimar la cobertura.'}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {plan.status === 'ok'
          ? `Año calendario aproximado: ${monthKeyToYearLabel(plan.approximateEndMonthKey)}`
          : plan.status === 'never_depletes'
            ? `Sin año de agotamiento estimado desde el cierre base ${monthKeyToYearLabel(plan.sourceMonthKey)}`
            : 'El año calendario aproximado aparecerá cuando el cálculo sea válido.'}
      </div>
    </div>

    <div className="mt-4">
      <FreedomDrawdownChart points={plan.curve} />
    </div>
  </Card>
);

export const AnalysisAurum: React.FC = () => {
  const [tab, setTab] = useState<AnalysisTab>('returns');
  const [currency, setCurrency] = useState<WealthCurrency>('CLP');
  const [includeRiskCapitalInTotals, setIncludeRiskCapitalInTotals] = useState(() =>
    loadIncludeRiskCapitalInTotals(),
  );
  const [closures, setClosures] = useState<WealthMonthlyClosure[]>(() =>
    loadWealthClosures().sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [freedomDraft, setFreedomDraft] = useState<FreedomControlDraft>({
    annualRatePct: '5',
    horizonYears: '40',
    monthlySpendClp: '6000000',
  });
  const closuresCountRef = useRef(closures.length);
  const initialFreedomOpen = useMemo(() => {
    const initialAnnualRatePct = parseNumericDraft('5');
    const initialHorizonYears = parseNumericDraft('40');
    const initialMonthlySpendClp = parseNumericDraft('6000000');
    const hasBase = resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals).status === 'ok';
    return !(hasBase && initialAnnualRatePct && initialHorizonYears && initialMonthlySpendClp);
  }, [closures, includeRiskCapitalInTotals]);
  const [freedomParametersOpen, setFreedomParametersOpen] = useState(initialFreedomOpen);

  const refreshClosures = useCallback((reason: string) => {
    const beforeCount = closuresCountRef.current;
    console.info('[Analysis][closures-before]', { reason, beforeCount });
    const loaded = loadWealthClosures().sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    console.info('[Analysis][closures-after]', {
      reason,
      afterCount: loaded.length,
      newestMonth: loaded.length ? loaded[loaded.length - 1].monthKey : null,
      oldestMonth: loaded.length ? loaded[0].monthKey : null,
    });
    closuresCountRef.current = loaded.length;
    setClosures(loaded);
    setErrorMessage('');
  }, []);

  useEffect(() => {
    refreshClosures('mount');
  }, [refreshClosures]);

  useEffect(() => {
    saveIncludeRiskCapitalInTotals(includeRiskCapitalInTotals);
  }, [includeRiskCapitalInTotals]);

  useEffect(() => {
    const refreshRiskToggle = () => setIncludeRiskCapitalInTotals(loadIncludeRiskCapitalInTotals());
    window.addEventListener('storage', refreshRiskToggle);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      refreshRiskToggle as EventListener,
    );
    return () => {
      window.removeEventListener('storage', refreshRiskToggle);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        refreshRiskToggle as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const onWealthUpdated = () => refreshClosures('wealth-updated');
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      refreshClosures('focus');
    };
    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshClosures]);

  const monthlyRowsAsc = useMemo(
    () => computeMonthlyRows(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );
  const monthlyRowsAscWithoutCrp = useMemo(() => computeMonthlyRows(closures, false), [closures]);
  const monthlyRowsDesc = useMemo(
    () => [...monthlyRowsAsc].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [monthlyRowsAsc],
  );
  const crpContributionInsight = useMemo(() => {
    if (!includeRiskCapitalInTotals) return null;
    return buildCrpContributionInsight(monthlyRowsAsc, monthlyRowsAscWithoutCrp);
  }, [includeRiskCapitalInTotals, monthlyRowsAsc, monthlyRowsAscWithoutCrp]);

  const analysisDiagnostics = useMemo(() => {
    const eurScaleOutliers = monthlyRowsAsc.filter((row) => row.rawEurClp > 10000);
    const invalidNetMonths = monthlyRowsAsc.filter((row) => row.invalidNet).map((row) => row.monthKey);
    const anomalyRaw = [...monthlyRowsAsc]
      .filter((row) => row.pct !== null)
      .sort((a, b) => Math.abs(Number(b.pct)) - Math.abs(Number(a.pct)))[0] || null;
    const march2025 = monthlyRowsAsc.find((row) => row.monthKey === '2025-03') || null;
    return { eurScaleOutliers, invalidNetMonths, anomalyRaw, march2025 };
  }, [monthlyRowsAsc]);

  useEffect(() => {
    const anomaly = analysisDiagnostics.anomalyRaw;
    const march2025 = analysisDiagnostics.march2025;
    console.info('[Analysis][eur-scale-before]', {
      march2025: march2025
        ? {
            rawEurClp: march2025.rawEurClp,
            gastosEur: GASTAPP_TOTALS['2025-03'] ?? null,
            gastosClp: march2025.gastosClp,
            expectedGastosClp:
              Number.isFinite(GASTAPP_TOTALS['2025-03']) && Number.isFinite(march2025.rawEurClp)
                ? Number(GASTAPP_TOTALS['2025-03']) * Number(march2025.rawEurClp)
                : null,
          }
        : null,
      monthsWithRawEurOutlier: analysisDiagnostics.eurScaleOutliers.map((row) => ({
        monthKey: row.monthKey,
        rawEurClp: row.rawEurClp,
      })),
      anomalyMonth: anomaly?.monthKey || null,
      anomalyValues: anomaly
        ? {
            varPatrimonioClp: anomaly.varPatrimonioClp,
            gastosClp: anomaly.gastosClp,
            retornoRealClp: anomaly.retornoRealClp,
            pct: anomaly.pct,
          }
        : null,
    });
    console.info('[Analysis][eur-scale-after]', { normalizationApplied: false });

    if (analysisDiagnostics.invalidNetMonths.length > 0) {
      setErrorMessage(
        `Hay cierres con netClp inválido en: ${analysisDiagnostics.invalidNetMonths.join(', ')}. Se muestran con "—" y no entran en resúmenes.`,
      );
      return;
    }

    if (analysisDiagnostics.eurScaleOutliers.length > 0) {
      setErrorMessage(
        `Detecté EUR/CLP fuera de escala en: ${analysisDiagnostics.eurScaleOutliers
          .map((row) => row.monthKey)
          .join(', ')}. Corrige esos cierres en origen.`,
      );
      return;
    }

    const suspectPost = monthlyRowsAsc.find(
      (row) => row.gastosClp !== null && Math.abs(row.gastosClp) > 100_000_000,
    );
    if (suspectPost) {
      setErrorMessage(
        `Detecté gastos fuera de rango en ${suspectPost.monthKey}. Revisa el EUR/CLP guardado en ese cierre.`,
      );
      return;
    }

    setErrorMessage('');
  }, [analysisDiagnostics, monthlyRowsAsc]);

  const periodSummaries = useMemo(() => {
    const monthKeysAsc = monthlyRowsAsc.map((row) => row.monthKey);
    const toSummary = (count: number, label: string) => {
      const keys = monthKeysAsc.slice(Math.max(0, monthKeysAsc.length - count));
      if (!keys.length) return null;
      const rows = monthlyRowsAsc.filter((row) => keys.includes(row.monthKey));
      const baseNetClp = rows.find((row) => row.netClp !== null)?.netClp ?? null;
      return aggregateRows(`period-${label}`, label, rows, currency, baseNetClp);
    };

    const summaries: AggregatedSummary[] = [];
    const p12 = toSummary(12, '12M');
    if (p12) summaries.push(p12);
    const p24 = toSummary(24, '24M');
    if (p24) summaries.push(p24);
    if (monthKeysAsc.length >= 36) {
      const p36 = toSummary(36, '36M');
      if (p36) summaries.push(p36);
    }
    if (monthKeysAsc.length) {
      const baseNetClp = monthlyRowsAsc.find((row) => row.netClp !== null)?.netClp ?? null;
      summaries.push(aggregateRows('period-inicio', 'Desde inicio', monthlyRowsAsc, currency, baseNetClp));
    }
    return summaries;
  }, [monthlyRowsAsc, currency]);

  const yearlySummaries = useMemo(() => {
    const years = Array.from(new Set(monthlyRowsAsc.map((row) => monthYear(row.monthKey)))).sort((a, b) => a - b);
    return years.map((year) => {
      const rows = monthlyRowsAsc.filter((row) => monthYear(row.monthKey) === year);
      const previousYearBase = monthlyRowsAsc
        .filter((row) => row.monthKey < `${year}-01`)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      const previousYearBaseValid = previousYearBase.filter((row) => row.netClp !== null);
      const baseNetClp = previousYearBaseValid.length
        ? previousYearBaseValid[previousYearBaseValid.length - 1].netClp
        : null;
      return aggregateRows(`year-${year}`, String(year), rows, currency, baseNetClp);
    });
  }, [monthlyRowsAsc, currency]);

  const heroSinceStart = useMemo(() => {
    if (!monthlyRowsAsc.length) return null;
    const baseNetClp = monthlyRowsAsc.find((row) => row.netClp !== null)?.netClp ?? null;
    return aggregateRows('hero-inicio', 'Desde inicio', monthlyRowsAsc, currency, baseNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLast12 = useMemo(() => {
    const rows = monthlyRowsAsc.slice(Math.max(0, monthlyRowsAsc.length - 12));
    if (!rows.length) return null;
    const baseNetClp = rows.find((row) => row.netClp !== null)?.netClp ?? null;
    return aggregateRows('hero-12m', 'Últ. 12M', rows, currency, baseNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLastMonth = useMemo(() => {
    const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealClp !== null) || null;
    if (!row) return null;
    return aggregateRows('hero-ultimo', 'Últ. mes', [row], currency, row.prevNetClp);
  }, [monthlyRowsAsc, currency]);

  const heroLastMonthPctMonthly = useMemo(() => {
    const row = [...monthlyRowsAsc].reverse().find((item) => item.retornoRealClp !== null) || null;
    return row?.pct ?? null;
  }, [monthlyRowsAsc]);
  const wealthLabModel = useMemo(
    () => buildWealthLabModel(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );

  const financialFreedomBase = useMemo(
    () => resolveFinancialFreedomBase(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );
  const freedomAnnualRatePct = useMemo(() => parseNumericDraft(freedomDraft.annualRatePct) ?? NaN, [freedomDraft.annualRatePct]);
  const freedomHorizonYears = useMemo(() => parseNumericDraft(freedomDraft.horizonYears) ?? NaN, [freedomDraft.horizonYears]);
  const freedomMonthlySpendClp = useMemo(() => parseNumericDraft(freedomDraft.monthlySpendClp) ?? NaN, [freedomDraft.monthlySpendClp]);
  const financialFreedomWithdrawalPlan = useMemo(
    () => buildMonthlyWithdrawalPlan(closures, freedomAnnualRatePct, freedomHorizonYears, includeRiskCapitalInTotals),
    [closures, freedomAnnualRatePct, freedomHorizonYears, includeRiskCapitalInTotals],
  );
  const financialFreedomCoveragePlan = useMemo(
    () => buildCoveragePlan(closures, freedomAnnualRatePct, freedomMonthlySpendClp, includeRiskCapitalInTotals),
    [closures, freedomAnnualRatePct, freedomMonthlySpendClp, includeRiskCapitalInTotals],
  );
  const freedomInputsAreValid = Boolean(
    financialFreedomBase.status === 'ok' &&
      Number.isFinite(freedomAnnualRatePct) &&
      freedomAnnualRatePct >= 0 &&
      Number.isFinite(freedomHorizonYears) &&
      freedomHorizonYears > 0 &&
      Number.isFinite(freedomMonthlySpendClp) &&
      freedomMonthlySpendClp > 0,
  );

  useEffect(() => {
    if (!freedomInputsAreValid) {
      setFreedomParametersOpen(true);
    }
  }, [freedomInputsAreValid]);

  return (
    <div className="space-y-3 p-3">
      <Card className="sticky top-[68px] z-20 border-slate-200 bg-white/95 p-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant={tab === 'returns' ? 'primary' : 'secondary'} onClick={() => setTab('returns')}>
            Retornos
          </Button>
          <Button size="sm" variant={tab === 'freedom' ? 'primary' : 'secondary'} onClick={() => setTab('freedom')}>
            Libertad Financiera
          </Button>
          <Button size="sm" variant={tab === 'lab' ? 'primary' : 'secondary'} onClick={() => setTab('lab')}>
            Lab
          </Button>
        </div>
        {tab === 'returns' && <div className="mt-2 flex items-center gap-1">
          {(['CLP', 'USD', 'EUR', 'UF'] as WealthCurrency[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCurrency(item)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
                currency === item
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-600',
              )}
            >
              {item}
            </button>
          ))}
        </div>}
      </Card>

      {tab === 'lab' ? (
        <LabTabContent
          model={wealthLabModel}
          includeRiskCapitalInTotals={includeRiskCapitalInTotals}
          onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
        />
      ) : tab === 'freedom' ? (
        <>
          <FreedomParametersCard
            sourceMonthKey={financialFreedomBase.sourceMonthKey}
            patrimonioBaseClp={financialFreedomBase.patrimonioBaseClp}
            draft={freedomDraft}
            onChange={(key, value) => setFreedomDraft((prev) => ({ ...prev, [key]: value }))}
            includeRiskCapitalInTotals={includeRiskCapitalInTotals}
            isOpen={freedomParametersOpen}
            onToggle={() => setFreedomParametersOpen((prev) => !prev)}
            onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <FreedomWithdrawalBlock
              plan={financialFreedomWithdrawalPlan}
              includeRiskCapitalInTotals={includeRiskCapitalInTotals}
            />
            <FreedomCoverageBlock
              plan={financialFreedomCoveragePlan}
              includeRiskCapitalInTotals={includeRiskCapitalInTotals}
            />
          </div>
        </>
      ) : (
        <>
          <ReturnRealHero
            sinceStart={heroSinceStart}
            last12={heroLast12}
            lastMonth={heroLastMonth}
            lastMonthPctMonthly={heroLastMonthPctMonthly}
            currency={currency}
            includeRiskCapitalInTotals={includeRiskCapitalInTotals}
            onToggleRiskMode={() => setIncludeRiskCapitalInTotals((prev) => !prev)}
            crpContributionInsight={crpContributionInsight}
          />

          {analysisDiagnostics.anomalyRaw && Math.abs(Number(analysisDiagnostics.anomalyRaw.pct || 0)) >= 200 && (
            <Card className="border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Diagnóstico previo: mes anómalo detectado en {analysisDiagnostics.anomalyRaw.monthKey} 
              {` · Var.Pat ${analysisDiagnostics.anomalyRaw.varPatrimonioClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.varPatrimonioClp, 'CLP')}`}
              {` · Gastos ${analysisDiagnostics.anomalyRaw.gastosClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.gastosClp, 'CLP')}`}
              {` · Ret.Real ${analysisDiagnostics.anomalyRaw.retornoRealClp === null ? '—' : formatCurrency(analysisDiagnostics.anomalyRaw.retornoRealClp, 'CLP')}`}
              {` · % ${formatPct(analysisDiagnostics.anomalyRaw.pct)}`}
            </Card>
          )}

          <Card className="border-slate-200 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays size={14} />
              Historial completo
            </div>
            <div className="mt-2 max-h-[55vh] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-2">Mes</th>
                    <th className="py-1 pr-2 text-right">%</th>
                    <th className="py-1 pr-2 text-right">Ret.Real</th>
                    <th className="py-1 pr-2 text-right">Var.Pat</th>
                    <th className="py-1 text-right">Gastos</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRowsDesc.map((row) => {
                    const varDisplay =
                      row.varPatrimonioClp === null ? null : convertFromClp(row.varPatrimonioClp, currency, row.fx);
                    const gastosDisplay =
                      row.gastosClp === null ? null : convertFromClp(row.gastosClp, currency, row.fx);
                    const retornoDisplay =
                      row.retornoRealClp === null ? null : convertFromClp(row.retornoRealClp, currency, row.fx);
                    const positive = (retornoDisplay || 0) >= 0;
                    return (
                      <tr key={row.monthKey} className="border-t border-slate-100">
                        <td className="py-1.5 pr-2 font-medium text-slate-700">{monthLabel(row.monthKey)}</td>
                        <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                          {formatPct(row.pct)}
                        </td>
                        <td className={cn('py-1.5 pr-2 text-right font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
                          {retornoDisplay === null ? '—' : formatCurrency(retornoDisplay, currency)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-700">
                          {varDisplay === null ? '—' : formatCurrency(varDisplay, currency)}
                        </td>
                        <td className="py-1.5 text-right text-slate-700">
                          {gastosDisplay === null ? '—' : formatCurrency(gastosDisplay, currency)}
                        </td>
                      </tr>
                    );
                  })}
                  {!monthlyRowsDesc.length && (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-xs text-slate-500">
                        Aún no hay cierres suficientes para calcular retornos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <SummaryTable title="Resúmenes por período" items={periodSummaries} currency={currency} />
          <SummaryTable title="Resúmenes por año" items={yearlySummaries} currency={currency} />
          <ReturnsChart rows={monthlyRowsAsc} />
        </>
      )}

      {!!errorMessage && (
        <Card className="border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{errorMessage}</Card>
      )}

      <Card className="border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <BarChart3 size={14} />
          Datos en solo lectura: los cálculos de Análisis no modifican cierres ni registros persistidos.
        </div>
      </Card>
    </div>
  );
};
