import { $, $$, escapeHtml } from '../core/dom.js';
import { DAY_SHORT, MONTH_NAMES, MONTH_SHORT, dayKey, formatMoney } from '../core/format.js';
import { STATUS_ORDER, appStatus, statusLabel, statusPill } from '../domain/shoot-status.js';

/**
 * Month calendar, in grid or list form.
 *
 * The grid is a horizontal scroller with three pages (previous / current /
 * next) so phones can swipe between months; each load fetches that whole
 * window. A sequence token drops stale responses when the user moves faster
 * than the network.
 */
export class CalendarView {
  /**
   * @param {{ api: object, actions: object, today?: () => Date }} deps
   *        `actions` is the mediator the view reports to (open a shoot, add one,
   *        show a day) — it never calls another view directly.
   */
  constructor({ api, actions, today = () => new Date() }) {
    this.api = api;
    this.actions = actions;
    this.today = today;
    const now = today();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.mode = 'grid';
    this.byDate = {};
    this.sequence = 0;
    this.settleTimer = 0;
    this.resizeTimer = 0;
  }

  mount() {
    $('#cal-prev').addEventListener('click', () => this.shift(-1));
    $('#cal-next').addEventListener('click', () => this.shift(1));
    $('#cal-today').addEventListener('click', () => {
      const now = this.today();
      this.goto(now.getFullYear(), now.getMonth());
    });
    $('#cal-view-grid').addEventListener('click', () => this.setMode('grid'));
    $('#cal-view-list').addEventListener('click', () => this.setMode('list'));
    $('#cal-year').addEventListener('change', (event) => this.goto(+event.target.value, this.month));
    $('#cal-month').addEventListener('change', (event) => this.goto(this.year, +event.target.value));

    const scroller = $('#cal-scroll');
    const settleLater = () => {
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.#settle(), 150);
    };
    scroller.addEventListener('scroll', settleLater, { passive: true });
    scroller.addEventListener('scrollend', () => {
      clearTimeout(this.settleTimer);
      this.#settle();
    });
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.recenter(), 150);
    });
  }

  /** Populate the month/year selects from `/api/meta`. */
  populate(meta) {
    const yearSelect = $('#cal-year');
    const monthSelect = $('#cal-month');
    if (!yearSelect) return;

    const years = new Set((meta.months || []).map((month) => +String(month).slice(0, 4)));
    years.add(this.today().getFullYear());
    const sorted = [...years].sort((a, b) => a - b);
    const keep = yearSelect.value;
    yearSelect.innerHTML = '';
    for (let year = Math.min(...sorted) - 1; year <= Math.max(...sorted) + 1; year++) {
      yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
    }
    if (keep && yearSelect.querySelector(`option[value="${keep}"]`)) yearSelect.value = keep;
    monthSelect.innerHTML = MONTH_NAMES.map((name, index) => `<option value="${index}">${name}</option>`).join('');
    monthSelect.value = String(this.month);
  }

  /** Repaint from cache immediately (keeps swiping smooth), then refresh data. */
  goto(year, month) {
    this.year = year + Math.floor(month / 12);
    this.month = ((month % 12) + 12) % 12;
    this.#syncToolbar();
    this.#renderLegend();
    if (this.mode === 'list') this.#renderList();
    else this.#renderGrid(true);
    this.load({ recenter: false });
  }

  shift(delta) {
    this.goto(this.year, this.month + delta);
  }

  setMode(mode) {
    this.mode = mode;
    const listMode = mode === 'list';
    $('#view-calendar').classList.toggle('list-mode', listMode);
    $('#cal-list').classList.toggle('hidden', !listMode);
    $('#cal-view-grid').classList.toggle('active', !listMode);
    $('#cal-view-list').classList.toggle('active', listMode);
    $('#cal-view-grid').setAttribute('aria-pressed', String(!listMode));
    $('#cal-view-list').setAttribute('aria-pressed', String(listMode));
    if (listMode) this.#renderList();
    else this.#renderGrid();
  }

  /** Move the calendar to the month containing `isoDate`. */
  focus(isoDate) {
    const [year, month] = String(isoDate || '').slice(0, 10).split('-').map(Number);
    if (year && month) {
      this.year = year;
      this.month = month - 1;
    }
  }

  async load({ recenter = true } = {}) {
    this.#syncToolbar();
    const from = dayKey(new Date(this.year, this.month - 1, 1));
    const to = dayKey(new Date(this.year, this.month + 2, 0));
    const sequence = ++this.sequence;

    const shoots = await this.api.listShootsBetween(from, to);
    if (sequence !== this.sequence) return; // a newer request already won

    this.byDate = groupByDay(shoots);
    this.#renderLegend();
    if (this.mode === 'list') this.#renderList();
    else this.#renderGrid(recenter);
  }

  shootsOn(dateKey) {
    return this.byDate[dateKey] || [];
  }

  recenter() {
    const scroller = $('#cal-scroll');
    if (scroller && this.mode === 'grid') scroller.scrollLeft = scroller.clientWidth;
  }

  #settle() {
    const scroller = $('#cal-scroll');
    if (!scroller) return;
    const delta = pageDelta(scroller.scrollLeft, scroller.clientWidth);
    if (delta) this.shift(delta);
  }

  #syncToolbar() {
    const yearSelect = $('#cal-year');
    const monthSelect = $('#cal-month');
    if (yearSelect && !yearSelect.querySelector(`option[value="${this.year}"]`)) {
      const option = document.createElement('option');
      option.value = this.year;
      option.textContent = this.year;
      yearSelect.appendChild(option);
    }
    if (yearSelect) yearSelect.value = String(this.year);
    if (monthSelect) monthSelect.value = String(this.month);
  }

  /** The legend mirrors the chips and lists only the statuses on screen. */
  #renderLegend() {
    const idsByStatus = new Map();
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      for (const shoot of this.shootsOn(dayKey(new Date(this.year, this.month, day)))) {
        const status = appStatus(shoot.status);
        if (!idsByStatus.has(status)) idsByStatus.set(status, new Set());
        idsByStatus.get(status).add(shoot.id);
      }
    }
    const present = STATUS_ORDER.filter((status) => idsByStatus.has(status));
    const wrap = $('#cal-legend');
    wrap.innerHTML = present.length
      ? present
          .map(
            (status) =>
              `<span class="legend-item"><i class="legend-swatch ${status}"></i>${escapeHtml(statusLabel(status))}<span class="legend-n">${idsByStatus.get(status).size}</span></span>`
          )
          .join('')
      : `<span class="legend-empty">No shoots in ${MONTH_NAMES[this.month]} ${this.year}</span>`;
  }

  #renderList() {
    const wrap = $('#cal-list');
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const rows = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const key = dayKey(new Date(this.year, this.month, day));
      const shoots = this.shootsOn(key);
      if (!shoots.length) continue;
      const date = new Date(this.year, this.month, day);
      rows.push(`
      <div class="cal-list-row" data-date="${key}">
        <div class="cl-date"><span class="cl-dow">${DAY_SHORT[date.getDay()]}</span><span class="cl-day">${day}</span><span class="cl-mon">${MONTH_SHORT[this.month]}</span></div>
        <div class="cl-events">
          ${shoots
            .map(
              (shoot) => `<div class="cl-event" data-id="${shoot.id}">
            <span class="cl-title">${escapeHtml(shoot.title)}</span>
            <span class="cl-fee td-mono">${formatMoney(shoot.fee)}</span>
            ${statusPill(shoot.status)}
          </div>`
            )
            .join('')}
        </div>
      </div>`);
    }

    wrap.innerHTML = rows.length
      ? rows.join('')
      : `<div class="empty">No shoots in ${MONTH_NAMES[this.month]} ${this.year} — use the Grid view to tap a day and add one.</div>`;

    $$('#cal-list .cl-event').forEach((element) =>
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        this.actions.openShoot(+element.dataset.id);
      })
    );
    $$('#cal-list .cal-list-row').forEach((row) =>
      row.addEventListener('click', () => this.actions.newShoot(row.dataset.date))
    );
  }

  #renderGrid(recenter = true) {
    $$('#cal-scroll .cal-page').forEach((page) => {
      $('.cal-grid', page).innerHTML = this.#monthCells(this.year, this.month + Number(page.dataset.delta));
    });

    $$('#cal-scroll .cal-chip').forEach((chip) =>
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        this.actions.openShoot(+chip.dataset.id);
      })
    );
    $$('#cal-scroll .cal-cell').forEach((cell) =>
      cell.addEventListener('click', () => this.actions.newShoot(cell.dataset.date))
    );
    $$('#cal-scroll .cal-more').forEach((more) =>
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.date;
        this.actions.openDay(key, this.shootsOn(key));
      })
    );

    if (recenter) this.recenter();
  }

  /**
   * One month of grid cells. `month` may sit outside 0–11 so the same builder
   * paints the neighbouring pages of the swipeable window.
   */
  #monthCells(year, month) {
    const normalizedMonth = ((month % 12) + 12) % 12;
    const normalizedYear = year + Math.floor(month / 12);
    const first = new Date(normalizedYear, normalizedMonth, 1);
    const daysInMonth = new Date(normalizedYear, normalizedMonth + 1, 0).getDate();
    const startDay = first.getDay();
    const todayKey = dayKey(this.today());
    const cells = [];

    for (let index = 0; index < Math.ceil((startDay + daysInMonth) / 7) * 7; index++) {
      const date = new Date(normalizedYear, normalizedMonth, 1 - startDay + index);
      const key = dayKey(date);
      const inMonth = date.getMonth() === normalizedMonth && date.getFullYear() === normalizedYear;
      const shoots = this.shootsOn(key);
      const shown = shoots.slice(0, 3);
      cells.push(`
      <div class="cal-cell ${inMonth ? '' : 'dim'} ${key === todayKey ? 'today' : ''}" data-date="${key}">
        <div class="cal-dayno"><span>${date.getDate()}</span></div>
        <div class="cal-chips">
          ${shown
            .map(
              (shoot) =>
                `<div class="cal-chip ${appStatus(shoot.status)}" data-id="${shoot.id}" title="${escapeHtml(shoot.title)}${shoot.venue ? ' — ' + escapeHtml(shoot.venue) : ''}">${escapeHtml(shoot.title)}</div>`
            )
            .join('')}
          ${shoots.length > 3 ? `<div class="cal-more" data-date="${key}">+${shoots.length - 3} more…</div>` : ''}
        </div>
      </div>`);
    }
    return cells.join('');
  }
}

/** Which page the scroller settled on: -1 previous, 0 current, 1 next. */
export function pageDelta(scrollLeft, pageWidth) {
  if (!pageWidth) return 0;
  if (scrollLeft < pageWidth * 0.5) return -1;
  if (scrollLeft > pageWidth * 1.5) return 1;
  return 0;
}

/** Index shoots by day, expanding multi-day shoots across their range. */
export function groupByDay(shoots, maxDays = 30) {
  const byDate = {};
  for (const shoot of shoots) {
    let day = new Date(shoot.shoot_date + 'T00:00:00');
    const end = shoot.end_date ? new Date(shoot.end_date + 'T00:00:00') : day;
    for (let index = 0; index < maxDays && day <= end; index++) {
      const key = dayKey(day);
      (byDate[key] = byDate[key] || []).push(shoot);
      day = new Date(day.getTime() + 86400000);
    }
  }
  return byDate;
}
