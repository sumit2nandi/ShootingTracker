'use strict';

const { ServiceUnavailableError } = require('../core/errors');
const { TtlCache } = require('../core/ttl-cache');
const { AccessPolicy } = require('../domain/access-policy');

const ACCESS_HINT = 'Could not read the app_users table. If the database is new, run: npm run migrate';

/**
 * The read side of the allow-list: "is this account allowed in, and as what?".
 *
 * Every request hits this, so answers are cached for a short while. Failures to
 * reach the table surface as a 503 with an actionable hint rather than a
 * generic 500, because that is nearly always a missing migration.
 */
class UserDirectory {
  /**
   * @param {{ userRepository: import('../repositories/user-repository').UserRepository,
   *           schemaInitializer: import('../persistence/schema-initializer').SchemaInitializer,
   *           cacheTtlMs?: number, clock?: () => number }} deps
   */
  constructor({ userRepository, schemaInitializer, cacheTtlMs = 20_000, clock = Date.now }) {
    this.userRepository = userRepository;
    this.schemaInitializer = schemaInitializer;
    this.cache = new TtlCache({ ttlMs: cacheTtlMs, clock });
  }

  /**
   * @param {string} email
   * @returns {Promise<object|null>} the account row, or null when unknown
   * @throws {ServiceUnavailableError} when the allow-list cannot be read
   */
  async lookup(email) {
    const key = AccessPolicy.normalizeEmail(email);
    if (!key) return null;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    try {
      await this.schemaInitializer.ensureApplied();
      return this.cache.set(key, await this.userRepository.findByEmail(key));
    } catch (error) {
      throw new ServiceUnavailableError(`${ACCESS_HINT} (${error.message})`, { cause: error });
    }
  }

  /** @returns {Promise<boolean>} whether the account may sign in right now */
  async isAllowed(email) {
    const user = await this.lookup(email);
    return Boolean(user && user.is_active);
  }

  /** Drop cached answers after the allow-list changes. */
  invalidate() {
    this.cache.clear();
  }
}

module.exports = { UserDirectory, ACCESS_HINT };
