import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Card, cn } from '../Components';
import {
  MAX_FINANCIAL_PERFORMANCE_FLOWS,
  isFinancialPerformanceConfirmationValid,
  reconcileFinancialPerformanceForPeriod,
  selectFinancialPerformanceClosure,
  type FinancialPerformanceConfirmation,
  type FinancialPerformanceFlow,
  type FinancialPerformancePeriod,
  type PerformanceFlowDirection,
} from '../../services/financialPerformance';
import { appendFinancialPerformanceConfirmation, loadFinancialPerformanceConfirmation } from '../../services/financialPerformanceStorage';
import { getCurrentUid } from '../../services/firebase';
import { type WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import { formatFreedomCompactClp } from './shared';

const monthEndDate = (monthKey: string): string => {
  const [year, month] = monthKey.split('-').map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
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

export const FinancialPerformanceSlice: React.FC<{
  closures: WealthMonthlyClosure[];
  includeRiskCapital: boolean;
  period: FinancialPerformancePeriod;
  onEditingStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}> = ({ closures, includeRiskCapital, period, onEditingStateChange }) => {
  const uid = getCurrentUid();
  const activeContext = useRef(true);
  const savingRef = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<FinancialPerformanceConfirmation | null>(null);
  const [draft, setDraft] = useState<ConfirmationDraft>(() => emptyConfirmationDraft(period.endMonth));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draftError, setDraftError] = useState('');
  const canConfirmSelectedPerimeter = !includeRiskCapital;

  useEffect(() => {
    activeContext.current = true;
    return () => { activeContext.current = false; };
  }, []);

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
    if (loadAttempt === 0) setDraft(emptyConfirmationDraft(period.endMonth));
    setStorageReady(false);
    setStorageError('');
    void loadFinancialPerformanceConfirmation(period, uid ? { expectedUid: uid } : {})
      .then((loaded) => {
        if (!active) return;
        setConfirmation(loaded);
        if (loadAttempt === 0) setDraft(toConfirmationDraft(loaded, period.endMonth));
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
  }, [canConfirmSelectedPerimeter, period.endMonth, period.startMonth, uid, loadAttempt]);

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
  useEffect(() => {
    onEditingStateChange?.({ dirty: isDraftDirty, saving: isSaving });
  }, [isDraftDirty, isSaving, onEditingStateChange]);

  useEffect(() => {
    if (!isDraftDirty && !isSaving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDraftDirty, isSaving]);
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
    if (!storageReady || isLoading || savingRef.current || !uid || getCurrentUid() !== uid) return;
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
    savingRef.current = true;
    setDraftError('');
    try {
      const saved = await appendFinancialPerformanceConfirmation(confirmationInput, period, { expectedUid: uid });
      if (!activeContext.current || getCurrentUid() !== uid) return;
      setConfirmation(saved);
      setDraft(toConfirmationDraft(saved, period.endMonth));
      setStorageReady(true);
      setStorageError('');
    } catch (error) {
      if (!activeContext.current || getCurrentUid() !== uid) return;
      setStorageError(String((error as { message?: string })?.message || 'No pude guardar la confirmación.'));
      setStorageReady(false);
    } finally {
      savingRef.current = false;
      if (activeContext.current && getCurrentUid() === uid) setIsSaving(false);
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
        <div role="alert" className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 p-3 text-xs text-rose-100">
          No pudimos verificar la confirmación guardada. La rentabilidad no se publica hasta recuperar el acceso.
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="mt-2 block min-h-9 rounded-lg border border-rose-200/40 px-3 font-semibold text-white">Reintentar lectura</button>
        </div>
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
      <fieldset disabled={isSaving || isLoading || !storageReady || !canConfirmSelectedPerimeter} className="mt-4 min-w-0">
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
      </fieldset>
      </details>
    </Card>
  );
};
