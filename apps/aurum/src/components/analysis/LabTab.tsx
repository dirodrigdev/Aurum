import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { Card, cn } from '../Components';
import { type WealthLabWindow, buildWealthLabModel, selectWealthLabPeriod } from '../../services/wealthLab';
import {
  PERFORMANCE_FINAL_MONTH,
  PERFORMANCE_INITIAL_MONTH,
  MAX_FINANCIAL_PERFORMANCE_FLOWS,
  isFinancialPerformanceConfirmationValid,
  reconcileFinancialPerformance,
  type FinancialPerformanceConfirmation,
  type FinancialPerformanceFlow,
  type PerformanceFlowDirection,
} from '../../services/financialPerformance';
import {
  appendFinancialPerformanceConfirmation,
  loadFinancialPerformanceConfirmation,
} from '../../services/financialPerformanceStorage';
import type { WealthMonthlyClosure } from '../../services/wealthStorage';
import { formatMonthLabel as monthLabel } from '../../utils/wealthFormat';
import { formatFreedomCompactClp } from './shared';

const LAB_WINDOW_OPTIONS: Array<{ key: WealthLabWindow; label: string }> = [
  { key: 'since_start', label: 'Desde inicio' },
  { key: 'last_12m', label: 'Últ. 12M' },
  { key: 'last_month', label: 'Últ. mes' },
];

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

const emptyConfirmationDraft = (): ConfirmationDraft => ({
  schemaVersion: 1,
  monthKey: PERFORMANCE_FINAL_MONTH,
  flowCompleteness: 'incomplete',
  positionMovementCompleteness: 'unconfirmed',
  flows: [],
});

const toConfirmationDraft = (confirmation: FinancialPerformanceConfirmation | null): ConfirmationDraft =>
  confirmation
    ? {
        schemaVersion: 1,
        monthKey: PERFORMANCE_FINAL_MONTH,
        flowCompleteness: confirmation.flowCompleteness,
        positionMovementCompleteness: confirmation.positionMovementCompleteness,
        flows: confirmation.flows.map((flow) => ({ ...flow, amountClp: String(flow.amountClp) })),
      }
    : emptyConfirmationDraft();

const formatPerformancePct = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;

const formatFlowCount = (draft: ConfirmationDraft) =>
  `${draft.flows.length} ${draft.flows.length === 1 ? 'movimiento' : 'movimientos'}`;

const FinancialPerformanceSlice: React.FC<{
  closures: WealthMonthlyClosure[];
  includeRiskCapital: boolean;
}> = ({ closures, includeRiskCapital }) => {
  const [confirmation, setConfirmation] = useState<FinancialPerformanceConfirmation | null>(null);
  const [draft, setDraft] = useState<ConfirmationDraft>(emptyConfirmationDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draftError, setDraftError] = useState('');

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void loadFinancialPerformanceConfirmation()
      .then((loaded) => {
        if (!active) return;
        setConfirmation(loaded);
        setDraft(toConfirmationDraft(loaded));
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
  }, []);

  const persistedDraft = useMemo(() => toConfirmationDraft(confirmation), [confirmation]);
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
  const previewConfirmation = useMemo<FinancialPerformanceConfirmation>(() => ({
    schemaVersion: 1,
    monthKey: PERFORMANCE_FINAL_MONTH,
    flowCompleteness: draft.flowCompleteness,
    positionMovementCompleteness: draft.positionMovementCompleteness,
    flows: draft.flows.map((flow) => ({ ...flow, amountClp: Number(flow.amountClp) })),
  }), [draft]);
  const result = useMemo(
    () => reconcileFinancialPerformance({ closures, confirmation: previewConfirmation, includeRiskCapital }),
    [closures, previewConfirmation, includeRiskCapital],
  );

  const persistDraft = async (nextDraft: ConfirmationDraft) => {
    const confirmationInput: FinancialPerformanceConfirmation = {
      schemaVersion: 1,
      monthKey: PERFORMANCE_FINAL_MONTH,
      flowCompleteness: nextDraft.flowCompleteness,
      positionMovementCompleteness: nextDraft.positionMovementCompleteness,
      flows: nextDraft.flows.map((flow) => ({
        ...flow,
        amountClp: Number(flow.amountClp),
        ...(flow.note?.trim() ? { note: flow.note.trim() } : { note: undefined }),
        ...(flow.reference?.trim() ? { reference: flow.reference.trim() } : { reference: undefined }),
      })),
    };
    if (!isFinancialPerformanceConfirmationValid(confirmationInput)) {
      setDraftError('Revisa que cada movimiento tenga tipo, fecha válida del período y monto CLP mayor que cero.');
      return;
    }
    setIsSaving(true);
    setDraftError('');
    try {
      const saved = await appendFinancialPerformanceConfirmation(confirmationInput);
      setConfirmation(saved);
      setDraft(toConfirmationDraft(saved));
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
          effectiveDate: '2026-08-31',
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

  const flowCompletenessLabel = draft.flowCompleteness === 'complete'
    ? `Lista completa · ${formatFlowCount(draft)}`
    : 'Lista incompleta / no sé';
  const flowNetValue = result.flowListComplete || draft.flows.length > 0
    ? formatFreedomCompactClp(result.confirmedFlowsNetClp)
    : 'No confirmado';
  const flowEquationValue = result.flowListComplete
    ? formatFreedomCompactClp(result.confirmedFlowsNetClp)
    : draft.flows.length > 0
      ? `parcial ${formatFreedomCompactClp(result.confirmedFlowsNetClp)}`
      : 'sin confirmar';
  const moneyValue = (value: number | null) => value === null ? 'No atribuible' : formatFreedomCompactClp(value);
  const coverageValue = (status: 'no_exposure' | 'not_evaluated' | 'evaluated', value: number | null) =>
    status === 'no_exposure'
      ? 'No aplica · sin exposición'
      : status === 'not_evaluated'
        ? 'Pendiente de atribución'
        : `${(value ?? 0).toFixed(0)}%`;

  return (
    <Card className="mt-3 border-slate-200 bg-gradient-to-br from-[#0b1728] via-[#10203a] to-[#12284a] p-4 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Performance financiera V1</div>
          <h3 className="mt-1 text-base font-semibold text-white">Julio → agosto 2026</h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-300/80">
            Cierres de inversión comparables. La variación de saldo no se presenta como rentabilidad mientras falte confirmar la lista de flujos.
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-2.5 py-1 text-[10px] font-semibold',
          result.quality === 'RECONSTRUIDO'
            ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200'
            : result.quality === 'INSUFICIENTE'
              ? 'border-rose-300/40 bg-rose-300/10 text-rose-200'
              : 'border-amber-300/40 bg-amber-300/10 text-amber-200',
        )}>
          {result.quality}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Variación observada · no rentabilidad</div>
          <div className="mt-1 text-lg font-semibold text-white">{moneyValue(result.observedChange)}</div>
          <div className="text-[11px] text-slate-300">{formatPerformancePct(result.observedChangePct)} cambio de saldo</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Aportes / retiros</div>
          <div className="mt-1 text-lg font-semibold text-white">{flowNetValue}</div>
          <div className="text-[11px] text-slate-300">{flowCompletenessLabel}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Resultado de cartera</div>
          <div className="mt-1 text-lg font-semibold text-white">{moneyValue(result.portfolioResult)}</div>
          <div className="text-[11px] text-slate-300">Sólo con lista de flujos completa</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Rentabilidad financiera</div>
          <div className="mt-1 text-lg font-semibold text-white">{formatPerformancePct(result.returnPct)}</div>
          <div className="text-[11px] text-slate-300">
            {result.returnMethod === 'simple'
              ? 'Simple'
              : result.returnMethod === 'simple_adjusted'
                ? 'Simple ajustado'
                : result.returnMethod === 'modified_dietz'
                  ? 'Modified Dietz · reconstruido'
                  : 'No disponible'}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Resultado de inversiones atribuible</div>
          <div className="mt-1 text-sm font-semibold text-white">{moneyValue(result.investmentAttributable)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Efecto FX · USD / EUR</div>
          <div className="mt-1 text-sm font-semibold text-white">{moneyValue(result.fxAttributable)}</div>
          <div className="text-[11px] text-slate-300">Cobertura: {coverageValue(result.fxCoverageStatus, result.fxCoveragePct)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Indexación UF</div>
          <div className="mt-1 text-sm font-semibold text-white">{moneyValue(result.ufAttributable)}</div>
          <div className="text-[11px] text-slate-300">Cobertura: {coverageValue(result.ufCoverageStatus, result.ufCoveragePct)}</div>
        </div>
        <div className="rounded-xl border border-amber-200/20 bg-amber-200/5 p-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-100/70">No explicado / no atribuido</div>
          <div className="mt-1 text-sm font-semibold text-amber-100">{moneyValue(result.unexplainedResidual)}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-slate-300">
        <div className="font-semibold text-slate-100">Reconciliación</div>
        <div className="mt-1 break-words">
          ΔV {moneyValue(result.observedChange)} = flujos {flowEquationValue} + inversión {moneyValue(result.investmentAttributable)} + FX {moneyValue(result.fxAttributable)} + UF {moneyValue(result.ufAttributable)} + no explicado {moneyValue(result.unexplainedResidual)}
        </div>
        <div className="mt-1 text-slate-400">{result.qualityReason}</div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white">Confirmación manual de flujos</div>
            <div className="text-[11px] text-slate-300/80">
              Cierre inicial {PERFORMANCE_INITIAL_MONTH} · cierre final {PERFORMANCE_FINAL_MONTH}
              {confirmation?.revision ? ` · revisión ${confirmation.revision}` : ''}
              {isDraftDirty ? ' · vista previa sin guardar' : ''}
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
            disabled={!storageReady || isLoading || isSaving}
            onClick={saveNoFlows}
            className="min-h-9 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
          >
            No hubo flujos este mes
          </button>
          <button
            type="button"
            disabled={!storageReady || isLoading || isSaving || draft.flows.length >= MAX_FINANCIAL_PERFORMANCE_FLOWS}
            onClick={() => addFlow('aporte')}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar aporte
          </button>
          <button
            type="button"
            disabled={!storageReady || isLoading || isSaving || draft.flows.length >= MAX_FINANCIAL_PERFORMANCE_FLOWS}
            onClick={() => addFlow('retiro')}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
          >
            <Plus size={13} /> Agregar retiro
          </button>
        </div>

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
                    min="2026-07-31"
                    max="2026-08-31"
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
              Esta confirmación independiente habilita la atribución de posiciones. Si hubo operaciones internas o cambió una exposición, déjala sin marcar.
            </p>
          </div>
          <button
            type="button"
            disabled={!storageReady || isLoading || isSaving}
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

export const LabTab: React.FC<LabTabProps> = ({ model, closures, includeRiskCapitalInTotals, onToggleRiskMode }) => {
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
    <>
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
    <FinancialPerformanceSlice closures={closures} includeRiskCapital={includeRiskCapitalInTotals} />
    </>
  );
};
