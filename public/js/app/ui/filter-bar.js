import { $, escapeHtml } from '../core/dom.js';
import { formatMonth } from '../core/format.js';
import { FILTER_FIELDS, FILTER_KEYS, FilterCriteria } from '../domain/filter-criteria.js';
import { STATUS_ORDER, statusLabel } from '../domain/shoot-status.js';

const ALL_LABELS = {
  month: 'All',
  coordinator: 'All',
  client: 'All Clients',
  status: 'All Statuses',
  type: 'All Types'
};

/**
 * Binds the shared filter bar to {@link FilterCriteria}.
 *
 * The controls are declared once in `FILTER_FIELDS`, so reading, writing,
 * clearing and restoring them are loops instead of seven copy-pasted lines
 * each — adding a filter is a one-line change.
 */
export class FilterBar {
  constructor({ onChange, debounceMs = 180 }) {
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.element = $('#filterbar');
  }

  mount() {
    for (const [key, selector] of Object.entries(FILTER_FIELDS)) {
      const control = $(selector);
      if (!control) continue;
      const event = control.tagName === 'INPUT' ? 'input' : 'change';
      control.addEventListener(event, () => this.#scheduleChange());
    }
    const clear = $('#f-clear');
    if (clear) clear.addEventListener('click', () => this.clear());
  }

  /** Fill the option lists from `/api/meta`. */
  populate(meta) {
    this.#fillOptions('month', meta.months || [], formatMonth);
    this.#fillOptions('coordinator', (meta.coordinators || []).map((coordinator) => coordinator.name));
    this.#fillOptions('client', meta.clients || []);
    this.#fillOptions('type', meta.types || []);
    this.#fillOptions('status', (meta.statuses || []).filter((status) => STATUS_ORDER.includes(status)), statusLabel);

    setDatalist('#dl-coordinators', (meta.coordinators || []).map((coordinator) => coordinator.name));
    setDatalist('#dl-clients', meta.clients || []);
    setDatalist('#dl-types', meta.types || []);
  }

  read() {
    const values = {};
    for (const [key, selector] of Object.entries(FILTER_FIELDS)) {
      const control = $(selector);
      values[key] = control ? String(control.value || '').trim() : '';
    }
    return new FilterCriteria(values);
  }

  write(criteria) {
    for (const [key, selector] of Object.entries(FILTER_FIELDS)) {
      const control = $(selector);
      if (!control) continue;
      const value = criteria[key] || '';
      // a stale option (e.g. a month that no longer exists) falls back to "All"
      const exists = control.tagName === 'INPUT' || !value || [...control.options].some((option) => option.value === value);
      control.value = exists ? value : '';
    }
  }

  clear() {
    this.write(FilterCriteria.empty());
    this.onChange(this.read());
  }

  setVisible(visible) {
    // `collapsed` animates the bar's height away; `hidden` would snap it out
    if (this.element) this.element.classList.toggle('collapsed', !visible);
  }

  setContext(view) {
    if (this.element) this.element.dataset.for = view;
  }

  #scheduleChange() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(this.read()), this.debounceMs);
  }

  #fillOptions(key, values, label = (value) => value) {
    const control = $(FILTER_FIELDS[key]);
    if (!control || control.tagName === 'INPUT') return;
    const current = control.value;
    control.innerHTML =
      `<option value="">${ALL_LABELS[key] || 'All'}</option>` +
      values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`).join('');
    if (values.includes(current)) control.value = current;
  }
}

function setDatalist(selector, values) {
  const list = $(selector);
  if (list) list.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">`).join('');
}

export { FILTER_KEYS };
