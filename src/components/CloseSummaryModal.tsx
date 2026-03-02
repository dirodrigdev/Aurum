
import React from "react";
import { Info, BarChart3 } from "lucide-react";
import { cn, formatLocaleNumber, Card, Button } from "./Components";

export type CloseSummaryData = {
  titleLine: string; // e.g. "P32 · 12 DIC–11 ENE"
  total: number;
  currency: string;
  vsBudgetPct: number | null;
  vsPrevPct: number | null;
};

type Props = {
  open: boolean;
  data: CloseSummaryData | null;
  onClose: () => void;
  onViewDetails: () => void;
};

const formatPct = (pct: number) => {
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded}%`;
};

const formatOverUnder = (pct: number, overText: string, underText: string, equalText: string) => {
  if (pct === 0) return `0% ${equalText}`;
  if (pct > 0) return `+${formatPct(pct)} ${overText}`;
  return `${formatPct(Math.abs(pct))} ${underText}`;
};

const budgetBadgeTone = (pct: number) =>
  pct <= 0
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-red-200 bg-red-50 text-red-700";

export const CloseSummaryModal: React.FC<Props> = ({
  open,
  data,
  onClose,
  onViewDetails,
}) => {
  if (!open || !data) return null;

  const budgetText =
    data.vsBudgetPct === null
      ? "—"
      : formatOverUnder(data.vsBudgetPct, 'sobre presupuesto', 'bajo presupuesto', 'igual a presupuesto');

  const prevText =
    data.vsPrevPct === null
      ? "—"
      : formatOverUnder(data.vsPrevPct, 'sobre periodo anterior', 'bajo periodo anterior', 'igual al periodo anterior');

  const budgetTone =
    data.vsBudgetPct === null
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : budgetBadgeTone(data.vsBudgetPct);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />

      <div className="relative w-full max-w-md px-4 pb-4 sm:pb-0">
        <Card className="relative overflow-hidden border border-slate-200 bg-white shadow-xl rounded-2xl">
          <div className="absolute -right-10 -top-10 opacity-[0.08]">
            <BarChart3 size={140} />
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-semibold tracking-tight text-slate-700">
                Cierre de Periodo
              </div>
              <div className="text-[11px] tracking-wide text-slate-500">{data.titleLine}</div>
            </div>

            <div className="mt-1 text-[28px] font-extrabold tracking-tight text-slate-900">
              {formatLocaleNumber(data.total)}{data.currency}
            </div>

            <div className="mt-3 flex items-start gap-2">
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                  budgetTone,
                )}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                <span>{budgetText}</span>
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                <Info size={14} className="opacity-80" />
                <span>{prevText}</span>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button onClick={onClose} className="flex-1">
                Cerrar
              </Button>
              <Button onClick={onViewDetails} variant="outline" className="flex-1">
                Ver detalles
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
