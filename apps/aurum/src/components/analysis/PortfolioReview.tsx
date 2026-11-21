import React, { useMemo, useState } from 'react';
import { Card, cn } from '../Components';
import {
  buildAnnualComparisonPeriod,
  buildWealthAvailability,
  buildWealthChangeBridge,
  reviewMonthOffset,
} from '../../services/portfolioReview';
import type { WealthCurrency, WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatMonthLabel } from '../../utils/wealthFormat';
import { formatCompactCurrency, formatPct } from './shared';
import type { MonthlyReturnRow } from './types';

type Props = {
  closures: WealthMonthlyClosure[];
  rows: MonthlyReturnRow[];
  currency: WealthCurrency;
  includeRisk: boolean;
};

const shortMonth = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });
const money = (value: number | null, currency: WealthCurrency) => value === null ? '—' : formatCompactCurrency(value, currency);
const signedMoney = (value: number | null, currency: WealthCurrency) => `${value !== null && value > 0 ? '+' : ''}${money(value, currency)}`;
const delta = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const numberLabel = (value: number, digits = 1) => value.toLocaleString('es-CL', { maximumFractionDigits: digits });
const percentChange = (a: number | null, b: number | null) => a === null || b === null || b <= 0 ? null : (a / b - 1) * 100;
const points = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${numberLabel(value)} pp`;

const AnnualComparison: React.FC<{
  recent: ReturnType<typeof buildAnnualComparisonPeriod>;
  prior: ReturnType<typeof buildAnnualComparisonPeriod>;
  currency: WealthCurrency;
}> = ({ recent, prior, currency }) => {
  const metrics = [
    {
      label: 'Retorno económico',
      values: [signedMoney(recent.economicReturn, currency), signedMoney(prior.economicReturn, currency), signedMoney(delta(recent.economicReturn, prior.economicReturn), currency)],
      notes: [formatPct(recent.economicReturnPct, 1), formatPct(prior.economicReturnPct, 1), points(delta(recent.economicReturnPct, prior.economicReturnPct))],
    },
    {
      label: 'Gastado',
      values: [money(recent.spend, currency), money(prior.spend, currency), signedMoney(delta(recent.spend, prior.spend), currency)],
      notes: [null, null, formatPct(percentChange(recent.spend, prior.spend), 1)],
    },
    {
      label: 'Variación patrimonial',
      values: [signedMoney(recent.wealthChange, currency), signedMoney(prior.wealthChange, currency), signedMoney(delta(recent.wealthChange, prior.wealthChange), currency)],
      notes: [formatPct(recent.wealthChangePct, 1), formatPct(prior.wealthChangePct, 1), points(delta(recent.wealthChangePct, prior.wealthChangePct))],
    },
  ];

  return (
    <Card className="border-slate-200 p-3 sm:p-4">
      <h2 className="text-base font-semibold text-slate-900">Últimos 12 meses frente a los 12 anteriores</h2>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
            <h3 className="text-sm font-semibold text-slate-800">{metric.label}</h3>
            <dl className="mt-2 grid grid-cols-3 gap-1.5">
              {['Últimos 12M', '12M anteriores', 'Diferencia'].map((label, index) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[10px] font-medium text-slate-500">{label}</dt>
                  <dd className="mt-0.5 break-words text-xs font-semibold tabular-nums text-slate-900">{metric.values[index]}</dd>
                  {metric.notes[index] && metric.notes[index] !== '—' && <dd className="text-[11px] tabular-nums text-slate-600">{metric.notes[index]}</dd>}
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {([{ period: recent, label: 'Últimos 12M' }, { period: prior, label: '12M anteriores' }]).map(({ period, label }) => (
          <span key={period.startMonth}>{label} · {shortMonth(period.startMonth)} a {shortMonth(period.endMonth)} · GastApp {period.spendMonths}/12</span>
        ))}
      </div>
      {(recent.economicReturn === null || prior.economicReturn === null) && (
        <p className="mt-1 text-xs text-slate-500">El retorno necesita doce gastos confirmados y cierres comparables, incluido el saldo inicial.</p>
      )}
    </Card>
  );
};

const Waterfall: React.FC<{
  bridge: NonNullable<ReturnType<typeof buildWealthChangeBridge>>;
  currency: WealthCurrency;
}> = ({ bridge, currency }) => {
  let running = 0;
  const bars = bridge.steps.map(({ label, value }) => {
    const from = running;
    running += value;
    return { label, value, from, to: running };
  });
  bars.push({ label: 'Variación neta', value: bridge.total, from: 0, to: bridge.total });
  const lo = Math.min(0, ...bars.map(({ to }) => to));
  const hi = Math.max(0, ...bars.map(({ to }) => to));
  const position = (value: number) => hi === lo ? 50 : 2 + 96 * (value - lo) / (hi - lo);

  return (
    <dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50 px-2.5 sm:px-3">
      {bars.map(({ label, value, from, to }, index) => {
        const isTotal = index === bars.length - 1;
        return (
          <div key={label} className="grid min-h-9 grid-cols-[minmax(5.25rem,1fr)_minmax(2.5rem,3fr)_6rem] items-center gap-2">
            <dt className={cn('text-xs text-slate-700', isTotal && 'font-semibold text-slate-900')}>{label}</dt>
            <dd className="relative h-full" aria-hidden="true">
              <span className="absolute inset-y-0 w-px bg-slate-300" style={{ left: `${position(0)}%` }} />
              {!isTotal && index < bars.length - 2 && (
                <span className="absolute top-1/2 z-10 h-full border-l border-dashed border-slate-400" style={{ left: `${position(to)}%` }} />
              )}
              <span
                className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-sm',
                  isTotal ? 'bg-slate-800' : value > 0 ? 'bg-teal-600' : value < 0 ? 'bg-rose-500' : 'bg-slate-400')}
                style={{ left: `${position(Math.min(from, to))}%`, width: `${Math.abs(position(to) - position(from))}%`, minWidth: 1 }}
              />
            </dd>
            <dd className="break-words text-right text-xs font-semibold tabular-nums text-slate-800">{signedMoney(value, currency)}</dd>
          </div>
        );
      })}
    </dl>
  );
};

const WealthAvailability: React.FC<{
  month: string;
  currency: WealthCurrency;
  availability: ReturnType<typeof buildWealthAvailability>;
  monthlySpendEur: number | null;
}> = ({ month, currency, availability, monthlySpendEur }) => (
  <Card className="border-slate-200 p-3 sm:p-4">
    <h2 className="text-base font-semibold text-slate-900">Patrimonio disponible frente a patrimonio total</h2>
    <p className="mt-0.5 text-xs text-slate-600">Cierre de {formatMonthLabel(month)}</p>
    {availability ? (
      <>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            { label: 'Disponible después de otras deudas', value: money(availability.immediate, currency) },
            { label: 'Patrimonio neto', value: money(availability.net, currency) },
            { label: 'Cobertura solo con disponible', value: availability.monthsFromCash === null ? '—' : `${numberLabel(availability.monthsFromCash)} meses` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-slate-50 p-2.5">
              <div className="text-xs text-slate-600">{label}</div>
              <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{value}</div>
            </div>
          ))}
        </div>
        <dl className="mt-2 divide-y divide-slate-100">
          {availability.breakdown.map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-2 py-1.5 text-xs">
              <dt className="text-slate-600">{label}</dt>
              <dd className="text-right font-semibold tabular-nums text-slate-900">{money(value, currency)}</dd>
            </div>
          ))}
        </dl>
        {availability.monthsFromCash !== null && monthlySpendEur !== null ? (
          <p className="mt-2 text-xs text-slate-500">
            {availability.monthsWithRescues !== null && `${numberLabel(availability.monthsWithRescues)} meses si se rescatan las inversiones financieras identificadas, antes de impuestos y costos. `}
            Gasto medio de GastApp: {money(monthlySpendEur, 'EUR')} al mes en los últimos 12M. Cobertura sin asumir rentabilidad futura.
          </p>
        ) : <p className="mt-2 text-xs text-slate-500">Para calcular la cobertura hace falta un promedio de gasto positivo con los 12 meses confirmados en GastApp.</p>}
      </>
    ) : <p className="mt-2 text-xs text-slate-500">Se necesita el detalle de saldos y tipos de cambio del último cierre.</p>}
  </Card>
);

export const PortfolioReview: React.FC<Props> = ({ closures, rows, currency, includeRisk }) => {
  const [months, setMonths] = useState<1 | 12>(1);
  const confirmed = useMemo(() => [...closures].filter((item) => !item.analysisProvisionalReason)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey)), [closures]);
  const latest = confirmed.at(-1);
  const startMonth = latest ? reviewMonthOffset(latest.monthKey, -months) : null;
  const initial = confirmed.find((item) => item.monthKey === startMonth);
  const analysis = useMemo(() => {
    if (!latest) return null;
    const keys = new Set(confirmed.map((item) => item.monthKey));
    const closedRows = rows.filter((row) => keys.has(row.monthKey));
    const recent = buildAnnualComparisonPeriod(closedRows, latest.monthKey);
    const prior = buildAnnualComparisonPeriod(closedRows, reviewMonthOffset(latest.monthKey, -12));
    return { recent, prior, availability: buildWealthAvailability(latest, currency, includeRisk, recent.monthlySpendEur) };
  }, [confirmed, latest, rows, currency, includeRisk]);
  const bridge = useMemo(() => initial && latest ? buildWealthChangeBridge(initial, latest, currency, includeRisk) : null,
    [initial, latest, currency, includeRisk]);

  if (!latest || !analysis) return null;
  return (
    <>
      <AnnualComparison recent={analysis.recent} prior={analysis.prior} currency={currency} />
      <Card className="border-slate-200 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Qué movió el patrimonio</h2>
            <p className="mt-0.5 text-xs text-slate-600">{startMonth ? shortMonth(startMonth) : ''} a {shortMonth(latest.monthKey)} · {currency}</p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Período de la variación patrimonial">
            {([1, 12] as const).map((period) => (
              <button type="button" key={period} aria-pressed={months === period} onClick={() => setMonths(period)}
                className={cn('min-h-9 rounded-lg border px-2.5 text-xs font-semibold',
                  months === period ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                {period === 1 ? 'Último mes' : '12 meses'}
              </button>
            ))}
          </div>
        </div>
        {bridge ? (
          <>
            <Waterfall bridge={bridge} currency={currency} />
            <p className="mt-2 text-xs text-slate-500">
              Patrimonio inicial {money(bridge.initialWealth, currency)} · Final {money(bridge.finalWealth, currency)}.
              {' '}{bridge.hasFxBreakdown ? 'Bloques a tipos de cambio iniciales.' : 'Los bloques incluyen el efecto cambiario por falta de detalle en moneda de origen.'}
              {' '}Los cambios de saldo pueden incluir aportes, retiros y transferencias.
            </p>
          </>
        ) : <p className="mt-2 text-xs text-slate-500">Se necesitan cierres comparables con desglose de saldos en ambos extremos del período.</p>}
      </Card>
      <WealthAvailability month={latest.monthKey} currency={currency} availability={analysis.availability} monthlySpendEur={analysis.recent.monthlySpendEur} />
    </>
  );
};
