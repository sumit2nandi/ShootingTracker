/**
 * "Wrap-up time" — when a shoot can be closed out from the dashboard.
 *
 * Use the timezone configured on the user's device (which follows their
 * location) for date boundaries and the wrap-up cutoff. A shoot can be marked
 * complete and collected after 7 pm on its own local calendar date.
 *
 * Pure, with the clock injected, so the rule is unit-testable at any instant.
 */

export const WRAP_UP_TIME_ZONE = 'Asia/Kolkata'; // fallback when the device timezone is unavailable
export const WRAP_UP_HOUR = 19;

/** IANA timezone from the user's device/location, without requesting GPS access. */
export function userTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || WRAP_UP_TIME_ZONE;
  } catch {
    return WRAP_UP_TIME_ZONE;
  }
}

/**
 * The calendar date and hour of `now`, as seen in `timeZone`.
 *
 * @returns {{ date: string, hour: number }} `date` is `YYYY-MM-DD`
 */
export function zonedNow(now = new Date(), timeZone = userTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = (type) => (parts.find((part) => part.type === type) || {}).value;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) };
}

/**
 * Has it been past 7 pm in the user's timezone on this entry's date?
 *
 * @param {string} shootDate `YYYY-MM-DD`
 * @param {Date} [now]
 */
export function isWrapUpTime(shootDate, now = new Date(), timeZone = userTimeZone()) {
  if (!shootDate) return false;
  const { date, hour } = zonedNow(now, timeZone);
  const shoot = String(shootDate).slice(0, 10);
  if (shoot < date) return true; // its day — and its 7 pm — has already passed
  if (shoot > date) return false; // its day (and 7 pm) has not come yet
  return hour >= WRAP_UP_HOUR; // on its day: from 7 pm onwards
}

/** What is still to be collected on a shoot (never negative). */
export function outstandingAmount(shoot) {
  const balance = (Number(shoot.fee) || 0) - (Number(shoot.paid_amount) || 0);
  return balance > 0 ? Math.round(balance * 100) / 100 : 0;
}
