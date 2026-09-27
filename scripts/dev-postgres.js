'use strict';

// Starts a local Postgres (embedded-postgres) for development, applies the
// schema and keeps running until Ctrl+C.
//
//   npm run dev:pg            # reuse the existing dev-data/pg cluster
//   npm run dev:pg -- --fresh # wipe it first and start from an empty database
//
// Then, in another shell:
//   DATABASE_URL=postgres://dev:dev@127.0.0.1:5433/dev npm start

const path = require('path');
const fs = require('fs');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'dev-data', 'pg');
const PORT = Number(process.env.DEV_PG_PORT || 5433);
const SCHEMA_FILE = path.join(__dirname, '..', 'server', 'schema.sql');
const url = (database) => `postgres://dev:dev@127.0.0.1:${PORT}/${database}`;

async function withClient(database, work) {
  const client = new Client({ connectionString: url(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function ensureDatabase() {
  await withClient('postgres', async (client) => {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = 'dev'");
    if (!existing.rows.length) await client.query('CREATE DATABASE dev');
  });
}

async function applySchema() {
  await withClient('dev', (client) => client.query(fs.readFileSync(SCHEMA_FILE, 'utf8')));
}

(async () => {
  if (process.argv.includes('--fresh')) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const needsInit = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));

  const postgres = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'dev',
    password: 'dev',
    port: PORT,
    persistent: true,
    initDB: needsInit
  });

  if (needsInit) await postgres.initialise();
  await postgres.start();
  await ensureDatabase();
  await applySchema(); // schema.sql is idempotent

  console.log(`Dev Postgres ready on 127.0.0.1:${PORT} (db=dev, user=dev, pass=dev) — schema applied.`);
  console.log(`  DATABASE_URL=${url('dev')} npm start`);

  const stop = async () => {
    try {
      await postgres.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30); // keep the process alive
})().catch((error) => {
  console.error('dev postgres failed:', error.message);
  process.exit(1);
});
