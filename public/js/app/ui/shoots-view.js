import { $, $$, escapeHtml } from '../core/dom.js';
import { formatDate, formatMoney, formatMonth, formatShortDate, daySpan } from '../core/format.js';
import { paymentLabel, statusPill } from '../domain/shoot-status.js';
import { animateDisclosure } from '../core/motion.js';

/**
 * The shoots list, grouped into collapsible months.
 *
 * Holds the rows it last rendered so the CSV export and the "n shown" counter
 * do not each refetch.
 */
export class ShootsView {
  constructor({ api, actions, today = () => new Date() }) {
    this.api = api;
    this.actions = actions;
    this.today = today;
    this.rows = [];
    this.expandAll = false;
  }

  mount() {
    $('#btn-shoots-reset').addEventListener('click', () => this.actions.resetFilters());
    $('#btn-shoots-filter').addEventListener('click', () => this.actions.toggleFilters());
  }

  /** @param {import('../domain/filter-criteria.js').FilterCriteria} filters */
  async load(filters) {
    this.filters = filters;
    this.rows = await this.api.listShoots(filters.toQueryString());
    this.render();
  }

  /** Arriving from a dashboard tile means "show me everything", so open every group. */
  setExpandAll(expandAll) {
    this.expandAll = expandAll;
  }

  syncResetButton(filters = this.filters) {
    const button = $('#btn-shoots-reset');
    if (button) button.hidden = !(filters && filters.isActive);
  }

  render() {
    $('#shoots-count').textContent = `${this.rows.length} shown`;
    this.syncResetButton();

    const wrap = $('#shoots-table');
    if (!this.rows.length) {
      wrap.innerHTML =
        this.filters && this.filters.isActive
          ? '<div class="empty">No shoots match this filter — tap “Show All” to clear it.</div>'
          : '<div class="empty">No shoots yet — add one with “+ New Shoot”.</div>';
      return;
    }

    const now = this.today();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const groups = groupByMonth(this.rows);

    wrap.innerHTML = [...groups.entries()]
      .map(
        ([yearMonth, monthRows]) => `
    <details class="shoot-month" ${this.expandAll || yearMonth === currentMonth ? 'open' : ''}>
      <summary><span>${escapeHtml(yearMonth === 'undated' ? 'Undated' : formatMonth(yearMonth))}</span><span class="month-count">${monthRows.length} shoot${monthRows.length === 1 ? '' : 's'}</span></summary>
      <div class="shoot-month-body">${monthTable(monthRows)}</div>
    </details>`
      )
      .join('');

    $$('#shoots-table tbody tr').forEach((row) =>
      row.addEventListener('click', () => this.actions.openShoot(+row.dataset.id))
    );
    $$('#shoots-table details.shoot-month').forEach((group) => animateDisclosure(group));
  }
}

/** Group rows by `YYYY-MM`, preserving the order the API returned. */
export function groupByMonth(rows) {
  const groups = new Map();
  for (const shoot of rows) {
    const yearMonth = String(shoot.shoot_date || '').slice(0, 7) || 'undated';
    if (!groups.has(yearMonth)) groups.set(yearMonth, []);
    groups.get(yearMonth).push(shoot);
  }
  return groups;
}

function monthTable(rows) {
  return `
    <table class="shoots-table">
      <thead><tr><th>Date</th><th>Title</th><th>Coordinator</th><th class="num">Fee</th><th class="col-pay">Payment</th><th class="col-status">Status</th></tr></thead>
      <tbody>${rows.map(shootRow).join('')}</tbody>
    </table>`;
}

function shootRow(shoot) {
  const paid = shoot.payment_status === 'paid';
  const payment = paymentLabel(shoot.payment_status);
  const multiDay = shoot.end_date && shoot.end_date !== shoot.shoot_date;
  const span = multiDay ? daySpan(shoot.shoot_date, shoot.end_date) : 0;
  const fullDate = multiDay
    ? `${formatDate(shoot.shoot_date)} → ${formatDate(shoot.end_date)}`
    : formatDate(shoot.shoot_date);

  return `
          <tr data-id="${shoot.id}" title="${escapeHtml(fullDate)}">
            <td class="td-mono cell-date"><span class="d-full">${formatDate(shoot.shoot_date)}</span><span class="d-short">${escapeHtml(formatShortDate(shoot.shoot_date))}</span>${multiDay ? `<span class="cell-range"> → ${formatDate(shoot.end_date)}</span>` : ''}${span > 1 ? `<span class="cell-days" title="${span}-day shoot">+${span - 1}d</span>` : ''}</td>
            <td class="cell-title">${escapeHtml(shoot.title)}</td>
            <td class="cell-coord">${escapeHtml(shoot.coordinator || '—')}</td>
            <td class="num td-mono">
              <span class="fee-bubble ${paid ? 'paid' : 'due'}" title="${escapeHtml(payment)}" aria-label="${escapeHtml(formatMoney(shoot.fee))}, ${escapeHtml(payment)}">${formatMoney(shoot.fee)}</span>
            </td>
            <td class="col-pay"><span class="pill ${shoot.payment_status}">${escapeHtml(payment)}</span></td>
            <td class="col-status">${statusPill(shoot.status)}</td>
          </tr>`;
}
