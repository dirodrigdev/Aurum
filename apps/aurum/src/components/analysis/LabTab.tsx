import React, { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import { type WealthLabWindow, buildWealthLabModel, selectWealthLabPeriod } from '../../services/wealthLab';
import { formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import { formatFreedomCompactClp } from './shared';

const LAB_WINDOW_OPTIONS: Array<{ key: WealthLabWindow; label: string }> = [
  { key: 'since_start', label: 'Desde inicio' },
  { key: 'last_12m', label: 'Últ. 12M' },
  { key: 'last_month', label: 'Últ. mes' },
];

type LabTabProps = {
  model: ReturnType<typeof buildWealthLabModel>;
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
};

const LabCompositionBar: React.FC<{
  totalClp: number;
  resultadoSinFxClp: number;
  efectoFxClp: number;
}> = ({ totalClp, resultadoSinFxClp, efectoFxClp }) => {
  const scale = Math.max(Math.abs(totalClp), Math.abs(resultadoSinFxClp), Math.abs(efectoFxClp), 1);
  const toPct = (value: number) => 50 + (value / scale) * 45;
  const zero = toPct(0);
  const sinFxEnd = toPct(resultadoSinFxClp);
  const totalEnd = toPct(totalClp);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Composición del período</div>
      <div className="mt-1 text-[11px] text-slate-300/80">Resultado del período = Resultado sin FX + Efecto FX</div>
      <div className="relative mt-3 h-8 rounded-full bg-white/5">
        <div className="absolute inset-y-1/2 left-1/2 w-px -translate-y-1/2 bg-white/15" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-emerald-400/90"
          style={{
            left: `${Math.min(zero, sinFxEnd)}%`,
            width: `${Math.max(0, Math.abs(sinFxEnd - zero))}%`,
          }}
        />
        <div
          className={cn(
            'absolute top-1/2 h-3 -translate-y-1/2 rounded-full',
            efectoFxClp >= 0 ? 'bg-sky-400/90' : 'bg-rose-400/90',
          )}
          style={{
            left: `${Math.min(sinFxEnd, totalEnd)}%`,
            width: `${Math.max(0, Math.abs(totalEnd - sinFxEnd))}%`,
          }}
        />
        <div
          className={cn(
            'absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full border',
            totalClp >= 0 ? 'border-white/80 bg-white' : 'border-rose-200 bg-rose-300',
          )}
          style={{ left: `${totalEnd}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-slate-300 sm:grid-cols-3">
        <div>
          <div className="text-slate-400">Resultado sin FX</div>
          <div className="font-medium text-emerald-300">{formatFreedomCompactClp(resultadoSinFxClp)}</div>
        </div>
        <div>
          <div className="text-slate-400">Efecto FX</div>
          <div className={cn('font-medium', efectoFxClp >= 0 ? 'text-sky-300' : 'text-rose-300')}>
            {formatFreedomCompactClp(efectoFxClp)}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Resultado del período</div>
          <div className={cn('font-medium', totalClp >= 0 ? 'text-white' : 'text-rose-300')}>
            {formatFreedomCompactClp(totalClp)}
          </div>
        </div>
      </div>
    </div>
  );
};

export const LabTab: React.FC<LabTabProps> = ({ model, includeRiskCapitalInTotals, onToggleRiskMode }) => {
  const [selectedWindow, setSelectedWindow] = useState<WealthLabWindow>('since_start');
  const selectedPeriod = useMemo(() => selectWealthLabPeriod(model, selectedWindow), [model, selectedWindow]);
  const totalValue = selectedPeriod.headlineMetrics?.real.totalClp ?? null;
  const sinFxValue = selectedPeriod.headlineMetrics?.resultadoSinFx.totalClp ?? null;
  const fxValue = selectedPeriod.headlineMetrics?.aporteFx.totalClp ?? null;
  const comparableMonths = selectedPeriod.headlineMetrics?.real.months ?? 0;
  const coverageNote =
    selectedPeriod.realMonths === 0
      ? 'Aún no hay cierres confirmados para este corte.'
      : selectedPeriod.fxComparableMonths === 0
        ? 'Este corte todavía no tiene base CLP/USD suficiente para separar el efecto cambiario.'
        : selectedPeriod.fxComparableMonths < selectedPeriod.realMonths
          ? `Usa ${selectedPeriod.fxComparableMonths} de ${selectedPeriod.realMonths} meses con base FX suficiente.`
          : 'Separación simple entre movimiento sin FX y efecto cambiario.';

  return (
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#0b1728] via-[#10203a] to-[#12284a] p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Lab</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="text-sm text-slate-300">
              {selectedPeriod.currentPeriodLabel
                ? `Lectura FX de ${monthLabel(selectedPeriod.currentPeriodLabel)}`
                : 'Lectura simple del período seleccionado'}
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
            onClick={() => setSelectedWindow(option.key)}
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

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
        <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Resultado del período</div>
        <div className={cn('mt-1 text-3xl font-semibold', (totalValue || 0) >= 0 ? 'text-white' : 'text-rose-300')}>
          {totalValue !== null ? formatFreedomCompactClp(totalValue) : '—'}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300/80">
          <span>{selectedPeriod.label}</span>
          {comparableMonths > 0 && <span>· {comparableMonths} meses comparables</span>}
        </div>
      </div>

      {totalValue !== null && sinFxValue !== null && fxValue !== null ? (
        <div className="mt-3">
          <LabCompositionBar
            totalClp={totalValue}
            resultadoSinFxClp={sinFxValue}
            efectoFxClp={fxValue}
          />
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[12px] text-slate-300/80">
          {coverageNote}
        </div>
      )}

      {coverageNote && totalValue !== null && sinFxValue !== null && fxValue !== null && (
        <div className="mt-3 text-[12px] text-slate-300/80">{coverageNote}</div>
      )}
    </Card>
  );
};
