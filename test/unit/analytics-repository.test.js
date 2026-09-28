'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RecordingDatabase } = require('../helpers/fakes');
const { AnalyticsRepository } = require('../../server/repositories/analytics-repository');
const { ShootFilter } = require('../../server/domain/shoot-filter');

test('dashboard date windows bind the viewer-local day instead of the database day', async () => {
  const database = new RecordingDatabase();
  const repository = new AnalyticsRepository({ database });
  const filter = ShootFilter.fromQuery({ month: '2026-09', owner: '9' });

  await repository.upcoming(filter, 8, '2026-09-29');
  assert.match(database.calls[0].text, /b\.shoot_date >= \$4::date/);
  assert.match(database.calls[0].text, /b\.shoot_date < \(\$5::date \+ interval '7 days'\)/);
  assert.match(database.calls[0].text, /b\.shoot_date = \$6::date/);
  assert.deepEqual(database.calls[0].params, ['2026-09-01', '2026-09-01', '9', '2026-09-29', '2026-09-29', '2026-09-29']);

  await repository.needsAttention(filter, 8, '2026-09-29');
  assert.match(database.calls[1].text, /b\.shoot_date < \$4::date/);
  assert.match(database.calls[1].text, /b\.shoot_date <> \$5::date/);
  assert.deepEqual(database.calls[1].params, ['2026-09-01', '2026-09-01', '9', '2026-09-29', '2026-09-29']);
});

test('dashboard date windows retain a server-side fallback when no local day is provided', async () => {
  const database = new RecordingDatabase();
  const repository = new AnalyticsRepository({ database });

  await repository.upcoming(ShootFilter.empty());
  assert.match(database.calls[0].text, /b\.shoot_date >= CURRENT_DATE/);
});
