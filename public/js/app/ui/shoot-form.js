import { $, $$, escapeHtml } from '../core/dom.js';
import { dayKey } from '../core/format.js';
import { animateDisclosure, closeOverlay, openOverlay } from '../core/motion.js';
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
    this.titles = [];
    this.titleMatches = [];
    this.titleActive = -1;
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
    animateDisclosure($('.more-details'));
    $('#sel-coordinator').addEventListener('change', () => {
      const input = $('#coord-new-input');
      const isNew = $('#sel-coordinator').value === NEW_COORDINATOR;
      input.hidden = !isNew;
      if (isNew) input.focus();
    });
    this.#mountTitleSuggestions();
  }

  /**
   * The title field offers the account's past titles while typing. It is a
   * small hand-rolled list rather than a `<datalist>`: this modal spends most
   * of its life `display: none`, and browsers suppress datalist suggestions
   * for inputs inside a hidden container — the account's own titles never
   * surfaced that way.
   */
  #mountTitleSuggestions() {
    const input = this.field('title');
    const wrap = input.closest('.field');
    const box = document.createElement('div');
    box.className = 'field-suggest';
    box.hidden = true;
    wrap.appendChild(box);
    this.titleInput = input;
    this.titleSuggest = box;

    input.addEventListener('input', () => this.#refreshTitleSuggestions());
    input.addEventListener('blur', () => setTimeout(() => this.#hideTitleSuggestions(), 120));
    input.addEventListener('keydown', (event) => this.#onTitleKeydown(event));
    box.addEventListener('pointerdown', (event) => {
      const item = event.target.closest('.field-suggest-item');
      if (!item) return;
      event.preventDefault(); // keep focus on the input
      const title = this.titleMatches[Number(item.dataset.index)];
      if (title !== undefined) input.value = title;
      this.#hideTitleSuggestions();
    });
  }

  #refreshTitleSuggestions() {
    const query = this.titleInput.value.trim().toLowerCase();
    this.titleMatches = query ? this.#filterTitles(query) : [];
    if (!this.titleMatches.length) {
      this.#hideTitleSuggestions();
      return;
    }
    this.titleActive = 0; // like a native datalist: the first match is the pick
    this.titleSuggest.innerHTML = this.titleMatches
      .map((title, index) =>
        `<button type="button" class="field-suggest-item${index === this.titleActive ? ' active' : ''}" data-index="${index}">${escapeHtml(title)}</button>`)
      .join('');
    this.titleSuggest.hidden = false;
  }

  /** Titles starting with the typed text first, then the other matches. */
  #filterTitles(query) {
    const matches = this.titles.filter((title) => title.toLowerCase().includes(query));
    const leading = matches.filter((title) => title.toLowerCase().startsWith(query));
    return [...leading, ...matches.filter((title) => !title.toLowerCase().startsWith(query))].slice(0, 8);
  }

  #hideTitleSuggestions() {
    this.titleMatches = [];
    this.titleActive = -1;
    this.titleSuggest.hidden = true;
  }

  #onTitleKeydown(event) {
    const open = !this.titleSuggest.hidden;
    if (event.key === 'ArrowDown' && !open && this.titles.length) {
      this.#refreshTitleSuggestions(); // open the list, caret stays put
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = this.titleMatches.length;
      if (!count) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.titleActive = (this.titleActive + delta + count) % count;
      [...this.titleSuggest.children].forEach((element, index) =>
        element.classList.toggle('active', index === this.titleActive));
    } else if (event.key === 'Enter') {
      // while the list is open, Enter accepts the highlighted title — it must
      // not also submit the form (there is no submit, and the default would
      // reload the page)
      event.preventDefault();
      const title = this.titleMatches[this.titleActive];
      if (title !== undefined) {
        this.titleInput.value = title;
        this.#hideTitleSuggestions();
      }
    } else if (event.key === 'Escape') {
      event.stopPropagation(); // close the list, not the modal
      this.#hideTitleSuggestions();
    }
  }

  /** Refresh the coordinator control and the title suggestions from `/api/meta`. */
  populate(meta) {
    this.coordinators = meta.coordinators || [];
    this.titles = meta.titles || [];
    const select = $('#sel-coordinator');
    const newInput = $('#coord-new-input');
    if (!select) return;
    // an account with no past coordinators gets a plain text box instead of a
    // dropdown that could only say "none" or "new"
    select.hidden = this.coordinators.length === 0;
    if (this.coordinators.length) {
      const current = select.value;
      select.innerHTML =
        '<option value="">— none —</option>' +
        this.coordinators.map((coordinator) => `<option value="${escapeHtml(coordinator.name)}">${escapeHtml(coordinator.name)}</option>`).join('') +
        `<option value="${NEW_COORDINATOR}">➕ New Coordinator…</option>`;
      if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    }
    newInput.hidden = this.coordinators.length > 0 && select.value !== NEW_COORDINATOR;
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
    $('#shoot-modal-title').textContent = shoot ? 'Edit Entry' : 'New Entry';

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

    // coordinator: a known name selects it, an unknown one goes into the
    // text box; an account without past coordinators always uses the box
    const select = $('#sel-coordinator');
    const newInput = $('#coord-new-input');
    const freeText = this.coordinators.length === 0;
    const known = shoot?.coordinator && this.coordinators.some((coordinator) => coordinator.name === shoot.coordinator);
    if (shoot?.coordinator) {
      select.value = known ? shoot.coordinator : NEW_COORDINATOR;
      newInput.value = known ? '' : shoot.coordinator;
    } else {
      select.value = '';
      newInput.value = '';
    }
    newInput.hidden = !freeText && select.value !== NEW_COORDINATOR;
    this.#hideTitleSuggestions();

    $('#sel-status').value = appStatus(shoot?.status);

    // a second visit must look like the first: extra fields folded away and the
    // sheet scrolled back to the top
    const details = $('.more-details');
    if (details) details.open = false;
    this.modal.scrollTop = 0;
    const sheet = this.modal.firstElementChild;
    if (sheet) sheet.scrollTop = 0;

    openOverlay(this.modal);
    setTimeout(() => this.field('title').focus(), 50);
  }

  close() {
    closeOverlay(this.modal);
  }

  /** The chosen coordinator: an existing name, or the one being typed. */
  coordinatorValue() {
    const select = $('#sel-coordinator');
    if (select.hidden) return $('#coord-new-input').value.trim(); // free-text mode
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
      this.actions.notifyError('Title and date are required');
      return;
    }
    const id = this.field('id').value;
    try {
      if (id) {
        await this.api.updateShoot(id, body);
        this.actions.notify('Entry updated');
      } else {
        await this.api.createShoot(body);
        this.actions.notify('Entry added');
      }
      this.close();
      this.actions.dataChanged();
    } catch (error) {
      this.actions.notifyError('Save failed: ' + error.message);
    }
  }
}
