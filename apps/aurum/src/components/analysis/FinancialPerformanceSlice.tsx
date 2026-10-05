import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Card, cn } from '../Components';
import {
  MAX_FINANCIAL_PERFORMANCE_FLOWS,
  financialPerformancePerimeter,
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
import { resolveGastappMonthlySpend } from '../../services/gastosMonthly';
import { type WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import { FinancialPerformanceResultView } from './FinancialPerformanceResultView';

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
  // New periods use the user's source-of-truth assumption locally; saving remains an explicit action.
  flowCompleteness: 'complete',
  positionMovementCompleteness: 'no_unrecorded_movements',
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
  const perimeter = financialPerformancePerimeter(includeRiskCapital);

  useEffect(() => {
    activeContext.current = true;
    return () => { activeContext.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setConfirmation(null);
    if (loadAttempt === 0) setDraft(emptyConfirmationDraft(period.endMonth));
    setStorageReady(false);
    setStorageError('');
    void loadFinancialPerformanceConfirmation(period, uid ? { expectedUid: uid, perimeter } : { perimeter })
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
  }, [period.endMonth, period.startMonth, uid, loadAttempt, perimeter]);

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
  const draftConfirmation = useMemo<FinancialPerformanceConfirmation>(() => ({
    schemaVersion: 1,
    monthKey: period.endMonth,
    perimeter,
    flowCompleteness: draft.flowCompleteness,
    positionMovementCompleteness: draft.positionMovementCompleteness,
    flows: draft.flows.map((flow) => ({ ...flow, amountClp: Number(flow.amountClp) })),
  }), [draft, perimeter, period.endMonth]);
  // A missing saved revision may use the initial draft after Firestore confirms that no revision exists.
  // This is an in-memory assumption only; it is persisted only after an explicit user action.
  const calculationConfirmation = confirmation ?? (storageReady && !isLoading ? draftConfirmation : null);
  const initialClosure = selectFinancialPerformanceClosure(closures, period.startMonth, includeRiskCapital);
  const finalClosure = selectFinancialPerformanceClosure(closures, period.endMonth, includeRiskCapital);
  const embeddedGastappWithdrawalClp = (() => {
    const snapshot = finalClosure?.gastappExpenseClose;
    if (!snapshot || snapshot.calendarMonthKey !== period.endMonth) return null;
    const amount = Number(snapshot.amountsByCurrency?.CLP?.total);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  })();
  const runtimeGastappSpend = resolveGastappMonthlySpend(period.endMonth);
  const runtimeGastappWithdrawalClp = (() => {
    if (runtimeGastappSpend.status !== 'complete' || runtimeGastappSpend.gastosEur === null) return null;
    const eurClp = Number(finalClosure?.fxRates?.eurClp);
    if (!Number.isFinite(eurClp) || eurClp <= 0) return null;
    const amount = runtimeGastappSpend.gastosEur * eurClp;
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  })();
  // Prefer the close-time snapshot; fall back to the current official GastApp
  // calendar contract for historical periods that predate embedded snapshots.
  const automaticConsumptionWithdrawalClp = embeddedGastappWithdrawalClp ?? runtimeGastappWithdrawalClp;
  const result = useMemo(
    () => reconcileFinancialPerformanceForPeriod({
      period,
      initialClosure,
      finalClosure,
      confirmation: calculationConfirmation,
      includeRiskCapital,
      automaticConsumptionWithdrawalClp,
    }),
    [automaticConsumptionWithdrawalClp, calculationConfirmation, finalClosure, includeRiskCapital, initialClosure, period],
  );

  const persistDraft = async (nextDraft: ConfirmationDraft) => {
    if (!storageReady || isLoading || savingRef.current || !uid || getCurrentUid() !== uid) return;
    const confirmationInput: FinancialPerformanceConfirmation = {
      schemaVersion: 1,
      monthKey: period.endMonth,
      perimeter,
      flowCompleteness: nextDraft.flowCompleteness,
      positionMovementCompleteness: nextDraft.positionMovementCompleteness,
      flows: nextDraft.flows.map((flow) => ({
        ...flow,
        amountClp: Number(flow.amountClp),
        ...(flow.note?.trim() ? { note: flow.note.trim() } : { note: undefined }),
        ...(flow.reference?.trim() ? { reference: flow.reference.trim() } : { reference: undefined }),
      })),
    };
    if (!isFinancialPerformanceConfirmationValid(confirmationInput, period)) {
      setDraftError('Revisa que cada movimiento tenga tipo, fecha válida del período y monto CLP mayor que cero.');
      return;
    }
    setIsSaving(true);
    savingRef.current = true;
    setDraftError('');
    try {
      const saved = await appendFinancialPerformanceConfirmation(confirmationInput, period, { expectedUid: uid, perimeter });
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
    if (draft.flows.length > 0 && !window.confirm('Esta confirmación eliminará la lista de movimientos ingresada. ¿Confirmas que no hubo otros aportes ni retiros aparte del consumo automático de GastApp?')) return;
    const noFlowsDraft: ConfirmationDraft = {
      ...draft,
      flows: [],
      flowCompleteness: 'complete',
    };
    setDraft(noFlowsDraft);
    void persistDraft(noFlowsDraft);
  };

  const noFlowsWouldChange =
    draft.flowCompleteness !== 'complete' ||
    draft.flows.length > 0 ||
    draft.positionMovementCompleteness !== (confirmation?.positionMovementCompleteness || 'unconfirmed');
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
      {storageError && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 p-3 text-xs text-rose-100">
          No pudimos verificar la confirmación guardada. La rentabilidad no se publica hasta recuperar el acceso.
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="mt-2 block min-h-11 rounded-lg border border-rose-200/40 px-3 font-semibold text-white">Reintentar lectura</button>
        </div>
      )}

      <FinancialPerformanceResultView
        result={result} confirmation={calculationConfirmation} hasSavedConfirmation={Boolean(confirmation)} isLoading={isLoading}
        storageReady={storageReady} storageError={Boolean(storageError)}
        closures={closures} includeRiskCapital={includeRiskCapital}
      />
      <p role="status" className="mt-4 text-xs text-slate-300">
        {isDraftDirty ? confirmation
          ? 'Cambios sin guardar: el resultado publicado conserva la última confirmación guardada.'
          : 'Borrador sin guardar: el resultado refleja los datos y supuestos de esta pantalla.'
          : confirmation?.revision
          ? `Confirmación guardada · revisión ${confirmation.revision} · ${includeRiskCapital ? 'inversiones con CapRiesgo' : 'inversiones sin CapRiesgo'}.`
          : storageReady && result.quality === 'RECONSTRUIDO'
            ? 'Supuesto inicial sin guardar: GastApp se incorpora como retiro automático y no hay otros aportes/retiros.'
            : 'Falta completar la validación de este período para reconstruir la rentabilidad.'}
      </p>

      <details className="mt-5 border-t border-white/10 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
          <span>{result.flowListComplete ? 'Revisar validación del período' : 'Completar validación del período'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
      <fieldset disabled={isSaving || isLoading || !storageReady} className="mt-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white">Movimientos y cobertura</div>
            <div className="text-[11px] text-slate-300/80">
              Cierre inicial {period.startMonth} · cierre final {period.endMonth}
              {confirmation?.revision ? ` · revisión ${confirmation.revision}` : ''}
              {isDraftDirty ? ' · cambios sin guardar' : ''}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-300/80">
              <span>Flujos: {calculationConfirmation?.flowCompleteness === 'complete' ? `lista completa${confirmation ? '' : ' · supuesto'}` : 'pendiente'}</span>
              <span>Movimientos de posiciones: {calculationConfirmation?.positionMovementCompleteness === 'no_unrecorded_movements' ? `reflejados${confirmation ? '' : ' · supuesto'}` : 'pendientes'}</span>
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
            disabled={!storageReady || isLoading || isSaving || !noFlowsWouldChange}
            onClick={saveNoFlows}
            className="min-h-11 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
          >
            No hubo otros flujos este mes
          </button>
          <button
            type="button"
            disabled={!storageReady || isLoading || isSaving || draft.flows.length >= MAX_FINANCIAL_PERFORMANCE_FLOWS}
            onClick={() => addFlow('aporte')}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar aporte
          </button>
          <button
            type="button"
            disabled={!storageReady || isLoading || isSaving || draft.flows.length >= MAX_FINANCIAL_PERFORMANCE_FLOWS}
            onClick={() => addFlow('retiro')}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar retiro
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          GastApp se incorpora automáticamente como retiro del portafolio del mes. Agrega aquí solo otros aportes o retiros de capital.
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
                    className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
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
                    className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
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
                    className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                    placeholder="10.000.000"
                  />
                </label>
                <label className="text-[10px] text-slate-400 xl:col-span-1">
                  Nota opcional
                  <input
                    type="text"
                    value={flow.note || ''}
                    onChange={(event) => updateFlow(flow.id, { note: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                    maxLength={160}
                  />
                </label>
                <label className="text-[10px] text-slate-400 xl:col-span-1">
                  Referencia opcional
                  <input
                    type="text"
                    value={flow.reference || ''}
                    onChange={(event) => updateFlow(flow.id, { reference: event.target.value })}
                    className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-[#14243a] px-2 text-[11px] text-white"
                    maxLength={120}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeFlow(flow.id)}
                  aria-label={`Eliminar movimiento ${index + 1}`}
                  className="inline-flex min-h-11 items-center justify-center gap-1 self-end rounded-lg border border-rose-300/25 bg-rose-300/5 px-2 text-[11px] text-rose-200"
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
                aria-pressed={draft.flowCompleteness === 'complete'}
                className={cn(
                  'min-h-11 rounded-lg border px-3 text-[11px] font-semibold',
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
                aria-pressed={draft.flowCompleteness === 'incomplete'}
                className={cn(
                  'min-h-11 rounded-lg border px-3 text-[11px] font-semibold',
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
              Confirmo que Aurum registra todas las compras, ventas y traslados de posición de este período.
            </label>
            <p className="text-xs leading-relaxed text-slate-300">
              Déjala marcada si Aurum ya registra todas esas operaciones. Si falta una o tienes dudas, desmárcala: el cálculo pasa a INDICATIVO y oculta la rentabilidad. Aplica a compras, ventas o traslados entre cuentas de inversión. Los cambios de precio y gastos personales de GastApp no cuentan aquí; los aportes y retiros se indican arriba.
            </p>
          </div>
          <button
            type="button"
            disabled={!storageReady || isLoading || isSaving || !isDraftDirty}
            onClick={() => void persistDraft(draft)}
            className="min-h-11 rounded-lg bg-sky-400 px-4 text-xs font-semibold text-slate-950 disabled:opacity-40"
          >
            {isSaving ? 'Guardando…' : 'Guardar confirmación'}
          </button>
        </div>
        {isDraftDirty && <button type="button" onClick={() => { setDraft(toConfirmationDraft(confirmation, period.endMonth)); setDraftError(''); }} className="mt-2 min-h-11 rounded-lg border border-white/20 px-3 text-xs text-slate-100">Descartar borrador</button>}
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
