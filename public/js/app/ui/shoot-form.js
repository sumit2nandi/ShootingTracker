import { $, $$, escapeHtml } from '../core/dom.js';
import { dayKey } from '../core/format.js';
import { appStatus } from '../domain/shoot-status.js';

const NEW_COORDINATOR = '__new__';

/** The new/edit shoot modal: fills the form, validates it, saves it. */
export class ShootForm {
  constructor({ api, actions, today = () => new Date() }) {
    this.api = api;
    this.actions = actions;
    this.today = today;
    this.modal = $('#shoot-modal');
    this.form = $('#shoot-form');
    this.coordinators = [];
  }

  mount() {
    // two entries to the same form: the header button on desktop, the floating
    // action button on phones
    $$('#btn-new-shoot, #btn-new-shoot-fab').forEach((button) =>
      button.addEventListener('click', () => this.open(null))
    );
    $('#btn-save-shoot').addEventListener('click', () => this.save());
    $$('#shoot-modal [data-close]').forEach((button) => button.addEventListener('click', () => this.close()));
    this.modal.addEventListener('click', (event) => {
      if (event.target.id === 'shoot-modal') this.close();
    });
    $('#sel-coordinator').addEventListener('change', () => {
      const input = $('#coord-new-input');
      const isNew = $('#sel-coordinator').value === NEW_COORDINATOR;
      input.hidden = !isNew;
      if (isNew) input.focus();
    });
  }

  /** Refresh the coordinator dropdown from `/api/meta`. */
  populate(meta) {
    this.coordinators = meta.coordinators || [];
    const select = $('#sel-coordinator');
    if (!select) return;
    const current = select.value;
    select.innerHTML =
      '<option value="">— none —</option>' +
      this.coordinators.map((coordinator) => `<option value="${escapeHtml(coordinator.name)}">${escapeHtml(coordinator.name)}</option>`).join('') +
      `<option value="${NEW_COORDINATOR}">➕ New coordinator…</option>`;
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
  }

  /**
   * A form control by name.
   *
   * Always through `form.elements`: `form.id` and `form.title` resolve to the
   * element's own IDL attributes (strings), not to the inputs named "id" and
   * "title", so `form.id.value = …` throws in strict mode. That is what used to
   * stop this modal from opening at all.
   */
  field(name) {
    return this.form.elements.namedItem(name);
  }

  /**
   * @param {object|null} shoot the shoot to edit, or null for a new one
   * @param {string} [presetDate] pre-filled date when adding from the calendar
   */
  open(shoot, presetDate) {
    const form = this.form;
    form.reset();
    $('#shoot-modal-title').textContent = shoot ? 'Edit shoot' : 'New shoot';

    const set = (name, value) => {
      this.field(name).value = value ?? '';
    };
    set('id', shoot?.id);
    set('title', shoot?.title);
    set('client_name', shoot?.client_name);
    set('shoot_type', shoot?.shoot_type);
    set('shoot_date', shoot?.shoot_date || presetDate || dayKey(this.today()));
    set('end_date', shoot?.end_date);
    set('start_time', shoot?.start_time ? String(shoot.start_time).slice(0, 5) : '');
    set('end_time', shoot?.end_time ? String(shoot.end_time).slice(0, 5) : '');
    set('venue', shoot?.venue);
    set('location', shoot?.location);
    set('fee', shoot?.fee ?? 0);
    set('contact_name', shoot?.contact_name);
    set('contact_phone', shoot?.contact_phone);
    set('notes', shoot?.notes);

    // coordinator: a known name selects it, an unknown one switches to "new"
    const select = $('#sel-coordinator');
    const newInput = $('#coord-new-input');
    const known = shoot?.coordinator && this.coordinators.some((coordinator) => coordinator.name === shoot.coordinator);
    if (shoot?.coordinator) {
      select.value = known ? shoot.coordinator : NEW_COORDINATOR;
      newInput.value = known ? '' : shoot.coordinator;
    } else {
      select.value = '';
      newInput.value = '';
    }
    newInput.hidden = select.value !== NEW_COORDINATOR;

    $('#sel-status').value = appStatus(shoot?.status);
    this.modal.classList.remove('hidden');
    setTimeout(() => this.field('title').focus(), 50);
  }

  close() {
    this.modal.classList.add('hidden');
  }

  /** The chosen coordinator: an existing name, or the one being typed. */
  coordinatorValue() {
    const select = $('#sel-coordinator');
    return select.value === NEW_COORDINATOR ? $('#coord-new-input').value.trim() : select.value;
  }

  readValues() {
    const value = (name) => this.field(name).value;
    const trimmed = (name) => value(name).trim() || null;
    return {
      title: value('title').trim(),
      client_name: trimmed('client_name'),
      shoot_type: trimmed('shoot_type'),
      shoot_date: value('shoot_date'),
      end_date: value('end_date') || null,
      start_time: value('start_time') || null,
      end_time: value('end_time') || null,
      venue: trimmed('venue'),
      location: trimmed('location'),
      coordinator: this.coordinatorValue() || null,
      fee: value('fee') || 0,
      status: value('status'),
      contact_name: trimmed('contact_name'),
      contact_phone: trimmed('contact_phone'),
      notes: trimmed('notes')
    };
  }

  async save() {
    const body = this.readValues();
    if (!body.title || !body.shoot_date) {
      this.actions.notifyError('Title and shoot date are required');
      return;
    }
    const id = this.field('id').value;
    try {
      if (id) {
        await this.api.updateShoot(id, body);
        this.actions.notify('Shoot updated');
      } else {
        await this.api.createShoot(body);
        this.actions.notify('Shoot added');
      }
      this.close();
      this.actions.dataChanged();
    } catch (error) {
      this.actions.notifyError('Save failed: ' + error.message);
    }
  }
}
