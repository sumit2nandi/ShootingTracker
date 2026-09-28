'use strict';

/**
 * Value coercion for imported cells.
 *
 * Each parser is a small pure function: text in, a normalized value (or null)
 * out. They are the most bug-prone part of importing, and being pure they are
 * exhaustively unit-testable without a database or a sheet.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const asText = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** Two-digit years: 60–99 → 19xx, 00–59 → 20xx. */
const expandYear = (year) => (year < 100 ? year + (year >= 60 ? 1900 : 2000) : year);

/** @returns {string|null} an ISO date, or null when the parts are not a real day. */
function formatDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null; // e.g. 31 Feb
  return date.toISOString().slice(0, 10);
}

/**
 * Parse the date formats seen in real sheets:
 * `2026-04-02`, `02/04/2026`, `2-4-26`, `12 Jan 2025`, `Jan 12 2025`.
 *
 * @returns {string|null} ISO `YYYY-MM-DD`
 */
function parseDate(value) {
  const text = asText(value);
  if (!text) return null;
  let match;

  if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return formatDate(+match[1], +match[2], +match[3]);
  }
  if ((match = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/))) {
    let day = +match[1];
    let month = +match[2];
    const year = expandYear(+match[3]);
    // Day/month first (India convention); if the "month" slot cannot be a
    // month, the sheet must be US-style mm/dd/yyyy — swap.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return formatDate(year, month, day);
  }
  if ((match = text.match(/^(\d{1,2})[\s\-/]+([a-z]{3,9})[\s\-/,]+(\d{2,4})/i))) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
    if (month >= 0) return formatDate(expandYear(+match[3]), month + 1, +match[1]);
  }
  if ((match = text.match(/^([a-z]{3,9})[\s\-/,]+(\d{1,2})[\s\-/,]+(\d{2,4})/i))) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
    if (month >= 0) return formatDate(expandYear(+match[3]), month + 1, +match[2]);
  }
  return null;
}

/** `10:30`, `9 pm` → `HH:MM:SS`. */
function parseTime(value) {
  const text = asText(value);
  if (!text) return null;
  let match;
  if ((match = text.match(/^(\d{1,2}):(\d{2})/))) {
    return `${String(match[1]).padStart(2, '0')}:${match[2]}:00`;
  }
  if ((match = text.match(/^(\d{1,2})\s*([ap])\.?\s*m\.?$/i))) {
    let hour = +match[1] % 12;
    if (/^p/i.test(match[2])) hour += 12;
    return `${String(hour).padStart(2, '0')}:00:00`;
  }
  return null;
}

/** `₹ 12,500.50` → `12500.5`; anything without digits → null. */
function parseMoney(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isNaN(amount) ? null : amount;
}

/**
 * The app tracks two states only: a shoot either still has to happen (planned)
 * or it is closed out (completed). "booked" / "confirmed" / "postponed" is
 * still to come; "done" / "delivered" / "cancelled" is over.
 *
 * @returns {'planned'|'completed'|null}
 */
function parseStatus(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  const completed = ['cancel', 'abort', 'drop', 'complet', 'don', 'finish', 'deliver', 'archive'];
  const planned = ['plan', 'confirm', 'book', 'lock', 'schedul', 'final', 'upcoming', 'postpon', 'reschedul', 'hold', 'shift'];
  if (completed.some((needle) => text.includes(needle))) return 'completed';
  if (planned.some((needle) => text.includes(needle))) return 'planned';
  return null;
}

/**
 * Interpret a "paid" cell against the shoot fee.
 *
 * @returns {number|null} amount collected — null means unknown, 0 means definitely unpaid
 */
function parsePaid(value, fee) {
  const text = asText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/^(unpaid|not paid|no|pending|0%|none|tbd|waiting|yet)/.test(lower)) return 0;
  if (/^(paid|yes|full|complete|completed|done|100%|received|cleared)/.test(lower)) return fee || 0;

  const percentage = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentage && fee) return Math.round(((fee * +percentage[1]) / 100) * 100) / 100;

  const money = parseMoney(text);
  if (money !== null) return money;

  const partOf = text.match(/([\d,]+)\s*(?:of|\/|out of)\s*([\d,]+)/); // "5000 of 10000"
  if (partOf) return parseMoney(partOf[1]);
  return null;
}

module.exports = { parseDate, parseTime, parseMoney, parseStatus, parsePaid, formatDate, expandYear, MONTHS };
