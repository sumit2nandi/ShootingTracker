'use strict';

/**
 * Hand-written test doubles.
 *
 * They exist because every collaborator is injected: a service under test can
 * be given an in-memory repository, and a repository can be given a database
 * that only records the SQL it was asked to run.
 */

/** Records every statement, replies with canned rows. */
class RecordingDatabase {
  /** @param {Array<{ rows?: any[], rowCount?: number }>} [responses] consumed in order */
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  async query(text, params) {
    this.calls.push({ text, params });
    const next = this.responses.shift() || {};
    return { rows: next.rows || [], rowCount: next.rowCount !== undefined ? next.rowCount : (next.rows || []).length };
  }

  /** Runs `work` with itself as the executor — no real transaction needed. */
  async withTransaction(work) {
    this.calls.push({ text: 'BEGIN' });
    try {
      const result = await work(this);
      this.calls.push({ text: 'COMMIT' });
      return result;
    } catch (error) {
      this.calls.push({ text: 'ROLLBACK' });
      throw error;
    }
  }

  async checkHealth() {
    return { ok: true, detail: 'connected', latencyMs: 1 };
  }

  async close() {}

  /** All statements issued so far, whitespace-collapsed for easy matching. */
  get statements() {
    return this.calls.map((call) => call.text.replace(/\s+/g, ' ').trim());
  }
}

/** In-memory stand-in for ShootRepository. */
class FakeShootRepository {
  constructor(rows = []) {
    this.rows = [...rows];
    this.nextId = Math.max(0, ...this.rows.map((row) => row.id)) + 1;
    this.inserted = [];
    this.updated = [];
  }

  async findMany(filter) {
    this.lastFilter = filter;
    return this.rows;
  }

  async findById(id) {
    return this.rows.find((row) => row.id === Number(id)) || null;
  }

  async existsById(id) {
    return this.rows.some((row) => row.id === Number(id));
  }

  async insert(values) {
    const id = this.nextId++;
    this.inserted.push(values);
    this.rows.push({ id, ...values });
    return id;
  }

  async update(id, values) {
    const row = this.rows.find((candidate) => candidate.id === Number(id));
    if (!row) return false;
    this.updated.push({ id: Number(id), values });
    Object.assign(row, values);
    return true;
  }

  async deleteById(id) {
    const index = this.rows.findIndex((row) => row.id === Number(id));
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async countByCoordinator(coordinatorId) {
    return this.rows.filter((row) => row.coordinator_id === Number(coordinatorId)).length;
  }
}

class FakePaymentRepository {
  constructor(rows = []) {
    this.rows = [...rows];
    this.nextId = 1;
  }

  async listByShoot(shootId) {
    return this.rows.filter((row) => row.shoot_id === Number(shootId));
  }

  async insert(payment) {
    const id = this.nextId++;
    this.rows.push({ id, ...payment });
    return id;
  }

  async deleteById(id) {
    const index = this.rows.findIndex((row) => row.id === Number(id));
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

class FakeMediaRepository {
  constructor(rows = []) {
    this.rows = [...rows];
    this.nextId = 1;
  }

  async listByShoot(shootId) {
    return this.rows.filter((row) => row.shoot_id === Number(shootId));
  }

  async insert(media) {
    const id = this.nextId++;
    this.rows.push({ id, ...media });
    return id;
  }

  async deleteById(id) {
    const index = this.rows.findIndex((row) => row.id === Number(id));
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

class FakeCoordinatorRepository {
  constructor(rows = []) {
    this.rows = [...rows];
    this.nextId = Math.max(0, ...this.rows.map((row) => row.id)) + 1;
  }

  async list() {
    return this.rows;
  }

  async upsertByName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const existing = this.rows.find((row) => row.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const row = { id: this.nextId++, name: trimmed };
    this.rows.push(row);
    return row.id;
  }

  async upsert({ name }) {
    const id = await this.upsertByName(name);
    return { id, name: String(name).trim() };
  }

  async deleteById(id) {
    const index = this.rows.findIndex((row) => row.id === Number(id));
    if (index < 0) return null;
    return this.rows.splice(index, 1)[0];
  }
}

/** In-memory stand-in for UserRepository. */
class FakeUserRepository {
  constructor(rows = []) {
    this.rows = rows.map((row) => ({ is_active: true, role: 'member', ...row }));
    this.nextId = Math.max(0, ...this.rows.map((row) => row.id || 0)) + 1;
  }

  async findByEmail(email) {
    const key = String(email).toLowerCase();
    return this.rows.find((row) => String(row.email).toLowerCase() === key) || null;
  }

  async list() {
    return this.rows.map((row) => ({ ...row }));
  }

  async upsert({ email, name }) {
    const existing = await this.findByEmail(email);
    if (existing) {
      // mirrors the real repository: re-adding reactivates and renames, but
      // never touches the role (database-level only)
      Object.assign(existing, { name: name || existing.name, is_active: true });
      return { ...existing };
    }
    const row = { id: this.nextId++, email, name: name || null, role: 'member', is_active: true };
    this.rows.push(row);
    return { ...row };
  }

  async update(id, patch) {
    const row = this.rows.find((candidate) => String(candidate.id) === String(id));
    if (!row) return null;
    // the repository applies only what it can write: no role here either
    const { role, ...writable } = patch;
    Object.assign(row, writable);
    return { ...row };
  }

  async deleteById(id) {
    const index = this.rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) return null;
    const [removed] = this.rows.splice(index, 1);
    return { id: removed.id, email: removed.email };
  }
}

/** Schema bootstrap that does nothing (the tables "exist"). */
const noopSchemaInitializer = { ensureApplied: async () => {}, apply: async () => {} };

module.exports = {
  RecordingDatabase,
  FakeShootRepository,
  FakePaymentRepository,
  FakeMediaRepository,
  FakeCoordinatorRepository,
  FakeUserRepository,
  noopSchemaInitializer
};
