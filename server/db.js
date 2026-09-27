'use strict';
require('dotenv').config();
const pg = require('pg');
const { Pool } = pg;

// Serialize DATE / TIME / TIMESTAMP columns as plain strings (not JS Dates)
// so the JSON API returns "2026-04-02", "10:00:00", etc.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1083, (v) => v); // time
pg.types.setTypeParser(1114, (v) => v); // timestamp
pg.types.setTypeParser(1184, (v) => v); // timestamptz

/**
 * Build pg Pool options from DATABASE_URL.
 *
 * We parse the URL ourselves instead of passing `connectionString` to pg:
 * pg >= 8.16 (pg-connection-string) parses `?sslmode=require` into `ssl: {}`,
 * and that object OVERRIDES an explicit `ssl` option (see pg
 * lib/connection-parameters.js: Object.assign(config, parse(connectionString))).
 * Result: Node silently validates the certificate chain, which breaks behind
 * corporate TLS-inspection proxies ("self-signed certificate in certificate
 * chain"). Parsing explicitly keeps `rejectUnauthorized: false` in effect.
 *
 * TLS note: for remote hosts we skip certificate verification (convenience for
 * dev tools behind corporate proxies). If you want strict verification, point
 * Node at the issuing CA instead:  NODE_EXTRA_CA_CERTS=/path/to/ca.crt
 */
function buildPoolConfig(url) {
  const base = {
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
  };
  if (!url) return base;

  let u;
  try {
    u = new URL(url);
  } catch (e) {
    throw new Error(`DATABASE_URL is not a valid URL: ${e.message}`);
  }

  const isRemote = u.hostname.includes('aivencloud.com') || url.includes('sslmode');
  return {
    ...base,
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: u.pathname.replace(/^\//, '') || undefined,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined
  };
}

const url = process.env.DATABASE_URL || '';
const pool = new Pool(buildPoolConfig(url));

pool.on('error', (e) => {
  console.error('[db] idle client error:', e.message);
});

/**
 * Simple query helper.
 */
const query = (text, params) => pool.query(text, params);

/**
 * Health check with a short timeout — used by the UI status pill and
 * by `npm run migrate`. Resolves { ok, detail, latencyMs }.
 */
async function checkHealth(timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve({ ok, detail, latencyMs: Date.now() - started });
    };
    const t = setTimeout(() => done(false, 'timeout'), timeoutMs);
    pool.connect((err, client) => {
      if (err) { return done(false, err.message); }
      client.query('SELECT 1').then(() => {
        client.release();
        done(true, 'connected');
      }).catch((e) => {
        client.release();
        done(false, e.message);
      });
    });
  });
}

module.exports = { pool, query, checkHealth, buildPoolConfig };
