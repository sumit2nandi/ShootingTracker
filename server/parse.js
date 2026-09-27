'use strict';
// Generic "sheet" parser: HTML tables, CSV, or JSON → normalized shoot rows.
const crypto = require('crypto');
const cheerio = require('cheerio');

/* ---------------- format detection ---------------- */

function detectFormat(text) {
  const t = String(text).replace(/^\uFEFF/, '').trim();
  if (!t) return 'csv';
  if (t.startsWith('[') || t.startsWith('{')) return 'json';
  if (/<table[\s>]/i.test(t) || /<html/i.test(t)) return 'html';
  return 'csv';
}

/* ---------------- HTML ---------------- */

function parseHtml(text) {
  const $ = cheerio.load(text);
  // Use plain JS arrays for row/cell collection — cheerio's .map() flattens
  // array return values, which would destroy the row structure.
  const tables = $('table').get().map((el) => {
    const rows = $(el).find('tr').get().map((tr) => {
      const cells = $(tr).find('th, td').map((c, cell) => $(cell).text().trim()).get();
      return cells;
    });
    // drop fully empty rows
    return rows.filter((r) => Array.isArray(r) && r.some((c) => c && c.trim() !== ''));
  });

  // pick the table with the most data rows (a spreadsheet export may contain chrome)
  tables.sort((a, b) => b.length - a.length);
  const rows = tables[0] || [];
  if (!rows.length) return { headers: [], data: [] };
  const headers = rows[0].map(normalizeHeader);
  const data = rows.slice(1);
  return { headers, data };
}

/* ---------------- CSV / TSV ---------------- */

function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const counts = { ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '|': (firstLine.match(/\|/g) || []).length };
  let best = ',', n = -1;
  for (const [d, c] of Object.entries(counts)) if (c > n) { best = d; n = c; }
  return n > 0 ? best : ',';
}

function parseCsv(text) {
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows
    .map((r) => r.map((c) => decodeEntities(String(c).trim())))
    .filter((r) => r.some((c) => c !== ''));
  if (!clean.length) return { headers: [], data: [] };
  const headers = clean[0].map(normalizeHeader);
  return { headers, data: clean.slice(1) };
}

/* ---------------- JSON ---------------- */

function parseJson(text) {
  let arr;
  try {
    arr = JSON.parse(text);
  } catch {
    return { headers: [], data: [] };
  }
  if (arr && !Array.isArray(arr) && Array.isArray(arr.rows)) arr = arr.rows;
  if (!Array.isArray(arr) || !arr.length) return { headers: [], data: [] };
  const headers = [];
  for (const obj of arr) {
    if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
  }
  const data = arr.map((obj) => (obj && typeof obj === 'object' ? headers.map((h) => (obj[h] === undefined ? '' : String(obj[h]))) : []));
  return { headers, data };
}

/* ---------------- HTML entities ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–' };
function decodeEntities(s) {
  return s.replace(/&(\w+);/g, (m, k) => (ENTITIES[k.toLowerCase()] !== undefined ? ENTITIES[k.toLowerCase()] : m));
}

/* ---------------- header → field mapping ---------------- */

function normalizeHeader(h) {
  return String(h || '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_RULES = [
  // [field, predicate(normalizedHeader)]
  ['fee', (h) => ['fee', 'amount', 'price', 'earnings', 'earning', 'rate', 'charge', 'cost', 'total', 'payment amount', 'amount paid', 'paid amount', 'budget', 'shoot fee', 'value', 'amount rs', 'rs', 'remuneration', 'remuneration amount', 'pay', 'payment amount rs'].includes(h)],
  ['paid', (h) => ['paid', 'payment', 'payment status', 'paid status', 'advance', 'advance status', 'payment received'].includes(h)],
  ['shoot_date', (h) => ['date', 'shoot date', 'day', 'scheduled date', 'booking date', 'event date', 'shoot day', 'date of shoot', 'shoot day date', 'dob'].includes(h)],
  ['end_date', (h) => ['end date', 'to date', 'till date', 'last date', 'until date'].includes(h)],
  ['start_time', (h) => ['start time', 'time', 'report time', 'start', 'call time'].includes(h)],
  ['end_time', (h) => ['end time', 'completion time', 'finish time'].includes(h)],
  ['title', (h) => ['title', 'project', 'shoot title', 'shoot name', 'project name', 'job', 'campaign', 'event', 'work', 'booking', 'order title', 'description', 'shoot description', 'details'].includes(h)],
  ['client_name', (h) => ['client', 'client name', 'customer', 'brand', 'client / name', 'party', 'client name city', 'groom bride', 'couple'].includes(h)],
  ['shoot_type', (h) => ['type', 'category', 'kind', 'occasion', 'shoot type', 'event type', 'work type'].includes(h)],
  ['venue', (h) => ['venue', 'venue name', 'hall', 'hall name', 'studio', 'venue place'].includes(h)],
  ['location', (h) => ['location', 'city', 'area', 'place', 'district', 'town', 'state', 'address', 'locality'].includes(h)],
  ['coordinator', (h) => ['coordinator', 'co ordinator', 'coordinator name', 'staff', 'handled by', 'assigned to', 'assigned', 'person in charge', 'co coordinator', 'manager', 'assigned person', 'shooter', 'photographer', 'video shooter', 'team'].includes(h)],
  ['contact_name', (h) => ['contact', 'contact name', 'client contact', 'contact person', 'client contact name'].includes(h)],
  ['contact_phone', (h) => ['phone', 'mobile', 'contact number', 'number', 'whatsapp', 'phone number', 'mobile number', 'contact mobile', 'client number', 'phone no'].includes(h)],
  ['status', (h) => ['status', 'state', 'progress', 'shoot status'].includes(h)],
  ['notes', (h) => ['notes', 'remark', 'remarks', 'note', 'info', 'comments'].includes(h)]
];

function mapHeaders(headers) {
  const mapping = {}; // field -> headerIndex
  const used = new Set();
  const unmapped = [];
  headers.forEach((h, i) => {
    if (!h) return;
    for (const [field, pred] of FIELD_RULES) {
      if (mapping[field] !== undefined) continue;
      if (pred(h)) { mapping[field] = i; used.add(i); break; }
    }
  });
  headers.forEach((h, i) => {
    if (h && !used.has(i)) unmapped.push(h);
  });
  return { mapping, unmapped };
}

/* ---------------- value normalization ---------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m;
  // yyyy-mm-dd
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return fmtDate(+m[1], +m[2], +m[3]);
  }
  // dd/mm/yyyy | dd-mm-yyyy | dd.mm.yyyy (also 2-digit year)
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (y < 100) y += y >= 60 ? 1900 : 2000;
    // default day/month (India convention); if the "month" slot can't be a
    // month, the date must be US-style mm/dd/yyyy — swap.
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
    return fmtDate(y, mo, d);
  }
  // "12 Jan 2025" / "12 Jan 25" / "12-Jan-2025"
  if ((m = s.match(/^(\d{1,2})[\s\-/]+([a-z]{3,9})[\s\-/,]+(\d{2,4})/i))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mo >= 0) {
      let y = +m[3];
      if (y < 100) y += y >= 60 ? 1900 : 2000;
      return fmtDate(y, mo + 1, +m[1]);
    }
  }
  // "Jan 12 2025"
  if ((m = s.match(/^([a-z]{3,9})[\s\-/,]+(\d{1,2})[\s\-/,]+(\d{2,4})/i))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mo >= 0) {
      let y = +m[3];
      if (y < 100) y += y >= 60 ? 1900 : 2000;
      return fmtDate(y, mo + 1, +m[2]);
    }
  }
  return null;
}

function fmtDate(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(dt.getTime())) return null;
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return null; // invalid like 31 Feb
  return dt.toISOString().slice(0, 10);
}

function parseTime(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,2}):(\d{2})/))) {
    return `${String(m[1]).padStart(2, '0')}:${m[2]}:00`;
  }
  // "12 pm" style
  if ((m = s.match(/^(\d{1,2})\s*([ap])\.?\s*m\.?$/i))) {
    let h = +m[1] % 12;
    if (/^p/i.test(m[2])) h += 12;
    return `${String(h).padStart(2, '0')}:00:00`;
  }
  return null;
}

// The app tracks two states only: a shoot either still has to happen (Planned) or
// it is closed out (Completed). So a sheet that says "booked" / "confirmed" /
// "postponed" is still to come, while "done" / "delivered" / "cancelled" is over.
function normalizeStatus(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (s.includes('cancel') || s.includes('abort') || s.includes('drop')
    || s.includes('complet') || s.includes('don') || s.includes('finish')
    || s.includes('deliver') || s.includes('archive')) return 'completed';
  if (s.includes('plan') || s.includes('confirm') || s.includes('book') || s.includes('lock')
    || s.includes('schedul') || s.includes('final') || s.includes('upcoming')
    || s.includes('postpon') || s.includes('reschedul') || s.includes('hold') || s.includes('shift')) return 'planned';
  return null;
}

function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Paid-column value → payment amount (or null = unknown, 0 = definitely unpaid). */
function parsePaid(v, fee) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (/^(unpaid|not paid|no|pending|0%|none|tbd|waiting|yet)/.test(lower)) return 0;
  if (/^(paid|yes|full|complete|completed|done|100%|received|cleared)/.test(lower)) return fee || 0;
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct && fee) return Math.round((fee * +pct[1]) / 100 * 100) / 100;
  const money = parseMoney(s);
  if (money !== null) return money;
  // "5000 of 10000"
  const of = s.match(/([\d,]+)\s*(?:of|\/|out of)\s*([\d,]+)/);
  if (of) return parseMoney(of[1]);
  return null;
}

/* ---------------- row assembly ---------------- */

function rowsToShoots(table) {
  const { headers, data } = table;
  const { mapping, unmapped } = mapHeaders(headers);
  const now = new Date();
  const thisYear = now.getFullYear();
  const shoots = [];
  const problems = [];

  data.forEach((cells, idx) => {
    const get = (field) => {
      const i = mapping[field];
      return i === undefined ? '' : String(cells[i] ?? '').trim();
    };

    let shootDate = parseDate(get('shoot_date'));
    let endDate = parseDate(get('end_date'));
    let fee = parseMoney(get('fee'));
    let paid = parsePaid(get('paid'), fee);
    let status = normalizeStatus(get('status'));

    // if the "fee" column actually contains payment amounts, keep both
    let title = get('title') || null;
    const client = get('client_name') || null;
    const type = get('shoot_type') || null;

    if (!shootDate) {
      problems.push({ row: idx + 2, reason: 'no parsable date in column "' + (headers[mapping.shoot_date] || '(none)') + '"' });
      return;
    }
    if (endDate && endDate < shootDate) endDate = shootDate;
    if (!title) {
      const parts = [client, type].filter(Boolean);
      title = parts.length ? parts.join(' – ') : `Shoot on ${shootDate}`;
    }
    if (paid === null) paid = status === 'completed' ? (fee || 0) : 0;

    // everything else → extra (original normalized header)
    const extra = {};
    const usedIdx = new Set(Object.values(mapping));
    headers.forEach((h, i) => {
      if (h && !usedIdx.has(i) && String(cells[i] ?? '').trim() !== '') extra[h] = String(cells[i]).trim();
    });

    const dedupe = crypto
      .createHash('md5')
      .update(`${title.toLowerCase()}|${shootDate}|${(client || '').toLowerCase()}|${fee || 0}`)
      .digest('hex');

    shoots.push({
      title,
      client_name: client,
      shoot_type: type,
      shoot_date: shootDate,
      end_date: endDate,
      start_time: parseTime(get('start_time')),
      end_time: parseTime(get('end_time')),
      venue: get('venue') || null,
      location: get('location') || null,
      coordinator: get('coordinator') || null,
      fee: fee || 0,
      status: status || 'planned',
      contact_name: get('contact_name') || null,
      contact_phone: get('contact_phone') || null,
      notes: get('notes') || null,
      payments: paid ? [{ amount: paid, method: null, note: 'from import', paid_on: shootDate }] : [],
      extra,
      dedupe_hash: dedupe,
      _unused_year: thisYear // (kept for potential year-defaulting; harmless)
    });
  });

  return { rows: shoots, unmapped, problems };
}

function parseSheet(text, format) {
  text = String(text).replace(/^\uFEFF/, ''); // strip UTF-8 BOM (Google Sheets exports)
  format = format || detectFormat(text);
  let table;
  if (format === 'html') table = parseHtml(text);
  else if (format === 'json') table = parseJson(text);
  else table = parseCsv(text);
  if (!table.headers.length) return { rows: [], unmapped: [], problems: [{ row: 0, reason: 'no table rows found' }] };
  return rowsToShoots(table);
}

module.exports = { parseSheet, detectFormat, detectDelimiter, parseHtml, parseCsv, parseJson, parseDate, parseMoney, parsePaid, normalizeStatus, mapHeaders, normalizeHeader };
