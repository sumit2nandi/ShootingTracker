'use strict';

const { ValidationError } = require('../core/errors');
const { coerceShootStatus, DEFAULT_SHOOT_STATUS } = require('./shoot-status');

/** Columns a client may write. Anything else is ignored (never trusted into SQL). */
const WRITABLE_SHOOT_COLUMNS = Object.freeze([
  'title',
  'client_name',
  'shoot_type',
  'shoot_date',
  'end_date',
  'start_time',
  'end_time',
  'venue',
  'location',
  'fee',
  'status',
  'contact_name',
  'contact_phone',
  'notes'
]);

const isBlank = (value) => value === null || value === undefined || value === '';

/**
 * A validated, database-shaped shoot payload.
 *
 * Validation and normalization live here rather than in a route handler, so the
 * HTTP layer, the CLI importer and the tests all agree on what a valid shoot
 * is.
 */
class ShootInput {
  /**
   * @param {Record<string, unknown>} values column → value (already whitelisted)
   * @param {{ coordinatorName?: string|null }} [extras]
   *        `coordinatorName` is `undefined` when untouched, `null` to clear the
   *        link and a string when the coordinator must be upserted by name.
   */
  constructor(values, { coordinatorName } = {}) {
    this.values = values;
    this.coordinatorName = coordinatorName;
  }

  get columns() {
    return Object.keys(this.values);
  }

  get isEmpty() {
    return this.columns.length === 0 && this.coordinatorName === undefined;
  }

  /** Full payload for an INSERT: required fields enforced, NOT NULL defaults filled in. */
  static forCreate(body = {}) {
    const input = ShootInput.#normalize(body, false);
    if (!input.values.title || !input.values.shoot_date) {
      throw new ValidationError('title and shoot_date are required');
    }
    return input;
  }

  /** Partial payload for an UPDATE: only the keys the caller sent. */
  static forUpdate(body = {}) {
    const input = ShootInput.#normalize(body, true);
    if (input.isEmpty) throw new ValidationError('no fields to update');
    return input;
  }

  static #normalize(body, partial) {
    const values = {};
    for (const column of WRITABLE_SHOOT_COLUMNS) {
      if (body[column] !== undefined) values[column] = isBlank(body[column]) ? null : body[column];
      else if (!partial) values[column] = null;
    }

    let coordinatorName;
    // An explicit id always wins over a name. (Previously an id on its own was
    // ignored unless a `coordinator` key was sent alongside it.)
    if (body.coordinator_id !== undefined) {
      values.coordinator_id = isBlank(body.coordinator_id) ? null : Number(body.coordinator_id);
      if (values.coordinator_id !== null && !Number.isFinite(values.coordinator_id)) {
        throw new ValidationError('coordinator_id must be a number');
      }
    } else if (body.coordinator !== undefined) {
      if (isBlank(body.coordinator)) {
        values.coordinator_id = null;
        coordinatorName = null;
      } else if (/^\d+$/.test(String(body.coordinator))) {
        values.coordinator_id = Number(body.coordinator);
      } else {
        coordinatorName = String(body.coordinator).trim();
      }
    }

    if (body.extra !== undefined) {
      values.extra = typeof body.extra === 'object' && body.extra !== null ? body.extra : {};
    } else if (!partial) {
      values.extra = {};
    }

    if (values.status !== undefined && values.status !== null) {
      values.status = coerceShootStatus(values.status);
    }
    if (values.fee !== undefined && values.fee !== null) {
      values.fee = Number(values.fee) || 0;
    }

    if (!partial) {
      // server-side defaults for NOT NULL columns
      if (isBlank(values.status)) values.status = DEFAULT_SHOOT_STATUS;
      if (isBlank(values.fee)) values.fee = 0;
      if (isBlank(values.extra)) values.extra = {};
    }

    return new ShootInput(values, { coordinatorName });
  }
}

module.exports = { ShootInput, WRITABLE_SHOOT_COLUMNS };
