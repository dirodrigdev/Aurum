import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, GitCompareArrows } from 'lucide-react';

import { Card, cn } from '../Components';
import type { WealthCurrency, WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatCurrency, formatMonthLabel } from '../../utils/wealthFormat';
import {
  buildGastappMonthlyValidation,
  calculateAnnualizedReturn,
  loadGastappMonthlyCalendarValidation,
  type GastappMonthlyValidationRow,
} from '../../services/gastappMonthlyCalendarValidation';

const formatPct = (value: number | null, digits = 2) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;

const returnTone = (value: number | null) => value === null ? 'text-slate-400' : value >= 0 ? 'text-emerald-300' : 'text-rose-300';
const deltaTone = (value: number | null) => value === null ? 'text-slate-400' : value >= 0 ? 'text-sky-300' : 'text-amber-200';

type Summary = {
  months: number;
  old: number | null;
  calendar: number | null;
  usable: number;
};

const SummaryTile: React.FC<{ summary: Summary }> = ({ summary }) => {
  const delta = summary.old === null || summary.calendar === null ? null : summary.calendar - summary.old;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Últimos {summary.months}M</div>
          <div className="mt-0.5 text-[10px] text-slate-500">Retorno anualizado compuesto</div>
        </div>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[9px] font-medium text-amber-100">
          {summary.usable}/{summary.months} meses
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-amber-300/[0.07] px-2.5 py-1.5">
          <div className="text-[9px] font-medium uppercase tracking-wide text-amber-100/60">12–11 actual</div>
          <div className={cn('mt-0.5 text-lg font-semibold tracking-tight', returnTone(summary.old))}>{formatPct(summary.old, 1)}</div>
        </div>
        <div className="rounded-xl bg-sky-300/[0.07] px-2.5 py-1.5 text-right">
          <div className="text-[9px] font-medium uppercase tracking-wide text-sky-100/60">Calendario</div>
          <div className={cn('mt-0.5 text-lg font-semibold tracking-tight', returnTone(summary.calendar))}>{formatPct(summary.calendar, 1)}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className="text-slate-500">Cambio calendario vs. actual</span>
        <span className={cn('font-semibold', deltaTone(delta))}>{formatPct(delta, 2)}</span>
      </div>
    </div>
  );
};

export const GastappMonthlyValidationTab: React.FC<{
  closures: WealthMonthlyClosure[];
  currency: WealthCurrency;
  includeRiskCapital: boolean;
}> = ({ closures, currency, includeRiskCapital }) => {
  const [source, setSource] = useState<Awaited<ReturnType<typeof loadGastappMonthlyCalendarValidation>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGastappMonthlyCalendarValidation().then((result) => {
      if (!cancelled) setSource(result);
    });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => source?.oldContracts && source.calendarContracts
    ? buildGastappMonthlyValidation({ closures, oldContracts: source.oldContracts, calendarContracts: source.calendarContracts, currency, includeRiskCapital })
    : [], [closures, currency, includeRiskCapital, source]);
  const summaries: Summary[] = [12, 24, 36].map((months) => {
    const window = rows.slice(-months);
    return {
      months,
      old: calculateAnnualizedReturn(window, 'old'),
      calendar: calculateAnnualizedReturn(window, 'calendar'),
      usable: window.length,
    };
  });
  const latest = rows.at(-1) || null;

  if (!source) return <Card className="p-4 text-sm text-slate-600">Cargando comparación mensual de GastApp…</Card>;
  if (source.status !== 'ok') return <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No se pudo cargar la comparación: {source.error || source.status}.</Card>;

  return <div className="space-y-4">
    <Card className="relative overflow-hidden border-slate-200 bg-gradient-to-br from-[#211304] via-[#3a2309] to-[#102a48] p-3.5 text-slate-100 shadow-[0_16px_40px_rgba(37,20,4,0.24)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(251,191,36,0.17),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(56,189,248,0.14),_transparent_40%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-100"><GitCompareArrows size={14} /> Validación de retorno</div>
            <div className="mt-1 text-[11px] text-slate-300">Mismo patrimonio cerrado; dos formas de asignar el gasto de GastApp.</div>
            <div className="mt-1 text-[9px] text-slate-400">Control temporal antes de cambiar la lectura oficial de Retornos.</div>
          </div>
          <div className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-medium text-amber-100">No oficial</div>
        </div>
        <div className="relative mt-3 grid gap-2 lg:grid-cols-3">
          {summaries.map((summary) => <SummaryTile key={summary.months} summary={summary} />)}
        </div>
      </div>
    </Card>

    <Card className="border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CalendarDays size={14} /> Retornos por mes</div>
          <div className="mt-0.5 text-[11px] text-slate-500">El patrimonio no cambia; cambia solo el mes al que se atribuye el gasto.</div>
        </div>
        {latest ? <div className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">Último mes: {formatMonthLabel(latest.monthKey)}</div> : null}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[890px] table-fixed text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="w-[130px] py-1 pr-2">Mes</th>
              <th className="py-1 pr-2 text-right text-amber-700">% 12–11</th>
              <th className="py-1 pr-2 text-right text-sky-700">% calendario</th>
              <th className="py-1 pr-2 text-right">Cambio</th>
              <th className="py-1 pr-2 text-right">Ret. Econ. calendario</th>
              <th className="py-1 text-right">Δ gasto EUR</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((row: GastappMonthlyValidationRow) => {
              const pctDelta = row.calendarPct - row.oldPct;
              return <tr key={row.monthKey} className="border-t border-slate-100">
                <td className="py-2 pr-2 font-medium text-slate-700">{formatMonthLabel(row.monthKey)}</td>
                <td className="py-2 pr-2 text-right font-semibold text-amber-700">{formatPct(row.oldPct)}</td>
                <td className="py-2 pr-2 text-right font-semibold text-sky-700">{formatPct(row.calendarPct)}</td>
                <td className={cn('py-2 pr-2 text-right font-semibold', pctDelta >= 0 ? 'text-sky-700' : 'text-amber-700')}>{formatPct(pctDelta)}</td>
                <td className={cn('py-2 pr-2 text-right', row.calendarReturnDisplay >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatCurrency(row.calendarReturnDisplay, currency)}</td>
                <td className="py-2 text-right text-slate-700">{formatCurrency(row.calendarSpendEur - row.oldSpendEur, 'EUR')}</td>
              </tr>;
            })}
            {!rows.length ? <tr><td colSpan={6} className="py-6 text-center text-slate-500">No hay meses comparables todavía.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  </div>;
};
