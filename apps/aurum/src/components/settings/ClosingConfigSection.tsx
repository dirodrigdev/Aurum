import React from 'react';
import { Button, Input } from '../Components';

export interface ClosingConfigRowView {
  key: string;
  label: string;
  enabled: boolean;
  maxAgeDays: number | null;
  supportsMaxAge: boolean;
  lastUpdatedDays: number | null;
  investmentId?: string;
}

interface ClosingConfigSectionProps {
  rows: ClosingConfigRowView[];
  onToggle: (key: string, enabled: boolean) => void;
  onMaxAgeDaysChange: (key: string, value: string) => void;
  onCloseInvestmentFromCurrentMonth: (investmentId: string) => void;
  onDeleteInvestmentCompletely: (investmentId: string) => void;
}

const renderAgeBadge = (days: number | null) => {
  if (days === null) return <span className="text-xs text-slate-500">Sin dato este mes</span>;
  if (days <= 1) return <span className="text-xs text-emerald-700">Actualizado hoy o ayer</span>;
  return <span className="text-xs text-slate-600">Última actualización: {days} día(s)</span>;
};

export const ClosingConfigSection: React.FC<ClosingConfigSectionProps> = ({
  rows,
  onToggle,
  onMaxAgeDaysChange,
  onCloseInvestmentFromCurrentMonth,
  onDeleteInvestmentCompletely,
}) => {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">Configuración de cierre</div>
        <div className="text-xs text-slate-600">
          Define qué campos exigen actualización para permitir cierre mensual.
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="rounded-xl border border-slate-200 bg-white/90 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-900">{row.label}</div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <span>{row.enabled ? 'ON' : 'OFF'}</span>
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(event) => onToggle(row.key, event.target.checked)}
                />
              </label>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {row.supportsMaxAge ? (
                row.enabled ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">Antigüedad máxima (días)</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="h-8 w-20"
                      value={row.maxAgeDays === null ? '' : String(row.maxAgeDays)}
                      onChange={(event) => onMaxAgeDaysChange(row.key, event.target.value)}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-slate-500">Antigüedad máxima: — (desactivado)</span>
                )
              ) : (
                <span className="text-xs text-slate-500">Antigüedad máxima: —</span>
              )}
              {renderAgeBadge(row.lastUpdatedDays)}
            </div>

            {row.investmentId && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCloseInvestmentFromCurrentMonth(row.investmentId as string)}
                >
                  Cerrar desde este mes
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onDeleteInvestmentCompletely(row.investmentId as string)}
                >
                  Eliminar completamente
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
