'use strict';

const { coerceShootStatus } = require('../domain/shoot-status');

/** Quote a value as a SQL literal (or NULL). */
function quote(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonbLiteral(value) {
  if (!value || Object.keys(value).length === 0) return "'{}'::jsonb";
  return `${quote(JSON.stringify(value))}::jsonb`;
}

/**
 * Render parsed rows as a standalone, re-runnable `.sql` script.
 *
 * Used when the database is only reachable through a web console: the output
 * must be idempotent on its own, so coordinators are upserted, shoots are
 * skipped by dedupe hash and payments are guarded by NOT EXISTS.
 *
 * @param {object[]} rows
 * @param {{ now?: () => Date }} [options]
 * @returns {string}
 */
function emitSql(rows, { now = () => new Date() } = {}) {
  const lines = [
    '-- ===========================================================',
    `-- ShootingTracker import — generated ${now().toISOString()}`,
    '-- Requires the base schema (server/schema.sql) to be applied first.',
    '-- Safe to re-run: duplicates are skipped by dedupe hash.',
    '-- ===========================================================',
    'BEGIN;',
    ''
  ];

  const seen = new Set();
  const coordinators = [];
  for (const row of rows) {
    const name = row.coordinator;
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      coordinators.push(name);
    }
  }

  lines.push('-- 1) coordinators (upsert by name)');
  for (const name of coordinators) {
    lines.push(
      `INSERT INTO coordinators (name) VALUES (${quote(name)})\n` +
        'ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name;'
    );
  }

  lines.push('');
  lines.push('-- 2) shoots (skip duplicates by dedupe hash)');
  rows.forEach((row, index) => {
    const coordinatorRef = row.coordinator
      ? `(SELECT id FROM coordinators WHERE lower(name) = lower(${quote(row.coordinator)}))`
      : 'NULL';
    const values = [
      quote(row.title),
      quote(row.client_name),
      quote(row.shoot_type),
      quote(row.shoot_date),
      row.end_date ? quote(row.end_date) : 'NULL',
      row.start_time ? quote(row.start_time) : 'NULL',
      row.end_time ? quote(row.end_time) : 'NULL',
      quote(row.venue),
      quote(row.location),
      coordinatorRef,
      Number(row.fee || 0),
      quote(coerceShootStatus(row.status)),
      quote(row.contact_name),
      quote(row.contact_phone),
      quote(row.notes),
      jsonbLiteral(row.extra),
      row.dedupe_hash ? quote(row.dedupe_hash) : 'NULL'
    ];
    lines.push(`-- row ${index + 1}: ${row.title} (${row.shoot_date})`);
    lines.push(
      'INSERT INTO shoots (title, client_name, shoot_type, shoot_date, end_date, start_time, end_time,\n' +
        '                    venue, location, coordinator_id, fee, status, contact_name, contact_phone,\n' +
        '                    notes, extra, dedupe_hash)\n' +
        `VALUES (${values.join(', ')})\n` +
        'ON CONFLICT (dedupe_hash) DO NOTHING;'
    );
  });

  lines.push('');
  lines.push('-- 3) payments imported with the data (only for rows whose dedupe hash matched)');
  rows.forEach((row) => {
    if (!row.dedupe_hash) return;
    (row.payments || []).forEach((payment) => {
      lines.push(
        'INSERT INTO payments (shoot_id, amount, paid_on, method, note)\n' +
          `SELECT s.id, ${Number(payment.amount)}, COALESCE(${payment.paid_on ? quote(payment.paid_on) : 'NULL'}::date, CURRENT_DATE), ${quote(payment.method)}, ${quote(payment.note)}\n` +
          'FROM shoots s\n' +
          `WHERE s.dedupe_hash = ${quote(row.dedupe_hash)}\n` +
          `  AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.shoot_id = s.id AND x.amount = ${Number(payment.amount)} AND x.note = ${quote(payment.note)} AND x.method IS NOT DISTINCT FROM ${quote(payment.method)});`
      );
    });
  });

  lines.push('');
  lines.push('COMMIT;');
  return lines.join('\n');
}

module.exports = { emitSql, quote, jsonbLiteral };
