'use strict';
// Dev Postgres runner (background): starts embedded Postgres on :5433,
// applies schema if missing, keeps running until stopped.
const path = require('path');
const fs = require('fs');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'dev-data', 'pg');
const PORT = 5433;

(async () => {
  const needsInit = !fs.existsSync(path.join(DIR, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: DIR,
    user: 'dev',
    password: 'dev',
    port: PORT,
    persistent: true,
    initDB: needsInit
  });
  if (needsInit) await pg.initialise();
  await pg.start();
  const c = new Client({ connectionString: `postgres://dev:dev@127.0.0.1:${PORT}/postgres` });
  await c.connect();
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = 'dev'");
  if (!exists.rows.length) await c.query('CREATE DATABASE dev');
  const d = new Client({ connectionString: `postgres://dev:dev@127.0.0.1:${PORT}/dev` });
  await d.connect();
  const has = await d.query("SELECT to_regclass('public.shoots') AS t");
  if (!has.rows[0].t) {
    await d.query(fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8'));
    console.log('schema applied');
  }
  await d.end(); await c.end();
  console.log(`dev Postgres ready on 127.0.0.1:${PORT} (dev/dev, db=dev)`);
  process.on('SIGINT', async () => { try { await pg.stop(); } catch {} process.exit(0); });
  setInterval(() => {}, 1 << 30);
})().catch((e) => { console.error('dev postgres failed:', e.message); process.exit(1); });
