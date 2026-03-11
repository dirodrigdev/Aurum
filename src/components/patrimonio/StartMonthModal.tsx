import React from 'react';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Loader2, PlayCircle, X, XCircle } from 'lucide-react';
import { Button } from '../Components';
import { formatCurrency } from '../../utils/wealthFormat';

export type StartMonthStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface StartMonthStepView {
  key: 'carry' | 'mortgage' | 'fx';
  title: string;
  status: StartMonthStepStatus;
  deltaClp: number;
  message?: string;
}

interface StartMonthModalProps {
  open: boolean;
  monthLabel: string;
  previousMonthLabel: string | null;
  steps: StartMonthStepView[];
  running: boolean;
  completed: boolean;
  flowError: string;
  finalNetClp: number | null;
  variationVsPreviousClp: number | null;
  onStart: () => void;
  onConfirmStart: () => void;
  onClose: () => void;
}

const StepStatusIcon: React.FC<{ status: StartMonthStepStatus }> = ({ status }) => {
  if (status === 'running') return <Loader2 size={15} className="animate-spin text-blue-600" />;
  if (status === 'done') return <CheckCircle2 size={15} className="text-emerald-600" />;
  if (status === 'error') return <XCircle size={15} className="text-red-600" />;
  return <PlayCircle size={15} className="text-slate-400" />;
};

const StepDelta: React.FC<{ value: number }> = ({ value }) => {
  if (Math.abs(value) < 0.5) return <span className="text-[11px] text-slate-500">Sin variación</span>;
  const positive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${positive ? 'text-emerald-700' : 'text-red-700'}`}>
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {positive ? '+' : '-'}
      {formatCurrency(Math.abs(value), 'CLP')}
    </span>
  );
};

export const StartMonthModal: React.FC<StartMonthModalProps> = ({
  open,
  monthLabel,
  previousMonthLabel,
  steps,
  running,
  completed,
  flowError,
  finalNetClp,
  variationVsPreviousClp,
  onStart,
  onConfirmStart,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/45 p-4 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-semibold text-slate-900">Comenzar {monthLabel}</div>
          <button
            type="button"
            className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            aria-label="Posponer arranque"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mt-1 text-sm text-slate-600">
          Se ejecutará el arranque del mes en 3 pasos secuenciales con impacto en patrimonio.
        </div>

        <div className="mt-3 space-y-2">
          {steps.map((step) => (
            <div
              key={step.key}
              className={`rounded-xl border px-3 py-2 transition-all duration-300 ${
                step.status === 'running'
                  ? 'border-blue-200 bg-blue-50/70'
                  : step.status === 'done'
                    ? 'border-emerald-200 bg-emerald-50/70'
                    : step.status === 'error'
                      ? 'border-red-200 bg-red-50/70'
                      : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm text-slate-800">
                  <StepStatusIcon status={step.status} />
                  <span>{step.title}</span>
                </div>
                {(step.status === 'done' || step.status === 'error') && <StepDelta value={step.deltaClp} />}
              </div>
              {!!step.message && (
                <div
                  className={`mt-1 text-[11px] ${
                    step.status === 'error' ? 'text-red-700' : 'text-slate-600'
                  }`}
                >
                  {step.message}
                </div>
              )}
            </div>
          ))}
        </div>

        {!!flowError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {flowError}
          </div>
        )}

        {completed && finalNetClp !== null && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Patrimonio inicial de {monthLabel}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(finalNetClp, 'CLP')}</div>
            <div className="mt-1 text-xs text-slate-600">
              Variación respecto a {previousMonthLabel || 'mes anterior'}:{' '}
              {variationVsPreviousClp === null ? (
                'sin base de comparación'
              ) : (
                <span className={variationVsPreviousClp >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                  {variationVsPreviousClp >= 0 ? '+' : '-'}
                  {formatCurrency(Math.abs(variationVsPreviousClp), 'CLP')}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onClose}>
            Ahora no
          </Button>
          {completed ? (
            <Button onClick={onConfirmStart}>Comenzar {monthLabel}</Button>
          ) : (
            <Button onClick={onStart} disabled={running}>
              {running ? 'Procesando...' : 'Iniciar arranque'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
