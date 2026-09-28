/**
 * "Wrap-up time" — the moment a shoot booked for today can be closed out.
 *
 * The studio works to Indian time, so the rule is written in Asia/Kolkata and
 * not in whatever zone the browser happens to sit in: once it is past 7 pm IST
 * on the day of a shoot, the day's work is done and the shoot can be marked
 * complete (and collected) straight from the dashboard.
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
 * Is this shoot happening today, with the evening already here?
 *
 * @param {string} shootDate `YYYY-MM-DD`
 * @param {Date} [now]
 */
export function isWrapUpTime(shootDate, now = new Date()) {
  if (!shootDate) return false;
  const { date, hour } = zonedNow(now);
  return String(shootDate).slice(0, 10) === date && hour >= WRAP_UP_HOUR;
}

/** What is still to be collected on a shoot (never negative). */
export function outstandingAmount(shoot) {
  const balance = (Number(shoot.fee) || 0) - (Number(shoot.paid_amount) || 0);
  return balance > 0 ? Math.round(balance * 100) / 100 : 0;
}
