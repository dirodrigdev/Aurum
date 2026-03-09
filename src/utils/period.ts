// Period utilities — single source of truth for Aurum period windows.
//
// Goals:
// - Stable across DST: always construct boundaries at local NOON.
// - Consistent period numbering: P1 starts on 2023-05-12 (closingDay=11).

export const DEFAULT_CLOSING_DAY = 11;

// P1 anchor: 12-May-2023 at 12:00 local time.
export const PERIOD_ANCHOR_START_NOON = new Date(2023, 4, 12, 12, 0, 0, 0);

export type PeriodInfo = {
  startNoon: Date;
  endNoon: Date;
  periodNumber: number;
  periodId: string; // e.g. "P32"
  label: string;    // same as periodId (kept for compatibility)
  startYMD: string; // yyyy-MM-dd
  endYMD: string;   // yyyy-MM-dd
};

const toNoon = (y: number, m0: number, d: number) => new Date(y, m0, d, 12, 0, 0, 0);

export const toYMD = (dt: Date) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const parseYMDToNoon = (ymd: string): Date => {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(NaN);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return toNoon(y, mo, d);
};

// Period number formula aligned with legacy calculatePeriodInfo().
// P1 corresponds to startNoon in May 2023 (month index 4): (2023-2023)*12 + 4 - 3 = 1
export const periodNumberFromStartNoon = (startNoon: Date) =>
  (startNoon.getFullYear() - 2023) * 12 + startNoon.getMonth() - 3;

export const periodIdFromNumber = (periodNumber: number) => `P${periodNumber}`;

export const endNoonFromStartNoon = (startNoon: Date, closingDay: number = DEFAULT_CLOSING_DAY): Date => {
  const y = startNoon.getFullYear();
  const m0 = startNoon.getMonth();
  let candidate = toNoon(y, m0, closingDay);
  if (candidate.getTime() < startNoon.getTime()) candidate = toNoon(y, m0 + 1, closingDay);
  return candidate;
};

export const nextStartNoonAfterEndNoon = (endNoon: Date): Date => {
  const d = new Date(endNoon);
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d;
};

export const periodRangeForDate = (date: Date = new Date(), closingDay: number = DEFAULT_CLOSING_DAY) => {
  const y = date.getFullYear();
  const m0 = date.getMonth();
  const day = date.getDate();

  let startNoon: Date;
  let endNoon: Date;

  if (day > closingDay) {
    startNoon = toNoon(y, m0, closingDay + 1);
    endNoon = toNoon(y, m0 + 1, closingDay);
  } else {
    startNoon = toNoon(y, m0 - 1, closingDay + 1);
    endNoon = toNoon(y, m0, closingDay);
  }

  return { startNoon, endNoon };
};

export const periodInfoForDate = (date: Date = new Date(), closingDay: number = DEFAULT_CLOSING_DAY): PeriodInfo => {
  const { startNoon, endNoon } = periodRangeForDate(date, closingDay);
  const periodNumber = periodNumberFromStartNoon(startNoon);
  const periodId = periodIdFromNumber(periodNumber);
  return {
    startNoon,
    endNoon,
    periodNumber,
    periodId,
    label: periodId,
    startYMD: toYMD(startNoon),
    endYMD: toYMD(endNoon),
  };
};

export const periodInfoForISODate = (isoDate: string, closingDay: number = DEFAULT_CLOSING_DAY): PeriodInfo => {
  const d = new Date(isoDate);
  if (!isNaN(d.getTime())) return periodInfoForDate(d, closingDay);

  // fallback: try yyyy-MM-dd
  const ymd = String(isoDate || '').slice(0, 10);
  const dd = parseYMDToNoon(ymd);
  if (!isNaN(dd.getTime())) return periodInfoForDate(dd, closingDay);

  return periodInfoForDate(new Date(), closingDay);
};

export const periodNumberFromStartYMD = (startYMD: string) => {
  const d = parseYMDToNoon(startYMD);
  if (isNaN(d.getTime())) return NaN;
  return periodNumberFromStartNoon(d);
};
