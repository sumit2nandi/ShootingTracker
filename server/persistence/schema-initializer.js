'use strict';

const fs = require('fs');
const path = require('path');
const { silentLogger } = require('../core/logger');

const SCHEMA_FILE = path.join(__dirname, '..', 'schema.sql');

/**
 * Applies `schema.sql` when the database has never been migrated.
 *
 * The allow-list lives in `app_users`, so a fresh database would lock everyone
 * out; the schema is idempotent, so applying it once on demand is safe. The
 * concern lives here rather than in the user repository: repositories read and
 * write rows, they do not create tables.
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
   * Ensure the access table exists. Memoized after the first success; a failure
   * clears the memo so the next caller retries.
   */
  ensureApplied() {
    if (!this.pending) {
      this.pending = (async () => {
        const result = await this.database.query("SELECT to_regclass('public.app_users') AS t");
        if (!result.rows[0].t) {
          await this.apply();
          this.logger.info('app_users was missing — applied schema.sql');
        }
      })().catch((error) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }
}

module.exports = { SchemaInitializer, SCHEMA_FILE };
