import { $, $$, escapeHtml, text } from '../core/dom.js';
import { dayKey, formatDate, formatMoney, formatTime } from '../core/format.js';
import { statusLabel, statusPill } from '../domain/shoot-status.js';

/** One key/value row; rows without a value are dropped by the caller. */
const kvRow = (label, value, attrs = '') =>
  value ? `<span class="k">${label}</span><span${attrs ? ' ' + attrs : ''}>${value}</span>` : '';

/**
 * The slide-over detail panel.
 *
 * Owns `#drawer` and `#drawer-backdrop` and nothing else; it asks the mediator
 * to edit, refresh or add, so it never reaches into the table or the calendar.
 */
export class ShootDrawer {
  constructor({ api, actions, confirm = window.confirm.bind(window), today = () => new Date() }) {
    this.api = api;
    this.actions = actions;
    this.confirm = confirm;
    this.today = today;
    this.element = $('#drawer');
    this.backdrop = $('#drawer-backdrop');
  }

  mount() {
    this.backdrop.addEventListener('click', (event) => {
      if (event.target.id === 'drawer-backdrop') this.close();
    });
  }

  open() {
    this.backdrop.classList.remove('hidden');
  }

  close() {
    this.backdrop.classList.add('hidden');
  }

  /** Load a shoot and render its detail panel. */
  async showShoot(id) {
    this.element.innerHTML = '<div class="empty">Loading…</div>';
    this.open();
    let shoot;
    try {
      shoot = await this.api.getShoot(id);
    } catch (error) {
      this.element.innerHTML = `<div class="empty">Could not load shoot: ${escapeHtml(error.message)}</div>`;
      return;
    }

    const paid = +shoot.paid_amount;
    const fee = +shoot.fee;
    const balance = Math.max(0, Math.round((fee - paid) * 100) / 100);
    const canCollect = balance > 0;

    this.element.innerHTML = this.#shootHtml(shoot, { paid, fee, balance, canCollect });
    this.#bindShoot(shoot, { balance, canCollect });
  }

  /** The "+N more" panel for a calendar day. */
  showDay(dateKey, shoots) {
    this.element.innerHTML = `
    ${drawerHead(formatDate(dateKey), `${shoots.length} shoot${shoots.length === 1 ? '' : 's'} on this day`)}
    ${shoots
      .map(
        (shoot) => `
      <div class="pay-row" data-id="${shoot.id}" style="cursor:pointer">
        ${statusPill(shoot.status)}
        <span>${escapeHtml(shoot.title)}</span>
        <span class="amt">${formatMoney(shoot.fee)}</span>
      </div>`
      )
      .join('')}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="dp-add">+ Add shoot on ${formatDate(dateKey)}</button>
      <button class="btn btn-ghost" data-close>Close</button>
    </div>`;
    this.open();

    $$('#drawer .pay-row[data-id]').forEach((row) =>
      row.addEventListener('click', () => this.showShoot(+row.dataset.id))
    );
    this.#bindClose();
    $('#dp-add').addEventListener('click', () => {
      this.close();
      this.actions.newShoot(dateKey);
    });
  }

  #shootHtml(shoot, { paid, fee, balance, canCollect }) {
    const contact = [text(shoot.contact_name), text(shoot.contact_phone)].filter(Boolean).join(' · ');
    const hasMoney = fee > 0 || paid > 0; // nothing booked → leave the money rows out
    const detailRows = [
      kvRow('Coordinator', text(shoot.coordinator)),
      hasMoney ? kvRow('Fee', formatMoney(fee), 'class="td-mono"') : '',
      hasMoney ? kvRow('Collected', formatMoney(paid), 'class="td-mono" style="color:var(--green)"') : '',
      hasMoney ? kvRow('Balance', formatMoney(Math.max(0, fee - paid)), 'class="td-mono"') : '',
      kvRow('Client', text(shoot.client_name)),
      kvRow('Type', text(shoot.shoot_type)),
      kvRow('Venue', text(shoot.venue)),
      kvRow('Location', text(shoot.location)),
      kvRow('Contact', contact)
    ].join('');
    const extraRows = Object.entries(shoot.extra || {})
      .filter(([, value]) => text(value))
      .map(([key, value]) => kvRow(escapeHtml(key), text(value)))
      .join('');

    const subtitle =
      formatDate(shoot.shoot_date) +
      (shoot.end_date && shoot.end_date !== shoot.shoot_date ? ` → ${formatDate(shoot.end_date)}` : '') +
      (shoot.start_time ? ` · ${formatTime(shoot.start_time)}` : '');

    return `
      ${drawerHead(escapeHtml(shoot.title), subtitle, `${statusPill(shoot.status)}<span class="pill ${shoot.payment_status}">${escapeHtml(statusLabel(shoot.payment_status))}</span>`)}
      ${detailRows ? `<div class="section"><h4>Details</h4><div class="kv kv-lead">${detailRows}</div></div>` : ''}
      ${shoot.notes ? `<div class="section"><h4>Notes</h4><div>${escapeHtml(shoot.notes)}</div></div>` : ''}
      ${extraRows ? `<div class="section"><h4>Extra fields (from import)</h4><div class="kv">${extraRows}</div></div>` : ''}
      <div class="section"><h4>Payment</h4>
        <div class="pay-list">
          ${(shoot.payments || [])
            .map(
              (payment) => `
            <div class="pay-row">
              <span class="muted small">${formatDate(payment.paid_on)}</span>
              <span>${[payment.method, payment.note].filter(Boolean).map(escapeHtml).join(' <span class="muted small">· </span>')}</span>
              <span class="amt">${formatMoney(payment.amount)}</span>
              <button data-pay-id="${payment.id}" title="Delete payment">✕</button>
            </div>`
            )
            .join('') || `<div class="muted small">${fee ? 'Nothing collected yet.' : 'Set a fee to start collecting.'}</div>`}
        </div>
        <div class="pay-total">Collected <b style="color:var(--green)">${formatMoney(paid)}</b> of ${formatMoney(fee)} (${fee ? Math.round((paid / fee) * 100) : 0}%)</div>
        <button class="btn btn-primary pay-mark" id="pay-mark" ${canCollect ? '' : 'disabled'}>Mark Paid</button>
        <div class="muted small pay-hint">${!fee ? 'Set a fee on this shoot first — then it can be marked paid.' : canCollect ? `Books the remaining ${formatMoney(balance)} as collected today.` : 'Nothing to collect — this shoot is already paid in full.'}</div>
      </div>
      <div class="drawer-actions">
        <button class="btn" id="dr-edit">✏️ Edit</button>
        <button class="btn btn-danger" id="dr-delete">🗑 Delete</button>
        <button class="btn btn-ghost" data-close>Close</button>
      </div>`;
  }

  #bindShoot(shoot, { balance, canCollect }) {
    this.#bindClose();

    $('#dr-edit').addEventListener('click', () => {
      this.close();
      this.actions.editShoot(shoot);
    });

    $('#dr-delete').addEventListener('click', async () => {
      if (!this.confirm(`Delete "${shoot.title}"? Its payments will be removed too.`)) return;
      try {
        await this.api.deleteShoot(shoot.id);
        this.actions.notify('Shoot deleted');
        this.close();
        this.actions.dataChanged();
      } catch (error) {
        this.actions.notifyError('Delete failed: ' + error.message);
      }
    });

    const markPaid = $('#pay-mark');
    markPaid.addEventListener('click', async () => {
      if (!canCollect) return;
      markPaid.disabled = true;
      try {
        await this.api.addPayment(shoot.id, {
          amount: balance,
          paid_on: dayKey(this.today()),
          note: 'Collected'
        });
        this.actions.notify(`Marked ${formatMoney(balance)} as paid`);
        this.showShoot(shoot.id);
        this.actions.dataChanged({ reloadMeta: false });
      } catch (error) {
        markPaid.disabled = false;
        this.actions.notifyError('Could not save: ' + error.message);
      }
    });

    $$('#drawer [data-pay-id]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (!this.confirm('Remove this payment?')) return;
        try {
          await this.api.deletePayment(button.dataset.payId);
          this.actions.notify('Payment removed');
          this.showShoot(shoot.id);
          this.actions.dataChanged({ reloadMeta: false });
        } catch (error) {
          this.actions.notifyError('Failed: ' + error.message);
        }
      })
    );
  }

  #bindClose() {
    $$('#drawer [data-close]').forEach((button) => button.addEventListener('click', () => this.close()));
  }
}

function drawerHead(title, subtitle, status = '') {
  return `
      <div class="drawer-head">
        <div class="drawer-head-txt">
          <h2>${title}</h2>
          <div class="sub">${subtitle}</div>
          ${status ? `<div class="drawer-status">${status}</div>` : ''}
        </div>
        <button class="btn popup-close" data-close aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
}
