// Madrid time helpers.
//
// Important: We deliberately avoid relying on the device timezone.
// We read "today" and "now" in Europe/Madrid via Intl.DateTimeFormat,
// then create Date objects using those parts (year/month/day) so downstream
// logic remains deterministic even if the device is in a different timezone.

const MADRID_TZ = 'Europe/Madrid';

type TZNowParts = {
  ymd: string; // YYYY-MM-DD (in requested TZ)
  /** Seconds since 00:00:00 in requested TZ. */
  secondsSinceMidnight: number;
  /** @deprecated Use secondsSinceMidnight */
  seconds: number;
};

const getNowPartsInTZ = (timeZone: string): TZNowParts => {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));

  return {
    ymd: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    secondsSinceMidnight: hour * 3600 + minute * 60 + second,
    // Backward compatibility (older code may read `seconds`)
    seconds: hour * 3600 + minute * 60 + second,
  };
};

export const madridNowParts = (): TZNowParts => getNowPartsInTZ(MADRID_TZ);

/**
 * Returns a Date object with the *calendar day in Madrid* and time fixed at 12:00.
 * This is safe to feed into functions that rely on getFullYear/getMonth/getDate.
 */
export const madridNoonDate = (): Date => {
  const { ymd } = madridNowParts();
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

/**
 * True if a day (YYYY-MM-DD) is already "closed" in Madrid, i.e. strictly in the past,
 * or it's today and Madrid time is >= 23:59:59.
 *
 * Used to avoid picking "future" monthly reports as default.
 */
export const isMadridDayClosed = (ymd: string): boolean => {
  if (!ymd) return true;
  const now = madridNowParts();

  const key = Number(String(ymd).replace(/-/g, ''));
  const nowKey = Number(String(now.ymd).replace(/-/g, ''));
  const endOfDaySeconds = 23 * 3600 + 59 * 60 + 59;

  if (key < nowKey) return true;
  if (key > nowKey) return false;
  return now.seconds >= endOfDaySeconds;
};
