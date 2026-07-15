import { collection, getDocs } from 'firebase/firestore';

import type { WealthCurrency, WealthMonthlyClosure } from './wealthStorage';
import { getGastappFirestore, isGastappFirestoreConfigured } from './firebase';

const OLD_COLLECTION = 'aurum_monthly_from_periods_v1';
const CALENDAR_COLLECTION = 'aurum_monthly_calendar_v2';

type MonthlyContract = { monthKey: string; status: string | null; totalEur: number | null };

export type GastappMonthlyValidationRow = {
  monthKey: string;
  oldSpendEur: number;
  calendarSpendEur: number;
  oldReturnDisplay: number;
  calendarReturnDisplay: number;
  oldPct: number;
  calendarPct: number;
};

export type GastappMonthlyValidationResult = {
  status: 'ok' | 'missing_config' | 'unavailable' | 'error';
  error: string | null;
  rows: GastappMonthlyValidationRow[];
};

const readNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const readMonthKey = (value: unknown, fallback: string) => /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : fallback;
const round2 = (value: number) => Number(value.toFixed(2));

type FxLike = { eurClp?: number; usdClp?: number; ufClp?: number };

const toDisplay = (valueClp: number, currency: WealthCurrency, fx: FxLike) => {
  if (currency === 'CLP') return valueClp;
  const rate = currency === 'EUR' ? Number(fx.eurClp) : currency === 'USD' ? Number(fx.usdClp) : Number(fx.ufClp);
  return rate > 0 ? valueClp / rate : null;
};

const netClp = (closure: WealthMonthlyClosure, includeRisk: boolean) => {
  const value = includeRisk ? closure.summary?.netClpWithRisk : closure.summary?.netClp ?? closure.summary?.netConsolidatedClp;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

const normalizeContracts = (snapshot: Awaited<ReturnType<typeof getDocs>>) => {
  const contracts = new Map<string, MonthlyContract>();
  snapshot.forEach((entry) => {
    const data = entry.data() as Record<string, unknown>;
    const monthKey = readMonthKey(data.monthKey, entry.id);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    contracts.set(monthKey, {
      monthKey,
      status: typeof data.status === 'string' ? data.status : null,
      totalEur: readNumber(data.total_contable_eur),
    });
  });
  return contracts;
};

export const buildGastappMonthlyValidation = ({
  closures,
  oldContracts,
  calendarContracts,
  currency,
  includeRiskCapital,
}: {
  closures: WealthMonthlyClosure[];
  oldContracts: Map<string, MonthlyContract>;
  calendarContracts: Map<string, MonthlyContract>;
  currency: WealthCurrency;
  includeRiskCapital: boolean;
}) => {
  const rows: GastappMonthlyValidationRow[] = [];
  let previous: WealthMonthlyClosure | null = null;
  for (const closure of [...closures].sort((a, b) => a.monthKey.localeCompare(b.monthKey))) {
    const currentNet = netClp(closure, includeRiskCapital);
    const previousNet = previous ? netClp(previous, includeRiskCapital) : null;
    const old = oldContracts.get(closure.monthKey);
    const calendar = calendarContracts.get(closure.monthKey);
    const eurClp = Number(closure.fxRates?.eurClp);
    if (
      previousNet !== null && currentNet !== null && eurClp > 0 &&
      old?.status === 'complete' && calendar?.status === 'complete' &&
      old.totalEur !== null && calendar.totalEur !== null
    ) {
      const previousDisplay = toDisplay(previousNet, currency, previous.fxRates || {});
      const currentDisplay = toDisplay(currentNet, currency, closure.fxRates || {});
      if (previousDisplay !== null && currentDisplay !== null && previousDisplay > 0) {
        const oldSpend = toDisplay(old.totalEur * eurClp, currency, closure.fxRates || {});
        const calendarSpend = toDisplay(calendar.totalEur * eurClp, currency, closure.fxRates || {});
        if (oldSpend !== null && calendarSpend !== null) {
          const wealthDelta = currentDisplay - previousDisplay;
          const oldReturnDisplay = wealthDelta + oldSpend;
          const calendarReturnDisplay = wealthDelta + calendarSpend;
          rows.push({
            monthKey: closure.monthKey,
            oldSpendEur: old.totalEur,
            calendarSpendEur: calendar.totalEur,
            oldReturnDisplay: round2(oldReturnDisplay),
            calendarReturnDisplay: round2(calendarReturnDisplay),
            oldPct: (oldReturnDisplay / previousDisplay) * 100,
            calendarPct: (calendarReturnDisplay / previousDisplay) * 100,
          });
        }
      }
    }
    previous = closure;
  }
  return rows;
};

export const loadGastappMonthlyCalendarValidation = async (): Promise<GastappMonthlyValidationResult & { oldContracts?: Map<string, MonthlyContract>; calendarContracts?: Map<string, MonthlyContract> }> => {
  if (!isGastappFirestoreConfigured()) return { status: 'missing_config', error: 'gastapp_firestore_not_configured', rows: [] };
  const db = getGastappFirestore();
  if (!db) return { status: 'unavailable', error: 'gastapp_firestore_unavailable', rows: [] };
  try {
    const [oldSnapshot, calendarSnapshot] = await Promise.all([
      getDocs(collection(db, OLD_COLLECTION)),
      getDocs(collection(db, CALENDAR_COLLECTION)),
    ]);
    return {
      status: 'ok', error: null, rows: [],
      oldContracts: normalizeContracts(oldSnapshot),
      calendarContracts: normalizeContracts(calendarSnapshot),
    };
  } catch (error: any) {
    return { status: 'error', error: String(error?.message || error), rows: [] };
  }
};

export const calculateAnnualizedReturn = (rows: GastappMonthlyValidationRow[], kind: 'old' | 'calendar') => {
  if (!rows.length) return null;
  const factors = rows.map((row) => 1 + (kind === 'old' ? row.oldPct : row.calendarPct) / 100);
  if (factors.some((factor) => !Number.isFinite(factor) || factor <= 0)) return null;
  return (Math.pow(factors.reduce((total, factor) => total * factor, 1), 12 / rows.length) - 1) * 100;
};
