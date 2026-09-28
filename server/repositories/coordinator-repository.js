'use strict';

const { withTranslatedErrors } = require('../persistence/pg-error-translator');

/** SQL for the people who handle shoots. */
class CoordinatorRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  async list() {
    const result = await this.database.query('SELECT id, name FROM coordinators ORDER BY lower(name)');
    return result.rows;
  }

  /**
   * Insert or return the coordinator with this name (case-insensitive).
   *
   * @param {string} name
   * @param {{ query: Function }} [executor] transaction client, when part of one
   * @returns {Promise<number|null>} the coordinator id, or null for a blank name
   */
  async upsertByName(name, executor = this.database) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const result = await withTranslatedErrors(() =>
      executor.query(
        `INSERT INTO coordinators (name) VALUES ($1)
         ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [trimmed]
      )
    );
    return result.rows[0].id;
  }

  /**
   * Upsert with contact details, keeping existing values when the new ones are blank.
   *
   * @param {{ name: string, email?: string|null, phone?: string|null, notes?: string|null }} details
   * @returns {Promise<{ id: number, name: string }>}
   */
  async upsert({ name, email, phone, notes }) {
    const result = await withTranslatedErrors(() =>
      this.database.query(
        `INSERT INTO coordinators (name, email, phone, notes)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (lower(name)) DO UPDATE SET
           email = COALESCE(EXCLUDED.email, coordinators.email),
           phone = COALESCE(EXCLUDED.phone, coordinators.phone)
         RETURNING id, name`,
        [String(name).trim(), email || null, phone || null, notes || null]
      )
    );
    return result.rows[0];
  }

  /** @returns {Promise<{ id: number, name: string }|null>} */
  async deleteById(id) {
    const result = await this.database.query(
      'DELETE FROM coordinators WHERE id = $1 RETURNING id, name',
      [id]
    );
    return result.rows[0] || null;
  }
}

module.exports = { CoordinatorRepository };
