import React, { useMemo } from 'react';
import { Card } from '../Components';
import { WealthCurrency, WealthFxRates, WealthNetBreakdownClp, WealthRecord } from '../../services/wealthStorage';
import { labelMatchKey, normalizeForMatch } from '../../utils/wealthLabels';
import { formatCurrency, formatRateDecimal, formatRateInt } from '../../utils/wealthFormat';

type NetBreakdown = WealthNetBreakdownClp;

interface InvestmentDetailRow {
  key: string;
  label: string;
  currentClp: number;
  compareClp: number | null;
  group: 'financieras' | 'previsionales' | 'otros';
  isRiskCapital: boolean;
}

const pct = (curr: number, prev: number | null) => {
  if (prev === null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
};

const isRiskCapitalLabel = (value: string) => /capital( de)? riesgo/.test(labelMatchKey(value));

const INVESTMENT_TAIL_PRIORITY: Record<string, number> = {
  'SURA financiero': 1,
  'SURA previsional': 2,
  PlanVital: 3,
};

const toClp = (amount: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amount;
  if (currency === 'USD') return amount * fx.usdClp;
  if (currency === 'EUR') return amount * fx.eurClp;
  return amount * fx.ufClp;
};

const fromClp = (amountClp: number, currency: WealthCurrency, fx: WealthFxRates) => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return amountClp / Math.max(1, fx.eurClp);
  return amountClp / Math.max(1, fx.ufClp);
};

const investmentBucket = (r: WealthRecord): { label: string; group: 'financieras' | 'previsionales' | 'otros' } | null => {
  const src = r.source.toLowerCase();
  const label = r.label.toLowerCase();
  if (src.includes('btg') || label.includes('btg')) return { label: 'BTG', group: 'financieras' };
  if (src.includes('planvital') || label.includes('planvital')) return { label: 'PlanVital', group: 'previsionales' };
  if (src.includes('wise') || label.includes('wise')) return { label: 'Wise', group: 'financieras' };
  if (src.includes('global66') || label.includes('global66')) return { label: 'Global66', group: 'financieras' };
  if (src.includes('sura') || label.includes('sura')) {
    if (label.includes('previsional')) return { label: 'SURA previsional', group: 'previsionales' };
    return { label: 'SURA financiero', group: 'financieras' };
  }
  return { label: r.label, group: 'otros' };
};

const buildInvestmentDetails = (
  currentRecords: WealthRecord[],
  currentFx: WealthFxRates,
  compareRecords: WealthRecord[] | null,
  compareFx: WealthFxRates | null,
): InvestmentDetailRow[] => {
  const current = new Map<string, { amount: number; group: 'financieras' | 'previsionales' | 'otros' }>();
  const compare = new Map<string, number>();

  currentRecords.forEach((r) => {
    if (r.block !== 'investment') return;
    const bucket = investmentBucket(r);
    if (!bucket) return;
    const prev = current.get(bucket.label);
    current.set(bucket.label, {
      amount: (prev?.amount || 0) + toClp(r.amount, r.currency, currentFx),
      group: bucket.group,
    });
  });

  if (compareRecords && compareFx) {
    compareRecords.forEach((r) => {
      if (r.block !== 'investment') return;
      const bucket = investmentBucket(r);
      if (!bucket) return;
      compare.set(bucket.label, (compare.get(bucket.label) || 0) + toClp(r.amount, r.currency, compareFx));
    });
  }

  const keys = Array.from(new Set([...current.keys(), ...compare.keys()]));
  return keys
    .map((key) => ({
      key,
      label: key,
      currentClp: current.get(key)?.amount || 0,
      compareClp: compare.has(key) ? compare.get(key)! : null,
      group: current.get(key)?.group || 'otros',
      isRiskCapital: isRiskCapitalLabel(key),
    }))
    .sort((a, b) => {
      const groupRank = (row: InvestmentDetailRow) =>
        row.group === 'financieras' ? 0 : row.group === 'previsionales' ? 1 : 2;
      const rankDiff = groupRank(a) - groupRank(b);
      if (rankDiff !== 0) return rankDiff;

      if (a.group === 'otros' && b.group === 'otros') {
        if (a.isRiskCapital !== b.isRiskCapital) return a.isRiskCapital ? 1 : -1;
        if (a.isRiskCapital && b.isRiskCapital) {
          const aUsd = normalizeForMatch(a.label).includes('usd');
          const bUsd = normalizeForMatch(b.label).includes('usd');
          if (aUsd !== bUsd) return aUsd ? 1 : -1;
        }
        return a.label.localeCompare(b.label);
      }

      const aTail = INVESTMENT_TAIL_PRIORITY[a.label];
      const bTail = INVESTMENT_TAIL_PRIORITY[b.label];
      if (aTail && bTail) return aTail - bTail;
      if (aTail) return 1;
      if (bTail) return -1;
      return b.currentClp - a.currentClp;
    });
};

interface BreakdownCardProps {
  title: string;
  subtitle: string;
  breakdown: NetBreakdown;
  currency: WealthCurrency;
  fx: WealthFxRates;
  compareAgainst?: NetBreakdown | null;
  compareFx?: WealthFxRates | null;
  currentRecords: WealthRecord[];
  compareRecords?: WealthRecord[] | null;
  showPartialBadge?: boolean;
  headerAction?: React.ReactNode;
  showClosureRates?: boolean;
  showRiskCapitalBadge?: boolean;
  riskModeOn?: boolean;
}

export const BreakdownCard: React.FC<BreakdownCardProps> = ({
  title,
  subtitle,
  breakdown,
  currency,
  fx,
  compareAgainst,
  compareFx,
  currentRecords,
  compareRecords,
  showPartialBadge,
  headerAction,
  showClosureRates,
  showRiskCapitalBadge = false,
  riskModeOn = false,
}) => {
  const rows = [
    {
      key: 'real_estate',
      label: 'Bienes raíces (neto)',
      valueClp: breakdown.realEstateNetClp,
      prevClp: compareAgainst?.realEstateNetClp ?? null,
    },
    { key: 'bank', label: 'Bancos', valueClp: breakdown.bankClp, prevClp: compareAgainst?.bankClp ?? null },
    {
      key: 'other_debt',
      label: 'Deudas no hipotecarias',
      valueClp: -breakdown.nonMortgageDebtClp,
      prevClp: compareAgainst ? -compareAgainst.nonMortgageDebtClp : null,
    },
    { key: 'investment', label: 'Inversiones', valueClp: breakdown.investmentClp, prevClp: compareAgainst?.investmentClp ?? null },
  ];

  const netDisplay = fromClp(breakdown.netClp, currency, fx);
  const compareNet = compareAgainst && compareFx ? fromClp(compareAgainst.netClp, currency, compareFx) : null;
  const deltaNet = compareNet !== null ? netDisplay - compareNet : null;
  const deltaPct = compareNet && compareNet !== 0 ? (deltaNet! / compareNet) * 100 : null;

  const investmentDetails = useMemo(
    () => {
      const currentForDetail = riskModeOn
        ? currentRecords
        : currentRecords.filter(
            (record) => !(record.block === 'investment' && isRiskCapitalLabel(record.label)),
          );
      const compareForDetail = (compareRecords || null)
        ? (riskModeOn
            ? (compareRecords || null)
            : (compareRecords || []).filter(
                (record) => !(record.block === 'investment' && isRiskCapitalLabel(record.label)),
              ))
        : null;
      return buildInvestmentDetails(currentForDetail, fx, compareForDetail, compareFx || null);
    },
    [
      currentRecords,
      compareRecords,
      riskModeOn,
      fx.usdClp,
      fx.eurClp,
      fx.ufClp,
      compareFx?.usdClp,
      compareFx?.eurClp,
      compareFx?.ufClp,
    ],
  );
  const showRiskBadge = riskModeOn && showRiskCapitalBadge;
  const investmentFinancial = investmentDetails.filter((i) => i.group === 'financieras');
  const investmentPrevisional = investmentDetails.filter((i) => i.group === 'previsionales');
  const investmentOthers = investmentDetails.filter((i) => i.group === 'otros');
  const financialCurrentClp = investmentFinancial.reduce((sum, row) => sum + row.currentClp, 0);
  const financialCompareClp = investmentFinancial.reduce((sum, row) => sum + (row.compareClp ?? 0), 0);
  const financialHasCompare = investmentFinancial.some((row) => row.compareClp !== null);
  const previsionalCurrentClp = investmentPrevisional.reduce((sum, row) => sum + row.currentClp, 0);
  const previsionalCompareClp = investmentPrevisional.reduce((sum, row) => sum + (row.compareClp ?? 0), 0);
  const previsionalHasCompare = investmentPrevisional.some((row) => row.compareClp !== null);
  const othersCurrentClp = investmentOthers.reduce((sum, row) => sum + row.currentClp, 0);
  const othersCompareClp = investmentOthers.reduce((sum, row) => sum + (row.compareClp ?? 0), 0);
  const othersHasCompare = investmentOthers.some((row) => row.compareClp !== null);
  const financialDeltaDisplay =
    fromClp(financialCurrentClp, currency, fx) - fromClp(financialCompareClp, currency, compareFx || fx);
  const financialPctDisplay =
    financialCompareClp !== 0 ? (financialDeltaDisplay / fromClp(financialCompareClp, currency, compareFx || fx)) * 100 : null;
  const previsionalDeltaDisplay =
    fromClp(previsionalCurrentClp, currency, fx) - fromClp(previsionalCompareClp, currency, compareFx || fx);
  const previsionalPctDisplay =
    previsionalCompareClp !== 0
      ? (previsionalDeltaDisplay / fromClp(previsionalCompareClp, currency, compareFx || fx)) * 100
      : null;
  const othersDeltaDisplay =
    fromClp(othersCurrentClp, currency, fx) - fromClp(othersCompareClp, currency, compareFx || fx);
  const othersPctDisplay =
    othersCompareClp !== 0 ? (othersDeltaDisplay / fromClp(othersCompareClp, currency, compareFx || fx)) * 100 : null;

  return (
    <Card className="p-2.5 space-y-2 border-[#d9d8d1]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-500">{subtitle}</div>
        </div>
        {headerAction}
      </div>
      <div className="flex items-center gap-2">
        <div className="text-[28px] leading-none font-bold text-slate-900">{formatCurrency(netDisplay, currency)}</div>
        {showRiskBadge && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            +CapRiesgo
          </span>
        )}
        {showPartialBadge && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            Parcial
          </span>
        )}
      </div>
      {showClosureRates && (
        <div className="text-[10px] text-slate-500">
          USD/CLP {formatRateInt(fx.usdClp)} · EUR/USD {formatRateDecimal(fx.eurClp / Math.max(1, fx.usdClp), 4)} · UF/CLP{' '}
          {formatRateInt(fx.ufClp)}
        </div>
      )}
      {deltaNet !== null && (
        <div className={`text-xs font-semibold ${deltaNet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {deltaNet >= 0 ? '+' : ''}
          {formatCurrency(deltaNet, currency)}
          {deltaPct !== null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)` : ''}
        </div>
      )}

      <div className="space-y-1.5 text-xs">
        {rows.map((row) => {
          const current = fromClp(row.valueClp, currency, fx);
          const prev = row.prevClp !== null && compareFx ? fromClp(row.prevClp, currency, compareFx) : null;
          const delta = prev !== null ? current - prev : null;
          const deltaRowPct = prev !== null ? pct(current, prev) : null;
          return (
            <div key={row.key} className="rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-slate-700">
                  {row.label}
                  {row.key === 'investment' && showRiskBadge && (
                    <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      +CapRiesgo
                    </span>
                  )}
                </span>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900">{formatCurrency(current, currency)}</div>
                  {delta !== null && (
                    <div className={`text-[10px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {delta >= 0 ? '+' : ''}
                      {formatCurrency(delta, currency)}
                      {deltaRowPct !== null ? ` (${deltaRowPct >= 0 ? '+' : ''}${deltaRowPct.toFixed(2)}%)` : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <details className="rounded-xl border border-[#e2dccf] bg-[#f8f5ef]">
        <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-semibold text-slate-700">
          Ver detalle de inversiones
        </summary>
        <div className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="min-w-0 overflow-hidden rounded-lg border border-[#d8c39d] bg-[#f6ead7] px-2.5 py-2">
              <div className="text-[11px] font-semibold text-[#7f5528]">Inversiones financieras</div>
              <div className="mt-1 text-[11px] text-slate-500">Subtotal</div>
              <div className="mt-0.5 max-w-full break-all text-[clamp(0.86rem,1.05vw,1.38rem)] leading-tight font-bold tracking-tight tabular-nums">
                {formatCurrency(fromClp(financialCurrentClp, currency, fx), currency)}
              </div>
              {financialHasCompare && (
                <div className={`mt-1 text-[10px] leading-tight [overflow-wrap:anywhere] ${financialDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {financialDeltaDisplay >= 0 ? '+' : ''}
                  {formatCurrency(financialDeltaDisplay, currency)}
                  {financialPctDisplay !== null
                    ? ` (${financialPctDisplay >= 0 ? '+' : ''}${financialPctDisplay.toFixed(2)}%)`
                    : ''}
                </div>
              )}
            </div>
            <div className="min-w-0 overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
              <div className="text-[11px] font-semibold text-emerald-800">Inversiones previsionales</div>
              <div className="mt-1 text-[11px] text-slate-500">Subtotal</div>
              <div className="mt-0.5 max-w-full break-all text-[clamp(0.86rem,1.05vw,1.38rem)] leading-tight font-bold tracking-tight tabular-nums">
                {formatCurrency(fromClp(previsionalCurrentClp, currency, fx), currency)}
              </div>
              {previsionalHasCompare && (
                <div className={`mt-1 text-[10px] leading-tight [overflow-wrap:anywhere] ${previsionalDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {previsionalDeltaDisplay >= 0 ? '+' : ''}
                  {formatCurrency(previsionalDeltaDisplay, currency)}
                  {previsionalPctDisplay !== null
                    ? ` (${previsionalPctDisplay >= 0 ? '+' : ''}${previsionalPctDisplay.toFixed(2)}%)`
                    : ''}
                </div>
              )}
            </div>
            <div className="min-w-0 overflow-hidden rounded-lg border border-[#e8dfcf] bg-[#fcfaf5] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(15,63,58,0.08)]">
              <div className="text-[11px] font-semibold text-slate-700">
                Otras inversiones
                {showRiskBadge && (
                  <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    +CapRiesgo
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">Subtotal</div>
              <div className="mt-0.5 max-w-full break-all text-[clamp(0.86rem,1.05vw,1.38rem)] leading-tight font-bold tracking-tight tabular-nums">
                {formatCurrency(fromClp(othersCurrentClp, currency, fx), currency)}
              </div>
              {othersHasCompare && (
                <div className={`mt-1 text-[10px] leading-tight [overflow-wrap:anywhere] ${othersDeltaDisplay >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {othersDeltaDisplay >= 0 ? '+' : ''}
                  {formatCurrency(othersDeltaDisplay, currency)}
                  {othersPctDisplay !== null
                    ? ` (${othersPctDisplay >= 0 ? '+' : ''}${othersPctDisplay.toFixed(2)}%)`
                    : ''}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {investmentDetails.map((row) => {
              const current = fromClp(row.currentClp, currency, fx);
              const prev = row.compareClp !== null && compareFx ? fromClp(row.compareClp, currency, compareFx) : null;
              const delta = prev !== null ? current - prev : null;
              const p = prev !== null ? pct(current, prev) : null;
              const rowStyle =
                row.isRiskCapital
                  ? 'border-[#e8dfcf] bg-[#fcfaf5] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(15,63,58,0.08)]'
                  : row.group === 'previsionales'
                    ? 'border-emerald-200 bg-emerald-50/30'
                    : row.group === 'financieras'
                      ? 'border-[#d8c39d] bg-[#f8efe2]'
                      : 'border-[#e8dfcf] bg-[#fcfaf5] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(15,63,58,0.08)]';
              const rowLeft =
                row.isRiskCapital
                  ? 'border-l-4 border-l-[#e5dccb]'
                  : row.group === 'previsionales'
                    ? 'border-l-4 border-l-emerald-300'
                    : row.group === 'financieras'
                      ? 'border-l-4 border-l-[#caa16d]'
                      : 'border-l-4 border-l-[#e5dccb]';
              return (
                <div
                  key={row.key}
                  className={`rounded-lg border px-2.5 py-1.5 ${rowStyle} ${rowLeft} ${
                    row.isRiskCapital && !riskModeOn ? 'opacity-35' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-slate-700">{row.label}</span>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-900">{formatCurrency(current, currency)}</div>
                      {delta !== null && (
                        <div className={`text-[10px] ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {delta >= 0 ? '+' : ''}
                          {formatCurrency(delta, currency)}
                          {p !== null ? ` (${p >= 0 ? '+' : ''}${p.toFixed(2)}%)` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!investmentDetails.length && <div className="text-[11px] text-slate-500">Sin detalle de inversiones aún.</div>}
          </div>
        </div>
      </details>
    </Card>
  );
};
