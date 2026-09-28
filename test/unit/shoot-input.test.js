'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ShootInput } = require('../../server/domain/shoot-input');
const { ValidationError } = require('../../server/core/errors');

test('create requires a title and a date', () => {
  assert.throws(() => ShootInput.forCreate({ title: 'x' }), ValidationError);
  assert.throws(() => ShootInput.forCreate({ shoot_date: '2026-01-01' }), /title and shoot_date are required/);
});

test('create fills NOT NULL defaults', () => {
  const input = ShootInput.forCreate({ title: 'Wedding', shoot_date: '2026-01-01' });
  assert.equal(input.values.status, 'planned');
  assert.equal(input.values.fee, 0);
  assert.deepEqual(input.values.extra, {});
  assert.equal(input.values.venue, null);
});

test('unknown columns never reach the database', () => {
  const input = ShootInput.forCreate({
    title: 'Wedding',
    shoot_date: '2026-01-01',
    'is_admin; DROP TABLE shoots': true,
    id: 99
  });
  assert.equal(input.values.id, undefined);
  assert.ok(input.columns.every((column) => /^[a-z_]+$/.test(column)));
});

test('an unknown status folds into the default', () => {
  const input = ShootInput.forCreate({ title: 'T', shoot_date: '2026-01-01', status: 'cancelled' });
  assert.equal(input.values.status, 'planned');
});

test('empty strings become NULL', () => {
  const input = ShootInput.forUpdate({ venue: '', notes: null });
  assert.deepEqual(input.values, { venue: null, notes: null });
});

test('a coordinator name is separated from the column values', () => {
  const input = ShootInput.forUpdate({ coordinator: '  Riya Saha  ' });
  assert.equal(input.coordinatorName, 'Riya Saha');
  assert.equal(input.values.coordinator, undefined, 'the name is not a column');
});

test('a numeric coordinator is treated as an id', () => {
  const input = ShootInput.forUpdate({ coordinator: '12' });
  assert.equal(input.values.coordinator_id, 12);
  assert.equal(input.coordinatorName, undefined);
});

test('clearing the coordinator nulls the link', () => {
  const input = ShootInput.forUpdate({ coordinator: '' });
  assert.equal(input.values.coordinator_id, null);
  assert.equal(input.coordinatorName, null);
});

test('an explicit coordinator_id is honoured on its own (regression)', () => {
  const input = ShootInput.forUpdate({ coordinator_id: 5 });
  assert.equal(input.values.coordinator_id, 5);
});

test('an explicit coordinator_id wins over a name', () => {
  const input = ShootInput.forUpdate({ coordinator_id: 5, coordinator: 'Someone Else' });
  assert.equal(input.values.coordinator_id, 5);
  assert.equal(input.coordinatorName, undefined);
});

test('update rejects an empty patch', () => {
  assert.throws(() => ShootInput.forUpdate({}), /no fields to update/);
});

test('update only carries the keys that were sent', () => {
  const input = ShootInput.forUpdate({ status: 'completed', fee: '12000' });
  assert.deepEqual(input.values, { fee: 12000, status: 'completed' });
});

test('a non-object extra is replaced by an empty object', () => {
  assert.deepEqual(ShootInput.forUpdate({ extra: 'nope' }).values.extra, {});
});
