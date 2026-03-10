import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '../Components';
import { parseStrictNumber } from '../../utils/numberUtils';
import { formatCurrency, formatMonthLabel, formatRateInt } from '../../utils/wealthFormat';
import {
  computeWealthHomeSectionAmounts,
  defaultFxRates,
  WealthFxRates,
  WealthMonthlyClosure,
  WealthRecord,
} from '../../services/wealthStorage';
import { sameCanonicalLabel } from '../../utils/wealthLabels';

export type ClosureReviewSource = 'csv' | 'manual';

export interface ClosureReviewModalResult {
  reviewedMonthKeys: string[];
  completeMonthKeys: string[];
  pendingMonthKeys: string[];
  updatedClosures: WealthMonthlyClosure[];
}

interface ClosureReviewModalProps {
  open: boolean;
  source: ClosureReviewSource;
  closures: WealthMonthlyClosure[];
  onCancel: () => void;
  onFinish: (result: ClosureReviewModalResult) => void;
}

interface ClosureComputedSummary {
  hasRecords: boolean;
  hasPropertyRecord: boolean;
  isSummaryOnly: boolean;
  hasMissingFx: boolean;
  investmentClp: number;
  bankClp: number;
  realEstateNetClp: number;
  nonMortgageDebtClp: number;
  totalNetClp: number;
}

const ensureFx = (fx?: WealthFxRates): WealthFxRates => ({
  usdClp: Number.isFinite(fx?.usdClp) && (fx?.usdClp || 0) > 0 ? (fx?.usdClp as number) : defaultFxRates.usdClp,
  eurClp: Number.isFinite(fx?.eurClp) && (fx?.eurClp || 0) > 0 ? (fx?.eurClp as number) : defaultFxRates.eurClp,
  ufClp: Number.isFinite(fx?.ufClp) && (fx?.ufClp || 0) > 0 ? (fx?.ufClp as number) : defaultFxRates.ufClp,
});

const convertToClp = (amount: number, currency: string, fx: WealthFxRates): number => {
  if (!Number.isFinite(amount)) return 0;
  if (currency === 'USD') return amount * fx.usdClp;
  if (currency === 'EUR') return amount * fx.eurClp;
  if (currency === 'UF') return amount * fx.ufClp;
  return amount;
};

const hasMissingFx = (closure: WealthMonthlyClosure) => {
  if (Array.isArray(closure.fxMissing) && closure.fxMissing.length > 0) return true;
  const fx = closure.fxRates;
  if (!fx) return true;
  return !(fx.usdClp > 0 && fx.ufClp > 0 && fx.eurClp > 0);
};

const containsPropertyRecord = (records: WealthRecord[]) =>
  records.some((record) => record.block === 'real_estate' && sameCanonicalLabel(record.label, 'Valor propiedad'));

const computeClosureSummary = (closure: WealthMonthlyClosure): ClosureComputedSummary => {
  const fx = ensureFx(closure.fxRates);
  const records = Array.isArray(closure.records) ? closure.records : [];
  const hasRecords = records.length > 0;
  const missingFx = hasMissingFx(closure);

  if (hasRecords) {
    const computed = computeWealthHomeSectionAmounts(records, fx);
    return {
      hasRecords: true,
      hasPropertyRecord: containsPropertyRecord(records),
      isSummaryOnly: false,
      hasMissingFx: missingFx,
      investmentClp: computed.investment,
      bankClp: computed.bank,
      realEstateNetClp: computed.realEstateNet,
      nonMortgageDebtClp: computed.nonMortgageDebt,
      totalNetClp: computed.totalNetClp,
    };
  }

  const summary = closure.summary;
  const byBlock = summary?.byBlock;
  const investmentClp = byBlock
    ? convertToClp(byBlock.investment.CLP, 'CLP', fx) +
      convertToClp(byBlock.investment.USD, 'USD', fx) +
      convertToClp(byBlock.investment.EUR, 'EUR', fx) +
      convertToClp(byBlock.investment.UF, 'UF', fx)
    : 0;
  const bankClp = byBlock
    ? convertToClp(byBlock.bank.CLP, 'CLP', fx) +
      convertToClp(byBlock.bank.USD, 'USD', fx) +
      convertToClp(byBlock.bank.EUR, 'EUR', fx) +
      convertToClp(byBlock.bank.UF, 'UF', fx)
    : 0;
  const realEstateNetClp = byBlock
    ? convertToClp(byBlock.real_estate.CLP, 'CLP', fx) +
      convertToClp(byBlock.real_estate.USD, 'USD', fx) +
      convertToClp(byBlock.real_estate.EUR, 'EUR', fx) +
      convertToClp(byBlock.real_estate.UF, 'UF', fx)
    : 0;
  const debtTotalClp = byBlock
    ? convertToClp(byBlock.debt.CLP, 'CLP', fx) +
      convertToClp(byBlock.debt.USD, 'USD', fx) +
      convertToClp(byBlock.debt.EUR, 'EUR', fx) +
      convertToClp(byBlock.debt.UF, 'UF', fx)
    : 0;

  return {
    hasRecords: false,
    hasPropertyRecord: false,
    isSummaryOnly: true,
    hasMissingFx: missingFx,
    investmentClp,
    bankClp,
    realEstateNetClp,
    nonMortgageDebtClp: Math.abs(debtTotalClp),
    totalNetClp: Number(summary?.netConsolidatedClp || 0),
  };
};

export const ClosureReviewModal: React.FC<ClosureReviewModalProps> = ({
  open,
  source,
  closures,
  onCancel,
  onFinish,
}) => {
  const [cursor, setCursor] = useState(0);
  const [workingClosures, setWorkingClosures] = useState<WealthMonthlyClosure[]>([]);
  const [fxDraft, setFxDraft] = useState({ usdClp: '', ufClp: '' });
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(new Set());
  const [completeKeys, setCompleteKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const sanitized = closures.map((closure) => ({
      ...closure,
      fxRates: closure.fxRates ? { ...closure.fxRates } : undefined,
      fxMissing: closure.fxMissing ? [...closure.fxMissing] : undefined,
    }));
    setWorkingClosures(sanitized);
    setCursor(0);
    setReviewedKeys(new Set());
    setCompleteKeys(new Set());
  }, [open, closures]);

  const currentClosure = workingClosures[cursor] || null;
  const currentSummary = useMemo(
    () => (currentClosure ? computeClosureSummary(currentClosure) : null),
    [currentClosure],
  );

  useEffect(() => {
    if (!currentClosure) return;
    const fx = ensureFx(currentClosure.fxRates);
    setFxDraft({
      usdClp: currentClosure.fxRates?.usdClp && currentClosure.fxRates.usdClp > 0 ? String(Math.round(fx.usdClp)) : '',
      ufClp: currentClosure.fxRates?.ufClp && currentClosure.fxRates.ufClp > 0 ? String(Math.round(fx.ufClp)) : '',
    });
  }, [currentClosure]);

  const total = workingClosures.length;
  const isDone = total === 0 || cursor >= total;

  const markPending = (monthKey: string) => {
    setReviewedKeys((prev) => {
      const next = new Set(prev);
      next.add(monthKey);
      return next;
    });
    setCompleteKeys((prev) => {
      const next = new Set(prev);
      next.delete(monthKey);
      return next;
    });
  };

  const markComplete = (monthKey: string) => {
    setReviewedKeys((prev) => {
      const next = new Set(prev);
      next.add(monthKey);
      return next;
    });
    setCompleteKeys((prev) => {
      const next = new Set(prev);
      next.add(monthKey);
      return next;
    });
  };

  const applyFxDraftToClosure = (closure: WealthMonthlyClosure): WealthMonthlyClosure => {
    const usdParsed = parseStrictNumber(fxDraft.usdClp);
    const ufParsed = parseStrictNumber(fxDraft.ufClp);
    const currentUsd = Number(closure.fxRates?.usdClp || 0);
    const currentUf = Number(closure.fxRates?.ufClp || 0);
    const currentEur = Number(closure.fxRates?.eurClp || 0);

    const usdClp = Number.isFinite(usdParsed) && usdParsed > 0 ? usdParsed : currentUsd > 0 ? currentUsd : 0;
    const ufClp = Number.isFinite(ufParsed) && ufParsed > 0 ? ufParsed : currentUf > 0 ? currentUf : 0;
    const eurClp =
      Number.isFinite(currentEur) && currentEur > 0
        ? currentEur
        : usdClp * (defaultFxRates.eurClp / defaultFxRates.usdClp);

    const fxRates: WealthFxRates = { usdClp, ufClp, eurClp };

    const missing: Array<'usdClp' | 'eurClp' | 'ufClp'> = [];
    if (!(fxRates.usdClp > 0)) missing.push('usdClp');
    if (!(fxRates.ufClp > 0)) missing.push('ufClp');
    if (!(fxRates.eurClp > 0)) missing.push('eurClp');

    return {
      ...closure,
      fxRates,
      fxMissing: missing.length ? missing : undefined,
    };
  };

  const goNext = () => {
    if (!currentClosure) return;
    markPending(currentClosure.monthKey);
    setCursor((prev) => prev + 1);
  };

  const confirmCurrent = () => {
    if (!currentClosure) return;
    const updated = applyFxDraftToClosure(currentClosure);

    setWorkingClosures((prev) =>
      prev.map((closure) => (closure.id === updated.id ? updated : closure)),
    );

    const nextSummary = computeClosureSummary(updated);
    const isComplete = !nextSummary.hasMissingFx && nextSummary.hasRecords;
    if (isComplete) markComplete(updated.monthKey);
    else markPending(updated.monthKey);

    setCursor((prev) => prev + 1);
  };

  const finish = () => {
    const reviewedMonthKeys = Array.from(reviewedKeys);
    const completeMonthKeys = Array.from(completeKeys);
    const pendingMonthKeys = workingClosures
      .map((closure) => closure.monthKey)
      .filter((monthKey) => !completeKeys.has(monthKey));

    onFinish({
      reviewedMonthKeys,
      completeMonthKeys,
      pendingMonthKeys,
      updatedClosures: workingClosures,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 px-4 py-5">
      <Card className="w-full max-w-3xl border border-slate-200 bg-white p-5 shadow-[0_22px_50px_rgba(15,23,42,0.35)]">
        {isDone ? (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-semibold text-slate-900">Revisión finalizada</div>
              <div className="text-sm text-slate-600">
                Origen: {source === 'csv' ? 'Importación CSV' : 'Ingreso manual'}.
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Completos: <span className="font-semibold">{completeKeys.size}</span>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Con faltantes: <span className="font-semibold">{Math.max(0, total - completeKeys.size)}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>
                Cancelar
              </Button>
              <Button variant="secondary" onClick={finish}>
                Guardar revisión
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Revisión de cierres</div>
                <div className="text-sm text-slate-600">
                  {source === 'csv' ? 'Importación CSV' : 'Ingreso manual'} · cierre {cursor + 1} de {total}
                </div>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                {currentClosure ? formatMonthLabel(currentClosure.monthKey) : ''}
              </div>
            </div>

            {currentClosure && currentSummary && (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  {currentSummary.isSummaryOnly ? (
                    <span className="font-medium text-amber-700">Datos resumidos: este cierre no tiene records de detalle.</span>
                  ) : (
                    <span className="font-medium text-emerald-700">Datos con detalle disponibles.</span>
                  )}
                  {currentSummary.hasMissingFx && (
                    <span className="ml-2 font-medium text-amber-700">Faltan indicadores USD/CLP y/o UF/CLP.</span>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumen del cierre</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      Bancos: <span className="font-semibold">{formatCurrency(currentSummary.bankClp, 'CLP')}</span>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      Inversiones: <span className="font-semibold">{formatCurrency(currentSummary.investmentClp, 'CLP')}</span>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      Propiedad neta:{' '}
                      <span className="font-semibold">
                        {currentSummary.hasPropertyRecord || currentSummary.isSummaryOnly
                          ? formatCurrency(currentSummary.realEstateNetClp, 'CLP')
                          : 'No aplica'}
                      </span>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      Deuda no hipotecaria:{' '}
                      <span className="font-semibold">-{formatCurrency(currentSummary.nonMortgageDebtClp, 'CLP')}</span>
                    </div>
                  </div>
                  <div className="mt-2 rounded-lg border border-slate-200 bg-[#f3eadb] px-3 py-2 text-sm text-slate-900">
                    Patrimonio total: <span className="font-semibold">{formatCurrency(currentSummary.totalNetClp, 'CLP')}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">TC/UF del cierre</div>
                  <div className="text-sm text-slate-700">
                    USD/CLP:{' '}
                    <span className="font-semibold">{formatRateInt(ensureFx(currentClosure.fxRates).usdClp)}</span> · UF/CLP:{' '}
                    <span className="font-semibold">{formatRateInt(ensureFx(currentClosure.fxRates).ufClp)}</span>
                  </div>

                  {currentSummary.hasMissingFx && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs text-slate-500">Completar USD/CLP</div>
                        <Input
                          value={fxDraft.usdClp}
                          inputMode="decimal"
                          onChange={(event) => setFxDraft((prev) => ({ ...prev, usdClp: event.target.value }))}
                          placeholder="Ej: 912"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-500">Completar UF/CLP</div>
                        <Input
                          value={fxDraft.ufClp}
                          inputMode="decimal"
                          onChange={(event) => setFxDraft((prev) => ({ ...prev, ufClp: event.target.value }))}
                          placeholder="Ej: 39825"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={goNext}>
                Siguiente
              </Button>
              <Button variant="secondary" onClick={confirmCurrent}>
                Confirmar
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};
