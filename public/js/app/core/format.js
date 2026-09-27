/** Locale-aware formatting. Pure functions, unit-tested without a browser. */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const formatMoney = (value) =>
  '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Compact money for chart labels: ₹2.5Cr, ₹2.5L, ₹45k, ₹800. */
export function formatMoneyShort(value) {
  const amount = Math.abs(Number(value) || 0);
  const oneDecimal = (n) => {
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  if (amount >= 1e7) return '₹' + oneDecimal(amount / 1e7) + 'Cr';
  if (amount >= 1e5) return '₹' + oneDecimal(amount / 1e5) + 'L';
  if (amount >= 1000) return '₹' + Math.round(amount / 1000) + 'k';
  return '₹' + Math.round(amount);
}

/** Local `YYYY-MM-DD` key for a Date (never UTC-shifted). */
export const dayKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** `2026-04-02` → `2 Apr 2026`. */
export function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return `${day} ${MONTH_SHORT[month - 1]} ${year}`;
}

/** `2026-04-02` → `2 Apr` (the month/year come from the group heading on phones). */
export function formatShortDate(value) {
  if (!value) return '—';
  const [, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!month || !day) return String(value);
  return `${day} ${MONTH_SHORT[month - 1]}`;
}

/** `14:30:00` → `2:30 pm`. */
export function formatTime(value) {
  if (!value) return '';
  const [hours, minutes] = String(value).split(':');
  const suffix = Number(hours) >= 12 ? 'pm' : 'am';
  const hour12 = Number(hours) % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

/** `2026-04` → `Apr 2026`. */
export function formatMonth(yearMonth) {
  const [year, month] = String(yearMonth).split('-').map(Number);
  return `${MONTH_SHORT[month - 1]} ${year}`;
}

/** Inclusive day count of a (possibly multi-day) shoot. */
export function daySpan(startDate, endDate) {
  if (!endDate || endDate === startDate) return 1;
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
  return Math.max(1, days);
}
