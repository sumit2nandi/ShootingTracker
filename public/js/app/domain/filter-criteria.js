/**
 * The filter bar's state as a value object.
 *
 * Pure and framework-free: it can be compared, serialized into a query string
 * and unit-tested. The DOM binding lives in `ui/filter-bar.js`.
 */
export const FILTER_FIELDS = Object.freeze({
  month: '#f-month',
  coordinator: '#f-coordinator',
  client: '#f-client',
  status: '#f-status',
  paymentStatus: '#f-payment',
  type: '#f-type',
  q: '#f-q'
});

export const FILTER_KEYS = Object.freeze(Object.keys(FILTER_FIELDS));

export class FilterCriteria {
  constructor(values = {}) {
    for (const key of FILTER_KEYS) this[key] = values[key] || '';
    Object.freeze(this);
  }

  static empty() {
    return new FilterCriteria();
  }

  with(patch) {
    return new FilterCriteria({ ...this, ...patch });
  }

  get isActive() {
    return FILTER_KEYS.some((key) => this[key]);
  }

  /** `month=2026-04&status=planned` — empty values are omitted. */
  toQueryString() {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) if (this[key]) params.set(key, this[key]);
    return params.toString();
  }

  toJSON() {
    return Object.fromEntries(FILTER_KEYS.map((key) => [key, this[key]]));
  }
}
