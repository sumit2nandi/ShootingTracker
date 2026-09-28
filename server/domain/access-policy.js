'use strict';

const { ConflictError, ForbiddenError, ValidationError } = require('../core/errors');

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OWNER = 'owner';
const MEMBER = 'member';
const ROLES = Object.freeze([OWNER, MEMBER]);

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const sameAccount = (a, b) => normalizeEmail(a) === normalizeEmail(b) && normalizeEmail(a) !== '';
const isActiveOwner = (user) => Boolean(user && user.is_active && user.role === OWNER);

/**
 * The rules that decide who may change the allow-list.
 *
 * Pure functions over plain user rows: no database, no HTTP. That makes every
 * invariant ("an app without an active owner is unusable", "you cannot lock
 * yourself out") directly unit-testable, and — unlike the previous
 * update-then-undo approach — the checks run *before* anything is written.
 */
class AccessPolicy {
  static get OWNER() {
    return OWNER;
  }

  static get MEMBER() {
    return MEMBER;
  }

  static get ROLES() {
    return ROLES;
  }

  static normalizeEmail(email) {
    return normalizeEmail(email);
  }

  static coerceRole(role) {
    return role === OWNER ? OWNER : MEMBER;
  }

  /** @throws {ValidationError} when the address cannot be an account. */
  static assertValidEmail(email) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new ValidationError('A valid email address is required');
    }
    return normalized;
  }

  /** @throws {ForbiddenError} when the actor is not an owner. */
  static assertCanManageAccess(actor) {
    if (!actor || actor.role !== OWNER) {
      throw new ForbiddenError('Only an owner can manage access');
    }
  }

  /**
   * Would applying `patch` to `target` leave the app without an active owner?
   *
   * @param {{ users: object[], target: object, patch: { role?: string, is_active?: boolean } }} input
   */
  static wouldRemoveLastOwner({ users, target, patch }) {
    const next = users.map((user) =>
      String(user.id) === String(target.id) ? { ...user, ...patch } : user
    );
    return !next.some(isActiveOwner);
  }

  /**
   * Validate a PATCH to the allow-list.
   *
   * Roles are deliberately **not** changeable from the app: demoting an owner
   * or promoting a member is a deliberate database-level decision
   * (`UPDATE app_users SET role = …`), not a tap in a list. Everything else
   * (name, active flag) stays owner-manageable, with the last-owner rule still
   * guarding against locking everyone out.
   *
   * @throws {ForbiddenError} when the patch touches the role
   * @throws {ConflictError}  when the change would leave the app without an owner
   */
  static assertCanUpdate({ users, target, patch }) {
    if (patch.role !== undefined) {
      throw new ForbiddenError(
        'Roles are not changed from the app — update the role in the database (app_users)'
      );
    }
    if (patch.is_active === false && target.role === OWNER) {
      if (AccessPolicy.wouldRemoveLastOwner({ users, target, patch })) {
        throw new ConflictError('At least one active owner is required');
      }
    }
  }

  /** @throws {ConflictError} on self-removal or removing the last owner. */
  static assertCanRemove({ users, target, actor }) {
    if (sameAccount(target.email, actor && actor.email)) {
      throw new ConflictError('You cannot remove your own access');
    }
    if (target.role === OWNER && users.filter(isActiveOwner).length <= 1) {
      throw new ConflictError('At least one owner is required');
    }
  }
}

module.exports = { AccessPolicy, EMAIL_PATTERN };
