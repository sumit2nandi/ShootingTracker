'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ShootFilter } = require('../../server/domain/shoot-filter');

test('an empty filter produces no WHERE clause', () => {
  const { where, params } = ShootFilter.fromQuery({}).toSql();
  assert.equal(where, '');
  assert.deepEqual(params, []);
});

test('unknown query parameters are ignored', () => {
  const filter = ShootFilter.fromQuery({ nonsense: 'x', 'DROP TABLE': '1' });
  assert.equal(filter.isEmpty, true);
});

test('month filter binds parameters instead of interpolating', () => {
  const { where, params } = ShootFilter.fromQuery({ month: '2026-04' }).toSql();
  assert.match(where, /WHERE b\.shoot_date >= \$1::date AND b\.shoot_date < \(\$2::date \+ interval '1 month'\)/);
  assert.deepEqual(params, ['2026-04-01', '2026-04-01']);
});

test('malformed month and year values are dropped', () => {
  assert.equal(ShootFilter.fromQuery({ month: '2026-4' }).toSql().where, '');
  assert.equal(ShootFilter.fromQuery({ year: "2026'; DROP TABLE shoots--" }).toSql().where, '');
});

test('coordinator accepts an id or a name', () => {
  assert.match(ShootFilter.fromQuery({ coordinator: '7' }).toSql().where, /coordinator_id = \$1::int/);
  const byName = ShootFilter.fromQuery({ coordinator: 'Riya Saha' }).toSql();
  assert.match(byName.where, /lower\(b\.coordinator\) = lower\(\$1\)/);
  assert.deepEqual(byName.params, ['Riya Saha']);
});

test('status list keeps only known statuses and binds one array', () => {
  const { where, params } = ShootFilter.fromQuery({ status: 'planned,bogus,completed' }).toSql();
  assert.match(where, /b\.status = ANY\(\$1\)/);
  assert.deepEqual(params, [['planned', 'completed']]);
  assert.equal(ShootFilter.fromQuery({ status: 'bogus' }).toSql().where, '', 'no valid status → no clause');
});

test('search binds the same pattern to every searched column', () => {
  const { where, params } = ShootFilter.fromQuery({ q: "O'Brien" }).toSql();
  assert.equal(params.length, 6);
  assert.deepEqual(new Set(params), new Set(["%O'Brien%"]));
  assert.match(where, /b\.extra::text ILIKE \$6/);
});

test('payment status maps to the ledger predicates', () => {
  assert.match(ShootFilter.fromQuery({ paymentStatus: 'paid' }).toSql().where, /paid_amount >= b\.fee/);
  assert.match(ShootFilter.fromQuery({ paymentStatus: 'outstanding' }).toSql().where, /fee > 0 AND b\.paid_amount < b\.fee/);
  assert.equal(ShootFilter.fromQuery({ paymentStatus: 'invented' }).toSql().where, '');
});

test('placeholders stay sequential when rules combine', () => {
  const { where, params } = ShootFilter.fromQuery({ month: '2026-04', client: 'Acme', minFee: '100' }).toSql();
  assert.deepEqual(params, ['2026-04-01', '2026-04-01', 'Acme', '100']);
  assert.match(where, /\$1.*\$2.*\$3.*\$4/s);
  assert.equal((where.match(/ AND /g) || []).length, 3);
});

test('extra conditions are appended without rewriting the clause', () => {
  const { where, params } = ShootFilter.fromQuery({ client: 'Acme' }).toSql({
    extraConditions: ['b.shoot_date >= CURRENT_DATE']
  });
  assert.equal(where, 'WHERE lower(b.client_name) = lower($1) AND b.shoot_date >= CURRENT_DATE');
  assert.deepEqual(params, ['Acme']);
});

test('extra conditions work on an otherwise empty filter', () => {
  const { where } = ShootFilter.empty().toSql({ extraConditions: ['b.status = \'planned\''] });
  assert.equal(where, "WHERE b.status = 'planned'");
});

test('the alias is configurable for reuse in other queries', () => {
  const { where } = ShootFilter.fromQuery({ client: 'Acme' }).toSql({ alias: 's' });
  assert.match(where, /lower\(s\.client_name\)/);
});
