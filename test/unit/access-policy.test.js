'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AccessPolicy } = require('../../server/domain/access-policy');
const { ConflictError, ForbiddenError, ValidationError } = require('../../server/core/errors');

const owner = { id: 1, email: 'owner@example.com', role: 'owner', is_active: true };
const secondOwner = { id: 2, email: 'second@example.com', role: 'owner', is_active: true };
const member = { id: 3, email: 'member@example.com', role: 'member', is_active: true };
const inactiveOwner = { id: 4, email: 'old@example.com', role: 'owner', is_active: false };

test('only owners may manage access', () => {
  assert.throws(() => AccessPolicy.assertCanManageAccess(member), ForbiddenError);
  assert.throws(() => AccessPolicy.assertCanManageAccess(null), /Only an owner can manage access/);
  assert.doesNotThrow(() => AccessPolicy.assertCanManageAccess(owner));
});

test('email addresses are validated and normalized', () => {
  assert.equal(AccessPolicy.assertValidEmail('  Person@Example.COM '), 'person@example.com');
  assert.throws(() => AccessPolicy.assertValidEmail('not-an-email'), ValidationError);
});

test('roles outside the vocabulary fall back to member', () => {
  assert.equal(AccessPolicy.coerceRole('owner'), 'owner');
  assert.equal(AccessPolicy.coerceRole('superuser'), 'member');
});

test('an owner may switch another account’s role — both directions', () => {
  const users = [owner, secondOwner, member];
  const actor = { email: 'second@example.com' };
  // owner → member, with another active owner still around
  assert.doesNotThrow(
    () => AccessPolicy.assertCanUpdate({ users, target: owner, patch: { role: 'member' }, actor })
  );
  // member → owner
  assert.doesNotThrow(
    () => AccessPolicy.assertCanUpdate({ users, target: member, patch: { role: 'owner' }, actor })
  );
  // and a no-op rewrite of an owner’s role (by a different account)
  assert.doesNotThrow(
    () => AccessPolicy.assertCanUpdate({ users, target: secondOwner, patch: { role: 'owner' }, actor: { email: 'owner@example.com' } })
  );
});

test('nobody may change their own role from the app', () => {
  const users = [owner, secondOwner, member];
  assert.throws(
    () => AccessPolicy.assertCanUpdate({ users, target: owner, patch: { role: 'member' }, actor: { email: 'OWNER@example.com' } }),
    /cannot change your own role/
  );
  assert.throws(
    () => AccessPolicy.assertCanUpdate({ users, target: member, patch: { role: 'owner' }, actor: { email: 'member@example.com' } }),
    /cannot change your own role/
  );
});

test('the last active owner cannot be demoted', () => {
  const users = [owner, member, inactiveOwner];
  assert.throws(
    () => AccessPolicy.assertCanUpdate({ users, target: owner, patch: { role: 'member' }, actor: member }),
    /At least one active owner is required/
  );
});

test('a role outside the vocabulary is rejected', () => {
  const users = [owner, secondOwner, member];
  assert.throws(
    () => AccessPolicy.assertCanUpdate({ users, target: member, patch: { role: 'superuser' }, actor: secondOwner }),
    ValidationError
  );
});

test('the last active owner cannot be deactivated', () => {
  const users = [owner, member, inactiveOwner];
  assert.throws(
    () => AccessPolicy.assertCanUpdate({ users, target: owner, patch: { is_active: false } }),
    /At least one active owner is required/
  );
});

test('deactivating a non-last owner and harmless updates are allowed', () => {
  const users = [owner, secondOwner, member];
  assert.doesNotThrow(() => AccessPolicy.assertCanUpdate({ users, target: secondOwner, patch: { is_active: false } }));
  assert.doesNotThrow(() => AccessPolicy.assertCanUpdate({ users, target: owner, patch: { name: 'New Name' } }));
});

test('nobody can remove their own access', () => {
  assert.throws(
    () => AccessPolicy.assertCanRemove({ users: [owner, secondOwner], target: owner, actor: { email: 'OWNER@example.com' } }),
    /cannot remove your own access/
  );
});

test('the last owner cannot be removed', () => {
  assert.throws(
    () => AccessPolicy.assertCanRemove({ users: [owner, member], target: owner, actor: member }),
    /At least one owner is required/
  );
});

test('a member can always be removed by somebody else', () => {
  assert.doesNotThrow(() => AccessPolicy.assertCanRemove({ users: [owner, member], target: member, actor: owner }));
});
