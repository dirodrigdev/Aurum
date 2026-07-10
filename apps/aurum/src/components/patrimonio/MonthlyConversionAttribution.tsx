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
      {pct(result.reportedChangePct)} reportado · {pct(result.constantConversionChangePct)} sin efecto conversión
    </button>
  );
};

export const MonthlyConversionAttributionModal: React.FC<{
  result: ConversionAttributionResult;
  onClose: () => void;
}> = ({ result, onClose }) => {
  if (result.status !== 'available') return null;
  const rows = [
    ['Variación reportada', result.reportedChangeAmount, result.reportedChangePct],
    ['Variación sin efecto de conversión', result.constantConversionChangeAmount, result.constantConversionChangePct],
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
              Explicación de la variación mensual
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {formatMonthLabel(result.previousMonthKey)} → {formatMonthLabel(result.currentMonthKey)} · {result.reportingCurrency}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

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
          <p>La variación sin efecto de conversión valoriza las posiciones actuales con las tasas del período anterior. El efecto de conversión muestra cuánto de la variación reportada se explica por cambios en USD, EUR o UF.</p>
          <p>Esta explicación no separa rentabilidad, aportes, retiros ni otros cambios de saldo.</p>
        </div>
      </section>
    </div>
  );
};
