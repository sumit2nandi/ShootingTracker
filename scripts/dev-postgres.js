'use strict';
// Starts a throwaway local Postgres (embedded-postgres) for development,
// applies the schema, and keeps running until Ctrl+C.
// Usage: npm run dev:pg   → then in another shell:
//   DATABASE_URL=postgres://dev:dev@127.0.0.1:5433/dev npm start
const path = require('path');
const fs = require('fs');
const EmbeddedPostgres = require('embedded-postgres').default;

const DIR = path.join(__dirname, '..', 'dev-data', 'pg');
const PORT = 5433;

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: DIR,
    user: 'dev',
    password: 'dev',
    port: PORT,
    persistent: true,
    initDB: true
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('dev');
  const { pool } = require('../server/db');
  await pool.query('SELECT 1').catch(() => {});
  await pool.end();
  // apply schema against the dev db
  const devPool = require('pg').Pool ? null : null;
  const { Client } = require('pg');
  const client = new Client({ connectionString: `postgres://dev:dev@127.0.0.1:${PORT}/dev` });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8'));
  console.log(`Dev Postgres ready on 127.0.0.1:${PORT} (db=dev, user=dev, pass=dev) — schema applied.`);
  await client.end();
  process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
  setInterval(() => {}, 1 << 30); // keep alive
})().catch((e) => {
  console.error('dev postgres failed:', e.message);
  process.exit(1);
});
