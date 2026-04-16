import { useEffect, useRef, useState } from 'react';
import {
  computeWealthHomeSectionAmounts,
  currentMonthKey,
  FX_RATES_UPDATED_EVENT,
  loadFxRates,
  loadIncludeRiskCapitalInTotals,
  loadWealthRecords,
  latestRecordsForMonth,
  resolveRiskCapitalRecordsForTotals,
  RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
  WEALTH_DATA_UPDATED_EVENT,
} from '../services/wealthStorage';

type WealthSnapshot = {
  totalNetClp: number;
  investment: number;
  bank: number;
  realEstateNet: number;
  nonMortgageDebt: number;
  usdClp: number;
  eurClp: number;
  ufClp: number;
};

type WealthDeltaToastState = {
  visible: boolean;
  delta: number;
  reason: string;
};

export const WEALTH_DELTA_TOAST_TRIGGER_EVENT = 'aurum:wealth-delta-toast-trigger';

const EPSILON = 0.5;

const differs = (a: number, b: number) => Math.abs(a - b) >= EPSILON;

const buildSnapshot = (): WealthSnapshot => {
  const monthKey = currentMonthKey();
  const records = latestRecordsForMonth(loadWealthRecords(), monthKey);
  const includeRiskCapital = loadIncludeRiskCapitalInTotals();
  const fx = loadFxRates();
  const recordsForTotals = resolveRiskCapitalRecordsForTotals(records, includeRiskCapital).recordsForTotals;
  const amounts = computeWealthHomeSectionAmounts(recordsForTotals, fx);
  return {
    totalNetClp: amounts.totalNetClp,
    investment: amounts.investment,
    bank: amounts.bank,
    realEstateNet: amounts.realEstateNet,
    nonMortgageDebt: amounts.nonMortgageDebt,
    usdClp: fx.usdClp,
    eurClp: fx.eurClp,
    ufClp: fx.ufClp,
  };
};

const inferReasons = (previous: WealthSnapshot, next: WealthSnapshot, trigger: 'wealth' | 'fx' | 'risk') => {
  const reasons: string[] = [];
  if (differs(previous.investment, next.investment)) reasons.push('Inversiones actualizadas');
  if (differs(previous.realEstateNet, next.realEstateNet)) reasons.push('Bienes raíces actualizados');
  if (differs(previous.bank, next.bank)) reasons.push('Bancos actualizados');
  if (differs(previous.nonMortgageDebt, next.nonMortgageDebt)) reasons.push('Deudas actualizadas');

  const fxChanged =
    differs(previous.usdClp, next.usdClp) ||
    differs(previous.eurClp, next.eurClp) ||
    differs(previous.ufClp, next.ufClp);
  if (!reasons.length && (trigger === 'fx' || fxChanged)) reasons.push('Tipo de cambio actualizado');
  if (!reasons.length && trigger === 'risk') reasons.push('Capital de riesgo aplicado');
  if (!reasons.length) reasons.push('Patrimonio actualizado');
  return reasons;
};

const summarizeReasons = (reasons: Set<string>) => {
  const items = Array.from(reasons);
  if (!items.length) return '';
  if (items.length <= 2) return items.join(' · ');
  return `${items.slice(0, 2).join(' · ')} +${items.length - 2} cambios`;
};

export const useWealthDelta = () => {
  const [toast, setToast] = useState<WealthDeltaToastState>({
    visible: false,
    delta: 0,
    reason: '',
  });

  const baselineRef = useRef<WealthSnapshot | null>(null);
  const pendingDeltaRef = useRef(0);
  const pendingReasonsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    baselineRef.current = buildSnapshot();

    const clearTimer = () => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const restartTimer = () => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setToast((current) => ({ ...current, visible: false }));
        pendingDeltaRef.current = 0;
        pendingReasonsRef.current.clear();
      }, 3000);
    };

    const processChange = (trigger: 'wealth' | 'fx' | 'risk') => {
      const previous = baselineRef.current;
      const next = buildSnapshot();
      if (!previous) {
        baselineRef.current = next;
        return;
      }
      baselineRef.current = next;
      const delta = next.totalNetClp - previous.totalNetClp;
      if (!differs(delta, 0)) return;

      const reasons = inferReasons(previous, next, trigger);
      reasons.forEach((reason) => pendingReasonsRef.current.add(reason));
      pendingDeltaRef.current += delta;

      setToast({
        visible: true,
        delta: pendingDeltaRef.current,
        reason: summarizeReasons(pendingReasonsRef.current),
      });
      restartTimer();
    };

    const onWealthUpdated = () => processChange('wealth');
    const onFxUpdated = () => processChange('fx');
    const onRiskUpdated = () => processChange('risk');
    const onStorage = () => processChange('wealth');
    const onManualToastTrigger = (event: Event) => {
      const detail = (event as CustomEvent<{ delta?: number; reason?: string }>).detail || {};
      const delta = Number(detail.delta || 0);
      if (!differs(delta, 0)) return;
      pendingReasonsRef.current.clear();
      pendingDeltaRef.current = delta;
      if (detail.reason) pendingReasonsRef.current.add(String(detail.reason));
      setToast({
        visible: true,
        delta: pendingDeltaRef.current,
        reason: summarizeReasons(pendingReasonsRef.current),
      });
      restartTimer();
    };

    window.addEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
    window.addEventListener(FX_RATES_UPDATED_EVENT, onFxUpdated as EventListener);
    window.addEventListener(
      RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
      onRiskUpdated as EventListener,
    );
    window.addEventListener('storage', onStorage);
    window.addEventListener(WEALTH_DELTA_TOAST_TRIGGER_EVENT, onManualToastTrigger as EventListener);

    return () => {
      clearTimer();
      window.removeEventListener(WEALTH_DATA_UPDATED_EVENT, onWealthUpdated as EventListener);
      window.removeEventListener(FX_RATES_UPDATED_EVENT, onFxUpdated as EventListener);
      window.removeEventListener(
        RISK_CAPITAL_TOTALS_PREFERENCE_UPDATED_EVENT,
        onRiskUpdated as EventListener,
      );
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(WEALTH_DELTA_TOAST_TRIGGER_EVENT, onManualToastTrigger as EventListener);
    };
  }, []);

  return toast;
};
