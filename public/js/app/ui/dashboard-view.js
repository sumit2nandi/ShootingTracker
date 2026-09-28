import { $, $$, escapeHtml } from '../core/dom.js';
import { formatDate, formatMoney, formatMoneyShort, MONTH_SHORT } from '../core/format.js';
import { STATUS_COLORS, STATUS_ORDER, appStatus, statusLabel } from '../domain/shoot-status.js';

/** KPI tiles, charts and breakdowns. Reads data, writes HTML, emits actions. */
export class DashboardView {
  constructor({ api, actions }) {
    this.api = api;
    this.actions = actions;
  }

  mount() {
    const kpiRow = $('#kpi-row');
    if (kpiRow) {
      kpiRow.addEventListener('click', (event) => this.#onTileActivated(event));
      kpiRow.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const tile = event.target.closest('.kpi[data-goto]');
        if (tile) {
          event.preventDefault();
          tile.click();
        }
      });
    }
    const chart = $('#chart-monthly');
    if (chart) {
      chart.addEventListener('click', (event) => {
        const bar = event.target.closest('.bar[data-val]');
        if (bar) this.actions.notify(`${bar.dataset.lbl}: ${formatMoney(bar.dataset.val)}`);
      });
    }
  }

  /** @param {import('../domain/filter-criteria.js').FilterCriteria} filters */
  async load(filters) {
    const query = filters.toQueryString();
    const summary = await this.api.dashboard(query);
    // With a month selected the earnings chart switches to a per-day view.
    const daily = filters.month ? groupFeesByDay(await this.api.listShoots(query)) : null;
    this.render(summary, daily);
  }

  render(summary, daily) {
    const kpi = summary.kpi || {};
    // Unquoted SQL aliases come back lowercased, hence `paidshoots`.
    $('#kpi-row').innerHTML = `
    <div class="kpi accent" data-goto="{}" role="button" tabindex="0"><div class="kpi-label">Total Shoots</div><div class="kpi-value">${kpi.shoots ?? 0}</div><div class="kpi-sub">${kpi.active ?? 0} Planned · ${kpi.completed ?? 0} Completed</div></div>
    <div class="kpi violet" data-goto="{}" role="button" tabindex="0"><div class="kpi-label">Total Fee</div><div class="kpi-value">${formatMoney(kpi.total_fee)}</div><div class="kpi-sub">Booked Earnings</div></div>
    <div class="kpi green" data-goto='{"status":"completed"}' role="button" tabindex="0"><div class="kpi-label">Completed</div><div class="kpi-value">${kpi.completed ?? 0}</div><div class="kpi-sub">Of ${kpi.shoots ?? 0} Total</div></div>
    <div class="kpi green" data-goto='{"paymentStatus":"paid"}' role="button" tabindex="0"><div class="kpi-label">Total Received</div><div class="kpi-value">${formatMoney(kpi.total_paid)}</div><div class="kpi-sub">${kpi.paidshoots ?? 0} Shoots Fully Paid</div></div>
    <div class="kpi" data-goto='{"status":"planned"}' role="button" tabindex="0"><div class="kpi-label">Planned</div><div class="kpi-value">${kpi.active ?? 0}</div><div class="kpi-sub">Still to Come</div></div>
    <div class="kpi amber" data-goto='{"paymentStatus":"outstanding"}' role="button" tabindex="0"><div class="kpi-label">Outstanding</div><div class="kpi-value">${formatMoney(kpi.outstanding)}</div><div class="kpi-sub">${kpi.outstandingshoots ?? 0} Shoots with a Balance</div></div>`;

    this.#renderEarnings(summary.monthly || [], daily);
    this.#renderStatusDonut(summary.byStatus || []);
    this.#renderCoordinators(summary.byCoordinator || []);
    this.#renderTypes(summary.byType || []);
    this.#renderUpcoming(summary.upcoming || []);
  }

  #onTileActivated(event) {
    const tile = event.target.closest('.kpi[data-goto]');
    if (!tile) return;
    let extra = {};
    try {
      extra = JSON.parse(tile.dataset.goto || '{}');
    } catch {
      extra = {};
    }
    this.actions.showShootsFiltered(extra);
  }

  #renderEarnings(monthly, daily) {
    const wrap = $('#chart-monthly');
    const title = $('#chart-title');
    const range = $('#chart-range');

    if (daily) {
      title.textContent = 'Earnings by Day';
      if (!daily.length) {
        wrap.innerHTML = '<div class="empty">No shoots in this month</div>';
        range.textContent = '';
        return;
      }
      const max = Math.max(...daily.map((entry) => entry.fee), 1);
      const label = (date) => {
        const [, month, day] = date.split('-').map(Number);
        return `${MONTH_SHORT[month - 1]} ${day}`;
      };
      wrap.innerHTML = barChart(daily.map((entry) => ({
        label: label(entry.date),
        axis: String(+entry.date.slice(8, 10)),
        value: entry.fee,
        max
      })));
      range.textContent = `${label(daily[0].date)} – ${label(daily[daily.length - 1].date)}`;
      return;
    }

    title.textContent = 'Earnings by Month';
    const months = (monthly || []).slice(-12).reverse().map((row) => ({ ym: row.ym, fee: +row.fee }));
    if (!months.length) {
      wrap.innerHTML = '<div class="empty">No data for this filter</div>';
      range.textContent = '';
      return;
    }
    const max = Math.max(...months.map((month) => month.fee), 1);
    const label = (ym) => {
      const [year, month] = ym.split('-').map(Number);
      return `${MONTH_SHORT[month - 1]} ${String(year).slice(2)}`;
    };
    wrap.innerHTML = barChart(months.map((month) => ({
      label: label(month.ym),
      axis: label(month.ym),
      value: month.fee,
      max
    })));
    range.textContent = `${label(months[0].ym)} – ${label(months[months.length - 1].ym)}`;
  }

  #renderStatusDonut(byStatus) {
    const wrap = $('#chart-status');
    const totals = new Map();
    for (const row of byStatus) {
      const key = appStatus(row.status);
      totals.set(key, (totals.get(key) || 0) + row.n);
    }
    const rows = STATUS_ORDER.filter((status) => totals.has(status)).map((status) => ({ status, n: totals.get(status) }));
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    if (!total) {
      wrap.innerHTML = '<div class="empty">No data for this filter</div>';
      return;
    }

    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const segments = rows.map((row) => {
      const fraction = row.n / total;
      const segment = {
        color: STATUS_COLORS[row.status] || '#888',
        dash: `${fraction * circumference} ${circumference}`,
        offset: -offset * circumference
      };
      offset += fraction;
      return segment;
    });

    wrap.innerHTML = `
    <svg width="160" height="160" viewBox="0 0 160 160">
      <g transform="rotate(-90 80 80)">
        ${segments.map((segment) => `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="22" stroke-dasharray="${segment.dash}" stroke-dashoffset="${segment.offset}"></circle>`).join('')}
      </g>
      <text x="80" y="76" text-anchor="middle" style="fill:var(--text)" font-size="26" font-weight="700">${total}</text>
      <text x="80" y="97" text-anchor="middle" style="fill:var(--muted)" font-size="11">shoots</text>
    </svg>
    <div class="donut-legend">
      ${rows.map((row) => `<div class="row"><i style="background:${STATUS_COLORS[row.status] || '#888'}"></i>${escapeHtml(statusLabel(row.status))}<span class="n">${row.n}</span></div>`).join('')}
    </div>`;
  }

  #renderCoordinators(list) {
    const wrap = $('#list-coordinators');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty">No data for this filter</div>';
      return;
    }
    const max = Math.max(...list.map((row) => +row.fee), 1);
    wrap.innerHTML =
      '<div class="coord-list">' +
      list
        .map(
          (row) => `
    <div class="coord-row">
      <div class="coord-top"><span>${escapeHtml(row.name)}</span><span class="amt">${row.shoots} shoots · ${formatMoney(row.fee)}</span></div>
      <div class="coord-track"><div class="coord-fill" style="width:${Math.max(2, (+row.fee / max) * 100)}%"></div></div>
    </div>`
        )
        .join('') +
      '</div>';
  }

  #renderTypes(list) {
    const wrap = $('#list-types');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty">No data for this filter</div>';
      return;
    }
    wrap.innerHTML = list
      .map((row) => `<div class="type-chip"><b>${row.shoots}</b> ${escapeHtml(row.type)} <span class="amt">${formatMoney(row.fee)}</span></div>`)
      .join('');
  }

  #renderUpcoming(list) {
    const wrap = $('#upcoming-table');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty">Nothing scheduled in the next 7 days 🎉</div>';
      return;
    }
    wrap.innerHTML = `
    <table class="upcoming-table"><tbody>${list
      .map(
        (shoot) => `
      <tr data-id="${shoot.id}">
        <td class="td-mono td-date">${formatDate(shoot.shoot_date)}</td>
        <td>${escapeHtml(shoot.title)}</td>
      </tr>`
      )
      .join('')}</tbody></table>`;
    $$('#upcoming-table tbody tr').forEach((row) =>
      row.addEventListener('click', () => this.actions.openShoot(+row.dataset.id))
    );
  }
}

function barChart(bars) {
  return `<div class="bars">${bars
    .map(
      (bar) => `
      <div class="bar-col">
        <div class="bar-pair">
          <div class="bar fee" style="height:${(bar.value / bar.max) * 100}%" title="${bar.label} — ${formatMoney(bar.value)}" data-lbl="${bar.label}" data-val="${bar.value}"><span class="bar-val">${bar.value ? formatMoneyShort(bar.value) : ''}</span></div>
        </div>
        <div class="bar-label">${bar.axis}</div>
      </div>`
    )
    .join('')}</div>`;
}

function groupFeesByDay(shoots) {
  const byDay = {};
  for (const shoot of shoots) {
    const key = String(shoot.shoot_date).slice(0, 10);
    byDay[key] = (byDay[key] || 0) + (+shoot.fee || 0);
  }
  return Object.entries(byDay)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, fee]) => ({ date, fee }));
}
