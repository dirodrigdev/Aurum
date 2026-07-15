import React, { useEffect, useMemo, useState } from 'react';

import { Card } from '../Components';
import type { WealthCurrency, WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatCurrency } from '../../utils/wealthFormat';
import {
  buildGastappMonthlyValidation,
  calculateAnnualizedReturn,
  loadGastappMonthlyCalendarValidation,
  type GastappMonthlyValidationRow,
} from '../../services/gastappMonthlyCalendarValidation';

const formatPct = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

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
  const summaries = [12, 24, 36].map((months) => {
    const window = rows.slice(-months);
    return { months, old: calculateAnnualizedReturn(window, 'old'), calendar: calculateAnnualizedReturn(window, 'calendar'), usable: window.length };
  });

  if (!source) return <Card className="p-4 text-sm text-slate-600">Cargando comparación mensual de GastApp…</Card>;
  if (source.status !== 'ok') return <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No se pudo cargar la comparación: {source.error || source.status}.</Card>;

  return <div className="space-y-4">
    <Card className="border-sky-200 bg-sky-50/70 p-4">
      <div className="text-sm font-semibold text-sky-950">Validación mensual GastApp</div>
      <p className="mt-1 text-xs text-sky-900">Vista temporal: compara el contrato 12–11 actual con el gasto por mes calendario. Retornos oficiales no se modifican aquí.</p>
    </Card>
    <div className="grid gap-3 md:grid-cols-3">
      {summaries.map((summary) => <Card key={summary.months} className="p-3">
        <div className="text-xs font-semibold text-slate-500">Últimos {summary.months}M</div>
        <div className="mt-2 text-sm text-slate-700">Antes: <strong>{formatPct(summary.old)}</strong></div>
        <div className="text-sm text-slate-700">Calendario: <strong>{formatPct(summary.calendar)}</strong></div>
        <div className="mt-1 text-[11px] text-slate-500">{summary.usable}/{summary.months} meses comparables</div>
      </Card>)}
    </div>
    <Card className="p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle por mes</div>
      <div className="mt-2 max-h-[60vh] overflow-auto"><table className="w-full min-w-[720px] text-xs"><thead className="sticky top-0 bg-white text-left text-slate-500"><tr><th className="py-1 pr-2">Mes</th><th className="py-1 pr-2 text-right">% antes</th><th className="py-1 pr-2 text-right">% calendario</th><th className="py-1 pr-2 text-right">Cambio</th><th className="py-1 text-right">Δ gasto EUR</th></tr></thead><tbody>{[...rows].reverse().map((row: GastappMonthlyValidationRow) => <tr key={row.monthKey} className="border-t border-slate-100"><td className="py-1.5 pr-2 font-medium">{row.monthKey}</td><td className="py-1.5 pr-2 text-right">{formatPct(row.oldPct)}</td><td className="py-1.5 pr-2 text-right">{formatPct(row.calendarPct)}</td><td className="py-1.5 pr-2 text-right">{formatPct(row.calendarPct - row.oldPct)}</td><td className="py-1.5 text-right">{formatCurrency(row.calendarSpendEur - row.oldSpendEur, 'EUR')}</td></tr>)}</tbody></table></div>
    </Card>
  </div>;
};
