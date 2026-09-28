'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TtlCache } = require('../../server/core/ttl-cache');
const { createLogger } = require('../../server/core/logger');
const { loadConfig } = require('../../server/config');
const { ConfigurationError, AppError, NotFoundError } = require('../../server/core/errors');
const { parseId } = require('../../server/domain/identifier');

test('TtlCache expires entries individually', () => {
  let now = 1000;
  const cache = new TtlCache({ ttlMs: 100, clock: () => now });

  cache.set('a', 'first');
  now = 1050;
  cache.set('b', 'second');

  assert.equal(cache.get('a'), 'first');
  now = 1120; // 'a' is 120ms old, 'b' only 70ms
  assert.equal(cache.get('a'), undefined, 'the older entry expired');
  assert.equal(cache.get('b'), 'second', 'the newer entry is still valid');
});

test('TtlCache caches a null answer (unknown accounts stay cheap)', () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  cache.set('nobody@example.com', null);
  // `null` is a cached answer ("this account does not exist"); only `undefined`
  // means "not cached", which is what stops repeated lookups for unknown users.
  assert.equal(cache.get('nobody@example.com'), null);
  assert.equal(cache.has('nobody@example.com'), true);
  assert.equal(cache.get('someone-else@example.com'), undefined);
});

test('TtlCache is bounded', () => {
  const cache = new TtlCache({ ttlMs: 1000, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), undefined);
});

test('logger honours its level and scope', () => {
  const lines = [];
  const sink = { log: (...args) => lines.push(args.join(' ')), warn: () => {}, error: () => {} };
  const logger = createLogger({ level: 'info', sink, scope: 'app', timestamps: false });

  logger.debug('hidden');
  logger.info('visible');
  logger.child('db').info('nested');

  assert.deepEqual(lines, ['[app] visible', '[app:db] nested']);
});

test('config applies defaults and validates', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.auth.googleClientId, null);
  assert.equal(config.auth.sessionSecretProvided, false);
  assert.ok(config.auth.sessionSecret.length >= 32, 'a secret is generated when none is configured');
  assert.throws(() => loadConfig({ PORT: 'not-a-port' }), ConfigurationError);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'chatty' }), ConfigurationError);
});

test('config is frozen so nothing can mutate settings at runtime', () => {
  const config = loadConfig({ PORT: '4000' });
  assert.throws(() => {
    config.port = 1;
  }, TypeError);
});

test('error hierarchy carries status and exposure', () => {
  const notFound = new NotFoundError();
  assert.equal(notFound.status, 404);
  assert.equal(notFound.expose, true);
  assert.ok(notFound instanceof AppError);

  const internal = new AppError('secret detail');
  assert.equal(internal.status, 500);
  assert.equal(internal.expose, false, '5xx messages are never exposed by default');
});

test('parseId accepts positive integers only', () => {
  assert.equal(parseId('42'), 42);
  assert.throws(() => parseId('abc'), /id must be a positive integer/);
  assert.throws(() => parseId('-1'), /positive integer/);
  assert.throws(() => parseId(undefined), /positive integer/);
});
