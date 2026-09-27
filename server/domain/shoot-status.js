'use strict';

/**
 * The vocabulary of the domain, in one place.
 *
 * A shoot is either still to come (`planned`) or closed out (`completed`).
 * Imports, filters, the API and the UI all read these constants instead of
 * repeating string literals, so adding a state is a single-file change.
 */
const SHOOT_STATUSES = Object.freeze(['planned', 'completed']);
const DEFAULT_SHOOT_STATUS = 'planned';

/** Derived from the payments ledger, never stored. */
const PAYMENT_STATUSES = Object.freeze(['paid', 'partial', 'unpaid']);

/** Payment filters accepted by the API (`outstanding` spans partial + unpaid). */
const PAYMENT_STATUS_FILTERS = Object.freeze([...PAYMENT_STATUSES, 'outstanding']);

const isShootStatus = (value) => SHOOT_STATUSES.includes(value);

/** Any unknown status folds into the default rather than reaching the database. */
const coerceShootStatus = (value) => (isShootStatus(value) ? value : DEFAULT_SHOOT_STATUS);

/** Keep only the statuses the domain knows, from a comma separated list. */
function parseStatusList(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(isShootStatus);
}

module.exports = {
  SHOOT_STATUSES,
  DEFAULT_SHOOT_STATUS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_FILTERS,
  isShootStatus,
  coerceShootStatus,
  parseStatusList
};
