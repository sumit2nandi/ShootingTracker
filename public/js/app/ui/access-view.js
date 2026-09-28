import { $, $$, escapeHtml } from '../core/dom.js';

/**
 * "People with Access" (owners only).
 *
 * The server is the authority on these rules; the view mirrors them by
 * disabling the buttons that would fail, and still surfaces the server's answer
 * when a race slips through.
 */
export class AccessView {
  constructor({ api, store, actions, confirm = window.confirm.bind(window) }) {
    this.api = api;
    this.store = store;
    this.actions = actions;
    this.confirm = confirm;
    this.modal = $('#access-modal');
  }

  mount() {
    $$('#access-modal [data-close]').forEach((button) => button.addEventListener('click', () => this.close()));
    this.modal.addEventListener('click', (event) => {
      if (event.target.id === 'access-modal') this.close();
    });
    $('#access-form').addEventListener('submit', (event) => this.#add(event));
  }

  async open() {
    this.modal.classList.remove('hidden');
    $('#access-list').innerHTML = '<div class="empty">Loading…</div>';
    await this.refresh();
  }

  close() {
    this.modal.classList.add('hidden');
  }

  async refresh() {
    let users;
    try {
      users = await this.api.listUsers();
    } catch (error) {
      $('#access-list').innerHTML = `<div class="empty">Could not load the list: ${escapeHtml(error.message)}</div>`;
      return;
    }

    const me = String((this.store.get().user || {}).email || '').toLowerCase();
    const activeOwners = users.filter((user) => user.is_active && user.role === 'owner').length;

    $('#access-list').innerHTML =
      users.map((user) => this.#rowHtml(user, { me, activeOwners })).join('') || '<div class="empty">Nobody yet.</div>';

    $$('#access-list [data-toggle]').forEach((button) =>
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await this.api.updateUser(button.dataset.toggle, { is_active: button.dataset.active !== 'true' });
          this.actions.notify('Access updated');
          await this.refresh();
        } catch (error) {
          this.actions.notifyError(error.message);
          button.disabled = false;
        }
      })
    );

    $$('#access-list [data-remove]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (!this.confirm('Remove this person from the allow-list?')) return;
        button.disabled = true;
        try {
          await this.api.removeUser(button.dataset.remove);
          this.actions.notify('Access removed');
          await this.refresh();
        } catch (error) {
          this.actions.notifyError(error.message);
          button.disabled = false;
        }
      })
    );
  }

  #rowHtml(user, { me, activeOwners }) {
    const isMe = String(user.email).toLowerCase() === me;
    const isLastOwner = user.role === 'owner' && user.is_active && activeOwners <= 1;
    return `
      <div class="access-row${user.is_active ? '' : ' off'}">
        <div class="access-who">
          <b>${escapeHtml(user.name || user.email)}</b>
          <span class="muted small">${escapeHtml(user.email)}${isMe ? ' · you' : ''}</span>
        </div>
        <span class="pill ${user.role === 'owner' ? 'owner' : 'unpaid'}">${user.role === 'owner' ? 'Owner' : 'Member'}</span>
        <div class="access-actions">
          <button class="btn btn-ghost" data-toggle="${user.id}" data-active="${user.is_active}"
            ${isLastOwner ? 'disabled title="At least one active owner is required"' : ''}>${user.is_active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-ghost" data-remove="${user.id}" ${isMe ? 'disabled title="You cannot remove your own access"' : ''}>Remove</button>
        </div>
      </div>`;
  }

  async #add(event) {
    event.preventDefault();
    const form = event.target;
    const body = { email: form.email.value.trim(), name: form.name.value.trim(), role: form.role.value };
    if (!body.email) return;
    try {
      await this.api.addUser(body);
      form.reset();
      this.actions.notify(`${body.email} can now sign in`);
      await this.refresh();
    } catch (error) {
      this.actions.notifyError(error.message);
    }
  }
}
