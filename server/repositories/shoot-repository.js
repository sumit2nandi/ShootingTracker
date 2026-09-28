'use strict';

const { BASE_CTE, SHOOT_COLUMNS } = require('./shoot-queries');
const { withTranslatedErrors } = require('../persistence/pg-error-translator');

/**
 * All SQL for the `shoots` table, and nothing else.
 *
 * Services talk to this narrow interface, so business rules can be tested with
 * an in-memory double and the storage engine can change without touching them.
 */
class ShootRepository {
  /**
   * @param {{ database: import('../persistence/postgres-database').Database, maxRows?: number }} deps
   */
  constructor({ database, maxRows = 2000 }) {
    this.database = database;
    this.maxRows = maxRows;
  }

  /**
   * @param {import('../domain/shoot-filter').ShootFilter} filter
   * @returns {Promise<object[]>}
   */
  async findMany(filter) {
    const { where, params } = filter.toSql({ alias: 'b' });
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT ${SHOOT_COLUMNS}
      FROM base b ${where}
      ORDER BY b.shoot_date DESC, b.id DESC
      LIMIT ${this.maxRows}`,
      params
    );
    return result.rows;
  }

  /** @returns {Promise<object|null>} */
  async findById(id) {
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT ${SHOOT_COLUMNS}
      FROM base b WHERE b.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async existsById(id, executor = this.database) {
    const result = await executor.query('SELECT 1 FROM shoots WHERE id = $1', [id]);
    return result.rows.length > 0;
  }

  /**
   * @param {Record<string, unknown>} values column → value (whitelisted upstream by ShootInput)
   * @param {{ query: Function }} [executor] a transaction client, when part of one
   * @returns {Promise<number>} the new id
   */
  async insert(values, executor = this.database) {
    const columns = Object.keys(values);
    const placeholders = columns.map((_column, index) => `$${index + 1}`);
    const result = await withTranslatedErrors(() =>
      executor.query(
        `INSERT INTO shoots (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING id`,
        Object.values(values).map(normalizeJson)
      )
    );
    return result.rows[0].id;
  }

  /** @returns {Promise<boolean>} whether a row was updated */
  async update(id, values, executor = this.database) {
    const columns = Object.keys(values);
    if (!columns.length) return this.existsById(id, executor);
    const assignments = columns.map((column, index) => `${column} = $${index + 1}`).join(', ');
    const result = await withTranslatedErrors(() =>
      executor.query(
        `UPDATE shoots SET ${assignments} WHERE id = $${columns.length + 1}`,
        [...Object.values(values).map(normalizeJson), id]
      )
    );
    return result.rowCount > 0;
  }

  /** @returns {Promise<boolean>} whether a row was deleted */
  async deleteById(id) {
    const result = await this.database.query('DELETE FROM shoots WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async countByCoordinator(coordinatorId) {
    const result = await this.database.query(
      'SELECT count(*)::int AS n FROM shoots WHERE coordinator_id = $1',
      [coordinatorId]
    );
    return result.rows[0].n;
  }

  /**
   * Insert an imported row, skipping rows already present (same dedupe hash).
   *
   * @returns {Promise<number|null>} the new id, or null when skipped as duplicate
   */
  async insertImported(record, executor = this.database) {
    const result = await executor.query(
      `INSERT INTO shoots (title, client_name, shoot_type, shoot_date, end_date, start_time, end_time,
                           venue, location, coordinator_id, fee, status, contact_name, contact_phone,
                           notes, extra, dedupe_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
       ON CONFLICT (dedupe_hash) DO NOTHING
       RETURNING id`,
      [
        record.title,
        record.client_name,
        record.shoot_type,
        record.shoot_date,
        record.end_date,
        record.start_time,
        record.end_time,
        record.venue,
        record.location,
        record.coordinator_id,
        record.fee,
        record.status,
        record.contact_name,
        record.contact_phone,
        record.notes,
        JSON.stringify(record.extra || {}),
        record.dedupe_hash
      ]
    );
    return result.rows.length ? result.rows[0].id : null;
  }
}

/** `extra` is JSONB: pg needs a string, not a JS object. */
function normalizeJson(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    ? JSON.stringify(value)
    : value;
}

module.exports = { ShootRepository };
