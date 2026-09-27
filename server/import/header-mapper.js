'use strict';

/**
 * Turn a spreadsheet header into a comparable key: lowercase, no punctuation,
 * no parenthesised units ("Fee (Rs)" → "fee").
 */
function normalizeHeader(header) {
  return String(header || '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const matchesAny = (...aliases) => {
  const set = new Set(aliases);
  return (header) => set.has(header);
};

/**
 * Header → field rules, in priority order.
 *
 * Each entry is independent data, so teaching the importer a new column name
 * means editing this table only — no parser code changes (open/closed).
 *
 * @type {ReadonlyArray<{ field: string, matches: (header: string) => boolean }>}
 */
const FIELD_RULES = Object.freeze([
  { field: 'fee', matches: matchesAny('fee', 'amount', 'price', 'earnings', 'earning', 'rate', 'charge', 'cost', 'total', 'payment amount', 'amount paid', 'paid amount', 'budget', 'shoot fee', 'value', 'amount rs', 'rs', 'remuneration', 'remuneration amount', 'pay', 'payment amount rs') },
  { field: 'paid', matches: matchesAny('paid', 'payment', 'payment status', 'paid status', 'advance', 'advance status', 'payment received') },
  { field: 'shoot_date', matches: matchesAny('date', 'shoot date', 'day', 'scheduled date', 'booking date', 'event date', 'shoot day', 'date of shoot', 'shoot day date', 'dob') },
  { field: 'end_date', matches: matchesAny('end date', 'to date', 'till date', 'last date', 'until date') },
  { field: 'start_time', matches: matchesAny('start time', 'time', 'report time', 'start', 'call time') },
  { field: 'end_time', matches: matchesAny('end time', 'completion time', 'finish time') },
  { field: 'title', matches: matchesAny('title', 'project', 'shoot title', 'shoot name', 'project name', 'job', 'campaign', 'event', 'work', 'booking', 'order title', 'description', 'shoot description', 'details') },
  { field: 'client_name', matches: matchesAny('client', 'client name', 'customer', 'brand', 'client / name', 'party', 'client name city', 'groom bride', 'couple') },
  { field: 'shoot_type', matches: matchesAny('type', 'category', 'kind', 'occasion', 'shoot type', 'event type', 'work type') },
  { field: 'venue', matches: matchesAny('venue', 'venue name', 'hall', 'hall name', 'studio', 'venue place') },
  { field: 'location', matches: matchesAny('location', 'city', 'area', 'place', 'district', 'town', 'state', 'address', 'locality') },
  { field: 'coordinator', matches: matchesAny('coordinator', 'co ordinator', 'coordinator name', 'staff', 'handled by', 'assigned to', 'assigned', 'person in charge', 'co coordinator', 'manager', 'assigned person', 'shooter', 'photographer', 'video shooter', 'team') },
  { field: 'contact_name', matches: matchesAny('contact', 'contact name', 'client contact', 'contact person', 'client contact name') },
  { field: 'contact_phone', matches: matchesAny('phone', 'mobile', 'contact number', 'number', 'whatsapp', 'phone number', 'mobile number', 'contact mobile', 'client number', 'phone no') },
  { field: 'status', matches: matchesAny('status', 'state', 'progress', 'shoot status') },
  { field: 'notes', matches: matchesAny('notes', 'remark', 'remarks', 'note', 'info', 'comments') }
]);

/**
 * Map normalized headers onto shoot fields.
 *
 * @param {string[]} headers normalized headers
 * @param {ReadonlyArray<{ field: string, matches: (header: string) => boolean }>} [rules]
 * @returns {{ mapping: Record<string, number>, unmapped: string[] }}
 */
function mapHeaders(headers, rules = FIELD_RULES) {
  const mapping = {};
  const used = new Set();
  const unmapped = [];

  headers.forEach((header, index) => {
    if (!header) return;
    for (const rule of rules) {
      if (mapping[rule.field] !== undefined) continue;
      if (rule.matches(header)) {
        mapping[rule.field] = index;
        used.add(index);
        break;
      }
    }
  });
  headers.forEach((header, index) => {
    if (header && !used.has(index)) unmapped.push(header);
  });

  return { mapping, unmapped };
}

module.exports = { normalizeHeader, mapHeaders, FIELD_RULES };
