'use strict';

const { AccessPolicy } = require('../domain/access-policy');
const { withTranslatedErrors } = require('../persistence/pg-error-translator');

const USER_COLUMNS = 'id, email, name, role, is_active, tour_completed';

/** SQL for `app_users` — the list of accounts allowed to sign in. */
class UserRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  /** @returns {Promise<object|null>} */
  async findByEmail(email) {
    const normalized = AccessPolicy.normalizeEmail(email);
    if (!normalized) return null;
    const result = await this.database.query(
      `SELECT ${USER_COLUMNS} FROM app_users WHERE lower(email) = $1`,
      [normalized]
    );
    return result.rows[0] || null;
  }

  async findById(id) {
    const result = await this.database.query(`SELECT ${USER_COLUMNS} FROM app_users WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  async list() {
    const result = await this.database.query(
      `SELECT ${USER_COLUMNS}, created_at FROM app_users ORDER BY is_active DESC, lower(email)`
    );
    return result.rows;
  }

  /**
   * Create an account that does not exist yet.
   *
   * Unlike {@link upsert} this never reactivates or alters an existing row —
   * it is the consent flow's insert, and a deactivated account must stay
   * deactivated no matter how often its owner tries to "sign in".
   *
   * @param {{ email: string, name?: string|null }} user
   * @returns {Promise<object|null>} the new row, or null when the email was already taken
   */
  async createNewUser({ email, name }) {
    const result = await this.database.query(
      `INSERT INTO app_users (email, name, role, tour_completed)
       VALUES ($1, $2, 'member', FALSE)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [AccessPolicy.normalizeEmail(email), (name && String(name).trim()) || null]
    );
    return result.rows[0] || null;
  }

  /**
   * Add an account, or reactivate one that already exists.
   *
   * @param {{ email: string, name?: string|null, role?: string }} user
   */
  async upsert({ email, name, role }) {
    const result = await withTranslatedErrors(
      () =>
        this.database.query(
          `INSERT INTO app_users (email, name, role)
           VALUES ($1, $2, COALESCE($3, 'member'))
           ON CONFLICT (lower(email)) DO UPDATE
             SET name = COALESCE(EXCLUDED.name, app_users.name),
                 role = COALESCE($3, app_users.role),
                 is_active = TRUE
           RETURNING ${USER_COLUMNS}`,
          [
            AccessPolicy.normalizeEmail(email),
            (name && String(name).trim()) || null,
            AccessPolicy.coerceRole(role)
          ]
        ),
      { conflictMessage: 'That email is already in the list' }
    );
    return result.rows[0];
  }

  /**
   * @param {number|string} id
   * @param {{ name?: string|null, role?: string, is_active?: boolean }} patch
   * @returns {Promise<object|null>} the updated row, or null when nothing matched
   */
  async update(id, patch = {}) {
    const assignments = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };
    if (patch.name !== undefined) set('name', (patch.name && String(patch.name).trim()) || null);
    if (patch.role !== undefined) set('role', AccessPolicy.coerceRole(patch.role));
    if (patch.is_active !== undefined) set('is_active', Boolean(patch.is_active));
    if (!assignments.length) return null;

    params.push(Number(id));
    const result = await this.database.query(
      `UPDATE app_users SET ${assignments.join(', ')} WHERE id = $${params.length}
       RETURNING ${USER_COLUMNS}`,
      params
    );
    return result.rows[0] || null;
  }

  /**
   * Remember that an account has seen the first-login tour.
   *
   * @returns {Promise<boolean>} whether a row was updated
   */
  async markTourCompleted(email) {
    const result = await this.database.query(
      'UPDATE app_users SET tour_completed = TRUE WHERE lower(email) = $1 AND tour_completed = FALSE',
      [AccessPolicy.normalizeEmail(email)]
    );
    return result.rowCount > 0;
  }

  /** @returns {Promise<{ id: number, email: string }|null>} */
  async deleteById(id) {
    const result = await this.database.query(
      'DELETE FROM app_users WHERE id = $1 RETURNING id, email',
      [Number(id)]
    );
    return result.rows[0] || null;
  }
}

module.exports = { UserRepository, USER_COLUMNS };
