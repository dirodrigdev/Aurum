import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Trash2, Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import { type WealthLabWindow, buildWealthLabModel, selectWealthLabPeriod } from '../../services/wealthLab';
import {
  MAX_FINANCIAL_PERFORMANCE_FLOWS,
  isFinancialPerformanceConfirmationValid,
  listFinancialPerformancePeriods,
  reconcileFinancialPerformanceForPeriod,
  selectFinancialPerformanceClosure,
  type FinancialPerformanceConfirmation,
  type FinancialPerformanceFlow,
  type FinancialPerformancePeriod,
  type PerformanceFlowDirection,
} from '../../services/financialPerformance';
import {
  appendFinancialPerformanceConfirmation,
  loadFinancialPerformanceConfirmation,
} from '../../services/financialPerformanceStorage';
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

const monthEndDate = (monthKey: string): string => {
  const [year, month] = monthKey.split('-').map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(day).padStart(2, '0')}`;
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

type DraftFinancialFlow = Omit<FinancialPerformanceFlow, 'amountClp'> & { amountClp: string };

type ConfirmationDraft = Omit<FinancialPerformanceConfirmation, 'flows' | 'revision' | 'updatedAt'> & {
  flows: DraftFinancialFlow[];
};

const emptyConfirmationDraft = (monthKey: string): ConfirmationDraft => ({
  schemaVersion: 1,
  monthKey,
  flowCompleteness: 'incomplete',
  positionMovementCompleteness: 'unconfirmed',
  flows: [],
});

const toConfirmationDraft = (
  confirmation: FinancialPerformanceConfirmation | null,
  monthKey: string,
): ConfirmationDraft =>
  confirmation
    ? {
        schemaVersion: 1,
        monthKey,
        flowCompleteness: confirmation.flowCompleteness,
        positionMovementCompleteness: confirmation.positionMovementCompleteness,
        flows: confirmation.flows.map((flow) => ({ ...flow, amountClp: String(flow.amountClp) })),
      }
    : emptyConfirmationDraft(monthKey);

const formatPerformancePct = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;

const formatFlowCount = (draft: ConfirmationDraft) =>
  `${draft.flows.length} ${draft.flows.length === 1 ? 'movimiento' : 'movimientos'}`;

const FinancialPerformanceSlice: React.FC<{
  closures: WealthMonthlyClosure[];
  includeRiskCapital: boolean;
  period: FinancialPerformancePeriod;
}> = ({ closures, includeRiskCapital, period }) => {
  const [confirmation, setConfirmation] = useState<FinancialPerformanceConfirmation | null>(null);
  const [draft, setDraft] = useState<ConfirmationDraft>(() => emptyConfirmationDraft(period.endMonth));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draftError, setDraftError] = useState('');
  const canConfirmSelectedPerimeter = !includeRiskCapital;

  useEffect(() => {
    let active = true;
    if (!canConfirmSelectedPerimeter) {
      setConfirmation(null);
      setDraft(emptyConfirmationDraft(period.endMonth));
      setStorageReady(false);
      setStorageError('');
      setIsLoading(false);
      return () => { active = false; };
    }
    setIsLoading(true);
    setConfirmation(null);
    setDraft(emptyConfirmationDraft(period.endMonth));
    setStorageReady(false);
    setStorageError('');
    void loadFinancialPerformanceConfirmation(period)
      .then((loaded) => {
        if (!active) return;
        setConfirmation(loaded);
        setDraft(toConfirmationDraft(loaded, period.endMonth));
        setStorageReady(true);
        setStorageError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStorageReady(false);
        setStorageError(
          String((error as { message?: string })?.message || 'No pude leer la confirmación guardada.'),
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canConfirmSelectedPerimeter, period.endMonth, period.startMonth]);

  const persistedDraft = useMemo(() => toConfirmationDraft(confirmation, period.endMonth), [confirmation, period.endMonth]);
  const isDraftDirty =
    draft.flowCompleteness !== persistedDraft.flowCompleteness ||
    draft.positionMovementCompleteness !== persistedDraft.positionMovementCompleteness ||
    draft.flows.length !== persistedDraft.flows.length ||
    draft.flows.some((flow, index) => {
      const persisted = persistedDraft.flows[index];
      return Boolean(
        !persisted ||
          flow.id !== persisted.id ||
          flow.direction !== persisted.direction ||
          flow.effectiveDate !== persisted.effectiveDate ||
          flow.amountClp !== persisted.amountClp ||
          (flow.note || '') !== (persisted.note || '') ||
          (flow.reference || '') !== (persisted.reference || ''),
      );
    });
  const result = useMemo(
    () => reconcileFinancialPerformanceForPeriod({
      period,
      initialClosure: selectFinancialPerformanceClosure(closures, period.startMonth, includeRiskCapital),
      finalClosure: selectFinancialPerformanceClosure(closures, period.endMonth, includeRiskCapital),
      confirmation: canConfirmSelectedPerimeter ? confirmation : null,
      includeRiskCapital,
    }),
    [closures, confirmation, includeRiskCapital, canConfirmSelectedPerimeter, period],
  );

  const persistDraft = async (nextDraft: ConfirmationDraft) => {
    const confirmationInput: FinancialPerformanceConfirmation = {
      schemaVersion: 1,
      monthKey: period.endMonth,
      flowCompleteness: nextDraft.flowCompleteness,
      positionMovementCompleteness: nextDraft.positionMovementCompleteness,
      flows: nextDraft.flows.map((flow) => ({
        ...flow,
        amountClp: Number(flow.amountClp),
        ...(flow.note?.trim() ? { note: flow.note.trim() } : { note: undefined }),
        ...(flow.reference?.trim() ? { reference: flow.reference.trim() } : { reference: undefined }),
      })),
    };
    if (!canConfirmSelectedPerimeter) return;
    if (!isFinancialPerformanceConfirmationValid(confirmationInput, period)) {
      setDraftError('Revisa que cada movimiento tenga tipo, fecha válida del período y monto CLP mayor que cero.');
      return;
    }
    setIsSaving(true);
    setDraftError('');
    try {
      const saved = await appendFinancialPerformanceConfirmation(confirmationInput, period);
      setConfirmation(saved);
      setDraft(toConfirmationDraft(saved, period.endMonth));
      setStorageReady(true);
      setStorageError('');
    } catch (error) {
      setStorageError(String((error as { message?: string })?.message || 'No pude guardar la confirmación.'));
      setStorageReady(false);
    } finally {
      setIsSaving(false);
    }
  };

  const setFlowCompleteness = (flowCompleteness: ConfirmationDraft['flowCompleteness']) => {
    setDraft((current) => ({ ...current, flowCompleteness }));
    setDraftError('');
  };

  const addFlow = (direction: PerformanceFlowDirection) => {
    setDraft((current) => ({
      ...current,
      flowCompleteness: 'incomplete',
      flows: [
        ...current.flows,
        {
          id: crypto.randomUUID(),
          direction,
          effectiveDate: `${period.endMonth}-15`,
          amountClp: '',
          note: '',
          reference: '',
        },
      ],
    }));
    setDraftError('');
  };

  const updateFlow = (flowId: string, patch: Partial<DraftFinancialFlow>) => {
    setDraft((current) => ({
      ...current,
      flowCompleteness: 'incomplete',
      flows: current.flows.map((flow) => (flow.id === flowId ? { ...flow, ...patch } : flow)),
    }));
    setDraftError('');
  };

  const removeFlow = (flowId: string) => {
    setDraft((current) => ({
      ...current,
      flowCompleteness: 'incomplete',
      flows: current.flows.filter((flow) => flow.id !== flowId),
    }));
    setDraftError('');
  };

  const saveNoFlows = () => {
    const noFlowsDraft: ConfirmationDraft = {
      ...draft,
      flows: [],
      flowCompleteness: 'complete',
    };
    setDraft(noFlowsDraft);
    void persistDraft(noFlowsDraft);
  };

  const flowCompletenessLabel = confirmation?.flowCompleteness === 'complete'
    ? `Lista completa · ${formatFlowCount(persistedDraft)}`
    : 'Lista pendiente';
  const noFlowsWouldChange =
    draft.flowCompleteness !== 'complete' ||
    draft.flows.length > 0 ||
    draft.positionMovementCompleteness !== (confirmation?.positionMovementCompleteness || 'unconfirmed');
  const flowNetValue = result.flowListComplete || Boolean(confirmation?.flows.length)
    ? formatFreedomCompactClp(result.confirmedFlowsNetClp)
    : 'No confirmado';
  const flowEquationValue = result.flowListComplete
    ? formatFreedomCompactClp(result.confirmedFlowsNetClp)
    : confirmation?.flows.length
      ? `parcial ${formatFreedomCompactClp(result.confirmedFlowsNetClp)}`
      : 'sin confirmar';
  const moneyValue = (value: number | null) => value === null ? '—' : formatFreedomCompactClp(value);
  const coverageValue = (status: 'no_exposure' | 'not_evaluated' | 'evaluated', value: number | null) =>
    status === 'no_exposure'
      ? 'No aplica · sin exposición'
      : status === 'not_evaluated'
        ? 'Pendiente de atribución'
        : `${(value ?? 0).toFixed(0)}%`;
  const canPublishReturn =
    canConfirmSelectedPerimeter && storageReady && !isLoading &&
    (result.quality === 'RECONSTRUIDO' || result.quality === 'EXACTO') && result.returnPct !== null;
  const methodLabel = result.returnMethod === 'simple'
    ? 'Método simple'
    : result.returnMethod === 'simple_adjusted'
      ? 'Método simple ajustado'
      : result.returnMethod === 'modified_dietz'
        ? 'Modified Dietz'
        : 'Método pendiente';
  const causeAttributionNote = result.investmentAttributable !== null
    ? 'Separamos instrumentos, dólar, euro, UF y la parte que aún no podemos explicar.'
    : includeRiskCapital
      ? 'La atribución con CapRiesgo queda pendiente porque la confirmación guardada solo cubre el perímetro base.'
    : result.flowListComplete && Boolean(confirmation?.flows.length)
      ? 'La rentabilidad está calculada con los flujos confirmados; esta vista no distribuye el resultado entre instrumentos cuando hubo aportes o retiros.'
      : confirmation?.positionMovementCompleteness !== 'no_unrecorded_movements'
        ? 'Confirma que no hubo compras, ventas ni traslados sin registrar para habilitar la atribución por causa.'
        : 'No hay detalle comparable suficiente para separar el cambio por causa.';
  const residualLabel = result.quality !== 'RECONSTRUIDO'
    ? 'Residuo provisional'
    : confirmation?.flows.length
      ? 'Resultado sin desglose por causa'
      : 'Residuo no explicado';

  return (
    <Card className="overflow-hidden border-slate-200 bg-gradient-to-br from-[#0b1728] via-[#10203a] to-[#12284a] p-4 text-slate-100 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">Tus inversiones</div>
          <h3 className="mt-1 text-lg font-semibold text-white">
            Qué cambió entre {monthLabel(period.startMonth)} y {monthLabel(period.endMonth)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Comparamos las posiciones de inversión de ambos cierres. El capital de riesgo {includeRiskCapital ? 'está incluido' : 'queda fuera'}.
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-3 py-1 text-xs font-semibold',
          storageError
            ? 'border-rose-300/40 bg-rose-300/10 text-rose-200'
            : result.quality === 'RECONSTRUIDO' || result.quality === 'EXACTO'
            ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200'
            : result.quality === 'INSUFICIENTE'
              ? 'border-rose-300/40 bg-rose-300/10 text-rose-200'
              : 'border-amber-300/40 bg-amber-300/10 text-amber-200',
        )}>
          {isLoading ? 'Cargando' : storageError ? 'No verificable' : result.quality}
        </span>
      </div>
      {includeRiskCapital && (
        <p className="mt-3 rounded-lg border border-amber-200/30 bg-amber-200/10 p-3 text-xs text-amber-100">
          Las confirmaciones guardadas hoy corresponden al perímetro base, sin CapRiesgo. Para no reutilizarlas en otro perímetro, esta vista queda indicativa y no permite guardar una validación.
        </p>
      )}
      {storageError && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 p-3 text-xs text-rose-100">
          No pudimos verificar la confirmación guardada. La rentabilidad no se publica hasta recuperar el acceso.
        </p>
      )}

      <div className="mt-5 grid gap-2 border-b border-white/10 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Valor inicial · {monthLabel(period.startMonth)}</div>
            <div className="mt-1 break-words text-sm font-semibold text-white">{moneyValue(result.initialValue)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Valor final · {monthLabel(period.endMonth)}</div>
            <div className="mt-1 break-words text-sm font-semibold text-white">{moneyValue(result.finalValue)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Variación observada</div>
            <div data-testid="financial-performance-observed-change" className="mt-1 break-words text-sm font-semibold text-white">{moneyValue(result.observedChange)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Aportes y retiros</div>
            <div className="mt-1 break-words text-sm font-semibold text-white">{flowNetValue}</div>
            <div className="mt-1 text-[11px] text-slate-300">{flowCompletenessLabel}</div>
          </div>
      </div>

      <div className="mt-5">
        <h4 className="text-sm font-semibold text-white">Por qué cambió</h4>
        <p className="mt-1 text-xs text-slate-300">
          {causeAttributionNote}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Instrumentos</div>
            <div data-testid="financial-performance-instruments-result" className="mt-1 break-words text-base font-semibold text-white">{moneyValue(result.investmentAttributable)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Efecto USD</div>
            <div data-testid="financial-performance-usd-result" className="mt-1 break-words text-base font-semibold text-white">{moneyValue(result.usdFxAttributable)}</div>
            <div className="mt-1 text-[11px] text-slate-300">{coverageValue(result.fxCoverageStatus, result.fxCoveragePct)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Efecto EUR</div>
            <div data-testid="financial-performance-eur-result" className="mt-1 break-words text-base font-semibold text-white">{moneyValue(result.eurFxAttributable)}</div>
            <div className="mt-1 text-[11px] text-slate-300">{coverageValue(result.fxCoverageStatus, result.fxCoveragePct)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-300">Indexación UF</div>
            <div data-testid="financial-performance-uf-result" className="mt-1 break-words text-base font-semibold text-white">{moneyValue(result.ufAttributable)}</div>
            <div className="mt-1 text-[11px] text-slate-300">{coverageValue(result.ufCoverageStatus, result.ufCoveragePct)}</div>
          </div>
          <div className="rounded-xl border border-amber-200/20 bg-amber-200/5 p-3">
            <div className="text-xs text-amber-100/80">
              {residualLabel}
            </div>
            <div data-testid="financial-performance-residual-result" className="mt-1 break-words text-base font-semibold text-amber-100">
              {moneyValue(result.unexplainedResidual)}
            </div>
            {result.quality !== 'RECONSTRUIDO' && <div className="mt-1 text-[10px] text-amber-100/70">Puede incluir causas aún no validadas; no se suma a la rentabilidad.</div>}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-sky-200/20 bg-sky-200/5 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-100">
          {canPublishReturn ? 'Rentabilidad financiera' : 'Rentabilidad pendiente de validación'}
        </div>
        <div className="mt-1 break-words text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          <span data-testid="financial-performance-published-value">
            {isLoading ? 'Cargando…' : canPublishReturn ? formatPerformancePct(result.returnPct) : '—'}
          </span>
        </div>
        <div className="mt-2 text-xs text-slate-300">
          {canPublishReturn
            ? `${methodLabel} · resultado de cartera ${moneyValue(result.portfolioResult)}`
            : includeRiskCapital
              ? 'La confirmación guardada no aplica al perímetro con CapRiesgo.'
              : storageError
                ? 'No pudimos comprobar la confirmación guardada.'
                : 'Se muestra la variación de saldos, no una rentabilidad confirmada.'}
        </div>
      </div>

      <details className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
        <summary className="cursor-pointer font-semibold text-white">Ver cómo se concilia el cálculo</summary>
        <div className="mt-2 break-words">
          Variación {moneyValue(result.observedChange)} = flujos {flowEquationValue} + instrumentos {moneyValue(result.investmentAttributable)} + USD {moneyValue(result.usdFxAttributable)} + EUR {moneyValue(result.eurFxAttributable)} + UF {moneyValue(result.ufAttributable)} + sin explicar {moneyValue(result.unexplainedResidual)}
        </div>
        <div className="mt-1 text-slate-300">{result.qualityReason}</div>
      </details>

      <details className="mt-5 border-t border-white/10 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
          <span>{result.flowListComplete ? 'Revisar validación del período' : 'Completar validación del período'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white">Movimientos y cobertura</div>
            <div className="text-[11px] text-slate-300/80">
              Cierre inicial {period.startMonth} · cierre final {period.endMonth}
              {confirmation?.revision ? ` · revisión ${confirmation.revision}` : ''}
              {isDraftDirty ? ' · cambios sin guardar' : ''}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-300/80">
              <span>Flujos: {confirmation?.flowCompleteness === 'complete' ? 'lista completa' : 'pendiente'}</span>
              <span>Movimientos de posiciones: {confirmation?.positionMovementCompleteness === 'no_unrecorded_movements' ? 'confirmados' : 'pendientes'}</span>
            </div>
          </div>
          {isLoading && <span className="text-[11px] text-slate-300">Cargando confirmación…</span>}
        </div>

        {storageError && (
          <div role="alert" className="mt-2 rounded-lg border border-rose-300/30 bg-rose-300/10 p-2 text-[11px] text-rose-100">
            No hay acceso a la confirmación guardada. {storageError}
          </div>
        )}
        {draftError && <div role="alert" className="mt-2 text-[11px] text-rose-200">{draftError}</div>}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canConfirmSelectedPerimeter || !storageReady || isLoading || isSaving || !noFlowsWouldChange}
            onClick={saveNoFlows}
            className="min-h-9 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
          >
            No hubo flujos este mes
          </button>
          <button
            type="button"
            disabled={!canConfirmSelectedPerimeter || !storageReady || isLoading || isSaving || draft.flows.length >= MAX_FINANCIAL_PERFORMANCE_FLOWS}
            onClick={() => addFlow('aporte')}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar aporte
          </button>
          <button
            type="button"
            disabled={!canConfirmSelectedPerimeter || !storageReady || isLoading || isSaving || draft.flows.length >= MAX_FINANCIAL_PERFORMANCE_FLOWS}
            onClick={() => addFlow('retiro')}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar retiro
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          Confirma solo aportes o retiros de capital de la cartera. Los gastos personales de GastApp no son flujos de inversión.
        </p>

        {draft.flows.length > 0 && (
          <div className="mt-3 space-y-2">
            {draft.flows.map((flow, index) => (
              <div key={flow.id} className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="text-[10px] text-slate-400">
                  Tipo
                  <select
                    value={flow.direction}
                    onChange={(event) => updateFlow(flow.id, { direction: event.target.value as PerformanceFlowDirection })}
                    className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                  >
                    <option value="aporte">Aporte</option>
                    <option value="retiro">Retiro</option>
                  </select>
                </label>
                <label className="text-[10px] text-slate-400">
                  Fecha efectiva
                  <input
                    type="date"
                    min={monthEndDate(period.startMonth)}
                    max={monthEndDate(period.endMonth)}
                    value={flow.effectiveDate}
                    onChange={(event) => updateFlow(flow.id, { effectiveDate: event.target.value })}
                    className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                  />
                </label>
                <label className="text-[10px] text-slate-400">
                  Monto CLP
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={flow.amountClp}
                    onChange={(event) => updateFlow(flow.id, { amountClp: event.target.value })}
                    className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                    placeholder="10.000.000"
                  />
                </label>
                <label className="text-[10px] text-slate-400 xl:col-span-1">
                  Nota opcional
                  <input
                    type="text"
                    value={flow.note || ''}
                    onChange={(event) => updateFlow(flow.id, { note: event.target.value })}
                    className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                    maxLength={160}
                  />
                </label>
                <label className="text-[10px] text-slate-400 xl:col-span-1">
                  Referencia opcional
                  <input
                    type="text"
                    value={flow.reference || ''}
                    onChange={(event) => updateFlow(flow.id, { reference: event.target.value })}
                    className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                    maxLength={120}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeFlow(flow.id)}
                  aria-label={`Eliminar movimiento ${index + 1}`}
                  className="inline-flex min-h-9 items-center justify-center gap-1 self-end rounded-lg border border-rose-300/25 bg-rose-300/5 px-2 text-[11px] text-rose-200"
                >
                  <Trash2 size={13} /> Eliminar
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFlowCompleteness('complete')}
                className={cn(
                  'min-h-9 rounded-lg border px-3 text-[11px] font-semibold',
                  draft.flowCompleteness === 'complete'
                    ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100'
                    : 'border-white/15 bg-white/5 text-slate-300',
                )}
              >
                Lista completa
              </button>
              <button
                type="button"
                onClick={() => setFlowCompleteness('incomplete')}
                className={cn(
                  'min-h-9 rounded-lg border px-3 text-[11px] font-semibold',
                  draft.flowCompleteness === 'incomplete'
                    ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                    : 'border-white/15 bg-white/5 text-slate-300',
                )}
              >
                Incompleta / no sé
              </button>
            </div>
            <label className="flex items-start gap-2 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={draft.positionMovementCompleteness === 'no_unrecorded_movements'}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  positionMovementCompleteness: event.target.checked ? 'no_unrecorded_movements' : 'unconfirmed',
                }))}
                className="mt-0.5 accent-emerald-400"
              />
              Confirmo que no hubo compras, ventas ni traslados de posición sin registrar durante el período.
            </label>
            <p className="text-[10px] text-slate-400">
              Esta confirmación es independiente de la lista de aportes y retiros. Si hubo compras, ventas o traslados no registrados, déjala sin marcar.
            </p>
          </div>
          <button
            type="button"
            disabled={!canConfirmSelectedPerimeter || !storageReady || isLoading || isSaving || !isDraftDirty}
            onClick={() => void persistDraft(draft)}
            className="min-h-10 rounded-lg bg-sky-400 px-4 text-xs font-semibold text-slate-950 disabled:opacity-40"
          >
            {isSaving ? 'Guardando…' : 'Guardar confirmación'}
          </button>
        </div>
        {confirmation?.revision && (
          <p className="mt-2 text-[10px] text-slate-400">
            Guardado como revisión {confirmation.revision}. Las revisiones anteriores se conservan para auditoría.
          </p>
        )}
      </div>
      </details>
    </Card>
  );
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
      <div className="text-xs font-medium text-slate-300">Serie FX heredada del Lab</div>
      <div className="mt-1 text-xs text-slate-300/80">Indicador combinado = indicador sin FX + componente FX</div>
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
          <div className="text-slate-400">Indicador sin FX</div>
          <div className="font-medium text-emerald-300">{formatFreedomCompactClp(resultadoSinFxClp)}</div>
        </div>
        <div>
          <div className="text-slate-400">Componente FX heredado</div>
          <div className={cn('font-medium', efectoFxClp >= 0 ? 'text-sky-300' : 'text-rose-300')}>
            {formatFreedomCompactClp(efectoFxClp)}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Indicador combinado</div>
          <div className={cn('font-medium', totalClp >= 0 ? 'text-white' : 'text-rose-300')}>
            {formatFreedomCompactClp(totalClp)}
          </div>
        </div>
      </div>
    </div>
  );
};

export const LabTab: React.FC<LabTabProps> = ({ model, closures, includeRiskCapitalInTotals, onToggleRiskMode }) => {
  const uid = getCurrentUid();
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
  const labValue = hasHistoricalPeriod ? selectedPeriod.headlineMetrics?.real.totalClp ?? null : null;
  const sinFxValue = hasHistoricalPeriod ? selectedPeriod.headlineMetrics?.resultadoSinFx.totalClp ?? null : null;
  const fxValue = hasHistoricalPeriod ? selectedPeriod.headlineMetrics?.aporteFx.totalClp ?? null : null;
  const comparableMonths = selectedPeriod.headlineMetrics?.real.months ?? 0;
  const trendPoints = hasHistoricalPeriod
    ? selectedPeriod.points.filter((point) => point.varPatrimonioClp !== null)
    : [];
  const observedPatrimonyChange = trendPoints.length
    ? trendPoints.reduce((sum, point) => sum + Number(point.varPatrimonioClp), 0)
    : null;
  const trendScale = Math.max(1, ...trendPoints.map((point) => Math.abs(point.varPatrimonioClp || 0)));
  const coverageNote =
    !hasHistoricalPeriod || selectedPeriod.realMonths === 0
      ? 'No hay cierres comparables para este período.'
      : selectedPeriod.fxComparableMonths === 0
        ? 'Este período no tiene base CLP/USD suficiente para separar el efecto cambiario patrimonial.'
        : selectedPeriod.fxComparableMonths < selectedPeriod.realMonths
          ? `El desglose cambiario cubre ${selectedPeriod.fxComparableMonths} de ${selectedPeriod.realMonths} meses.`
          : 'El desglose patrimonial usa los meses con base CLP/USD comparable.';
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
            onClick={onToggleRiskMode}
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
          key={`${selectedFinancialPeriod.endMonth}:${includeRiskCapitalInTotals ? 'risk' : 'base'}`}
          closures={closures}
          includeRiskCapital={includeRiskCapitalInTotals}
          period={selectedFinancialPeriod}
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
        <details className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">Explorar la serie FX histórica del Lab</summary>
          <p className="mt-2">
            Esta serie experimental no concilia necesariamente con el cambio patrimonial observado y no mide rentabilidad de inversiones.
            {comparableMonths > 0 && ` Cubre ${comparableMonths} meses con base FX comparable.`}
          </p>
          {labValue !== null && sinFxValue !== null && fxValue !== null && (
            <div className="mt-3 rounded-xl bg-[#10203a] p-1 text-slate-100">
              <LabCompositionBar totalClp={labValue} resultadoSinFxClp={sinFxValue} efectoFxClp={fxValue} />
            </div>
          )}
          <p className="mt-2">{coverageNote}</p>
        </details>
      </Card>
    </>
  );
};
