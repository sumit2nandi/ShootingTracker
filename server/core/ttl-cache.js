'use strict';

/**
 * A tiny map with a per-entry time-to-live.
 *
 * Caching used to be hand-rolled inside the user lookup, where one shared
 * timestamp expired (or kept) every entry at once. Extracting it gives a single
 * place to reason about expiry, makes the clock injectable for tests, and lets
 * any other module reuse it.
 *
 * @template K, V
 */
class TtlCache {
  /**
   * @param {{ ttlMs: number, clock?: () => number, maxEntries?: number }} options
   */
  constructor({ ttlMs, clock = Date.now, maxEntries = 1000 }) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new TypeError('ttlMs must be a non-negative number');
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.maxEntries = maxEntries;
    /** @type {Map<K, { value: V, expiresAt: number }>} */
    this.entries = new Map();
  }

  /** @returns {V|undefined} the cached value, or undefined when absent/expired. */
  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  /** @param {V} value */
  set(key, value) {
    if (this.entries.size >= this.maxEntries) {
      // cheap bound: drop the oldest insertion when the cache is full
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.clock() + this.ttlMs });
    return value;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { TtlCache };
