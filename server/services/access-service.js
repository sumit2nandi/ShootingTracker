'use strict';

const { ConflictError, NotFoundError } = require('../core/errors');
const { AccessPolicy } = require('../domain/access-policy');

/**
 * The write side of the allow-list: who may sign in, and with which role.
 *
 * Decisions come from {@link AccessPolicy} (pure rules), storage from the user
 * repository, and cache invalidation from the directory — this class only
 * sequences them. Invariants are checked *before* anything is written, so the
 * database is never briefly left without an owner.
 */
class AccessService {
  /**
   * @param {{ userRepository: import('../repositories/user-repository').UserRepository,
   *           userDirectory: import('./user-directory').UserDirectory,
   *           schemaInitializer: import('../persistence/schema-initializer').SchemaInitializer }} deps
   */
  constructor({ userRepository, userDirectory, schemaInitializer }) {
    this.userRepository = userRepository;
    this.userDirectory = userDirectory;
    this.schemaInitializer = schemaInitializer;
  }

  async list() {
    await this.schemaInitializer.ensureApplied();
    return this.userRepository.list();
  }

  /**
   * Add an account (or reactivate an existing one).
   *
   * New accounts always arrive as **members** — the `role` a caller might send
   * is ignored; an owner promotes them later, from the list itself.
   *
   * @param {{ email: string, name?: string }} input
   * @returns {Promise<object>} the created (or reactivated) account
   */
  async add(input = {}) {
    const email = AccessPolicy.assertValidEmail(input.email);
    await this.schemaInitializer.ensureApplied();
    const user = await this.userRepository.upsert({ email, name: input.name });
    this.userDirectory.invalidate();
    return user;
  }

  /**
   * Create the profile of a brand-new sign-in (the consent flow).
   *
   * The account always arrives as a *member* — ownership is granted from
   * "People with Access" — and the first-login tour is left uncompleted so it
   * plays on their very first visit to the app.
   *
   * @param {{ email: string, name?: string|null }} input
   * @returns {Promise<object>} the created account
   * @throws {ValidationError} on a bad address, or when the account already exists
   */
  async createNewUser(input = {}) {
    const email = AccessPolicy.assertValidEmail(input.email);
    await this.schemaInitializer.ensureApplied();
    const user = await this.userRepository.createNewUser({ email, name: input.name });
    if (!user) throw new ConflictError('That email is already in the list');
    this.userDirectory.invalidate();
    return user;
  }

  /**
   * Remember that an account saw the first-login tour.
   *
   * @param {string} email of the signed-in account
   */
  async markTourCompleted(email) {
    await this.userRepository.markTourCompleted(email);
    this.userDirectory.invalidate();
  }

  /**
   * @param {number|string} id
   * @param {{ name?: string, role?: string, is_active?: boolean }} patch
   * @param {{ actor: object }} context the signed-in owner making the change
   */
  async update(id, patch = {}, { actor } = {}) {
    const users = await this.list();
    const target = findById(users, id);
    AccessPolicy.assertCanUpdate({ users, target, patch, actor });

    const updated = await this.userRepository.update(id, patch);
    if (!updated) throw new NotFoundError();
    this.userDirectory.invalidate();
    return updated;
  }

  /**
   * @param {number|string} id
   * @param {{ actor: object }} context
   * @returns {Promise<{ id: number, email: string }>} the removed account
   */
  async remove(id, { actor } = {}) {
    const users = await this.list();
    const target = findById(users, id);
    AccessPolicy.assertCanRemove({ users, target, actor });

    const removed = await this.userRepository.deleteById(id);
    if (!removed) throw new NotFoundError();
    this.userDirectory.invalidate();
    return removed;
  }
}

function findById(users, id) {
  const found = users.find((user) => String(user.id) === String(id));
  if (!found) throw new NotFoundError();
  return found;
}

module.exports = { AccessService };
