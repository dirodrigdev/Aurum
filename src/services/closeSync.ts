/**
 * CloseSync
 *
 * A tiny, deterministic "sync" wrapper used by pages before writing monthly expenses.
 *
 * Goals:
 * - Ensure missing periods are auto-closed (Madrid rule: close at 23:59:59 on closing day).
 * - Keep a cached "current active period" computed in Europe/Madrid, even if device TZ differs.
 * - Provide a single in-flight lock so multiple triggers don't spawn duplicate work.
 * - Emit a local data event when the active period changes, so screens can refresh explicitly.
 */

import { calculatePeriodInfo } from '../components/Components';
import { emitDataEvent } from '../state/dataEvents';
import { getClosingConfig } from './db';
import { ensureAutoCloseMissingPeriods } from './periodClosing';
import { madridNoonDate } from '../utils/madridTime';

export type CloseSyncReason = string;

export type CurrentPeriodSnapshot = {
  periodNumber: number;
  startYMD: string;
  endYMD: string;
  periodKey: string; // `${startYMD}__${endYMD}`
};

type CloseSyncState = {
  isSyncing: boolean;
  lastReason?: CloseSyncReason;
  lastRunAtISO?: string;
  currentPeriod?: CurrentPeriodSnapshot;
};

const state: CloseSyncState = {
  isSyncing: false,
};

let inFlight: Promise<void> | null = null;
let lastStartedAt = 0;

const ymdFromDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const computeCurrentPeriod = (closingDay: number): CurrentPeriodSnapshot => {
  const p = calculatePeriodInfo(madridNoonDate(), closingDay);
  const startYMD = ymdFromDate(new Date(p.startDate));
  const endYMD = ymdFromDate(new Date(p.endDate));
  return {
    periodNumber: Number(p.periodNumber || 0),
    startYMD,
    endYMD,
    periodKey: `${startYMD}__${endYMD}`,
  };
};

export const getCloseSyncState = (): Readonly<CloseSyncState> => {
  return state;
};

/**
 * Runs the "auto-close missing periods" routine (if needed) and refreshes cached current period.
 *
 * Notes:
 * - This does NOT show UI by itself; pages may use the state/events to react.
 * - Safe to call many times; it's deduped by an in-flight lock + short cooldown.
 */
export const runCloseSync = async (reason: CloseSyncReason): Promise<void> => {
  const now = Date.now();
  // Micro-cooldown: if called repeatedly within ~1s, reuse inFlight / skip starting a new one.
  if (inFlight) return inFlight;
  if (now - lastStartedAt < 750 && state.lastRunAtISO) return;

  lastStartedAt = now;
  state.isSyncing = true;
  state.lastReason = reason;

  const prevKey = state.currentPeriod?.periodKey;

  inFlight = (async () => {
    let closingDay = 11;
    try {
      const cfg = await getClosingConfig();
      closingDay = Number((cfg as any)?.diaFijo || 11);
    } catch (e) {
      // Offline / Firestore issues: fall back to 11.
      console.warn('[closeSync] getClosingConfig failed, using diaFijo=11', e);
    }

    // 1) Ensure missing closed reports exist.
    try {
      await ensureAutoCloseMissingPeriods();
    } catch (e) {
      // Never crash the app on close attempt.
      console.error('[closeSync] ensureAutoCloseMissingPeriods failed', e);
    }

    // 2) Update cached "current period" (Madrid).
    try {
      state.currentPeriod = computeCurrentPeriod(closingDay);
    } catch (e) {
      console.error('[closeSync] computeCurrentPeriod failed', e);
    }

    state.lastRunAtISO = new Date().toISOString();

    const nextKey = state.currentPeriod?.periodKey;
    if (prevKey && nextKey && prevKey !== nextKey) {
      emitDataEvent('active_period_changed');
    }
  })()
    .finally(() => {
      state.isSyncing = false;
      inFlight = null;
    });

  return inFlight;
};
