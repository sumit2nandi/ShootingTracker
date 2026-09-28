/**
 * "Wrap-up time" — when a shoot can be closed out from the dashboard.
 *
 * The studio works to Indian time, so the rule is written in Asia/Kolkata and
 * not in whatever zone the browser happens to sit in: a shoot can be marked
 * complete (and collected) from the moment it is past **7 pm IST on that
 * shoot's own date** — the evening of its day, and every moment after.
 *
 * Pure, with the clock injected, so the rule is unit-testable at any instant.
 */

export const WRAP_UP_TIME_ZONE = 'Asia/Kolkata';
export const WRAP_UP_HOUR = 19;

/**
 * The calendar date and hour of `now`, as seen in `timeZone`.
 *
 * @returns {{ date: string, hour: number }} `date` is `YYYY-MM-DD`
 */
export function zonedNow(now = new Date(), timeZone = WRAP_UP_TIME_ZONE) {
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
 * Has it been past 7 pm IST on this shoot's date?
 *
 * @param {string} shootDate `YYYY-MM-DD`
 * @param {Date} [now]
 */
export function isWrapUpTime(shootDate, now = new Date()) {
  if (!shootDate) return false;
  const { date, hour } = zonedNow(now);
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
