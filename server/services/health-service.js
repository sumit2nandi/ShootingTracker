'use strict';

/** Reports database connectivity for the status pill and the migration CLI. */
class HealthService {
  /**
   * @param {{ database: import('../persistence/postgres-database').Database,
   *           clock?: () => Date, timeoutMs?: number }} deps
   */
  constructor({ database, clock = () => new Date(), timeoutMs }) {
    this.database = database;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  /** @returns {Promise<{ ok: boolean, detail: string, latencyMs: number, time: string }>} */
  async check() {
    const health = await this.database.checkHealth(this.timeoutMs);
    return { ...health, time: this.clock().toISOString() };
  }
}

module.exports = { HealthService };
