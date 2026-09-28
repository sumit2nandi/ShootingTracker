import { $, $$, escapeHtml } from '../core/dom.js';
import { closeOverlay, openOverlay } from '../core/motion.js';

/**
 * "People with Access" (owners only).
 *
 * An owner manages the list from here: add, activate/deactivate, remove, and
 * switch another account's role between member and owner. The signed-in
 * owner's own row has no role control (changing one's own role is a database
 * job), and the last active owner cannot be demoted — the same rules the
 * server enforces, mirrored here by disabling the control that would fail.
 */
export class AccessView {
  constructor({ api, store, actions, confirm = async () => false }) {
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
    // members never manage access — the entry point is not in their app at all
    if ((this.store.get().user || {}).role !== 'owner') return;
    const form = $('#access-form');
    if (form) form.reset();            // a half-typed invite does not survive a close
    this.modal.scrollTop = 0;
    const sheet = this.modal.firstElementChild;
    if (sheet) sheet.scrollTop = 0;
    openOverlay(this.modal);
    $('#access-list').innerHTML = '<div class="empty">Loading…</div>';
    await this.refresh();
  }

  close() {
    closeOverlay(this.modal);
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

    $$('#access-list [data-role]').forEach((select) => {
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await this.api.updateUser(select.dataset.role, { role: select.value });
          this.actions.notify('Role updated');
          await this.refresh();
        } catch (error) {
          this.actions.notifyError(error.message);
          select.disabled = false;
        }
      });
    });

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
        if (!(await this.confirm('This person will no longer be able to sign in.', {
          title: 'Remove access?', confirmLabel: 'Remove'
        }))) return;
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
    const isOwner = user.role === 'owner';
    const isLastOwner = isOwner && user.is_active && activeOwners <= 1;
    // your own role is not a tap away — it is a database-level decision.
    // everyone else's is.
    const roleControl = isMe
      ? `<span class="pill ${isOwner ? 'owner' : 'unpaid'}">${isOwner ? 'Owner' : 'Member'}</span>`
      : `<select class="role-select${isOwner ? ' owner' : ''}" data-role="${user.id}" aria-label="Role of ${escapeHtml(user.name || user.email)}"
           ${isLastOwner ? 'disabled title="At least one active owner is required"' : ''}>
        <option value="member"${isOwner ? '' : ' selected'}>Member</option>
        <option value="owner"${isOwner ? ' selected' : ''}>Owner</option>
      </select>`;
    return `
      <div class="access-row${user.is_active ? '' : ' off'}">
        <div class="access-who">
          <b>${escapeHtml(user.name || user.email)}</b>
          <span class="muted small">${escapeHtml(user.email)}${isMe ? ' · you' : ''}</span>
        </div>
        ${roleControl}
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
    // no role on purpose: people join as members; ownership is a database job
    const body = { email: form.email.value.trim(), name: form.name.value.trim() };
    if (!body.email) return;
    try {
      await this.api.addUser(body);
      form.reset();
      this.actions.notify(`${body.email} can now sign in as a member`);
      await this.refresh();
    } catch (error) {
      this.actions.notifyError(error.message);
    }
  }
}
