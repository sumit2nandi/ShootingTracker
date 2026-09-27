'use strict';

const { Pool } = require('pg');
const { buildPoolConfig } = require('./pool-config');
const { applyDateTypeParsers } = require('./type-parsers');
const { silentLogger } = require('../core/logger');

/**
 * @typedef {object} QueryExecutor
 * @property {(text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number }>} query
 */

/**
 * @typedef {object} Database
 * @property {(text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number }>} query
 * @property {<T>(work: (executor: QueryExecutor) => Promise<T>) => Promise<T>} withTransaction
 * @property {(timeoutMs?: number) => Promise<{ ok: boolean, detail: string, latencyMs: number }>} checkHealth
 * @property {() => Promise<void>} close
 */

/**
 * PostgreSQL adapter for the {@link Database} port.
 *
 * Repositories depend on that narrow interface, never on `pg` itself, so the
 * driver (or a fake in tests) can be swapped without touching business code.
 *
 * @implements {Database}
 */
class PostgresDatabase {
  /**
   * @param {{ url?: string, pool?: import('pg').Pool, logger?: object,
   *           connectionTimeoutMillis?: number, idleTimeoutMillis?: number,
   *           maxClients?: number, healthCheckTimeoutMs?: number }} options
   */
  constructor(options = {}) {
    this.logger = options.logger || silentLogger;
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs || 5_000;
    if (options.pool) {
      this.pool = options.pool;
    } else {
      applyDateTypeParsers();
      this.pool = new Pool(buildPoolConfig(options.url || '', options));
    }
    this.pool.on('error', (error) => this.logger.error('idle client error:', error.message));
  }

  /** @type {Database['query']} */
  query(text, params) {
    return this.pool.query(text, params);
  }

  /**
   * Run `work` inside a transaction; commit on success, roll back on throw.
   * Callers get a {@link QueryExecutor} and never see connection handling.
   *
   * @type {Database['withTransaction']}
   */
  async withTransaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error('rollback failed:', rollbackError.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Connectivity probe with a hard timeout — used by the status pill and the
   * migration CLI.
   *
   * @type {Database['checkHealth']}
   */
  async checkHealth(timeoutMs = this.healthCheckTimeoutMs) {
    const startedAt = Date.now();
    const result = await Promise.race([
      this.query('SELECT 1')
        .then(() => ({ ok: true, detail: 'connected' }))
        .catch((error) => ({ ok: false, detail: error.message })),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, detail: 'timeout' }), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      })
    ]);
    return { ...result, latencyMs: Date.now() - startedAt };
  }

  /** @type {Database['close']} */
  close() {
    return this.pool.end();
  }
}

module.exports = { PostgresDatabase };
