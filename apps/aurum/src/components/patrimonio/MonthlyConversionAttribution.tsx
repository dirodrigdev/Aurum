import React from 'react';
import { X } from 'lucide-react';
import type { ConversionAttributionResult } from '../../services/monthlyConversionAttribution';
import { formatCurrency, formatMonthLabel } from '../../utils/wealthFormat';

const pct = (value: number) =>
  `${value >= 0 ? '+' : ''}${new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value * 100)}%`;

const percentagePoints = (value: number) =>
  `${value >= 0 ? '+' : ''}${new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value * 100)} pp`;

const rate = (value: number) =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);

export const MonthlyConversionAttributionLine: React.FC<{
  result: ConversionAttributionResult;
  onOpen: () => void;
}> = ({ result, onOpen }) => {
  if (result.status !== 'available') return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 block w-full text-left text-xs text-[#e7dcc9] underline decoration-[#e7dcc9]/35 underline-offset-4 hover:text-white"
      data-testid="monthly-conversion-attribution-line"
    >
      {pct(result.reportedChangePct)} reportado · {pct(result.constantConversionChangePct)} a conversiones constantes
    </button>
  );
};

export const MonthlyConversionAttributionModal: React.FC<{
  result: ConversionAttributionResult;
  onClose: () => void;
  context?: {
    title: string;
    elapsedMonths: number;
  };
}> = ({ result, onClose, context }) => {
  if (result.status !== 'available') return null;
  const rows = [
    ['Variación reportada', result.reportedChangeAmount, result.reportedChangePct],
    ['Variación a conversiones constantes', result.constantConversionChangeAmount, result.constantConversionChangePct],
    ['Efecto de conversión', result.conversionEffectAmount, result.conversionEffectPctPoints],
  ] as const;
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversion-attribution-title"
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="conversion-attribution-title" className="text-lg font-semibold text-slate-950">
              {context?.title || 'Explicación de la variación mensual'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {formatMonthLabel(result.previousMonthKey)} → {formatMonthLabel(result.currentMonthKey)}
              {context ? ` · ${context.elapsedMonths} ${context.elapsedMonths === 1 ? 'mes' : 'meses'}` : ''}
              {' · '}{result.reportingCurrency}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {context && (
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {[
              ['Patrimonio inicial', result.previousReportedValue],
              ['Final reportado', result.currentReportedValue],
              ['Final con tasas iniciales', result.currentValueAtPreviousRates],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-medium text-slate-500">{label}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatCurrency(value as number, result.reportingCurrency)}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 space-y-2">
          {rows.map(([label, amount, percentage], index) => (
            <div key={label} className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-medium text-slate-600">{label}</div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="font-semibold text-slate-950">{formatCurrency(amount, result.reportingCurrency)}</span>
                <span className="text-sm font-semibold text-slate-700">
                  {index === 2 ? percentagePoints(percentage) : pct(percentage)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {result.ratesUsed.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-900">Tasas consideradas</h3>
            <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
              {result.ratesUsed.map((item) => (
                <div key={item.pair} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="font-medium text-slate-700">{item.pair}</span>
                  <span className="tabular-nums text-slate-600">{rate(item.previous)} → {rate(item.current)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2 text-xs leading-relaxed text-slate-600">
          <p>
            {context
              ? 'La variación a conversiones constantes valoriza las posiciones del cierre final con las tasas del cierre inicial. El efecto de conversión muestra cuánto de la variación reportada se explica por cambios en las tasas consideradas.'
              : 'La variación a conversiones constantes valoriza las posiciones actuales con las tasas del período anterior. El efecto de conversión muestra cuánto de la variación reportada se explica por cambios en las tasas consideradas.'}
          </p>
          <p>Esta explicación no separa rentabilidad, aportes, retiros ni otros cambios de saldo.</p>
        </div>
      </section>
    </div>
  );
};
