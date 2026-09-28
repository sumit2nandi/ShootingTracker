'use strict';

const fs = require('fs');
const path = require('path');
const { silentLogger } = require('../core/logger');

const SCHEMA_FILE = path.join(__dirname, '..', 'schema.sql');

/**
 * Applies `schema.sql` when the database is not at the current shape.
 *
 * Two situations trigger an application:
 *  - `app_users` does not exist at all (a brand-new database); and
 *  - `app_users` exists but `shoots.owner_id` does not (a database created
 *    before per-user data existed). `schema.sql` is idempotent, including
 *    its trailing convergence section, so applying it in either case is safe.
 *
 * The concern lives here rather than in the user repository: repositories
 * read and write rows, they do not create tables.
 */
class SchemaInitializer {
  /**
   * @param {{ database: import('./postgres-database').Database, logger?: object, schemaFile?: string }} deps
   */
  constructor({ database, logger = silentLogger, schemaFile = SCHEMA_FILE }) {
    this.database = database;
    this.logger = logger;
    this.schemaFile = schemaFile;
    /** @type {Promise<void>|null} in-flight work, so concurrent callers share one run */
    this.pending = null;
  }

  readSchemaSql() {
    return fs.readFileSync(this.schemaFile, 'utf8');
  }

  /** Apply the schema unconditionally (used by `npm run migrate`). */
  async apply() {
    await this.database.query(this.readSchemaSql());
  }

  /**
   * @returns {Promise<{ needed: boolean, reason: 'fresh'|'pre-per-user'|'current' }>}
   */
  async inspect() {
    const result = await this.database.query(
      `SELECT to_regclass('public.app_users') IS NOT NULL AS has_users,
              (SELECT count(*)::int FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'shoots' AND column_name = 'owner_id') AS has_owner`
    );
    const { has_users, has_owner } = result.rows[0];
    if (!has_users) return { needed: true, reason: 'fresh' };
    if (!has_owner) return { needed: true, reason: 'pre-per-user' };
    return { needed: false, reason: 'current' };
  }

  /**
   * Ensure the schema is current. Memoized after the first success; a failure
   * clears the memo so the next caller retries.
   */
  ensureApplied() {
    if (!this.pending) {
      this.pending = (async () => {
        const { needed, reason } = await this.inspect();
        if (!needed) return;
        await this.apply();
        this.logger.info(
          reason === 'fresh'
            ? 'app_users was missing — applied schema.sql'
            : 'database predated per-user data — applied schema.sql (convergence)'
        );
      })().catch((error) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }
}

module.exports = { SchemaInitializer, SCHEMA_FILE };
