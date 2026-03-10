import React from 'react';
import { Button, Input } from '../Components';

interface CloseValidationIssueView {
  type: string;
  label: string;
  canResolveWithPrevious?: boolean;
  canExcludeThisMonth?: boolean;
}

interface CloseConfirmModalProps {
  open: boolean;
  closeMonthDraft: string;
  monthKey: string;
  selectedClosureMonthKey?: string | null;
  recentCloseWarning: string;
  closeBlockingIssues: CloseValidationIssueView[];
  closeWarningIssues: CloseValidationIssueView[];
  closeInfo: string;
  closeError: string;
  monthLabel: (monthKey: string) => string;
  onCloseMonthDraftChange: (nextMonth: string) => void;
  onResolveWithPrevious: (issue: CloseValidationIssueView) => void;
  onResolveExclude: (issue: CloseValidationIssueView) => void;
  onReview: (issue: CloseValidationIssueView) => void;
  onCancel: () => void;
  onAttemptClose: (monthKey: string) => void;
}

export const CloseConfirmModal: React.FC<CloseConfirmModalProps> = ({
  open,
  closeMonthDraft,
  monthKey,
  selectedClosureMonthKey,
  recentCloseWarning,
  closeBlockingIssues,
  closeWarningIssues,
  closeInfo,
  closeError,
  monthLabel,
  onCloseMonthDraftChange,
  onResolveWithPrevious,
  onResolveExclude,
  onReview,
  onCancel,
  onAttemptClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 p-4 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="text-base font-semibold text-slate-900">Confirmar cierre mensual</div>
        <div className="mt-1 text-sm text-slate-600">Selecciona el mes que quieres cerrar y resuelve bloqueos aquí mismo.</div>

        <div className="mt-3">
          <label className="text-xs text-slate-600">Mes a cerrar</label>
          <Input
            type="month"
            value={closeMonthDraft}
            onChange={(e) => onCloseMonthDraftChange(e.target.value || monthKey)}
          />
        </div>

        {selectedClosureMonthKey && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Este mes ya tiene cierre ({selectedClosureMonthKey}). Si continúas, se sobrescribirá.
          </div>
        )}

        {recentCloseWarning && (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
            {recentCloseWarning}
          </div>
        )}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Bloqueos: {closeBlockingIssues.length} · Advertencias: {closeWarningIssues.length}
        </div>

        {!!closeBlockingIssues.length && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2">
            <div className="text-xs font-semibold text-red-800">Debes resolver estos bloqueos antes de cerrar:</div>
            <div className="mt-2 space-y-2">
              {closeBlockingIssues.map((issue, idx) => (
                <div key={`close-block-${issue.type}-${issue.label}-${idx}`} className="rounded border border-red-200 bg-white p-2">
                  <div className="text-xs text-red-700">{issue.label}</div>
                  {issue.type !== 'future_month' && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {issue.canResolveWithPrevious && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResolveWithPrevious(issue)}
                        >
                          Usar mes anterior
                        </Button>
                      )}
                      {issue.canExcludeThisMonth && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResolveExclude(issue)}
                        >
                          Excluir este mes
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => onReview(issue)}>
                        Revisar bloque
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!!closeWarningIssues.length && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="text-xs font-semibold text-amber-800">
              Advertencia: hay valores arrastrados de mes anterior (puedes cerrar igual)
            </div>
            <div className="mt-2 max-h-28 overflow-auto text-xs text-amber-800 space-y-1">
              {closeWarningIssues.map((issue, idx) => (
                <div key={`close-warn-${issue.type}-${issue.label}-${idx}`} className="flex items-center justify-between gap-2">
                  <span>{issue.label}</span>
                  <Button size="sm" variant="outline" onClick={() => onReview(issue)}>
                    Revisar
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!!closeInfo && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {closeInfo}
          </div>
        )}

        {!!closeError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {closeError}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={() => onAttemptClose(closeMonthDraft)} disabled={closeBlockingIssues.length > 0}>
            {selectedClosureMonthKey
              ? closeWarningIssues.length
                ? 'Sobrescribir con arrastres'
                : 'Sobrescribir cierre'
              : closeWarningIssues.length
                ? 'Cerrar con arrastres'
                : 'Confirmar cierre'}
          </Button>
        </div>
      </div>
    </div>
  );
};

