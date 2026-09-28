'use strict';

/**
 * The browser modules are plain ES modules with their dependencies injected, so
 * the pure ones (formatting, filters, CSV, transport) can be imported and
 * tested in Node — no browser, no build step, no DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const appDir = path.join(__dirname, '..', '..', 'public', 'js', 'app');
const load = (relative) => import(pathToFileURL(path.join(appDir, relative)).href);

test('money and dates are formatted for the Indian locale', async () => {
  const { formatMoney, formatMoneyShort, formatDate, formatShortDate, formatTime, formatMonth, daySpan, dayKey } =
    await load('core/format.js');

  assert.equal(formatMoney(45000), '₹45,000');
  assert.equal(formatMoney(null), '₹0');
  assert.equal(formatMoneyShort(25000000), '₹2.5Cr');
  assert.equal(formatMoneyShort(250000), '₹2.5L');
  assert.equal(formatMoneyShort(45000), '₹45k');
  assert.equal(formatMoneyShort(800), '₹800');

  assert.equal(formatDate('2026-04-02'), '2 Apr 2026');
  assert.equal(formatDate(''), '—');
  assert.equal(formatShortDate('2026-04-02'), '2 Apr');
  assert.equal(formatTime('14:30:00'), '2:30 pm');
  assert.equal(formatTime('00:15:00'), '12:15 am');
  assert.equal(formatMonth('2026-04'), 'Apr 2026');

  assert.equal(daySpan('2026-04-02', '2026-04-05'), 4);
  assert.equal(daySpan('2026-04-02', null), 1);
  assert.equal(dayKey(new Date(2026, 3, 2)), '2026-04-02', 'local date, never UTC-shifted');
});

test('markup helpers escape user content', async () => {
  const { escapeHtml, text } = await load('core/dom.js');
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("O'Brien & Co"), 'O&#39;Brien &amp; Co');
  assert.equal(text('  '), '');
  assert.equal(text(null), '');
});

test('legacy statuses fold into the two the app knows', async () => {
  const { appStatus, statusPill, statusLabel, paymentLabel } = await load('domain/shoot-status.js');
  assert.equal(appStatus('confirmed'), 'planned');
  assert.equal(appStatus('postponed'), 'planned');
  assert.equal(appStatus('cancelled'), 'completed');
  assert.equal(appStatus('completed'), 'completed');
  assert.equal(statusLabel('planned'), 'Planned');
  assert.equal(paymentLabel('partial'), 'Partially Paid');
  assert.match(statusPill('cancelled'), /class="pill completed">Completed</);
});

test('filter criteria serialize to a query string', async () => {
  const { FilterCriteria, FILTER_KEYS } = await load('domain/filter-criteria.js');

  const empty = FilterCriteria.empty();
  assert.equal(empty.toQueryString(), '');
  assert.equal(empty.isActive, false);

  const filters = new FilterCriteria({ month: '2026-04', q: 'beach wedding', ignored: 'nope' });
  assert.equal(filters.toQueryString(), 'month=2026-04&q=beach+wedding');
  assert.equal(filters.isActive, true);
  assert.equal(filters.ignored, undefined, 'only known keys are kept');
  assert.deepEqual(Object.keys(filters.toJSON()), [...FILTER_KEYS]);

  const narrowed = filters.with({ status: 'planned' });
  assert.equal(narrowed.status, 'planned');
  assert.equal(filters.status, '', 'criteria are immutable');
});

test('the CSV export keeps the original spreadsheet layout', async () => {
  const { buildExportCsv } = await load('domain/csv-export.js');

  const csv = buildExportCsv([
    { id: 2, shoot_date: '2026-05-10', title: 'Second, with comma', coordinator: 'Riya', fee: 1000, status: 'planned' },
    { id: 1, shoot_date: '2026-04-02', title: 'First', coordinator: 'Arjun', fee: 45000, status: 'completed' }
  ]);
  const lines = csv.split('\n');

  assert.equal(lines[0], 'Date,Description,Coordinator ,Remuneration,Status,,Month,Total,,Advance,,');
  assert.ok(lines[1].startsWith('2-April-2026,First,Arjun,45000,Done'), lines[1]);
  assert.match(lines[1], /April,45000/, 'the month block totals that month');
  assert.match(lines[2], /"Second, with comma"/, 'commas are quoted');
  assert.ok(lines[2].includes(',,'), 'a planned shoot has an empty status cell');
  assert.equal(buildExportCsv([]), '');
});

test('the api client sends JSON, unwraps errors and reports 401 once', async () => {
  const { ApiClient } = await load('data/api-client.js');
  const calls = [];
  const respond = (status, body, json = true) => ({
    ok: status < 400,
    status,
    headers: { get: () => (json ? 'application/json' : 'text/plain') },
    json: async () => body,
    text: async () => body
  });

  let unauthorized = 0;
  const client = new ApiClient({
    onUnauthorized: () => unauthorized++,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/boom')) return respond(500, { error: 'Internal server error' });
      if (url.includes('/gone')) return respond(401, { error: 'Sign-in required' });
      return respond(200, { ok: true });
    }
  });

  assert.deepEqual(await client.get('/api/shoots', 'month=2026-04'), { ok: true });
  assert.equal(calls[0].url, '/api/shoots?month=2026-04');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'same-origin');

  await client.post('/api/shoots', { title: 'New' });
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body, '{"title":"New"}');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');

  await assert.rejects(client.get('/boom'), /Internal server error/);
  await assert.rejects(client.get('/gone'), /session has expired/);
  assert.equal(unauthorized, 1);
});

test('the API facade maps use cases onto endpoints', async () => {
  const { ShootingTrackerApi } = await load('data/shooting-tracker-api.js');
  const calls = [];
  const record = (method) => (path, arg) => {
    calls.push([method, path, arg]);
    return Promise.resolve({ users: [], user: { email: 'a@example.com' } });
  };
  const api = new ShootingTrackerApi({
    client: { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') }
  });

  await api.listShootsBetween('2026-04-01', '2026-04-30');
  await api.addPayment(7, { amount: 100 });
  await api.deletePayment(3);
  await api.updateUser(2, { is_active: false });
  await api.currentUser();

  assert.deepEqual(calls[0], ['GET', '/api/shoots', 'from=2026-04-01&to=2026-04-30']);
  assert.deepEqual(calls[1], ['POST', '/api/shoots/7/payments', { amount: 100 }]);
  assert.deepEqual(calls[2], ['DELETE', '/api/payments/3', undefined]);
  assert.deepEqual(calls[3], ['PATCH', '/api/users/2', { is_active: false }]);
  assert.deepEqual(calls[4], ['GET', '/api/auth/me', undefined]);
});

test('the owner’s viewing choice rides along on reads and on writes', async () => {
  const { ShootingTrackerApi } = await load('data/shooting-tracker-api.js');
  const calls = [];
  const record = (method) => (path, body, query) => {
    calls.push([method, path, body, query]);
    return Promise.resolve({ user: { email: 'a@example.com' }, users: [] });
  };
  const api = new ShootingTrackerApi({
    client: { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') }
  });

  assert.equal(api.withViewing('month=2026-04'), 'month=2026-04', 'no choice → the query is untouched');

  api.setViewingAs('Other@Example.com');
  const viewingAs = encodeURIComponent('other@example.com');
  await api.listShoots('month=2026-04');
  await api.dashboard('');
  await api.listShootsBetween('2026-04-01', '2026-04-30');
  await api.meta();
  await api.getShoot(9);
  await api.createShoot({ title: 'X' });
  await api.updateShoot(7, { fee: 1 });

  assert.deepEqual(calls[0], ['GET', '/api/shoots', `month=2026-04&viewingAs=${viewingAs}`, undefined]);
  assert.deepEqual(calls[1], ['GET', '/api/dashboard', `viewingAs=${viewingAs}`, undefined]);
  assert.deepEqual(calls[2], ['GET', '/api/shoots', `from=2026-04-01&to=2026-04-30&viewingAs=${viewingAs}`, undefined]);
  assert.deepEqual(calls[3], ['GET', '/api/meta', `viewingAs=${viewingAs}`, undefined]);
  assert.deepEqual(calls[4], ['GET', '/api/shoots/9', `viewingAs=${viewingAs}`, undefined], 'the detail read follows the choice');
  assert.deepEqual(calls[5], ['POST', '/api/shoots', { title: 'X' }, `viewingAs=${viewingAs}`], 'a create follows the choice too');
  assert.deepEqual(calls[6], ['PUT', '/api/shoots/7', { fee: 1 }, `viewingAs=${viewingAs}`], '…and so does an update');

  api.setViewingAs(null);
  assert.equal(api.withViewing(''), undefined, 'and it can be switched back off');
  await api.createShoot({ title: 'Y' });
  assert.deepEqual(calls[7], ['POST', '/api/shoots', { title: 'Y' }, undefined], 'back on own data → plain write');
});

test('the tour-completion call hits the auth endpoint', async () => {
  const { ShootingTrackerApi } = await load('data/shooting-tracker-api.js');
  const calls = [];
  const api = new ShootingTrackerApi({ client: { post: (path, body) => calls.push([path, body]) } });
  await api.markTourCompleted();
  assert.deepEqual(calls, [['/api/auth/me/tour-completed', undefined]]);
});

test('calendar grouping spreads multi-day shoots across their range', async () => {
  const { groupByDay, pageDelta } = await load('ui/calendar-view.js');

  const byDate = groupByDay([
    { id: 1, shoot_date: '2026-04-02', end_date: '2026-04-04', title: 'Wedding' },
    { id: 2, shoot_date: '2026-04-04', end_date: null, title: 'Portrait' }
  ]);
  assert.deepEqual(Object.keys(byDate), ['2026-04-02', '2026-04-03', '2026-04-04']);
  assert.equal(byDate['2026-04-04'].length, 2);
  assert.equal(groupByDay([{ id: 3, shoot_date: '2026-04-01', end_date: '2027-04-01' }])['2026-04-01'].length, 1);
  assert.equal(Object.keys(groupByDay([{ id: 3, shoot_date: '2026-04-01', end_date: '2027-04-01' }])).length, 30, 'runaway ranges are capped');

  assert.equal(pageDelta(0, 400), -1);
  assert.equal(pageDelta(400, 400), 0);
  assert.equal(pageDelta(800, 400), 1);
  assert.equal(pageDelta(100, 0), 0);
});

test('the shoots table groups rows by month in API order', async () => {
  const { groupByMonth } = await load('ui/shoots-view.js');
  const groups = groupByMonth([
    { id: 1, shoot_date: '2026-05-02' },
    { id: 2, shoot_date: '2026-04-30' },
    { id: 3, shoot_date: '2026-05-20' },
    { id: 4, shoot_date: null }
  ]);
  assert.deepEqual([...groups.keys()], ['2026-05', '2026-04', 'undated']);
  assert.equal(groups.get('2026-05').length, 2);
});

test('a shoot can be wrapped up from the dashboard after 7 pm IST', async () => {
  const { isWrapUpTime, zonedNow, outstandingAmount, WRAP_UP_HOUR } = await load('domain/wrap-up.js');

  // 13:35 UTC is 19:05 in Kolkata (+5:30)
  const evening = new Date('2026-04-02T13:35:00Z');
  const lateAfternoon = new Date('2026-04-02T13:25:00Z'); // 18:55 IST

  assert.equal(WRAP_UP_HOUR, 19);
  assert.deepEqual(zonedNow(evening), { date: '2026-04-02', hour: 19 });
  assert.equal(isWrapUpTime('2026-04-02', evening), true);
  assert.equal(isWrapUpTime('2026-04-02', lateAfternoon), false, 'not before 7 pm');
  assert.equal(isWrapUpTime('2026-04-03', evening), false, 'only today’s shoots');
  assert.equal(isWrapUpTime('', evening), false);

  // 19:00 UTC is already past midnight in Kolkata, so it is the next day at 00:30
  const pastMidnightIst = new Date('2026-04-02T19:00:00Z');
  assert.deepEqual(zonedNow(pastMidnightIst), { date: '2026-04-03', hour: 0 });
  assert.equal(isWrapUpTime('2026-04-03', pastMidnightIst), false);

  assert.equal(outstandingAmount({ fee: '45000.00', paid_amount: '20000.00' }), 25000);
  assert.equal(outstandingAmount({ fee: 1000, paid_amount: 1000 }), 0);
  assert.equal(outstandingAmount({ fee: 1000, paid_amount: 1500 }), 0, 'never negative');
});

test('the store notifies subscribers on every update', async () => {
  const { Store } = await load('core/store.js');
  const store = new Store({ view: 'dashboard' });
  const seen = [];
  const unsubscribe = store.subscribe((state) => seen.push(state.view));

  store.update({ view: 'shoots' });
  store.update({ user: { email: 'a@example.com' } });
  unsubscribe();
  store.update({ view: 'calendar' });

  assert.deepEqual(seen, ['shoots', 'shoots']);
  assert.equal(store.get().view, 'calendar');
  assert.deepEqual(store.get().user, { email: 'a@example.com' });
});

test('the profile avatar falls back through name, email and a placeholder', async () => {
  const { ProfileView } = await load('ui/profile-view.js');
  assert.equal(ProfileView.initial({ name: 'Sumit Nandi', email: 'a@b.c' }), 'S');
  assert.equal(ProfileView.initial({ email: 'zoe@example.com' }), 'Z');
  assert.equal(ProfileView.initial({ name: '  ' }), '?');
  assert.equal(ProfileView.initial(null), '?');
});

test('the event bus supports unsubscription', async () => {
  const { EventBus } = await load('core/events.js');
  const bus = new EventBus();
  let count = 0;
  const off = bus.on('ping', () => count++);
  bus.emit('ping');
  off();
  bus.emit('ping');
  assert.equal(count, 1);
});

test('overlays wait for their exit animation before hiding', async () => {
  const { openOverlay, closeOverlay, prefersReducedMotion } = await load('core/motion.js');
  const overlay = () => {
    const classes = new Set(['hidden']);
    return {
      classes,
      firstElementChild: null,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) }
    };
  };

  global.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(prefersReducedMotion(), false);

  const animated = overlay();
  openOverlay(animated);
  assert.equal(animated.classes.has('hidden'), false);

  closeOverlay(animated);
  assert.equal(animated.classes.has('closing'), true, 'it plays the exit animation first');
  assert.equal(animated.classes.has('hidden'), false);
  await new Promise((resolve) => setTimeout(resolve, 420));
  assert.deepEqual([...animated.classes], ['hidden'], 'and only then leaves the screen');

  // someone who asked for less motion gets the same result, immediately
  global.window = { matchMedia: () => ({ matches: true }) };
  assert.equal(prefersReducedMotion(), true);
  const instant = overlay();
  openOverlay(instant);
  closeOverlay(instant);
  assert.equal(instant.classes.has('hidden'), true);
  assert.equal(instant.classes.has('closing'), false);
  delete global.window;
});

test('a disclosure without the animation API keeps working natively', async () => {
  const { animateDisclosure } = await load('core/motion.js');
  const details = { dataset: {}, querySelector: () => null, children: [] };
  assert.doesNotThrow(() => animateDisclosure(details));
  assert.equal(details.dataset.motion, undefined, 'no listener is attached when it cannot animate');
});

test('the theme follows storage first and the OS second', async () => {
  const { ThemeController } = await load('core/theme.js');
  const attributes = {};
  const store = new Map();
  const controller = new ThemeController({
    root: { setAttribute: (name, value) => (attributes[name] = value) },
    storage: { get: (key) => store.get(key) ?? null, set: (key, value) => store.set(key, value) },
    media: { matches: true, addEventListener() {} }
  });

  assert.equal(controller.current, 'dark', 'no stored choice → follow the OS');
  controller.toggle();
  assert.equal(attributes['data-theme'], 'light');
  assert.equal(controller.current, 'light', 'the stored choice now wins over the OS');
});
