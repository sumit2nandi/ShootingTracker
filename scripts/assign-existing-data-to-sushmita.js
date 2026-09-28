'use strict';

// ============================================================
// One-time migration: give ALL existing shoot data to
// sushmitaghosh0099@gmail.com.
//
//   node scripts/assign-existing-data-to-sushmita.js
//   npm run assign:existing
//
// What it does, in order:
//   1. Applies server/schema.sql — safe on any database (idempotent), and on
//      databases created before per-user data it adds `shoots.owner_id` and
//      `app_users.tour_completed`.
//   2. Makes sure the target account exists in app_users (created as a member
//      when missing — sushmitaghosh0099@gmail.com by default; an existing row
//      is left as-is).
//   3. Points every shoot that has no owner yet at that account, so all
//      pre-existing data shows up under sushmitaghosh0099@gmail.com.
//      (Shoots already owned by someone else are left alone — use --all to
//      force every row to the account.)
//   4. Marks tour_completed for every account that existed before new sign-ups
//      start arriving, so the first-login tour is only shown to genuinely new
//      accounts.
//
// Reads DATABASE_URL from .env (same as the app). Safe to re-run.
// ============================================================

const { loadConfig, loadEnvFile } = require('../server/config');
const { PostgresDatabase } = require('../server/persistence/postgres-database');
const { SchemaInitializer } = require('../server/persistence/schema-initializer');
const { createLogger } = require('../server/core/logger');

const TARGET_EMAIL = (process.argv[2] || 'sushmitaghosh0099@gmail.com').trim().toLowerCase();
const FORCE_ALL = process.argv.includes('--all');

async function main() {
  const config = loadConfig(loadEnvFile());
  const logger = createLogger({ level: 'info', timestamps: true });

  if (!config.database.url) {
    logger.error('DATABASE_URL is not set — put it in .env (see .env.example) and try again.');
    process.exit(1);
  }

  const database = new PostgresDatabase({
    url: config.database.url,
    connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    idleTimeoutMillis: config.database.idleTimeoutMillis,
    maxClients: 2,
    logger: logger.child('db')
  });

  try {
    // 1. Schema, including the convergence section for older databases.
    await new SchemaInitializer({ database, logger: logger.child('schema') }).apply();
    logger.info('Schema checked/applied.');

    // 2. The target account must exist.
    const existing = await database.query('SELECT id, role, is_active FROM app_users WHERE lower(email) = $1', [
      TARGET_EMAIL
    ]);
    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      logger.info(`Account already present: ${TARGET_EMAIL} (id=${userId}, role=${existing.rows[0].role})`);
    } else {
      const name =
        TARGET_EMAIL === 'sushmitaghosh0099@gmail.com'
          ? 'Sushmita Ghosh'
          : String(TARGET_EMAIL.split('@')[0].split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'User');
      const created = await database.query(
        `INSERT INTO app_users (email, name, role, tour_completed)
         VALUES ($1, $2, 'member', TRUE) RETURNING id`,
        [TARGET_EMAIL, name]
      );
      userId = created.rows[0].id;
      logger.info(`Created account ${TARGET_EMAIL} (id=${userId}, name=${name}, role=member)`);
    }

    // 3. Own existing (unassigned) shoots — or, with --all, every shoot.
    const total = (await database.query('SELECT count(*)::int AS n FROM shoots')).rows[0].n;
    const update = FORCE_ALL
      ? 'UPDATE shoots SET owner_id = $1'
      : 'UPDATE shoots SET owner_id = $1 WHERE owner_id IS NULL';
    const result = await database.query(`${update} RETURNING id`, [userId]);
    const assigned = result.rowCount || 0;
    const stillUnowned = (
      await database.query('SELECT count(*)::int AS n FROM shoots WHERE owner_id IS NULL')
    ).rows[0].n;

    // 4. Existing accounts have already "been here" — no tour for them.
    const tours = await database.query('UPDATE app_users SET tour_completed = TRUE WHERE tour_completed = FALSE');
    const tourCount = tours.rowCount || 0;

    logger.info('------------------------------------------------------');
    logger.info(`Total shoots            : ${total}`);
    logger.info(`Assigned to ${TARGET_EMAIL.padEnd(28)}: ${assigned}${FORCE_ALL ? '  (forced with --all)' : ''}`);
    logger.info(`Still unassigned        : ${stillUnowned}`);
    logger.info(`Tours marked completed  : ${tourCount} account(s)`);
    logger.info('Done. Sign in as this account and the data will be there.');
  } catch (error) {
    logger.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

main();
