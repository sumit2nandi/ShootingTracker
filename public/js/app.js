'use strict';
/* ================= ShootingTracker SPA ================= */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  view: 'dashboard',
  filters: { month: '', coordinator: '', status: '', paymentStatus: '', q: '' },
  viewFilters: {}, // per-view filter memory
  meta: { statuses: [], coordinators: [], clients: [], types: [], months: [] },
  cal: { year: new Date().getFullYear(), month: new Date().getMonth() },
  user: null,          // the signed-in account (role decides who can manage access)
  calView: 'grid',
  shootsFiltersOpen: false, // shoots-tab filter bar starts collapsed
  shootsExpandAll: false,  // set when the user arrives from a dashboard tile
  dbOk: null
};

/* ---------- api ---------- */

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET') };
  if (opts.body !== undefined) {
    if (opts.raw) { init.body = opts.body; }
    else { init.body = JSON.stringify(opts.body); init.headers = { 'Content-Type': 'application/json' }; }
  }
  const res = await fetch(path, init);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401) {
    window.location.replace('/');
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------- formatting ---------- */

const fmtMoney = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
/* short form for the labels printed above the chart bars: ₹2.5L, ₹45k, ₹800 */
const fmtMoneyShort = (n) => {
  const v = Math.abs(Number(n) || 0);
  const r1 = (x) => { const t = Math.round(x * 10) / 10; return Number.isInteger(t) ? String(t) : t.toFixed(1); };
  if (v >= 1e7) return '₹' + r1(v / 1e7) + 'Cr';
  if (v >= 1e5) return '₹' + r1(v / 1e5) + 'L';
  if (v >= 1000) return '₹' + Math.round(v / 1000) + 'k';
  return '₹' + Math.round(v);
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}
/* "22 Sep" — the month/year already come from the group heading on phones */
function shortDate(s) {
  if (!s) return '—';
  const [, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!m || !d) return String(s);
  return `${d} ${MONTH_SHORT[m - 1]}`;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, mi] = String(t).split(':');
  let hh = +h; const ap = hh >= 12 ? 'pm' : 'am'; hh = hh % 12 || 12;
  return `${hh}:${mi} ${ap}`;
}

/* ---------- db status ---------- */

async function pollHealth() {
  const pill = $('#db-status');
  try {
    const h = await api('/api/health');
    state.dbOk = h.ok;
    pill.className = `db-pill ${h.ok ? 'ok' : 'bad'}`;
    pill.title = h.ok ? `Connected (${h.latencyMs} ms)` : `DB unreachable: ${h.detail}`;
    $('.db-pill-text', pill).textContent = h.ok ? 'DB connected' : 'DB unreachable';
    if (!h.ok) $('#main').insertAdjacentHTML('afterbegin', dbBanner(h.detail));
  } catch (e) {
    state.dbOk = false;
    pill.className = 'db-pill bad';
    $('.db-pill-text', pill).textContent = 'offline';
  }
  if (state.dbOk) { const b = $('#db-banner'); if (b) b.remove(); }
}
function dbBanner(detail) {
  if ($('#db-banner')) return '';
  return `<div id="db-banner" class="card" style="border-color:rgba(239,93,111,.5)">
    <b>⚠️ Database unreachable.</b> <span class="muted">${esc(detail)}</span><br/>
    <span class="muted small">Check <code>.env → DATABASE_URL</code> (Aiven: add this host's IP to the allowlist, and apply
    <code>server/schema.sql</code> if you haven't). Retrying automatically…</span>
  </div>`;
}
setInterval(pollHealth, 30000);

/* ---------- meta + filters ---------- */

async function loadMeta() {
  try {
    state.meta = await api('/api/meta');
  } catch { return; }
  fillSelect('#f-month', state.meta.months, '', true);
  fillSelect('#f-coordinator', state.meta.coordinators.map((c) => c.name));
  // status filter mirrors whatever the API reports (Planned / Completed)
  {
    const el = $('#f-status');
    const cur = el.value;
    const list = (state.meta.statuses || []).filter((s) => STATUS_ORDER.includes(s));
    el.innerHTML = '<option value="">All statuses</option>' +
      list.map((s) => `<option value="${esc(s)}">${esc(statusLabel(s))}</option>`).join('');
    if (list.includes(cur)) el.value = cur;
  }
  $('#dl-coordinators').innerHTML = state.meta.coordinators.map((c) => `<option value="${esc(c.name)}">`).join('');
  $('#dl-clients').innerHTML = state.meta.clients.map((c) => `<option value="${esc(c)}">`).join('');
  $('#dl-types').innerHTML = state.meta.types.map((t) => `<option value="${esc(t)}">`).join('');
  fillFormCoordinators();
  fillCalSelects();
}

function fillFormCoordinators() {
  const sel = $('#sel-coordinator');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML =
    '<option value="">— none —</option>' +
    state.meta.coordinators.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('') +
    '<option value="__new__">➕ New coordinator…</option>';
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function fillCalSelects() {
  const ysel = $('#cal-year'), msel = $('#cal-month');
  if (!ysel) return;
  const years = new Set((state.meta.months || []).map((m) => +String(m).slice(0, 4)));
  years.add(new Date().getFullYear());
  const list = [...years].sort((a, b) => a - b);
  const lo = Math.min(...list) - 1, hi = Math.max(...list) + 1;
  const keep = ysel.value;
  ysel.innerHTML = [];
  for (let y = lo; y <= hi; y++) ysel.innerHTML += `<option value="${y}">${y}</option>`;
  if (keep && ysel.querySelector(`option[value="${keep}"]`)) ysel.value = keep;
  msel.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  msel.value = String(state.cal.month);
}

function fillSelect(sel, values, selected = '', withAll = false) {
  const el = $(sel);
  const cur = el.value;
  el.innerHTML = (withAll ? '<option value="">All</option>' : '<option value="">All</option>') +
    values.map((v) => {
      const label = withAll && v !== 'all' ? monthLabel(v) : v;
      return `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
  if (cur && values.includes(cur) || (withAll && cur === 'all')) el.value = cur;
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

function filterParams() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) if (v) p.set(k, v);
  return p.toString();
}

let filterTimer = null;
function onFilterChange() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => refreshCurrent(), 180);
}
function readFilters() {
  state.filters = {
    month: $('#f-month').value,
    coordinator: $('#f-coordinator').value,
    status: $('#f-status').value,
    paymentStatus: $('#f-payment').value,
    q: $('#f-q').value.trim()
  };
}
function clearFilters() {
  $('#f-month').value = ''; $('#f-coordinator').value = '';
  $('#f-status').value = ''; $('#f-payment').value = ''; $('#f-q').value = '';
  readFilters(); refreshCurrent();
}

/* ---------- routing ---------- */

function setView(v) {
  if (state.view !== 'calendar' && v !== state.view) state.viewFilters[state.view] = readFilters();
  if (v !== 'shoots') state.shootsExpandAll = false;   // the tile-driven expansion is one-shot
  state.view = v;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  for (const el of $$('.view')) el.classList.toggle('hidden', el.id !== `view-${v}`);
  const showFilters = v === 'dashboard' || (v === 'shoots' && state.shootsFiltersOpen);
  $('#filterbar').classList.toggle('hidden', v === 'calendar' || !showFilters);
  $('#filterbar').dataset.for = v;
  restoreViewFilters(v);
  refreshCurrent(false);
}

function restoreViewFilters(v) {
  const f = state.viewFilters[v] || { month: '', coordinator: '', status: '', paymentStatus: '', q: '' };
  state.filters = { month: f.month || '', coordinator: f.coordinator || '', status: f.status || '', paymentStatus: f.paymentStatus || '', q: f.q || '' };
  $('#f-month').value = state.filters.month;
  $('#f-coordinator').value = state.filters.coordinator;
  $('#f-status').value = (state.meta.statuses || []).includes(state.filters.status) ? state.filters.status : '';
  $('#f-payment').value = ['paid', 'partial', 'unpaid', 'outstanding'].includes(state.filters.paymentStatus) ? state.filters.paymentStatus : '';
  $('#f-q').value = state.filters.q;
}

function refreshCurrent(reRead = true) {
  if (reRead) readFilters();
  if (state.view === 'dashboard') return loadDashboard();
  if (state.view === 'shoots') return loadShoots();
  if (state.view === 'calendar') return loadCalendar();
}

/* ---------- dashboard ---------- */

async function loadDashboard() {
  try {
    const d = await api('/api/dashboard?' + filterParams());
    let daily = null;
    if (state.filters.month) {
      // month selected → earnings chart shows per-day earnings for that month
      const rows = await api('/api/shoots?' + filterParams());
      const byDay = {};
      for (const s of rows) {
        const k = String(s.shoot_date).slice(0, 10);
        byDay[k] = (byDay[k] || 0) + (+s.fee || 0);
      }
      daily = Object.entries(byDay).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, fee]) => ({ date, fee }));
    }
    renderDashboard(d, daily);
  } catch (e) { toast('Dashboard: ' + e.message, 'err'); }
}

function renderDashboard(d, daily) {
  const k = d.kpi || {};
  // six tiles, in count/amount pairs: total → completed → planned.
  // tiles are clickable → open the Shoots tab with the matching filter.
  // (note: unquoted SQL aliases come back lowercased, hence k.paidshoots)
  $('#kpi-row').innerHTML = `
    <div class="kpi accent" data-goto="{}" role="button" tabindex="0"><div class="kpi-label">Total shoots</div><div class="kpi-value">${k.shoots ?? 0}</div><div class="kpi-sub">${k.active ?? 0} planned · ${k.completed ?? 0} completed</div></div>
    <div class="kpi violet" data-goto="{}" role="button" tabindex="0"><div class="kpi-label">Total fee</div><div class="kpi-value">${fmtMoney(k.total_fee)}</div><div class="kpi-sub">booked earnings</div></div>
    <div class="kpi red" data-goto='{"status":"completed"}' role="button" tabindex="0"><div class="kpi-label">Completed</div><div class="kpi-value">${k.completed ?? 0}</div><div class="kpi-sub">of ${k.shoots ?? 0} total</div></div>
    <div class="kpi green" data-goto='{"paymentStatus":"paid"}' role="button" tabindex="0"><div class="kpi-label">Total received</div><div class="kpi-value">${fmtMoney(k.total_paid)}</div><div class="kpi-sub">${k.paidshoots ?? 0} shoots fully paid</div></div>
    <div class="kpi" data-goto='{"status":"planned"}' role="button" tabindex="0"><div class="kpi-label">Planned</div><div class="kpi-value">${k.active ?? 0}</div><div class="kpi-sub">still to come</div></div>
    <div class="kpi amber" data-goto='{"paymentStatus":"outstanding"}' role="button" tabindex="0"><div class="kpi-label">Outstanding</div><div class="kpi-value">${fmtMoney(k.outstanding)}</div><div class="kpi-sub">${k.outstandingshoots ?? 0} shoots with a balance</div></div>`;

  renderEarnings(d.monthly || [], daily);
  renderStatusDonut(d.byStatus || []);
  renderCoordinators(d.byCoordinator || []);
  renderTypes(d.byType || []);
  renderUpcoming(d.upcoming || []);
}

function renderEarnings(monthly, daily) {
  const wrap = $('#chart-monthly');
  const title = $('#chart-title');
  if (daily) {
    title.textContent = 'Earnings by day';
    if (!daily.length) {
      wrap.innerHTML = '<div class="empty">No shoots in this month</div>';
      $('#chart-range').textContent = '';
      return;
    }
    const max = Math.max(...daily.map((d) => d.fee), 1);
    const label = (d) => { const [, m, dd] = d.split('-').map(Number); return `${MONTH_SHORT[m - 1]} ${dd}`; };
    wrap.innerHTML = `<div class="bars">${daily.map((d) => `
      <div class="bar-col">
        <div class="bar-pair">
          <div class="bar fee" style="height:${(d.fee / max) * 100}%" title="${label(d.date)} — ${fmtMoney(d.fee)}" data-lbl="${label(d.date)}" data-val="${d.fee}"><span class="bar-val">${d.fee ? fmtMoneyShort(d.fee) : ''}</span></div>
        </div>
        <div class="bar-label">${+d.date.slice(8, 10)}</div>
      </div>`).join('')}</div>`;
    $('#chart-range').textContent = `${label(daily[0].date)} – ${label(daily[daily.length - 1].date)}`;
    return;
  }
  title.textContent = 'Earnings by month';
  const months = (monthly || []).slice(-12).reverse().map((m) => ({ ym: m.ym, fee: +m.fee }));
  if (!months.length) {
    wrap.innerHTML = '<div class="empty">No data for this filter</div>';
    $('#chart-range').textContent = '';
    return;
  }
  const max = Math.max(...months.map((m) => m.fee), 1);
  const label = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`; };
  wrap.innerHTML = `<div class="bars">${months.map((m) => `
      <div class="bar-col">
        <div class="bar-pair">
          <div class="bar fee" style="height:${(m.fee / max) * 100}%" title="${label(m.ym)} — ${fmtMoney(m.fee)}" data-lbl="${label(m.ym)}" data-val="${m.fee}"><span class="bar-val">${m.fee ? fmtMoneyShort(m.fee) : ''}</span></div>
        </div>
        <div class="bar-label">${label(m.ym)}</div>
      </div>`).join('')}</div>`;
  $('#chart-range').textContent = `${label(months[0].ym)} – ${label(months[months.length - 1].ym)}`;
}

const STATUS_COLORS = { planned: '#7b8ea3', completed: '#15803d' };
const STATUS_ORDER = Object.keys(STATUS_COLORS);
const statusLabel = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
/* Rows imported before the app settled on two states may still carry
   "confirmed" / "postponed" / "cancelled"; fold them into Planned or Completed
   so every screen, filter and legend only ever shows the two real states. */
const appStatus = (s) => (s === 'completed' || s === 'cancelled' ? 'completed' : 'planned');
const statusPill = (s) => `<span class="pill ${appStatus(s)}">${statusLabel(appStatus(s))}</span>`;

function renderStatusDonut(byStatus) {
  const wrap = $('#chart-status');
  // fold any legacy status into Planned / Completed before charting
  const totals = new Map();
  for (const s of byStatus) {
    const key = appStatus(s.status);
    totals.set(key, (totals.get(key) || 0) + s.n);
  }
  const rows = STATUS_ORDER.filter((st) => totals.has(st)).map((st) => ({ status: st, n: totals.get(st) }));
  const total = rows.reduce((a, b) => a + b.n, 0);
  if (!total) { wrap.innerHTML = '<div class="empty">No data for this filter</div>'; return; }
  const R = 56, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = rows.map((s) => {
    const frac = s.n / total;
    const seg = { color: STATUS_COLORS[s.status] || '#888', dash: `${frac * C} ${C}`, off: -offset * C, status: s.status, n: s.n };
    offset += frac;
    return seg;
  });
  wrap.innerHTML = `
    <svg width="160" height="160" viewBox="0 0 160 160">
      <g transform="rotate(-90 80 80)">
        ${segs.map((s) => `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${s.color}" stroke-width="22" stroke-dasharray="${s.dash}" stroke-dashoffset="${s.off}"></circle>`).join('')}
      </g>
      <text x="80" y="76" text-anchor="middle" fill="#e8edf5" font-size="26" font-weight="700">${total}</text>
      <text x="80" y="97" text-anchor="middle" fill="#8b98ad" font-size="11">shoots</text>
    </svg>
    <div class="donut-legend">
      ${rows.map((s) => `<div class="row"><i style="background:${STATUS_COLORS[s.status] || '#888'}"></i>${esc(statusLabel(s.status))}<span class="n">${s.n}</span></div>`).join('')}
    </div>`;
}

function renderCoordinators(list) {
  const wrap = $('#list-coordinators');
  if (!list.length) { wrap.innerHTML = '<div class="empty">No data for this filter</div>'; return; }
  const max = Math.max(...list.map((c) => +c.fee), 1);
  wrap.innerHTML = `<div class="coord-list">` + list.map((c) => `
    <div class="coord-row">
      <div class="coord-top"><span>${esc(c.name)}</span><span class="amt">${c.shoots} shoots · ${fmtMoney(c.fee)}</span></div>
      <div class="coord-track"><div class="coord-fill" style="width:${Math.max(2, (+c.fee / max) * 100)}%"></div></div>
    </div>`).join('') + `</div>`;
}

function renderTypes(list) {
  const wrap = $('#list-types');
  if (!list.length) { wrap.innerHTML = '<div class="empty">No data for this filter</div>'; return; }
  wrap.innerHTML = list.map((t) => `<div class="type-chip"><b>${t.shoots}</b> ${esc(t.type)} <span class="amt">${fmtMoney(t.fee)}</span></div>`).join('');
}

function renderUpcoming(list) {
  const wrap = $('#upcoming-table');
  if (!list.length) { wrap.innerHTML = '<div class="empty">Nothing scheduled in the next 7 days 🎉</div>'; return; }
  wrap.innerHTML = `
    <table class="upcoming-table"><tbody>${list.map((s) => `
      <tr data-id="${s.id}">
        <td class="td-mono td-date">${fmtDate(s.shoot_date)}</td>
        <td>${esc(s.title)}</td>
      </tr>`).join('')}</tbody></table>`;
  $$('#upcoming-table tbody tr').forEach((tr) => tr.addEventListener('click', () => openDrawer(+tr.dataset.id)));
}

/* ---------- calendar ---------- */

/* The grid is a horizontal scroller with three pages (prev / current / next
   month) so phones can swipe between months; each load fetches the whole
   window and the day map covers it end to end. A sequence token drops stale
   responses when months change faster than the network. */
let calSeq = 0;

async function loadCalendar(opts = {}) {
  syncCalToolbar();
  const { year, month } = state.cal;
  const from = dayKey(new Date(year, month - 1, 1));
  const to = dayKey(new Date(year, month + 2, 0));
  const seq = ++calSeq;
  try {
    const shoots = await api(`/api/shoots?from=${from}&to=${to}`);
    if (seq !== calSeq) return;
    // map by date (support multi-day ranges)
    const byDate = {};
    for (const s of shoots) {
      let d = new Date(s.shoot_date + 'T00:00:00');
      const end = s.end_date ? new Date(s.end_date + 'T00:00:00') : d;
      for (let i = 0; i < 30 && d <= end; i++) {
        const k = dayKey(d);
        (byDate[k] = byDate[k] || []).push(s);
        d = new Date(d.getTime() + 86400000);
      }
    }
    state.calByDate = byDate;
    renderCalLegend();
    if (state.calView === 'list') renderCalendarList();
    else renderCalendarGrid(opts.recenter !== false);
  } catch (e) { toast('Calendar: ' + e.message, 'err'); }
}

function syncCalToolbar() {
  const { year, month } = state.cal;
  const ysel = $('#cal-year'), msel = $('#cal-month');
  if (ysel && !ysel.querySelector(`option[value="${year}"]`)) {
    const o = document.createElement('option');
    o.value = year; o.textContent = year; ysel.appendChild(o);
  }
  if (ysel) ysel.value = String(year);
  if (msel) msel.value = String(month);
}

/* Legend mirrors the event chips exactly (same colours and left bar) and only
   lists the statuses that actually occur in the month on screen. */
function renderCalLegend() {
  const { year, month } = state.cal;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const idsByStatus = new Map();
  for (let d = 1; d <= daysInMonth; d++) {
    const k = dayKey(new Date(year, month, d));
    for (const s of (state.calByDate || {})[k] || []) {
      if (!s) continue;
      const key = appStatus(s.status);
      if (!idsByStatus.has(key)) idsByStatus.set(key, new Set());
      idsByStatus.get(key).add(s.id);
    }
  }
  const present = STATUS_ORDER.filter((st) => idsByStatus.has(st));
  const wrap = $('#cal-legend');
  if (!present.length) {
    wrap.innerHTML = `<span class="legend-empty">No shoots in ${MONTH_NAMES[state.cal.month]} ${state.cal.year}</span>`;
    return;
  }
  wrap.innerHTML = present.map((st) => {
    const n = idsByStatus.get(st).size;
    return `<span class="legend-item"><i class="legend-swatch ${st}"></i>${statusLabel(st)}<span class="legend-n">${n}</span></span>`;
  }).join('');
}

function renderCalendarList() {
  const { year, month } = state.cal;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const wrap = $('#cal-list');
  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const k = dayKey(new Date(year, month, d));
    const shoots = (state.calByDate || {})[k];
    if (!shoots || !shoots.length) continue;
    const dt = new Date(year, month, d);
    rows.push(`
      <div class="cal-list-row" data-date="${k}">
        <div class="cl-date"><span class="cl-dow">${DOW[dt.getDay()]}</span><span class="cl-day">${d}</span><span class="cl-mon">${MONTH_SHORT[month]}</span></div>
        <div class="cl-events">
          ${shoots.map((s) => `<div class="cl-event" data-id="${s.id}">
            <span class="cl-title">${esc(s.title)}</span>
            <span class="cl-fee td-mono">${fmtMoney(s.fee)}</span>
            ${statusPill(s.status)}
          </div>`).join('')}
        </div>
      </div>`);
  }
  wrap.innerHTML = rows.length ? rows.join('') :
    `<div class="empty">No shoots in ${MONTH_NAMES[month]} ${year} — use the Grid view to tap a day and add one.</div>`;
  $$('#cal-list .cl-event').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(+el.dataset.id); }));
  $$('#cal-list .cal-list-row').forEach((r) => r.addEventListener('click', () => openShootModal(null, r.dataset.date)));
}

function setCalView(v) {
  state.calView = v;
  const listMode = v === 'list';
  $('#view-calendar').classList.toggle('list-mode', listMode);
  $('#cal-list').classList.toggle('hidden', !listMode);
  $('#cal-view-grid').classList.toggle('active', !listMode);
  $('#cal-view-list').classList.toggle('active', listMode);
  $('#cal-view-grid').setAttribute('aria-pressed', String(!listMode));
  $('#cal-view-list').setAttribute('aria-pressed', String(listMode));
  if (listMode) renderCalendarList();
  else renderCalendarGrid();
}

/* One month's grid cells as HTML. `month` may sit outside 0–11 so the same
   builder can paint the neighbouring pages of the swipeable window. */
function calMonthCells(year, month) {
  const m = ((month % 12) + 12) % 12;
  const y = year + Math.floor(month / 12);
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startDow = first.getDay();
  const todayK = dayKey(new Date());
  const cells = [];
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(y, m, 1 - startDow + i);
    const k = dayKey(d);
    const inMonth = d.getMonth() === m && d.getFullYear() === y;
    const shoots = (state.calByDate || {})[k] || [];
    const shown = shoots.slice(0, 3);
    cells.push(`
      <div class="cal-cell ${inMonth ? '' : 'dim'} ${k === todayK ? 'today' : ''}" data-date="${k}">
        <div class="cal-dayno"><span>${d.getDate()}</span></div>
        <div class="cal-chips">
          ${shown.map((s) => `<div class="cal-chip ${appStatus(s.status)}" data-id="${s.id}" title="${esc(s.title)}${s.venue ? ' — ' + esc(s.venue) : ''}">${esc(s.title)}</div>`).join('')}
          ${shoots.length > 3 ? `<div class="cal-more" data-date="${k}">+${shoots.length - 3} more…</div>` : ''}
        </div>
      </div>`);
  }
  return cells.join('');
}

function renderCalendarGrid(recenter = true) {
  const { year, month } = state.cal;
  $$('#cal-scroll .cal-page').forEach((page) => {
    $('.cal-grid', page).innerHTML = calMonthCells(year, month + Number(page.dataset.delta));
  });
  // events
  $$('#cal-scroll .cal-chip').forEach((chip) => chip.addEventListener('click', (ev) => { ev.stopPropagation(); openDrawer(+chip.dataset.id); }));
  $$('#cal-scroll .cal-cell').forEach((cell) => cell.addEventListener('click', () => openShootModal(null, cell.dataset.date)));
  $$('#cal-scroll .cal-more').forEach((m) => m.addEventListener('click', (ev) => { ev.stopPropagation(); openDayPanel(ev.currentTarget.dataset.date); }));
  if (recenter) {
    const wrap = $('#cal-scroll');
    if (wrap) wrap.scrollLeft = wrap.clientWidth;   // park on the middle page
  }
}

function openDayPanel(dateK) {
  const shoots = (state.calByDate || {})[dateK] || [];
  const drawer = $('#drawer');
  drawer.innerHTML = `
    <div class="drawer-head">
      <div class="drawer-head-txt">
        <h2>${fmtDate(dateK)}</h2>
        <div class="sub">${shoots.length} shoot${shoots.length === 1 ? '' : 's'} on this day</div>
      </div>
      <button class="btn popup-close" data-close aria-label="Close" title="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    ${shoots.map((s) => `
      <div class="pay-row" data-id="${s.id}" style="cursor:pointer">
        ${statusPill(s.status)}
        <span>${esc(s.title)}</span>
        <span class="amt">${fmtMoney(s.fee)}</span>
      </div>`).join('')}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="dp-add">+ Add shoot on ${fmtDate(dateK)}</button>
      <button class="btn btn-ghost" data-close>Close</button>
    </div>`;
  $('#drawer-backdrop').classList.remove('hidden');
  $$('#drawer .pay-row[data-id]').forEach((r) => r.addEventListener('click', () => openDrawer(+r.dataset.id)));
  $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
  $('#dp-add').addEventListener('click', () => { $('#drawer-backdrop').classList.add('hidden'); openShootModal(null, dateK); });
}

/* Month navigation is shared by the toolbar buttons, the month/year selects
   and the horizontal swipe on the grid: jump state, repaint from the cache at
   once (keeps swiping smooth) and refresh data without touching the scroll
   position the user is at. */
function calGoto(year, month) {
  state.cal.year = year + Math.floor(month / 12);
  state.cal.month = ((month % 12) + 12) % 12;
  syncCalToolbar();
  renderCalLegend();
  if (state.calView === 'list') renderCalendarList();
  else renderCalendarGrid(true);
  loadCalendar({ recenter: false });
}

function calShift(delta) {
  calGoto(state.cal.year, state.cal.month + delta);
}

$('#cal-prev').addEventListener('click', () => calShift(-1));
$('#cal-next').addEventListener('click', () => calShift(1));
$('#cal-today').addEventListener('click', () => { const n = new Date(); calGoto(n.getFullYear(), n.getMonth()); });

/* Horizontal swipe pages through months: the scroller holds three pages
   (prev/current/next) and once it settles on an edge page that month becomes
   current and the window recenters on it. The 150 ms debounce covers browsers
   without the `scrollend` event (same routine either way, and a settled
   middle page is a no-op). */
function calScrollDelta(scrollLeft, pageWidth) {
  if (!pageWidth) return 0;
  if (scrollLeft < pageWidth * 0.5) return -1;
  if (scrollLeft > pageWidth * 1.5) return 1;
  return 0;
}

function calSettle() {
  const wrap = $('#cal-scroll');
  if (!wrap) return;
  const delta = calScrollDelta(wrap.scrollLeft, wrap.clientWidth);
  if (delta) calShift(delta);
}

let calSettleTimer = 0;
$('#cal-scroll').addEventListener('scroll', () => {
  clearTimeout(calSettleTimer);
  calSettleTimer = setTimeout(calSettle, 150);
}, { passive: true });
$('#cal-scroll').addEventListener('scrollend', () => {
  clearTimeout(calSettleTimer);
  calSettle();
});

let calResizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(calResizeTimer);
  calResizeTimer = setTimeout(() => {
    if (state.view === 'calendar' && state.calView === 'grid') {
      const wrap = $('#cal-scroll');
      if (wrap) wrap.scrollLeft = wrap.clientWidth;
    }
  }, 150);
});

/* ---------- shoots table ---------- */

// Reaching this tab from a dashboard tile (Outstanding, Planned, …) lands on a
// filtered list, so offer a one-tap way back to every shoot.
const hasActiveFilters = () => {
  const f = state.filters;
  return !!(f.month || f.coordinator || f.status || f.paymentStatus || f.q);
};

function syncShootsReset() {
  const btn = $('#btn-shoots-reset');
  if (btn) btn.hidden = !hasActiveFilters();
}

function resetShootsFilters() {
  state.viewFilters.shoots = { month: '', coordinator: '', status: '', paymentStatus: '', q: '' };
  state.filters = { month: '', coordinator: '', status: '', paymentStatus: '', q: '' };
  $('#f-month').value = ''; $('#f-coordinator').value = '';
  $('#f-status').value = ''; $('#f-payment').value = ''; $('#f-q').value = '';
  syncShootsReset();
  refreshCurrent(false);
  toast('Showing all shoots');
}

async function loadShoots() {
  try {
    const rows = await api('/api/shoots?' + filterParams());
    renderShoots(rows);
  } catch (e) { toast('Shoots: ' + e.message, 'err'); }
}

function renderShoots(rows) {
  $('#shoots-count').textContent = `${rows.length} shown`;
  syncShootsReset();
  const wrap = $('#shoots-table');
  if (!rows.length) {
    wrap.innerHTML = hasActiveFilters()
      ? '<div class="empty">No shoots match this filter — tap “Show all” to clear it.</div>'
      : '<div class="empty">No shoots yet — add one with “+ New shoot”.</div>';
    return;
  }

  const groups = new Map();
  rows.forEach((shoot) => {
    const ym = String(shoot.shoot_date || '').slice(0, 7) || 'undated';
    if (!groups.has(ym)) groups.set(ym, []);
    groups.get(ym).push(shoot);
  });
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const headings = (ym) => ym === 'undated' ? 'Undated' : monthLabel(ym);
  // arriving from a dashboard tile means "show me everything", so open every group
  const isOpen = (ym) => state.shootsExpandAll || ym === currentMonth;
  const tableFor = (monthRows) => `
    <table class="shoots-table">
      <thead><tr><th>Date</th><th>Title</th><th>Coordinator</th><th class="num">Fee</th><th class="col-pay">Payment</th><th class="col-status">Status</th></tr></thead>
      <tbody>${monthRows.map((s) => {
        const paid = s.payment_status === 'paid';
        const paymentLabel = s.payment_status === 'partial' ? 'Partially paid' : statusLabel(s.payment_status);
        const multiDay = s.end_date && s.end_date !== s.shoot_date;
        const daySpan = multiDay
          ? Math.max(1, Math.round((new Date(s.end_date) - new Date(s.shoot_date)) / 86400000) + 1)
          : 0;
        const fullDate = multiDay ? `${fmtDate(s.shoot_date)} → ${fmtDate(s.end_date)}` : fmtDate(s.shoot_date);
        return `
          <tr data-id="${s.id}" title="${esc(fullDate)}">
            <td class="td-mono cell-date"><span class="d-full">${fmtDate(s.shoot_date)}</span><span class="d-short">${esc(shortDate(s.shoot_date))}</span>${multiDay ? `<span class="cell-range"> → ${fmtDate(s.end_date)}</span>` : ''}${daySpan > 1 ? `<span class="cell-days" title="${daySpan}-day shoot">+${daySpan - 1}d</span>` : ''}</td>
            <td class="cell-title">${esc(s.title)}</td>
            <td class="cell-coord">${esc(s.coordinator || '—')}</td>
            <td class="num td-mono">
              <span class="fee-bubble ${paid ? 'paid' : 'due'}" title="${esc(paymentLabel)}" aria-label="${esc(fmtMoney(s.fee))}, ${esc(paymentLabel)}">${fmtMoney(s.fee)}</span>
            </td>
            <td class="col-pay"><span class="pill ${s.payment_status}">${esc(paymentLabel)}</span></td>
            <td class="col-status">${statusPill(s.status)}</td>
          </tr>`;
      }).join('')}</tbody>
    </table>`;

  wrap.innerHTML = [...groups.entries()].map(([ym, monthRows]) => `
    <details class="shoot-month" ${isOpen(ym) ? 'open' : ''}>
      <summary><span>${esc(headings(ym))}</span><span class="month-count">${monthRows.length} shoot${monthRows.length === 1 ? '' : 's'}</span></summary>
      ${tableFor(monthRows)}
    </details>`).join('');
  $$('#shoots-table tbody tr').forEach((tr) => tr.addEventListener('click', () => openDrawer(+tr.dataset.id)));
}

/* ---------- shoot modal ---------- */

function openShootModal(shoot, presetDate) {
  const f = $('#shoot-form');
  f.reset();
  $('#shoot-modal-title').textContent = shoot ? 'Edit shoot' : 'New shoot';
  const set = (name, val) => { f[name].value = val ?? ''; };
  set('id', shoot?.id); set('title', shoot?.title); set('client_name', shoot?.client_name);
  set('shoot_type', shoot?.shoot_type); set('shoot_date', shoot?.shoot_date || presetDate || dayKey(new Date()));
  set('end_date', shoot?.end_date); set('start_time', shoot?.start_time ? String(shoot.start_time).slice(0, 5) : '');
  set('end_time', shoot?.end_time ? String(shoot.end_time).slice(0, 5) : '');
  set('venue', shoot?.venue); set('location', shoot?.location);
  set('fee', shoot?.fee ?? 0); set('contact_name', shoot?.contact_name);
  set('contact_phone', shoot?.contact_phone); set('notes', shoot?.notes);
  // coordinator: existing → dropdown option; unknown → "new" mode with text field
  const coordSel = $('#sel-coordinator'), coordNew = $('#coord-new-input');
  const known = shoot?.coordinator && state.meta.coordinators.some((c) => c.name === shoot.coordinator);
  if (shoot?.coordinator) {
    coordSel.value = known ? shoot.coordinator : '__new__';
    coordNew.value = known ? '' : shoot.coordinator;
  } else { coordSel.value = ''; coordNew.value = ''; }
  coordNew.hidden = coordSel.value !== '__new__';
  // status: the app only knows Planned and Completed
  const stSel = $('#sel-status');
  stSel.value = appStatus(shoot?.status);
  $('#shoot-modal').classList.remove('hidden');
  setTimeout(() => f.title.focus(), 50);
}
function formCoordinatorValue() {
  const sel = $('#sel-coordinator');
  return sel.value === '__new__' ? $('#coord-new-input').value.trim() : sel.value;
}
function closeShootModal() { $('#shoot-modal').classList.add('hidden'); }

$('#btn-new-shoot').addEventListener('click', () => openShootModal(null));
$('#btn-save-shoot').addEventListener('click', async () => {
  const f = $('#shoot-form');
  const body = {
    title: f.title.value.trim(), client_name: f.client_name.value.trim() || null,
    shoot_type: f.shoot_type.value.trim() || null, shoot_date: f.shoot_date.value,
    end_date: f.end_date.value || null, start_time: f.start_time.value || null,
    end_time: f.end_time.value || null, venue: f.venue.value.trim() || null,
    location: f.location.value.trim() || null, coordinator: formCoordinatorValue() || null,
    fee: f.fee.value || 0, status: f.status.value, contact_name: f.contact_name.value.trim() || null,
    contact_phone: f.contact_phone.value.trim() || null, notes: f.notes.value.trim() || null
  };
  if (!body.title || !body.shoot_date) { toast('Title and shoot date are required', 'err'); return; }
  const id = f.id.value;
  try {
    if (id) { await api(`/api/shoots/${id}`, { method: 'PUT', body }); toast('Shoot updated'); }
    else { await api('/api/shoots', { body }); toast('Shoot added'); }
    closeShootModal();
    loadMeta();
    refreshCurrent();
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
});

/* ---------- people with access (owner only) ---------- */

let accessCache = null;

async function openAccess() {
  $('#access-modal').classList.remove('hidden');
  $('#access-list').innerHTML = '<div class="empty">Loading…</div>';
  await refreshAccess();
}

function closeAccess() { $('#access-modal').classList.add('hidden'); }

async function refreshAccess() {
  let data;
  try { data = await api('/api/users'); }
  catch (e) { $('#access-list').innerHTML = `<div class="empty">Could not load the list: ${esc(e.message)}</div>`; return; }
  accessCache = data.users || [];
  const me = String(state.user && state.user.email || '').toLowerCase();
  const owners = accessCache.filter((u) => u.is_active && u.role === 'owner').length;
  $('#access-list').innerHTML = accessCache.map((u) => {
    const isMe = String(u.email).toLowerCase() === me;
    const isLastOwner = u.role === 'owner' && u.is_active && owners <= 1;
    return `
      <div class="access-row${u.is_active ? '' : ' off'}">
        <div class="access-who">
          <b>${esc(u.name || u.email)}</b>
          <span class="muted small">${esc(u.email)}${isMe ? ' · you' : ''}</span>
        </div>
        <span class="pill ${u.role === 'owner' ? 'owner' : 'unpaid'}">${u.role === 'owner' ? 'Owner' : 'Member'}</span>
        <div class="access-actions">
          <button class="btn btn-ghost" data-toggle="${u.id}" data-active="${u.is_active}"
            ${u.role === 'owner' && u.is_active && owners <= 1 ? 'disabled title="At least one active owner is required"' : ''}>${u.is_active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-ghost" data-remove="${u.id}" ${isMe ? 'disabled title="You cannot remove your own access"' : ''}>Remove</button>
        </div>
      </div>`;
  }).join('') || '<div class="empty">Nobody yet.</div>';
  $$('#access-list [data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/api/users/${b.dataset.toggle}`, { method: 'PATCH', body: { is_active: b.dataset.active !== 'true' } });
      toast('Access updated');
      await refreshAccess();
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  }));
  $$('#access-list [data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this person from the allow-list?')) return;
    b.disabled = true;
    try {
      await api(`/api/users/${b.dataset.remove}`, { method: 'DELETE' });
      toast('Access removed');
      await refreshAccess();
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  }));
}

$('#access-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { email: f.email.value.trim(), name: f.name.value.trim(), role: f.role.value };
  if (!body.email) return;
  try {
    await api('/api/users', { body });
    f.reset();
    toast(`${body.email} can now sign in`);
    await refreshAccess();
  } catch (err) { toast(err.message, 'err'); }
});

/* ---------- detail drawer ---------- */

/* One key/value row for the drawer. Rows whose value is empty are dropped by the
   caller, so a popup never prints fields the shoot has no data for. */
function kvRow(label, value, attrs = '') {
  return value ? `<span class="k">${label}</span><span${attrs ? ' ' + attrs : ''}>${value}</span>` : '';
}
/* Escaped, trimmed text — '' when nothing is stored for that field. */
const txt = (v) => { const t = String(v ?? '').trim(); return t ? esc(t) : ''; };

async function openDrawer(id) {
  const drawer = $('#drawer');
  drawer.innerHTML = '<div class="empty">Loading…</div>';
  $('#drawer-backdrop').classList.remove('hidden');
  try {
    const s = await api(`/api/shoots/${id}`);
    const paid = +s.paid_amount, fee = +s.fee;
    const balance = Math.max(0, Math.round((fee - paid) * 100) / 100);
    const canCollect = balance > 0;
    // Only list the details this shoot actually has — no "—" placeholder rows.
    const contact = [txt(s.contact_name), txt(s.contact_phone)].filter(Boolean).join(' · ');
    const hasMoney = fee > 0 || paid > 0; // nothing booked → leave the money rows out
    const detailRows = [
      kvRow('Coordinator', txt(s.coordinator)),
      hasMoney ? kvRow('Fee', fmtMoney(fee), 'class="td-mono"') : '',
      hasMoney ? kvRow('Collected', fmtMoney(paid), 'class="td-mono" style="color:var(--green)"') : '',
      hasMoney ? kvRow('Balance', fmtMoney(Math.max(0, fee - paid)), 'class="td-mono"') : '',
      kvRow('Client', txt(s.client_name)),
      kvRow('Type', txt(s.shoot_type)),
      kvRow('Venue', txt(s.venue)),
      kvRow('Location', txt(s.location)),
      kvRow('Contact', contact)
    ].join('');
    const extraRows = Object.entries(s.extra || {})
      .filter(([, v]) => txt(v))
      .map(([k, v]) => kvRow(esc(k), txt(v)))
      .join('');
    drawer.innerHTML = `
      <div class="drawer-head">
        <div class="drawer-head-txt">
          <h2>${esc(s.title)}</h2>
          <div class="sub">${fmtDate(s.shoot_date)}${s.end_date && s.end_date !== s.shoot_date ? ` → ${fmtDate(s.end_date)}` : ''}${s.start_time ? ` · ${fmtTime(s.start_time)}` : ''}</div>
          <div class="drawer-status">
            ${statusPill(s.status)}<span class="pill ${s.payment_status}">${esc(statusLabel(s.payment_status))}</span>
          </div>
        </div>
        <button class="btn popup-close" data-close aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      ${detailRows ? `<div class="section"><h4>Details</h4><div class="kv kv-lead">${detailRows}</div></div>` : ''}
      ${s.notes ? `<div class="section"><h4>Notes</h4><div>${esc(s.notes)}</div></div>` : ''}
      ${extraRows ? `<div class="section"><h4>Extra fields (from import)</h4><div class="kv">${extraRows}</div></div>` : ''}
      <div class="section"><h4>Payment</h4>
        <div class="pay-list">
          ${(s.payments || []).map((p) => `
            <div class="pay-row">
              <span class="muted small">${fmtDate(p.paid_on)}</span>
              <span>${[p.method, p.note].filter(Boolean).map(esc).join(' <span class="muted small">· </span>')}</span>
              <span class="amt">${fmtMoney(p.amount)}</span>
              <button data-pay-id="${p.id}" title="Delete payment">✕</button>
            </div>`).join('') || `<div class="muted small">${fee ? 'Nothing collected yet.' : 'Set a fee to start collecting.'}</div>`}
        </div>
        <div class="pay-total">Collected <b style="color:var(--green)">${fmtMoney(paid)}</b> of ${fmtMoney(fee)} (${fee ? Math.round((paid / fee) * 100) : 0}%)</div>
        <button class="btn btn-primary pay-mark" id="pay-mark" ${canCollect ? '' : 'disabled'}>Mark Paid</button>
        <div class="muted small pay-hint">${!fee ? 'Set a fee on this shoot first — then it can be marked paid.' : canCollect ? `Books the remaining ${fmtMoney(balance)} as collected today.` : 'Nothing to collect — this shoot is already paid in full.'}</div>
      </div>
      <div class="drawer-actions">
        <button class="btn" id="dr-edit">✏️ Edit</button>
        <button class="btn btn-danger" id="dr-delete">🗑 Delete</button>
        <button class="btn btn-ghost" data-close>Close</button>
      </div>`;
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    $('#dr-edit').addEventListener('click', () => { closeDrawer(); openShootModal(s); });
    $('#dr-delete').addEventListener('click', async () => {
      if (!confirm(`Delete "${s.title}"? Its payments will be removed too.`)) return;
      try { await api(`/api/shoots/${id}`, { method: 'DELETE' }); toast('Shoot deleted'); closeDrawer(); loadMeta(); refreshCurrent(); }
      catch (e) { toast('Delete failed: ' + e.message, 'err'); }
    });
    const payMark = $('#pay-mark');
    payMark.addEventListener('click', async () => {
      if (!canCollect) return;
      payMark.disabled = true;
      try {
        await api(`/api/shoots/${id}/payments`, { body: { amount: balance, paid_on: dayKey(new Date()), note: 'Collected' } });
        toast(`Marked ${fmtMoney(balance)} as paid`);
        openDrawer(id);
        refreshCurrent();
      } catch (e) { payMark.disabled = false; toast('Could not save: ' + e.message, 'err'); }
    });
    $$('#drawer [data-pay-id]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this payment?')) return;
      try { await api(`/api/payments/${b.dataset.payId}`, { method: 'DELETE' }); toast('Payment removed'); openDrawer(id); refreshCurrent(); }
      catch (e) { toast('Failed: ' + e.message, 'err'); }
    }));
  } catch (e) {
    drawer.innerHTML = `<div class="empty">Could not load shoot: ${esc(e.message)}</div>`;
  }
}
function closeDrawer() { $('#drawer-backdrop').classList.add('hidden'); }

/* ---------- export (original calendar CSV format) ---------- */

function buildExportCsv(rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const sorted = [...rows].sort((a, b) => (a.shoot_date < b.shoot_date ? -1 : a.shoot_date > b.shoot_date ? 1 : a.id - b.id));
  const [fy, fm] = String(sorted[0].shoot_date).slice(0, 7).split('-').map(Number);
  // Month/Total side block: 12 consecutive months from the earliest month, like the original sheet
  const monthTotals = [];
  for (let i = 0; i < 12; i++) {
    const dt = new Date(fy, fm - 1 + i, 1);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const total = sorted.reduce((a, s) => (String(s.shoot_date).slice(0, 7) === ym ? a + (+s.fee || 0) : a), 0);
    monthTotals.push({ name: MONTH_NAMES[dt.getMonth()], total });
  }
  const lines = ['Date,Description,Coordinator ,Remuneration,Status,,Month,Total,,Advance,,'];
  sorted.forEach((s, i) => {
    const [y, m, d] = String(s.shoot_date).slice(0, 10).split('-').map(Number);
    const date = `${d}-${MONTH_NAMES[m - 1]}-${y}`;
    const status = appStatus(s.status) === 'completed' ? 'Done' : '';
    const fee = Math.round((+s.fee || 0) * 100) / 100;
    const mt = monthTotals[i];
    const row = [
      date, cell(s.title), cell(s.coordinator || ''), fee, status, '',
      mt ? mt.name : '', mt ? mt.total : '', '',
      i === 0 ? 'Description ' : '', i === 0 ? 'Amount ' : '', i === 0 ? 'Date' : ''
    ];
    lines.push(row.join(','));
  });
  return lines.join('\n');
}

function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- global wiring ---------- */

$$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
// chart bars: click/tap to show the number
$('#chart-monthly').addEventListener('click', (e) => {
  const b = e.target.closest('.bar[data-val]');
  if (!b) return;
  toast(`${b.dataset.lbl}: ${fmtMoney(b.dataset.val)}`);
});
// dashboard KPI tiles: click → Shoots tab with the matching filter
$('#kpi-row').addEventListener('click', (e) => {
  const kpi = e.target.closest('.kpi[data-goto]');
  if (!kpi) return;
  let extra = {};
  try { extra = JSON.parse(kpi.dataset.goto || '{}'); } catch { extra = {}; }
  state.viewFilters.shoots = {
    month: state.filters.month, coordinator: state.filters.coordinator, status: '', paymentStatus: '', q: '', ...extra
  };
  state.shootsFiltersOpen = true;
  state.shootsExpandAll = true;   // every month group open, not just this month
  $('#btn-shoots-filter').setAttribute('aria-expanded', 'true');
  $('#btn-shoots-filter').classList.add('active');
  setView('shoots');
});
$('#kpi-row').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const kpi = e.target.closest('.kpi[data-goto]');
  if (kpi) { e.preventDefault(); kpi.click(); }
});
$('#btn-shoots-reset').addEventListener('click', resetShootsFilters);
// shoots tab: filters start hidden, funnel toggles them
$('#btn-shoots-filter').addEventListener('click', () => {
  state.shootsFiltersOpen = !state.shootsFiltersOpen;
  $('#filterbar').classList.toggle('hidden', !state.shootsFiltersOpen);
  $('#btn-shoots-filter').setAttribute('aria-expanded', String(state.shootsFiltersOpen));
  $('#btn-shoots-filter').classList.toggle('active', state.shootsFiltersOpen);
  if (state.shootsFiltersOpen) readFilters();
});
// calendar: grid / list views
$('#cal-view-grid').addEventListener('click', () => setCalView('grid'));
$('#cal-view-list').addEventListener('click', () => setCalView('list'));
$('#sel-coordinator').addEventListener('change', () => {
  const ni = $('#coord-new-input');
  if ($('#sel-coordinator').value === '__new__') { ni.hidden = false; ni.focus(); }
  else { ni.hidden = true; }
});
$('#cal-year').addEventListener('change', (e) => calGoto(+e.target.value, state.cal.month));
$('#cal-month').addEventListener('change', (e) => calGoto(state.cal.year, +e.target.value));
$('#btn-export').addEventListener('click', async () => {
  try {
    const rows = await api('/api/shoots');
    if (!rows.length) { toast('Nothing to export yet — add some shoots first', 'err'); return; }
    const csv = buildExportCsv(rows);
    const year = rows.reduce((m, s) => (String(s.shoot_date).slice(0, 4) < m ? String(s.shoot_date).slice(0, 4) : m), '9999');
    downloadText(`Shooting-Calendar-${year}.csv`, csv);
    toast(`Exported ${rows.length} shoots`);
  } catch (e) { toast('Export failed: ' + e.message, 'err'); }
});
$$('#shoot-modal [data-close]').forEach((b) => b.addEventListener('click', closeShootModal));
$$('#access-modal [data-close]').forEach((b) => b.addEventListener('click', closeAccess));
$('#access-modal').addEventListener('click', (e) => { if (e.target.id === 'access-modal') closeAccess(); });
$('#btn-access').addEventListener('click', openAccess);
$('#shoot-modal').addEventListener('click', (e) => { if (e.target.id === 'shoot-modal') closeShootModal(); });
$('#drawer-backdrop').addEventListener('click', (e) => { if (e.target.id === 'drawer-backdrop') closeDrawer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeShootModal(); closeDrawer(); closeAccess(); } });
['f-month', 'f-coordinator', 'f-status', 'f-payment'].forEach((id) => $('#' + id).addEventListener('change', onFilterChange));
$('#f-q').addEventListener('input', onFilterChange);
$('#f-clear').addEventListener('click', clearFilters);

/* ---------- boot ---------- */

$('#btn-signout').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { window.location.replace('/'); }
});

(async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
    $('#signed-in-user').textContent = user.email;
    $('#btn-access').hidden = user.role !== 'owner';
  } catch (_error) { return; }
  pollHealth();
  await loadMeta();
  setView('dashboard');
  setInterval(() => { if (state.dbOk === false) { pollHealth(); } }, 45000);
})();
