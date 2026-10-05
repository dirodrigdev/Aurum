import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import { type WealthLabWindow, buildWealthLabModel, selectWealthLabPeriod } from '../../services/wealthLab';
import { listFinancialPerformancePeriods } from '../../services/financialPerformance';
import { FinancialPerformanceSlice } from './FinancialPerformanceSlice';
import { currentMonthKey, type WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import { formatFreedomCompactClp } from './shared';
import { getCurrentUid } from '../../services/firebase';

type RendimientoPeriod = 'monthly' | 'last_12m' | 'since_start';

const LAB_WINDOW_OPTIONS: Array<{ key: RendimientoPeriod; label: string }> = [
  { key: 'monthly', label: 'Mensual' },
  { key: 'last_12m', label: 'Últimos 12 meses' },
  { key: 'since_start', label: 'Desde inicio' },
];

const periodPreferenceKey = (uid: string) => `aurum.performance.period.v1:${uid}`;
type PeriodPreference = { view: RendimientoPeriod; endMonth: string };

const readPeriodPreference = (uid: string | null): PeriodPreference | null => {
  if (!uid || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(periodPreferenceKey(uid));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PeriodPreference>;
    if (
      (parsed.view === 'monthly' || parsed.view === 'last_12m' || parsed.view === 'since_start') &&
      typeof parsed.endMonth === 'string' && /^\d{4}-\d{2}$/.test(parsed.endMonth)
    ) return { view: parsed.view, endMonth: parsed.endMonth };
  } catch {
    // A local preference is optional; an unavailable or malformed value is ignored.
  }
  return null;
};

const monthOrdinal = (monthKey: string): number => {
  const [year, month] = monthKey.split('-').map(Number);
  return year * 12 + month - 1;
};

type LabTabProps = {
  model: ReturnType<typeof buildWealthLabModel>;
  closures: WealthMonthlyClosure[];
  includeRiskCapitalInTotals: boolean;
  onToggleRiskMode: () => void;
};

export const LabTab: React.FC<LabTabProps> = ({ model, closures, includeRiskCapitalInTotals, onToggleRiskMode }) => {
  const uid = getCurrentUid();
  const [editingState, setEditingState] = useState({ dirty: false, saving: false });
  const acceptPeriodChange = useCallback(() => {
    if (editingState.saving) return false;
    if (editingState.dirty && !window.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos para cambiar el período o perímetro? Cancelar conserva tu edición.')) return false;
    setEditingState({ dirty: false, saving: false });
    return true;
  }, [editingState]);
  const [preferenceState, setPreferenceState] = useState(() => ({ uid, value: readPeriodPreference(uid) }));
  const preference = preferenceState.uid === uid ? preferenceState.value : null;
  const selectedWindow = preference?.view || 'monthly';
  const financialPeriods = useMemo(
    () => listFinancialPerformancePeriods(closures, includeRiskCapitalInTotals),
    [closures, includeRiskCapitalInTotals],
  );
  const historicalClosedMonths = useMemo(() => {
    const currentMonth = currentMonthKey();
    const closedMonths = new Set(
      closures
        .filter((closure) => (
          closure.monthKey < currentMonth &&
          !closure.analysisProvisionalReason &&
          Boolean(closure.id?.trim()) &&
          Boolean(closure.closedAt?.trim())
        ))
        .map((closure) => closure.monthKey),
    );
    return [...new Set(model.points.map((point) => point.monthKey).filter((key) => closedMonths.has(key)))].sort();
  }, [closures, model.points]);
  const fallbackEndMonth = financialPeriods[financialPeriods.length - 1]?.endMonth || historicalClosedMonths[historicalClosedMonths.length - 1] || '';
  const selectedEndMonth = preference?.endMonth && historicalClosedMonths.includes(preference.endMonth)
    ? preference.endMonth
    : fallbackEndMonth;
  const selectedFinancialPeriod = financialPeriods.find((period) => period.endMonth === selectedEndMonth) || null;

  useEffect(() => {
    if (!uid) return;
    setPreferenceState((current) => current.uid === uid ? current : { uid, value: readPeriodPreference(uid) });
  }, [uid]);

  useEffect(() => {
    if (!uid || !selectedEndMonth) return;
    const nextPreference = { view: selectedWindow, endMonth: selectedEndMonth };
    setPreferenceState((current) => {
      if (current.uid !== uid || current.value?.view !== nextPreference.view || current.value?.endMonth !== nextPreference.endMonth) {
        return { uid, value: nextPreference };
      }
      return current;
    });
    try {
      window.localStorage.setItem(periodPreferenceKey(uid), JSON.stringify(nextPreference));
    } catch {
      // Performance remains usable if the browser blocks local preference storage.
    }
  }, [selectedEndMonth, selectedWindow, uid]);

  const setSelectedWindow = (view: RendimientoPeriod) => {
    if (view === selectedWindow || !acceptPeriodChange()) return;
    if (!uid) {
      setPreferenceState({ uid: null, value: { view, endMonth: selectedEndMonth } });
      return;
    }
    setPreferenceState({ uid, value: { view, endMonth: selectedEndMonth } });
  };

  const selectedPeriod = useMemo(() => {
    const anchoredPoints = model.points.filter((point) => point.monthKey <= selectedEndMonth);
    const window: WealthLabWindow = selectedWindow === 'monthly' ? 'last_month' : selectedWindow;
    const boundedPoints = selectedWindow === 'last_12m' && selectedEndMonth
      ? anchoredPoints.filter((point) => monthOrdinal(point.monthKey) >= monthOrdinal(selectedEndMonth) - 11)
      : anchoredPoints;
    return selectWealthLabPeriod({ ...model, points: boundedPoints }, window);
  }, [model, selectedEndMonth, selectedWindow]);
  const hasHistoricalPeriod = Boolean(selectedEndMonth && selectedPeriod.points.length);
  const trendPoints = hasHistoricalPeriod
    ? selectedPeriod.points.filter((point) => point.varPatrimonioClp !== null)
    : [];
  const observedPatrimonyChange = trendPoints.length
    ? trendPoints.reduce((sum, point) => sum + Number(point.varPatrimonioClp), 0)
    : null;
  const trendScale = Math.max(1, ...trendPoints.map((point) => Math.abs(point.varPatrimonioClp || 0)));
  const endMonthLabel = selectedEndMonth ? monthLabel(selectedEndMonth) : 'Sin cierres';
  const globalPeriodLabel = selectedWindow === 'monthly'
    ? selectedFinancialPeriod
      ? `${monthLabel(selectedFinancialPeriod.startMonth)} → ${monthLabel(selectedFinancialPeriod.endMonth)}`
      : `Hasta ${endMonthLabel} · sin cierre inicial comparable`
    : selectedWindow === 'last_12m'
      ? `Últimos 12 meses hasta ${endMonthLabel}`
      : `Desde inicio hasta ${endMonthLabel}`;

  return (
    <>
      <Card className="border-slate-200 bg-white p-4 sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Rendimiento</div>
        <h2 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Cómo rindieron mis inversiones y por qué</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Primero ves los saldos y qué explica el cambio. La rentabilidad aparece solo cuando sus datos y confirmaciones están completos.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)] sm:items-end">
          <div>
            <div className="text-xs font-semibold text-slate-500">Período</div>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Período de rendimiento">
              {LAB_WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={selectedWindow === option.key}
                  onClick={() => setSelectedWindow(option.key)}
                  className={cn(
                    'min-h-10 rounded-full border px-4 py-2 text-xs font-semibold',
                    selectedWindow === option.key
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs font-semibold text-slate-600">
            Mes de cierre
            <select
              aria-label="Mes de cierre"
              value={selectedEndMonth}
              onChange={(event) => {
                const endMonth = event.target.value;
                if (endMonth === selectedEndMonth || !acceptPeriodChange()) return;
                setPreferenceState({ uid, value: { view: selectedWindow, endMonth } });
              }}
              disabled={!historicalClosedMonths.length}
              className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 disabled:text-slate-400"
            >
              {!historicalClosedMonths.length && <option value="">Sin cierres</option>}
              {historicalClosedMonths.map((monthKey) => (
                <option key={monthKey} value={monthKey}>{monthLabel(monthKey)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
          <span>Período seleccionado: {globalPeriodLabel} · Perímetro: inversiones {includeRiskCapitalInTotals ? 'con CapRiesgo' : 'sin CapRiesgo'}</span>
          <button
            type="button"
            onClick={() => { if (acceptPeriodChange()) onToggleRiskMode(); }}
            aria-pressed={includeRiskCapitalInTotals}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Zap size={14} aria-hidden="true" />
            {includeRiskCapitalInTotals ? 'Excluir CapRiesgo' : 'Incluir CapRiesgo'}
          </button>
        </div>
      </Card>

      {selectedWindow === 'monthly' && selectedFinancialPeriod ? (
        <FinancialPerformanceSlice
          key={`${uid}:${selectedFinancialPeriod.endMonth}:${includeRiskCapitalInTotals ? 'risk' : 'base'}`}
          closures={closures}
          includeRiskCapital={includeRiskCapitalInTotals}
          period={selectedFinancialPeriod}
          onEditingStateChange={setEditingState}
        />
      ) : selectedWindow === 'monthly' ? (
        <Card className="border-slate-200 bg-white p-4 sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Cobertura mensual pendiente</div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">No hay dos cierres detallados consecutivos para {endMonthLabel}</h3>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            La rentabilidad financiera requiere posiciones de inversión detalladas en el cierre inicial y final. El contexto patrimonial del mismo mes sí aparece abajo cuando está disponible.
          </p>
        </Card>
      ) : (
        <Card className="border-slate-200 bg-white p-4 sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Rentabilidad acumulada pendiente</div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Aún no hay rentabilidad financiera validada para este período</h3>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            El historial muestra cambios observados del patrimonio hasta {endMonthLabel}; no confirma todos los aportes y retiros de las inversiones para una ventana acumulada.
          </p>
        </Card>
      )}

      <Card className="border-slate-200 bg-white p-4 sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Contexto del patrimonio</div>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">Cómo se movió el patrimonio</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Esta serie incluye otros bloques del patrimonio. Muestra cambios observados y no equivale a la rentabilidad de las inversiones.
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <div className="text-xs text-slate-500">Cambio patrimonial observado</div>
            <div className={cn('mt-1 text-2xl font-semibold', (observedPatrimonyChange || 0) >= 0 ? 'text-slate-900' : 'text-rose-700')}>
              {observedPatrimonyChange !== null ? formatFreedomCompactClp(observedPatrimonyChange) : '—'}
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {globalPeriodLabel}
            {selectedPeriod.realMonths > 0 && ` · ${selectedPeriod.realMonths} ${selectedPeriod.realMonths === 1 ? 'mes' : 'meses'} con cierre comparable`}
          </div>
        </div>
        {trendPoints.length > 1 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-700">Cambio observado por mes</div>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div
                role="img"
                aria-label={`Cambios patrimoniales observados de ${monthLabel(trendPoints[0].monthKey)} a ${monthLabel(trendPoints[trendPoints.length - 1].monthKey)}`}
                className="relative flex min-w-full items-center gap-1"
              >
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-slate-300" />
                {trendPoints.map((point) => {
                  const value = point.varPatrimonioClp || 0;
                  const height = Math.max(3, Math.round(Math.abs(value) / trendScale * 40));
                  return (
                    <div key={point.monthKey} className="relative h-24 min-w-[14px] flex-1" title={`${monthLabel(point.monthKey)} · ${formatFreedomCompactClp(value)}`}>
                      <div
                        className={cn('absolute left-0 w-full rounded-sm', value >= 0 ? 'bg-emerald-500' : 'bg-rose-400')}
                        style={{ height, ...(value >= 0 ? { bottom: '50%' } : { top: '50%' }) }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>{monthLabel(trendPoints[0].monthKey)}</span>
                <span>{monthLabel(trendPoints[trendPoints.length - 1].monthKey)}</span>
              </div>
            </div>
          </div>
        )}

      </Card>
    </>
  );
};
