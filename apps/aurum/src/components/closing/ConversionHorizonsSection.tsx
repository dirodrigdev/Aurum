import React, { useState } from 'react';
import { MonthlyConversionAttributionModal } from '../patrimonio/MonthlyConversionAttribution';
import type { AvailableConversionHorizon } from '../../services/conversionHorizons';

const percent = (value: number) =>
  `${value > 0 ? '+' : ''}${new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value * 100)}%`;

const percentagePoints = (value: number) =>
  `${value > 0 ? '+' : ''}${new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value * 100)} pp`;

const shortMonth = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  const label = new Date(year, month - 1, 1, 12).toLocaleDateString('es-CL', {
    month: 'short',
    year: 'numeric',
  });
  const withoutDot = label.replace('.', '');
  return withoutDot.charAt(0).toUpperCase() + withoutDot.slice(1);
};

const periodLabel = (horizon: AvailableConversionHorizon) => {
  const period = `${shortMonth(horizon.initialMonthKey)} → ${shortMonth(horizon.finalMonthKey)}`;
  if (horizon.key !== 'SINCE_COMPLETE') return period;
  return `${period} · ${horizon.elapsedMonths} ${horizon.elapsedMonths === 1 ? 'mes' : 'meses'}`;
};

export const ConversionHorizonsSection: React.FC<{
  horizons: AvailableConversionHorizon[];
}> = ({ horizons }) => {
  const [selected, setSelected] = useState<AvailableConversionHorizon | null>(null);
  if (!horizons.length) return null;

  return (
    <section data-testid="conversion-horizons-section" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
          Variación patrimonial y efecto de conversión
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Comparación del cierre final frente al cierre inicial de cada período.
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {horizons.map((horizon) => (
          <button
            key={horizon.key}
            type="button"
            onClick={() => setSelected(horizon)}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-[#9c6b36]/50 hover:bg-[#faf7f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9c6b36]/40"
            data-testid={`conversion-horizon-${horizon.key}`}
          >
            <div className="text-[10px] font-semibold tracking-[0.16em] text-slate-600">{horizon.label}</div>
            <div className="mt-1 text-[11px] text-slate-500">{periodLabel(horizon)}</div>
            <div className="mt-3 space-y-1">
              <div className="text-lg font-bold tabular-nums text-slate-900">
                {percent(horizon.result.reportedChangePct)} <span className="text-[11px] font-medium text-slate-500">reportado</span>
              </div>
              <div className="text-sm font-semibold tabular-nums text-emerald-700">
                {percent(horizon.result.constantConversionChangePct)} <span className="text-[11px] font-medium text-slate-500">a conversiones constantes</span>
              </div>
              <div className="text-xs font-medium tabular-nums text-slate-600">
                {percentagePoints(horizon.result.conversionEffectPctPoints)} efecto de conversión
              </div>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <MonthlyConversionAttributionModal
          result={selected.result}
          context={{ title: selected.label, elapsedMonths: selected.elapsedMonths }}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
};
