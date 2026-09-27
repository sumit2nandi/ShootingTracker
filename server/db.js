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

const url = process.env.DATABASE_URL || '';
const isRemote = url.includes('aivencloud.com') || url.includes('sslmode');

const pool = new Pool({
  connectionString: url || undefined,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
});

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

module.exports = { pool, query, checkHealth };
