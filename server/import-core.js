'use strict';
// Shared import logic: insert parsed rows into Postgres (idempotent),
// or emit a standalone .sql file for manual execution (Aiven web console).
const { pool } = require('./db');

const STATUSES = ['planned', 'confirmed', 'completed', 'postponed', 'cancelled'];

function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function jsonb(s) {
  if (!s || Object.keys(s).length === 0) return "'{}'::jsonb";
  return esc(JSON.stringify(s)) + '::jsonb';
}

/**
 * Insert rows into the database.
 * Idempotency:
 *  - coordinators upserted by lower(name)
 *  - shoots inserted with ON CONFLICT (dedupe_hash) DO NOTHING
 *  - payments inserted only for newly created shoots
 */
async function importRows(rows) {
  const client = await pool.connect();
  const summary = { inserted: 0, skipped: 0, payments: 0, coordinators: new Set(), errors: [] };
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      try {
        let coordId = null;
        if (row.coordinator) {
          const r = await client.query(
            `INSERT INTO coordinators (name) VALUES ($1)
             ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [row.coordinator]
          );
          coordId = r.rows[0].id;
          summary.coordinators.add(row.coordinator);
        }
        const vals = [
          row.title,
          row.client_name || null,
          row.shoot_type || null,
          row.shoot_date,
          row.end_date || null,
          row.start_time || null,
          row.end_time || null,
          row.venue || null,
          row.location || null,
          coordId,
          row.fee || 0,
          STATUSES.includes(row.status) ? row.status : 'planned',
          row.contact_name || null,
          row.contact_phone || null,
          row.notes || null,
          JSON.stringify(row.extra || {}),
          row.dedupe_hash || null
        ];
        const res = await client.query(
          `INSERT INTO shoots (title, client_name, shoot_type, shoot_date, end_date, start_time, end_time,
                               venue, location, coordinator_id, fee, status, contact_name, contact_phone,
                               notes, extra, dedupe_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
           ON CONFLICT (dedupe_hash) DO NOTHING
           RETURNING id`,
          vals
        );
        if (!res.rows.length) {
          summary.skipped++;
          continue;
        }
        summary.inserted++;
        const shootId = res.rows[0].id;
        for (const p of row.payments || []) {
          await client.query(
            'INSERT INTO payments (shoot_id, amount, paid_on, method, note) VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5)',
            [shootId, p.amount, p.paid_on || null, p.method || null, p.note || null]
          );
          summary.payments++;
        }
      } catch (e) {
        summary.errors.push({ title: row.title, date: row.shoot_date, error: e.message });
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  summary.coordinators = [...summary.coordinators];
  return summary;
}

/**
 * Emit a standalone SQL file (for the Aiven web console) that creates the
 * same data as importRows. Idempotent: re-running it creates no duplicates.
 */
function emitSql(rows) {
  const lines = [];
  lines.push('-- ===========================================================');
  lines.push('-- ShootingTracker import — generated ' + new Date().toISOString());
  lines.push('-- Requires the base schema (server/schema.sql) to be applied first.');
  lines.push('-- Safe to re-run: duplicates are skipped by dedupe hash.');
  lines.push('-- ===========================================================');
  lines.push('BEGIN;');
  lines.push('');

  const coordNames = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.coordinator && !seen.has(row.coordinator.toLowerCase())) {
      seen.add(row.coordinator.toLowerCase());
      coordNames.push(row.coordinator);
    }
  }
  lines.push('-- 1) coordinators (upsert by name)');
  for (const n of coordNames) {
    lines.push(
      `INSERT INTO coordinators (name) VALUES (${esc(n)})\n` +
      `ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name;`
    );
  }
  lines.push('');
  lines.push('-- 2) shoots (skip duplicates by dedupe hash)');
  rows.forEach((row, i) => {
    const coordRef = row.coordinator
      ? `(SELECT id FROM coordinators WHERE lower(name) = lower(${esc(row.coordinator)}))`
      : 'NULL';
    const values = [
      esc(row.title),
      esc(row.client_name),
      esc(row.shoot_type),
      esc(row.shoot_date),
      row.end_date ? esc(row.end_date) : 'NULL',
      row.start_time ? esc(row.start_time) : 'NULL',
      row.end_time ? esc(row.end_time) : 'NULL',
      esc(row.venue),
      esc(row.location),
      coordRef,
      Number(row.fee || 0),
      esc(STATUSES.includes(row.status) ? row.status : 'planned'),
      esc(row.contact_name),
      esc(row.contact_phone),
      esc(row.notes),
      jsonb(row.extra),
      row.dedupe_hash ? esc(row.dedupe_hash) : 'NULL'
    ];
    lines.push(`-- row ${i + 1}: ${row.title} (${row.shoot_date})`);
    lines.push(
      `INSERT INTO shoots (title, client_name, shoot_type, shoot_date, end_date, start_time, end_time,\n` +
      `                    venue, location, coordinator_id, fee, status, contact_name, contact_phone,\n` +
      `                    notes, extra, dedupe_hash)\n` +
      `VALUES (${values.join(', ')})\n` +
      `ON CONFLICT (dedupe_hash) DO NOTHING;`
    );
  });
  lines.push('');
  lines.push('-- 3) payments imported with the data (only for rows whose dedupe hash matched)');
  rows.forEach((row, i) => {
    (row.payments || []).forEach((p, j) => {
      if (!row.dedupe_hash) return;
      lines.push(
        `INSERT INTO payments (shoot_id, amount, paid_on, method, note)\n` +
        `SELECT s.id, ${Number(p.amount)}, COALESCE(${p.paid_on ? esc(p.paid_on) : 'NULL'}::date, CURRENT_DATE), ${esc(p.method)}, ${esc(p.note)}\n` +
        `FROM shoots s\n` +
        `WHERE s.dedupe_hash = ${esc(row.dedupe_hash)}\n` +
        `  AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.shoot_id = s.id AND x.amount = ${Number(p.amount)} AND x.note = ${esc(p.note)} AND x.method IS NOT DISTINCT FROM ${esc(p.method)});`
      );
    });
  });
  lines.push('');
  lines.push('COMMIT;');
  return lines.join('\n');
}

module.exports = { importRows, emitSql, esc };
